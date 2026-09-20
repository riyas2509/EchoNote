#!/usr/bin/env bash
# ==============================================================================
# EchoNote Production Deployment Script Safety Test Suite (Step 1J)
# ==============================================================================
# Tests all security invariants and guardrails for scripts/deploy-cloud-run.sh
# WITHOUT executing any real deployment or gcloud remote commands.
# ==============================================================================

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEPLOY_SCRIPT="$WORKSPACE_ROOT/scripts/deploy-cloud-run.sh"

PASSED_COUNT=0
FAILED_COUNT=0

# Create sandbox test directory for mock binaries
TEST_SANDBOX="$(mktemp -d)"
trap 'rm -rf "$TEST_SANDBOX"' EXIT

MOCK_BIN="$TEST_SANDBOX/bin"
mkdir -p "$MOCK_BIN"

REAL_NPM="$(command -v npm)"

# Helper for creating a mock npm for pre-flight testing
setup_mock_npm() {
  local lint_exit="${1:-0}"
  local build_exit="${2:-0}"
  cat <<EOF > "$MOCK_BIN/npm"
#!/usr/bin/env bash
if [ "\$1" = "run" ] && [ "\$2" = "lint" ]; then
  if [ "$lint_exit" -ne 0 ]; then
    echo "Simulated lint failure" >&2
    exit $lint_exit
  fi
  echo "Mock lint passed"
  exit 0
fi

if [ "\$1" = "run" ] && [ "\$2" = "build" ]; then
  if [ "$build_exit" -ne 0 ]; then
    echo "Simulated build failure" >&2
    exit $build_exit
  fi
  echo "Mock build passed"
  exit 0
fi

exec "$REAL_NPM" "\$@"
EOF
  chmod +x "$MOCK_BIN/npm"
}

# Helper for creating a mock gcloud
setup_mock_gcloud() {
  local mock_project="${1:-echonote-2509}"
  cat <<EOF > "$MOCK_BIN/gcloud"
#!/usr/bin/env bash
if [ "\$1" = "config" ] && [ "\$2" = "get-value" ] && [ "\$3" = "project" ]; then
  echo "$mock_project"
  exit 0
fi

if [ "\$1" = "run" ] && [ "\$2" = "deploy" ]; then
  echo "MOCK_GCLOUD_DEPLOY_INVOKED: \$*"
  exit 0
fi

if [ "\$1" = "run" ] && [ "\$2" = "services" ] && [ "\$3" = "update" ]; then
  echo "MOCK_GCLOUD_SERVICES_UPDATE_INVOKED: \$*"
  exit 0
fi

echo "MOCK_GCLOUD_UNKNOWN: \$*"
exit 0
EOF
  chmod +x "$MOCK_BIN/gcloud"
}

# Helper to log test results
assert_test() {
  local test_name="$1"
  local expected_exit="$2" # 0 or nonzero
  local expected_text="$3"
  local actual_exit="$4"
  local actual_output="$5"

  local success=1
  if [ "$expected_exit" = "0" ] && [ "$actual_exit" -ne 0 ]; then
    success=0
  elif [ "$expected_exit" = "nonzero" ] && [ "$actual_exit" -eq 0 ]; then
    success=0
  fi

  if [ -n "$expected_text" ]; then
    if ! echo "$actual_output" | grep -q -F -- "$expected_text"; then
      success=0
    fi
  fi

  if [ "$success" -eq 1 ]; then
    echo "  ✅ $test_name ... PASSED"
    PASSED_COUNT=$((PASSED_COUNT + 1))
  else
    echo "  ❌ $test_name ... FAILED"
    echo "     Expected exit: $expected_exit, got: $actual_exit"
    echo "     Expected text: '$expected_text'"
    echo "     Output was:"
    echo "$actual_output" | sed 's/^/       /'
    FAILED_COUNT=$((FAILED_COUNT + 1))
  fi
}

# Helper to assert forbidden text is absent
assert_absent() {
  local test_name="$1"
  local forbidden_text="$2"
  local actual_output="$3"

  if echo "$actual_output" | grep -q -F -- "$forbidden_text"; then
    echo "  ❌ $test_name ... FAILED"
    echo "     Forbidden text '$forbidden_text' was found in output!"
    FAILED_COUNT=$((FAILED_COUNT + 1))
  else
    echo "  ✅ $test_name ... PASSED"
    PASSED_COUNT=$((PASSED_COUNT + 1))
  fi
}

