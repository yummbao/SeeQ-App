import { HAZARD_TEST_MESSAGES, HAZARD_TEST_TONES, type HazardTone } from './hazard-alert-policy';
import type { HazardSignal } from './hazard-protocol';

export type OutputPhase = 'speech-stop' | 'tone-wait' | 'tone-finished' | 'tone-failed' | 'speech-start' | 'speech-finished' | 'output-failed' | 'cancelled';
type Dependencies = {
  isCurrent: () => boolean;
  stopSpeech: () => Promise<void>;
  playTone: (tone: HazardTone) => Promise<'finished' | 'cancelled'>;
  speak: (text: string) => Promise<'finished' | 'cancelled'>;
  vibrate: () => void;
  report: (phase: OutputPhase, error?: unknown) => void;
  toneFailed: (error: unknown) => void;
  toneSucceeded: () => void;
};

/** Both the live socket and the test buttons use this exact sequence. */
export async function runHazardOutput(signal: HazardSignal, isTest: boolean, api: Dependencies) {
  try {
    api.report('speech-stop');
    await api.stopSpeech();
    if (!api.isCurrent()) return;
    api.vibrate();
    const tone = HAZARD_TEST_TONES[signal.event];
    if (tone) {
      try {
        api.report('tone-wait');
        // The player adapter settles only on an actual finish, failure or cancellation.
        const result = await api.playTone(tone);
        if (!api.isCurrent() || result === 'cancelled') { api.report('cancelled'); return; }
        api.report('tone-finished');
        api.toneSucceeded();
      } catch (error) {
        // playTone must stop audible playback BEFORE rejecting; its session may stay alive for TTS.
        if (!api.isCurrent()) return;
        api.report('tone-failed', error);
        api.toneFailed(error);
      }
    }
    if (!api.isCurrent()) return;
    api.report('speech-start');
    const text = HAZARD_TEST_MESSAGES[signal.event];
    const result = await api.speak(isTest ? `테스트. ${text}` : text);
    if (api.isCurrent()) api.report(result === 'finished' ? 'speech-finished' : 'cancelled');
  } catch (error) {
    if (api.isCurrent()) api.report('output-failed', error);
  }
}
