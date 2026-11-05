# 제공된 seeq_final_fixed.py WebSocket 코드 검토

2026-11-01에 채팅으로 제공된 WebSocket 버전을 검토한 결과다. 기존 TCP 첨부에 대한 이전 분석과 구분한다. 라즈베리파이에 접속하거나 실제 실행 파일을 수정·테스트하지 않았다.

## 확인 결과

1. AppServer.send_signal_to_app()는 호출할 때마다 새 data 딕셔너리를 만들고 timestamp에 time.time()을 넣는다. 초 단위이며 앱의 timestamp*1000과 일치한다. 제공된 코드에는 프로그램 시작 시 생성한 timestamp를 재사용하는 버그가 없다.
2. pending(maxsize=12), urgent_pending(maxsize=4) 두 송신 큐가 있다. queued_at은 time.monotonic()이다. _send_loop는 송신 전에 1.5초 초과 대기 항목을 버린다. 현재 연결/카메라 세대가 달라져도 버리며 일반 알림은 장면 변경도 확인한다.
3. EventLogger.pending(maxsize=256)은 CSV 쓰기용 큐다. 이 큐에서 WebSocket으로 다시 전송하는 코드는 없다. CSV 기록 재생 기능도 없다.
4. 일반적인 큐 대기가 이 코드에서 2484초짜리 신호를 반복 전송하게 만든다고 단정할 근거는 없다. 반대로 송신 전 1.5초 검사가 실제 단말까지 1.5초 내 도착을 보장하는 것도 아니다.
5. client.send(json.dumps(...)) 호출 자체의 소요 시간은 측정하지 않는다. 이미 시작된 send, OS/수신 단말의 버퍼 지연, 시간 보정이 일어난 시점은 현재 로그만으로 구분되지 않는다. ping_interval=5/ping_timeout=5가 있지만 그것만으로 실제 원인을 특정할 수는 없다.
6. 모델·추적·송신 간격 제어는 주로 time.monotonic()을 사용한다. 앞서 TCP 원본에서 언급한 time.time() 기반 송신 쿨다운 문제는 이 WebSocket 버전에 그대로 적용되지 않는다.

따라서 앱의 10초 제한을 늘리거나 data['timestamp']를 송신 직전에 현재 시각으로 덮어쓰는 방식은 적용하지 않는다. 이것은 오래된 위험을 신선한 감지로 위장할 수 있다.

## 가장 먼저 볼 자료: 이미 저장된 CSV

현재 EventLogger.record(data, 'SENT', objects)는 client.send가 반환된 뒤 호출된다. CSV의 time은 그때의 서버 시각이고 timestamp는 최초 이벤트 생성 시각이다. 두 값의 차이로 서버 안에서 이미 오래된 값이 되었는지 먼저 확인할 수 있다.

tools/pi-clock-audit/audit_warning_history.py는 이 CSV를 읽기만 한다. 표준 라이브러리만 사용하고 모델·카메라·서버를 실행하지 않는다. 파일을 Pi에 복사한 뒤 실제 생성된 CSV 경로로 실행한다:

```bash
python3 audit_warning_history.py warning_history/실제파일.csv --last 10
```

- age_after_send_approx_s가 약 2484: 서버 내부 대기/송신 중 지연 또는 생성 이후 서버 시각 변경을 확인.
- 이 값이 약 0~2초인데 앱 ageSeconds가 약 2484: 당시 서버 epoch와 아이폰 epoch 차이, 수신/네트워크 버퍼, 다른 실행 파일/서버 접속 여부를 비교. 한 원인으로 단정하지 않음.
- time은 초 단위로 잘려 저장되므로 약 1초 오차가 있다. SENT는 아이폰 수신 확인 응답이 아니며, 이것만으로 실제 네트워크 전달 완료를 보장하지 않는다.

도구는 로컬 Python 런타임을 확보하지 못해 이 작업에서 실행 검증하지 않았다. 실제 CSV 숫자를 제공하면 비교할 수 있다.

## Python에 추가할 정확한 로그 위치

감지 조건, 이벤트 종류/멘트, 임계값, 큐 우선순위는 바꾸지 않는다. 우선 아래 진단만 추가한다.

### 1. 실제 실행 파일 확인

AppServer.__init__의 서버 시작 로그 옆:

```python
print('[CLOCK AUDIT v1]', {
    'file': str(Path(__file__).resolve()),
    'epoch_s': time.time(),
    'monotonic_s': time.monotonic(),
}, flush=True)
```

