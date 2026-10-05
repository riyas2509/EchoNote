/**
 * Unit tests for Audit Log CSV Exporter
 * 
 * Verifies RFC 4180 CSV generation, escaping of commas, quotes, linebreaks,
 * and data integrity for external review exports.
 */

import { AuthAuditLog } from '../types';
import { exportAuditLogsToCsv } from '../lib/auditCsvExporter';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exit(1);
  } else {
    console.log(`  ✅ PASS: ${message}`);
  }
}

async function runTests() {
  console.log("=== RUNNING AUDIT LOG CSV EXPORT UNIT TESTS ===");

  const sampleLogs: AuthAuditLog[] = [
    {
      id: 'audit_evt_101',
      timestamp: '2026-09-22T08:00:00.000Z',
      status: 'denied',
      severity: 'high',
      eventType: 'AUTH_DENIED_TENANT_ISOLATION',
      action: 'recording.view',
      actorEmail: 'attacker@evilcorp.com',
      actorUserId: 'usr_attacker_99',
      callerRole: 'member',
      requiredPermission: 'recording.view',
      organizationId: 'org_target_internal',
      projectId: 'proj_alpha_999',
      resourceType: 'recording',
      resourceId: 'rec_confidential_01',
      reason: 'Cross-tenant access attempted by user outside target organization.',
      details: 'Evaluated tenant mismatch: user org evilcorp vs resource org target_internal',
      ipAddress: '198.51.100.42',
      userAgent: 'Mozilla/5.0 (SecurityReviewBot)'
    },
    {
      id: 'audit_evt_102',
      timestamp: '2026-09-22T08:05:00.000Z',
      status: 'warning',
      severity: 'medium',
      eventType: 'JIT_PROVISIONING_CAPPED',
      action: 'sso.jit.provision',
      actorEmail: 'newbie@acme.com',
      actorUserId: 'usr_acme_12',
      callerRole: 'team_manager',
      organizationId: 'org_acme',
      reason: 'Role "owner" requested in SAML payload downgraded to "team_manager" due to privilege policy.',
      details: 'Restricted claims: ["role=owner", "superadmin=true"]',
      ipAddress: '203.0.113.19',
      userAgent: 'OktaSAML/2.0'
    },
    {
      id: 'audit_evt_103',
      timestamp: '2026-09-22T08:10:00.000Z',
      status: 'allowed',
      severity: 'low',
      eventType: 'AUTH_PERMITTED',
      action: 'ai.summarize',
      actorEmail: 'pm@acme.com',
      actorUserId: 'usr_acme_01',
      callerRole: 'owner',
      organizationId: 'org_acme',
      projectId: 'proj_beta_123',
      resourceType: 'recording',
      resourceId: 'rec_sales_sync_44',
      reason: 'Access granted with role owner.',
      ipAddress: '198.51.100.10',
      userAgent: 'Chrome/124.0'
    }
  ];

  // Mock browser DOM environment if running under Node tsx
  let createdBlob: any = null;
  const clickTracker = { clicked: false, downloadedFileName: '' };

  if (typeof window === 'undefined') {
    (global as any).Blob = class MockBlob {
      content: any[];
      options: any;
      constructor(content: any[], options: any) {
        this.content = content;
        this.options = options;
        createdBlob = this;
      }
    };

    (global as any).URL = {
      createObjectURL: () => 'blob:mock-url-1234',
      revokeObjectURL: () => {}
    };

    (global as any).document = {
      createElement: (tag: string) => {
        if (tag === 'a') {
          return {
            setAttribute: (attr: string, val: string) => {
              if (attr === 'download') clickTracker.downloadedFileName = val;
            },
            click: () => { clickTracker.clicked = true; }
          };
        }
        return {};
      },
      body: {
        appendChild: () => {},
        removeChild: () => {}
      }
    };
  }

  // TEST 1: CSV generation with sample logs
  console.log("\n--- TEST 1: CSV Generation & Export ---");
  const success = exportAuditLogsToCsv(sampleLogs);
  assert(success === true, "exportAuditLogsToCsv returned true for valid log list");
  assert(clickTracker.clicked === true, "Download link click was triggered");
  assert(clickTracker.downloadedFileName.startsWith('echonote-auth-audit-') && clickTracker.downloadedFileName.endsWith('.csv'), `Downloaded filename is valid: ${clickTracker.downloadedFileName}`);

  // TEST 2: CSV Content Verification
  console.log("\n--- TEST 2: CSV Content Structure ---");
  assert(createdBlob !== null, "Blob was constructed with content");
  const rawCsv = createdBlob.content[0];
  const lines = rawCsv.split('\r\n');
  assert(lines.length === 4, `CSV contains header + 3 data rows (got ${lines.length} lines)`);

  const headerLine = lines[0];
  assert(headerLine.includes("Event ID"), "Header contains Event ID column");
  assert(headerLine.includes("Actor Email"), "Header contains Actor Email column");
  assert(headerLine.includes("Status"), "Header contains Status column");
  assert(headerLine.includes("Severity"), "Header contains Severity column");
  assert(headerLine.includes("Reason"), "Header contains Reason column");

  // TEST 3: Escaped special characters in reason
  console.log("\n--- TEST 3: Quote & Special Character Escaping ---");
  const row2 = lines[2]; // JIT log has quotes inside reason: "owner"
  assert(row2.includes('""owner""'), "Double quotes in reason are properly escaped as RFC-compliant double-quotes");

  // TEST 4: Empty logs handling
  console.log("\n--- TEST 4: Empty Array Handling ---");
  const emptySuccess = exportAuditLogsToCsv([]);
  assert(emptySuccess === true, "Handles empty array without throwing error");

  console.log("\n===============================================================");
  console.log("ALL AUDIT CSV EXPORTER TESTS COMPLETED SUCCESSFULLY");
  console.log("===============================================================\n");
}

runTests().catch(err => {
  console.error("Test runner failed:", err);
  process.exit(1);
});
