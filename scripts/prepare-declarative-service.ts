import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

// Production constants & invariants
export const EXPECTED_PROJECT_ID = 'echonote-2509';
export const EXPECTED_REGION = 'us-west1';
export const EXPECTED_SERVICE_NAME = 'echonote';
export const EXPECTED_SERVICE_ACCOUNT = '200551109142-compute@developer.gserviceaccount.com';
export const EXPECTED_ARTIFACT_REGISTRY = 'us-west1-docker.pkg.dev/echonote-2509/echonote/echonote';
export const PRODUCTION_PROJECT_NUMBER = '200551109142';

// Historical test fixture baseline revision (strictly for unit tests and fixtures)
export const TEST_FIXTURE_BASELINE_REVISION = 'echonote-00009-w5m';
export const BASELINE_SERVING_REVISION = TEST_FIXTURE_BASELINE_REVISION;

// Staging constants & invariants
export const STAGING_PROJECT_ID = 'echonote-staging';
export const STAGING_REGION = 'us-west1';
export const STAGING_SERVICE_NAME = 'echonote-staging';
export const STAGING_ARTIFACT_REGISTRY = 'us-west1-docker.pkg.dev/echonote-staging/echonote-staging/echonote';
export const STAGING_DEFAULT_APP_URL = 'https://echonote-staging-3fgo4kkjgq-uw.a.run.app';
export const STAGING_PROJECT_NUMBER = '113524085497';
export const STAGING_DEFAULT_FIRESTORE_DB = '(default)';
export const STAGING_DEFAULT_STORAGE_BUCKET = 'echonote-staging-reports';
export const STAGING_DEFAULT_SCHEDULER_SA = 'echo-scheduler@echonote-staging.iam.gserviceaccount.com';
export const STAGING_DEFAULT_RAZORPAY_KEY_ID = 'rzp_test_stagingKey123';

// Note: Staging service account must be explicitly supplied via configuration or CLI.
// No invented default is assumed or permitted.
export const STAGING_TEST_FIXTURE_SERVICE_ACCOUNT = 'echonote-staging-sa@echonote-staging.iam.gserviceaccount.com';

export interface SecretMapping {
  name: string;
  secretName: string;
  secretKey: string;
}

export const PRODUCTION_SECRET_MAPPINGS: readonly SecretMapping[] = [
  { name: 'GEMINI_API_KEY', secretName: 'echonote-gemini-api-key', secretKey: 'latest' },
  { name: 'RAZORPAY_KEY_SECRET', secretName: 'echonote-razorpay-key-secret', secretKey: 'latest' },
  { name: 'RAZORPAY_WEBHOOK_SECRET', secretName: 'echonote-razorpay-webhook-secret', secretKey: 'latest' },
  { name: 'RESEND_API_KEY', secretName: 'echonote-resend-api-key', secretKey: 'latest' },
  { name: 'PLAYBACK_SECRET', secretName: 'echonote-playback-secret', secretKey: 'latest' },
  { name: 'CRON_SECRET', secretName: 'echonote-cron-secret', secretKey: 'latest' },
  { name: 'INTEGRATION_ENCRYPTION_KEY', secretName: 'echonote-integration-encryption-key', secretKey: 'latest' },
  { name: 'ZOOM_WEBHOOK_SECRET', secretName: 'echonote-zoom-webhook-secret', secretKey: 'latest' },
  { name: 'REPORT_DOWNLOAD_SECRET', secretName: 'echonote-report-download-secret', secretKey: 'latest' },
] as const;

// Backward-compatible alias for production secret mappings
export const SECRET_MAPPINGS = PRODUCTION_SECRET_MAPPINGS;

// Core staging secrets verified in echonote-staging Secret Manager
export const STAGING_CORE_SECRET_MAPPINGS: readonly SecretMapping[] = [
  { name: 'GEMINI_API_KEY', secretName: 'echonote-gemini-api-key', secretKey: 'latest' },
  { name: 'REPORT_DOWNLOAD_SECRET', secretName: 'REPORT_DOWNLOAD_SECRET', secretKey: 'latest' },
] as const;

// Staging optional feature secret catalog
export const STAGING_OPTIONAL_FEATURE_SECRETS: Readonly<Record<string, SecretMapping>> = {
  email_delivery: { name: 'RESEND_API_KEY', secretName: 'echonote-resend-api-key', secretKey: 'latest' },
  razorpay: { name: 'RAZORPAY_KEY_SECRET', secretName: 'echonote-razorpay-key-secret', secretKey: 'latest' },
  razorpay_webhook: { name: 'RAZORPAY_WEBHOOK_SECRET', secretName: 'echonote-razorpay-webhook-secret', secretKey: 'latest' },
  zoom_webhook: { name: 'ZOOM_WEBHOOK_SECRET', secretName: 'echonote-zoom-webhook-secret', secretKey: 'latest' },
  integration_encryption: { name: 'INTEGRATION_ENCRYPTION_KEY', secretName: 'echonote-integration-encryption-key', secretKey: 'latest' },
  playback_signing: { name: 'PLAYBACK_SECRET', secretName: 'echonote-playback-secret', secretKey: 'latest' },
  cron_header: { name: 'CRON_SECRET', secretName: 'echonote-cron-secret', secretKey: 'latest' },
} as const;

