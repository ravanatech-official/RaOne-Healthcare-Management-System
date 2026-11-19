import { initializeApp } from 'firebase/app';
import {
  browserSessionPersistence,
  getAuth,
  GoogleAuthProvider,
  setPersistence,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleAuthProvider = new GoogleAuthProvider();

// Session-scoped persistence for shared-device safety (v4 §61.1)
setPersistence(auth, browserSessionPersistence).catch((err) => {
  console.error('Failed to configure session persistence:', err);
});
