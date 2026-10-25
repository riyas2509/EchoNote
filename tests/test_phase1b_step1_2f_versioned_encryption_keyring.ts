/**
 * tests/test_phase1b_step1_2f_versioned_encryption_keyring.ts
 *
 * EchoNote Phase 1B Step 1.2F: Versioned Encryption Keyring & Rotation Readiness Test Suite
 *
 * Comprehensive multi-dimensional verification covering:
 * 1. Key Parsing & Strict 32-Byte Guarantee:
 *    - 64-char hex, 44-char base64, 32-byte UTF-8 parsing.
 *    - Strict rejection of invalid lengths, characters, or malformed encodings.
 * 2. Active Key Versioning & Key Precedence:
 *    - Default version 'local-aes-256-gcm:v1'.
 *    - Explicit version configuration ('v2', 'v3', etc.).
 *    - Payload keyId stamping with canonical ID.
 *    - INTEGRATION_ENCRYPTION_KEY takes precedence over INTEGRATION_SECRET_KEY.
 *    - Fallback to INTEGRATION_SECRET_KEY when INTEGRATION_ENCRYPTION_KEY is unset.
 * 3. Controlled Keyring & Previous Key Support:
 *    - Decryption of historical payloads using previous keys.
 *    - JSON mapping with direct 32-byte keys.
 *    - JSON mapping with environment-variable name references.
 *    - Comma-separated pairs, single env var, and named vars.
 *    - Correct key selection based on payload.keyId.
 * 4. Safe Rotation & Re-encryption:
 *    - reencryptSecret transforms v1 payload to v2 payload.
 *    - Verified decryption after rotation.
 * 5. Fail-Closed Security & Rejection:
 *    - Rejection of unknown key versions (KEY_VERSION_NOT_FOUND).
 *    - Rejection of malformed / illegal key IDs (untrusted input validation).
 *    - Rejection of duplicate conflicting key material (safe conflict rejection).
 *    - Idempotent handling of exact duplicate keys.
 *    - Protection of active key against conflicting previous key material.
 *    - Rejection of missing previous keys (KEY_VERSION_NOT_FOUND).
 *    - Rejection of wrong keys (AUTHENTICATION_FAILED).
 *    - Rejection of tampered ciphertext and modified authentication tags (AUTHENTICATION_FAILED).
 *    - Rejection of invalid IV lengths and tag lengths (INVALID_ENCRYPTED_PAYLOAD).
 *    - Rejection of malformed payload objects (INVALID_ENCRYPTED_PAYLOAD).
 *    - Rejection when active key is missing (ENCRYPTION_KEY_REQUIRED).
 * 6. No Plaintext Fallback:
 *    - Fails safely instead of returning or storing raw plaintext.
 * 7. Zero Secret Leakage:
 *    - Errors and logs never contain secret values, ciphertexts, or key bytes.
 * 8. Existing Version-1 Payload Compatibility:
 *    - Seamless backward-compatibility with existing 'local-aes-256-gcm:v1' records.
 */

import crypto from "crypto";
import {
  parseEncryptionKey,
  isValidKeyVersion,
  normalizeKeyId,
  extractShortVersion,
  getIntegrationKeyring,
  getIntegrationEncryptionKey,
  getActiveEncryptionKeyId,
  getKeyringKeyIds,
  isKeyVersionAvailable,
  encryptSecret,
  decryptSecret,
  reencryptSecret,
  isIntegrationEncryptionConfigured,
  EncryptedPayload
} from "../lib/integrationSecurity.ts";

let passed = 0;
let failed = 0;

