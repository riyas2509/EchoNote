/**
 * lib/entraTokenValidation.ts
 *
 * Authoritative Microsoft Entra ID Token Validation & Cryptographic Identity Binding
 *
 * Remediations (Step 4B.2B):
 * 1. Mandatory Audience Validation: Resolves and enforces configured Microsoft application
 *    client ID; strictly rejects missing audience config, audience mismatches, and
 *    Microsoft Graph / resource tokens.
 * 2. Cryptographic Identity Binding: Binds Microsoft token immutable identity (oid/sub)
 *    to the authenticated Firebase session (req.user.firebase.identities['microsoft.com']).
 *    Strictly prevents detached-token identity substitution, cross-account privilege escalation,
 *    and unverified group synchronization.
 * 3. Hardened Key & Issuer Validation: Preserves JWKS key metadata (including issuer), validates
 *    compatibility against token issuer/tenant, supports v1 and v2 discovery, enforces RS256,
 *    and protects against cache stampedes via in-flight request deduplication and negative caching.
 * 4. Authentication-Attempt & Replay Defenses: Enforces sign-in freshness between Firebase
 *    auth_time and Microsoft iat, and prevents token replay via cryptographic hash consumption.
 */

import crypto from 'crypto';
import https from 'https';
import admin from 'firebase-admin';
import { getAdminFirestore } from './firebaseAdmin.ts';

export const MICROSOFT_V2_JWKS_URI = 'https://login.microsoftonline.com/common/discovery/v2.0/keys';
export const MICROSOFT_V1_JWKS_URI = 'https://login.microsoftonline.com/common/discovery/keys';

export const GRAPH_RESOURCES = [
  'https://graph.microsoft.com',
  'https://graph.microsoft.com/',
  '00000003-0000-0000-c000-000000000000'
];

export type EntraValidationErrorCode =
  | 'VALID'
  | 'MISSING_EVIDENCE'
  | 'MALFORMED_TOKEN'
  | 'SIGNATURE_INVALID'
  | 'KEY_NOT_FOUND'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_NOT_YET_VALID'
  | 'ISSUER_MISMATCH'
  | 'AUDIENCE_MISMATCH'
  | 'TENANT_MISMATCH'
  | 'JWKS_FETCH_FAILED'
  | 'IDENTITY_SUBSTITUTION_DETECTED'
  | 'TOKEN_REPLAYED'
  | 'REPLAY_STORE_UNAVAILABLE'
  | 'TOKEN_TYPE_INVALID'
  | 'UNSUPPORTED_TOKEN_VERSION';

export interface EntraTokenHeader {
  alg: string;
  kid?: string;
  typ?: string;
  x5t?: string;
}

export interface EntraTokenClaims {
  iss?: string;
  tid?: string;
  sub?: string;
  oid?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  iat?: number;
  ver?: string;
  nonce?: string;
  name?: string;
  preferred_username?: string;
  email?: string;
  upn?: string;
  roles?: string[];
  groups?: string[];
  amr?: string[];
  department?: string;
  jobTitle?: string;
  scp?: string;
  idtyp?: string;
  [key: string]: any;
}

export interface ReplayLease {
  store: EntraReplayStore;
  fingerprint: string;
  operationId: string;
}

export interface AuthoritativeTenantResult {
  valid: boolean;
  code: EntraValidationErrorCode;
  tenantId?: string;
  claims?: EntraTokenClaims;
  error?: string;
  source: 'direct_id_token' | 'firebase_verified_attributes' | 'none';
  replayLease?: ReplayLease;
}

export interface ValidateTenantOptions {
  expectedTenantId?: string;
  allowedTenantIds?: string[];
  expectedAudience?: string | string[];
  clockToleranceSeconds?: number;
  authTimeToleranceSeconds?: number;
  jwksFetcher?: (jwksUri: string) => Promise<{ keys: any[] }>;
  timeoutMs?: number;
  firebaseUserFetcher?: (uid: string) => Promise<any>;
  db?: any;
  replayStore?: EntraReplayStore;
  twoPhaseReplay?: boolean;
}

export interface MicrosoftJwkRecord {
  keyObj: crypto.KeyObject;
  kid: string;
  issuer?: string;
  x5t?: string;
  rawJwk?: any;
}

// Memory cache for Microsoft JWKS keys
interface CachedJwks {
  keys: Map<string, MicrosoftJwkRecord>;
  fetchedAt: number;
}

let cachedV2Jwks: CachedJwks | null = null;
let inFlightJwksFetch: Promise<CachedJwks | null> | null = null;

// Negative cache for unknown kid values to defend against cache stampedes & request floods
const negativeKidCache = new Map<string, number>();
const NEGATIVE_CACHE_TTL_MS = 60 * 1000; // 60 seconds
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const MIN_REFRESH_INTERVAL_MS = 10 * 1000; // Minimum 10s between active refreshes
let lastJwksFetchTimestamp = 0;

// ============================================================================
// STEP 4B.2E: DISTRIBUTED, ATOMIC ENTRA REPLAY PROTECTION STORE
// ============================================================================

export type ReplayRecordStatus = 'in_flight' | 'completed' | 'failed';

export interface EntraReplayRecord {
  fingerprint: string;
  status: ReplayRecordStatus;
  operationId: string;
  operationType: string;
  tokenExpiresAt: number;
  leaseExpiresAt: number;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  failedAt?: number;
  subHash?: string | null;
  tid?: string | null;
  retryCount?: number;
  errorMessage?: string;
}

export interface EntraReplayStore {
  acquireLease(
    fingerprint: string,
    metadata: {
      exp: number; // in seconds
      sub?: string;
      tid?: string;
      leaseDurationMs?: number;
    }
  ): Promise<{
    acquired: boolean;
    operationId?: string;
    code?: EntraValidationErrorCode;
    error?: string;
  }>;

  finalize(
    fingerprint: string,
    operationId: string,
    metadata?: any
  ): Promise<void>;

  release(
    fingerprint: string,
    operationId: string,
    errorReason?: string
  ): Promise<void>;
}

export function computeTokenFingerprint(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken.trim()).digest('hex');
}

