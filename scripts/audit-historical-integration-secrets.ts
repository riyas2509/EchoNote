/**
 * scripts/audit-historical-integration-secrets.ts
 *
 * EchoNote Phase 1B Step 1.2E: Read-Only Historical Integration Credential Inventory Utility
 *
 * SAFETY INVARIANTS:
 * 1. STRICTLY READ-ONLY: Never writes, modifies, deletes, migrates, or patches any Firestore records.
 * 2. ZERO SECRET EXPOSURE: Never prints, logs, or exports credential values, access tokens,
 *    webhook secrets, encryption keys, decrypted payloads, or raw configuration objects.
 * 3. EXPLICIT ENVIRONMENT SELECTION: Requires explicit project/environment confirmation flag
 *    before executing any live scan. Never runs silently against production.
 * 4. INVENTORY AID DISCLAIMER: Field-name and envelope scanning is an audit aid, not cryptographic
 *    proof that all secrets have been found or classified correctly.
 */

import { Firestore } from "firebase-admin/firestore";
import {
  containsSensitiveSecrets,
  SENSITIVE_INTEGRATION_FIELDS
} from "../lib/integrationSecurity.ts";
import { getAdminFirestore, getFirebaseConfig } from "../lib/firebaseAdmin.ts";

export type CredentialClassificationStatus =
  | "encrypted"
  | "potential_plaintext"
  | "no_secrets_detected"
  | "ambiguous";

export interface RecordClassification {
  docPath: string;
  organizationId: string;
  integrationId: string;
  status: CredentialClassificationStatus;
  detectedSensitiveFieldNames: string[];
  keyId?: string;
  notes?: string;
}

export interface InventoryResult {
  targetProject: string;
  totalOrgsScanned: number;
  totalIntegrationsScanned: number;
  encryptedCount: number;
  potentialPlaintextCount: number;
  noSecretsDetectedCount: number;
  ambiguousCount: number;
  records: RecordClassification[];
}

export interface InventoryOptions {
  db?: Firestore;
  targetProject?: string;
  orgIdFilter?: string;
  silent?: boolean;
}

/**
 * Extracts sensitive field names from a configuration object without exposing any values.
 * Only returns field keys.
 */
export function detectSensitiveFieldNames(config: any): string[] {
  if (!config || typeof config !== "object") {
    return [];
  }

  const detectedKeys = new Set<string>();

  for (const [key, value] of Object.entries(config)) {
    // Skip sanitization metadata flags like has_slackBotToken: true
    if (key.startsWith("has_") || typeof value === "boolean") {
      continue;
    }

    const isSensitiveName =
      SENSITIVE_INTEGRATION_FIELDS.has(key) ||
      key.toLowerCase().includes("secret") ||
      key.toLowerCase().includes("token") ||
      key.toLowerCase().includes("serviceaccount");

    if (isSensitiveName && value !== undefined && value !== null) {
      if (typeof value === "string") {
        // If not already masked with ••••, it is potential plaintext
        if (value.trim().length > 0 && !value.includes("••••")) {
          detectedKeys.add(key);
        }
      } else if (typeof value !== "object") {
        detectedKeys.add(key);
      }
    }

    // Inspect nested webhook endpoints
    if (key === "endpoints" && Array.isArray(value)) {
      value.forEach((ep: any, idx: number) => {
        if (ep && ep.secret && typeof ep.secret === "string" && !ep.secret.includes("••••")) {
          detectedKeys.add(`endpoints[${idx}].secret`);
        }
      });
    }

    // Inspect nested REST API keys
    if (key === "keys" && Array.isArray(value)) {
      value.forEach((k: any, idx: number) => {
        if (k && (k.rawKey || k.keySecret)) {
          detectedKeys.add(`keys[${idx}].rawKey`);
        } else if (k && k.key && typeof k.key === "string" && !k.key.includes("••••")) {
          detectedKeys.add(`keys[${idx}].key`);
        }
      });
    }

    // Inspect nested OAuth clients
    if (key === "clients" && Array.isArray(value)) {
      value.forEach((cl: any, idx: number) => {
        if (cl && cl.secret && typeof cl.secret === "string" && !cl.secret.includes("••••")) {
          detectedKeys.add(`clients[${idx}].secret`);
        }
      });
    }
  }

  return Array.from(detectedKeys);
}

/**
 * Pure classification function for a single integration document.
 * Examines document structure without reading, printing, or mutating secret values.
 */
