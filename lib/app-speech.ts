import * as ExpoSpeech from 'expo-speech';
import { isHazardAudioActive } from './speech-priority';

let revision = 0;
let spokenRevision = 0;
export const getSpeechRevision = () => spokenRevision;

// App TTS is independent of VoiceOver/TalkBack. Hazard audio still has priority.
export const AppSpeech = {
  stop: () => {
    if (isHazardAudioActive()) return;
    revision += 1;
    return ExpoSpeech.stop();
  },
  speak: (message: string, options?: Parameters<typeof ExpoSpeech.speak>[1]) => {
    if (isHazardAudioActive()) return;
    revision += 1;
    spokenRevision += 1;
    ExpoSpeech.speak(message, { language: 'ko-KR', ...options });
  },
};

/** Repeated taps replace the previous description instead of forming a long queue. */
export function describeButton(message: string) {
  if (!message.trim() || isHazardAudioActive()) return;
  spokenRevision += 1;
  const request = ++revision;
  void ExpoSpeech.stop().then(() => {
    if (request !== revision || isHazardAudioActive()) return;
    ExpoSpeech.speak(message, { language: 'ko-KR' });
  }).catch(() => {});
}
