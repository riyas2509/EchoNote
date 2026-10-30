/**
 * Step 3 Focused Regression Test: REPORT_DOWNLOAD_SECRET Deployment & Declarative Coverage
 *
 * Verifies that REPORT_DOWNLOAD_SECRET is consistently configured across all supported
 * Cloud Run deployment paths and cannot be omitted from the declarative manifest:
 * 1. scripts/prepare-declarative-service.ts (SECRET_MAPPINGS & Knative transform output)
 * 2. scripts/deploy-cloud-run.sh (constant declaration & CLOUD_RUN_SECRETS export)
 * 3. deploy-cloud-run-B1A.sh (constant declaration & CLOUD_RUN_SECRETS export)
 * 4. scripts/migrate-cloud-run-declarative.sh (SECRET_MAPPINGS array)
 * 5. lib/recurringReportDeliveryService.ts (fail-closed runtime validation)
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
import {
  transformServiceManifest,
  SECRET_MAPPINGS,
} from '../scripts/prepare-declarative-service.js';
import {
  getReportDownloadSecret,
  generateReportDownloadToken,
  verifyReportDownloadToken,
} from '../lib/recurringReportDeliveryService.js';

console.log('======================================================================');
console.log('🧪 RUNNING REPORT_DOWNLOAD_SECRET DEPLOYMENT COVERAGE REGRESSION TESTS');
console.log('======================================================================');

let testCount = 0;
let passCount = 0;

function runTest(description: string, fn: () => void) {
  testCount++;
  try {
    fn();
    console.log(`  ✅ [${testCount}] ${description} ... PASSED`);
    passCount++;
  } catch (err: any) {
    console.error(`  ❌ [${testCount}] ${description} ... FAILED`);
    console.error(`     Error: ${err?.message || err}`);
    process.exit(1);
  }
}

const SAMPLE_SERVICE_YAML = `
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: echonote
  namespace: echonote-2509
spec:
  template:
    metadata:
      name: echonote-00009-w5m
    spec:
      serviceAccountName: 200551109142-compute@developer.gserviceaccount.com
      containers:
      - image: us-west1-docker.pkg.dev/echonote-2509/echonote/echonote@sha256:ca1549df6662f01d7c489ed8ebdc536b0044c51ee55aa4d314e5522a9cd8820c
        ports:
        - containerPort: 3000
        env:
        - name: NODE_ENV
          value: production
`;

const EXPECTED_ALL_SECRETS = [
  { name: 'GEMINI_API_KEY', secretName: 'echonote-gemini-api-key', secretKey: 'latest' },
  { name: 'RAZORPAY_KEY_SECRET', secretName: 'echonote-razorpay-key-secret', secretKey: 'latest' },
  { name: 'RAZORPAY_WEBHOOK_SECRET', secretName: 'echonote-razorpay-webhook-secret', secretKey: 'latest' },
  { name: 'RESEND_API_KEY', secretName: 'echonote-resend-api-key', secretKey: 'latest' },
  { name: 'PLAYBACK_SECRET', secretName: 'echonote-playback-secret', secretKey: 'latest' },
  { name: 'CRON_SECRET', secretName: 'echonote-cron-secret', secretKey: 'latest' },
  { name: 'INTEGRATION_ENCRYPTION_KEY', secretName: 'echonote-integration-encryption-key', secretKey: 'latest' },
  { name: 'ZOOM_WEBHOOK_SECRET', secretName: 'echonote-zoom-webhook-secret', secretKey: 'latest' },
  { name: 'REPORT_DOWNLOAD_SECRET', secretName: 'echonote-report-download-secret', secretKey: 'latest' },
];

// Test 1: SECRET_MAPPINGS includes REPORT_DOWNLOAD_SECRET
runTest('prepare-declarative-service.ts: SECRET_MAPPINGS includes REPORT_DOWNLOAD_SECRET', () => {
  const mapping = SECRET_MAPPINGS.find(m => m.name === 'REPORT_DOWNLOAD_SECRET');
  assert.ok(mapping, 'REPORT_DOWNLOAD_SECRET must be in SECRET_MAPPINGS');
  assert.strictEqual(mapping.secretName, 'echonote-report-download-secret');
  assert.strictEqual(mapping.secretKey, 'latest');
});

// Test 2: Exactly 9 secrets configured in SECRET_MAPPINGS with all expected entries
runTest('prepare-declarative-service.ts: Exactly 9 secrets configured without omission or alteration', () => {
  assert.strictEqual(SECRET_MAPPINGS.length, 9, 'Must have exactly 9 secrets');
  for (const expected of EXPECTED_ALL_SECRETS) {
    const found = SECRET_MAPPINGS.find(m => m.name === expected.name);
    assert.ok(found, `Expected secret ${expected.name} not found in SECRET_MAPPINGS`);
    assert.strictEqual(found.secretName, expected.secretName);
    assert.strictEqual(found.secretKey, expected.secretKey);
  }
});

// Test 3: transformServiceManifest includes REPORT_DOWNLOAD_SECRET secretKeyRef
runTest('prepare-declarative-service.ts: transformServiceManifest generates valid secretKeyRef for REPORT_DOWNLOAD_SECRET', () => {
  const result = transformServiceManifest({
    inputYamlContent: SAMPLE_SERVICE_YAML,
    imageDigest: 'sha256:ca1549df6662f01d7c489ed8ebdc536b0044c51ee55aa4d314e5522a9cd8820c',
    ordinaryEnvOverrides: { RAZORPAY_KEY_ID: 'rzp_live_testdummykey123' },
  });

  assert.strictEqual(result.secretVarCount, 9);
  const parsed = YAML.parse(result.yaml);
  const envList: any[] = parsed.spec.template.spec.containers[0].env;

  const rdsEntry = envList.find(e => e.name === 'REPORT_DOWNLOAD_SECRET');
  assert.ok(rdsEntry, 'Transformed manifest container env must contain REPORT_DOWNLOAD_SECRET');
  assert.strictEqual(rdsEntry.value, undefined, 'Must not have a literal value');
  assert.ok(rdsEntry.valueFrom?.secretKeyRef, 'Must have valueFrom.secretKeyRef');
  assert.strictEqual(rdsEntry.valueFrom.secretKeyRef.name, 'echonote-report-download-secret');
  assert.strictEqual(rdsEntry.valueFrom.secretKeyRef.key, 'latest');
});

// Test 4: scripts/deploy-cloud-run.sh defines SECRET_REPORT_DOWNLOAD_SECRET and includes in CLOUD_RUN_SECRETS
runTest('scripts/deploy-cloud-run.sh: Defines SECRET_REPORT_DOWNLOAD_SECRET and includes in CLOUD_RUN_SECRETS', () => {
  const filePath = path.resolve(REPO_ROOT, 'scripts/deploy-cloud-run.sh');
  const content = fs.readFileSync(filePath, 'utf8');

  assert.ok(
    content.includes('readonly SECRET_REPORT_DOWNLOAD_SECRET="REPORT_DOWNLOAD_SECRET=echonote-report-download-secret:latest"'),
    'scripts/deploy-cloud-run.sh must declare SECRET_REPORT_DOWNLOAD_SECRET',
  );
  assert.ok(
    content.includes('${SECRET_REPORT_DOWNLOAD_SECRET}'),
    'scripts/deploy-cloud-run.sh must include ${SECRET_REPORT_DOWNLOAD_SECRET} in CLOUD_RUN_SECRETS',
  );
  // Also verify all 8 other secrets are referenced
  assert.ok(content.includes('${SECRET_GEMINI_API_KEY}'));
  assert.ok(content.includes('${SECRET_RAZORPAY_KEY_SECRET}'));
  assert.ok(content.includes('${SECRET_RAZORPAY_WEBHOOK_SECRET}'));
  assert.ok(content.includes('${SECRET_RESEND_API_KEY}'));
  assert.ok(content.includes('${SECRET_PLAYBACK_SECRET}'));
  assert.ok(content.includes('${SECRET_CRON_SECRET}'));
  assert.ok(content.includes('${SECRET_INTEGRATION_ENCRYPTION_KEY}'));
  assert.ok(content.includes('${SECRET_ZOOM_WEBHOOK_SECRET}'));
});

// Test 5: deploy-cloud-run-B1A.sh defines SECRET_REPORT_DOWNLOAD_SECRET and includes in CLOUD_RUN_SECRETS
runTest('deploy-cloud-run-B1A.sh: Defines SECRET_REPORT_DOWNLOAD_SECRET and includes in CLOUD_RUN_SECRETS', () => {
  const filePath = path.resolve(REPO_ROOT, 'deploy-cloud-run-B1A.sh');
  const content = fs.readFileSync(filePath, 'utf8');

  assert.ok(
    content.includes('readonly SECRET_REPORT_DOWNLOAD_SECRET="REPORT_DOWNLOAD_SECRET=echonote-report-download-secret:latest"'),
    'deploy-cloud-run-B1A.sh must declare SECRET_REPORT_DOWNLOAD_SECRET',
  );
  assert.ok(
    content.includes('${SECRET_REPORT_DOWNLOAD_SECRET}'),
    'deploy-cloud-run-B1A.sh must include ${SECRET_REPORT_DOWNLOAD_SECRET} in CLOUD_RUN_SECRETS',
  );
});

// Test 6: scripts/migrate-cloud-run-declarative.sh includes REPORT_DOWNLOAD_SECRET in SECRET_MAPPINGS
runTest('scripts/migrate-cloud-run-declarative.sh: Includes REPORT_DOWNLOAD_SECRET in SECRET_MAPPINGS', () => {
  const filePath = path.resolve(REPO_ROOT, 'scripts/migrate-cloud-run-declarative.sh');
  const content = fs.readFileSync(filePath, 'utf8');

  assert.ok(
    content.includes('"REPORT_DOWNLOAD_SECRET=echonote-report-download-secret:latest"'),
    'scripts/migrate-cloud-run-declarative.sh must include REPORT_DOWNLOAD_SECRET in SECRET_MAPPINGS',
  );
  assert.ok(
    content.includes('Secret Manager Mappings (9 production secrets)'),
    'scripts/migrate-cloud-run-declarative.sh comments must reflect 9 secrets',
  );
});

// Test 7: Fail-closed runtime validation ensures secret must exist and meet strength criteria
runTest('lib/recurringReportDeliveryService.ts: Fail-closed runtime validation strictly enforced', () => {
  const origSecret = process.env.REPORT_DOWNLOAD_SECRET;
  try {
    // Missing
    delete process.env.REPORT_DOWNLOAD_SECRET;
    assert.throws(
      () => getReportDownloadSecret(),
      /CONFIG_ERROR: REPORT_DOWNLOAD_SECRET is not configured/,
    );

    // Whitespace only
    process.env.REPORT_DOWNLOAD_SECRET = '                                ';
    assert.throws(
      () => getReportDownloadSecret(),
      /CONFIG_ERROR: REPORT_DOWNLOAD_SECRET cannot be empty or whitespace-only/,
    );

    // Too short (< 32 chars)
    process.env.REPORT_DOWNLOAD_SECRET = 'short_secret_25_characters';
    assert.throws(
      () => getReportDownloadSecret(),
      /CONFIG_ERROR: REPORT_DOWNLOAD_SECRET must be at least 32 characters long/,
    );

    // Valid 32-char
    const validSecret = 'test_report_download_secret_32_chars_12345';
    process.env.REPORT_DOWNLOAD_SECRET = validSecret;
    assert.strictEqual(getReportDownloadSecret(), validSecret);

    const token = generateReportDownloadToken({
      email: 'test@echotechai.in',
      projectId: 'proj_test',
      artifactId: 'art_test',
      occurrenceId: 'occ_test',
    });
    const verified = verifyReportDownloadToken(token);
    assert.strictEqual(verified.valid, true);
    assert.strictEqual(verified.claims?.email, 'test@echotechai.in');
    assert.strictEqual(verified.claims?.projectId, 'proj_test');
  } finally {
    if (origSecret !== undefined) {
      process.env.REPORT_DOWNLOAD_SECRET = origSecret;
    } else {
      delete process.env.REPORT_DOWNLOAD_SECRET;
    }
  }
});

console.log('======================================================================');
console.log(`🎉 ALL ${passCount}/${testCount} REPORT_DOWNLOAD_SECRET DEPLOYMENT TESTS PASSED!`);
console.log('======================================================================');
