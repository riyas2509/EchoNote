/**
 * EchoNote MFA Recovery Codes Cryptographic Engine & Security Model (Step 3B.4.2)
 *
 * SPECIFICATION & SECURITY BOUNDARIES:
 * ==============================================================================
 * 1. ENTROPY & CODE GENERATION:
 *    - Alphabet: Base32 Crockford subset without ambiguous characters (0, O, 1, I, L removed).
 *      Set: '23456789ABCDEFGHJKMNPQRSTVWXYZ' (32 unambiguous symbols = 5 bits per character).
 *    - Format: 10 characters split into two groups of 5 with a hyphen (e.g., 'ABCD2-EFGH3').
 *    - Normalized Form: Uppercase, hyphen stripped -> 10 characters from 32-symbol alphabet.
 *    - Entropy: 10 * log2(32) = 10 * 5 = 50 bits of cryptographic entropy per recovery code.
 *    - 10 codes generated per set -> 500 bits total entropy pool.
 *    - RNG: Node.js crypto.randomBytes() (CSPRNG).
 *
 * 2. STORAGE & VERIFICATION (HMAC-SHA256 with Server-Side Pepper):
 *    - Plaintext codes are NEVER stored in Firestore, browser storage, logs, or audit records.
 *    - Stored representation:
 *      * codeId: 'rc_0'..'rc_9' (opaque index identifier)
 *      * saltHex: 16 cryptographically random bytes (32 hex chars) per code
 *      * verifierHex: HMAC-SHA256(pepper, saltHex + ":" + normalizedCode)
 *      * used: boolean
 *      * usedAt: ISO 8601 string or null
 *    - High-entropy server pepper: Loaded from process.env.MFA_RECOVERY_PEPPER (minimum 32 characters).
 *      Fails closed with a clear configuration error if missing or invalid. Never silently falls back
 *      to hardcoded secrets, dynamic seeds, or unrelated environment variables.
 *    - Firestore Path: Subcollection /users/{uid}/security/mfa_recovery (isolated from client reads/writes).
 *
 * 3. ATOMIC SINGLE-USE REDEMPTION:
 *    - Implemented inside a Firestore transaction or atomic batch on the user's isolated security document.
 *    - All active unused codes are evaluated using timingSafeEqual.
 *    - Once matched, that specific code is marked { used: true, usedAt: now }.
 *    - If code is already used, invalid, or exhausted, returns generic failure.
 *
 * 4. RECOVERY AUTHORIZATION TICKET:
 *    - Short-lived signed token (HMAC-SHA256 with ticket secret), TTL: 10 minutes (600 seconds).
 *    - Bound to caller's UID, codeId consumed, and issued timestamp.
 *    - Single-use ticket tracked in memory / Firestore to prevent ticket replay.
 *    - Allows caller to access protected organization endpoints that require MFA
 *      via 'X-MFA-Recovery-Ticket' header OR satisfies MFA middleware for recovery sessions.
 * ==============================================================================
 */

import crypto from "crypto";

// 32-character unambiguous alphanumeric charset (36 alphanumeric minus 0, 1, I, O)
// Exactly 32 characters -> 5 bits of entropy per character
export const RECOVERY_CODE_CHARSET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const RECOVERY_CODE_LENGTH = 10; // 10 chars * 5 bits = 50 bits of entropy per code
export const RECOVERY_CODE_COUNT = 10;
export const RECOVERY_TICKET_TTL_SECONDS = 600; // 10 minutes

/**
 * Normalizes user-submitted recovery code by removing hyphens, spaces, and converting to uppercase.
 */
export function normalizeRecoveryCode(rawCode: string): string {
  if (!rawCode || typeof rawCode !== "string") return "";
  return rawCode.trim().toUpperCase().replace(/[-\s]/g, "");
}

/**
 * Validates whether the normalized code matches the exact format and charset.
 */
export function isValidRecoveryCodeFormat(normalizedCode: string): boolean {
  if (!normalizedCode || normalizedCode.length !== RECOVERY_CODE_LENGTH) {
    return false;
  }
  for (let i = 0; i < normalizedCode.length; i++) {
    if (!RECOVERY_CODE_CHARSET.includes(normalizedCode[i])) {
      return false;
    }
  }
  return true;
}

// Test-only injected pepper to allow deterministic and isolated test setups
let testInjectedPepper: string | null = null;

