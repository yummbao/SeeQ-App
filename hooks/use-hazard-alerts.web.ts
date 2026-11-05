import { prepareHazardAudio, playWebHazardTone, cancelWebHazardTone } from '@/lib/web-hazard-audio.web';
import { HAZARD_TEST_MESSAGES } from '@/lib/hazard-alert-policy';
import { runHazardOutput } from '@/lib/hazard-output-sequence';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
  const [warning, setWarning] = useState<Warning | null>(null);
  const [lastSignal, setLastSignal] = useState<Warning | null>(null);
  const arbiter = useRef(new HazardArbiter());
  const warningRef = useRef<Warning | null>(null);
  const activeRef = useRef(true);
  const speechBusy = useRef(false);
  const runId = useRef(0);
  const releaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resumeRef = useRef(options.onResumeGuidance);
  useEffect(() => { resumeRef.current = options.onResumeGuidance; }, [options.onResumeGuidance]);

  const cancelOutput = useCallback(() => {
    runId.current += 1;
    speechBusy.current = false;
    cancelWebHazardTone();
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
    cancelOutput();
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
        playTone: kind => playWebHazardTone(kind === 'level1'),
        speak: text => speak(text, isCurrent),
      });
    } finally { if (isCurrent()) speechBusy.current = false; }
  }, [cancelOutput]);

  const receive = useCallback((signal: HazardSignal, isTest = false) => {
    if (!activeRef.current) return;
    if (isTest && warningRef.current && !warningRef.current.isTest) {
      setError('실제 경고가 진행 중일 때는 테스트할 수 없습니다.');
      return;
    }
    // A live warning always takes over a locally simulated warning.
    if (!isTest && warningRef.current?.isTest) arbiter.current.clear();
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
      const saved = value || process.env.EXPO_PUBLIC_EXHIBITION_HAZARD_WS_URL;
      if (!disposed && saved) {
        try { setEndpoint(normalizeHazardUrl(saved)); } catch { setError('저장된 서버 주소를 다시 입력해 주세요.'); }
      }
    }).catch(() => { if (!disposed) setError('서버 주소를 불러오지 못했습니다.'); })
      .finally(() => { if (!disposed) setHydrated(true); });
    const listener = AppState.addEventListener('change', setAppState);
    return () => { disposed = true; listener.remove(); };
  }, []);

  useEffect(() => {
    activeRef.current = options.allowed && enabled && appState === 'active';
    if (!activeRef.current) dismiss(false);
    if (!hydrated) return;
    if (!options.allowed || !enabled || appState !== 'active' || !endpoint) return;
    const close = openHazardSocket({
      endpoint,
      onStatus: setStatus,
      onFrame: raw => {
        const now = Date.now();
        let key = 'invalid';
        try { key = String(JSON.parse(String(raw)).event); } catch { /* Log a bounded raw sample below. */ }
        if (key !== lastFrameLog.current.key || now - lastFrameLog.current.at >= 5000) {
          lastFrameLog.current = { key, at: now };
          console.info('[SeeQ hazard receive]', { receivedAt: new Date(now).toISOString(), raw: String(raw).slice(0, 4096) });
        }
      },
      onError: setError,
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
    void prepareHazardAudio().catch(cause => setAudioError(String(cause.message))); 
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
    endpoint, enabled, setEnabled: changeEnabled, status, error: audioError || error, warning, lastSignal, connect,
    dismiss: () => dismiss(),
    test: (event: HazardType) => {
      if (!enabled) { setError('주변 인식을 켠 뒤 테스트해 주세요.'); return; }
      // Resume the Web Audio context synchronously inside this user gesture.
      void prepareHazardAudio().catch(cause => {
        console.warn('[SeeQ hazard audio] browser activation failed', String(cause));
        setAudioError(String(cause.message));
      }).then(() => {
        if (activeRef.current) receive({ event, message: HAZARD_TEST_MESSAGES[event], ttc: event === 'LEVEL1' ? 1.2 : null, timestamp: Date.now() / 1000 }, true);
      });
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
