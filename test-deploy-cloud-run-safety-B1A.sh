#!/usr/bin/env bash
# ==============================================================================
# EchoNote Production Deployment Script Safety Test Suite (Fix B.1 & B.1A)
# ==============================================================================
# Tests all security invariants, immutable Docker deployment guardrails, and
# Secret Manager references for scripts/deploy-cloud-run.sh
# WITHOUT executing any real deployment or remote cloud commands.
# ==============================================================================

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEPLOY_SCRIPT="$WORKSPACE_ROOT/scripts/deploy-cloud-run.sh"
chmod +x "$DEPLOY_SCRIPT"

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

# Helper for creating a mock git
setup_mock_git() {
  local mock_sha="${1:-a1b2c3d4e5f6}"
  cat <<EOF > "$MOCK_BIN/git"
#!/usr/bin/env bash
if [ "\$1" = "rev-parse" ]; then
  if [ -n "$mock_sha" ]; then
    echo "$mock_sha"
    exit 0
  else
    exit 1
  fi
fi
if command -v /usr/bin/git &>/dev/null; then
  exec /usr/bin/git "\$@"
fi
exit 0
EOF
  chmod +x "$MOCK_BIN/git"
}

# Helper for creating a mock docker
setup_mock_docker() {
  local build_exit="${1:-0}"
  local push_exit="${2:-0}"
  cat <<EOF > "$MOCK_BIN/docker"
#!/usr/bin/env bash
if [ "\$1" = "build" ]; then
  if [ "$build_exit" -ne 0 ]; then
    echo "Simulated docker build failure" >&2
    exit $build_exit
  fi
  echo "MOCK_DOCKER_BUILD_INVOKED: \$*"
  exit 0
fi

if [ "\$1" = "push" ]; then
  if [ "$push_exit" -ne 0 ]; then
    echo "Simulated docker push failure" >&2
    exit $push_exit
  fi
  echo "MOCK_DOCKER_PUSH_INVOKED: \$*"
  exit 0
fi

if [ "\$1" = "inspect" ]; then
  echo "us-west1-docker.pkg.dev/echonote-2509/echonote/echonote@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  exit 0
fi

echo "MOCK_DOCKER_UNKNOWN: \$*"
exit 0
EOF
  chmod +x "$MOCK_BIN/docker"
}

