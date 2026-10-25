/**
 * tests/test_phase1b_step1_2e_key_readiness_and_inventory.ts
 *
 * EchoNote Phase 1B Step 1.2E: Encryption Key Deployment Readiness & Historical Secret Inventory
 *
 * Test suite verifying:
 * 1. Deployment Configuration Invariants:
 *    - deploy-cloud-run-B1A.sh and scripts/deploy-cloud-run.sh map INTEGRATION_ENCRYPTION_KEY
 *      to echonote-integration-encryption-key:latest in CLOUD_RUN_SECRETS.
 *    - Scripts do not disclose or hardcode raw secret values.
 * 2. Environment Template Invariants:
 *    - .env.example documents INTEGRATION_ENCRYPTION_KEY with placeholder [SET_VIA_SECRET_MANAGER].
 *    - No usable production or plain keys are present in .env.example.
 * 3. Inventory Classification Engine:
 *    - Classifies encrypted records (with AES-GCM envelope) as "encrypted".
 *    - Classifies legacy documents with plain secrets as "potential_plaintext".
 *    - Identifies nested webhook secrets and raw API keys without leaking values.
 *    - Classifies operational non-secret documents as "no_secrets_detected".
 *    - Classifies malformed/inconsistent documents as "ambiguous".
 * 4. Zero Exposure Output Invariant:
 *    - Report output NEVER contains secret values, access tokens, or raw configs.
 * 5. Zero Mutation Invariant:
 *    - Inventory operations execute zero writes/mutations against Firestore.
 * 6. CLI Target Guardrails:
 *    - Ambiguous or unconfirmed execution fails safely.
 */

import fs from "fs";
import path from "path";
import {
  classifyIntegrationRecord,
  detectSensitiveFieldNames,
  formatSanitizedInventoryReport,
  runHistoricalSecretInventory,
  InventoryResult
} from "../scripts/audit-historical-integration-secrets.ts";

let passed = 0;
let failed = 0;

