import type { AudioPlayer, AudioStatus } from 'expo-audio';

type Player = Pick<AudioPlayer, 'isLoaded' | 'muted' | 'volume' | 'loop' | 'play' | 'addListener'>;
type Options = {
  isCurrent: () => boolean;
  registerCancel: (cancel: (() => void) | null) => void;
  report: (stage: 'loaded' | 'play-requested' | 'playing' | 'ended') => void;
  reportStatus?: (status: Pick<AudioStatus, 'isLoaded' | 'playing' | 'playbackState' | 'reasonForWaitingToPlay' | 'didJustFinish'>) => void;
  timeoutMs?: number;
};

export function playHazardTone(player: Player, options: Options): Promise<'finished' | 'cancelled'> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let started = false;
    let playingReported = false;
    let lastStatusKey = '';
    let listener: { remove: () => void } | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (result: 'finished' | 'cancelled' | Error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      listener?.remove();
      options.registerCancel(null);
      if (result instanceof Error) reject(result); else resolve(result);
    };
    const start = () => {
      if (settled || started) return;
      if (!options.isCurrent()) { finish('cancelled'); return; }
      started = true;
      try {
        options.report('loaded');
        player.muted = false; player.volume = 1; player.loop = false;
        options.report('play-requested');
        player.play();
      } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
    };
    options.registerCancel(() => finish('cancelled'));
    if (settled) return;
    if (!options.isCurrent()) { finish('cancelled'); return; }
    timer = setTimeout(() => finish(new Error(started ? '경고음 종료 이벤트가 5초 안에 오지 않았습니다.' : '경고음 파일을 5초 안에 로드하지 못했습니다.')), options.timeoutMs ?? 5000);
    try {
      listener = player.addListener('playbackStatusUpdate', (status: AudioStatus) => {
        const snapshot = {
          isLoaded: status.isLoaded, playing: status.playing,
          playbackState: status.playbackState,
          reasonForWaitingToPlay: status.reasonForWaitingToPlay,
          didJustFinish: status.didJustFinish,
        };
        const key = JSON.stringify(snapshot);
        if (key !== lastStatusKey) {
          lastStatusKey = key;
          options.reportStatus?.(snapshot);
        }
        if (!options.isCurrent()) { finish('cancelled'); return; }
        if (status.playbackState === 'error' || status.playbackState === 'failed') {
          finish(new Error(`오디오 플레이어 오류: ${status.playbackState}; ${status.reasonForWaitingToPlay || '원인 미제공'}`));
        } else if (started && status.didJustFinish) {
          options.report('ended'); finish('finished');
        } else {
          if (status.isLoaded) start();
          if (started && status.playing && !playingReported) { playingReported = true; options.report('playing'); }
        }
      });
      // Some players synchronously emit a status when registering a listener.
      if (settled) listener.remove();
      else if (player.isLoaded) start();
    } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
  });
}
