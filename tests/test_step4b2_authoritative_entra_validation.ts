/**
 * tests/test_step4b2_authoritative_entra_validation.ts
 *
 * EchoNote Step 4B.2B: Critical Entra Token Validation & Identity-Binding Remediation Test Suite
 *
 * Verifies all required security invariants:
 *  1. Mandatory Audience Validation: Enforces configured client ID; rejects missing audience config,
 *     audience mismatches, and Microsoft Graph / resource tokens.
 *  2. Cryptographic Identity Binding: Binds Microsoft token immutable identity (oid/sub)
 *     to the authenticated Firebase session (req.user.firebase.identities['microsoft.com']).
 *     Rejects detached-token identity substitution, cross-account privilege escalation,
 *     and email-only spoofing.
 *  3. Key Issuer Binding & Negative Caching: Preserves JWKS key metadata, rejects incompatible
 *     key/issuer combinations, and prevents unknown-kid request floods via negative caching.
 *  4. Supported Token Versions: Strictly validates v1.0 and v2.0 token formats and corresponding issuers,
 *     and rejects unsupported token versions.
 *  5. Replay Protection & Attempt Freshness: Enforces single-use token consumption and validates
 *     delta between Firebase auth_time and Microsoft iat.
 *  6. Multi-Tenant Directory Isolation: Strictly rejects tokens issued by foreign tenants.
 *  7. Audit Logging Hygiene: Excludes raw tokens and credentials from logs.
 */

import crypto from 'crypto';
import {
  verifyRawEntraIdToken,
  validateAuthoritativeEntraTenant,
  isValidEntraIssuer,
  setCustomJwksFetcher,
  resetCustomJwksFetcher,
  resetReplayCache,
  clearNegativeKidCache,
  EntraTokenClaims
} from '../lib/entraTokenValidation.js';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function recordTest(section: string, name: string, passed: boolean, details?: string) {
  totalTests++;
  if (passed) {
    passedTests++;
    console.log(`  ✅ PASS: [${section}] ${name}`);
  } else {
    failedTests++;
    console.error(`  ❌ FAIL: [${section}] ${name}`);
    if (details) console.error(`     Details: ${details}`);
  }
}

console.log("\n================================================================================");
console.log("🔐 ECHONOTE STEP 4B.2B: CRITICAL ENTRA TOKEN & IDENTITY BINDING TEST SUITE");
console.log("================================================================================\n");

// --- Test Setup: Generate RSA Key Pair for Cryptographic Simulation ---
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const testKid = 'mock-microsoft-key-2026';
const testV1Kid = 'mock-microsoft-v1-key-2026';
const testClientId = '00000002-0000-0000-c000-000000000000';
const authorizedTenant = '72f988bf-86f1-41af-91ab-2d7cd011db47';
const foreignTenant = '11111111-2222-3333-4444-555555555555';

const mockV2Jwk = {
  ...publicKey.export({ format: 'jwk' }),
  kid: testKid,
  alg: 'RS256',
  use: 'sig',
  issuer: `https://login.microsoftonline.com/{tenantid}/v2.0`
};

const mockV1Jwk = {
  ...publicKey.export({ format: 'jwk' }),
  kid: testV1Kid,
  alg: 'RS256',
  use: 'sig',
  issuer: `https://sts.windows.net/{tenantid}/`
};

// Incompatible issuer JWK for key-issuer binding tests
const incompatibleJwk = {
  ...publicKey.export({ format: 'jwk' }),
  kid: 'incompatible-key-kid',
  alg: 'RS256',
  use: 'sig',
  issuer: 'https://login.microsoftonline.com/some-unrelated-foreign-authority/v2.0'
};

let fetchCounter = 0;
const mockJwksFetcher = async () => {
  fetchCounter++;
  return {
    keys: [mockV2Jwk, mockV1Jwk, incompatibleJwk]
  };
};