# Helper for creating a mock gcloud
setup_mock_gcloud() {
  local mock_project="${1:-echonote-2509}"
  local mock_digest="${2:-sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef}"
  local mock_revision="${3:-echonote-00010-abc}"
  local mock_ready="${4:-True}"
  local mock_image="${5:-us-west1-docker.pkg.dev/echonote-2509/echonote/echonote@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef}"

  cat <<EOF > "$MOCK_BIN/gcloud"
#!/usr/bin/env bash
if [ "\$1" = "config" ] && [ "\$2" = "get-value" ] && [ "\$3" = "project" ]; then
  echo "$mock_project"
  exit 0
fi

if [ "\$1" = "artifacts" ] && [ "\$2" = "docker" ] && [ "\$3" = "images" ] && [ "\$4" = "describe" ]; then
  if [ -n "$mock_digest" ]; then
    echo "$mock_digest"
    exit 0
  else
    exit 1
  fi
fi

if [ "\$1" = "run" ] && [ "\$2" = "deploy" ]; then
  echo "MOCK_GCLOUD_DEPLOY_INVOKED: \$*"
  exit 0
fi

if [ "\$1" = "run" ] && [ "\$2" = "services" ] && [ "\$3" = "update" ]; then
  echo "MOCK_GCLOUD_SERVICES_UPDATE_INVOKED: \$*"
  exit 0
fi

if [ "\$1" = "run" ] && [ "\$2" = "services" ] && [ "\$3" = "describe" ]; then
  echo "$mock_revision"
  exit 0
fi

if [ "\$1" = "run" ] && [ "\$2" = "revisions" ] && [ "\$3" = "describe" ]; then
  if [[ "\$*" == *"--format=value(spec.containers[0].image)"* ]]; then
    echo "$mock_image"
    exit 0
  fi
  echo "$mock_ready"
  exit 0
fi

if [ "\$1" = "run" ] && [ "\$2" = "services" ] && [ "\$3" = "update-traffic" ]; then
  echo "MOCK_GCLOUD_UPDATE_TRAFFIC_INVOKED: \$*"
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

echo "======================================================================"
echo "🚀 RUNNING ECHONOTE FIX B.1A DEPLOYMENT SAFETY & IMMUTABLE DOCKER TESTS"
echo "======================================================================"

# Default mock binaries to successful states
setup_mock_npm 0 0
setup_mock_git "a1b2c3d4e5f6"
setup_mock_docker 0 0
setup_mock_gcloud "echonote-2509"

# ----------------------------------------------------------------------------
# Test A: Correct Target & Validation Success with DRY_RUN=1
# ----------------------------------------------------------------------------
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
  "0" "Razorpay Pro Monthly Plan:   VALID" "$EXIT_CODE" "$OUT"

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
assert_test "Test L1: Summary displays Secret Manager References header" \
  "0" "Secret Manager References (6 production secrets):" "$EXIT_CODE" "$OUT"

assert_test "Test L2: Summary lists GEMINI_API_KEY mapping" \
  "0" "GEMINI_API_KEY -> echonote-gemini-api-key:latest" "$EXIT_CODE" "$OUT"

assert_test "Test L3: Summary lists RAZORPAY_KEY_SECRET mapping" \
  "0" "RAZORPAY_KEY_SECRET -> echonote-razorpay-key-secret:latest" "$EXIT_CODE" "$OUT"

assert_pattern_absent "Test L4: No Razorpay live/test secret-like values in deploy script" \
  "(rzp_(live|test)_[A-Za-z0-9]{10,}|RAZORPAY_KEY_SECRET=[A-Za-z0-9]{16,})" "$DEPLOY_SCRIPT" "Razorpay key/secret format"

assert_pattern_absent "Test L5: No Gemini API-key-like values in deploy script" \
  "AIza[0-9A-Za-z_-]{30,}" "$DEPLOY_SCRIPT" "Gemini/Google API key format"

assert_pattern_absent "Test L6: No Resend API-key-like values in deploy script" \
  "re_[A-Za-z0-9_]{16,}" "$DEPLOY_SCRIPT" "Resend API key format"

assert_pattern_absent "Test L7: No raw 64-character hex secret tokens in deploy script" \
  "[0-9a-fA-F]{64}" "$DEPLOY_SCRIPT" "Raw 64-character hex secret format"

# ----------------------------------------------------------------------------
# Test M: Fix B.1 & B.1A Specific Immutable Docker Deployment Guardrail Tests (All Invariants)
# ----------------------------------------------------------------------------
echo "----------------------------------------------------------------------"
echo "Verifying Fix B.1 & B.1A Required Invariants..."
echo "----------------------------------------------------------------------"

# Invariant 1: production project is hard-locked
OUT_P1=$(PATH="$MOCK_BIN:$PATH" GOOGLE_CLOUD_PROJECT="unauthorized-project" "$DEPLOY_SCRIPT" deploy 2>&1)
EXIT_P1=$?
assert_test "Fix B.1A Inv 1: Production project is hard-locked to echonote-2509" \
  "nonzero" "ERROR: Production deployment target mismatch" "$EXIT_P1" "$OUT_P1"

# Invariant 2: production region is hard-locked
OUT_P2=$(PATH="$MOCK_BIN:$PATH" CLOUD_RUN_REGION="us-central1" "$DEPLOY_SCRIPT" deploy 2>&1)
EXIT_P2=$?
assert_test "Fix B.1A Inv 2: Production region is hard-locked to us-west1" \
  "nonzero" "ERROR: Production deployment target mismatch" "$EXIT_P2" "$OUT_P2"

# Invariant 3: service name is hard-locked
OUT_P3=$(PATH="$MOCK_BIN:$PATH" CLOUD_RUN_SERVICE="unauthorized-service" "$DEPLOY_SCRIPT" deploy 2>&1)
EXIT_P3=$?
assert_test "Fix B.1A Inv 3: Service name is hard-locked to echonote" \
  "nonzero" "ERROR: Production deployment target mismatch" "$EXIT_P3" "$OUT_P3"

# Invariant 4: service account is hard-locked
assert_test "Fix B.1A Inv 4: Service account is hard-locked in deploy invocation" \
  "0" "--service-account=200551109142-compute@developer.gserviceaccount.com" "$EXIT_CODE" "$OUT"

# Invariant 5: deploy path does NOT contain source deployment flags
FORBIDDEN_SRC_FLAG="--""source"
assert_absent "Fix B.1A Inv 5: Deploy path does NOT contain '$FORBIDDEN_SRC_FLAG'" \
  "$FORBIDDEN_SRC_FLAG" "$OUT"
assert_pattern_absent "Fix B.1A Inv 5b: Deploy script file does NOT contain 'gcloud run deploy.*$FORBIDDEN_SRC_FLAG'" \
  "gcloud[[:space:]]+run[[:space:]]+deploy.*--""source" "$DEPLOY_SCRIPT" "gcloud run deploy --source"

# Invariant 6: image repository is hard-locked
assert_test "Fix B.1A Inv 6: Artifact Registry image repository is hard-locked" \
  "0" "us-west1-docker.pkg.dev/echonote-2509/echonote/echonote" "$EXIT_CODE" "$OUT"

# Invariant 7: image tag uses git SHA
assert_test "Fix B.1A Inv 7: Image tag resolves to git SHA in docker build & push" \
  "0" "us-west1-docker.pkg.dev/echonote-2509/echonote/echonote:a1b2c3d4e5f6" "$EXIT_CODE" "$OUT"

# Invariant 8: mutable latest tag is rejected
OUT_LATEST=$(PATH="$MOCK_BIN:$PATH" IMAGE_TAG="latest" "$DEPLOY_SCRIPT" deploy 2>&1)
EXIT_LATEST=$?
assert_test "Fix B.1A Inv 8: Mutable 'latest' tag is strictly rejected" \
  "nonzero" "ERROR: Mutable 'latest' tag is strictly forbidden" "$EXIT_LATEST" "$OUT_LATEST"

# Invariant 9: Secret Manager references remain configured
assert_test "Fix B.1A Inv 9: All 6 Secret Manager references remain configured in deploy" \
  "0" "--set-secrets=GEMINI_API_KEY=echonote-gemini-api-key:latest,RAZORPAY_KEY_SECRET=echonote-razorpay-key-secret:latest,RAZORPAY_WEBHOOK_SECRET=echonote-razorpay-webhook-secret:latest,RESEND_API_KEY=echonote-resend-api-key:latest,PLAYBACK_SECRET=echonote-playback-secret:latest,CRON_SECRET=echonote-cron-secret:latest" \
  "$EXIT_CODE" "$OUT"

# Invariant 10: Docker build is required
setup_mock_docker 1 0
OUT_DBUILD=$(PATH="$MOCK_BIN:$PATH" "$DEPLOY_SCRIPT" deploy 2>&1)
EXIT_DBUILD=$?
assert_test "Fix B.1A Inv 10a: Aborts immediately if Docker build fails" \
  "nonzero" "ERROR: Docker build failed" "$EXIT_DBUILD" "$OUT_DBUILD"
assert_absent "Fix B.1A Inv 10b: No traffic shift on Docker build failure" \
  "MOCK_GCLOUD_UPDATE_TRAFFIC_INVOKED" "$OUT_DBUILD"

# Invariant 11: Docker push is required
setup_mock_docker 0 1
OUT_DPUSH=$(PATH="$MOCK_BIN:$PATH" "$DEPLOY_SCRIPT" deploy 2>&1)
EXIT_DPUSH=$?
assert_test "Fix B.1A Inv 11a: Aborts immediately if Docker push fails" \
  "nonzero" "ERROR: Docker push failed" "$EXIT_DPUSH" "$OUT_DPUSH"
assert_absent "Fix B.1A Inv 11b: No traffic shift on Docker push failure" \
  "MOCK_GCLOUD_UPDATE_TRAFFIC_INVOKED" "$OUT_DPUSH"

# Reset mock docker to success
setup_mock_docker 0 0

# Invariant 12: immutable digest is required for deployment
assert_test "Fix B.1A Inv 12a: Immutable digest is used in --image argument" \
  "0" "--image=us-west1-docker.pkg.dev/echonote-2509/echonote/echonote@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" \
  "$EXIT_CODE" "$OUT"

# Invariant 13: initial deployment uses --no-traffic
assert_test "Fix B.1A Inv 13: Initial deployment uses --no-traffic" \
  "0" "--no-traffic" "$EXIT_CODE" "$OUT"

# Invariant 14: digest resolution failure aborts and does not shift traffic
setup_mock_gcloud "echonote-2509" "invalid_digest"
cat <<EOF > "$MOCK_BIN/docker"
#!/usr/bin/env bash
if [ "\$1" = "build" ] || [ "\$1" = "push" ]; then
  exit 0
fi
exit 1
EOF
chmod +x "$MOCK_BIN/docker"
OUT_INVDIGEST=$(PATH="$MOCK_BIN:$PATH" "$DEPLOY_SCRIPT" deploy 2>&1)
EXIT_INVDIGEST=$?
assert_test "Fix B.1A Inv 14a: Aborts if image digest format is invalid or unresolved" \
  "nonzero" "ERROR: Invalid image digest format" "$EXIT_INVDIGEST" "$OUT_INVDIGEST"
assert_absent "Fix B.1A Inv 14b: No traffic shift on invalid digest" \
  "MOCK_GCLOUD_UPDATE_TRAFFIC_INVOKED" "$OUT_INVDIGEST"

# Invariant 15: readiness is checked before traffic routing
setup_mock_docker 0 0
setup_mock_gcloud "echonote-2509" "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" "echonote-00010-abc" "False"
OUT_UNREADY=$(PATH="$MOCK_BIN:$PATH" "$DEPLOY_SCRIPT" deploy 2>&1)
EXIT_UNREADY=$?
assert_test "Fix B.1A Inv 15a: Aborts if deployed revision fails health check (Ready != True)" \
  "nonzero" "failed health check" "$EXIT_UNREADY" "$OUT_UNREADY"
assert_absent "Fix B.1A Inv 15b: No traffic shift if revision is not Ready" \
  "MOCK_GCLOUD_UPDATE_TRAFFIC_INVOKED" "$OUT_UNREADY"

# Invariant 16: image digest of deployed revision is verified before traffic shift
setup_mock_gcloud "echonote-2509" "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" "echonote-00010-abc" "True" "us-west1-docker.pkg.dev/echonote-2509/echonote/echonote@sha256:mismatched00000000000000000000000000000000000000000000000000000000"
OUT_MISMATCH=$(PATH="$MOCK_BIN:$PATH" "$DEPLOY_SCRIPT" deploy 2>&1)
EXIT_MISMATCH=$?
assert_test "Fix B.1A Inv 16a: Aborts if deployed revision image does not match resolved digest" \
  "nonzero" "image verification failed" "$EXIT_MISMATCH" "$OUT_MISMATCH"
assert_absent "Fix B.1A Inv 16b: No traffic shift if revision image digest does not match" \
  "MOCK_GCLOUD_UPDATE_TRAFFIC_INVOKED" "$OUT_MISMATCH"

# Invariant 17: traffic shift ONLY occurs when Ready=True and image matches
setup_mock_gcloud "echonote-2509" "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" "echonote-00010-abc" "True" "us-west1-docker.pkg.dev/echonote-2509/echonote/echonote@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
OUT_SUCCESS=$(PATH="$MOCK_BIN:$PATH" "$DEPLOY_SCRIPT" deploy 2>&1)
EXIT_SUCCESS=$?
assert_test "Fix B.1A Inv 17a: Succeeded when Ready=True and image digest matches" \
  "0" "Explicit immutable Docker deployment completed and 100% traffic active" "$EXIT_SUCCESS" "$OUT_SUCCESS"
assert_test "Fix B.1A Inv 17b: update-traffic is called targeting the verified revision" \
  "0" "MOCK_GCLOUD_UPDATE_TRAFFIC_INVOKED: run services update-traffic echonote --to-revisions=echonote-00010-abc=100" "$EXIT_SUCCESS" "$OUT_SUCCESS"

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