echo "======================================================================"
echo "🚀 RUNNING STEP 1J & 1L-A DEPLOYMENT SAFETY & SECRET MANAGER TESTS"
echo "======================================================================"

# Default mock npm to successful pre-flight
setup_mock_npm 0 0

# ----------------------------------------------------------------------------
# Test A: Correct Target & Validation Success with DRY_RUN=1
# ----------------------------------------------------------------------------
setup_mock_gcloud "echonote-2509"
OUT=$(PATH="$MOCK_BIN:$PATH" DRY_RUN=1 "$DEPLOY_SCRIPT" deploy 2>&1)
EXIT_CODE=$?
assert_test "Test A: Correct target with DRY_RUN=1 passes pre-flight and validations" \
  "0" "PRE-FLIGHT PASSED" "$EXIT_CODE" "$OUT"

# Verify no gcloud deploy was called
if echo "$OUT" | grep -q "MOCK_GCLOUD_DEPLOY_INVOKED"; then
  echo "  ❌ Test A: gcloud deploy was unexpectedly invoked during dry run!"
  FAILED_COUNT=$((FAILED_COUNT + 1))
else
  echo "  ✅ Test A: Confirmed no remote gcloud deploy was executed"
  PASSED_COUNT=$((PASSED_COUNT + 1))
fi

# ----------------------------------------------------------------------------
# Test B: Wrong CLOUD_RUN_SERVICE
# ----------------------------------------------------------------------------
OUT=$(PATH="$MOCK_BIN:$PATH" CLOUD_RUN_SERVICE="rogue-service" "$DEPLOY_SCRIPT" deploy 2>&1)
EXIT_CODE=$?
assert_test "Test B: Rejects wrong CLOUD_RUN_SERVICE override" \
  "nonzero" "ERROR: Production deployment target mismatch" "$EXIT_CODE" "$OUT"

# ----------------------------------------------------------------------------
# Test C: Wrong CLOUD_RUN_REGION
# ----------------------------------------------------------------------------
OUT=$(PATH="$MOCK_BIN:$PATH" CLOUD_RUN_REGION="europe-west1" "$DEPLOY_SCRIPT" deploy 2>&1)
EXIT_CODE=$?
assert_test "Test C: Rejects wrong CLOUD_RUN_REGION override" \
  "nonzero" "ERROR: Production deployment target mismatch" "$EXIT_CODE" "$OUT"

# ----------------------------------------------------------------------------
# Test D1: Wrong GOOGLE_CLOUD_PROJECT
# ----------------------------------------------------------------------------
OUT=$(PATH="$MOCK_BIN:$PATH" GOOGLE_CLOUD_PROJECT="other-project" "$DEPLOY_SCRIPT" deploy 2>&1)
EXIT_CODE=$?
assert_test "Test D1: Rejects wrong GOOGLE_CLOUD_PROJECT override" \
  "nonzero" "ERROR: Production deployment target mismatch" "$EXIT_CODE" "$OUT"

# ----------------------------------------------------------------------------
# Test D2: Active gcloud project mismatch
# ----------------------------------------------------------------------------
setup_mock_gcloud "rogue-gcloud-project"
OUT=$(PATH="$MOCK_BIN:$PATH" "$DEPLOY_SCRIPT" deploy 2>&1)
EXIT_CODE=$?
assert_test "Test D2: Rejects mismatched active gcloud project" \
  "nonzero" "ERROR: Active gcloud project mismatch" "$EXIT_CODE" "$OUT"

# Reset mock gcloud to correct project for subsequent tests
setup_mock_gcloud "echonote-2509"

# ----------------------------------------------------------------------------
# Test E1: Missing/Empty Plan ID
# ----------------------------------------------------------------------------
OUT=$(PATH="$MOCK_BIN:$PATH" RAZORPAY_PRO_MONTHLY_PLAN_ID="" "$DEPLOY_SCRIPT" deploy 2>&1)
EXIT_CODE=$?
assert_test "Test E1: Rejects empty RAZORPAY_PRO_MONTHLY_PLAN_ID" \
  "nonzero" "ERROR: Invalid or missing RAZORPAY_PRO_MONTHLY_PLAN_ID" "$EXIT_CODE" "$OUT"