// Helper to create cryptographically signed test Entra JWTs
function createSignedEntraToken(
  payloadOverrides: Partial<EntraTokenClaims> = {},
  options?: {
    kid?: string;
    alg?: string;
    signingKey?: crypto.KeyObject;
    tamperPayloadAfterSigning?: boolean;
    tamperSignature?: boolean;
  }
): string {
  const kid = options?.kid !== undefined ? options.kid : testKid;
  const alg = options?.alg || 'RS256';
  const now = Math.floor(Date.now() / 1000);

  const header = { alg, typ: 'JWT', kid };
  const payload: EntraTokenClaims = {
    iss: `https://login.microsoftonline.com/${authorizedTenant}/v2.0`,
    tid: authorizedTenant,
    sub: 'auth-user-oid-12345',
    oid: 'auth-user-oid-12345',
    aud: testClientId,
    iat: now,
    nbf: now - 10,
    exp: now + 3600,
    ver: '2.0',
    name: 'Verified Entra User',
    preferred_username: 'user@authorized-tenant.com',
    email: 'user@authorized-tenant.com',
    roles: ['member'],
    groups: ['sec-group-engineers'],
    department: 'Engineering',
    jobTitle: 'Senior Platform Engineer',
    ...payloadOverrides
  };

  const b64Url = (obj: any) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const message = `${b64Url(header)}.${b64Url(payload)}`;

  const keyToUse = options?.signingKey || privateKey;
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(message);
  let signature = sign.sign(keyToUse, 'base64url');

  if (options?.tamperSignature) {
    signature = signature.substring(0, signature.length - 4) + 'AAAA';
  }

  if (options?.tamperPayloadAfterSigning) {
    const tamperedPayload = { ...payload, name: 'Attacker Tampered Name' };
    return `${b64Url(header)}.${b64Url(tamperedPayload)}.${signature}`;
  }

  return `${message}.${signature}`;
}

