let context: AudioContext | undefined;
let active: { cancel: () => void } | undefined;

// Call directly from a click/tap before awaiting anything.
export async function prepareHazardAudio() {
  if (typeof window === 'undefined') throw new Error('브라우저에서 소리를 활성화해 주세요.');
  const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) throw new Error('이 브라우저는 경고음 재생을 지원하지 않습니다.');
  if (!context || context.state === 'closed') context = new Context();
  await context.resume();
  if (context.state !== 'running') throw new Error('소리 활성화 버튼을 다시 눌러 주세요.');
}

export function cancelWebHazardTone() { active?.cancel(); }

export async function playWebHazardTone(severe: boolean): Promise<'finished' | 'cancelled'> {
  cancelWebHazardTone();
  if (!context || context.state !== 'running') throw new Error('소리 활성화 버튼을 먼저 눌러 주세요.');
  const audio = context;
  const count = severe ? 3 : 1;
  const duration = severe ? 0.25 : 0.18;
  const step = duration + 0.12;
  return new Promise((resolve, reject) => {
    const nodes: { oscillator: OscillatorNode; gain: GainNode }[] = [];
    let settled = false;
    let ended = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const token = { cancel: () => finish('cancelled') };
    const finish = (result: 'finished' | 'cancelled' | Error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      audio.removeEventListener?.('statechange', stateChanged);
      if (active === token) active = undefined;
      for (const { oscillator, gain } of nodes) {
        oscillator.onended = null;
        try { oscillator.stop(); } catch { /* already ended */ }
        oscillator.disconnect(); gain.disconnect();
      }
      if (result instanceof Error) reject(result); else resolve(result);
    };
    const stateChanged = () => {
      if (audio.state !== 'running') finish(new Error(`경고음 재생 중 AudioContext가 ${audio.state} 상태가 되었습니다. 소리를 다시 활성화해 주세요.`));
    };
    active = token;
    audio.addEventListener?.('statechange', stateChanged);
    // This is a failure watchdog, never a fake successful completion.
    timer = setTimeout(() => finish(new Error('웹 경고음 종료 이벤트가 5초 안에 오지 않았습니다.')), 5000);
    try {
      for (let index = 0; index < count; index++) {
        const start = audio.currentTime + index * step;
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        nodes.push({ oscillator, gain });
        oscillator.frequency.value = severe ? 1000 : 800;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.2, start + 0.01);
        gain.gain.setValueAtTime(0.2, start + duration - 0.02);
        gain.gain.linearRampToValueAtTime(0, start + duration);
        oscillator.connect(gain); gain.connect(audio.destination);
        oscillator.onended = () => {
          if (settled) return;
          ended++;
          if (ended === count) finish('finished');
        };
        oscillator.start(start); oscillator.stop(start + duration);
      }
    } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
  });
}
