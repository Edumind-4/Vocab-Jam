import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, (firebaseConfig as any).firestoreDatabaseId);

// --- Required Helper Functions for App.tsx ---

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export const ensureAuth = async () => {
  if (!auth.currentUser) {
    try {
      await signInAnonymously(auth);
    } catch (error: any) {
      if (error.code === 'auth/admin-restricted-operation') {
        console.error("Anonymous Authentication is disabled in Firebase Console.");
        throw new Error("ADMIN_REQUIRED: Anonymous authentication must be enabled in the Firebase Console (Authentication > Sign-in method) for this app to work correctly.");
      }
      throw error;
    }
  }
  return auth.currentUser;
};

export const signInWithGoogle = async () => {
  const provider = new GoogleAuthProvider();
  return signInWithPopup(auth, provider);
};

export const handleFirestoreError = (error: any, operation: OperationType, path: string) => {
  console.error(`Firestore Error [${operation}] at ${path}:`, error);
  throw error;
};