# ----------------------------------------------------------------------------
# Test E2: Invalid Plan ID regex format
# ----------------------------------------------------------------------------
OUT=$(PATH="$MOCK_BIN:$PATH" RAZORPAY_TEAM_YEARLY_PLAN_ID="invalid_plan_format" "$DEPLOY_SCRIPT" deploy 2>&1)
EXIT_CODE=$?
assert_test "Test E2: Rejects invalid Plan ID regex format" \
  "nonzero" "ERROR: Invalid or missing RAZORPAY_TEAM_YEARLY_PLAN_ID" "$EXIT_CODE" "$OUT"

# ----------------------------------------------------------------------------
# Test F: Invalid Razorpay Mode
# ----------------------------------------------------------------------------
OUT=$(PATH="$MOCK_BIN:$PATH" RAZORPAY_MODE="test" "$DEPLOY_SCRIPT" deploy 2>&1)
EXIT_CODE=$?
assert_test "Test F: Rejects non-live RAZORPAY_MODE override" \
  "nonzero" "ERROR: Invalid ambient RAZORPAY_MODE" "$EXIT_CODE" "$OUT"

# ----------------------------------------------------------------------------
# Test G: Preflight failure on 'npm run lint'
# ----------------------------------------------------------------------------
setup_mock_npm 1 0
OUT=$(PATH="$MOCK_BIN:$PATH" "$DEPLOY_SCRIPT" deploy 2>&1)
EXIT_CODE=$?
assert_test "Test G: Stops immediately when npm run lint fails" \
  "nonzero" "ERROR: Local pre-flight failed at 'npm run lint'" "$EXIT_CODE" "$OUT"

# ----------------------------------------------------------------------------
# Test H: Preflight failure on 'npm run build'
# ----------------------------------------------------------------------------
setup_mock_npm 0 2
OUT=$(PATH="$MOCK_BIN:$PATH" "$DEPLOY_SCRIPT" deploy 2>&1)
EXIT_CODE=$?
assert_test "Test H: Stops immediately when npm run build fails" \
  "nonzero" "ERROR: Local pre-flight failed at 'npm run build'" "$EXIT_CODE" "$OUT"

# Reset mock npm to success
setup_mock_npm 0 0

# ----------------------------------------------------------------------------
# Test I: Service Account Pinning & Env Flags in Command Construction
# ----------------------------------------------------------------------------
setup_mock_gcloud "echonote-2509"
OUT=$(PATH="$MOCK_BIN:$PATH" DRY_RUN=0 "$DEPLOY_SCRIPT" deploy 2>&1)
EXIT_CODE=$?

assert_test "Test I1: Command specifies explicit service account" \
  "0" "--service-account=200551109142-compute@developer.gserviceaccount.com" "$EXIT_CODE" "$OUT"

assert_test "Test I2: Command uses --update-env-vars (preserving existing env)" \
  "0" "--update-env-vars=RAZORPAY_MODE=live" "$EXIT_CODE" "$OUT"

assert_test "Test I3: Summary logs only VALID status without secret exposure" \
  "0" "Razorpay Pro Monthly Plan: VALID" "$EXIT_CODE" "$OUT"

# ----------------------------------------------------------------------------
# Test J: Step 1L-A Deploy Action Secret Manager Integration
# ----------------------------------------------------------------------------
assert_test "Test J1: Deploy specifies --set-secrets flag" \
  "0" "--set-secrets=" "$EXIT_CODE" "$OUT"

assert_test "Test J2: Deploy maps GEMINI_API_KEY to echonote-gemini-api-key:latest" \
  "0" "GEMINI_API_KEY=echonote-gemini-api-key:latest" "$EXIT_CODE" "$OUT"

assert_test "Test J3: Deploy maps RAZORPAY_KEY_SECRET to echonote-razorpay-key-secret:latest" \
  "0" "RAZORPAY_KEY_SECRET=echonote-razorpay-key-secret:latest" "$EXIT_CODE" "$OUT"

assert_test "Test J4: Deploy maps RAZORPAY_WEBHOOK_SECRET to echonote-razorpay-webhook-secret:latest" \
  "0" "RAZORPAY_WEBHOOK_SECRET=echonote-razorpay-webhook-secret:latest" "$EXIT_CODE" "$OUT"

assert_test "Test J5: Deploy maps RESEND_API_KEY to echonote-resend-api-key:latest" \
  "0" "RESEND_API_KEY=echonote-resend-api-key:latest" "$EXIT_CODE" "$OUT"

