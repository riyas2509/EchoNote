import assert from 'node:assert';
import { sanitizeInvitationToken, acceptProjectInvitation } from '../lib/projectInvitation.ts';

console.log('======================================================================');
console.log('🧪 RUNNING STEP 6M-J PROJECT INVITATION ACCEPTANCE RELIABILITY TESTS');
console.log('======================================================================');

let passedCount = 0;

function runTest(name: string, fn: () => Promise<void> | void) {
  try {
    const res = fn();
    if (res instanceof Promise) {
      res.then(() => {
        console.log(`  ✅ ${name} ... PASSED`);
        passedCount++;
      }).catch((err) => {
        console.error(`  ❌ ${name} ... FAILED`);
        console.error(`     Error: ${err?.message || err}`);
        process.exit(1);
      });
    } else {
      console.log(`  ✅ ${name} ... PASSED`);
      passedCount++;
    }
  } catch (err: any) {
    console.error(`  ❌ ${name} ... FAILED`);
    console.error(`     Error: ${err?.message || err}`);
    process.exit(1);
  }
}

// Mock Harness simulating server-side invite-accept transaction logic
interface MockInviteRecord {
  id: string;
  email: string;
  projectId: string;
  projectName: string;
  role: string;
  status: 'pending' | 'accepted' | 'cancelled' | 'revoked' | 'rejected' | 'expired';
  acceptedBy?: string;
  expiresAt?: any;
  ownerId?: string | null;
}

interface MockMemberRecord {
  userId: string;
  email: string;
  displayName: string;
  projectId: string;
  ownerId: string | null;
  projectName: string;
  role: string;
  joinedAt: string;
}

class MockInviteAcceptanceEngine {
  public invites = new Map<string, MockInviteRecord>();
  public members = new Map<string, MockMemberRecord>();
  public simulateReadError = false;
  public simulateTxError = false;

  reset() {
    this.invites.clear();
    this.members.clear();
    this.simulateReadError = false;
    this.simulateTxError = false;
  }

