export type HazardReceiveTiming = {
  receivedAtMs: number;
  receivedAtUtc: string;
  timestampRaw: number | string | null;
  timestampType: string;
  unitGuess: 'unix-seconds' | 'unix-milliseconds' | 'unknown';
  validatorTimestampMs: number | null;
  timestampUtcAsSeconds: string | null;
  ageMs: number | null;
  ageSeconds: number | null;
  previousTimestampRaw: number | string | null;
  timestampStepSeconds: number | null;
  receiveStepMs: number | null;
  monotonicStepMs: number | null;
  receiverClockStepMs: number | null;
  unchangedTimestampForMs: number;
};

function utc(milliseconds: number): string | null {
  return Number.isFinite(milliseconds) && Math.abs(milliseconds) <= 8.64e15 ? new Date(milliseconds).toISOString() : null;
}

/** Diagnostic measurements only. Never alters timestamps or freshness policy. */
export class HazardReceiveClockAudit {
  private previous: HazardReceiveTiming | null = null;
  private previousMonotonic = 0;
  private unchangedSince = 0;

  reset() { this.previous = null; }

  record(raw: unknown, receivedAtMs: number, monotonicMs = globalThis.performance?.now() ?? receivedAtMs): HazardReceiveTiming | null {
    if (typeof raw !== 'string' || raw.length > 4096) return null;
    let data;
    try { data = JSON.parse(raw); } catch { return null; }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    const timestamp = data.timestamp;
    const numeric = typeof timestamp === 'number' && Number.isFinite(timestamp);
    const rawValue = numeric || typeof timestamp === 'string' ? timestamp : null;
    const serverMs = numeric && Number.isFinite(timestamp * 1000) ? timestamp * 1000 : null;
    const age = serverMs == null ? null : receivedAtMs - serverMs;
    const previous = this.previous;
    const same = rawValue != null && previous != null && previous.timestampRaw === rawValue;
    if (!same) this.unchangedSince = monotonicMs;
    const receiveStepMs = previous == null ? null : receivedAtMs - previous.receivedAtMs;
    const monotonicStepMs = previous == null ? null : monotonicMs - this.previousMonotonic;
    const report: HazardReceiveTiming = {
      receivedAtMs,
      receivedAtUtc: utc(receivedAtMs) ?? String(receivedAtMs),
      timestampRaw: rawValue,
      timestampType: typeof timestamp,
      unitGuess: numeric && timestamp >= 1e11 && timestamp < 1e14 ? 'unix-milliseconds' : numeric && timestamp >= 1e9 && timestamp < 1e11 ? 'unix-seconds' : 'unknown',
      validatorTimestampMs: serverMs,
      timestampUtcAsSeconds: serverMs == null ? null : utc(serverMs),
      ageMs: age,
      ageSeconds: age == null ? null : age / 1000,
      previousTimestampRaw: previous?.timestampRaw ?? null,
      timestampStepSeconds: numeric && typeof previous?.timestampRaw === 'number' ? timestamp - previous.timestampRaw : null,
      receiveStepMs,
      monotonicStepMs,
      receiverClockStepMs: receiveStepMs == null || monotonicStepMs == null ? null : receiveStepMs - monotonicStepMs,
      unchangedTimestampForMs: same ? Math.max(0, monotonicMs - this.unchangedSince) : 0,
    };
    this.previous = report; this.previousMonotonic = monotonicMs;
    return report;
  }
}

export function formatHazardTiming(timing: HazardReceiveTiming): string {
  const lines = [
    `아이폰 Date.now() ms: ${timing.receivedAtMs}`,
    `수신 timestamp 원값: ${timing.timestampRaw ?? '(없음)'} (${timing.timestampType})`,
    `검사에 사용한 timestamp × 1000: ${timing.validatorTimestampMs ?? '(계산 불가)'}`,
    `차이: ${timing.ageMs ?? '?'} ms / ${timing.ageSeconds ?? '?'} 초`,
    `아이폰 UTC: ${timing.receivedAtUtc}`,
    `감지 UTC(초 해석): ${timing.timestampUtcAsSeconds ?? '(범위/형식 확인)'}`,
  ];
  if (timing.timestampStepSeconds != null) lines.push(`직전 신호 대비 timestamp 변화: ${timing.timestampStepSeconds} 초 / 수신 간격: ${timing.receiveStepMs} ms`);
  if (timing.unchangedTimestampForMs > 0) lines.push(`같은 timestamp 반복: ${timing.unchangedTimestampForMs} ms`);
  return lines.join('\n');
}
