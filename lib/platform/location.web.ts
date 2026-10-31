import { PermissionStatus } from 'expo';
import type { LocationObject, LocationOptions, LocationSubscription } from 'expo-location';
export { Accuracy, reverseGeocodeAsync } from 'expo-location';
export type { LocationObject, LocationOptions, LocationSubscription } from 'expo-location';

function position(value: GeolocationPosition): LocationObject {
  return { timestamp: value.timestamp, coords: { latitude: value.coords.latitude, longitude: value.coords.longitude, altitude: value.coords.altitude, accuracy: value.coords.accuracy, altitudeAccuracy: value.coords.altitudeAccuracy, heading: value.coords.heading, speed: value.coords.speed } };
}
function geolocation(): Geolocation {
  if (typeof navigator === 'undefined' || !navigator.geolocation || !window.isSecureContext) throw new Error('실제 위치는 HTTPS 또는 localhost에서 브라우저 위치 권한을 허용해야 사용할 수 있습니다.');
  return navigator.geolocation;
}
export function getCurrentPositionAsync(_options?: LocationOptions): Promise<LocationObject> {
  return new Promise((resolve, reject) => {
    geolocation().getCurrentPosition(value => resolve(position(value)), reject, { enableHighAccuracy: true, timeout: 12000, maximumAge: 5000 });
  });
}
export async function requestForegroundPermissionsAsync() {
  try {
    await getCurrentPositionAsync();
    return { status: PermissionStatus.GRANTED, granted: true, canAskAgain: true, expires: 'never' as const };
  } catch {
    return { status: PermissionStatus.DENIED, granted: false, canAskAgain: true, expires: 'never' as const };
  }
}
export async function watchPositionAsync(_options: LocationOptions, callback: (value: LocationObject) => void): Promise<LocationSubscription> {
  const service = geolocation();
  const id = service.watchPosition(value => callback(position(value)), error => console.warn('[SeeQ] 브라우저 위치 수신 실패', error.message), { enableHighAccuracy: true, maximumAge: 5000, timeout: 12000 });
  return { remove: () => service.clearWatch(id) };
}