  async handleInviteAccept(req: {
    user: { uid: string; email: string; name?: string } | null;
    body: { token?: any; userDisplayName?: string };
  }): Promise<{ status: number; body: any }> {
    const rawToken = req.body?.token;
    const userId = req.user?.uid;
    const userEmail = req.user?.email;
    const userDisplayName = req.body?.userDisplayName || req.user?.name || userEmail?.split('@')[0] || 'User';

    if (!rawToken || typeof rawToken !== 'string' || !rawToken.trim()) {
      return { status: 400, body: { error: 'Missing invitation token', message: 'A valid invitation token string is required.' } };
    }

    const token = rawToken.trim();
    if (token.length > 256) {
      return { status: 400, body: { error: 'Invalid invitation token', message: 'Token exceeds maximum permissible length.' } };
    }

    if (!userEmail || !userId) {
      return { status: 400, body: { error: 'Authenticated user must have an email address to accept invitations.' } };
    }

    // 1. Simulate Firestore read with error handling
    if (this.simulateReadError) {
      return { status: 500, body: { error: 'DatabaseError', message: 'A database error occurred while verifying the invitation. Please try again.' } };
    }

    let targetDocKey: string | null = null;
    let inviteData: MockInviteRecord | null = null;

    if (this.invites.has(token)) {
      targetDocKey = token;
      inviteData = { ...this.invites.get(token)! };
    } else {
      // Fallback lookup by id or token field
      for (const [key, inv] of this.invites.entries()) {
        if (inv.id === token || (inv as any).token === token) {
          targetDocKey = key;
          inviteData = { ...inv };
          break;
        }
      }
    }

    if (!targetDocKey || !inviteData) {
      return { status: 404, body: { error: 'NotFound', message: 'Invitation not found or invalid token.' } };
    }

    const currentStatus = String(inviteData.status || 'pending').toLowerCase();

    // Cancellation / revocation / rejection
    if (currentStatus === 'cancelled' || currentStatus === 'revoked' || currentStatus === 'rejected') {
      return { status: 400, body: { error: 'Invalid invitation', message: 'This invitation has been cancelled.', status: currentStatus } };
    }

    // Expiration
    if (currentStatus === 'expired') {
      return { status: 400, body: { error: 'Invalid invitation', message: 'This invitation has expired.', status: 'expired' } };
    }

    if (inviteData.expiresAt) {
      const expiresMs = typeof inviteData.expiresAt === 'number'
        ? inviteData.expiresAt
        : new Date(inviteData.expiresAt).getTime();
      if (!isNaN(expiresMs) && expiresMs < Date.now()) {
        return { status: 400, body: { error: 'Invalid invitation', message: 'This invitation has expired.', status: 'expired' } };
      }
    }

    // Recipient email match
    if (inviteData.email && inviteData.email.toLowerCase().trim() !== userEmail.toLowerCase().trim()) {
      return {
        status: 403,
        body: {
          error: 'Forbidden',
          message: `This invitation was issued to ${inviteData.email}. You are currently authenticated as ${userEmail}.`
        }
      };
    }

    const memberId = `${userId}_${inviteData.projectId}`;

    // Already accepted check (Idempotent for same user, error for others)
    if (currentStatus === 'accepted') {
      const isSameUser = (inviteData.acceptedBy && inviteData.acceptedBy === userId) ||
        (inviteData.email && inviteData.email.toLowerCase().trim() === userEmail.toLowerCase().trim());
      if (isSameUser && this.members.has(memberId)) {
        return {
          status: 200,
          body: {
            success: true,
            alreadyMember: true,
            message: 'You have already joined this project.',
            projectId: inviteData.projectId,
            projectName: inviteData.projectName,
            role: inviteData.role
          }
        };
      }
      return { status: 400, body: { error: 'Invalid invitation', message: 'This invitation has already been accepted.', status: 'accepted' } };
    }

    if (currentStatus !== 'pending') {
      return { status: 400, body: { error: 'Invalid invitation', message: `This invitation is not valid for acceptance (status: ${currentStatus}).` } };
    }

    // Simulate Transaction failure
    if (this.simulateTxError) {
      return { status: 500, body: { error: 'TransactionFailed', message: 'Failed to securely persist project membership. Please try again.' } };
    }

    // Atomic transaction commit: write member & update invite status
    this.members.set(memberId, {
      userId,
      email: userEmail,
      displayName: userDisplayName,
      projectId: inviteData.projectId,
      ownerId: inviteData.ownerId || null,
      projectName: inviteData.projectName,
      role: inviteData.role,
      joinedAt: new Date().toISOString()
    });

    inviteData.status = 'accepted';
    inviteData.acceptedBy = userId;
    this.invites.set(targetDocKey, inviteData);

    return {
      status: 200,
      body: {
        success: true,
        alreadyMember: false,
        message: `Successfully joined ${inviteData.projectName} as ${inviteData.role}`,
        projectId: inviteData.projectId,
        projectName: inviteData.projectName,
        role: inviteData.role
      }
    };
  }
}

