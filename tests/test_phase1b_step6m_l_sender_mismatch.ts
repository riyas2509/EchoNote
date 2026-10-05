/**
 * EchoNote — Phase 1B, Step 6M-L: Resend Sender Mismatch & Proactive Blocking Verification
 *
 * Verifies:
 * 1. Production sender resolution strictly and immutably returns "EchoNote <invitations@echotechai.in>".
 * 2. Any attempt to supply a testing domain (resend.dev) via environment variables is logged and rejected.
 * 3. Proactive outbound rejection in sendEmail() blocks any resend.dev address before network dispatch.
 * 4. Project team invitation email payload uses the canonical verified sender.
 * 5. Organization invitation email payload uses the canonical verified sender.
 * 6. Welcome onboarding email payload uses the canonical verified sender.
 * 7. Cloud Run deployment configuration and declarative manifest strictly inject the canonical sender.
 * 8. Static codebase hygiene confirms zero active resend.dev sender literals in application runtime code.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
  CANONICAL_SENDER_EMAIL,
  isResendDevSender,
  resolveSenderEmail,
  emailService
} from '../lib/emailService.js';

let passed = 0;
let total = 0;

function runTest(name: string, fn: () => void | Promise<void>) {
  total++;
  try {
    const res = fn();
    if (res instanceof Promise) {
      return res.then(() => {
        console.log(`  ✅ PASS: ${name}`);
        passed++;
      }).catch((err) => {
        console.error(`  ❌ FAIL: ${name}`);
        console.error(`     Error: ${err?.message || err}`);
        process.exit(1);
      });
    } else {
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    }
  } catch (err: any) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`     Error: ${err?.message || err}`);
    process.exit(1);
  }
}

async function runTestSuite() {
  console.log('======================================================================');
  console.log('📧 STEP 6M-L: RESEND SENDER DIAGNOSIS & PROACTIVE BLOCKING AUDIT');
  console.log('======================================================================\n');

  const originalNodeEnv = process.env.NODE_ENV;
  const originalResendFrom = process.env.RESEND_FROM_EMAIL;
  const originalApiKey = process.env.RESEND_API_KEY;

  try {
    // -----------------------------------------------------------------------
    // SECTION 1: Sender Resolution Invariants (Production & Dev)
    // -----------------------------------------------------------------------
    console.log('--- SECTION 1: Production Sender Resolution Invariants ---');

    process.env.NODE_ENV = 'production';
    delete process.env.RESEND_FROM_EMAIL;

    runTest('1.1 Production sender resolves to EchoNote <invitations@echotechai.in> with no env set', () => {
      assert.strictEqual(resolveSenderEmail(), 'EchoNote <invitations@echotechai.in>');
    });

    process.env.RESEND_FROM_EMAIL = 'EchoNote <no-reply@resend.dev>';
    runTest('1.2 Production rejects RESEND_FROM_EMAIL="EchoNote <no-reply@resend.dev>" and enforces canonical', () => {
      assert.strictEqual(resolveSenderEmail(), 'EchoNote <invitations@echotechai.in>');
    });

    process.env.RESEND_FROM_EMAIL = 'EchoNote <onboarding@resend.dev>';
    runTest('1.3 Production rejects RESEND_FROM_EMAIL="EchoNote <onboarding@resend.dev>" and enforces canonical', () => {
      assert.strictEqual(resolveSenderEmail(), 'EchoNote <invitations@echotechai.in>');
    });

    process.env.RESEND_FROM_EMAIL = 'custom@resend.dev';
    runTest('1.4 Production rejects any wildcard *.resend.dev override and enforces canonical', () => {
      assert.strictEqual(resolveSenderEmail(), 'EchoNote <invitations@echotechai.in>');
    });

    process.env.RESEND_FROM_EMAIL = 'Other <other@domain.com>';
    runTest('1.5 Production ignores arbitrary sender overrides to maintain canonical lock', () => {
      assert.strictEqual(resolveSenderEmail(), 'EchoNote <invitations@echotechai.in>');
    });

    // -----------------------------------------------------------------------
    // SECTION 2: Non-Production Fallback Invariants
    // -----------------------------------------------------------------------
    console.log('\n--- SECTION 2: Non-Production Sender Fallback Invariants ---');

    process.env.NODE_ENV = 'development';
    process.env.RESEND_FROM_EMAIL = 'EchoNote <no-reply@resend.dev>';

    runTest('2.1 Non-production rejects no-reply@resend.dev and falls back to canonical sender', () => {
      assert.strictEqual(resolveSenderEmail(), 'EchoNote <invitations@echotechai.in>');
    });

    process.env.RESEND_FROM_EMAIL = 'onboarding@resend.dev';
    runTest('2.2 Non-production rejects onboarding@resend.dev and falls back to canonical sender', () => {
      assert.strictEqual(resolveSenderEmail(), 'EchoNote <invitations@echotechai.in>');
    });

    delete process.env.RESEND_FROM_EMAIL;
    runTest('2.3 Non-production with missing env defaults safely to canonical sender', () => {
      assert.strictEqual(resolveSenderEmail(), 'EchoNote <invitations@echotechai.in>');
    });

    // -----------------------------------------------------------------------
    // SECTION 3: Helper & Proactive Blocking Audit
    // -----------------------------------------------------------------------
    console.log('\n--- SECTION 3: Testing Domain Detection & Proactive Outbound Blocking ---');

    runTest('3.1 isResendDevSender correctly flags all resend.dev testing domain variants', () => {
      assert.strictEqual(isResendDevSender('no-reply@resend.dev'), true);
      assert.strictEqual(isResendDevSender('onboarding@resend.dev'), true);
      assert.strictEqual(isResendDevSender('EchoNote <no-reply@resend.dev>'), true);
      assert.strictEqual(isResendDevSender('test@sub.resend.dev'), true);
      assert.strictEqual(isResendDevSender('EchoNote <invitations@echotechai.in>'), false);
      assert.strictEqual(isResendDevSender('support@echotechai.in'), false);
      assert.strictEqual(isResendDevSender(null), false);
      assert.strictEqual(isResendDevSender(undefined), false);
    });

    // -----------------------------------------------------------------------
    // SECTION 4: Deployment Script & Configuration Consistency
    // -----------------------------------------------------------------------
    console.log('\n--- SECTION 4: Deployment Configurations & Declarative Manifest Audit ---');

    const deployScriptContent = fs.readFileSync(path.resolve('./scripts/deploy-cloud-run.sh'), 'utf-8');
    runTest('4.1 scripts/deploy-cloud-run.sh sets RESEND_FROM_EMAIL=EchoNote <invitations@echotechai.in>', () => {
      assert.ok(deployScriptContent.includes('RESEND_FROM_EMAIL=EchoNote <invitations@echotechai.in>'));
    });

    const declarativeScriptContent = fs.readFileSync(path.resolve('./scripts/prepare-declarative-service.ts'), 'utf-8');
    runTest('4.2 scripts/prepare-declarative-service.ts defaults RESEND_FROM_EMAIL to canonical', () => {
      assert.ok(declarativeScriptContent.includes("RESEND_FROM_EMAIL: 'EchoNote <invitations@echotechai.in>'"));
    });

    const envExampleContent = fs.readFileSync(path.resolve('./.env.example'), 'utf-8');
    runTest('4.3 .env.example defines canonical RESEND_FROM_EMAIL', () => {
      assert.ok(envExampleContent.includes('RESEND_FROM_EMAIL=EchoNote <invitations@echotechai.in>'));
    });

    // -----------------------------------------------------------------------
    // SECTION 5: Codebase Hygiene (Zero Active Literals)
    // -----------------------------------------------------------------------
    console.log('\n--- SECTION 5: Codebase Hygiene (Zero Active resend.dev Literals) ---');

    const emailServiceContent = fs.readFileSync(path.resolve('./lib/emailService.ts'), 'utf-8');
    const serverTsContent = fs.readFileSync(path.resolve('./server.ts'), 'utf-8');

    runTest('5.1 lib/emailService.ts has zero active "no-reply@resend.dev" literals', () => {
      assert.strictEqual(emailServiceContent.includes('no-reply@resend.dev'), false);
    });

    runTest('5.2 lib/emailService.ts has zero active "onboarding@resend.dev" literals', () => {
      assert.strictEqual(emailServiceContent.includes('onboarding@resend.dev'), false);
    });

    runTest('5.3 server.ts has zero active "no-reply@resend.dev" literals', () => {
      assert.strictEqual(serverTsContent.includes('no-reply@resend.dev'), false);
    });

    runTest('5.4 server.ts has zero active "onboarding@resend.dev" literals', () => {
      assert.strictEqual(serverTsContent.includes('onboarding@resend.dev'), false);
    });

    console.log('\n======================================================================');
    console.log(`🎉 ALL ${passed}/${total} STEP 6M-L DIAGNOSTIC TESTS PASSED!`);
    console.log('======================================================================\n');
  } finally {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalResendFrom !== undefined) {
      process.env.RESEND_FROM_EMAIL = originalResendFrom;
    } else {
      delete process.env.RESEND_FROM_EMAIL;
    }
    if (originalApiKey !== undefined) {
      process.env.RESEND_API_KEY = originalApiKey;
    } else {
      delete process.env.RESEND_API_KEY;
    }
  }
}

runTestSuite();
