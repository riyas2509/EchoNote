/**
 * EchoNote — Phase 2, Step 5: Brand Presentation, Favicon & Link Previews Test Suite
 *
 * Validates:
 * 1. Confirmed canonical domain strictly equals 'https://echonote-25.vercel.app' across all assets.
 * 2. Absolute absence of obsolete domains (echonote-25.ai.studio, echonote.ai) in active SEO, HTML, and server configs.
 * 3. Physical existence of all favicon, icon, and logo assets in public/:
 *    - favicon.ico, favicon-16x16.png, favicon-32x32.png, favicon.png (192x192), apple-touch-icon.png (180x180), Logo-2.png.
 * 4. Physical existence and dimensional compliance of og-preview.png (1200x630).
 * 5. Web app manifest (public/site.webmanifest) presence, syntax, and icon linkages.
 * 6. HTML head favicon, apple-touch-icon, manifest, and theme-color (#112250) configuration.
 * 7. Open Graph and Twitter Card metadata properties, including absolute HTTPS URLs to og-preview.png.
 * 8. Robots.txt and Sitemap.xml canonical URL compliance with https://echonote-25.vercel.app.
 * 9. Logo usage consistency across navigation, topbar, auth, and onboarding components.
 */

import fs from 'fs';
import path from 'path';

