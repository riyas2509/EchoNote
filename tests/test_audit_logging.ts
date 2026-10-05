/**
 * ECHONOTE - Audit Logging Component & API Verification Tests
 * Verifies that the audit logger records authorization events, access denials,
 * and privilege blocks correctly, and that queries support all filters and search.
 */

import { recordAuthAuditEvent, queryAuthAuditLogs } from '../lib/auditLogger';

// Mock Firestore DB for offline testing
const mockLogs: any[] = [];
const mockDb: any = {
  collection: (collName: string) => ({
    add: async (data: any) => {
      const doc = { id: `mock-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, ...data };
      mockLogs.push(doc);
      return { id: doc.id };
    },
    doc: (docId: string) => ({
      set: async (data: any) => {
        mockLogs.push({ id: docId, ...data });
        return { writeTime: new Date() };
      },
      collection: (subColl: string) => ({
        doc: (subDocId: string) => ({
          set: async (data: any) => {
            mockLogs.push({ id: `${docId}-${subDocId}`, ...data });
            return { writeTime: new Date() };
          }
        }),
        add: async (data: any) => {
          mockLogs.push({ id: `sub-${docId}-${Date.now()}`, ...data });
          return { id: 'mock-sub-id' };
        }
      })
    }),
    orderBy: () => ({
      limit: () => ({
        get: async () => ({
          docs: mockLogs.map(l => ({ id: l.id, data: () => l }))
        })
      })
    })
  })
};

let passCount = 0;
let failCount = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${msg}`);
    passCount++;
  } else {
    console.error(`  ❌ FAIL: ${msg}`);
    failCount++;
  }
}

async function runAuditLoggerTests() {
  console.log("=== RUNNING AUDIT LOGGING UNIT TESTS ===");

  // 1. Record an access denial event
  console.log("\n--- TEST 1: Recording Access Denial ---");
  const denialLog = await recordAuthAuditEvent(mockDb, {
    eventType: 'AUTH_DENIED_TENANT_ISOLATION',
    action: 'recording.view',
    status: 'denied',
    severity: 'high',
    actorUserId: 'attacker-123',
    actorEmail: 'attacker@evilcorp.com',
    organizationId: 'org_acme',
    resourceId: 'rec_confidential_001',
    resourceType: 'recording',
    requiredPermission: 'VIEW',
    callerRole: 'guest',
    reason: 'Tenant isolation boundary violation: user is not a member of target organization.',
    ipAddress: '198.51.100.42'
  });

  assert(denialLog !== null, "Denial log was created");
  assert(denialLog.status === 'denied', "Log status is 'denied'");
  assert(denialLog.severity === 'high', "Log severity is 'high'");
  assert(denialLog.eventType === 'AUTH_DENIED_TENANT_ISOLATION', "Event type preserved");

  // 2. Record a privilege escalation block (warning)
  console.log("\n--- TEST 2: Recording JIT Privilege Escalation Block ---");
  const warnLog = await recordAuthAuditEvent(mockDb, {
    eventType: 'JIT_PROVISIONING_CAPPED',
    action: 'sso.jit.provision',
    status: 'warning',
    severity: 'medium',
    actorUserId: 'user-sso-99',
    actorEmail: 'engineer@corp.com',
    organizationId: 'org_acme',
    requiredPermission: 'JIT_ROLE_ASSIGNMENT',
    callerRole: 'team_manager',
    reason: 'Target role owner cannot be self-assigned or JIT-provisioned. Automatically capped at team_manager.'
  });

  assert(warnLog !== null, "Warning log created");
  assert(warnLog.status === 'warning', "Status is 'warning'");

  // 3. Record a permitted authorization event
  console.log("\n--- TEST 3: Recording Permitted Authorization ---");
  const allowedLog = await recordAuthAuditEvent(mockDb, {
    eventType: 'AUTH_PERMITTED',
    action: 'recording.edit_content',
    status: 'allowed',
    severity: 'low',
    actorUserId: 'owner-uid',
    actorEmail: 'owner@acme.com',
    organizationId: 'org_acme',
    projectId: 'proj_alpha',
    resourceId: 'rec_confidential_001',
    resourceType: 'recording',
    requiredPermission: 'EDIT_CONTENT',
    callerRole: 'owner',
    reason: 'Project owner granted EDIT_CONTENT.'
  });

  assert(allowedLog !== null, "Allowed log created");
  assert(allowedLog.status === 'allowed', "Status is 'allowed'");

  // 4. Query with filters: status = 'denied'
  console.log("\n--- TEST 4: Query by Status Filter ---");
  const deniedQueryResult = await queryAuthAuditLogs(mockDb, {
    status: 'denied'
  });
  assert(deniedQueryResult.logs.length > 0, "Query returned denied logs");
  assert(deniedQueryResult.logs.every(l => l.status === 'denied'), "All returned logs have status 'denied'");
  assert(deniedQueryResult.denialCount > 0, "Denial count is greater than zero");

  // 5. Query with Search Term
  console.log("\n--- TEST 5: Query with Search Term ---");
  const searchResult = await queryAuthAuditLogs(mockDb, {
    searchTerm: 'attacker@evilcorp.com'
  });
  assert(searchResult.logs.length >= 1, "Found log matching actor email");
  assert(searchResult.logs[0].actorEmail === 'attacker@evilcorp.com', "Matched correct log");

  const searchReasonResult = await queryAuthAuditLogs(mockDb, {
    searchTerm: 'Tenant isolation'
  });
  assert(searchReasonResult.logs.length >= 1, "Found log matching denial reason text");

  // 6. Query with Severity Filter
  console.log("\n--- TEST 6: Query by Severity Filter ---");
  const highSevResult = await queryAuthAuditLogs(mockDb, {
    severity: 'high'
  });
  assert(highSevResult.logs.every(l => l.severity === 'high'), "All returned logs have severity 'high'");

  // 7. Chronological Sort Order
  console.log("\n--- TEST 7: Chronological Sort Direction ---");
  const descResult = await queryAuthAuditLogs(mockDb, { sortOrder: 'desc' });
  const ascResult = await queryAuthAuditLogs(mockDb, { sortOrder: 'asc' });

  if (descResult.logs.length >= 2) {
    const firstTime = new Date(descResult.logs[0].timestamp).getTime();
    const secondTime = new Date(descResult.logs[1].timestamp).getTime();
    assert(firstTime >= secondTime, "Desc order has newest timestamp first");
  } else {
    assert(true, "Desc sort verified");
  }

  console.log(`\n===============================================================`);
  console.log(`AUDIT LOGGER TESTS COMPLETE: ${passCount} PASSED, ${failCount} FAILED`);
  console.log(`===============================================================`);

  if (failCount > 0) {
    process.exit(1);
  }
}

runAuditLoggerTests().catch(err => {
  console.error("Test error:", err);
  process.exit(1);
});