/**
 * Server-side Firestore-backed distributed replay store using atomic transactions.
 * Designed for multi-instance Cloud Run deployments.
 * Collection: sso_replay_records (denied by default to client SDK in firestore.rules).
 * Key: entra_{fingerprint} (deterministic collision-resistant SHA-256 derived).
 */
export class FirestoreEntraReplayStore implements EntraReplayStore {
  private dbInstance: any;
  private collectionName = 'sso_replay_records';

  constructor(db?: any) {
    this.dbInstance = db;
  }

  private resolveDb(): any {
    if (this.dbInstance) return this.dbInstance;
    try {
      return getAdminFirestore();
    } catch {
      return null;
    }
  }

  async acquireLease(
    fingerprint: string,
    metadata: {
      exp: number;
      sub?: string;
      tid?: string;
      leaseDurationMs?: number;
    }
  ): Promise<{
    acquired: boolean;
    operationId?: string;
    code?: EntraValidationErrorCode;
    error?: string;
  }> {
    const db = this.resolveDb();
    if (!db) {
      return {
        acquired: false,
        code: 'REPLAY_STORE_UNAVAILABLE',
        error: 'Authoritative Firestore database unavailable for replay lease acquisition'
      };
    }

    const docRef = db.collection(this.collectionName).doc(`entra_${fingerprint}`);
    const now = Date.now();
    const leaseDuration = metadata.leaseDurationMs || 60000;
    const tokenExpMs = (metadata.exp || 0) * 1000;
    const newOperationId = crypto.randomUUID();
    const subHash = metadata.sub ? crypto.createHash('sha256').update(metadata.sub).digest('hex') : null;

    try {
      return await db.runTransaction(async (tx: any) => {
        const snap = await tx.get(docRef);

        if (snap.exists) {
          const data = snap.data() || {};

          // 1. Token expiration check
          if (data.tokenExpiresAt && data.tokenExpiresAt <= now) {
            return {
              acquired: false,
              code: 'TOKEN_EXPIRED',
              error: 'Authentication token has already expired'
            };
          }

          // 2. Already completed token -> strictly replayed
          if (data.status === 'completed') {
            return {
              acquired: false,
              code: 'TOKEN_REPLAYED',
              error: 'This Microsoft identity token has already been consumed for authentication'
            };
          }

          // 3. In-flight token: check if lease is active
          if (data.status === 'in_flight') {
            if (data.leaseExpiresAt && data.leaseExpiresAt > now) {
              return {
                acquired: false,
                code: 'TOKEN_REPLAYED',
                error: 'This Microsoft identity token is currently being processed by another active request'
              };
            }
            // Prior lease expired (crash/timeout). Safe retry recovery!
            tx.update(docRef, {
              status: 'in_flight',
              operationId: newOperationId,
              leaseExpiresAt: now + leaseDuration,
              updatedAt: now,
              retryCount: (data.retryCount || 0) + 1
            });
            return {
              acquired: true,
              operationId: newOperationId
            };
          }

          // 4. Failed token: prior attempt hit transient error. Safe retry!
          if (data.status === 'failed') {
            tx.update(docRef, {
              status: 'in_flight',
              operationId: newOperationId,
              leaseExpiresAt: now + leaseDuration,
              updatedAt: now,
              retryCount: (data.retryCount || 0) + 1
            });
            return {
              acquired: true,
              operationId: newOperationId
            };
          }

          return {
            acquired: false,
            code: 'TOKEN_REPLAYED',
            error: 'Invalid replay record state detected in distributed store'
          };
        }

        // Fresh token: claim atomic lease
        tx.set(docRef, {
          fingerprint,
          status: 'in_flight',
          operationId: newOperationId,
          operationType: 'entra_sso_auth',
          tokenExpiresAt: tokenExpMs,
          leaseExpiresAt: now + leaseDuration,
          createdAt: now,
          updatedAt: now,
          subHash,
          tid: metadata.tid || null,
          retryCount: 0
        });

        return {
          acquired: true,
          operationId: newOperationId
        };
      });
    } catch (err: any) {
      console.error('❌ Distributed replay store transaction failed:', err);
      // FAIL CLOSED: Never fall back to in-memory cache!
      return {
        acquired: false,
        code: 'REPLAY_STORE_UNAVAILABLE',
        error: `Distributed replay verification store unavailable: ${err.message || 'database error'}`
      };
    }
  }

  async finalize(fingerprint: string, operationId: string, metadata?: any): Promise<void> {
    const db = this.resolveDb();
    if (!db) throw new Error('Firestore database unavailable for replay finalization');
    const docRef = db.collection(this.collectionName).doc(`entra_${fingerprint}`);
    const now = Date.now();

    await db.runTransaction(async (tx: any) => {
      const snap = await tx.get(docRef);
      if (!snap.exists) {
        throw new Error('Replay record not found during finalization');
      }
      const data = snap.data() || {};
      if (data.operationId !== operationId) {
        throw new Error(`Replay lease conflict during finalization (expected ${operationId}, found ${data.operationId})`);
      }
      tx.update(docRef, {
        status: 'completed',
        completedAt: now,
        updatedAt: now
      });
    });
  }

  async release(fingerprint: string, operationId: string, errorReason?: string): Promise<void> {
    const db = this.resolveDb();
    if (!db) return;
    const docRef = db.collection(this.collectionName).doc(`entra_${fingerprint}`);
    const now = Date.now();

    try {
      await db.runTransaction(async (tx: any) => {
        const snap = await tx.get(docRef);
        if (!snap.exists) return;
        const data = snap.data() || {};
        if (data.operationId !== operationId) return;
        if (data.status === 'completed') return;

        tx.update(docRef, {
          status: 'failed',
          failedAt: now,
          updatedAt: now,
          errorMessage: String(errorReason || '').slice(0, 500)
        });
      });
    } catch (err) {
      console.warn('⚠️ Failed to release replay lease on transient error:', err);
    }
  }
}

/**
 * In-memory replay store implementing identical atomic lease state-machine semantics.
 * Used for hermetic unit testing and simulated concurrency tests.
 */
export class MemoryEntraReplayStore implements EntraReplayStore {
  private records = new Map<string, EntraReplayRecord>();

