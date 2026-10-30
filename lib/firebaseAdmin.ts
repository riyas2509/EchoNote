import fs from "fs";
import path from "path";
import admin from "firebase-admin";
import { initializeApp, getApps, App } from "firebase-admin/app";
import { getFirestore, Firestore } from "firebase-admin/firestore";
import { getStorage, Storage } from "firebase-admin/storage";

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

export const KNOWN_PRODUCTION_PROJECT = "echonote-2509";
export const KNOWN_PRODUCTION_DB = "ai-studio-eb588566-0d1e-4ef9-bca0-1194fd2bb6d5";
export const KNOWN_PRODUCTION_BUCKET = "echonote-2509.firebasestorage.app";

export const DEFAULT_TEST_PROJECT = "echonote-test";
export const DEFAULT_TEST_DB = "echonote-test-db";
export const DEFAULT_TEST_BUCKET = "echonote-test.appspot.com";

export const DEFAULT_EMULATOR_PROJECT = "echonote-emulator";
export const DEFAULT_EMULATOR_DB = "(default)";
export const DEFAULT_EMULATOR_BUCKET = "echonote-emulator.appspot.com";

export const DEFAULT_LOCAL_DEV_PROJECT = "echonote-local-dev";
export const DEFAULT_LOCAL_DEV_DB = "echonote-local-dev-db";
export const DEFAULT_LOCAL_DEV_BUCKET = "echonote-local-dev.appspot.com";

let cachedConfig: FirebaseAppletConfig | null = null;

/**
 * Loads the Firebase configuration with strict environment isolation.
 *
 * Requirements:
 * 1. Local development, tests, and unspecified environments must not silently select the production Firestore database or storage bucket.
 * 2. Explicit, validated environment configuration required for production access (NODE_ENV=production, ALLOW_PRODUCTION_RESOURCES=true).
 * 3. Conflicting environment settings (e.g., ALLOW_PRODUCTION_RESOURCES with staging, test, or emulator) fail closed.
 * 4. Staging isolation requires explicit non-production FIRESTORE_DATABASE_ID and STORAGE_BUCKET, failing closed on missing/production values.
 * 5. Emulator mode prefers emulator resources and strictly rejects production overrides.
 */