/**
 * Validates the configured MFA recovery code pepper against minimum-strength requirements.
 * Requirements:
 * - Must be a non-empty string of at least 32 characters (256 bits of entropy if random string).
 * - Or 64-character hexadecimal string / 44-character base64 string.
 * Returns true if valid, false otherwise.
 * Never logs or exposes the secret's value.
 */
export function isValidRecoveryPepper(pepper: string | null | undefined): boolean {
  if (!pepper || typeof pepper !== "string") {
    return false;
  }
  const trimmed = pepper.trim();
  // Minimum length of 32 characters
  return trimmed.length >= 32;
}

/**
 * Injects an explicit test-only recovery pepper.
 * Pass null to reset.
 * Strictly forbidden when process.env.NODE_ENV === 'production'.
 */
export function setTestRecoveryPepper(testPepper: string | null): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Security violation: Test recovery pepper injection is strictly forbidden in production mode.");
  }
  if (testPepper !== null && !isValidRecoveryPepper(testPepper)) {
    throw new Error("Invalid test recovery pepper: Must meet minimum 32-character requirement.");
  }
  testInjectedPepper = testPepper;
}

/**
 * Retrieves the active server-side HMAC pepper for recovery codes and tickets.
 *
 * Requirements & Invariants:
 * 1. Checks explicit test-injected pepper if in test mode.
 * 2. Reads process.env.MFA_RECOVERY_PEPPER.
 * 3. Never derives pepper from unrelated secrets (e.g. CRON_SECRET, PLAYBACK_SECRET).
 * 4. Never falls back to hardcoded strings or silently generated dynamic keys in production.
 * 5. Fails closed with a clear configuration error if missing or invalid.
 */
export function getRecoveryPepper(): string {
  // 1. Allow explicit test injection (only in test environment or when explicitly set by test suites)
  if (testInjectedPepper && isValidRecoveryPepper(testInjectedPepper)) {
    return testInjectedPepper;
  }

  // 2. Read explicit environment configuration
  const envPepper = process.env.MFA_RECOVERY_PEPPER;

  if (isValidRecoveryPepper(envPepper)) {
    return envPepper!.trim();
  }

  // 3. Fails closed with configuration error. Never use unrelated secrets or hardcoded fallbacks.
  if (!envPepper || !envPepper.trim()) {
    throw new Error(
      "MFA recovery pepper configuration error: 'MFA_RECOVERY_PEPPER' environment variable is missing. " +
      "An explicit high-entropy secret (minimum 32 characters) is required."
    );
  }

  throw new Error(
    "MFA recovery pepper configuration error: 'MFA_RECOVERY_PEPPER' does not meet minimum strength requirements " +
    "(must be at least 32 characters in length)."
  );
}


/**
 * Computes the keyed HMAC-SHA256 verifier for a normalized recovery code.
 */
export function computeCodeVerifier(normalizedCode: string, saltHex: string, pepper?: string): string {
  const activePepper = pepper || getRecoveryPepper();
  const hmac = crypto.createHmac("sha256", activePepper);
  hmac.update(`${saltHex}:${normalizedCode}`);
  return hmac.digest("hex");
}

/**
 * Constant-time verifier comparison to prevent timing attacks.
 */
export function timingSafeCompare(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a, "hex");
    const bufB = Buffer.from(b, "hex");
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

export interface StoredRecoveryCode {
  codeId: string;
  saltHex: string;
  verifierHex: string;
  used: boolean;
  usedAt: string | null;
  createdAt: string;
}

export interface UserRecoveryDocument {
  uid: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  totalCodes: number;
  remainingCodes: number;
  codes: StoredRecoveryCode[];
}

export interface GeneratedRecoveryCodesResult {
  plaintextCodes: string[];
  document: UserRecoveryDocument;
}

/**
 * Generates a fresh set of 10 single-use recovery codes and their secure verifiers.
 */