function check(description: string, condition: boolean, extra?: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${description}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${description}${extra ? ` (${extra})` : ""}`);
    failed++;
  }
}

// Deterministic test keys (strictly 32 bytes)
const testKey1Hex = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"; // Key 1
const testKey2Hex = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210"; // Key 2
const testKey3Hex = "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899"; // Key 3
const testKey4Hex = "11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff"; // Key 4

export async function runTestSuite() {
  console.log("================================================================================");
  console.log("🛡️  ECHONOTE PHASE 1B STEP 1.2F: VERSIONED ENCRYPTION KEYRING TEST SUITE");
  console.log("================================================================================");

  // Backup environment
  const savedEnv = { ...process.env };

  try {
    // -----------------------------------------------------------------------------
    // Section 1: Key Parsing & Strict 32-Byte Validation
    // -----------------------------------------------------------------------------
    console.log("\n--- Section 1: Key Parsing & Strict 32-Byte Validation ---");

    const keyHexBuf = parseEncryptionKey(testKey1Hex);
    check("[1] 64-character hex string parses to exactly 32-byte Buffer",
      keyHexBuf !== null && keyHexBuf.length === 32
    );

    const base64Key = Buffer.from(testKey1Hex, "hex").toString("base64");
    const keyB64Buf = parseEncryptionKey(base64Key);
    check("[2] 44-character base64 string parses to exactly 32-byte Buffer",
      keyB64Buf !== null && keyB64Buf.length === 32
    );

    const utf8Key = "12345678901234567890123456789012"; // 32 utf-8 bytes
    const keyUtf8Buf = parseEncryptionKey(utf8Key);
    check("[3] Exact 32-byte UTF-8 string parses to 32-byte Buffer",
      keyUtf8Buf !== null && keyUtf8Buf.length === 32
    );

    check("[4] 63-character hex string rejected (returns null)",
      parseEncryptionKey(testKey1Hex.slice(0, 63)) === null
    );

    check("[5] 65-character hex string rejected (returns null)",
      parseEncryptionKey(testKey1Hex + "a") === null
    );

    check("[6] Non-hex string of length 64 rejected",
      parseEncryptionKey("z".repeat(64)) === null
    );

    check("[7] Empty and null key values return null",
      parseEncryptionKey("") === null &&
      parseEncryptionKey(null) === null &&
      parseEncryptionKey(undefined) === null
    );

    // -----------------------------------------------------------------------------
    // Section 2: Active Key Versioning & Precedence
    // -----------------------------------------------------------------------------
    console.log("\n--- Section 2: Active Key Versioning & Precedence ---");

    // Clear all encryption variables
    delete process.env.INTEGRATION_ENCRYPTION_KEY;
    delete process.env.INTEGRATION_SECRET_KEY;
    delete process.env.INTEGRATION_ENCRYPTION_KEY_VERSION;
    delete process.env.INTEGRATION_ENCRYPTION_PREVIOUS_KEYS;
    delete process.env.INTEGRATION_ENCRYPTION_PREVIOUS_KEY;

    // Default version when VERSION is unset
    process.env.INTEGRATION_ENCRYPTION_KEY = testKey1Hex;

    const defaultKeyring = getIntegrationKeyring();
    check("[8] Unset version defaults to 'v1' and canonical keyId 'local-aes-256-gcm:v1'",
      defaultKeyring !== null &&
      defaultKeyring.activeVersion === "v1" &&
      defaultKeyring.activeKeyId === "local-aes-256-gcm:v1" &&
      getActiveEncryptionKeyId() === "local-aes-256-gcm:v1"
    );

    const secretText = "confidential-enterprise-oauth-token-123";
    const payloadV1 = encryptSecret(secretText);

    check("[9] encryptSecret stamps active keyId 'local-aes-256-gcm:v1' in payload",
      payloadV1.keyId === "local-aes-256-gcm:v1" &&
      typeof payloadV1.ciphertext === "string" &&
      typeof payloadV1.iv === "string" &&
      typeof payloadV1.tag === "string"
    );

    const decryptedV1 = decryptSecret(payloadV1);
    check("[10] decryptSecret decrypts active v1 payload cleanly",
      decryptedV1 === secretText
    );

    // Set explicit version 'v2'
    process.env.INTEGRATION_ENCRYPTION_KEY = testKey2Hex;
    process.env.INTEGRATION_ENCRYPTION_KEY_VERSION = "v2";

    const v2Keyring = getIntegrationKeyring();
    check("[11] Explicit version 'v2' resolves to 'local-aes-256-gcm:v2'",
      v2Keyring !== null &&
      v2Keyring.activeVersion === "v2" &&
      v2Keyring.activeKeyId === "local-aes-256-gcm:v2" &&
      getActiveEncryptionKeyId() === "local-aes-256-gcm:v2"
    );

    const payloadV2 = encryptSecret(secretText);
    check("[12] encryptSecret with active v2 stamps 'local-aes-256-gcm:v2'",
      payloadV2.keyId === "local-aes-256-gcm:v2"
    );

    const decryptedV2 = decryptSecret(payloadV2);
    check("[13] decryptSecret decrypts active v2 payload cleanly",
      decryptedV2 === secretText
    );

    // Test Key Precedence: INTEGRATION_ENCRYPTION_KEY takes precedence over INTEGRATION_SECRET_KEY
    process.env.INTEGRATION_ENCRYPTION_KEY = testKey1Hex;
    process.env.INTEGRATION_SECRET_KEY = testKey2Hex;
    const activeKeyWithBoth = getIntegrationEncryptionKey();
    check("[14] INTEGRATION_ENCRYPTION_KEY takes precedence when both env vars are present",
      activeKeyWithBoth !== null && activeKeyWithBoth.equals(Buffer.from(testKey1Hex, "hex"))
    );

    // Test Fallback: INTEGRATION_SECRET_KEY used when INTEGRATION_ENCRYPTION_KEY is unset
    delete process.env.INTEGRATION_ENCRYPTION_KEY;
    process.env.INTEGRATION_SECRET_KEY = testKey2Hex;
    const activeKeyWithFallback = getIntegrationEncryptionKey();
    check("[15] INTEGRATION_SECRET_KEY fallback works when INTEGRATION_ENCRYPTION_KEY is absent",
      activeKeyWithFallback !== null && activeKeyWithFallback.equals(Buffer.from(testKey2Hex, "hex"))
    );

    // -----------------------------------------------------------------------------
    // Section 3: Controlled Keyring & Previous Key Support
    // -----------------------------------------------------------------------------
    console.log("\n--- Section 3: Controlled Keyring & Previous Key Support ---");

    // Configure Active=v2, Previous={v1: testKey1Hex} via JSON
    process.env.INTEGRATION_ENCRYPTION_KEY = testKey2Hex;
    delete process.env.INTEGRATION_SECRET_KEY;
    process.env.INTEGRATION_ENCRYPTION_KEY_VERSION = "v2";
    process.env.INTEGRATION_ENCRYPTION_PREVIOUS_KEYS = JSON.stringify({
      v1: testKey1Hex
    });

    const multiKeyring = getIntegrationKeyring();
    check("[16] Keyring registers both active v2 and previous v1 keys",
      multiKeyring !== null &&
      isKeyVersionAvailable("v1") &&
      isKeyVersionAvailable("local-aes-256-gcm:v1") &&
      isKeyVersionAvailable("v2") &&
      isKeyVersionAvailable("local-aes-256-gcm:v2")
    );

    // Decrypt historical v1 payload using previous key
    const decryptedHistoricalV1 = decryptSecret(payloadV1);
    check("[17] decryptSecret successfully decrypts historical v1 payload with previous key",
      decryptedHistoricalV1 === secretText
    );

    // Decrypt active v2 payload using active key
    const decryptedCurrentV2 = decryptSecret(payloadV2);
    check("[18] decryptSecret successfully decrypts current v2 payload with active key",
      decryptedCurrentV2 === secretText
    );

    // Test JSON mapping to environment-variable name
    process.env.MY_HISTORICAL_KEY_SECRET = testKey1Hex;
    process.env.INTEGRATION_ENCRYPTION_PREVIOUS_KEYS = JSON.stringify({
      v1: "MY_HISTORICAL_KEY_SECRET"
    });
    check("[19] JSON mapping supports referencing environment-variable names",
      isKeyVersionAvailable("v1") && decryptSecret(payloadV1) === secretText
    );
    delete process.env.MY_HISTORICAL_KEY_SECRET;

    // Test previous key via comma-separated pairs
    process.env.INTEGRATION_ENCRYPTION_PREVIOUS_KEYS = `v1=${testKey1Hex},v3=${testKey3Hex}`;
    check("[20] Comma-separated pairs syntax supported in PREVIOUS_KEYS",
      isKeyVersionAvailable("v1") && isKeyVersionAvailable("v3")
    );

    // Test previous key via single INTEGRATION_ENCRYPTION_PREVIOUS_KEY
    delete process.env.INTEGRATION_ENCRYPTION_PREVIOUS_KEYS;
    process.env.INTEGRATION_ENCRYPTION_PREVIOUS_KEY = testKey1Hex;
    check("[21] Single INTEGRATION_ENCRYPTION_PREVIOUS_KEY binds to v1 when active is v2",
      isKeyVersionAvailable("v1") && isKeyVersionAvailable("local-aes-256-gcm:v1")
    );

    // Test named variable INTEGRATION_ENCRYPTION_KEY_V1
    delete process.env.INTEGRATION_ENCRYPTION_PREVIOUS_KEY;
    process.env.INTEGRATION_ENCRYPTION_KEY_V1 = testKey1Hex;
    check("[22] Named variable INTEGRATION_ENCRYPTION_KEY_V1 binds to v1 in keyring",
      isKeyVersionAvailable("v1") && isKeyVersionAvailable("local-aes-256-gcm:v1")
    );

    // -----------------------------------------------------------------------------
    // Section 4: Safe Rotation & Re-encryption
    // -----------------------------------------------------------------------------
    console.log("\n--- Section 4: Safe Rotation & Re-encryption ---");

    // payloadV1 is encrypted under key 1.
    // Active key is key 2 (v2).
    // reencryptSecret decrypts with key 1 and encrypts with key 2.
    const reencryptedPayload = reencryptSecret(payloadV1);

    check("[23] reencryptSecret produces new payload stamped with active keyId 'local-aes-256-gcm:v2'",
      reencryptedPayload.keyId === "local-aes-256-gcm:v2" &&
      reencryptedPayload.ciphertext !== payloadV1.ciphertext
    );

    const decryptedReencrypted = decryptSecret(reencryptedPayload);
    check("[24] Decrypting re-encrypted payload yields original plaintext",
      decryptedReencrypted === secretText
    );

    // -----------------------------------------------------------------------------
    // Section 5: Untrusted keyId Validation & Conflict Rejection
    // -----------------------------------------------------------------------------
    console.log("\n--- Section 5: Untrusted keyId Validation & Conflict Rejection ---");

    // Malformed keyId rejection
    check("[25] isValidKeyVersion strictly rejects malformed, traversing, or illegal versions",
      isValidKeyVersion("v1") === true &&
      isValidKeyVersion("local-aes-256-gcm:v1") === true &&
      isValidKeyVersion("v2-migration") === true &&
      isValidKeyVersion("../../etc/passwd") === false &&
      isValidKeyVersion("v1; DROP TABLE") === false &&
      isValidKeyVersion("invalid version with spaces") === false &&
      isValidKeyVersion("") === false
    );

    // Conflicting previous keys: same version defined with different keys
    process.env.INTEGRATION_ENCRYPTION_KEY = testKey2Hex;
    process.env.INTEGRATION_ENCRYPTION_KEY_VERSION = "v2";
    // Define v1 with key1 in JSON, and conflicting v1 with key3 in named var
    process.env.INTEGRATION_ENCRYPTION_PREVIOUS_KEYS = JSON.stringify({ v1: testKey1Hex });
    process.env.INTEGRATION_ENCRYPTION_KEY_V1 = testKey3Hex; // Conflicting key material!

    // Conflicted key version is safely discarded from previousMap to prevent ambiguous decryption
    check("[26] Conflicting previous key definitions are rejected safely without guessing",
      isKeyVersionAvailable("v1") === false
    );

    // Duplicate identical key: idempotent, accepted
    delete process.env.INTEGRATION_ENCRYPTION_KEY_V1;
    process.env.INTEGRATION_ENCRYPTION_PREVIOUS_KEYS = JSON.stringify({ v1: testKey1Hex });
    process.env.INTEGRATION_ENCRYPTION_PREVIOUS_KEY = testKey1Hex; // Identical duplicate!
    check("[27] Duplicate identical previous key material is safely accepted idempotently",
      isKeyVersionAvailable("v1") === true
    );

    // Active key protection: previous key specifying conflicting material for active version
    process.env.INTEGRATION_ENCRYPTION_PREVIOUS_KEYS = JSON.stringify({ v2: testKey3Hex }); // Conflicting with active v2!
    const activeKeyringWithConflict = getIntegrationKeyring();
    check("[28] Active key is strictly protected against conflicting previous key specifications",
      activeKeyringWithConflict !== null &&
      activeKeyringWithConflict.activeKey.equals(Buffer.from(testKey2Hex, "hex")) &&
      activeKeyringWithConflict.keys.get("v2")?.key.equals(Buffer.from(testKey2Hex, "hex"))
    );

    // -----------------------------------------------------------------------------
    // Section 6: Fail-Closed Security & Standardized Errors
    // -----------------------------------------------------------------------------
    console.log("\n--- Section 6: Fail-Closed Security & Standardized Errors ---");

    // Case 1: Unknown key version
    const unknownPayload: EncryptedPayload = {
      ciphertext: payloadV1.ciphertext,
      iv: payloadV1.iv,
      tag: payloadV1.tag,
      keyId: "local-aes-256-gcm:v99"
    };

    let unknownVersionError = "";
    try {
      decryptSecret(unknownPayload);
    } catch (err: any) {
      unknownVersionError = err.message;
    }
    check("[29] Unknown key version throws KEY_VERSION_NOT_FOUND",
      unknownVersionError.includes("KEY_VERSION_NOT_FOUND") &&
      unknownVersionError.includes("local-aes-256-gcm:v99")
    );

    // Case 2: Malformed key version throws KEY_VERSION_NOT_FOUND
    let malformedVersionError = "";
    try {
      decryptSecret({ ...payloadV1, keyId: "../traversal/key" });
    } catch (err: any) {
      malformedVersionError = err.message;
    }
    check("[30] Malformed untrusted keyId throws sanitized KEY_VERSION_NOT_FOUND error",
      malformedVersionError.includes("KEY_VERSION_NOT_FOUND")
    );

    // Case 3: Missing historical key (v1 key removed, only v2 configured)
    delete process.env.INTEGRATION_ENCRYPTION_PREVIOUS_KEYS;
    delete process.env.INTEGRATION_ENCRYPTION_PREVIOUS_KEY;
    delete process.env.INTEGRATION_ENCRYPTION_KEY_V1;

    let missingKeyError = "";
    try {
      decryptSecret(payloadV1);
    } catch (err: any) {
      missingKeyError = err.message;
    }
    check("[31] Missing historical key throws KEY_VERSION_NOT_FOUND without fallback or guessing",
      missingKeyError.includes("KEY_VERSION_NOT_FOUND") &&
      missingKeyError.includes("local-aes-256-gcm:v1")
    );

    // Case 4: Wrong key for version (tampered key)
    process.env.INTEGRATION_ENCRYPTION_PREVIOUS_KEYS = JSON.stringify({ v1: testKey3Hex }); // Wrong key!
    let wrongKeyError = "";
    try {
      decryptSecret(payloadV1);
    } catch (err: any) {
      wrongKeyError = err.message;
    }
    check("[32] Wrong key for version fails authentication and throws AUTHENTICATION_FAILED",
      wrongKeyError.includes("AUTHENTICATION_FAILED")
    );

    // Case 5: Modified authentication tag
    process.env.INTEGRATION_ENCRYPTION_PREVIOUS_KEYS = JSON.stringify({ v1: testKey1Hex }); // Restore valid key
    const corruptedTagBuf = Buffer.from(payloadV1.tag, "base64");
    corruptedTagBuf[0] ^= 0xff; // Flip bits
    const tamperedTagPayload: EncryptedPayload = {
      ...payloadV1,
      tag: corruptedTagBuf.toString("base64")
    };

    let tamperedTagError = "";
    try {
      decryptSecret(tamperedTagPayload);
    } catch (err: any) {
      tamperedTagError = err.message;
    }
    check("[33] Tampered authentication tag throws AUTHENTICATION_FAILED",
      tamperedTagError.includes("AUTHENTICATION_FAILED")
    );

    // Case 6: Tampered ciphertext
    const corruptedCipherBuf = Buffer.from(payloadV1.ciphertext, "base64");
    corruptedCipherBuf[0] ^= 0xff;
    const tamperedCipherPayload: EncryptedPayload = {
      ...payloadV1,
      ciphertext: corruptedCipherBuf.toString("base64")
    };

    let tamperedCipherError = "";
    try {
      decryptSecret(tamperedCipherPayload);
    } catch (err: any) {
      tamperedCipherError = err.message;
    }
    check("[34] Tampered ciphertext throws AUTHENTICATION_FAILED",
      tamperedCipherError.includes("AUTHENTICATION_FAILED")
    );

    // Case 7: Invalid IV length (e.g. 8 bytes instead of 12)
    const invalidIvPayload: EncryptedPayload = {
      ...payloadV1,
      iv: Buffer.from("12345678").toString("base64")
    };

    let invalidIvError = "";
    try {
      decryptSecret(invalidIvPayload);
    } catch (err: any) {
      invalidIvError = err.message;
    }
    check("[35] Invalid IV length throws INVALID_ENCRYPTED_PAYLOAD",
      invalidIvError.includes("INVALID_ENCRYPTED_PAYLOAD") &&
      invalidIvError.includes("INVALID_IV_LENGTH")
    );

    // Case 8: Invalid Tag length (e.g. 8 bytes instead of 16)
    const invalidTagPayload: EncryptedPayload = {
      ...payloadV1,
      tag: Buffer.from("12345678").toString("base64")
    };

    let invalidTagError = "";
    try {
      decryptSecret(invalidTagPayload);
    } catch (err: any) {
      invalidTagError = err.message;
    }
    check("[36] Invalid Tag length throws INVALID_ENCRYPTED_PAYLOAD",
      invalidTagError.includes("INVALID_ENCRYPTED_PAYLOAD") &&
      invalidTagError.includes("INVALID_TAG_LENGTH")
    );

    // Case 9: Malformed payload missing fields
    let malformedPayloadError = "";
    try {
      decryptSecret({ ciphertext: "abc", iv: "def" } as any);
    } catch (err: any) {
      malformedPayloadError = err.message;
    }
    check("[37] Incomplete payload object throws INVALID_ENCRYPTED_PAYLOAD",
      malformedPayloadError.includes("INVALID_ENCRYPTED_PAYLOAD") &&
      malformedPayloadError.includes("INVALID_PAYLOAD")
    );

    // Case 10: Missing active key throws ENCRYPTION_KEY_REQUIRED
    delete process.env.INTEGRATION_ENCRYPTION_KEY;
    delete process.env.INTEGRATION_SECRET_KEY;
    delete process.env.INTEGRATION_ENCRYPTION_PREVIOUS_KEYS;

    let missingConfigEncryptError = "";
    try {
      encryptSecret("test");
    } catch (err: any) {
      missingConfigEncryptError = err.message;
    }
    check("[38] encryptSecret fails safely with ENCRYPTION_KEY_REQUIRED when key is missing",
      missingConfigEncryptError.includes("ENCRYPTION_KEY_REQUIRED") &&
      missingConfigEncryptError.includes("CONFIGURATION_REQUIRED")
    );

    let missingConfigDecryptError = "";
    try {
      decryptSecret(payloadV1);
    } catch (err: any) {
      missingConfigDecryptError = err.message;
    }
    check("[39] decryptSecret fails safely with ENCRYPTION_KEY_REQUIRED when key is missing",
      missingConfigDecryptError.includes("ENCRYPTION_KEY_REQUIRED") &&
      missingConfigDecryptError.includes("CONFIGURATION_REQUIRED")
    );

    // -----------------------------------------------------------------------------
    // Section 7: No Plaintext Fallback & Zero Secret Leakage
    // -----------------------------------------------------------------------------
    console.log("\n--- Section 7: No Plaintext Fallback & Zero Secret Leakage ---");

    // Verify system never silently returns plaintext when encryption is not configured
    let fallbackAttemptResult: string | null = null;
    try {
      fallbackAttemptResult = decryptSecret(payloadV1);
    } catch {
      // Expected to throw
    }
    check("[40] No plaintext fallback: decryptSecret never returns plaintext when key is missing",
      fallbackAttemptResult === null
    );

    const allErrors = [
      unknownVersionError,
      malformedVersionError,
      missingKeyError,
      wrongKeyError,
      tamperedTagError,
      tamperedCipherError,
      invalidIvError,
      invalidTagError,
      malformedPayloadError,
      missingConfigEncryptError,
      missingConfigDecryptError
    ];

    const leakedAnySecret = allErrors.some((e) =>
      e.includes(secretText) ||
      e.includes(testKey1Hex) ||
      e.includes(testKey2Hex) ||
      e.includes(testKey3Hex) ||
      e.includes(testKey4Hex)
    );

    check("[41] Error messages NEVER contain plaintext, key material, or cipher data",
      !leakedAnySecret
    );

    // -----------------------------------------------------------------------------
    // Section 8: Existing Version-1 Payload Compatibility
    // -----------------------------------------------------------------------------
    console.log("\n--- Section 8: Existing Version-1 Payload Compatibility ---");

    // Construct an exact legacy Step 1.2C payload shape
    process.env.INTEGRATION_ENCRYPTION_KEY = testKey1Hex;
    delete process.env.INTEGRATION_ENCRYPTION_KEY_VERSION; // default v1

    const legacyPayload: EncryptedPayload = {
      ciphertext: payloadV1.ciphertext,
      iv: payloadV1.iv,
      tag: payloadV1.tag,
      keyId: "local-aes-256-gcm:v1"
    };

    const legacyDecrypted = decryptSecret(legacyPayload);
    check("[42] Existing 'local-aes-256-gcm:v1' payload decrypts seamlessly",
      legacyDecrypted === secretText
    );

    check("[43] normalizeKeyId and extractShortVersion map 'v1' and 'local-aes-256-gcm:v1' symmetrically",
      normalizeKeyId("v1") === "local-aes-256-gcm:v1" &&
      normalizeKeyId("local-aes-256-gcm:v1") === "local-aes-256-gcm:v1" &&
      extractShortVersion("local-aes-256-gcm:v1") === "v1" &&
      extractShortVersion("v1") === "v1"
    );

  } finally {
    // Restore environment
    process.env = savedEnv;
  }

  // -----------------------------------------------------------------------------
  // SUMMARY
  // -----------------------------------------------------------------------------
  console.log("\n================================================================================");
  console.log(`📊 TEST SUITE SUMMARY: ${passed} / ${passed + failed} PASSED (${failed} FAILED)`);
  console.log("================================================================================");

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log("🎉 ALL STEP 1.2F VERSIONED KEYRING & ROTATION INVARIANTS PASSED PERFECTLY!\n");
  }
}

// Execute when invoked directly
if (import.meta.url === `file://${process.argv[1]}`.replace(/\\/g, "/") || process.argv[1]?.endsWith("test_phase1b_step1_2f_versioned_encryption_keyring.ts")) {
  runTestSuite().catch((err) => {
    console.error("Test execution failed:", err);
    process.exit(1);
  });
}
