import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { Magnetometer } from 'expo-sensors';
import * as ExpoSpeech from 'expo-speech';
//import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from "expo-speech-recognition";
import { HazardConnectionScreen } from '@/components/hazard-connection-screen';
import { useHazardAlerts } from '@/hooks/use-hazard-alerts';
import { HAZARD_LABEL } from '@/lib/hazard-protocol';
import { isHazardAudioActive } from '@/lib/speech-priority';
import { getApps, initializeApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from 'firebase/auth';
import { get, getDatabase, onValue, ref, remove, set, update } from 'firebase/database';
import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Vibration,
  View
} from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';


Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});
// 🔥 Firebase 설정
const firebaseConfig = {
  apiKey: "AIzaSyAD7B0bkmHBiYsOG-FXGXstdoda9b6WTYA",
  authDomain: "seeq-a3251.firebaseapp.com",
  projectId: "seeq-a3251",
  storageBucket: "seeq-a3251.firebasestorage.app",
  messagingSenderId: "190227872860",
  appId: "1:190227872860:web:b679c47b03995910dffa99",
  databaseURL: "https://seeq-a3251-default-rtdb.asia-southeast1.firebasedatabase.app/"
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const auth = getAuth(app);
const db = getDatabase(app);
const TMAP_APP_KEY = 'B4kEbjLGj99bPxMpMdfst5ZeOUsoIHLn6EtiN7mC';

const MOVE_RECORD_DISTANCE_METERS = 5;
const TURN_PRE_ALERT_DISTANCE_METERS = 30;
const TURN_NOW_DISTANCE_METERS = 8;
const ARRIVAL_DISTANCE_METERS = 10;
const OFF_ROUTE_DISTANCE_METERS = 20;
const OFF_ROUTE_CONFIRMATION_MS = 5000;
const MAX_RELIABLE_GPS_ACCURACY_METERS = 25;
const LOW_ACCURACY_NOTICE_COOLDOWN_MS = 30000;

// 검색 결과 없음과 티맵 서버의 인증/요청 실패를 구분한다.
const requestTmap = async (url: string, options: RequestInit) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const body = await response.text();
    let data: any;
    try {
      data = JSON.parse(body);
    } catch {
      throw new Error(`티맵 응답을 읽지 못했습니다. (HTTP ${response.status})`);
    }
    if (!response.ok || data?.error) {
      const message = data?.error?.message || data?.error?.msg || data?.message;
      throw new Error(
        `티맵 요청 실패 (HTTP ${response.status})${message ? `: ${message}` : ''}`
      );
    }
    return data;
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new Error('티맵 응답 시간이 초과되었습니다. 네트워크를 확인하고 다시 시도해 주세요.');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

// VoiceOver/TalkBack이 켜진 상태에서는 expo-speech로 같은 문구를 한 번 더
// 재생하지 않는다. 접근성 시스템에 안내를 맡겨 중복 음성을 막는다.
let isScreenReaderEnabled = false;

const Speech = {
  ...ExpoSpeech,
  stop: () => {
    if (isHazardAudioActive()) return;
    if (!isScreenReaderEnabled) {
      return ExpoSpeech.stop();
    }
  },
  speak: (
    message: string,
    options?: Parameters<typeof ExpoSpeech.speak>[1]
  ) => {
    if (isHazardAudioActive()) return;
    if (isScreenReaderEnabled) {
      AccessibilityInfo.announceForAccessibility(message);
      return;
    }

    ExpoSpeech.speak(message, options);
  },
};

// ============================================================
// 1. 공통 스타일
// ============================================================
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  inner: { flex: 1, justifyContent: 'center', paddingHorizontal: 25 },
  logoContainer: { alignItems: 'center', marginBottom: 40 },
  logoText: { color: 'white', fontSize: 68, fontWeight: '900' },
  logoTextSmall: { color: 'white', fontSize: 32, fontWeight: '900' },
  subText: { color: '#888', fontSize: 18, fontWeight: '600', marginTop: 5 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 25, paddingTop: 60, paddingBottom: 15 },
  headerTitle: { color: 'white', fontSize: 20, fontWeight: '800' },
  scrollContent: { paddingHorizontal: 20, paddingTop: 10 },
  typeSelector: { flexDirection: 'row', backgroundColor: '#111', borderRadius: 20, padding: 6, marginBottom: 25 },
  typeButton: { flex: 1, height: 55, justifyContent: 'center', alignItems: 'center', borderRadius: 15 },
  typeButtonText: { color: '#666', fontSize: 18, fontWeight: '700' },
  inputContainer: { marginBottom: 15 },
  inputWrapper: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#111', borderRadius: 20, marginBottom: 15, paddingHorizontal: 20, height: 75 },
  input: { flex: 1, color: 'white', fontSize: 20, marginLeft: 15 },
  loginHelperContainer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginBottom: 30 },
  helperText: { color: '#666', fontSize: 15, fontWeight: '500' },
  helperDivider: { color: '#222', marginHorizontal: 20 },
  loginButton: { height: 75, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  loginButtonText: { color: 'black', fontSize: 24, fontWeight: '800' },
  mainCard: { borderRadius: 35, height: 220, justifyContent: 'center', alignItems: 'center', marginBottom: 20 },
  mainCardTitle: { color: 'black', fontSize: 28, fontWeight: 'bold', marginTop: 10 },
  grid: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 },
  subCard: { backgroundColor: '#111', width: '48%', height: 160, borderRadius: 28, justifyContent: 'center', alignItems: 'center' },
  subCardTitle: { color: 'white', fontSize: 20, fontWeight: 'bold', marginTop: 8 },
  emergencyButton: { backgroundColor: '#FF3B30', flexDirection: 'row', height: 85, borderRadius: 25, justifyContent: 'center', alignItems: 'center' },
  emergencyText: { color: 'white', fontSize: 22, fontWeight: 'bold', marginLeft: 10 },
  emergencyBanner: { backgroundColor: '#FF3B30', padding: 15, paddingTop: 50, alignItems: 'center' },
  emergencyBannerText: { color: 'white', fontWeight: 'bold' },
  mapSection: { height: '60%' },
  userMarker: { padding: 10, borderRadius: 25, borderWidth: 3, borderColor: 'black' },
  logSection: { flex: 1, backgroundColor: '#050505', borderTopLeftRadius: 30, borderTopRightRadius: 30, padding: 25, marginTop: -25 },
  logTitle: { fontSize: 20, fontWeight: 'bold', marginBottom: 15 },
  logItem: { paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: '#111' },
  logTextItem: { color: '#555', fontSize: 15 },
  locationShareButton: {
  width: '100%',
  minHeight: 82,
  backgroundColor: '#1A1A1A',
  borderRadius: 22,
  paddingVertical: 18,
  paddingHorizontal: 20,
  marginTop: 12,
  marginBottom: 8,
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  borderWidth: 1,
  borderColor: '#333',
},

locationShareButtonOn: {
  borderColor: '#D2FF00',
  backgroundColor: '#202600',
},

locationShareLeft: {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 14,
  flex: 1,
},

locationShareTitle: {
  color: '#FFFFFF',
  fontSize: 17,
  fontWeight: '800',
},

locationShareDesc: {
  color: '#AAAAAA',
  fontSize: 12,
  marginTop: 5,
},

shareStatusLight: {
  width: 14,
  height: 14,
  borderRadius: 7,
  backgroundColor: '#555',
  marginLeft: 12,
},

shareStatusLightOn: {
  backgroundColor: '#D2FF00',
},
  hazardOverlay: {
    position: 'absolute',
    top: 50,
    left: 15,
    right: 15,
    backgroundColor: '#D2FF00',
    zIndex: 9999,
    borderRadius: 15,
    paddingVertical: 15,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 8,
  },
  hazardText: {
    color: 'black',
    fontSize: 16,
    fontWeight: '700',
    marginLeft: 12,
    flex: 1,
  },
  fullCard: {
  backgroundColor: '#111',
  width: '100%',
  height: 100,
  borderRadius: 28,
  justifyContent: 'center',
  alignItems: 'center',
  marginBottom: 20,
},

emergencySubText: {
  color: 'white',
  fontSize: 13,
  fontWeight: '500',
  marginLeft: 10,
  marginTop: 4,
},
});

// ============================================================
// 2. 길찾기 화면 Props
// ============================================================
type RouteViewProps = {
  isRecognitionOn: boolean;
  setIsRecognitionOn: (enabled: boolean) => void;
  recognitionStatus: string;
  routeCoords: any[];
  myLocation: any;
  themeColor: string;
  heading: number;
  userAddress: string;
  destination: string;
  setDestination: (text: string) => void;
  setCurrentScreen: (screen: string) => void;
  getRoute: (
    startLat: number,
    startLon: number,
    endLat: number,
    endLon: number
  ) => Promise<any>;
  searchPlace: (keyword: string, page?: number) => Promise<any>;
  setRouteCoords: React.Dispatch<React.SetStateAction<any[]>>;
  setGuidePoints: React.Dispatch<React.SetStateAction<any[]>>;
  setCurrentGuideIndex: React.Dispatch<React.SetStateAction<number>>;
  guidePoints: any[];
  currentGuideIndex: number;
  searchResults: any[];
  setSearchResults: React.Dispatch<React.SetStateAction<any[]>>;
  searchPage: number;
  setSearchPage: React.Dispatch<React.SetStateAction<number>>;
  hasMoreResults: boolean;
  setHasMoreResults: React.Dispatch<React.SetStateAction<boolean>>;
  recentPlaces: any[];
  setRecentPlaces: React.Dispatch<React.SetStateAction<any[]>>;
  favorites: any[];
  setFavorites: React.Dispatch<React.SetStateAction<any[]>>;
  mapRef: React.RefObject<MapView | null>;
  isListening: boolean;
  startVoiceRecognition: () => void;
  destinationCoords: {
  latitude: number;
  longitude: number;
} | null;

setDestinationCoords: React.Dispatch<
  React.SetStateAction<{
    latitude: number;
    longitude: number;
  } | null>
>;
};


const getDistanceFromLatLonInMeters = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
) => {
  const R = 6371000;

  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
};

