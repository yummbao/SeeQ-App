# Expo Go stale / 2484초 시간 차이 점검

## 확인한 사항과 아직 모르는 사항

앱은 프레임마다 Date.now()를 읽고 `ageMs = receivedAtMs - timestamp * 1000`으로 계산한다. Date.now()는 Unix 밀리초이고 Python time.time()은 Unix 초이므로 이 환산 자체는 맞다. 10초보다 오래되거나 30초보다 미래인 프레임은 거부한다. 이 계산·단위·허용 범위를 이번 작업에서 변경하지 않았다.

2484초는 41분 24초다. 그 값만으로 시계 차이와 큐 지연을 구분할 수는 없다. 앱이 현재 시각으로 자동 보정하거나 오래된 timestamp를 수신 시각으로 덮어쓰면 실제로 오래된 위험을 새 위험처럼 처리하므로 그렇게 변경하지 않았다.

실제 라즈베리파이에는 접속하거나 테스트하지 않았다. 이후 제공된 현재 WebSocket 소스의 검토와 진단 위치는 [PI-WEBSOCKET-TIMESTAMP-REVIEW.md](./PI-WEBSOCKET-TIMESTAMP-REVIEW.md)에 정리했다. 아래 TCP 첨부 분석은 이전 소스에 대한 기록이며 현재 WebSocket 서버에 그대로 적용하면 안 된다.

## 기존 Python 첨부 코드에서 확인한 위치

파일: C:\Users\김유민\.codex\attachments\179930dc-859c-421f-b2c2-ba6bd883702c\붙여넣은 텍스트.txt

- 28행 send_signal_to_app: 연결된 클라이언트가 있을 때마다 새 data 객체를 만든다.
- 36행: `"timestamp": time.time()`은 함수 내부다. 이 원본에서는 함수 호출 때마다 새 시각을 생성한다. 프로그램 시작 시 한 번 생성한 timestamp를 재사용하는 형태는 아니다.
- 40행: json.dumps(data)를 매 호출 수행하고 TCP sendall로 전송한다. 코드상 명시적인 전송 큐/이전 JSON 재전송 루프는 없다.
- 다만 sendall 완료 대기에 걸리는 시간과 OS/중계 서버의 버퍼는 이 소스만으로 확정할 수 없다. 현재 WebSocket 코드에 새 큐나 last_payload 방송 기능이 추가되었는지도 알 수 없다.
- 52/53행, 185~205행의 송신 간격 제어와 140~153행의 TTC 시간차는 time.time()을 사용한다. 실행 중 시간을 뒤로 바꿨다면 기존 last_send 값이 새 현재 시각보다 미래가 되어 송신이 잠시 멈출 수 있다. 실제 서버에서 같은 구조를 쓴다면 시간 수정 후 프로세스 재시작 여부와 음수 시간차를 확인한다. 향후 경과시간 계산은 time.monotonic(), JSON의 절대시각은 time.time()으로 분리하는 것이 적절하다. 기존 0.5/2.0초 조건을 임의로 바꾸지는 않는다.

## 앱에 추가한 로그/화면 항목

모바일의 onFrame에서 다른 로그 작업 전에 수신 Date.now()를 읽는다. 실제 판정은 기존 socket core가 이 콜백 직후 다시 읽은 Date.now()로 한다. 따라서 두 측정 사이의 짧은 JS 처리 시간은 있을 수 있지만, 2484초 차이를 만드는 고정 오프셋이나 보정은 없다.

`[SeeQ hazard receive]` 로그:

- receivedAtMs / receivedAtUtc: 앱이 받은 시각
- timestampRaw / timestampType: 원래 timestamp 값과 자료형
- validatorTimestampMs: timestamp를 초로 해석하여 1000배 한 값
- timestampUtcAsSeconds: 초로 해석한 감지 UTC
- ageMs / ageSeconds: 두 값의 차이
- unitGuess: seconds 또는 milliseconds로 보이는지(진단용이며 수신 허용에 사용하지 않음)
- timestampStepSeconds / receiveStepMs: 직전 신호와 timestamp/수신 시각 변화량
- unchangedTimestampForMs: 같은 timestamp가 반복된 기간
- monotonicStepMs / receiverClockStepMs: 경과시간 대비 휴대폰 벽시계가 갑자기 바뀐 흔적

종류 변경 또는 5초 간격으로 콘솔에 샘플을 기록한다. 연결 화면의 오류에도 `[시간 비교]`와 주요 숫자가 추가된다. 콘솔 접근이 어려우면 화면 텍스트를 길게 눌러 복사할 수 있다. 재연결 시 진단 비교 기준만 초기화한다. 검증기의 timestamp는 보정하거나 변경하지 않는다.

## 숫자 해석

| 관찰 | 확인할 위치 |
| --- | --- |
| timestamp는 같은데 수신 시각/age만 계속 증가 | cached JSON, 전역 payload, 기본 인자 timestamp=time.time(), last_payload 반복 방송 확인 |
| timestamp도 매번 증가하지만 age가 약 2484초로 일정 | 실제 송신 프로세스의 time.time()과 payload 값 비교. 고정 시계 차이와 일정한 버퍼 지연은 앱만으로 구분 불가 |
| Python 송신 직전 time.time()-payload.timestamp부터 이미 큼 | 앱 도착 전에 오래된 값. 생성 위치/큐/캐시/추론 대기 확인 |
| Python 생성·송신에서는 차이가 작고 앱에서만 큼 | 실제 두 기기 epoch 숫자와 네트워크/중계 지연 확인. 화면에 보이는 현지 시각만 비교하지 않음 |
| 약 13자리 timestamp | 밀리초 여부 확인. 현재 프로토콜은 초 단위 숫자이며 문자열·밀리초를 임의 변환하지 않음 |

