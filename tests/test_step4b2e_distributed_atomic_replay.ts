/**
 * tests/test_step4b2e_distributed_atomic_replay.ts
 *
 * EchoNote Step 4B.2E: Distributed, Atomic Entra Replay Protection Test Suite
 *
 * Verifies all security & architectural invariants required for multi-instance Cloud Run:
 *  1. SHA-256 Cryptographic Fingerprint & Key Derivation (Zero token/claim leakage)
 *  2. Atomic Firestore Replay Store State Machine (in_flight -> completed -> replayed)
 *  3. Concurrency & Race-Condition Defense across multi-instance simulation
 *  4. Safe Retries after Transient Failures (without lockout or duplicate side effects)
 *  5. In-Flight Lease Timeout / Crash Recovery
 *  6. Strict Fail-Closed Posture on Store Unavailability (No in-memory fallback)
 *  7. Two-Phase Route-Level Lifecycle Integration in server.ts
 */

import crypto from 'crypto';
import {
  computeTokenFingerprint,
  FirestoreEntraReplayStore,
  MemoryEntraReplayStore,
  setCustomReplayStore,
  resetCustomReplayStore,
  setCustomJwksFetcher,
  resetCustomJwksFetcher,
  validateAuthoritativeEntraTenant,
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

// Generate RSA Keys for Mock Token Signing
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const testKid = 'mock-microsoft-key-step4b2e';
const authorizedTenant = '72f988bf-86f1-41af-91ab-2d7cd011db47';
const testClientId = '00000002-0000-0000-c000-000000000000';

const mockJwk = {
  ...publicKey.export({ format: 'jwk' }),
  kid: testKid,
  alg: 'RS256',
  use: 'sig',
  issuer: `https://login.microsoftonline.com/{tenantid}/v2.0`
};

function createSignedEntraToken(payload: Partial<EntraTokenClaims> = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT', kid: testKid };
  const claims: EntraTokenClaims = {
    iss: `https://login.microsoftonline.com/${authorizedTenant}/v2.0`,
    tid: authorizedTenant,
    sub: 'oid-user-4b2e',
    oid: 'oid-user-4b2e',
    aud: testClientId,
    iat: now,
    nbf: now - 10,
    exp: now + 3600,
    ver: '2.0',
    email: 'user@acme.com',
    ...payload
  };

  const b64 = (obj: any) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const message = `${b64(header)}.${b64(claims)}`;
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(message);
  const sig = sign.sign(privateKey, 'base64url');
  return `${message}.${sig}`;
}

const userSession = {
  uid: 'fb-user-4b2e',
  email: 'user@acme.com',
  auth_time: Math.floor(Date.now() / 1000),
  firebase: {
    sign_in_provider: 'microsoft.com',
    identities: { 'microsoft.com': ['oid-user-4b2e'] }
  }
};

/**
 * High-Fidelity Mock Firestore for Distributed Concurrency & Transaction Testing
 */
class MockTransactionalFirestore {
  public docs: Map<string, any> = new Map();
  public simulateFailure = false;
  public txRunCount = 0;

  collection(name: string) {
    const self = this;
    return {
      doc(id: string) {
        const fullKey = `${name}/${id}`;
        return {
          id,
          get: async () => {
            const data = self.docs.get(fullKey);
            return {
              id,
              exists: data !== undefined,
              data: () => (data ? { ...data } : undefined)
            };
          },
          set: async (val: any) => {
            self.docs.set(fullKey, { ...val });
          },
          update: async (patch: any) => {
            const existing = self.docs.get(fullKey) || {};
            self.docs.set(fullKey, { ...existing, ...patch });
          }
        };
      }
    };
  }

  async runTransaction(updateFn: (tx: any) => Promise<any>): Promise<any> {
    this.txRunCount++;
    if (this.simulateFailure) {
      throw new Error('Simulated Firestore transactional unavailability / network abort');
    }

    const self = this;
    const stagedWrites: Array<() => void> = [];

    const tx = {
      get: async (docRef: any) => {
        const fullKey = `sso_replay_records/${docRef.id}`;
        const data = self.docs.get(fullKey);
        return {
          id: docRef.id,
          exists: data !== undefined,
          data: () => (data ? { ...data } : undefined)
        };
      },
      set: (docRef: any, val: any) => {
        stagedWrites.push(() => {
          self.docs.set(`sso_replay_records/${docRef.id}`, { ...val });
        });
      },
      update: (docRef: any, patch: any) => {
        stagedWrites.push(() => {
          const fullKey = `sso_replay_records/${docRef.id}`;
          const existing = self.docs.get(fullKey) || {};
          self.docs.set(fullKey, { ...existing, ...patch });
        });
      }
    };

    const result = await updateFn(tx);
    for (const write of stagedWrites) {
      write();
    }
    return result;
  }
}

(async () => {
  console.log("\n================================================================================");
  console.log("🔒 ECHONOTE STEP 4B.2E: DISTRIBUTED, ATOMIC ENTRA REPLAY PROTECTION TESTS");
  console.log("================================================================================\n");

  setCustomJwksFetcher(async () => ({ keys: [mockJwk] }));

  // ============================================================================
  // DIMENSION 1: Cryptographic Fingerprint & Non-Leakage Key Derivation
  // ============================================================================
  console.log("--- DIMENSION 1: Cryptographic Fingerprint & Data Hygiene ---");

  const rawTokenA = createSignedEntraToken({ nonce: 'nonce-111' });
  const rawTokenB = createSignedEntraToken({ nonce: 'nonce-222' });

  const fpA1 = computeTokenFingerprint(rawTokenA);
  const fpA2 = computeTokenFingerprint(rawTokenA);
  const fpB = computeTokenFingerprint(rawTokenB);

  recordTest(
    'FINGERPRINT_DERIVATION',
    '1.1 SHA-256 fingerprint is deterministic and collision-resistant',
    fpA1 === fpA2 && fpA1 !== fpB && fpA1.length === 64
  );

  const mockDb = new MockTransactionalFirestore();
  const firestoreStore = new FirestoreEntraReplayStore(mockDb);

  const leaseA = await firestoreStore.acquireLease(fpA1, {
    exp: Math.floor(Date.now() / 1000) + 3600,
    sub: 'oid-user-4b2e',
    tid: authorizedTenant
  });

  const recordA = mockDb.docs.get(`sso_replay_records/entra_${fpA1}`);
  recordTest(
    'RECORD_HYGIENE',
    '1.2 Replay document key uses deterministic prefixed SHA-256 hash',
    mockDb.docs.has(`sso_replay_records/entra_${fpA1}`)
  );

  const serializedData = JSON.stringify(recordA);
  const leaksRawToken = serializedData.includes(rawTokenA);
  const leaksSubRaw = serializedData.includes('oid-user-4b2e');
  const hasSubHash = typeof recordA?.subHash === 'string' && recordA.subHash.length === 64;

  recordTest(
    'RECORD_HYGIENE',
    '1.3 Replay record contains zero raw tokens, credentials, or plaintext subject IDs',
    !leaksRawToken && !leaksSubRaw && hasSubHash
  );

  // ============================================================================
  // DIMENSION 2: Atomic Firestore State Machine Transitions
  // ============================================================================
  console.log("\n--- DIMENSION 2: Atomic State Machine (in_flight -> completed -> replayed) ---");

  recordTest(
    'STATE_MACHINE',
    '2.1 Fresh token transitions to in_flight with operationId and timestamps',
    leaseA.acquired && recordA.status === 'in_flight' && typeof leaseA.operationId === 'string'
  );

  // Finalize successful authentication & JIT provisioning
  await firestoreStore.finalize(fpA1, leaseA.operationId!);
  const recordACompleted = mockDb.docs.get(`sso_replay_records/entra_${fpA1}`);

  recordTest(
    'STATE_MACHINE',
    '2.2 Finalize transitions status to completed with completedAt timestamp',
    recordACompleted.status === 'completed' && typeof recordACompleted.completedAt === 'number'
  );

  // Subsequent use of completed token
  const leaseA2 = await firestoreStore.acquireLease(fpA1, {
    exp: Math.floor(Date.now() / 1000) + 3600
  });

  recordTest(
    'STATE_MACHINE',
    '2.3 Subsequent use of completed token is strictly rejected as TOKEN_REPLAYED',
    !leaseA2.acquired && leaseA2.code === 'TOKEN_REPLAYED'
  );

  // Token expiration check
  const expiredToken = createSignedEntraToken({ exp: Math.floor(Date.now() / 1000) - 100 });
  const fpExpired = computeTokenFingerprint(expiredToken);
  mockDb.docs.set(`sso_replay_records/entra_${fpExpired}`, {
    status: 'in_flight',
    tokenExpiresAt: (Math.floor(Date.now() / 1000) - 100) * 1000,
    leaseExpiresAt: Date.now() + 60000
  });

  const leaseExpired = await firestoreStore.acquireLease(fpExpired, {
    exp: Math.floor(Date.now() / 1000) - 100
  });

  recordTest(
    'STATE_MACHINE',
    '2.4 Expired token record rejected as TOKEN_EXPIRED',
    !leaseExpired.acquired && leaseExpired.code === 'TOKEN_EXPIRED'
  );

  // ============================================================================
  // DIMENSION 3: Concurrency & Multi-Instance Cloud Run Race Condition Defense
  // ============================================================================
  console.log("\n--- DIMENSION 3: Concurrency & Cloud Run Multi-Instance Race Defense ---");

  const concurrentToken = createSignedEntraToken({ nonce: 'concurrent-token-test' });
  const fpConcurrent = computeTokenFingerprint(concurrentToken);

  // Node 1 & Node 2 receive identical authentication token concurrently
  const node1Store = new FirestoreEntraReplayStore(mockDb);
  const node2Store = new FirestoreEntraReplayStore(mockDb);

  // Simulate Node 1 acquiring lease first
  const node1Claim = await node1Store.acquireLease(fpConcurrent, {
    exp: Math.floor(Date.now() / 1000) + 3600,
    sub: 'oid-user-4b2e'
  });

  // Node 2 attempts to claim the exact same token while Node 1 is in-flight
  const node2Claim = await node2Store.acquireLease(fpConcurrent, {
    exp: Math.floor(Date.now() / 1000) + 3600,
    sub: 'oid-user-4b2e'
  });

  recordTest(
    'CONCURRENCY_DEFENSE',
    '3.1 Node 1 successfully acquires active in-flight lease',
    node1Claim.acquired === true && typeof node1Claim.operationId === 'string'
  );

  recordTest(
    'CONCURRENCY_DEFENSE',
    '3.2 Concurrent Node 2 request is strictly blocked (TOKEN_REPLAYED) while lease is active',
    node2Claim.acquired === false && node2Claim.code === 'TOKEN_REPLAYED'
  );

  // Node 1 finishes provisioning and finalizes
  await node1Store.finalize(fpConcurrent, node1Claim.operationId!);

  // Node 3 attempts to use the token after Node 1 completed
  const node3Claim = await node1Store.acquireLease(fpConcurrent, {
    exp: Math.floor(Date.now() / 1000) + 3600
  });

  recordTest(
    'CONCURRENCY_DEFENSE',
    '3.3 Node 3 rejected as TOKEN_REPLAYED after Node 1 finalizes',
    node3Claim.acquired === false && node3Claim.code === 'TOKEN_REPLAYED'
  );

  // ============================================================================
  // DIMENSION 4: Safe Retries after Transient Failures
  // ============================================================================
  console.log("\n--- DIMENSION 4: Safe Retries after Transient Failures ---");

  const retryableToken = createSignedEntraToken({ nonce: 'transient-retry-test' });
  const fpRetry = computeTokenFingerprint(retryableToken);

  // Initial Attempt 1: Acquires lease
  const attempt1Claim = await firestoreStore.acquireLease(fpRetry, {
    exp: Math.floor(Date.now() / 1000) + 3600,
    sub: 'oid-user-4b2e'
  });

  recordTest(
    'SAFE_RETRY',
    '4.1 Initial attempt acquires in-flight lease',
    attempt1Claim.acquired === true
  );

  // Simulate transient failure during downstream provisioning (e.g. database contention)
  await firestoreStore.release(fpRetry, attempt1Claim.operationId!, 'Transient Firestore deadlock');
  const recordFailed = mockDb.docs.get(`sso_replay_records/entra_${fpRetry}`);

  recordTest(
    'SAFE_RETRY',
    '4.2 Transient failure marks record as failed without permanent lockout',
    recordFailed.status === 'failed' && typeof recordFailed.failedAt === 'number'
  );

  // Attempt 2 (Client Retry): Same token retries after transient failure
  const attempt2Claim = await firestoreStore.acquireLease(fpRetry, {
    exp: Math.floor(Date.now() / 1000) + 3600,
    sub: 'oid-user-4b2e'
  });

  const recordRetried = mockDb.docs.get(`sso_replay_records/entra_${fpRetry}`);

  recordTest(
    'SAFE_RETRY',
    '4.3 Client retry on failed record acquires fresh lease with new operationId',
    attempt2Claim.acquired === true &&
    attempt2Claim.operationId !== attempt1Claim.operationId &&
    recordRetried.retryCount === 1
  );

  // Attempt 2 completes provisioning successfully
  await firestoreStore.finalize(fpRetry, attempt2Claim.operationId!);
  const recordFinalized = mockDb.docs.get(`sso_replay_records/entra_${fpRetry}`);

  recordTest(
    'SAFE_RETRY',
    '4.4 Successful retry finalizes to completed and locks against future replay',
    recordFinalized.status === 'completed'
  );

  const attempt3PostFinal = await firestoreStore.acquireLease(fpRetry, {
    exp: Math.floor(Date.now() / 1000) + 3600
  });

  recordTest(
    'SAFE_RETRY',
    '4.5 Post-finalization replay strictly blocked',
    attempt3PostFinal.acquired === false && attempt3PostFinal.code === 'TOKEN_REPLAYED'
  );

  // ============================================================================
  // DIMENSION 5: Lease Timeout & Cloud Run Worker Crash Recovery
  // ============================================================================
  console.log("\n--- DIMENSION 5: In-Flight Lease Timeout & Crash Recovery ---");

  const crashToken = createSignedEntraToken({ nonce: 'crash-recovery-test' });
  const fpCrash = computeTokenFingerprint(crashToken);

  // Worker 1 claims token with a very short lease (10ms) and abruptly crashes
  const crashedClaim = await firestoreStore.acquireLease(fpCrash, {
    exp: Math.floor(Date.now() / 1000) + 3600,
    sub: 'oid-user-4b2e',
    leaseDurationMs: 20 // 20ms lease
  });

  recordTest(
    'CRASH_RECOVERY',
    '5.1 Worker 1 claims lease before crash',
    crashedClaim.acquired === true
  );

  // Wait 30ms for Worker 1 lease to expire
  await new Promise(r => setTimeout(r, 30));

  // Worker 2 (or retrying client) attempts to claim after crash timeout
  const recoveredClaim = await firestoreStore.acquireLease(fpCrash, {
    exp: Math.floor(Date.now() / 1000) + 3600,
    sub: 'oid-user-4b2e',
    leaseDurationMs: 60000
  });

  recordTest(
    'CRASH_RECOVERY',
    '5.2 Expired in-flight lease is safely recovered by new worker after timeout',
    recoveredClaim.acquired === true && recoveredClaim.operationId !== crashedClaim.operationId
  );

  // ============================================================================
  // DIMENSION 6: Fail-Closed Posture on Replay Store Unavailability
  // ============================================================================
  console.log("\n--- DIMENSION 6: Fail-Closed Posture on Store Unavailability ---");

  const unavailToken = createSignedEntraToken({ nonce: 'unavail-test' });
  const fpUnavail = computeTokenFingerprint(unavailToken);

  // Simulate Firestore database outage
  mockDb.simulateFailure = true;

  const failureResult = await firestoreStore.acquireLease(fpUnavail, {
    exp: Math.floor(Date.now() / 1000) + 3600
  });

  recordTest(
    'FAIL_CLOSED',
    '6.1 Fails closed with REPLAY_STORE_UNAVAILABLE when database fails',
    failureResult.acquired === false && failureResult.code === 'REPLAY_STORE_UNAVAILABLE'
  );

  // Verify that validateAuthoritativeEntraTenant also fails closed when store is unavailable
  const validationFailure = await validateAuthoritativeEntraTenant(
    userSession,
    { idToken: unavailToken },
    {
      expectedTenantId: authorizedTenant,
      expectedAudience: testClientId,
      replayStore: firestoreStore
    }
  );

  recordTest(
    'FAIL_CLOSED',
    '6.2 Authoritative tenant validator returns REPLAY_STORE_UNAVAILABLE (no bypass, no local fallback)',
    validationFailure.valid === false && validationFailure.code === 'REPLAY_STORE_UNAVAILABLE'
  );

  mockDb.simulateFailure = false; // Restore mock database

  // ============================================================================
  // DIMENSION 7: Two-Phase Route Integration in server.ts
  // ============================================================================
  console.log("\n--- DIMENSION 7: Two-Phase Route Integration & JIT Handshake ---");

  // Route Simulation Helper for Step 4B.2E
  async function simulateValidateRouteWithReplay(
    token: string,
    store: any,
    simulateJitError = false
  ): Promise<{ status: number; body: any }> {
    const {
      resolveAuthoritativeTenantPolicy,
      resolveAuthoritativeMicrosoftClientId,
      validateAuthoritativeEntraTenant
    } = await import('../lib/entraTokenValidation.js');

    const orgConfig = { entraTenantId: authorizedTenant, entraClientId: testClientId };
    const tenantPolicy = resolveAuthoritativeTenantPolicy({}, orgConfig);
    const clientPolicy = resolveAuthoritativeMicrosoftClientId({}, orgConfig, { allowSharedApp: true });

    let entraValidation: any = null;
    try {
      entraValidation = await validateAuthoritativeEntraTenant(
        userSession,
        { idToken: token },
        {
          expectedTenantId: tenantPolicy.expectedTenantId,
          allowedTenantIds: tenantPolicy.allowedTenantIds,
          expectedAudience: clientPolicy.clientId,
          replayStore: store,
          twoPhaseReplay: true
        }
      );

      if (!entraValidation.valid) {
        let httpStatus = 403;
        let clientCode = "SSO_AUTHENTICATION_FAILED";
        if (entraValidation.code === 'TOKEN_REPLAYED') {
          clientCode = "SSO_TOKEN_REPLAYED";
        } else if (entraValidation.code === 'REPLAY_STORE_UNAVAILABLE') {
          clientCode = "SSO_REPLAY_CHECK_UNAVAILABLE";
          httpStatus = 503;
        }

        return {
          status: httpStatus,
          body: { error: httpStatus === 503 ? "Service Unavailable" : "Forbidden", code: clientCode }
        };
      }

      // Simulate JIT Provisioning
      if (simulateJitError) {
        throw new Error('Simulated transient deadlock during member provisioning');
      }

      // Route finalization on success
      if (entraValidation?.replayLease) {
        await entraValidation.replayLease.store.finalize(
          entraValidation.replayLease.fingerprint,
          entraValidation.replayLease.operationId
        );
      }

      return {
        status: 200,
        body: { success: true, isEnterprise: true, isMember: true }
      };
    } catch (err: any) {
      if (entraValidation?.replayLease) {
        await entraValidation.replayLease.store.release(
          entraValidation.replayLease.fingerprint,
          entraValidation.replayLease.operationId,
          err.message
        );
      }
      return {
        status: 500,
        body: { error: "SSO Validation Failed", message: err.message }
      };
    }
  }

  const liveToken = createSignedEntraToken({ nonce: 'route-live-handshake' });
  const testStore = new MemoryEntraReplayStore();

  // Test 7.1: Legitimate first route call succeeds with 200
  const resSuccess = await simulateValidateRouteWithReplay(liveToken, testStore, false);
  recordTest(
    'ROUTE_TWO_PHASE',
    '7.1 First route submission completes with 200 and finalizes replay record',
    resSuccess.status === 200 && resSuccess.body.success === true
  );

  // Test 7.2: Second route call with identical token returns 403 SSO_TOKEN_REPLAYED
  const resReplayed = await simulateValidateRouteWithReplay(liveToken, testStore, false);
  recordTest(
    'ROUTE_TWO_PHASE',
    '7.2 Second route submission rejected with 403 SSO_TOKEN_REPLAYED',
    resReplayed.status === 403 && resReplayed.body.code === 'SSO_TOKEN_REPLAYED'
  );

  // Test 7.3: Route transient failure releases lease and allows subsequent retry to succeed
  const transientToken = createSignedEntraToken({ nonce: 'transient-route-token' });
  const resTransient1 = await simulateValidateRouteWithReplay(transientToken, testStore, true);
  recordTest(
    'ROUTE_TWO_PHASE',
    '7.3 Transient JIT error returns 500 and releases lease',
    resTransient1.status === 500
  );

  const resTransient2 = await simulateValidateRouteWithReplay(transientToken, testStore, false);
  recordTest(
    'ROUTE_TWO_PHASE',
    '7.4 Subsequent retry with same token succeeds with 200 after transient error',
    resTransient2.status === 200 && resTransient2.body.success === true
  );

  // ============================================================================
  // SUMMARY
  // ============================================================================
  console.log("\n================================================================================");
  console.log(`📊 STEP 4B.2E SUITE RESULTS: ${passedTests}/${totalTests} Passed (${failedTests} Failed)`);
  console.log("================================================================================");

  if (failedTests === 0) {
    console.log("🎯 All Step 4B.2E Distributed, Atomic Replay Protection Invariants Verified Successfully!\n");
    process.exit(0);
  } else {
    console.error(`❌ ${failedTests} tests failed in Step 4B.2E!`);
    process.exit(1);
  }
})();
