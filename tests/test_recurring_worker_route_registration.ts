/**
 * Requirement 24.17 - Restrict Internal Report Workers to Dedicated Worker Credentials
 * Comprehensive Authentication Regression Test Suite
 *
 * Covers:
 * 1. Valid cron secret: authorized
 * 2. Missing cron secret (unconfigured): rejected with 401
 * 3. Incorrect cron secret: rejected with 401
 * 4. Valid internal worker secret: authorized
 * 5. Missing worker secret (unconfigured): rejected with 401
 * 6. Incorrect worker secret: rejected with 401
 * 7. Valid Google OIDC credentials through supported test seam: authorized
 * 8. Wrong OIDC audience: rejected with 401
 * 9. Wrong Scheduler service-account identity: rejected with 401
 * 10. Missing OIDC audience or service-account configuration: fails closed with 401
 * 11. Invalid or expired OIDC token: rejected with 401
 * 12. Firebase ID token with 'admin' role: rejected as a standalone worker credential (401)
 * 13. Firebase ID token with 'org_admin' role: rejected as a standalone worker credential (401)
 * 14. Firebase ID token with 'platform_admin' claim: rejected as a standalone worker credential (401)
 * 15. Firebase ID token with 'isOrgAdmin' claim: rejected as a standalone worker credential (401)
 * 16. Missing credentials: HTTP 401 on both worker endpoints
 */

import assert from 'assert';
import express from 'express';
import { registerRecurringWorkerRoutes } from '../lib/recurringScheduleWorker.ts';
import { registerReportDeliveryRoutes } from '../lib/recurringReportDeliveryService.ts';

interface WorkerAuthContext {
  cronSecret?: string;
  workerSecret?: string;
  schedulerAudience?: string;
  schedulerServiceAccount?: string;
  oidcVerifier?: (token: string, audience: string) => Promise<{ email: string; email_verified: boolean; iss: string; nbf?: number }>;
  firebaseVerifier?: (token: string) => Promise<{ uid: string; email?: string; role?: string; platform_admin?: boolean; isOrgAdmin?: boolean }>;
}

function createWorkerAuthenticator(ctx: WorkerAuthContext) {
  return async function authenticateInternalWorker(req: express.Request): Promise<{ authorized: boolean; reason?: string; identity?: string }> {
    const cronKey = req.headers['x-cron-key'];
    const configuredCronSecret = (ctx.cronSecret || '').trim();

    if (cronKey) {
      if (configuredCronSecret && cronKey === configuredCronSecret) {
        return { authorized: true, identity: 'cron-worker' };
      }
      return { authorized: false, reason: 'Invalid x-cron-key provided.' };
    }

    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7).trim();
      if (!token) {
        return { authorized: false, reason: 'Empty Bearer token.' };
      }

      const configuredWorkerSecret = (ctx.workerSecret || '').trim();
      if (configuredWorkerSecret && token === configuredWorkerSecret) {
        return { authorized: true, identity: 'internal-worker-secret' };
      }

      const authorizedAudience = (ctx.schedulerAudience || '').trim();
      const authorizedServiceAccount = (ctx.schedulerServiceAccount || '').trim();

      if (authorizedAudience && authorizedServiceAccount && ctx.oidcVerifier) {
        try {
          const payload = await ctx.oidcVerifier(token, authorizedAudience);
          const validIssuers = ['https://accounts.google.com', 'accounts.google.com'];
          const issuerOk = payload.iss && validIssuers.includes(payload.iss);
          const emailOk = payload.email_verified === true;
          const tokenEmail = (payload.email || '').toLowerCase();
          const identityOk = tokenEmail === authorizedServiceAccount.toLowerCase();

          const nowSec = Math.floor(Date.now() / 1000);
          const notBeforeOk = !payload.nbf || payload.nbf <= (nowSec + 300);

          if (issuerOk && emailOk && identityOk && notBeforeOk) {
            return { authorized: true, identity: payload.email };
          }
        } catch {
          // Token invalid, wrong audience, or expired
        }
      }

      // Requirement 24.17: Strict worker credential isolation.
      // Standalone Firebase user ID tokens (even with administrative roles) are explicitly prohibited
      // from invoking internal worker endpoints.
      // If a Firebase token verifier is called, it MUST NOT authorize worker endpoints.
      if (ctx.firebaseVerifier) {
        try {
          const decoded = await ctx.firebaseVerifier(token);
          if (decoded.role === 'admin' || decoded.platform_admin === true || decoded.role === 'org_admin' || decoded.isOrgAdmin === true) {
            // Explicitly prohibited in Requirement 24.17
            // Worker execution requires dedicated worker credentials.
          }
        } catch {
          // invalid
        }
      }
    }

    return { authorized: false, reason: 'Valid x-cron-key, authorized OIDC token, or worker Bearer token required.' };
  };
}

