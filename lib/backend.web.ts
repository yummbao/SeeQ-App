import { getApps, initializeApp, type FirebaseOptions } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getDatabase } from 'firebase/database';
import { exhibitionConfigError } from './backend-policy';

export const exhibitionConfig: FirebaseOptions = {
  apiKey: process.env.EXPO_PUBLIC_EXHIBITION_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_EXHIBITION_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_EXHIBITION_FIREBASE_PROJECT_ID,
  appId: process.env.EXPO_PUBLIC_EXHIBITION_FIREBASE_APP_ID,
  databaseURL: process.env.EXPO_PUBLIC_EXHIBITION_FIREBASE_DATABASE_URL,
};

export function createSeeqBackend(production: FirebaseOptions) {
  const backendError = exhibitionConfigError(exhibitionConfig, production);
  // A local inert instance keeps the map renderable before configuration.
  // Auth operations/listeners are gated by backendError; never fall back to production.
  const config = backendError ? { apiKey: 'exhibition-not-configured', projectId: 'seeq-exhibition-unconfigured', appId: 'unconfigured', databaseURL: 'https://seeq-exhibition-unconfigured.firebaseio.com' } : exhibitionConfig;
  const name = `seeq-exhibition-${config.projectId}`;
  const app = getApps().find(value => value.name === name) ?? initializeApp(config, name);
  return { auth: getAuth(app), db: getDatabase(app), backendError };
}