export function getFirebaseConfig(): FirebaseAppletConfig {
  if (cachedConfig) return cachedConfig;

  let fileConfig: FirebaseAppletConfig = {};
  try {
    const configPath = path.join(process.cwd(), "firebase-applet-config.json");
    if (fs.existsSync(configPath)) {
      fileConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
    }
  } catch (e) {
    console.warn("⚠️ Failed to load firebase-applet-config.json in firebaseAdmin:", e);
  }

  const nodeEnv = process.env.NODE_ENV?.trim();
  const isProductionMode = nodeEnv === "production";
  const isStagingMode =
    process.env.STAGING_ISOLATION_REQUIRED === "true" ||
    nodeEnv === "staging";
  const isTestMode = nodeEnv === "test";
  const hasEmulator = Boolean(
    process.env.FIRESTORE_EMULATOR_HOST?.trim() ||
    process.env.FIREBASE_STORAGE_EMULATOR_HOST?.trim()
  );
  const allowProduction = process.env.ALLOW_PRODUCTION_RESOURCES === "true";

  const firestoreDbEnv = process.env.FIRESTORE_DATABASE_ID?.trim();
  const storageBucketEnv = (process.env.STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET)?.trim();
  const gcpProjectEnv = process.env.GOOGLE_CLOUD_PROJECT?.trim();

  // --- 1. Conflicting Environment Settings ---
  if (isProductionMode && isStagingMode) {
    throw new Error(
      "[Firebase Admin Conflict]: Conflicting environment configuration: both production and staging modes are indicated."
    );
  }

  if (allowProduction && isStagingMode) {
    throw new Error(
      "[Firebase Admin Conflict]: ALLOW_PRODUCTION_RESOURCES=true cannot be combined with staging mode."
    );
  }

  if (allowProduction && isTestMode) {
    throw new Error(
      "[Firebase Admin Conflict]: ALLOW_PRODUCTION_RESOURCES=true cannot be combined with test mode."
    );
  }

  if (allowProduction && hasEmulator) {
    throw new Error(
      "[Firebase Admin Conflict]: ALLOW_PRODUCTION_RESOURCES=true cannot be combined with active Firebase emulators."
    );
  }

  const targetsProductionDb = firestoreDbEnv === KNOWN_PRODUCTION_DB;
  const targetsProductionBucket = storageBucketEnv === KNOWN_PRODUCTION_BUCKET;
  const targetsProductionProject = gcpProjectEnv === KNOWN_PRODUCTION_PROJECT;

  // --- 2. Staging Mode Isolation ---
  if (isStagingMode) {
    if (!firestoreDbEnv) {
      throw new Error(
        "[Firebase Configuration Error]: Staging isolation is required, but FIRESTORE_DATABASE_ID is missing or empty. Fail-closed: refusing fallback to production database."
      );
    }
    if (targetsProductionDb) {
      throw new Error(
        `[Firebase Configuration Error]: Staging isolation is required, but FIRESTORE_DATABASE_ID is set to the production database '${KNOWN_PRODUCTION_DB}'. Refusing to proceed.`
      );
    }
    if (!storageBucketEnv) {
      throw new Error(
        "[Firebase Configuration Error]: Staging isolation is required, but STORAGE_BUCKET is missing or empty. Fail-closed: refusing fallback to production storage bucket."
      );
    }
    if (targetsProductionBucket) {
      throw new Error(
        `[Firebase Configuration Error]: Staging isolation is required, but STORAGE_BUCKET is set to the production bucket '${KNOWN_PRODUCTION_BUCKET}'. Refusing to proceed.`
      );
    }
    if (targetsProductionProject) {
      throw new Error(
        `[Firebase Configuration Error]: Staging isolation is required, but GOOGLE_CLOUD_PROJECT is set to production project '${KNOWN_PRODUCTION_PROJECT}'. Refusing to proceed.`
      );
    }

    cachedConfig = {
      ...fileConfig,
      projectId: gcpProjectEnv || fileConfig.projectId || "echonote-staging",
      firestoreDatabaseId: firestoreDbEnv,
      storageBucket: storageBucketEnv,
    };
    return cachedConfig;
  }

  // --- 3. Explicit Production Mode ---
  if (isProductionMode) {
    if (!allowProduction) {
      throw new Error(
        "[Firebase Configuration Error]: NODE_ENV is set to production, but ALLOW_PRODUCTION_RESOURCES is not 'true'. Fail-closed: explicit authorization required."
      );
    }
    if (hasEmulator) {
      throw new Error(
        "[Firebase Configuration Error]: Production mode cannot run while emulator host is configured."
      );
    }
    if (gcpProjectEnv && gcpProjectEnv !== KNOWN_PRODUCTION_PROJECT) {
      throw new Error(
        `[Firebase Configuration Error]: Production mode requires project '${KNOWN_PRODUCTION_PROJECT}', but got '${gcpProjectEnv}'.`
      );
    }

    cachedConfig = {
      ...fileConfig,
      projectId: gcpProjectEnv || KNOWN_PRODUCTION_PROJECT,
      firestoreDatabaseId: firestoreDbEnv || fileConfig.firestoreDatabaseId || KNOWN_PRODUCTION_DB,
      storageBucket: storageBucketEnv || fileConfig.storageBucket || KNOWN_PRODUCTION_BUCKET,
    };
    return cachedConfig;
  }

  // --- 4. Guard: Non-Production Prohibited From Touching Production Resources ---
  if (targetsProductionDb || targetsProductionBucket || targetsProductionProject) {
    throw new Error(
      `[Firebase Admin Security]: Implicit or unauthenticated production resource selection is prohibited in non-production environments (NODE_ENV='${nodeEnv || "unspecified"}'). Explicit production mode with ALLOW_PRODUCTION_RESOURCES=true is required.`
    );
  }

  // --- 5. Emulator Mode ---
  if (hasEmulator) {
    cachedConfig = {
      ...fileConfig,
      projectId: gcpProjectEnv || DEFAULT_EMULATOR_PROJECT,
      firestoreDatabaseId: firestoreDbEnv || DEFAULT_EMULATOR_DB,
      storageBucket: storageBucketEnv || DEFAULT_EMULATOR_BUCKET,
    };
    return cachedConfig;
  }

  // --- 6. Test Mode ---
  if (isTestMode) {
    cachedConfig = {
      ...fileConfig,
      projectId: gcpProjectEnv || DEFAULT_TEST_PROJECT,
      firestoreDatabaseId: firestoreDbEnv || DEFAULT_TEST_DB,
      storageBucket: storageBucketEnv || DEFAULT_TEST_BUCKET,
    };
    return cachedConfig;
  }

  // --- 7. Local Development / Unspecified Mode ---
  cachedConfig = {
    ...fileConfig,
    projectId: gcpProjectEnv || DEFAULT_LOCAL_DEV_PROJECT,
    firestoreDatabaseId: firestoreDbEnv || DEFAULT_LOCAL_DEV_DB,
    storageBucket: storageBucketEnv || DEFAULT_LOCAL_DEV_BUCKET,
  };
  return cachedConfig;
}

