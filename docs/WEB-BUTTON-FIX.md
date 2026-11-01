# 웹 중첩 버튼 수정 및 배포 점검

대상: C:\SeeQ-App. 모바일 원본과 Firebase 설정/규칙은 이번 작업에서 변경하지 않았다.

## 원인과 수정

기존 app/(tabs)/index.web.tsx의 HomeView > 관리 대상 목록에서 4288행의 위치 이동용 TouchableOpacity 안에 4332행의 연결 해제용 TouchableOpacity가 있었다. 둘 다 SpokenButton 별칭이며, SpokenButton은 react-native-web에서 실제 HTML button으로 렌더링된다. 따라서 위치 버튼 안에 삭제 버튼이 들어가는 잘못된 HTML이었다.

components/guardian-target-row.web.tsx로 해당 행을 분리했다. 일반 View 컨테이너 아래에 위치 보기와 연결 해제 버튼을 형제 요소로 배치한다. 버튼을 div 역할로 위장하거나 React 경고를 억제하지 않는다. 위치 선택/화면 이동/짧은 음성 안내, 연결 해제 API와 성공/실패 안내는 기존 콜백을 유지한다. 연결 해제를 눌러도 위치 화면 이동이 함께 실행되지 않는다.

수정 파일:

- app/(tabs)/index.web.tsx: 기존 관리 대상 행을 GuardianTargetRow로 교체.
- components/guardian-target-row.web.tsx: 두 독립 버튼을 가진 웹 전용 행.
- tests/web-button-structure.test.cjs: 실제 react-native-web HTML과 클릭/포커스/소스 중첩 회귀 검사.
- docs/WEB-BUTTON-FIX.md: 검증과 배포 준비 상태.

## 검증

- 전체 TypeScript 검사 통과.
- 새 컴포넌트/테스트 ESLint: 오류 0, 경고 0.
- 웹 화면 전체 ESLint: 오류 16, 경고 24. 백업 원본과 같은 규칙별 개수이며 이번 변경에서 추가되지 않았다. 기존 항목은 effect 내 동기 상태 변경, 렌더 중 ref 접근/컴포넌트 생성, 함수 선언 순서, 미사용 변수/의존성 등이다. 검사 억제나 전역 규칙 변경은 하지 않았다. 이 항목들이 제거되었다고 판단하면 안 된다.
- 실제 react-native-web을 jsdom에 렌더링해 button 2개가 형제인지, button 내부 button이 없는지 확인. 연결 해제는 해제 콜백만, 위치 보기는 이동 콜백만 실행하는 검사 통과. 포커스와 접근성 이름도 확인.
- 지도/플랫폼 선택/계정 전환/음성/위험 알림 등을 포함한 총 37개 회귀 테스트 통과.
- 정적 웹 빌드 성공, dist 생성. 실제 iPhone Safari/Android Chrome에서 화면 조작을 완료한 검증은 아니다.

```powershell
cd C:\SeeQ-App
npx tsc --noEmit --incremental false
npx eslint components/guardian-target-row.web.tsx tests/web-button-structure.test.cjs
node --test tests/web-button-structure.test.cjs tests/exhibition-platform-routing.test.cjs tests/web-compatibility.test.cjs tests/exhibition.test.cjs tests/hazard-alerts.test.cjs tests/button-speech.test.cjs
npm run web:build
```

웹 전체 lint의 남은 항목은 다음 명령으로 확인한다. 현재는 위에 기재한 기존 오류 때문에 종료 코드 1이다.

```powershell
npx eslint "app/(tabs)/index.web.tsx"
```

## EAS Hosting 준비 상태

web:preflight의 전시 Firebase 분리 설정은 통과했다. 기본 위험 감지 서버 주소는 미설정이며 실제 하드웨어 수신을 사용할 때 별도 wss:// 주소가 필요하다. 이는 경고 시연·회원가입·로그인·웹 페이지 자체의 정적 빌드를 막지는 않는다.

현재 app.json에는 EAS projectId 연결이 없다. Expo 계정으로 로그인하고 프로젝트를 연결한 뒤 최종 빌드/미리보기 배포를 진행한다. 이 작업에서는 로그인·EAS 프로젝트 생성·공개 배포를 실행하지 않았다.

```powershell
npx eas-cli@latest login
npx eas-cli@latest init
npm run web:preflight
npm run web:build
npx eas-cli@latest deploy
```

미리보기 주소를 iPhone Safari/Android Chrome에서 열어 사용자/보호자 로그인·연결·위치 보기·연결 해제·지도·메뉴를 확인한다. Firebase의 배포 도메인 허용 설정도 확인한다. 최종 HTTPS 주소로 QR을 만든다. 실제 DB 규칙 게시 여부는 이번 작업에서 변경하거나 원격 검증하지 않았다.

기존 ESLint 항목은 이번 export를 실패시키지 않았지만, CI에서 전체 lint 통과를 요구한다면 해당 항목을 먼저 정리해야 한다. 실제 EAS 계정/도메인/원격 Firebase 설정까지 확인한 배포 완료 상태는 아니다.

## 백업

변경 전 웹 화면과 모바일/설정 파일의 해시를 다음에 보관했다:
C:\Users\김유민\OneDrive\바탕 화면\my-app\backups\seeq-before-button-fix-20261031-223309

changed-files.json은 이번 변경 파일 목록이며 restore-web.ps1로 이번 버튼 수정만 복구할 수 있다. 다른 Firebase 규칙 변경은 포함하지 않는다.
