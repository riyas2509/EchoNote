/**
 * Diagnostic Test Script: Project Invitation Acceptance Flow
 *
 * Validates:
 * 1. Explicit distinction between "Token Not Found" (HTTP 404) and "Firestore Read Error" (HTTP 500).
 * 2. Strict validation that Firestore transaction/write errors return HTTP 500 and PREVENT an HTTP 200 success response.
 * 3. Atomic state verification: membership is NOT persisted when write fails.
 * 4. Successful acceptance persists membership and transitions invite status.
 */

import assert from 'node:assert';
import { acceptProjectInvitation } from '../lib/projectInvitation.ts';

interface StoredDoc {
  id: string;
  data: Record<string, any>;
}

class MockFirestoreDiagnosticClient {
  public invitesStore = new Map<string, Record<string, any>>();
  public membersStore = new Map<string, Record<string, any>>();
  public activitiesStore: any[] = [];

  // Fault injection flags
  public failReadWith: Error | null = null;
  public failTransactionWith: Error | null = null;

  reset() {
    this.invitesStore.clear();
    this.membersStore.clear();
    this.activitiesStore = [];
    this.failReadWith = null;
    this.failTransactionWith = null;
  }

  seedInvite(id: string, data: Record<string, any>) {
    this.invitesStore.set(id, { id, ...data });
  }

  collection(name: string) {
    const self = this;
    if (name === 'invites') {
      return {
        doc: (docId: string) => {
          return {
            id: docId,
            path: `invites/${docId}`,
            get: async () => {
              if (self.failReadWith) {
                throw self.failReadWith;
              }
              const exists = self.invitesStore.has(docId);
              return {
                id: docId,
                exists,
                data: () => exists ? { ...self.invitesStore.get(docId) } : undefined,
                ref: { id: docId, path: `invites/${docId}` }
              };
            }
          };
        },
        where: (field: string, op: string, val: any) => {
          return {
            limit: (count: number) => {
              return {
                get: async () => {
                  if (self.failReadWith) {
                    throw self.failReadWith;
                  }
                  const matches: any[] = [];
                  for (const [key, data] of self.invitesStore.entries()) {
                    if (data[field] === val) {
                      matches.push({
                        id: key,
                        exists: true,
                        data: () => ({ ...data }),
                        ref: { id: key, path: `invites/${key}` }
                      });
                      if (matches.length >= count) break;
                    }
                  }
                  return {
                    empty: matches.length === 0,
                    docs: matches
                  };
                }
              };
            }
          };
        }
      };
    }

    if (name === 'projectMembers') {
      return {
        doc: (docId: string) => {
          return {
            id: docId,
            path: `projectMembers/${docId}`,
            get: async () => {
              const exists = self.membersStore.has(docId);
              return {
                id: docId,
                exists,
                data: () => exists ? { ...self.membersStore.get(docId) } : undefined
              };
            }
          };
        }
      };
    }

    if (name === 'projectActivities') {
      return {
        add: async (data: any) => {
          self.activitiesStore.push(data);
          return { id: `activity_${Date.now()}` };
        }
      };
    }

    throw new Error(`Unexpected collection accessed: ${name}`);
  }

  async runTransaction(updateFn: (tx: any) => Promise<any>) {
    const stagedMemberSets = new Map<string, any>();
    const stagedInviteUpdates = new Map<string, any>();

    const tx = {
      get: async (ref: any) => {
        const docId = ref.id;
        const exists = this.invitesStore.has(docId);
        return {
          id: docId,
          exists,
          data: () => exists ? { ...this.invitesStore.get(docId) } : undefined
        };
      },
      set: (ref: any, data: any, options?: any) => {
        stagedMemberSets.set(ref.id, data);
      },
      update: (ref: any, data: any) => {
        stagedInviteUpdates.set(ref.id, data);
      }
    };

    // Execute transaction callback
    await updateFn(tx);

    // If transaction error is simulated during commit/persistence
    if (this.failTransactionWith) {
      throw this.failTransactionWith;
    }

    // Atomically commit staged writes
    for (const [id, data] of stagedMemberSets.entries()) {
      this.membersStore.set(id, data);
    }
    for (const [id, data] of stagedInviteUpdates.entries()) {
      const existing = this.invitesStore.get(id) || {};
      this.invitesStore.set(id, { ...existing, ...data });
    }
  }
}

async function runDiagnostics() {
  console.log('======================================================================');
  console.log('🔬 INVITATION ACCEPTANCE & FIRESTORE DURABILITY DIAGNOSTIC TEST');
  console.log('======================================================================\n');

  const mockDb = new MockFirestoreDiagnosticClient();

  // -------------------------------------------------------------------------
  // Diagnostic 1: Token Not Found -> Returns HTTP 404 (NotFound)
  // -------------------------------------------------------------------------
  console.log('--> [DIAGNOSTIC 1] Testing genuine nonexistent token...');
  mockDb.reset();
  const nonExistentResult = await acceptProjectInvitation(mockDb as any, {
    rawToken: 'nonexistent_token_123',
    userId: 'user_alpha',
    userEmail: 'alpha@example.com',
    userDisplayName: 'Alpha User'
  });

  console.log(`    Status Code: ${nonExistentResult.status}`);
  console.log(`    Error Code:  ${nonExistentResult.body.error}`);
  console.log(`    Message:     ${nonExistentResult.body.message}`);

  assert.strictEqual(
    nonExistentResult.status,
    404,
    'Nonexistent token must return HTTP 404'
  );
  assert.strictEqual(
    nonExistentResult.body.error,
    'NotFound',
    'Error identifier must be NotFound'
  );
  assert.strictEqual(
    mockDb.membersStore.size,
    0,
    'No member record should be created'
  );
  console.log('    ✅ PASS: Genuine nonexistent token cleanly returns HTTP 404 NotFound.\n');

  // -------------------------------------------------------------------------
  // Diagnostic 2: Firestore Read Error -> Returns HTTP 500 (DatabaseError)
  // -------------------------------------------------------------------------
  console.log('--> [DIAGNOSTIC 2] Testing Firestore infrastructure read failure...');
  mockDb.reset();
  mockDb.seedInvite('token_db_failure', {
    projectId: 'proj_alpha',
    projectName: 'Alpha Project',
    email: 'beta@example.com',
    role: 'editor',
    status: 'pending'
  });

  // Inject Firestore read failure (network timeout / quota exhausted)
  mockDb.failReadWith = new Error('DEADLINE_EXCEEDED: Firestore connection timed out while querying invites collection');

  const readErrorResult = await acceptProjectInvitation(mockDb as any, {
    rawToken: 'token_db_failure',
    userId: 'user_beta',
    userEmail: 'beta@example.com',
    userDisplayName: 'Beta User'
  });

  console.log(`    Status Code: ${readErrorResult.status}`);
  console.log(`    Error Code:  ${readErrorResult.body.error}`);
  console.log(`    Message:     ${readErrorResult.body.message}`);

  assert.strictEqual(
    readErrorResult.status,
    500,
    'Firestore read failure must return HTTP 500, NOT HTTP 404'
  );
  assert.strictEqual(
    readErrorResult.body.error,
    'DatabaseError',
    'Error identifier must be DatabaseError'
  );
  assert.notStrictEqual(
    readErrorResult.status,
    404,
    'CRITICAL: Firestore read failure was swallowed as HTTP 404!'
  );
  assert.strictEqual(
    mockDb.membersStore.size,
    0,
    'No member record should be created when read fails'
  );
  console.log('    ✅ PASS: Firestore read failure explicitly returns HTTP 500 (not swallowed as 404).\n');

  // -------------------------------------------------------------------------
  // Diagnostic 3: Firestore Write / Transaction Error -> Returns HTTP 500
  //                and PREVENTS HTTP 200 Success Response
  // -------------------------------------------------------------------------
  console.log('--> [DIAGNOSTIC 3] Testing Firestore transaction/write failure...');
  mockDb.reset();
  mockDb.seedInvite('token_tx_failure', {
    projectId: 'proj_gamma',
    projectName: 'Gamma Project',
    email: 'gamma@example.com',
    role: 'admin',
    status: 'pending'
  });

  // Inject transaction commit failure
  mockDb.failTransactionWith = new Error('ABORTED: Transaction lock contention or datastore write failure');

  const txErrorResult = await acceptProjectInvitation(mockDb as any, {
    rawToken: 'token_tx_failure',
    userId: 'user_gamma',
    userEmail: 'gamma@example.com',
    userDisplayName: 'Gamma User'
  });

  console.log(`    Status Code: ${txErrorResult.status}`);
  console.log(`    Error Code:  ${txErrorResult.body.error}`);
  console.log(`    Message:     ${txErrorResult.body.message}`);

  assert.strictEqual(
    txErrorResult.status,
    500,
    'Transaction write failure must return HTTP 500'
  );
  assert.strictEqual(
    txErrorResult.body.error,
    'TransactionFailed',
    'Error identifier must be TransactionFailed'
  );
  assert.notStrictEqual(
    txErrorResult.status,
    200,
    'CRITICAL: Endpoint returned HTTP 200 even though write transaction failed!'
  );
  assert.strictEqual(
    txErrorResult.body.success,
    undefined,
    'Success field must NOT be present or true on transaction error'
  );

  // Validate state isolation: no partial writes survived
  assert.strictEqual(
    mockDb.membersStore.size,
    0,
    'Membership document must NOT exist in membersStore after transaction failure'
  );
  const unupdatedInvite = mockDb.invitesStore.get('token_tx_failure');
  assert.strictEqual(
    unupdatedInvite?.status,
    'pending',
    'Invite status must remain "pending" when transaction fails'
  );
  console.log('    ✅ PASS: Transaction failure blocks HTTP 200 and prevents partial membership persistence.\n');

  // -------------------------------------------------------------------------
  // Diagnostic 4: Successful Acceptance -> Atomically persists membership & returns 200
  // -------------------------------------------------------------------------
  console.log('--> [DIAGNOSTIC 4] Testing valid invitation acceptance...');
  mockDb.reset();
  mockDb.seedInvite('token_success_valid', {
    projectId: 'proj_delta',
    projectName: 'Delta Workspace',
    email: 'delta@example.com',
    role: 'collaborator',
    status: 'pending'
  });

  const successResult = await acceptProjectInvitation(mockDb as any, {
    rawToken: 'token_success_valid',
    userId: 'user_delta',
    userEmail: 'delta@example.com',
    userDisplayName: 'Delta User'
  });

  console.log(`    Status Code: ${successResult.status}`);
  console.log(`    Success:     ${successResult.body.success}`);
  console.log(`    Role:        ${successResult.body.role}`);
  console.log(`    Project ID:  ${successResult.body.projectId}`);

  assert.strictEqual(successResult.status, 200, 'Valid invite must return HTTP 200');
  assert.strictEqual(successResult.body.success, true, 'Response must indicate success: true');
  assert.strictEqual(successResult.body.role, 'collaborator', 'Role must match invite specification');

  // Verify database state
  const memberKey = 'user_delta_proj_delta';
  assert.ok(mockDb.membersStore.has(memberKey), 'Member record must be stored in database');
  const storedMember = mockDb.membersStore.get(memberKey);
  assert.strictEqual(storedMember?.userId, 'user_delta');
  assert.strictEqual(storedMember?.projectId, 'proj_delta');
  assert.strictEqual(storedMember?.role, 'collaborator');

  const updatedInvite = mockDb.invitesStore.get('token_success_valid');
  assert.strictEqual(updatedInvite?.status, 'accepted', 'Invite status must transition to "accepted"');
  assert.strictEqual(updatedInvite?.acceptedBy, 'user_delta');
  console.log('    ✅ PASS: Valid acceptance writes durable membership and transitions invite status.\n');

  // -------------------------------------------------------------------------
  // Diagnostic 5: Expired Token -> Returns HTTP 400
  // -------------------------------------------------------------------------
  console.log('--> [DIAGNOSTIC 5] Testing expired invitation token...');
  mockDb.reset();
  mockDb.seedInvite('token_expired', {
    projectId: 'proj_delta',
    projectName: 'Delta Workspace',
    email: 'delta@example.com',
    role: 'collaborator',
    status: 'expired'
  });

  const expiredResult = await acceptProjectInvitation(mockDb as any, {
    rawToken: 'token_expired',
    userId: 'user_delta',
    userEmail: 'delta@example.com'
  });

  console.log(`    Status Code: ${expiredResult.status}`);
  console.log(`    Message:     ${expiredResult.body.message}`);

  assert.strictEqual(expiredResult.status, 400, 'Expired token must return HTTP 400');
  assert.strictEqual(mockDb.membersStore.size, 0, 'No member record should be created');
  console.log('    ✅ PASS: Expired token is rejected with HTTP 400.\n');

  // -------------------------------------------------------------------------
  // Diagnostic 6: Email Mismatch -> Returns HTTP 403 Forbidden
  // -------------------------------------------------------------------------
  console.log('--> [DIAGNOSTIC 6] Testing recipient email mismatch...');
  mockDb.reset();
  mockDb.seedInvite('token_mismatch', {
    projectId: 'proj_delta',
    projectName: 'Delta Workspace',
    email: 'original_recipient@example.com',
    role: 'collaborator',
    status: 'pending'
  });

  const mismatchResult = await acceptProjectInvitation(mockDb as any, {
    rawToken: 'token_mismatch',
    userId: 'attacker_user',
    userEmail: 'attacker@example.com'
  });

  console.log(`    Status Code: ${mismatchResult.status}`);
  console.log(`    Message:     ${mismatchResult.body.message}`);

  assert.strictEqual(mismatchResult.status, 403, 'Email mismatch must return HTTP 403 Forbidden');
  assert.strictEqual(mockDb.membersStore.size, 0, 'No member record should be created');
  console.log('    ✅ PASS: Mismatched recipient email is rejected with HTTP 403 Forbidden.\n');

  console.log('======================================================================');
  console.log('🎉 ALL 6 DIAGNOSTIC CHECKS PASSED SUCCESSFULLY!');
  console.log('======================================================================');
}

runDiagnostics().catch((err) => {
  console.error('❌ Diagnostic test failed:', err);
  process.exit(1);
});
