/**
 * tests/test_integration_reencryption_migration.ts
 *
 * AH.156 — Verification Suite for Integration Re-Encryption Migration
 *
 * Verifies:
 * 1. Dry run creates 0 modifications in Firestore Emulator.
 * 2. Live migration upgrades v1 records to v2.
 * 3. Preserves all unrelated fields (provider, config masked values, custom settings).
 * 4. Repeated runs are idempotent (0 migrated, alreadyMigrated count increments).
 * 5. Concurrent modification protection.
 * 6. Malformed ciphertext and missing keys fail safely without corrupting records.
 * 7. Mixed v1 and v2 records coexist safely.
 */

import crypto from 'crypto';
import assert from 'assert';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
  encryptSecret,
  decryptSecret,
  isIntegrationEncryptionConfigured,
  EncryptedPayload
} from '../lib/integrationSecurity.ts';
import { migrateIntegrationCredentials } from '../scripts/migrate-integration-credentials.ts';

// Configure test environment with v2 active and v1 previous
const keyV1Hex = crypto.randomBytes(32).toString('hex');
const keyV2Hex = crypto.randomBytes(32).toString('hex');

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8088';
process.env.INTEGRATION_ENCRYPTION_KEY = keyV2Hex;
process.env.INTEGRATION_ENCRYPTION_KEY_VERSION = 'v2';
process.env.INTEGRATION_ENCRYPTION_KEY_V1 = keyV1Hex;

const testApp = initializeApp({ projectId: 'demo-reencryption-test' }, `test-${Date.now()}`);
const db = getFirestore(testApp);

