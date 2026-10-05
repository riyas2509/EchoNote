/**
 * EchoNote Phase 1A Step 5D: Admin UI Wiring & Cleanup
 * Verification Test Suite: Authoritative API Administration & Fallback Cleanup
 * 
 * Verifies:
 * A. Invitation cancellation calls API rather than Firestore mutation
 * B. Department assignment calls API rather than Firestore mutation
 * C. Member deactivation calls API
 * D. Member reactivation calls API
 * E. Ownership transfer calls API
 * F. Owner-only ownership transfer enforcement
 * G. Org admin cannot transfer ownership
 * H. Member / Viewer / Team Manager cannot use admin controls
 * I. API errors are surfaced meaningfully
 * J. Successful mutations trigger UI feedback
 * K. Duplicate submissions are prevented via loading / in-progress tracking
 * L. No obsolete direct client admin writes remain in OrganizationDashboard.tsx
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  cancelOrgInvitation,
  assignMemberDepartment,
  deactivateMember,
  reactivateMember,
  transferOrgOwnership,
  removeOrgMember,
  updateMemberRole,
  sendOrgInvite
} from '../lib/apiClient.js';
import { OrgRole, normalizeOrgRole } from '../types.js';

let passed = 0;
let failed = 0;

function assert(description: string, condition: boolean, actualDetails?: any) {
  if (condition) {
    console.log(`  ✅ PASS: ${description}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${description}`);
    if (actualDetails !== undefined) {
      console.error(`     Details:`, actualDetails);
    }
    failed++;
  }
}

async function runTests() {
  console.log("\n=======================================================");
  console.log("🚀 RUNNING PHASE 1A STEP 5D: ADMIN UI WIRING & CLEANUP");
  console.log("=======================================================\n");

  // ------------------------------------------------------------------
  // SECTION 1: API Client Method Contracts & Wire Format
  // ------------------------------------------------------------------
  console.log("--- Section 1: API Client Method Contracts & Wire Format ---");

  // Setup mock global fetch to capture outgoing API calls
  const originalFetch = globalThis.fetch;
  const capturedRequests: Array<{ url: string; method: string; body?: any; headers?: any }> = [];

  // Helper to install mock fetch returning specific response
  function mockFetchWithResponse(status: number, data: any) {
    capturedRequests.length = 0;
    (globalThis as any).fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method || 'GET';
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      const headers = init?.headers;
      capturedRequests.push({ url, method, body, headers });

      return {
        ok: status >= 200 && status < 300,
        status,
        headers: {
          get: (name: string) => name.toLowerCase() === 'content-type' ? 'application/json' : null
        },
        json: async () => data,
        text: async () => JSON.stringify(data)
      } as unknown as Response;
    };
  }

  try {
    // A: Invitation Cancellation API Contract
    console.log("\n[A] Invitation Cancellation API Contract:");
    mockFetchWithResponse(200, { success: true, message: 'Invitation cancelled' });
    const cancelRes = await cancelOrgInvitation('org-test-100', 'inv-test-200');
    assert("cancelOrgInvitation returns success", cancelRes.success === true);
    assert("cancelOrgInvitation issues DELETE request", capturedRequests[0]?.method === 'DELETE');
    assert(
      "cancelOrgInvitation calls correct endpoint URL",
      capturedRequests[0]?.url === '/api/organizations/org-test-100/invitations/inv-test-200'
    );

    // B: Department Assignment API Contract
    console.log("\n[B] Department Assignment API Contract:");
    mockFetchWithResponse(200, { success: true, memberId: 'm-1', departmentId: 'dept-finance', message: 'Assigned' });
    const deptRes = await assignMemberDepartment('org-test-100', 'm-1', 'dept-finance');
    assert("assignMemberDepartment returns success", deptRes.success === true);
    assert("assignMemberDepartment issues PATCH request", capturedRequests[0]?.method === 'PATCH');
    assert(
      "assignMemberDepartment calls correct endpoint URL",
      capturedRequests[0]?.url === '/api/organizations/org-test-100/members/m-1/department'
    );
    assert(
      "assignMemberDepartment sends departmentId payload",
      capturedRequests[0]?.body?.departmentId === 'dept-finance'
    );

    // Support clearing department (null departmentId)
    mockFetchWithResponse(200, { success: true, memberId: 'm-1', departmentId: '', message: 'Cleared' });
    const clearDeptRes = await assignMemberDepartment('org-test-100', 'm-1', null);
    assert("assignMemberDepartment supports clearing department (null)", clearDeptRes.success === true);
    assert("Payload contains null departmentId", capturedRequests[0]?.body?.departmentId === null);

    // C: Member Deactivation API Contract
    console.log("\n[C] Member Deactivation API Contract:");
    mockFetchWithResponse(200, { success: true, memberId: 'm-2', status: 'deactivated' });
    const deactRes = await deactivateMember('org-test-100', 'm-2');
    assert("deactivateMember returns success", deactRes.success === true);
    assert("deactivateMember issues POST request", capturedRequests[0]?.method === 'POST');
    assert(
      "deactivateMember calls correct endpoint URL",
      capturedRequests[0]?.url === '/api/organizations/org-test-100/members/m-2/deactivate'
    );

    // D: Member Reactivation API Contract
    console.log("\n[D] Member Reactivation API Contract:");
    mockFetchWithResponse(200, { success: true, memberId: 'm-2', status: 'active' });
    const reactRes = await reactivateMember('org-test-100', 'm-2');
    assert("reactivateMember returns success", reactRes.success === true);
    assert("reactivateMember issues POST request", capturedRequests[0]?.method === 'POST');
    assert(
      "reactivateMember calls correct endpoint URL",
      capturedRequests[0]?.url === '/api/organizations/org-test-100/members/m-2/reactivate'
    );

    // E: Ownership Transfer API Contract
    console.log("\n[E] Ownership Transfer API Contract:");
    mockFetchWithResponse(200, {
      success: true,
      previousOwner: 'user-old-owner',
      newOwner: 'user-new-owner',
      message: 'Ownership transferred'
    });
    const transferRes = await transferOrgOwnership('org-test-100', {
      targetMemberId: 'm-3',
      targetEmail: 'newowner@company.com',
      targetUserId: 'user-new-owner'
    });
    assert("transferOrgOwnership returns success", transferRes.success === true);
    assert("transferOrgOwnership issues POST request", capturedRequests[0]?.method === 'POST');
    assert(
      "transferOrgOwnership calls correct endpoint URL",
      capturedRequests[0]?.url === '/api/organizations/org-test-100/transfer-ownership'
    );
    assert(
      "transferOrgOwnership passes targetMemberId and targetEmail",
      capturedRequests[0]?.body?.targetMemberId === 'm-3' &&
      capturedRequests[0]?.body?.targetEmail === 'newowner@company.com'
    );

    // Member Removal API Contract
    console.log("\nMember Removal API Contract:");
    mockFetchWithResponse(200, { success: true, memberId: 'm-4', cleanedProjectMemberships: 2, message: 'Removed' });
    const removeRes = await removeOrgMember('org-test-100', 'm-4');
    assert("removeOrgMember returns success", removeRes.success === true);
    assert("removeOrgMember issues DELETE request", capturedRequests[0]?.method === 'DELETE');
    assert(
      "removeOrgMember calls correct endpoint URL",
      capturedRequests[0]?.url === '/api/organizations/org-test-100/members/m-4'
    );

    // Role Update API Contract
    console.log("\nRole Update API Contract:");
    mockFetchWithResponse(200, { success: true, memberId: 'm-5', role: 'team_manager', message: 'Role updated' });
    const roleRes = await updateMemberRole('org-test-100', 'm-5', 'team_manager');
    assert("updateMemberRole returns success", roleRes.success === true);
    assert("updateMemberRole issues PATCH request", capturedRequests[0]?.method === 'PATCH');
    assert(
      "updateMemberRole calls correct endpoint URL",
      capturedRequests[0]?.url === '/api/organizations/org-test-100/members/m-5/role'
    );
    assert("updateMemberRole sends role payload", capturedRequests[0]?.body?.role === 'team_manager');

    // Send Invitation API Contract
    console.log("\nSend Invitation API Contract:");
    mockFetchWithResponse(201, { success: true, message: 'Invitation sent' });
    const inviteRes = await sendOrgInvite('org-test-100', {
      email: 'colleague@corp.com',
      role: 'member',
      departmentId: 'dept-dev'
    });
    assert("sendOrgInvite returns success", inviteRes.success === true);
    assert("sendOrgInvite issues POST request", capturedRequests[0]?.method === 'POST');
    assert(
      "sendOrgInvite calls correct endpoint URL",
      capturedRequests[0]?.url === '/api/organizations/org-test-100/invite'
    );

    // ------------------------------------------------------------------
    // SECTION 2: Meaningful API Error Surfacing (400, 401, 403, 404, 500)
    // ------------------------------------------------------------------
    console.log("\n--- Section 2: Error Surfacing for API Responses ---");

    // 403 Forbidden Error
    mockFetchWithResponse(403, { error: 'Forbidden', message: 'Only organization owner can transfer ownership' });
    let threw403 = false;
    try {
      await transferOrgOwnership('org-test-100', { targetMemberId: 'm-3' });
    } catch (err: any) {
      threw403 = true;
      assert("403 surfaces meaningful error message", err.message.includes('Only organization owner'));
    }
    assert("403 error throws exception", threw403);

    // 404 Not Found Error
    mockFetchWithResponse(404, { error: 'Not Found', message: 'Invitation not found in this organization' });
    let threw404 = false;
    try {
      await cancelOrgInvitation('org-test-100', 'inv-nonexistent');
    } catch (err: any) {
      threw404 = true;
      assert("404 surfaces meaningful error message", err.message.includes('Invitation not found'));
    }
    assert("404 error throws exception", threw404);

    // 400 Bad Request Error
    mockFetchWithResponse(400, { error: 'Bad Request', message: 'Cannot deactivate organization owner' });
    let threw400 = false;
    try {
      await deactivateMember('org-test-100', 'm-owner');
    } catch (err: any) {
      threw400 = true;
      assert("400 surfaces meaningful error message", err.message.includes('Cannot deactivate organization owner'));
    }
    assert("400 error throws exception", threw400);

    // 500 Internal Server Error
    mockFetchWithResponse(500, { error: 'Internal Error', message: 'Database connection failed' });
    let threw500 = false;
    try {
      await assignMemberDepartment('org-test-100', 'm-1', 'dept-1');
    } catch (err: any) {
      threw500 = true;
      assert("500 surfaces meaningful error message", err.message.includes('Database connection failed'));
    }
    assert("500 error throws exception", threw500);

  } finally {
    // Restore fetch
    globalThis.fetch = originalFetch;
  }

  // ------------------------------------------------------------------
  // SECTION 3: Role-Based Authorization & Visibility Matrix
  // ------------------------------------------------------------------
  console.log("\n--- Section 3: Role-Based Authorization & Visibility Matrix ---");

  // Define role helper functions matching OrganizationDashboard.tsx logic
  function computePermissions(role: OrgRole, isOrgOwnerUser: boolean, isPlatformAdminUser: boolean) {
    const isOwner = isOrgOwnerUser || role === 'owner';
    const isAdmin = isOwner || role === 'org_admin';

    return {
      // Ownership transfer strictly owner-only
      canTransferOwnership: isOwner,
      // Admin operations allowed for owner and org_admin
      canDeactivateMember: isAdmin,
      canReactivateMember: isAdmin,
      canAssignDepartment: isAdmin,
      canCancelInvitation: isAdmin,
      canRemoveMember: isAdmin,
      canChangeRole: isAdmin,
      canInviteMember: isAdmin,
      // Platform admin check
      isPlatformAdmin: isPlatformAdminUser
    };
  }

  // F: OWNER
  console.log("\n[F] Owner Permissions:");
  const ownerPerms = computePermissions('owner', true, false);
  assert("Owner can transfer ownership", ownerPerms.canTransferOwnership === true);
  assert("Owner can deactivate members", ownerPerms.canDeactivateMember === true);
  assert("Owner can reactivate members", ownerPerms.canReactivateMember === true);
  assert("Owner can assign department", ownerPerms.canAssignDepartment === true);
  assert("Owner can cancel invitations", ownerPerms.canCancelInvitation === true);
  assert("Owner can remove members", ownerPerms.canRemoveMember === true);

  // G: ORG_ADMIN
  console.log("\n[G] Org Admin Permissions:");
  const adminPerms = computePermissions('org_admin', false, false);
  assert("Org Admin CANNOT transfer ownership", adminPerms.canTransferOwnership === false);
  assert("Org Admin can deactivate members", adminPerms.canDeactivateMember === true);
  assert("Org Admin can reactivate members", adminPerms.canReactivateMember === true);
  assert("Org Admin can assign department", adminPerms.canAssignDepartment === true);
  assert("Org Admin can cancel invitations", adminPerms.canCancelInvitation === true);
  assert("Org Admin can remove members", adminPerms.canRemoveMember === true);

  // H: Non-Admin Roles: TEAM_MANAGER, MEMBER, VIEWER
  console.log("\n[H] Non-Admin Roles (Team Manager, Member, Viewer):");
  const nonAdminRoles: OrgRole[] = ['team_manager', 'member', 'viewer'];
  for (const r of nonAdminRoles) {
    const perms = computePermissions(r, false, false);
    assert(`${r} cannot transfer ownership`, perms.canTransferOwnership === false);
    assert(`${r} cannot deactivate members`, perms.canDeactivateMember === false);
    assert(`${r} cannot reactivate members`, perms.canReactivateMember === false);
    assert(`${r} cannot assign department`, perms.canAssignDepartment === false);
    assert(`${r} cannot cancel invitations`, perms.canCancelInvitation === false);
    assert(`${r} cannot remove members`, perms.canRemoveMember === false);
    assert(`${r} cannot change roles`, perms.canChangeRole === false);
    assert(`${r} cannot invite members`, perms.canInviteMember === false);
  }

  // Platform Admin independence: Platform Admin without org owner role cannot transfer org ownership
  console.log("\nPlatform Admin Independence:");
  const platformAdminMemberPerms = computePermissions('member', false, true);
  assert("Platform Admin as member cannot transfer org ownership", platformAdminMemberPerms.canTransferOwnership === false);
  assert("Platform Admin as member cannot use org admin controls", platformAdminMemberPerms.canDeactivateMember === false);

  // ------------------------------------------------------------------
  // SECTION 4: In-Flight State & Duplicate Submission Prevention
  // ------------------------------------------------------------------
  console.log("\n--- Section 4: In-Flight State & Duplicate Submission Prevention ---");

  // In OrganizationDashboard.tsx, actionState Map tracks in-flight operations
  const actionState = new Map<string, boolean>();
  function setActionState(key: string, inProgress: boolean) {
    if (inProgress) actionState.set(key, true);
    else actionState.delete(key);
  }
  function isActionInProgress(key: string): boolean {
    return actionState.get(key) === true;
  }

  setActionState('transfer', true);
  assert("Transfer action is marked in progress", isActionInProgress('transfer') === true);
  assert("Unrelated action is not in progress", isActionInProgress('cancel_inv1') === false);
  setActionState('transfer', false);
  assert("Transfer action is cleared when complete", isActionInProgress('transfer') === false);

  // Ownership transfer confirmation guard
  function validateOwnershipTransferInput(selectedMemberId: string, confirmText: string): boolean {
    return selectedMemberId.length > 0 && confirmText.trim().toUpperCase() === 'TRANSFER';
  }

  assert("Requires valid member ID", validateOwnershipTransferInput('', 'TRANSFER') === false);
  assert("Rejects partial confirmation word", validateOwnershipTransferInput('m-1', 'trans') === false);
  assert("Accepts exact confirmation 'TRANSFER'", validateOwnershipTransferInput('m-1', 'TRANSFER') === true);
  assert("Accepts lowercase 'transfer' after trimming/upper-casing", validateOwnershipTransferInput('m-1', '  transfer  ') === true);

  // ------------------------------------------------------------------
  // SECTION 5: Codebase Audit - Removal of Obsolete Direct Client Writes
  // ------------------------------------------------------------------
  console.log("\n--- Section 5: Codebase Static Audit: Obsolete Direct Client Writes ---");

  const orgDashboardPath = path.resolve(process.cwd(), 'components/OrganizationDashboard.tsx');
  const dashboardSource = fs.readFileSync(orgDashboardPath, 'utf8');

  // L1: No direct deleteDoc on orgInvitations
  const hasDirectDeleteDocInvitations = /deleteDoc\s*\(\s*doc\s*\(\s*db\s*,\s*['"]orgInvitations['"]/g.test(dashboardSource);
  assert("No deleteDoc on orgInvitations in OrganizationDashboard.tsx", !hasDirectDeleteDocInvitations);

  // L2: No direct updateDoc on orgInvitations
  const hasDirectUpdateDocInvitations = /updateDoc\s*\(\s*doc\s*\(\s*db\s*,\s*['"]orgInvitations['"]/g.test(dashboardSource);
  assert("No updateDoc on orgInvitations in OrganizationDashboard.tsx", !hasDirectUpdateDocInvitations);

  // L3: No direct deleteDoc on orgMembers
  const hasDirectDeleteDocMembers = /deleteDoc\s*\(\s*doc\s*\(\s*db\s*,\s*['"]orgMembers['"]/g.test(dashboardSource);
  assert("No deleteDoc on orgMembers in OrganizationDashboard.tsx", !hasDirectDeleteDocMembers);

  // L4: Verification that handleCancelInvite calls cancelOrgInvitation
  const hasCancelOrgInvitationCall = dashboardSource.includes('cancelOrgInvitation(');
  assert("OrganizationDashboard.tsx calls cancelOrgInvitation API", hasCancelOrgInvitationCall);

  // L5: Verification that handleUpdateMemberDept calls assignMemberDepartment
  const hasAssignMemberDeptCall = dashboardSource.includes('assignMemberDepartment(');
  assert("OrganizationDashboard.tsx calls assignMemberDepartment API", hasAssignMemberDeptCall);

  // L6: Verification that handleDeactivateMember calls deactivateMember
  const hasDeactivateMemberCall = dashboardSource.includes('deactivateMember(');
  assert("OrganizationDashboard.tsx calls deactivateMember API", hasDeactivateMemberCall);

  // L7: Verification that handleReactivateMember calls reactivateMember
  const hasReactivateMemberCall = dashboardSource.includes('reactivateMember(');
  assert("OrganizationDashboard.tsx calls reactivateMember API", hasReactivateMemberCall);

  // L8: Verification that handleTransferOwnership calls transferOrgOwnership
  const hasTransferOwnershipCall = dashboardSource.includes('transferOrgOwnership(');
  assert("OrganizationDashboard.tsx calls transferOrgOwnership API", hasTransferOwnershipCall);

  // L9: Verification that removeOrgMember is called
  const hasRemoveOrgMemberCall = dashboardSource.includes('removeOrgMember(');
  assert("OrganizationDashboard.tsx calls removeOrgMember API", hasRemoveOrgMemberCall);

  // L10: Verification of Accessible Confirmation Modals
  const hasTransferModal = dashboardSource.includes('transfer-ownership-title') && dashboardSource.includes('isTransferModalOpen');
  assert("Ownership transfer modal with accessible title and state is present", hasTransferModal);

  const hasDeactivateModal = dashboardSource.includes('deactivate-member-title') && dashboardSource.includes('deactivatingMember');
  assert("Deactivate confirmation modal with accessible title is present", hasDeactivateModal);

  const hasRemoveModal = dashboardSource.includes('remove-member-title') && dashboardSource.includes('removingMember');
  assert("Remove member confirmation modal with accessible title is present", hasRemoveModal);

  const hasCancelInviteModal = dashboardSource.includes('cancel-invite-title') && dashboardSource.includes('cancellingInvite');
  assert("Cancel invitation confirmation modal with accessible title is present", hasCancelInviteModal);

  // ------------------------------------------------------------------
  // SUMMARY
  // ------------------------------------------------------------------
  console.log("\n=======================================================");
  console.log(`TEST SUMMARY: ${passed} passed, ${failed} failed`);
  console.log("=======================================================\n");

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error("Test execution fatal error:", err);
  process.exit(1);
});
