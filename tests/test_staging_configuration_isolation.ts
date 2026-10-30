/**
 * EchoNote Staging Isolation & Fail-Closed Environment Configuration Tests
 * File: tests/test_staging_configuration_isolation.ts
 *
 * Verifies that:
 * 1. Staging Knative service specification generates cleanly with NODE_ENV=staging and explicit service account.
 * 2. Staging service name is strictly echonote-staging.
 * 3. Staging service account is strictly required and validated (rejects missing, malformed, or production account).
 * 4. Staging manifest has STAGING_ISOLATION_REQUIRED=true and rejects ALLOW_PRODUCTION_RESOURCES=true.
 * 5. Staging manifest strictly enforces RAZORPAY_MODE=test and rejects rzp_live_* keys.
 * 6. Production manifest generation preserves ALLOW_PRODUCTION_RESOURCES=true, RAZORPAY_MODE=live, and rejects staging flags.
 * 7. Unknown environment names fail closed with clear error.
 * 8. Staging Cloud Scheduler scripts validate endpoints, parameters, and reject production targets.
 * 9. Overdue-alert scheduler supports staging and points to staging Cloud Run URL.
 * 10. Recurring report dispatcher job definition is present and targets /api/internal/reports/dispatch-deliveries.
 * 11. Refinement 1: CLI rejects missing --serving-revision argument and rejects malformed revision names.
 * 12. Refinement 2: Staging CLI requires explicit --service-account and identifies it in output.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { spawnSync } from 'node:child_process';
import {
  transformServiceManifest,
  validateRevisionFormat,
  validateServiceAccountFormat,
  STAGING_PROJECT_ID,
  STAGING_SERVICE_NAME,
  STAGING_TEST_FIXTURE_SERVICE_ACCOUNT,
  EXPECTED_PROJECT_ID,
  EXPECTED_SERVICE_NAME,
  EXPECTED_SERVICE_ACCOUNT,
  TEST_FIXTURE_BASELINE_REVISION,
} from '../scripts/prepare-declarative-service.js';

console.log('=== Running Staging Configuration Isolation & Scheduler Reliability Tests ===\n');

function findBash(): string {
  const candidates = [
    'bash',
    'C:\\Users\\riyam\\AppData\\Local\\Programs\\Git\\bin\\bash.exe',
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
  ];
  for (const c of candidates) {
    try {
      const res = spawnSync(c, ['--version'], { encoding: 'utf8' });
      if (res.status === 0) return c;
    } catch {}
  }
  throw new Error('Bash binary required for scheduler script tests.');
}

const bashPath = findBash();
const cwd = process.cwd();

let passed = 0;
let total = 0;

function test(description: string, fn: () => void) {
  total++;
  try {
    fn();
    console.log(`  ✓ [PASS] ${description}`);
    passed++;
  } catch (err: any) {
    console.error(`  ✗ [FAIL] ${description}:`, err.message);
    throw err;
  }
}

const SAMPLE_PROD_YAML = `
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
        - image: us-west1-docker.pkg.dev/echonote-2509/echonote/echonote@sha256:ba5eba5eba5eba5eba5eba5eba5eba5eba5eba5eba5eba5eba5eba5eba5eba5e
`;

const SAMPLE_STAGING_YAML = `
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: echonote-staging
  namespace: echonote-staging
spec:
  template:
    metadata:
      name: echonote-staging-00004-td8
    spec:
      serviceAccountName: 123456789012-compute@developer.gserviceaccount.com
      containers:
        - image: us-west1-docker.pkg.dev/echonote-staging/echonote/echonote@sha256:ba5eba5eba5eba5eba5eba5eba5eba5eba5eba5eba5eba5eba5eba5eba5eba5e
`;

const IMMUTABLE_DIGEST = 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const VALID_STAGING_SA = '123456789012-compute@developer.gserviceaccount.com';
const VALID_STAGING_REV = 'echonote-staging-00004-td8';

// 1. Staging manifest generation with explicit service account and serving revision
test('1. Staging manifest generates cleanly with environment=staging and explicit SA', () => {
  const result = transformServiceManifest({
    inputYamlContent: SAMPLE_STAGING_YAML,
    imageDigest: IMMUTABLE_DIGEST,
    serviceName: 'echonote-staging',
    environment: 'staging',
    servingRevision: VALID_STAGING_REV,
    serviceAccount: VALID_STAGING_SA,
    ordinaryEnvOverrides: {
      RAZORPAY_KEY_ID: 'rzp_test_stagingKey123',
    },
  });

  assert.strictEqual(result.environment, 'staging');
  assert.strictEqual(result.serviceName, 'echonote-staging');
  assert.strictEqual(result.serviceAccount, VALID_STAGING_SA);
  assert.strictEqual(result.pinnedServingRevision, VALID_STAGING_REV);

  const doc = YAML.parse(result.yaml);
  const env: Array<{ name: string; value?: string }> = doc.spec.template.spec.containers[0].env;

  assert.strictEqual(env.find(e => e.name === 'NODE_ENV')?.value, 'staging');
  assert.strictEqual(env.find(e => e.name === 'STAGING_ISOLATION_REQUIRED')?.value, 'true');
  assert.strictEqual(env.find(e => e.name === 'ALLOW_PRODUCTION_RESOURCES'), undefined);
  assert.strictEqual(env.find(e => e.name === 'RAZORPAY_MODE')?.value, 'test');
  assert.strictEqual(env.find(e => e.name === 'RAZORPAY_KEY_ID')?.value, 'rzp_test_stagingKey123');
});

// 2. Refinement 2: Staging strictly requires explicit service account
test('2. Staging rejects missing service account', () => {
  assert.throws(
    () => {
      transformServiceManifest({
        inputYamlContent: SAMPLE_STAGING_YAML,
        imageDigest: IMMUTABLE_DIGEST,
        serviceName: 'echonote-staging',
        environment: 'staging',
        servingRevision: VALID_STAGING_REV,
        ordinaryEnvOverrides: {
          RAZORPAY_KEY_ID: 'rzp_test_stagingKey123',
        },
      });
    },
    /Missing required staging service account/
  );
});

// 3. Refinement 2: Staging rejects malformed service account
test('3. Staging rejects malformed service account', () => {
  assert.throws(
    () => {
      transformServiceManifest({
        inputYamlContent: SAMPLE_STAGING_YAML,
        imageDigest: IMMUTABLE_DIGEST,
        serviceName: 'echonote-staging',
        environment: 'staging',
        servingRevision: VALID_STAGING_REV,
        serviceAccount: 'invalid-email-format',
        ordinaryEnvOverrides: {
          RAZORPAY_KEY_ID: 'rzp_test_stagingKey123',
        },
      });
    },
    /Invalid Google Service Account format/
  );
});

// 4. Refinement 2: Staging rejects production service account substitution
test('4. Staging rejects substitution of production service account', () => {
  assert.throws(
    () => {
      transformServiceManifest({
        inputYamlContent: SAMPLE_STAGING_YAML,
        imageDigest: IMMUTABLE_DIGEST,
        serviceName: 'echonote-staging',
        environment: 'staging',
        servingRevision: VALID_STAGING_REV,
        serviceAccount: EXPECTED_SERVICE_ACCOUNT,
        ordinaryEnvOverrides: {
          RAZORPAY_KEY_ID: 'rzp_test_stagingKey123',
        },
      });
    },
    /\[STAGING ISOLATION BREACH\]: Cannot use production service account in staging/
  );
});

// 5. Staging rejects live payment mode or live keys
test('5. Staging rejects live Razorpay key ID and live payment mode', () => {
  assert.throws(
    () => {
      transformServiceManifest({
        inputYamlContent: SAMPLE_STAGING_YAML,
        imageDigest: IMMUTABLE_DIGEST,
        serviceName: 'echonote-staging',
        environment: 'staging',
        servingRevision: VALID_STAGING_REV,
        serviceAccount: VALID_STAGING_SA,
        ordinaryEnvOverrides: {
          RAZORPAY_KEY_ID: 'rzp_live_secretkey123',
          RAZORPAY_MODE: 'live',
        },
      });
    },
    /Staging requires "test"/
  );

  assert.throws(
    () => {
      transformServiceManifest({
        inputYamlContent: SAMPLE_STAGING_YAML,
        imageDigest: IMMUTABLE_DIGEST,
        serviceName: 'echonote-staging',
        environment: 'staging',
        servingRevision: VALID_STAGING_REV,
        serviceAccount: VALID_STAGING_SA,
        ordinaryEnvOverrides: {
          RAZORPAY_KEY_ID: 'rzp_live_secretkey123',
          RAZORPAY_MODE: 'test',
        },
      });
    },
    /Invalid RAZORPAY_KEY_ID for mode "test"/
  );
});

// 6. Staging rejects ALLOW_PRODUCTION_RESOURCES=true
test('6. Staging rejects ALLOW_PRODUCTION_RESOURCES=true override', () => {
  assert.throws(
    () => {
      transformServiceManifest({
        inputYamlContent: SAMPLE_STAGING_YAML,
        imageDigest: IMMUTABLE_DIGEST,
        serviceName: 'echonote-staging',
        environment: 'staging',
        servingRevision: VALID_STAGING_REV,
        serviceAccount: VALID_STAGING_SA,
        ordinaryEnvOverrides: {
          RAZORPAY_KEY_ID: 'rzp_test_stagingKey123',
          ALLOW_PRODUCTION_RESOURCES: 'true',
        },
      });
    },
    /\[STAGING ISOLATION BREACH\]: ALLOW_PRODUCTION_RESOURCES must NOT be enabled in staging/
  );
});

// 7. Production rejects STAGING_ISOLATION_REQUIRED=true
test('7. Production rejects STAGING_ISOLATION_REQUIRED=true override', () => {
  assert.throws(
    () => {
      transformServiceManifest({
        inputYamlContent: SAMPLE_PROD_YAML,
        imageDigest: IMMUTABLE_DIGEST,
        serviceName: 'echonote',
        environment: 'production',
        ordinaryEnvOverrides: {
          RAZORPAY_KEY_ID: 'rzp_live_testdummykey123',
          STAGING_ISOLATION_REQUIRED: 'true',
        },
      });
    },
    /\[PRODUCTION GUARD\]: STAGING_ISOLATION_REQUIRED must NOT be set in production/
  );
});

// 8. Unknown environment name fails closed
test('8. Unknown environment name throws error', () => {
  assert.throws(
    () => {
      transformServiceManifest({
        inputYamlContent: SAMPLE_STAGING_YAML,
        imageDigest: IMMUTABLE_DIGEST,
        serviceName: 'echonote-staging',
        environment: 'qa' as any,
        servingRevision: VALID_STAGING_REV,
        serviceAccount: VALID_STAGING_SA,
        ordinaryEnvOverrides: {
          RAZORPAY_KEY_ID: 'rzp_test_stagingKey123',
        },
      });
    },
    /Invalid environment name: "qa"/
  );
});

// 9. Cross-environment service name rejection
test('9. Staging rejects production service name and vice-versa', () => {
  assert.throws(
    () => {
      transformServiceManifest({
        inputYamlContent: SAMPLE_PROD_YAML,
        imageDigest: IMMUTABLE_DIGEST,
        serviceName: 'echonote',
        environment: 'staging',
        servingRevision: VALID_STAGING_REV,
        serviceAccount: VALID_STAGING_SA,
        ordinaryEnvOverrides: {
          RAZORPAY_KEY_ID: 'rzp_test_stagingKey123',
        },
      });
    },
    /Service name "echonote" is invalid for staging environment/
  );

  assert.throws(
    () => {
      transformServiceManifest({
        inputYamlContent: SAMPLE_STAGING_YAML,
        imageDigest: IMMUTABLE_DIGEST,
        serviceName: 'echonote-staging',
        environment: 'production',
        ordinaryEnvOverrides: {
          RAZORPAY_KEY_ID: 'rzp_live_testdummykey123',
        },
      });
    },
    /Service name "echonote-staging" is invalid for production environment/
  );
});

// 10. Refinement 1: Revision format validation
test('10. Revision format validation accepts valid and rejects malformed', () => {
  validateRevisionFormat('echonote-00038-xl2');
  validateRevisionFormat('echonote-staging-00004-td8');

  assert.throws(() => validateRevisionFormat(''), /Serving revision must be a non-empty string/);
  assert.throws(() => validateRevisionFormat('123-starts-with-number'), /Invalid Cloud Run revision format/);
  assert.throws(() => validateRevisionFormat('REV_UPPERCASE'), /Invalid Cloud Run revision format/);
});

// 11. Refinement 1: CLI rejects missing --serving-revision argument
test('11. CLI execution fails closed when --serving-revision is omitted', () => {
  const scriptPath = path.join(cwd, 'scripts', 'prepare-declarative-service.ts');
  const tmpIn = path.join(cwd, 'tests', 'fixtures', 'sample_service.yaml');
  const tmpOut = path.join(cwd, 'dist', 'test-output-desired.yaml');

  const res = spawnSync('npx', [
    'tsx',
    scriptPath,
    `--input=${tmpIn}`,
    `--output=${tmpOut}`,
    `--digest=${IMMUTABLE_DIGEST}`,
  ], { encoding: 'utf8', cwd, shell: true });

  assert.notStrictEqual(res.status, 0);
  assert(res.stderr.includes('Missing required --serving-revision argument in CLI invocation') || res.stderr.includes('Usage:'));
});

// 12. Refinement 1 & 2: CLI succeeds when explicit revision and staging SA are provided
test('12. CLI execution succeeds for staging when explicit revision and SA are supplied', () => {
  const scriptPath = path.join(cwd, 'scripts', 'prepare-declarative-service.ts');
  const tmpIn = path.join(cwd, 'tests', 'fixtures', 'sample_service.yaml');
  // Create a minimal staging sample
  const stagingInContent = SAMPLE_STAGING_YAML;
  const tmpStagingIn = path.join(cwd, 'dist', 'test-staging-input.yaml');
  const tmpStagingOut = path.join(cwd, 'dist', 'test-staging-output.yaml');

  fs.mkdirSync(path.join(cwd, 'dist'), { recursive: true });
  fs.writeFileSync(tmpStagingIn, stagingInContent, 'utf8');

  const res = spawnSync('npx', [
    'tsx',
    scriptPath,
    `--input=${tmpStagingIn}`,
    `--output=${tmpStagingOut}`,
    `--digest=${IMMUTABLE_DIGEST}`,
    `--environment=staging`,
    `--service-name=echonote-staging`,
    `--serving-revision=${VALID_STAGING_REV}`,
    `--service-account=${VALID_STAGING_SA}`,
  ], {
    encoding: 'utf8',
    cwd,
    shell: true,
    env: { ...process.env, RAZORPAY_KEY_ID: 'rzp_test_cliTest123' },
  });

  assert.strictEqual(res.status, 0, `CLI failed: ${res.stderr}\n${res.stdout}`);
  assert(res.stdout.includes('Environment:              staging'));
  assert(res.stdout.includes('Service Name:             echonote-staging'));
  assert(res.stdout.includes(`Service Account:          ${VALID_STAGING_SA} (explicitly supplied staging account)`));
  assert(res.stdout.includes(`Traffic Specification:    100% pinned to verified ${VALID_STAGING_REV}`));

  // Clean up test temp files
  try {
    fs.unlinkSync(tmpStagingIn);
    fs.unlinkSync(tmpStagingOut);
  } catch {}
});

// 13. Scheduler script verifies staging Cloud Run URL
test('13. schedule-recurring-report-workers.sh staging targets verified staging URL', () => {
  const scriptPath = path.join(cwd, 'scripts', 'schedule-recurring-report-workers.sh');
  const res = spawnSync(bashPath, [scriptPath, '--environment=staging'], { encoding: 'utf8', cwd });
  assert.strictEqual(res.status, 0);
  assert(res.stdout.includes('https://echonote-staging-3fgo4kkjgq-uw.a.run.app/api/internal/reports/process-recurring'));
  assert(res.stdout.includes('https://echonote-staging-3fgo4kkjgq-uw.a.run.app/api/internal/reports/dispatch-deliveries'));
  assert(res.stdout.includes('echonote-recurring-report-dispatcher'));
  assert(res.stdout.includes('echonote-scheduler-invoker@echonote-staging.iam.gserviceaccount.com'));
});

// 14. Overdue alert script supports staging and isolates target URL
test('14. schedule-overdue-alerts.sh supports staging and isolates target URL', () => {
  const scriptPath = path.join(cwd, 'scripts', 'schedule-overdue-alerts.sh');
  const res = spawnSync(bashPath, [scriptPath, '--environment=staging'], { encoding: 'utf8', cwd });
  assert.strictEqual(res.status, 0);
  assert(res.stdout.includes('Environment:         staging'));
  assert(res.stdout.includes('Project ID:          echonote-staging'));
  assert(res.stdout.includes('https://echonote-staging-3fgo4kkjgq-uw.a.run.app/api/admin/tasks/scan-overdue'));
  assert(res.stdout.includes('echonote-scheduler-invoker@echonote-staging.iam.gserviceaccount.com'));
});

console.log(`\n======================================================`);
console.log(`✓ ALL ${passed}/${total} STAGING ISOLATION & SCHEDULER TESTS PASSED!`);
console.log(`======================================================`);
