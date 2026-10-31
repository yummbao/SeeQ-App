# SeeQ 전시용 웹앱 운영 안내

## 모바일과 데이터 분리

작업 대상은 C:\SeeQ-App이다. iOS/Android는 기존 Firebase와 react-native-maps를 계속 사용한다.
웹은 Leaflet 지도와 별도 전시 Firebase 앱을 사용한다. 웹용 Firebase 설정이 누락되거나 기존 모바일 프로젝트와 같으면 계정 기능을 차단한다. 지도/명시적 위치 체험/경고 시연은 가능하다. 이 상태를 실제 로그인 성공으로 표시하지 않는다.

`.env.exhibition.example`을 `.env.local`로 복사하고 별도로 만든 전시 Firebase 프로젝트의 웹 설정을 입력한다. EXPO_PUBLIC 값은 브라우저에 공개된다. 관리자 키, 서비스 계정 파일, 비밀번호는 넣지 않는다.

Firebase Console에서 전시 프로젝트에만 다음을 설정한다.

1. Authentication > Email/Password 사용 설정.
2. Realtime Database 생성. `database.exhibition.rules.json`의 규칙을 검토한 뒤 **전시 프로젝트**에 적용. 기존 운영 규칙은 바꾸지 않는다.
3. Authentication > Authorized domains에 실제 EAS Hosting 도메인과 필요한 localhost 추가.
4. 사용자/보호자 계정을 웹 회원가입으로 각각 생성하고 각 이메일 인증을 완료한다. 실제로 수신 가능한 전시 담당자의 별도 이메일을 사용한다. 공통 비밀번호나 관리자 키를 코드에 넣지 않는다.
5. 사용자 화면의 연결 코드를 보호자 화면에서 입력하고 사용자 쪽에서 수락한다. 두 기기/서로 다른 브라우저 프로필을 사용한다. 같은 브라우저 탭들은 Firebase 로그인 상태를 공유한다.

테스트 계정은 자동 생성하지 않았다. 이 작업에서 실제 사용자 가입·메일 발송·운영 데이터 쓰기·규칙 배포는 하지 않았다. 전시 종료 후 해당 전시 프로젝트의 테스트 계정과 위치 기록을 정리한다.

## 실행 및 EAS Hosting

```powershell
cd C:\SeeQ-App
Copy-Item .env.exhibition.example .env.local
# .env.local에 전시 Firebase 설정 입력
npm run web:preflight
npx expo start --web --clear
```

Firebase 설정 없이도 지도 화면을 살펴볼 수 있지만 `web:preflight`는 의도적으로 실패한다. 실제 기능이 준비되지 않은 상태의 전시 배포를 잡는 검사다.

```powershell
npm run web:preflight
npm run web:build
npx eas-cli@latest login
npx eas-cli@latest init
npx eas-cli@latest deploy
# 미리보기 URL에서 두 기기로 실제 기능 확인 후:
npx eas-cli@latest deploy --prod
```

`eas init`이 계정/프로젝트에 연결하면서 app.json의 extra.eas.projectId 등을 설정한다. 계정별 ID는 임의로 만들지 않았다. web.output=static 설정은 유지한다. 배포 산출물은 dist다. CLI 로그인/계정 연결/공개 배포는 이 작업에서 실행하지 않았다.

EAS 환경 변수를 사용한다면 `eas env:pull --environment production`으로 가져온 뒤 export하고, `eas deploy --environment production`으로 같은 환경을 배포한다. EXPO_PUBLIC 값은 export 시점에 번들에 들어가므로 환경 변수를 바꾸면 다시 빌드해야 한다.

미리보기 도메인을 Firebase Authorized domains에 등록하고 로그인/가입/연결/위치 공유를 확인한다. 최종 HTTPS URL로 QR을 만든다. localhost, 개발용 LAN IP는 관람객 공개 주소가 아니다.

## 기능과 제약

