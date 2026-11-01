# 전시 Firebase 보안 규칙 검토 및 재현

대상은 C:\SeeQ-App의 전시용 Realtime Database 규칙이다. 실제 Console 게시나 운영 프로젝트 seeq-a3251 변경은 하지 않았다.

## 수정 설계

`users/$uid`, `profiles/$uid`에는 부모 `.write` 허용이 없다. 소유자의 루트 읽기만 허용하며, 다른 사람의 루트 읽기는 차단한다. 메타데이터는 허용된 개별 필드만 쓰고, uid/email/계정 유형은 최초 생성 후 변경·삭제할 수 없다. 알 수 없는 필드도 거부한다. 가입 코드는 전체 프로필 set 대신 개별 필드를 한 번의 multi-location update로 생성한다. 부모의 스키마 `.validate`는 해당 원자적 작업의 완성된 데이터를 검사한다.

연결 권한은 클라이언트의 역할 선택이나 guardianLinks 목록 하나만 믿지 않는다. 서버에 저장된 불변 계정 유형, Firebase의 `email_verified` 클레임, 만료 전 요청의 requestId, 승인된 감사 기록과 네 개의 연결 필드 일치를 확인한다.

| 경로 | 허용 범위 |
| --- | --- |
| profiles/$uid 전체, email, pairCode | 본인만 읽기. 연결된 상대에게도 전체/이메일/코드 조회 불허 |
| profiles/$uid/name, userId | 본인 또는 승인·연결 기록이 일치하는 상대만 읽기 |
| users/$uid 전체 | 본인만 읽기. 보호자는 전체 조회 불가 |
| users/$uid/location, moveHistory | 본인 또는 정상 연결된 보호자가 shareLocation=true 또는 status/emergency=true일 때 읽기 |
| shareLocation/status | 본인 쓰기. 정상 연결된 보호자는 읽기만 가능 |
| pairedGuardian/pairedUser 네 개 | 대상 사용자의 정상 수락 작업 또는 양측 참여자의 정상 해제 작업에서만 변경 |
| pairCodes | 목록 조회 불가. 128비트 임의 32자리 코드와 만료시간. 소유자 또는 코드를 전달받은 인증·검증된 보호자가 해당 코드의 UID/만료시간만 조회 |
| usersByEmail/usersById | 웹에서는 읽기·쓰기 모두 차단. 이메일 로그인은 Firebase Auth와 본인 UID 프로필로 처리 |

연결 코드는 UID 조회를 위한 **비밀 초대 토큰**이다. 다른 보호자가 이 토큰 자체를 전달받으면 요청을 보낼 수 있지만, 대상 사용자의 수락 없이 연결·위치 조회는 불가능하다. 코드의 추측 가능성을 낮추기 위해 기존 6자리 대신 crypto.getRandomValues의 128비트 코드를 사용한다. 코드 목록 조회와 타인 프로필의 코드 조회는 허용하지 않는다. 코드 수명은 앱에서 14분이며 규칙의 최대 허용 범위는 15분이다. 코드 갱신은 이전 토큰과 그 토큰으로 생성된 미수락 요청의 승인 권한을 취소한다.

## 요청·수락·삭제