// ============================================================
// 3. 길찾기 화면: 검색 / 즐겨찾기 / 경로 지도 / 최근 기록
// ============================================================
function RouteView({
  isRecognitionOn,
  setIsRecognitionOn,
  recognitionStatus,
  routeCoords,
  myLocation,
  themeColor,
  heading,
  userAddress,
  destination,
  setDestination,
  setCurrentScreen,
  getRoute,
  searchPlace,
  setRouteCoords,
  setGuidePoints,
  setCurrentGuideIndex,
  guidePoints,
  currentGuideIndex,
  searchResults,
  setSearchResults,
  searchPage,
  setSearchPage,
  hasMoreResults,
  setHasMoreResults,
  recentPlaces,
  setRecentPlaces,
  favorites,
  setFavorites,
  mapRef,
isListening,
startVoiceRecognition,
destinationCoords,
setDestinationCoords,
}: RouteViewProps) {
  const displayCoords = myLocation?.coords;
  const [isSearchMode, setIsSearchMode] = useState(false);
  const [isRouteMapMode, setIsRouteMapMode] = useState(false);
  const [isRecentHistoryMode, setIsRecentHistoryMode] = useState(false);
  const [guideDistance, setGuideDistance] = useState(0);
  const formatDistance = (distance: number) => {
    if (distance < 1000) return `${Math.round(distance)}미터`;
    return `${(distance / 1000).toFixed(1)}킬로미터`;
  };
  useEffect(() => {
    if (!myLocation?.coords || !mapRef.current) return;

    mapRef.current.animateToRegion(
      {
        latitude: myLocation.coords.latitude,
        longitude: myLocation.coords.longitude,
        latitudeDelta: 0.005,
        longitudeDelta: 0.005,
      },
      500
    );
  }, [myLocation]);

  useEffect(() => {
  if (!myLocation?.coords) return;
  if (!guidePoints[currentGuideIndex]) return;

  const guide = guidePoints[currentGuideIndex];

  const distance = getDistanceFromLatLonInMeters(
    myLocation.coords.latitude,
    myLocation.coords.longitude,
    guide.latitude,
    guide.longitude
  );

  setGuideDistance(Math.round(distance));
}, [myLocation, guidePoints, currentGuideIndex]);

  if (!displayCoords) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center', padding: 28 }]}>
        <ActivityIndicator size="large" color={themeColor} />
        <Text style={{ color: 'white', fontSize: 22, marginTop: 20, textAlign: 'center' }}>
          현재 위치를 확인하고 있습니다
        </Text>
        <Text style={{ color: '#aaa', fontSize: 16, marginTop: 12, textAlign: 'center', lineHeight: 24 }}>
          지도를 표시하려면 위치 정보가 필요합니다. 휴대폰 설정에서 위치 서비스와 Expo Go의 위치 접근 권한을 확인해 주세요.
        </Text>
        <TouchableOpacity
          accessibilityRole="button"
          onPress={() => setCurrentScreen('home')}
          style={{ backgroundColor: themeColor, padding: 18, borderRadius: 14, marginTop: 24 }}
        >
          <Text style={{ color: '#000', fontSize: 18, fontWeight: '700' }}>더보기 열기</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const loadMorePlaces = async () => {
    if (!hasMoreResults || !destination.trim()) return;

    const nextPage = searchPage + 1;
    let newPlaces: any[];
    try {
      newPlaces = await searchPlace(destination, nextPage);
    } catch (error: any) {
      Alert.alert('검색 실패', error?.message || '네트워크 연결을 확인해 주세요.');
      return;
    }

    if (!newPlaces.length) {
      setHasMoreResults(false);
      return;
    }

    setSearchResults(prev => {
      const merged = [...prev, ...newPlaces];

      const unique = merged.filter(
        (item, index, self) =>
          index ===
          self.findIndex(
            x =>
              x.name === item.name &&
              x.latitude === item.latitude &&
              x.longitude === item.longitude
          )
      );

      return unique.sort((a: any, b: any) => a.distance - b.distance);
    });

    setSearchPage(nextPage);
  };

  const isAddressKeyword = (text: string) => {

    const keyword = text.replace(/\s/g, '');

    return (
      /\d/.test(keyword) ||
      keyword.includes('로') ||
      keyword.includes('길') ||
      keyword.includes('번길') ||
      keyword.includes('동') ||
      keyword.includes('가') ||
      keyword.includes('리') ||
      keyword.includes('읍') ||
      keyword.includes('면')
    );
  };
  const sortPlacesByRelevance = (places: any[], searchText: string) => {
  const searchKeyword = searchText.trim().replace(/\s/g, '');

  const getScore = (place: any) => {
    const name = (place.name || '').replace(/\s/g, '');
    const address = (place.fullAddress || '').replace(/\s/g, '');

    // 1. 이름이 검색어와 완전 일치
    if (name === searchKeyword) return 0;

    // 2. 이름이 검색어로 시작
    if (name.startsWith(searchKeyword)) return 1;

    // 3. 이름에 검색어 포함
    if (name.includes(searchKeyword)) return 2;

    // 4. 주소에 검색어 포함
    if (address.includes(searchKeyword)) return 3;

    // 5. 나머지
    return 10;
  };

  return places.sort((a, b) => {
    const scoreA = getScore(a);
    const scoreB = getScore(b);

    if (scoreA !== scoreB) {
      return scoreA - scoreB;
    }

    return a.distance - b.distance;
  });
};

const handleSearch = async () => {
  if (!destination.trim()) {
    Alert.alert('알림', '목적지를 입력하세요.');
    return;
  }

  Keyboard.dismiss();

  setRouteCoords([]);
  setGuidePoints([]);
  setCurrentGuideIndex(0);

  // ⭐ 1페이지만 말고 1~3페이지까지 먼저 가져오기
  let pages: any[][];
  try {
    pages = await Promise.all([
    searchPlace(destination, 1),
    searchPlace(destination, 2),
    searchPlace(destination, 3),
    ]);
  } catch (error: any) {
    setSearchResults([]);
    setHasMoreResults(false);
    Alert.alert('검색 요청 실패', error?.message || '네트워크 연결을 확인해 주세요.');
    return;
  }

  const merged = pages.flat();

  const unique = merged.filter(
    (item, index, self) =>
      index ===
      self.findIndex(
        x =>
          x.name === item.name &&
          x.latitude === item.latitude &&
          x.longitude === item.longitude
      )
  );

  const sorted = sortPlacesByRelevance(unique, destination);

  const isStationSearch =
  destination.includes('역') ||
  destination.includes('전철') ||
  destination.includes('지하철');

let finalResults = sorted;

if (isStationSearch) {
  const stationResults = sorted.filter((p: any) => {
    const name = p.name || '';

    return (
      name.includes('역') ||
      name.includes('호선') ||
      name.includes('출구')
    );
  });

  const others = sorted.filter((p: any) => {
    const name = p.name || '';

    return !(
      name.includes('역') ||
      name.includes('호선') ||
      name.includes('출구')
    );
  });

  finalResults = [...stationResults, ...others];
}

  if (!sorted.length) {
    Alert.alert('검색 실패', '목적지를 찾을 수 없습니다.');
    return;
  }

setSearchResults(finalResults);  setSearchPage(3);
  setHasMoreResults(sorted.length >= 60);
};

const startRouteToPlace = async (place: any) => {
  Speech.stop();

  const route = await getRoute(
    displayCoords.latitude,
    displayCoords.longitude,
    place.latitude,
    place.longitude
  );

  if (!route) return;
  if (!route?.features) {
    Alert.alert('경로 실패', '길찾기 결과가 없습니다.');
    return;
  }

  let totalDistance = 0;
  let totalTime = 0;

  route.features.forEach((f: any) => {
    if (f.properties?.distance) totalDistance += f.properties.distance;
    if (f.properties?.time) totalTime += f.properties.time;
  });

  const coords = route.features
    .filter((item: any) => item.geometry?.type === 'LineString')
    .flatMap((item: any) =>
      item.geometry.coordinates.map((coord: number[]) => ({
        latitude: coord[1],
        longitude: coord[0],
      }))
    );

  const points = route.features
    .filter(
      (item: any) =>
        item.geometry?.type === 'Point' &&
        item.properties?.description
    )
    .map((item: any) => ({
      latitude: item.geometry.coordinates[1],
      longitude: item.geometry.coordinates[0],
      description: item.properties.description,
    }));

setRouteCoords(coords);
setGuidePoints(points);
setCurrentGuideIndex(0);


  setDestinationCoords({
  latitude: place.latitude,
  longitude: place.longitude,
});

  setRecentPlaces(prev => {
    const updated = [
      place,
      ...prev.filter(
        p =>
          !(
            p.name === place.name &&
            p.latitude === place.latitude &&
            p.longitude === place.longitude
          )
      ),
    ];
    return updated.slice(0, 5);
  });

  const minutes = Math.round(totalTime / 60);
  const placeTitle = isAddressKeyword(destination)
    ? place.bldName || place.name || '목적지'
    : place.name;

  setIsSearchMode(false);
setIsRecentHistoryMode(false);
setIsRouteMapMode(true);

setTimeout(() => {

  Speech.stop();

  Speech.speak(
    `${placeTitle}까지 ${formatDistance(totalDistance)}, 도보 ${minutes}분입니다. 길안내를 시작합니다.`,
    { language: 'ko-KR' }
  );

}, 1500);

  if (coords.length > 0 && mapRef.current) {
    mapRef.current.fitToCoordinates(coords, {
      edgePadding: {
        top: 80,
        right: 50,
        bottom: 120,
        left: 50,
      },
      animated: true,
    });
  }
};

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <TouchableWithoutFeedback
  accessible={false}
  onPress={Keyboard.dismiss}
>
        <View style={styles.container}>
          {/* 검색 모드 */}
          {isSearchMode ? (
            <View style={{ flex: 1, paddingTop: 55 }}>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingHorizontal: 20,
                  marginBottom: 18,
                }}
              >
                <TouchableOpacity
                  onPress={() => {
                    setIsSearchMode(false);
                    setSearchResults([]);
                  }}
                  style={{ marginRight: 12 }}
                >
                  <Ionicons name="chevron-back" size={30} color="white" />
                </TouchableOpacity>

                <View
                  style={{
                    flex: 1,
                    height: 58,
                    backgroundColor: '#1A1A1A',
                    borderRadius: 30,
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingHorizontal: 18,
                  }}
                >
                  <Ionicons
                    name="search"
                    size={22}
                    color="#aaa"
                  />

                  <TextInput
                    style={{
                      flex: 1,
                      color: 'white',
                      fontSize: 22,
                      marginLeft: 12,
                    }}
                    placeholder="목적지 검색"
                    placeholderTextColor="#777"
                    value={destination}
                    onChangeText={setDestination}
                    autoFocus
                    returnKeyType="search"
                    onSubmitEditing={handleSearch}
                  />

                  {/* 🎤 음성 검색 */}
                  <TouchableOpacity
                    onPress={startVoiceRecognition}
                    style={{ marginRight: 10 }}
                  >
                    <Ionicons
                      name={isListening ? "mic" : "mic-outline"}
                      size={26}
                      color={isListening ? "#D2FF00" : "#aaa"}
                    />
                  </TouchableOpacity>

                  {/* ❌ 검색어 삭제 */}
                  <TouchableOpacity
                    onPress={() => {
                      setDestination('');
                      setSearchResults([]);
                    }}
                  >
                    <Ionicons
                      name="close-circle"
                      size={28}
                      color="#ddd"
                    />
                  </TouchableOpacity>
                </View>
              </View>
              {searchResults.length === 0 ? (
                <View style={{ flex: 1, paddingHorizontal: 20 }}>
                  <Text style={{ color: '#888', fontSize: 16, marginBottom: 14 }}>
                    검색어를 입력하면 결과가 아래에 표시됩니다.
                  </Text>

                  {favorites.length > 0 && (
                    <>
                      <Text
                        style={{
                          color: 'white',
                          fontSize: 18,
                          fontWeight: '700',
                          marginBottom: 10,
                        }}
                      >
                        ⭐ 즐겨찾기
                      </Text>

                      {favorites.slice(0, 5).map((place, index) => (
                        <TouchableOpacity
                          key={index}
                          onPress={() => startRouteToPlace(place)}
                          style={{
                            backgroundColor: '#111',
                            paddingVertical: 16,
                            paddingHorizontal: 16,
                            borderRadius: 14,
                            marginBottom: 10,
                          }}
                        >
                          <Text style={{ color: 'white', fontSize: 18, fontWeight: '700' }}>
                            {place.name}
                          </Text>
                          <Text style={{ color: '#aaa', marginTop: 4, fontSize: 14 }}>
                            {place.fullAddress || '주소 정보 없음'}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </>
                  )}
                </View>
              ) : (
                <FlatList
                  data={searchResults}
                  keyExtractor={(_, index) => index.toString()}
                  onEndReached={loadMorePlaces}
                  onEndReachedThreshold={0.5}
                  keyboardShouldPersistTaps="handled"
                  contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 30 }}
                  ListFooterComponent={
                    hasMoreResults ? (
                      <Text style={{ color: '#888', textAlign: 'center', paddingVertical: 12 }}>
                        더 불러오는 중...
                      </Text>
                    ) : null
                  }
                  renderItem={({ item: place, index }) => {
                    const isFavorite = favorites.some(
                      p =>
                        p.name === place.name &&
                        p.latitude === place.latitude &&
                        p.longitude === place.longitude
                    );

                    return (
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          paddingVertical: 18,
                          borderBottomWidth: 1,
                          borderBottomColor: '#222',
                        }}
                      >
                        {/* 왼쪽: 즐겨찾기 */}
                        <TouchableOpacity
                          onPress={() => {
                            if (isFavorite) {
                              setFavorites(prev =>
                                prev.filter(
                                  p =>
                                    !(
                                      p.name === place.name &&
                                      p.latitude === place.latitude &&
                                      p.longitude === place.longitude
                                    )
                                )
                              );
                              Speech.stop();
                              Speech.speak('즐겨찾기에서 제거되었습니다', { language: 'ko-KR' });
                            } else {
                              setFavorites(prev => [place, ...prev]);
                              Speech.stop();
                              Speech.speak('즐겨찾기에 추가되었습니다', { language: 'ko-KR' });
                            }
                          }}
                          style={{
                            width: 52,
                            height: 52,
                            borderRadius: 26,
                            backgroundColor: '#222',
                            justifyContent: 'center',
                            alignItems: 'center',
                            marginRight: 14,
                          }}
                        >
                          <Ionicons
                            name={isFavorite ? 'star' : 'star-outline'}
                            size={26}
                            color={isFavorite ? '#D2FF00' : '#bbb'}
                          />
                        </TouchableOpacity>

                        {/* 가운데: 누르면 음성 읽기 */}
                        <TouchableOpacity
                          style={{ flex: 1, paddingRight: 12 }}
                          onPress={() => {
                            Speech.stop();

                            const placeTitle = isAddressKeyword(destination)
                              ? place.bldName || place.name || '장소 정보'
                              : place.name;

                            Speech.speak(
                              `${index + 1}번, ${placeTitle}, ${formatDistance(place.distance)}`,
                              { language: 'ko-KR' }
                            );
                          }}
                        >
                          <Text style={{ color: 'white', fontSize: 20, fontWeight: '700' }}>
                            {isAddressKeyword(destination)
                              ? place.bldName || place.name || '장소 정보'
                              : place.name}
                          </Text>

                          <Text style={{ color: '#aaa', fontSize: 15, marginTop: 4 }}>
                            {place.fullAddress || '주소 정보 없음'}
                          </Text>

                          <Text style={{ color: '#888', fontSize: 14, marginTop: 4 }}>
                            {formatDistance(place.distance)}
                          </Text>
                        </TouchableOpacity>

                        {/* 오른쪽: 길찾기만 */}
                        <TouchableOpacity
                          style={{
                            backgroundColor: '#D2FF00',
                            borderRadius: 12,
                            paddingVertical: 12,
                            paddingHorizontal: 14,
                            justifyContent: 'center',
                            alignItems: 'center',
                          }}
                          onPress={async () => {
                            Speech.stop();

                            const route = await getRoute(
                              displayCoords.latitude,
                              displayCoords.longitude,
                              place.latitude,
                              place.longitude
                            );

                            if (!route) return;
                            if (!route?.features) {
                              Alert.alert('경로 실패', '길찾기 결과가 없습니다.');
                              return;
                            }

                            let totalDistance = 0;
                            let totalTime = 0;

                            route.features.forEach((f: any) => {
                              if (f.properties?.distance) totalDistance += f.properties.distance;
                              if (f.properties?.time) totalTime += f.properties.time;
                            });

                            const minutes = Math.round(totalTime / 60);

                            const coords = route.features
                              .filter((item: any) => item.geometry?.type === 'LineString')
                              .flatMap((item: any) =>
                                item.geometry.coordinates.map((coord: number[]) => ({
                                  latitude: coord[1],
                                  longitude: coord[0],
                                }))
                              );

                            setRouteCoords(coords);

                            const points = route.features
                              .filter(
                                (item: any) =>
                                  item.geometry?.type === 'Point' &&
                                  item.properties?.description
                              )
                              .map((item: any) => ({
                                latitude: item.geometry.coordinates[1],
                                longitude: item.geometry.coordinates[0],
                                description: item.properties.description,
                              }));

                            setGuidePoints(points);
                            setCurrentGuideIndex(0);
                            setDestinationCoords({
                              latitude: place.latitude,
                              longitude: place.longitude,
                            });

                            setRecentPlaces(prev => {
                              const updated = [
                                place,
                                ...prev.filter(
                                  p =>
                                    !(
                                      p.name === place.name &&
                                      p.latitude === place.latitude &&
                                      p.longitude === place.longitude
                                    )
                                ),
                              ];
                              return updated.slice(0, 5);
                            });

                            const placeTitle = isAddressKeyword(destination)
                              ? place.bldName || place.name || '목적지'
                              : place.name;

                            setIsSearchMode(false);
setIsRouteMapMode(true);

setTimeout(() => {

  if (coords.length > 0 && mapRef.current) {
    mapRef.current.fitToCoordinates(coords, {
      edgePadding: {
        top: 80,
        right: 50,
        bottom: 80,
        left: 50,
      },
      animated: true,
    });
  }

  Speech.stop();

  Speech.speak(
    `${placeTitle}까지 ${formatDistance(totalDistance)}, 도보 ${minutes}분입니다. 길안내를 시작합니다.`,
    { language: 'ko-KR' }
  );

}, 5000);                          }}
                        >
                          <Text style={{ color: 'black', fontWeight: '800', fontSize: 14 }}>
                            길찾기
                          </Text>
                        </TouchableOpacity>
                      </View>
                    );
                  }}
                />
              )}
            </View>
          ) : isRouteMapMode ? (
            <View style={{ flex: 1, backgroundColor: '#000' }}>
         

             <TouchableWithoutFeedback
  accessible={false}
  onPress={() => {
    Vibration.vibrate(300);
  }}
>
                <View style={{ flex: 1 }}>
                  <MapView
                    ref={mapRef}
                    style={{ flex: 1 }}
                    accessible={false}
                    accessibilityElementsHidden={true}
                    importantForAccessibility="no-hide-descendants"
                    showsUserLocation={true}
                    initialRegion={{
                      latitude: displayCoords.latitude,
                      longitude: displayCoords.longitude,
                      latitudeDelta: 0.08,
                      longitudeDelta: 0.08,
                    }}
                  >
                    {routeCoords.length > 0 && (
                      <Polyline
                        coordinates={routeCoords}
                        strokeWidth={6}
                        strokeColor="#3B82F6"
                      />
                    )}
                  </MapView>
                </View>
              </TouchableWithoutFeedback>
              <View
  accessible={false}
  accessibilityElementsHidden={true}
  importantForAccessibility="no-hide-descendants"
  style={{
    position: 'absolute',
                  top: 52,
                  left: 18,
                  right: 18,
                  backgroundColor: 'rgba(10,10,10,0.94)',
                  borderRadius: 22,
                  paddingVertical: 18,
                  paddingHorizontal: 18,
                  flexDirection: 'row',
                  alignItems: 'center',
                  borderWidth: 1,
                  borderColor: '#2A2A2A',
                }}
              >
                <Ionicons name="arrow-up" size={54} color="white" />
                <View style={{ flex: 1, marginLeft: 16 }}>
                  <Text style={{ color: 'white', fontSize: 34, fontWeight: '900' }}>
  {guidePoints[currentGuideIndex]
    ? `${guideDistance}m`
    : '안내 중'}
</Text>


                  <Text style={{ color: '#ddd', fontSize: 17, fontWeight: '700', marginTop: 2 }}>
                 
                    {guidePoints[currentGuideIndex]?.description ||
'목적지까지 경로가 표시됩니다'}
                  </Text>
                </View>
              </View>

              <View
                style={{
                  position: 'absolute',
                  right: 16,
                  top: 260,
                  gap: 12,
                }}
              >
                <TouchableOpacity
                  accessible={true}
                  accessibilityRole="button"
                  accessibilityLabel="길안내 다시 듣기"
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 24,
                    backgroundColor: '#050505',
                    justifyContent: 'center',
                    alignItems: 'center',
                  }}
                  onPress={() => {
                    setTimeout(() => {

  Speech.stop();

  Speech.speak(
    guidePoints[currentGuideIndex]?.description ||
    '길안내를 진행 중입니다',
    { language: 'ko-KR' }
  );

}, 1500);
                  }}
                >
                  <Ionicons name="volume-high" size={24} color="white" />
                </TouchableOpacity>

      
                <TouchableOpacity
  accessible={true}
  accessibilityRole="button"
  accessibilityLabel="현재 방향 확인"
 onPress={() => {

  setTimeout(() => {

    Speech.stop();

    const directions = [
      '북',
      '북동',
      '동',
      '남동',
      '남',
      '남서',
      '서',
      '북서',
    ];

    const direction =
      directions[Math.round(heading / 45) % 8];

    Speech.speak(
      `현재 ${direction} 방향입니다.`,
      { language: 'ko-KR' }
    );

  }, 1500);

}}
  style={{
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#050505',
    justifyContent: 'center',
    alignItems: 'center',
  }}
