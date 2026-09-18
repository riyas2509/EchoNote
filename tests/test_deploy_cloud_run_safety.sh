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

echo "======================================================================"
echo "🚀 RUNNING STEP 1J DEPLOYMENT SAFETY & TARGET LOCKING TESTS"
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
# Summary
# ----------------------------------------------------------------------------
echo "======================================================================"
echo "TEST RESULTS SUMMARY: $PASSED_COUNT PASSED, $FAILED_COUNT FAILED"
echo "======================================================================"

if [ "$FAILED_COUNT" -gt 0 ]; then
  exit 1
fi
exit 0