export interface OrdinaryEnvVarConfig {
  RAZORPAY_MODE?: string;
  RAZORPAY_KEY_ID?: string;
  NODE_ENV?: string;
  ALLOW_PRODUCTION_RESOURCES?: string;
  STAGING_ISOLATION_REQUIRED?: string;
  STAGING_EMAIL_DELIVERY_ENABLED?: string;
  APP_URL?: string;
  RESEND_FROM_EMAIL?: string;
  RAZORPAY_PRO_MONTHLY_PLAN_ID?: string;
  RAZORPAY_PRO_YEARLY_PLAN_ID?: string;
  RAZORPAY_TEAM_MONTHLY_PLAN_ID?: string;
  RAZORPAY_TEAM_YEARLY_PLAN_ID?: string;
  GOOGLE_CLOUD_PROJECT?: string;
  FIRESTORE_DATABASE_ID?: string;
  STORAGE_BUCKET?: string;
  SCHEDULER_SERVICE_ACCOUNT?: string;
  SCHEDULER_OIDC_AUDIENCE?: string;
}

export const DEFAULT_ORDINARY_ENV_VARS: Readonly<Record<Exclude<keyof OrdinaryEnvVarConfig, 'RAZORPAY_KEY_ID' | 'STAGING_ISOLATION_REQUIRED' | 'STAGING_EMAIL_DELIVERY_ENABLED' | 'GOOGLE_CLOUD_PROJECT' | 'FIRESTORE_DATABASE_ID' | 'STORAGE_BUCKET' | 'SCHEDULER_SERVICE_ACCOUNT' | 'SCHEDULER_OIDC_AUDIENCE'>, string>> = {
  RAZORPAY_MODE: 'live',
  NODE_ENV: 'production',
  ALLOW_PRODUCTION_RESOURCES: 'true',
  APP_URL: 'https://echonote-25.ai.studio',
  RESEND_FROM_EMAIL: 'EchoNote <invitations@echotechai.in>',
  RAZORPAY_PRO_MONTHLY_PLAN_ID: 'plan_TambUyuTkGL4zY',
  RAZORPAY_PRO_YEARLY_PLAN_ID: 'plan_Tamd1Ef89GKQNk',
  RAZORPAY_TEAM_MONTHLY_PLAN_ID: 'plan_TamdizBJ9W7kJo',
  RAZORPAY_TEAM_YEARLY_PLAN_ID: 'plan_TameI4cjPUzRpn',
};

export const DEFAULT_STAGING_ORDINARY_ENV_VARS: Readonly<Record<Exclude<keyof OrdinaryEnvVarConfig, 'RAZORPAY_KEY_ID' | 'ALLOW_PRODUCTION_RESOURCES'>, string>> = {
  RAZORPAY_MODE: 'test',
  NODE_ENV: 'staging',
  STAGING_ISOLATION_REQUIRED: 'true',
  STAGING_EMAIL_DELIVERY_ENABLED: 'false',
  GOOGLE_CLOUD_PROJECT: STAGING_PROJECT_ID,
  FIRESTORE_DATABASE_ID: STAGING_DEFAULT_FIRESTORE_DB,
  STORAGE_BUCKET: STAGING_DEFAULT_STORAGE_BUCKET,
  SCHEDULER_SERVICE_ACCOUNT: STAGING_DEFAULT_SCHEDULER_SA,
  SCHEDULER_OIDC_AUDIENCE: STAGING_DEFAULT_APP_URL,
  APP_URL: STAGING_DEFAULT_APP_URL,
  RESEND_FROM_EMAIL: 'EchoNote Staging <invitations@echotechai.in>',
  RAZORPAY_PRO_MONTHLY_PLAN_ID: 'plan_test_pro_monthly',
  RAZORPAY_PRO_YEARLY_PLAN_ID: 'plan_test_pro_yearly',
  RAZORPAY_TEAM_MONTHLY_PLAN_ID: 'plan_test_team_monthly',
  RAZORPAY_TEAM_YEARLY_PLAN_ID: 'plan_test_team_yearly',
};

export const ALLOWED_SERVICE_NAMES = ['echonote', 'echonote-prod', 'echonote-staging'] as const;

