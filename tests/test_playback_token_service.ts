/**
 * Tests for Hardened Playback Token Service
 *
 * Verifies:
 * 1. Dedicated secret produces valid signatures.
 * 2. Two service instances using the same secret verify each other's tokens.
 * 3. Different secrets reject each other's tokens.
 * 4. Missing secret fails closed in staging (generation throws, verification returns invalid).
 * 5. Missing secret fails closed in production (generation throws, verification returns invalid).
 * 6. Health-check startup remains functional without the playback secret (does not crash).
 * 7. Zero SESSION_SECRET fallback (SESSION_SECRET is completely ignored).
 * 8. Expired tokens are rejected.
 * 9. Invalid signatures and recording IDs are rejected.
 * 10. Staging isolation: Rejects production secret name or fixture.
 * 11. No secret values exposed in errors or diagnostics.
 */

import assert from 'assert';
import test from 'node:test';
import {
  generatePlaybackToken,
  verifyPlaybackToken,
  getPlaybackSecret,
  isRestrictedEnvironment,
  type PlaybackTokenPayload,
} from '../lib/playbackTokenService.ts';

const SAMPLE_PAYLOAD: PlaybackTokenPayload = {
  uid: 'user_prod_tester_001',
  recId: 'rec_meeting_nov_2026',
  email: 'auditor@echonote.staging.internal',
  platform_admin: false,
  role: 'member',
};

// Original environment snapshot
const origPlaybackSecret = process.env.PLAYBACK_SECRET;
const origSessionSecret = process.env.SESSION_SECRET;
const origStagingIsolation = process.env.STAGING_ISOLATION_REQUIRED;
const origNodeEnv = process.env.NODE_ENV;
const origKService = process.env.K_SERVICE;

function restoreEnv() {
  if (origPlaybackSecret !== undefined) process.env.PLAYBACK_SECRET = origPlaybackSecret;
  else delete process.env.PLAYBACK_SECRET;

  if (origSessionSecret !== undefined) process.env.SESSION_SECRET = origSessionSecret;
  else delete process.env.SESSION_SECRET;

  if (origStagingIsolation !== undefined) process.env.STAGING_ISOLATION_REQUIRED = origStagingIsolation;
  else delete process.env.STAGING_ISOLATION_REQUIRED;

  if (origNodeEnv !== undefined) process.env.NODE_ENV = origNodeEnv;
  else delete process.env.NODE_ENV;

  if (origKService !== undefined) process.env.K_SERVICE = origKService;
  else delete process.env.K_SERVICE;
}

test.beforeEach(() => {
  restoreEnv();
});

test.after(() => {
  restoreEnv();
});

// ---------------------------------------------------------------------------
// 1. Dedicated secret produces valid signatures
// ---------------------------------------------------------------------------
test('1. Dedicated secret produces valid HMAC-SHA256 signatures and payload', () => {
  process.env.PLAYBACK_SECRET = 'dedicated_staging_secret_32_characters_12345';
  process.env.NODE_ENV = 'staging';
  process.env.STAGING_ISOLATION_REQUIRED = 'true';

  const tokenResult = generatePlaybackToken(SAMPLE_PAYLOAD, 900);
  assert.ok(tokenResult.token, 'Token string must exist');
  assert.strictEqual(tokenResult.expiresIn, 900);
  assert.ok(tokenResult.expiresAt > Date.now());

  const parts = tokenResult.token.split('.');
  assert.strictEqual(parts.length, 2, 'Token must have encodedData and signature');

  const verifyResult = verifyPlaybackToken(tokenResult.token);
  assert.strictEqual(verifyResult.valid, true);
  assert.strictEqual(verifyResult.data?.uid, SAMPLE_PAYLOAD.uid);
  assert.strictEqual(verifyResult.data?.recId, SAMPLE_PAYLOAD.recId);
});