## 현재 Python 서버에 넣을 진단 위치

실행 파일이 확인되지 않아 실제 서버 코드를 수정하지 않았다. 담당자에게 현재 .py의 JSON 생성 함수, 큐 producer/consumer, WebSocket send 부분을 요청해야 한다.

새 감지 결과의 payload를 만드는 위치에서만 새 감지 시각을 만든다. 다음 예시는 기존 전송 조건 안에 추가할 진단 위치이며 WebSocket 서버 전체를 대체하는 코드가 아니다.

```python
# 새 감지 이벤트가 확정되어 새 payload를 만드는 곳
detected_epoch_s = time.time()
created_monotonic_s = time.monotonic()
data = {
    "event": event_type,
    "message": message,
    "ttc": ttc,
    "timestamp": detected_epoch_s,
}
print("[SeeQ created]", {
    "event": data["event"],
    "timestamp_s": data["timestamp"],
    "now_s": time.time(),
}, flush=True)
```

실제 `await websocket.send(...)` 또는 기존 TCP sendall **바로 앞뒤**에 로그를 넣는다. data 변수명은 실제 코드에 맞춘다.

```python
send_now_s = time.time()
send_begin_mono = time.monotonic()
print("[SeeQ before send]", {
    "event": data["event"],
    "timestamp_s": data["timestamp"],
    "send_now_s": send_now_s,
    "age_before_send_s": send_now_s - data["timestamp"],
    # 큐를 사용하면 생성/넣기 시점의 monotonic 값도 함께 전달해 비교
    "elapsed_since_created_s": send_begin_mono - created_monotonic_s,
}, flush=True)

# 원래 사용하던 WebSocket/TCP send 호출을 그대로 실행

print("[SeeQ after send]", {
    "send_duration_s": time.monotonic() - send_begin_mono,
    "now_s": time.time(),
}, flush=True)
```

큐가 있다면 enqueue/dequeue 시각을 time.monotonic()으로 각각 기록한다. 송신 완료는 아이폰 도착 확인과 같지는 않다. 오래된 큐 항목을 보내기 직전에 timestamp만 현재로 바꾸면 안 된다. 오래된 감지를 폐기하고 실제 새 감지 결과를 생성해야 한다. 재연결 때 오래된 last_payload/큐를 다시 방송하는지도 확인한다. 현재 코드 없이 큐 크기/드롭 정책을 임의 수정하지 않았다.

현재 프로세스의 Unix 시각 확인:

```bash
python3 -c 'import time,datetime; print(time.time()); print(datetime.datetime.now(datetime.timezone.utc).isoformat())'
```

위 명령과 별개로 실제 AI/송신 함수 내부 로그가 중요하다. 다른 프로세스/컨테이너 또는 시작 시 캐시한 시각을 쓸 수 있기 때문이다. Unix 값에 한국 시간 9시간을 더하지 않는다.

## iPhone 확인 순서

```powershell
cd C:\SeeQ-App
npx expo start --go --clear
```

1. 기존 서버를 종료하고 Expo Go도 다시 열어 새 코드를 로드한다.
2. 실제 신호를 받고 연결 화면의 수신 원문과 `[시간 비교]`를 복사한다. 약 5초 뒤 같은 정보를 한 번 더 확보하면 timestamp 재사용 여부를 볼 수 있다.
3. Python 생성/송신 로그 두 건과 비교한다. 10초 기준은 그대로다.
4. 새 LEVEL1이 승인되면 player-ended -> tone-finished -> speech-start 순서와 기존 경고음/멘트를 확인한다.
5. LEVEL1 입력이 멈추고 유지 시간 및 음성이 끝난 뒤 LEVEL2를 확인한다. 실제 LEVEL1이 계속 오는 동안 낮은 LEVEL2를 억제하는 기존 정책은 유지한다.

## 검증/수정 범위

54개 자동 검사 통과: 2484초 계산, 초/밀리초 구분, timestamp 재사용·전진·휴대폰 시계 변화, 기존 시간 경계, stale 거부 후 새 LEVEL1의 경고음→TTS 복구 및 기존 LEVEL1/LEVEL2/횡단보도/GO 경고 순서 포함. TypeScript·변경 파일 ESLint 통과. 실제 라즈베리파이/아이폰에서 성공했다고 판단한 결과는 아니다.

추가/수정: lib/hazard-receive-timing.ts, hooks/use-hazard-alerts.native.ts, tests/hazard-receive-timing.test.cjs, tests/native-hazard-audio.test.cjs, 본 문서.

웹 훅/웹 오디오, 공통 JSON 파서/수신 허용 조건, Firebase·지도·보호자 코드는 변경하지 않았다. 원본 Python 첨부도 변경하지 않았다. 백업은 C:\Users\김유민\OneDrive\바탕 화면\my-app\backups\seeq-before-native-clock-audit-20261101-143834에 있다.

참고: https://docs.python.org/3/library/time.html , https://docs.python.org/3/library/socket.html#socket.socket.sendall
