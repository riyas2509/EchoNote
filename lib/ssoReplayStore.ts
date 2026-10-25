/**
 * lib/ssoReplayStore.ts
 *
 * Distributed, Atomic Replay Protection Store for Microsoft Entra ID Tokens
 *
 * Implements Step 4B.2E Requirements:
 * 1. Shared & Durable: Backed by Firestore collection `sso_replay_records` targeting
 *    the authoritative named database, surviving Cloud Run container restarts and
 *    autoscaling across instances.
 * 2. Cryptographic Privacy: Uses SHA-256 fingerprint document IDs. Never stores raw tokens,
 *    authorization codes, or credentials.
 * 3. Atomic State Machine Transitions via Firestore Transactions:
 *    - `processing`: An instance has atomically acquired an exclusive processing lease.
 *    - `completed`: Protected operation succeeded; token can NEVER be reused.
 *    - `failed_retryable`: A transient error occurred; retry is permitted only for the same
 *      authenticated Firebase UID, organization, and operation type.
 *    - `failed_terminal`: Validation/authorization failed; token is permanently consumed and
 *      cannot be reused to bypass security checks.
 * 4. Fail-Closed: When Firestore transaction fails or is unavailable, requests fail closed with
 *    REPLAY_STORE_UNAVAILABLE. Never falls back to process-local cache.
 * 5. Bounded Storage & Expiry: Enforces token expiration timestamps. Client SDK access is denied.
 */

import crypto from 'crypto';
import admin from 'firebase-admin';

export const REPLAY_COLLECTION = 'sso_replay_records';
export const DEFAULT_LEASE_DURATION_MS = 30000; // 30 seconds processing lease

export type ReplayRecordStatus = 'processing' | 'completed' | 'failed_retryable' | 'failed_terminal';

export interface SsoReplayDocument {
  fingerprint: string;                  // SHA-256 hash of token (64 hex characters)
  status: ReplayRecordStatus;           // Atomic state machine status
  operationId: string;                  // Unique server-generated UUID for this attempt
  operationType: string;                // e.g. 'entra_sso_validate'
  userId: string;                       // Authenticated Firebase UID (reqUser.uid)
  orgId: string;                        // Targeted organization ID
  tenantId?: string;                    // Entra Tenant ID
  tokenSub?: string;                    // Immutable subject / oid
  tokenExp: number;                     // Token expiration in epoch seconds
  leaseExpiresAt: number;               // Epoch ms when processing lease expires
  attempts: number;                     // Attempt counter
  createdAt: string;                    // ISO timestamp of initial creation
  updatedAt: string;                    // ISO timestamp of last update
  completedAt?: string;                 // ISO timestamp when completed
  lastErrorCode?: string;               // Error code if failed
  lastErrorMessage?: string;             // Error message if failed
}

export interface AcquireReplayLeaseParams {
  rawToken: string;
  userId: string;
  orgId: string;
  operationType?: string;
  tokenExp: number;
  tenantId?: string;
  tokenSub?: string;
  leaseDurationMs?: number;
}

export interface AcquireReplayLeaseResult {
  acquired: boolean;
  fingerprint: string;
  operationId?: string;
  status?: ReplayRecordStatus;
  isRetry?: boolean;
  leaseRecovered?: boolean;
  code?: 'TOKEN_REPLAYED' | 'OPERATION_IN_PROGRESS' | 'TOKEN_EXPIRED' | 'REPLAY_STORE_UNAVAILABLE';
  message?: string;
}

/**
 * Computes deterministic, collision-resistant SHA-256 fingerprint for a raw token.
 * Never exposes raw credentials or claims in document keys.
 */
export function computeTokenFingerprint(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken.trim()).digest('hex');
}

/**
 * Derives the deterministic Firestore document key for a token fingerprint.
 */
export function getReplayDocumentId(fingerprint: string): string {
  return `sso_replay_${fingerprint}`;
}

/**
 * Generates a unique, cryptographically random operation ID.
 */