// ---------------------------------------------------------------------------
// 2. Two service instances using the same secret verify each other's tokens
// ---------------------------------------------------------------------------
test("2. Two Cloud Run service instances using the same secret verify each other's tokens", () => {
  const sharedClusterSecret = 'cluster_wide_shared_secret_hex_32_chars_ok';

  // Cloud Run Instance 1 receives token generation request
  process.env.PLAYBACK_SECRET = sharedClusterSecret;
  process.env.K_SERVICE = 'echonote-staging';
  process.env.NODE_ENV = 'staging';
  const instance1Result = generatePlaybackToken(SAMPLE_PAYLOAD, 900);

  // Cloud Run Instance 2 receives browser audio stream request
  process.env.PLAYBACK_SECRET = sharedClusterSecret;
  process.env.K_SERVICE = 'echonote-staging';
  process.env.NODE_ENV = 'staging';
  const instance2Verify = verifyPlaybackToken(instance1Result.token);

  assert.strictEqual(instance2Verify.valid, true);
  assert.strictEqual(instance2Verify.data?.recId, SAMPLE_PAYLOAD.recId);
  assert.strictEqual(instance2Verify.data?.uid, SAMPLE_PAYLOAD.uid);
});

// ---------------------------------------------------------------------------
// 3. Different secrets reject each other's tokens
// ---------------------------------------------------------------------------
test("3. Different secrets reject each other's tokens with Invalid token signature", () => {
  const secretA = 'secret_container_instance_alpha_1111111111111';
  const secretB = 'secret_container_instance_bravo_2222222222222';

  process.env.PLAYBACK_SECRET = secretA;
  const token = generatePlaybackToken(SAMPLE_PAYLOAD, 900).token;

  process.env.PLAYBACK_SECRET = secretB;
  const verifyResult = verifyPlaybackToken(token);

  assert.strictEqual(verifyResult.valid, false);
  assert.strictEqual(verifyResult.error, 'Invalid token signature');
  assert.strictEqual(verifyResult.data, undefined);
});

// ---------------------------------------------------------------------------
// 4. Missing secret fails closed in staging
// ---------------------------------------------------------------------------
test('4. Missing secret fails closed in staging: generation throws, verification fails', () => {
  delete process.env.PLAYBACK_SECRET;
  delete process.env.SESSION_SECRET;
  process.env.NODE_ENV = 'staging';
  process.env.STAGING_ISOLATION_REQUIRED = 'true';

  assert.strictEqual(isRestrictedEnvironment(), true);

  // Startup / resolution does NOT crash
  const resolution = getPlaybackSecret();
  assert.strictEqual(resolution.configured, false);
  assert.strictEqual(resolution.secret, null);
  assert.strictEqual(resolution.source, 'NONE');

  // Generation fails closed with clear CONFIG_ERROR
  assert.throws(
    () => {
      generatePlaybackToken(SAMPLE_PAYLOAD);
    },
    /CONFIG_ERROR: PLAYBACK_SECRET is not configured/
  );

  // Verification fails closed with clear error message
  const dummyToken = 'eyJhbGciOiJIUzI1NiJ9.dummy_signature';
  const verifyResult = verifyPlaybackToken(dummyToken);
  assert.strictEqual(verifyResult.valid, false);
  assert.ok(
    verifyResult.error?.includes('PLAYBACK_SECRET is not configured'),
    `Expected error about missing PLAYBACK_SECRET, got: ${verifyResult.error}`
  );
});

// ---------------------------------------------------------------------------
// 5. Missing secret fails closed in production
// ---------------------------------------------------------------------------
test('5. Missing secret fails closed in production: generation throws, verification fails', () => {
  delete process.env.PLAYBACK_SECRET;
  delete process.env.SESSION_SECRET;
  process.env.NODE_ENV = 'production';
  process.env.K_SERVICE = 'echonote';

  assert.strictEqual(isRestrictedEnvironment(), true);

  // Startup resolution does NOT crash
  const resolution = getPlaybackSecret();
  assert.strictEqual(resolution.configured, false);
  assert.strictEqual(resolution.secret, null);

  // Generation fails closed
  assert.throws(
    () => {
      generatePlaybackToken(SAMPLE_PAYLOAD);
    },
    /CONFIG_ERROR: PLAYBACK_SECRET is not configured/
  );

  // Verification fails closed
  const verifyResult = verifyPlaybackToken('some.token');
  assert.strictEqual(verifyResult.valid, false);
  assert.ok(verifyResult.error?.includes('PLAYBACK_SECRET is not configured'));
});

