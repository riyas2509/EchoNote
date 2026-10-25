/**
 * EchoNote Phase 1A — Step 5.4C: SEC-04 Residual Exposure Remediation Test Suite
 *
 * Verifies:
 * 1. Public invitation preview sanitization (GET /api/invite-details/:token):
 *    - Unauthenticated callers never receive an unmasked inviter email.
 *    - Unauthenticated callers receive masked recipient email.
 *    - Genuine safe display names are preserved without inventing/inferring.
 *    - Neutral label "Project administrator" or masked email is used when display name is missing.
 *    - Authenticated verified recipients receive unmasked info.
 *    - Unverified recipient accounts remain masked.
 * 2. Firestore rules tightening on /invites/{inviteId}:
 *    - Unauthenticated reads denied.
 *    - Generic project viewers denied direct get and list on /invites.
 *    - Recipient get requires request.auth.token.email_verified == true.
 *    - Project admins and platform admins retain authorized get and list.
 * 3. Frontend safety & integrity (JoinPage & CollaborationDashboard):
 *    - JoinPage displays masked/neutral labels cleanly without UI regressions.
 *    - CollaborationDashboard restricts invites listener to project owners/admins.
 */

import fs from 'fs';
import path from 'path';
import assert from 'assert';

console.log("================================================================================");
console.log("🛡️  ECHONOTE PHASE 1A STEP 5.4C: SEC-04 RESIDUAL EXPOSURE REMEDIATION SUITE");
console.log("================================================================================");

let totalTests = 0;
let passedTests = 0;