1. 검증된 보호자만 실제 코드로 요청 생성. pendingRequests, connectionRequests, guardianSentRequests의 UID/requestId/본문/상태가 동일한 원자적 생성이어야 한다. 대상과 보호자가 이미 연결 중이면 새 연결 불가. requestId는 128비트 난수, 요청 생성시각은 serverTimestamp, 앱의 응답 기한은 4분(규칙 최대 5분)이다.
2. 수락은 요청 대상 사용자만 가능. 네 개 연결 필드, guardianLinks, 승인 감사 기록, 대기 요청 삭제를 하나의 update로 저장한다. 한 필드만 승인하거나 보호자가 자기 요청을 수락하는 시도는 거부한다. 사용자와 보호자는 각각 한 명만 연결할 수 있다.
3. 거절은 대상 사용자만 가능. 두 감사 기록을 rejected로 변경하고 대기 요청을 동시에 제거한다. 만료된 요청은 수락할 수 없다. 만료된 대기 요청은 새 요청으로 대체하거나 참여자가 세 요청 기록을 동시에 삭제할 수 있다.
4. 연결 해제는 연결 당사자만 가능. 네 필드와 guardianLinks를 동시에 지우고 감사 기록을 disconnected로 바꾼다. 연결을 남겨 둔 채 목록/감사 기록만 삭제할 수 없다. 해제 후 과거 approved 기록으로 재연결할 수 없다.
5. 이미 소비된 pendingRequests의 null 삭제는 해당 요청 경로 참여자에게만 무효과 작업으로 허용한다. 이 예외는 새 요청 생성·변경 권한을 주지 않는다.

가입 시에는 이메일 검증 전 본인 최소 프로필 생성만 허용한다. 연결·위치 공유 등은 검증된 토큰이 필요하다. 계정 유형을 바꾸려면 운영자가 검토해야 하며 클라이언트에서 임의 변경할 수 없다. 표시용 userId는 검색 인덱스를 제거했으므로 전역 고유 아이디로 사용하지 않는다.

## 웹/모바일 코드

- app/(tabs)/index.web.tsx: 새 전시 규칙에 맞는 웹 전용 화면. 이전 웹 로컬 캐시와 섞이지 않도록 secure-v2 저장소 네임스페이스 사용.
- app/(tabs)/index.final.web.tsx 및 index4.web.tsx: 동일한 보안 웹 화면 재사용. 다른 웹 라우트로 예전 쓰기 흐름이 실행되지 않도록 처리.
- lib/exhibition-data.web.ts: 실제 웹과 Emulator 테스트가 같이 실행하는 가입·코드 갱신·요청·수락·거절·해제 API. 상대 프로필은 이름/id 두 자식 경로만 읽는다. 실패한 쓰기를 성공으로 표시하지 않는다.
- database.exhibition.rules.json: 게시하지 않은 전시용 규칙.
- scripts/generate-exhibition-rules.cjs: 중복되는 검증식을 생성하는 유지보수 원본. `node scripts/generate-exhibition-rules.cjs`로 규칙 재생성 후 반드시 Emulator 테스트.
- firebase.exhibition.json: demo-seeq-exhibition-security 인스턴스와 127.0.0.1:9000만 지정한 **Emulator 전용** 설정. Console 배포용 설정으로 사용하지 않는다.
- tests/exhibition-rules.emulator.test.cjs 및 tools/security-tests: Emulator 테스트와 앱 의존성에서 분리한 고정 버전 도구.

기존 index.tsx/index.final.tsx, 모바일용 모듈, app.json, 루트 package.json/package-lock.json, 운영용 database.rules.json은 이번 작업에서 변경하지 않았다. 테스트 도구는 별도 tools/security-tests/node_modules에 설치했다.

## 테스트 실행

Java 21 이상과 Node.js가 필요하다. 이미 설치한 Java를 사용하거나 해당 실행에서만 Java 폴더를 지정할 수 있다. 시스템 Java 설정은 이 작업에서 변경하지 않았다.

```powershell
cd C:\SeeQ-App
npm --prefix tools/security-tests ci
# Java가 PATH에 없다면 실제 설치 경로 지정:
# $env:SEEQ_TEST_JAVA_HOME='C:\path\to\java-21'
npm --prefix tools/security-tests test
```

테스트 runner는 프로젝트 ID를 demo-seeq-exhibition-security로 고정하며 .env.local을 읽지 않는다. 테스트 본문도 FIREBASE_DATABASE_EMULATOR_HOST가 localhost:9000 또는 127.0.0.1:9000이 아니면 실행을 거부한다. 실제 Firebase 데이터에 접속하거나 규칙을 게시하지 않는다. 테스트 데이터는 Emulator에서만 생성·초기화한다. 9000 포트를 다른 프로그램이 사용 중이면 먼저 해당 프로그램을 확인한다.

