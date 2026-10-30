import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import {
  transformServiceManifest,
  EXPECTED_PROJECT_ID,
  EXPECTED_SERVICE_NAME,
  EXPECTED_SERVICE_ACCOUNT,
  EXPECTED_ARTIFACT_REGISTRY,
  BASELINE_SERVING_REVISION,
  SECRET_MAPPINGS,
  DEFAULT_ORDINARY_ENV_VARS,
} from '../scripts/prepare-declarative-service.js';

console.log('======================================================================');
console.log('🧪 RUNNING STEP 6M-I DECLARATIVE SERVICE MANIFEST TRANSFORMATION TESTS');
console.log('======================================================================');

let passedCount = 0;

function runTest(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✅ ${name} ... PASSED`);
    passedCount++;
  } catch (err: any) {
    console.error(`  ❌ ${name} ... FAILED`);
    console.error(`     Error: ${err?.message || err}`);
    process.exit(1);
  }
}

const SAMPLE_EXPORTED_YAML = `
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: echonote
  namespace: echonote-2509
  labels:
    cloud.googleapis.com/location: us-west1
  annotations:
    run.googleapis.com/ingress: all
    run.googleapis.com/client-name: gcloud
spec:
  template:
    metadata:
      name: echonote-00009-w5m
      annotations:
        autoscaling.knative.dev/maxScale: '10'
        autoscaling.knative.dev/minScale: '0'
        run.googleapis.com/execution-environment: gen2
    spec:
      containerConcurrency: 80
      timeoutSeconds: 300
      serviceAccountName: 200551109142-compute@developer.gserviceaccount.com
      containers:
      - image: us-west1-docker.pkg.dev/echonote-2509/echonote/echonote@sha256:olddigest000000000000000000000000000000000000000000000000000000000
        ports:
        - containerPort: 3000
          name: http1
        resources:
          limits:
            cpu: 1000m
            memory: 512Mi
          requests:
            cpu: 500m
            memory: 256Mi
        startupProbe:
          tcpSocket:
            port: 3000
          periodSeconds: 10
          timeoutSeconds: 4
          failureThreshold: 3
        env:
        - name: RAZORPAY_MODE
          value: live
        - name: NODE_ENV
          value: production
        - name: APP_URL
          value: https://echonote-25.ai.studio
        - name: GEMINI_API_KEY
          value: legacy-plaintext-gemini-key
        - name: RAZORPAY_KEY_SECRET
          value: legacy-plaintext-razorpay-key
        - name: RAZORPAY_WEBHOOK_SECRET
          value: legacy-plaintext-webhook-key
        - name: RESEND_API_KEY
          value: legacy-plaintext-resend-key
        - name: PLAYBACK_SECRET
          value: legacy-plaintext-playback-key
        - name: CRON_SECRET
          value: legacy-plaintext-cron-key
  traffic:
  - percent: 100
    revisionName: echonote-00009-w5m
`;

const TARGET_DIGEST = 'sha256:ca1549df6662f01d7c489ed8ebdc536b0044c51ee55aa4d314e5522a9cd8820c';

// Test 1: Transformation succeeds and parses into valid Knative Service
runTest('Transform succeeds and parses into Knative Service object', () => {
  const result = transformServiceManifest({
    inputYamlContent: SAMPLE_EXPORTED_YAML,
    imageDigest: TARGET_DIGEST,
  });

  const parsed = YAML.parse(result.yaml);
  assert.strictEqual(parsed.apiVersion, 'serving.knative.dev/v1');
  assert.strictEqual(parsed.kind, 'Service');
  assert.strictEqual(parsed.metadata.name, EXPECTED_SERVICE_NAME);
  assert.strictEqual(parsed.metadata.namespace, EXPECTED_PROJECT_ID);
});

// Test 2: Unrelated service and template settings are completely preserved
runTest('Unrelated service settings (networking, scaling, resources, probes) are preserved', () => {
  const result = transformServiceManifest({
    inputYamlContent: SAMPLE_EXPORTED_YAML,
    imageDigest: TARGET_DIGEST,
  });

  const parsed = YAML.parse(result.yaml);

  // Ingress annotation
  assert.strictEqual(parsed.metadata.annotations['run.googleapis.com/ingress'], 'all');
  assert.strictEqual(parsed.metadata.labels['cloud.googleapis.com/location'], 'us-west1');

  // Scaling annotations
  assert.strictEqual(parsed.spec.template.metadata.annotations['autoscaling.knative.dev/maxScale'], '10');
  assert.strictEqual(parsed.spec.template.metadata.annotations['run.googleapis.com/execution-environment'], 'gen2');

  // Concurrency & timeout
  assert.strictEqual(parsed.spec.template.spec.containerConcurrency, 80);
  assert.strictEqual(parsed.spec.template.spec.timeoutSeconds, 300);

  // Service Account
  assert.strictEqual(parsed.spec.template.spec.serviceAccountName, EXPECTED_SERVICE_ACCOUNT);

  // Ports, resources, probes
  const container = parsed.spec.template.spec.containers[0];
  assert.strictEqual(container.ports[0].containerPort, 3000);
  assert.strictEqual(container.resources.limits.cpu, '1000m');
  assert.strictEqual(container.resources.limits.memory, '512Mi');
  assert.strictEqual(container.resources.requests.cpu, '500m');
  assert.strictEqual(container.startupProbe.periodSeconds, 10);
});

// Test 3: Strips template revision name so Cloud Run generates a fresh revision
runTest('Strips previous revision name from template.metadata', () => {
  const result = transformServiceManifest({
    inputYamlContent: SAMPLE_EXPORTED_YAML,
    imageDigest: TARGET_DIGEST,
  });

  const parsed = YAML.parse(result.yaml);
  assert.strictEqual(parsed.spec.template.metadata.name, undefined);
});

// Test 4: Container image is pinned to exact immutable digest
runTest('Container image is pinned to exact immutable digest URI', () => {
  const result = transformServiceManifest({
    inputYamlContent: SAMPLE_EXPORTED_YAML,
    imageDigest: TARGET_DIGEST,
  });

  const parsed = YAML.parse(result.yaml);
  const expectedImage = `${EXPECTED_ARTIFACT_REGISTRY}@${TARGET_DIGEST}`;
  assert.strictEqual(parsed.spec.template.spec.containers[0].image, expectedImage);
  assert.strictEqual(result.imageUri, expectedImage);
});

// Test 5: Literal-to-secret type conversion for all 9 sensitive variables
runTest('Converts all 9 sensitive variables to Secret Manager references (valueFrom.secretKeyRef)', () => {
  const result = transformServiceManifest({
    inputYamlContent: SAMPLE_EXPORTED_YAML,
    imageDigest: TARGET_DIGEST,
  });

  const parsed = YAML.parse(result.yaml);
  const envList: any[] = parsed.spec.template.spec.containers[0].env;

  for (const secret of SECRET_MAPPINGS) {
    const envItem = envList.find(e => e.name === secret.name);
    assert.ok(envItem, `Missing secret variable: ${secret.name}`);
    assert.strictEqual(envItem.value, undefined, `Secret ${secret.name} must NOT contain literal value`);
    assert.ok(envItem.valueFrom?.secretKeyRef, `Secret ${secret.name} must have valueFrom.secretKeyRef`);
    assert.strictEqual(envItem.valueFrom.secretKeyRef.name, secret.secretName);
    assert.strictEqual(envItem.valueFrom.secretKeyRef.key, secret.secretKey);
  }
});

// Test 6: Exactly 10 ordinary variables with correct values
runTest('All 10 ordinary variables are present with correct literal values', () => {
  const result = transformServiceManifest({
    inputYamlContent: SAMPLE_EXPORTED_YAML,
    imageDigest: TARGET_DIGEST,
    ordinaryEnvOverrides: {
      RAZORPAY_KEY_ID: 'rzp_live_testdummykey123',
    },
  });

  const parsed = YAML.parse(result.yaml);
  const envList: any[] = parsed.spec.template.spec.containers[0].env;

  assert.strictEqual(envList.find(e => e.name === 'RAZORPAY_MODE')?.value, 'live');
  assert.strictEqual(envList.find(e => e.name === 'RAZORPAY_KEY_ID')?.value, 'rzp_live_testdummykey123');
  assert.strictEqual(envList.find(e => e.name === 'NODE_ENV')?.value, 'production');
  assert.strictEqual(envList.find(e => e.name === 'ALLOW_PRODUCTION_RESOURCES')?.value, 'true');
  assert.strictEqual(envList.find(e => e.name === 'APP_URL')?.value, 'https://echonote-25.ai.studio');
  assert.strictEqual(envList.find(e => e.name === 'RESEND_FROM_EMAIL')?.value, 'EchoNote <invitations@echotechai.in>');
  assert.strictEqual(envList.find(e => e.name === 'RAZORPAY_PRO_MONTHLY_PLAN_ID')?.value, 'plan_TambUyuTkGL4zY');
  assert.strictEqual(envList.find(e => e.name === 'RAZORPAY_PRO_YEARLY_PLAN_ID')?.value, 'plan_Tamd1Ef89GKQNk');
  assert.strictEqual(envList.find(e => e.name === 'RAZORPAY_TEAM_MONTHLY_PLAN_ID')?.value, 'plan_TamdizBJ9W7kJo');
  assert.strictEqual(envList.find(e => e.name === 'RAZORPAY_TEAM_YEARLY_PLAN_ID')?.value, 'plan_TameI4cjPUzRpn');
});

// Test 7: Total variable count is exactly 19, no duplicates, zero overlap
runTest('Total environment variable count is 19 with zero duplicates and zero overlap', () => {
  const result = transformServiceManifest({
    inputYamlContent: SAMPLE_EXPORTED_YAML,
    imageDigest: TARGET_DIGEST,
    ordinaryEnvOverrides: {
      RAZORPAY_KEY_ID: 'rzp_live_testdummykey123',
    },
  });

  const parsed = YAML.parse(result.yaml);
  const envList: any[] = parsed.spec.template.spec.containers[0].env;

  assert.strictEqual(envList.length, 19);
  const names = envList.map(e => e.name);
  const uniqueNames = new Set(names);
  assert.strictEqual(uniqueNames.size, 19, 'Duplicate environment variable names detected');
});

// Test 8: Traffic is 100% pinned strictly to serving revision (0% to new revision)
runTest('Traffic is 100% pinned to serving revision (echonote-00009-w5m)', () => {
  const result = transformServiceManifest({
    inputYamlContent: SAMPLE_EXPORTED_YAML,
    imageDigest: TARGET_DIGEST,
    servingRevision: 'echonote-00009-w5m',
  });

  const parsed = YAML.parse(result.yaml);
  assert.deepStrictEqual(parsed.spec.traffic, [
    {
      percent: 100,
      revisionName: 'echonote-00009-w5m',
    },
  ]);
  assert.strictEqual(result.pinnedServingRevision, 'echonote-00009-w5m');
});

// Test 9: Zero plain text secrets in the output YAML
runTest('No plaintext secrets or legacy string values exist in transformed output', () => {
  const result = transformServiceManifest({
    inputYamlContent: SAMPLE_EXPORTED_YAML,
    imageDigest: TARGET_DIGEST,
  });

  const forbiddenStrings = [
    'legacy-plaintext-gemini-key',
    'legacy-plaintext-razorpay-key',
    'legacy-plaintext-webhook-key',
    'legacy-plaintext-resend-key',
    'legacy-plaintext-playback-key',
    'legacy-plaintext-cron-key',
  ];

  for (const forbidden of forbiddenStrings) {
    assert.strictEqual(result.yaml.includes(forbidden), false, `Transformed YAML contains leaked string: ${forbidden}`);
  }
});

// Test 10: Rejects invalid or mutable image digest
runTest('Rejects mutable tag (e.g. latest) or invalid image digest', () => {
  assert.throws(
    () => {
      transformServiceManifest({
        inputYamlContent: SAMPLE_EXPORTED_YAML,
        imageDigest: 'latest',
      });
    },
    /Invalid immutable image digest format/,
  );

  assert.throws(
    () => {
      transformServiceManifest({
        inputYamlContent: SAMPLE_EXPORTED_YAML,
        imageDigest: 'sha256:short',
      });
    },
    /Invalid immutable image digest format/,
  );
});

// Test 11: Rejects malformed YAML syntax and invalid service schema
runTest('Rejects malformed YAML syntax with parse error', () => {
  assert.throws(
    () => {
      transformServiceManifest({
        inputYamlContent: 'foo: [\nunclosed array\n',
        imageDigest: TARGET_DIGEST,
      });
    },
    /Failed to parse input Cloud Run service YAML/,
  );

  assert.throws(
    () => {
      transformServiceManifest({
        inputYamlContent: 'just: a string scalar',
        imageDigest: TARGET_DIGEST,
      });
    },
    /Invalid Cloud Run Service document/,
  );
});

// Test 12: Rejects unexpected service name
runTest('Rejects mismatched service name', () => {
  const wrongServiceYaml = SAMPLE_EXPORTED_YAML.replace('name: echonote', 'name: wrong-service');
  assert.throws(
    () => {
      transformServiceManifest({
        inputYamlContent: wrongServiceYaml,
        imageDigest: TARGET_DIGEST,
      });
    },
    /Service name mismatch/,
  );
});

// Test 13: Rejects mismatched service account
runTest('Rejects mismatched service account', () => {
  const wrongSaYaml = SAMPLE_EXPORTED_YAML.replace(
    EXPECTED_SERVICE_ACCOUNT,
    'attacker@developer.gserviceaccount.com',
  );
  assert.throws(
    () => {
      transformServiceManifest({
        inputYamlContent: wrongSaYaml,
        imageDigest: TARGET_DIGEST,
      });
    },
    /Service account mismatch/,
  );
});

// Test 14: Rejects non-live Razorpay mode
runTest('Rejects non-live Razorpay mode override', () => {
  assert.throws(
    () => {
      transformServiceManifest({
        inputYamlContent: SAMPLE_EXPORTED_YAML,
        imageDigest: TARGET_DIGEST,
        ordinaryEnvOverrides: { RAZORPAY_MODE: 'test', RAZORPAY_KEY_ID: 'rzp_test_dummykey123' },
      });
    },
    /Production requires "live"/,
  );
});

// Test 15: Rejects invalid plan ID format
runTest('Rejects invalid plan ID format', () => {
  assert.throws(
    () => {
      transformServiceManifest({
        inputYamlContent: SAMPLE_EXPORTED_YAML,
        imageDigest: TARGET_DIGEST,
        ordinaryEnvOverrides: { RAZORPAY_PRO_MONTHLY_PLAN_ID: 'invalid_plan_format' },
      });
    },
    /Invalid plan ID/,
  );
});

// Test 16: RAZORPAY_KEY_ID is present in the generated desired Cloud Run configuration
runTest('RAZORPAY_KEY_ID is present in generated desired Cloud Run configuration', () => {
  const result = transformServiceManifest({
    inputYamlContent: SAMPLE_EXPORTED_YAML,
    imageDigest: TARGET_DIGEST,
    ordinaryEnvOverrides: { RAZORPAY_KEY_ID: 'rzp_live_testdummykey123' },
  });
  const parsed = YAML.parse(result.yaml);
  const envList: any[] = parsed.spec.template.spec.containers[0].env;
  const keyItem = envList.find(e => e.name === 'RAZORPAY_KEY_ID');
  assert.ok(keyItem, 'RAZORPAY_KEY_ID must be present in env');
  assert.strictEqual(keyItem.value, 'rzp_live_testdummykey123');
});

// Test 17: RAZORPAY_KEY_ID is treated as an ordinary environment variable
runTest('RAZORPAY_KEY_ID is treated as an ordinary environment variable', () => {
  const result = transformServiceManifest({
    inputYamlContent: SAMPLE_EXPORTED_YAML,
    imageDigest: TARGET_DIGEST,
    ordinaryEnvOverrides: { RAZORPAY_KEY_ID: 'rzp_live_testdummykey123' },
  });
  const parsed = YAML.parse(result.yaml);
  const envList: any[] = parsed.spec.template.spec.containers[0].env;
  const keyItem = envList.find(e => e.name === 'RAZORPAY_KEY_ID');
  assert.strictEqual(typeof keyItem.value, 'string');
  assert.strictEqual(keyItem.valueFrom, undefined, 'RAZORPAY_KEY_ID must NOT have valueFrom');
});

// Test 18: RAZORPAY_KEY_SECRET remains a Secret Manager reference
runTest('RAZORPAY_KEY_SECRET remains a Secret Manager reference', () => {
  const result = transformServiceManifest({
    inputYamlContent: SAMPLE_EXPORTED_YAML,
    imageDigest: TARGET_DIGEST,
    ordinaryEnvOverrides: { RAZORPAY_KEY_ID: 'rzp_live_testdummykey123' },
  });
  const parsed = YAML.parse(result.yaml);
  const envList: any[] = parsed.spec.template.spec.containers[0].env;
  const secretItem = envList.find(e => e.name === 'RAZORPAY_KEY_SECRET');
  assert.ok(secretItem, 'RAZORPAY_KEY_SECRET must be present');
  assert.strictEqual(secretItem.value, undefined, 'Secret must NOT have plain value');
  assert.strictEqual(secretItem.valueFrom?.secretKeyRef?.name, 'echonote-razorpay-key-secret');
  assert.strictEqual(secretItem.valueFrom?.secretKeyRef?.key, 'latest');
});

// Test 19: RAZORPAY_WEBHOOK_SECRET remains a Secret Manager reference
runTest('RAZORPAY_WEBHOOK_SECRET remains a Secret Manager reference', () => {
  const result = transformServiceManifest({
    inputYamlContent: SAMPLE_EXPORTED_YAML,
    imageDigest: TARGET_DIGEST,
    ordinaryEnvOverrides: { RAZORPAY_KEY_ID: 'rzp_live_testdummykey123' },
  });
  const parsed = YAML.parse(result.yaml);
  const envList: any[] = parsed.spec.template.spec.containers[0].env;
  const secretItem = envList.find(e => e.name === 'RAZORPAY_WEBHOOK_SECRET');
  assert.ok(secretItem, 'RAZORPAY_WEBHOOK_SECRET must be present');
  assert.strictEqual(secretItem.value, undefined, 'Secret must NOT have plain value');
  assert.strictEqual(secretItem.valueFrom?.secretKeyRef?.name, 'echonote-razorpay-webhook-secret');
  assert.strictEqual(secretItem.valueFrom?.secretKeyRef?.key, 'latest');
});

// Test 20: Missing RAZORPAY_KEY_ID fails safely
runTest('Missing RAZORPAY_KEY_ID fails safely with clear error', () => {
  assert.throws(
    () => {
      transformServiceManifest({
        inputYamlContent: SAMPLE_EXPORTED_YAML,
        imageDigest: TARGET_DIGEST,
        ordinaryEnvOverrides: { RAZORPAY_KEY_ID: '' },
      });
    },
    /Missing required RAZORPAY_KEY_ID environment variable/,
  );
});

// Test 21: live mode rejects a non-rzp_live_ key ID
runTest('Live mode rejects a non-rzp_live_ key ID', () => {
  assert.throws(
    () => {
      transformServiceManifest({
        inputYamlContent: SAMPLE_EXPORTED_YAML,
        imageDigest: TARGET_DIGEST,
        ordinaryEnvOverrides: { RAZORPAY_MODE: 'live', RAZORPAY_KEY_ID: 'invalid_prefix_key_123' },
      });
    },
    /Invalid RAZORPAY_KEY_ID for mode "live": must start with "rzp_live_"./,
  );
});

// Test 22: test mode rejects a non-rzp_test_ key ID
runTest('Test mode rejects a non-rzp_test_ key ID', () => {
  assert.throws(
    () => {
      transformServiceManifest({
        inputYamlContent: SAMPLE_EXPORTED_YAML,
        imageDigest: TARGET_DIGEST,
        ordinaryEnvOverrides: { RAZORPAY_MODE: 'test', RAZORPAY_KEY_ID: 'rzp_live_not_test_123' },
      });
    },
    /Invalid RAZORPAY_KEY_ID for mode "test": must start with "rzp_test_"./,
  );
});

// Test 23: actual credential values are never printed by validation errors
runTest('Actual credential values are never printed by validation errors', () => {
  const secretCandidate = 'unrecognized_key_secret_candidate_998877';
  try {
    transformServiceManifest({
      inputYamlContent: SAMPLE_EXPORTED_YAML,
      imageDigest: TARGET_DIGEST,
      ordinaryEnvOverrides: { RAZORPAY_MODE: 'live', RAZORPAY_KEY_ID: secretCandidate },
    });
    assert.fail('Expected transformServiceManifest to throw');
  } catch (err: any) {
    assert.strictEqual(
      err.message.includes(secretCandidate),
      false,
      'Error message must NOT contain raw key value',
    );
  }
});

// Test 24: .env.example contains no real credential values
runTest('.env.example contains no real credential values', () => {
  const envContent = fs.readFileSync(path.resolve(process.cwd(), '.env.example'), 'utf8');
  assert.ok(!envContent.match(/rzp_live_[A-Za-z0-9]{14,}/), 'No live Razorpay key IDs in .env.example');
  assert.ok(!envContent.match(/rzp_test_[A-Za-z0-9]{14,}/), 'No test Razorpay key IDs in .env.example');
  assert.ok(!envContent.match(/AIza[0-9A-Za-z_-]{30,}/), 'No Google API keys in .env.example');
  assert.ok(!envContent.match(/re_[0-9A-Za-z_-]{20,}/), 'No Resend API keys in .env.example');
});

// Test 25: Default service name behavior targets echonote
runTest('Default service name behavior targets echonote', () => {
  const result = transformServiceManifest({
    inputYamlContent: SAMPLE_EXPORTED_YAML,
    imageDigest: TARGET_DIGEST,
    ordinaryEnvOverrides: { RAZORPAY_KEY_ID: 'rzp_live_testdummykey123' },
  });
  assert.strictEqual(result.serviceName, 'echonote');
  const doc = YAML.parse(result.yaml);
  assert.strictEqual(doc.metadata.name, 'echonote');
});

// Test 26: Explicit service name echonote succeeds for echonote manifest
runTest('Explicit service name echonote succeeds for echonote manifest', () => {
  const result = transformServiceManifest({
    inputYamlContent: SAMPLE_EXPORTED_YAML,
    imageDigest: TARGET_DIGEST,
    serviceName: 'echonote',
    ordinaryEnvOverrides: { RAZORPAY_KEY_ID: 'rzp_live_testdummykey123' },
  });
  assert.strictEqual(result.serviceName, 'echonote');
  const doc = YAML.parse(result.yaml);
  assert.strictEqual(doc.metadata.name, 'echonote');
});

// Test 27: echonote-prod acceptance when serviceName=echonote-prod
runTest('echonote-prod acceptance when serviceName=echonote-prod', () => {
  const prodYaml = SAMPLE_EXPORTED_YAML.replace('name: echonote', 'name: echonote-prod');
  const result = transformServiceManifest({
    inputYamlContent: prodYaml,
    imageDigest: TARGET_DIGEST,
    serviceName: 'echonote-prod',
    servingRevision: 'echonote-prod-00001-abc',
    ordinaryEnvOverrides: { RAZORPAY_KEY_ID: 'rzp_live_testdummykey123' },
  });
  assert.strictEqual(result.serviceName, 'echonote-prod');
  assert.strictEqual(result.pinnedServingRevision, 'echonote-prod-00001-abc');
  const doc = YAML.parse(result.yaml);
  assert.strictEqual(doc.metadata.name, 'echonote-prod');
  assert.strictEqual(doc.spec.traffic[0].revisionName, 'echonote-prod-00001-abc');
});

// Test 28: Cross-service rejection: rejects echonote manifest when serviceName=echonote-prod
runTest('Cross-service rejection: rejects echonote manifest when serviceName=echonote-prod', () => {
  assert.throws(
    () => {
      transformServiceManifest({
        inputYamlContent: SAMPLE_EXPORTED_YAML, // has metadata.name: echonote
        imageDigest: TARGET_DIGEST,
        serviceName: 'echonote-prod',
        ordinaryEnvOverrides: { RAZORPAY_KEY_ID: 'rzp_live_testdummykey123' },
      });
    },
    /Service name mismatch: expected "echonote-prod", got "echonote"/,
  );
});

// Test 29: Cross-service rejection: rejects echonote-prod manifest when serviceName=echonote
runTest('Cross-service rejection: rejects echonote-prod manifest when serviceName=echonote', () => {
  const prodYaml = SAMPLE_EXPORTED_YAML.replace('name: echonote', 'name: echonote-prod');
  assert.throws(
    () => {
      transformServiceManifest({
        inputYamlContent: prodYaml,
        imageDigest: TARGET_DIGEST,
        serviceName: 'echonote',
        ordinaryEnvOverrides: { RAZORPAY_KEY_ID: 'rzp_live_testdummykey123' },
      });
    },
    /Service name mismatch: expected "echonote", got "echonote-prod"/,
  );

  // Also rejects with default service name
  assert.throws(
    () => {
      transformServiceManifest({
        inputYamlContent: prodYaml,
        imageDigest: TARGET_DIGEST,
        ordinaryEnvOverrides: { RAZORPAY_KEY_ID: 'rzp_live_testdummykey123' },
      });
    },
    /Service name mismatch: expected "echonote", got "echonote-prod"/,
  );
});

// Test 30: Strips stale run.googleapis.com/sources annotations
runTest('Strips stale run.googleapis.com/sources annotations from metadata and template', () => {
  const yamlWithSources = SAMPLE_EXPORTED_YAML
    .replace(
      'run.googleapis.com/client-name: gcloud',
      'run.googleapis.com/client-name: gcloud\n    run.googleapis.com/sources: gs://echonote-bucket/stale-source.tar.gz',
    )
    .replace(
      'run.googleapis.com/execution-environment: gen2',
      'run.googleapis.com/execution-environment: gen2\n        run.googleapis.com/sources: gs://echonote-bucket/stale-source.tar.gz',
    );

  const result = transformServiceManifest({
    inputYamlContent: yamlWithSources,
    imageDigest: TARGET_DIGEST,
    ordinaryEnvOverrides: { RAZORPAY_KEY_ID: 'rzp_live_testdummykey123' },
  });

  const doc = YAML.parse(result.yaml);
  assert.strictEqual(doc.metadata.annotations['run.googleapis.com/sources'], undefined, 'Top-level source annotation must be deleted');
  assert.strictEqual(doc.spec.template.metadata.annotations['run.googleapis.com/sources'], undefined, 'Template source annotation must be deleted');
  assert.strictEqual(doc.metadata.annotations['run.googleapis.com/client-name'], 'gcloud', 'Other annotations preserved');
  assert.strictEqual(doc.spec.template.metadata.annotations['run.googleapis.com/execution-environment'], 'gen2', 'Other template annotations preserved');
});

// Test 31: echonote-prod preserves all 18 environment entries and 9 secret mappings
runTest('echonote-prod preserves all 19 environment entries and 9 secret mappings', () => {
  const prodYaml = SAMPLE_EXPORTED_YAML.replace('name: echonote', 'name: echonote-prod');
  const result = transformServiceManifest({
    inputYamlContent: prodYaml,
    imageDigest: TARGET_DIGEST,
    serviceName: 'echonote-prod',
    servingRevision: 'echonote-prod-00001-xyz',
    ordinaryEnvOverrides: { RAZORPAY_KEY_ID: 'rzp_live_testdummykey123' },
  });

  assert.strictEqual(result.ordinaryVarCount, 10);
  assert.strictEqual(result.secretVarCount, 9);
  const doc = YAML.parse(result.yaml);
  const env = doc.spec.template.spec.containers[0].env;
  assert.strictEqual(env.length, 19);
  const secretEntries = env.filter((e: any) => e.valueFrom?.secretKeyRef);
  assert.strictEqual(secretEntries.length, 9);
  const ordinaryEntries = env.filter((e: any) => e.value !== undefined);
  assert.strictEqual(ordinaryEntries.length, 10);
});

// Test 32: echonote-prod validates service account and immutable image digest
runTest('echonote-prod validates service account and immutable image digest', () => {
  const prodYaml = SAMPLE_EXPORTED_YAML.replace('name: echonote', 'name: echonote-prod');
  const result = transformServiceManifest({
    inputYamlContent: prodYaml,
    imageDigest: TARGET_DIGEST,
    serviceName: 'echonote-prod',
    servingRevision: 'echonote-prod-00001-xyz',
    ordinaryEnvOverrides: { RAZORPAY_KEY_ID: 'rzp_live_testdummykey123' },
  });

  assert.strictEqual(result.serviceAccount, '200551109142-compute@developer.gserviceaccount.com');
  assert.strictEqual(result.imageUri, `us-west1-docker.pkg.dev/echonote-2509/echonote/echonote@${TARGET_DIGEST}`);
});

// Test 33: Rejects unsupported service names
runTest('Rejects unsupported service names', () => {
  assert.throws(
    () => {
      transformServiceManifest({
        inputYamlContent: SAMPLE_EXPORTED_YAML,
        imageDigest: TARGET_DIGEST,
        serviceName: 'attacker-service',
        ordinaryEnvOverrides: { RAZORPAY_KEY_ID: 'rzp_live_testdummykey123' },
      });
    },
    /Unsupported service name: "attacker-service"/,
  );
});

console.log('======================================================================');
console.log(`🎉 ALL ${passedCount} STEP 6M-I DECLARATIVE TRANSFORMATION TESTS PASSED!`);
console.log('======================================================================');