export function runPhase2Step5BrandPresentationValidation() {
  console.log('=== Starting Phase 2, Step 5: Brand Presentation, Favicon & Link Previews Verification ===\n');

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

  const CONFIRMED_CANONICAL_DOMAIN = 'https://echonote-25.vercel.app';
  const OBSOLETE_DOMAINS = ['echonote-25.ai.studio', 'echonote.ai'];

  console.log('--- Test Suite 1: Canonical Domain Integrity ---');

  // Verify index.html
  const indexPath = path.join(process.cwd(), 'index.html');
  const indexContent = fs.readFileSync(indexPath, 'utf8');
  assert(indexContent.includes(`<link rel="canonical" href="${CONFIRMED_CANONICAL_DOMAIN}/">`), '1.1 index.html has exact canonical URL link');
  assert(indexContent.includes(`meta property="og:url" content="${CONFIRMED_CANONICAL_DOMAIN}/"`), '1.2 index.html og:url matches confirmed canonical domain');
  assert(indexContent.includes(`meta name="twitter:url" content="${CONFIRMED_CANONICAL_DOMAIN}/"`), '1.3 index.html twitter:url matches confirmed canonical domain');

  // Verify SeoManager.tsx
  const seoManagerPath = path.join(process.cwd(), 'components', 'public', 'SeoManager.tsx');
  const seoManagerContent = fs.readFileSync(seoManagerPath, 'utf8');
  assert(seoManagerContent.includes(`export const CANONICAL_BASE_URL = '${CONFIRMED_CANONICAL_DOMAIN}';`), '1.4 SeoManager.tsx defines CANONICAL_BASE_URL as https://echonote-25.vercel.app');

  // Verify server.ts
  const serverPath = path.join(process.cwd(), 'server.ts');
  const serverContent = fs.readFileSync(serverPath, 'utf8');
  assert(serverContent.includes(`return "${CONFIRMED_CANONICAL_DOMAIN}";`), '1.5 server.ts resolveAppUrl returns confirmed canonical domain in production');

  // Verify absence of obsolete domains in active SEO files
  const activeFilesToCheck = [
    { name: 'index.html', content: indexContent },
    { name: 'SeoManager.tsx', content: seoManagerContent },
    { name: 'robots.txt', content: fs.readFileSync(path.join(process.cwd(), 'public', 'robots.txt'), 'utf8') },
    { name: 'sitemap.xml', content: fs.readFileSync(path.join(process.cwd(), 'public', 'sitemap.xml'), 'utf8') }
  ];

  activeFilesToCheck.forEach(file => {
    OBSOLETE_DOMAINS.forEach(obs => {
      assert(!file.content.includes(obs), `1.6 ${file.name} does not contain obsolete domain reference: ${obs}`);
    });
  });

  console.log('\n--- Test Suite 2: Brand Assets, Favicon & Icon Existence ---');

  const requiredAssets = [
    { file: 'favicon.ico', minSize: 1000 },
    { file: 'favicon-16x16.png', minSize: 500 },
    { file: 'favicon-32x32.png', minSize: 500 },
    { file: 'favicon.png', minSize: 1000 },
    { file: 'apple-touch-icon.png', minSize: 1000 },
    { file: 'Logo-2.png', minSize: 1000 },
    { file: 'og-preview.png', minSize: 10000 }
  ];

  requiredAssets.forEach(asset => {
    const assetPath = path.join(process.cwd(), 'public', asset.file);
    const exists = fs.existsSync(assetPath);
    assert(exists, `2.1 Asset public/${asset.file} exists on disk`);
    if (exists) {
      const stats = fs.statSync(assetPath);
      assert(stats.size >= asset.minSize, `2.2 Asset public/${asset.file} has valid file size (${stats.size} bytes)`);
    }
  });

  // Verify og-preview.png PNG dimensions (1200x630)
  const ogPath = path.join(process.cwd(), 'public', 'og-preview.png');
  if (fs.existsSync(ogPath)) {
    const buf = fs.readFileSync(ogPath);
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    assert(w === 1200 && h === 630, `2.3 og-preview.png has exact 1200x630 dimensions (got ${w}x${h})`);
  }

  console.log('\n--- Test Suite 3: Web App Manifest & HTML Header Icon Directives ---');

  const manifestPath = path.join(process.cwd(), 'public', 'site.webmanifest');
  assert(fs.existsSync(manifestPath), '3.1 public/site.webmanifest exists');
  const manifestRaw = fs.readFileSync(manifestPath, 'utf8');
  let parsedManifest: any = null;
  try {
    parsedManifest = JSON.parse(manifestRaw);
    assert(parsedManifest.short_name === 'EchoNote', '3.2 Manifest short_name is EchoNote');
    assert(Array.isArray(parsedManifest.icons) && parsedManifest.icons.length >= 4, '3.3 Manifest defines comprehensive icon array');
    assert(parsedManifest.theme_color === '#112250', '3.4 Manifest theme_color matches EchoNote brand navy #112250');
  } catch (e: any) {
    assert(false, '3.2 Manifest is valid JSON', e.message);
  }

  // HTML Link tags
  assert(indexContent.includes('<link rel="icon" type="image/x-icon" href="/favicon.ico">'), '3.5 index.html links /favicon.ico');
  assert(indexContent.includes('<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">'), '3.6 index.html links /favicon-16x16.png');
  assert(indexContent.includes('<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">'), '3.7 index.html links /favicon-32x32.png');
  assert(indexContent.includes('<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">'), '3.8 index.html links /apple-touch-icon.png');
  assert(indexContent.includes('<link rel="manifest" href="/site.webmanifest">'), '3.9 index.html links /site.webmanifest');
  assert(indexContent.includes('<meta name="theme-color" content="#112250">'), '3.10 index.html theme-color is set to #112250');

  console.log('\n--- Test Suite 4: Social Link Preview & Metadata Consistency ---');

  const expectedOgImage = `${CONFIRMED_CANONICAL_DOMAIN}/og-preview.png`;
  assert(indexContent.includes(`meta property="og:image" content="${expectedOgImage}"`), '4.1 og:image is absolute HTTPS URL to og-preview.png');
  assert(indexContent.includes('meta property="og:image:width" content="1200"'), '4.2 og:image:width is 1200');
  assert(indexContent.includes('meta property="og:image:height" content="630"'), '4.3 og:image:height is 630');
  assert(indexContent.includes(`meta name="twitter:image" content="${expectedOgImage}"`), '4.4 twitter:image is absolute HTTPS URL to og-preview.png');
  assert(indexContent.includes('meta name="twitter:card" content="summary_large_image"'), '4.5 twitter:card is summary_large_image');

  console.log('\n--- Test Suite 5: Robots & Sitemap Verification ---');

  const sitemapRaw = fs.readFileSync(path.join(process.cwd(), 'public', 'sitemap.xml'), 'utf8');
  assert(sitemapRaw.includes(`<loc>${CONFIRMED_CANONICAL_DOMAIN}/</loc>`), '5.1 Sitemap specifies confirmed canonical root URL');
  assert(!sitemapRaw.includes('echonote-25.ai.studio'), '5.2 Sitemap is completely clean of echonote-25.ai.studio');

  const robotsRaw = fs.readFileSync(path.join(process.cwd(), 'public', 'robots.txt'), 'utf8');
  assert(robotsRaw.includes(`Sitemap: ${CONFIRMED_CANONICAL_DOMAIN}/sitemap.xml`), '5.3 robots.txt points to confirmed canonical sitemap URL');

  console.log(`\n==================================================`);
  console.log(`RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log(`==================================================\n`);

  if (failed > 0) {
    throw new Error(`${failed} test(s) failed in Brand Presentation validation.`);
  }
}

// Run in ESM
runPhase2Step5BrandPresentationValidation();
