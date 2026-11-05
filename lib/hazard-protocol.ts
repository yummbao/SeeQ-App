export const HAZARD_TYPES = ['LEVEL1', 'LEVEL2', 'CROSSWALK', 'GO'] as const;
export type HazardType = (typeof HAZARD_TYPES)[number];
export type HazardSignal = {
  event: HazardType;
  message: string;
  ttc: number | null;
  /** Python time.time(): Unix seconds, not milliseconds. */
  timestamp: number;
};

export const HAZARD_PRIORITY: Record<HazardType, number> = {
  LEVEL1: 4, LEVEL2: 3, CROSSWALK: 2, GO: 1,
};
export const HAZARD_LABEL: Record<HazardType, string> = {
  LEVEL1: '위험물 접근', LEVEL2: '장애물 주의', CROSSWALK: '횡단보도 안내', GO: '신호 안내',
};
export const HAZARD_HOLD_MS: Record<HazardType, number> = {
  LEVEL1: 3000, LEVEL2: 2500, CROSSWALK: 5000, GO: 4500,
};

export function normalizeHazardUrl(value: string): string {
  const url = new URL(value.trim());
  if (!['ws:', 'wss:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.hash) {
    throw new Error('ws:// 또는 wss://로 시작하는 서버 주소를 입력해 주세요.');
  }
  return url.toString();
}

export function parseHazardSignal(raw: unknown, now = Date.now()): HazardSignal | null {
  if (typeof raw !== 'string' || raw.length > 4096) return null;
  try {
    const data = JSON.parse(raw);
    if (!data || !HAZARD_TYPES.includes(data.event) || typeof data.message !== 'string' ||
        !data.message.trim() || data.message.length > 300 || typeof data.timestamp !== 'number' ||
        !Number.isFinite(data.timestamp)) return null;
    const age = now - data.timestamp * 1000;
    // Drop buffered alerts after reconnect. Both devices must have synchronized clocks.
    if (age > 10000 || age < -30000) return null;
    if (data.ttc != null && (typeof data.ttc !== 'number' || !Number.isFinite(data.ttc) || data.ttc < 0)) return null;
    return {
      event: data.event,
      message: data.message.trim(),
      ttc: data.event === 'LEVEL1' ? data.ttc ?? null : null,
      timestamp: data.timestamp,
    };
  } catch {
    return null;
  }
}

/** Small deterministic arbiter shared by live messages and local tests. */
export class HazardArbiter {
  active: HazardSignal | null = null;
  expiresAt = 0;
  private lastPlayedAt = -Infinity;
  private lastTimestamp: Partial<Record<HazardType, number>> = {};

  accept(signal: HazardSignal, now = Date.now(), outputBusy = false): 'play' | 'refresh' | 'ignore' {
    if (signal.timestamp <= (this.lastTimestamp[signal.event] ?? -Infinity)) return 'ignore';
    this.lastTimestamp[signal.event] = signal.timestamp;
    if (this.active && now < this.expiresAt &&
        HAZARD_PRIORITY[signal.event] < HAZARD_PRIORITY[this.active.event]) return 'ignore';
    const repeating = this.active?.event === signal.event &&
      (outputBusy || (this.active.message === signal.message && now - this.lastPlayedAt < 3000));
    this.active = signal;
    this.expiresAt = now + HAZARD_HOLD_MS[signal.event];
    if (repeating) return 'refresh';
    this.lastPlayedAt = now;
    return 'play';
  }

  clear() {
    this.active = null;
    this.expiresAt = 0;
    this.lastPlayedAt = -Infinity;
    this.lastTimestamp = {};
  }
}
