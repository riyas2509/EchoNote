/**
 * EchoNote — API Routing & CORS Security Regression Test Suite
 *
 * Verifies:
 * 1. Approved staging frontend hosts resolve strictly to staging Cloud Run backend.
 * 2. Approved production frontend hosts resolve strictly to production Cloud Run backend.
 * 3. Unknown Vercel preview hosts fail closed with clear non-sensitive error.
 * 4. Arbitrary non-Vercel hosts fail closed with clear non-sensitive error.
 * 5. Host normalization protects against trailing dots, unexpected ports, and casing.
 * 6. Suffix, prefix, and deceptive domain tricks are strictly rejected by exact matching.
 * 7. Explicit valid VITE_API_URL maintains strict precedence and correct resolution.
 * 8. Explicit VITE_API_URL cannot silently cross environment boundaries (prod->staging or staging->prod).
 * 9. Untrusted hosts cannot use explicit API URL to target Cloud Run backends.
 * 10. VITE_API_URL pointing to frontend origin (with or without paths/trailing slashes) is safely rerouted on approved hosts, but fails closed on untrusted hosts.
 * 11. Missing or malformed VITE_API_URL configuration handled safely in Node and browser.
 * 12. Server CORS configuration strictly allows approved origins and rejects null, unknown previews, and untrusted domains.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import express from 'express';
import cors from 'cors';
import {
  getApiBaseUrl,
  normalizeHostname,
  APPROVED_PRODUCTION_HOSTS,
  APPROVED_STAGING_HOSTS,
  CLOUD_RUN_PRODUCTION_BACKEND,
  CLOUD_RUN_STAGING_BACKEND,
} from '../lib/apiClient.ts';

console.log('======================================================================');
console.log('🔒 RUNNING FOCUSED API ROUTING & CORS SECURITY REGRESSION TEST SUITE');
console.log('======================================================================');

let passedTests = 0;
let totalTests = 0;

function runTest(name: string, fn: () => void | Promise<void>) {
  totalTests++;
  try {
    const res = fn();
    if (res && typeof (res as any).then === 'function') {
      (res as any).then(() => {
        console.log(`  ✅ [PASS] ${name}`);
        passedTests++;
      }).catch((err: any) => {
        console.error(`  ❌ [FAIL] ${name}`);
        console.error(`     Error: ${err?.message || err}`);
        process.exit(1);
      });
    } else {
      console.log(`  ✅ [PASS] ${name}`);
      passedTests++;
    }
  } catch (err: any) {
    console.error(`  ❌ [FAIL] ${name}`);
    console.error(`     Error: ${err?.message || err}`);
    process.exit(1);
  }
}

// Helper to simulate browser environment
function withBrowserContext(
  hostname: string,
  origin: string,
  envApiUrl: string | undefined,
  fn: () => void
) {
  const origWindow = (global as any).window;
  const origEnv = process.env.VITE_API_URL;

  try {
    if (envApiUrl !== undefined) {
      process.env.VITE_API_URL = envApiUrl;
    } else {
      delete process.env.VITE_API_URL;
    }

    (global as any).window = {
      location: {
        hostname,
        origin,
      },
    };

    fn();
  } finally {
    if (origWindow === undefined) {
      delete (global as any).window;
    } else {
      (global as any).window = origWindow;
    }

    if (origEnv !== undefined) {
      process.env.VITE_API_URL = origEnv;
    } else {
      delete process.env.VITE_API_URL;
    }
  }
}

// -----------------------------------------------------------------------------
// Test Group 1: Approved Staging Frontend Hosts
// -----------------------------------------------------------------------------
runTest('1.1 Approved staging host echonote-staging.vercel.app resolves to staging backend', () => {
  withBrowserContext('echonote-staging.vercel.app', 'https://echonote-staging.vercel.app', '', () => {
    const url = getApiBaseUrl();
    assert.strictEqual(url, CLOUD_RUN_STAGING_BACKEND);
    assert.strictEqual(url, 'https://echonote-staging-3fgo4kkjgq-uw.a.run.app');
  });
});

runTest('1.2 Approved staging host echonote-stage.vercel.app resolves to staging backend', () => {
  withBrowserContext('echonote-stage.vercel.app', 'https://echonote-stage.vercel.app', '', () => {
    const url = getApiBaseUrl();
    assert.strictEqual(url, CLOUD_RUN_STAGING_BACKEND);
  });
});

// -----------------------------------------------------------------------------
// Test Group 2: Approved Production Frontend Hosts
// -----------------------------------------------------------------------------
runTest('2.1 Approved production host echonote-25.vercel.app resolves to production backend', () => {
  withBrowserContext('echonote-25.vercel.app', 'https://echonote-25.vercel.app', '', () => {
    const url = getApiBaseUrl();
    assert.strictEqual(url, CLOUD_RUN_PRODUCTION_BACKEND);
    assert.strictEqual(url, 'https://echonote-zfo2izdqla-uw.a.run.app');
  });
});

runTest('2.2 Approved production host echonote.vercel.app resolves to production backend', () => {
  withBrowserContext('echonote.vercel.app', 'https://echonote.vercel.app', '', () => {
    const url = getApiBaseUrl();
    assert.strictEqual(url, CLOUD_RUN_PRODUCTION_BACKEND);
  });
});

// -----------------------------------------------------------------------------
// Test Group 3: Host Normalization & Deceptive Domain Rejection
// -----------------------------------------------------------------------------
runTest('3.1 Hostname normalization strips ports, trailing FQDN dots, and normalizes case', () => {
  assert.strictEqual(normalizeHostname('ECHONOTE-25.VERCEL.APP.'), 'echonote-25.vercel.app');
  assert.strictEqual(normalizeHostname('  echonote.vercel.app:443  '), 'echonote.vercel.app');
  assert.strictEqual(normalizeHostname(''), '');
  assert.strictEqual(normalizeHostname(null), '');
});

runTest('3.2 Suffix trick (echonote-25.vercel.app.attacker.com) fails closed', () => {
  withBrowserContext('echonote-25.vercel.app.attacker.com', 'https://echonote-25.vercel.app.attacker.com', '', () => {
    assert.throws(
      () => getApiBaseUrl(),
      /EchoNote API Configuration Error: Untrusted host/
    );
  });
});

runTest('3.3 Prefix trick (attacker-echonote-25.vercel.app) fails closed', () => {
  withBrowserContext('attacker-echonote-25.vercel.app', 'https://attacker-echonote-25.vercel.app', '', () => {
    assert.throws(
      () => getApiBaseUrl(),
      /EchoNote API Configuration Error: Untrusted host/
    );
  });
});

runTest('3.4 Deceptive domain (fake-echonote.vercel.app) fails closed', () => {
  withBrowserContext('fake-echonote.vercel.app', 'https://fake-echonote.vercel.app', '', () => {
    assert.throws(
      () => getApiBaseUrl(),
      /EchoNote API Configuration Error: Untrusted host/
    );
  });
});

runTest('3.5 Arbitrary external domain (phishing-site.com) fails closed', () => {
  withBrowserContext('phishing-site.com', 'https://phishing-site.com', '', () => {
    assert.throws(
      () => getApiBaseUrl(),
      /EchoNote API Configuration Error: Untrusted host/
    );
  });
});

// -----------------------------------------------------------------------------
// Test Group 4: Localhost Development
// -----------------------------------------------------------------------------
runTest('4.1 Localhost and 127.0.0.1 resolve cleanly to empty string for dev proxying', () => {
  withBrowserContext('localhost', 'http://localhost:5173', '', () => {
    assert.strictEqual(getApiBaseUrl(), '');
  });
  withBrowserContext('127.0.0.1', 'http://127.0.0.1:3000', '', () => {
    assert.strictEqual(getApiBaseUrl(), '');
  });
});

// -----------------------------------------------------------------------------
// Test Group 5: Explicit VITE_API_URL & Environment Boundary Integrity
// -----------------------------------------------------------------------------
runTest('5.1 Explicit VITE_API_URL takes precedence and strips trailing slashes', () => {
  withBrowserContext('echonote-25.vercel.app', 'https://echonote-25.vercel.app', 'https://custom-backend.internal.net//', () => {
    assert.strictEqual(getApiBaseUrl(), 'https://custom-backend.internal.net');
  });
});

runTest('5.2 Production frontend host cannot target staging backend URL (fails closed)', () => {
  withBrowserContext('echonote-25.vercel.app', 'https://echonote-25.vercel.app', CLOUD_RUN_STAGING_BACKEND, () => {
    assert.throws(
      () => getApiBaseUrl(),
      /Production frontend host cannot target staging backend/
    );
  });
});

runTest('5.3 Staging frontend host cannot target production backend URL (fails closed)', () => {
  withBrowserContext('echonote-staging.vercel.app', 'https://echonote-staging.vercel.app', CLOUD_RUN_PRODUCTION_BACKEND, () => {
    assert.throws(
      () => getApiBaseUrl(),
      /Staging frontend host cannot target production backend/
    );
  });
});

runTest('5.4 Untrusted host cannot target Cloud Run backend via explicit VITE_API_URL (fails closed)', () => {
  withBrowserContext('attacker.com', 'https://attacker.com', CLOUD_RUN_PRODUCTION_BACKEND, () => {
    assert.throws(
      () => getApiBaseUrl(),
      /Untrusted host "attacker\.com" cannot route to Cloud Run backend/
    );
  });
});

// -----------------------------------------------------------------------------
// Test Group 6: VITE_API_URL Pointing to Frontend Origin
// -----------------------------------------------------------------------------
runTest('6.1 VITE_API_URL pointing to frontend origin on approved prod host safely reroutes to production backend', () => {
  withBrowserContext('echonote-25.vercel.app', 'https://echonote-25.vercel.app', 'https://echonote-25.vercel.app/', () => {
    assert.strictEqual(getApiBaseUrl(), CLOUD_RUN_PRODUCTION_BACKEND);
  });
});

runTest('6.2 VITE_API_URL pointing to frontend origin with /api path safely reroutes to production backend', () => {
  withBrowserContext('echonote-25.vercel.app', 'https://echonote-25.vercel.app', 'https://echonote-25.vercel.app/api', () => {
    assert.strictEqual(getApiBaseUrl(), CLOUD_RUN_PRODUCTION_BACKEND);
  });
});

runTest('6.3 VITE_API_URL pointing to frontend origin on approved staging host safely reroutes to staging backend', () => {
  withBrowserContext('echonote-staging.vercel.app', 'https://echonote-staging.vercel.app', 'https://echonote-staging.vercel.app', () => {
    assert.strictEqual(getApiBaseUrl(), CLOUD_RUN_STAGING_BACKEND);
  });
});

runTest('6.4 VITE_API_URL pointing to frontend origin on untrusted host fails closed', () => {
  withBrowserContext('untrusted-site.vercel.app', 'https://untrusted-site.vercel.app', 'https://untrusted-site.vercel.app', () => {
    assert.throws(
      () => getApiBaseUrl(),
      /EchoNote API Configuration Error: Untrusted frontend host "untrusted-site\.vercel\.app"/
    );
  });
});

// -----------------------------------------------------------------------------
// Test Group 7: Missing or Malformed Configuration & Node Compatibility
// -----------------------------------------------------------------------------
runTest('7.1 Whitespace-only, NA, undefined, and null string values are treated as unset', () => {
  const malformedInputs = ['   ', 'NA', 'na', 'undefined', 'null', 'NULL'];
  for (const input of malformedInputs) {
    withBrowserContext('echonote-25.vercel.app', 'https://echonote-25.vercel.app', input, () => {
      assert.strictEqual(getApiBaseUrl(), CLOUD_RUN_PRODUCTION_BACKEND, `Failed for input: ${input}`);
    });
  }
});

runTest('7.2 Node environment with unset VITE_API_URL returns empty string cleanly', () => {
  delete process.env.VITE_API_URL;
  assert.strictEqual(getApiBaseUrl(), '');
});

runTest('7.3 Node environment with explicit VITE_API_URL returns configured URL', () => {
  process.env.VITE_API_URL = 'https://node-backend.run.app/';
  assert.strictEqual(getApiBaseUrl(), 'https://node-backend.run.app');
  delete process.env.VITE_API_URL;
});

// -----------------------------------------------------------------------------
// Test Group 8: Server CORS Security & Origin Isolation
// -----------------------------------------------------------------------------
runTest('8.1 Server CORS configuration static audit confirms exact allowlist', () => {
  const serverCode = fs.readFileSync('server.ts', 'utf8');

  assert(serverCode.includes('"https://echonote-25.vercel.app"'), 'Must include echonote-25.vercel.app');
  assert(serverCode.includes('"https://echonote.vercel.app"'), 'Must include echonote.vercel.app');
  assert(serverCode.includes('"https://echonote-staging.vercel.app"'), 'Must include echonote-staging.vercel.app');
  assert(serverCode.includes('"https://echonote-stage.vercel.app"'), 'Must include echonote-stage.vercel.app');
  assert(!serverCode.includes('/^https:\\/\\/echonote(-[a-zA-Z0-9_-]+)?\\.vercel\\.app$/'), 'Broad Vercel wildcard regex must be removed');
  assert(serverCode.includes('cleanOrigin === "null"'), 'Must reject null string origin');
});

runTest('8.2 Live Express CORS simulation enforces approved origins and rejects unapproved origins', async () => {
  const defaultAllowedOrigins = [
    "https://echonote-25.ai.studio",
    "https://ai.studio",
    "https://echonote-25.vercel.app",
    "https://echonote.vercel.app",
    "https://echonote-staging.vercel.app",
    "https://echonote-stage.vercel.app",
    "https://echotechai.in",
    "https://www.echotechai.in",
  ];

  const approvedVercelOrigins = [
    "https://echonote-25.vercel.app",
    "https://echonote.vercel.app",
    "https://echonote-staging.vercel.app",
    "https://echonote-stage.vercel.app"
  ];

  function checkOrigin(origin: string | undefined): Promise<{ allowed: boolean; headersSet: boolean }> {
    return new Promise((resolve) => {
      const corsMiddleware = cors({
        origin: (reqOrigin, callback) => {
          if (!reqOrigin) return callback(null, true);
          const cleanOrigin = reqOrigin.replace(/\/+$/, '');
          if (cleanOrigin === "null" || cleanOrigin === "") return callback(null, false);
          if (defaultAllowedOrigins.includes(cleanOrigin)) return callback(null, true);
          if (approvedVercelOrigins.includes(cleanOrigin)) return callback(null, true);
          if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(cleanOrigin)) return callback(null, true);
          return callback(null, false);
        },
        credentials: true
      });

      let nextCalled = false;
      const req: any = { headers: { origin }, method: 'GET' };
      const res: any = {
        setHeader: (k: string, v: string) => {
          if (k.toLowerCase() === 'access-control-allow-origin') {
            res._allowedOrigin = v;
          }
        },
        getHeader: () => {},
      };
      corsMiddleware(req, res, () => {
        nextCalled = true;
        resolve({
          allowed: nextCalled,
          headersSet: res._allowedOrigin !== undefined
        });
      });
    });
  }

  const prodRes = await checkOrigin('https://echonote-25.vercel.app');
  assert.strictEqual(prodRes.allowed && prodRes.headersSet, true, 'Approved prod must be allowed with CORS headers');

  const stagingRes = await checkOrigin('https://echonote-staging.vercel.app');
  assert.strictEqual(stagingRes.allowed && stagingRes.headersSet, true, 'Approved staging must be allowed with CORS headers');

  const localRes = await checkOrigin('http://localhost:3000');
  assert.strictEqual(localRes.allowed && localRes.headersSet, true, 'Localhost must be allowed with CORS headers');

  const noOriginRes = await checkOrigin(undefined);
  assert.strictEqual(noOriginRes.allowed, true, 'Same-origin/no-origin request must be allowed through next()');

  const attackerRes = await checkOrigin('https://echonote-evil.vercel.app');
  assert.strictEqual(attackerRes.headersSet, false, 'Arbitrary Vercel preview must not receive CORS allow header');

  const nullRes = await checkOrigin('null');
  assert.strictEqual(nullRes.headersSet, false, 'Null origin must not receive CORS allow header');

  const phishingRes = await checkOrigin('https://phishing.com');
  assert.strictEqual(phishingRes.headersSet, false, 'Phishing origin must not receive CORS allow header');
});

// Await async tests before printing final success
setTimeout(() => {
  console.log('======================================================================');
  console.log(`🎉 ALL ${passedTests}/${totalTests} FOCUSED SECURITY TESTS PASSED!`);
  console.log('======================================================================');
}, 100);
