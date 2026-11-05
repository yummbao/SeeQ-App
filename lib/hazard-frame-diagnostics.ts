import { HAZARD_TYPES, parseHazardSignal } from './hazard-protocol';

export type HazardFrameIssue = { code: string; message: string };
const short = (value: unknown) => String(value).slice(0, 100);

/** Explains the existing validator's rejection; it never relaxes acceptance. */
export function diagnoseHazardFrame(raw: unknown, now = Date.now()): HazardFrameIssue | null {
  if (parseHazardSignal(raw, now)) return null;
  if (typeof raw !== 'string') return { code: 'not-text', message: `텍스트 JSON이 아닙니다. 수신 형식: ${typeof raw}` };
  if (raw.length > 4096) return { code: 'too-large', message: '수신 JSON이 허용 크기 4096자를 넘었습니다.' };
  let data;
  try { data = JSON.parse(raw); } catch { return { code: 'invalid-json', message: '수신 내용이 JSON 문법에 맞지 않습니다.' }; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { code: 'not-object', message: '감지 데이터는 JSON 객체여야 합니다.' };
  if (!('event' in data)) return { code: 'missing-event', message: `event 항목이 없습니다. 수신 항목: ${Object.keys(data).slice(0, 12).join(', ')}` };
  if (!HAZARD_TYPES.includes(data.event)) return { code: 'unsupported-event', message: `지원하지 않는 event: ${short(JSON.stringify(data.event))}. LEVEL1, LEVEL2, CROSSWALK, GO만 지원합니다.` };
  if (typeof data.message !== 'string' || !data.message.trim() || data.message.length > 300) return { code: 'invalid-message', message: 'message는 비어 있지 않은 300자 이하 문자열이어야 합니다.' };
  if (typeof data.timestamp !== 'number' || !Number.isFinite(data.timestamp)) return { code: 'invalid-timestamp', message: `timestamp는 Unix 초 단위 숫자여야 합니다. 현재 형식: ${typeof data.timestamp}, 값: ${short(data.timestamp)}` };
  if (data.timestamp >= 1e11 && data.timestamp < 1e14) return { code: 'timestamp-milliseconds', message: 'timestamp가 밀리초 형식으로 보입니다. 현재 수신 규약은 Python time.time()의 Unix 초 단위입니다.' };
  const age = now - data.timestamp * 1000;
  if (age > 10000) return { code: 'stale', message: `감지 시각이 휴대폰보다 ${(age / 1000).toFixed(1)}초 이전입니다(허용 10초). 전송 지연 또는 라즈베리파이·휴대폰 시각을 확인해 주세요.` };
  if (age < -30000) return { code: 'future', message: `감지 시각이 휴대폰보다 ${(-age / 1000).toFixed(1)}초 앞섭니다(허용 30초). 라즈베리파이·휴대폰 시각을 확인해 주세요.` };
  if (data.ttc != null && (typeof data.ttc !== 'number' || !Number.isFinite(data.ttc) || data.ttc < 0)) return { code: 'invalid-ttc', message: 'ttc는 null 또는 0 이상의 숫자여야 합니다.' };
  return { code: 'unsupported', message: '지원하지 않는 감지 데이터입니다.' };
}

export function formatHazardFrameIssue(issue: HazardFrameIssue, raw: unknown): string {
  const preview = (typeof raw === 'string' ? raw : String(raw)).slice(0, 650);
  return `[수신 진단: ${issue.code}]\n${issue.message}\n수신 원문: ${preview}`;
}
