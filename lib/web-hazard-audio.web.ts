let context: AudioContext | undefined;
let active: { nodes: OscillatorNode[]; timer: ReturnType<typeof setTimeout>; resolve: () => void } | undefined;

// Call synchronously from the visitor's button gesture, before any await.
export async function prepareHazardAudio() {
  if (typeof window === 'undefined') throw new Error('브라우저에서 소리를 활성화해 주세요.');
  const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) throw new Error('이 브라우저는 경고음 재생을 지원하지 않습니다.');
  if (!context || context.state === 'closed') context = new Context();
  await context.resume();
  if (context.state !== 'running') throw new Error('소리 활성화 버튼을 다시 눌러 주세요.');
}

export function cancelWebHazardTone() {
  if (!active) return;
  const previous = active; active = undefined;
  clearTimeout(previous.timer);
  previous.nodes.forEach(node => { try { node.stop(); node.disconnect(); } catch { /* already ended */ } });
  previous.resolve();
}

export async function playWebHazardTone(severe: boolean) {
  cancelWebHazardTone();
  if (!context || context.state !== 'running') throw new Error('소리 활성화 버튼을 먼저 눌러 주세요.');
  const audio = context;
  const count = severe ? 3 : 1;
  const duration = severe ? 0.25 : 0.18;
  const step = duration + 0.12;
  await new Promise<void>(resolve => {
    const nodes: OscillatorNode[] = [];
    for (let index = 0; index < count; index++) {
      const start = audio.currentTime + index * step;
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.frequency.value = severe ? 1000 : 800;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.2, start + 0.01);
      gain.gain.setValueAtTime(0.2, start + duration - 0.02);
      gain.gain.linearRampToValueAtTime(0, start + duration);
      oscillator.connect(gain); gain.connect(audio.destination);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      oscillator.start(start); oscillator.stop(start + duration);
      nodes.push(oscillator);
    }
    active = { nodes, resolve, timer: setTimeout(() => { active = undefined; resolve(); }, (count * step + 0.03) * 1000) };
  });
}
