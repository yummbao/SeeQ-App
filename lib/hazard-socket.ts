import { parseHazardSignal, type HazardSignal } from './hazard-protocol';

type Options = {
  endpoint: string;
  onStatus: (status: '연결 중' | '연결됨' | '재연결 대기') => void;
  onError: (message: string) => void;
  onSignal: (signal: HazardSignal) => void;
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
  let attempts = 0;
  const connect = () => {
    if (disposed) return;
    options.onStatus('연결 중');
    let failed = false;
    let ws: WebSocket | null = null;
    const fail = () => {
      if (disposed || failed) return;
      failed = true;
      if (connectTimeout) api.clearTimeout(connectTimeout);
      if (ws) {
        ws.onopen = null; ws.onmessage = null; ws.onclose = null; ws.onerror = null;
        try { ws.close(); } catch { /* A partially opened socket may already be closed. */ }
      }
      options.onStatus('재연결 대기');
      options.onError('연결이 끊겼습니다. 서버 주소와 같은 Wi-Fi 연결을 확인해 주세요.');
      options.onDisconnect();
      retry = api.setTimeout(connect, Math.min(1000 * 2 ** attempts++, 10000));
    };
    try {
      ws = new api.WebSocket(options.endpoint);
      socket = ws;
      connectTimeout = api.setTimeout(fail, 8000);
      ws.onopen = () => {
        if (disposed || failed) return;
        if (connectTimeout) api.clearTimeout(connectTimeout);
        attempts = 0;
        options.onStatus('연결됨'); options.onError('');
      };
      ws.onmessage = event => {
        if (disposed || failed) return;
        const signal = parseHazardSignal(event.data);
        if (!signal) {
          options.onError('지원하지 않거나 오래된 감지 데이터입니다. JSON 형식과 라즈베리파이 시간을 확인해 주세요.');
          return;
        }
        options.onError('');
        options.onSignal(signal);
      };
      ws.onerror = fail;
      ws.onclose = fail;
    } catch { fail(); }
  };
  connect();
  return () => {
    disposed = true;
    if (retry) api.clearTimeout(retry);
    if (connectTimeout) api.clearTimeout(connectTimeout);
    if (socket) {
      socket.onopen = null; socket.onmessage = null; socket.onerror = null; socket.onclose = null;
      try { socket.close(); } catch { /* Already closed. */ }
    }
  };
}