>
                  <Ionicons name="compass" size={24} color="#D2FF00" />
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="길안내 종료"
                style={{
                  position: 'absolute',
                  right: 20,
                  bottom: 124,
                  backgroundColor: '#A32626',
                  paddingVertical: 13,
                  paddingHorizontal: 24,
                  borderRadius: 18,
                  alignItems: 'center',
                }}
               onPress={() => {

  Speech.stop();

  setRouteCoords([]);
  setGuidePoints([]);
  setCurrentGuideIndex(0);

  setDestinationCoords(null);

  setIsRouteMapMode(false);
}}
              >
                <Text style={{ color: 'white', fontSize: 18, fontWeight: '900' }}>
                  종료
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel={isRecognitionOn ? '주변 인식 끄기' : '주변 인식 켜기'}
                accessibilityState={{ selected: isRecognitionOn }}
                onPress={() => {
                  setIsRecognitionOn(!isRecognitionOn);
                }}
                style={{
                  position: 'absolute',
                  left: 16,
                  right: 16,
                  bottom: 24,
                  backgroundColor: isRecognitionOn ? 'rgba(10,14,0,0.94)' : 'rgba(15,15,15,0.94)',
                  borderRadius: 22,
                  padding: 18,
                  borderWidth: 1,
                  borderColor: isRecognitionOn ? '#D2FF00' : '#333',
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                  <View
                    style={{
                      width: 52,
                      height: 52,
                      borderRadius: 26,
                      borderWidth: 2,
                      borderColor: isRecognitionOn ? '#D2FF00' : '#555',
                      justifyContent: 'center',
                      alignItems: 'center',
                      marginRight: 14,
                    }}
                  >
                    <Ionicons
                      name={isRecognitionOn ? 'radio-button-on' : 'radio-button-off'}
                      size={30}
                      color={isRecognitionOn ? '#D2FF00' : '#777'}
                    />
                  </View>
                  <View>
                    <Text style={{ color: 'white', fontSize: 19, fontWeight: '900' }}>
                      {isRecognitionOn ? '주변 인식 켜짐' : '주변 인식 꺼짐'}
                    </Text>
                    <Text style={{ color: '#aaa', fontSize: 13, marginTop: 4 }}>
                      {isRecognitionOn ? `서버 ${recognitionStatus}` : '누르면 주변 인식 수신 켜기'}
                    </Text>
                  </View>
                </View>
                <View
                  style={{
                    width: 46,
                    height: 28,
                    borderRadius: 14,
                    backgroundColor: isRecognitionOn ? '#D2FF00' : '#444',
                    alignItems: isRecognitionOn ? 'flex-end' : 'flex-start',
                    justifyContent: 'center',
                    paddingHorizontal: 4,
                  }}
                >
                  <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: 'white' }} />
                </View>
              </TouchableOpacity>

            </View>
              ) : isRecentHistoryMode ? (
              <View style={{ flex: 1, backgroundColor: '#000' }}>
                <View style={styles.header}>
                  <TouchableOpacity onPress={() => setIsRecentHistoryMode(false)}>
                    <Ionicons name="chevron-back" size={32} color={themeColor} />
                  </TouchableOpacity>
                  <Text style={styles.headerTitle}>최신 기록</Text>
                  <View style={{ width: 32 }} />
                </View>

                <View style={{ flex: 1, paddingHorizontal: 20, paddingTop: 10 }}>
                  {recentPlaces.length === 0 ? (
                    <View
                      style={{
                        backgroundColor: '#111',
                        borderRadius: 18,
                        padding: 18,
                      }}
                    >
                      <Text style={{ color: '#888', fontSize: 16 }}>
                        최근 기록이 없습니다.
                      </Text>
                    </View>
                  ) : (
                    <ScrollView showsVerticalScrollIndicator={false}>
                      {recentPlaces.map((place, index) => (
                        <View
                          key={index}
                          style={{
                            backgroundColor: '#111',
                            borderRadius: 18,
                            padding: 16,
                            marginBottom: 12,
                          }}
                        >
                          <TouchableOpacity
                            onPress={() => startRouteToPlace(place)}
                          >
                            <Text style={{ color: 'white', fontSize: 18, fontWeight: '700' }}>
                              {place.name}
                            </Text>
                            <Text style={{ color: '#aaa', fontSize: 14, marginTop: 4 }}>
                              {place.fullAddress || '주소 정보 없음'}
                            </Text>
                          </TouchableOpacity>

                          <View
                            style={{
                              flexDirection: 'row',
                              justifyContent: 'flex-end',
                              marginTop: 12,
                            }}
                          >
                            <TouchableOpacity
                              onPress={() => {
                                setRecentPlaces(prev =>
                                  prev.filter(
                                    p =>
                                      !(
                                        p.name === place.name &&
                                        p.latitude === place.latitude &&
                                        p.longitude === place.longitude
                                      )
                                  )
                                );
                                Speech.stop();
                                Speech.speak('최신 기록에서 삭제되었습니다', {
                                  language: 'ko-KR',
                                });
                              }}
                              style={{
                                backgroundColor: '#222',
                                paddingVertical: 10,
                                paddingHorizontal: 14,
                                borderRadius: 12,
                              }}
                            >
                              <Text style={{ color: 'white', fontWeight: '700' }}>삭제</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      ))}
                    </ScrollView>
                  )}
                </View>
              </View>
              ) : (
              /* 기본 화면 */
              <View style={{ flex: 1, backgroundColor: '#000' }}>
                <MapView
                  ref={mapRef}
                  style={StyleSheet.absoluteFill}
                  accessible={false}
                  accessibilityElementsHidden={true}
                  importantForAccessibility="no-hide-descendants"
                  showsUserLocation={true}
                  initialRegion={{
                    latitude: displayCoords.latitude,
                    longitude: displayCoords.longitude,
                    latitudeDelta: 0.006,
                    longitudeDelta: 0.006,
                  }}
                />

                <View
                  style={{
                    position: 'absolute',
                    top: 54,
                    left: 22,
                    right: 22,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <Text style={{ color: 'white', fontSize: 34, fontWeight: '900' }}>
                    See<Text style={{ color: '#D2FF00' }}>Q</Text>
                  </Text>

                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <TouchableOpacity
                      accessible={true}
                      accessibilityRole="button"
                      accessibilityLabel="현재 지도 안내 듣기"
                      onPress={() => {
                        const nextGuide = guidePoints[currentGuideIndex];
                        Speech.stop();
                        Speech.speak(
                          nextGuide
                            ? `다음 안내는 ${formatDistance(guideDistance)} 앞, ${nextGuide.description}`
                            : '현재 진행 중인 길안내가 없습니다. 목적지를 입력해 주세요.',
                          { language: 'ko-KR' }
                        );
                      }}
                      style={{
                        width: 48,
                        height: 48,
                        borderRadius: 24,
                        backgroundColor: '#111',
                        justifyContent: 'center',
                        alignItems: 'center',
                      }}
                    >
                      <Ionicons name="volume-high" size={24} color="white" />
                    </TouchableOpacity>

                    <TouchableOpacity
                      accessible={true}
                      accessibilityRole="button"
                      accessibilityLabel="더보기 메뉴 열기"
                      onPress={() => setCurrentScreen('home')}
                      style={{
                        width: 48,
                        height: 48,
                        borderRadius: 24,
                        backgroundColor: '#111',
                        justifyContent: 'center',
                        alignItems: 'center',
                      }}
                    >
                      <Ionicons name="menu" size={26} color="white" />
                    </TouchableOpacity>
                  </View>
                </View>

                <View
  accessible={false}
  importantForAccessibility="no"
  style={{
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
                    paddingHorizontal: 20,
                    paddingBottom: 26,
                    paddingTop: 16,
                    backgroundColor: 'rgba(0,0,0,0.58)',
                  }}
                >
                  <TouchableOpacity
  accessible={true}
  accessibilityRole="button"
  accessibilityLabel="목적지 검색"
  accessibilityHint="두 번 탭하여 목적지를 입력합니다"
  onPress={() => setIsSearchMode(true)}

                    style={{
                      backgroundColor: 'rgba(12,12,12,0.96)',
                      borderRadius: 28,
                      padding: 22,
                      borderWidth: 1,
                      borderColor: '#2A2A2A',
                      alignItems: 'center',
                    }}
                  >
                    <Text
  accessible={false}
  style={{ color: 'white', fontSize: 26, fontWeight: '900', marginBottom: 8 }}
>
  어디로 가시나요?
</Text>

<Text
  accessible={false}
  style={{ color: '#aaa', fontSize: 15, marginBottom: 18 }}
>
  말씀하시거나 검색해 주세요.
</Text>
                    <View
                      style={{
                        width: 78,
                        height: 78,
                        borderRadius: 39,
                        backgroundColor: '#D2FF00',
                        justifyContent: 'center',
                        alignItems: 'center',
                      }}
                    >
                      <Ionicons name="mic" size={38} color="black" />
                    </View>
                  </TouchableOpacity>

                  <View
                    style={{
                      flexDirection: 'row',
                      borderWidth: 1,
                      borderColor: '#333',
                      borderRadius: 18,
                      marginTop: 12,
                      overflow: 'hidden',
                    }}
                  >
                    <TouchableOpacity
                      accessible={true}
                      accessibilityRole="button"
                      accessibilityLabel="즐겨찾기 열기"
                      onPress={() => setIsSearchMode(true)}
                      style={{ flex: 1, paddingVertical: 15, alignItems: 'center' }}
                    >
                      <Text style={{ color: '#D2FF00', fontWeight: '800' }}>즐겨찾기</Text>
                    </TouchableOpacity>
                    <View style={{ width: 1, backgroundColor: '#333' }} />
                    <TouchableOpacity
                      accessible={true}
                      accessibilityRole="button"
                      accessibilityLabel="최근 목적지 열기"
                      onPress={() => setIsRecentHistoryMode(true)}
                      style={{ flex: 1, paddingVertical: 15, alignItems: 'center' }}
                    >
                      <Text style={{ color: 'white', fontWeight: '800' }}>최근 목적지</Text>
                    </TouchableOpacity>
                  </View>

                  <View
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'space-around',
                      alignItems: 'center',
                      paddingTop: 16,
                    }}
                  >
                    <TouchableOpacity
                      accessible={true}
                      accessibilityRole="button"
                      accessibilityLabel="지도 탭"
                      style={{ alignItems: 'center' }}
                    >
                      <Ionicons name="location" size={24} color="#D2FF00" />
                      <Text style={{ color: '#D2FF00', fontSize: 12, marginTop: 4, fontWeight: '800' }}>지도</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      accessible={true}
                      accessibilityRole="button"
                      accessibilityLabel="길찾기 탭"
                      onPress={() => setIsSearchMode(true)}
                      style={{ alignItems: 'center' }}
                    >
                      <Ionicons name="navigate" size={24} color="white" />
                      <Text style={{ color: 'white', fontSize: 12, marginTop: 4, fontWeight: '800' }}>
  길찾기
</Text>
</TouchableOpacity>
<TouchableOpacity
  accessible={true}
  accessibilityRole="button"
  accessibilityLabel="더보기 탭"
  onPress={() => setCurrentScreen('home')}
  style={{ alignItems: 'center' }}
>
  <Ionicons name="ellipsis-horizontal" size={26} color="white" />
  <Text
    style={{
      color: 'white',
      fontSize: 12,
      marginTop: 4,
      fontWeight: '800',
    }}
  >
    더보기
  </Text>
</TouchableOpacity>

</View>

</View>

</View>
                  )}
        </View>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
}
// ============================================================
// 4. 메인 앱: 전체 상태, 권한, 위치 추적, 화면 전환
// ============================================================
export default function SeeQFinalApp() {
  const [heading, setHeading] = useState(0);

  useEffect(() => {
    const updateScreenReaderState = (enabled: boolean) => {
      isScreenReaderEnabled = enabled;

      // 보조기술을 켠 순간 이미 재생 중인 앱 TTS도 멈춘다.
      if (enabled) {
        ExpoSpeech.stop();
      }
    };

    AccessibilityInfo.isScreenReaderEnabled().then(updateScreenReaderState);
    const subscription = AccessibilityInfo.addEventListener(
      'screenReaderChanged',
      updateScreenReaderState
    );

    return () => subscription.remove();
  }, []);

  // 🔥 알림 권한 요청
  useEffect(() => {
    const requestNotificationPermission = async () => {
      await Notifications.requestPermissionsAsync();
    };

    requestNotificationPermission();
  }, []);

  useEffect(() => {
    // 나침반 센서 값을 실시간으로 heading 변수에 저장합니다.
    const subscribe = Magnetometer.addListener(data => {
      let angle = Math.atan2(data.y, data.x) * (180 / Math.PI);

      if (angle < 0) angle += 360;

      setHeading(angle);
    });

    return () => subscribe.remove();
  }, []);
  const [currentScreen, setCurrentScreen] = useState('route');
  const [pathLogMode, setPathLogMode] = useState<'menu' | 'movement' | 'guardian'>('menu');
  const [userType, setUserType] = useState('user');
  const [currentUser, setCurrentUser] = useState<any>(auth.currentUser);
  const [myLocation, setMyLocation] = useState<any>(null); // 내 현재 위치
  const [targetLocation, setTargetLocation] = useState<any>(null); // (보호자용) 사용자 위치
  const [emergencyStatus, setEmergencyStatus] = useState(false);
  const [shareLocation, setShareLocation] = useState(false);
  const [myPairCode, setMyPairCode] = useState('');
  const [canGuardianViewLocation, setCanGuardianViewLocation] = useState(false);
  const [isUpdatingShare, setIsUpdatingShare] = useState(false);
  const [moveLogs, setMoveLogs] = useState<string[]>(["시스템 연결 대기 중..."]);
  const [userAddress, setUserAddress] = useState('');
  const [guardianAddress, setGuardianAddress] = useState('');
  const [routeCoords, setRouteCoords] = useState<any[]>([]);
  const [destination, setDestination] = useState('');
  const [guidePoints, setGuidePoints] = useState<any[]>([]);
  const [currentGuideIndex, setCurrentGuideIndex] = useState(0);
  const [destinationCoords, setDestinationCoords] = useState<{
  latitude: number;
  longitude: number;
} | null>(null);
  const [lastSpokenGuide, setLastSpokenGuide] = useState('');
  const [lastSpokenIndex, setLastSpokenIndex] = useState(-1);
  const [spokenStages, setSpokenStages] = useState<Record<number, number>>({});
  const [arrivalStage, setArrivalStage] = useState(0);
  const [hasStartedWalking, setHasStartedWalking] = useState(false);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchPage, setSearchPage] = useState(1);
  const [hasMoreResults, setHasMoreResults] = useState(true);
  const [recentPlaces, setRecentPlaces] = useState<any[]>([]);
  const [favorites, setFavorites] = useState<any[]>([]);
  const [guardianTargets, setGuardianTargets] = useState<any[]>([]);
  const [selectedGuardianTarget, setSelectedGuardianTarget] = useState<any>(null);
  const [pairedGuardianInfo, setPairedGuardianInfo] = useState<any>(null);
  const [movementHistory, setMovementHistory] = useState<any[]>([]);
  const [historyRange, setHistoryRange] = useState<'today' | '7days' | '30days'>('7days');
  const [moveStatus, setMoveStatus] = useState('정지 중');
  const [lastUpdateTime, setLastUpdateTime] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [recognizedText, setRecognizedText] = useState('');
  const [sosConfirmMode, setSosConfirmMode] = useState(false);
  const shownConnectionRequestIdsRef = useRef<Set<string>>(new Set());
  const isReroutingRef = useRef(false);
  const lastRerouteAtRef = useRef(0);
  const offRouteSinceRef = useRef<number | null>(null);
  const lastLowAccuracyNoticeAtRef = useRef(0);
  const hazardAlerts = useHazardAlerts({
    allowed: userType === 'user',
    onResumeGuidance: () => {
      const nextGuide = guidePoints[currentGuideIndex];
      if (userType !== 'user' || currentScreen !== 'route' || !destinationCoords || !nextGuide) return;
      Speech.speak(`길안내를 계속합니다. ${nextGuide.description}`, { language: 'ko-KR' });
    },
  });

  useEffect(() => {
    setArrivalStage(0);
    setSpokenStages({});
    offRouteSinceRef.current = null;
  }, [destinationCoords]);
 
  
  const getAuthErrorMessage = (error: any) => {
    switch (error?.code) {
      case 'auth/email-already-in-use':
        return '이미 가입된 이메일입니다. 로그인 화면에서 이메일 로그인을 이용해 주세요.';
      case 'auth/invalid-email':
        return '이메일 형식이 올바르지 않습니다.';
      case 'auth/weak-password':
        return '비밀번호는 6자리 이상으로 입력해 주세요.';
      case 'auth/user-not-found':
      case 'auth/invalid-credential':
      case 'auth/wrong-password':
        return '이메일 또는 비밀번호를 확인해 주세요.';
      case 'auth/network-request-failed':
        return '네트워크 연결을 확인한 뒤 다시 시도해 주세요.';
      case 'auth/too-many-requests':
        return '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.';
      default:
        return error?.message || '문제가 발생했습니다. 잠시 후 다시 시도해 주세요.';
    }
  };

  const generatePairCode = () =>
    Math.random().toString(36).replace(/[^a-z0-9]/gi, '').slice(0, 6).toUpperCase();

  const generateUniquePairCode = async () => {
    let nextCode = generatePairCode();

    for (let i = 0; i < 8; i += 1) {
      const codeSnapshot = await get(ref(db, `pairCodes/${nextCode}`));
      if (!codeSnapshot.exists()) return nextCode;
      nextCode = generatePairCode();
    }

    return Date.now().toString(36).slice(-6).toUpperCase();
  };

  const refreshMyPairCode = async () => {
    if (!currentUser || !isUser) return;

    try {
      const profileSnapshot = await get(ref(db, `profiles/${currentUser.uid}`));
      const userSnapshot = await get(ref(db, `users/${currentUser.uid}`));
      const profile = profileSnapshot.val() || {};
      const userData = userSnapshot.val() || {};
      const oldCode = String(profile.pairCode || userData.pairCode || myPairCode || '').toUpperCase();
      const nextCode = await generateUniquePairCode();
      const email = profile.email || userData.email || currentUser.email || '';
      const userId = profile.userId || userData.userId || '';
      const updates: Record<string, any> = {
        [`profiles/${currentUser.uid}/pairCode`]: nextCode,
        [`users/${currentUser.uid}/pairCode`]: nextCode,
        [`pairCodes/${nextCode}`]: currentUser.uid,
      };

      if (email) {
        updates[`usersByEmail/${getEmailKey(email)}/pairCode`] = nextCode;
      }

      if (userId) {
        updates[`usersById/${userId}/pairCode`] = nextCode;
      }

      await update(ref(db), updates);

      if (oldCode && oldCode !== nextCode) {
        remove(ref(db, `pairCodes/${oldCode}`)).catch(() => {
          console.log('이전 연결 코드 삭제 실패');
        });
      }

      setMyPairCode(nextCode);
      Speech.stop();
      Speech.speak(`새 연결 코드는 ${nextCode.split('').join(' ')} 입니다`, { language: 'ko-KR' });
      Alert.alert('연결 코드 변경 완료', `새 연결 코드: ${nextCode}`);
    } catch (error: any) {
      console.log('연결 코드 변경 실패', error);
      Alert.alert('변경 실패', '연결 코드를 새로 만들지 못했습니다. Firebase 권한을 확인해 주세요.');
    }
  };



  const handleEmailLogin = async () => {
    const emailText = emailRef.current.trim();
    const passwordText = passwordRef.current;

    if (!emailText || !passwordText.trim()) {
      Alert.alert('입력 필요', '이메일과 비밀번호를 입력해 주세요.');
      return;
    }

try {

  const credential =
    await signInWithEmailAndPassword(
      auth,
      emailText,
      passwordText
    );

  if (!credential.user.emailVerified) {

    Alert.alert(
      '이메일 인증 필요',
      '이메일 인증 후 로그인해주세요.'
    );

    await signOut(auth);

    return;
  }

  const uid = credential.user.uid;

  const profileSnapshot = await get(
    ref(db, `profiles/${uid}`)
  );

  const profile = profileSnapshot.val();

  if (!profile) {
    Alert.alert(
      '로그인 실패',
      '계정 정보를 찾을 수 없습니다.'
    );

    await signOut(auth);
    return;
  }

  if (profile.type !== userType) {
    Alert.alert(
      '계정 유형 불일치',
      profile.type === 'user'
        ? '이 계정은 사용자 계정입니다.'
        : '이 계정은 보호자 계정입니다.'
    );

    await signOut(auth);
    return;
  }

  await credential.user.reload();

  handleVoice('로그인되었습니다');

  setCurrentScreen(
    profile.type === 'user'
      ? 'route'
      : 'home'
  );

} catch (error: any) {
  console.log('이메일 로그인 실패', error);
  Alert.alert('로그인 실패', getAuthErrorMessage(error));
}
  };

  const getEmailKey = (email: string) =>
    email.trim().toLowerCase().replace(/[.#$[\]/]/g, '_');

  const saveSignupProfile = async (user: any, profile: any) => {
    const pairCode = profile.type === 'user' ? generatePairCode() : null;

    await set(ref(db, `profiles/${user.uid}`), {
      uid: user.uid,
      name: profile.name,
      userId: profile.userId,
      email: profile.email.toLowerCase(),
      type: profile.type,
      pairCode,
      pairedGuardian: null,
      pairedUser: null,
      createdAt: profile.createdAt,
      verifiedAt: new Date().toISOString(),
    });

    await set(ref(db, `usersByEmail/${getEmailKey(profile.email)}`), {
      uid: user.uid,
      name: profile.name,
      userId: profile.userId,
      type: profile.type,
    });

    await set(ref(db, `usersById/${profile.userId}`), {
      uid: user.uid,
      name: profile.name,
      email: profile.email.toLowerCase(),
      type: profile.type,
      pairCode,
    });

    if (pairCode) {
      await set(ref(db, `pairCodes/${pairCode}`), user.uid);
    }

    await set(ref(db, `users/${user.uid}`), {
      uid: user.uid,
      name: profile.name,
      userId: profile.userId,
      email: profile.email.toLowerCase(),
      type: profile.type,
      pairCode,
      pairedGuardian: null,
      pairedUser: null,
      shareLocation: false,
      emergency: false,
    });

    return pairCode;
  };

  const handleEmailSignup = async () => {
    const nameText = signupNameRef.current.trim();
    const idText = signupIdRef.current.trim();
    const emailText = signupEmailRef.current.trim();
    const passwordText = signupPasswordRef.current;
    const confirmPasswordText = signupPasswordConfirmRef.current;

    if (!nameText || !idText || !emailText || !passwordText.trim() || !confirmPasswordText.trim()) {
      Alert.alert('입력 필요', '이름, 아이디, 이메일, 비밀번호를 모두 입력해 주세요.');
      return;
    }

    if (passwordText.length < 6) {
      Alert.alert('비밀번호 확인', '비밀번호는 6자리 이상이어야 합니다.');
      return;
    }

    if (passwordText !== confirmPasswordText) {
      Alert.alert('비밀번호 확인', '비밀번호가 서로 다릅니다.');
      return;
    }

    try {
      const credential = await createUserWithEmailAndPassword(auth, emailText, passwordText);
      const user = credential.user;

await sendEmailVerification(user);

let createdPairCode = null;

      await updateProfile(user, {
        displayName: nameText,
      });

      try {
        createdPairCode = await saveSignupProfile(user, {
          name: nameText,
          userId: idText,
          email: emailText.toLowerCase(),
          type: userType,
          createdAt: new Date().toISOString(),
        });
        if (createdPairCode) setMyPairCode(createdPairCode);
      } catch (profileError) {
        console.log('프로필 DB 저장 실패', profileError);
      }

      Alert.alert(
  '인증 메일 발송',
  '입력한 이메일로 인증 메일을 보냈습니다. 이메일 인증 후 로그인해주세요.',
        [
          {
            text: '확인',
            onPress: () => setCurrentScreen('login'),
          },
        ]
      );
    } catch (error: any) {
      console.log('회원가입 실패', error);
      if (error?.code === 'auth/email-already-in-use') {
        Alert.alert(
          '이미 가입된 이메일',
          '이 이메일은 이미 가입되어 있습니다. 로그인 화면으로 이동할까요?',
          [
            { text: '취소', style: 'cancel' },
            { text: '로그인하기', onPress: () => setCurrentScreen('login') },
          ]
        );
        return;
      }

      Alert.alert('회원가입 실패', getAuthErrorMessage(error));
    }
  };

  const handleLogout = async () => {
  try {

    if (currentUser) {
      await set(
        ref(db, `users/${currentUser.uid}/status`),
        {
          emergency: false,
          timestamp: new Date().toISOString(),
        }
      );
    }

    await signOut(auth);

    setFavorites([]);
    setRecentPlaces([]);
    setPathLogMode('menu');
    setCurrentScreen('route');

    Speech.stop();
    Speech.speak('로그아웃되었습니다', {
      language: 'ko-KR',
    });

  } catch (error: any) {
    console.log('로그아웃 실패', error);
    Alert.alert(
      '로그아웃 실패',
      error?.message || '로그아웃 중 문제가 발생했습니다.'
    );
  }
};

  const requireLogin = (nextScreen: string) => {
    if (!currentUser) {
      Alert.alert('로그인 필요', '로그인 후 이용할 수 있습니다.');
      setCurrentScreen('login');
      return;
    }

    setCurrentScreen(nextScreen);
  };

  const addGuardianTarget = () => {
    if (!currentUser) {
      requireLogin('home');
      return;
    }

    Alert.prompt(
      '관리 대상 추가',
      '사용자 앱에 표시된 6자리 연결 코드를 입력하세요.',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '연결',
          onPress: async (code?: string) => {
            const inputCode = code?.trim().toUpperCase();

            if (!inputCode) {
              Alert.alert('입력 필요', '연결 코드를 입력해 주세요.');
              return;
            }
try {
  const normalizedCode = (inputCode || '').trim().toUpperCase();

  console.log('현재 로그인 uid', currentUser?.uid);
  console.log('입력코드', normalizedCode);
  console.log('조회경로', `pairCodes/${normalizedCode}`);

  const codeSnapshot = await get(
    ref(db, `pairCodes/${normalizedCode}`)
  );

  console.log('exists', codeSnapshot.exists());
  console.log('val', codeSnapshot.val());

  const targetUid = codeSnapshot.val();
  console.log('targetUid', targetUid);
              if (!targetUid) {
                Alert.alert('대상 없음', '입력한 연결 코드로 가입된 사용자를 찾을 수 없습니다.');
                return;
              }

              if (targetUid === currentUser.uid) {
                Alert.alert('확인 필요', '내 계정은 관리 대상으로 추가할 수 없습니다.');
                return;
              }

console.log('pending 저장 시작');
const requestedAt = new Date().toISOString();
const requestPayload = {
    guardianUid: currentUser.uid,
    guardianName:
      currentUser.displayName || '보호자',
    requestedAt,
    status: 'pending',
  };

await set(ref(db, `connectionRequests/${targetUid}/${currentUser.uid}`), requestPayload);

update(ref(db), {
  [`pendingRequests/${targetUid}/${currentUser.uid}`]: requestPayload,
  [`guardianSentRequests/${currentUser.uid}/${targetUid}`]: {
    targetUid,
    requestedAt,
    status: 'pending',
  },
}).catch((error) => {
  console.log('보조 연결 요청 기록 저장 실패', error);
});

console.log(
  '저장 경로',
  `pendingRequests/${targetUid}/${currentUser.uid}`
);


Alert.alert(
  '요청 전송',
  '사용자에게 연결 요청을 보냈습니다.'
);

return;


  
            } catch (error: any) {
  console.log('연결 요청 오류', error);

  Alert.alert(
    '관리 대상을 확인하지 못했습니다',
    String(error?.message || error)
  );
}
          },
        },
      ],
      'plain-text'
    );
  };


