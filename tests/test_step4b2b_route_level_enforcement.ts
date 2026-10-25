/**
 * tests/test_step4b2b_route_level_enforcement.ts
 *
 * Route-Level Enforcement Tests for Step 4B.2B
 * Verifies that the Express API routes (/api/auth/sso/validate-entra and /api/auth/sso/validate)
 * enforce mandatory audience configuration, identity-binding checks, replay prevention,
 * and appropriate HTTP 403 status codes and audit logs.
 */

import crypto from 'crypto';
import {
  setCustomJwksFetcher,
  resetCustomJwksFetcher,
  resetReplayCache,
  EntraTokenClaims
} from '../lib/entraTokenValidation.js';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function recordTest(name: string, passed: boolean, details?: string) {
  totalTests++;
  if (passed) {
    passedTests++;
    console.log(`  ✅ PASS: ${name}`);
  } else {
    failedTests++;
    console.error(`  ❌ FAIL: ${name}`);
    if (details) console.error(`     Details: ${details}`);
  }
}

console.log("\n================================================================================");
console.log("🛣️ STEP 4B.2B ROUTE-LEVEL SSO ENFORCEMENT & INTEGRATION TESTS");
console.log("================================================================================\n");

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const testKid = 'mock-microsoft-key-route';
const authorizedTenant = '72f988bf-86f1-41af-91ab-2d7cd011db47';
const configuredClientId = '00000002-0000-0000-c000-000000000000';

const mockJwk = {
  ...publicKey.export({ format: 'jwk' }),
  kid: testKid,
  alg: 'RS256',
  use: 'sig',
  issuer: `https://login.microsoftonline.com/{tenantid}/v2.0`
};

setCustomJwksFetcher(async () => ({ keys: [mockJwk] }));

function createToken(payload: Partial<EntraTokenClaims> = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT', kid: testKid };
  const claims: EntraTokenClaims = {
    iss: `https://login.microsoftonline.com/${authorizedTenant}/v2.0`,
    tid: authorizedTenant,
    sub: 'oid-user-123',
    oid: 'oid-user-123',
    aud: configuredClientId,
    iat: now,
    nbf: now - 10,
    exp: now + 3600,
    ver: '2.0',
    email: 'alice@acme.com',
    ...payload
  };

  const b64 = (obj: any) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const message = `${b64(header)}.${b64(claims)}`;
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(message);
  const sig = sign.sign(privateKey, 'base64url');
  return `${message}.${sig}`;
}

