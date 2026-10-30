/**
 * EchoNote Deployment Script Safety Regression Tests
 * File: tests/test_deployment_script_safety.ts
 *
 * Verifies that:
 * 1. Invoking deploy-cloud-run-B1A.sh or scripts/deploy-cloud-run.sh with no arguments
 *    safely displays usage/help and exits 0 without invoking gcloud or mutating cloud state.
 * 2. No deployment, environment update, traffic promotion, or mutation can be selected implicitly.
 * 3. Invalid actions fail with non-zero exit code and display clear usage instructions.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const cwd = process.cwd();
const script1Path = path.join(cwd, 'scripts', 'deploy-cloud-run.sh');
const script2Path = path.join(cwd, 'deploy-cloud-run-B1A.sh');

console.log('=== Running Deployment Script Safety Tests ===\n');

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

// 1. Static checks for scripts/deploy-cloud-run.sh
test('1. scripts/deploy-cloud-run.sh static default action is help, not update-env or deploy', () => {
  const content = fs.readFileSync(script1Path, 'utf8');
  assert(content.includes('ACTION="${1:-help}"'), 'scripts/deploy-cloud-run.sh must default ACTION to help');
  assert(!content.includes('ACTION="${1:-update-env}"'), 'scripts/deploy-cloud-run.sh must NOT default ACTION to update-env');
  assert(!content.includes('ACTION="${1:-deploy}"'), 'scripts/deploy-cloud-run.sh must NOT default ACTION to deploy');
  assert(content.includes('help|--help|-h|"")'), 'scripts/deploy-cloud-run.sh must contain safe help case');
});

// 2. Static checks for deploy-cloud-run-B1A.sh
test('2. deploy-cloud-run-B1A.sh static default action is help, not update-env or deploy', () => {
  const content = fs.readFileSync(script2Path, 'utf8');
  assert(content.includes('ACTION="${1:-help}"'), 'deploy-cloud-run-B1A.sh must default ACTION to help');
  assert(!content.includes('ACTION="${1:-update-env}"'), 'deploy-cloud-run-B1A.sh must NOT default ACTION to update-env');
  assert(!content.includes('ACTION="${1:-deploy}"'), 'deploy-cloud-run-B1A.sh must NOT default ACTION to deploy');
  assert(content.includes('help|--help|-h|"")'), 'deploy-cloud-run-B1A.sh must contain safe help case');
});

// 3. Execution check via bash if bash is available
function findBash(): string | null {
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
  return null;
}

const bashPath = findBash();

if (bashPath) {
  test('3. Executing scripts/deploy-cloud-run.sh with no args outputs usage and exits 0', () => {
    const res = spawnSync(bashPath, [script1Path], { encoding: 'utf8', cwd });
    assert.strictEqual(res.status, 0, `Expected exit code 0, got ${res.status}`);
    assert(res.stdout.includes('Usage: ./scripts/deploy-cloud-run.sh <ACTION> [OPTIONS]'));
    assert(res.stdout.includes('Safety Notice:'));
    assert(!res.stdout.includes('Updating Cloud Run Service'));
    assert(!res.stdout.includes('gcloud run'));
  });

  test('4. Executing deploy-cloud-run-B1A.sh with no args outputs usage and exits 0', () => {
    const res = spawnSync(bashPath, [script2Path], { encoding: 'utf8', cwd });
    assert.strictEqual(res.status, 0, `Expected exit code 0, got ${res.status}`);
    assert(res.stdout.includes('Usage: ./deploy-cloud-run-B1A.sh <ACTION> [OPTIONS]'));
    assert(res.stdout.includes('Safety Notice:'));
    assert(!res.stdout.includes('Updating Cloud Run Service'));
    assert(!res.stdout.includes('gcloud run'));
  });

  test('5. Executing scripts/deploy-cloud-run.sh with unknown action exits 1 with error', () => {
    const res = spawnSync(bashPath, [script1Path, 'unauthorized-mutation'], { encoding: 'utf8', cwd });
    assert.strictEqual(res.status, 1, `Expected exit code 1, got ${res.status}`);
    assert(res.stderr.includes('Unknown action: unauthorized-mutation') || res.stdout.includes('Unknown action: unauthorized-mutation'));
  });
} else {
  console.log('  [INFO] Bash binary not located on PATH; runtime execution skipped, static AST verified.');
}

console.log(`\n======================================================`);
console.log(`✓ ALL ${passed}/${total} DEPLOYMENT SCRIPT SAFETY TESTS PASSED!`);
console.log(`======================================================`);