export function classifyIntegrationRecord(
  docPath: string,
  data: any
): RecordClassification {
  const parts = docPath.replace(/^\//, "").split("/");
  const orgId = parts[1] || "unknown_org";
  const integrationId = parts[3] || "unknown_integration";

  if (!data || typeof data !== "object") {
    return {
      docPath,
      organizationId: orgId,
      integrationId,
      status: "ambiguous",
      detectedSensitiveFieldNames: [],
      notes: "Document body is null or non-object"
    };
  }

  const isMarkedEncrypted = Boolean(data._secretsEncrypted);
  const encryptedPayload = data._encryptedSecrets;

  // Check 1: Encrypted Document Verification
  if (isMarkedEncrypted) {
    if (
      encryptedPayload &&
      typeof encryptedPayload === "object" &&
      typeof encryptedPayload.ciphertext === "string" &&
      typeof encryptedPayload.iv === "string" &&
      typeof encryptedPayload.tag === "string"
    ) {
      return {
        docPath,
        organizationId: orgId,
        integrationId,
        status: "encrypted",
        detectedSensitiveFieldNames: [],
        keyId: encryptedPayload.keyId || "local-aes-256-gcm:v1",
        notes: "Verified AES-GCM envelope metadata present"
      };
    } else {
      return {
        docPath,
        organizationId: orgId,
        integrationId,
        status: "ambiguous",
        detectedSensitiveFieldNames: [],
        notes: "Document marked _secretsEncrypted: true but _encryptedSecrets payload is missing or malformed"
      };
    }
  }

  // Check 2: Potential Plaintext Document Verification
  const config = data.config;
  const sensitiveFieldNames = detectSensitiveFieldNames(config);
  const hasSecretsByHelper = containsSensitiveSecrets(config);

  if (sensitiveFieldNames.length > 0 || hasSecretsByHelper) {
    return {
      docPath,
      organizationId: orgId,
      integrationId,
      status: "potential_plaintext",
      detectedSensitiveFieldNames: sensitiveFieldNames.length > 0 ? sensitiveFieldNames : ["detected_sensitive_fields"],
      notes: "Unencrypted document contains sensitive credential field names with unmasked values"
    };
  }

  // Check 3: Standard Non-Secret Document
  return {
    docPath,
    organizationId: orgId,
    integrationId,
    status: "no_secrets_detected",
    detectedSensitiveFieldNames: [],
    notes: "No unencrypted credential field names or secret payloads detected"
  };
}

/**
 * Runs the historical integration credential audit across Firestore.
 * Strictly read-only; executes zero writes.
 */
export async function runHistoricalSecretInventory(
  options: InventoryOptions = {}
): Promise<InventoryResult> {
  const targetProject = options.targetProject || "unknown_project";
  let db = options.db;

  if (!db) {
    try {
      db = getAdminFirestore();
    } catch (err: any) {
      throw new Error(`Firebase Admin Firestore initialization failed: ${err.message}`);
    }
  }

  const result: InventoryResult = {
    targetProject,
    totalOrgsScanned: 0,
    totalIntegrationsScanned: 0,
    encryptedCount: 0,
    potentialPlaintextCount: 0,
    noSecretsDetectedCount: 0,
    ambiguousCount: 0,
    records: []
  };

  try {
    let orgDocsQuery = db.collection("organizations");
    const orgsSnap = await orgDocsQuery.get();
    result.totalOrgsScanned = orgsSnap.size;

    for (const orgDoc of orgsSnap.docs) {
      if (options.orgIdFilter && orgDoc.id !== options.orgIdFilter) {
        continue;
      }

      const integrationsSnap = await orgDoc.ref.collection("integrations").get();
      result.totalIntegrationsScanned += integrationsSnap.size;

      for (const intDoc of integrationsSnap.docs) {
        const docPath = `/organizations/${orgDoc.id}/integrations/${intDoc.id}`;
        const classification = classifyIntegrationRecord(docPath, intDoc.data());

        result.records.push(classification);

        switch (classification.status) {
          case "encrypted":
            result.encryptedCount++;
            break;
          case "potential_plaintext":
            result.potentialPlaintextCount++;
            break;
          case "no_secrets_detected":
            result.noSecretsDetectedCount++;
            break;
          case "ambiguous":
            result.ambiguousCount++;
            break;
        }
      }
    }
  } catch (err: any) {
    throw new Error(`Historical integration secret audit failed during read scan: ${err.message}`);
  }

  return result;
}

/**
 * Formats inventory results into a strictly sanitized human-readable audit report.
 */
export function formatSanitizedInventoryReport(result: InventoryResult): string {
  const lines: string[] = [];

  lines.push("================================================================================");
  lines.push("🛡️  ECHONOTE HISTORICAL INTEGRATION CREDENTIAL INVENTORY REPORT (READ-ONLY)");
  lines.push("================================================================================");
  lines.push("");
  lines.push("⚠️  AUDIT DISCLAIMER:");
  lines.push("  - This inventory utility performs strictly READ-ONLY metadata and field-name analysis.");
  lines.push("  - Zero documents were written, mutated, rotated, or migrated.");
  lines.push("  - Field-name scanning is an inventory aid, not proof that all secrets have been found.");
  lines.push("  - No secret values, tokens, or encryption keys are printed or displayed in this report.");
  lines.push("");
  lines.push(`Target Project:                   ${result.targetProject}`);
  lines.push(`Organizations Inspected:          ${result.totalOrgsScanned}`);
  lines.push(`Integration Documents Inspected:  ${result.totalIntegrationsScanned}`);
  lines.push("--------------------------------------------------------------------------------");
  lines.push("AGGREGATE STATUS BREAKDOWN:");
  lines.push(`  ✅ Encrypted Documents (AES-GCM):     ${result.encryptedCount}`);
  lines.push(`  ⚠️  Potential Legacy Plaintext:        ${result.potentialPlaintextCount}`);
  lines.push(`  ℹ️  No Secrets Detected (Operational): ${result.noSecretsDetectedCount}`);
  lines.push(`  ❓ Ambiguous / Unclassified Records:  ${result.ambiguousCount}`);
  lines.push("--------------------------------------------------------------------------------");
  lines.push("DOCUMENT CLASSIFICATION DETAILS (SANITIZED IDENTIFIERS ONLY):");

  if (result.records.length === 0) {
    lines.push("  (No integration documents found in target scope)");
  } else {
    for (const rec of result.records) {
      let icon = "ℹ️ ";
      if (rec.status === "encrypted") icon = "✅";
      if (rec.status === "potential_plaintext") icon = "⚠️ ";
      if (rec.status === "ambiguous") icon = "❓";

      const fieldsInfo =
        rec.detectedSensitiveFieldNames.length > 0
          ? ` [Fields: ${rec.detectedSensitiveFieldNames.join(", ")}]`
          : "";
      const keyInfo = rec.keyId ? ` (KeyID: ${rec.keyId})` : "";

      lines.push(`  ${icon} [${rec.status.toUpperCase()}] ${rec.docPath}${fieldsInfo}${keyInfo}`);
      if (rec.notes) {
        lines.push(`      Note: ${rec.notes}`);
      }
    }
  }

  lines.push("================================================================================");
  lines.push("RECOMMENDED NEXT ACTIONS:");
  if (result.potentialPlaintextCount > 0) {
    lines.push(`  1. Rotate upstream credentials at providers for ${result.potentialPlaintextCount} legacy document(s).`);
    lines.push("  2. Schedule a dry-run migration to re-encrypt and sanitize remaining legacy records.");
  } else {
    lines.push("  1. No potential legacy plaintext credentials detected in the inspected scope.");
  }
  lines.push("================================================================================");

  return lines.join("\n");
}

// -----------------------------------------------------------------------------
// CLI Execution Guardrails
// -----------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);

  // Require explicit project or environment confirmation
  const projectArg = args.find((a) => a.startsWith("--project="))?.split("=")[1];
  const envArg = args.find((a) => a.startsWith("--target-env="))?.split("=")[1];
  const confirmFlag = args.includes("--confirm-scan");

  if (!confirmFlag || (!projectArg && !envArg)) {
    console.error("❌ ERROR: Explicit target project and confirmation flag required.");
    console.error("");
    console.error("To prevent accidental scans against production or unintended environments,");
    console.error("you must specify --project=<projectId> or --target-env=<env> and --confirm-scan.");
    console.error("");
    console.error("Usage:");
    console.error("  npx tsx scripts/audit-historical-integration-secrets.ts --project=echonote-test --confirm-scan");
    console.error("  npx tsx scripts/audit-historical-integration-secrets.ts --target-env=staging --confirm-scan");
    console.error("");
    process.exit(1);
  }

  const targetProject = projectArg || envArg || "unknown";

  try {
    const config = getFirebaseConfig();
    const resolvedProject = projectArg || config.projectId || targetProject;

    console.log(`🔍 Initializing read-only inventory scan against target: [${resolvedProject}]...`);

    const result = await runHistoricalSecretInventory({
      targetProject: resolvedProject
    });

    console.log("\n" + formatSanitizedInventoryReport(result));
  } catch (err: any) {
    console.error("\n❌ Inventory execution failed safely:", err.message);
    process.exit(1);
  }
}

// Auto-run if executed as main CLI script
if (
  process.argv[1] &&
  (process.argv[1].endsWith("audit-historical-integration-secrets.ts") ||
    process.argv[1].endsWith("audit-historical-integration-secrets.js"))
) {
  main();
}
