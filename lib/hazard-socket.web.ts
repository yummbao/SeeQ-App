import { openHazardSocket as openSocket } from './hazard-socket-core';

export function openHazardSocket(...args: Parameters<typeof openSocket>): ReturnType<typeof openSocket> {
  const [options] = args;
  if (typeof window !== 'undefined' && window.location.protocol === 'https:' && options.endpoint.startsWith('ws:')) {
    options.onStatus('재연결 대기');
    options.onError('HTTPS 웹사이트에서는 이 ws:// 감지 서버에 직접 연결할 수 없습니다. wss:// 서버를 사용하거나 실제 감지는 모바일 앱에서 이용해 주세요. 경고 테스트는 웹에서도 사용할 수 있습니다.');
    return () => {};
  }
  return openSocket(...args);
}