/*
  useSpeechRecognitionEvent("result", (event) => {
    const text = event.results[0]?.transcript || '';

    console.log("음성 결과:", text);

    setRecognizedText(text);

    setDestination(text);

    Speech.stop();
    Speech.speak(`${text} 검색합니다`, {
      language: 'ko-KR',
    });
  });

  useSpeechRecognitionEvent("end", () => {
    setIsListening(false);
  });
*/
  // ------------------------------------------------------------
  // 4-1. 음성 검색 준비 영역
  // ------------------------------------------------------------
  const startVoiceRecognition = async () => {
  Alert.alert('안내', '음성인식은 현재 비활성화 상태입니다.');
};


  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);

      if (!user) {
        setFavorites([]);
        setRecentPlaces([]);
        setGuardianTargets([]);
        setSelectedGuardianTarget(null);
        setPairedGuardianInfo(null);
        setMovementHistory([]);
        setMyPairCode('');
        shownConnectionRequestIdsRef.current.clear();
        return;
      }

      try {
        const savedFavorites = await AsyncStorage.getItem(`favorites:${user.uid}`);
        const savedRecentPlaces = await AsyncStorage.getItem(`recentPlaces:${user.uid}`);
        const savedGuardianTargets = await AsyncStorage.getItem(`guardianTargets:${user.uid}`);
        const savedMovementHistory = await AsyncStorage.getItem(`movementHistory:${user.uid}`);

        setFavorites(savedFavorites ? JSON.parse(savedFavorites) : []);
        setRecentPlaces(savedRecentPlaces ? JSON.parse(savedRecentPlaces) : []);
        setGuardianTargets(savedGuardianTargets ? JSON.parse(savedGuardianTargets) : []);
        setMovementHistory(savedMovementHistory ? JSON.parse(savedMovementHistory) : []);

    const profileSnapshot = await get(ref(db, `profiles/${user.uid}`));
const profile = profileSnapshot.val();

console.log('🔥 profile', profile);

        if (profile?.pairCode) {
          setMyPairCode(profile.pairCode);
        } else if (profile?.type === 'user') {
          const nextPairCode = generatePairCode();
          setMyPairCode(nextPairCode);
          update(ref(db), {
            [`profiles/${user.uid}/pairCode`]: nextPairCode,
            [`users/${user.uid}/pairCode`]: nextPairCode,
            [`usersById/${profile.userId}/pairCode`]: nextPairCode,
            [`pairCodes/${nextPairCode}`]: user.uid,
          }).catch(() => {
            console.log('연결 코드 저장 실패');
          });
        }
      } catch (e) {
        console.log('저장된 장소 불러오기 실패');
      }
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!selectedGuardianTarget && guardianTargets.length > 0) {
      setSelectedGuardianTarget(guardianTargets[0]);
    }
  }, [guardianTargets, selectedGuardianTarget]);

  useEffect(() => {
    if (!currentUser) return;

    AsyncStorage.setItem(
      `favorites:${currentUser.uid}`,
      JSON.stringify(favorites)
    );
  }, [favorites, currentUser]);

  useEffect(() => {
    if (!currentUser) return;

    AsyncStorage.setItem(
      `recentPlaces:${currentUser.uid}`,
      JSON.stringify(recentPlaces)
    );
  }, [recentPlaces, currentUser]);

  useEffect(() => {
    if (!currentUser) return;

    AsyncStorage.setItem(
      `guardianTargets:${currentUser.uid}`,
      JSON.stringify(guardianTargets)
    );
  }, [guardianTargets, currentUser]);

  useEffect(() => {
    if (!currentUser) return;

    AsyncStorage.setItem(
      `movementHistory:${currentUser.uid}`,
      JSON.stringify(movementHistory)
    );
  }, [movementHistory, currentUser]);
  const lastLoggedLocationRef = useRef<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const lastEmergencyStatusRef = useRef(false);
  const hasLoadedEmergencyStatusRef = useRef(false);
  const emailRef = useRef('');
  const passwordRef = useRef('');
  const signupNameRef = useRef('');
  const signupIdRef = useRef('');
  const signupEmailRef = useRef('');
  const signupPasswordRef = useRef('');
  const signupPasswordConfirmRef = useRef('');
  const mapRef = useRef<MapView | null>(null);

  const BRAND_COLOR = '#D2FF00';
  const getDirectionText = (heading: number) => {
    if (typeof heading !== 'number') return '방향 확인 중';
    const directions = ['북', '북동', '동', '남동', '남', '남서', '서', '북서'];
    const index = Math.round(heading / 45) % 8;
    return directions[index];
  };
  const isUser = userType === 'user';
  const themeColor = isUser ? BRAND_COLOR : '#FFFFFF';
  /*useEffect(() => {
    (async () => {
      const result =
        await ExpoSpeechRecognitionModule.requestPermissionsAsync();

      console.log('마이크 권한:', result);
    })();
  }, []);*/
  useEffect(() => {
    if (!isUser) {
      setCanGuardianViewLocation(false);
      setTargetLocation(null);
      setMoveLogs(["시스템 연결 대기 중..."]);
      setEmergencyStatus(false);
      lastEmergencyStatusRef.current = false;
      hasLoadedEmergencyStatusRef.current = false;
    }
  }, [userType]);
  // [추가] 나침반을 이용한 방향 감지 로직
 useEffect(() => {
  if (!isUser) return;
  if (!myLocation?.coords) return;
  if (!destinationCoords) return;
  if (isHazardAudioActive()) return;

  const distance = getDistanceFromLatLonInMeters(
    myLocation.coords.latitude,
    myLocation.coords.longitude,
    destinationCoords.latitude,
    destinationCoords.longitude
  );

  // GPS 오차를 고려해 도착은 10m 이내에서만 확정한다.
  // 가까운 도착 안내를 먼저 처리해 같은 위치에서 두 문구가 이어지지 않게 한다.
  if (distance <= ARRIVAL_DISTANCE_METERS && arrivalStage < 2) {

    Vibration.vibrate([0, 300, 150, 300]);

    Speech.stop();

    Speech.speak(
      "목적지에 도착했습니다.",
      { language: 'ko-KR' }
    );

    setArrivalStage(2);

setRouteCoords([]);
setGuidePoints([]);
setCurrentGuideIndex(0);

setDestinationCoords(null);

setSpokenStages({});
  } else if (distance <= 30 && arrivalStage < 1) {

    Speech.speak(
      "잠시 후 목적지에 도착합니다.",
      { language: 'ko-KR' }
    );

    setArrivalStage(1);
  }

}, [myLocation, destinationCoords, arrivalStage]);

  useEffect(() => {
    if (!isUser) return;
    if (!myLocation?.coords) return;
    if (guidePoints.length === 0) return;
    if (currentGuideIndex >= guidePoints.length) return;
    if (isHazardAudioActive()) return;

   const currentGuide = guidePoints[currentGuideIndex];
    const distance = getDistanceFromLatLonInMeters(
      myLocation.coords.latitude,
      myLocation.coords.longitude,
      currentGuide.latitude,
      currentGuide.longitude
    );



    const stage = spokenStages[currentGuideIndex] || 0;

    const guideText = currentGuide.description || '';

const isRight =
  guideText.includes('우회전') ||
  guideText.includes('2시 방향');

const isLeft =
  guideText.includes('좌회전') ||
  guideText.includes('10시 방향');

// 회전 약 30m 전 안내: 걷는 중에도 미리 방향을 준비할 수 있게 한다.
if (
  distance <= TURN_PRE_ALERT_DISTANCE_METERS &&
  distance > TURN_NOW_DISTANCE_METERS &&
  stage < 1
) {

  Vibration.vibrate(200);

  if (isRight) {
    Speech.speak(
      '30미터 앞에서 오른쪽으로 꺾으세요.',
      { language: 'ko-KR' }
    );
  } else if (isLeft) {
    Speech.speak(
      '30미터 앞에서 왼쪽으로 꺾으세요.',
      { language: 'ko-KR' }
    );
  } else if (guideText) {
    Speech.speak(`30미터 앞에서 ${guideText}`, { language: 'ko-KR' });
  }

  setSpokenStages(prev => ({
    ...prev,
    [currentGuideIndex]: 1,
  }));

  return;
}

// 회전 직전 안내: GPS 오차를 고려해 8m 이내에서 한 번만 안내한다.
if (distance <= TURN_NOW_DISTANCE_METERS && stage < 2) {

  Vibration.vibrate([0, 200, 100, 200]);

  if (isRight) {
    Speech.speak(
      '지금 오른쪽으로 꺾으세요.',
      { language: 'ko-KR' }
    );
  } else if (isLeft) {
    Speech.speak(
      '지금 왼쪽으로 꺾으세요.',
      { language: 'ko-KR' }
    );
  } else if (guideText) {
    Speech.speak(guideText, { language: 'ko-KR' });
  }

  setSpokenStages(prev => ({
    ...prev,
    [currentGuideIndex]: 2,
  }));

  setCurrentGuideIndex(prev => prev + 1);

  return;
}
  }, [myLocation, guidePoints, currentGuideIndex, isUser, spokenStages]);
  useEffect(() => {
    if (!isUser) return;
    if (!myLocation?.coords) return;
    if (routeCoords.length === 0) return;

    const current = myLocation.coords;
    const accuracy = Number(current.accuracy);
    const now = Date.now();

    // GPS 오차가 큰 상태에서는 경로 이탈을 단정하지 않는다.
    if (Number.isFinite(accuracy) && accuracy > MAX_RELIABLE_GPS_ACCURACY_METERS) {
      offRouteSinceRef.current = null;

      if (now - lastLowAccuracyNoticeAtRef.current >= LOW_ACCURACY_NOTICE_COOLDOWN_MS) {
        lastLowAccuracyNoticeAtRef.current = now;
        Speech.speak('위치 정확도가 낮습니다. 잠시 후 경로를 다시 확인합니다.', {
          language: 'ko-KR',
        });
      }
      return;
    }

    // 경로 중 가장 가까운 점 찾기
    let minDistance = Infinity;

    routeCoords.forEach((pt) => {
      const d = getDistanceFromLatLonInMeters(
        current.latitude,
        current.longitude,
        pt.latitude,
        pt.longitude
      );
      if (d < minDistance) minDistance = d;
    });

    // GPS가 한 번 튀는 경우를 피하려고 20m 이상 이탈이 5초 지속될 때만 재탐색한다.
    if (minDistance > OFF_ROUTE_DISTANCE_METERS) {
      if (!offRouteSinceRef.current) {
        offRouteSinceRef.current = now;
        return;
      }

      if (now - offRouteSinceRef.current < OFF_ROUTE_CONFIRMATION_MS) {
        return;
      }

      if (
        isReroutingRef.current ||
        now - lastRerouteAtRef.current < 10000
      ) {
        return;
      }

      isReroutingRef.current = true;
      lastRerouteAtRef.current = now;
      offRouteSinceRef.current = null;

      Vibration.vibrate([0, 500, 200, 500]);

      const reroute = async () => {
        try {
          Speech.stop();

          Speech.speak(
            '경로를 벗어났습니다. 새로운 경로를 탐색합니다.',
            { language: 'ko-KR' }
          );

          if (!destinationCoords) return;

          const newRoute = await getRoute(
            current.latitude,
            current.longitude,
            destinationCoords.latitude,
            destinationCoords.longitude
          );

          if (!newRoute?.features) {
            Speech.speak('새 경로를 찾지 못했습니다. 잠시 후 다시 시도합니다.', {
              language: 'ko-KR',
            });
            return;
          }

          const totalDistance = newRoute.features.reduce(
            (sum: number, feature: any) => sum + (Number(feature.properties?.distance) || 0),
            0
          );
          const totalTime = newRoute.features.reduce(
            (sum: number, feature: any) => sum + (Number(feature.properties?.time) || 0),
            0
          );

          const coords = newRoute.features
            .filter((f: any) => f.geometry?.type === 'LineString')
            .flatMap((f: any) =>
              f.geometry.coordinates.map((c: number[]) => ({
                latitude: c[1],
                longitude: c[0],
              }))
            );

          const points = newRoute.features
            .filter(
              (item: any) =>
                item.geometry?.type === 'Point' &&
                item.properties?.description
            )
            .map((item: any) => ({
              latitude: item.geometry.coordinates[1],
              longitude: item.geometry.coordinates[0],
              description: item.properties.description,
            }));

          setRouteCoords(coords);
          setGuidePoints(points);
          setCurrentGuideIndex(0);
          setSpokenStages({});

          const distanceText =
            totalDistance < 1000
              ? `${Math.round(totalDistance)}미터`
              : `${(totalDistance / 1000).toFixed(1)}킬로미터`;
          const timeText = totalTime > 0 ? `, 예상 ${Math.max(1, Math.round(totalTime / 60))}분` : '';
          const firstGuideText = points[0]?.description
            ? ` 첫 안내는 ${points[0].description}`
            : '';

          Speech.stop();
          Speech.speak(
            `새 경로를 안내합니다. 남은 거리는 ${distanceText}${timeText}입니다.${firstGuideText}`,
            { language: 'ko-KR' }
          );
        } finally {
          isReroutingRef.current = false;
        }
      };

      reroute();
    } else {
      offRouteSinceRef.current = null;
    }
  }, [myLocation]);


  useEffect(() => {
    if (!currentUser) return;

    const shareRef = ref(db, `users/${currentUser.uid}/shareLocation`);

    const offShare = onValue(shareRef, (snapshot) => {
      setShareLocation(!!snapshot.val());
    });

    return () => offShare();
  }, [currentUser]);

  useEffect(() => {
  if (!currentUser || isUser) return;

  const pairedRef = ref(
    db,
    `profiles/${currentUser.uid}/pairedUser`
  );

  const off = onValue(
    pairedRef,
    async (snapshot) => {
      const pairedUid = snapshot.val();

      console.log(
        '🔥 pairedUser 변경',
        pairedUid
      );

      if (!pairedUid) {
        setGuardianTargets([]);
        setSelectedGuardianTarget(null);
        return;
      }

      const targetSnapshot = await get(
        ref(db, `users/${pairedUid}`)
      );

      const target = targetSnapshot.val();

      if (!target) return;

      const nextTarget = {
        id: pairedUid,
        uid: pairedUid,
        userId: target.userId,
        name: target.name,
        status: '연결됨',
        lastSeen: '위치 공유 대기 중',
      };

      setGuardianTargets([nextTarget]);
      setSelectedGuardianTarget(nextTarget);

      console.log(
        '🔥 보호자 목록 갱신',
        nextTarget
      );
    }
  );

  return () => off();
}, [currentUser, isUser]);

  useEffect(() => {
    if (!currentUser || !isUser) {
      setPairedGuardianInfo(null);
      return;
    }

    const pairedGuardianRef = ref(db, `users/${currentUser.uid}/pairedGuardian`);

    const off = onValue(pairedGuardianRef, async (snapshot) => {
      let guardianUid = snapshot.val();

      if (!guardianUid) {
        const profileSnapshot = await get(ref(db, `profiles/${currentUser.uid}/pairedGuardian`));
        guardianUid = profileSnapshot.val();
      }

      if (!guardianUid) {
        setPairedGuardianInfo(null);
        return;
      }

      try {
        const [guardianUserSnapshot, guardianProfileSnapshot] = await Promise.all([
          get(ref(db, `users/${guardianUid}`)),
          get(ref(db, `profiles/${guardianUid}`)),
        ]);
        const guardianUser = guardianUserSnapshot.val() || {};
        const guardianProfile = guardianProfileSnapshot.val() || {};

        setPairedGuardianInfo({
          uid: guardianUid,
          name:
            guardianUser.name ||
            guardianProfile.name ||
            guardianUser.displayName ||
            guardianProfile.displayName ||
            '보호자',
          userId: guardianUser.userId || guardianProfile.userId || '',
          email: guardianUser.email || guardianProfile.email || '',
        });
      } catch (error) {
        console.log('연결된 보호자 정보 불러오기 실패', error);
        setPairedGuardianInfo({
          uid: guardianUid,
          name: '보호자',
          userId: '',
          email: '',
        });
      }
    });

    return () => off();
  }, [currentUser, isUser]);

  
 useEffect(() => {
  console.log('🔥🔥🔥 리스너 테스트');

  console.log(
    '리스너 시작',
    currentUser?.uid,
    isUser
  );

  if (!currentUser) return;
  if (!isUser) return;

shownConnectionRequestIdsRef.current.clear();

const requestRef = ref(
  db,
  `pendingRequests/${currentUser.uid}`
);

console.log(
  '리스너 경로',
  `pendingRequests/${currentUser.uid}`
);

 const unsubscribe = onValue(
  requestRef,
  async (snapshot) => {
    const requests = snapshot.val() || {};
    const pendingEntries = Object.entries(requests)
      .map(([guardianUid, value]: any) => ({
        ...value,
        guardianUid: value?.guardianUid || guardianUid,
      }))
      .filter((request: any) => request.status !== 'approved' && request.status !== 'rejected');

    const getConnectionRequestKey = (item: any) =>
      `${currentUser.uid}:${item.guardianUid}:${item.requestedAt || ''}`;

    const request = pendingEntries.find(
      (item: any) => !shownConnectionRequestIdsRef.current.has(getConnectionRequestKey(item))
    );

    if (!request) return;

    const requestKey = getConnectionRequestKey(request);
    shownConnectionRequestIdsRef.current.add(requestKey);

    try {
      const connectionStatusSnapshot = await get(
        ref(db, `connectionRequests/${currentUser.uid}/${request.guardianUid}/status`)
      );

      const connectionStatus = connectionStatusSnapshot.val();

      if (
        connectionStatus === 'approved' ||
        connectionStatus === 'rejected'
      ) {
        return;
      }
    } catch (error) {
      console.log('처리된 연결 요청 확인 실패', error);
    }

    Alert.alert(
      '연결 요청',
      `${request.guardianName || '보호자'}님이 연결을 요청했습니다.`,
      [
        {
          text: '거절',
          style: 'cancel',
          onPress: async () => {
            try {
              const respondedAt = new Date().toISOString();
              await update(ref(db), {
                [`pendingRequests/${currentUser.uid}/${request.guardianUid}/status`]: 'rejected',
                [`pendingRequests/${currentUser.uid}/${request.guardianUid}/respondedAt`]: respondedAt,
              });

              update(ref(db), {
                [`connectionRequests/${currentUser.uid}/${request.guardianUid}/status`]: 'rejected',
                [`connectionRequests/${currentUser.uid}/${request.guardianUid}/respondedAt`]: respondedAt,
                [`guardianSentRequests/${request.guardianUid}/${currentUser.uid}/status`]: 'rejected',
                [`guardianSentRequests/${request.guardianUid}/${currentUser.uid}/respondedAt`]: respondedAt,
              }).catch((error) => {
                console.log('보조 연결 요청 거절 기록 저장 실패', error);
              });

              remove(ref(db, `pendingRequests/${currentUser.uid}/${request.guardianUid}`)).catch(() => {
                console.log('처리된 연결 요청 삭제 실패');
              });
            } catch (e) {
              console.log('연결 요청 거절 실패', e);
              shownConnectionRequestIdsRef.current.delete(requestKey);
            }
          },
        },
        {
          text: '수락',
          onPress: async () => {
            try {
              const userSnapshot = await get(ref(db, `users/${currentUser.uid}`));
              const profileSnapshot = await get(ref(db, `profiles/${currentUser.uid}`));
              const userData = userSnapshot.val() || {};
              const profileData = profileSnapshot.val() || {};
              const userName = userData.name || profileData.name || '사용자';
              const userId = userData.userId || profileData.userId || '';
              const respondedAt = new Date().toISOString();

              await update(ref(db), {
                [`profiles/${currentUser.uid}/pairedGuardian`]: request.guardianUid,
                [`profiles/${request.guardianUid}/pairedUser`]: currentUser.uid,
                [`users/${currentUser.uid}/pairedGuardian`]: request.guardianUid,
                [`users/${request.guardianUid}/pairedUser`]: currentUser.uid,
                [`guardianLinks/${request.guardianUid}/${currentUser.uid}`]: {
                  uid: currentUser.uid,
                  userId,
                  name: userName,
                  approvedAt: respondedAt,
                },
              });

              update(ref(db), {
                [`pendingRequests/${currentUser.uid}/${request.guardianUid}/status`]: 'approved',
                [`pendingRequests/${currentUser.uid}/${request.guardianUid}/respondedAt`]: respondedAt,
              }).catch((error) => {
                console.log('연결 요청 승인 상태 저장 실패', error);
              });

              update(ref(db), {
                [`connectionRequests/${currentUser.uid}/${request.guardianUid}/status`]: 'approved',
                [`connectionRequests/${currentUser.uid}/${request.guardianUid}/respondedAt`]: respondedAt,
                [`guardianSentRequests/${request.guardianUid}/${currentUser.uid}/status`]: 'approved',
                [`guardianSentRequests/${request.guardianUid}/${currentUser.uid}/respondedAt`]: respondedAt,
              }).catch((error) => {
                console.log('보조 연결 요청 승인 기록 저장 실패', error);
              });

              remove(ref(db, `pendingRequests/${currentUser.uid}/${request.guardianUid}`)).catch(() => {
                console.log('처리된 연결 요청 삭제 실패');
              });

              Alert.alert('연결 완료', '보호자와 연결되었습니다.');
            } catch (e) {
              console.log('연결 실패', e);
              shownConnectionRequestIdsRef.current.delete(requestKey);
              Alert.alert('연결 실패', '요청을 처리하지 못했습니다.');
            }
          },
        },
      ]
    );
  },
  (error) => {
    console.log('🔥 리스너 에러', error);
  }
);
  return () => unsubscribe();
}, [currentUser, isUser]);

 const handleVoice = (msg: string) => {
  Vibration.vibrate(20);
  Speech.stop();
  Speech.speak(msg, { language: 'ko' });
};
  const getDistanceFromLatLonInMeters = (
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ) => {
    const R = 6371000;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  const getDateKey = (date = new Date()) => date.toISOString().slice(0, 10);

  const getKoreanWeekday = (date: Date) => {
    const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
    return weekdays[date.getDay()];
  };

  const getShortDateText = (timestamp: string) => {
    const date = new Date(timestamp);
    return `${date.getMonth() + 1}/${date.getDate()} ${date.toLocaleTimeString('ko-KR', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })}`;
  };

  const getHistoryRangeText = (history: any[]) => {
    if (!history.length) return '기록 없음';

    const sorted = [...history].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    const firstDate = new Date(sorted[0].timestamp);
    const lastDate = new Date(sorted[sorted.length - 1].timestamp);

    return `${firstDate.getMonth() + 1}/${firstDate.getDate()} (${getKoreanWeekday(firstDate)}) - ${lastDate.getMonth() + 1}/${lastDate.getDate()} (${getKoreanWeekday(lastDate)})`;
  };

  const pruneMovementHistory = (history: any[]) => {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;

    return history
      .filter(item => new Date(item.timestamp).getTime() >= cutoff)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      .slice(-1000);
  };

  const getFilteredMovementHistory = () => {
    const now = new Date();
    const todayKey = getDateKey(now);
    const rangeDays = historyRange === 'today' ? 1 : historyRange === '7days' ? 7 : 30;
    const cutoff = Date.now() - (rangeDays - 1) * 24 * 60 * 60 * 1000;

    return movementHistory.filter(item => {
      if (historyRange === 'today') return item.dateKey === todayKey;
      return new Date(item.timestamp).getTime() >= cutoff;
    });
  };

  const recordMovementPoint = async (
    latitude: number,
    longitude: number,
    addressText: string
  ) => {
    const now = new Date();
    const nextPoint = {
      id: `${now.getTime()}`,
      dateKey: getDateKey(now),
      timestamp: now.toISOString(),
      latitude,
      longitude,
      address: addressText || '위치 정보 없음',
    };

    setMovementHistory(prev => {
      const lastPoint = prev[prev.length - 1];

      if (lastPoint) {
        const distance = getDistanceFromLatLonInMeters(
          lastPoint.latitude,
          lastPoint.longitude,
          latitude,
          longitude
        );

        if (distance < MOVE_RECORD_DISTANCE_METERS) {
          return prev;
        }
      }

      const cleaned = pruneMovementHistory([...prev, nextPoint]);

      if (currentUser) {
        set(ref(db, `users/${currentUser.uid}/moveHistory`), cleaned).catch(() => {
          console.log('이동 기록 저장 실패');
        });
      }

      return cleaned;
    });
  };


  // ⭐⭐⭐ 여기 추가
  // ------------------------------------------------------------
  // 4-2. 위치 주소 변환
  // ------------------------------------------------------------
  const getAddress = async (
    lat: number,
    lon: number,
    type: 'user' | 'guardian'
  ) => {
    try {
      const result = await Location.reverseGeocodeAsync({
        latitude: lat,
        longitude: lon,
      });

      if (result.length > 0) {
        const addr = result[0];

        const parts = [addr.name, addr.street, addr.district]
          .filter((v, i, arr) => v && arr.indexOf(v) === i);

        const text =
          parts.join(' ') ||
          [addr.region, addr.city, addr.district]
            .filter((v, i, arr) => v && arr.indexOf(v) === i)
            .join(' ');

        if (type === 'user') {
          setUserAddress(text);
        } else {
          setGuardianAddress(text);
        }

        return text;
      }

      return '위치 정보 없음';
    } catch (e) {
      console.log('주소 변환 실패');
      return '주소 변환 실패';
    }
  };
  // ------------------------------------------------------------
  // 4-3. 목적지 검색: TMAP POI API
  // ------------------------------------------------------------
  const searchPlace = async (keyword: string, page = 1) => {
    try {
      if (!myLocation?.coords) {
        throw new Error('현재 위치를 확인하지 못했습니다. 위치 권한과 GPS 상태를 확인해 주세요.');
      }

      const originLat = myLocation.coords.latitude;
      const originLon = myLocation.coords.longitude;

      const data = await requestTmap(
        `https://apis.openapi.sk.com/tmap/pois?version=1&format=json` +
        `&searchKeyword=${encodeURIComponent(keyword)}` +
        `&count=20` +
        `&page=${page}` +
        `&searchtypCd=R` +          // 거리순
        `&radius=10` +              // 10km 반경
        `&centerLat=${originLat}` + // 현재 위치 위도
        `&centerLon=${originLon}` + // 현재 위치 경도
        `&reqCoordType=WGS84GEO` +
        `&resCoordType=WGS84GEO`,
        {
          method: 'GET',
          headers: {
            appKey: TMAP_APP_KEY,
          },
        }
      );

      const results = data?.searchPoiInfo?.pois?.poi || [];

      if (!results.length) return [];

      const mapped = results
        .map((item: any) => {
          const latitude = parseFloat(item.noorLat || item.frontLat || item.lat);
          const longitude = parseFloat(item.noorLon || item.frontLon || item.lon);

          if (Number.isNaN(latitude) || Number.isNaN(longitude)) return null;

          const distance = getDistanceFromLatLonInMeters(
            originLat,
            originLon,
            latitude,
            longitude
          );

          return {
            name: item.name,
            bldName: item.bldName,
            latitude,
            longitude,
            distance,
            fullAddress:
              item.newAddressList?.newAddress?.[0]?.fullAddressRoad ||
              item.fullAddressRoad ||
              [
                item.roadName,
                [item.bldNo1, item.bldNo2].filter(Boolean).join('-'),
              ]
                .filter(Boolean)
                .join(' ') ||
              [
                item.upperAddrName,
                item.middleAddrName,
                item.lowerAddrName,
                item.detailAddrName,
              ]
                .filter(Boolean)
                .join(' '),
          };
        })
.filter(Boolean)
.sort((a: any, b: any) => {
  const searchKeyword = keyword
    .trim()
    .replace(/\s/g, '');

 const aName = (a.name || '').replace(/\s/g, '');
const bName = (b.name || '').replace(/\s/g, '');

const getScore = (name: string) => {
  // 완전 일치
  if (name === searchKeyword) return 0;

  // 검색어로 시작
  if (name.startsWith(searchKeyword)) return 1;

  // 검색어 포함
  if (name.includes(searchKeyword)) return 2;

  // 나머지
  return 10;
};

const scoreA = getScore(aName);
const scoreB = getScore(bName);

// 관련도 우선
if (scoreA !== scoreB) {
  return scoreA - scoreB;
}

// 같은 관련도면 거리순
return a.distance - b.distance;
});
      return mapped;
    } catch (e) {
      console.log('장소 검색 실패', e);
      throw e;
    }
  };

  // ⭐ 여기부터 붙여넣기
  // ------------------------------------------------------------
  // 4-4. 도보 경로 요청: TMAP 보행자 경로 API
  // ------------------------------------------------------------
  const getRoute = async (
    startLat: number,
    startLon: number,
    endLat: number,
    endLon: number
  ) => {
    try {
      const data = await requestTmap(
        "https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            appKey: TMAP_APP_KEY,
          },
          body: JSON.stringify({
            startX: startLon,
            startY: startLat,
            endX: endLon,
            endY: endLat,
            reqCoordType: "WGS84GEO",
            resCoordType: "WGS84GEO",
            startName: "출발지",
            endName: "목적지",
          }),
        }
      );

      if (!Array.isArray(data?.features) || !data.features.some(
        (feature: any) => feature.geometry?.type === 'LineString' && feature.geometry.coordinates?.length > 1
      )) {
        throw new Error('이 목적지까지 보행 경로를 찾지 못했습니다. 다른 출입구나 가까운 도로를 선택해 주세요.');
      }
      return data;
    } catch (e: any) {
      console.log("경로 요청 실패", e);
      Alert.alert('길찾기 요청 실패', e?.message || '네트워크 연결을 확인해 주세요.');
      return null;
    }
  };
  // ------------------------------------------------------------
  // 4-5. 위치 추적 및 Firebase 실시간 연동
  // ------------------------------------------------------------
  // 🛰️ 위치 추적 및 실시간 데이터 연동 핵심 로직
  useEffect(() => {
    let watchSubscription: Location.LocationSubscription | null = null;
    let unsubscribeLocation: (() => void) | null = null;
    let unsubscribeStatus: (() => void) | null = null;
    let unsubscribeMoveHistory: (() => void) | null = null;

    const pushUserLog = (placeText: string) => {
      const time = new Date().toLocaleTimeString();

      setMoveLogs(prev => {
        const cleanPrev =
          prev.length === 1 && prev[0].includes("시스템 연결 대기 중")
            ? []
            : prev.slice(0, 9);

        return [
          `[내 위치] ${time} / ${placeText}`,
          ...cleanPrev,
        ];
      });
    };


    const pushGuardianLog = (placeText: string) => {
      const time = new Date().toLocaleTimeString();

      setMoveLogs(prev => {
        const cleanPrev =
          prev.length === 1 && prev[0].includes("시스템 연결 대기 중")
            ? []
            : prev.slice(0, 9);

        return [
          `[위치수신] ${time} / ${placeText}`,
          ...cleanPrev,
        ];
      });
    };

    const startLocationTracking = async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert("권한 필요", "위치 권한을 허용해야 실시간 기능이 작동합니다.");
        return;
      }

      // 1) 처음 1번 현재 위치 바로 가져오기
      try {
        const current = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.BestForNavigation,
        });

        setMyLocation(current);

        if (isUser) {
          const latitude = current.coords.latitude;
          const longitude = current.coords.longitude;


          const placeText = await getAddress(latitude, longitude, 'user');
          pushUserLog(placeText);
          await recordMovementPoint(latitude, longitude, placeText);

          if (currentUser) {
            set(ref(db, `users/${currentUser.uid}/location`), {
              latitude,
              longitude,
              timestamp: new Date().toISOString(),
            }).catch(() => {
              console.log('초기 위치 Firebase 저장 실패');
            });
          }

          lastLoggedLocationRef.current = { latitude, longitude };
        }
      } catch (err) {
        console.log("초기 위치 가져오기 실패:", err);
      }

      // 2) 이후 실시간 추적
      watchSubscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: 5000,
          distanceInterval: MOVE_RECORD_DISTANCE_METERS,
        },
        async (location) => {
          setMyLocation(location);
          if (!location.coords) {
            console.log("GPS 없음");
            return;
          }
          getAddress(location.coords.latitude, location.coords.longitude, 'user');

          if (isUser) {
            const latitude = location.coords.latitude;
            const longitude = location.coords.longitude;
            const accuracy = location.coords.accuracy ?? 999;

            // 정확도 너무 안 좋으면 무시
            if (accuracy > 30) {
              console.log("정확도 낮아서 무시:", accuracy);
              return;
            }

            await recordMovementPoint(
              latitude,
              longitude,
              userAddress || '이동 경로'
            );

            let shouldLog = false;

            if (!lastLoggedLocationRef.current) {
              shouldLog = true;
            } else {
              const distance = getDistanceFromLatLonInMeters(
                lastLoggedLocationRef.current.latitude,
                lastLoggedLocationRef.current.longitude,
                latitude,
                longitude
              );

              if (distance >= 10) {
                shouldLog = true;
                setMoveStatus('이동 중');
              } else {
                setMoveStatus('정지 중');
              }
            }

            if (shouldLog) {
              const addressText = await getAddress(latitude, longitude, 'user');
              pushUserLog(addressText);
              await recordMovementPoint(latitude, longitude, addressText);

              if (currentUser) {
                set(ref(db, `users/${currentUser.uid}/location`), {
                  latitude,
                  longitude,
                  timestamp: new Date().toISOString(),
                }).catch(() => {
                  console.log("Firebase 실패");
                });
              }

              lastLoggedLocationRef.current = { latitude, longitude };
            }
          }
        }
      );

      // 3) 보호자 모드면 Firebase 실시간 수신
      if (!isUser) {
        const targetUid = selectedGuardianTarget?.uid || guardianTargets[0]?.uid;

        if (!targetUid) {
          setCanGuardianViewLocation(false);
          setTargetLocation(null);
          setMoveLogs(["연결된 관리 대상이 없습니다"]);
          return;
        }

        const locationRef = ref(db, `users/${targetUid}/location`);
        const shareRef = ref(db, `users/${targetUid}/shareLocation`);
        const moveHistoryRef = ref(db, `users/${targetUid}/moveHistory`);

        let isShared = false;
        let isEmergency = false;
        let latestLocationData: any = null;

        const updatePermission = () => {
          const canView = isShared || isEmergency;
          setCanGuardianViewLocation(canView);

          if (!canView) {
            setTargetLocation(null);
            setMoveLogs(["시스템 연결 대기 중..."]); // ⭐ 추가
          } else if (latestLocationData) {
            setTargetLocation(latestLocationData);
          }
        };

        const offShare = onValue(shareRef, (snapshot) => {
          isShared = !!snapshot.val();
          console.log("shareLocation:", isShared);
          updatePermission();
        });

        unsubscribeLocation = onValue(locationRef, async (snapshot) => {
          const data = snapshot.val();

          if (data) {
            latestLocationData = data;

            if (isShared || isEmergency) {
              setTargetLocation(data);
              const addressText = await getAddress(data.latitude, data.longitude, 'guardian');
              pushGuardianLog(addressText);
            } else {
              setTargetLocation(null);
            }
          }
        });

        unsubscribeMoveHistory = onValue(moveHistoryRef, (snapshot) => {
          const data = snapshot.val();

          if (Array.isArray(data)) {
            setMovementHistory(pruneMovementHistory(data));
          } else {
            setMovementHistory([]);
          }
        });

        const statusRef = ref(db, `users/${targetUid}/status`);
        const guardianAlertStartedAt = Date.now();
        const offStatus = onValue(statusRef, async (snapshot) => {
          const statusData = snapshot.val();
          const previousEmergency = lastEmergencyStatusRef.current;
          const firebaseEmergency = !!statusData?.emergency;
          const emergencyTime = statusData?.timestamp
            ? new Date(statusData.timestamp).getTime()
            : 0;
          const isNewEmergency = emergencyTime > guardianAlertStartedAt;

          if (
            !hasLoadedEmergencyStatusRef.current &&
            firebaseEmergency &&
            !isNewEmergency
          ) {
            isEmergency = false;
            setEmergencyStatus(false);
            updatePermission();
            lastEmergencyStatusRef.current = false;
            hasLoadedEmergencyStatusRef.current = true;
            set(statusRef, {
              emergency: false,
              timestamp: new Date().toISOString(),
            }).catch(() => {
              console.log('긴급 상태 초기화 실패');
            });
            return;
          }

          isEmergency = firebaseEmergency;

          console.log("emergency:", isEmergency);

          setEmergencyStatus(isEmergency);
          updatePermission();

          if (
            hasLoadedEmergencyStatusRef.current &&
            isEmergency &&
            !previousEmergency &&
            isNewEmergency
          ) {
            Alert.alert("🚨 긴급 상황", "사용자가 도움을 요청했습니다!");
            Vibration.vibrate([0, 500, 200, 500]);
            await Notifications.scheduleNotificationAsync({
              content: {
                title: '긴급 위험 알림',
                body: '사용자가 긴급 도움을 요청했습니다. 현재 위치를 확인하세요.',
                sound: true,
              },
              trigger: null,
            });
          }

          lastEmergencyStatusRef.current = isEmergency;
          hasLoadedEmergencyStatusRef.current = true;
        });

        unsubscribeStatus = () => {
          offShare();
          offStatus();
        };
      }
    };

    startLocationTracking();

    return () => {
      if (watchSubscription) watchSubscription.remove();
      if (unsubscribeLocation) unsubscribeLocation();
      if (unsubscribeStatus) unsubscribeStatus();
      if (unsubscribeMoveHistory) unsubscribeMoveHistory();
    };
  }, [userType, selectedGuardianTarget, guardianTargets, currentUser]);


  // --- [화면] 동선 기록 (수정된 로직 적용) ---
  // ------------------------------------------------------------
  // 5. 화면: 동선 기록 / 보호자 위치 확인
  // ------------------------------------------------------------
  const PathLogView = () => {
    const displayCoords = isUser ? myLocation?.coords : targetLocation;

    useEffect(() => {
      if (!isUser && targetLocation && mapRef.current) {
        mapRef.current.animateToRegion({
          latitude: targetLocation.latitude,
          longitude: targetLocation.longitude,
          latitudeDelta: 0.005,
          longitudeDelta: 0.005,
        }, 1000);
      }
    }, [targetLocation, isUser]);

    // 💡 보호자면 targetLocation(사용자)을 보여주고, 사용자면 myLocation(내 위치)을 보여줌
    if (!isUser && !canGuardianViewLocation) {
      return (
        <View style={styles.container}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => setCurrentScreen('home')}>
              <Ionicons name="chevron-back" size={32} color={themeColor} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>사용자 위치 확인</Text>
            <View style={{ width: 32 }} />
          </View>

          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
            <Text style={{ color: 'white', fontSize: 18, fontWeight: '700', textAlign: 'center' }}>
              사용자가 위치 확인을 허용했거나 SOS 요청 중일 때만 확인할 수 있습니다.
            </Text>
          </View>
        </View>
      );
    }

    if (!isUser) {
      if (!displayCoords) {
        return <Text style={{ color: 'white', textAlign: 'center' }}>위치 정보 없음</Text>;
      }

      return (
        <View style={styles.container}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => setCurrentScreen('home')}>
              <Ionicons name="chevron-back" size={32} color={themeColor} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>실시간 위치</Text>
            <View style={{ width: 32 }} />
          </View>

          <View style={{ flex: 1 }}>
            <MapView
              ref={mapRef}
              style={StyleSheet.absoluteFill}
              showsUserLocation={false}
              initialRegion={{
                latitude: displayCoords.latitude,
                longitude: displayCoords.longitude,
                latitudeDelta: 0.005,
                longitudeDelta: 0.005,
              }}
            >
              {targetLocation && (
                <Marker
                  coordinate={{
                    latitude: targetLocation.latitude,
                    longitude: targetLocation.longitude,
                  }}
                  title="사용자 현재 위치"
                >
                  <View style={[styles.userMarker, { backgroundColor: BRAND_COLOR }]}>
                    <Ionicons name="person" size={20} color="black" />
                  </View>
                </Marker>
              )}
            </MapView>

            <View
              style={{
                position: 'absolute',
                left: 18,
                right: 18,
                bottom: 24,
                backgroundColor: '#111',
                borderRadius: 22,
                padding: 18,
                borderWidth: 1,
                borderColor: '#252525',
              }}
            >
              <Text style={{ color: BRAND_COLOR, fontSize: 15, fontWeight: '900', marginBottom: 8 }}>
                현재 위치
              </Text>
              <Text style={{ color: 'white', fontSize: 18, fontWeight: '800', lineHeight: 26 }}>
                {guardianAddress || '사용자 위치를 확인 중입니다.'}
              </Text>
            </View>
          </View>
        </View>
      );
    }

    if (pathLogMode === 'menu') {
      return (
        <View style={styles.container}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => setCurrentScreen('home')}>
              <Ionicons name="chevron-back" size={32} color={themeColor} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>기록 보기</Text>
            <View style={{ width: 32 }} />
          </View>

          <View style={{ flex: 1, paddingHorizontal: 22, paddingTop: 18 }}>
            <TouchableOpacity
              onPress={() => setPathLogMode('movement')}
              style={{
                backgroundColor: '#111',
                borderRadius: 20,
                minHeight: 118,
                padding: 20,
                marginBottom: 14,
                flexDirection: 'row',
                alignItems: 'center',
                borderWidth: 1,
                borderColor: '#252525',
              }}
            >
              <View
                style={{
                  width: 54,
                  height: 54,
                  borderRadius: 27,
                  backgroundColor: BRAND_COLOR,
                  justifyContent: 'center',
                  alignItems: 'center',
                  marginRight: 16,
                }}
              >
                <Ionicons name="footsteps" size={27} color="black" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: 'white', fontSize: 21, fontWeight: '900' }}>
                  이동 기록
                </Text>
                <Text style={{ color: '#aaa', fontSize: 14, marginTop: 7, lineHeight: 20 }}>
                  지도와 최근 이동 위치를 확인합니다.
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={24} color="#777" />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setPathLogMode('guardian')}
              style={{
                backgroundColor: '#111',
                borderRadius: 20,
                minHeight: 118,
                padding: 20,
                flexDirection: 'row',
                alignItems: 'center',
                borderWidth: 1,
                borderColor: '#252525',
              }}
            >
              <View
                style={{
                  width: 54,
                  height: 54,
                  borderRadius: 27,
                  backgroundColor: pairedGuardianInfo ? BRAND_COLOR : '#252525',
                  justifyContent: 'center',
                  alignItems: 'center',
                  marginRight: 16,
                }}
              >
                <Ionicons
                  name={pairedGuardianInfo ? 'shield-checkmark' : 'shield-outline'}
                  size={27}
                  color={pairedGuardianInfo ? 'black' : '#aaa'}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: 'white', fontSize: 21, fontWeight: '900' }}>
                  보호자 기록
                </Text>
                <Text style={{ color: '#aaa', fontSize: 14, marginTop: 7, lineHeight: 20 }}>
                  현재 연결된 보호자 정보를 확인합니다.
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={24} color="#777" />
            </TouchableOpacity>
          </View>
        </View>
      );
    }

    if (pathLogMode === 'guardian') {
      return (
        <View style={styles.container}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => setPathLogMode('menu')}>
              <Ionicons name="chevron-back" size={32} color={themeColor} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>보호자 기록</Text>
            <View style={{ width: 32 }} />
          </View>

          <View style={{ flex: 1, paddingHorizontal: 22, paddingTop: 18 }}>
            <View
              style={{
                backgroundColor: pairedGuardianInfo ? '#172000' : '#111',
                borderRadius: 20,
                padding: 20,
                borderWidth: 1,
                borderColor: pairedGuardianInfo ? BRAND_COLOR : '#252525',
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 18 }}>
                <View
                  style={{
                    width: 58,
                    height: 58,
                    borderRadius: 29,
                    backgroundColor: pairedGuardianInfo ? BRAND_COLOR : '#252525',
                    justifyContent: 'center',
                    alignItems: 'center',
                    marginRight: 16,
                  }}
                >
                  <Ionicons
                    name={pairedGuardianInfo ? 'shield-checkmark' : 'shield-outline'}
                    size={30}
                    color={pairedGuardianInfo ? 'black' : '#aaa'}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: '#aaa', fontSize: 14, fontWeight: '800', marginBottom: 6 }}>
                    연결된 보호자
                  </Text>
                  <Text style={{ color: 'white', fontSize: 22, fontWeight: '900' }}>
                    {pairedGuardianInfo ? pairedGuardianInfo.name : '연결된 보호자 없음'}
                  </Text>
                </View>
              </View>

              {!!pairedGuardianInfo ? (
                <>
                  <Text style={{ color: '#aaa', fontSize: 15, lineHeight: 23 }}>
                    {pairedGuardianInfo.userId
                      ? `아이디 ${pairedGuardianInfo.userId}`
                      : pairedGuardianInfo.email || '보호자 계정과 연결되어 있습니다.'}
                  </Text>
                  <Text style={{ color: BRAND_COLOR, fontSize: 15, fontWeight: '900', marginTop: 16 }}>
                    연결 상태 정상
                  </Text>
                </>
              ) : (
                <Text style={{ color: '#aaa', fontSize: 15, lineHeight: 23 }}>
                  보호자가 연결되면 이곳에 이름과 계정 정보가 표시됩니다.
                </Text>
              )}
            </View>
          </View>
        </View>
      );
    }

    const filteredHistory = getFilteredMovementHistory();
    const savedHistoryCoords = filteredHistory.map(item => ({
      latitude: item.latitude,
      longitude: item.longitude,
    }));
    const currentCoord = displayCoords
      ? {
          latitude: displayCoords.latitude,
          longitude: displayCoords.longitude,
        }
      : null;
    const lastSavedCoord = savedHistoryCoords[savedHistoryCoords.length - 1];
    const shouldAppendCurrentCoord =
      currentCoord &&
      (!lastSavedCoord ||
        getDistanceFromLatLonInMeters(
          lastSavedCoord.latitude,
          lastSavedCoord.longitude,
          currentCoord.latitude,
          currentCoord.longitude
        ) >= MOVE_RECORD_DISTANCE_METERS);
    const historyCoords = shouldAppendCurrentCoord
      ? [...savedHistoryCoords, currentCoord]
      : savedHistoryCoords;
    const fallbackCoords = historyCoords[historyCoords.length - 1] || displayCoords;
    const recentHistoryItems = [...filteredHistory]
      .reverse()
      .filter(
        (item, index, self) =>
          index === self.findIndex(prev => prev.address === item.address)
      )
      .slice(0, 8);

    if (!fallbackCoords) {
      return <Text style={{ color: 'white', textAlign: 'center' }}>위치 정보 없음</Text>;
    }

    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setPathLogMode('menu')}><Ionicons name="chevron-back" size={32} color={themeColor} /></TouchableOpacity>
          <Text style={styles.headerTitle}>이동 기록</Text>
          <View style={{ width: 32 }} />
        </View>

        <View
          style={{
            flexDirection: 'row',
            backgroundColor: '#111',
            borderRadius: 14,
            marginHorizontal: 22,
            marginTop: 8,
            padding: 4,
          }}
        >
          {[
            { key: 'today', label: '오늘' },
            { key: '7days', label: '7일' },
            { key: '30days', label: '30일' },
          ].map(item => {
            const isActive = historyRange === item.key;

            return (
              <TouchableOpacity
                key={item.key}
                onPress={() => setHistoryRange(item.key as 'today' | '7days' | '30days')}
                style={{
                  flex: 1,
                  height: 48,
                  borderRadius: 10,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: isActive ? '#263000' : 'transparent',
                  borderWidth: isActive ? 1 : 0,
                  borderColor: BRAND_COLOR,
                }}
              >
                <Text
                  style={{
                    color: isActive ? BRAND_COLOR : '#888',
                    fontSize: 18,
                    fontWeight: '900',
                  }}
                >
                  {item.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View
          style={{
            height: 210,
            marginHorizontal: 22,
            marginTop: 16,
            borderRadius: 18,
            overflow: 'hidden',
            backgroundColor: '#111',
          }}
        >
          <MapView
            ref={mapRef}
            style={StyleSheet.absoluteFill}
            showsUserLocation={isUser}
            initialRegion={{
              latitude: fallbackCoords.latitude,
              longitude: fallbackCoords.longitude,
              latitudeDelta: 0.02,
              longitudeDelta: 0.02,
            }}
          >
            {historyCoords.length > 1 && (
              <Polyline
                coordinates={historyCoords}
                strokeWidth={5}
                strokeColor={BRAND_COLOR}
              />
            )}

            {historyCoords[0] && (
              <Marker coordinate={historyCoords[0]} title="시작 위치">
                <View style={[styles.userMarker, { backgroundColor: BRAND_COLOR }]}>
                  <Ionicons name="location" size={18} color="black" />
                </View>
              </Marker>
            )}

            {historyCoords.length > 1 && (
              <Marker coordinate={historyCoords[historyCoords.length - 1]} title="최근 위치">
                <View style={[styles.userMarker, { backgroundColor: '#FF3B30' }]}>
                  <Ionicons name="location" size={18} color="white" />
                </View>
              </Marker>
            )}
          </MapView>
        </View>

        <View
          style={{
            flex: 1,
            backgroundColor: '#111',
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            marginTop: 18,
            paddingTop: 22,
            paddingHorizontal: 22,
          }}
        >
          <Text style={{ color: 'white', fontSize: 22, fontWeight: '900', marginBottom: 18 }}>
            {getHistoryRangeText(filteredHistory)}
          </Text>

          {recentHistoryItems.length === 0 ? (
            <View
              style={{
                backgroundColor: '#1A1A1A',
                borderRadius: 18,
                padding: 18,
              }}
            >
              <Text style={{ color: '#aaa', fontSize: 16, lineHeight: 24 }}>
                아직 저장된 이동 기록이 없습니다. GPS 위치가 업데이트되면 하루 단위로 자동 저장됩니다.
              </Text>
            </View>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false}>
              {recentHistoryItems.map((item, index) => (
                <View
                  key={item.id}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingVertical: 16,
                    borderBottomWidth: index === recentHistoryItems.length - 1 ? 0 : 1,
                    borderBottomColor: '#252525',
                  }}
                >
                  <View
                    style={{
                      width: 42,
                      height: 42,
                      borderRadius: 21,
                      backgroundColor: BRAND_COLOR,
                      justifyContent: 'center',
                      alignItems: 'center',
                      marginRight: 14,
                    }}
                  >
                    <Ionicons name="location" size={24} color="black" />
                  </View>

                  <Text
                    numberOfLines={1}
                    style={{
                      color: 'white',
                      fontSize: 19,
                      fontWeight: '900',
                      flex: 1,
                    }}
                  >
                    {item.address}
                  </Text>

                  <Text style={{ color: '#aaa', fontSize: 15, fontWeight: '700', marginLeft: 12 }}>
                    {getShortDateText(item.timestamp)}
                  </Text>
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      </View>
    );
  };
  useEffect(() => {
    const subscription = Magnetometer.addListener(data => {
      let angle =
        Math.atan2(data.y, data.x) * (180 / Math.PI);

      angle = angle >= 0 ? angle : angle + 360;

      setHeading(Math.round(angle));
    });

    Magnetometer.setUpdateInterval(1000);

    return () => subscription.remove();
  }, []);
  // --- 나머지 화면 (LoginView, HomeView 동일 유지) ---
  // ------------------------------------------------------------
  // 6. 화면: 로그인
  // ------------------------------------------------------------
  const LoginView = () => (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.container}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 28, justifyContent: 'center' }}
        >
          <TouchableOpacity
            onPress={() => setCurrentScreen('home')}
             accessible={true}
              accessibilityRole="button"
             accessibilityLabel="뒤로가기"
            style={{ position: 'absolute', top: 58, left: 22, width: 48, height: 48, justifyContent: 'center' }}
          >
            <Ionicons name="chevron-back" size={32} color={themeColor} />
          </TouchableOpacity>

          <View style={{ alignItems: 'center', marginBottom: 34 }}>
            <Text style={{ color: 'white', fontSize: 36, fontWeight: '900' }}>
              See<Text style={{ color: BRAND_COLOR }}>Q</Text>
            </Text>
            <Text style={{ color: '#aaa', fontSize: 16, marginTop: 14, textAlign: 'center', lineHeight: 24 }}>
              로그인하고 즐겨찾기와 기록을 안전하게 사용하세요
            </Text>
          </View>

          <View style={styles.typeSelector}>
            <TouchableOpacity
              style={[styles.typeButton, isUser && { backgroundColor: '#222', borderColor: BRAND_COLOR, borderWidth: 1 }]}
              onPress={() => setUserType('user')}
            >
              <Text style={[styles.typeButtonText, isUser && { color: BRAND_COLOR }]}>사용자용</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.typeButton, !isUser && { backgroundColor: '#222', borderColor: '#FFF', borderWidth: 1 }]}
              onPress={() => setUserType('guardian')}
            >
              <Text style={[styles.typeButtonText, !isUser && { color: '#FFF' }]}>보호자용</Text>
            </TouchableOpacity>
          </View>

          <View style={{ gap: 12 }}>
           

           
              
           

            <View style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 8 }}>
              <View style={{ flex: 1, height: 1, backgroundColor: '#222' }} />
              <Text style={{ color: '#666', marginHorizontal: 14 }}>또는</Text>
              <View style={{ flex: 1, height: 1, backgroundColor: '#222' }} />
            </View>

            <View
              style={{
                height: 58,
                borderRadius: 14,
                backgroundColor: '#111',
                borderWidth: 1,
                borderColor: '#252525',
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: 16,
              }}
            >
              <Ionicons name="mail" size={22} color="#aaa" style={{ marginRight: 10 }} />
              <TextInput
                style={{ flex: 1, color: 'white', fontSize: 16 }}
                placeholder="이메일"
                placeholderTextColor="#666"
                defaultValue={emailRef.current}
                onChangeText={(text) => {
                  emailRef.current = text;
                }}
                autoCapitalize="none"
                keyboardType="email-address"
              />
            </View>

            <View
              style={{
                height: 58,
                borderRadius: 14,
                backgroundColor: '#111',
                borderWidth: 1,
                borderColor: '#252525',
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: 16,
              }}
            >
              <Ionicons name="lock-closed" size={22} color="#aaa" style={{ marginRight: 10 }} />
              <TextInput
                style={{ flex: 1, color: 'white', fontSize: 16 }}
                placeholder="비밀번호"
                placeholderTextColor="#666"
                defaultValue={passwordRef.current}
                onChangeText={(text) => {
                  passwordRef.current = text;
                }}
                secureTextEntry
              />
            </View>

         

          

   <TouchableOpacity
              style={{
                height: 58,
                borderRadius: 14,
                backgroundColor: themeColor,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              onPress={handleEmailLogin}
            >
              <Text style={{ color: 'black', fontSize: 17, fontWeight: '900' }}>이메일 로그인</Text>
            </TouchableOpacity>

  <TouchableOpacity
              style={{
                height: 52,
                borderRadius: 14,
                backgroundColor: '#111',
                borderWidth: 1,
                borderColor: '#2A2A2A',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              onPress={() => setCurrentScreen('signup')}
            >
              <Text style={{ color: 'white', fontSize: 15, fontWeight: '800' }}>
                처음이면 회원가입
              </Text>
            </TouchableOpacity>
          </View>

<TouchableOpacity
  onPress={async () => {

    const emailText = emailRef.current.trim();

    if (!emailText) {
      Alert.alert(
        '이메일 입력',
        '이메일을 먼저 입력해주세요.'
      );
      return;
    }

    try {

      await sendPasswordResetEmail(
        auth,
        emailText
      );

      Alert.alert(
        '전송 완료',
        '비밀번호 재설정 이메일을 보냈습니다.'
      );

    } catch (error: any) {

      Alert.alert(
        '전송 실패',
        error?.message || '오류가 발생했습니다.'
      );

    }
  }}
>
  <Text
    style={{
      color: '#4A90E2',
      textAlign: 'center',
      marginTop: 18,
      fontSize: 16,
      fontWeight: '700',
    }}
  >
    비밀번호 찾기
  </Text>
</TouchableOpacity>

          <Text style={{ color: '#666', fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 34 }}>
            로그인하면 서비스 이용약관 및 개인정보 처리방침에 동의하게 됩니다.
          </Text>
        </ScrollView>
    </KeyboardAvoidingView>
  );

  const SignupView = () => {
    const signupFields = [
      {
        icon: 'person',
        placeholder: '이름',
        defaultValue: signupNameRef.current,
        onChangeText: (text: string) => {
          signupNameRef.current = text;
        },
      },
      {
        icon: 'id-card',
        placeholder: '아이디',
        defaultValue: signupIdRef.current,
        onChangeText: (text: string) => {
          signupIdRef.current = text;
        },
        autoCapitalize: 'none' as const,
      },
      {
        icon: 'mail',
        placeholder: '이메일',
        defaultValue: signupEmailRef.current,
        onChangeText: (text: string) => {
          signupEmailRef.current = text;
        },
        autoCapitalize: 'none' as const,
        keyboardType: 'email-address' as const,
      },
      {
        icon: 'lock-closed',
        placeholder: '비밀번호',
        defaultValue: signupPasswordRef.current,
        onChangeText: (text: string) => {
          signupPasswordRef.current = text;
        },
        secureTextEntry: true,
      },
      {
        icon: 'checkmark-circle',
        placeholder: '비밀번호 확인',
        defaultValue: signupPasswordConfirmRef.current,
        onChangeText: (text: string) => {
          signupPasswordConfirmRef.current = text;
        },
        secureTextEntry: true,
      },
    ];

    return (
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.container}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 28, paddingTop: 72, paddingBottom: 28 }}
        >
          <TouchableOpacity
            onPress={() => setCurrentScreen('login')}
            style={{ width: 48, height: 48, justifyContent: 'center', marginBottom: 12 }}
          >
            <Ionicons name="chevron-back" size={32} color={themeColor} />
          </TouchableOpacity>

          <View style={{ alignItems: 'center', marginBottom: 28 }}>
            <Text style={{ color: 'white', fontSize: 34, fontWeight: '900' }}>
              See<Text style={{ color: BRAND_COLOR }}>Q</Text>
            </Text>
            <Text style={{ color: 'white', fontSize: 24, fontWeight: '900', marginTop: 18 }}>
              회원가입
            </Text>
            <Text style={{ color: '#aaa', fontSize: 15, marginTop: 10, lineHeight: 22, textAlign: 'center' }}>
              보호자 연결과 위치 공유를 위해 정보를 입력해 주세요.
            </Text>
          </View>

          <View style={styles.typeSelector}>
            <TouchableOpacity
              style={[styles.typeButton, isUser && { backgroundColor: '#222', borderColor: BRAND_COLOR, borderWidth: 1 }]}
              onPress={() => setUserType('user')}
            >
              <Text style={[styles.typeButtonText, isUser && { color: BRAND_COLOR }]}>사용자용</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.typeButton, !isUser && { backgroundColor: '#222', borderColor: '#FFF', borderWidth: 1 }]}
              onPress={() => setUserType('guardian')}
            >
              <Text style={[styles.typeButtonText, !isUser && { color: '#FFF' }]}>보호자용</Text>
            </TouchableOpacity>
          </View>

          <View style={{ gap: 12 }}>
            {signupFields.map(field => (
              <View
                key={field.placeholder}
                style={{
                  height: 58,
                  borderRadius: 14,
                  backgroundColor: '#111',
                  borderWidth: 1,
                  borderColor: '#252525',
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingHorizontal: 16,
                }}
              >
                <Ionicons name={field.icon as any} size={22} color="#aaa" style={{ marginRight: 10 }} />
                <TextInput
                  style={{ flex: 1, color: 'white', fontSize: 16 }}
                  placeholder={field.placeholder}
                  placeholderTextColor="#666"
                  defaultValue={field.defaultValue}
                  onChangeText={field.onChangeText}
                  autoCapitalize={field.autoCapitalize || 'sentences'}
                  keyboardType={field.keyboardType || 'default'}
                  secureTextEntry={field.secureTextEntry}
                />
              </View>
            ))}

            <TouchableOpacity
              style={{
                height: 60,
                borderRadius: 14,
                backgroundColor: themeColor,
                alignItems: 'center',
                justifyContent: 'center',
                marginTop: 6,
              }}
              onPress={handleEmailSignup}
            >
              <Text style={{ color: 'black', fontSize: 18, fontWeight: '900' }}>
                이메일 인증하고 가입하기
              </Text>
            </TouchableOpacity>
          </View>

          <Text style={{ color: '#666', fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 24 }}>
            가입 후 이메일 인증을 완료해야 계정 연결과 보호자 기능을 안전하게 사용할 수 있습니다.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  };

  const SettingsView = () => {
    const settingSections: {
      icon: any;
      title: string;
      value?: string;
      onPress: () => void;
    }[][] = [
      [
        {
          icon: 'person-circle-outline',
          title: '계정 관리',
          onPress: () =>
            Alert.alert(
              '계정 관리',
              currentUser?.email ? `로그인 계정: ${currentUser.email}` : '로그인 정보가 없습니다.'
            ),
        },
        {
          icon: 'people-outline',
          title: '관리 대상 관리',
          onPress: () => {
            if (isUser) {
              Alert.alert('관리 대상 관리', '보호자용 계정에서 사용할 수 있습니다.');
              return;
            }

            addGuardianTarget();
          },
        },
      ],
      [
        {
          icon: 'radio-outline',
          title: '주변 인식 연결',
          onPress: () => setCurrentScreen('hazardSettings'),
        },
        {
          icon: 'shield-checkmark-outline',
          title: '앱 접근 권한',
          onPress: () =>
            Alert.alert('앱 접근 권한', '위치, 알림, 마이크 권한은 휴대폰 설정 앱에서 변경할 수 있습니다.'),
        },
      ],
      [
        {
          icon: 'information-circle-outline',
          title: '앱 정보',
          value: 'v1.0.0',
          onPress: () => Alert.alert('앱 정보', 'SeeQ v1.0.0'),
        },
      ],
    ];

    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setCurrentScreen('home')}>
            <Ionicons name="chevron-back" size={32} color={themeColor} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>설정</Text>
          <View style={{ width: 32 }} />
        </View>

        <ScrollView contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 28 }}>
          {settingSections.map((section, sectionIndex) => (
            <View
              key={sectionIndex}
              style={{
                backgroundColor: '#151515',
                borderRadius: 18,
                marginBottom: 16,
                borderWidth: 1,
                borderColor: '#252525',
                overflow: 'hidden',
              }}
            >
              {section.map((item, itemIndex) => (
                <TouchableOpacity
                  key={item.title}
                  onPress={item.onPress}
                  style={{
                    minHeight: 74,
                    paddingHorizontal: 18,
                    flexDirection: 'row',
                    alignItems: 'center',
                    borderBottomWidth: itemIndex === section.length - 1 ? 0 : 1,
                    borderBottomColor: '#252525',
                  }}
                >
                  <Ionicons name={item.icon as any} size={28} color="#ddd" />
                  <Text
                    style={{
                      color: 'white',
                      fontSize: 19,
                      fontWeight: '900',
                      marginLeft: 16,
                      flex: 1,
                    }}
                  >
                    {item.title}
                  </Text>
                  {item.value ? (
                    <Text style={{ color: '#aaa', fontSize: 16, fontWeight: '700' }}>
                      {item.value}
                    </Text>
                  ) : (
                    <Ionicons name="chevron-forward" size={22} color="#aaa" />
                  )}
                </TouchableOpacity>
              ))}
            </View>
          ))}

          {currentUser && (
            <TouchableOpacity
              style={{
                height: 64,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: '#4A1F1F',
                backgroundColor: '#151515',
                alignItems: 'center',
                justifyContent: 'center',
                marginTop: 6,
              }}
              onPress={handleLogout}
            >
              <Text style={{ color: '#FF6B6B', fontSize: 18, fontWeight: '900' }}>
                로그아웃
              </Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </View>
    );
  };

