import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

// Production constants & invariants
export const EXPECTED_PROJECT_ID = 'echonote-2509';
export const EXPECTED_REGION = 'us-west1';
export const EXPECTED_SERVICE_NAME = 'echonote';
export const EXPECTED_SERVICE_ACCOUNT = '200551109142-compute@developer.gserviceaccount.com';
export const EXPECTED_ARTIFACT_REGISTRY = 'us-west1-docker.pkg.dev/echonote-2509/echonote/echonote';
export const BASELINE_SERVING_REVISION = 'echonote-00009-w5m';

export interface SecretMapping {
  name: string;
  secretName: string;
  secretKey: string;
}

export const SECRET_MAPPINGS: readonly SecretMapping[] = [
  { name: 'GEMINI_API_KEY', secretName: 'echonote-gemini-api-key', secretKey: 'latest' },
  { name: 'RAZORPAY_KEY_SECRET', secretName: 'echonote-razorpay-key-secret', secretKey: 'latest' },
  { name: 'RAZORPAY_WEBHOOK_SECRET', secretName: 'echonote-razorpay-webhook-secret', secretKey: 'latest' },
  { name: 'RESEND_API_KEY', secretName: 'echonote-resend-api-key', secretKey: 'latest' },
  { name: 'PLAYBACK_SECRET', secretName: 'echonote-playback-secret', secretKey: 'latest' },
  { name: 'CRON_SECRET', secretName: 'echonote-cron-secret', secretKey: 'latest' },
] as const;

export interface OrdinaryEnvVarConfig {
  RAZORPAY_MODE?: string;
  RAZORPAY_KEY_ID?: string;
  NODE_ENV?: string;
  APP_URL?: string;
  RESEND_FROM_EMAIL?: string;
  RAZORPAY_PRO_MONTHLY_PLAN_ID?: string;
  RAZORPAY_PRO_YEARLY_PLAN_ID?: string;
  RAZORPAY_TEAM_MONTHLY_PLAN_ID?: string;
  RAZORPAY_TEAM_YEARLY_PLAN_ID?: string;
}

export const DEFAULT_ORDINARY_ENV_VARS: Readonly<Record<Exclude<keyof OrdinaryEnvVarConfig, 'RAZORPAY_KEY_ID'>, string>> = {
  RAZORPAY_MODE: 'live',
  NODE_ENV: 'production',
  APP_URL: 'https://echonote-25.ai.studio',
  RESEND_FROM_EMAIL: 'EchoNote <invitations@echotechai.in>',
  RAZORPAY_PRO_MONTHLY_PLAN_ID: 'plan_TambUyuTkGL4zY',
  RAZORPAY_PRO_YEARLY_PLAN_ID: 'plan_Tamd1Ef89GKQNk',
  RAZORPAY_TEAM_MONTHLY_PLAN_ID: 'plan_TamdizBJ9W7kJo',
  RAZORPAY_TEAM_YEARLY_PLAN_ID: 'plan_TameI4cjPUzRpn',
};

export interface TransformOptions {
  inputYamlContent: string;
  imageDigest: string;
  servingRevision?: string;
  ordinaryEnvOverrides?: OrdinaryEnvVarConfig;
}

export interface TransformResult {
  yaml: string;
  ordinaryVarCount: number;
  secretVarCount: number;
  imageUri: string;
  pinnedServingRevision: string;
  serviceAccount: string;
}

/**
 * Validates and transforms a Cloud Run Knative Service manifest
 * into an atomic, declarative desired-state manifest:
 * - Converts the 6 sensitive variables from literal to Secret Manager references.
 * - Enforces exactly 9 ordinary variables with zero overlap.
 * - Pins 100% traffic strictly to the existing serving revision.
 * - Preserves all container resources, ports, annotations, and service account.
 * - Strips template revision name so Cloud Run generates a fresh revision.
 */
