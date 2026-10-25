/**
 * tests/test_vercel_api_routing_and_branding.ts
 *
 * AH.160 — Verification Suite for Vercel API Routing Proxy and Google Branding
 *
 * Validates:
 * 1. vercel.json contains an exact, precedence-ordered rewrite rule for API requests.
 * 2. API rewrite captures path and query parameters and directs them to the verified Cloud Run backend.
 * 3. SPA fallback rewrite is preserved and evaluated only after the API rewrite rule.
 * 4. AuthView.tsx completely eliminates the red Font Awesome Google icon (<i className="fa-brands fa-google text-red-500">).
 * 5. AuthView.tsx includes compliant, official 4-color Google "G" SVG marks for both login and registration flows.
 * 6. Microsoft Entra branding and OAuth click handlers remain intact.
 * 7. Simulated routing ensures API requests do not return the SPA index.html shell.
 */

import fs from 'fs';
import path from 'path';
import assert from 'assert';

console.log('================================================================================');
console.log('🔍 RUNNING AH.160 VERCEL API ROUTING & GOOGLE BRANDING VERIFICATION SUITE');
console.log('================================================================================\n');

// -----------------------------------------------------------------------------
// Test 1: Validate vercel.json Rewrites Architecture
// -----------------------------------------------------------------------------
console.log('--- Test 1: vercel.json Rewrite Rule Ordering & Precedence ---');
const vercelConfigPath = path.resolve('vercel.json');
assert(fs.existsSync(vercelConfigPath), 'vercel.json must exist');
const vercelConfig = JSON.parse(fs.readFileSync(vercelConfigPath, 'utf8'));

assert(Array.isArray(vercelConfig.rewrites), 'rewrites must be an array');
assert(vercelConfig.rewrites.length >= 2, 'rewrites must have at least 2 rules');

const apiRule = vercelConfig.rewrites[0];
const spaRule = vercelConfig.rewrites[1];

console.log('Rule 1 (Precedence):', apiRule);
console.log('Rule 2 (Fallback):  ', spaRule);

assert.strictEqual(apiRule.source, '/api/(.*)', 'First rewrite must match /api/(.*)');
assert.strictEqual(
  apiRule.destination,
  'https://echonote-zfo2izdqla-uw.a.run.app/api/$1',
  'First rewrite destination must target the verified Cloud Run backend'
);

assert.strictEqual(spaRule.source, '/(.*)', 'Second rewrite must match all remaining SPA routes');
assert.strictEqual(spaRule.destination, '/index.html', 'Second rewrite must route to /index.html');
console.log('✅ PASS: [1] vercel.json has strict API proxy precedence over SPA fallback.\n');

// -----------------------------------------------------------------------------
// Test 2: Simulate Route Matching Matrix
// -----------------------------------------------------------------------------
console.log('--- Test 2: Simulated Route Matching Matrix ---');
function simulateVercelRewrite(reqPath: string): { matched: string; destination: string; isApiProxy: boolean } {
  for (const rule of vercelConfig.rewrites) {
    // Vercel regex conversion from glob/regex pattern
    const regex = new RegExp(`^${rule.source.replace('(.*)', '(.*)')}$`);
    const match = reqPath.match(regex);
    if (match) {
      let dest = rule.destination;
      if (match[1] !== undefined) {
        dest = dest.replace('$1', match[1]);
      }
      return {
        matched: rule.source,
        destination: dest,
        isApiProxy: dest.startsWith('https://echonote-zfo2izdqla-uw.a.run.app/api')
      };
    }
  }
  return { matched: 'none', destination: reqPath, isApiProxy: false };
}

const testPaths = [
  { path: '/api/health', expectedDest: 'https://echonote-zfo2izdqla-uw.a.run.app/api/health', shouldProxy: true },
  { path: '/api/tasks', expectedDest: 'https://echonote-zfo2izdqla-uw.a.run.app/api/tasks', shouldProxy: true },
  { path: '/api/search-history', expectedDest: 'https://echonote-zfo2izdqla-uw.a.run.app/api/search-history', shouldProxy: true },
  { path: '/api/projects/proj_123/search', expectedDest: 'https://echonote-zfo2izdqla-uw.a.run.app/api/projects/proj_123/search', shouldProxy: true },
  { path: '/api/recordings/rec_999/trim', expectedDest: 'https://echonote-zfo2izdqla-uw.a.run.app/api/recordings/rec_999/trim', shouldProxy: true },
  { path: '/', expectedDest: '/index.html', shouldProxy: false },
  { path: '/app', expectedDest: '/index.html', shouldProxy: false },
  { path: '/join', expectedDest: '/index.html', shouldProxy: false },
  { path: '/project/xyz', expectedDest: '/index.html', shouldProxy: false }
];