자동 실행 서비스에서 이 로그가 나오는지 확인한다. 수정한 파일과 서비스가 실제 실행하는 파일이 다를 수 있다. 실행 중인 websockets 버전도 함께 확인한다. 이 검토를 위해 패키지 업그레이드는 하지 않는다.

### 2. 큐에 넣는 시점

send_signal_to_app()의 `task = (client, generation, data, objects, now, version, camera_generation)` 바로 앞:

```python
print('[CLOCK ENQUEUE]', {
    'event': data['event'],
    'timestamp_s': data['timestamp'],
    'server_epoch_s': time.time(),
    'queued_at_monotonic_s': now,
    'connection_generation': generation,
}, flush=True)
```

### 3. 실제 송신 직전/직후

_send_loop()의 기존 1.5초 폐기 검사를 통과한 뒤, `client.send(json.dumps(data, ensure_ascii=True))` 한 줄을 다음 진단 코드로 감싼다:

```python
before_send_wall = time.time()
before_send_mono = time.monotonic()
print('[CLOCK BEFORE SEND]', {
    'event': data['event'],
    'timestamp_s': data['timestamp'],
    'server_epoch_s': before_send_wall,
    'payload_age_s': before_send_wall - data['timestamp'],
    'queue_wait_s': before_send_mono - queued_at,
    'connection_generation': generation,
}, flush=True)

client.send(json.dumps(data, ensure_ascii=True))

after_send_wall = time.time()
after_send_mono = time.monotonic()
print('[CLOCK AFTER SEND]', {
    'event': data['event'],
    'timestamp_s': data['timestamp'],
    'server_epoch_s': after_send_wall,
    'payload_age_s': after_send_wall - data['timestamp'],
    'send_duration_s': after_send_mono - before_send_mono,
    'wall_clock_jump_during_send_s':
        (after_send_wall - before_send_wall)
        - (after_send_mono - before_send_mono),
}, flush=True)
```

기존 `_last_sent_alert` 갱신과 logger.record(..., 'SENT', ...)는 이 코드 뒤에 그대로 둔다. await나 send(timeout=...)로 임의 변경하지 않는다. 이 코드는 websockets.sync 서버이며 라이브러리 버전에 없는 send 인자를 추가하면 안 된다.

## 로그로 판단한 뒤의 보완

- enqueue부터 payload_age가 큼: 실행 코드/서버 시각/실제 timestamp 생성 위치 확인. 제공된 소스의 생성식 자체는 정상이다.
- queue_wait>1.5인 항목이 실제 보내짐: 실행 중인 _send_loop가 이 소스와 같은지 확인. 이 소스의 guard대로라면 보내기 전에 폐기된다.
- BEFORE SEND는 신선하고 AFTER SEND만 늦음: send 소요 시간과 시계 보정량을 구분해 연결/전송 지연을 조사.
- 앱만 오래됨: 동일 JSON timestamp를 기준으로 서버 epoch와 앱 receivedAtMs/1000을 비교. 단말 JS 중단 후 오래된 버퍼가 도착하는지도 확인.

서버에서도 송신 직전 `time.time()-data['timestamp']`가 10초를 넘거나 -30초보다 작으면 폐기하는 보완을 검토할 수 있다. 이는 생성 후 벽시계가 바뀐 항목을 막는 추가 검사다. timestamp를 갱신하거나 앱의 제한을 늘리는 대안이 아니다. 측정 결과 없이 이것만으로 2484초 문제를 해결했다고 주장하지 않는다.

## 앱/소리 확인

이 검토 단계에서는 Firebase·지도·보호자·웹사이트 및 앱 수신 허용 기준을 변경하지 않았다. 앱의 기존 [시간 비교]와 위 서버 로그의 같은 timestamp를 비교한다. 원인이 제거되어 새 프레임이 허용되면 LEVEL1/LEVEL2 각각 player-ended → tone-finished → speech-start 순서와 실제 스피커 소리를 확인한다. 실제 LEVEL1이 계속 활성인 동안 낮은 LEVEL2를 억제하는 기존 정책은 유지한다.

실제 Pi/iPhone 검사 전이므로 현재 문제 해결 또는 실제 음성 재생 성공을 단정하지 않는다.

참고: https://websockets.readthedocs.io/en/15.0.1/reference/sync/server.html , https://docs.python.org/3/library/time.html