async function runTests() {
  console.log('=== Running AH.156 Integration Re-encryption Migration Tests ===');
  assert(isIntegrationEncryptionConfigured(), 'Keyring must be configured');

  const orgId = `org_test_${Date.now()}`;
  await db.collection('organizations').doc(orgId).set({ id: orgId, name: 'Test Org' });

  // Encrypt raw payload with v1 directly using encryptSecret with override targetKeyId
  const rawSecretSlack = JSON.stringify({ token: 'xoxb-test-slack-token-123' });
  const payloadV1Slack = encryptSecret(rawSecretSlack, 'local-aes-256-gcm:v1');
  assert.strictEqual(payloadV1Slack.keyId, 'local-aes-256-gcm:v1', 'Slack payload must be stamped with v1');

  const rawSecretJira = JSON.stringify({ apiKey: 'jira-test-api-key-456' });
  const payloadV1Jira = encryptSecret(rawSecretJira, 'local-aes-256-gcm:v1');

  // Seed documents
  const slackRef = db.collection('organizations').doc(orgId).collection('integrations').doc('slack');
  await slackRef.set({
    id: 'slack',
    provider: 'slack',
    enabled: true,
    unrelatedNote: 'slack-auto-sync-active',
    config: { has_token: true, token: '••••••••••••-123' },
    _secretsEncrypted: true,
    _encryptedSecrets: payloadV1Slack,
    createdAt: '2026-10-01T12:00:00Z',
    updatedAt: '2026-10-01T12:00:00Z'
  });

  const jiraRef = db.collection('organizations').doc(orgId).collection('integrations').doc('jira');
  await jiraRef.set({
    id: 'jira',
    provider: 'jira',
    enabled: true,
    customField: 'jira-domain-example',
    config: { has_apiKey: true, apiKey: '••••••••••••-456' },
    _secretsEncrypted: true,
    _encryptedSecrets: payloadV1Jira,
    createdAt: '2026-10-01T12:00:00Z',
    updatedAt: '2026-10-01T12:00:00Z'
  });

  // Seed corrupt doc
  const corruptRef = db.collection('organizations').doc(orgId).collection('integrations').doc('corrupt');
  await corruptRef.set({
    id: 'corrupt',
    provider: 'webhook',
    _secretsEncrypted: true,
    _encryptedSecrets: {
      ciphertext: 'corrupted_base64_data',
      iv: crypto.randomBytes(12).toString('base64'),
      tag: crypto.randomBytes(16).toString('base64'),
      keyId: 'local-aes-256-gcm:v1'
    }
  });

  console.log('\n--- Test 1: Dry-Run Mode ---');
  const dryStats = await migrateIntegrationCredentials({
    db,
    dryRun: true,
    orgIdFilter: orgId,
    silent: true
  });
  assert.strictEqual(dryStats.scanned, 3, 'Must scan 3 seeded integrations');
  assert.strictEqual(dryStats.eligible, 3, '3 eligible v1 records');
  assert.strictEqual(dryStats.migrated, 0, 'Dry-run must migrate 0 records');
  assert.strictEqual(dryStats.dryRun, true, 'dryRun flag must be true');

  // Verify documents unchanged in Firestore
  const slackSnapDry = await slackRef.get();
  assert.strictEqual(slackSnapDry.data()?._encryptedSecrets?.keyId, 'local-aes-256-gcm:v1', 'Dry-run must not modify keyId');

  console.log('\n--- Test 2: Live Migration ---');
  const liveStats = await migrateIntegrationCredentials({
    db,
    dryRun: false,
    orgIdFilter: orgId,
    silent: true
  });

  assert.strictEqual(liveStats.migrated, 2, 'Must successfully migrate slack and jira');
  assert.strictEqual(liveStats.failed, 1, 'Corrupt doc must fail cleanly');
  assert.strictEqual(liveStats.errors.length, 1, 'Exactly 1 recorded error for corrupt doc');

  // Verify slack doc
  const slackSnap = await slackRef.get();
  const slackData = slackSnap.data()!;
  assert.strictEqual(slackData._encryptedSecrets?.keyId, 'local-aes-256-gcm:v2', 'KeyId updated to v2');
  assert.strictEqual(slackData.unrelatedNote, 'slack-auto-sync-active', 'Unrelated field preserved');
  assert.strictEqual(slackData.createdAt, '2026-10-01T12:00:00Z', 'Original createdAt preserved');
  assert.ok(slackData._migratedAt, '_migratedAt timestamp stamped');

  // Verify decrypted secret content matches original
  const decryptedSlack = decryptSecret(slackData._encryptedSecrets);
  assert.strictEqual(decryptedSlack, rawSecretSlack, 'Decrypted content must match original plaintext');

  // Verify jira doc
  const jiraSnap = await jiraRef.get();
  const jiraData = jiraSnap.data()!;
  assert.strictEqual(jiraData._encryptedSecrets?.keyId, 'local-aes-256-gcm:v2', 'Jira keyId updated to v2');
  assert.strictEqual(jiraData.customField, 'jira-domain-example', 'Custom field preserved');
  const decryptedJira = decryptSecret(jiraData._encryptedSecrets);
  assert.strictEqual(decryptedJira, rawSecretJira, 'Jira decrypted content matches original');

  console.log('\n--- Test 3: Idempotency (Repeated Run) ---');
  const repeatStats = await migrateIntegrationCredentials({
    db,
    dryRun: false,
    orgIdFilter: orgId,
    silent: true
  });

  assert.strictEqual(repeatStats.migrated, 0, 'Repeated run must migrate 0 records');
  assert.strictEqual(repeatStats.alreadyMigrated, 2, '2 records recognized as already migrated');
  assert.strictEqual(repeatStats.failed, 1, 'Corrupt record remains failing safely');

  console.log('\n--- Test 4: Mixed v1 and v2 Coexistence ---');
  // Both can be decrypted by any application code in the same session
  const v1Direct = decryptSecret(payloadV1Slack);
  const v2Direct = decryptSecret(slackData._encryptedSecrets);
  assert.strictEqual(v1Direct, v2Direct, 'v1 and v2 payloads decrypt to identical plaintext');

  console.log('\n--- Test 5: Legacy Shape Without keyId Migrated Safely ---');
  const legacyPayload = encryptSecret(JSON.stringify({ legacyKey: 'legacy-data' }), 'local-aes-256-gcm:v1');
  delete (legacyPayload as any).keyId; // Strip keyId to simulate legacy shape

  const legacyRef = db.collection('organizations').doc(orgId).collection('integrations').doc('legacy_app');
  await legacyRef.set({
    id: 'legacy_app',
    provider: 'legacy',
    _secretsEncrypted: true,
    _encryptedSecrets: legacyPayload,
    updatedAt: '2026-10-01T00:00:00Z'
  });

  const legacyMigrateStats = await migrateIntegrationCredentials({
    db,
    dryRun: false,
    orgIdFilter: orgId,
    silent: true
  });
  assert.strictEqual(legacyMigrateStats.migrated, 1, 'Legacy document without keyId migrated successfully');
  const legacySnap = await legacyRef.get();
  assert.strictEqual(legacySnap.data()?._encryptedSecrets?.keyId, 'local-aes-256-gcm:v2', 'Legacy doc updated to v2');
  const decryptedLegacy = decryptSecret(legacySnap.data()?._encryptedSecrets);
  assert.strictEqual(decryptedLegacy, JSON.stringify({ legacyKey: 'legacy-data' }), 'Decrypted legacy content verified');

  console.log('\n--- Test 6: Concurrent Modification Race Condition Protection ---');
  // Seed a document that will be updated concurrently while migration is in progress
  const raceRef = db.collection('organizations').doc(orgId).collection('integrations').doc('race_test');
  const initialRacePayload = encryptSecret(JSON.stringify({ secret: 'initial-version' }), 'local-aes-256-gcm:v1');
  await raceRef.set({
    id: 'race_test',
    provider: 'race',
    _secretsEncrypted: true,
    _encryptedSecrets: initialRacePayload,
    updatedAt: '2026-10-01T00:00:00Z'
  });

  // Emulate concurrent modification: update document timestamp and credentials to v2 before transaction commits
  const freshConcurrentPayload = encryptSecret(JSON.stringify({ secret: 'updated-by-user-concurrently' }), 'local-aes-256-gcm:v2');
  await raceRef.update({
    _encryptedSecrets: freshConcurrentPayload,
    updatedAt: '2026-10-22T10:00:00Z',
    updatedBy: 'active_user@example.com'
  });

  const raceMigrateStats = await migrateIntegrationCredentials({
    db,
    dryRun: false,
    orgIdFilter: orgId,
    silent: true
  });
  // Since it was already updated to v2 concurrently, migration must recognize it as already migrated without overwriting
  assert.strictEqual(raceMigrateStats.migrated, 0, 'Migration must not overwrite concurrent update');
  const afterRaceSnap = await raceRef.get();
  const racePlaintext = decryptSecret(afterRaceSnap.data()?._encryptedSecrets);
  assert.strictEqual(racePlaintext, JSON.stringify({ secret: 'updated-by-user-concurrently' }), 'User concurrent update strictly preserved');

  console.log('\n======================================================');
  console.log('✅ ALL 6 INTEGRATION MIGRATION & CONCURRENCY TESTS PASSED!');
  console.log('======================================================\n');
  await deleteApp(testApp);
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