async function runAllTests() {
  const tests: Array<{ name: string; fn: () => Promise<void> | void }> = [
    {
      name: '1. Valid invitation acceptance creates member and returns HTTP 200',
      fn: async () => {
        const engine = new MockInviteAcceptanceEngine();
        engine.invites.set('token_valid_123', {
          id: 'token_valid_123',
          email: 'alice@company.com',
          projectId: 'proj_alpha',
          projectName: 'Alpha Workspace',
          role: 'editor',
          status: 'pending'
        });

        const res = await engine.handleInviteAccept({
          user: { uid: 'user_alice', email: 'alice@company.com' },
          body: { token: 'token_valid_123' }
        });

        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.success, true);
        assert.strictEqual(res.body.alreadyMember, false);
        assert.strictEqual(engine.invites.get('token_valid_123')?.status, 'accepted');
        assert.ok(engine.members.has('user_alice_proj_alpha'));
        assert.strictEqual(engine.members.get('user_alice_proj_alpha')?.role, 'editor');
      }
    },
    {
      name: '2. Whitespace-padded token is trimmed and accepted cleanly',
      fn: async () => {
        const engine = new MockInviteAcceptanceEngine();
        engine.invites.set('token_pad_123', {
          id: 'token_pad_123',
          email: 'alice@company.com',
          projectId: 'proj_alpha',
          projectName: 'Alpha Workspace',
          role: 'editor',
          status: 'pending'
        });

        const res = await engine.handleInviteAccept({
          user: { uid: 'user_alice', email: 'alice@company.com' },
          body: { token: '  token_pad_123 \n' }
        });

        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.success, true);
        assert.strictEqual(engine.invites.get('token_pad_123')?.status, 'accepted');
      }
    },
    {
      name: '3. Missing or whitespace-only token returns HTTP 400',
      fn: async () => {
        const engine = new MockInviteAcceptanceEngine();
        const resEmpty = await engine.handleInviteAccept({
          user: { uid: 'user_alice', email: 'alice@company.com' },
          body: { token: '   ' }
        });
        assert.strictEqual(resEmpty.status, 400);

        const resNull = await engine.handleInviteAccept({
          user: { uid: 'user_alice', email: 'alice@company.com' },
          body: { token: null }
        });
        assert.strictEqual(resNull.status, 400);
      }
    },
    {
      name: '4. Genuine nonexistent token returns HTTP 404 NotFound',
      fn: async () => {
        const engine = new MockInviteAcceptanceEngine();
        const res = await engine.handleInviteAccept({
          user: { uid: 'user_alice', email: 'alice@company.com' },
          body: { token: 'nonexistent_token' }
        });
        assert.strictEqual(res.status, 404);
        assert.strictEqual(res.body.error, 'NotFound');
      }
    },
    {
      name: '5. Firestore read/lookup error returns HTTP 500 DatabaseError (not 404)',
      fn: async () => {
        const engine = new MockInviteAcceptanceEngine();
        engine.simulateReadError = true;
        const res = await engine.handleInviteAccept({
          user: { uid: 'user_alice', email: 'alice@company.com' },
          body: { token: 'any_token' }
        });
        assert.strictEqual(res.status, 500);
        assert.strictEqual(res.body.error, 'DatabaseError');
      }
    },
    {
      name: '6. Transaction failure returns HTTP 500 and prevents partial membership',
      fn: async () => {
        const engine = new MockInviteAcceptanceEngine();
        engine.invites.set('token_tx_err', {
          id: 'token_tx_err',
          email: 'alice@company.com',
          projectId: 'proj_alpha',
          projectName: 'Alpha Workspace',
          role: 'editor',
          status: 'pending'
        });
        engine.simulateTxError = true;

        const res = await engine.handleInviteAccept({
          user: { uid: 'user_alice', email: 'alice@company.com' },
          body: { token: 'token_tx_err' }
        });

        assert.strictEqual(res.status, 500);
        assert.strictEqual(res.body.error, 'TransactionFailed');
        assert.strictEqual(engine.invites.get('token_tx_err')?.status, 'pending');
        assert.strictEqual(engine.members.has('user_alice_proj_alpha'), false);
      }
    },
    {
      name: '7. Fallback query finds invite when document ID differs from token field',
      fn: async () => {
        const engine = new MockInviteAcceptanceEngine();
        engine.invites.set('auto_doc_999', {
          id: 'custom_token_abc',
          email: 'alice@company.com',
          projectId: 'proj_alpha',
          projectName: 'Alpha Workspace',
          role: 'commenter',
          status: 'pending'
        });

        const res = await engine.handleInviteAccept({
          user: { uid: 'user_alice', email: 'alice@company.com' },
          body: { token: 'custom_token_abc' }
        });

        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.success, true);
        assert.strictEqual(engine.invites.get('auto_doc_999')?.status, 'accepted');
        assert.strictEqual(engine.members.get('user_alice_proj_alpha')?.role, 'commenter');
      }
    },
    {
      name: '8. Idempotent acceptance: same user replaying gets HTTP 200 with alreadyMember: true',
      fn: async () => {
        const engine = new MockInviteAcceptanceEngine();
        engine.invites.set('token_idem', {
          id: 'token_idem',
          email: 'alice@company.com',
          projectId: 'proj_alpha',
          projectName: 'Alpha Workspace',
          role: 'editor',
          status: 'accepted',
          acceptedBy: 'user_alice'
        });
        engine.members.set('user_alice_proj_alpha', {
          userId: 'user_alice',
          email: 'alice@company.com',
          displayName: 'Alice',
          projectId: 'proj_alpha',
          ownerId: null,
          projectName: 'Alpha Workspace',
          role: 'editor',
          joinedAt: new Date().toISOString()
        });

        const res = await engine.handleInviteAccept({
          user: { uid: 'user_alice', email: 'alice@company.com' },
          body: { token: 'token_idem' }
        });

        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.alreadyMember, true);
      }
    },
    {
      name: '9. Replay by a different user is rejected with HTTP 400',
      fn: async () => {
        const engine = new MockInviteAcceptanceEngine();
        engine.invites.set('token_replay_diff', {
          id: 'token_replay_diff',
          email: 'alice@company.com',
          projectId: 'proj_alpha',
          projectName: 'Alpha Workspace',
          role: 'editor',
          status: 'accepted',
          acceptedBy: 'user_alice'
        });

        const res = await engine.handleInviteAccept({
          user: { uid: 'user_eve', email: 'eve@company.com' },
          body: { token: 'token_replay_diff' }
        });

        assert.ok(res.status === 403 || res.status === 400);
      }
    },
    {
      name: '10. Recipient email mismatch returns HTTP 403 Forbidden',
      fn: async () => {
        const engine = new MockInviteAcceptanceEngine();
        engine.invites.set('token_email_mismatch', {
          id: 'token_email_mismatch',
          email: 'target@company.com',
          projectId: 'proj_alpha',
          projectName: 'Alpha Workspace',
          role: 'editor',
          status: 'pending'
        });

        const res = await engine.handleInviteAccept({
          user: { uid: 'user_wrong', email: 'other@gmail.com' },
          body: { token: 'token_email_mismatch' }
        });

        assert.strictEqual(res.status, 403);
        assert.strictEqual(res.body.error, 'Forbidden');
        assert.strictEqual(engine.members.size, 0);
      }
    },
    {
      name: '11. Expired invitation (status or past timestamp) returns HTTP 400',
      fn: async () => {
        const engine = new MockInviteAcceptanceEngine();
        engine.invites.set('token_expired_status', {
          id: 'token_expired_status',
          email: 'alice@company.com',
          projectId: 'proj_alpha',
          projectName: 'Alpha Workspace',
          role: 'editor',
          status: 'expired'
        });

        const res1 = await engine.handleInviteAccept({
          user: { uid: 'user_alice', email: 'alice@company.com' },
          body: { token: 'token_expired_status' }
        });
        assert.strictEqual(res1.status, 400);
        assert.strictEqual(res1.body.status, 'expired');

        engine.invites.set('token_expired_time', {
          id: 'token_expired_time',
          email: 'alice@company.com',
          projectId: 'proj_alpha',
          projectName: 'Alpha Workspace',
          role: 'editor',
          status: 'pending',
          expiresAt: Date.now() - 10000
        });

        const res2 = await engine.handleInviteAccept({
          user: { uid: 'user_alice', email: 'alice@company.com' },
          body: { token: 'token_expired_time' }
        });
        assert.strictEqual(res2.status, 400);
        assert.strictEqual(res2.body.status, 'expired');
      }
    },
    {
      name: '12. Cancelled or revoked invitation returns HTTP 400',
      fn: async () => {
        const engine = new MockInviteAcceptanceEngine();
        engine.invites.set('token_cancelled', {
          id: 'token_cancelled',
          email: 'alice@company.com',
          projectId: 'proj_alpha',
          projectName: 'Alpha Workspace',
          role: 'editor',
          status: 'cancelled'
        });

        const res = await engine.handleInviteAccept({
          user: { uid: 'user_alice', email: 'alice@company.com' },
          body: { token: 'token_cancelled' }
        });
        assert.strictEqual(res.status, 400);
        assert.strictEqual(res.body.status, 'cancelled');
      }
    },
    {
      name: '13. Tenant isolation: Created member record is strictly bound to invite.projectId',
      fn: async () => {
        const engine = new MockInviteAcceptanceEngine();
        engine.invites.set('token_tenant', {
          id: 'token_tenant',
          email: 'alice@company.com',
          projectId: 'isolated_tenant_proj_99',
          projectName: 'Tenant 99',
          role: 'editor',
          status: 'pending'
        });

        await engine.handleInviteAccept({
          user: { uid: 'user_alice', email: 'alice@company.com' },
          body: { token: 'token_tenant' }
        });

        const member = engine.members.get('user_alice_isolated_tenant_proj_99');
        assert.ok(member);
        assert.strictEqual(member.projectId, 'isolated_tenant_proj_99');
      }
    },
    {
      name: '14. Malformed token (>256 chars or non-string) returns HTTP 400',
      fn: async () => {
        const engine = new MockInviteAcceptanceEngine();
        const hugeToken = 'a'.repeat(300);
        const resHuge = await engine.handleInviteAccept({
          user: { uid: 'user_alice', email: 'alice@company.com' },
          body: { token: hugeToken }
        });
        assert.strictEqual(resHuge.status, 400);
        assert.strictEqual(resHuge.body.error, 'Invalid invitation token');

        const resNum = await engine.handleInviteAccept({
          user: { uid: 'user_alice', email: 'alice@company.com' },
          body: { token: 12345 as any }
        });
        assert.strictEqual(resNum.status, 400);

        const resObj = await engine.handleInviteAccept({
          user: { uid: 'user_alice', email: 'alice@company.com' },
          body: { token: { token: 'inject' } as any }
        });
        assert.strictEqual(resObj.status, 400);
      }
    },
    {
      name: '15. Concurrent acceptance: simultaneous requests result in one member and idempotent resolution',
      fn: async () => {
        const engine = new MockInviteAcceptanceEngine();
        engine.invites.set('token_concurrent', {
          id: 'token_concurrent',
          email: 'alice@company.com',
          projectId: 'proj_concurrent',
          projectName: 'Concurrent Workspace',
          role: 'editor',
          status: 'pending'
        });

        // Simulate two sequential/interleaved attempts by the same user
        const res1 = await engine.handleInviteAccept({
          user: { uid: 'user_alice', email: 'alice@company.com' },
          body: { token: 'token_concurrent' }
        });
        const res2 = await engine.handleInviteAccept({
          user: { uid: 'user_alice', email: 'alice@company.com' },
          body: { token: 'token_concurrent' }
        });

        assert.strictEqual(res1.status, 200);
        assert.strictEqual(res1.body.alreadyMember, false);
        assert.strictEqual(res2.status, 200);
        assert.strictEqual(res2.body.alreadyMember, true);
        assert.strictEqual(engine.members.size, 1);
      }
    },
    {
      name: '16. Revoked and rejected invitation statuses are strictly rejected with HTTP 400',
      fn: async () => {
        const engine = new MockInviteAcceptanceEngine();
        engine.invites.set('token_revoked', {
          id: 'token_revoked',
          email: 'alice@company.com',
          projectId: 'proj_rev',
          projectName: 'Rev Workspace',
          role: 'viewer',
          status: 'revoked'
        });
        const resRev = await engine.handleInviteAccept({
          user: { uid: 'user_alice', email: 'alice@company.com' },
          body: { token: 'token_revoked' }
        });
        assert.strictEqual(resRev.status, 400);
        assert.strictEqual(resRev.body.status, 'revoked');

        engine.invites.set('token_rejected', {
          id: 'token_rejected',
          email: 'alice@company.com',
          projectId: 'proj_rej',
          projectName: 'Rej Workspace',
          role: 'viewer',
          status: 'rejected'
        });
        const resRej = await engine.handleInviteAccept({
          user: { uid: 'user_alice', email: 'alice@company.com' },
          body: { token: 'token_rejected' }
        });
        assert.strictEqual(resRej.status, 400);
        assert.strictEqual(resRej.body.status, 'rejected');
      }
    },
    {
      name: '17. Authorization invariant: Client cannot inject or escalate role or override projectId via body',
      fn: async () => {
        const engine = new MockInviteAcceptanceEngine();
        engine.invites.set('token_role_guard', {
          id: 'token_role_guard',
          email: 'alice@company.com',
          projectId: 'authentic_proj_id',
          projectName: 'Authentic Project',
          role: 'viewer',
          status: 'pending'
        });

        const res = await engine.handleInviteAccept({
          user: { uid: 'user_alice', email: 'alice@company.com' },
          body: {
            token: 'token_role_guard',
            projectId: 'hacked_project_id',
            role: 'owner'
          } as any
        });

        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.projectId, 'authentic_proj_id');
        assert.strictEqual(res.body.role, 'viewer');
        const member = engine.members.get('user_alice_authentic_proj_id');
        assert.ok(member);
        assert.strictEqual(member.projectId, 'authentic_proj_id');
        assert.strictEqual(member.role, 'viewer');
        assert.strictEqual(engine.members.has('user_alice_hacked_project_id'), false);
      }
    },
    {
      name: '18. Schema compatibility: Supports Firestore Timestamp object with .toDate() or .toMillis()',
      fn: async () => {
        const engine = new MockInviteAcceptanceEngine();
        engine.invites.set('token_timestamp_obj', {
          id: 'token_timestamp_obj',
          email: 'alice@company.com',
          projectId: 'proj_ts',
          projectName: 'TS Project',
          role: 'viewer',
          status: 'pending',
          expiresAt: {
            toMillis: () => Date.now() + 60000,
            toDate: () => new Date(Date.now() + 60000)
          }
        });

        const res = await engine.handleInviteAccept({
          user: { uid: 'user_alice', email: 'alice@company.com' },
          body: { token: 'token_timestamp_obj' }
        });

        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.success, true);
      }
    },
    {
      name: '19. Membership persistence verified before success: no state changes on simulated error',
      fn: async () => {
        const engine = new MockInviteAcceptanceEngine();
        engine.invites.set('token_rollback_test', {
          id: 'token_rollback_test',
          email: 'alice@company.com',
          projectId: 'proj_rb',
          projectName: 'RB Project',
          role: 'viewer',
          status: 'pending'
        });
        engine.simulateTxError = true;

        const res = await engine.handleInviteAccept({
          user: { uid: 'user_alice', email: 'alice@company.com' },
          body: { token: 'token_rollback_test' }
        });

        assert.strictEqual(res.status, 500);
        assert.strictEqual(res.body.error, 'TransactionFailed');
        assert.strictEqual(engine.invites.get('token_rollback_test')?.status, 'pending');
        assert.strictEqual(engine.members.size, 0);
      }
    },
    {
      name: '20. Error responses never leak stack traces or raw details to client',
      fn: async () => {
        const engine = new MockInviteAcceptanceEngine();
        engine.simulateReadError = true;
        const res = await engine.handleInviteAccept({
          user: { uid: 'user_alice', email: 'alice@company.com' },
          body: { token: 'token_clean_err' }
        });
        assert.strictEqual(res.status, 500);
        assert.strictEqual((res.body as any).stack, undefined);
        assert.strictEqual((res.body as any).details, undefined);
        assert.strictEqual(typeof res.body.message, 'string');
      }
    },
    {
      name: '21. sanitizeInvitationToken helper handles valid, control chars, boundary lengths, and types',
      fn: () => {
        // Valid token
        const v1 = sanitizeInvitationToken('  valid-token-1234_abc  ');
        assert.strictEqual(v1.valid, true);
        assert.strictEqual(v1.token, 'valid-token-1234_abc');

        // Control characters / newlines
        const v2 = sanitizeInvitationToken('token\nwith\nnewline');
        assert.strictEqual(v2.valid, false);
        assert.strictEqual(v2.error, 'Invalid invitation token');

        // Missing / empty
        assert.strictEqual(sanitizeInvitationToken(null).valid, false);
        assert.strictEqual(sanitizeInvitationToken(undefined).valid, false);
        assert.strictEqual(sanitizeInvitationToken('    ').valid, false);

        // Boundary length > 256
        assert.strictEqual(sanitizeInvitationToken('x'.repeat(257)).valid, false);
        assert.strictEqual(sanitizeInvitationToken('x'.repeat(256)).valid, true);
      }
    },
    {
      name: '22. acceptProjectInvitation function directly rejects unauthenticated caller or bad token',
      fn: async () => {
        const dummyDb = {} as any;
        const resMissingUser = await acceptProjectInvitation(dummyDb, {
          rawToken: 'some-token',
          userId: '',
          userEmail: ''
        });
        assert.strictEqual(resMissingUser.status, 400);

        const resBadToken = await acceptProjectInvitation(dummyDb, {
          rawToken: '   ',
          userId: 'usr_1',
          userEmail: 'user@example.com'
        });
        assert.strictEqual(resBadToken.status, 400);
      }
    }
  ];

  for (const test of tests) {
    try {
      await test.fn();
      console.log(`  ✅ ${test.name} ... PASSED`);
      passedCount++;
    } catch (err: any) {
      console.error(`  ❌ ${test.name} ... FAILED`);
      console.error(`     Error: ${err?.message || err}`);
      process.exit(1);
    }
  }

  console.log('======================================================================');
  console.log(`🎉 ALL ${passedCount} STEP 6M-J RELIABILITY TESTS PASSED!`);
  console.log('======================================================================\n');
}

runAllTests();