export const firebaseConfig = getFirebaseConfig();
export const FIRESTORE_DATABASE_ID = firebaseConfig.firestoreDatabaseId || DEFAULT_LOCAL_DEV_DB;

let appAdminInstance: App | null = null;

/**
 * Returns or initializes the canonical Firebase Admin App singleton.
 */
export function getFirebaseAdminApp(): App {
  if (appAdminInstance) return appAdminInstance;

  const config = getFirebaseConfig();

  const existingApps = getApps();
  if (existingApps.length > 0) {
    appAdminInstance = existingApps[0];
    return appAdminInstance;
  }

  try {
    appAdminInstance = initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: config.projectId,
      storageBucket: config.storageBucket
    });
  } catch (err) {
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
 * Never defaults to '(default)' unless explicitly configured for the emulator.
 */
export function getAdminFirestore(): Firestore {
  if (dbInstance) return dbInstance;

  const app = getFirebaseAdminApp();
  const config = getFirebaseConfig();
  const databaseId = config.firestoreDatabaseId || DEFAULT_LOCAL_DEV_DB;

  dbInstance = getFirestore(app, databaseId);
  return dbInstance;
}

export const db: Firestore = getAdminFirestore();

let storageInstance: Storage | null = null;

/**
 * Returns the canonical Firebase Admin Storage instance configured for the environment bucket.
 */
export function getAdminStorage(): Storage {
  if (storageInstance) return storageInstance;
  const app = getFirebaseAdminApp();
  storageInstance = getStorage(app);
  return storageInstance;
}

/**
 * Returns a Google Cloud Storage Bucket reference targeting the configured storage bucket.
 */
export function getAdminBucket(customBucketName?: string) {
  const config = getFirebaseConfig();
  const bucketName = customBucketName || config.storageBucket || DEFAULT_LOCAL_DEV_BUCKET;
  return admin.storage().bucket(bucketName);
}

/** Resets the cached configuration and singleton instances (for testing & isolation) */
export function resetFirebaseAdminInstancesForTesting() {
  cachedConfig = null;
  dbInstance = null;
  storageInstance = null;
  appAdminInstance = null;
}

export default {
  appAdmin,
  db,
  getAdminFirestore,
  getAdminStorage,
  getAdminBucket,
  getFirebaseAdminApp,
  getFirebaseConfig,
  resetFirebaseAdminInstancesForTesting,
  firebaseConfig,
  FIRESTORE_DATABASE_ID,
  KNOWN_PRODUCTION_PROJECT,
  KNOWN_PRODUCTION_DB,
  KNOWN_PRODUCTION_BUCKET,
  DEFAULT_TEST_PROJECT,
  DEFAULT_TEST_DB,
  DEFAULT_TEST_BUCKET,
  DEFAULT_EMULATOR_PROJECT,
  DEFAULT_EMULATOR_DB,
  DEFAULT_EMULATOR_BUCKET,
  DEFAULT_LOCAL_DEV_PROJECT,
  DEFAULT_LOCAL_DEV_DB,
  DEFAULT_LOCAL_DEV_BUCKET,
};