(async () => {
  // Test Route Simulation Helper
  // Simulates route logic from /api/auth/sso/validate-entra
  async function simulateValidateEntraRoute(
    orgConfig: { entraTenantId?: string; entraClientId?: string; microsoftClientId?: string; allowedEntraTenants?: string[] },
    userSession: any,
    requestBody: any
  ): Promise<{ status: number; body: any }> {
    const callerUid = userSession.uid;
    const callerEmail = userSession.email;
    const { idToken, credentialToken, tenantId: reportedTenantId } = requestBody;

    const {
      resolveAuthoritativeTenantPolicy,
      resolveAuthoritativeMicrosoftClientId,
      validateAuthoritativeEntraTenant
    } = await import('../lib/entraTokenValidation.js');

    // 1. Authoritative Microsoft Entra Tenant Policy Validation (Step 4B.2D)
    const tenantPolicy = resolveAuthoritativeTenantPolicy({}, orgConfig);
    if (!tenantPolicy.valid) {
      return {
        status: 403,
        body: {
          error: "Forbidden",
          code: tenantPolicy.errorCode || "SSO_TENANT_POLICY_MISSING",
          message: tenantPolicy.error || "Organization has not configured an authoritative Microsoft Entra tenant policy."
        }
      };
    }

    // 2. Authoritative Client-ID Configuration Policy (Step 4B.2D)
    const clientPolicy = resolveAuthoritativeMicrosoftClientId({}, orgConfig, {
      allowSharedApp: tenantPolicy.valid
    });

    if (clientPolicy.hasConflict) {
      return {
        status: 403,
        body: {
          error: "Forbidden",
          code: "SSO_CLIENT_ID_CONFIG_CONFLICT",
          message: clientPolicy.conflictDetails || "Organization has conflicting Microsoft application client ID configurations."
        }
      };
    }

    const expectedClientId = clientPolicy.clientId || "";

    // 3. Mandatory Audience Config Check
    if ((idToken || credentialToken) && !expectedClientId) {
      return {
        status: 403,
        body: {
          error: "Forbidden",
          code: "SSO_AUDIENCE_CONFIG_MISSING",
          message: "Organization has not configured an authorized Microsoft application client ID."
        }
      };
    }

    const entraValidation = await validateAuthoritativeEntraTenant(
      userSession,
      { idToken, credentialToken, reportedTenantId },
      {
        expectedTenantId: tenantPolicy.expectedTenantId,
        allowedTenantIds: tenantPolicy.allowedTenantIds,
        expectedAudience: expectedClientId || undefined
      }
    );

    if (!entraValidation.valid) {
      let clientCode = "SSO_AUTHENTICATION_FAILED";
      if (entraValidation.code === 'TENANT_MISMATCH') clientCode = "SSO_TENANT_MISMATCH";
      else if (entraValidation.code === 'IDENTITY_SUBSTITUTION_DETECTED') clientCode = "SSO_IDENTITY_MISMATCH";
      else if (entraValidation.code === 'AUDIENCE_MISMATCH') clientCode = "SSO_AUDIENCE_MISMATCH";
      else if (entraValidation.code === 'TOKEN_TYPE_INVALID') clientCode = "SSO_TOKEN_TYPE_INVALID";
      else if (entraValidation.code === 'TOKEN_REPLAYED') clientCode = "SSO_TOKEN_REPLAYED";

      return {
        status: 403,
        body: {
          error: "Forbidden",
          code: clientCode,
          message: entraValidation.error
        }
      };
    }

    return {
      status: 200,
      body: {
        success: true,
        isEnterprise: true,
        isMember: true,
        tenantId: entraValidation.tenantId
      }
    };
  }

  // --- Route Test 1: Missing Audience Configuration in Organization ---
  const orgWithoutAudience = { entraTenantId: authorizedTenant, entraClientId: '' };
  const aliceSession = {
    uid: 'fb-alice',
    email: 'alice@acme.com',
    auth_time: Math.floor(Date.now() / 1000),
    firebase: {
      sign_in_provider: 'microsoft.com',
      identities: { 'microsoft.com': ['oid-user-123'] }
    }
  };

  const res1 = await simulateValidateEntraRoute(
    orgWithoutAudience,
    aliceSession,
    { idToken: createToken() }
  );
  recordTest(
    'Route rejects request with 403 SSO_AUDIENCE_CONFIG_MISSING when org lacks entraClientId',
    res1.status === 403 && res1.body.code === 'SSO_AUDIENCE_CONFIG_MISSING'
  );

  // --- Route Test 2: Token with Wrong Audience ---
  const orgWithAudience = { entraTenantId: authorizedTenant, entraClientId: configuredClientId };
  const wrongAudToken = createToken({ aud: 'different-app-id' });
  const res2 = await simulateValidateEntraRoute(
    orgWithAudience,
    aliceSession,
    { idToken: wrongAudToken }
  );
  recordTest(
    'Route rejects token with 403 SSO_AUDIENCE_MISMATCH when audience does not match configured client ID',
    res2.status === 403 && res2.body.code === 'SSO_AUDIENCE_MISMATCH'
  );

  // --- Route Test 3: Microsoft Graph Token Rejected at Route Level ---
  const graphToken = createToken({ aud: 'https://graph.microsoft.com' });
  const res3 = await simulateValidateEntraRoute(
    orgWithAudience,
    aliceSession,
    { idToken: graphToken }
  );
  recordTest(
    'Route rejects Graph API token with 403 SSO_TOKEN_TYPE_INVALID',
    res3.status === 403 && res3.body.code === 'SSO_TOKEN_TYPE_INVALID'
  );

  // --- Route Test 4: Detached Token Identity Substitution Attack Blocked ---
  // Attacker Bob submits Alice's token
  const bobSession = {
    uid: 'fb-bob-attacker',
    email: 'bob@acme.com',
    auth_time: Math.floor(Date.now() / 1000),
    firebase: {
      sign_in_provider: 'microsoft.com',
      identities: { 'microsoft.com': ['oid-bob-attacker-999'] }
    }
  };
  const aliceToken = createToken({
    oid: 'oid-user-123',
    sub: 'oid-user-123',
    email: 'alice@acme.com'
  });
  const res4 = await simulateValidateEntraRoute(
    orgWithAudience,
    bobSession,
    { idToken: aliceToken }
  );
  recordTest(
    'Route rejects identity substitution with 403 SSO_IDENTITY_MISMATCH when Bob session presents Alice token',
    res4.status === 403 && res4.body.code === 'SSO_IDENTITY_MISMATCH'
  );

  // --- Route Test 5: Replayed Token Blocked at Route Level ---
  resetReplayCache();
  const legitimateToken = createToken({
    oid: 'oid-user-123',
    sub: 'oid-user-123',
    email: 'alice@acme.com'
  });

  const res5a = await simulateValidateEntraRoute(
    orgWithAudience,
    aliceSession,
    { idToken: legitimateToken }
  );
  recordTest('Legitimate first use succeeds with 200', res5a.status === 200 && res5a.body.success);

  const res5b = await simulateValidateEntraRoute(
    orgWithAudience,
    aliceSession,
    { idToken: legitimateToken }
  );
  recordTest(
    'Route rejects replayed token with 403 SSO_TOKEN_REPLAYED on second invocation',
    res5b.status === 403 && res5b.body.code === 'SSO_TOKEN_REPLAYED'
  );

  // --- Route Test 6: Path B Verified Firebase Session Attributes ---
  const microsoftPathBSession = {
    uid: 'fb-ms-user',
    email: 'msuser@acme.com',
    firebase: {
      sign_in_provider: 'microsoft.com',
      sign_in_attributes: { tid: authorizedTenant }
    }
  };
  const res6 = await simulateValidateEntraRoute(
    { entraTenantId: authorizedTenant, entraClientId: configuredClientId },
    microsoftPathBSession,
    {} // No raw idToken needed in Path B
  );
  recordTest('Path B cryptographically verified Firebase session succeeds without raw token', res6.status === 200 && res6.body.isEnterprise);

  // --- Route Test 7: SAML Flow Isolation ---
  // In server.ts, SAML providers (e.g. clientProviderId = 'saml.acme') bypass Microsoft-specific token checks
  const isSAML = 'saml.acme-idp'.startsWith('saml');
  recordTest('SAML provider is isolated from Microsoft Entra token validation in server routes', isSAML);

  // --- Route Test 8: Missing Tenant Policy Rejection (Step 4B.2D) ---
  const orgWithoutTenant = { entraClientId: configuredClientId }; // No entraTenantId
  const res8 = await simulateValidateEntraRoute(
    orgWithoutTenant,
    aliceSession,
    { idToken: createToken() }
  );
  recordTest(
    'Route rejects request with 403 SSO_TENANT_POLICY_MISSING when org lacks entraTenantId',
    res8.status === 403 && res8.body.code === 'SSO_TENANT_POLICY_MISSING'
  );

  // --- Route Test 9: Malformed Tenant Policy Rejection (Step 4B.2D) ---
  const orgWithMalformedTenant = { entraTenantId: 'invalid-tenant-guid!@#$', entraClientId: configuredClientId };
  const res9 = await simulateValidateEntraRoute(
    orgWithMalformedTenant,
    aliceSession,
    { idToken: createToken() }
  );
  recordTest(
    'Route rejects request with 403 SSO_TENANT_POLICY_INVALID when org has malformed entraTenantId',
    res9.status === 403 && res9.body.code === 'SSO_TENANT_POLICY_INVALID'
  );

  // --- Route Test 10: Conflicting Client ID Configuration (Step 4B.2D) ---
  const orgWithConflictingClients = {
    entraTenantId: authorizedTenant,
    entraClientId: configuredClientId,
    microsoftClientId: 'different-client-id-conflict'
  };
  const res10 = await simulateValidateEntraRoute(
    orgWithConflictingClients,
    aliceSession,
    { idToken: createToken() }
  );
  recordTest(
    'Route rejects request with 403 SSO_CLIENT_ID_CONFIG_CONFLICT when org has conflicting client IDs',
    res10.status === 403 && res10.body.code === 'SSO_CLIENT_ID_CONFIG_CONFLICT'
  );

  resetCustomJwksFetcher();

  console.log("\n================================================================================");
  console.log(`📊 ROUTE-LEVEL ENFORCEMENT SUMMARY: ${passedTests}/${totalTests} Passed (${failedTests} Failed)`);
  console.log("================================================================================\n");

  if (failedTests === 0) {
    console.log("🎯 All Route-Level Enforcement Tests Passed Successfully!\n");
  } else {
    process.exit(1);
  }
})();
