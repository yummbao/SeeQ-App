import { isHazardAudioActive } from '@/lib/speech-priority';
import { prepareHazardAudio, playWebHazardTone } from '@/lib/web-hazard-audio.web';
import { useState } from 'react';
import { Text, View, ScrollView } from 'react-native';
import { SpokenButton } from '@/components/spoken-button';
import { AppSpeech } from '@/lib/app-speech';
import MapView from '@/components/maps/seeq-map';
import { WEB_DEMO_ORIGIN } from '@/lib/web-demo-location';
import type { WebExperienceProps, WebLocationGateProps } from './web-experience';

const button = { backgroundColor: '#D2FF00', borderRadius: 10, paddingVertical: 11, paddingHorizontal: 14, marginTop: 10 };
export function WebExperienceBar({ backendError, isDemo, hasLocation, onRequestLocation, onHazardSettings }: WebExperienceProps) {
  const [expanded, setExpanded] = useState(false);
  const [notificationStatus, setNotificationStatus] = useState('');
  return (
    <View style={{ backgroundColor: '#182200', borderBottomWidth: 1, borderColor: '#506000', padding: 10, zIndex: 1 }}>
      <SpokenButton speechLabel="웹 기능 안내" onPress={() => setExpanded(value => !value)}>
        <Text style={{ color: '#D2FF00', fontWeight: '800', fontSize: 14 }}>SeeQ 웹 · {isDemo ? '체험 위치 사용 중' : hasLocation ? '브라우저 실제 위치' : '실제 위치 확인 대기'} · 기능 안내 {expanded ? '접기' : '열기'}</Text>
      </SpokenButton>
      <Text style={{ color: backendError ? '#FFCC80' : '#ddd', marginTop: 4 }}>{backendError || '전시 전용 Firebase · 실제 모바일 계정/데이터와 분리'}</Text>
      {expanded && (
        <ScrollView style={{ maxHeight: 250 }}>
          <Text style={{ color: '#fff', lineHeight: 22, marginTop: 8 }}>
            로그인·보호자 연결·위치 공유는 별도 전시용 Firebase 설정 후 실제로 사용할 수 있습니다. SOS는 전시용 보호자 화면으로 전달하며 구조기관에 신고하지 않습니다. 지도는 웹 지도이며 길찾기는 기존 TMAP 요청을 사용합니다.{"\n"}
            실제 위치는 HTTPS와 위치 권한이 필요합니다. 체험 위치는 서울시청 기준이며 이동 기록이나 보호자 위치로 전송하지 않습니다.{"\n"}
            음성·경고음은 브라우저가 소리 재생을 허용해야 합니다. 아래 음성 확인과 경고 테스트를 먼저 눌러 주세요.{"\n"}
            iPhone Safari 진동과 웹 나침반은 지원하지 않습니다. 지원 브라우저에서는 진동이 동작합니다.{"\n"}
            실제 위험 감지는 연결된 라즈베리파이가 필요합니다. HTTPS 웹사이트에서는 보안 연결인 wss:// 서버가 필요하며, 경고 테스트는 명확히 테스트로 표시합니다.{"\n"}
            브라우저를 닫거나 화면을 잠근 동안의 실시간 위치·위험 수신은 보장하지 않습니다. 웹 주소 표시는 좌표로 제공됩니다.
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <SpokenButton speechLabel="실제 위치 사용" onPress={onRequestLocation} style={button}><Text>실제 위치 사용</Text></SpokenButton>
            <SpokenButton speechLabel="소리 활성화" onPress={() => {
              if (isHazardAudioActive()) { setNotificationStatus('위험 안내가 끝난 뒤 소리를 확인해 주세요.'); return; }
              void prepareHazardAudio().then(() => { if (isHazardAudioActive()) return 'cancelled' as const; return playWebHazardTone(false); }).then(() => setNotificationStatus('경고음이 활성화되었습니다. 화면을 잠그거나 다른 앱으로 전환하면 다시 활성화해야 할 수 있습니다.')).catch(error => setNotificationStatus(String(error.message)));
            }} style={button}><Text>소리 활성화·경고음 확인</Text></SpokenButton>
            <SpokenButton speechLabel="음성 확인" onPress={() => AppSpeech.speak('SeeQ 웹 음성 안내입니다.')} style={button}><Text>음성 확인</Text></SpokenButton>
            <SpokenButton speechLabel="위험 감지 연결 및 테스트" onPress={onHazardSettings} style={button}><Text>위험 감지 연결·테스트</Text></SpokenButton>
            <SpokenButton speechLabel="브라우저 알림 권한" onPress={async () => {
              if (typeof Notification === 'undefined') { setNotificationStatus('이 브라우저는 별도 시스템 알림을 지원하지 않습니다. 앱 안의 경고는 표시됩니다.'); return; }
              try { const result = await Notification.requestPermission(); setNotificationStatus(result === 'granted' ? '브라우저 알림을 허용했습니다.' : '브라우저 알림이 허용되지 않았습니다. 앱 안의 경고는 표시됩니다.'); }
              catch { setNotificationStatus('시스템 알림 권한을 요청하지 못했습니다. 앱 안의 경고는 표시됩니다.'); }
            }} style={button}><Text>브라우저 알림 권한</Text></SpokenButton>
          </View>
          {!!notificationStatus && <Text style={{ color: 'white', marginTop: 8 }}>{notificationStatus}</Text>}
        </ScrollView>
      )}
    </View>
  );
}

export function WebLocationGate({ onDemo, onRetry, onMenu }: WebLocationGateProps) {
  return (
    <View style={{ flex: 1, minHeight: 450, backgroundColor: '#000' }}>
      <MapView style={{ flex: 1 }} initialRegion={{ ...WEB_DEMO_ORIGIN, latitudeDelta: 0.02, longitudeDelta: 0.02 }} />
      <View style={{ padding: 20, backgroundColor: '#111' }}>
        <Text style={{ color: 'white', fontSize: 21, fontWeight: '800' }}>SeeQ 웹 지도</Text>
        <Text style={{ color: '#bbb', fontSize: 15, lineHeight: 22, marginTop: 8 }}>현재 위치를 기다리고 있습니다. 위 지도는 서울 기준 기본 지도입니다. 위치를 허용하거나 체험 위치를 선택해 주세요.</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          <SpokenButton speechLabel="실제 위치 사용" onPress={onRetry} style={button}><Text>실제 위치 사용</Text></SpokenButton>
          <SpokenButton speechLabel="지도 체험하기" onPress={onDemo} style={button}><Text>지도 체험하기</Text></SpokenButton>
          <SpokenButton speechLabel="더보기" onPress={onMenu} style={button}><Text>더보기</Text></SpokenButton>
        </View>
        <Text style={{ color: '#aaa', marginTop: 8, fontSize: 13 }}>체험 위치는 실제 GPS가 아니며 보호자에게 공유하지 않습니다.</Text>
      </View>
    </View>
  );
}
