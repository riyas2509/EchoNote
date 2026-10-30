/**
 * EchoNote Firebase Admin Isolation & Production Guard Regression Tests
 * File: tests/test_firebase_admin_isolation.ts
 *
 * Verifies that:
 * 1. Unspecified and local development environments NEVER silently target production Firestore DB or bucket.
 * 2. Test mode isolates to safe test resources.
 * 3. Emulator mode isolates to emulator defaults and rejects production overrides.
 * 4. Staging mode strictly isolates and fails closed if production DB/bucket are targeted.
 * 5. Production mode requires explicit authorization (ALLOW_PRODUCTION_RESOURCES=true, NODE_ENV=production).
 * 6. Conflicting environment variables fail closed immediately.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
  getFirebaseConfig,
  resetFirebaseAdminInstancesForTesting,
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
} from '../lib/firebaseAdmin.ts';

const originalEnv = { ...process.env };

function cleanEnv() {
  process.env = { ...originalEnv };
  delete process.env.NODE_ENV;
  delete process.env.STAGING_ISOLATION_REQUIRED;
  delete process.env.ALLOW_PRODUCTION_RESOURCES;
  delete process.env.FIRESTORE_DATABASE_ID;
  delete process.env.STORAGE_BUCKET;
  delete process.env.FIREBASE_STORAGE_BUCKET;
  delete process.env.GOOGLE_CLOUD_PROJECT;
  delete process.env.FIRESTORE_EMULATOR_HOST;
  delete process.env.FIREBASE_STORAGE_EMULATOR_HOST;
  resetFirebaseAdminInstancesForTesting();
}

let passed = 0;
let total = 0;

function test(description: string, fn: () => void) {
  total++;
  try {
    cleanEnv();
    fn();
    console.log(`  ✓ [PASS] ${description}`);
    passed++;
  } catch (err: any) {
    console.error(`  ✗ [FAIL] ${description}:`, err.message);
    throw err;
  }
}

console.log('=== Running Firebase Admin Isolation & Production Guard Tests ===\n');

// 1. Unspecified environment
test('1. Unspecified environment defaults to safe local dev resources, NOT production', () => {
  const cfg = getFirebaseConfig();
  assert.strictEqual(cfg.firestoreDatabaseId, DEFAULT_LOCAL_DEV_DB);
  assert.strictEqual(cfg.storageBucket, DEFAULT_LOCAL_DEV_BUCKET);
  assert.strictEqual(cfg.projectId, DEFAULT_LOCAL_DEV_PROJECT);
  assert.notStrictEqual(cfg.firestoreDatabaseId, KNOWN_PRODUCTION_DB);
  assert.notStrictEqual(cfg.storageBucket, KNOWN_PRODUCTION_BUCKET);
});

// 2. Local development environment
test('2. NODE_ENV=development defaults to safe local dev resources, NOT production', () => {
  process.env.NODE_ENV = 'development';
  const cfg = getFirebaseConfig();
  assert.strictEqual(cfg.firestoreDatabaseId, DEFAULT_LOCAL_DEV_DB);
  assert.strictEqual(cfg.storageBucket, DEFAULT_LOCAL_DEV_BUCKET);
});

// 3. Test environment
test('3. NODE_ENV=test defaults to safe isolated test resources', () => {
  process.env.NODE_ENV = 'test';
  const cfg = getFirebaseConfig();
  assert.strictEqual(cfg.firestoreDatabaseId, DEFAULT_TEST_DB);
  assert.strictEqual(cfg.storageBucket, DEFAULT_TEST_BUCKET);
  assert.strictEqual(cfg.projectId, DEFAULT_TEST_PROJECT);
});

// 4. Test environment honors explicit custom test DB
test('4. NODE_ENV=test honors explicit non-production test DB override', () => {
  process.env.NODE_ENV = 'test';
  process.env.FIRESTORE_DATABASE_ID = 'custom-hermetic-unit-test-db';
  const cfg = getFirebaseConfig();
  assert.strictEqual(cfg.firestoreDatabaseId, 'custom-hermetic-unit-test-db');
});

// 5. Test environment rejects production DB
test('5. NODE_ENV=test throws error if FIRESTORE_DATABASE_ID targets production DB', () => {
  process.env.NODE_ENV = 'test';
  process.env.FIRESTORE_DATABASE_ID = KNOWN_PRODUCTION_DB;
  assert.throws(() => getFirebaseConfig(), /prohibited in non-production environments/);
});

// 6. Test environment rejects production storage bucket
test('6. NODE_ENV=test throws error if STORAGE_BUCKET targets production bucket', () => {
  process.env.NODE_ENV = 'test';
  process.env.STORAGE_BUCKET = KNOWN_PRODUCTION_BUCKET;
  assert.throws(() => getFirebaseConfig(), /prohibited in non-production environments/);
});

// 7. Unspecified environment rejects production DB override
test('7. Unspecified environment throws error if FIRESTORE_DATABASE_ID targets production DB', () => {
  process.env.FIRESTORE_DATABASE_ID = KNOWN_PRODUCTION_DB;
  assert.throws(() => getFirebaseConfig(), /prohibited in non-production environments/);
});

// 8. Emulator mode
test('8. FIRESTORE_EMULATOR_HOST sets emulator defaults and isolates from cloud', () => {
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
  const cfg = getFirebaseConfig();
  assert.strictEqual(cfg.firestoreDatabaseId, DEFAULT_EMULATOR_DB);
  assert.strictEqual(cfg.storageBucket, DEFAULT_EMULATOR_BUCKET);
  assert.strictEqual(cfg.projectId, DEFAULT_EMULATOR_PROJECT);
});

// 9. Emulator mode rejects production DB
test('9. Emulator mode throws if production DB is configured as target', () => {
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
  process.env.FIRESTORE_DATABASE_ID = KNOWN_PRODUCTION_DB;
  assert.throws(() => getFirebaseConfig(), /prohibited in non-production environments/);
});

// 10. Staging mode requires explicit non-production DB
test('10. Staging mode fails closed when FIRESTORE_DATABASE_ID is missing', () => {
  process.env.STAGING_ISOLATION_REQUIRED = 'true';
  process.env.STORAGE_BUCKET = 'staging-test-bucket';
  assert.throws(() => getFirebaseConfig(), /FIRESTORE_DATABASE_ID is missing or empty/);
});

// 11. Staging mode fails closed when STORAGE_BUCKET is missing
test('11. Staging mode fails closed when STORAGE_BUCKET is missing', () => {
  process.env.STAGING_ISOLATION_REQUIRED = 'true';
  process.env.FIRESTORE_DATABASE_ID = 'staging-test-db';
  assert.throws(() => getFirebaseConfig(), /STORAGE_BUCKET is missing or empty/);
});

// 12. Staging mode rejects production DB
test('12. Staging mode refuses configuration targeting production DB', () => {
  process.env.STAGING_ISOLATION_REQUIRED = 'true';
  process.env.FIRESTORE_DATABASE_ID = KNOWN_PRODUCTION_DB;
  process.env.STORAGE_BUCKET = 'staging-test-bucket';
  assert.throws(() => getFirebaseConfig(), /FIRESTORE_DATABASE_ID is set to the production database/);
});

// 13. Staging mode rejects production bucket
test('13. Staging mode refuses configuration targeting production bucket', () => {
  process.env.STAGING_ISOLATION_REQUIRED = 'true';
  process.env.FIRESTORE_DATABASE_ID = 'staging-test-db';
  process.env.STORAGE_BUCKET = KNOWN_PRODUCTION_BUCKET;
  assert.throws(() => getFirebaseConfig(), /STORAGE_BUCKET is set to the production bucket/);
});

// 14. Explicit production mode succeeds with all required flags
test('14. Explicit production mode succeeds when NODE_ENV=production, ALLOW_PRODUCTION_RESOURCES=true, and project is echonote-2509', () => {
  process.env.NODE_ENV = 'production';
  process.env.ALLOW_PRODUCTION_RESOURCES = 'true';
  process.env.GOOGLE_CLOUD_PROJECT = KNOWN_PRODUCTION_PROJECT;

  const cfg = getFirebaseConfig();
  assert.strictEqual(cfg.firestoreDatabaseId, KNOWN_PRODUCTION_DB);
  assert.strictEqual(cfg.storageBucket, KNOWN_PRODUCTION_BUCKET);
  assert.strictEqual(cfg.projectId, KNOWN_PRODUCTION_PROJECT);
});

// 15. Production mode fails closed without ALLOW_PRODUCTION_RESOURCES=true
test('15. Production mode fails closed if ALLOW_PRODUCTION_RESOURCES is missing', () => {
  process.env.NODE_ENV = 'production';
  process.env.GOOGLE_CLOUD_PROJECT = KNOWN_PRODUCTION_PROJECT;
  assert.throws(() => getFirebaseConfig(), /ALLOW_PRODUCTION_RESOURCES is not 'true'/);
});

// 16. Production mode fails closed if project does not match production project
test('16. Production mode fails closed if GOOGLE_CLOUD_PROJECT does not match production', () => {
  process.env.NODE_ENV = 'production';
  process.env.ALLOW_PRODUCTION_RESOURCES = 'true';
  process.env.GOOGLE_CLOUD_PROJECT = 'some-other-project-id';
  assert.throws(() => getFirebaseConfig(), /Production mode requires project 'echonote-2509'/);
});

// 17. Conflict: Production and Staging modes both indicated
test('17. Conflicting flags: NODE_ENV=production + STAGING_ISOLATION_REQUIRED=true fails closed', () => {
  process.env.NODE_ENV = 'production';
  process.env.STAGING_ISOLATION_REQUIRED = 'true';
  process.env.ALLOW_PRODUCTION_RESOURCES = 'true';
  assert.throws(() => getFirebaseConfig(), /both production and staging modes are indicated/);
});

// 18. Conflict: ALLOW_PRODUCTION_RESOURCES=true with Staging mode
test('18. Conflicting flags: ALLOW_PRODUCTION_RESOURCES=true + STAGING_ISOLATION_REQUIRED=true fails closed', () => {
  process.env.STAGING_ISOLATION_REQUIRED = 'true';
  process.env.ALLOW_PRODUCTION_RESOURCES = 'true';
  process.env.FIRESTORE_DATABASE_ID = 'staging-db';
  process.env.STORAGE_BUCKET = 'staging-bucket';
  assert.throws(() => getFirebaseConfig(), /cannot be combined with staging mode/);
});

// 19. Conflict: ALLOW_PRODUCTION_RESOURCES=true with Test mode
test('19. Conflicting flags: ALLOW_PRODUCTION_RESOURCES=true + NODE_ENV=test fails closed', () => {
  process.env.NODE_ENV = 'test';
  process.env.ALLOW_PRODUCTION_RESOURCES = 'true';
  assert.throws(() => getFirebaseConfig(), /cannot be combined with test mode/);
});

// 20. Conflict: ALLOW_PRODUCTION_RESOURCES=true with Emulator
test('20. Conflicting flags: ALLOW_PRODUCTION_RESOURCES=true + FIRESTORE_EMULATOR_HOST fails closed', () => {
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
  process.env.ALLOW_PRODUCTION_RESOURCES = 'true';
  assert.throws(() => getFirebaseConfig(), /cannot be combined with active Firebase emulators/);
});

// 21. Production deploy script manifests include ALLOW_PRODUCTION_RESOURCES=true
test('21. Production deployment manifests explicitly include ALLOW_PRODUCTION_RESOURCES=true', () => {
  const deployScript = fs.readFileSync(path.join(process.cwd(), 'scripts', 'deploy-cloud-run.sh'), 'utf8');
  assert(deployScript.includes('ALLOW_PRODUCTION_RESOURCES=true'), 'scripts/deploy-cloud-run.sh must define ALLOW_PRODUCTION_RESOURCES=true');

  const b1aScript = fs.readFileSync(path.join(process.cwd(), 'deploy-cloud-run-B1A.sh'), 'utf8');
  assert(b1aScript.includes('ALLOW_PRODUCTION_RESOURCES=true'), 'deploy-cloud-run-B1A.sh must define ALLOW_PRODUCTION_RESOURCES=true');

  const declarativePrep = fs.readFileSync(path.join(process.cwd(), 'scripts', 'prepare-declarative-service.ts'), 'utf8');
  assert(declarativePrep.includes("ALLOW_PRODUCTION_RESOURCES: 'true'"), 'prepare-declarative-service.ts must define ALLOW_PRODUCTION_RESOURCES: true in DEFAULT_ORDINARY_ENV_VARS');
});

cleanEnv();
console.log(`\n======================================================`);
console.log(`✓ ALL ${passed}/${total} FIREBASE ADMIN ISOLATION TESTS PASSED!`);
console.log(`======================================================`);
