import type * as Notifications from 'expo-notifications';

export function setNotificationHandler(_handler: Parameters<typeof Notifications.setNotificationHandler>[0]) {}
// Startup never triggers a browser permission prompt. The user can opt in in the web toolbar.
export async function requestPermissionsAsync() {
  const permission = typeof Notification === 'undefined' ? 'denied' : Notification.permission;
  return { status: permission === 'default' ? 'undetermined' : permission, granted: permission === 'granted', canAskAgain: permission === 'default', expires: 'never' };
}
export async function scheduleNotificationAsync(request: Parameters<typeof Notifications.scheduleNotificationAsync>[0]) {
  const id = `seeq-web-${Date.now()}`;
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try { new Notification(String(request.content.title ?? 'SeeQ'), { body: String(request.content.body ?? ''), tag: id }); } catch { /* In-app alert remains available on browsers without desktop notifications. */ }
  }
  return id;
}