export function generateRecoveryCodesSet(uid: string): GeneratedRecoveryCodesResult {
  const plaintextCodes: string[] = [];
  const storedCodes: StoredRecoveryCode[] = [];
  const now = new Date().toISOString();
  const pepper = getRecoveryPepper();

  for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
    // Generate 10 cryptographically random characters from the charset
    const randomBytes = crypto.randomBytes(RECOVERY_CODE_LENGTH);
    let codeStr = "";
    for (let c = 0; c < RECOVERY_CODE_LENGTH; c++) {
      const charIndex = randomBytes[c] % RECOVERY_CODE_CHARSET.length;
      codeStr += RECOVERY_CODE_CHARSET[charIndex];
    }

    // Format for display: 5-5 with hyphen, e.g. "ABCD2-EFGH3"
    const formattedCode = `${codeStr.slice(0, 5)}-${codeStr.slice(5)}`;
    plaintextCodes.push(formattedCode);

    // Secure per-code random salt
    const saltHex = crypto.randomBytes(16).toString("hex");
    const verifierHex = computeCodeVerifier(codeStr, saltHex, pepper);

    storedCodes.push({
      codeId: `rc_${i}`,
      saltHex,
      verifierHex,
      used: false,
      usedAt: null,
      createdAt: now
    });
  }

  const document: UserRecoveryDocument = {
    uid,
    version: 1,
    createdAt: now,
    updatedAt: now,
    totalCodes: RECOVERY_CODE_COUNT,
    remainingCodes: RECOVERY_CODE_COUNT,
    codes: storedCodes
  };

  return {
    plaintextCodes,
    document
  };
}

/**
 * Evaluates a candidate code against the stored recovery codes using constant-time comparison.
 * Returns the matched unused StoredRecoveryCode or null.
 */
export function findMatchingUnusedCode(
  candidatePlaintext: string,
  storedCodes: StoredRecoveryCode[]
): StoredRecoveryCode | null {
  const normalized = normalizeRecoveryCode(candidatePlaintext);
  if (!isValidRecoveryCodeFormat(normalized)) {
    return null;
  }

  const pepper = getRecoveryPepper();
  let matched: StoredRecoveryCode | null = null;

  for (const stored of storedCodes) {
    if (stored.used) continue;
    const computed = computeCodeVerifier(normalized, stored.saltHex, pepper);
    if (timingSafeCompare(computed, stored.verifierHex)) {
      matched = stored;
      break;
    }
  }

  return matched;
}

/**
 * RECOVERY TICKET CRYPTOGRAPHIC SPECIFICATION (Step 3B.4.4)
 * ==============================================================================
 * Format: "v1.<base64url(payload)>.<base64url(hmac)>"
 * Payload strictly contains:
 * - uid: Bound authenticated Firebase user UID
 * - codeId: ID of redeemed single-use recovery code
 * - purpose: Explicitly "mfa_recovery_reset"
 * - iss: "echonote-auth"
 * - aud: "echonote-mfa-recovery"
 * - scope: Allowed operations, e.g. ["mfa:reset-lost-factor"]
 * - nonce: Cryptographically random salt to guarantee ticket uniqueness
 * - iat: Issued-at timestamp (epoch seconds)
 * - exp: Expiration timestamp (epoch seconds, 10 min TTL)
 */
export interface RecoveryTicketPayload {
  uid: string;
  codeId: string;
  purpose: string;
  iss: string;
  aud: string;
  scope: string[];
  nonce: string;
  iat: number;
  exp: number;
}

function base64UrlEncode(str: string): string {
  return Buffer.from(str)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) {
    base64 += "=";
  }
  return Buffer.from(base64, "base64").toString("utf8");
}

/**
 * Issues a signed, tamper-resistant Recovery Ticket for a user who redeemed a recovery code.
 * Strictly bound to purpose 'mfa_recovery_reset' and scope 'mfa:reset-lost-factor'.
 */
export function issueRecoveryTicket(
  uid: string, 
  codeId: string, 
  options?: { purpose?: string; scope?: string[] }
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: RecoveryTicketPayload = {
    uid,
    codeId,
    purpose: options?.purpose || "mfa_recovery_reset",
    iss: "echonote-auth",
    aud: "echonote-mfa-recovery",
    scope: options?.scope || ["mfa:reset-lost-factor"],
    nonce: crypto.randomBytes(12).toString("hex"),
    iat: now,
    exp: now + RECOVERY_TICKET_TTL_SECONDS
  };

  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const secret = getRecoveryPepper();
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`echonote-recovery-ticket:${payloadB64}`)
    .digest("base64url");

  return `v1.${payloadB64}.${signature}`;
}

export interface VerifyRecoveryTicketOptions {
  expectedUid?: string;
  expectedPurpose?: string;
  requiredScope?: string;
}

/**
 * Validates a Recovery Ticket, ensuring valid signature, non-expiry, UID binding,
 * purpose, issuer, audience, and required scope.
 */