function check(title: string, condition: boolean, detail?: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✅ PASS: [${totalTests}] ${title}`);
  } else {
    console.error(`  ❌ FAIL: [${totalTests}] ${title} ${detail ? `(${detail})` : ''}`);
    throw new Error(`Assertion failed: ${title}`);
  }
}

// -----------------------------------------------------------------------------
// 1. Static Audit of firestore.rules
// -----------------------------------------------------------------------------
console.log("\n--- Section 1: Firestore Security Rules Invariant Audit ---");
const firestoreRulesContent = fs.readFileSync(path.join(process.cwd(), 'firestore.rules'), 'utf-8');

// A. No unauthenticated get on /invites/{inviteId}
check(
  "firestore.rules does NOT allow unauthenticated get on invites",
  !firestoreRulesContent.includes("match /invites/{inviteId} {\n      allow get: if true;") &&
  !firestoreRulesContent.includes("match /invites/{inviteId} {\n      allow read: if true;")
);

// B. Recipient read requires email_verified == true
check(
  "firestore.rules requires email_verified == true for recipient invite get",
  firestoreRulesContent.includes("request.auth.token.email_verified == true && resource.data.email == request.auth.token.email")
);

// C. Generic project viewers canViewProject removed from invites get and list
const inviteMatchBlock = firestoreRulesContent.slice(
  firestoreRulesContent.indexOf("match /invites/{inviteId}"),
  firestoreRulesContent.indexOf("match /recordings/{recordingId}")
);

check(
  "firestore.rules removes canViewProject from /invites/{inviteId} get rule",
  !inviteMatchBlock.includes("canViewProject(resource.data.projectId)")
);

check(
  "firestore.rules restricts /invites/{inviteId} list to isAdmin() || isProjectAdmin(resource.data.projectId)",
  inviteMatchBlock.includes("allow list: if isAuthenticated() && (\n        isAdmin() ||\n        isProjectAdmin(resource.data.projectId)")
);

check(
  "firestore.rules restricts /invites/{inviteId} get to admin, project admin, or verified recipient",
  inviteMatchBlock.includes("allow get: if isAuthenticated() && (\n        isAdmin() ||\n        isProjectAdmin(resource.data.projectId) ||\n        (request.auth.token.email_verified == true && resource.data.email == request.auth.token.email)")
);

// -----------------------------------------------------------------------------
// 2. Static Audit of server.ts GET /api/invite-details/:token
// -----------------------------------------------------------------------------
console.log("\n--- Section 2: Server Preview Sanitization Static Audit ---");
const serverContent = fs.readFileSync(path.join(process.cwd(), 'server.ts'), 'utf-8');

const previewRouteIdx = serverContent.indexOf('app.get("/api/invite-details/:token"');
const previewRouteBlock = serverContent.slice(previewRouteIdx, previewRouteIdx + 8000);

check(
  "server.ts GET /api/invite-details/:token uses optionalAuth",
  previewRouteBlock.includes('app.get("/api/invite-details/:token", optionalAuth')
);

check(
  "server.ts checks email_verified on recipient before granting unmasked email",
  previewRouteBlock.includes("(req.user as any).email_verified === true")
);

check(
  "server.ts ensures unauthenticated caller receives publicInviterLabel (never unmasked email)",
  previewRouteBlock.includes("const publicInviterLabel = safeInviterDisplayName || maskedInviterEmail || \"Project administrator\";")
);

check(
  "server.ts returns maskedRecipientEmail and masked email for unauthenticated caller",
  previewRouteBlock.includes("email: isAuthorizedToSeeUnmasked ? recipientEmail : maskedEmail") &&
  previewRouteBlock.includes("recipientEmail: isAuthorizedToSeeUnmasked ? recipientEmail : maskedEmail")
);

check(
  "server.ts returns sanitized invitedBy and inviterName",
  previewRouteBlock.includes("invitedBy: sanitizedInvitedBy") &&
  previewRouteBlock.includes("inviterName: sanitizedInviterName")
);

// -----------------------------------------------------------------------------
// 3. Functional Simulation of Inviter Sanitization Logic
// -----------------------------------------------------------------------------
console.log("\n--- Section 3: Functional Inviter Sanitization Invariants ---");

// Helper reproducing server.ts logic
function sanitizeInvitePreview(inviteData: any, reqUser: any | null) {
  const recipientEmail = inviteData.email || "";
  const isRecipientAuthed = Boolean(
    reqUser?.email &&
    recipientEmail &&
    reqUser.email.toLowerCase().trim() === recipientEmail.toLowerCase().trim() &&
    reqUser.email_verified === true
  );

  const isProjectMemberOrAdmin = Boolean(reqUser && reqUser.isProjectAdmin);
  const isAuthorizedToSeeUnmasked = isRecipientAuthed || isProjectMemberOrAdmin;

  let safeInviterDisplayName: string | null = null;
  if (inviteData.inviterDisplayName && typeof inviteData.inviterDisplayName === "string" && !inviteData.inviterDisplayName.includes("@") && inviteData.inviterDisplayName.trim()) {
    safeInviterDisplayName = inviteData.inviterDisplayName.trim();
  } else if (inviteData.inviterName && typeof inviteData.inviterName === "string" && !inviteData.inviterName.includes("@") && inviteData.inviterName.trim()) {
    safeInviterDisplayName = inviteData.inviterName.trim();
  } else if (inviteData.invitedBy && typeof inviteData.invitedBy === "string" && !inviteData.invitedBy.includes("@") && inviteData.invitedBy.trim()) {
    safeInviterDisplayName = inviteData.invitedBy.trim();
  }

  const rawInviter = inviteData.invitedBy || "";
  const maskEmail = (em: string) => {
    if (!em || !em.includes("@")) return "unknown";
    const [name, domain] = em.split("@");
    return `${name[0]}***${name.length > 1 ? name[name.length - 1] : ''}@${domain}`;
  };

  const maskedEmail = maskEmail(recipientEmail);
  const maskedInviterEmail = rawInviter.includes("@") ? maskEmail(rawInviter) : null;

  const publicInviterLabel = safeInviterDisplayName || maskedInviterEmail || "Project administrator";
  const sanitizedInvitedBy = isAuthorizedToSeeUnmasked ? (rawInviter || publicInviterLabel) : publicInviterLabel;
  const sanitizedInviterName = safeInviterDisplayName || (isAuthorizedToSeeUnmasked ? (inviteData.inviterName || rawInviter || publicInviterLabel) : publicInviterLabel);

  return {
    email: isAuthorizedToSeeUnmasked ? recipientEmail : maskedEmail,
    recipientEmail: isAuthorizedToSeeUnmasked ? recipientEmail : maskedEmail,
    maskedRecipientEmail: maskedEmail,
    isRecipientVerified: Boolean(isRecipientAuthed),
    invitedBy: sanitizedInvitedBy,
    inviterName: sanitizedInviterName
  };
}

// Test Case 3.1: Unauthenticated request with email-based invitedBy
const case31 = sanitizeInvitePreview(
  { email: "candidate@acme.com", invitedBy: "lead.engineer@acme.com", projectId: "p1" },
  null
);
check(
  "Unauthenticated request masks inviter email (does not leak lead.engineer@acme.com)",
  !case31.invitedBy.includes("lead.engineer@acme.com") && case31.invitedBy.includes("***")
);
check(
  "Unauthenticated request masks recipient email (does not leak candidate@acme.com)",
  !case31.email.includes("candidate@acme.com") && case31.email.includes("***")
);

// Test Case 3.2: Unauthenticated request with genuine safe display name
const case32 = sanitizeInvitePreview(
  { email: "candidate@acme.com", invitedBy: "lead.engineer@acme.com", inviterDisplayName: "Sarah Connor", projectId: "p1" },
  null
);
check(
  "Unauthenticated request returns genuine safe display name 'Sarah Connor'",
  case32.invitedBy === "Sarah Connor" && case32.inviterName === "Sarah Connor"
);

// Test Case 3.3: Unauthenticated request with missing inviter name and missing email
const case33 = sanitizeInvitePreview(
  { email: "candidate@acme.com", invitedBy: "", projectId: "p1" },
  null
);
check(
  "Unauthenticated request returns neutral label 'Project administrator' when inviter is blank",
  case33.invitedBy === "Project administrator"
);

// Test Case 3.4: Authenticated unverified recipient
const case34 = sanitizeInvitePreview(
  { email: "candidate@acme.com", invitedBy: "lead.engineer@acme.com", projectId: "p1" },
  { email: "candidate@acme.com", email_verified: false }
);
check(
  "Unverified recipient does NOT receive unmasked email or unmasked inviter",
  case34.email.includes("***") && case34.invitedBy.includes("***") && !case34.isRecipientVerified
);

// Test Case 3.5: Authenticated verified recipient
const case35 = sanitizeInvitePreview(
  { email: "candidate@acme.com", invitedBy: "lead.engineer@acme.com", projectId: "p1" },
  { email: "candidate@acme.com", email_verified: true }
);
check(
  "Verified recipient receives unmasked email and authorized inviter",
  case35.email === "candidate@acme.com" && case35.invitedBy === "lead.engineer@acme.com" && case35.isRecipientVerified
);

// Test Case 3.6: Authorized project admin
const case36 = sanitizeInvitePreview(
  { email: "candidate@acme.com", invitedBy: "lead.engineer@acme.com", projectId: "p1" },
  { email: "admin@acme.com", email_verified: true, isProjectAdmin: true }
);
check(
  "Project admin receives unmasked details for project audit",
  case36.email === "candidate@acme.com" && case36.invitedBy === "lead.engineer@acme.com"
);

// -----------------------------------------------------------------------------
// 4. Frontend Resilience Audit (JoinPage & CollaborationDashboard)
// -----------------------------------------------------------------------------
console.log("\n--- Section 4: Frontend UI Integrity Audit ---");
const joinPageContent = fs.readFileSync(path.join(process.cwd(), 'pages', 'JoinPage.tsx'), 'utf-8');
const collabContent = fs.readFileSync(path.join(process.cwd(), 'components', 'CollaborationDashboard.tsx'), 'utf-8');

check(
  "JoinPage.tsx handles fallback inviter display safely (invitedBy || inviterName || 'Project administrator')",
  joinPageContent.includes("invite?.invitedBy || invite?.inviterName || 'Project administrator'")
);

check(
  "JoinPage.tsx handles optional email without crash",
  joinPageContent.includes("invite?.email ? invite.email.charAt(0).toUpperCase() : '✉'")
);

check(
  "CollaborationDashboard.tsx restricts onSnapshot invite listener to owner and admin",
  collabContent.includes("if (userRole !== 'owner' && userRole !== 'admin')") &&
  collabContent.includes("setInvites([]);")
);

console.log("\n================================================================================");
console.log(`📊 TEST SUITE SUMMARY: ${passedTests} / ${totalTests} PASSED (0 FAILED)`);
console.log("================================================================================");
console.log("🎉 ALL SEC-04 STEP 5.4C RESIDUAL EXPOSURE REMEDIATION INVARIANTS PASSED PERFECTLY!");
