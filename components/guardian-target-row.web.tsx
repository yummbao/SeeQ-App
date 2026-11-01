import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { SpokenButton } from '@/components/spoken-button';

type Props = {
  target: { name: string; userId?: string; lastSeen?: string; status?: string };
  isLast: boolean;
  brandColor: string;
  onOpen: () => void;
  onDisconnect: () => void | Promise<void>;
};

export function GuardianTargetRow({ target, isLast, brandColor, onOpen, onDisconnect }: Props) {
  return (
    <View style={[styles.row, { marginBottom: isLast ? 12 : 10 }]}>
      <SpokenButton
        speechLabel={`${target.name} 위치`}
        accessibilityLabel={`${target.name} 위치`}
        style={styles.open}
        onPress={onOpen}
      >
        <View style={styles.avatar}>
          <Ionicons name="person" size={24} color={brandColor} />
        </View>
        <View style={styles.details}>
          <Text style={styles.name}>{target.name}</Text>
          <Text style={styles.lastSeen}>
            {target.userId
              ? `아이디 ${target.userId} · ${target.lastSeen || '아직 위치 확인 전'}`
              : target.lastSeen || '아직 위치 확인 전'}
          </Text>
        </View>
        <View style={styles.status}>
          <View style={[styles.light, { backgroundColor: brandColor }]} />
          <Text style={[styles.statusText, { color: brandColor }]}>{target.status || '안전'}</Text>
        </View>
      </SpokenButton>
      <SpokenButton
        speechLabel="연결 해제"
        accessibilityLabel={`${target.name} 연결 해제`}
        onPress={onDisconnect}
        style={styles.disconnect}
      >
        <Ionicons name="trash-outline" size={18} color="#FF6B6B" />
      </SpokenButton>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { backgroundColor: '#1A1A1A', borderRadius: 16, padding: 14, flexDirection: 'row', alignItems: 'center' },
  open: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#2A2A2A', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  details: { flex: 1, minWidth: 0 },
  name: { color: 'white', fontSize: 17, fontWeight: '900' },
  lastSeen: { color: '#aaa', fontSize: 12, marginTop: 4 },
  status: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 10 },
  light: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  statusText: { fontSize: 12, fontWeight: '900' },
  disconnect: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#252525', justifyContent: 'center', alignItems: 'center' },
});
