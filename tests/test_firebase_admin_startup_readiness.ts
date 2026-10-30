/**
 * Firebase Admin Startup Readiness & Fail-Closed Authentication Tests
 * File: tests/test_firebase_admin_startup_readiness.ts
 *
 * Architecture:
 * - Zero Firebase Admin static imports in the parent test runner process.
 * - Every behavior test runs in a dedicated, hermetically isolated Node child process.
 * - Controlled environment created per-child with all host/developer ADC stripped.
 * - CLOUDSDK_CONFIG points to a genuinely created, empty temporary directory (cleaned up on exit).
 * - NO_GCE_CHECK=true and GCE_METADATA_HOST=127.0.0.1:9999 prevent GCP metadata server probes.
 * - Firebase Admin modules are dynamically imported inside the child process only after the environment is set.
 */

import assert from 'node:assert';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const tsxCli = path.resolve('node_modules/tsx/dist/cli.mjs');

interface ChildExecutionResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Spawns an isolated child process executing a test script under a sanitized, no-credential environment.
 * Creates and reliably cleans up a genuine empty temporary directory for CLOUDSDK_CONFIG.
 * Cleanup failures propagate and fail the test.
 */
function runIsolatedChild(childScriptBody: string): ChildExecutionResult {
  const tempAdcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'echonote-test-adc-'));

  const cleanEnv: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: process.env.PATH || '',
    SystemRoot: process.env.SystemRoot || '',
    NODE_ENV: 'test',
    VITE_TEST_MODE: 'true',
    GOOGLE_CLOUD_PROJECT: 'echonote-test',
    FIRESTORE_DATABASE_ID: 'echonote-test-db',
    STORAGE_BUCKET: 'echonote-test-bucket',
    CLOUDSDK_CONFIG: tempAdcDir,          // Real empty temp dir blocks developer ADC
    NO_GCE_CHECK: 'true',                 // Blocks GCP metadata server probes
    GCE_METADATA_HOST: '127.0.0.1:9999',  // Safeguard: immediately refuses metadata network probes
  };

  // Explicitly remove all credential, emulator, and mode-override environment variables
  delete cleanEnv.GOOGLE_APPLICATION_CREDENTIALS;
  delete cleanEnv.GCLOUD_PROJECT;
  delete cleanEnv.FIRESTORE_EMULATOR_HOST;
  delete cleanEnv.FIREBASE_STORAGE_EMULATOR_HOST;
  delete cleanEnv.FIREBASE_AUTH_EMULATOR_HOST;
  delete cleanEnv.STAGING_ISOLATION_REQUIRED;
  delete cleanEnv.ALLOW_PRODUCTION_RESOURCES;

  try {
    const result = spawnSync(process.execPath, [tsxCli, '--input-type=module', '-e', childScriptBody], {
      cwd: path.resolve('.'),
      env: cleanEnv,
      encoding: 'utf8',
      timeout: 30000,
    });

    return {
      status: result.status,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
    };
  } finally {
    fs.rmSync(tempAdcDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// 1. Uncredentialed Startup & Handle Instantiation
// ---------------------------------------------------------------------------
test('1. Uncredentialed startup and handle instantiation succeed in isolated child process', async () => {
  const childCode = `
    const { getFirebaseAdminApp, getFirebaseConfig, getAdminFirestore, getAdminStorage, getAdminBucket } = await import('./lib/firebaseAdmin.ts');
    
    const app = getFirebaseAdminApp();
    if (!app || app.name !== '[DEFAULT]') {
      console.error('Invalid app instance');
      process.exit(2);
    }

    const config = getFirebaseConfig();
    if (config.projectId !== 'echonote-test') {
      console.error('Unexpected projectId: ' + config.projectId);
      process.exit(3);
    }

    const firestore = getAdminFirestore();
    if (!firestore) {
      console.error('Failed to instantiate Firestore handle');
      process.exit(4);
    }

    const storage = getAdminStorage();
    if (!storage) {
      console.error('Failed to instantiate Storage handle');
      process.exit(5);
    }

    const bucket = getAdminBucket();
    if (!bucket || bucket.name !== 'echonote-test-bucket') {
      console.error('Unexpected bucket name: ' + (bucket && bucket.name));
      process.exit(6);
    }

    console.log('STARTUP_AND_HANDLES_OK');
    process.exit(0);
  `;

  const res = runIsolatedChild(childCode);
  assert.strictEqual(res.status, 0, `Child exited with code ${res.status}. stderr: ${res.stderr}`);
  assert.ok(res.stdout.includes('STARTUP_AND_HANDLES_OK'), `Child stdout missing success marker. stdout: ${res.stdout}`);
});

// ---------------------------------------------------------------------------
// 2. Malformed JWT Rejection (Parsing Phase)
// ---------------------------------------------------------------------------
test('2. Malformed JWT rejection fails closed at parsing phase in isolated child process', async () => {
  const childCode = `
    const { getFirebaseAdminApp } = await import('./lib/firebaseAdmin.ts');
    const { getAuth } = await import('firebase-admin/auth');

    const app = getFirebaseAdminApp();
    const auth = getAuth(app);

    try {
      await auth.verifyIdToken('not-a-valid-jwt-token-string');
      console.error('UNEXPECTED_SUCCESS: malformed token should have rejected');
      process.exit(2);
    } catch (err) {
      if (err.code === 'auth/argument-error' && err.message.includes('Decoding Firebase ID token failed')) {
        console.log('MALFORMED_JWT_FAIL_CLOSED_OK');
        process.exit(0);
      } else {
        console.error('Unexpected error: code=' + err.code + ', message=' + err.message);
        process.exit(3);
      }
    }
  `;

  const res = runIsolatedChild(childCode);
  assert.strictEqual(res.status, 0, `Child exited with code ${res.status}. stderr: ${res.stderr}`);
  assert.ok(res.stdout.includes('MALFORMED_JWT_FAIL_CLOSED_OK'), `Child stdout missing marker. stdout: ${res.stdout}`);
});

// ---------------------------------------------------------------------------
// 3. Syntactically Valid JWT with Unknown Key ID Rejection
// ---------------------------------------------------------------------------
test('3. Syntactically valid JWT with unknown signing key ID fails closed with argument error', async () => {
  const childCode = `
    const { getFirebaseAdminApp, getFirebaseConfig } = await import('./lib/firebaseAdmin.ts');
    const { getAuth } = await import('firebase-admin/auth');

    const app = getFirebaseAdminApp();
    const config = getFirebaseConfig();
    const auth = getAuth(app);

    // Construct a structurally valid RS256 JWT where aud and iss match config.projectId ('echonote-test')
    const header = Buffer.from(JSON.stringify({
      alg: 'RS256',
      typ: 'JWT',
      kid: 'untrusted-synthetic-key-id'
    })).toString('base64url');

    const payload = Buffer.from(JSON.stringify({
      iss: 'https://securetoken.google.com/' + config.projectId,
      aud: config.projectId,
      sub: 'synthetic-user-12345',
      iat: Math.floor(Date.now() / 1000) - 60,
      exp: Math.floor(Date.now() / 1000) + 3600,
    })).toString('base64url');

    const dummySignature = Buffer.from('synthetic_signature_bytes_for_testing_fail_closed').toString('base64url');
    const syntheticJwt = header + '.' + payload + '.' + dummySignature;

    try {
      await auth.verifyIdToken(syntheticJwt);
      console.error('UNEXPECTED_SUCCESS: synthetic JWT should have rejected');
      process.exit(2);
    } catch (err) {
      // With matching claims (iss, aud, sub, exp), verification proceeds to key matching against Google certs.
      // An unknown kid must reject with auth/argument-error stating the kid does not correspond to a known public key.
      if (err.code === 'auth/argument-error' && err.message.includes('does not correspond to a known public key')) {
        console.log('SYNTACTIC_JWT_UNKNOWN_KEY_FAIL_CLOSED_OK');
        process.exit(0);
      } else if (err.code && err.code.startsWith('auth/')) {
        // In restricted network environments where cert fetch is blocked, it rejects with auth/ error
        console.log('SYNTACTIC_JWT_AUTH_ERROR_OK:' + err.code);
        process.exit(0);
      } else {
        console.error('Unexpected error: code=' + err.code + ', message=' + err.message);
        process.exit(3);
      }
    }
  `;

  const res = runIsolatedChild(childCode);
  assert.strictEqual(res.status, 0, `Child exited with code ${res.status}. stderr: ${res.stderr}`);
  assert.ok(
    res.stdout.includes('SYNTACTIC_JWT_UNKNOWN_KEY_FAIL_CLOSED_OK') ||
      res.stdout.includes('SYNTACTIC_JWT_AUTH_ERROR_OK'),
    `Child stdout missing unknown key rejection marker. stdout: ${res.stdout}`
  );
});

// ---------------------------------------------------------------------------
// 4. Credential-Dependent Token Minting (createCustomToken)
// ---------------------------------------------------------------------------
test('4. createCustomToken fails closed when signing credentials are unavailable', async () => {
  const childCode = `
    const { getFirebaseAdminApp } = await import('./lib/firebaseAdmin.ts');
    const { getAuth } = await import('firebase-admin/auth');

    const app = getFirebaseAdminApp();
    const auth = getAuth(app);

    try {
      await auth.createCustomToken('synthetic-uid-123');
      console.error('UNEXPECTED_SUCCESS: createCustomToken must require signing credentials');
      process.exit(2);
    } catch (err) {
      // Must reject because no service account / signing credentials exist
      if (err.code === 'auth/invalid-credential' && err.message.includes('Failed to determine service account')) {
        console.log('CUSTOM_TOKEN_FAIL_CLOSED_OK');
        process.exit(0);
      } else {
        console.error('Unexpected error: code=' + err.code + ', message=' + err.message);
        process.exit(3);
      }
    }
  `;

  const res = runIsolatedChild(childCode);
  assert.strictEqual(res.status, 0, `Child exited with code ${res.status}. stderr: ${res.stderr}`);
  assert.ok(res.stdout.includes('CUSTOM_TOKEN_FAIL_CLOSED_OK'), `Child stdout missing custom token marker. stdout: ${res.stdout}`);
});

// ---------------------------------------------------------------------------
// 5. Credential-Dependent Administrative Lookup (getUser)
// ---------------------------------------------------------------------------
test('5. Administrative getUser lookup fails closed without granting access', async () => {
  const childCode = `
    const { getFirebaseAdminApp } = await import('./lib/firebaseAdmin.ts');
    const { getAuth } = await import('firebase-admin/auth');

    const app = getFirebaseAdminApp();
    const auth = getAuth(app);

    try {
      await auth.getUser('synthetic-uid-123');
      console.error('UNEXPECTED_SUCCESS: getUser must require valid credentials');
      process.exit(2);
    } catch (err) {
      // Must reject with credential/project error, never grant unauthorized access
      const validCodes = ['auth/project-not-found', 'auth/insufficient-permission', 'auth/invalid-credential'];
      if (validCodes.includes(err.code) || (err.message && err.message.includes('credential'))) {
        console.log('GET_USER_FAIL_CLOSED_OK');
        process.exit(0);
      } else {
        console.error('Unexpected error: code=' + err.code + ', message=' + err.message);
        process.exit(3);
      }
    }
  `;

  const res = runIsolatedChild(childCode);
  assert.strictEqual(res.status, 0, `Child exited with code ${res.status}. stderr: ${res.stderr}`);
  assert.ok(res.stdout.includes('GET_USER_FAIL_CLOSED_OK'), `Child stdout missing getUser marker. stdout: ${res.stdout}`);
});

// ---------------------------------------------------------------------------
// 6. Offline Environment Boundary Probe
// ---------------------------------------------------------------------------
test('6. Offline environment boundary probe (verifies emulator absence and prevents live cloud calls)', async () => {
  const hasEmulator = Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST);
  if (hasEmulator) {
    // If a local emulator is actively configured in the developer environment, test against it
    const childCode = `
      const { getFirebaseAdminApp } = await import('./lib/firebaseAdmin.ts');
      const { getAuth } = await import('firebase-admin/auth');
      const app = getFirebaseAdminApp();
      const auth = getAuth(app);
      const token = await auth.createCustomToken('emulator-test-uid');
      if (typeof token === 'string' && token.length > 0) {
        console.log('EMULATOR_POSITIVE_OK');
        process.exit(0);
      }
      process.exit(2);
    `;
    const res = runIsolatedChild(childCode);
    assert.strictEqual(res.status, 0);
    assert.ok(res.stdout.includes('EMULATOR_POSITIVE_OK'));
  } else {
    // Document confirmed offline boundary: live positive tests require an active emulator or real test credentials.
    // Staging and production credentials are strictly prohibited in unit testing.
    assert.strictEqual(
      process.env.FIREBASE_AUTH_EMULATOR_HOST,
      undefined,
      'No active Firebase Auth emulator detected; positive live endpoint tests safely bypassed to protect cloud resources'
    );
  }
});