assert_test "Test J6: Deploy maps PLAYBACK_SECRET to echonote-playback-secret:latest" \
  "0" "PLAYBACK_SECRET=echonote-playback-secret:latest" "$EXIT_CODE" "$OUT"

assert_test "Test J7: Deploy maps CRON_SECRET to echonote-cron-secret:latest" \
  "0" "CRON_SECRET=echonote-cron-secret:latest" "$EXIT_CODE" "$OUT"

assert_test "Test J8: Deploy preserves NODE_ENV=production in env vars" \
  "0" "NODE_ENV=production" "$EXIT_CODE" "$OUT"

assert_test "Test J9: Deploy preserves RAZORPAY_MODE=live in env vars" \
  "0" "RAZORPAY_MODE=live" "$EXIT_CODE" "$OUT"

assert_absent "Test J10: Deploy does NOT use --set-env-vars (which would wipe unmentioned vars)" \
  "--set-env-vars" "$OUT"

# Extract the value of --update-env-vars to verify none of the 6 secret names are in it
UPDATE_ENV_PART="$(echo "$OUT" | grep -o -- '--update-env-vars=[^ ]*' || true)"
assert_absent "Test J11: GEMINI_API_KEY is absent from --update-env-vars" \
  "GEMINI_API_KEY" "$UPDATE_ENV_PART"
assert_absent "Test J12: RAZORPAY_KEY_SECRET is absent from --update-env-vars" \
  "RAZORPAY_KEY_SECRET" "$UPDATE_ENV_PART"
assert_absent "Test J13: RAZORPAY_WEBHOOK_SECRET is absent from --update-env-vars" \
  "RAZORPAY_WEBHOOK_SECRET" "$UPDATE_ENV_PART"
assert_absent "Test J14: RESEND_API_KEY is absent from --update-env-vars" \
  "RESEND_API_KEY" "$UPDATE_ENV_PART"
assert_absent "Test J15: PLAYBACK_SECRET is absent from --update-env-vars" \
  "PLAYBACK_SECRET" "$UPDATE_ENV_PART"
assert_absent "Test J16: CRON_SECRET is absent from --update-env-vars" \
  "CRON_SECRET" "$UPDATE_ENV_PART"

# ----------------------------------------------------------------------------
# Test K: Step 1L-A Update-Env Action Secret Manager Integration
# ----------------------------------------------------------------------------
OUT_UPDATE=$(PATH="$MOCK_BIN:$PATH" DRY_RUN=0 "$DEPLOY_SCRIPT" update-env 2>&1)
EXIT_CODE_UPDATE=$?

assert_test "Test K1: Update-env succeeds and invokes services update" \
  "0" "MOCK_GCLOUD_SERVICES_UPDATE_INVOKED" "$EXIT_CODE_UPDATE" "$OUT_UPDATE"

assert_test "Test K2: Update-env specifies --set-secrets flag" \
  "0" "--set-secrets=" "$EXIT_CODE_UPDATE" "$OUT_UPDATE"

assert_test "Test K3: Update-env contains all 6 Secret Manager mappings" \
  "0" "GEMINI_API_KEY=echonote-gemini-api-key:latest,RAZORPAY_KEY_SECRET=echonote-razorpay-key-secret:latest,RAZORPAY_WEBHOOK_SECRET=echonote-razorpay-webhook-secret:latest,RESEND_API_KEY=echonote-resend-api-key:latest,PLAYBACK_SECRET=echonote-playback-secret:latest,CRON_SECRET=echonote-cron-secret:latest" \
  "$EXIT_CODE_UPDATE" "$OUT_UPDATE"

assert_test "Test K4: Update-env uses --update-env-vars to preserve other non-secret env vars" \
  "0" "--update-env-vars=RAZORPAY_MODE=live" "$EXIT_CODE_UPDATE" "$OUT_UPDATE"

assert_absent "Test K5: Update-env does NOT use --set-env-vars" \
  "--set-env-vars" "$OUT_UPDATE"

UPDATE_ENV_PART_K="$(echo "$OUT_UPDATE" | grep -o -- '--update-env-vars=[^ ]*' || true)"
assert_absent "Test K6: Update-env does NOT place GEMINI_API_KEY in --update-env-vars" \
  "GEMINI_API_KEY" "$UPDATE_ENV_PART_K"
assert_absent "Test K7: Update-env does NOT place RAZORPAY_KEY_SECRET in --update-env-vars" \
  "RAZORPAY_KEY_SECRET" "$UPDATE_ENV_PART_K"