export function transformServiceManifest(options: TransformOptions): TransformResult {
  const { inputYamlContent, imageDigest, servingRevision = BASELINE_SERVING_REVISION, ordinaryEnvOverrides = {} } = options;

  if (!imageDigest || !/^sha256:[a-f0-9]{64}$/.test(imageDigest)) {
    throw new Error(`Invalid immutable image digest format: "${imageDigest}". Must be sha256:<64 hex characters>.`);
  }

  let doc: any;
  try {
    doc = YAML.parse(inputYamlContent);
  } catch (err: any) {
    throw new Error(`Failed to parse input Cloud Run service YAML: ${err?.message || err}`);
  }

  if (!doc || typeof doc !== 'object') {
    throw new Error('Invalid Cloud Run YAML: root document is not an object.');
  }

  if (doc.apiVersion !== 'serving.knative.dev/v1' || doc.kind !== 'Service') {
    throw new Error(`Invalid Cloud Run Service document. Expected apiVersion: serving.knative.dev/v1, kind: Service. Got apiVersion: ${doc.apiVersion}, kind: ${doc.kind}`);
  }

  // 1. Validate Service metadata
  const serviceName = doc.metadata?.name;
  if (serviceName !== EXPECTED_SERVICE_NAME) {
    throw new Error(`Service name mismatch: expected "${EXPECTED_SERVICE_NAME}", got "${serviceName}"`);
  }

  const namespace = doc.metadata?.namespace;
  const expectedProjectNumber = '200551109142';

  if (
    namespace &&
    namespace !== EXPECTED_PROJECT_ID &&
    namespace !== expectedProjectNumber
  ) {
    throw new Error(
      `Namespace mismatch: expected "${EXPECTED_PROJECT_ID}" or project number "${expectedProjectNumber}", got "${namespace}"`
    );
  }

  // 2. Validate Template Spec
  if (!doc.spec || !doc.spec.template || !doc.spec.template.spec) {
    throw new Error('Invalid Service document: missing spec.template.spec');
  }

  const templateSpec = doc.spec.template.spec;
  const serviceAccount = templateSpec.serviceAccountName;
  if (serviceAccount !== EXPECTED_SERVICE_ACCOUNT) {
    throw new Error(`Service account mismatch: expected "${EXPECTED_SERVICE_ACCOUNT}", got "${serviceAccount}"`);
  }

  const containers = templateSpec.containers;
  if (!Array.isArray(containers) || containers.length === 0) {
    throw new Error('Invalid Service document: spec.template.spec.containers is empty or not an array');
  }

  const container = containers[0];

  // 3. Strip previous revision name from template metadata so Cloud Run creates a new revision
  if (doc.spec.template.metadata) {
    delete doc.spec.template.metadata.name;
  }

  // 4. Update container image to pinned immutable digest
  const expectedImageUri = `${EXPECTED_ARTIFACT_REGISTRY}@${imageDigest}`;
  container.image = expectedImageUri;

  // 5. Construct atomic desired env entries
  const ordinaryValues: Record<string, string | undefined> = {
    ...DEFAULT_ORDINARY_ENV_VARS,
    RAZORPAY_KEY_ID: 'RAZORPAY_KEY_ID' in ordinaryEnvOverrides
      ? ordinaryEnvOverrides.RAZORPAY_KEY_ID
      : process.env.RAZORPAY_KEY_ID,
    ...ordinaryEnvOverrides,
  };

  // Validate RAZORPAY_KEY_ID and RAZORPAY_MODE
  const mode = ordinaryValues.RAZORPAY_MODE || 'live';
  const keyId = ordinaryValues.RAZORPAY_KEY_ID;

  if (!keyId || typeof keyId !== 'string' || keyId.trim() === '') {
    throw new Error('Missing required RAZORPAY_KEY_ID environment variable.');
  }

  if (mode === 'live' && !keyId.startsWith('rzp_live_')) {
    throw new Error('Invalid RAZORPAY_KEY_ID for mode "live": must start with "rzp_live_".');
  }

  if (mode === 'test' && !keyId.startsWith('rzp_test_')) {
    throw new Error('Invalid RAZORPAY_KEY_ID for mode "test": must start with "rzp_test_".');
  }

  if (mode !== 'live' && mode !== 'test') {
    throw new Error(`Invalid RAZORPAY_MODE: "${mode}". Mode must be "live" or "test".`);
  }

  // Production requires strictly 'live'
  if (mode !== 'live') {
    throw new Error(`Invalid RAZORPAY_MODE: "${mode}". Production requires "live".`);
  }

  // Validate plan IDs regex
  const planRegex = /^plan_[A-Za-z0-9]+$/;
  const planKeys: (keyof OrdinaryEnvVarConfig)[] = [
    'RAZORPAY_PRO_MONTHLY_PLAN_ID',
    'RAZORPAY_PRO_YEARLY_PLAN_ID',
    'RAZORPAY_TEAM_MONTHLY_PLAN_ID',
    'RAZORPAY_TEAM_YEARLY_PLAN_ID',
  ];
  for (const k of planKeys) {
    const val = ordinaryValues[k];
    if (!val || !planRegex.test(val)) {
      throw new Error(`Invalid plan ID for ${k}: "${val}". Must match ^plan_[A-Za-z0-9]+$`);
    }
  }

  const desiredEnv: Array<{
    name: string;
    value?: string;
    valueFrom?: {
      secretKeyRef: {
        name: string;
        key: string;
      };
    };
  }> = [];

  // Add 9 ordinary variables
  const ordinaryKeys: (keyof OrdinaryEnvVarConfig)[] = [
    'RAZORPAY_MODE',
    'RAZORPAY_KEY_ID',
    'NODE_ENV',
    'APP_URL',
    'RESEND_FROM_EMAIL',
    'RAZORPAY_PRO_MONTHLY_PLAN_ID',
    'RAZORPAY_PRO_YEARLY_PLAN_ID',
    'RAZORPAY_TEAM_MONTHLY_PLAN_ID',
    'RAZORPAY_TEAM_YEARLY_PLAN_ID',
  ];

  for (const key of ordinaryKeys) {
    desiredEnv.push({
      name: key,
      value: String(ordinaryValues[key]),
    });
  }

  // Add 6 secret variables with secretKeyRef
  for (const secret of SECRET_MAPPINGS) {
    desiredEnv.push({
      name: secret.name,
      valueFrom: {
        secretKeyRef: {
          name: secret.secretName,
          key: secret.secretKey,
        },
      },
    });
  }

  // Validation: Check for duplicates or overlap
  const seenNames = new Set<string>();
  for (const item of desiredEnv) {
    if (seenNames.has(item.name)) {
      throw new Error(`Duplicate environment variable detected: "${item.name}"`);
    }
    seenNames.add(item.name);
  }

  if (desiredEnv.length !== 15) {
    throw new Error(`Expected exactly 15 environment entries, got ${desiredEnv.length}`);
  }

  container.env = desiredEnv;

  // 6. Explicitly preserve existing serving revision at 100% traffic
  // Do NOT route traffic to the newly created revision yet.
  doc.spec.traffic = [
    {
      percent: 100,
      revisionName: servingRevision,
    },
  ];

  // 7. Serialize to clean Knative YAML
  const transformedYaml = YAML.stringify(doc, {
    indent: 2,
    lineWidth: 0,
  });

  return {
    yaml: transformedYaml,
    ordinaryVarCount: ordinaryKeys.length,
    secretVarCount: SECRET_MAPPINGS.length,
    imageUri: expectedImageUri,
    pinnedServingRevision: servingRevision,
    serviceAccount,
  };
}

