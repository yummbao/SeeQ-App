import { diagnoseHazardFrame, formatHazardFrameIssue } from './hazard-frame-diagnostics';
import { parseHazardSignal, type HazardSignal } from './hazard-protocol';

type Options = {
  endpoint: string;
  /** Opt-in for the Pi server that accepts TIME_SYNC. Does not relax freshness checks. */
  timeSync?: boolean;
  onStatus: (status: '연결 중' | '연결됨' | '재연결 대기') => void;
  onError: (message: string) => void;
  onSignal: (signal: HazardSignal) => void;
  onFrame?: (raw: unknown) => void;
  onDisconnect: () => void;
};
type Dependencies = {
  WebSocket: typeof WebSocket;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
};

/** One active connection, bounded retry delay, and no callbacks after disposal. */
export function openHazardSocket(options: Options, dependencies?: Dependencies): () => void {
  const api = dependencies ?? { WebSocket, setTimeout, clearTimeout };
  let disposed = false;
  let socket: WebSocket | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let connectTimeout: ReturnType<typeof setTimeout> | null = null;
  let timeSyncTimer: ReturnType<typeof setTimeout> | null = null;
  const stopTimeSync = () => {
    if (timeSyncTimer !== null) api.clearTimeout(timeSyncTimer);
    timeSyncTimer = null;
  };
  let attempts = 0;
  let lastDiagnosticAt = -Infinity;
  let lastDiagnosticCode = "";
  const connect = () => {
    if (disposed) return;
    options.onStatus('연결 중');
    let failed = false;
    let ws: WebSocket | null = null;
    const logClose = (event?: CloseEvent) => {
      console.info('[WS CLOSE]', {
        code: event?.code,
        reason: event?.reason,
        wasClean: event?.wasClean,
      });
    };
    const fail = () => {
      if (disposed || failed) return;
      failed = true;
      stopTimeSync();
      if (connectTimeout) api.clearTimeout(connectTimeout);
      if (ws) {
        ws.onopen = null; ws.onmessage = null; ws.onclose = logClose; ws.onerror = null;
        try { ws.close(); } catch { /* A partially opened socket may already be closed. */ }
      }
      options.onStatus('재연결 대기');
      options.onError('연결이 끊겼습니다. 서버 주소와 같은 Wi-Fi 연결을 확인해 주세요.');
      options.onDisconnect();
      retry = api.setTimeout(connect, Math.min(1000 * 2 ** attempts++, 10000));
    };
    const sendTimeSync = () => {
      if (disposed || failed || socket !== ws || !ws || ws.readyState !== 1) return;
      try {
        const timestamp = Date.now() / 1000;
        ws.send(JSON.stringify({ event: 'TIME_SYNC', timestamp }));
        // This confirms sending only; no server acknowledgment is implied.
        console.info('[WS TIME_SYNC SENT]', { timestamp });
        timeSyncTimer = api.setTimeout(sendTimeSync, 60000);
      } catch (error) {
        console.warn('[WS TIME_SYNC FAILED]', { reason: String(error) });
        fail();
      }
    };
    try {
      console.info('[WS CONNECT]', { attempt: attempts + 1 });
      ws = new api.WebSocket(options.endpoint);
      socket = ws;
      connectTimeout = api.setTimeout(() => {
        console.info('[WS TIMEOUT]', { timeoutMs: 8000 });
        fail();
      }, 8000);
      ws.onopen = () => {
        if (disposed || failed) return;
        if (connectTimeout) api.clearTimeout(connectTimeout);
        console.info('[WS OPEN]');
        attempts = 0;
        if (options.timeSync) {
          stopTimeSync();
          sendTimeSync();
          if (failed) return;
        }
        options.onStatus('연결됨'); options.onError('');
      };
      ws.onmessage = event => {
        if (disposed || failed) return;
        options.onFrame?.(event.data);
        const receivedAt = Date.now();
        const signal = parseHazardSignal(event.data, receivedAt);
        if (!signal) {
          const issue = diagnoseHazardFrame(event.data, receivedAt) ?? { code: 'unsupported', message: '지원하지 않는 감지 데이터입니다.' };
          options.onError(formatHazardFrameIssue(issue, event.data));
          if (issue.code !== lastDiagnosticCode || receivedAt - lastDiagnosticAt >= 5000) {
            lastDiagnosticCode = issue.code; lastDiagnosticAt = receivedAt;
            console.info('[SeeQ hazard reject]', { ...issue, receivedAt: new Date(receivedAt).toISOString(), raw: String(event.data).slice(0, 650) });
          }
          return;
        }
        options.onError('');
        options.onSignal(signal);
      };
      ws.onerror = event => {
        console.info('[WS ERROR]', event);
        fail();
      };
      ws.onclose = event => {
        logClose(event);
        fail();
      };
    } catch { fail(); }
  };
  connect();
  return () => {
    disposed = true;
    stopTimeSync();
    if (retry) api.clearTimeout(retry);
    if (connectTimeout) api.clearTimeout(connectTimeout);
    if (socket) {
      socket.onopen = null; socket.onmessage = null; socket.onerror = null; socket.onclose = null;
      try { socket.close(); } catch { /* Already closed. */ }
    }
  };
}