assert_absent "Test K8: Update-env does NOT place RAZORPAY_WEBHOOK_SECRET in --update-env-vars" \
  "RAZORPAY_WEBHOOK_SECRET" "$UPDATE_ENV_PART_K"
assert_absent "Test K9: Update-env does NOT place RESEND_API_KEY in --update-env-vars" \
  "RESEND_API_KEY" "$UPDATE_ENV_PART_K"
assert_absent "Test K10: Update-env does NOT place PLAYBACK_SECRET in --update-env-vars" \
  "PLAYBACK_SECRET" "$UPDATE_ENV_PART_K"
assert_absent "Test K11: Update-env does NOT place CRON_SECRET in --update-env-vars" \
  "CRON_SECRET" "$UPDATE_ENV_PART_K"

# Test K12: Update-env with DRY_RUN=1 does not invoke gcloud
OUT_UPDATE_DRY=$(PATH="$MOCK_BIN:$PATH" DRY_RUN=1 "$DEPLOY_SCRIPT" update-env 2>&1)
if echo "$OUT_UPDATE_DRY" | grep -q "MOCK_GCLOUD_SERVICES_UPDATE_INVOKED"; then
  echo "  ❌ Test K12: gcloud services update was unexpectedly invoked during dry run!"
  FAILED_COUNT=$((FAILED_COUNT + 1))
else
  echo "  ✅ Test K12: Confirmed update-env with DRY_RUN=1 does not execute remote gcloud update"
  PASSED_COUNT=$((PASSED_COUNT + 1))
fi

# ----------------------------------------------------------------------------
# Test L: Static Security & Hardening Invariants
# ----------------------------------------------------------------------------
# Check that scripts/deploy-cloud-run.sh does not contain raw secret values
assert_test "Test L1: Summary displays Secret Manager References header" \
  "0" "Secret Manager References (6 production secrets):" "$EXIT_CODE" "$OUT"

assert_test "Test L2: Summary lists GEMINI_API_KEY mapping" \
  "0" "GEMINI_API_KEY -> echonote-gemini-api-key:latest" "$EXIT_CODE" "$OUT"

assert_test "Test L3: Summary lists RAZORPAY_KEY_SECRET mapping" \
  "0" "RAZORPAY_KEY_SECRET -> echonote-razorpay-key-secret:latest" "$EXIT_CODE" "$OUT"

# Helper to assert that a regex pattern matching raw credentials is absent
assert_pattern_absent() {
  local test_name="$1"
  local pattern="$2"
  local target_file="$3"
  local pattern_description="$4"

  if grep -E -q "$pattern" "$target_file"; then
    echo "  ❌ $test_name ... FAILED"
    echo "     Detected raw credential pattern: $pattern_description"
    FAILED_COUNT=$((FAILED_COUNT + 1))
  else
    echo "  ✅ $test_name ... PASSED"
    PASSED_COUNT=$((PASSED_COUNT + 1))
  fi
}

# Verify no plaintext secret values or recognizable credential patterns in deploy script file
assert_pattern_absent "Test L4: No Razorpay live/test secret-like values in deploy script" \
  "(rzp_(live|test)_[A-Za-z0-9]{10,}|RAZORPAY_KEY_SECRET=[A-Za-z0-9]{16,})" "$DEPLOY_SCRIPT" "Razorpay key/secret format"

assert_pattern_absent "Test L5: No Gemini API-key-like values in deploy script" \
  "AIza[0-9A-Za-z_-]{30,}" "$DEPLOY_SCRIPT" "Gemini/Google API key format"

assert_pattern_absent "Test L6: No Resend API-key-like values in deploy script" \
  "re_[A-Za-z0-9_]{16,}" "$DEPLOY_SCRIPT" "Resend API key format"

assert_pattern_absent "Test L7: No raw 64-character hex secret tokens in deploy script" \
  "[0-9a-fA-F]{64}" "$DEPLOY_SCRIPT" "Raw 64-character hex secret format"

# ----------------------------------------------------------------------------
# Summary
# ----------------------------------------------------------------------------
echo "======================================================================"
echo "TEST RESULTS SUMMARY: $PASSED_COUNT PASSED, $FAILED_COUNT FAILED"
echo "======================================================================"

if [ "$FAILED_COUNT" -gt 0 ]; then
  exit 1
fi
exit 0
