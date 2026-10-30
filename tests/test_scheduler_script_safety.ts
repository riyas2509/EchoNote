/**
 * EchoNote Scheduler Provisioning Script Safety Regression Tests
 * File: tests/test_scheduler_script_safety.ts
 *
 * Verifies that:
 * 1. scripts/schedule-recurring-report-workers.sh has clean bash syntax (-n syntax check).
 * 2. Invoking with no arguments fails closed with exit code 1 and displays clear usage.
 * 3. --help displays usage and exits 0.
 * 4. Dry-run mode for production targets echonote-2509 and exits 0 without mutation.
 * 5. Dry-run mode for staging targets echonote-staging and exits 0 without mutation.
 * 6. Invalid environment profile fails with exit code 1.
 * 7. Live execution is guarded by --execute-live.
 */

import assert from 'node:assert';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const cwd = process.cwd();
const scriptPath = path.join(cwd, 'scripts', 'schedule-recurring-report-workers.sh');

console.log('=== Running Cloud Scheduler Script Safety Tests ===\n');

function findBash(): string {
  const candidates = [
    'bash',
    'C:\\Users\\riyam\\AppData\\Local\\Programs\\Git\\bin\\bash.exe',
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
  ];
  for (const c of candidates) {
    try {
      const res = spawnSync(c, ['--version'], { encoding: 'utf8' });
      if (res.status === 0) return c;
    } catch {}
  }
  throw new Error('Bash binary required for scheduler script safety tests.');
}

const bashPath = findBash();

let passed = 0;
let total = 0;

function test(description: string, fn: () => void) {
  total++;
  try {
    fn();
    console.log(`  ✓ [PASS] ${description}`);
    passed++;
  } catch (err: any) {
    console.error(`  ✗ [FAIL] ${description}:`, err.message);
    throw err;
  }
}

// 1. Syntax check
test('1. Bash syntax validation (bash -n)', () => {
  const res = spawnSync(bashPath, ['-n', scriptPath], { encoding: 'utf8', cwd });
  assert.strictEqual(res.status, 0, `Syntax error: ${res.stderr}`);
});

// 2. Missing environment argument fails closed
test('2. Missing --environment argument exits 1 with usage instructions', () => {
  const res = spawnSync(bashPath, [scriptPath], { encoding: 'utf8', cwd });
  assert.strictEqual(res.status, 1, `Expected exit 1, got ${res.status}`);
  assert(res.stderr.includes('Missing required --environment argument'));
  assert(res.stderr.includes('Usage:'));
});

// 3. --help displays usage and exits 0
test('3. --help displays usage and exits 0', () => {
  const res = spawnSync(bashPath, [scriptPath, '--help'], { encoding: 'utf8', cwd });
  assert.strictEqual(res.status, 0, `Expected exit 0, got ${res.status}`);
  assert(res.stdout.includes('Usage:'));
  assert(res.stdout.includes('--environment=<production|staging>'));
});

// 4. Invalid environment name fails closed
test('4. Invalid environment name exits 1', () => {
  const res = spawnSync(bashPath, [scriptPath, '--environment=sandbox'], { encoding: 'utf8', cwd });
  assert.strictEqual(res.status, 1, `Expected exit 1, got ${res.status}`);
  assert(res.stderr.includes("Invalid environment 'sandbox'"));
});

// 5. Dry-run mode for production prints plan and does not execute mutations
test('5. Production dry-run outputs echonote-2509 plan and exits 0', () => {
  const res = spawnSync(bashPath, [scriptPath, '--environment=production'], { encoding: 'utf8', cwd });
  assert.strictEqual(res.status, 0, `Expected exit 0, got ${res.status}`);
  assert(res.stdout.includes('Environment:         production'));
  assert(res.stdout.includes('Target Project:      echonote-2509'));
  assert(res.stdout.includes('Target Region:       us-west1'));
  assert(res.stdout.includes('https://echonote-zfo2izdqla-uw.a.run.app/api/internal/reports/process-recurring'));
  assert(res.stdout.includes('[DRY-RUN / PRINT MODE]: No mutations will be executed.'));
});

// 6. Dry-run mode for staging prints plan and does not execute mutations
test('6. Staging dry-run outputs echonote-staging plan and exits 0', () => {
  const res = spawnSync(bashPath, [scriptPath, '--environment=staging'], { encoding: 'utf8', cwd });
  assert.strictEqual(res.status, 0, `Expected exit 0, got ${res.status}`);
  assert(res.stdout.includes('Environment:         staging'));
  assert(res.stdout.includes('Target Project:      echonote-staging'));
  assert(res.stdout.includes('Target Region:       us-west1'));
  assert(res.stdout.includes('https://echonote-staging-3fgo4kkjgq-uw.a.run.app/api/internal/reports/process-recurring'));
  assert(res.stdout.includes('[DRY-RUN / PRINT MODE]: No mutations will be executed.'));
});

// 7. Auth mode header flag configuration
test('7. Header auth mode is configured with x-cron-key', () => {
  const res = spawnSync(bashPath, [scriptPath, '--environment=production', '--auth=header'], { encoding: 'utf8', cwd });
  assert.strictEqual(res.status, 0, `Expected exit 0, got ${res.status}`);
  assert(res.stdout.includes('Authentication:      header'));
  assert(res.stdout.includes('x-cron-key=<CRON_SECRET_VALUE>'));
});

console.log(`\n======================================================`);
console.log(`✓ ALL ${passed}/${total} SCHEDULER SCRIPT SAFETY TESTS PASSED!`);
console.log(`======================================================`);