// ------------------------------------------------------------
  // 7. 화면: 홈 / 더보기 메뉴
  // ------------------------------------------------------------
  const HomeView = ({ favorites }: { favorites: any[] }) => !isUser ? (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={{ width: 88, alignItems: 'flex-start' }}>
          <Text style={styles.logoTextSmall}>
            See<Text style={{ color: BRAND_COLOR }}>Q</Text>
          </Text>
        </View>
        <Text style={[styles.headerTitle, { flex: 1, textAlign: 'center' }]}>보호자용</Text>
        <TouchableOpacity
          onPress={() => setCurrentScreen('login')}
          style={{ width: 88, alignItems: 'flex-end' }}
        >
          <Ionicons name="person-circle" size={30} color="white" />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 28 }}>
        <View
          style={{
            backgroundColor: '#111',
            borderRadius: 20,
            padding: 18,
            marginTop: 10,
            marginBottom: 14,
            borderWidth: 1,
            borderColor: '#252525',
          }}
        >
          <Text style={{ color: 'white', fontSize: 22, fontWeight: '900', marginBottom: 6 }}>
            관리 대상
          </Text>
          <Text style={{ color: '#aaa', fontSize: 14, marginBottom: 16 }}>
            위치를 확인할 가족을 선택하세요.
          </Text>

          {guardianTargets.length === 0 ? (
            <View
              style={{
                backgroundColor: '#1A1A1A',
                borderRadius: 16,
                padding: 18,
                marginBottom: 12,
                borderWidth: 1,
                borderColor: '#2A2A2A',
              }}
            >
              <Text style={{ color: 'white', fontSize: 17, fontWeight: '900' }}>
                아직 관리 대상이 없습니다.
              </Text>
              <Text style={{ color: '#aaa', fontSize: 13, lineHeight: 20, marginTop: 6 }}>
                아래 버튼을 눌러 위치를 확인할 가족을 추가하세요.
              </Text>
            </View>
          ) : (
            guardianTargets.map((target, index) => (
              <TouchableOpacity
                key={target.id}
                style={{
                  backgroundColor: '#1A1A1A',
                  borderRadius: 16,
                  padding: 14,
                  marginBottom: index === guardianTargets.length - 1 ? 12 : 10,
                  flexDirection: 'row',
                  alignItems: 'center',
                }}
                onPress={() => {
                  handleVoice(`${target.name}의 위치 화면으로 이동합니다`);
                  setSelectedGuardianTarget(target);
                  setCurrentScreen('pathLog');
                }}
              >
                <View
                  style={{
                    width: 46,
                    height: 46,
                    borderRadius: 23,
                    backgroundColor: '#2A2A2A',
                    justifyContent: 'center',
                    alignItems: 'center',
                    marginRight: 12,
                  }}
                >
                  <Ionicons name="person" size={24} color={BRAND_COLOR} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: 'white', fontSize: 17, fontWeight: '900' }}>
                    {target.name}
                  </Text>
                  <Text style={{ color: '#aaa', fontSize: 12, marginTop: 4 }}>
                    {target.userId ? `아이디 ${target.userId} · ${target.lastSeen || '아직 위치 확인 전'}` : target.lastSeen || '아직 위치 확인 전'}
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 10 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: BRAND_COLOR, marginRight: 6 }} />
                  <Text style={{ color: BRAND_COLOR, fontSize: 12, fontWeight: '900' }}>
                    {target.status || '안전'}
                  </Text>
                </View>
                <TouchableOpacity
 onPress={async () => {
  console.log('삭제 target', target);
  console.log('현재 사용자', currentUser?.uid);

  try {
      const targetUid = target.uid || target.id;
      const disconnectedAt = new Date().toISOString();

      await update(ref(db), {
        [`users/${targetUid}/pairedGuardian`]: null,
        [`profiles/${targetUid}/pairedGuardian`]: null,
        [`users/${currentUser.uid}/pairedUser`]: null,
        [`profiles/${currentUser.uid}/pairedUser`]: null,
      });

      update(ref(db), {
        [`guardianLinks/${currentUser.uid}/${targetUid}`]: null,
        [`connectionRequests/${targetUid}/${currentUser.uid}/status`]: 'disconnected',
        [`connectionRequests/${targetUid}/${currentUser.uid}/disconnectedAt`]: disconnectedAt,
        [`guardianSentRequests/${currentUser.uid}/${targetUid}/status`]: 'disconnected',
        [`guardianSentRequests/${currentUser.uid}/${targetUid}/disconnectedAt`]: disconnectedAt,
        [`pendingRequests/${targetUid}/${currentUser.uid}`]: null,
      }).catch((cleanupError) => {
        console.log('연결 해제 부가 기록 정리 실패', cleanupError);
      });

      setGuardianTargets(prev =>
        prev.filter(item => item.id !== target.id)
      );

      if (selectedGuardianTarget?.id === target.id) {
        setSelectedGuardianTarget(null);
      }

      Speech.stop();
      Speech.speak('연결이 해제되었습니다', {
        language: 'ko-KR',
      });

      Alert.alert(
        '삭제 완료',
        '보호자 연결이 해제되었습니다.'
      );
    } catch (error) {
  console.log('삭제 오류', error);

  Alert.alert(
    '삭제 오류',
    String(error)
  );
}
  }}
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 17,
                    backgroundColor: '#252525',
                    justifyContent: 'center',
                    alignItems: 'center',
                  }}
                >
                  <Ionicons name="trash-outline" size={18} color="#FF6B6B" />
                </TouchableOpacity>
              </TouchableOpacity>
            ))
          )}

          <TouchableOpacity
            onPress={addGuardianTarget}
            style={{
              backgroundColor: '#1A1A1A',
              borderRadius: 16,
              paddingVertical: 16,
              paddingHorizontal: 14,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1,
              borderColor: '#333',
            }}
          >
            <Ionicons name="add" size={24} color="white" />
            <Text style={{ color: 'white', fontSize: 16, fontWeight: '900', marginLeft: 8 }}>
              새로운 대상 추가
            </Text>
          </TouchableOpacity>
        </View>

        <View style={{ flexDirection: 'row', gap: 12, marginBottom: 12 }}>
          <TouchableOpacity
            style={{
              flex: 1,
              height: 118,
              borderRadius: 18,
              backgroundColor: '#151515',
              justifyContent: 'center',
              alignItems: 'center',
              borderWidth: 1,
              borderColor: '#252525',
            }}
            onPress={() => setCurrentScreen('pathLog')}
          >
            <Ionicons name="location" size={34} color={BRAND_COLOR} />
            <Text style={{ color: 'white', fontSize: 17, fontWeight: '900', marginTop: 10 }}>
              실시간 위치
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            disabled={!emergencyStatus}
            style={{
              flex: 1,
              height: 118,
              borderRadius: 18,
              backgroundColor: emergencyStatus ? '#351111' : '#151515',
              justifyContent: 'center',
              alignItems: 'center',
              borderWidth: 1,
              borderColor: emergencyStatus ? '#FF3B30' : '#252525',
            }}
            onPress={() => {
              Alert.alert(
                '긴급 위험 알림',
                '사용자가 긴급 도움을 요청했습니다. 현재 위치 화면으로 이동합니다.'
              );
              setCurrentScreen('pathLog');
            }}
          >
            <Ionicons
              name={emergencyStatus ? 'notifications' : 'notifications-outline'}
              size={34}
              color={emergencyStatus ? '#FF6B6B' : '#777'}
            />
            <Text style={{ color: 'white', fontSize: 17, fontWeight: '900', marginTop: 10 }}>
              위험 알림
            </Text>
            <Text style={{ color: emergencyStatus ? '#FFB4B4' : '#888', fontSize: 12, marginTop: 5 }}>
              {emergencyStatus ? '긴급 요청 수신' : '새 알림 없음'}
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={{
            backgroundColor: '#151515',
            borderRadius: 18,
            paddingVertical: 22,
            paddingHorizontal: 20,
            flexDirection: 'row',
            alignItems: 'center',
            marginBottom: 10,
            borderWidth: 1,
            borderColor: '#252525',
          }}
          onPress={() => requireLogin('videoList')}
        >
          <Ionicons name="videocam" size={30} color={BRAND_COLOR} />
          <Text style={{ color: 'white', fontSize: 18, fontWeight: '900', marginLeft: 14, flex: 1 }}>
            영상 기록
          </Text>
          <Ionicons name="chevron-forward" size={22} color="#777" />
        </TouchableOpacity>

        <TouchableOpacity
          style={{
            backgroundColor: '#151515',
            borderRadius: 18,
            paddingVertical: 20,
            paddingHorizontal: 18,
            flexDirection: 'row',
            alignItems: 'center',
            marginBottom: 10,
          }}
          onPress={() => setCurrentScreen('settings')}
        >
          <Ionicons name="settings" size={28} color={BRAND_COLOR} />
          <Text style={{ color: 'white', fontSize: 18, fontWeight: '900', marginLeft: 14, flex: 1 }}>
            설정
          </Text>
          <Ionicons name="chevron-forward" size={22} color="#777" />
        </TouchableOpacity>

        {currentUser && (
          <TouchableOpacity
            style={{
              backgroundColor: '#151515',
              borderRadius: 18,
              paddingVertical: 20,
              paddingHorizontal: 18,
              flexDirection: 'row',
              alignItems: 'center',
              borderWidth: 1,
              borderColor: '#3A1A1A',
            }}
            onPress={handleLogout}
          >
            <Ionicons name="log-out-outline" size={28} color="#FF6B6B" />
            <Text style={{ color: '#FF6B6B', fontSize: 18, fontWeight: '900', marginLeft: 14 }}>
              로그아웃
            </Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  ) : (
    <View style={styles.container}>
      {!isUser && emergencyStatus && (
        <TouchableOpacity
          style={styles.emergencyBanner}
          onPress={async () => {
            setEmergencyStatus(false);
            if (currentUser) {
              set(ref(db, `users/${currentUser.uid}/status`), {
                emergency: false,
                timestamp: new Date().toISOString(),
              }).catch(() => {
                console.log('긴급 상태 해제 실패');
              });
            }
          }}
        >
          <Text style={styles.emergencyBannerText}>사용자 긴급 도움 요청 발생!</Text>
        </TouchableOpacity>
      )}

      <View style={styles.header}>
        <TouchableOpacity onPress={() => setCurrentScreen('route')}>
          <Ionicons name="map" size={30} color={themeColor} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>더보기</Text>
        <TouchableOpacity onPress={() => setCurrentScreen('login')}>
          <Ionicons name="person-circle" size={30} color="white" />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 28 }}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={`주변 인식 연결. ${hazardAlerts.status}`}
          onPress={() => setCurrentScreen('hazardSettings')}
          style={{ backgroundColor: '#151515', borderRadius: 18, padding: 20, marginTop: 12, flexDirection: 'row', alignItems: 'center' }}
        >
          <Ionicons name="radio-outline" size={28} color={BRAND_COLOR} />
          <View style={{ marginLeft: 14, flex: 1 }}>
            <Text style={{ color: 'white', fontSize: 19, fontWeight: '800' }}>주변 인식 연결</Text>
            <Text style={{ color: '#aaa', fontSize: 14, marginTop: 6 }}>{hazardAlerts.status} · 연결 설정 및 경고 테스트</Text>
          </View>
          <Ionicons name="chevron-forward" size={22} color="#aaa" />
        </TouchableOpacity>
        <View style={{ flexDirection: 'row', gap: 12, marginTop: 12, marginBottom: 12 }}>
          <TouchableOpacity
            style={{
              flex: 1,
              height: 116,
              borderRadius: 18,
              backgroundColor: '#151515',
              justifyContent: 'center',
              alignItems: 'center',
            }}
            onPress={() => {
              if (!currentUser) {
                requireLogin('videoList');
                return;
              }

              handleVoice('영상 기록 화면으로 이동합니다');
              setCurrentScreen('videoList');
            }}
          >
            <Ionicons name="videocam" size={32} color={themeColor} />
            <Text style={{ color: 'white', fontSize: 18, fontWeight: '800', marginTop: 12 }}>
              영상 기록
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={{
              flex: 1,
              height: 116,
              borderRadius: 18,
              backgroundColor: '#151515',
              justifyContent: 'center',
              alignItems: 'center',
            }}
            onPress={async () => {
              if (!isUser) {
                setCurrentScreen('pathLog');
                return;
              }

              if (isUpdatingShare) return;

              if (!currentUser) {
                Alert.alert('로그인 필요', '위치 공유는 로그인 후 사용할 수 있습니다.');
                setCurrentScreen('login');
                return;
              }

              try {
                setIsUpdatingShare(true);
                const newValue = !shareLocation;
                await set(ref(db, `users/${currentUser.uid}/shareLocation`), newValue);
                setShareLocation(newValue);

                if (newValue && myLocation?.coords) {
                  const latitude = myLocation.coords.latitude;
                  const longitude = myLocation.coords.longitude;

                  await set(ref(db, `users/${currentUser.uid}/location`), {
                    latitude,
                    longitude,
                    timestamp: new Date().toISOString(),
                  });

                  lastLoggedLocationRef.current = { latitude, longitude };
                }
              } catch (error: any) {
                console.log('위치 공유 변경 실패', error);
                Alert.alert(
                  '위치 공유 실패',
                  'Firebase 권한 때문에 위치 공유를 저장하지 못했습니다. Realtime Database 규칙에서 로그인 사용자가 자신의 users/{uid} 경로에 쓸 수 있는지 확인해 주세요.'
                );
              } finally {
                setTimeout(() => setIsUpdatingShare(false), 300);
              }
            }}
          >
            <Ionicons name={shareLocation ? 'people' : 'people-outline'} size={32} color={themeColor} />
            <Text style={{ color: 'white', fontSize: 18, fontWeight: '800', marginTop: 12 }}>
              위치 공유
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={{
            backgroundColor:
  emergencyStatus
    ? '#2E7D32'
    : sosConfirmMode
    ? '#FF8F00'
    : '#B32626',
            borderRadius: 18,
            minHeight: 94,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 12,
          }}
         onPress={
  isUser
    ? async () => {

        // 이미 SOS 활성화 상태면 해제
        if (emergencyStatus) {

          setEmergencyStatus(false);

          if (currentUser) {
            await set(
              ref(db, `users/${currentUser.uid}/status`),
              {
                emergency: false,
                timestamp: new Date().toISOString(),
              }
            );
          }

          Speech.stop();
          Speech.speak(
            '긴급 도움 요청이 해제되었습니다',
            { language: 'ko-KR' }
          );

          return;
        }

        // 첫 클릭
        if (!sosConfirmMode) {

          setSosConfirmMode(true);

          Speech.stop();
          Speech.speak(
            '긴급 도움 요청을 보내시겠습니까. 두번 다시 눌러주세요.',
            { language: 'ko-KR' }
          );

          setTimeout(() => {
            setSosConfirmMode(false);
          }, 2000);

          return;
        }

        // 두 번째 클릭 → 실제 전송
        setSosConfirmMode(false);
        setEmergencyStatus(true);

        if (currentUser) {
          await set(
            ref(db, `users/${currentUser.uid}/status`),
            {
              emergency: true,
              timestamp: new Date().toISOString(),
            }
          );
        }

        Speech.stop();
        Speech.speak(
          '긴급 도움 요청이 전송되었습니다',
          { language: 'ko-KR' }
        );
      }
    : undefined
}
>

        
          <Ionicons name="alert-circle" size={34} color="white" />
          <Text
  style={{
    color: 'white',
    fontSize: 22,
    fontWeight: '900',
    marginLeft: 12,
  }}
