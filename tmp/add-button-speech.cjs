const fs = require('fs');
const ts = require('typescript');
const file = 'app/(tabs)/index.tsx';
let source = fs.readFileSync(file, 'utf8');
const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const literal = text => JSON.stringify(text);
const labels = {
  432: literal('더보기 메뉴를 엽니다.'),
  737: literal('목적지 검색을 닫고 지도로 돌아갑니다.'),
  781: literal('음성으로 목적지를 검색합니다. 현재 음성 인식은 준비 중입니다.'),
  793: literal('입력한 검색어와 검색 결과를 지웁니다.'),
  827: '`즐겨찾기 ${place.name}까지 길찾기를 시작합니다.`',
  883: "isFavorite ? '이 장소를 즐겨찾기에서 제거합니다.' : '이 장소를 즐겨찾기에 추가합니다.'",
  922: '`장소 정보를 읽습니다. ${place.name}`',
  953: '`${place.name}까지 도보 경로를 찾습니다.`',
  1152: literal('현재 길안내를 다시 읽어드립니다.'),
  1182: literal('현재 바라보는 방향을 확인합니다.'),
  1227: literal('길안내를 종료하고 지도로 돌아갑니다.'),
  1259: "isRecognitionOn ? '주변 인식을 끕니다. 감지 알림 수신을 중지합니다.' : '주변 인식을 켭니다. 감지 서버에 연결합니다.'",
  1329: literal('최근 목적지 목록을 닫고 지도로 돌아갑니다.'),
  1361: '`최근 목적지 ${place.name}까지 길찾기를 시작합니다.`',
  1379: '`${place.name}을 최근 목적지에서 삭제합니다.`',
  1446: literal('현재 지도와 길안내 상태를 읽어드립니다.'),
  1472: literal('더보기 메뉴를 엽니다.'),
  1505: literal('목적지 검색 화면을 엽니다. 가고 싶은 장소나 주소를 입력해 주세요.'),
  1558: literal('즐겨찾기 장소 목록을 엽니다.'),
  1568: literal('최근에 검색한 목적지 목록을 엽니다.'),
  1587: literal('현재 지도 화면입니다.'),
  1597: literal('길찾기를 위해 목적지 검색 화면을 엽니다.'),
  1609: literal('더보기 메뉴를 엽니다.'),
  3547: literal('더보기 메뉴로 돌아갑니다.'),
  3571: literal('실시간 위치 화면을 닫고 더보기로 돌아갑니다.'),
  3634: literal('기록 메뉴를 닫고 더보기로 돌아갑니다.'),
  3642: literal('이동 기록 화면을 엽니다. 지도와 최근 이동 위치를 확인할 수 있습니다.'),
  3680: literal('보호자 기록 화면을 엽니다. 현재 연결된 보호자 정보를 확인할 수 있습니다.'),
  3729: literal('보호자 기록을 닫고 기록 메뉴로 돌아갑니다.'),
  3836: literal('이동 기록을 닫고 기록 메뉴로 돌아갑니다.'),
  3859: '`${item.label} 동안의 이동 기록을 표시합니다.`',
  4035: literal('로그인 화면을 닫고 더보기로 돌아갑니다.'),
  4055: literal('사용자용 계정 로그인을 선택했습니다.'),
  4061: literal('보호자용 계정 로그인을 선택했습니다.'),
  4137: literal('입력한 이메일과 비밀번호로 로그인합니다.'),
  4151: literal('회원가입 화면을 엽니다.'),
  4169: literal('입력한 이메일로 비밀번호 재설정 메일을 요청합니다.'),
  4279: literal('회원가입 화면을 닫고 로그인으로 돌아갑니다.'),
  4299: literal('사용자용 계정 가입을 선택했습니다.'),
  4305: literal('보호자용 계정 가입을 선택했습니다.'),
  4342: literal('회원가입을 요청하고 이메일 인증 메일을 보냅니다.'),
  4423: literal('설정을 닫고 더보기로 돌아갑니다.'),
  4444: '`${item.title} 항목을 엽니다.`',
  4481: literal('로그아웃을 요청합니다.'),
  4516: literal('계정 로그인 화면을 엽니다.'),
  4563: '`${target.name}의 위치 화면을 엽니다.`',
  4606: '`${target.name}과의 보호자 연결을 해제합니다.`',
  4674: literal('새 관리 대상을 추가합니다. 사용자의 연결 코드를 입력해 주세요.'),
  4696: literal('연결된 사용자의 실시간 위치 화면을 엽니다.'),
  4715: literal('수신한 긴급 도움 요청과 사용자 위치를 확인합니다.'),
  4749: "currentUser ? '영상 기록 화면을 엽니다.' : '영상 기록을 보려면 로그인해 주세요.'",
  4770: literal('설정 화면을 엽니다.'),
  4790: literal('로그아웃을 요청합니다.'),
  4814: literal('긴급 상황 알림을 닫습니다.'),
  4833: literal('지도 화면으로 돌아갑니다.'),
  4837: literal('계정 로그인 화면을 엽니다.'),
  4843: literal('주변 인식 연결 화면을 엽니다. 서버 연결과 경고 테스트를 할 수 있습니다.'),
  4857: "currentUser ? '영상 기록 화면을 엽니다.' : '영상 기록을 보려면 로그인해 주세요.'",
  4882: "!currentUser ? '위치 공유를 사용하려면 로그인해 주세요.' : shareLocation ? '보호자 위치 공유를 끕니다.' : '보호자 위치 공유를 켭니다.'",
  4941: "emergencyStatus ? '긴급 도움 요청을 해제합니다.' : sosConfirmMode ? '긴급 도움 요청을 전송합니다.' : '긴급 도움 요청 버튼입니다. 다시 누르면 전송됩니다.'",
  5046: "currentUser ? '기록 메뉴를 엽니다. 이동 기록과 보호자 정보를 확인할 수 있습니다.' : '기록을 보려면 로그인해 주세요.'",
  5067: "currentUser ? '설정 화면을 엽니다.' : '설정을 사용하려면 로그인해 주세요.'",
  5086: literal('로그아웃을 요청합니다.'),
  5136: literal('새 보호자 연결 코드를 만듭니다.'),
  5211: literal('카메라 안내를 닫고 더보기로 돌아갑니다.'),
  5295: literal('영상 기록을 닫고 더보기로 돌아갑니다.'),
  5336: literal('현재 경고 알림을 닫습니다.'),
};
const edits = [];
function visit(node) {
  if (ts.isJsxOpeningElement(node) && node.tagName.getText(ast) === 'TouchableOpacity') {
    const line = ast.getLineAndCharacterOfPosition(node.getStart()).line + 1;
    if (!labels[line]) throw new Error('Missing speech label at line '+line);
    edits.push({ at: node.tagName.end, text: '\n                  speechLabel={' + labels[line] + '}' });
  }
  ts.forEachChild(node, visit);
}
visit(ast);
for (const edit of edits.sort((a,b)=>b.at-a.at)) source = source.slice(0,edit.at)+edit.text+source.slice(edit.at);
source = source.replace("import * as ExpoSpeech from 'expo-speech';\n", '');
source = source.replace('  AccessibilityInfo,\n', '').replace('  TouchableOpacity,\n','');
const start = source.indexOf('// VoiceOver/TalkBack');
const end = source.indexOf('// ============================================================',start);
if(start<0 || end<0)throw new Error('Speech wrapper not found');
source = source.slice(0,start)+source.slice(end);
const effectStart = source.indexOf('  useEffect(() => {\n    const updateScreenReaderState');
const effectEnd = source.indexOf('  // 🔥 알림 권한 요청',effectStart);
if(effectStart<0||effectEnd<0)throw new Error('Screen reader listener not found');
source=source.slice(0,effectStart)+source.slice(effectEnd);
source=source.replace("import { isHazardAudioActive } from '@/lib/speech-priority';", "import { isHazardAudioActive } from '@/lib/speech-priority';\nimport { AppSpeech as Speech } from '@/lib/app-speech';\nimport { SpokenButton as TouchableOpacity } from '@/components/spoken-button';");
fs.writeFileSync(file,source);
console.log('Added explicit spoken descriptions to '+edits.length+' app buttons.');
