import { get, ref, serverTimestamp, update, type Database } from 'firebase/database';

function secret() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('').toUpperCase();
}

export async function createExhibitionProfile(db: Database, user: { uid: string; email?: string | null }, profile: any) {
  const metadata = { uid: user.uid, name: profile.name, userId: profile.userId, email: user.email!.toLowerCase(), type: profile.type };
  const fields: Record<string, unknown> = {};
  const records = {
    profiles: { ...metadata, createdAt: profile.createdAt, verifiedAt: new Date().toISOString() },
    users: { ...metadata, shareLocation: false, emergency: false },
  };
  for (const [collection, record] of Object.entries(records)) {
    for (const [key, value] of Object.entries(record)) fields[`${collection}/${user.uid}/${key}`] = value;
  }
  await update(ref(db), fields);
  return null;
}

export async function rotateExhibitionPairCode(db: Database, uid: string) {
  const profile = (await get(ref(db, `profiles/${uid}`))).val();
  const code = secret();
  const updates: Record<string, unknown> = {
    [`profiles/${uid}/pairCode`]: code,
    [`pairCodes/${code}`]: { uid, expiresAt: Date.now() + 14 * 60 * 1000 },
  };
  if (profile?.pairCode && profile.pairCode !== code) updates[`pairCodes/${profile.pairCode}`] = null;
  await update(ref(db), updates);
  return code;
}

export async function sendExhibitionRequest(db: Database, guardianUid: string, code: string) {
  const normalized = code.trim().toUpperCase();
  if (!/^[A-F0-9]{32}$/.test(normalized)) throw new Error('사용자 화면의 32자리 연결 코드를 입력해 주세요.');
  const capability = (await get(ref(db, `pairCodes/${normalized}`))).val();
  if (!capability?.uid || capability.expiresAt <= Date.now()) throw new Error('연결 코드가 만료되었습니다. 사용자에게 새 코드를 요청해 주세요.');
  const profile = (await get(ref(db, `profiles/${guardianUid}`))).val();
  const targetUid = capability.uid;
  const payload = {
    targetUid, guardianUid, guardianName: profile.name,
    pairCode: normalized, requestId: secret(), requestedAt: serverTimestamp(),
    expiresAt: Date.now() + 4 * 60 * 1000, status: 'pending',
  };
  await update(ref(db), {
    [`pendingRequests/${targetUid}/${guardianUid}`]: payload,
    [`connectionRequests/${targetUid}/${guardianUid}`]: payload,
    [`guardianSentRequests/${guardianUid}/${targetUid}`]: payload,
  });
}

export async function respondExhibitionRequest(db: Database, targetUid: string, guardianUid: string, accept: boolean, expectedRequestId: string) {
  const request = (await get(ref(db, `connectionRequests/${targetUid}/${guardianUid}`))).val();
  if (!request || request.requestId !== expectedRequestId || request.status !== 'pending' || request.expiresAt <= Date.now()) throw new Error('만료되었거나 이미 처리된 연결 요청입니다.');
  const response = { ...request, status: accept ? 'approved' : 'rejected', respondedAt: serverTimestamp() };
  const updates: Record<string, unknown> = {
    [`pendingRequests/${targetUid}/${guardianUid}`]: null,
    [`connectionRequests/${targetUid}/${guardianUid}`]: response,
    [`guardianSentRequests/${guardianUid}/${targetUid}`]: response,
  };
  if (accept) {
    const profile = (await get(ref(db, `profiles/${targetUid}`))).val();
    Object.assign(updates, {
      [`profiles/${targetUid}/pairedGuardian`]: guardianUid,
      [`users/${targetUid}/pairedGuardian`]: guardianUid,
      [`profiles/${guardianUid}/pairedUser`]: targetUid,
      [`users/${guardianUid}/pairedUser`]: targetUid,
      [`guardianLinks/${guardianUid}/${targetUid}`]: { uid: targetUid, name: profile.name, userId: profile.userId, requestId: request.requestId, approvedAt: serverTimestamp() },
    });
  }
  await update(ref(db), updates);
}

export async function disconnectExhibitionPair(db: Database, targetUid: string, guardianUid: string) {
  const request = (await get(ref(db, `connectionRequests/${targetUid}/${guardianUid}`))).val();
  if (!request || request.status !== 'approved') throw new Error('유효한 연결 정보를 찾을 수 없습니다.');
  const disconnected = { ...request, status: 'disconnected', disconnectedAt: serverTimestamp() };
  await update(ref(db), {
    [`profiles/${targetUid}/pairedGuardian`]: null, [`users/${targetUid}/pairedGuardian`]: null,
    [`profiles/${guardianUid}/pairedUser`]: null, [`users/${guardianUid}/pairedUser`]: null,
    [`guardianLinks/${guardianUid}/${targetUid}`]: null,
    [`pendingRequests/${targetUid}/${guardianUid}`]: null,
    [`connectionRequests/${targetUid}/${guardianUid}`]: disconnected,
    [`guardianSentRequests/${guardianUid}/${targetUid}`]: disconnected,
  });
}

export async function readLinkedSummary(db: Database, uid: string) {
  const [name, userId] = await Promise.all(['name', 'userId'].map(field => get(ref(db, `profiles/${uid}/${field}`))));
  return { name: name.val(), userId: userId.val() };
}