| 기능 | 실제 구현 및 조건 |
| --- | --- |
| 회원가입/로그인/보호자 연결 | 전시 Firebase 설정과 규칙 적용 후 실제 SDK 요청. 이메일 인증 필요. 새로고침 시 역할 복원. |
| 지도/검색/길찾기 | Leaflet 지도 + 기존 TMAP 실제 API. 인터넷과 유효한 TMAP 키/사용량 필요. |
| GPS/위치 공유 | HTTPS 및 사용자 위치 권한. 체험 원점은 별도 표시하며 Firebase GPS로 저장하지 않음. 보호자는 자신의 GPS 권한 없이도 공유된 위치 수신 가능. |
| 음성 안내 | 브라우저 음성 엔진. 먼저 음성 확인 버튼을 눌러 기기에서 소리 확인. |
| 위험 경고음 | 소리 활성화 버튼을 눌러 Web Audio를 활성화. 위험도에 맞는 짧은 경고음/반복 경고음. 모바일은 기존 WAV 재생 유지. |
| 실제 위험 감지 | 연결된 실제 모델의 기존 JSON 수신. HTTPS 사이트에는 wss:// 서버 필요. 연결/재연결 상태 표시. |
| 서버 없는 경고 시연 | 기존 경고 테스트. '테스트'로 표시. 카메라 객체 탐지를 수행한 것으로 표시하지 않음. |
| SOS | 전시 서버에 실제 저장. 연결된 보호자가 사이트를 열고 있을 때 수신. 저장 실패 시 전송 성공으로 표시하지 않음. 구조기관 신고 기능이 아님. |
| 진동/별도 시스템 알림 | 지원 브라우저/권한에서만. iPhone Safari 탭에서 진동·일반 웹 푸시를 보장하지 않음. 화면 경고는 유지. |
| 백그라운드/화면 잠금 | 위치/소리/서버 수신 보장 불가. 별도 백그라운드 푸시 서버·서비스 워커는 미구현. 전시 체험은 화면을 켠 상태로 진행. |

라즈베리파이의 ws://10.42.0.1:5000은 공개 HTTPS 페이지에서 직접 접속할 수 없다. 앱 코드만으로 해제할 수 없는 브라우저 제한이다. 실제 하드웨어 체험을 위해서는 팀원이 TLS 인증서와 접근 가능한 wss 엔드포인트(현장 네트워크 또는 인증된 중계 서버)를 제공해야 한다. EAS Hosting은 기존 Python TCP/WebSocket 서버를 자동 호스팅하지 않는다. SeeQ-WiFi에 인터넷이 없다면 웹 지도/티맵/Firebase도 사용할 수 없다.

## 전시 전 두 기기 점검

1. iPhone Safari와 Android Chrome에서 HTTPS 링크 열기. 설치/Expo Go 없이 초기 지도 확인.
2. 각각 사용자/보호자 회원가입, 이메일 인증, 로그인, 새로고침 후 역할 확인.
3. 연결 코드 수락/거절, 새로고침 후 연결 유지, 연결 해제 확인.
4. 위치 공유 OFF일 때 보호자 좌표 비표시, ON일 때 실제 위치 표시. 보호자 자신의 위치 권한을 거부해도 수신되는지 확인.
5. 경로 검색/진행/음성, 소리 활성화 후 실제 위험 JSON 및 테스트 구분 확인.
6. SOS 전송/해제, 네트워크 차단 시 실패 안내. 보호자 페이지 재접속으로 기존 SOS가 해제되지 않는지 확인.

실제 계정/Firebase 규칙/기기 스피커/라즈베리파이는 별도 환경이 필요하며 로컬 번들 및 단위 테스트 통과만으로 실기기 검증 완료를 의미하지 않는다.

## 백업

이전 지도 수정 전 백업: `backups/seeq-before-web-20261031-201542`.
이번 전시 수정 전 백업: `backups/seeq-before-exhibition-20261031-205346`.
두 경로는 `C:\Users\김유민\OneDrive\바탕 화면\my-app` 아래에 있다. 각각 원본 소스와 변경 목록을 보관한다. 이번 복구는 이번 백업의 restore-web.ps1을 사용한다. Expo 종료 후 `./restore-web.ps1 -WhatIf`로 확인하고 `./restore-web.ps1 -Install`로 복원한다. 이전 지도 분리까지 되돌리려면 첫 백업 스크립트를 사용한다.

공식 참고: https://docs.expo.dev/eas/hosting/ , https://docs.expo.dev/eas/environment-variables/usage/ , https://firebase.google.com/docs/projects/multiprojects , https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay
