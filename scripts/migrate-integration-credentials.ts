/**
 * scripts/migrate-integration-credentials.ts
 *
 * AH.156 — Safe Integration Key Re-Encryption Migration Utility
 *
 * Operational & Security Guarantees:
 * - Read-only dry run mode supported by default (dryRun: true).
 * - Only re-encrypts records stamped with legacy keyId (e.g. 'local-aes-256-gcm:v1').
 * - Preserves all non-secret integration fields, timestamps, provider IDs, and document structure.
 * - Concurrency protection: verifies document keyId and updatedAt during write to prevent overwriting concurrent updates.
 * - Zero secret logging: never prints, logs, or exports plain credentials, ciphertexts, or keys.
 * - Idempotent: repeated runs skip already migrated documents (keyId === activeKeyId).
 * - Fails safely on corrupt ciphertext or missing key without modifying the document.
 */

import { Firestore } from 'firebase-admin/firestore';
import {
  reencryptSecret,
  getActiveEncryptionKeyId,
  isIntegrationEncryptionConfigured,
  EncryptedPayload
} from '../lib/integrationSecurity.ts';

export interface MigrationOptions {
  db: Firestore;
  dryRun?: boolean;
  targetKeyId?: string;
  orgIdFilter?: string;
  batchSize?: number;
  silent?: boolean;
}

export interface MigrationStats {
  scanned: number;
  eligible: number;
  migrated: number;
  alreadyMigrated: number;
  skippedNoSecrets: number;
  failed: number;
  dryRun: boolean;
  errors: { docPath: string; error: string }[];
}

export async function migrateIntegrationCredentials(options: MigrationOptions): Promise<MigrationStats> {
  const {
    db,
    dryRun = true,
    targetKeyId = getActiveEncryptionKeyId() || 'local-aes-256-gcm:v2',
    orgIdFilter,
    batchSize = 50,
    silent = false
  } = options;

  const stats: MigrationStats = {
    scanned: 0,
    eligible: 0,
    migrated: 0,
    alreadyMigrated: 0,
    skippedNoSecrets: 0,
    failed: 0,
    dryRun,
    errors: []
  };

  if (!isIntegrationEncryptionConfigured()) {
    throw new Error('ENCRYPTION_KEY_REQUIRED: Migration cannot proceed without a valid configured keyring.');
  }

  // Scan all organizations
  let orgsQuery: FirebaseFirestore.Query = db.collection('organizations');
  if (orgIdFilter) {
    orgsQuery = db.collection('organizations').where('id', '==', orgIdFilter);
  }

  const orgsSnap = await orgsQuery.get();

  for (const orgDoc of orgsSnap.docs) {
    const orgId = orgDoc.id;
    const integrationsRef = db.collection('organizations').doc(orgId).collection('integrations');
    const integrationsSnap = await integrationsRef.get();

    for (const intDoc of integrationsSnap.docs) {
      stats.scanned++;
      const data = intDoc.data() || {};
      const docPath = `organizations/${orgId}/integrations/${intDoc.id}`;

      // Check if document has encrypted secrets
      if (!data._secretsEncrypted || !data._encryptedSecrets) {
        stats.skippedNoSecrets++;
        continue;
      }

      // Support legacy shape where keyId is omitted in _encryptedSecrets (defaults to local-aes-256-gcm:v1)
      const existingPayload = data._encryptedSecrets as EncryptedPayload;
      const currentKeyId = existingPayload?.keyId || 'local-aes-256-gcm:v1';
      const existingUpdatedAt = data.updatedAt || null;

      // If already on target key, skip (idempotent)
      if (currentKeyId === targetKeyId) {
        stats.alreadyMigrated++;
        continue;
      }

      stats.eligible++;

      if (dryRun) {
        if (!silent) {
          console.log(`[DRY-RUN] Would re-encrypt ${docPath} from ${currentKeyId} to ${targetKeyId}`);
        }
        continue;
      }

      // Execute migration via transaction for concurrency safety
      try {
        await db.runTransaction(async (transaction) => {
          const freshSnap = await transaction.get(intDoc.ref);
          if (!freshSnap.exists) {
            throw new Error('DOCUMENT_NOT_FOUND: Document deleted during migration');
          }
          const freshData = freshSnap.data() || {};
          const freshPayload = freshData._encryptedSecrets as EncryptedPayload;
          const freshKeyId = freshPayload?.keyId || 'local-aes-256-gcm:v1';
          const freshUpdatedAt = freshData.updatedAt || null;

          // Concurrency check 1: If someone concurrently updated to targetKeyId, abort cleanly
          if (freshKeyId === targetKeyId) {
            return;
          }

          // Concurrency check 2: If document was updated by an active session/user, abort to avoid overwrite
          if (existingUpdatedAt && freshUpdatedAt && freshUpdatedAt !== existingUpdatedAt) {
            throw new Error(`CONCURRENT_MODIFICATION: Document was updated concurrently (timestamp ${existingUpdatedAt} -> ${freshUpdatedAt})`);
          }

          // Concurrency check 3: If keyId changed to something else unexpected, abort
          if (freshKeyId !== currentKeyId) {
            throw new Error(`CONCURRENT_MODIFICATION: Document keyId changed from ${currentKeyId} to ${freshKeyId}`);
          }

          // Re-encrypt to target key (handles legacy payload missing keyId by normalizing to v1)
          const normalizedPayload = {
            ...freshPayload,
            keyId: freshKeyId
          };
          const newPayload = reencryptSecret(normalizedPayload, targetKeyId);

          // Update ONLY secret payload, leaving unrelated fields intact
          transaction.update(intDoc.ref, {
            _encryptedSecrets: newPayload,
            _migratedAt: new Date().toISOString()
          });
        });

        stats.migrated++;
        if (!silent) {
          console.log(`[MIGRATED] Successfully re-encrypted ${docPath} to ${targetKeyId}`);
        }
      } catch (err: any) {
        stats.failed++;
        stats.errors.push({ docPath, error: err?.message || String(err) });
        if (!silent) {
          console.error(`[ERROR] Failed to re-encrypt ${docPath}: ${err?.message || err}`);
        }
      }
    }
  }

  return stats;
}