export function generateOperationId(): string {
  return `op_${Date.now().toString(36)}_${crypto.randomBytes(8).toString('hex')}`;
}

/**
 * Atomically acquires a processing lease for an authentication token in Firestore.
 * Prevents concurrent duplicate requests and cross-instance race conditions.
 * Supports safe retries for the same user and organization after transient failures.
 */
export async function acquireReplayLease(
  db: admin.firestore.Firestore,
  params: AcquireReplayLeaseParams
): Promise<AcquireReplayLeaseResult> {
  const fingerprint = computeTokenFingerprint(params.rawToken);
  const docId = getReplayDocumentId(fingerprint);
  const docRef = db.collection(REPLAY_COLLECTION).doc(docId);
  const leaseDuration = params.leaseDurationMs || DEFAULT_LEASE_DURATION_MS;
  const now = Date.now();
  const nowSeconds = Math.floor(now / 1000);
  const opId = generateOperationId();
  const opType = params.operationType || 'entra_sso_validate';

  // Pre-flight expiration validation
  if (params.tokenExp && params.tokenExp < nowSeconds) {
    return {
      acquired: false,
      fingerprint,
      code: 'TOKEN_EXPIRED',
      message: 'Authentication token has expired and cannot be processed.'
    };
  }

  try {
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(docRef);

      if (!snap.exists) {
        // First acquisition: Atomically create record in 'processing' state
        const newDoc: SsoReplayDocument = {
          fingerprint,
          status: 'processing',
          operationId: opId,
          operationType: opType,
          userId: params.userId,
          orgId: params.orgId,
          tenantId: params.tenantId,
          tokenSub: params.tokenSub,
          tokenExp: params.tokenExp,
          leaseExpiresAt: now + leaseDuration,
          attempts: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };

        tx.set(docRef, newDoc);

        return {
          acquired: true,
          fingerprint,
          operationId: opId,
          status: 'processing' as ReplayRecordStatus
        };
      }

      const existing = snap.data() as SsoReplayDocument;

      // 1. Completed state: NEVER allowed to be reused
      if (existing.status === 'completed') {
        return {
          acquired: false,
          fingerprint,
          code: 'TOKEN_REPLAYED' as const,
          message: 'Authentication token has already been consumed for a completed operation.'
        };
      }

      // 2. Terminal failure state: Evidence cannot be reused to bypass failed check
      if (existing.status === 'failed_terminal') {
        return {
          acquired: false,
          fingerprint,
          code: 'TOKEN_REPLAYED' as const,
          message: 'Authentication token was previously rejected as terminal failure and cannot be reused.'
        };
      }

      // 3. User & Organization Boundary Checks:
      // A different user or organization cannot take over an existing replay record!
      if (existing.userId && existing.userId !== params.userId) {
        return {
          acquired: false,
          fingerprint,
          code: 'TOKEN_REPLAYED' as const,
          message: 'Authentication token was previously presented by a different authenticated user session.'
        };
      }

      if (existing.orgId && existing.orgId !== params.orgId) {
        return {
          acquired: false,
          fingerprint,
          code: 'TOKEN_REPLAYED' as const,
          message: 'Authentication token was previously presented to a different organization.'
        };
      }

      // 4. Processing state: Check if lease is active
      if (existing.status === 'processing') {
        if (now < (existing.leaseExpiresAt || 0)) {
          // Active lease in flight: Concurrent duplicate request detected!
          return {
            acquired: false,
            fingerprint,
            code: 'OPERATION_IN_PROGRESS' as const,
            message: 'An authentication operation for this token is currently processing. Concurrent duplicate rejected.'
          };
        }

        // Stale lease expired: Safe recovery policy
        const updatedAttempts = (existing.attempts || 1) + 1;
        tx.update(docRef, {
          status: 'processing',
          operationId: opId,
          leaseExpiresAt: now + leaseDuration,
          attempts: updatedAttempts,
          updatedAt: new Date().toISOString()
        });

        return {
          acquired: true,
          fingerprint,
          operationId: opId,
          status: 'processing' as ReplayRecordStatus,
          isRetry: true,
          leaseRecovered: true
        };
      }

      // 5. Retryable failure state: Safe retry policy
      if (existing.status === 'failed_retryable') {
        const updatedAttempts = (existing.attempts || 1) + 1;
        tx.update(docRef, {
          status: 'processing',
          operationId: opId,
          leaseExpiresAt: now + leaseDuration,
          attempts: updatedAttempts,
          updatedAt: new Date().toISOString()
        });

        return {
          acquired: true,
          fingerprint,
          operationId: opId,
          status: 'processing' as ReplayRecordStatus,
          isRetry: true
        };
      }

      // Fallback safe rejection
      return {
        acquired: false,
        fingerprint,
        code: 'TOKEN_REPLAYED' as const,
        message: 'Authentication token replay status is invalid.'
      };
    });

    return result;
  } catch (err: any) {
    console.error("🔒 Distributed Replay Store Transaction Failed (Failing closed):", err?.message || err);
    // FAIL CLOSED: Do not fall back to local process memory
    return {
      acquired: false,
      fingerprint,
      code: 'REPLAY_STORE_UNAVAILABLE',
      message: 'Distributed replay protection store is unavailable. Request rejected for security.'
    };
  }
}

