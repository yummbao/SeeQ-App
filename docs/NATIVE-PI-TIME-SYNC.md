# 모바일 Pi TIME_SYNC 연동

2026-11-03: 사용자가 제공한 사진의 서버 규약(event=TIME_SYNC, timestamp=Unix 초)에 맞춰 모바일 클라이언트를 수정했다. 사진은 새 Python 소스 전체가 아니므로 서버 구현 자체를 검증한 것으로 보지 않는다.

## 변경 위치

- lib/hazard-socket-core.ts: timeSync 옵션 추가. onopen 직후 전송하고 60초마다 반복한다. 기존 onclose/onerror/8초 연결 타임아웃/재연결 로직을 유지한다. 실패·정리 시 동기화 타이머를 취소하며 예전 연결 콜백은 전송하지 않는다.
- hooks/use-hazard-alerts.native.ts: openHazardSocket 호출에 timeSync: true를 지정한다. iOS/Android만 활성화한다. 웹 호출은 기본 false다.
- tests/hazard-alerts.test.cjs, tests/native-hazard-audio.test.cjs: 초 단위, 즉시 전송, 재연결, 타이머 해제, 송신 실패, 기본 비활성, stale 기준 유지와 네이티브 연동을 검증한다.

메시지는 다음과 같다.

```json
{"event":"TIME_SYNC","timestamp":1793682000.123}
```

timestamp는 전송 때마다 Date.now()/1000으로 새로 계산한다. [WS TIME_SYNC SENT]는 클라이언트 send 호출 성공이지 서버의 적용 확인 응답이 아니다. 서버 응답 형식이 제공되지 않아 임의 ACK 규약을 추가하지 않았다. 연결 직후 동기화 이전에 생성된 프레임은 여전히 stale일 수 있으므로 새 감지를 확인한다.

## 실행 확인

```powershell
cd C:\SeeQ-App
npx.cmd expo start --go --clear
```

Expo Go에 새 번들을 로드한 뒤 SeeQ-WiFi에서 주변 인식을 연결한다. [WS OPEN] 다음 [WS TIME_SYNC SENT]를 확인한다. Python이 TIME_SYNC를 수신·적용했는지 같은 연결의 로그를 확인한다. 새 LEVEL1/LEVEL2에서 시간 차이가 허용 범위 안으로 들어오고 player-ended → tone-finished → speech-start가 나오는지 확인한다. 같은 시점의 JSON/시간 비교/오디오 로그를 보관한다. 오래된 서버의 `for _ in client: pass`는 이 메시지를 무시하므로 서버 수정 없이 동작하지 않는다.

## 서버 측 필수 확인

운영체제 시계 변경 없이 연결별 기준 시각을 유지하는 방식이다. 최초 동기화 때 client_epoch와 server_monotonic을 저장하고 새 감지 이벤트 생성 시 client_epoch+(time.monotonic()-server_monotonic)을 사용할 수 있다. 네트워크 전달 시간만큼의 근사 오차가 있으므로 정밀 시각 동기화를 보장하지 않는다.

- 새 연결에서 이전 연결의 시간 기준을 무조건 재사용하지 않는다.
- 동기화 기준을 생성 시각에 적용한다. 오래된 큐 이벤트의 timestamp를 송신 직전에 현재 시각으로 덮어쓰지 않는다.
- 재동기화해도 이미 생성된 위험의 원래 나이를 지우지 않는다.
- 큐 경과시간/감지 유효기간은 time.monotonic()으로 검사한다.
- 동기화 전 처리, 수신값 유효성, 연속 갱신 때 시계 변화 처리를 실제 Python에서 확인해야 한다.

앱의 10초 과거/30초 미래 검사, LEVEL1/LEVEL2/CROSSWALK/GO 정책, 음원·TTS·Firebase·지도는 이번 변경에서 수정하지 않았다. 실제 라즈베리파이·아이폰 스피커 테스트 및 서버 ACK 검증은 수행하지 않았다.

변경 전 백업: C:\Users\김유민\OneDrive\바탕 화면\my-app\backups\seeq-before-native-time-sync-20261103
