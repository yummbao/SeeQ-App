const fs = require('fs');
const ts = require('typescript');
const file = 'app/(tabs)/index.tsx';
let source = fs.readFileSync(file, 'utf8');
const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = {
  '더보기 메뉴를 엽니다.': '더보기',
  '목적지 검색을 닫고 지도로 돌아갑니다.': '뒤로가기',
  '음성으로 목적지를 검색합니다. 현재 음성 인식은 준비 중입니다.': '음성 검색',
  '입력한 검색어와 검색 결과를 지웁니다.': '검색어 지우기',
  '현재 길안내를 다시 읽어드립니다.': '길안내 다시 듣기',
  '현재 바라보는 방향을 확인합니다.': '현재 방향',
  '길안내를 종료하고 지도로 돌아갑니다.': '길안내 종료',
  '최근 목적지 목록을 닫고 지도로 돌아갑니다.': '뒤로가기',
  '현재 지도와 길안내 상태를 읽어드립니다.': '지도 안내',
  '목적지 검색 화면을 엽니다. 가고 싶은 장소나 주소를 입력해 주세요.': '목적지 검색',
  '즐겨찾기 장소 목록을 엽니다.': '즐겨찾기',
  '최근에 검색한 목적지 목록을 엽니다.': '최근 목적지',
  '현재 지도 화면입니다.': '지도',
  '길찾기를 위해 목적지 검색 화면을 엽니다.': '길찾기',
  '더보기 메뉴로 돌아갑니다.': '뒤로가기',
  '실시간 위치 화면을 닫고 더보기로 돌아갑니다.': '뒤로가기',
  '기록 메뉴를 닫고 더보기로 돌아갑니다.': '뒤로가기',
  '이동 기록 화면을 엽니다. 지도와 최근 이동 위치를 확인할 수 있습니다.': '이동 기록',
  '보호자 기록 화면을 엽니다. 현재 연결된 보호자 정보를 확인할 수 있습니다.': '보호자 기록',
  '보호자 기록을 닫고 기록 메뉴로 돌아갑니다.': '뒤로가기',
  '이동 기록을 닫고 기록 메뉴로 돌아갑니다.': '뒤로가기',
  '로그인 화면을 닫고 더보기로 돌아갑니다.': '뒤로가기',
  '사용자용 계정 로그인을 선택했습니다.': '사용자용',
  '보호자용 계정 로그인을 선택했습니다.': '보호자용',
  '입력한 이메일과 비밀번호로 로그인합니다.': '이메일 로그인',
  '회원가입 화면을 엽니다.': '회원가입',
  '입력한 이메일로 비밀번호 재설정 메일을 요청합니다.': '비밀번호 찾기',
  '회원가입 화면을 닫고 로그인으로 돌아갑니다.': '뒤로가기',
  '사용자용 계정 가입을 선택했습니다.': '사용자용',
  '보호자용 계정 가입을 선택했습니다.': '보호자용',
  '회원가입을 요청하고 이메일 인증 메일을 보냅니다.': '이메일 인증하고 가입하기',
  '설정을 닫고 더보기로 돌아갑니다.': '뒤로가기',
  '로그아웃을 요청합니다.': '로그아웃',
  '계정 로그인 화면을 엽니다.': '로그인',
  '새 관리 대상을 추가합니다. 사용자의 연결 코드를 입력해 주세요.': '새로운 대상 추가',
  '연결된 사용자의 실시간 위치 화면을 엽니다.': '실시간 위치',
  '수신한 긴급 도움 요청과 사용자 위치를 확인합니다.': '위험 알림',
  '설정 화면을 엽니다.': '설정',
  '긴급 상황 알림을 닫습니다.': '긴급 알림 닫기',
  '지도 화면으로 돌아갑니다.': '지도',
  '주변 인식 연결 화면을 엽니다. 서버 연결과 경고 테스트를 할 수 있습니다.': '주변 인식 연결',
  '새 보호자 연결 코드를 만듭니다.': '연결 코드 변경',
  '카메라 안내를 닫고 더보기로 돌아갑니다.': '뒤로가기',
  '영상 기록을 닫고 더보기로 돌아갑니다.': '뒤로가기',
  '현재 경고 알림을 닫습니다.': '경고 닫기',
};
function shortExpression(expr) {
  if (ts.isStringLiteral(expr)) {
    if (!(expr.text in names)) throw new Error('Unmapped label: '+expr.text);
    return JSON.stringify(names[expr.text]);
  }
  const text = expr.getText(ast);
  if(text.includes('isFavorite'))return "isFavorite ? '즐겨찾기 해제' : '즐겨찾기 추가'";
  if(text.includes('isRecognitionOn'))return "isRecognitionOn ? '주변 인식 끄기' : '주변 인식 켜기'";
  if(text.includes('place.name'))return text.includes('삭제') ? "'삭제'" : text.includes('도보 경로') ? "'길찾기'" : 'place.name';
  if(text.includes('target.name'))return text.includes('연결을 해제') ? "'연결 해제'" : '`${target.name} 위치`';
  if(text.includes('item.label'))return 'item.label';
  if(text.includes('item.title'))return 'item.title';
  if(text.includes('shareLocation'))return "shareLocation ? '위치 공유 끄기' : '위치 공유 켜기'";
  if(text.includes('emergencyStatus'))return "emergencyStatus ? '도움 요청 해제' : sosConfirmMode ? '도움 요청 전송' : '긴급 도움 요청'";
  if(text.includes('영상 기록'))return "'영상 기록'";
  if(text.includes('기록 메뉴'))return "'기록 보기'";
  if(text.includes('설정 화면'))return "'설정'";
  throw new Error('Unmapped expression: '+text);
}
const edits=[];
function visit(node) {
  if(ts.isJsxAttribute(node)&&node.name.text==='speechLabel') {
    const expr=node.initializer.expression;
    edits.push({start:node.initializer.getStart(ast),end:node.initializer.end,text:'{'+shortExpression(expr)+'}'});
  }
  ts.forEachChild(node,visit);
}
visit(ast);
for(const edit of edits.sort((a,b)=>b.start-a.start))source=source.slice(0,edit.start)+edit.text+source.slice(edit.end);
source=source.replace('handleVoice(`${target.name}의 위치 화면으로 이동합니다`)', 'handleVoice(`${target.name} 위치`)');
source=source.replace("handleVoice('영상 기록 화면으로 이동합니다')", "handleVoice('영상 기록')");
fs.writeFileSync(file,source);
console.log('Shortened '+edits.length+' button labels.');
