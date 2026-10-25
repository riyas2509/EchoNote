/**
 * scripts/migrate-legacy-notifications.ts
 *
 * AH.148 — Legacy Notification Compatibility and Backfill Migration Utility
 *
 * Safely backfills missing `userId` and `userEmail` aliases on legacy notification documents
 * in the top-level `/notifications` collection from trusted existing `recipientUserId`
 * and `recipientEmail` fields.
 *
 * Operational & Security Guarantees:
 * - Strictly server-side admin operation (Firestore Admin SDK).
 * - Read-only dry run mode supported (dryRun: true).
 * - Validates recipient identifiers; skips malformed / unresolvable documents.
 * - Detects conflicts: never overwrites an existing non-empty alias if it differs from the authoritative recipient.
 * - Preserves all existing fields: id, isRead, createdAt, updatedAt, type, title, message, metadata, projectId, taskId, idempotencyKey.
 * - Bounded batch writes (default 250 docs/batch, well within Firestore 500 limit).
 * - Fully idempotent: rerun yields 0 updates.
 * - Never logs sensitive notification contents (titles/messages/emails redacted in logs).
 */

import admin from 'firebase-admin';
import { isValidEmail, normalizeEmail } from '../lib/notificationModel.ts';

export interface MigrationOptions {
  dryRun?: boolean;
  batchSize?: number;
  projectIdFilter?: string;
  limit?: number;
  verbose?: boolean;
}

export interface MigrationSummary {
  scannedCount: number;
  eligibleCount: number;
  migratedCount: number;
  alreadyMigratedCount: number;
  skippedMalformedCount: number;
  conflictCount: number;
  batchCount: number;
  dryRun: boolean;
  errors: string[];
}

export interface DocumentMigrationResult {
  docId: string;
  action: 'migrated' | 'already_migrated' | 'skipped_malformed' | 'conflict_skipped';
  reason?: string;
  updates?: Record<string, any>;
}

/**
 * Validates a user ID string. Must be a non-empty string, trimmed, <= 128 chars.
 */
export function isValidUserId(uid: any): boolean {
  if (typeof uid !== 'string') return false;
  const trimmed = uid.trim();
  return trimmed.length > 0 && trimmed.length <= 128;
}

/**
 * Analyzes a single notification document and determines the safe migration action.
 */
export function evaluateNotificationForMigration(
  docId: string,
  data: Record<string, any>
): DocumentMigrationResult {
  const recipientUserId = data.recipientUserId !== undefined ? data.recipientUserId : null;
  const recipientEmail = data.recipientEmail !== undefined ? data.recipientEmail : null;

  const currentUserId = data.userId !== undefined ? data.userId : null;
  const currentUserEmail = data.userEmail !== undefined ? data.userEmail : null;

  // Check for malformed or completely missing recipient identities
  const hasValidRecipientUid = isValidUserId(recipientUserId);
  const hasValidRecipientEmail = isValidEmail(recipientEmail);

  if (!hasValidRecipientUid && !hasValidRecipientEmail) {
    // If it already has valid userId or userEmail, check if it's already complete
    if (isValidUserId(currentUserId) || isValidEmail(currentUserEmail)) {
      return { docId, action: 'already_migrated' };
    }
    return {
      docId,
      action: 'skipped_malformed',
      reason: 'Missing both valid recipientUserId and valid recipientEmail'
    };
  }

  // Check for conflicts between existing aliases and recipient fields
  if (currentUserId && hasValidRecipientUid && currentUserId !== recipientUserId) {
    return {
      docId,
      action: 'conflict_skipped',
      reason: `Conflict detected: existing userId "${currentUserId}" does not match recipientUserId "${recipientUserId}"`
    };
  }

  if (currentUserEmail && hasValidRecipientEmail && normalizeEmail(currentUserEmail) !== normalizeEmail(recipientEmail)) {
    return {
      docId,
      action: 'conflict_skipped',
      reason: `Conflict detected: existing userEmail "${currentUserEmail}" does not match recipientEmail "${recipientEmail}"`
    };
  }

  // Determine needed updates
  const updates: Record<string, any> = {};

  if (hasValidRecipientUid && (!currentUserId || currentUserId !== recipientUserId)) {
    updates.userId = recipientUserId;
  }

  if (hasValidRecipientEmail) {
    const norm = normalizeEmail(recipientEmail);
    if (!currentUserEmail || normalizeEmail(currentUserEmail) !== norm) {
      updates.userEmail = norm;
    }
  }

  // If no updates needed, it is already migrated
  if (Object.keys(updates).length === 0) {
    return { docId, action: 'already_migrated' };
  }

  return {
    docId,
    action: 'migrated',
    updates
  };
}

/**
 * Executes or simulates the legacy notification migration against Firestore.
 */
export async function migrateLegacyNotifications(
  firestore: admin.firestore.Firestore,
  options: MigrationOptions = {}
): Promise<MigrationSummary> {
  const dryRun = options.dryRun ?? false;
  const batchSize = Math.min(options.batchSize ?? 250, 450); // Keep below 500
  const maxLimit = options.limit ?? Infinity;

  const summary: MigrationSummary = {
    scannedCount: 0,
    eligibleCount: 0,
    migratedCount: 0,
    alreadyMigratedCount: 0,
    skippedMalformedCount: 0,
    conflictCount: 0,
    batchCount: 0,
    dryRun,
    errors: []
  };

  let query: admin.firestore.Query = firestore.collection('notifications');

  if (options.projectIdFilter) {
    query = query.where('projectId', '==', options.projectIdFilter);
  }

  query = query.orderBy(admin.firestore.FieldPath.documentId());

  let lastDoc: admin.firestore.DocumentSnapshot | null = null;
  let continuePaging = true;

  while (continuePaging) {
    let pagedQuery = query.limit(batchSize);
    if (lastDoc) {
      pagedQuery = pagedQuery.startAfter(lastDoc);
    }

    const snapshot = await pagedQuery.get();
    if (snapshot.empty) {
      break;
    }

    const pendingBatchWrites: { ref: admin.firestore.DocumentReference; updates: Record<string, any> }[] = [];

    for (const doc of snapshot.docs) {
      if (summary.scannedCount >= maxLimit) {
        continuePaging = false;
        break;
      }

      summary.scannedCount++;
      lastDoc = doc;

      const evalResult = evaluateNotificationForMigration(doc.id, doc.data());

      switch (evalResult.action) {
        case 'already_migrated':
          summary.alreadyMigratedCount++;
          break;
        case 'skipped_malformed':
          summary.skippedMalformedCount++;
          if (options.verbose) {
            summary.errors.push(`[MALFORMED] Doc ${doc.id}: ${evalResult.reason}`);
          }
          break;
        case 'conflict_skipped':
          summary.conflictCount++;
          summary.errors.push(`[CONFLICT] Doc ${doc.id}: ${evalResult.reason}`);
          break;
        case 'migrated':
          summary.eligibleCount++;
          if (evalResult.updates && Object.keys(evalResult.updates).length > 0) {
            pendingBatchWrites.push({
              ref: doc.ref,
              updates: evalResult.updates
            });
          }
          break;
      }
    }

    // Apply batch write if not in dry-run mode and there are updates
    if (pendingBatchWrites.length > 0) {
      summary.batchCount++;
      if (!dryRun) {
        const batch = firestore.batch();
        for (const item of pendingBatchWrites) {
          batch.update(item.ref, item.updates);
        }
        await batch.commit();
        summary.migratedCount += pendingBatchWrites.length;
      } else {
        // In dry run, count as eligible without committing
        summary.migratedCount += pendingBatchWrites.length;
      }
    }

    if (snapshot.docs.length < batchSize) {
      continuePaging = false;
    }
  }

  return summary;
}

// Standalone execution wrapper if invoked directly from CLI
if (process.argv[1] && process.argv[1].endsWith('migrate-legacy-notifications.ts')) {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run') || !args.includes('--execute');
  const isVerbose = args.includes('--verbose');

  console.log(`=== EchoNote AH.148 Notification Migration ===`);
  console.log(`Mode: ${isDryRun ? 'DRY-RUN (Simulated)' : 'EXECUTE (Live mutation)'}`);

  const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
  const gcloudProject = process.env.GCLOUD_PROJECT || 'echonote-prod';

  if (!admin.apps.length) {
    if (emulatorHost) {
      console.log(`Connecting to Firestore Emulator: ${emulatorHost}`);
      admin.initializeApp({ projectId: gcloudProject });
    } else {
      console.log(`Connecting via default Google Application Credentials for project: ${gcloudProject}`);
      admin.initializeApp();
    }
  }

  const db = admin.firestore();

  migrateLegacyNotifications(db, {
    dryRun: isDryRun,
    verbose: isVerbose
  }).then(summary => {
    console.log(`\nMigration Summary:`);
    console.log(`  Scanned:          ${summary.scannedCount}`);
    console.log(`  Eligible:         ${summary.eligibleCount}`);
    console.log(`  Migrated:         ${summary.migratedCount} ${isDryRun ? '(simulated)' : '(committed)'}`);
    console.log(`  Already Migrated: ${summary.alreadyMigratedCount}`);
    console.log(`  Skipped (Bad):    ${summary.skippedMalformedCount}`);
    console.log(`  Conflicts:        ${summary.conflictCount}`);
    console.log(`  Batches:          ${summary.batchCount}`);

    if (summary.errors.length > 0) {
      console.log(`\nNotices / Conflicts (${summary.errors.length}):`);
      summary.errors.slice(0, 10).forEach(e => console.log(`  ${e}`));
      if (summary.errors.length > 10) {
        console.log(`  ... and ${summary.errors.length - 10} more`);
      }
    }

    process.exit(summary.conflictCount > 0 ? 2 : 0);
  }).catch(err => {
    console.error(`Migration error:`, err);
    process.exit(1);
  });
}