export interface TransformOptions {
  inputYamlContent: string;
  imageDigest: string;
  servingRevision?: string;
  ordinaryEnvOverrides?: OrdinaryEnvVarConfig;
  serviceName?: string;
  environment?: 'production' | 'staging';
  serviceAccount?: string;
  enabledIntegrations?: string[];
  stagingSecretsAvailable?: string[];
}

export interface TransformResult {
  yaml: string;
  ordinaryVarCount: number;
  secretVarCount: number;
  imageUri: string;
  pinnedServingRevision: string;
  serviceAccount: string;
  serviceName: string;
  environment: 'production' | 'staging';
}

/**
 * Validates Cloud Run revision naming convention:
 * Letters, numbers, hyphens, starting with a letter and ending with an alphanumeric character.
 */
export function validateRevisionFormat(revision: string): void {
  if (!revision || typeof revision !== 'string' || revision.trim() === '') {
    throw new Error('Serving revision must be a non-empty string.');
  }
  const revRegex = /^[a-z][a-z0-9-]{0,61}[a-z0-9]$/;
  if (!revRegex.test(revision)) {
    throw new Error(`Invalid Cloud Run revision format: "${revision}". Must match ^[a-z][a-z0-9-]{0,61}[a-z0-9]$`);
  }
}

/**
 * Validates Google service account email format:
 * Either standard compute default (<project-number>-compute@developer.gserviceaccount.com)
 * or IAM service account (<sa-name>@<project-id>.iam.gserviceaccount.com).
 */
export function validateServiceAccountFormat(sa: string): void {
  if (!sa || typeof sa !== 'string' || sa.trim() === '') {
    throw new Error('Service account must be a non-empty string.');
  }
  const computeRegex = /^[0-9]+-compute@developer\.gserviceaccount\.com$/;
  const iamRegex = /^[a-z][a-z0-9-]{4,28}[a-z0-9]@[a-z0-9-]+\.iam\.gserviceaccount\.com$/;
  if (!computeRegex.test(sa) && !iamRegex.test(sa)) {
    throw new Error(`Invalid Google Service Account format: "${sa}". Must be a valid GCE compute or IAM service account.`);
  }
}

/**
 * Validates and transforms a Cloud Run Knative Service manifest
 * into an atomic, declarative desired-state manifest:
 * - Converts sensitive variables from literal to Secret Manager references.
 * - Enforces environment-specific ordinary variables with zero overlap.
 * - Pins 100% traffic strictly to the verified serving revision.
 * - Preserves all container resources, ports, annotations, and service account.
 * - Strips template revision name so Cloud Run generates a fresh revision.
 */
