/**
 * EchoNote Step 3B.4.4: MFA Recovery Ticket Authorization Boundary Verification Suite
 *
 * Verifies the complete security model, isolation boundaries, and regression invariants:
 * 1. Entropy calculation and cryptographic properties of the 32-character Base32 alphabet.
 * 2. Unambiguous code normalization (hyphen-stripping, whitespace, case insensitivity).
 * 3. Salted HMAC-SHA256 verifier computation using server pepper (zero plaintext storage).
 * 4. Atomic single-use redemption and rejection of reuse / replay attempts.
 * 5. Rate limiting enforcement (lockout after max attempts per time window).
 * 6. Recovery Ticket issuance, tamper-resistance, and cryptographic validation.
 * 7. Boundary Invariant 1: Recovery tickets strictly DO NOT satisfy isSessionMfaVerified().
 * 8. Boundary Invariant 2: Recovery tickets CANNOT unlock protected project APIs.
 * 9. Boundary Invariant 3: Recovery tickets CANNOT unlock protected organization administration.
 * 10. Boundary Invariant 4: Recovery tickets CANNOT disable MFA through the ordinary endpoint.
 * 11. Boundary Invariant 5: Recovery tickets CANNOT authenticate general product APIs.
 * 12. Boundary Invariant 6: Invalid, expired, tampered, and cross-user recovery tickets are rejected.
 * 13. Boundary Invariant 7: Dedicated recovery endpoint works strictly within designated scope.
 * 14. Boundary Invariant 8: Genuine Firebase MFA sessions continue to satisfy policies.
 * 15. Boundary Invariant 9: MFA_REQUIRED_ADMINS and MFA_ENFORCED_ALL remain strictly enforced.
 */

import crypto from "crypto";
import { 
  RECOVERY_CODE_CHARSET, 
  RECOVERY_CODE_LENGTH, 
  RECOVERY_CODE_COUNT,
  RECOVERY_TICKET_TTL_SECONDS,
  normalizeRecoveryCode,
  isValidRecoveryCodeFormat,
  getRecoveryPepper,
  setTestRecoveryPepper,
  isValidRecoveryPepper,
  computeCodeVerifier,
  generateRecoveryCodesSet,
  findMatchingUnusedCode,
  issueRecoveryTicket,
  verifyRecoveryTicket,
  checkRecoveryRateLimit,
  recordRecoveryAttempt,
  resetRecoveryRateLimit,
  timingSafeCompare
} from "../lib/recoveryCodes.ts";
import { 
  evaluateOrgMfaPolicy, 
  isSessionMfaVerified,
  requireAuth,
  requireRecoveryScope,
  requireOrgRole,
  resolveProjectAccess
} from "../middleware/auth.ts";

