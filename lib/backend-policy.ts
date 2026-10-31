import type { FirebaseOptions } from 'firebase/app';

// The exhibition must never silently use the mobile production backend.
export function exhibitionConfigError(config: FirebaseOptions, production: FirebaseOptions): string {
  if (![config.apiKey, config.authDomain, config.projectId, config.appId, config.databaseURL].every(value => typeof value === 'string' && value.trim() && !value.includes('YOUR_'))) {
    return '전시용 Firebase 설정이 필요합니다. .env.exhibition.example을 참고해 .env.local을 설정해 주세요. 지도와 경고 시연은 사용할 수 있습니다.';
  }
  let database: URL;
  try { database = new URL(config.databaseURL!); } catch { return '전시용 Firebase databaseURL을 확인해 주세요.'; }
  if (database.protocol !== 'https:' || !/\.(firebasedatabase\.app|firebaseio\.com)$/.test(database.hostname)) return '전시용 Firebase HTTPS 데이터베이스 주소가 필요합니다.';
  if (config.projectId === production.projectId || config.authDomain === production.authDomain || database.hostname === new URL(production.databaseURL!).hostname) {
    return '전시용 웹에 기존 사용자 Firebase를 사용할 수 없습니다. 별도 Firebase 프로젝트를 설정해 주세요.';
  }
  if (config.authDomain !== `${config.projectId}.firebaseapp.com`) return '전시용 프로젝트의 기본 authDomain(projectId.firebaseapp.com)을 사용해 주세요.';
  return '';
}
