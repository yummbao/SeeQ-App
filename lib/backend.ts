import { getApps, initializeApp, type FirebaseOptions } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getDatabase } from 'firebase/database';

export function createSeeqBackend(config: FirebaseOptions) {
  const app = getApps().length === 0 ? initializeApp(config) : getApps()[0];
  return { auth: getAuth(app), db: getDatabase(app), backendError: '' };
}
