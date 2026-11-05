import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Keyboard, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SpokenButton as TouchableOpacity } from '@/components/spoken-button';
import { describeButton } from '@/lib/app-speech';
import type { HazardController } from '@/hooks/use-hazard-alerts';
import { HAZARD_LABEL, HAZARD_TYPES } from '@/lib/hazard-protocol';

export function HazardConnectionScreen({ controller, onBack }: { controller: HazardController; onBack: () => void }) {
  const [editedDraft, setDraft] = useState<string | null>(null);
  const draft = editedDraft ?? controller.endpoint;
  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity speechLabel="뒤로가기" accessibilityRole="button" accessibilityLabel="뒤로가기" onPress={onBack} style={styles.back}>
          <Ionicons name="chevron-back" color="#D2FF00" size={32} />
        </TouchableOpacity>
        <Text style={styles.title}>주변 인식 연결</Text>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.heading}>주변 인식</Text>
            <Switch accessibilityLabel="주변 인식" value={controller.enabled} onValueChange={enabled => {
              controller.setEnabled(enabled);
              describeButton(enabled ? '주변 인식 켜기' : '주변 인식 끄기');
            }} trackColor={{ true: '#637900', false: '#444' }} thumbColor="#D2FF00" />
          </View>
          <Text style={[styles.status, { color: controller.status === '연결됨' ? '#D2FF00' : '#ddd' }]} accessibilityLiveRegion="polite">
            {controller.status === '연결됨' ? '라즈베리파이 연결됨' : controller.status}
          </Text>
          <Text style={styles.description}>앱이 열린 동안 감지 알림을 받습니다. 휴대폰과 라즈베리파이를 같은 Wi-Fi에 연결해 주세요.</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.heading}>서버 주소</Text>
          <Text style={styles.description}>팀원에게 받은 WebSocket 주소와 포트를 입력해 주세요.</Text>
          <TextInput
            accessibilityLabel="웹소켓 서버 주소"
            value={draft} onChangeText={setDraft} placeholder="ws://192.168.0.20:5000" placeholderTextColor="#777"
            autoCapitalize="none" autoCorrect={false} keyboardType="url" returnKeyType="go" style={styles.input}
            onSubmitEditing={() => { Keyboard.dismiss(); controller.connect(draft); }}
          />
          <TouchableOpacity speechLabel="저장하고 연결" accessibilityRole="button" style={styles.primary} onPress={() => { Keyboard.dismiss(); controller.connect(draft); }}>
            <Text style={styles.primaryText}>저장하고 연결</Text>
          </TouchableOpacity>
          {!!controller.error && <Text selectable style={styles.error} accessibilityLiveRegion="polite">{controller.error}</Text>}
        </View>
        <View style={styles.card}>
          <Text style={styles.heading}>경고 테스트</Text>
          <Text style={styles.description}>서버 없이 소리·음성·진동을 확인합니다. 실제 감지 결과가 아니며 테스트 표시가 붙습니다.</Text>
          {HAZARD_TYPES.map(event => (
            <TouchableOpacity speechLabel={`${HAZARD_LABEL[event]} 테스트`} key={event} accessibilityRole="button" style={styles.test} onPress={() => controller.test(event)}>
              <Text style={styles.testText}>{HAZARD_LABEL[event]} 테스트</Text>
              <Ionicons name="volume-high-outline" color="white" size={22} />
            </TouchableOpacity>
          ))}
          <TouchableOpacity speechLabel="경고 닫기" accessibilityRole="button" style={styles.test} onPress={controller.dismiss}>
            <Text style={styles.testText}>현재 경고 닫기</Text>
            <Ionicons name="close" color="white" size={22} />
          </TouchableOpacity>
        </View>
        {controller.lastSignal && (
          <View style={styles.card}>
            <Text style={styles.heading}>{controller.lastSignal.isTest ? '최근 테스트' : '최근 수신 알림'}</Text>
            <Text style={styles.description}>{controller.lastSignal.message}</Text>
            <Text style={styles.description}>{new Date(controller.lastSignal.timestamp * 1000).toLocaleTimeString('ko-KR')}</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  header: { flexDirection: 'row', alignItems: 'center', paddingTop: 55, paddingHorizontal: 20, paddingBottom: 16 },
  back: { width: 48, height: 48, justifyContent: 'center' },
  title: { color: '#fff', fontSize: 22, fontWeight: '800' },
  content: { padding: 20, paddingBottom: 40 },
  card: { backgroundColor: '#151515', borderRadius: 20, padding: 20, marginBottom: 16 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  heading: { color: '#fff', fontSize: 20, fontWeight: '800' },
  status: { fontSize: 18, fontWeight: '700', marginTop: 14 },
  description: { color: '#bbb', fontSize: 15, lineHeight: 23, marginTop: 10 },
  input: { backgroundColor: '#222', borderWidth: 1, borderColor: '#444', borderRadius: 12, padding: 15, color: '#fff', fontSize: 17, marginTop: 16 },
  primary: { backgroundColor: '#D2FF00', padding: 17, borderRadius: 12, alignItems: 'center', marginTop: 12 },
  primaryText: { color: '#000', fontSize: 18, fontWeight: '800' },
  error: { color: '#FFB4B4', fontSize: 15, lineHeight: 23, marginTop: 12 },
  test: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#282828', borderRadius: 12, padding: 16, marginTop: 12 },
  testText: { color: '#fff', fontSize: 16, fontWeight: '700', flex: 1 },
});