DB Emulator v4.11.2에서 20개 시나리오 통과: 정상 가입/코드 전달/원자적 수락/거절/양측 해제, 익명 및 타 계정 정보 조회 거부, 부모 덮어쓰기/역할 변경 거부, 코드 목록·추측·만료·갱신 검증, 요청 승인/본문 위조 거부, 일부 링크·감사 기록만 삭제 거부, 공유 OFF 위치/기록 차단, SOS 예외, 만료 요청 및 오래된 UI 콜백 재사용 거부, 한 사용자/보호자의 이중 연결 거부.

이는 실제 웹 데이터 API로 수행한 Emulator 검사다. Firebase Auth 이메일 전송·실제 Console 규칙 적용·Safari/Chrome 두 기기 UI까지 검사한 것은 아니다. 변경 후 위 명령을 다시 실행하고 실제 전시 프로젝트 적용은 별도로 검토한다.

## 추가 설정과 기존 전시 데이터

- 전시 프로젝트에는 이메일/비밀번호 로그인을 활성화하고 실제 이메일 인증을 완료한다. 토큰 갱신을 위해 인증 후 다시 로그인한다.
- 이전의 느슨한 규칙으로 만든 전시 연결/대기 요청/guardianLinks는 신뢰할 수 없다. 관리자가 **전시 DB에서만** 기존 연결 기록과 네 개 연결 필드를 검토·초기화한 뒤 새 코드로 재연결해야 한다. 운영 DB는 변경하지 않는다. 이 작업은 기존 데이터 삭제/마이그레이션을 자동 실행하지 않았다.
- 기존 6자리 코드는 새 보안 요청에서 사용할 수 없다. 웹의 코드 변경 버튼 또는 새 로그인에서 생성한 32자리 코드를 사용한다.
- 기기 시계가 크게 틀리면 요청 만료 검사가 거부할 수 있다. 현장 기기의 자동 날짜/시간을 켠다.
- 공개 행사에서 대량 요청을 제한하려면 App Check 또는 서버 측 속도 제한을 별도로 검토한다. 초대 코드를 공개 게시하지 않는다.

변경 전 백업은 C:\Users\김유민\OneDrive\바탕 화면\my-app\backups\seeq-before-rules-security-20261031-214213에 있다. 이전 규칙에는 보안 문제가 있으므로 백업 규칙을 공개 DB에 재게시하면 안 된다.

공식 참고: https://firebase.google.com/docs/database/security/core-syntax , https://firebase.google.com/docs/rules/unit-tests


최종 확인: Emulator 20개 통과, 기존 기능 및 Expo Router 플랫폼 선택 검사 35개 통과, TypeScript·새 데이터 API/테스트/스크립트 ESLint 통과, 캐시를 비운 웹 빌드 통과, 규칙 생성기와 배포 전 규칙 파일의 SHA256 일치. 모바일 원본 8개 파일의 SHA256이 백업과 동일함을 확인했다. 실제 Console 게시와 두 기기 UI 확인은 수행하지 않았다. 로컬 테스트 로그는 tmp에서 관리하고 git에 포함하지 않는다.

이 PC에서 검증에 사용한 임시 Java는 다음과 같다. 새 터미널에서 재현할 때 경로가 남아 있다면 사용 가능하다:

```powershell
$env:SEEQ_TEST_JAVA_HOME='C:\Users\김유민\OneDrive\바탕 화면\my-app\tmp\firebase-security-tools\jdk-21.0.13+9-jre'
npm --prefix C:\SeeQ-App\tools\security-tests test
```

규칙 파일만 수정했기 때문에 실제 서버의 기존 보안 정책은 아직 바뀌지 않았다. 새 웹 코드와 함께 사용할 규칙을 검토해 **전시 프로젝트에만** 적용해야 한다. Console 게시 명령은 이번 작업에서 실행하지 않았다.