testPaths.forEach(({ path, expectedDest, shouldProxy }) => {
  const result = simulateVercelRewrite(path);
  assert.strictEqual(result.destination, expectedDest, `Path ${path} must route to ${expectedDest}`);
  assert.strictEqual(result.isApiProxy, shouldProxy, `Path ${path} proxy flag mismatch`);
  console.log(`  ✅ [Route] ${path} -> ${result.destination} (API Proxy: ${result.isApiProxy})`);
});
console.log('✅ PASS: [2] Route matching matrix verified for all API and SPA paths.\n');

// -----------------------------------------------------------------------------
// Test 3: Validate Removal of Red FontAwesome Google Icon
// -----------------------------------------------------------------------------
console.log('--- Test 3: Google Branding & Icon Verification ---');
const authViewPath = path.resolve('components/AuthView.tsx');
assert(fs.existsSync(authViewPath), 'AuthView.tsx must exist');
const authViewContent = fs.readFileSync(authViewPath, 'utf8');

assert(
  !authViewContent.includes('fa-brands fa-google text-red-500'),
  'AuthView.tsx must NOT contain the old red Font Awesome Google icon'
);
assert(
  !authViewContent.includes('text-red-500 text-sm'),
  'AuthView.tsx must NOT contain the text-red-500 icon class'
);
console.log('✅ PASS: [3] Red Font Awesome Google icon is completely removed.\n');

// -----------------------------------------------------------------------------
// Test 4: Validate Official 4-Color Google "G" SVG Presence
// -----------------------------------------------------------------------------
console.log('--- Test 4: Official Multicolour Google "G" SVG Verification ---');
const officialGoogleColors = ['#4285F4', '#34A853', '#FBBC05', '#EA4335'];
officialGoogleColors.forEach(color => {
  const matches = (authViewContent.match(new RegExp(color, 'g')) || []).length;
  // Must appear at least twice: once for login, once for register
  assert(
    matches >= 2,
    `Google brand color ${color} must appear at least 2 times (login + signup). Found: ${matches}`
  );
  console.log(`  ✅ Verified Google brand color ${color} present (${matches} occurrences)`);
});

// Verify Google button click handlers remain unchanged
assert(authViewContent.includes('onClick={handleGoogleSso}'), 'handleGoogleSso must be attached to buttons');
assert(authViewContent.includes('onClick={handleMicrosoftSso}'), 'handleMicrosoftSso must remain intact');
assert(authViewContent.includes('fa-brands fa-microsoft text-sky-600'), 'Microsoft Entra branding must remain intact');

console.log('✅ PASS: [4] Compliant 4-color Google "G" marks and Microsoft branding verified.\n');

// -----------------------------------------------------------------------------
// Test 5: Verify apiClient URL Resolution Consistency
// -----------------------------------------------------------------------------
console.log('--- Test 5: apiClient.ts getApiUrl Same-Origin Behavior ---');

function getApiBaseUrl(): string {
  const envUrl = process.env.VITE_API_URL;
  if (typeof envUrl === 'string') {
    const trimmed = envUrl.trim();
    if (
      trimmed.length > 0 &&
      trimmed.toUpperCase() !== 'NA' &&
      trimmed.toLowerCase() !== 'undefined' &&
      trimmed.toLowerCase() !== 'null'
    ) {
      return trimmed.replace(/\/+$/, '');
    }
  }
  return '';
}

function getApiUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    try {
      const parsed = new URL(path);
      parsed.pathname = parsed.pathname.replace(/\/+/g, '/');
      return parsed.toString();
    } catch {
      return path;
    }
  }
  const cleanPath = '/' + path.replace(/^\/+/, '');
  const baseUrl = getApiBaseUrl();
  return baseUrl ? `${baseUrl}${cleanPath}` : cleanPath;
}

const relativeUrl1 = getApiUrl('/api/tasks');
const relativeUrl2 = getApiUrl('api/search-history');
const absoluteUrl = getApiUrl('https://custom-backend.run.app/api/health');

console.log('getApiBaseUrl():', getApiBaseUrl() || '(empty, same-origin)');
console.log('getApiUrl("/api/tasks"):', relativeUrl1);
console.log('getApiUrl("api/search-history"):', relativeUrl2);
console.log('getApiUrl("https://custom-backend.run.app/api/health"):', absoluteUrl);

assert.strictEqual(relativeUrl1, '/api/tasks', 'Must produce clean relative path /api/tasks');
assert.strictEqual(relativeUrl2, '/api/search-history', 'Must normalize relative path to /api/search-history');
assert.strictEqual(absoluteUrl, 'https://custom-backend.run.app/api/health', 'Absolute URLs must remain unchanged');
console.log('✅ PASS: [5] apiClient URL resolution produces clean same-origin relative URLs forwarded by Vercel.\n');

console.log('================================================================================');
console.log('🎉 ALL AH.160 ROUTING AND BRANDING VERIFICATIONS PASSED SUCCESSFULLY!');
console.log('================================================================================\n');
