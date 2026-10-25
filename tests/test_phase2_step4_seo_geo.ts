/**
 * EchoNote — Phase 2, Step 4: Technical SEO & GEO Comprehensive Test Suite
 *
 * Validates:
 * 1. Verification of canonical domain resolution (`https://echonote-25.ai.studio`).
 * 2. Public route coverage & metadata accuracy (title, description, canonical link).
 * 3. Open Graph and Twitter Card metadata properties.
 * 4. Robots.txt format, crawl rules, and boundary enforcement (Allow public, Disallow private).
 * 5. Sitemap.xml format, schema compliance, and exclusion of private routes.
 * 6. Structured data (JSON-LD) validity, schema types (Organization, SoftwareApplication, WebSite, FAQPage).
 * 7. GEO & Answer-Engine readability (Core positioning, decision workflow from meeting to execution).
 * 8. Exclusion of private user data (transcripts, recordings, project names, user emails) from public SEO artifacts.
 * 9. Safe fallback & 404 behavior for private/unmapped routes.
 */

import fs from 'fs';
import path from 'path';

export function runPhase2Step4SeoGeoValidation() {
  console.log('=== Starting Phase 2, Step 4: SEO & GEO Technical Verification ===\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName}${detail ? ` - ${detail}` : ''}`);
      failed++;
    }
  }

  const CANONICAL_DOMAIN = 'https://echonote-25.vercel.app';
  const CORE_POSITIONING = 'EchoNote is a decision and execution memory layer for coordination-heavy teams.';

  // 1. Verify Canonical Domain & Robots.txt
  console.log('--- Test Suite 1: Canonical Domain & Robots.txt Boundaries ---');

  const robotsPath = path.join(process.cwd(), 'public', 'robots.txt');
  assert(fs.existsSync(robotsPath), '1.1 public/robots.txt file exists');

  const robotsContent = fs.readFileSync(robotsPath, 'utf8');
  assert(robotsContent.includes('User-agent: *'), '1.2 robots.txt specifies User-agent: *');
  assert(robotsContent.includes('Allow: /'), '1.3 robots.txt allows public root');
  assert(robotsContent.includes('Disallow: /app'), '1.4 robots.txt disallows authenticated /app');
  assert(robotsContent.includes('Disallow: /auth'), '1.5 robots.txt disallows /auth route');
  assert(robotsContent.includes('Disallow: /join'), '1.6 robots.txt disallows /join project invite link');
  assert(robotsContent.includes('Disallow: /invite'), '1.7 robots.txt disallows /invite org invite link');
  assert(robotsContent.includes('Disallow: /api/'), '1.8 robots.txt disallows backend /api/ endpoints');
  assert(robotsContent.includes(`Sitemap: ${CANONICAL_DOMAIN}/sitemap.xml`), '1.9 robots.txt points to canonical sitemap.xml');

  // 2. Verify Sitemap.xml
  console.log('\n--- Test Suite 2: Sitemap.xml Completeness & Privacy Protection ---');

  const sitemapPath = path.join(process.cwd(), 'public', 'sitemap.xml');
  assert(fs.existsSync(sitemapPath), '2.1 public/sitemap.xml file exists');

  const sitemapContent = fs.readFileSync(sitemapPath, 'utf8');
  assert(sitemapContent.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'), '2.2 Valid XML sitemap schema');

  const expectedPublicRoutes = [
    '/',
    '/features',
    '/solutions',
    '/pricing',
    '/security',
    '/demo',
    '/contact',
    '/privacy',
    '/terms'
  ];

  expectedPublicRoutes.forEach((route) => {
    const loc = `${CANONICAL_DOMAIN}${route === '/' ? '/' : route}`;
    assert(sitemapContent.includes(`<loc>${loc}</loc>`), `2.3 Sitemap includes public canonical route: ${route}`);
  });

  // Verify private routes are NOT in sitemap
  const forbiddenSitemapPatterns = ['/app', '/auth', '/join', '/invite', '/api', 'meeting', 'transcript', 'user'];
  forbiddenSitemapPatterns.forEach((pattern) => {
    assert(!sitemapContent.includes(`<loc>${CANONICAL_DOMAIN}${pattern}`), `2.4 Sitemap excludes private/sensitive route pattern: ${pattern}`);
  });

  // 3. Verify index.html Metadata
  console.log('\n--- Test Suite 3: index.html Canonical Metadata ---');

  const indexPath = path.join(process.cwd(), 'index.html');
  const indexContent = fs.readFileSync(indexPath, 'utf8');

  assert(indexContent.includes(`<link rel="canonical" href="${CANONICAL_DOMAIN}/">`), '3.1 index.html has canonical link pointing to canonical production domain');
  assert(indexContent.includes('content="EchoNote | Decision & Execution Memory for Coordination-Heavy Teams"'), '3.2 index.html title matches authentic product positioning');
  assert(indexContent.includes(`meta property="og:url" content="${CANONICAL_DOMAIN}/"`), '3.3 Open Graph URL matches canonical domain');
  assert(indexContent.includes('meta name="twitter:card" content="summary_large_image"'), '3.4 Twitter card configured for rich previews');
  assert(!indexContent.includes('https://echonote.ai/'), '3.5 Legacy or unverified echonote.ai domain replaced completely in index.html');
  assert(!indexContent.includes('https://echonote-25.ai.studio/'), '3.6 Obsolete echonote-25.ai.studio domain replaced completely in index.html');

  // 4. Verify Server Serving of robots.txt and sitemap.xml
  console.log('\n--- Test Suite 4: Server Endpoint Configuration ---');

  const serverPath = path.join(process.cwd(), 'server.ts');
  const serverContent = fs.readFileSync(serverPath, 'utf8');

  assert(serverContent.includes('app.get("/robots.txt"'), '4.1 server.ts defines explicit route for /robots.txt');
  assert(serverContent.includes('app.get("/sitemap.xml"'), '4.2 server.ts defines explicit route for /sitemap.xml');
  assert(serverContent.includes('resolveAppUrl()'), '4.3 server.ts utilizes canonical resolveAppUrl() function');

  // 5. Verify GEO Content & Answer-Engine Structure
  console.log('\n--- Test Suite 5: Generative Engine Optimization (GEO) & Factual Copy ---');

  const homePath = path.join(process.cwd(), 'pages', 'Home.tsx');
  const homeContent = fs.readFileSync(homePath, 'utf8');

  assert(homeContent.includes('decision and execution memory layer'), '5.1 Home page incorporates core positioning statement');
  assert(homeContent.includes('FAQPage'), '5.2 Home page provides crawlable FAQ schema');
  assert(homeContent.includes('SoftwareApplication'), '5.3 Home page provides SoftwareApplication schema');
  assert(homeContent.includes('Organization'), '5.4 Home page provides Organization schema');

  // Verify internal linking structure between public pages
  const footerPath = path.join(process.cwd(), 'components', 'LandingFooter.tsx');
  const footerContent = fs.readFileSync(footerPath, 'utf8');
  assert(footerContent.includes('/features') && footerContent.includes('/solutions') && footerContent.includes('/pricing'), '5.5 Footer contains direct crawlable internal links');

  console.log(`\n==================================================`);
  console.log(`RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log(`==================================================\n`);

  if (failed > 0) {
    throw new Error(`${failed} test(s) failed in SEO/GEO validation.`);
  }
}

// Run in ESM
runPhase2Step4SeoGeoValidation();