(async () => {
  setCustomJwksFetcher(mockJwksFetcher);

  // ============================================================================
  // SECTION 1: Mandatory Audience Validation & Resource Rejection
  // ============================================================================
  console.log("--- SECTION 1: Mandatory Audience Validation & Resource Rejection ---");

  // 1.1 Valid token with matching configured audience succeeds
  const validToken = createSignedEntraToken();
  const validAudResult = await verifyRawEntraIdToken(validToken, {
    expectedTenantId: authorizedTenant,
    expectedAudience: testClientId
  });
  recordTest('AUDIENCE_MANDATORY', '1.1 Authenticates token when expectedAudience matches application client ID', validAudResult.valid && validAudResult.code === 'VALID');

  // 1.2 Reject when expectedAudience configuration is completely missing
  const missingAudResult = await verifyRawEntraIdToken(validToken, {
    expectedTenantId: authorizedTenant
  });
  recordTest('AUDIENCE_MANDATORY', '1.2 Strictly rejects validation when expectedAudience is not configured', !missingAudResult.valid && missingAudResult.code === 'AUDIENCE_MISMATCH');

  // 1.3 Reject token with wrong audience
  const wrongAudToken = createSignedEntraToken({ aud: 'unauthorized-other-client-id' });
  const wrongAudResult = await verifyRawEntraIdToken(wrongAudToken, {
    expectedTenantId: authorizedTenant,
    expectedAudience: testClientId
  });
  recordTest('AUDIENCE_MANDATORY', '1.3 Rejects token with unexpected audience', !wrongAudResult.valid && wrongAudResult.code === 'AUDIENCE_MISMATCH');

  // 1.4 Strictly reject Microsoft Graph access tokens as identity evidence
  const graphToken = createSignedEntraToken({ aud: 'https://graph.microsoft.com' });
  const graphResult = await verifyRawEntraIdToken(graphToken, {
    expectedTenantId: authorizedTenant,
    expectedAudience: 'https://graph.microsoft.com'
  });
  recordTest('AUDIENCE_MANDATORY', '1.4 Strictly rejects Microsoft Graph access token as ID token evidence', !graphResult.valid && graphResult.code === 'TOKEN_TYPE_INVALID');

  // 1.5 Strictly reject Graph App ID GUID
  const graphGuidToken = createSignedEntraToken({ aud: '00000003-0000-0000-c000-000000000000' });
  const graphGuidResult = await verifyRawEntraIdToken(graphGuidToken, {
    expectedTenantId: authorizedTenant,
    expectedAudience: '00000003-0000-0000-c000-000000000000'
  });
  recordTest('AUDIENCE_MANDATORY', '1.5 Strictly rejects Microsoft Graph GUID resource token', !graphGuidResult.valid && graphGuidResult.code === 'TOKEN_TYPE_INVALID');

  // 1.6 Reject daemon / app-only access token
  const daemonToken = createSignedEntraToken({ idtyp: 'app' });
  const daemonResult = await verifyRawEntraIdToken(daemonToken, {
    expectedTenantId: authorizedTenant,
    expectedAudience: testClientId
  });
  recordTest('AUDIENCE_MANDATORY', '1.6 Rejects daemon app-only token (idtyp: app)', !daemonResult.valid && daemonResult.code === 'TOKEN_TYPE_INVALID');

  // ============================================================================
  // SECTION 2: Cryptographic Identity Binding & Detached-Token Substitution Defense
  // ============================================================================
  console.log("\n--- SECTION 2: Cryptographic Identity Binding & Detached Token Defense ---");

  // User A session setup
  const userA_Session = {
    uid: 'firebase-user-a',
    email: 'usera@acme.com',
    auth_time: Math.floor(Date.now() / 1000),
    firebase: {
      sign_in_provider: 'microsoft.com',
      identities: {
        'microsoft.com': ['oid-usera-99999']
      }
    }
  };

  // User B session setup
  const userB_Session = {
    uid: 'firebase-user-b',
    email: 'userb@acme.com',
    auth_time: Math.floor(Date.now() / 1000),
    firebase: {
      sign_in_provider: 'microsoft.com',
      identities: {
        'microsoft.com': ['oid-userb-88888']
      }
    }
  };

  // User A Microsoft token
  const userA_Token = createSignedEntraToken({
    oid: 'oid-usera-99999',
    sub: 'oid-usera-99999',
    email: 'usera@acme.com',
    groups: ['acme-standard-engineers'],
    department: 'Engineering'
  });

  // User B Microsoft token (Privileged Admin with Security Admin group)
  const userB_Token = createSignedEntraToken({
    oid: 'oid-userb-88888',
    sub: 'oid-userb-88888',
    email: 'userb@acme.com',
    groups: ['acme-security-superadmins'],
    department: 'Security'
  });

  // Scenario 2.1: User A session + User A token -> SUCCESS
  const validBindingResult = await validateAuthoritativeEntraTenant(
    userA_Session,
    { idToken: userA_Token },
    { expectedTenantId: authorizedTenant, expectedAudience: testClientId }
  );
  recordTest('IDENTITY_BINDING', '2.1 Successfully binds User A session to User A Microsoft token', validBindingResult.valid && validBindingResult.code === 'VALID');

  // Scenario 2.2: User A session + User B token -> DETECTED & REJECTED
  const substitutionResult = await validateAuthoritativeEntraTenant(
    userA_Session,
    { idToken: userB_Token },
    { expectedTenantId: authorizedTenant, expectedAudience: testClientId }
  );
  recordTest(
    'IDENTITY_BINDING',
    '2.2 Strictly rejects detached User B token submitted under User A session (IDENTITY_SUBSTITUTION_DETECTED)',
    !substitutionResult.valid && substitutionResult.code === 'IDENTITY_SUBSTITUTION_DETECTED'
  );

  // Scenario 2.3: Token from correct tenant but different Microsoft subject
  const mismatchedSubjectToken = createSignedEntraToken({
    oid: 'oid-unknown-stranger',
    sub: 'oid-unknown-stranger',
    email: 'usera@acme.com' // Spoofed email matching session, but wrong immutable oid!
  });
  const subjectMismatchResult = await validateAuthoritativeEntraTenant(
    userA_Session,
    { idToken: mismatchedSubjectToken },
    { expectedTenantId: authorizedTenant, expectedAudience: testClientId }
  );
  recordTest(
    'IDENTITY_BINDING',
    '2.3 Rejects token with matching email but forged/mismatched immutable subject ID',
    !subjectMismatchResult.valid && subjectMismatchResult.code === 'IDENTITY_SUBSTITUTION_DETECTED'
  );

  // Scenario 2.4: Session without Microsoft provider identity submits Microsoft token
  const passwordUserSession = {
    uid: 'firebase-user-pwd',
    email: 'pwduser@acme.com',
    firebase: {
      sign_in_provider: 'password',
      identities: {
        'email': ['pwduser@acme.com']
      }
    }
  };
  const passwordUserToken = createSignedEntraToken({
    oid: 'oid-pwduser-77777',
    sub: 'oid-pwduser-77777',
    email: 'pwduser@acme.com'
  });
  const unlinkedSessionResult = await validateAuthoritativeEntraTenant(
    passwordUserSession,
    { idToken: passwordUserToken },
    { expectedTenantId: authorizedTenant, expectedAudience: testClientId }
  );
  recordTest(
    'IDENTITY_BINDING',
    '2.4 Rejects Microsoft token when Firebase user has no linked Microsoft provider identity',
    !unlinkedSessionResult.valid && unlinkedSessionResult.code === 'IDENTITY_SUBSTITUTION_DETECTED'
  );

  // ============================================================================
  // SECTION 3: Token Replay Defense & Authentication-Attempt Freshness
  // ============================================================================
  console.log("\n--- SECTION 3: Token Replay Defense & Attempt Freshness ---");

  // Scenario 3.1: Replaying already-consumed token fails closed
  const replayToken = createSignedEntraToken({
    oid: 'oid-userb-88888',
    sub: 'oid-userb-88888',
    email: 'userb@acme.com'
  });

  const firstUse = await validateAuthoritativeEntraTenant(
    userB_Session,
    { idToken: replayToken },
    { expectedTenantId: authorizedTenant, expectedAudience: testClientId }
  );
  recordTest('REPLAY_DEFENSE', '3.1 First token submission succeeds and records consumption', firstUse.valid && firstUse.code === 'VALID');

  const secondUse = await validateAuthoritativeEntraTenant(
    userB_Session,
    { idToken: replayToken },
    { expectedTenantId: authorizedTenant, expectedAudience: testClientId }
  );
  recordTest('REPLAY_DEFENSE', '3.2 Second submission of the same token is rejected as replay (TOKEN_REPLAYED)', !secondUse.valid && secondUse.code === 'TOKEN_REPLAYED');

  // Scenario 3.2: Stale session / auth_time delta mismatch
  const staleSession = {
    ...userA_Session,
    auth_time: Math.floor(Date.now() / 1000) - 1800 // 30 minutes ago
  };
  const freshToken = createSignedEntraToken({
    oid: 'oid-usera-99999',
    sub: 'oid-usera-99999',
    email: 'usera@acme.com',
    iat: Math.floor(Date.now() / 1000) // Now
  });
  const staleResult = await validateAuthoritativeEntraTenant(
    staleSession,
    { idToken: freshToken },
    { expectedTenantId: authorizedTenant, expectedAudience: testClientId, authTimeToleranceSeconds: 300 }
  );
  recordTest('REPLAY_DEFENSE', '3.3 Rejects token when session auth_time and token iat exceed tolerance', !staleResult.valid && staleResult.code === 'TOKEN_EXPIRED');

  // ============================================================================
  // SECTION 4: Signing-Key Issuer Binding & Negative Caching
  // ============================================================================
  console.log("\n--- SECTION 4: Key Issuer Binding & Negative Caching ---");

  // 4.1 Incompatible JWK issuer is rejected
  const tokenWithIncompatibleKey = createSignedEntraToken(
    { tid: authorizedTenant },
    { kid: 'incompatible-key-kid' }
  );
  const incompatibleKeyResult = await verifyRawEntraIdToken(tokenWithIncompatibleKey, {
    expectedTenantId: authorizedTenant,
    expectedAudience: testClientId
  });
  recordTest('KEY_ISSUER_BINDING', '4.1 Rejects key whose advertised JWKS issuer is incompatible with token issuer', !incompatibleKeyResult.valid && incompatibleKeyResult.code === 'KEY_NOT_FOUND');

  // 4.2 Unknown kid negative caching prevents request floods
  const initialFetchCount = fetchCounter;
  const unknownKidToken = createSignedEntraToken({ tid: authorizedTenant }, { kid: 'non-existent-kid-flooder' });

  // First attempt triggers fetch and records negative cache
  const flood1 = await verifyRawEntraIdToken(unknownKidToken, {
    expectedTenantId: authorizedTenant,
    expectedAudience: testClientId
  });
  const fetchCountAfter1 = fetchCounter;

  // Second attempt hits negative cache immediately without calling fetcher
  const flood2 = await verifyRawEntraIdToken(unknownKidToken, {
    expectedTenantId: authorizedTenant,
    expectedAudience: testClientId
  });
  const fetchCountAfter2 = fetchCounter;

  recordTest('KEY_ISSUER_BINDING', '4.2 Unknown kid records negative cache on first miss', !flood1.valid && flood1.code === 'KEY_NOT_FOUND');
  recordTest('KEY_ISSUER_BINDING', '4.3 Negative cache prevents subsequent network fetches for same unknown kid', fetchCountAfter2 === fetchCountAfter1);

  // ============================================================================
  // SECTION 5: Supported Token Versions (v1.0 & v2.0) and Unsupported Versions
  // ============================================================================
  console.log("\n--- SECTION 5: Token Version & Issuer Consistency ---");

  // 5.1 Valid v2 token with v2 issuer accepted
  const v2Token = createSignedEntraToken({
    ver: '2.0',
    iss: `https://login.microsoftonline.com/${authorizedTenant}/v2.0`
  });
  const v2Result = await verifyRawEntraIdToken(v2Token, {
    expectedTenantId: authorizedTenant,
    expectedAudience: testClientId
  });
  recordTest('TOKEN_VERSION', '5.1 Accepts v2.0 token with matching v2 issuer format', v2Result.valid);

  // 5.2 Valid v1 token with v1 issuer and v1 key accepted
  const v1Token = createSignedEntraToken(
    {
      ver: '1.0',
      iss: `https://sts.windows.net/${authorizedTenant}/`
    },
    { kid: testV1Kid }
  );
  const v1Result = await verifyRawEntraIdToken(v1Token, {
    expectedTenantId: authorizedTenant,
    expectedAudience: testClientId
  });
  recordTest('TOKEN_VERSION', '5.2 Accepts v1.0 token with matching v1 sts.windows.net issuer format', v1Result.valid);

  // 5.3 v2 token with v1 issuer rejected
  const mismatchedV2Token = createSignedEntraToken({
    ver: '2.0',
    iss: `https://sts.windows.net/${authorizedTenant}/`
  });
  const mismatchedV2Result = await verifyRawEntraIdToken(mismatchedV2Token, {
    expectedTenantId: authorizedTenant,
    expectedAudience: testClientId
  });
  recordTest('TOKEN_VERSION', '5.3 Rejects v2.0 token with v1 issuer format (ISSUER_MISMATCH)', !mismatchedV2Result.valid && mismatchedV2Result.code === 'ISSUER_MISMATCH');

  // 5.4 Unsupported token version (e.g. 3.0) rejected
  const v3Token = createSignedEntraToken({
    ver: '3.0'
  });
  const v3Result = await verifyRawEntraIdToken(v3Token, {
    expectedTenantId: authorizedTenant,
    expectedAudience: testClientId
  });
  recordTest('TOKEN_VERSION', '5.4 Rejects unsupported token version (UNSUPPORTED_TOKEN_VERSION)', !v3Result.valid && v3Result.code === 'UNSUPPORTED_TOKEN_VERSION');

  // ============================================================================
  // SECTION 6: Multi-Tenant Isolation & Signature Tampering
  // ============================================================================
  console.log("\n--- SECTION 6: Multi-Tenant Isolation & Signature Integrity ---");

  // 6.1 Token issued by foreign tenant strictly rejected
  const foreignToken = createSignedEntraToken({
    tid: foreignTenant,
    iss: `https://login.microsoftonline.com/${foreignTenant}/v2.0`
  });
  const foreignResult = await verifyRawEntraIdToken(foreignToken, {
    expectedTenantId: authorizedTenant,
    expectedAudience: testClientId
  });
  recordTest('TENANT_ISOLATION', '6.1 Strictly rejects foreign tenant token (TENANT_MISMATCH)', !foreignResult.valid && foreignResult.code === 'TENANT_MISMATCH');

  // 6.2 Tampered payload rejected with SIGNATURE_INVALID
  const tamperedToken = createSignedEntraToken({}, { tamperPayloadAfterSigning: true });
  const tamperedResult = await verifyRawEntraIdToken(tamperedToken, {
    expectedTenantId: authorizedTenant,
    expectedAudience: testClientId
  });
  recordTest('SIGNATURE_INTEGRITY', '6.2 Rejects tampered payload with invalid signature', !tamperedResult.valid && tamperedResult.code === 'SIGNATURE_INVALID');

  // 6.3 Expired token rejected
  const now = Math.floor(Date.now() / 1000);
  const expiredToken = createSignedEntraToken({ exp: now - 300 });
  const expiredResult = await verifyRawEntraIdToken(expiredToken, {
    expectedTenantId: authorizedTenant,
    expectedAudience: testClientId
  });
  recordTest('TEMPORAL_VALIDITY', '6.3 Rejects expired token', !expiredResult.valid && expiredResult.code === 'TOKEN_EXPIRED');

  // ============================================================================
  // SECTION 7: Authoritative Firebase ID Token Provider Recognition (Path B)
  // ============================================================================
  console.log("\n--- SECTION 7: Firebase Session Attributes (Path B) ---");

  const validFirebaseSession = {
    uid: 'fb-user-123',
    email: 'alice@acme.com',
    firebase: {
      sign_in_provider: 'microsoft.com',
      sign_in_attributes: {
        tid: authorizedTenant
      }
    }
  };
  const pathB_Result = await validateAuthoritativeEntraTenant(
    validFirebaseSession,
    {},
    { expectedTenantId: authorizedTenant, expectedAudience: testClientId }
  );
  recordTest('PATH_B_FIREBASE', '7.1 Recognizes authoritative tid from cryptographically verified Firebase session', pathB_Result.valid && pathB_Result.source === 'firebase_verified_attributes');

  // ============================================================================
  // SECTION 8: Audit Logging Hygiene & Cleanup
  // ============================================================================
  console.log("\n--- SECTION 8: Audit Logging Hygiene ---");

  recordTest(
    'AUDIT_HYGIENE',
    '8.1 Validation error objects exclude raw ID token strings',
    !tamperedResult.error?.includes(tamperedToken) && !substitutionResult.error?.includes(userB_Token)
  );

  resetCustomJwksFetcher();

  console.log("\n================================================================================");
  console.log(`📊 STEP 4B.2B CRITICAL REMEDIATION SUMMARY: ${passedTests}/${totalTests} Passed (${failedTests} Failed)`);
  console.log("================================================================================\n");

  if (failedTests === 0) {
    console.log("🎯 All Critical Entra Token Validation & Identity-Binding Remediations Verified Successfully!\n");
  } else {
    console.error("❌ Some tests failed!");
    process.exit(1);
  }
})();
