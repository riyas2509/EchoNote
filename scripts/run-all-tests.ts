/**
 * EchoNote Authoritative Aggregate Test Runner
 *
 * Discovers and executes all deterministic, hermetic test suites sequentially.
 * Guarantees fail-fast or aggregate failure reporting with non-zero exit codes.
 * Runs natively via Node without shell-dependent CLI wrappers.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

export interface TestSuiteDefinition {
  name: string;
  filePath: string;
  env?: Record<string, string>;
}

export interface ExcludedSuiteDefinition {
  name: string;
  filePath: string;
  reason: string;
}

/**
 * Authoritative list of hermetic test suites that run in the aggregate runner.
 */
export const TEST_SUITES: TestSuiteDefinition[] = [
  {
    name: 'API Routing & CORS Security',
    filePath: 'tests/test_api_routing_and_cors_security.ts',
  },
  {
    name: 'Invitation Routing & Error Acceptance',
    filePath: 'tests/test_phase1b_step6g_routing_acceptance.ts',
  },
  {
    name: 'Vercel API Proxying & Branding Compliance',
    filePath: 'tests/test_vercel_api_routing_and_branding.ts',
  },
  {
    name: 'Technical SEO & GEO Structured Data',
    filePath: 'tests/test_phase2_step4_seo_geo.ts',
  },
  {
    name: 'Reasoning Meeting Workflow (Req 23)',
    filePath: 'tests/test_reasoning_meeting_workflow.ts',
  },
  {
    name: 'Reasoning Meeting Modal Contracts (Req 23)',
    filePath: 'tests/test_reasoning_meeting_modal_unit.ts',
  },
  {
    name: 'Reasoning Meeting API Client (Req 23)',
    filePath: 'tests/test_reasoning_meeting_api_client.ts',
  },
  {
    name: 'Reasoning Meeting Dashboard Integration (Req 23)',
    filePath: 'tests/test_reasoning_meeting_dashboard_integration.ts',
  },
  {
    name: 'Recurrence Scheduling Engine (Req 24, 29)',
    filePath: 'tests/test_recurrence_scheduling.ts',
  },
  {
    name: 'Recurring Worker Authentication & Routes (Req 24)',
    filePath: 'tests/test_recurring_worker_route_registration.ts',
  },
  {
    name: 'Recurring Schedule Persistence & API (Req 24)',
    filePath: 'tests/test_recurring_schedule_api.ts',
  },
  {
    name: 'Recurring Schedule Worker Execution (Req 24)',
    filePath: 'tests/test_recurring_schedule_worker.ts',
  },
  {
    name: 'Recurring Report Delivery & Notifications (Req 19, 24)',
    filePath: 'tests/test_recurring_report_delivery.ts',
  },
  {
    name: 'Recurring Schedule Frontend Client (Req 24)',
    filePath: 'tests/test_recurring_schedule_frontend.ts',
  },
  {
    name: 'Recurring Schedule End-to-End Simulation (Req 19, 20, 24)',
    filePath: 'tests/test_recurring_schedule_e2e_simulation.ts',
  },
  {
    name: 'Search History Route Integration (Req 10)',
    filePath: 'tests/test_search_history_route_integration.ts',
  },
  {
    name: 'Project Search History (Req 7, 10)',
    filePath: 'tests/test_ah185_project_search_history.ts',
  },
  {
    name: 'Audio Trimming & Editing (Req 8)',
    filePath: 'tests/test_phase1b_step2_3_audio_trimming.ts',
  },
  {
    name: 'Report Download Secret Deployment Coverage (Req 19)',
    filePath: 'tests/test_report_download_secret_deployment_coverage.ts',
  },
  {
    name: 'Report Download Secret Security Regression (Req 19)',
    filePath: 'tests/test_report_download_secret_regression.ts',
  },
  {
    name: 'Staging Isolation & Email Safety (Req 1)',
    filePath: 'tests/test_staging_isolation_and_email_safety.ts',
  },
  {
    name: 'Transactional Email Sender Mismatch (Req 2)',
    filePath: 'tests/test_phase1b_step6m_l_sender_mismatch.ts',
  },
  {
    name: 'Transactional Email Sender Hardening (Req 2)',
    filePath: 'tests/test_phase1b_step6f_email_sender.ts',
  },
  {
    name: 'Declarative Cloud Run Migration & Manifests (Req 19, 24)',
    filePath: 'tests/test_phase1b_step6m_i_declarative_migration.ts',
    env: {
      RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID || 'rzp_live_test1234567890',
    },
  },
  {
    name: 'Firebase Admin Isolation & Guard (Req 1, 24)',
    filePath: 'tests/test_firebase_admin_isolation.ts',
  },
  {
    name: 'Deployment Script Safety & Defaults',
    filePath: 'tests/test_deployment_script_safety.ts',
  },
  {
    name: 'Staging Configuration Isolation & Scheduler Reliability (Req 24)',
    filePath: 'tests/test_staging_configuration_isolation.ts',
  },
  {
    name: 'Cloud Scheduler Script Safety & Provisioning (Req 24)',
    filePath: 'tests/test_scheduler_script_safety.ts',
  },
];

/**
 * Documented inventory of non-hermetic test suites excluded from offline aggregate execution.
 */