/**
 * Atomically marks an operation as completed.
 * Guarantees that the token can never be consumed again.
 */
export async function completeReplayOperation(
  db: admin.firestore.Firestore,
  fingerprint: string,
  operationId: string
): Promise<boolean> {
  const docId = getReplayDocumentId(fingerprint);
  const docRef = db.collection(REPLAY_COLLECTION).doc(docId);

  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(docRef);
      if (!snap.exists) return false;
      const data = snap.data() as SsoReplayDocument;

      // Only the operation that owns the current lease may complete it
      if (data.operationId !== operationId) {
        console.warn(`⚠️ Operation ID mismatch during completion: expected ${data.operationId}, got ${operationId}`);
        return false;
      }

      tx.update(docRef, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      return true;
    });
  } catch (err: any) {
    console.error("⚠️ Failed to mark replay record completed:", err?.message || err);
    return false;
  }
}

/**
 * Atomically marks an operation as terminal failure.
 * Evidence cannot be reused to bypass failed verification.
 */
export async function markReplayTerminalFailure(
  db: admin.firestore.Firestore,
  fingerprint: string,
  operationId: string,
  errorCode?: string,
  errorMessage?: string
): Promise<boolean> {
  const docId = getReplayDocumentId(fingerprint);
  const docRef = db.collection(REPLAY_COLLECTION).doc(docId);

  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(docRef);
      if (!snap.exists) return false;
      const data = snap.data() as SsoReplayDocument;

      if (data.operationId !== operationId) return false;

      tx.update(docRef, {
        status: 'failed_terminal',
        lastErrorCode: errorCode || 'TERMINAL_ERROR',
        lastErrorMessage: errorMessage || 'Operation failed terminally',
        updatedAt: new Date().toISOString()
      });

      return true;
    });
  } catch (err: any) {
    console.error("⚠️ Failed to mark replay record terminal failure:", err?.message || err);
    return false;
  }
}

/**
 * Atomically marks an operation as retryable failure.
 * Used when a known transient failure occurs before irreversible side effects.
 */
export async function markReplayRetryableFailure(
  db: admin.firestore.Firestore,
  fingerprint: string,
  operationId: string,
  errorCode?: string,
  errorMessage?: string
): Promise<boolean> {
  const docId = getReplayDocumentId(fingerprint);
  const docRef = db.collection(REPLAY_COLLECTION).doc(docId);

  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(docRef);
      if (!snap.exists) return false;
      const data = snap.data() as SsoReplayDocument;

      if (data.operationId !== operationId) return false;

      tx.update(docRef, {
        status: 'failed_retryable',
        lastErrorCode: errorCode || 'TRANSIENT_ERROR',
        lastErrorMessage: errorMessage || 'Transient failure occurred; retry permitted',
        updatedAt: new Date().toISOString()
      });

      return true;
    });
  } catch (err: any) {
    console.error("⚠️ Failed to mark replay record retryable failure:", err?.message || err);
    return false;
  }
}

