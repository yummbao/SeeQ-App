# SeeQ 모바일 유지 + 웹 실행 변경 안내

## 작업 대상과 원인

이번 수정 대상은 **C:\SeeQ-App**이다. OneDrive 바탕 화면의 `my-app`은 별도 프로젝트이며 앱 소스를 동기화하지 않았다.

수정 전 `npx expo export --platform web`에서 `codegenNativeComponent is not a function`을 재현했다.
직접 원인은 웹을 지원하지 않는 `react-native-maps`의 네이티브 구현이 웹 및 정적 렌더링으로 들어온 것이다.
`app/(tabs)/index.tsx` 외에 `index.final.tsx`도 Expo Router의 자동 라우트이므로 두 파일의 import를 모두 분리했다. 기존 라우트는 삭제하지 않았다.

## 바뀐 파일 묶음

| 경로 | 변경 |
| --- | --- |
| components/maps/seeq-map.native.tsx 및 seeq-map.tsx | 기존 react-native-maps를 그대로 재수출 |
| components/maps/seeq-map.web.tsx | Leaflet 실제 지도, 마커, 경로, 화면 맞추기, 좌표 이동 |
| components/maps/leaflet.web.css, LEAFLET-LICENSE.txt | 웹 지도 스타일과 라이선스; 상대 이미지 대신 내장 이미지 |
| app/(tabs)/index.tsx, index.final.tsx | 플랫폼별 지도/API import; 웹 위치 권한 안내와 명시적 체험 위치 |
| components/web-experience.web.tsx 및 web-experience.tsx | 실제/체험 상태 표시, 지원 기능 안내, 위치 재요청, 알림 권한, 음성 확인 |
| lib/platform/*.web.ts 및 native.ts | 웹 위치·센서·알림·진동 처리. 네이티브는 기존 모듈 재수출 |
| lib/app-alert.web.ts | 웹 브라우저 확인/입력창에서 기존 승인·거절·연결 콜백 실행 |
| lib/hazard-socket-core.ts, hazard-socket.ts, hazard-socket.web.ts | 기존 수신 로직 유지; HTTPS에서 비보안 ws 연결의 명확한 안내 |
| hooks/use-hazard-alerts.ts | 진동 import만 플랫폼별 어댑터로 변경 |
| app/(tabs)/_layout.tsx, lib/app-alert.ts | SDK 58 색상/알림 null 타입 호환 보정 |
| package.json, package-lock.json | 웹 지도 leaflet, 타입 @types/leaflet, DOM 테스트 jsdom 추가 |
| tests/web-compatibility.test.cjs | 지도·경로 렌더링, 실제 위치/체험 분리, 웹 API와 기존 콜백 검증 |

Firebase 인증 함수, 사용자/보호자 유형, 데이터베이스 경로와 승인 흐름, TMAP 경로 요청, 위험 신호 이벤트·우선순위 및 경고 테스트는 유지한다.
브라우저가 실제 위치를 반환했을 때만 기존 GPS 상태와 위치 공유/이동 기록 로직으로 전달한다.
체험 좌표는 표시와 검색 출발점에만 쓰고 `setMyLocation`에 넣거나 Firebase 위치로 쓰지 않는다.

## 실제 지원과 조건부/체험 기능

| 기능 | 웹 동작 |
| --- | --- |
| 지도·마커·경로 | Leaflet + OpenStreetMap. 인터넷 필요. 지도 귀속 표시 유지 |
| 장소 검색·도보 경로 | 기존 TMAP API 사용. 유효 키·사용량·브라우저 CORS 허용 필요 |
| 로그인·가입·보호자 승인·위치 공유 | 기존 Firebase SDK와 데이터 사용. 실제 계정/서비스 권한은 별도 확인 필요 |
| 실제 위치 | HTTPS 또는 localhost와 사용자 위치 권한 필요. 브라우저 전면에서 추적 |
| 위치 체험 | 사용자가 '지도 체험하기'를 선택할 때 서울시청 기준 사용. 상단에 '체험 위치 사용 중' 표시 |
| 주소 표시 | 웹 역지오코딩 미지원으로 실제 위도/경도 표시. 모바일 주소 변환은 그대로 |
| TTS·경고음 | 브라우저 오디오 허용 필요. 음성 확인/경고 테스트를 먼저 누를 것. Safari/Chrome 기기에서 실제 소리 확인 필요 |
| 위험 감지 | 실제 WebSocket 서버 연결 필요. HTTPS 사이트에서는 wss 필요. ws://10.42.0.1:5000은 HTTPS에서 차단되므로 모바일 앱이나 보안 중계 필요 |
| 경고 테스트 | 실제 탐지와 구분해 [테스트] 표시 |
| 진동 | navigator.vibrate 지원 브라우저에서만 실행. iPhone Safari 미지원 |
| 나침반 | 웹에서 실제 방향을 제공하지 않으며 버튼을 누르면 미지원 안내 |
| 브라우저 시스템 알림 | 사용자가 권한 버튼으로 허용한 지원 브라우저에서만 실행. 앱 안 경고는 별도 유지 |
| 백그라운드/화면 잠금 | 브라우저 위치 및 위험 수신 보장 안 됨 |
| 카메라 영상 기록·음성 검색 | 원래 준비 중인 기능은 그대로이며 이번 작업에서 실제 구현으로 표시하지 않음 |

타일 서버는 기본 `https://tile.openstreetmap.org/{z}/{x}/{y}.png`를 사용하며,
필요하면 `EXPO_PUBLIC_WEB_MAP_TILE_URL`로 호환 타일 제공자를 바꿀 수 있다. 제공자의 이용 조건과 지도 귀속 표시는 확인해야 한다.

## 실행 및 배포

```powershell
cd C:\SeeQ-App
npx expo start --web --clear
```

정적 배포 파일 생성:

```powershell
npx expo export --platform web
```

생성된 `dist`를 HTTPS 호스팅에 올린 뒤 그 공개 주소로 QR코드를 만들어야 방문자가 앱 설치 없이 사용할 수 있다.
localhost 주소나 개발 PC의 IP로 만든 QR은 같은 네트워크 밖에서 접근할 수 없다.
이번 작업은 외부 호스팅에 배포하거나 공개 QR을 발행하지 않는다. 배포 도메인의 Firebase 허용 설정과 TMAP 브라우저 요청 허용도 확인할 것.

## 검증 범위

- 웹 개발 서버의 실제 HTTP 응답 및 정적 웹 빌드
- 네이티브 번들 생성 확인
- `node --test tests/web-compatibility.test.cjs tests/hazard-alerts.test.cjs tests/button-speech.test.cjs`
- Leaflet 실제 모듈을 DOM 환경에서 로드해 지도·마커·경로·명령형 API 확인
- 플랫폼 미지원 API, HTTPS ws 차단, 보호자 승인 콜백, 체험 좌표 비공유 검사
- 연결된 브라우저 UI 도구가 없어 실제 Safari/Chrome 화면 조작과 실제 Firebase 계정·라즈베리파이 기기 연동은 확인하지 못함

## 백업과 복구

백업 위치:
`C:\Users\김유민\OneDrive\바탕 화면\my-app\backups\seeq-before-web-20261031-201542`

앱/컴포넌트/훅/라이브러리/에셋/설정/기존 테스트/문서와 원래 package-lock을 보관했다. node_modules, 생성 캐시, tmp는 npm ci 등으로 재생성하는 항목이라 제외한다.
`changed-files.json`에는 수정/추가 파일이 기록되어 있고 `restore-web.ps1`이 그 목록을 사용한다.

1. Expo 개발 서버 종료.
2. 백업 폴더에서 복구 내용을 미리 확인:

```powershell
.\restore-web.ps1 -WhatIf
```

3. 실제 원본 복구 및 기존 의존성 재설치:

```powershell
.\restore-web.ps1 -Install
```

스크립트는 해당 수정에서 추가한 파일만 제거하고 수정한 원본만 복원한다. 그 뒤 `npx expo start -c`로 재시작한다.
`dist` 같은 생성물은 남아 있으므로 복구 후에는 이전에 생성한 웹 빌드를 배포하지 않는다.

## 이번 작업의 확인 결과 (2026-10-31)

- TypeScript 전체 검사 및 변경한 웹 모듈 ESLint 검사 통과.
- 기존 위험 알림/버튼 음성과 웹 호환성 테스트 총 26개 통과.
- 웹 개발 서버 HTTP 200 응답 확인. 웹 정적 빌드 및 iOS/Android 번들 생성 성공.
- 기존 키로 TMAP 장소 검색 및 보행 경로 API HTTP 200, 브라우저 CORS preflight 허용 확인.
- 실제 Safari/Chrome 화면, 휴대폰 소리/진동 및 라즈베리파이 연결은 기기에서 추가 확인 필요.