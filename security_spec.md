# EchoNote Security Specification
## Phase 0: Payload-First Security TDD & Attribute-Based Access Control (ABAC)

---

### 1. Data Invariants

1. **Master Gate (Relational Sync) Invariant**:
   - Access to collaborative resources (`tasks`, `comments`, `projectActivities`, `recordings`, `transcriptions`) is strictly derived from parent resource verification (`projects/{projectId}`) and verified project membership (`projectMembers/{uid_projectId}`).
   - Revocation of project membership synchronously terminates read and write access to all associated tasks, comments, and project content.

2. **Identity Integrity & Anti-Spoofing Invariant**:
   - For all user-authored resources (`recordings`, `tasks`, `comments`, `projectActivities`, `projectMembers`), incoming author and identity fields (`userId`, `createdBy`) MUST match `request.auth.uid`.
   - Email-based validations must require verified credentials (`request.auth.token.email_verified == true`).
   - Project ownership (`userId`) is immutable once set and cannot be reassigned via direct client document writes.

3. **Privilege Escalation & Role Boundaries Invariant**:
   - Direct client writes cannot grant elevated platform or project roles.
   - In `users/{userId}`, users cannot set or modify `role`, `platform_admin`, `claims`, `plan`, `monthlyMinuteLimit`, `monthlyThinkingLimit`, or organization role fields.
   - In `projectMembers`, standard users cannot self-assign `role: 'owner'`. Only project owners and authorized project admins can configure member roles, or users joining via validated invites.

4. **Tenant & Organization Boundary Invariant**:
   - Corporate organizations (`organizations/{orgId}`), departments, org members, SSO identity mappings, and organization analytics are strictly constrained to organization members and administrators.
   - Client-side deletion of organizations is strictly forbidden (`allow delete: if false;`). Direct client-side deletion of projects is forbidden for standard non-admin users (`allow delete: if isAdmin();`).

5. **Immutable Records & Audit Invariant**:
   - Audit logs (`/organizations/{orgId}/auditLogs/{logId}`) are completely immutable to direct client writes (`allow write: if false;`).
   - Decision history records (`/decisionHistory/{id}`), AI usage logs (`/aiUsageLogs/{id}`), and billing transactions (`/transactions/{id}`) cannot be updated or deleted by clients.
   - Project activities (`projectActivities/{id}`) are append-only; update operations are rejected (`allow update: if false;`).

6. **Secure List Queries Invariant**:
   - Rule blocks for `list` queries evaluate `resource.data` against `request.auth.uid`, verified project membership, or organization boundaries. Rules never delegate query security to client-side filters.

7. **Path Variable Hardening & Resource Exhaustion (DoS) Invariant**:
   - All document IDs in path variables are validated against alphanumeric format and length restrictions (`isValidId()`).
   - String fields and array sizes are constrained with `.size()` limits to prevent "Denial of Wallet" attacks.

---

### 2. The "Dirty Dozen" Malicious Payloads

The following 12 test payloads represent adversarial attempts to bypass identity, integrity, tenant isolation, or state machines:

#### Payload D1: Anonymous / Unauthenticated Task Write
- **Target**: `POST /tasks/task_evil_01`
- **Auth**: `null` (Unauthenticated)
- **Data**:
  ```json
  {
    "projectId": "proj_123",
    "title": "Hacked Task",
    "assigneeEmail": "victim@example.com",
    "status": "pending",
    "createdBy": "attacker_uid"
  }
  ```
- **Expected Outcome**: `PERMISSION_DENIED` (Authentication required)

#### Payload D2: Self-Assigned Project Ownership Privilege Escalation
- **Target**: `PUT /projectMembers/attacker_proj123`
- **Auth**: `{ uid: "attacker_uid", email: "attacker@test.com", email_verified: true }`
- **Data**:
  ```json
  {
    "userId": "attacker_uid",
    "projectId": "proj_123",
    "role": "owner",
    "email": "attacker@test.com"
  }
  ```
- **Expected Outcome**: `PERMISSION_DENIED` (Cannot self-grant owner role directly)

#### Payload D3: Ghost Field / Shadow Update Injection
- **Target**: `PATCH /tasks/task_legit_01`
- **Auth**: `{ uid: "member_uid", email: "member@test.com", email_verified: true }`
- **Data**:
  ```json
  {
    "status": "completed",
    "isVerified": true,
    "systemRole": "superadmin"
  }
  ```
- **Expected Outcome**: `PERMISSION_DENIED` (Shadow fields rejected via strict `affectedKeys().hasOnly()`)

#### Payload D4: Cross-Project IDOR Task Creation
- **Target**: `POST /tasks/task_idor_01`
- **Auth**: `{ uid: "outsider_uid", email: "outsider@evil.com", email_verified: true }`
- **Data**:
  ```json
  {
    "projectId": "proj_victim_confidential",
    "title": "Unauthorized Injected Task",
    "assigneeEmail": "outsider@evil.com",
    "status": "pending",
    "createdBy": "outsider_uid"
  }
  ```