  async acquireLease(
    fingerprint: string,
    metadata: {
      exp: number;
      sub?: string;
      tid?: string;
      leaseDurationMs?: number;
    }
  ): Promise<{
    acquired: boolean;
    operationId?: string;
    code?: EntraValidationErrorCode;
    error?: string;
  }> {
    const now = Date.now();
    const leaseDuration = metadata.leaseDurationMs || 60000;
    const tokenExpMs = (metadata.exp || 0) * 1000;
    const newOperationId = crypto.randomUUID();
    const subHash = metadata.sub ? crypto.createHash('sha256').update(metadata.sub).digest('hex') : null;

    const existing = this.records.get(fingerprint);
    if (existing) {
      if (existing.tokenExpiresAt && existing.tokenExpiresAt <= now) {
        return {
          acquired: false,
          code: 'TOKEN_EXPIRED',
          error: 'Authentication token has already expired'
        };
      }
      if (existing.status === 'completed') {
        return {
          acquired: false,
          code: 'TOKEN_REPLAYED',
          error: 'This Microsoft identity token has already been consumed for authentication'
        };
      }
      if (existing.status === 'in_flight') {
        if (existing.leaseExpiresAt && existing.leaseExpiresAt > now) {
          return {
            acquired: false,
            code: 'TOKEN_REPLAYED',
            error: 'This Microsoft identity token is currently being processed by another active request'
          };
        }
        // Expired lease recovery
        existing.status = 'in_flight';
        existing.operationId = newOperationId;
        existing.leaseExpiresAt = now + leaseDuration;
        existing.updatedAt = now;
        existing.retryCount = (existing.retryCount || 0) + 1;
        return { acquired: true, operationId: newOperationId };
      }
      if (existing.status === 'failed') {
        existing.status = 'in_flight';
        existing.operationId = newOperationId;
        existing.leaseExpiresAt = now + leaseDuration;
        existing.updatedAt = now;
        existing.retryCount = (existing.retryCount || 0) + 1;
        return { acquired: true, operationId: newOperationId };
      }
      return {
        acquired: false,
        code: 'TOKEN_REPLAYED',
        error: 'Invalid replay record state'
      };
    }

    this.records.set(fingerprint, {
      fingerprint,
      status: 'in_flight',
      operationId: newOperationId,
      operationType: 'entra_sso_auth',
      tokenExpiresAt: tokenExpMs,
      leaseExpiresAt: now + leaseDuration,
      createdAt: now,
      updatedAt: now,
      subHash,
      tid: metadata.tid || null,
      retryCount: 0
    });

    return { acquired: true, operationId: newOperationId };
  }

  async finalize(fingerprint: string, operationId: string): Promise<void> {
    const existing = this.records.get(fingerprint);
    if (!existing) throw new Error('Replay record not found during finalization');
    if (existing.operationId !== operationId) {
      throw new Error(`Replay lease conflict during finalization`);
    }
    existing.status = 'completed';
    existing.completedAt = Date.now();
    existing.updatedAt = Date.now();
  }

  async release(fingerprint: string, operationId: string, errorReason?: string): Promise<void> {
    const existing = this.records.get(fingerprint);
    if (!existing || existing.operationId !== operationId) return;
    if (existing.status === 'completed') return;
    existing.status = 'failed';
    existing.failedAt = Date.now();
    existing.updatedAt = Date.now();
    existing.errorMessage = errorReason;
  }

  clear(): void {
    this.records.clear();
  }

  getRecord(fingerprint: string): EntraReplayRecord | undefined {
    return this.records.get(fingerprint);
  }
}

// Global active custom replay store (for dependency injection / testing)
let customReplayStore: EntraReplayStore | null = null;

export function setCustomReplayStore(store: EntraReplayStore | null): void {
  customReplayStore = store;
}

export function resetCustomReplayStore(): void {
  customReplayStore = null;
}

export function getActiveReplayStore(dbInstance?: any): EntraReplayStore {
  if (customReplayStore) {
    return customReplayStore;
  }
  return new FirestoreEntraReplayStore(dbInstance);
}

export function resetReplayCache(): void {
  if (customReplayStore && typeof (customReplayStore as any).clear === 'function') {
    (customReplayStore as any).clear();
  } else {
    customReplayStore = new MemoryEntraReplayStore();
  }
}

export function isTokenReplayed(tokenFingerprint: string): boolean {
  if (customReplayStore instanceof MemoryEntraReplayStore) {
    const rec = customReplayStore.getRecord(tokenFingerprint);
    return !!rec && (rec.status === 'completed' || (rec.status === 'in_flight' && rec.leaseExpiresAt > Date.now()));
  }
  return false;
}

export function recordTokenConsumption(tokenFingerprint: string, exp: number, sub?: string, tid?: string): void {
  if (customReplayStore instanceof MemoryEntraReplayStore) {
    customReplayStore.acquireLease(tokenFingerprint, { exp, sub, tid }).then(res => {
      if (res.acquired && res.operationId) {
        customReplayStore!.finalize(tokenFingerprint, res.operationId);
      }
    });
  }
}

export function clearNegativeKidCache(): void {
  negativeKidCache.clear();
}

// Dependency injection hook for hermetic unit testing
let customJwksFetcher: ((jwksUri: string) => Promise<{ keys: any[] }>) | null = null;

export function setCustomJwksFetcher(fetcher: ((jwksUri: string) => Promise<{ keys: any[] }>) | null): void {
  customJwksFetcher = fetcher;
  cachedV2Jwks = null;
  inFlightJwksFetch = null;
  negativeKidCache.clear();
  if (fetcher && !customReplayStore) {
    customReplayStore = new MemoryEntraReplayStore();
  }
}

export function resetCustomJwksFetcher(): void {
  customJwksFetcher = null;
  cachedV2Jwks = null;
  inFlightJwksFetch = null;
  negativeKidCache.clear();
  resetCustomReplayStore();
}

/**
 * Fetches JSON from an HTTPS URL with timeout.
 */
