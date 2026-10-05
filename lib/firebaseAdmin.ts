import fs from "fs";
import path from "path";
import admin from "firebase-admin";
import { initializeApp, getApps, App } from "firebase-admin/app";
import { getFirestore, Firestore } from "firebase-admin/firestore";

export interface FirebaseAppletConfig {
  projectId?: string;
  appId?: string;
  apiKey?: string;
  authDomain?: string;
  firestoreDatabaseId?: string;
  storageBucket?: string;
  messagingSenderId?: string;
  measurementId?: string;
  oAuthClientId?: string;
  recaptchaSiteKey?: string;
}

let cachedConfig: FirebaseAppletConfig | null = null;

/**
 * Loads the Firebase configuration from firebase-applet-config.json with environment fallbacks.
 */
export function getFirebaseConfig(): FirebaseAppletConfig {
  if (cachedConfig) return cachedConfig;

  let config: FirebaseAppletConfig = {};
  try {
    const configPath = path.join(process.cwd(), "firebase-applet-config.json");
    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    }
  } catch (e) {
    console.warn("⚠️ Failed to load firebase-applet-config.json in firebaseAdmin:", e);
  }

  // Canonical project and database defaults
  config.projectId = config.projectId || process.env.GOOGLE_CLOUD_PROJECT || "echonote-2509";
  config.firestoreDatabaseId = config.firestoreDatabaseId || "ai-studio-eb588566-0d1e-4ef9-bca0-1194fd2bb6d5";
  config.storageBucket = config.storageBucket || "echonote-2509.firebasestorage.app";

  cachedConfig = config;
  return cachedConfig;
}

export const firebaseConfig = getFirebaseConfig();
export const FIRESTORE_DATABASE_ID = firebaseConfig.firestoreDatabaseId || "ai-studio-eb588566-0d1e-4ef9-bca0-1194fd2bb6d5";

let appAdminInstance: App | null = null;

/**
 * Returns or initializes the canonical Firebase Admin App singleton.
 */
export function getFirebaseAdminApp(): App {
  if (appAdminInstance) return appAdminInstance;

  const existingApps = getApps();
  if (existingApps.length > 0) {
    appAdminInstance = existingApps[0];
    return appAdminInstance;
  }

  const config = getFirebaseConfig();
  try {
    appAdminInstance = initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: config.projectId,
      storageBucket: config.storageBucket
    });
  } catch (err) {
    console.warn("⚠️ Firebase Admin default credential init failed, falling back without explicit credential:", err);
    appAdminInstance = initializeApp({
      projectId: config.projectId,
      storageBucket: config.storageBucket
    });
  }

  return appAdminInstance;
}

export const appAdmin = getFirebaseAdminApp();

let dbInstance: Firestore | null = null;

/**
 * Returns the canonical Firestore instance targeting the authoritative named database.
 * Never defaults to '(default)'.
 */
export function getAdminFirestore(): Firestore {
  if (dbInstance) return dbInstance;

  const app = getFirebaseAdminApp();
  const config = getFirebaseConfig();
  const databaseId = config.firestoreDatabaseId || "ai-studio-eb588566-0d1e-4ef9-bca0-1194fd2bb6d5";

  dbInstance = getFirestore(app, databaseId);
  return dbInstance;
}

export const db: Firestore = getAdminFirestore();

export default {
  appAdmin,
  db,
  getAdminFirestore,
  getFirebaseAdminApp,
  getFirebaseConfig,
  firebaseConfig,
  FIRESTORE_DATABASE_ID
};