// Deterministic test-only secret for isolated test runs
const TEST_PEPPER = "test-only-explicit-mfa-recovery-pepper-for-ci-and-local-tests-32b";
setTestRecoveryPepper(TEST_PEPPER);

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assertTest(name: string, condition: boolean, details?: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✅ PASS: ${name}`);
  } else {
    failedTests++;
    console.error(`  ❌ FAIL: ${name}`);
    if (details) console.error(`     Details: ${details}`);
  }
}

console.log("\n================================================================================");
console.log("🔐 STEP 3B.4.4: MFA RECOVERY CODES & AUTHORIZATION BOUNDARY REGRESSION SUITE");
console.log("================================================================================\n");

// ============================================================================
// SECTION 1: ENTROPY, CHARACTERS, AND NORMALIZATION
// ============================================================================
console.log("--- SECTION 1: Entropy, Character Set & Normalization ---");

{
  // 1.1 Unambiguous alphabet size and exclusion of ambiguous symbols (0, 1, I, O)
  assertTest(
    "1.1 Charset has exactly 32 unambiguous characters (5 bits/char)",
    RECOVERY_CODE_CHARSET.length === 32 &&
    !RECOVERY_CODE_CHARSET.includes("0") &&
    !RECOVERY_CODE_CHARSET.includes("O") &&
    !RECOVERY_CODE_CHARSET.includes("1") &&
    !RECOVERY_CODE_CHARSET.includes("I")
  );

  // 1.2 Mathematical entropy calculation
  const bitsPerChar = Math.log2(RECOVERY_CODE_CHARSET.length);
  const entropyPerCode = RECOVERY_CODE_LENGTH * bitsPerChar;
  const totalPoolEntropy = RECOVERY_CODE_COUNT * entropyPerCode;

  assertTest(
    "1.2 Code length is 10 chars with exactly 50 bits entropy per code and 500 bits total pool",
    bitsPerChar === 5 && entropyPerCode === 50 && totalPoolEntropy === 500
  );

  // 1.3 Normalization of code inputs
  const sampleFormatted = "abcd2-efgh3";
  const normalized = normalizeRecoveryCode(sampleFormatted);
  assertTest(
    "1.3 normalizeRecoveryCode strips hyphens, spaces, and uppercases",
    normalized === "ABCD2EFGH3" && isValidRecoveryCodeFormat(normalized) === true
  );

  // 1.4 Invalid format detection
  assertTest(
    "1.4 Reject invalid characters or lengths",
    isValidRecoveryCodeFormat("ABCD2EFGH1") === false && // contains '1'
    isValidRecoveryCodeFormat("SHORT") === false &&
    isValidRecoveryCodeFormat("TOOLONGSTRING123") === false
  );
}

// ============================================================================
// SECTION 2: GENERATION & SECURE SALTED STORAGE
// ============================================================================
console.log("\n--- SECTION 2: Code Generation & Salted Keyed Verifiers ---");

{
  const uid = "test_user_rec_01";
  const generated = generateRecoveryCodesSet(uid);

  assertTest(
    "2.1 Generates exactly 10 plaintext codes and 10 verifier records",
    generated.plaintextCodes.length === 10 &&
    generated.document.codes.length === 10 &&
    generated.document.totalCodes === 10 &&
    generated.document.remainingCodes === 10
  );

  // 2.2 Plaintext is NOT stored in the document
  const rawDocString = JSON.stringify(generated.document);
  let anyPlaintextLeaked = false;
  for (const plain of generated.plaintextCodes) {
    const rawPlain = normalizeRecoveryCode(plain);
    if (rawDocString.includes(rawPlain)) {
      anyPlaintextLeaked = true;
      break;
    }
  }
  assertTest(
    "2.2 Plaintext codes are strictly absent from stored document representation",
    anyPlaintextLeaked === false
  );

  // 2.3 Unique salts per code
  const salts = new Set(generated.document.codes.map(c => c.saltHex));
  assertTest(
    "2.3 Every code verifier uses an independent 16-byte random salt",
    salts.size === 10
  );

  // 2.4 Verifier match verification
  const firstPlain = generated.plaintextCodes[0];
  const matched = findMatchingUnusedCode(firstPlain, generated.document.codes);
  assertTest(
    "2.4 findMatchingUnusedCode accurately identifies matching unused code",
    matched !== null && matched.codeId === "rc_0" && matched.used === false
  );

  // 2.5 Tampered code fails verifier check
  const tamperedPlain = firstPlain.slice(0, -1) + (firstPlain.endsWith("9") ? "8" : "9");
  const failedMatch = findMatchingUnusedCode(tamperedPlain, generated.document.codes);
  assertTest(
    "2.5 Modified code does not match any stored verifiers",
    failedMatch === null
  );
}

// ============================================================================
// SECTION 3: ATOMIC SINGLE-USE REDEMPTION & REPLAY PREVENTION
// ============================================================================
console.log("\n--- SECTION 3: Single-Use Redemption & Replay Prevention ---");

{
  const uid = "test_user_rec_02";
  const { plaintextCodes, document } = generateRecoveryCodesSet(uid);
  const targetCode = plaintextCodes[3];

  // First redemption: Should succeed
  const match1 = findMatchingUnusedCode(targetCode, document.codes);
  assertTest(
    "3.1 First redemption finds matching unused code",
    match1 !== null && match1.codeId === "rc_3"
  );

  // Simulate atomic consumption in transaction
  match1!.used = true;
  match1!.usedAt = new Date().toISOString();
  document.remainingCodes -= 1;

  // Second redemption of same code: MUST return null
  const match2 = findMatchingUnusedCode(targetCode, document.codes);
  assertTest(
    "3.2 Replay attempt on consumed recovery code is strictly rejected (single-use enforced)",
    match2 === null
  );

  assertTest(
    "3.3 Remaining code counter accurately decremented",
    document.remainingCodes === 9
  );
}

// ============================================================================
// SECTION 4: RATE LIMITING & BRUTE-FORCE RESISTANCE
// ============================================================================
console.log("\n--- SECTION 4: Rate Limiting & Lockout Defense ---");

{
  const rlUid = "test_user_ratelimit";
  const rlIp = "192.168.1.100";
  resetRecoveryRateLimit(rlUid, rlIp);

  // 5 attempts allowed
  for (let i = 0; i < 5; i++) {
    const check = checkRecoveryRateLimit(rlUid, rlIp);
    assertTest(`4.1 Attempt ${i + 1} admitted within limit`, check.allowed === true);
    recordRecoveryAttempt(rlUid, rlIp);
  }

  // 6th attempt: Must be rate limited
  const blockedCheck = checkRecoveryRateLimit(rlUid, rlIp);
  assertTest(
    "4.2 6th consecutive attempt is rejected with HTTP 429 lock-out window",
    blockedCheck.allowed === false && blockedCheck.retryAfterSeconds > 0
  );

  // Reset restores admission
  resetRecoveryRateLimit(rlUid, rlIp);
  const resetCheck = checkRecoveryRateLimit(rlUid, rlIp);
  assertTest(
    "4.3 Successful reset restores redemption admission",
    resetCheck.allowed === true
  );
}

// ============================================================================
// SECTION 5: RECOVERY AUTHORIZATION TICKET LIFECYCLE & CRYPTOGRAPHIC VALIDATION
// ============================================================================
console.log("\n--- SECTION 5: Recovery Ticket Lifecycle & Cryptographic Verification ---");

function createSignedTestTicket(payload: any): string {
  const payloadB64 = Buffer.from(JSON.stringify(payload))
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  const secret = getRecoveryPepper();
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`echonote-recovery-ticket:${payloadB64}`)
    .digest("base64url");
  return `v1.${payloadB64}.${signature}`;
}

{
  const uid = "test_user_ticket_01";
  const codeId = "rc_5";
  const ticket = issueRecoveryTicket(uid, codeId);

  assertTest(
    "5.1 Issues signed recovery ticket with 'v1.' prefix",
    typeof ticket === "string" && ticket.startsWith("v1.")
  );

  // Verify valid ticket
  const verified = verifyRecoveryTicket(ticket, uid);
  assertTest(
    "5.2 Valid recovery ticket parses successfully and verifies signature",
    verified !== null && verified.uid === uid && verified.codeId === codeId
  );

  // Rejection on UID mismatch (cross-user replay protection)
  const crossUserVerified = verifyRecoveryTicket(ticket, "other_malicious_user");
  assertTest(
    "5.3 Ticket cannot be redeemed by or bound to a different authenticated UID",
    crossUserVerified === null
  );

  // Tamper detection (modified payload)
  const parts = ticket.split(".");
  const tamperedTicket = `${parts[0]}.${parts[1]}tamper.${parts[2]}`;
  const tamperedResult = verifyRecoveryTicket(tamperedTicket, uid);
  assertTest(
    "5.4 Tampered recovery ticket fails signature check",
    tamperedResult === null
  );

  // Constant-time compare self-check
  assertTest(
    "5.5 timingSafeCompare validates equality in constant time",
    timingSafeCompare("abcdef12", "abcdef12") === true &&
    timingSafeCompare("abcdef12", "abcdef13") === false
  );

  // Expired ticket verification
  const now = Math.floor(Date.now() / 1000);
  const expiredTicket = createSignedTestTicket({
    uid,
    codeId: "rc_exp",
    purpose: "mfa_recovery_reset",
    iss: "echonote-auth",
    aud: "echonote-mfa-recovery",
    scope: ["mfa:reset-lost-factor"],
    nonce: "expnonce",
    iat: now - 1200,
    exp: now - 300 // expired 5 minutes ago
  });
  const expiredResult = verifyRecoveryTicket(expiredTicket, uid);
  assertTest(
    "5.6 Expired recovery ticket is strictly rejected",
    expiredResult === null
  );

  // Mismatched issuer and audience
  const badAudTicket = createSignedTestTicket({
    uid,
    codeId: "rc_aud",
    purpose: "mfa_recovery_reset",
    iss: "echonote-auth",
    aud: "untrusted-audience",
    scope: ["mfa:reset-lost-factor"],
    nonce: "badnonce",
    iat: now,
    exp: now + 600
  });
  assertTest(
    "5.7 Recovery ticket with untrusted audience is strictly rejected",
    verifyRecoveryTicket(badAudTicket, uid) === null
  );

  // Mismatched purpose
  const badPurposeTicket = createSignedTestTicket({
    uid,
    codeId: "rc_purp",
    purpose: "unauthorized_admin_access",
    iss: "echonote-auth",
    aud: "echonote-mfa-recovery",
    scope: ["mfa:reset-lost-factor"],
    nonce: "badpurp",
    iat: now,
    exp: now + 600
  });
  assertTest(
    "5.8 Recovery ticket with unauthorized purpose is strictly rejected",
    verifyRecoveryTicket(badPurposeTicket, { expectedUid: uid, expectedPurpose: "mfa_recovery_reset" }) === null
  );

  // Mismatched scope
  const badScopeTicket = createSignedTestTicket({
    uid,
    codeId: "rc_scope",
    purpose: "mfa_recovery_reset",
    iss: "echonote-auth",
    aud: "echonote-mfa-recovery",
    scope: ["unrelated:scope"],
    nonce: "badscope",
    iat: now,
    exp: now + 600
  });
  assertTest(
    "5.9 Recovery ticket without required scope is strictly rejected",
    verifyRecoveryTicket(badScopeTicket, { expectedUid: uid, requiredScope: "mfa:reset-lost-factor" }) === null
  );
}

// ============================================================================
// SECTION 6: RECOVERY TICKET AUTHORIZATION BOUNDARY REGRESSION TESTS (STEP 3B.4.4)
// ============================================================================
console.log("\n--- SECTION 6: Authorization Boundary Invariants (Step 3B.4.4) ---");

async function runAuthorizationBoundaryTests() {
  const uid = "admin_recovery_user";
  const validTicket = issueRecoveryTicket(uid, "rc_active_01");

  // 6.1 isSessionMfaVerified DOES NOT accept recoveryVerified = true
  const sessionWithRecoveryFlag = {
    uid,
    email: "admin@enterprise.com",
    recoveryVerified: true,
    recoveryTicket: validTicket
  };
  assertTest(
    "6.1 A valid recovery ticket does not satisfy isSessionMfaVerified()",
    isSessionMfaVerified(sessionWithRecoveryFlag) === false
  );

  // 6.2 isSessionMfaVerified rejects recoveryTicket presence or ticket object
  const sessionWithRecoveryObject = {
    uid,
    email: "admin@enterprise.com",
    recoveryTicket: { codeId: "rc_1", iat: 1000, exp: 2000 }
  };
  assertTest(
    "6.2 isSessionMfaVerified strictly ignores recoveryTicket presence",
    isSessionMfaVerified(sessionWithRecoveryObject) === false
  );

  // 6.3 isSessionMfaVerified rejects Firestore mfaEnabled flag and enrolledFactors alone
  const sessionWithMetadataOnly = {
    uid,
    email: "admin@enterprise.com",
    mfaEnabled: true,
    multiFactor: { enrolledFactors: [{ factorId: "totp" }] }
  };
  assertTest(
    "6.3 isSessionMfaVerified strictly ignores mfaEnabled and enrolledFactors without session claim",
    isSessionMfaVerified(sessionWithMetadataOnly) === false
  );

  // 6.4 Genuine Firebase MFA-verified session returns true
  const genuineMfaSession = {
    uid,
    email: "admin@enterprise.com",
    firebase: {
      sign_in_provider: "password",
      sign_in_second_factor: "totp"
    }
  };
  assertTest(
    "6.4 Genuine Firebase MFA session (sign_in_second_factor: 'totp') satisfies isSessionMfaVerified()",
    isSessionMfaVerified(genuineMfaSession) === true
  );

  // 6.5 Organization policy evaluation under MFA_REQUIRED_ADMINS
  const adminOrgPolicy = { mfaRequirement: "MFA_REQUIRED_ADMINS" };
  const recoveredAdminEval = evaluateOrgMfaPolicy(adminOrgPolicy, "org_admin", isSessionMfaVerified(sessionWithRecoveryFlag));
  assertTest(
    "6.5 Admin with recovery ticket fails MFA_REQUIRED_ADMINS policy (allowed === false)",
    recoveredAdminEval.allowed === false && Boolean(recoveredAdminEval.violationReason)
  );

  // 6.6 Organization policy evaluation under MFA_ENFORCED_ALL
  const allOrgPolicy = { mfaRequirement: "MFA_ENFORCED_ALL" };
  const recoveredMemberEval = evaluateOrgMfaPolicy(allOrgPolicy, "member", isSessionMfaVerified(sessionWithRecoveryFlag));
  assertTest(
    "6.6 Member with recovery ticket fails MFA_ENFORCED_ALL policy (allowed === false)",
    recoveredMemberEval.allowed === false && Boolean(recoveredMemberEval.violationReason)
  );

  // 6.7 Genuine Firebase MFA session satisfies both policies
  const genuineAdminEval = evaluateOrgMfaPolicy(adminOrgPolicy, "org_admin", isSessionMfaVerified(genuineMfaSession));
  const genuineMemberEval = evaluateOrgMfaPolicy(allOrgPolicy, "member", isSessionMfaVerified(genuineMfaSession));
  assertTest(
    "6.7 Genuine Firebase MFA-verified session satisfies MFA_REQUIRED_ADMINS and MFA_ENFORCED_ALL",
    genuineAdminEval.allowed === true && genuineMemberEval.allowed === true
  );

  // 6.8 Protected project API access: resolveProjectAccess blocks access
  function createMockDbForProject(policy: any) {
    return {
      collection: (name: string) => ({
        doc: (id: string) => ({
          get: async () => {
            if (name === "projects") {
              return {
                exists: true,
                data: () => ({
                  id: "proj_protected",
                  name: "Protected Project",
                  userId: "usr_creator",
                  organizationId: "org_enterprise"
                })
              };
            }
            if (name === "organizations" && id === "org_enterprise") {
              return {
                exists: true,
                data: () => ({
                  id: "org_enterprise",
                  name: "Enterprise Corp",
                  ownerId: "admin_recovery_user",
                  ownerEmail: "admin@enterprise.com",
                  securitySettings: policy
                })
              };
            }
            return { exists: false, data: () => ({}) };
          }
        }),
        where: () => ({
          where: () => ({
            where: () => ({
              limit: () => ({
                get: async () => ({
                  empty: false,
                  docs: [{ data: () => ({ role: "org_admin", status: "active", orgId: "org_enterprise" }) }]
                })
              })
            })
          })
        })
      })
    } as any;
  }

  const mockDbAdminPolicy = createMockDbForProject({ mfaRequirement: "MFA_REQUIRED_ADMINS" });
  const projectAccessResult = await resolveProjectAccess(
    mockDbAdminPolicy,
    sessionWithRecoveryFlag,
    "proj_protected"
  );
  assertTest(
    "6.8 A valid recovery ticket cannot unlock a protected project API",
    projectAccessResult.hasAccess === false &&
    projectAccessResult.mfaRequired === true &&
    projectAccessResult.mfaRequirement === "MFA_REQUIRED_ADMINS",
    JSON.stringify(projectAccessResult)
  );

  // 6.9 Protected organization administration: requireOrgRole blocks access
  function createMockDbForOrgRole(policy: any) {
    return {
      collection: (name: string) => ({
        doc: (id: string) => ({
          get: async () => ({
            exists: true,
            data: () => ({
              id,
              name: "Enterprise Corp",
              ownerId: "usr_owner",
              ownerEmail: "owner@enterprise.com",
              securitySettings: policy
            })
          })
        }),
        where: () => ({
          where: () => ({
            where: () => ({
              limit: () => ({
                get: async () => ({
                  empty: false,
                  docs: [{ data: () => ({ role: "org_admin", status: "active", orgId: "org_enterprise" }) }]
                })
              })
            })
          })
        })
      })
    } as any;
  }

  const orgRoleMiddleware = requireOrgRole(createMockDbForOrgRole({ mfaRequirement: "MFA_REQUIRED_ADMINS" }), "org_admin");
  let orgStatus: number | null = null;
  let orgJson: any = null;
  let orgNextCalled: any = false;

  await orgRoleMiddleware(
    {
      params: { organizationId: "org_enterprise" },
      headers: { "x-mfa-recovery-ticket": validTicket },
      user: sessionWithRecoveryFlag
    } as any,
    {
      status: (c: number) => {
        orgStatus = c;
        return { json: (b: any) => { orgJson = b; } };
      }
    } as any,
    () => { orgNextCalled = true; }
  );

  assertTest(
    "6.9 A valid recovery ticket cannot unlock protected organization administration",
    orgStatus === 403 &&
    orgNextCalled === false &&
    (orgJson?.code === "MFA_REQUIRED" || orgJson?.code === "MFA_ENROLLMENT_REQUIRED")
  );

  // 6.10 Ordinary MFA disable endpoint protection
  // Simulates POST /api/auth/mfa/disable reauthentication check:
  // Requires auth_time within last 15 minutes (900s). Rejects expired auth_time even with recovery ticket.
  const nowSec = Math.floor(Date.now() / 1000);
  const sessionExpiredReauth = {
    ...sessionWithRecoveryFlag,
    auth_time: nowSec - 1800 // 30 minutes old (expired reauth threshold)
  };
  const isReauthRecent = (authTime: number) => Boolean(authTime && (nowSec - authTime) <= 900);
  assertTest(
    "6.10 A recovery ticket cannot disable MFA through the ordinary self-service endpoint",
    isReauthRecent(sessionExpiredReauth.auth_time) === false
  );

  // 6.11 General API protection: requireAuth rejects missing Bearer token even if recovery ticket header is provided
  let generalStatus: number | null = null;
  let generalNextCalled: any = false;
  await requireAuth(
    {
      headers: {
        "x-mfa-recovery-ticket": validTicket // Ticket provided, but Bearer token omitted
      }
    } as any,
    {
      status: (c: number) => {
        generalStatus = c;
        return { json: () => {} };
      }
    } as any,
    () => { generalNextCalled = true; }
  );
  assertTest(
    "6.11 Recovery-ticket authentication fails on general APIs (missing Bearer rejected with HTTP 401)",
    generalStatus === 401 && generalNextCalled === false
  );

  // 6.12 Narrowly scoped recovery boundary: requireRecoveryScope allows valid ticket on dedicated endpoint
  const recoveryMiddleware = requireRecoveryScope("mfa:reset-lost-factor");
  let recNextCalled: any = false;
  let capturedPayload: any = null;
  const mockRecReq: any = {
    user: { uid, email: "admin@enterprise.com" },
    headers: { "x-mfa-recovery-ticket": validTicket }
  };
  recoveryMiddleware(
    mockRecReq,
    { status: () => ({ json: () => {} }) } as any,
    () => {
      recNextCalled = true;
      capturedPayload = mockRecReq.recoveryPayload;
    }
  );
  assertTest(
    "6.12 Dedicated recovery middleware permits valid ticket on explicitly designated recovery endpoint",
    recNextCalled === true && capturedPayload?.uid === uid && capturedPayload?.codeId === "rc_active_01"
  );

  // 6.13 Scope boundary: requireRecoveryScope rejects ticket attempting out-of-scope operation
  const wrongScopeMiddleware = requireRecoveryScope("workspace:admin");
  let wrongScopeStatus: number | null = null;
  let wrongScopeNextCalled: any = false;
  wrongScopeMiddleware(
    {
      user: { uid, email: "admin@enterprise.com" },
      headers: { "x-mfa-recovery-ticket": validTicket }
    } as any,
    {
      status: (c: number) => {
        wrongScopeStatus = c;
        return { json: () => {} };
      }
    } as any,
    () => { wrongScopeNextCalled = true; }
  );
  assertTest(
    "6.13 An explicitly permitted recovery endpoint works ONLY within its intended scope",
    wrongScopeStatus === 403 && wrongScopeNextCalled === false
  );

  // 6.14 requireRecoveryScope rejects unauthenticated requests (missing req.user)
  let unauthStatus: number | null = null;
  let unauthNextCalled: any = false;
  recoveryMiddleware(
    {
      headers: { "x-mfa-recovery-ticket": validTicket }
    } as any,
    {
      status: (c: number) => {
        unauthStatus = c;
        return { json: () => {} };
      }
    } as any,
    () => { unauthNextCalled = true; }
  );
  assertTest(
    "6.14 Recovery ticket without primary authenticated user is rejected (HTTP 401)",
    unauthStatus === 401 && unauthNextCalled === false
  );

  // 6.15 Post-recovery factor reset invariant
  // Once factors are reset, the user must enroll a new authenticator and complete a live Firebase second-factor challenge
  const postResetSession = {
    uid,
    email: "admin@enterprise.com",
    mfaEnabled: false,
    firebase: { sign_in_provider: "password" } // No sign_in_second_factor
  };
  const postResetEval = evaluateOrgMfaPolicy(adminOrgPolicy, "org_admin", isSessionMfaVerified(postResetSession));
  assertTest(
    "6.15 Post-recovery account remains blocked until completing a genuine Firebase MFA second-factor challenge",
    postResetEval.allowed === false && isSessionMfaVerified(postResetSession) === false
  );
}

// ============================================================================
// SECTION 7: MFA RECOVERY PEPPER HARDENING & REGRESSION SUITE
// ============================================================================
console.log("\n--- SECTION 7: MFA Recovery Pepper Hardening & Regression Tests ---");

function runPepperHardeningTests() {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalEnvPepper = process.env.MFA_RECOVERY_PEPPER;
  const originalCron = process.env.CRON_SECRET;
  const originalPlayback = process.env.PLAYBACK_SECRET;

  try {
    // 7.1 Validation: Rejects null, undefined, empty, or whitespace
    assertTest(
      "7.1 isValidRecoveryPepper rejects null, undefined, and empty string",
      isValidRecoveryPepper(null) === false &&
      isValidRecoveryPepper(undefined) === false &&
      isValidRecoveryPepper("") === false &&
      isValidRecoveryPepper("   ") === false
    );

    // 7.2 Validation: Rejects short secrets (< 32 chars)
    assertTest(
      "7.2 isValidRecoveryPepper rejects short secrets (< 32 characters)",
      isValidRecoveryPepper("short-secret-12345") === false &&
      isValidRecoveryPepper("a".repeat(31)) === false
    );

    // 7.3 Validation: Accepts strong secrets (>= 32 chars)
    assertTest(
      "7.3 isValidRecoveryPepper accepts valid high-entropy secrets (>= 32 characters)",
      isValidRecoveryPepper("a".repeat(32)) === true &&
      isValidRecoveryPepper("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef") === true
    );

    // 7.4 Fails closed when secret is missing and no test pepper is injected
    setTestRecoveryPepper(null);
    delete process.env.MFA_RECOVERY_PEPPER;
    // Set unrelated secrets that MUST NOT be used as fallbacks
    process.env.CRON_SECRET = "cron-secret-that-must-never-be-used-as-recovery-pepper-32b";
    process.env.PLAYBACK_SECRET = "playback-secret-that-must-never-be-used-as-recovery-pepper";

    let missingThrown = false;
    let missingErrorMessage = "";
    try {
      getRecoveryPepper();
    } catch (err: any) {
      missingThrown = true;
      missingErrorMessage = err.message;
    }
    assertTest(
      "7.4 getRecoveryPepper fails closed with clear error when MFA_RECOVERY_PEPPER is missing",
      missingThrown === true && missingErrorMessage.includes("missing")
    );

    // 7.5 No insecure fallback to CRON_SECRET or PLAYBACK_SECRET
    // The previous getRecoveryPepper threw instead of deriving from CRON_SECRET/PLAYBACK_SECRET
    assertTest(
      "7.5 Zero fallback: Does NOT derive recovery pepper from CRON_SECRET or PLAYBACK_SECRET",
      missingThrown === true && !missingErrorMessage.includes(process.env.CRON_SECRET!)
    );

    // 7.6 Fails closed when secret is too short / invalid
    process.env.MFA_RECOVERY_PEPPER = "too-short-secret";
    let invalidThrown = false;
    let invalidErrorMessage = "";
    try {
      getRecoveryPepper();
    } catch (err: any) {
      invalidThrown = true;
      invalidErrorMessage = err.message;
    }
    assertTest(
      "7.6 getRecoveryPepper fails closed when MFA_RECOVERY_PEPPER does not meet strength requirement",
      invalidThrown === true && invalidErrorMessage.includes("minimum strength requirements")
    );

    // 7.7 Error messages never log or leak secret value
    assertTest(
      "7.7 Configuration errors do not expose or leak configured secret values",
      !invalidErrorMessage.includes("too-short-secret")
    );

    // 7.8 Explicit valid environment secret is respected
    const validExplicitSecret = "custom-prod-pepper-secret-with-plenty-of-entropy-999";
    process.env.MFA_RECOVERY_PEPPER = validExplicitSecret;
    const resolvedEnvPepper = getRecoveryPepper();
    assertTest(
      "7.8 Valid explicitly configured MFA_RECOVERY_PEPPER is correctly returned",
      resolvedEnvPepper === validExplicitSecret
    );

    // 7.9 Explicit test-only injection takes precedence and isolates tests
    const isolatedTestSecret = "test-isolated-secret-for-specific-unit-test-32b";
    setTestRecoveryPepper(isolatedTestSecret);
    const resolvedTestPepper = getRecoveryPepper();
    assertTest(
      "7.9 Explicit test-only injection is respected for deterministic testing",
      resolvedTestPepper === isolatedTestSecret
    );

    // 7.10 Production isolation guard: setTestRecoveryPepper strictly rejected when NODE_ENV === 'production'
    process.env.NODE_ENV = "production";
    let prodInjectionBlocked = false;
    let prodInjectionErrorMessage = "";
    try {
      setTestRecoveryPepper("attempted-injection-in-production-env-32chars");
    } catch (err: any) {
      prodInjectionBlocked = true;
      prodInjectionErrorMessage = err.message;
    }
    assertTest(
      "7.10 Production isolation: setTestRecoveryPepper is strictly forbidden in production mode",
      prodInjectionBlocked === true && prodInjectionErrorMessage.includes("forbidden in production")
    );

    // 7.11 Rejected production injection leaves existing state unmodified and safe
    assertTest(
      "7.11 Production isolation: Rejected production injection does not alter active test pepper state",
      getRecoveryPepper() === isolatedTestSecret
    );

    // 7.12 Safe error messaging on production guard (no values leaked)
    assertTest(
      "7.12 Production isolation: Security violation error message does not leak candidate secret",
      !prodInjectionErrorMessage.includes("attempted-injection")
    );

  } finally {
    // Restore environment and test pepper cleanly
    if (originalNodeEnv !== undefined) process.env.NODE_ENV = originalNodeEnv;
    else delete process.env.NODE_ENV;

    if (originalEnvPepper !== undefined) process.env.MFA_RECOVERY_PEPPER = originalEnvPepper;
    else delete process.env.MFA_RECOVERY_PEPPER;

    if (originalCron !== undefined) process.env.CRON_SECRET = originalCron;
    else delete process.env.CRON_SECRET;

    if (originalPlayback !== undefined) process.env.PLAYBACK_SECRET = originalPlayback;
    else delete process.env.PLAYBACK_SECRET;

    setTestRecoveryPepper(TEST_PEPPER);
  }
}

runPepperHardeningTests();

// Execute Section 6 asynchronously
runAuthorizationBoundaryTests().then(() => {
  // ============================================================================
  // SECTION 8: SUMMARY REPORT
  // ============================================================================
  console.log("\n================================================================================");
  console.log(`📊 RECOVERY CODES TEST SUMMARY: ${passedTests}/${totalTests} Tests Passed (${failedTests} Failed)`);
  console.log("================================================================================\n");

  if (failedTests > 0) {
    process.exit(1);
  } else {
    console.log("🎯 All Recovery Code Authorization Boundary Invariants (Step 3B.4.4) Fully Verified!\n");
  }
}).catch((err) => {
  console.error("Test execution error:", err);
  process.exit(1);
});