- **Expected Outcome**: `PERMISSION_DENIED` (Caller is not a member or owner of the referenced project)

#### Payload D5: Viewer Comment Creation Bypass
- **Target**: `POST /comments/comment_viewer_01`
- **Auth**: `{ uid: "viewer_uid", email: "viewer@corp.com", email_verified: true }`
- **Context**: `viewer_uid` has `role: 'viewer'` in `projectMembers`
- **Data**:
  ```json
  {
    "projectId": "proj_123",
    "recordingId": "rec_123",
    "userId": "viewer_uid",
    "userEmail": "viewer@corp.com",
    "userName": "Viewer User",
    "content": "Malicious comment injected by read-only viewer",
    "createdAt": "2026-09-22T10:00:00.000Z"
  }
  ```
- **Expected Outcome**: `PERMISSION_DENIED` (Read-only viewers cannot create comments)

#### Payload D6: Cross-Tenant Project Ownership Hijack
- **Target**: `PATCH /projects/proj_victim_123`
- **Auth**: `{ uid: "attacker_uid", email: "attacker@test.com", email_verified: true }`
- **Data**:
  ```json
  {
    "userId": "attacker_uid",
    "name": "Hijacked Project Name"
  }
  ```
- **Expected Outcome**: `PERMISSION_DENIED` (Project owner `userId` is immutable; non-owner cannot hijack project)

#### Payload D7: User Profile Role Escalation
- **Target**: `PATCH /users/user_target_123`
- **Auth**: `{ uid: "user_target_123", email: "user@test.com", email_verified: true }`
- **Data**:
  ```json
  {
    "role": "admin",
    "platform_admin": true,
    "plan": "enterprise"
  }
  ```
- **Expected Outcome**: `PERMISSION_DENIED` (Users cannot elevate role, platform_admin, or subscription tier)

#### Payload D8: Unauthorized Recording Deletion by Project Viewer
- **Target**: `DELETE /recordings/rec_important_01`
- **Auth**: `{ uid: "viewer_uid", email: "viewer@corp.com", email_verified: true }`
- **Context**: `viewer_uid` is only a `viewer` on the project; recording belongs to `creator_uid`
- **Expected Outcome**: `PERMISSION_DENIED` (Viewers and non-owners cannot delete recordings)

#### Payload D9: Direct Client Audit Log Mutation
- **Target**: `POST /organizations/org_corp/auditLogs/log_fake_01`
- **Auth**: `{ uid: "org_member_uid", email: "member@corp.com", email_verified: true }`
- **Data**:
  ```json
  {
    "action": "wipe_database",
    "actor": "admin@corp.com",
    "details": "Falsified audit log entry"
  }
  ```
- **Expected Outcome**: `PERMISSION_DENIED` (Audit logs are strictly server-write only `allow write: if false;`)

#### Payload D10: Immutable Decision History Mutation
- **Target**: `PATCH /decisionHistory/dec_123`
- **Auth**: `{ uid: "author_uid", email: "author@test.com", email_verified: true }`
- **Data**:
  ```json
  {
    "summary": "Tampered decision notes"
  }
  ```
- **Expected Outcome**: `PERMISSION_DENIED` (Decision history is immutable)

#### Payload D11: Resource Exhaustion / Denial of Wallet Injection
- **Target**: `POST /tasks/task_giant_01`
- **Auth**: `{ uid: "member_uid", email: "member@corp.com", email_verified: true }`
- **Data**:
  ```json
  {
    "projectId": "proj_123",
    "title": "A".repeat(1500000),
    "assigneeEmail": "member@corp.com",
    "status": "pending",
    "createdBy": "member_uid"
  }
  ```
- **Expected Outcome**: `PERMISSION_DENIED` (Field size limit exceeded)

#### Payload D12: Unauthorized Project Invitation Creation
- **Target**: `POST /invites/invite_evil_01`
- **Auth**: `{ uid: "viewer_uid", email: "viewer@corp.com", email_verified: true }`
- **Data**:
  ```json
  {
    "projectId": "proj_123",
    "role": "owner",
    "email": "accomplice@evil.com",
    "invitedBy": "viewer_uid"
  }
  ```
- **Expected Outcome**: `PERMISSION_DENIED` (Only project owner/admin can issue invitations; cannot invite as owner)

---

### 3. Verification Test Suite Architecture

The test runner `firestore.rules.test.ts` executes all 12 Dirty Dozen payloads as well as legitimate baseline operations to confirm that:
1. All 12 adversarial bypass attempts produce `PERMISSION_DENIED`.
2. Authorized project operations (member task create/update, owner invite, author comment, owner recording edit) are `ALLOWED`.