export const EXCLUDED_NON_HERMETIC_SUITES: ExcludedSuiteDefinition[] = [
  {
    name: 'Real Firestore Emulator Verification',
    filePath: 'tests/test_phase1_step3_real_firestore_emulator.ts',
    reason: 'Requires active Firebase Local Emulator Suite running on localhost:8080.',
  },
  {
    name: 'Overdue Alerts Real Firestore Emulator',
    filePath: 'tests/test_overdue_alerts_real_firestore_emulator.ts',
    reason: 'Requires active Firebase Local Emulator Suite.',
  },
  {
    name: 'Prerequisite Completion Real Firestore Emulator',
    filePath: 'tests/test_prerequisite_completion_real_firestore_emulator.ts',
    reason: 'Requires active Firebase Local Emulator Suite.',
  },
  {
    name: 'Full Notification Lifecycle Emulator',
    filePath: 'tests/test_full_notification_lifecycle_emulator.ts',
    reason: 'Requires active Firebase Local Emulator Suite.',
  },
  {
    name: 'Phase 1B Step 1.2H Emulator Verification',
    filePath: 'tests/test_phase1b_step1_2h_emulator_verification.ts',
    reason: 'Requires active Firebase Local Emulator Suite.',
  },
  {
    name: 'Authoritative Microsoft Entra SSO Validation',
    filePath: 'tests/test_step4b2_authoritative_entra_validation.ts',
    reason: 'Requires live Microsoft Entra ID tenant registration and network token exchange.',
  },
  {
    name: 'End-to-End Live MFA Verification',
    filePath: 'tests/test_step3b3_end_to_end_mfa_verification.ts',
    reason: 'Requires live Firebase SMS / phone verification factor in real browser.',
  },
  {
    name: 'Live Telemetry & Billing Audits',
    filePath: 'tests/billing_reliability_audit.ts',
    reason: 'Interactive audit script probing live database telemetry.',
  },
];

console.log('======================================================================');
console.log(`🚀 RUNNING ECHONOTE AGGREGATE TEST SUITE (${TEST_SUITES.length} SUITES)`);
console.log(`ℹ️  (${EXCLUDED_NON_HERMETIC_SUITES.length} non-hermetic/emulator suites documented and excluded)`);
console.log('======================================================================\n');

interface SuiteResult {
  name: string;
  filePath: string;
  passed: boolean;
  durationMs: number;
  errorDetail?: string;
}

const results: SuiteResult[] = [];
let anyFailed = false;

const tsxCliPath = path.resolve(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
const useDirectTsx = fs.existsSync(tsxCliPath);

for (let i = 0; i < TEST_SUITES.length; i++) {
  const suite = TEST_SUITES[i];
  const suiteNum = `[${i + 1}/${TEST_SUITES.length}]`;
  process.stdout.write(`${suiteNum} Running: ${suite.name} (${suite.filePath}) ... `);

  const startTime = Date.now();
  const spawnEnv = {
    ...process.env,
    ...(suite.env || {}),
  };

  const spawnArgs = useDirectTsx
    ? [process.execPath, [tsxCliPath, suite.filePath]] as const
    : [process.platform === 'win32' ? 'npx.cmd' : 'npx', ['tsx', suite.filePath]] as const;

  const child = spawnSync(spawnArgs[0], spawnArgs[1] as any, {
    cwd: process.cwd(),
    env: spawnEnv,
    encoding: 'utf8',
    shell: !useDirectTsx,
    timeout: 180000, // 3-minute timeout to catch hung processes
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const durationMs = Date.now() - startTime;
  const passed = child.status === 0 && !child.error;

  if (passed) {
    console.log(`✅ PASSED (${durationMs}ms)`);
    results.push({ name: suite.name, filePath: suite.filePath, passed: true, durationMs });
  } else {
    console.log(`❌ FAILED (exit code: ${child.status}${child.error ? `, error: ${child.error.message}` : ''})`);
    anyFailed = true;
    const errorPrefix = child.error ? `Process Error: ${child.error.message}\n` : '';
    const output = errorPrefix + (child.stdout || '') + (child.stderr || '');
    results.push({
      name: suite.name,
      filePath: suite.filePath,
      passed: false,
      durationMs,
      errorDetail: output.slice(-800),
    });
  }
}

console.log('\n======================================================================');
console.log('📊 ECHONOTE AGGREGATE TEST SUMMARY');
console.log('======================================================================');

let passedCount = 0;
for (const r of results) {
  const statusIcon = r.passed ? '✅' : '❌';
  console.log(`  ${statusIcon} ${r.name.padEnd(52)} (${r.durationMs}ms)`);
  if (!r.passed && r.errorDetail) {
    console.log(`     Error snippet:\n     ${r.errorDetail.trim().replace(/\n/g, '\n     ')}`);
  }
  if (r.passed) passedCount++;
}

console.log('======================================================================');
console.log(`TOTAL SUITES: ${TEST_SUITES.length} | PASSED: ${passedCount} | FAILED: ${TEST_SUITES.length - passedCount}`);
console.log('======================================================================\n');

if (anyFailed) {
  console.error('💥 Aggregate test run FAILED.');
  process.exit(1);
} else {
  console.log('🎉 ALL TEST SUITES PASSED SUCCESSFULLY!');
  process.exit(0);
}
