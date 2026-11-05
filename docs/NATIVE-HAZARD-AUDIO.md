# iPhone Expo Go 실제 감지 경고음 수정

작업 대상: C:\SeeQ-App. 이번 작업은 모바일 우선이다. 웹 경고음/TTS 구현과 기존 웹 dist는 갱신하지 않았고 공개 배포하지 않았다.

## 확인한 원인과 한계

실제 신호와 테스트 버튼은 원래도 receive -> output이라는 동일 함수로 들어오고 있었다. 서로 다른 수신 알고리즘을 임의로 합치거나 Python 알고리즘/JSON 조건을 변경하지 않았다.

기존 모바일 구현에서 확인한 문제:

- require(WAV) 모듈을 createAudioPlayer에 전달하고 isLoaded를 기다리지 않은 채 play()를 호출했다. 실패/종료 이벤트 누락은 모두 5초 후 같은 오류로 취급했다.
- 경고음 catch에서 실제 오류를 기록하지 않고 TTS로 대체했다. 이후 정상 WebSocket 프레임이 오면 error도 지워져 원인을 확인하기 어려웠다.
- 경고음이 성공하면 LEVEL1/LEVEL2는 TTS를 실행하지 않고, CROSSWALK/GO만 TTS를 실행하는 분기가 있었다.
- 같은 신호가 3초 이상 계속 오면 진행 중인 출력까지 취소·재시작해 음성이 끝나지 못할 수 있었다.

Expo Go 개발 모드의 require 음원은 Metro HTTP 주소로 해석될 수 있다. SeeQ-WiFi로 전환한 뒤 PC에 접근하지 못하는 상황은 가능한 실패 원인이다. 실제 iPhone의 과거 실패 원인을 기존 로그 없이 확정할 수는 없다. 새 수신/오디오 상태 로그로 정확한 프레임과 네이티브 오류를 확인해야 한다. 볼륨/Bluetooth/Expo Go 네이티브 버전 문제까지 자동 테스트로 검증한 것은 아니다.

## 유지한 테스트 정책

| 신호 | 경고음 | 경고음 후 기존 테스트 멘트 |
| --- | --- | --- |
| LEVEL1 | hazard-level1.wav의 기존 바이트 그대로 | 전방 위험물 접근중! 즉시 정지하세요. |
| LEVEL2 | hazard-short.wav의 기존 바이트 그대로 | 전방에 장애물이 있습니다. |
| CROSSWALK | hazard-short.wav의 기존 바이트 그대로 | 전방에 횡단보도. 빨간불입니다. |
| GO | 기존과 동일하게 경고음 없음 | 초록불이 감지되었습니다. |

LEVEL3를 추가하지 않았다. 음원의 길이·파형·파일 안의 반복 횟수는 바꾸지 않았다. 테스트 음성의 '테스트.' 접두어도 유지한다. 실제 감지 음성도 같은 정책 멘트를 사용하고, 서버가 보낸 message 원문은 화면/수신 로그에 남긴다. 진동 패턴과 레벨 우선순위, 기본 유지 시간은 그대로다.

## 구현

- hooks/use-hazard-alerts.native.ts: Expo Go/iOS/Android가 선택하는 새 전용 훅. 기존 use-hazard-alerts.ts는 웹에 그대로 남겨 두었다. 실제 소켓과 테스트 버튼 모두 이 네이티브 훅의 receive/output과 동일한 runHazardOutput을 사용한다.
- lib/hazard-alert-policy.ts: 기존 테스트의 네 가지 멘트/음원 매핑.
- lib/hazard-output-sequence.ts: 이전 TTS 정지 -> 경고음 완료 대기 -> TTS. 취소된 경고의 TTS는 실행하지 않는다. 경고음 오류는 들리는 경고음을 정지한 후 기존 멘트 TTS로 대체한다. iOS 세션은 TTS가 끝날 때까지 유지하고 이후 플레이어를 해제한다.
- lib/hazard-tone-player.ts: isLoaded 확인 후 한 번만 play. muted=false, volume=1, loop=false. 실제 didJustFinish를 받아야 정상 완료한다. 5초 타임아웃은 성공 완료로 취급하지 않고 오류로 기록한다.
- lib/hazard-sounds.native.ts 및 assets/sounds/hazard-tones.json: 현재 두 WAV의 정확한 바이트를 JS 번들에 포함하고 캐시의 file:// 파일로 쓴다. 네트워크나 Metro 음원 다운로드에 의존하지 않는다. 원래 WAV 파일은 수정하지 않았고 SHA256/바이트 일치를 테스트했다. expo-file-system은 현재 설치한 Expo의 기존 의존성으로 사용하며 SDK나 패키지 버전을 변경하지 않았다.
- lib/hazard-protocol.ts: 네이티브 훅에서만 사용하는 outputBusy 선택 인자 추가. 출력 중 같은 신호는 상태 갱신만 하고, 높은 위험도는 기존 순위대로 선점한다. 네이티브 중복 판정은 기존 테스트 멘트를 기준으로 해 JSON 설명의 작은 변화가 쿨다운을 우회하지 않는다. 웹 호출은 기본값 false로 종전 동작을 유지한다. 파서의 수신 형식/유효시간 검사는 변경하지 않았다.
- lib/hazard-socket-core.ts: 선택적 onFrame 진단 콜백만 추가. 메시지 파싱과 송신 조건은 변경하지 않았다.