// ---------------------------------------------------------------------------
// 6. Health-check startup remains functional without the playback secret
// ---------------------------------------------------------------------------
test('6. Health-check startup remains functional without the playback secret', () => {
  delete process.env.PLAYBACK_SECRET;
  delete process.env.SESSION_SECRET;
  process.env.NODE_ENV = 'staging';
  process.env.STAGING_ISOLATION_REQUIRED = 'true';
  process.env.K_SERVICE = 'echonote-staging';

  // Proves that querying playback secret status does NOT throw an unhandled exception
  assert.doesNotThrow(() => {
    const res = getPlaybackSecret();
    assert.strictEqual(res.configured, false);
  });
});

// ---------------------------------------------------------------------------
// 7. No SESSION_SECRET fallback
// ---------------------------------------------------------------------------
test('7. Zero SESSION_SECRET fallback: SESSION_SECRET is strictly ignored', () => {
  delete process.env.PLAYBACK_SECRET;
  process.env.SESSION_SECRET = 'legacy_session_secret_value_1234567890';
  process.env.NODE_ENV = 'staging';
  process.env.STAGING_ISOLATION_REQUIRED = 'true';

  // Even though SESSION_SECRET is set, PLAYBACK_SECRET is required; SESSION_SECRET must NOT be used
  const resolution = getPlaybackSecret();
  assert.strictEqual(resolution.configured, false);
  assert.notStrictEqual(resolution.source, 'SESSION_SECRET');
  assert.strictEqual(resolution.secret, null);

  // In local dev without PLAYBACK_SECRET, it uses EPHEMERAL_DEV, NOT SESSION_SECRET
  delete process.env.NODE_ENV;
  delete process.env.STAGING_ISOLATION_REQUIRED;
  delete process.env.K_SERVICE;

  const devRes = getPlaybackSecret();
  assert.strictEqual(devRes.source, 'EPHEMERAL_DEV');
  assert.notStrictEqual(devRes.secret, 'legacy_session_secret_value_1234567890');
});

// ---------------------------------------------------------------------------
// 8. Expired tokens are rejected
// ---------------------------------------------------------------------------
test('8. Expired playback tokens are strictly rejected', () => {
  process.env.PLAYBACK_SECRET = 'expiry_test_secret_32_characters_long_ok';

  // Token expired 10 seconds ago
  const expiredToken = generatePlaybackToken(SAMPLE_PAYLOAD, -10).token;
  const result = verifyPlaybackToken(expiredToken);

  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.error, 'Playback token expired');
});

// ---------------------------------------------------------------------------
// 9. Invalid signatures and recording IDs are rejected
// ---------------------------------------------------------------------------
test('9a. Tampered payload with original signature is rejected', () => {
  process.env.PLAYBACK_SECRET = 'tamper_test_secret_32_characters_long_ok';

  const token = generatePlaybackToken(SAMPLE_PAYLOAD, 900).token;
  const [encodedData, signature] = token.split('.');

  // Tamper recId
  const decoded = JSON.parse(Buffer.from(encodedData, 'base64url').toString('utf8'));
  decoded.recId = 'attacker_hijacked_recording';
  const tamperedEncoded = Buffer.from(JSON.stringify(decoded)).toString('base64url');

  const result = verifyPlaybackToken(`${tamperedEncoded}.${signature}`);
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.error, 'Invalid token signature');
});

test('9b. Recording ID mismatch is rejected when expectedRecId option is provided', () => {
  process.env.PLAYBACK_SECRET = 'recid_validation_secret_32_characters_ok';

  const token = generatePlaybackToken(SAMPLE_PAYLOAD, 900).token;

  // Matching recId succeeds
  const matchResult = verifyPlaybackToken(token, { expectedRecId: SAMPLE_PAYLOAD.recId });
  assert.strictEqual(matchResult.valid, true);

  // Mismatched recId fails
  const mismatchResult = verifyPlaybackToken(token, { expectedRecId: 'rec_different_target' });
  assert.strictEqual(mismatchResult.valid, false);
  assert.strictEqual(mismatchResult.error, 'Playback token does not match requested recording.');
});

// ---------------------------------------------------------------------------
// 10. Staging isolation: Rejects production secret name or fixture
// ---------------------------------------------------------------------------
test('10. Staging rejects production secret fixture or placeholder', () => {
  process.env.NODE_ENV = 'staging';
  process.env.STAGING_ISOLATION_REQUIRED = 'true';
  process.env.PLAYBACK_SECRET = 'echonote-playback-secret';

  assert.throws(
    () => {
      getPlaybackSecret();
    },
    /\[STAGING ISOLATION BREACH\]: Production secret name or fixture cannot be used as PLAYBACK_SECRET in staging/
  );
});

