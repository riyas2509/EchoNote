/**
 * EchoNote Phase 1 Step 1: Team Collaboration & Permission System
 * Foundation Unit Tests: Role Normalization & Type Contracts
 * 
 * Verifies:
 * 1. Target project role mappings:
 *    - editor -> admin (backward-compatible normalization)
 *    - admin -> admin
 *    - owner -> owner
 *    - commenter -> commenter
 *    - viewer -> viewer
 * 2. Case-insensitivity & whitespace trimming
 * 3. Safe least-privilege default for unknown/invalid values:
 *    - Unknown values must resolve to 'viewer' and NEVER become 'admin'
 * 4. Comment interface structure & ProjectMember backward compatibility
 */

import {
  normalizeProjectRole,
  TargetProjectRole,
  CollaborationRole,
  ProjectMember,
  Comment,
  AuthoritativeOrgRole,
  OrgRole
} from "../types.js";

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

console.log("\n=======================================================");
console.log("🚀 RUNNING PHASE 1 STEP 1 FOUNDATION TESTS");
console.log("=======================================================\n");

// -------------------------------------------------------------
// SECTION 1: Exact Target Role Normalization
// -------------------------------------------------------------
console.log("--- Section 1: Canonical & Legacy Role Normalization ---");
assert('normalizeProjectRole("editor") === "admin"', normalizeProjectRole("editor") === "admin", normalizeProjectRole("editor"));
assert('normalizeProjectRole("admin") === "admin"', normalizeProjectRole("admin") === "admin", normalizeProjectRole("admin"));
assert('normalizeProjectRole("owner") === "owner"', normalizeProjectRole("owner") === "owner", normalizeProjectRole("owner"));
assert('normalizeProjectRole("commenter") === "commenter"', normalizeProjectRole("commenter") === "commenter", normalizeProjectRole("commenter"));
assert('normalizeProjectRole("viewer") === "viewer"', normalizeProjectRole("viewer") === "viewer", normalizeProjectRole("viewer"));

// -------------------------------------------------------------
// SECTION 2: Case-Insensitivity and Whitespace Trimming
// -------------------------------------------------------------
console.log("\n--- Section 2: Case-Insensitivity & Whitespace Handling ---");
assert('normalizeProjectRole("EDITOR") === "admin"', normalizeProjectRole("EDITOR") === "admin", normalizeProjectRole("EDITOR"));
assert('normalizeProjectRole("  editor  ") === "admin"', normalizeProjectRole("  editor  ") === "admin", normalizeProjectRole("  editor  "));
assert('normalizeProjectRole("Admin") === "admin"', normalizeProjectRole("Admin") === "admin", normalizeProjectRole("Admin"));
assert('normalizeProjectRole(" OWNER ") === "owner"', normalizeProjectRole(" OWNER ") === "owner", normalizeProjectRole(" OWNER "));
assert('normalizeProjectRole("Commenter") === "commenter"', normalizeProjectRole("Commenter") === "commenter", normalizeProjectRole("Commenter"));
assert('normalizeProjectRole("  VIEWER  ") === "viewer"', normalizeProjectRole("  VIEWER  ") === "viewer", normalizeProjectRole("  VIEWER  "));

// -------------------------------------------------------------
// SECTION 3: Safe Least-Privilege Invariants (Unknown / Invalid Roles)
// -------------------------------------------------------------
console.log("\n--- Section 3: Safe Least-Privilege Invariants ---");
const invalidTestCases: Array<[string, any]> = [
  ["undefined", undefined],
  ["null", null],
  ["empty string", ""],
  ["whitespace only", "   "],
  ["super_admin (org role)", "super_admin"],
  ["org_admin (org role)", "org_admin"],
  ["team_manager (org role)", "team_manager"],
  ["team_lead (org role)", "team_lead"],
  ["guest (org role)", "guest"],
  ["arbitrary role 'root'", "root"],
  ["arbitrary role 'hacker'", "hacker"],
  ["arbitrary role 'moderator'", "moderator"],
  ["arbitrary role 'member'", "member"],
];

for (const [label, val] of invalidTestCases) {
  const result = normalizeProjectRole(val);
  assert(`Unknown role "${label}" resolves to 'viewer'`, result === "viewer", { input: val, result });
  assert(`Unknown role "${label}" NEVER resolves to 'admin'`, result !== "admin", { input: val, result });
}

// -------------------------------------------------------------
// SECTION 4: TypeScript Contract & Type Compatibility
// -------------------------------------------------------------
console.log("\n--- Section 4: Data Model Contracts ---");

// Test ProjectMember accepts target roles and legacy 'editor'
const testMembers: ProjectMember[] = [
  { projectId: "p1", uid: "u1", email: "owner@test.com", role: "owner", joinedAt: "2026-09-21T00:00:00Z" },
  { projectId: "p1", uid: "u2", email: "admin@test.com", role: "admin", joinedAt: "2026-09-21T00:00:00Z" },
  { projectId: "p1", uid: "u3", email: "commenter@test.com", role: "commenter", joinedAt: "2026-09-21T00:00:00Z" },
  { projectId: "p1", uid: "u4", email: "viewer@test.com", role: "viewer", joinedAt: "2026-09-21T00:00:00Z" },
  // Legacy document compatibility
  { projectId: "p1", uid: "u5", email: "editor@test.com", role: "editor", joinedAt: "2026-09-21T00:00:00Z" }
];

assert("ProjectMember interface supports all 4 target roles + legacy 'editor'", testMembers.length === 5);
assert(
  "Normalizing legacy member role resolves to 'admin'",
  normalizeProjectRole(testMembers[4].role) === "admin"
);

// Test Comment interface structure
const sampleComment: Comment = {
  id: "comment_123",
  recordingId: "rec_456",
  projectId: "p1",
  organizationId: "org_789",
  userId: "u3",
  userEmail: "commenter@test.com",
  userName: "Jane Commenter",
  content: "Great observation during the second quarter analysis.",
  timestampSeconds: 142.5,
  parentCommentId: undefined,
  createdAt: "2026-09-21T00:05:00Z",
  updatedAt: undefined
};

assert("Comment contract satisfies all required architecture fields", sampleComment.id === "comment_123" && sampleComment.recordingId === "rec_456");

// Test AuthoritativeOrgRole preservation
const orgRoles: AuthoritativeOrgRole[] = ['owner', 'org_admin', 'team_manager', 'member', 'viewer'];
assert("AuthoritativeOrgRole preserves all 5 tenant tiers intact", orgRoles.length === 5);

console.log("\n=======================================================");
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
console.log("=======================================================\n");

if (failed > 0) {
  process.exit(1);
} else {
  console.log("🎉 ALL FOUNDATION TESTS PASSED SUCCESSFULLY!\n");
}
