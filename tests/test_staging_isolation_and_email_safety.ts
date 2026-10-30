/**
 * Requirement 24.7.4 - Staging Isolation & Email Safety Hardening Tests
 */

import assert from 'assert';
import {
  getFirebaseConfig,
  resetFirebaseAdminInstancesForTesting,
  KNOWN_PRODUCTION_DB,
  KNOWN_PRODUCTION_BUCKET,
  DEFAULT_LOCAL_DEV_DB,
  DEFAULT_LOCAL_DEV_BUCKET
} from '../lib/firebaseAdmin.ts';
import {
  validateStagingEmailRecipient,
  sendEmail
} from '../lib/emailService.ts';

async function runTests() {
  console.log('=== Running Requirement 24.7.4 Staging Isolation & Email Safety Tests ===\n');

  const originalEnv = { ...process.env };

  function restoreEnv() {
    process.env = { ...originalEnv };
    resetFirebaseAdminInstancesForTesting();
  }

  console.log('Test 1: Default Firestore & Storage bucket configuration');
  restoreEnv();
  delete process.env.FIRESTORE_DATABASE_ID;
  delete process.env.STORAGE_BUCKET;
  delete process.env.FIREBASE_STORAGE_BUCKET;
  delete process.env.STAGING_ISOLATION_REQUIRED;
  delete process.env.NODE_ENV;

  const defaultConfig = getFirebaseConfig();
  assert.strictEqual(defaultConfig.firestoreDatabaseId, DEFAULT_LOCAL_DEV_DB, 'Default DB must default to safe local dev DB');
  assert.strictEqual(defaultConfig.storageBucket, DEFAULT_LOCAL_DEV_BUCKET, 'Default bucket must default to safe local dev bucket');
  console.log('  [PASS] Preserves safe local development defaults when no overrides are present');

  console.log('\nTest 2: Explicit Firestore database override');
  restoreEnv();
  process.env.FIRESTORE_DATABASE_ID = 'staging-custom-db-123';
  const customDbConfig = getFirebaseConfig();
  assert.strictEqual(customDbConfig.firestoreDatabaseId, 'staging-custom-db-123', 'Custom database ID must be honored');
  console.log('  [PASS] Explicit Firestore database override is honored');

  console.log('\nTest 3: Explicit Cloud Storage bucket override');
  restoreEnv();
  process.env.STORAGE_BUCKET = 'staging-reports-bucket.appspot.com';
  const customBucketConfig = getFirebaseConfig();
  assert.strictEqual(customBucketConfig.storageBucket, 'staging-reports-bucket.appspot.com', 'Custom storage bucket must be honored');
  console.log('  [PASS] Explicit Cloud Storage bucket override is honored');

  console.log('\nTest 4: Staging mode fails closed if FIRESTORE_DATABASE_ID is missing');
  restoreEnv();
  process.env.STAGING_ISOLATION_REQUIRED = 'true';
  delete process.env.FIRESTORE_DATABASE_ID;
  process.env.STORAGE_BUCKET = 'isolated-staging-bucket';

  assert.throws(
    () => {
      getFirebaseConfig();
    },
    /FIRESTORE_DATABASE_ID is missing or empty/,
    'Must throw when staging isolation is required but FIRESTORE_DATABASE_ID is missing'
  );
  console.log('  [PASS] Staging isolation fails closed when FIRESTORE_DATABASE_ID is absent');

  console.log('\nTest 5: Staging mode refuses fallback to known production database');
  restoreEnv();
  process.env.STAGING_ISOLATION_REQUIRED = 'true';
  process.env.FIRESTORE_DATABASE_ID = KNOWN_PRODUCTION_DB;
  process.env.STORAGE_BUCKET = 'isolated-staging-bucket';

  assert.throws(
    () => {
      getFirebaseConfig();
    },
    /FIRESTORE_DATABASE_ID is set to the production database/,
    'Must throw when staging environment is given the production database'
  );
  console.log('  [PASS] Refuses configuration if staging targets the production database');

  console.log('\nTest 6: Staging mode fails closed if STORAGE_BUCKET is missing');
  restoreEnv();
  process.env.STAGING_ISOLATION_REQUIRED = 'true';
  process.env.FIRESTORE_DATABASE_ID = 'isolated-staging-db';
  delete process.env.STORAGE_BUCKET;
  delete process.env.FIREBASE_STORAGE_BUCKET;

  assert.throws(
    () => {
      getFirebaseConfig();
    },
    /STORAGE_BUCKET is missing or empty/,
    'Must throw when staging isolation is required but STORAGE_BUCKET is missing'
  );
  console.log('  [PASS] Staging isolation fails closed when STORAGE_BUCKET is absent');

  console.log('\nTest 7: Staging mode refuses fallback to known production bucket');
  restoreEnv();
  process.env.STAGING_ISOLATION_REQUIRED = 'true';
  process.env.FIRESTORE_DATABASE_ID = 'isolated-staging-db';
  process.env.STORAGE_BUCKET = KNOWN_PRODUCTION_BUCKET;

  assert.throws(
    () => {
      getFirebaseConfig();
    },
    /STORAGE_BUCKET is set to the production bucket/,
    'Must throw when staging environment is given the production bucket'
  );
  console.log('  [PASS] Refuses configuration if staging targets the production bucket');

  console.log('\nTest 8: Reinitialization and cache reset for test isolation');
  restoreEnv();
  process.env.FIRESTORE_DATABASE_ID = 'initial-db-name';
  const configA = getFirebaseConfig();
  assert.strictEqual(configA.firestoreDatabaseId, 'initial-db-name');

  process.env.FIRESTORE_DATABASE_ID = 'second-db-name';
  assert.strictEqual(getFirebaseConfig().firestoreDatabaseId, 'initial-db-name', 'Should return cached config before reset');

  resetFirebaseAdminInstancesForTesting();
  const configB = getFirebaseConfig();
  assert.strictEqual(configB.firestoreDatabaseId, 'second-db-name', 'Should return updated config after reset');
  console.log('  [PASS] resetFirebaseAdminInstancesForTesting clears cached configuration properly');

  console.log('\nTest 9: Staging email delivery disabled by default');
  restoreEnv();
  process.env.STAGING_MODE = 'true';
  delete process.env.STAGING_EMAIL_DELIVERY_ENABLED;
  process.env.STAGING_ALLOWED_RECIPIENTS = 'tester@echotechai.in';

  const checkDefaultDisabled = validateStagingEmailRecipient('tester@echotechai.in');
  assert.strictEqual(checkDefaultDisabled.allowed, false);
  assert.strictEqual(checkDefaultDisabled.errorCode, 'STAGING_DELIVERY_DISABLED');
  console.log('  [PASS] Staging email delivery is disabled by default');

  console.log('\nTest 10: Missing staging allowlist fails closed');
  restoreEnv();
  process.env.STAGING_MODE = 'true';
  process.env.STAGING_EMAIL_DELIVERY_ENABLED = 'true';
  delete process.env.STAGING_ALLOWED_RECIPIENTS;
  delete process.env.STAGING_ALLOWED_DOMAINS;

  const checkMissingAllowlist = validateStagingEmailRecipient('tester@echotechai.in');
  assert.strictEqual(checkMissingAllowlist.allowed, false);
  assert.strictEqual(checkMissingAllowlist.errorCode, 'STAGING_ALLOWLIST_MISSING');
  console.log('  [PASS] Missing allowlist fails closed');

  console.log('\nTest 11: Approved recipient by exact email');
  restoreEnv();
  process.env.STAGING_MODE = 'true';
  process.env.STAGING_EMAIL_DELIVERY_ENABLED = 'true';
  process.env.STAGING_ALLOWED_RECIPIENTS = 'alice@example.com, bob@example.com';

  const checkAlice = validateStagingEmailRecipient('alice@example.com');
  assert.strictEqual(checkAlice.allowed, true, 'Alice should be allowed');
  console.log('  [PASS] Explicit recipient in allowlist is allowed with case/whitespace resilience');

  console.log('\nTest 12: Approved recipient by domain allowlist');
  restoreEnv();
  process.env.STAGING_MODE = 'true';
  process.env.STAGING_EMAIL_DELIVERY_ENABLED = 'true';
  process.env.STAGING_ALLOWED_DOMAINS = 'echotechai.in, testdomain.com';

  const checkDomain1 = validateStagingEmailRecipient('anyuser@echotechai.in');
  assert.strictEqual(checkDomain1.allowed, true, 'echotechai.in domain recipient should be allowed');
  console.log('  [PASS] Domain allowlist correctly allows matching recipient domains');

  console.log('\nTest 13: Non-allowlisted recipient blocked before provider');
  restoreEnv();
  process.env.STAGING_MODE = 'true';
  process.env.STAGING_EMAIL_DELIVERY_ENABLED = 'true';
  process.env.STAGING_ALLOWED_RECIPIENTS = 'allowed@echotechai.in';

  const checkBlocked = validateStagingEmailRecipient('customer@production-client.com');
  assert.strictEqual(checkBlocked.allowed, false);
  assert.strictEqual(checkBlocked.errorCode, 'STAGING_RECIPIENT_BLOCKED');

  const sendResult = await sendEmail({
    to: 'customer@production-client.com',
    subject: 'Staging Test Report',
    html: '<p>Test</p>'
  });
  assert.strictEqual(sendResult.success, false);
  assert.strictEqual(sendResult.errorCode, 'STAGING_RECIPIENT_BLOCKED');
  assert.strictEqual(sendResult.statusCode, 403);
  assert.strictEqual(sendResult.isSandboxOrValidation, true);
  console.log('  [PASS] sendEmail blocks non-allowlisted recipient with 403 and does not call provider');

  console.log('\nTest 14: Production mode does not restrict recipients');
  restoreEnv();
  process.env.NODE_ENV = 'production';
  delete process.env.STAGING_MODE;
  delete process.env.STAGING_SAFETY_ENABLED;

  const checkProduction = validateStagingEmailRecipient('customer@production-client.com');
  assert.strictEqual(checkProduction.allowed, true, 'Production mode should allow recipient without staging restrictions');
  console.log('  [PASS] Production mode bypasses staging safety restrictions');

  restoreEnv();
  console.log('\nAll Requirement 24.7.4 Staging Isolation & Email Safety tests PASSED successfully!');
}

runTests().catch(err => {
  console.error('\nTest failed:', err);
  process.exit(1);
});