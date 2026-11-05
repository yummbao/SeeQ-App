import type { HazardType } from './hazard-protocol';

// Exact messages and sound choices from the existing warning-test buttons.
export const HAZARD_TEST_MESSAGES: Record<HazardType, string> = {
  LEVEL1: '전방 위험물 접근중! 즉시 정지하세요.',
  LEVEL2: '전방에 장애물이 있습니다.',
  CROSSWALK: '전방에 횡단보도. 빨간불입니다.',
  GO: '초록불이 감지되었습니다.',
};
export type HazardTone = 'level1' | 'short';
export const HAZARD_TEST_TONES: Record<HazardType, HazardTone | null> = {
  LEVEL1: 'level1', LEVEL2: 'short', CROSSWALK: 'short', GO: null,
};
