/**
 * tests/test_phase1b_step1_2f_versioned_keyring.ts
 *
 * EchoNote Phase 1B Step 1.2F: Versioned Encryption Keyring & Rotation Readiness Test Suite
 * (Delegates to test_phase1b_step1_2f_versioned_encryption_keyring.ts for complete coverage)
 */

import { runTestSuite } from "./test_phase1b_step1_2f_versioned_encryption_keyring.ts";

runTestSuite().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