iOS 오디오 설정은 playsInSilentMode=true, duckOthers, background=false를 유지한다. 레벨별 경고음/TTS는 동시에 출력하지 않는다. 더 높은 위험도가 오면 이전 경고음 또는 TTS를 중단한 뒤 새 순서를 시작한다. 오류는 소켓 오류와 별도 상태로 보관해 다음 정상 프레임이 지우지 못하게 했다.

## 검증

- 실제 네이티브 훅 + 실제 소켓 수신 코어에 가상 WebSocket/오디오 상태를 주입한 20개 검사 통과. 각 이벤트의 실제/테스트 경로, 로딩 대기, 종료 전 TTS 금지, 오류 후 정리/TTS, 음원 바이트 일치, iOS 세션 실패, 연속/변형 프레임, 높은 위험도의 음성·경고음 선점, 연결 해제, 종료 이벤트 누락, LEVEL3 거부를 확인했다.
- 기존 지도·웹·계정 세션·음성·경고·플랫폼 검사 37개 통과.
- 전체 TypeScript 및 이번 변경 파일 ESLint 통과.
- iOS/Android 디버그용 JS export 성공. 두 플랫폼 번들에 네이티브 훅/순서 제어가 실제 포함되는지 확인했다. 이 검사는 실제 스피커에서 소리를 들은 검사나 네이티브 앱 설치 빌드가 아니다.
- Firebase 코드/규칙, 지도 화면, 기존 웹 훅/웹 경고음, 앱 설정/잠금 파일, 두 원본 WAV의 해시가 백업과 동일하다.

```powershell
cd C:\SeeQ-App
node --test tests/native-hazard-audio.test.cjs
npx tsc --noEmit --incremental false
```

## iPhone Expo Go에서 재현

1. 기존 Expo 터미널을 Ctrl+C로 종료한다. 새 .native.ts 선택이 적용되도록 캐시를 비워 다시 시작한다.

```powershell
cd C:\SeeQ-App
npx expo start --clear
```

2. iPhone에서 Expo Go를 완전히 다시 열어 QR로 접속한다. 미디어 음량과 Bluetooth 출력 대상을 확인한다. 콘솔에서 `[SeeQ hazard audio]`의 cache-ready를 확인한다. 네이티브 코드를 추가한 작업이 아니므로 별도의 앱 설치 빌드는 하지 않는다.
3. 주변 인식 연결 화면의 기존 테스트 버튼 네 가지를 하나씩 누른다. LEVEL1/LEVEL2/CROSSWALK는 기존 경고음이 끝난 후 테스트 멘트, GO는 기존처럼 음성만 나와야 한다.
4. 앱이 완전히 열린 상태에서 SeeQ-WiFi에 연결하고 기존 서버 주소로 실제 탐지를 실행한다. PC도 같은 Wi-Fi에 연결되어 있으면 Metro 콘솔 수신 로그 확인이 쉽다. PC가 보이지 않는 Wi-Fi로 바꿔도 새 경고음은 HTTP가 아니라 로컬 파일로 재생한다. 개발 JS 번들을 새로 받아야 하는 앱 재시작/Reload는 별도의 네트워크 연결이 필요할 수 있다.
5. 실제 수신 시 아래 핵심 순서와 `tone-source`의 localFile=true를 확인한다. player-playing은 기기의 상태 이벤트 간격에 따라 생략될 수 있지만 player-ended 없이 정상 tone-finished/speech-start로 넘어가면 안 된다.

```text
[SeeQ hazard receive] raw: {실제 라즈베리파이 JSON}
tone-source (localFile: true)
player-loaded
player-play-requested
player-ended
tone-finished
speech-start
speech-finished
```

실제 프레임 원문 로그는 신호 종류가 바뀌거나 같은 종류가 5초 이상 지속될 때 샘플링한다. 모든 알림 처리 순서 로그에는 runId/event/isTest/platform/elapsedMs가 있어 이전 경고와 구분할 수 있다. 오디오 오류는 경고 설정 화면에도 남는다.

6. 같은 물체를 계속 비춰도 진행 중인 출력이 매 프레임 중첩되지 않는지, 낮은 위험도 안내 도중 LEVEL1이 오면 이전 출력이 멈추고 LEVEL1 경고음부터 시작하는지 확인한다.
7. 여전히 음성만 나오면 `[SeeQ hazard receive]`의 실제 JSON 한 줄과 `[SeeQ hazard audio]`의 tone-failed/output-failed reason, iPhone 기종·iOS/Expo Go 버전을 전달한다. 다른 계정 정보나 Firebase 키는 필요하지 않다. GO 프레임이라면 음성만 나오는 것이 기존 정책이다.

## 범위와 백업

웹은 아직 기존 재생 구현을 사용한다. 실제 iPhone에서 위 검증을 완료한 뒤 웹 활성화/완료 이벤트 처리는 별도 반영한다. 웹 코드를 수정하거나 EAS Hosting에 자동 배포하지 않았다.

백업: C:\Users\김유민\OneDrive\바탕 화면\my-app\backups\seeq-before-native-hazard-audio-20261101-132617
changed-files.json과 restore-web.ps1로 이번 수정 파일을 확인/복구할 수 있다. 원본 설정과 소스 전체의 백업도 보관한다.

API 참고: https://docs.expo.dev/versions/v58.0.0/sdk/audio/


추가 iOS 세션 유지와 연속 테스트 보완은 [IOS-HAZARD-TTS-SESSION.md](IOS-HAZARD-TTS-SESSION.md)를 확인한다.
