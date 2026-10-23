import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import * as ExpoSpeech from 'expo-speech';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, AppState, Platform, Vibration } from 'react-native';

import { HazardArbiter, normalizeHazardUrl, type HazardSignal, type HazardType } from '@/lib/hazard-protocol';
import { openHazardSocket } from '@/lib/hazard-socket';
import { isHazardAudioActive, setHazardAudioActive } from '@/lib/speech-priority';

type Warning = HazardSignal & { isTest: boolean };
type ConnectionStatus = '설정 필요' | '꺼짐' | '연결 중' | '연결됨' | '재연결 대기' | '앱 복귀 대기';
const STORAGE_KEY = 'seeq:hazard-websocket-url';
const TEST_MESSAGES: Record<HazardType, string> = {
  LEVEL1: '전방 위험물 접근중! 즉시 정지하세요.',
  LEVEL2: '전방에 장애물이 있습니다.',
  CROSSWALK: '전방에 횡단보도. 빨간불입니다.',
  GO: '초록불이 감지되었습니다.',
};

export function useHazardAlerts(options: { allowed: boolean; onResumeGuidance: () => void }) {
  const [endpoint, setEndpoint] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [hydrated, setHydrated] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [appState, setAppState] = useState(AppState.currentState);
  const [connectionStatus, setStatus] = useState<ConnectionStatus>('연결 중');
  const [error, setError] = useState('');
  const [warning, setWarning] = useState<Warning | null>(null);
  const [lastSignal, setLastSignal] = useState<Warning | null>(null);
  const arbiter = useRef(new HazardArbiter());
  const warningRef = useRef<Warning | null>(null);
  const activeRef = useRef(true);
  const speechBusy = useRef(false);
  const runId = useRef(0);
  const player = useRef<AudioPlayer | null>(null);
  const releaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toneWait = useRef<{ timer: ReturnType<typeof setTimeout>; cancel: () => void } | null>(null);
  const resumeRef = useRef(options.onResumeGuidance);
  useEffect(() => { resumeRef.current = options.onResumeGuidance; }, [options.onResumeGuidance]);

  const cancelOutput = useCallback(() => {
    runId.current += 1;
    speechBusy.current = false;
    if (toneWait.current) {
      clearTimeout(toneWait.current.timer);
      toneWait.current.cancel();
      toneWait.current = null;
    }
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
    cancelOutput();
    const id = runId.current;
    speechBusy.current = true;
    const isCurrent = () => id === runId.current && activeRef.current;
    try {
      await ExpoSpeech.stop();
      if (!isCurrent()) return;
      if (signal.event === 'LEVEL1') {
        Vibration.vibrate(Platform.OS === 'ios' ? [0, 80, 80, 80, 80, 80] : [0, 850, 100, 850, 100, 850]);
      } else if (signal.event !== 'GO') {
        Vibration.vibrate(Platform.OS === 'ios' ? [0, 160] : [0, 180, 120, 180]);
      }
      if (signal.event !== 'GO') {
        try {
          await setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'duckOthers', shouldPlayInBackground: false });
          if (!isCurrent()) return;
          const source = signal.event === 'LEVEL1'
            ? require('../assets/sounds/hazard-level1.wav')
            : require('../assets/sounds/hazard-short.wav');
          const sound = createAudioPlayer(source, { updateInterval: 100 });
          player.current = sound;
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => { cleanup(); reject(new Error('경고음 재생 시간이 초과되었습니다.')); }, 5000);
            const cleanup = () => {
              clearTimeout(timeout);
              listener.remove();
              toneWait.current = null;
            };
            const listener = sound.addListener('playbackStatusUpdate', state => {
              if (state.didJustFinish) { cleanup(); resolve(); }
            });
            toneWait.current = { timer: timeout, cancel: () => { listener.remove(); resolve(); } };
            sound.play();
          });
          if (!isCurrent()) return;
          sound.remove();
          player.current = null;
        } catch {
          if (isCurrent()) setError('경고음을 재생하지 못해 음성 안내로 대신합니다. 기기 음량을 확인해 주세요.');
          if (!isCurrent()) return;
          await speak(signal.isTest ? `테스트. ${signal.message}` : signal.message, isCurrent);
          return;
        }
      }
      if (!isCurrent()) return;
      if (signal.event === 'CROSSWALK' || signal.event === 'GO') {
        await speak(signal.isTest ? `테스트. ${signal.message}` : signal.message, isCurrent);
      } else if (await AccessibilityInfo.isScreenReaderEnabled()) {
        // Give screen-reader users the same warning text, without a second app TTS.
        AccessibilityInfo.announceForAccessibility(signal.isTest ? `테스트. ${signal.message}` : signal.message);
      }
    } catch {
      if (isCurrent()) setError('경고 소리를 출력하지 못했습니다. 화면의 경고를 확인해 주세요.');
    } finally {
      if (isCurrent()) speechBusy.current = false;
    }
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
    const decision = arbiter.current.accept(signal);
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
      if (!disposed && value) {
        try { setEndpoint(normalizeHazardUrl(value)); } catch { setError('저장된 서버 주소를 다시 입력해 주세요.'); }
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

  const status: ConnectionStatus = !options.allowed || !enabled ? '꺼짐'
    : appState !== 'active' ? '앱 복귀 대기'
    : !hydrated || !endpoint ? '설정 필요' : connectionStatus;
  return {
    endpoint, enabled, setEnabled, status, error, warning, lastSignal, connect,
    dismiss: () => dismiss(),
    test: (event: HazardType) => {
      if (!enabled) { setError('주변 인식을 켠 뒤 테스트해 주세요.'); return; }
      receive({ event, message: TEST_MESSAGES[event], ttc: event === 'LEVEL1' ? 1.2 : null, timestamp: Date.now() / 1000 }, true);
    },
  };
}

async function speak(message: string, isCurrent: () => boolean): Promise<void> {
  if (!isCurrent()) return;
  if (await AccessibilityInfo.isScreenReaderEnabled()) {
    if (!isCurrent()) return;
    AccessibilityInfo.announceForAccessibility(message);
    // Accessibility announcements do not expose completion callbacks.
    await new Promise(resolve => setTimeout(resolve, Math.min(10000, Math.max(2500, message.length * 180))));
    return;
  }
  if (!isCurrent()) return;
  await new Promise<void>(resolve => {
    const timeout = setTimeout(() => { if (isCurrent()) void ExpoSpeech.stop(); resolve(); }, 15000);
    const done = () => { clearTimeout(timeout); resolve(); };
    ExpoSpeech.speak(message, { language: 'ko-KR', onDone: done, onStopped: done, onError: done });
  });
}

export type HazardController = ReturnType<typeof useHazardAlerts>;
