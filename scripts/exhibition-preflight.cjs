/* global __dirname */
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
require('@expo/env').load(root);
const contents = fs.readFileSync(path.join(root, 'lib/backend-policy.ts'), 'utf8');
const mod = { exports: {} };
new Function('exports', ts.transpileModule(contents, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(mod.exports);
const config = {
  apiKey: process.env.EXPO_PUBLIC_EXHIBITION_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_EXHIBITION_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_EXHIBITION_FIREBASE_PROJECT_ID,
  appId: process.env.EXPO_PUBLIC_EXHIBITION_FIREBASE_APP_ID,
  databaseURL: process.env.EXPO_PUBLIC_EXHIBITION_FIREBASE_DATABASE_URL,
};
const production = { projectId: 'seeq-a3251', authDomain: 'seeq-a3251.firebaseapp.com', databaseURL: 'https://seeq-a3251-default-rtdb.asia-southeast1.firebasedatabase.app' };
const error = mod.exports.exhibitionConfigError(config, production);
if (error) { console.error(error); process.exitCode = 1; }
else console.log('PASS: 전시용 Firebase 프로젝트 분리 설정 확인. 실제 계정 로그인 및 규칙 검사는 별도로 진행하세요.');
const ws = process.env.EXPO_PUBLIC_EXHIBITION_HAZARD_WS_URL;
if (ws) {
  try { const url = new URL(ws); if (url.protocol !== 'wss:' || url.username || url.password) throw Error(); }
  catch { console.error('공개 웹 위험 감지 서버는 인증정보를 URL에 포함하지 않은 wss:// 주소여야 합니다.'); process.exitCode = 1; }
} else console.log('INFO: 위험 감지 기본 서버 미설정. 현장 설정 또는 표시된 경고 시연만 사용 가능.');