// ---------------------------------------------------------------------------
// 11. No secret values exposed in errors or diagnostics
// ---------------------------------------------------------------------------
test('11. Error messages never disclose secret values', () => {
  const secretKey = 'super_secret_raw_key_do_not_leak_in_logs';
  process.env.PLAYBACK_SECRET = secretKey;

  const token = generatePlaybackToken(SAMPLE_PAYLOAD, 900).token;

  // Verify failure with mismatched secret
  process.env.PLAYBACK_SECRET = 'different_secret_99999999999999999999';
  const res = verifyPlaybackToken(token);

  assert.strictEqual(res.valid, false);
  assert.ok(!res.error?.includes(secretKey), 'Secret value must not appear in error');
  assert.ok(!res.error?.includes('different_secret'), 'Secret value must not appear in error');
});

// ---------------------------------------------------------------------------
// 12. Local development ephemeral secret caching & multi-token validity
// ---------------------------------------------------------------------------
test('12. Local dev ephemeral secret is cached once per process and validates multiple tokens', () => {
  delete process.env.PLAYBACK_SECRET;
  delete process.env.SESSION_SECRET;
  delete process.env.NODE_ENV;
  delete process.env.STAGING_ISOLATION_REQUIRED;
  delete process.env.K_SERVICE;

  // Ensure local dev mode
  assert.strictEqual(isRestrictedEnvironment(), false);

  const res1 = getPlaybackSecret();
  const res2 = getPlaybackSecret();

  assert.strictEqual(res1.configured, true);
  assert.strictEqual(res1.isEphemeral, true);
  assert.strictEqual(res1.source, 'EPHEMERAL_DEV');
  assert.strictEqual(res1.secret, res2.secret, 'Ephemeral secret must be cached and not regenerated');

  // Generate two distinct tokens within the same local process
  const token1 = generatePlaybackToken({ ...SAMPLE_PAYLOAD, recId: 'rec_first_call' }, 900).token;
  const token2 = generatePlaybackToken({ ...SAMPLE_PAYLOAD, recId: 'rec_second_call' }, 900).token;

  assert.notStrictEqual(token1, token2);

  // Both tokens verify successfully
  const verify1 = verifyPlaybackToken(token1, { expectedRecId: 'rec_first_call' });
  const verify2 = verifyPlaybackToken(token2, { expectedRecId: 'rec_second_call' });

  assert.strictEqual(verify1.valid, true);
  assert.strictEqual(verify1.data?.recId, 'rec_first_call');
  assert.strictEqual(verify2.valid, true);
  assert.strictEqual(verify2.data?.recId, 'rec_second_call');
});

// ---------------------------------------------------------------------------
// 13. Timing-safe comparison safely handles signatures of different lengths
// ---------------------------------------------------------------------------
test('13. Safely handles signatures of different lengths without throwing unhandled exceptions', () => {
  process.env.PLAYBACK_SECRET = 'timing_safe_test_secret_32_characters';

  const validToken = generatePlaybackToken(SAMPLE_PAYLOAD, 900).token;
  const [encodedData] = validToken.split('.');

  // Test signatures with unequal lengths
  const shortSigToken = `${encodedData}.short`;
  const singleCharSigToken = `${encodedData}.a`;
  const longSigToken = `${encodedData}.${'a'.repeat(256)}`;
  const emptySigToken = `${encodedData}.`;

  // Verify none throw RangeError or unhandled exception
  assert.doesNotThrow(() => {
    const resShort = verifyPlaybackToken(shortSigToken);
    assert.strictEqual(resShort.valid, false);
    assert.strictEqual(resShort.error, 'Invalid token signature');

    const resSingle = verifyPlaybackToken(singleCharSigToken);
    assert.strictEqual(resSingle.valid, false);
    assert.strictEqual(resSingle.error, 'Invalid token signature');

    const resLong = verifyPlaybackToken(longSigToken);
    assert.strictEqual(resLong.valid, false);
    assert.strictEqual(resLong.error, 'Invalid token signature');

    const resEmpty = verifyPlaybackToken(emptySigToken);
    assert.strictEqual(resEmpty.valid, false);
    assert.strictEqual(resEmpty.error, 'Malformed token format');
  });
});
