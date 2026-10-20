/**
 * tests/test_phase1b_step1_2o_functions_runtime_readiness.ts
 *
 * EchoNote Phase 1B Step 1.2O: Firebase Cloud Functions Runtime and Encryption-Key Readiness
 */

import {
  parseEncryptionKey,
  getIntegrationKeyring,
  getActiveEncryptionKeyId,
  getIntegrationEncryptionKey,
  isIntegrationEncryptionConfigured,
  encryptSecret,
  decryptSecret,
  KEY_ID_PREFIX,
  DEFAULT_KEY_VERSION
} from '../lib/integrationSecurity.ts';
import { isJiraOAuthConfigured } from '../functions/index.ts';
import path from 'path';
import fs from 'fs';

let passedTests = 0;
let failedTests = 0;

function check(testId: string, description: string, condition: boolean, extra?: string) {
  if (condition) {
    console.log(`  ✅ PASS [${testId}]: ${description}`);
    passedTests++;
  } else {
    console.error(`  ❌ FAIL [${testId}]: ${description}${extra ? ` (${extra})` : ''}`);
    failedTests++;
  }
}

async function runStep12OTests() {
  console.log('='.repeat(80));
  console.log('EchoNote Phase 1B — Step 1.2O: Functions Runtime & Encryption-Key Readiness');
  console.log('='.repeat(80));

  const origEnv = { ...process.env };

  try {
    console.log('\n--- Suite 1: Functions v2 Generation & Module Exports ---');

    const functionsModule = await import('../functions/index.ts');

    check('F1-01', 'Functions module exports onAudioUpload trigger', typeof functionsModule.onAudioUpload === 'function');
    check('F1-02', 'Functions module exports sendInviteEmail callable', typeof functionsModule.sendInviteEmail === 'function');
    check('F1-03', 'Functions module exports acceptInvite callable', typeof functionsModule.acceptInvite === 'function');
    check('F1-04', 'Functions module exports createProject callable', typeof functionsModule.createProject === 'function');
    check('F1-05', 'Functions module exports getJiraAuthUrl callable', typeof functionsModule.getJiraAuthUrl === 'function');
    check('F1-06', 'Functions module exports exchangeJiraCode callable', typeof functionsModule.exchangeJiraCode === 'function');
    check('F1-07', 'Functions module exports syncToJira callable', typeof functionsModule.syncToJira === 'function');
    check('F1-08', 'Functions module exports isJiraOAuthConfigured helper', typeof functionsModule.isJiraOAuthConfigured === 'function');

    console.log('\n--- Suite 2: Jira Disabled-Until-Configured Validation ---');

    delete process.env.JIRA_CLIENT_ID;
    delete process.env.JIRA_CLIENT_SECRET;
    delete process.env.JIRA_REDIRECT_URI;
    check('J2-01', 'isJiraOAuthConfigured returns false when variables are absent', !isJiraOAuthConfigured());

    process.env.JIRA_CLIENT_ID = '[SET_VIA_SECRET_MANAGER]';
    process.env.JIRA_CLIENT_SECRET = 'valid-secret-123';
    process.env.JIRA_REDIRECT_URI = 'https://echonote-2509.web.app/auth/jira/callback';
    check('J2-02', 'isJiraOAuthConfigured returns false for placeholder JIRA_CLIENT_ID', !isJiraOAuthConfigured());

    process.env.JIRA_CLIENT_ID = 'valid-client-id-123';
    process.env.JIRA_CLIENT_SECRET = '[SET_VIA_SECRET_MANAGER]';
    check('J2-03', 'isJiraOAuthConfigured returns false for placeholder JIRA_CLIENT_SECRET', !isJiraOAuthConfigured());

    process.env.JIRA_CLIENT_ID = 'your_jira_client_id';
    process.env.JIRA_CLIENT_SECRET = 'your_jira_client_secret';
    check('J2-04', 'isJiraOAuthConfigured returns false for example template values', !isJiraOAuthConfigured());

    process.env.JIRA_CLIENT_ID = 'real-client-id';
    process.env.JIRA_CLIENT_SECRET = 'real-client-secret';
    delete process.env.JIRA_REDIRECT_URI;
    check('J2-05', 'isJiraOAuthConfigured returns false when JIRA_REDIRECT_URI is missing', !isJiraOAuthConfigured());

    process.env.JIRA_REDIRECT_URI = 'https://echonote-2509.web.app/auth/jira/callback';
    check('J2-06', 'isJiraOAuthConfigured returns true when genuine credentials are provided', isJiraOAuthConfigured());

    console.log('\n--- Suite 3: Encryption Keyring & Runtime Secret Wiring ---');

    delete process.env.INTEGRATION_ENCRYPTION_KEY;
    check('E3-01', 'isIntegrationEncryptionConfigured returns false when key is absent', !isIntegrationEncryptionConfigured());
    check('E3-02', 'getIntegrationEncryptionKey returns null when key is absent', getIntegrationEncryptionKey() === null);

    process.env.INTEGRATION_ENCRYPTION_KEY = 'too-short-key';
    check('E3-03', 'parseEncryptionKey rejects short key', parseEncryptionKey('too-short-key') === null);
    check('E3-04', 'isIntegrationEncryptionConfigured returns false for invalid key', !isIntegrationEncryptionConfigured());

    const validHexKey = 'a'.repeat(64);
    process.env.INTEGRATION_ENCRYPTION_KEY = validHexKey;
    process.env.INTEGRATION_ENCRYPTION_KEY_VERSION = 'v1';
    check('E3-05', 'parseEncryptionKey parses 64-hex char key to 32 bytes', parseEncryptionKey(validHexKey)?.length === 32);
    check('E3-06', 'isIntegrationEncryptionConfigured returns true for valid hex key', isIntegrationEncryptionConfigured());

    const keyring = getIntegrationKeyring();
    check('E3-07', 'Active key version defaults to local-aes-256-gcm:v1', keyring?.activeKeyId === `${KEY_ID_PREFIX}v1`);
    check('E3-08', 'Active key buffer is 32 bytes', keyring?.activeKey.length === 32);

    const testSecret = 'sample-jira-token-value-abc123xyz';
    const encrypted = encryptSecret(testSecret);
    check('E3-09', 'encryptSecret produces ciphertext, iv, tag, and keyId',
      Boolean(encrypted.ciphertext && encrypted.iv && encrypted.tag && encrypted.keyId)
    );
    check('E3-10', 'Ciphertext does not contain raw plaintext token', !encrypted.ciphertext.includes(testSecret));
    const decrypted = decryptSecret(encrypted);
    check('E3-11', 'decryptSecret successfully recovers original secret', decrypted === testSecret);

    process.env.INTEGRATION_ENCRYPTION_KEY = 'b'.repeat(64);
    process.env.INTEGRATION_ENCRYPTION_KEY_VERSION = 'v2';
    process.env.INTEGRATION_ENCRYPTION_PREVIOUS_KEYS = JSON.stringify({
      v1: validHexKey
    });

    const keyringV2 = getIntegrationKeyring();
    check('E3-12', 'Active key successfully updated to v2', keyringV2?.activeKeyId === `${KEY_ID_PREFIX}v2`);

    const decryptedHistorical = decryptSecret(encrypted);
    check('E3-13', 'Keyring resolves previous key (v1) to decrypt historical payload', decryptedHistorical === testSecret);

    console.log('\n--- Suite 4: Fail-Safe Security & Zero Secret Leakage ---');

    let tamperedErrorCaught = false;
    try {
      decryptSecret({
        ...encrypted,
        ciphertext: Buffer.from('corrupted-data').toString('hex')
      });
    } catch (e: any) {
      tamperedErrorCaught = true;
      check('S4-01', 'Decryption fails closed on tampered ciphertext', true);
      check('S4-02', 'Error message does not reveal secret or key bytes',
        !e.message.includes(testSecret) && !e.message.includes(validHexKey)
      );
    }
    if (!tamperedErrorCaught) check('S4-01', 'Decryption should have failed', false);

    let unknownVersionCaught = false;
    try {
      decryptSecret({
        ...encrypted,
        keyId: `${KEY_ID_PREFIX}v999`
      });
    } catch (e: any) {
      unknownVersionCaught = true;
      check('S4-03', 'Decryption fails closed on unconfigured key version', true);
      check('S4-04', 'Unknown key version error message is safe and unrevealing',
        !e.message.includes(testSecret)
      );
    }
    if (!unknownVersionCaught) check('S4-03', 'Decryption should have failed for unknown version', false);

    console.log('\n--- Suite 5: Cloud Functions Secret Declaration Inspection ---');

    const sourcePath = path.join(process.cwd(), 'functions', 'index.ts');
    const sourceContent = fs.readFileSync(sourcePath, 'utf8');

    check('C5-01', 'exchangeJiraCode declares secrets: [INTEGRATION_ENCRYPTION_KEY]',
      sourceContent.includes("secrets: ['INTEGRATION_ENCRYPTION_KEY']") ||
      sourceContent.includes('secrets: ["INTEGRATION_ENCRYPTION_KEY"]')
    );
    check('C5-02', 'syncToJira declares secrets: [INTEGRATION_ENCRYPTION_KEY]',
      (sourceContent.match(/secrets:\s*\[['"]INTEGRATION_ENCRYPTION_KEY['"]\]/g) || []).length >= 2
    );
    check('C5-03', 'functions/index.ts uses firebase-functions/v2/https',
      sourceContent.includes("from 'firebase-functions/v2/https'")
    );
    check('C5-04', 'functions/index.ts uses firebase-functions/v2/storage',
      sourceContent.includes("from 'firebase-functions/v2/storage'")
    );

  } finally {
    process.env = origEnv;
  }

  console.log('\n' + '='.repeat(80));
  console.log(`Results: ${passedTests} passed, ${failedTests} failed`);
  console.log('='.repeat(80));

  if (failedTests > 0) {
    process.exit(1);
  }
}

runStep12OTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