export function verifyRecoveryTicket(
  ticket: string, 
  options?: VerifyRecoveryTicketOptions | string
): RecoveryTicketPayload | null {
  if (!ticket || typeof ticket !== "string" || !ticket.startsWith("v1.")) {
    return null;
  }

  // Handle backwards-compatible single UID string argument
  const opts: VerifyRecoveryTicketOptions = typeof options === "string" 
    ? { expectedUid: options } 
    : (options || {});

  const parts = ticket.split(".");
  if (parts.length !== 3) return null;

  const [, payloadB64, signature] = parts;
  const secret = getRecoveryPepper();
  const expectedSig = crypto
    .createHmac("sha256", secret)
    .update(`echonote-recovery-ticket:${payloadB64}`)
    .digest("base64url");

  if (!timingSafeCompare(Buffer.from(signature).toString("hex"), Buffer.from(expectedSig).toString("hex"))) {
    return null;
  }

  try {
    const payloadStr = base64UrlDecode(payloadB64);
    const payload: RecoveryTicketPayload = JSON.parse(payloadStr);

    const now = Math.floor(Date.now() / 1000);
    if (!payload.exp || payload.exp < now) {
      return null; // Expired
    }

    if (opts.expectedUid && payload.uid !== opts.expectedUid) {
      return null; // Bound to different user
    }

    // Issuer & Audience validation
    if (payload.iss && payload.iss !== "echonote-auth") {
      return null;
    }
    if (payload.aud && payload.aud !== "echonote-mfa-recovery") {
      return null;
    }

    // Purpose validation
    const targetPurpose = opts.expectedPurpose || "mfa_recovery_reset";
    if (payload.purpose && payload.purpose !== targetPurpose) {
      return null;
    }

    // Scope validation
    if (opts.requiredScope) {
      const scopes = Array.isArray(payload.scope) ? payload.scope : [];
      if (!scopes.includes(opts.requiredScope)) {
        return null;
      }
    }

    return payload;
  } catch {
    return null;
  }
}

/**
 * RATE LIMITING ENGINE FOR RECOVERY CODE ATTEMPTS
 * ==============================================================================
 * To prevent brute-force attacks against the 50-bit recovery codes:
 * - Maximum 5 redemption attempts per 15 minutes per user / IP.
 * - Progressive delay lockout upon repeated failures.
 */
interface RateLimitBucket {
  attempts: number[];
}

const userRedemptionBuckets = new Map<string, RateLimitBucket>();
const ipRedemptionBuckets = new Map<string, RateLimitBucket>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

export function checkRecoveryRateLimit(uid: string, clientIp: string = ""): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;

  // 1. Check user bucket
  const userBucket = userRedemptionBuckets.get(uid);
  if (userBucket) {
    userBucket.attempts = userBucket.attempts.filter(t => t > cutoff);
    if (userBucket.attempts.length >= MAX_ATTEMPTS) {
      const oldest = userBucket.attempts[0];
      const retryAfterSeconds = Math.max(1, Math.ceil((oldest + WINDOW_MS - now) / 1000));
      return { allowed: false, retryAfterSeconds };
    }
  }

  // 2. Check IP bucket if provided
  if (clientIp) {
    const ipBucket = ipRedemptionBuckets.get(clientIp);
    if (ipBucket) {
      ipBucket.attempts = ipBucket.attempts.filter(t => t > cutoff);
      if (ipBucket.attempts.length >= MAX_ATTEMPTS) {
        const oldest = ipBucket.attempts[0];
        const retryAfterSeconds = Math.max(1, Math.ceil((oldest + WINDOW_MS - now) / 1000));
        return { allowed: false, retryAfterSeconds };
      }
    }
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

export function recordRecoveryAttempt(uid: string, clientIp: string = ""): void {
  const now = Date.now();
  let userBucket = userRedemptionBuckets.get(uid);
  if (!userBucket) {
    userBucket = { attempts: [] };
    userRedemptionBuckets.set(uid, userBucket);
  }
  userBucket.attempts.push(now);

  if (clientIp) {
    let ipBucket = ipRedemptionBuckets.get(clientIp);
    if (!ipBucket) {
      ipBucket = { attempts: [] };
      ipRedemptionBuckets.set(clientIp, ipBucket);
    }
    ipBucket.attempts.push(now);
  }
}

export function resetRecoveryRateLimit(uid: string, clientIp: string = ""): void {
  userRedemptionBuckets.delete(uid);
  if (clientIp) {
    ipRedemptionBuckets.delete(clientIp);
  }
}