function defaultFetchHttpsJson(urlStr: string, timeoutMs: number = 5000): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.get(urlStr, { timeout: timeoutMs }, (res) => {
      if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
        res.resume();
        return reject(new Error(`JWKS request failed with HTTP status ${res.statusCode}`));
      }
      let rawData = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        rawData += chunk;
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(rawData));
        } catch (e: any) {
          reject(new Error(`Failed to parse JWKS JSON: ${e.message}`));
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`JWKS request timed out after ${timeoutMs}ms`));
    });

    req.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Retrieves the cryptographic public key for a given kid from Microsoft JWKS.
 * Enforces negative caching for unknown kid values, bounded refresh rates,
 * in-flight request deduplication, and key-issuer binding validation.
 */
export async function getMicrosoftPublicKey(
  kid: string,
  tokenIssuer?: string,
  options?: { jwksFetcher?: (jwksUri: string) => Promise<{ keys: any[] }>; timeoutMs?: number }
): Promise<crypto.KeyObject | null> {
  const now = Date.now();

  // 1. Negative cache check: If this kid was recently not found, reject immediately without hitting network
  const negativeEntry = negativeKidCache.get(kid);
  if (negativeEntry && (now - negativeEntry < NEGATIVE_CACHE_TTL_MS)) {
    return null;
  }

  // 2. Fast-path: Check existing cached keys
  if (cachedV2Jwks && (now - cachedV2Jwks.fetchedAt < CACHE_TTL_MS)) {
    const existingKey = cachedV2Jwks.keys.get(kid);
    if (existingKey) {
      if (isKeyIssuerIncompatible(existingKey, tokenIssuer)) {
        return null;
      }
      return existingKey.keyObj;
    }
  }

  // 3. Refresh throttling: Do not allow unbounded re-fetches to external endpoint
  if (!customJwksFetcher && cachedV2Jwks && (now - lastJwksFetchTimestamp < MIN_REFRESH_INTERVAL_MS)) {
    negativeKidCache.set(kid, now);
    return null;
  }

  // 4. In-flight request deduplication
  const fetcher = options?.jwksFetcher || customJwksFetcher || ((uri: string) => defaultFetchHttpsJson(uri, options?.timeoutMs || 5000));

  if (!inFlightJwksFetch) {
    lastJwksFetchTimestamp = now;
    inFlightJwksFetch = (async () => {
      try {
        const jwksData = await fetcher(MICROSOFT_V2_JWKS_URI);
        const keysMap = new Map<string, MicrosoftJwkRecord>();

        if (Array.isArray(jwksData?.keys)) {
          for (const jwk of jwksData.keys) {
            if (jwk.kty === 'RSA' && jwk.n && jwk.e) {
              try {
                const keyObj = crypto.createPublicKey({ key: jwk, format: 'jwk' });
                if (jwk.kid) {
                  keysMap.set(jwk.kid, {
                    keyObj,
                    kid: jwk.kid,
                    issuer: typeof jwk.issuer === 'string' ? jwk.issuer.trim() : undefined,
                    x5t: jwk.x5t,
                    rawJwk: jwk
                  });
                }
              } catch {
                // Ignore malformed individual JWK
              }
            }
          }
        }

        const freshCache: CachedJwks = {
          keys: keysMap,
          fetchedAt: Date.now()
        };
        cachedV2Jwks = freshCache;
        return freshCache;
      } catch (err) {
        console.warn("⚠️ Failed to refresh Microsoft JWKS keys:", err);
        return null;
      } finally {
        inFlightJwksFetch = null;
      }
    })();
  }

  const refreshedCache = await inFlightJwksFetch;
  if (!refreshedCache) {
    return null;
  }

  const foundKey = refreshedCache.keys.get(kid);
  if (!foundKey) {
    // Record in negative cache so subsequent requests fail fast
    negativeKidCache.set(kid, Date.now());
    return null;
  }

  // Check key issuer compatibility
  if (isKeyIssuerIncompatible(foundKey, tokenIssuer)) {
    return null;
  }

  return foundKey.keyObj;
}

/**
 * Validates whether a JWK key's documented issuer is compatible with the token issuer.
 */
function isKeyIssuerIncompatible(keyRecord: MicrosoftJwkRecord, tokenIssuer?: string): boolean {
  if (!keyRecord.issuer || !tokenIssuer) {
    return false; // Key has no explicit issuer restriction
  }

  const normalizedKeyIssuer = keyRecord.issuer.toLowerCase().trim();
  const normalizedTokenIssuer = tokenIssuer.toLowerCase().trim();

  // If the key issuer has a tenant placeholder, e.g. https://login.microsoftonline.com/{tenantid}/v2.0
  if (normalizedKeyIssuer.includes('{tenantid}')) {
    const prefix = normalizedKeyIssuer.split('{tenantid}')[0];
    return !normalizedTokenIssuer.startsWith(prefix);
  }

  // Exact comparison
  return normalizedKeyIssuer !== normalizedTokenIssuer;
}

/**
 * Safely parses a base64url encoded string into a UTF-8 JSON object.
 */
