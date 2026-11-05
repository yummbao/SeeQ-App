# iOS 짧은 경고음 이후 TTS 누락 보완

장애물(LEVEL2)과 횡단보도(CROSSWALK)는 같은 hazard-short.wav를 사용한다. 경고음은 들리는데 뒤 TTS가 누락되는 현상을 보고받았다.

설치된 expo-audio의 iOS 구현(AudioModule.swift)을 확인하면 keepAudioSessionActive=false일 때 재생 종료와 pause 후 세션 해제를 예약한다. remove 역시 세션 유지 등록을 해제한다. 예약된 deactivateSession은 약 100ms 뒤 실행하며 ExpoSpeech의 TTS는 이 모듈의 '오디오 플레이어가 재생 중' 검사에 포함되지 않는다. 따라서 경고음 종료 직후 플레이어를 제거하고 같은 앱 오디오 세션으로 TTS를 시작하면 TTS 도중 세션이 꺼질 수 있다. 실제 기기의 과거 로그 없이 단말 원인을 단정하지는 않는다.

수정:

- iOS 경고음 플레이어에 keepAudioSessionActive=true 지정. Android는 기존 false 유지.
- 경고음 종료·실패 시 먼저 pause하여 들리는 경고음은 멈추되, 플레이어/세션 유지 등록은 TTS 종료·실패·취소까지 보관한다. TTS가 끝나면 remove한다. 그러므로 경고음과 TTS는 겹치지 않는다.
- 높은 실제 위험이나 화면 종료 시에는 기존 출력을 정지·해제하고 새 출력에 세션을 넘긴다.
- 명시적인 테스트 버튼 선택은 이전 테스트의 hold/중복 제한에 막히지 않고 새 테스트를 실행한다. 실제 경고가 진행 중일 때 테스트가 끼어들 수 없으며 실제 신호 간 우선순위는 유지한다.
- 기존 WAV 바이트·멘트·진동·GO 음성 전용 정책은 유지한다.

검증: 네이티브 훅 검사 24개 + JSON 진단/소켓/버튼 음성 검사 22개 = 46개 통과. 같은 화면에서 LEVEL1/LEVEL2/CROSSWALK/GO를 차례로 누르기, 짧은 경고음 도중 테스트 변경, 실제 위험의 테스트 차단, 재생 실패 뒤 TTS 중 세션 유지/음성 종료 후 해제를 포함한다. 전체 TypeScript 및 변경 파일 ESLint도 통과했다. 실제 iPhone 스피커에서 확인한 검사는 아니다.

```powershell
cd C:\SeeQ-App
npx expo start --go --clear
```

기존 서버를 Ctrl+C로 종료하고 Expo Go를 완전히 닫은 뒤 새 QR로 다시 연다. 주변 인식 연결 화면에서 위험물 테스트의 음성까지 끝난 뒤 장애물, 횡단보도를 차례로 누른다. 각각 기존 경고음 후 '테스트. 전방에 장애물이 있습니다.', '테스트. 전방에 횡단보도. 빨간불입니다.'가 나오는지 확인한다. GO는 기존처럼 음성만 나온다.

계속 음성이 빠지면 [SeeQ hazard audio]의 해당 event에 대해 player-ended/tone-finished/speech-start/speech-finished 또는 output-failed 로그를 확인한다. 실제 카메라 JSON 수신 거부 문제는 수신 진단 코드/원문을 별도로 확인해야 한다. 이 수정은 거부된 데이터를 강제로 허용하지 않는다.

Firebase·계정 연결·지도·웹 파일은 이번 수정에서 변경하지 않았다. 공개 배포하지 않았다. 백업: C:\Users\김유민\OneDrive\바탕 화면\my-app\backups\seeq-before-ios-speech-session-20261101-141546.