// CLI Execution Handler
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename || '')) {
  try {
    const args = process.argv.slice(2);
    let inputYamlPath = '';
    let outputYamlPath = '';
    let imageDigest = '';
    let servingRevision = BASELINE_SERVING_REVISION;

    for (const arg of args) {
      if (arg.startsWith('--input=')) {
        inputYamlPath = arg.substring('--input='.length);
      } else if (arg.startsWith('--output=')) {
        outputYamlPath = arg.substring('--output='.length);
      } else if (arg.startsWith('--digest=')) {
        imageDigest = arg.substring('--digest='.length);
      } else if (arg.startsWith('--serving-revision=')) {
        servingRevision = arg.substring('--serving-revision='.length);
      }
    }

    if (!inputYamlPath || !outputYamlPath || !imageDigest) {
      console.error('Usage: tsx scripts/prepare-declarative-service.ts --input=<service.yaml> --output=<desired.yaml> --digest=<sha256:...> [--serving-revision=<rev>]');
      process.exit(1);
    }

    const inputContent = fs.readFileSync(inputYamlPath, 'utf8');
    const result = transformServiceManifest({
      inputYamlContent: inputContent,
      imageDigest,
      servingRevision,
      ordinaryEnvOverrides: {
        RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID,
        RAZORPAY_PRO_MONTHLY_PLAN_ID: process.env.RAZORPAY_PRO_MONTHLY_PLAN_ID,
        RAZORPAY_PRO_YEARLY_PLAN_ID: process.env.RAZORPAY_PRO_YEARLY_PLAN_ID,
        RAZORPAY_TEAM_MONTHLY_PLAN_ID: process.env.RAZORPAY_TEAM_MONTHLY_PLAN_ID,
        RAZORPAY_TEAM_YEARLY_PLAN_ID: process.env.RAZORPAY_TEAM_YEARLY_PLAN_ID,
      },
    });

    // Write file with strict 0600 mode permissions
    fs.writeFileSync(outputYamlPath, result.yaml, { mode: 0o600, encoding: 'utf8' });

    console.log('✅ Declarative Cloud Run Service Specification generated successfully:');
    console.log(`   Service Account:          ${result.serviceAccount}`);
    console.log(`   Immutable Image URI:      ${result.imageUri}`);
    console.log(`   Ordinary Variables:       ${result.ordinaryVarCount} configured`);
    console.log(`   Secret Manager Mappings:  ${result.secretVarCount} mapped to Secret Manager`);
    console.log(`   Traffic Specification:    100% pinned to ${result.pinnedServingRevision} (0% to new revision)`);
    console.log(`   Output Manifest:          ${outputYamlPath} (permissions 0600)`);
  } catch (err: any) {
    console.error(`ERROR: ${err?.message || err}`);
    process.exit(1);
  }
}