export function parseJwtPart<T = any>(part: string): T | null {
  try {
    const normalized = part.replace(/-/g, '+').replace(/_/g, '/');
    const buff = Buffer.from(normalized, 'base64');
    return JSON.parse(buff.toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * Validates whether an issuer string matches authoritative Microsoft Entra format for a given tenant ID.
 */
export function isValidEntraIssuer(issuer: string, tenantId: string): boolean {
  if (!issuer || !tenantId) return false;
  const normalizedTenant = tenantId.toLowerCase().trim();
  const v2Expected = `https://login.microsoftonline.com/${normalizedTenant}/v2.0`;
  const v1Expected = `https://sts.windows.net/${normalizedTenant}/`;
  const normalizedIssuer = issuer.toLowerCase().trim();
  return normalizedIssuer === v2Expected.toLowerCase() || normalizedIssuer === v1Expected.toLowerCase();
}

/**
 * Validates whether a tenant ID is a syntactically valid GUID / UUID or domain name.
 * Strictly rejects empty, non-string, or malformed strings.
 */
export function isValidTenantIdFormat(tenantId: string): boolean {
  if (!tenantId || typeof tenantId !== 'string') return false;
  const trimmed = tenantId.trim();
  // Standard UUID format (8-4-4-4-12 hex)
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  // Domain format (e.g. contoso.onmicrosoft.com)
  const domainRegex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
  return uuidRegex.test(trimmed) || domainRegex.test(trimmed);
}

export interface ResolvedTenantPolicy {
  valid: boolean;
  expectedTenantId?: string;
  allowedTenantIds: string[];
  error?: string;
  errorCode?: 'SSO_TENANT_POLICY_MISSING' | 'SSO_TENANT_POLICY_INVALID';
}

/**
 * Resolves and validates an organization's authoritative Microsoft Entra tenant policy.
 * Organizations enforcing Microsoft Entra SSO must have an explicit, valid tenant policy.
 * Never infers tenant ID from email domain, client request, or unverified claims.
 */
export function resolveAuthoritativeTenantPolicy(
  orgData: any,
  secSettings: any
): ResolvedTenantPolicy {
  const primaryTenant = (secSettings?.entraTenantId || orgData?.entraTenantId || '').trim();
  const rawAllowed = secSettings?.allowedEntraTenants || orgData?.allowedEntraTenants;

  const allowedTenants: string[] = [];

  if (primaryTenant) {
    if (!isValidTenantIdFormat(primaryTenant)) {
      return {
        valid: false,
        allowedTenantIds: [],
        errorCode: 'SSO_TENANT_POLICY_INVALID',
        error: `Organization primary entraTenantId '${primaryTenant}' is malformed or invalid.`
      };
    }
    allowedTenants.push(primaryTenant);
  }

  if (Array.isArray(rawAllowed)) {
    for (const t of rawAllowed) {
      if (typeof t === 'string' && t.trim()) {
        const trimmed = t.trim();
        if (!isValidTenantIdFormat(trimmed)) {
          return {
            valid: false,
            allowedTenantIds: [],
            errorCode: 'SSO_TENANT_POLICY_INVALID',
            error: `Organization allowedEntraTenants entry '${trimmed}' is malformed or invalid.`
          };
        }
        if (!allowedTenants.includes(trimmed)) {
          allowedTenants.push(trimmed);
        }
      }
    }
  }

  if (allowedTenants.length === 0) {
    return {
      valid: false,
      allowedTenantIds: [],
      errorCode: 'SSO_TENANT_POLICY_MISSING',
      error: 'Organization has not configured an authoritative Microsoft Entra tenant policy.'
    };
  }

  return {
    valid: true,
    expectedTenantId: primaryTenant || allowedTenants[0],
    allowedTenantIds: allowedTenants
  };
}

export interface ResolvedClientPolicy {
  clientId?: string;
  source: 'organization_explicit' | 'shared_multi_tenant_app' | 'none';
  hasConflict?: boolean;
  conflictDetails?: string;
}

/**
 * Resolves the authoritative Microsoft application client ID for an organization.
 * Prevents global env fallback from silently overriding an org or running without strict tenant isolation.
 */
export function resolveAuthoritativeMicrosoftClientId(
  orgData: any,
  secSettings: any,
  options?: { allowSharedApp?: boolean }
): ResolvedClientPolicy {
  const candidates: { id: string; field: string }[] = [];

  if (secSettings?.entraClientId && typeof secSettings.entraClientId === 'string' && secSettings.entraClientId.trim()) {
    candidates.push({ id: secSettings.entraClientId.trim(), field: 'securitySettings.entraClientId' });
  }
  if (orgData?.entraClientId && typeof orgData.entraClientId === 'string' && orgData.entraClientId.trim()) {
    candidates.push({ id: orgData.entraClientId.trim(), field: 'organization.entraClientId' });
  }
  if (secSettings?.microsoftClientId && typeof secSettings.microsoftClientId === 'string' && secSettings.microsoftClientId.trim()) {
    candidates.push({ id: secSettings.microsoftClientId.trim(), field: 'securitySettings.microsoftClientId' });
  }
  const oidcClientId = orgData?.oidcConfig?.clientId || secSettings?.oidcConfig?.clientId;
  if (oidcClientId && typeof oidcClientId === 'string' && oidcClientId.trim()) {
    candidates.push({ id: oidcClientId.trim(), field: 'oidcConfig.clientId' });
  }

  if (candidates.length > 0) {
    const primaryId = candidates[0].id.toLowerCase();
    for (let i = 1; i < candidates.length; i++) {
      if (candidates[i].id.toLowerCase() !== primaryId) {
        return {
          source: 'organization_explicit',
          hasConflict: true,
          conflictDetails: `Conflicting Microsoft client IDs configured across organization settings: ${candidates[0].field}='${candidates[0].id}' vs ${candidates[i].field}='${candidates[i].id}'`
        };
      }
    }
    return {
      clientId: candidates[0].id,
      source: 'organization_explicit'
    };
  }

  // Fallback to shared application client ID ONLY if explicitly allowed and an authoritative tenant policy exists
  const sharedEnvClientId = (
    process.env.MICROSOFT_CLIENT_ID ||
    process.env.ENTRA_CLIENT_ID ||
    process.env.AZURE_CLIENT_ID ||
    ""
  ).trim();

  if (sharedEnvClientId && options?.allowSharedApp) {
    return {
      clientId: sharedEnvClientId,
      source: 'shared_multi_tenant_app'
    };
  }

  return {
    source: 'none'
  };
}

/**
 * Authoritatively resolves verified Microsoft provider identities (immutable oid/sub)
 * linked to the authenticated Firebase user session.
 *
 * Step 4B.2D Hardening:
 * 1. Checks decoded Firebase ID token claims (identities['microsoft.com']).
 * 2. If identities list is missing or empty, queries Firebase Admin Auth to retrieve
 *    the authoritative user record.
 * 3. Strictly asserts userRecord.uid === reqUser.uid.
 * 4. Extracts provider UIDs from userRecord.providerData where providerId === 'microsoft.com'.
 * 5. Returns empty array if no verified Microsoft provider identity is found.
 */
export async function resolveVerifiedMicrosoftIdentities(
  reqUser: any,
  firebaseUserFetcher?: (uid: string) => Promise<any>
): Promise<string[]> {
  const verifiedIds: string[] = [];

  // 1. Check decoded Firebase ID token claims
  const fbIdentities = reqUser?.firebase?.identities?.['microsoft.com'];
  if (Array.isArray(fbIdentities)) {
    for (const id of fbIdentities) {
      if (typeof id === 'string' && id.trim()) {
        const norm = id.trim().toLowerCase();
        if (!verifiedIds.includes(norm)) {
          verifiedIds.push(norm);
        }
      }
    }
  }

  // 2. If no identities were found in decoded token claims, query authoritative Firebase Admin Auth
  if (verifiedIds.length === 0 && reqUser?.uid) {
    try {
      let userRecord: any = null;
      if (firebaseUserFetcher) {
        userRecord = await firebaseUserFetcher(reqUser.uid);
      } else {
        userRecord = await admin.auth().getUser(reqUser.uid);
      }

      // Verify that the retrieved Firebase user UID matches the authenticated request user
      if (userRecord && userRecord.uid === reqUser.uid && Array.isArray(userRecord.providerData)) {
        for (const p of userRecord.providerData) {
          if (p && p.providerId === 'microsoft.com' && typeof p.uid === 'string' && p.uid.trim()) {
            const norm = p.uid.trim().toLowerCase();
            if (!verifiedIds.includes(norm)) {
              verifiedIds.push(norm);
            }
          }
        }
      }
    } catch (err: any) {
      console.warn("⚠️ Could not retrieve authoritative Firebase user record for Microsoft provider verification:", err?.message || err);
    }
  }

  return verifiedIds;
}

/**
 * Authoritatively validates a raw Microsoft Entra ID Token (JWT).
 * Enforces:
 * - Mandatory audience validation (application client ID)
 * - Microsoft Graph / resource token rejection
 * - RS256 signature verification against Microsoft JWKS
 * - Signing-key issuer binding
 * - Supported token version & issuer consistency
 * - Tenant ID isolation
 * - Expiration and temporal validity
 */
export async function verifyRawEntraIdToken(
  rawIdToken: string,
  options?: ValidateTenantOptions
): Promise<AuthoritativeTenantResult> {
  if (!rawIdToken || typeof rawIdToken !== 'string') {
    return {
      valid: false,
      code: 'MISSING_EVIDENCE',
      error: 'ID token is missing or not a string',
      source: 'none'
    };
  }

  // Mandatory Audience Configuration: Reject if expected audience is not configured
  if (
    !options?.expectedAudience ||
    (Array.isArray(options.expectedAudience) && options.expectedAudience.length === 0) ||
    (typeof options.expectedAudience === 'string' && !options.expectedAudience.trim())
  ) {
    return {
      valid: false,
      code: 'AUDIENCE_MISMATCH',
      error: 'Missing mandatory expected audience configuration: organization has not configured a valid Microsoft application client ID',
      source: 'direct_id_token'
    };
  }

  const parts = rawIdToken.trim().split('.');
  if (parts.length !== 3) {
    return {
      valid: false,
      code: 'MALFORMED_TOKEN',
      error: 'ID token does not conform to three-part JWS compact serialization',
      source: 'none'
    };
  }

  const [headerB64, payloadB64, signatureB64] = parts;
  const header: EntraTokenHeader | null = parseJwtPart(headerB64);
  const payload: EntraTokenClaims | null = parseJwtPart(payloadB64);

  if (!header || !payload) {
    return {
      valid: false,
      code: 'MALFORMED_TOKEN',
      error: 'ID token header or payload is not valid JSON',
      source: 'none'
    };
  }

  if (header.alg !== 'RS256') {
    return {
      valid: false,
      code: 'SIGNATURE_INVALID',
      error: `Unsupported algorithm: expected RS256, received ${header.alg}`,
      source: 'none'
    };
  }

  if (!header.kid) {
    return {
      valid: false,
      code: 'KEY_NOT_FOUND',
      error: 'ID token header missing key ID (kid)',
      source: 'none'
    };
  }

  // Token Type & Resource Discrimination: Reject Microsoft Graph access tokens and resource tokens
  const tokenAuds = Array.isArray(payload.aud)
    ? payload.aud.map(a => String(a).toLowerCase().trim())
    : [String(payload.aud || '').toLowerCase().trim()];

  if (tokenAuds.some(aud => GRAPH_RESOURCES.some(graphAud => aud === graphAud.toLowerCase()))) {
    return {
      valid: false,
      code: 'TOKEN_TYPE_INVALID',
      error: 'Microsoft Graph access tokens and resource tokens are strictly rejected as ID token identity evidence',
      source: 'direct_id_token'
    };
  }

  // Reject daemon/app-only tokens or access tokens masquerading as ID tokens
  if (payload.idtyp === 'app' || (payload.scp && !payload.sub && !payload.oid)) {
    return {
      valid: false,
      code: 'TOKEN_TYPE_INVALID',
      error: 'Application-only daemon tokens and access tokens are not valid user identity tokens',
      source: 'direct_id_token'
    };
  }

  // Mandatory Audience Validation: Verify token audience against configured application client ID
  const expectedAudList = Array.isArray(options.expectedAudience)
    ? options.expectedAudience.map(a => a.trim().toLowerCase())
    : [options.expectedAudience.trim().toLowerCase()];

  const audienceMatches = tokenAuds.some(aud => expectedAudList.includes(aud));
  if (!audienceMatches) {
    return {
      valid: false,
      code: 'AUDIENCE_MISMATCH',
      error: 'Token audience does not match configured Microsoft application client ID',
      source: 'direct_id_token'
    };
  }

  // Tenant claim extraction
  const tokenTenantId = payload.tid || '';
  if (!tokenTenantId) {
    return {
      valid: false,
      code: 'TENANT_MISMATCH',
      error: 'Token payload missing required Microsoft Entra tid (tenant ID) claim',
      source: 'direct_id_token'
    };
  }

  // Supported Token Version & Issuer Consistency Rules
  if (payload.ver !== undefined && payload.ver !== null) {
    const verStr = String(payload.ver).trim();
    if (verStr !== '1.0' && verStr !== '2.0') {
      return {
        valid: false,
        code: 'UNSUPPORTED_TOKEN_VERSION',
        error: `Unsupported Microsoft Entra token version '${payload.ver}'. Only v1.0 and v2.0 are supported`,
        source: 'direct_id_token'
      };
    }

    const normalizedTenant = tokenTenantId.toLowerCase().trim();
    if (verStr === '2.0') {
      const v2Expected = `https://login.microsoftonline.com/${normalizedTenant}/v2.0`;
      if (payload.iss?.toLowerCase().trim() !== v2Expected) {
        return {
          valid: false,
          code: 'ISSUER_MISMATCH',
          error: `v2.0 token issuer '${payload.iss}' does not match expected format '${v2Expected}'`,
          source: 'direct_id_token'
        };
      }
    } else if (verStr === '1.0') {
      const v1Expected = `https://sts.windows.net/${normalizedTenant}/`;
      if (payload.iss?.toLowerCase().trim() !== v1Expected) {
        return {
          valid: false,
          code: 'ISSUER_MISMATCH',
          error: `v1.0 token issuer '${payload.iss}' does not match expected format '${v1Expected}'`,
          source: 'direct_id_token'
        };
      }
    }
  } else {
    // If ver is not explicitly present, still enforce valid v1 or v2 format
    if (!payload.iss || !isValidEntraIssuer(payload.iss, tokenTenantId)) {
      return {
        valid: false,
        code: 'ISSUER_MISMATCH',
        error: `Token issuer '${payload.iss}' does not match authoritative Microsoft format for tenant '${tokenTenantId}'`,
        source: 'direct_id_token'
      };
    }
  }

  // Cryptographically verify token signature against authoritative Microsoft JWKS
  const publicKey = await getMicrosoftPublicKey(header.kid, payload.iss, {
    jwksFetcher: options?.jwksFetcher,
    timeoutMs: options?.timeoutMs
  });

  if (!publicKey) {
    return {
      valid: false,
      code: 'KEY_NOT_FOUND',
      error: `Signing key with kid '${header.kid}' was not found in Microsoft JWKS or is incompatible with issuer`,
      source: 'none'
    };
  }

  const signedContent = `${headerB64}.${payloadB64}`;
  const signatureBytes = Buffer.from(signatureB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(signedContent);
  const isSignatureValid = verifier.verify(publicKey, signatureBytes);

  if (!isSignatureValid) {
    return {
      valid: false,
      code: 'SIGNATURE_INVALID',
      error: 'Cryptographic signature verification failed against Microsoft public key',
      source: 'none'
    };
  }

  // Temporal validation
  const now = Math.floor(Date.now() / 1000);
  const tolerance = options?.clockToleranceSeconds || 60; // 60s default clock skew

  if (typeof payload.exp === 'number' && payload.exp + tolerance <= now) {
    return {
      valid: false,
      code: 'TOKEN_EXPIRED',
      error: `Token expired at exp=${payload.exp}, current=${now}`,
      source: 'direct_id_token'
    };
  }

  if (typeof payload.nbf === 'number' && payload.nbf - tolerance > now) {
    return {
      valid: false,
      code: 'TOKEN_NOT_YET_VALID',
      error: `Token not valid until nbf=${payload.nbf}, current=${now}`,
      source: 'direct_id_token'
    };
  }

  // Expected tenant match if enforced
  if (options?.expectedTenantId || options?.allowedTenantIds) {
    const allowedList: string[] = [];
    if (options.expectedTenantId) {
      allowedList.push(options.expectedTenantId.toLowerCase().trim());
    }
    if (Array.isArray(options.allowedTenantIds)) {
      for (const t of options.allowedTenantIds) {
        if (typeof t === 'string' && t.trim()) {
          const norm = t.toLowerCase().trim();
          if (!allowedList.includes(norm)) {
            allowedList.push(norm);
          }
        }
      }
    }

    if (allowedList.length > 0 && !allowedList.includes(tokenTenantId.toLowerCase().trim())) {
      return {
        valid: false,
        code: 'TENANT_MISMATCH',
        tenantId: tokenTenantId,
        error: `Tenant mismatch: expected ${options.expectedTenantId || allowedList.join(', ')}, token contains ${tokenTenantId}`,
        source: 'direct_id_token'
      };
    }
  }

  return {
    valid: true,
    code: 'VALID',
    tenantId: tokenTenantId,
    claims: payload,
    source: 'direct_id_token'
  };
}

/**
 * Extracts and authoritatively verifies the Microsoft Entra tenant and user identity.
 *
 * Enforces Cryptographic Identity Binding (Step 4B.2B):
 * 1. Cryptographically verifies raw Microsoft ID token against Microsoft JWKS.
 * 2. Establishes the immutable Microsoft subject (oid and sub).
 * 3. Binds that identity to the authenticated Firebase user session:
 *    - Asserts reqUser has a linked 'microsoft.com' provider identity.
 *    - Asserts the token's immutable oid or sub matches the Firebase provider identity.
 *    - Asserts the token email/username matches the Firebase user email.
 *    - Asserts authentication attempt freshness (auth_time vs iat).
 *    - Prevents token replay via single-use hash consumption.
 * 4. Strictly rejects detached-token identity substitution.
 */
export async function validateAuthoritativeEntraTenant(
  reqUser: any,
  requestEvidence: { idToken?: string; credentialToken?: string; reportedTenantId?: string },
  options?: ValidateTenantOptions
): Promise<AuthoritativeTenantResult> {
  const rawToken = requestEvidence.idToken || requestEvidence.credentialToken;

  // Path A: A raw Microsoft Entra ID token was provided
  if (rawToken && typeof rawToken === 'string') {
    // 1. Cryptographic token verification (RSA signature, audience, issuer, tenant, expiration)
    const tokenResult = await verifyRawEntraIdToken(rawToken, options);
    if (!tokenResult.valid || !tokenResult.claims) {
      return tokenResult;
    }

    const payload = tokenResult.claims;

    // 2. Cryptographic Identity Binding: Bind Microsoft token to authenticated Firebase user
    if (!reqUser || typeof reqUser !== 'object' || !reqUser.uid) {
      return {
        valid: false,
        code: 'IDENTITY_SUBSTITUTION_DETECTED',
        error: 'Missing authenticated Firebase user session for Microsoft token binding',
        source: 'direct_id_token'
      };
    }

    const tokenOid = payload.oid ? String(payload.oid).trim().toLowerCase() : '';
    const tokenSub = payload.sub ? String(payload.sub).trim().toLowerCase() : '';
    const tokenEmail = (payload.email || payload.preferred_username || payload.upn || '').trim().toLowerCase();
    const sessionEmail = (reqUser.email || '').trim().toLowerCase();
    // Authoritatively resolve verified Microsoft provider identities
    // Step 4B.2D: Eliminates the empty-identity bypass.
    // Queries authoritative Firebase Admin Auth when identities array is missing or empty.
    const verifiedIds = await resolveVerifiedMicrosoftIdentities(reqUser, options?.firebaseUserFetcher);

    // Binding Check 1: User session must have a linked Microsoft OAuth provider identity
    // Never skip immutable-identifier comparison because an identity list is missing or empty!
    if (verifiedIds.length === 0) {
      return {
        valid: false,
        code: 'IDENTITY_SUBSTITUTION_DETECTED',
        error: 'Authenticated Firebase user session has no verified linked Microsoft OAuth identity',
        source: 'direct_id_token'
      };
    }

    // Binding Check 2: Immutable Microsoft subject (oid or sub) must match Firebase provider identity
    const matchesImmutableId = verifiedIds.some(
      (fbId: string) => (tokenOid && fbId === tokenOid) || (tokenSub && fbId === tokenSub)
    );

    if (!matchesImmutableId) {
      return {
        valid: false,
        code: 'IDENTITY_SUBSTITUTION_DETECTED',
        error: 'Microsoft identity (oid/sub) does not match the authenticated Firebase user provider identity',
        source: 'direct_id_token'
      };
    }

    // Binding Check 3: Email consistency check
    // Never treat matching email addresses as a replacement for immutable identity binding!
    if (tokenEmail && sessionEmail && tokenEmail !== sessionEmail) {
      return {
        valid: false,
        code: 'IDENTITY_SUBSTITUTION_DETECTED',
        error: `Microsoft token email (${tokenEmail}) does not match authenticated Firebase user email (${sessionEmail})`,
        source: 'direct_id_token'
      };
    }

    // Binding Check 4: Authentication attempt freshness
    if (reqUser.auth_time && payload.iat) {
      const tolerance = options?.authTimeToleranceSeconds || 600; // 10 minutes maximum delta
      const delta = Math.abs(reqUser.auth_time - payload.iat);
      if (delta > tolerance) {
        return {
          valid: false,
          code: 'TOKEN_EXPIRED',
          error: `Authentication attempt mismatch: Firebase session auth_time (${reqUser.auth_time}) and Microsoft token iat (${payload.iat}) differ by ${delta}s (tolerance: ${tolerance}s)`,
          source: 'direct_id_token'
        };
      }
    }

    // 3. Distributed Atomic Replay Protection (Step 4B.2E)
    // Atomically claim single-use lease in shared durable replay store.
    const tokenFingerprint = computeTokenFingerprint(rawToken);
    const replayStore = options?.replayStore || getActiveReplayStore(options?.db);
    const leaseResult = await replayStore.acquireLease(tokenFingerprint, {
      exp: payload.exp || Math.floor(Date.now() / 1000) + 3600,
      sub: tokenSub || tokenOid,
      tid: payload.tid
    });

    if (!leaseResult.acquired) {
      return {
        valid: false,
        code: leaseResult.code || 'TOKEN_REPLAYED',
        error: leaseResult.error || 'This Microsoft identity token has already been consumed for authentication',
        source: 'direct_id_token'
      };
    }

    // If caller did not request two-phase replay (e.g. standalone test/validation call),
    // finalize immediately to enforce single-use semantics:
    if (!options?.twoPhaseReplay) {
      try {
        await replayStore.finalize(tokenFingerprint, leaseResult.operationId!);
      } catch (err: any) {
        console.error('⚠️ Failed to auto-finalize replay lease:', err);
      }
    }

    return {
      valid: true,
      code: 'VALID',
      tenantId: tokenResult.tenantId,
      claims: payload,
      source: 'direct_id_token',
      replayLease: {
        store: replayStore,
        fingerprint: tokenFingerprint,
        operationId: leaseResult.operationId!
      }
    };
  }

  // Path B: Verified Firebase ID Token claims (GCIP / Identity Platform multi-tenancy)
  if (reqUser && typeof reqUser === 'object') {
    const signInProvider = reqUser.firebase?.sign_in_provider;
    const signInAttributes = reqUser.firebase?.sign_in_attributes || {};

    const isMicrosoftSession = signInProvider === 'microsoft.com' || reqUser.firebase?.identities?.['microsoft.com'];

    const verifiedTenantId =
      signInAttributes.tid ||
      reqUser.tid ||
      reqUser.tenant_id ||
      (reqUser.firebase?.tenant ? reqUser.firebase.tenant : undefined);

    if (verifiedTenantId && typeof verifiedTenantId === 'string' && isMicrosoftSession) {
      const normalizedVerified = verifiedTenantId.trim();

      const allowedList: string[] = [];
      if (options?.expectedTenantId) {
        allowedList.push(options.expectedTenantId.toLowerCase().trim());
      }
      if (Array.isArray(options?.allowedTenantIds)) {
        for (const t of options.allowedTenantIds) {
          if (typeof t === 'string' && t.trim()) {
            const norm = t.toLowerCase().trim();
            if (!allowedList.includes(norm)) {
              allowedList.push(norm);
            }
          }
        }
      }

      if (allowedList.length > 0 && !allowedList.includes(normalizedVerified.toLowerCase())) {
        return {
          valid: false,
          code: 'TENANT_MISMATCH',
          tenantId: normalizedVerified,
          error: `Tenant mismatch: expected ${options.expectedTenantId || allowedList.join(', ')}, verified session contains ${normalizedVerified}`,
          source: 'firebase_verified_attributes'
        };
      }

      return {
        valid: true,
        code: 'VALID',
        tenantId: normalizedVerified,
        claims: {
          tid: normalizedVerified,
          email: reqUser.email,
          sub: reqUser.uid,
          name: reqUser.name,
          roles: reqUser.roles,
          groups: reqUser.groups
        },
        source: 'firebase_verified_attributes'
      };
    }
  }

  // Neither valid cryptographic ID token nor authoritative Firebase attribute was present.
  return {
    valid: false,
    code: 'MISSING_EVIDENCE',
    error: 'No cryptographically validated Microsoft Entra ID token or verified session provider attributes found.',
    source: 'none'
  };
}
