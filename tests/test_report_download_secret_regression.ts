
	/**
 * Requirement 24.15 - Focused Regression Tests for Dedicated Report Download Secret and Key Strength
 */

import assert from 'assert';
import crypto from 'crypto';
import {
  generateReportDownloadToken,
  verifyReportDownloadToken,
  getReportDownloadSecret,
  MIN_REPORT_DOWNLOAD_SECRET_LENGTH,
} from '../lib/recurringReportDeliveryService.ts';

async function runTests() {
  console.log('=== Running Requirement 24.15 Dedicated Secret & Key Strength Tests ===\n');

  const origDownloadSecret = process.env.REPORT_DOWNLOAD_SECRET;
  const origJwtSecret = process.env.JWT_SECRET;

  try {
    // 1. Missing REPORT_DOWNLOAD_SECRET fails generation
    delete process.env.REPORT_DOWNLOAD_SECRET;
    delete process.env.JWT_SECRET;

    console.log('Test 1: Missing REPORT_DOWNLOAD_SECRET causes token generation to fail');
    assert.throws(
      () => {
        generateReportDownloadToken({
          email: 'test@example.com',
          projectId: 'proj_123',
          artifactId: 'art_456',
          occurrenceId: 'occ_789',
        });
      },
      /CONFIG_ERROR: REPORT_DOWNLOAD_SECRET is not configured/
    );
    console.log('  [PASS] generateReportDownloadToken throws when REPORT_DOWNLOAD_SECRET is missing');

    // 2. Missing REPORT_DOWNLOAD_SECRET fails verification fail-closed
    console.log('\nTest 2: Missing REPORT_DOWNLOAD_SECRET causes token verification to fail closed');
    const dummyToken = 'eyJhbGciOiJIUzI1NiJ9.dummy_sig';
    const resultNoSecret = verifyReportDownloadToken(dummyToken);
    assert.strictEqual(resultNoSecret.valid, false);
    assert.strictEqual(resultNoSecret.error, 'Signing secret is not configured');
    console.log('  [PASS] verifyReportDownloadToken returns valid: false when secret is absent');

    // 3. JWT_SECRET alone is rejected and cannot act as fallback
    console.log('\nTest 3: JWT_SECRET alone is rejected and cannot act as a fallback');
    delete process.env.REPORT_DOWNLOAD_SECRET;
    process.env.JWT_SECRET = 'jwt_fallback_secret_with_more_than_32_characters_long_12345';
    assert.throws(
      () => {
        getReportDownloadSecret();
      },
      /CONFIG_ERROR: REPORT_DOWNLOAD_SECRET is not configured/
    );
    const jwtVerifyResult = verifyReportDownloadToken(dummyToken);
    assert.strictEqual(jwtVerifyResult.valid, false);
    assert.strictEqual(jwtVerifyResult.error, 'Signing secret is not configured');
    delete process.env.JWT_SECRET;
    console.log('  [PASS] JWT_SECRET is completely ignored and fallback is refused');

    // 4. Secret shorter than 32 characters is rejected
    console.log('\nTest 4: Secret shorter than 32 characters is rejected');
    process.env.REPORT_DOWNLOAD_SECRET = 'short_secret_20_chars';
    assert.throws(
      () => {
        getReportDownloadSecret();
      },
      /CONFIG_ERROR: REPORT_DOWNLOAD_SECRET must be at least 32 characters long/
    );
    console.log('  [PASS] Secrets with length < 32 are rejected with CONFIG_ERROR');

    // 5. Whitespace-only secret is rejected
    console.log('\nTest 5: Whitespace-only secret is rejected');
    process.env.REPORT_DOWNLOAD_SECRET = '                                 '; // 32 spaces
    assert.throws(
      () => {
        getReportDownloadSecret();
      },
      /CONFIG_ERROR: REPORT_DOWNLOAD_SECRET cannot be empty or whitespace-only/
    );
    console.log('  [PASS] Whitespace-only secret rejected');

    // 6. A 32-character test secret is accepted
    console.log('\nTest 6: Exactly 32-character test secret is accepted');
    const EXACT_32_CHAR_SECRET = '12345678901234567890123456789012';
    process.env.REPORT_DOWNLOAD_SECRET = EXACT_32_CHAR_SECRET;
    assert.strictEqual(getReportDownloadSecret(), EXACT_32_CHAR_SECRET);
    console.log('  [PASS] 32-character secret accepted without transformation');

    // 7. Valid token generates and verifies with configured secret
    console.log('\nTest 7: Valid token generates and verifies with configured secret');
    const validToken = generateReportDownloadToken({
      email: 'member@echonote.ai',
      projectId: 'proj_secret_audit',
      artifactId: 'art_report_test',
      occurrenceId: 'occ_run_test',
      expiresInSeconds: 1800,
    });
    assert.ok(typeof validToken === 'string' && validToken.includes('.'));
    const validResult = verifyReportDownloadToken(validToken);
    assert.strictEqual(validResult.valid, true);
    assert.strictEqual(validResult.claims?.email, 'member@echonote.ai');
    assert.strictEqual(validResult.claims?.projectId, 'proj_secret_audit');
    assert.strictEqual(validResult.claims?.artifactId, 'art_report_test');
    console.log('  [PASS] Token signed and verified successfully with dedicated secret');

    // 8. Token signed using different secret is rejected
    console.log('\nTest 8: Token signed using different secret is rejected');
    process.env.REPORT_DOWNLOAD_SECRET = 'alternative_valid_secret_key_that_is_32_chars_long';
    const diffSecretResult = verifyReportDownloadToken(validToken);
    assert.strictEqual(diffSecretResult.valid, false);
    assert.strictEqual(diffSecretResult.error, 'Invalid token signature');
    process.env.REPORT_DOWNLOAD_SECRET = EXACT_32_CHAR_SECRET;
    console.log('  [PASS] Token rejected when signature does not match active secret');

    // 9. Expired token is rejected
    console.log('\nTest 9: Expired token is rejected');
    const expiredToken = generateReportDownloadToken({
      email: 'member@echonote.ai',
      projectId: 'proj_secret_audit',
      artifactId: 'art_report_test',
      occurrenceId: 'occ_run_test',
      expiresInSeconds: -30,
    });
    const expiredResult = verifyReportDownloadToken(expiredToken);
    assert.strictEqual(expiredResult.valid, false);
    assert.strictEqual(expiredResult.error, 'Token has expired');
    console.log('  [PASS] Expired token correctly rejected');

    // 10. Tampered payload is rejected
    console.log('\nTest 10: Tampered payload is rejected');
    const [payloadB64, sig] = validToken.split('.');
    const decodedPayload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    decodedPayload.email = 'attacker@evil.com';
    const tamperedPayloadB64 = Buffer.from(JSON.stringify(decodedPayload)).toString('base64url');
    const tamperedToken = tamperedPayloadB64 + '.' + sig;
    const tamperedResult = verifyReportDownloadToken(tamperedToken);
    assert.strictEqual(tamperedResult.valid, false);
    assert.strictEqual(tamperedResult.error, 'Invalid token signature');
    console.log('  [PASS] Tampered payload signature mismatch detected');

    // 11. Malformed or wrong-length signatures are safely rejected
    console.log('\nTest 11: Malformed or wrong-length signatures are safely rejected without unexpected throw');
    const shortSigToken = payloadB64 + '.shortSig';
    const shortSigResult = verifyReportDownloadToken(shortSigToken);
    assert.strictEqual(shortSigResult.valid, false);
    assert.ok(shortSigResult.error === 'Signature verification failed' || shortSigResult.error === 'Invalid token signature');

    const longSigToken = payloadB64 + '.' + sig + 'extralongcharacters';
    const longSigResult = verifyReportDownloadToken(longSigToken);
    assert.strictEqual(longSigResult.valid, false);
    assert.ok(longSigResult.error === 'Signature verification failed' || longSigResult.error === 'Invalid token signature');

    const garbageToken = 'not_a_valid_token_structure';
    const garbageResult = verifyReportDownloadToken(garbageToken);
    assert.strictEqual(garbageResult.valid, false);
    assert.strictEqual(garbageResult.error, 'Malformed token structure');
    console.log('  [PASS] Malformed signatures handled safely without RangeError exception');

    console.log('\n=== All Requirement 24.15 Regression Tests PASSED (11/11 checks) ===');
  } finally {
    if (origDownloadSecret !== undefined) process.env.REPORT_DOWNLOAD_SECRET = origDownloadSecret;
    else delete process.env.REPORT_DOWNLOAD_SECRET;

    if (origJwtSecret !== undefined) process.env.JWT_SECRET = origJwtSecret;
    else delete process.env.JWT_SECRET;
  }
}

runTests().catch((err) => {
  console.error('\n[FAIL] Test suite encountered unexpected error:', err);
  process.exit(1);
});