>
  {!isUser
    ? '긴급 상황 모니터링 중'
    : emergencyStatus
    ? '도움 요청 중 (탭하여 해제)'
    : sosConfirmMode
    ? '다시 누르면 전송'
    : '긴급 도움 요청'}
</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={{
            backgroundColor: '#151515',
            borderRadius: 18,
            paddingVertical: 22,
            paddingHorizontal: 20,
            flexDirection: 'row',
            alignItems: 'center',
            marginBottom: 10,
          }}
          onPress={() => {
            setPathLogMode('menu');
            requireLogin('pathLog');
          }}
        >
          <Ionicons name="list" size={28} color="#aaa" />
          <Text style={{ color: 'white', fontSize: 19, fontWeight: '800', marginLeft: 16 }}>
            기록 보기
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={{
            backgroundColor: '#151515',
            borderRadius: 18,
            paddingVertical: 22,
            paddingHorizontal: 20,
            flexDirection: 'row',
            alignItems: 'center',
            marginBottom: 18,
          }}
          onPress={() => setCurrentScreen('settings')}
        >
          <Ionicons name="settings" size={28} color="#aaa" />
          <Text style={{ color: 'white', fontSize: 19, fontWeight: '800', marginLeft: 16 }}>
            설정
          </Text>
        </TouchableOpacity>

        {currentUser && (
          <TouchableOpacity
            style={{
              backgroundColor: '#151515',
              borderRadius: 18,
              paddingVertical: 22,
              paddingHorizontal: 20,
              flexDirection: 'row',
              alignItems: 'center',
              marginBottom: 18,
              borderWidth: 1,
              borderColor: '#333',
            }}
            onPress={handleLogout}
          >
            <Ionicons name="log-out-outline" size={28} color="#FF6B6B" />
            <Text style={{ color: '#FF6B6B', fontSize: 19, fontWeight: '900', marginLeft: 16 }}>
              로그아웃
            </Text>
          </TouchableOpacity>
        )}

        {isUser && (
          <View
            style={{
              borderWidth: 1,
              borderColor: shareLocation ? '#D2FF00' : '#333',
              backgroundColor: shareLocation ? '#202600' : '#111',
              borderRadius: 18,
              padding: 18,
              flexDirection: 'row',
              alignItems: 'center',
            }}
          >
            <Ionicons
              name={shareLocation ? 'lock-open' : 'lock-closed'}
              size={30}
              color={shareLocation ? '#D2FF00' : '#aaa'}
            />
            <View style={{ marginLeft: 14, flex: 1 }}>
              <Text style={{ color: 'white', fontSize: 17, fontWeight: '900' }}>
                {shareLocation ? '보호자 위치 공유 중' : '위치 공유가 꺼져 있습니다'}
              </Text>
              <Text style={{ color: '#aaa', fontSize: 13, marginTop: 5 }}>
                위치 공유 버튼을 누르면 보호자가 현재 위치를 확인할 수 있습니다.
              </Text>
              {!!myPairCode && (
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10 }}>
                  <Text style={{ color: '#D2FF00', fontSize: 16, fontWeight: '900', flex: 1 }}>
                    연결 코드 {myPairCode}
                  </Text>
                  <TouchableOpacity
                    onPress={refreshMyPairCode}
                    style={{
                      backgroundColor: '#252525',
                      borderRadius: 12,
                      paddingVertical: 8,
                      paddingHorizontal: 12,
                      borderWidth: 1,
                      borderColor: '#3A3A3A',
                    }}
                  >
                    <Text style={{ color: 'white', fontSize: 13, fontWeight: '900' }}>
                      변경
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
  // ------------------------------------------------------------
  // 9. 화면 라우팅
  // ------------------------------------------------------------
  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      {currentScreen === 'hazardSettings' && <HazardConnectionScreen controller={hazardAlerts} onBack={() => setCurrentScreen('home')} />}
      {currentScreen === 'login' && LoginView()}
      {currentScreen === 'signup' && SignupView()}
      {currentScreen === 'home' && <HomeView favorites={favorites} />}
      {currentScreen === 'settings' && (currentUser ? <SettingsView /> : LoginView())}
      {currentScreen === 'pathLog' && (!isUser || currentUser ? <PathLogView /> : LoginView())}
      {currentScreen === 'route' && (
        <RouteView
          isRecognitionOn={hazardAlerts.enabled}
          setIsRecognitionOn={hazardAlerts.setEnabled}
          recognitionStatus={hazardAlerts.status}
          routeCoords={routeCoords}
          myLocation={myLocation}
          themeColor={themeColor}
          heading={heading}
          userAddress={userAddress}
          destination={destination}
          setDestination={setDestination}
          setCurrentScreen={setCurrentScreen}
          getRoute={getRoute}
          searchPlace={searchPlace}
          setRouteCoords={setRouteCoords}
          setGuidePoints={setGuidePoints}
          setCurrentGuideIndex={setCurrentGuideIndex}
          guidePoints={guidePoints}
          currentGuideIndex={currentGuideIndex}
          searchResults={searchResults}
          setSearchResults={setSearchResults}
          searchPage={searchPage}
          setSearchPage={setSearchPage}
          hasMoreResults={hasMoreResults}
          setHasMoreResults={setHasMoreResults}
          recentPlaces={recentPlaces}
          setRecentPlaces={setRecentPlaces}
          favorites={favorites}
          setFavorites={setFavorites}
          mapRef={mapRef}
          isListening={isListening}
          startVoiceRecognition={startVoiceRecognition}
          destinationCoords={destinationCoords}
          setDestinationCoords={setDestinationCoords}
        />
      )}
      {currentScreen === 'cameraView' && (
        <View style={styles.container}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => setCurrentScreen('home')}>
              <Ionicons name="chevron-back" size={32} color={themeColor} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>현재 위치</Text>
            <View style={{ width: 32 }} />
          </View>

          <View style={{ flex: 1, paddingHorizontal: 24, paddingTop: 30 }}>
            <View
              style={{
                backgroundColor: '#111',
                borderRadius: 28,
                padding: 24,
                alignItems: 'center',
                marginBottom: 20,
              }}
            >
              <Ionicons name="camera" size={60} color={BRAND_COLOR} />

              <Text
                style={{
                  color: 'white',
                  fontSize: 24,
                  fontWeight: '800',
                  marginTop: 16,
                  textAlign: 'center',
                }}
              >
                카메라 연결 준비 중
              </Text>

              <Text
                style={{
                  color: '#aaa',
                  fontSize: 16,
                  marginTop: 10,
                  textAlign: 'center',
                  lineHeight: 24,
                }}
              >
                Raspberry Pi 카메라와 YOLO 객체 인식 모델을 연동해 보행 중 주변 장애물을 안내할 예정입니다.
              </Text>
            </View>

            <View
              style={{
                backgroundColor: '#111',
                borderRadius: 24,
                padding: 20,
                marginBottom: 14,
              }}
            >
              <Text style={{ color: BRAND_COLOR, fontSize: 18, fontWeight: '800', marginBottom: 12 }}>
                인식 예정 객체
              </Text>

              <Text style={{ color: 'white', fontSize: 17, marginBottom: 8 }}>• 사람</Text>
              <Text style={{ color: 'white', fontSize: 17, marginBottom: 8 }}>• 차량</Text>
              <Text style={{ color: 'white', fontSize: 17, marginBottom: 8 }}>• 장애물</Text>
              <Text style={{ color: 'white', fontSize: 17 }}>• 횡단보도 주변 위험 요소</Text>
            </View>

            <View
              style={{
                backgroundColor: '#1A1A1A',
                borderRadius: 24,
                padding: 20,
              }}
            >
              <Text style={{ color: 'white', fontSize: 18, fontWeight: '800', marginBottom: 10 }}>
                현재 구현 상태
              </Text>

              <Text style={{ color: '#aaa', fontSize: 16, lineHeight: 24 }}>
                현재는 GPS 기반 길찾기, 보호자 위치 공유, SOS 기능을 먼저 구현했으며,
                카메라 부품 수령 후 YOLO 인식 결과를 이 화면에 연결할 예정입니다.
              </Text>
            </View>
          </View>
        </View>
      )}
      {currentScreen === 'videoList' && currentUser && (
        <View style={styles.container}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => setCurrentScreen('home')}>
              <Ionicons name="chevron-back" size={32} color={themeColor} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>영상 기록</Text>
            <View style={{ width: 32 }} />
          </View>

          <View style={{ flex: 1, paddingHorizontal: 24, paddingTop: 30 }}>
            <View
              style={{
                backgroundColor: '#111',
                borderRadius: 28,
                padding: 24,
                marginBottom: 18,
              }}
            >
              <Ionicons name="videocam" size={54} color={BRAND_COLOR} />

              <Text style={{ color: 'white', fontSize: 24, fontWeight: '800', marginTop: 16 }}>
                인식 영상 기록 준비 중
              </Text>

              <Text style={{ color: '#aaa', fontSize: 16, lineHeight: 24, marginTop: 10 }}>
                YOLO 객체 인식 결과와 위험 감지 상황을 저장해 보호자 또는 사용자가 나중에 확인할 수 있도록 구성할 예정입니다.
              </Text>
            </View>

            <View style={{ backgroundColor: '#1A1A1A', borderRadius: 24, padding: 20 }}>
              <Text style={{ color: BRAND_COLOR, fontSize: 18, fontWeight: '800', marginBottom: 12 }}>
                저장 예정 정보
              </Text>

              <Text style={{ color: 'white', fontSize: 17, marginBottom: 8 }}>• 감지 시간</Text>
              <Text style={{ color: 'white', fontSize: 17, marginBottom: 8 }}>• 감지 객체</Text>
              <Text style={{ color: 'white', fontSize: 17, marginBottom: 8 }}>• 위험 상황 여부</Text>
              <Text style={{ color: 'white', fontSize: 17 }}>• 보호자 확인용 기록</Text>
            </View>
          </View>
        </View>
      )}
      {hazardAlerts.warning && (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={`${hazardAlerts.warning.isTest ? '테스트. ' : ''}${HAZARD_LABEL[hazardAlerts.warning.event]}. ${hazardAlerts.warning.message}. 경고 닫기`}
          style={[styles.hazardOverlay, { backgroundColor: hazardAlerts.warning.event === 'LEVEL1' ? '#FF7168' : '#D2FF00' }]}
          onPress={hazardAlerts.dismiss}
        >
          <Ionicons name="warning" size={30} color="black" />
          <View style={{ flex: 1 }}>
            <Text style={[styles.hazardText, { flex: 0, fontWeight: '900' }]}>{hazardAlerts.warning.isTest ? '[테스트] ' : ''}{HAZARD_LABEL[hazardAlerts.warning.event]}</Text>
            <Text style={[styles.hazardText, { flex: 0, marginTop: 5 }]}>{hazardAlerts.warning.message}</Text>
            {hazardAlerts.warning.ttc != null && <Text style={[styles.hazardText, { flex: 0, fontSize: 13, marginTop: 5 }]}>충돌 예상 {hazardAlerts.warning.ttc.toFixed(1)}초</Text>}
          </View>
          <Ionicons name="close" size={22} color="black" />
        </TouchableOpacity>
      )}
    </View>
  );
}
