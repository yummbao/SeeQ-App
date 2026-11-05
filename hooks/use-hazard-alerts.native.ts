import { HazardReceiveClockAudit, formatHazardTiming, type HazardReceiveTiming } from '@/lib/hazard-receive-timing';
import { HAZARD_TEST_MESSAGES } from '@/lib/hazard-alert-policy';
import { runHazardOutput } from '@/lib/hazard-output-sequence';
import { getHazardSoundUri, prepareHazardSounds } from '@/lib/hazard-sounds.native';
import { playHazardTone } from '@/lib/hazard-tone-player';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import * as ExpoSpeech from 'expo-speech';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { Vibration } from '@/lib/platform/vibration';

import { HazardArbiter, normalizeHazardUrl, type HazardSignal, type HazardType } from '@/lib/hazard-protocol';
import { openHazardSocket } from '@/lib/hazard-socket';
import { isHazardAudioActive, setHazardAudioActive } from '@/lib/speech-priority';

type Warning = HazardSignal & { isTest: boolean };
type ConnectionStatus = '설정 필요' | '꺼짐' | '연결 중' | '연결됨' | '재연결 대기' | '앱 복귀 대기';
const STORAGE_KEY = 'seeq:hazard-websocket-url';

export function useHazardAlerts(options: { allowed: boolean; onResumeGuidance: () => void }) {
  const [endpoint, setEndpoint] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [hydrated, setHydrated] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [appState, setAppState] = useState(AppState.currentState);
  const [connectionStatus, setStatus] = useState<ConnectionStatus>('연결 중');
  const [error, setError] = useState('');
  const [audioError, setAudioError] = useState('');
  const lastFrameLog = useRef({ key: '', at: -Infinity });
  const clockAudit = useRef(new HazardReceiveClockAudit());
  const frameTiming = useRef<HazardReceiveTiming | null>(null);
  const [warning, setWarning] = useState<Warning | null>(null);
  const [lastSignal, setLastSignal] = useState<Warning | null>(null);
  const arbiter = useRef(new HazardArbiter());
  const warningRef = useRef<Warning | null>(null);
  const activeRef = useRef(true);
  const speechBusy = useRef(false);
  const runId = useRef(0);
  const player = useRef<AudioPlayer | null>(null);
  const releaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toneCancel = useRef<(() => void) | null>(null);
  const resumeRef = useRef(options.onResumeGuidance);
  useEffect(() => { resumeRef.current = options.onResumeGuidance; }, [options.onResumeGuidance]);

  useEffect(() => {
    let disposed = false;
    void Promise.resolve().then(prepareHazardSounds).then(() => {
      console.info('[SeeQ hazard audio]', { phase: 'cache-ready', platform: Platform.OS });
    }).catch(error => {
      console.warn('[SeeQ hazard audio]', { phase: 'cache-failed', reason: String(error) });
      if (!disposed) setAudioError('경고음 로컬 파일 준비 실패. 위험 수신 시 재시도합니다.');
    });
    return () => { disposed = true; };
  }, []);

  const cancelOutput = useCallback((reason: string = 'dismiss-or-inactive') => {
    if (speechBusy.current || player.current) {
      console.info('[SeeQ hazard audio]', {
        phase: 'output-cancel', reason, runId: runId.current,
        event: warningRef.current?.event, hasPlayer: Boolean(player.current),
      });
    }
    runId.current += 1;
    speechBusy.current = false;
    const cancelTone = toneCancel.current;
    toneCancel.current = null;
    cancelTone?.();
    try { player.current?.pause(); player.current?.remove(); } catch { /* Already released. */ }
    player.current = null;
    if (isHazardAudioActive()) {
      Vibration.cancel();
      void ExpoSpeech.stop().catch(() => {});
    }
  }, []);

  const dismiss = useCallback((resume = true) => {
    const hadWarning = !!warningRef.current;
    if (releaseTimer.current) clearTimeout(releaseTimer.current);
    releaseTimer.current = null;
    cancelOutput();
    arbiter.current.clear();
    warningRef.current = null;
    setWarning(null);
    setHazardAudioActive(false);
    if (resume && hadWarning && activeRef.current) resumeRef.current();
  }, [cancelOutput]);

  const armRelease = useCallback(() => {
    if (releaseTimer.current) clearTimeout(releaseTimer.current);
    const check = () => {
      const remaining = arbiter.current.expiresAt - Date.now();
      if (remaining > 0 || speechBusy.current) {
        releaseTimer.current = setTimeout(check, Math.max(200, remaining));
      } else dismiss();
    };
    releaseTimer.current = setTimeout(check, Math.max(200, arbiter.current.expiresAt - Date.now()));
  }, [dismiss]);

  const output = useCallback(async (signal: Warning) => {
    cancelOutput('replaced-by-' + signal.event);
    const id = runId.current;
    const startedAt = Date.now();
    speechBusy.current = true;
    const isCurrent = () => id === runId.current && activeRef.current;
    const meta = { runId: id, event: signal.event, isTest: signal.isTest, platform: Platform.OS };
    try {
      await runHazardOutput(signal, signal.isTest, {
        isCurrent,
        stopSpeech: () => ExpoSpeech.stop(),
        report: (phase, cause) => {
          const detail = { ...meta, phase, elapsedMs: Date.now() - startedAt, reason: cause == null ? undefined : String(cause) };
          if (cause) console.warn('[SeeQ hazard audio]', detail); else console.info('[SeeQ hazard audio]', detail);
          if (phase === 'output-failed') setAudioError('위험 안내 음성 출력 실패: ' + String(cause));
        },
        toneFailed: cause => setAudioError('경고음 재생 실패. 안내 음성으로 대신합니다. 원인: ' + String(cause)),
        toneSucceeded: () => setAudioError(''),
        vibrate: () => {
          if (signal.event === 'LEVEL1') Vibration.vibrate(Platform.OS === 'ios' ? [0, 80, 80, 80, 80, 80] : [0, 850, 100, 850, 100, 850]);
          else if (signal.event !== 'GO') Vibration.vibrate(Platform.OS === 'ios' ? [0, 160] : [0, 180, 120, 180]);
        },
        playTone: async kind => {
          console.info('[SeeQ hazard audio]', { ...meta, phase: 'audio-mode-start' });
          await setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'duckOthers', shouldPlayInBackground: false });
          if (!isCurrent()) return 'cancelled';
          console.info('[SeeQ hazard audio]', { ...meta, phase: 'audio-mode-ready' });
          const uri = getHazardSoundUri(kind);
          console.info('[SeeQ hazard audio]', { ...meta, phase: 'tone-source', kind, localFile: uri.startsWith('file:') });
          const sound = createAudioPlayer({ uri }, { updateInterval: 100, keepAudioSessionActive: Platform.OS === 'ios' });
          player.current = sound;
          console.info('[SeeQ hazard audio]', { ...meta, phase: 'player-created', isLoaded: sound.isLoaded });
          try {
            return await playHazardTone(sound, {
              isCurrent,
              reportStatus: status => console.info('[SeeQ hazard audio]', { ...meta, phase: 'player-status', ...status }),
              registerCancel: cancel => { if (player.current === sound) toneCancel.current = cancel; },
              report: stage => console.info('[SeeQ hazard audio]', { ...meta, phase: 'player-' + stage, elapsedMs: Date.now() - startedAt }),
            });
          } finally {
            // Stop audible playback before TTS, but retain iOS's session keeper.
            // Removing it here schedules AVAudioSession deactivation during speech.
            if (player.current === sound) {
              try { sound.pause(); } catch (error) {
                console.warn('[SeeQ hazard audio] pause failed', String(error));
                try { sound.remove(); } catch { /* already released */ }
                player.current = null;
              }
              toneCancel.current = null;
            }
          }
        },
        speak: text => speak(text, isCurrent),
      });
    } finally {
      if (isCurrent()) {
        const completedPlayer = player.current;
        player.current = null; toneCancel.current = null;
        if (completedPlayer) {
          try { completedPlayer.pause(); } catch { /* already stopped */ }
          try { completedPlayer.remove(); } catch (error) { console.warn('[SeeQ hazard audio] release failed', String(error)); }
        }
        speechBusy.current = false;
      }
    }
  }, [cancelOutput]);

  const receive = useCallback((signal: HazardSignal, isTest = false) => {
    if (!activeRef.current) return;
    if (isTest && warningRef.current && !warningRef.current.isTest) {
      setError('실제 경고가 진행 중일 때는 테스트할 수 없습니다.');
      return;
    }
    // Each explicit test selection replaces the previous test, irrespective of level.
    // The live-warning guard above still prevents a test from interrupting real danger.
    if (isTest || warningRef.current?.isTest) arbiter.current.clear();
    if (speechBusy.current) arbiter.current.expiresAt = Math.max(arbiter.current.expiresAt, Date.now() + 500);
    const decision = arbiter.current.accept({ ...signal, message: HAZARD_TEST_MESSAGES[signal.event] }, Date.now(), speechBusy.current);
    if (decision === 'ignore') return;
    const next = { ...signal, isTest };
    warningRef.current = next;
    setWarning(next);
    setLastSignal(next);
    setHazardAudioActive(true);
    armRelease();
    if (decision === 'play') void output(next);
  }, [armRelease, output]);
  const receiveRef = useRef(receive);
  useEffect(() => { receiveRef.current = receive; }, [receive]);

  useEffect(() => {
    let disposed = false;
    AsyncStorage.getItem(STORAGE_KEY).then(value => {
      const saved = value;
      if (!disposed && saved) {
        try { setEndpoint(normalizeHazardUrl(saved)); } catch { setError('저장된 서버 주소를 다시 입력해 주세요.'); }
      }
    }).catch(() => { if (!disposed) setError('서버 주소를 불러오지 못했습니다.'); })
      .finally(() => { if (!disposed) setHydrated(true); });
    const listener = AppState.addEventListener('change', setAppState);
    return () => { disposed = true; listener.remove(); };
  }, []);

  useEffect(() => {
    console.info('[WS CONDITIONS]', { allowed: options.allowed, enabled, hydrated, appState, hasEndpoint: Boolean(endpoint) });
    activeRef.current = options.allowed && enabled && appState === 'active';
    if (!activeRef.current) dismiss(false);
    if (!hydrated) return;
    if (!options.allowed || !enabled || appState !== 'active' || !endpoint) return;
    const close = openHazardSocket({
      endpoint,
      timeSync: true,
      onStatus: status => {
        if (status === '연결 중') { clockAudit.current.reset(); frameTiming.current = null; }
        setStatus(status);
      },
      onFrame: raw => {
        // Capture wall time immediately on frame arrival, before logging/parsing work.
        const now = Date.now();
        const timing = clockAudit.current.record(raw, now);
        frameTiming.current = timing;
        let key = 'invalid';
        try { key = String(JSON.parse(String(raw)).event); } catch { /* Log a bounded raw sample below. */ }
        if (key !== lastFrameLog.current.key || now - lastFrameLog.current.at >= 5000) {
          lastFrameLog.current = { key, at: now };
          console.info('[SeeQ hazard receive]', { ...timing, receivedAt: new Date(now).toISOString(), raw: String(raw).slice(0, 4096) });
        }
      },
      onError: message => {
        const timing = frameTiming.current;
        setError(message && message.startsWith('[수신 진단:') && timing ? message + '\n\n[시간 비교]\n' + formatHazardTiming(timing) : message);
      },
      onSignal: signal => receiveRef.current(signal),
      onDisconnect: () => dismiss(false),
    });
    return () => { close(); dismiss(false); };
  }, [endpoint, enabled, hydrated, appState, generation, dismiss, options.allowed]);

  useEffect(() => () => {
    activeRef.current = false;
    if (releaseTimer.current) clearTimeout(releaseTimer.current);
    cancelOutput(); setHazardAudioActive(false);
  }, [cancelOutput]);

  const connect = useCallback((value: string) => {
    console.info('[WS CONNECT REQUEST]', { hasAddress: Boolean(value.trim()) });
    try {
      const url = normalizeHazardUrl(value);
      setError(''); setEndpoint(url); setEnabled(true); setGeneration(n => n + 1);
      void AsyncStorage.setItem(STORAGE_KEY, url).catch(() => setError('연결 주소를 저장하지 못했습니다.'));
      return true;
    } catch {
      setError('주소를 확인해 주세요. 예: ws://192.168.0.20:5000');
      return false;
    }
  }, []);

  const changeEnabled = useCallback((value: boolean) => {
    if (!value) dismiss(false);
    setEnabled(value);
  }, [dismiss]);

  const status: ConnectionStatus = !options.allowed || !enabled ? '꺼짐'
    : appState !== 'active' ? '앱 복귀 대기'
    : !hydrated || !endpoint ? '설정 필요' : connectionStatus;
  return {
    endpoint, enabled, setEnabled: changeEnabled, status, error: [audioError, error].filter(Boolean).join("\n"), warning, lastSignal, connect,
    dismiss: () => dismiss(),
    test: (event: HazardType) => {
      if (!enabled) { setError('주변 인식을 켠 뒤 테스트해 주세요.'); return; }
      receive({ event, message: HAZARD_TEST_MESSAGES[event], ttc: event === 'LEVEL1' ? 1.2 : null, timestamp: Date.now() / 1000 }, true);
    },
  };
}

async function speak(message: string, isCurrent: () => boolean): Promise<'finished' | 'cancelled'> {
  if (!isCurrent()) return 'cancelled';
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (result: 'finished' | 'cancelled' | Error) => {
      if (settled) return;
      settled = true; clearTimeout(timeout);
      if (result instanceof Error) reject(result); else resolve(result);
    };
    const timeout = setTimeout(() => {
      finish(new Error('위험 안내 음성이 15초 안에 종료되지 않았습니다.'));
      if (isCurrent()) void ExpoSpeech.stop().catch(() => {});
    }, 15000);
    try {
      ExpoSpeech.speak(message, { language: 'ko-KR', onDone: () => finish('finished'), onStopped: () => finish('cancelled'), onError: error => finish(error instanceof Error ? error : new Error(String(error))) });
    } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
  });
}

export type HazardController = ReturnType<typeof useHazardAlerts>;
