# index2.tsx 코드 위치표

원본은 `index2.tsx` 그대로 두고, 찾기 쉽게 구역 표시를 넣은 파일은 `index2.organized.tsx`입니다.
백업 파일은 `index2.backup.tsx`입니다.

## 큰 구역

- 1. 공통 스타일: `StyleSheet.create` 안에 전체 디자인 스타일
- 2. 길찾기 Props: `RouteViewProps`
- 3. 길찾기 화면: `RouteView`
  - 목적지 검색 화면
  - 검색 결과 리스트
  - 즐겨찾기 추가/삭제
  - 경로 지도 화면
  - 최근 기록 화면
- 4. 메인 앱: `SeeQFinalApp`
  - 전체 상태값
  - 알림 권한
  - 나침반
  - 위치 추적
  - Firebase 공유 상태
- 4-1. 음성 검색 준비 영역
- 4-2. 위치 주소 변환: `getAddress`
- 4-3. 목적지 검색: `searchPlace`
- 4-4. 도보 경로 요청: `getRoute`
- 4-5. 위치 추적 및 Firebase 실시간 연동
- 5. 동선 기록 / 보호자 위치 확인: `PathLogView`
- 6. 로그인 화면: `LoginView`
- 7. 홈 / 더보기 메뉴: `HomeView`
- 8. 위험 알림 테스트 로직
- 9. 화면 라우팅: `currentScreen`에 따라 보여주는 부분

## 다음 분리 추천 순서

1. `styles`를 `styles/seeqStyles.ts`로 이동
2. `firebaseConfig`, `db`, `TMAP_APP_KEY`를 `config`로 이동
3. 거리 계산, 방향 계산, 장소 정렬 함수를 `utils`로 이동
4. `RouteView`를 `screens/RouteScreen.tsx`로 이동
5. `LoginView`, `HomeView`, `PathLogView`를 각각 화면 파일로 이동
6. 카메라 준비 화면과 영상 기록 화면을 별도 화면 파일로 이동

## 꼭 고칠 안정성 포인트

- `RouteView`에서 위치 없음 return보다 아래에 Hook이 있어 React Hook 오류가 날 수 있음
- `Magnetometer.addListener`가 여러 번 있어 하나로 합치는 것이 좋음
- 경로 이탈/목적지 도착/안내 지점 음성이 여러 useEffect에서 중복될 수 있음
- `guidePoints[guidePoints.length - 1]` 사용 전에 빈 배열 체크 필요