export function transformServiceManifest(options: TransformOptions): TransformResult {
  const {
    inputYamlContent,
    imageDigest,
    ordinaryEnvOverrides = {},
    serviceName,
  } = options;

  const requestedServiceName = serviceName ?? EXPECTED_SERVICE_NAME;

  if (!ALLOWED_SERVICE_NAMES.includes(requestedServiceName as any)) {
    throw new Error(`Unsupported service name: "${requestedServiceName}". Supported services are: ${ALLOWED_SERVICE_NAMES.join(', ')}`);
  }

  // Infer or validate environment
  let resolvedEnv: 'production' | 'staging';
  if (options.environment) {
    if (options.environment !== 'production' && options.environment !== 'staging') {
      throw new Error(`Invalid environment name: "${options.environment}". Must be "production" or "staging".`);
    }
    resolvedEnv = options.environment;
  } else {
    resolvedEnv = requestedServiceName === 'echonote-staging' ? 'staging' : 'production';
  }

  // Cross-validation of environment and service name
  if (resolvedEnv === 'staging' && requestedServiceName !== 'echonote-staging') {
    throw new Error(`Service name "${requestedServiceName}" is invalid for staging environment. Expected "echonote-staging".`);
  }
  if (resolvedEnv === 'production' && requestedServiceName === 'echonote-staging') {
    throw new Error(`Service name "${requestedServiceName}" is invalid for production environment.`);
  }

  // 1. Serving revision resolution and validation
  let servingRevision = options.servingRevision;
  if (!servingRevision) {
    // For unit tests and backwards compatibility in programmatic transformation,
    // if options.servingRevision is omitted, use the test fixture baseline for production.
    // However, if specified, it must be validated.
    if (resolvedEnv === 'production') {
      servingRevision = TEST_FIXTURE_BASELINE_REVISION;
    } else {
      throw new Error('Serving revision is required for staging manifest transformation.');
    }
  }

  validateRevisionFormat(servingRevision);

  // 2. Service account resolution and validation
  let expectedServiceAccount: string;
  if (resolvedEnv === 'production') {
    expectedServiceAccount = options.serviceAccount ?? EXPECTED_SERVICE_ACCOUNT;
    if (expectedServiceAccount !== EXPECTED_SERVICE_ACCOUNT) {
      throw new Error(`Production requires service account "${EXPECTED_SERVICE_ACCOUNT}", got "${expectedServiceAccount}"`);
    }
  } else {
    // Staging requires an explicitly supplied service account (via options or CLI)
    const suppliedSa = options.serviceAccount || process.env.STAGING_SERVICE_ACCOUNT;
    if (!suppliedSa || typeof suppliedSa !== 'string' || suppliedSa.trim() === '') {
      throw new Error('Missing required staging service account. You must explicitly supply a valid staging service account via --service-account=<email> or STAGING_SERVICE_ACCOUNT.');
    }
    expectedServiceAccount = suppliedSa.trim();
    validateServiceAccountFormat(expectedServiceAccount);

    // Reject accidental substitution of production service account into staging
    if (expectedServiceAccount === EXPECTED_SERVICE_ACCOUNT) {
      throw new Error('[STAGING ISOLATION BREACH]: Cannot use production service account in staging.');
    }
  }

  const expectedArtifactRegistry = resolvedEnv === 'staging' ? STAGING_ARTIFACT_REGISTRY : EXPECTED_ARTIFACT_REGISTRY;

  // Cross-environment repository leakage protection
  if (resolvedEnv === 'staging' && expectedArtifactRegistry === EXPECTED_ARTIFACT_REGISTRY) {
    throw new Error('[STAGING ISOLATION BREACH]: Cannot use production Artifact Registry in staging.');
  }
  if (resolvedEnv === 'production' && expectedArtifactRegistry === STAGING_ARTIFACT_REGISTRY) {
    throw new Error('[PRODUCTION GUARD]: Cannot use staging Artifact Registry in production.');
  }

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

  // Validate Service metadata
  const actualName = doc.metadata?.name;
  if (actualName !== requestedServiceName) {
    throw new Error(`Service name mismatch: expected "${requestedServiceName}", got "${actualName}"`);
  }

  // Strip stale run.googleapis.com/sources annotations if present
  if (doc.metadata?.annotations) {
    delete doc.metadata.annotations['run.googleapis.com/sources'];
  }

  const namespace = doc.metadata?.namespace;

  if (resolvedEnv === 'production') {
    if (
      namespace &&
      namespace !== EXPECTED_PROJECT_ID &&
      namespace !== PRODUCTION_PROJECT_NUMBER
    ) {
      throw new Error(
        `Namespace mismatch: expected "${EXPECTED_PROJECT_ID}" or project number "${PRODUCTION_PROJECT_NUMBER}", got "${namespace}"`
      );
    }
  } else {
    if (
      namespace &&
      namespace !== STAGING_PROJECT_ID &&
      namespace !== STAGING_PROJECT_NUMBER
    ) {
      throw new Error(
        `Namespace mismatch: expected "${STAGING_PROJECT_ID}" or project number "${STAGING_PROJECT_NUMBER}", got "${namespace}"`
      );
    }
  }

  // Validate Template Spec
  if (!doc.spec || !doc.spec.template || !doc.spec.template.spec) {
    throw new Error('Invalid Service document: missing spec.template.spec');
  }

  const templateSpec = doc.spec.template.spec;
  const serviceAccount = templateSpec.serviceAccountName;
  if (serviceAccount !== expectedServiceAccount) {
    throw new Error(`Service account mismatch: expected "${expectedServiceAccount}", got "${serviceAccount}"`);
  }

  const containers = templateSpec.containers;
  if (!Array.isArray(containers) || containers.length === 0) {
    throw new Error('Invalid Service document: spec.template.spec.containers is empty or not an array');
  }

  const container = containers[0];

  // Strip previous revision name and stale source annotations from template metadata
  if (doc.spec.template.metadata) {
    delete doc.spec.template.metadata.name;
    if (doc.spec.template.metadata.annotations) {
      delete doc.spec.template.metadata.annotations['run.googleapis.com/sources'];
    }
  }

  // Update container image to pinned immutable digest
  const expectedImageUri = `${expectedArtifactRegistry}@${imageDigest}`;
  container.image = expectedImageUri;

  // Construct atomic desired env entries
  let baseDefaults: Record<string, string>;
  let ordinaryKeys: string[];

  if (resolvedEnv === 'production') {
    baseDefaults = { ...DEFAULT_ORDINARY_ENV_VARS };
    ordinaryKeys = [
      'RAZORPAY_MODE',
      'RAZORPAY_KEY_ID',
      'NODE_ENV',
      'ALLOW_PRODUCTION_RESOURCES',
      'APP_URL',
      'RESEND_FROM_EMAIL',
      'RAZORPAY_PRO_MONTHLY_PLAN_ID',
      'RAZORPAY_PRO_YEARLY_PLAN_ID',
      'RAZORPAY_TEAM_MONTHLY_PLAN_ID',
      'RAZORPAY_TEAM_YEARLY_PLAN_ID',
    ];
  } else {
    baseDefaults = { ...DEFAULT_STAGING_ORDINARY_ENV_VARS };
    ordinaryKeys = [
      'RAZORPAY_MODE',
      'RAZORPAY_KEY_ID',
      'NODE_ENV',
      'STAGING_ISOLATION_REQUIRED',
      'STAGING_EMAIL_DELIVERY_ENABLED',
      'GOOGLE_CLOUD_PROJECT',
      'FIRESTORE_DATABASE_ID',
      'STORAGE_BUCKET',
      'SCHEDULER_SERVICE_ACCOUNT',
      'SCHEDULER_OIDC_AUDIENCE',
      'APP_URL',
      'RESEND_FROM_EMAIL',
      'RAZORPAY_PRO_MONTHLY_PLAN_ID',
      'RAZORPAY_PRO_YEARLY_PLAN_ID',
      'RAZORPAY_TEAM_MONTHLY_PLAN_ID',
      'RAZORPAY_TEAM_YEARLY_PLAN_ID',
    ];
  }

  const ordinaryValues: Record<string, string | undefined> = {
    ...baseDefaults,
    RAZORPAY_KEY_ID: 'RAZORPAY_KEY_ID' in ordinaryEnvOverrides
      ? ordinaryEnvOverrides.RAZORPAY_KEY_ID
      : ((resolvedEnv === 'staging' && process.env.RAZORPAY_KEY_ID && !process.env.RAZORPAY_KEY_ID.startsWith('rzp_test_'))
          ? STAGING_DEFAULT_RAZORPAY_KEY_ID
          : (process.env.RAZORPAY_KEY_ID || (resolvedEnv === 'staging' ? STAGING_DEFAULT_RAZORPAY_KEY_ID : undefined))),
    ...ordinaryEnvOverrides,
  };

  // Fail-closed checks for Staging Isolation
  if (resolvedEnv === 'staging') {
    if (ordinaryValues.ALLOW_PRODUCTION_RESOURCES === 'true') {
      throw new Error('[STAGING ISOLATION BREACH]: ALLOW_PRODUCTION_RESOURCES must NOT be enabled in staging.');
    }
    if (ordinaryValues.NODE_ENV !== 'staging') {
      throw new Error(`[STAGING ISOLATION BREACH]: NODE_ENV must be "staging", got "${ordinaryValues.NODE_ENV}".`);
    }
    if (ordinaryValues.STAGING_ISOLATION_REQUIRED !== 'true') {
      throw new Error('[STAGING ISOLATION BREACH]: STAGING_ISOLATION_REQUIRED must be "true".');
    }
    // Prevent accidental production resource leakage into staging
    if (ordinaryValues.GOOGLE_CLOUD_PROJECT === EXPECTED_PROJECT_ID) {
      throw new Error(`[STAGING ISOLATION BREACH]: Cannot use production GOOGLE_CLOUD_PROJECT '${EXPECTED_PROJECT_ID}' in staging.`);
    }
    if (ordinaryValues.FIRESTORE_DATABASE_ID === 'ai-studio-eb588566-0d1e-4ef9-bca0-1194fd2bb6d5') {
      throw new Error('[STAGING ISOLATION BREACH]: Cannot use production FIRESTORE_DATABASE_ID in staging.');
    }
    if (ordinaryValues.STORAGE_BUCKET === 'echonote-2509.firebasestorage.app') {
      throw new Error('[STAGING ISOLATION BREACH]: Cannot use production STORAGE_BUCKET in staging.');
    }
    // Fail closed if required staging variables are missing or empty
    if (!ordinaryValues.GOOGLE_CLOUD_PROJECT || ordinaryValues.GOOGLE_CLOUD_PROJECT.trim() === '') {
      throw new Error('[STAGING CONFIG ERROR]: GOOGLE_CLOUD_PROJECT must be configured for staging.');
    }
    if (!ordinaryValues.FIRESTORE_DATABASE_ID || ordinaryValues.FIRESTORE_DATABASE_ID.trim() === '') {
      throw new Error('[STAGING CONFIG ERROR]: FIRESTORE_DATABASE_ID must be configured for staging.');
    }
    if (!ordinaryValues.STORAGE_BUCKET || ordinaryValues.STORAGE_BUCKET.trim() === '') {
      throw new Error('[STAGING CONFIG ERROR]: STORAGE_BUCKET must be configured for staging.');
    }
    if (!ordinaryValues.SCHEDULER_SERVICE_ACCOUNT || ordinaryValues.SCHEDULER_SERVICE_ACCOUNT.trim() === '') {
      throw new Error('[STAGING CONFIG ERROR]: SCHEDULER_SERVICE_ACCOUNT must be configured for staging.');
    }
    if (!ordinaryValues.SCHEDULER_OIDC_AUDIENCE || ordinaryValues.SCHEDULER_OIDC_AUDIENCE.trim() === '') {
      throw new Error('[STAGING CONFIG ERROR]: SCHEDULER_OIDC_AUDIENCE must be configured for staging.');
    }
  }

  // Fail-closed checks for Production Guards
  if (resolvedEnv === 'production') {
    if (ordinaryValues.NODE_ENV !== 'production') {
      throw new Error(`[PRODUCTION GUARD]: NODE_ENV must be "production", got "${ordinaryValues.NODE_ENV}".`);
    }
    if (ordinaryValues.ALLOW_PRODUCTION_RESOURCES !== 'true') {
      throw new Error('[PRODUCTION GUARD]: ALLOW_PRODUCTION_RESOURCES must be "true" for production.');
    }
    if (ordinaryValues.STAGING_ISOLATION_REQUIRED === 'true') {
      throw new Error('[PRODUCTION GUARD]: STAGING_ISOLATION_REQUIRED must NOT be set in production.');
    }
  }

  // Validate RAZORPAY_KEY_ID and RAZORPAY_MODE
  const mode = ordinaryValues.RAZORPAY_MODE || (resolvedEnv === 'production' ? 'live' : 'test');
  const keyId = ordinaryValues.RAZORPAY_KEY_ID;

  if (!keyId || typeof keyId !== 'string' || keyId.trim() === '') {
    throw new Error('Missing required RAZORPAY_KEY_ID environment variable.');
  }

  const liveKeyRegex = /^rzp_live_[A-Za-z0-9]+$/;
  const testKeyRegex = /^rzp_test_[A-Za-z0-9]+$/;

  if (mode === 'live' && !liveKeyRegex.test(keyId)) {
    throw new Error('Invalid RAZORPAY_KEY_ID for mode "live": must start with "rzp_live_" and match pattern /^rzp_live_[A-Za-z0-9]+$/.');
  }

  if (mode === 'test' && !testKeyRegex.test(keyId)) {
    throw new Error('Invalid RAZORPAY_KEY_ID for mode "test": must start with "rzp_test_" and match pattern /^rzp_test_[A-Za-z0-9]+$/.');
  }

  if (mode !== 'live' && mode !== 'test') {
    throw new Error(`Invalid RAZORPAY_MODE: "${mode}". Mode must be "live" or "test".`);
  }

  if (resolvedEnv === 'production' && mode !== 'live') {
    throw new Error(`Invalid RAZORPAY_MODE: "${mode}". Production requires "live".`);
  }

  if (resolvedEnv === 'staging' && mode !== 'test') {
    throw new Error(`Invalid RAZORPAY_MODE: "${mode}". Staging requires "test".`);
  }

  // Validate plan IDs regex
  const planRegex = /^plan_[A-Za-z0-9_]+$/;
  const planKeys: (keyof OrdinaryEnvVarConfig)[] = [
    'RAZORPAY_PRO_MONTHLY_PLAN_ID',
    'RAZORPAY_PRO_YEARLY_PLAN_ID',
    'RAZORPAY_TEAM_MONTHLY_PLAN_ID',
    'RAZORPAY_TEAM_YEARLY_PLAN_ID',
  ];
  for (const k of planKeys) {
    const val = ordinaryValues[k];
    if (!val || !planRegex.test(val)) {
      throw new Error(`Invalid plan ID for ${k}: "${val}". Must match ^plan_[A-Za-z0-9_]+$`);
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

  for (const key of ordinaryKeys) {
    desiredEnv.push({
      name: key,
      value: String(ordinaryValues[key]),
    });
  }

  // Add secret variables with secretKeyRef
  const activeSecretMappings: SecretMapping[] = [];

  if (resolvedEnv === 'production') {
    // Production unconditionally maps all 9 production secrets
    activeSecretMappings.push(...PRODUCTION_SECRET_MAPPINGS);
  } else {
    // Staging maps core verified secrets that exist in staging Secret Manager
    activeSecretMappings.push(...STAGING_CORE_SECRET_MAPPINGS);

    // Check optional features that require absent secrets:
    // If an optional feature is enabled, verify the secret is explicitly made available,
    // otherwise fail closed with clear error without inventing dummy credentials.
    const isEmailDeliveryEnabled = ordinaryValues.STAGING_EMAIL_DELIVERY_ENABLED === 'true';
    if (isEmailDeliveryEnabled) {
      const available = options.stagingSecretsAvailable || [];
      if (!available.includes('echonote-resend-api-key')) {
        throw new Error(
          `[STAGING CONFIG ERROR]: Feature 'email_delivery' is enabled (STAGING_EMAIL_DELIVERY_ENABLED=true), but required secret 'echonote-resend-api-key' is not configured in staging Secret Manager.`
        );
      }
      activeSecretMappings.push(STAGING_OPTIONAL_FEATURE_SECRETS.email_delivery);
    }

    if (options.enabledIntegrations?.includes('zoom')) {
      const available = options.stagingSecretsAvailable || [];
      if (!available.includes('echonote-zoom-webhook-secret')) {
        throw new Error(
          `[STAGING CONFIG ERROR]: Feature 'zoom' is enabled, but required secret 'echonote-zoom-webhook-secret' is not configured in staging Secret Manager.`
        );
      }
      activeSecretMappings.push(STAGING_OPTIONAL_FEATURE_SECRETS.zoom_webhook);
    }

    if (options.enabledIntegrations?.includes('razorpay')) {
      const available = options.stagingSecretsAvailable || [];
      if (!available.includes('echonote-razorpay-key-secret')) {
        throw new Error(
          `[STAGING CONFIG ERROR]: Feature 'razorpay' is enabled, but required secret 'echonote-razorpay-key-secret' is not configured in staging Secret Manager.`
        );
      }
      activeSecretMappings.push(STAGING_OPTIONAL_FEATURE_SECRETS.razorpay);
    }

    if (options.enabledIntegrations?.includes('third_party_credentials')) {
      const available = options.stagingSecretsAvailable || [];
      if (!available.includes('echonote-integration-encryption-key')) {
        throw new Error(
          `[STAGING CONFIG ERROR]: Feature 'third_party_credentials' is enabled, but required secret 'echonote-integration-encryption-key' is not configured in staging Secret Manager.`
        );
      }
      activeSecretMappings.push(STAGING_OPTIONAL_FEATURE_SECRETS.integration_encryption);
    }

    if (options.enabledIntegrations?.includes('playback_signing')) {
      const available = options.stagingSecretsAvailable || [];
      const secretName = available.includes('PLAYBACK_SECRET')
        ? 'PLAYBACK_SECRET'
        : 'echonote-playback-secret';
      if (!available.includes('echonote-playback-secret') && !available.includes('PLAYBACK_SECRET')) {
        throw new Error(
          `[STAGING CONFIG ERROR]: Feature 'playback_signing' is enabled, but required secret 'echonote-playback-secret' or 'PLAYBACK_SECRET' is not configured in staging Secret Manager.`
        );
      }
      activeSecretMappings.push({
        name: 'PLAYBACK_SECRET',
        secretName,
        secretKey: 'latest',
      });
    }

    // Strict staging isolation check: reject any production secret substitution or production project reference
    for (const mapping of activeSecretMappings) {
      if (mapping.secretName.includes('2509') || mapping.secretName === 'echonote-report-download-secret') {
        throw new Error(
          `[STAGING ISOLATION BREACH]: Production secret '${mapping.secretName}' cannot be referenced in staging.`
        );
      }
    }
  }

  for (const secret of activeSecretMappings) {
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

  const expectedTotalEnvCount = ordinaryKeys.length + activeSecretMappings.length;
  if (desiredEnv.length !== expectedTotalEnvCount) {
    throw new Error(`Expected exactly ${expectedTotalEnvCount} environment entries, got ${desiredEnv.length}`);
  }

  container.env = desiredEnv;

  // Explicitly preserve existing serving revision at 100% traffic
  doc.spec.traffic = [
    {
      percent: 100,
      revisionName: servingRevision,
    },
  ];

  // Serialize to clean Knative YAML
  const transformedYaml = YAML.stringify(doc, {
    indent: 2,
    lineWidth: 0,
  });

  return {
    yaml: transformedYaml,
    ordinaryVarCount: ordinaryKeys.length,
    secretVarCount: activeSecretMappings.length,
    imageUri: expectedImageUri,
    pinnedServingRevision: servingRevision,
    serviceAccount: expectedServiceAccount,
    serviceName: requestedServiceName,
    environment: resolvedEnv,
  };
}

// CLI Execution Handler
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename || '')) {
  try {
    const args = process.argv.slice(2);
    let inputYamlPath = '';
    let outputYamlPath = '';
    let imageDigest = '';
    let servingRevision: string | undefined;
    let serviceName = EXPECTED_SERVICE_NAME;
    let environment: 'production' | 'staging' | undefined;
    let serviceAccount: string | undefined;

    for (const arg of args) {
      if (arg.startsWith('--input=')) {
        inputYamlPath = arg.substring('--input='.length);
      } else if (arg.startsWith('--output=')) {
        outputYamlPath = arg.substring('--output='.length);
      } else if (arg.startsWith('--digest=')) {
        imageDigest = arg.substring('--digest='.length);
      } else if (arg.startsWith('--serving-revision=')) {
        servingRevision = arg.substring('--serving-revision='.length);
      } else if (arg.startsWith('--service-name=')) {
        serviceName = arg.substring('--service-name='.length);
      } else if (arg.startsWith('--service-account=')) {
        serviceAccount = arg.substring('--service-account='.length);
      } else if (arg.startsWith('--environment=')) {
        const envVal = arg.substring('--environment='.length);
        if (envVal === 'production' || envVal === 'staging') {
          environment = envVal;
        } else {
          throw new Error(`Invalid environment: "${envVal}". Must be "production" or "staging".`);
        }
      }
    }

    if (!inputYamlPath || !outputYamlPath || !imageDigest) {
      console.error('Usage: tsx scripts/prepare-declarative-service.ts --input=<service.yaml> --output=<desired.yaml> --digest=<sha256:...> --serving-revision=<rev> [--environment=<production|staging>] [--service-name=<name>] [--service-account=<email>]');
      process.exit(1);
    }

    // Refinement 1: CLI requires explicit --serving-revision to prevent silent fallback to historical fixtures
    if (!servingRevision || servingRevision.trim() === '') {
      console.error('ERROR: Missing required --serving-revision argument in CLI invocation. Silent fallback to historical revisions is strictly disabled.');
      process.exit(1);
    }

    validateRevisionFormat(servingRevision);

    const inputContent = fs.readFileSync(inputYamlPath, 'utf8');
    const result = transformServiceManifest({
      inputYamlContent: inputContent,
      imageDigest,
      servingRevision,
      serviceName,
      environment,
      serviceAccount,
      ordinaryEnvOverrides: {
        ...(process.env.RAZORPAY_KEY_ID ? { RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID } : {}),
        ...(process.env.STAGING_EMAIL_DELIVERY_ENABLED ? { STAGING_EMAIL_DELIVERY_ENABLED: process.env.STAGING_EMAIL_DELIVERY_ENABLED } : {}),
        ...(process.env.APP_URL ? { APP_URL: process.env.APP_URL } : {}),
        ...(process.env.GOOGLE_CLOUD_PROJECT ? { GOOGLE_CLOUD_PROJECT: process.env.GOOGLE_CLOUD_PROJECT } : {}),
        ...(process.env.FIRESTORE_DATABASE_ID ? { FIRESTORE_DATABASE_ID: process.env.FIRESTORE_DATABASE_ID } : {}),
        ...(process.env.STORAGE_BUCKET ? { STORAGE_BUCKET: process.env.STORAGE_BUCKET } : {}),
        ...(process.env.SCHEDULER_SERVICE_ACCOUNT ? { SCHEDULER_SERVICE_ACCOUNT: process.env.SCHEDULER_SERVICE_ACCOUNT } : {}),
        ...(process.env.SCHEDULER_OIDC_AUDIENCE ? { SCHEDULER_OIDC_AUDIENCE: process.env.SCHEDULER_OIDC_AUDIENCE } : {}),
        ...(process.env.RAZORPAY_PRO_MONTHLY_PLAN_ID ? { RAZORPAY_PRO_MONTHLY_PLAN_ID: process.env.RAZORPAY_PRO_MONTHLY_PLAN_ID } : {}),
        ...(process.env.RAZORPAY_PRO_YEARLY_PLAN_ID ? { RAZORPAY_PRO_YEARLY_PLAN_ID: process.env.RAZORPAY_PRO_YEARLY_PLAN_ID } : {}),
        ...(process.env.RAZORPAY_TEAM_MONTHLY_PLAN_ID ? { RAZORPAY_TEAM_MONTHLY_PLAN_ID: process.env.RAZORPAY_TEAM_MONTHLY_PLAN_ID } : {}),
        ...(process.env.RAZORPAY_TEAM_YEARLY_PLAN_ID ? { RAZORPAY_TEAM_YEARLY_PLAN_ID: process.env.RAZORPAY_TEAM_YEARLY_PLAN_ID } : {}),
      },
    });

    // Write file with strict 0600 mode permissions
    fs.writeFileSync(outputYamlPath, result.yaml, { mode: 0o600, encoding: 'utf8' });

    console.log('✅ Declarative Cloud Run Service Specification generated successfully:');
    console.log(`   Environment:              ${result.environment}`);
    console.log(`   Service Name:             ${result.serviceName}`);
    console.log(`   Service Account:          ${result.serviceAccount} (${result.environment === 'production' ? 'production default verified' : 'explicitly supplied staging account'})`);
    console.log(`   Immutable Image URI:      ${result.imageUri}`);
    console.log(`   Ordinary Variables:       ${result.ordinaryVarCount} configured`);
    console.log(`   Secret Manager Mappings:  ${result.secretVarCount} mapped to Secret Manager`);
    console.log(`   Traffic Specification:    100% pinned to verified ${result.pinnedServingRevision} (0% to new revision)`);
    console.log(`   Output Manifest:          ${outputYamlPath} (permissions 0600)`);
  } catch (err: any) {
    console.error(`ERROR: ${err?.message || err}`);
    process.exit(1);
  }
}