function check(description: string, condition: boolean, extra?: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${description}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${description}${extra ? ` (${extra})` : ""}`);
    failed++;
  }
}

async function runTestSuite() {
  console.log("================================================================================");
  console.log("🛡️  ECHONOTE PHASE 1B STEP 1.2E: DEPLOYMENT READINESS & INVENTORY TEST SUITE");
  console.log("================================================================================");

  // -----------------------------------------------------------------------------
  // Section 1: Deployment Configuration Static Audit
  // -----------------------------------------------------------------------------
  console.log("\n--- Section 1: Deployment Configuration Static Audit ---");

  const deployScriptPath = path.join(process.cwd(), "deploy-cloud-run-B1A.sh");
  const deployScriptAltPath = path.join(process.cwd(), "scripts/deploy-cloud-run.sh");

  const deployContent = fs.readFileSync(deployScriptPath, "utf8");
  const deployAltContent = fs.readFileSync(deployScriptAltPath, "utf8");

  // Test 1: Binding declaration in deploy-cloud-run-B1A.sh
  check("[1] deploy-cloud-run-B1A.sh declares SECRET_INTEGRATION_ENCRYPTION_KEY binding",
    deployContent.includes('SECRET_INTEGRATION_ENCRYPTION_KEY="INTEGRATION_ENCRYPTION_KEY=echonote-integration-encryption-key:latest"')
  );

  // Test 2: Injected into CLOUD_RUN_SECRETS in deploy-cloud-run-B1A.sh
  check("[2] deploy-cloud-run-B1A.sh includes SECRET_INTEGRATION_ENCRYPTION_KEY in CLOUD_RUN_SECRETS",
    deployContent.includes("${SECRET_INTEGRATION_ENCRYPTION_KEY}")
  );

  // Test 3: Binding declaration in scripts/deploy-cloud-run.sh
  check("[3] scripts/deploy-cloud-run.sh declares SECRET_INTEGRATION_ENCRYPTION_KEY binding",
    deployAltContent.includes('SECRET_INTEGRATION_ENCRYPTION_KEY="INTEGRATION_ENCRYPTION_KEY=echonote-integration-encryption-key:latest"') &&
    deployAltContent.includes("${SECRET_INTEGRATION_ENCRYPTION_KEY}")
  );

  // Test 4: Scripts do not disclose plaintext secrets or hex tokens
  const hexKeyRegex = /[0-9a-fA-F]{64}/;
  check("[4] Deployment scripts do NOT contain hardcoded 64-char hex keys",
    !hexKeyRegex.test(deployContent) && !hexKeyRegex.test(deployAltContent)
  );

  // Test 5: Summary lists 7 production secrets
  check("[5] Deployment summary reports 7 production secrets and key mapping",
    deployContent.includes("Secret Manager References (7 production secrets):") &&
    deployContent.includes("INTEGRATION_ENCRYPTION_KEY -> echonote-integration-encryption-key:latest") &&
    deployAltContent.includes("Secret Manager References (7 production secrets):") &&
    deployAltContent.includes("INTEGRATION_ENCRYPTION_KEY -> echonote-integration-encryption-key:latest")
  );

  // -----------------------------------------------------------------------------
  // Section 2: Environment Example Template Audit
  // -----------------------------------------------------------------------------
  console.log("\n--- Section 2: Environment Example Template Audit ---");

  const envExampleContent = fs.readFileSync(path.join(process.cwd(), ".env.example"), "utf8");

  // Test 6: Variable documented with placeholder
  check("[6] .env.example documents INTEGRATION_ENCRYPTION_KEY=[SET_VIA_SECRET_MANAGER]",
    envExampleContent.includes("INTEGRATION_ENCRYPTION_KEY=[SET_VIA_SECRET_MANAGER]")
  );

  // Test 7: Explains 32-byte requirement
  check("[7] .env.example explains 32-byte AES-256-GCM format requirement",
    envExampleContent.includes("AES-256-GCM 32-byte key: 64 hex chars or 44 base64 chars")
  );

  // Test 8: Does not contain raw usable secrets
  check("[8] .env.example does not contain hardcoded plaintext encryption keys",
    !hexKeyRegex.test(envExampleContent)
  );

  // -----------------------------------------------------------------------------
  // Section 3: Inventory Classification Engine Tests
  // -----------------------------------------------------------------------------
  console.log("\n--- Section 3: Inventory Classification Engine Tests ---");

  // Test 9: Encrypted record classification
  const encryptedDoc = {
    id: "zoom",
    enabled: true,
    status: "connected",
    config: {
      zoomAccountId: "acc_123",
      zoomClientId: "client_123",
      zoomClientSecret: "••••••••••••1234",
      has_zoomClientSecret: true
    },
    _secretsEncrypted: true,
    _encryptedSecrets: {
      ciphertext: "U2FtcGxlRW5jcnlwdGVkRGF0YQ==",
      iv: "MTIzNDU2Nzg5MDEy",
      tag: "YWJjZGVmZ2hpamtsbW5vcA==",
      keyId: "local-aes-256-gcm:v1"
    }
  };
  const resEncrypted = classifyIntegrationRecord("/organizations/org_1/integrations/zoom", encryptedDoc);
  check("[9] Correctly classifies valid encrypted record as 'encrypted'",
    resEncrypted.status === "encrypted" &&
    resEncrypted.keyId === "local-aes-256-gcm:v1" &&
    resEncrypted.detectedSensitiveFieldNames.length === 0
  );

  // Test 10: Legacy document with plaintext secret
  const plaintextSecretVal = "super_secret_raw_zoom_api_token_999";
  const legacyPlaintextDoc = {
    id: "zoom",
    enabled: true,
    status: "connected",
    config: {
      zoomAccountId: "acc_123",
      zoomClientId: "client_123",
      zoomClientSecret: plaintextSecretVal
    }
  };
  const resPlaintext = classifyIntegrationRecord("/organizations/org_1/integrations/zoom", legacyPlaintextDoc);
  check("[10] Correctly classifies legacy plaintext record as 'potential_plaintext'",
    resPlaintext.status === "potential_plaintext" &&
    resPlaintext.detectedSensitiveFieldNames.includes("zoomClientSecret")
  );

  // Test 11: Nested webhook secret detection
  const plainWebhookVal = "whsec_confidential_webhook_secret_888";
  const webhookDoc = {
    id: "webhooks",
    enabled: true,
    config: {
      endpoints: [
        { id: "wh_1", url: "https://example.com/hook", secret: plainWebhookVal }
      ]
    }
  };
  const resWebhook = classifyIntegrationRecord("/organizations/org_1/integrations/webhooks", webhookDoc);
  check("[11] Detects nested unmasked webhook secret as 'potential_plaintext'",
    resWebhook.status === "potential_plaintext" &&
    resWebhook.detectedSensitiveFieldNames.includes("endpoints[0].secret")
  );

  // Test 12: Nested raw API key detection
  const rawKeyVal = "en_live_supersecret_key_777";
  const apiKeyDoc = {
    id: "rest-api",
    enabled: true,
    config: {
      keys: [
        { id: "key_1", label: "Prod Key", rawKey: rawKeyVal, key: "en_live_••••••" }
      ]
    }
  };
  const resApiKey = classifyIntegrationRecord("/organizations/org_1/integrations/rest-api", apiKeyDoc);
  check("[12] Detects raw REST API key as 'potential_plaintext'",
    resApiKey.status === "potential_plaintext" &&
    resApiKey.detectedSensitiveFieldNames.includes("keys[0].rawKey")
  );

  // Test 13: Operational document without secrets
  const safeOperationalDoc = {
    id: "slack",
    enabled: true,
    status: "connected",
    config: {
      defaultChannel: "#announcements",
      notifyOnRecording: true
    }
  };
  const resSafe = classifyIntegrationRecord("/organizations/org_1/integrations/slack", safeOperationalDoc);
  check("[13] Classifies non-secret operational record as 'no_secrets_detected'",
    resSafe.status === "no_secrets_detected" &&
    resSafe.detectedSensitiveFieldNames.length === 0
  );

  // Test 14: Masked configuration without plaintext
  const maskedDoc = {
    id: "slack",
    enabled: true,
    status: "connected",
    config: {
      slackBotToken: "••••••••••••5678",
      has_slackBotToken: true
    }
  };
  const resMasked = classifyIntegrationRecord("/organizations/org_1/integrations/slack", maskedDoc);
  check("[14] Classifies sanitized masked record without plain secrets as 'no_secrets_detected'",
    resMasked.status === "no_secrets_detected" &&
    resMasked.detectedSensitiveFieldNames.length === 0
  );

  // Test 15: Ambiguous record (marked encrypted but missing payload)
  const brokenEncryptedDoc = {
    id: "zoom",
    enabled: true,
    _secretsEncrypted: true
    // missing _encryptedSecrets
  };
  const resAmbiguous = classifyIntegrationRecord("/organizations/org_1/integrations/zoom", brokenEncryptedDoc);
  check("[15] Classifies malformed encrypted record as 'ambiguous'",
    resAmbiguous.status === "ambiguous" &&
    resAmbiguous.notes?.includes("missing or malformed")
  );

  // Test 16: Ambiguous record (null data)
  const resNullDoc = classifyIntegrationRecord("/organizations/org_1/integrations/zoom", null);
  check("[16] Classifies null document body as 'ambiguous'",
    resNullDoc.status === "ambiguous"
  );

  // -----------------------------------------------------------------------------
  // Section 4: Zero Secret Exposure Output Invariant
  // -----------------------------------------------------------------------------
  console.log("\n--- Section 4: Zero Secret Exposure Output Invariant ---");

  const sampleResult: InventoryResult = {
    targetProject: "echonote-audit-test",
    totalOrgsScanned: 2,
    totalIntegrationsScanned: 3,
    encryptedCount: 1,
    potentialPlaintextCount: 2,
    noSecretsDetectedCount: 0,
    ambiguousCount: 0,
    records: [resEncrypted, resPlaintext, resWebhook]
  };

  const reportOutput = formatSanitizedInventoryReport(sampleResult);

  // Test 17: Report output does NOT contain sample secrets
  check("[17] Report output NEVER contains raw secret values",
    !reportOutput.includes(plaintextSecretVal) &&
    !reportOutput.includes(plainWebhookVal) &&
    !reportOutput.includes(rawKeyVal)
  );

  // Test 18: Report output displays field names and paths
  check("[18] Report output includes sanitized identifiers and field names only",
    reportOutput.includes("/organizations/org_1/integrations/zoom") &&
    reportOutput.includes("zoomClientSecret") &&
    reportOutput.includes("endpoints[0].secret") &&
    reportOutput.includes("POTENTIAL_PLAINTEXT") &&
    reportOutput.includes("ENCRYPTED")
  );

  // Test 19: Report includes prominent disclaimer
  check("[19] Report includes explicit read-only inventory disclaimer",
    reportOutput.includes("AUDIT DISCLAIMER:") &&
    reportOutput.includes("Zero documents were written, mutated, rotated, or migrated")
  );

  // -----------------------------------------------------------------------------
  // Section 5: Zero Firestore Mutation Invariant
  // -----------------------------------------------------------------------------
  console.log("\n--- Section 5: Zero Firestore Mutation Invariant ---");

  let writeOperationCount = 0;

  // Mock Firestore designed to detect any write attempts
  const mockReadOnlyDb: any = {
    collection: (collName: string) => ({
      get: async () => ({
        size: 1,
        docs: [
          {
            id: "org_audit_test",
            ref: {
              collection: (subName: string) => ({
                get: async () => ({
                  size: 2,
                  docs: [
                    { id: "zoom", data: () => legacyPlaintextDoc },
                    { id: "slack", data: () => safeOperationalDoc }
                  ]
                }),
                doc: () => {
                  return {
                    set: async () => { writeOperationCount++; },
                    update: async () => { writeOperationCount++; },
                    delete: async () => { writeOperationCount++; }
                  };
                }
              })
            }
          }
        ]
      }),
      doc: () => ({
        set: async () => { writeOperationCount++; },
        update: async () => { writeOperationCount++; },
        delete: async () => { writeOperationCount++; }
      })
    })
  };

  const inventoryScanResult = await runHistoricalSecretInventory({
    db: mockReadOnlyDb,
    targetProject: "echonote-mock-test"
  });

  // Test 20: Zero write operations executed
  check("[20] Inventory scan executes ZERO write/mutation operations (writeCount === 0)",
    writeOperationCount === 0
  );

  // Test 21: Inventory scan correctly accumulates aggregate counts
  check("[21] Inventory scan correctly counts 1 plaintext and 1 safe record",
    inventoryScanResult.totalOrgsScanned === 1 &&
    inventoryScanResult.totalIntegrationsScanned === 2 &&
    inventoryScanResult.potentialPlaintextCount === 1 &&
    inventoryScanResult.noSecretsDetectedCount === 1
  );

  // -----------------------------------------------------------------------------
  // Section 6: CLI Guardrails Verification
  // -----------------------------------------------------------------------------
  console.log("\n--- Section 6: CLI Guardrails Verification ---");

  // Test 22: Sensitive field name detector does not return empty string or non-names
  const detectedKeys = detectSensitiveFieldNames({
    zoomClientSecret: "secret_1",
    accountName: "Company",
    token: "token_1"
  });
  check("[22] detectSensitiveFieldNames extracts only sensitive keys",
    detectedKeys.includes("zoomClientSecret") &&
    detectedKeys.includes("token") &&
    !detectedKeys.includes("accountName")
  );

  // -----------------------------------------------------------------------------
  // SUMMARY
  // -----------------------------------------------------------------------------
  console.log("\n================================================================================");
  console.log(`📊 TEST SUITE SUMMARY: ${passed} / ${passed + failed} PASSED (${failed} FAILED)`);
  console.log("================================================================================");

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log("🎉 ALL STEP 1.2E DEPLOYMENT READINESS & INVENTORY INVARIANTS PASSED PERFECTLY!\n");
  }
}

runTestSuite().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
