import { File, Paths } from 'expo-file-system';
import tones from '@/assets/sounds/hazard-tones.json';
import type { HazardTone } from './hazard-alert-policy';

/** Identical existing WAV bytes; no Metro URL or network request on SeeQ-WiFi. */
export function getHazardSoundUri(kind: HazardTone): string {
  const tone = tones[kind];
  const file = new File(Paths.cache, tone.filename);
  if (!file.exists || file.size !== tone.size) {
    file.create({ overwrite: true });
    file.write(tone.base64, { encoding: 'base64' });
  }
  if (!file.exists || file.size !== tone.size) {
    throw new Error(
      '경고음 파일 검증 실패: ' + kind + '; uri=' + file.uri +
      '; expectedBytes=' + tone.size + '; actualBytes=' + file.size
    );
  }
  console.info('[SeeQ hazard audio]', {
    phase: 'file-verified', kind, uri: file.uri,
    expectedBytes: tone.size, actualBytes: file.size,
  });
  return file.uri;
}

export function prepareHazardSounds() {
  getHazardSoundUri('level1'); getHazardSoundUri('short');
}