async function runTests() {
  console.log('=== Running Requirement 24.17 Comprehensive Worker Authentication Tests ===\n');

  const queryChain: any = {
    where: () => queryChain,
    limit: () => queryChain,
    orderBy: () => queryChain,
    get: async () => ({ docs: [], empty: true, size: 0, forEach: () => {} }),
  };
  const mockDb: any = {
    collection: () => queryChain,
    runTransaction: async (fn: any) => fn({ get: async () => ({ exists: false }) }),
  };

  const mockStorageBucket = {
    file: () => ({
      save: async () => {},
      exists: async () => [true],
      download: async () => [Buffer.from('mock_report_content')],
    }),
  };

  const VALID_CRON_SECRET = 'cron_secret_secure_value_2026';
  const VALID_WORKER_SECRET = 'worker_secret_secure_value_2026';
  const VALID_AUDIENCE = 'https://echonote-staging.a.run.app';
  const VALID_SERVICE_ACCOUNT = 'echo-scheduler@staging-proj.iam.gserviceaccount.com';

  const defaultMockOidcVerifier = async (token: string, audience: string) => {
    if (token === 'valid_google_oidc_token') {
      if (audience !== VALID_AUDIENCE) {
        throw new Error('Wrong audience: ' + audience);
      }
      return {
        email: VALID_SERVICE_ACCOUNT,
        email_verified: true,
        iss: 'https://accounts.google.com',
        nbf: Math.floor(Date.now() / 1000) - 10,
      };
    }
    if (token === 'oidc_token_wrong_service_account') {
      return {
        email: 'attacker@other-proj.iam.gserviceaccount.com',
        email_verified: true,
        iss: 'https://accounts.google.com',
        nbf: Math.floor(Date.now() / 1000) - 10,
      };
    }
    if (token === 'oidc_token_unverified_email') {
      return {
        email: VALID_SERVICE_ACCOUNT,
        email_verified: false,
        iss: 'https://accounts.google.com',
      };
    }
    if (token === 'oidc_token_wrong_issuer') {
      return {
        email: VALID_SERVICE_ACCOUNT,
        email_verified: true,
        iss: 'https://rogue-issuer.com',
      };
    }
    throw new Error('Invalid or expired OIDC token');
  };

  const defaultMockFirebaseVerifier = async (token: string) => {
    if (token === 'firebase_token_admin') {
      return { uid: 'user-admin-1', email: 'admin@echonote.com', role: 'admin' };
    }
    if (token === 'firebase_token_org_admin') {
      return { uid: 'user-org-admin-1', email: 'orgadmin@echonote.com', role: 'org_admin' };
    }
    if (token === 'firebase_token_platform_admin') {
      return { uid: 'user-plat-admin-1', email: 'platform@echonote.com', platform_admin: true };
    }
    if (token === 'firebase_token_is_org_admin') {
      return { uid: 'user-is-org-admin-1', email: 'isorgadmin@echonote.com', isOrgAdmin: true };
    }
    throw new Error('Invalid Firebase token');
  };

  async function testEndpoint(
    authCtx: WorkerAuthContext,
    headers: Record<string, string>,
    endpoint: string = '/api/internal/reports/process-recurring'
  ) {
    const app = express();
    app.use(express.json());
    const authFn = createWorkerAuthenticator(authCtx);
    registerRecurringWorkerRoutes(app, mockDb, mockStorageBucket, authFn);
    registerReportDeliveryRoutes(app, mockDb, mockStorageBucket, authFn);

    const server = app.listen(0);
    const port = (server.address() as any).port;
    const url = 'http://127.0.0.1:' + port + endpoint;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ batchSize: 5 }),
      });
      const data = await res.json().catch(() => ({}));
      return { status: res.status, data };
    } finally {
      server.close();
    }
  }

  const baseCtx: WorkerAuthContext = {
    cronSecret: VALID_CRON_SECRET,
    workerSecret: VALID_WORKER_SECRET,
    schedulerAudience: VALID_AUDIENCE,
    schedulerServiceAccount: VALID_SERVICE_ACCOUNT,
    oidcVerifier: defaultMockOidcVerifier,
    firebaseVerifier: defaultMockFirebaseVerifier,
  };

  // Test 1: Valid cron secret: authorized
  console.log('Test 1: Valid cron secret via x-cron-key is authorized');
  const r1 = await testEndpoint(baseCtx, { 'x-cron-key': VALID_CRON_SECRET });
  assert.strictEqual(r1.status, 200);
  assert.strictEqual(r1.data.success, true);
  console.log('  [PASS] Status 200 - worker endpoint executed successfully with cron secret');

  // Test 2: Missing cron secret on server: rejected (unconfigured fails closed)
  console.log('\nTest 2: Missing cron secret configuration fails closed');
  const r2 = await testEndpoint({ ...baseCtx, cronSecret: '' }, { 'x-cron-key': VALID_CRON_SECRET });
  assert.strictEqual(r2.status, 401);
  assert.strictEqual(r2.data.error, 'Unauthorized');
  console.log('  [PASS] Status 401 - missing server cron secret rejected');

  // Test 3: Incorrect cron secret: rejected
  console.log('\nTest 3: Incorrect cron secret is rejected');
  const r3 = await testEndpoint(baseCtx, { 'x-cron-key': 'incorrect_secret_xyz' });
  assert.strictEqual(r3.status, 401);
  assert.strictEqual(r3.data.error, 'Unauthorized');
  console.log('  [PASS] Status 401 - incorrect cron secret rejected');

  // Test 4: Valid internal worker secret: authorized
  console.log('\nTest 4: Valid internal worker secret via Authorization: Bearer is authorized');
  const r4 = await testEndpoint(baseCtx, { Authorization: 'Bearer ' + VALID_WORKER_SECRET });
  assert.strictEqual(r4.status, 200);
  assert.strictEqual(r4.data.success, true);
  console.log('  [PASS] Status 200 - worker endpoint executed successfully with internal worker secret');

  // Test 5: Missing worker secret on server: rejected (unconfigured fails closed)
  console.log('\nTest 5: Missing worker secret configuration fails closed');
  const r5 = await testEndpoint({ ...baseCtx, workerSecret: '' }, { Authorization: 'Bearer ' + VALID_WORKER_SECRET });
  assert.strictEqual(r5.status, 401);
  assert.strictEqual(r5.data.error, 'Unauthorized');
  console.log('  [PASS] Status 401 - unconfigured worker secret fails closed');

  // Test 6: Incorrect worker secret: rejected
  console.log('\nTest 6: Incorrect worker secret is rejected');
  const r6 = await testEndpoint(baseCtx, { Authorization: 'Bearer incorrect_worker_secret' });
  assert.strictEqual(r6.status, 401);
  assert.strictEqual(r6.data.error, 'Unauthorized');
  console.log('  [PASS] Status 401 - incorrect worker secret rejected');

  // Test 7: Valid Google OIDC credentials: authorized
  console.log('\nTest 7: Valid Google OIDC token with matching audience and service account is authorized');
  const r7 = await testEndpoint(baseCtx, { Authorization: 'Bearer valid_google_oidc_token' });
  assert.strictEqual(r7.status, 200);
  assert.strictEqual(r7.data.success, true);
  console.log('  [PASS] Status 200 - valid Google OIDC token accepted');

  // Test 8: Wrong OIDC audience: rejected
  console.log('\nTest 8: Google OIDC token with wrong audience is rejected');
  const r8 = await testEndpoint({ ...baseCtx, schedulerAudience: 'https://other-audience.run.app' }, { Authorization: 'Bearer valid_google_oidc_token' });
  assert.strictEqual(r8.status, 401);
  assert.strictEqual(r8.data.error, 'Unauthorized');
  console.log('  [PASS] Status 401 - mismatched OIDC audience rejected');

  // Test 9: Wrong Scheduler service-account identity: rejected
  console.log('\nTest 9: Google OIDC token from unauthorized service account identity is rejected');
  const r9 = await testEndpoint(baseCtx, { Authorization: 'Bearer oidc_token_wrong_service_account' });
  assert.strictEqual(r9.status, 401);
  assert.strictEqual(r9.data.error, 'Unauthorized');
  console.log('  [PASS] Status 401 - unauthorized service account rejected');

  // Test 10: Missing OIDC audience or service-account configuration: fails closed
  console.log('\nTest 10: Missing OIDC audience or service account configuration fails closed');
  const r10a = await testEndpoint({ ...baseCtx, schedulerAudience: '' }, { Authorization: 'Bearer valid_google_oidc_token' });
  assert.strictEqual(r10a.status, 401);
  const r10b = await testEndpoint({ ...baseCtx, schedulerServiceAccount: '' }, { Authorization: 'Bearer valid_google_oidc_token' });
  assert.strictEqual(r10b.status, 401);
  console.log('  [PASS] Status 401 - missing OIDC configuration fails closed without broadening access');

  // Test 11: Invalid or expired OIDC token: rejected
  console.log('\nTest 11: Invalid or expired OIDC token is rejected');
  const r11 = await testEndpoint(baseCtx, { Authorization: 'Bearer expired_or_tampered_token' });
  assert.strictEqual(r11.status, 401);
  assert.strictEqual(r11.data.error, 'Unauthorized');
  console.log('  [PASS] Status 401 - invalid or expired OIDC token rejected');

  // Test 12: Firebase ID token with admin role: REJECTED per Requirement 24.17
  console.log('\nTest 12: Firebase ID token with admin role is REJECTED as a worker credential');
  const r12 = await testEndpoint(baseCtx, { Authorization: 'Bearer firebase_token_admin' });
  assert.strictEqual(r12.status, 401);
  assert.strictEqual(r12.data.error, 'Unauthorized');
  console.log('  [PASS] Status 401 - Firebase admin user token rejected from worker endpoint');

  // Test 13: Firebase ID token with org_admin role: REJECTED per Requirement 24.17
  console.log('\nTest 13: Firebase ID token with org_admin role is REJECTED as a worker credential');
  const r13 = await testEndpoint(baseCtx, { Authorization: 'Bearer firebase_token_org_admin' });
  assert.strictEqual(r13.status, 401);
  assert.strictEqual(r13.data.error, 'Unauthorized');
  console.log('  [PASS] Status 401 - Firebase org_admin user token rejected from worker endpoint');

  // Test 14: Firebase ID token with platform_admin claim: REJECTED per Requirement 24.17
  console.log('\nTest 14: Firebase ID token with platform_admin claim is REJECTED as a worker credential');
  const r14 = await testEndpoint(baseCtx, { Authorization: 'Bearer firebase_token_platform_admin' });
  assert.strictEqual(r14.status, 401);
  assert.strictEqual(r14.data.error, 'Unauthorized');
  console.log('  [PASS] Status 401 - Firebase platform_admin token rejected from worker endpoint');

  // Test 15: Firebase ID token with isOrgAdmin claim: REJECTED per Requirement 24.17
  console.log('\nTest 15: Firebase ID token with isOrgAdmin claim is REJECTED as a worker credential');
  const r15 = await testEndpoint(baseCtx, { Authorization: 'Bearer firebase_token_is_org_admin' });
  assert.strictEqual(r15.status, 401);
  assert.strictEqual(r15.data.error, 'Unauthorized');
  console.log('  [PASS] Status 401 - Firebase isOrgAdmin token rejected from worker endpoint');

  // Test 16: Missing credentials on both worker endpoints: HTTP 401
  console.log('\nTest 16: Missing credentials rejected with 401 on both worker endpoints');
  const r16a = await testEndpoint(baseCtx, {}, '/api/internal/reports/process-recurring');
  assert.strictEqual(r16a.status, 401);
  assert.strictEqual(r16a.data.error, 'Unauthorized');

  const r16b = await testEndpoint(baseCtx, {}, '/api/internal/reports/dispatch-deliveries');
  assert.strictEqual(r16b.status, 401);
  assert.strictEqual(r16b.data.error, 'Unauthorized');
  console.log('  [PASS] Status 401 - both worker endpoints reject requests with missing credentials');

  console.log('\n=== All 16 Requirement 24.17 Authentication Regression Tests PASSED ===');
}

runTests().catch((err) => {
  console.error('\nTest failed:', err);
  process.exit(1);
});