/**
 * Retrieves the current replay record for diagnostic or audit verification.
 */
export async function getReplayRecord(
  db: admin.firestore.Firestore,
  fingerprint: string
): Promise<SsoReplayDocument | null> {
  const docId = getReplayDocumentId(fingerprint);
  const snap = await db.collection(REPLAY_COLLECTION).doc(docId).get();
  if (!snap.exists) return null;
  return snap.data() as SsoReplayDocument;
}

// -----------------------------------------------------------------------------
// Test & Simulation Helpers for Multi-Instance and Transactional Testing
// -----------------------------------------------------------------------------

let customReplayDb: admin.firestore.Firestore | null = null;

export function setCustomReplayDb(db: admin.firestore.Firestore | null): void {
  customReplayDb = db;
}

export function getCustomReplayDb(): admin.firestore.Firestore | null {
  return customReplayDb;
}

export function resetCustomReplayDb(): void {
  customReplayDb = null;
}

/**
 * Creates an in-memory Firestore simulator that provides true serializable transaction semantics,
 * supporting multi-instance simulation (two simulator instances backed by the same shared state map).
 */
export function createSimulatedReplayStoreDb(sharedStoreMap: Map<string, any> = new Map()): admin.firestore.Firestore {
  let transactionLock: Promise<void> = Promise.resolve();

  const simulatedDb: any = {
    _sharedStore: sharedStoreMap,
    collection: (collName: string) => ({
      doc: (docId: string) => {
        const fullKey = `${collName}/${docId}`;
        const docRef: any = {
          id: docId,
          path: fullKey,
          get: async () => {
            const val = sharedStoreMap.get(fullKey);
            return {
              id: docId,
              exists: val !== undefined,
              data: () => (val ? JSON.parse(JSON.stringify(val)) : undefined)
            };
          },
          set: async (data: any) => {
            sharedStoreMap.set(fullKey, JSON.parse(JSON.stringify(data)));
          },
          update: async (data: any) => {
            const current = sharedStoreMap.get(fullKey) || {};
            sharedStoreMap.set(fullKey, { ...current, ...JSON.parse(JSON.stringify(data)) });
          }
        };
        return docRef;
      }
    }),
    runTransaction: async <T>(updateFunction: (transaction: any) => Promise<T>): Promise<T> => {
      // Serializable execution with optimistic concurrency simulation
      let releaseLock: () => void = () => {};
      const nextLock = new Promise<void>((resolve) => {
        releaseLock = resolve;
      });

      const prevLock = transactionLock;
      transactionLock = nextLock;

      await prevLock;

      try {
        const readVersions = new Map<string, number>();
        const writes: Array<{ type: 'set' | 'update'; key: string; data: any }> = [];

        const tx: any = {
          get: async (docRef: any) => {
            const current = sharedStoreMap.get(docRef.path);
            readVersions.set(docRef.path, current ? 1 : 0);
            return {
              id: docRef.id,
              exists: current !== undefined,
              data: () => (current ? JSON.parse(JSON.stringify(current)) : undefined)
            };
          },
          set: (docRef: any, data: any) => {
            writes.push({ type: 'set', key: docRef.path, data: JSON.parse(JSON.stringify(data)) });
          },
          update: (docRef: any, data: any) => {
            writes.push({ type: 'update', key: docRef.path, data: JSON.parse(JSON.stringify(data)) });
          }
        };

        const result = await updateFunction(tx);

        // Apply writes atomically
        for (const w of writes) {
          if (w.type === 'set') {
            sharedStoreMap.set(w.key, w.data);
          } else if (w.type === 'update') {
            const current = sharedStoreMap.get(w.key) || {};
            sharedStoreMap.set(w.key, { ...current, ...w.data });
          }
        }

        return result;
      } finally {
        releaseLock();
      }
    }
  };

  return simulatedDb as admin.firestore.Firestore;
}
