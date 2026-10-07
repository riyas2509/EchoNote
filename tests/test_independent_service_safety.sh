#!/usr/bin/env bash
# ==============================================================================
# EchoNote Independent Cloud Run Safety Test Suite
# ==============================================================================
# Tests the independently managed echonote-prod migration path.
# Does NOT execute any real Cloud Run mutation.
# ==============================================================================

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MIGRATE_SCRIPT="$WORKSPACE_ROOT/scripts/migrate-cloud-run-independent.sh"

chmod +x "$MIGRATE_SCRIPT"

PASSED_COUNT=0
FAILED_COUNT=0

# Test-only non-secret value required by the production configuration guard.
export RAZORPAY_KEY_ID="rzp_test_dummy"

TEST_SANDBOX="$(mktemp -d)"
trap 'rm -rf "$TEST_SANDBOX"' EXIT

MOCK_BIN="$TEST_SANDBOX/bin"
mkdir -p "$MOCK_BIN"

setup_mock_npm() {
  cat <<'EOF' > "$MOCK_BIN/npm"
#!/usr/bin/env bash
if [ "$1" = "run" ] && [ "$2" = "lint" ]; then
  echo "Mock lint passed"
  exit 0
fi

if [ "$1" = "run" ] && [ "$2" = "build" ]; then
  echo "Mock build passed"
  exit 0
fi

if [ "$1" = "run" ] && [ "$2" = "tsx" ]; then
  exit 0
fi

exit 0
EOF
  chmod +x "$MOCK_BIN/npm"
}

setup_mock_gcloud() {
  local mock_state_file="$MOCK_BIN/.gcloud_replace_state"
  rm -f "$mock_state_file"

  local mock_project="${1:-echonote-2509}"
  local mock_legacy_traffic="${2:-echonote-00009-w5m 100}"
  local mock_prod_traffic="${3:-echonote-prod-00001-6rt 100}"
  local mock_ready_revision="${4:-echonote-prod-00001-6rt}"
  local mock_created_revision="${5:-echonote-prod-00002-abc}"
  local mock_ready="${6:-True}"
  local mock_image="${7:-us-west1-docker.pkg.dev/echonote-2509/echonote/echonote@sha256:ca1549df6662f01d7c489ed8ebdc536b0044c51ee55aa4d314e5522a9cd8820c}"
  local mock_revision_service="${8:-echonote-prod}"
  local mock_export_file="${9:-$WORKSPACE_ROOT/tests/fixtures/sample_independent_service.yaml}"
  local mock_active_project="${10:-$mock_project}"

  cat <<EOF > "$MOCK_BIN/gcloud"
#!/usr/bin/env bash

if [ "\$1" = "config" ] && [ "\$2" = "get-value" ] && [ "\$3" = "project" ]; then
  echo "$mock_active_project"
  exit 0
fi

if [ "\$1" = "run" ] && [ "\$2" = "services" ] && [ "\$3" = "describe" ]; then
  if [[ "\$*" == *"--format=export"* ]]; then
    cat "$mock_export_file"
    exit 0
  fi

  if [[ "\$*" == *"status.traffic[0].revisionName,status.traffic[0].percent"* ]]; then
    if [ "\$4" = "echonote-prod" ]; then
      if [ -f "$mock_state_file" ] && [ -n "\${MOCK_POST_REPLACE_PROD_TRAFFIC:-}" ]; then
        echo "\$MOCK_POST_REPLACE_PROD_TRAFFIC"
      else
        echo "$mock_prod_traffic"
      fi
    elif [ "\$4" = "echonote" ]; then
      echo "$mock_legacy_traffic"
    else
      echo "UNKNOWN_SERVICE_TRAFFIC"
      exit 1
    fi
    exit 0
  fi

  if [[ "\$*" == *"status.latestReadyRevisionName"* ]]; then
    echo "$mock_ready_revision"
    exit 0
  fi

  if [[ "\$*" == *"status.latestCreatedRevisionName"* ]]; then
    echo "$mock_created_revision"
    exit 0
  fi

  echo "$mock_created_revision"
  exit 0
fi

if [ "\$1" = "run" ] && [ "\$2" = "services" ] && [ "\$3" = "replace" ]; then
  if grep -q 'run.googleapis.com/sources' "\$4"; then
    echo "MOCK_FORBIDDEN_SOURCE_ANNOTATION_PRESENT" >&2
    exit 1
  fi

  if ! grep -q 'name: echonote-prod' "\$4"; then
    echo "MOCK_WRONG_SERVICE_NAME" >&2
    exit 1
  fi

  touch "$mock_state_file"
  echo "MOCK_GCLOUD_SERVICES_REPLACE_INVOKED"
  exit 0
fi

if [ "\$1" = "run" ] && [ "\$2" = "revisions" ] && [ "\$3" = "describe" ]; then
  if [[ "\$*" == *"metadata.labels[serving.knative.dev/service]"* ]]; then
    echo "$mock_revision_service"
    exit 0
  fi

  if [[ "\$*" == *"status.conditions[0].status"* ]]; then
    echo "$mock_ready"
    exit 0
  fi

  if [[ "\$*" == *"spec.containers[0].image"* ]]; then
    echo "$mock_image"
    exit 0
  fi

  echo "$mock_ready"
  exit 0
fi

if [ "\$1" = "run" ] && [ "\$2" = "services" ] && [ "\$3" = "update-traffic" ]; then
  echo "MOCK_GCLOUD_SERVICES_UPDATE_TRAFFIC_INVOKED: \$*"
  exit 0
fi

echo "MOCK_GCLOUD_UNKNOWN: \$*"
exit 0
EOF

  chmod +x "$MOCK_BIN/gcloud"
}

assert_test() {
  local test_name="$1"
  local expected_exit="$2"
  local expected_text="$3"
  local actual_exit="$4"
  local actual_output="${5:-}"

  local success=1

  if [ "$expected_exit" = "0" ] && [ "$actual_exit" -ne 0 ]; then
    success=0
  elif [ "$expected_exit" = "nonzero" ] && [ "$actual_exit" -eq 0 ]; then
    success=0
  fi

  if [ -n "$expected_text" ] && ! echo "$actual_output" | grep -q -F -- "$expected_text"; then
    success=0
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

assert_absent() {
  local test_name="$1"
  local forbidden_text="$2"
  local actual_output="$3"

  if echo "$actual_output" | grep -q -F -- "$forbidden_text"; then
    echo "  ❌ $test_name ... FAILED"
    echo "     Forbidden text '$forbidden_text' was found."
    FAILED_COUNT=$((FAILED_COUNT + 1))
  else
    echo "  ✅ $test_name ... PASSED"
    PASSED_COUNT=$((PASSED_COUNT + 1))
  fi
}

mkdir -p "$WORKSPACE_ROOT/tests/fixtures"

cat <<'EOF' > "$WORKSPACE_ROOT/tests/fixtures/sample_independent_service.yaml"
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: echonote-prod
  namespace: echonote-2509
  labels:
    cloud.googleapis.com/location: us-west1
spec:
  template:
    metadata:
      name: echonote-prod-00001-6rt
      annotations:
        autoscaling.knative.dev/maxScale: '10'
    spec:
      timeoutSeconds: 300
      serviceAccountName: 200551109142-compute@developer.gserviceaccount.com
      containers:
      - image: us-west1-docker.pkg.dev/echonote-2509/echonote/echonote@sha256:old0000000000000000000000000000000000000000000000000000000000000
        ports:
        - containerPort: 3000
  traffic:
  - percent: 100
    revisionName: echonote-prod-00001-6rt
EOF

VALID_TEST_DIGEST="sha256:ca1549df6662f01d7c489ed8ebdc536b0044c51ee55aa4d314e5522a9cd8820c"

echo "======================================================================"
echo "🧪 RUNNING ECHONOTE INDEPENDENT CLOUD RUN SAFETY TESTS"
echo "======================================================================"

setup_mock_npm
setup_mock_gcloud

# ----------------------------------------------------------------------------
# 1. Target and project hard-locks
# ----------------------------------------------------------------------------

OUT_TARGET=$(PATH="$MOCK_BIN:$PATH" "$MIGRATE_SCRIPT" prepare --digest="$VALID_TEST_DIGEST" 2>&1)
EXIT_TARGET=$?
assert_test "Independent 1: Correct echonote-prod target is accepted" \
  "0" "Service:          echonote-prod" "$EXIT_TARGET" "$OUT_TARGET"

setup_mock_gcloud   "echonote-2509"   "echonote-00009-w5m 100"   "echonote-prod-00001-6rt 100"   "echonote-prod-00001-6rt"   "echonote-prod-00002-abc"   "True"   "us-west1-docker.pkg.dev/echonote-2509/echonote/echonote@sha256:ca1549df6662f01d7c489ed8ebdc536b0044c51ee55aa4d314e5522a9cd8820c"   "echonote-prod"   "$WORKSPACE_ROOT/tests/fixtures/sample_independent_service.yaml"   "attacker-project"

OUT_PROJECT=$(PATH="$MOCK_BIN:$PATH" "$MIGRATE_SCRIPT" prepare --digest="$VALID_TEST_DIGEST" 2>&1)
EXIT_PROJECT=$?
assert_test "Independent 2: Wrong active project is rejected" \
  "nonzero" "ERROR: Active gcloud project mismatch" "$EXIT_PROJECT" "$OUT_PROJECT"

# Restore the normal mock project for the remaining validation tests.
setup_mock_gcloud \
  "echonote-2509" \
  "echonote-00009-w5m 100" \
  "echonote-prod-00001-6rt 100" \
  "echonote-prod-00001-6rt" \
  "echonote-prod-00002-abc" \
  "True"

OUT_MODE=$(PATH="$MOCK_BIN:$PATH" RAZORPAY_MODE="test" "$MIGRATE_SCRIPT" prepare --digest="$VALID_TEST_DIGEST" 2>&1)
EXIT_MODE=$?
assert_test "Independent 3: Non-live Razorpay mode is rejected" \
  "nonzero" "ERROR: Production requires RAZORPAY_MODE=live" "$EXIT_MODE" "$OUT_MODE"

# ----------------------------------------------------------------------------
# 2. Immutable image validation
# ----------------------------------------------------------------------------

OUT_NO_DIGEST=$(PATH="$MOCK_BIN:$PATH" "$MIGRATE_SCRIPT" prepare 2>&1)
EXIT_NO_DIGEST=$?
assert_test "Independent 4: Missing immutable digest is rejected" \
  "nonzero" "ERROR: Explicit immutable image digest required" "$EXIT_NO_DIGEST" "$OUT_NO_DIGEST"

OUT_BAD_REPO=$(PATH="$MOCK_BIN:$PATH" "$MIGRATE_SCRIPT" prepare --digest="us-west1-docker.pkg.dev/wrong/project@sha256:$(
  printf 'a%.0s' {1..64}
)" 2>&1)
EXIT_BAD_REPO=$?
assert_test "Independent 5: Wrong Artifact Registry repository is rejected" \
  "nonzero" "ERROR: Image repository mismatch" "$EXIT_BAD_REPO" "$OUT_BAD_REPO"

OUT_BAD_DIGEST=$(PATH="$MOCK_BIN:$PATH" "$MIGRATE_SCRIPT" prepare --digest="sha256:invalid" 2>&1)
EXIT_BAD_DIGEST=$?
assert_test "Independent 6: Malformed digest is rejected" \
  "nonzero" "ERROR: Invalid immutable image digest" "$EXIT_BAD_DIGEST" "$OUT_BAD_DIGEST"

# ----------------------------------------------------------------------------
# 3. DRY RUN
# ----------------------------------------------------------------------------

OUT_DRY=$(PATH="$MOCK_BIN:$PATH" DRY_RUN=1 "$MIGRATE_SCRIPT" prepare --digest="$VALID_TEST_DIGEST" 2>&1)
EXIT_DRY=$?
assert_test "Independent 7: DRY_RUN succeeds" \
  "0" "DRY RUN PASSED." "$EXIT_DRY" "$OUT_DRY"
assert_absent "Independent 8: DRY_RUN does not invoke services replace" \
  "MOCK_GCLOUD_SERVICES_REPLACE_INVOKED" "$OUT_DRY"

# ----------------------------------------------------------------------------
# 4. Successful prepare
# ----------------------------------------------------------------------------

setup_mock_gcloud \
  "echonote-2509" \
  "echonote-00009-w5m 100" \
  "echonote-prod-00001-6rt 100" \
  "echonote-prod-00001-6rt" \
  "echonote-prod-00002-abc" \
  "True"

OUT_PREPARE=$(PATH="$MOCK_BIN:$PATH" "$MIGRATE_SCRIPT" prepare --digest="$VALID_TEST_DIGEST" 2>&1)
EXIT_PREPARE=$?

assert_test "Independent 9: Prepare invokes services replace" \
  "0" "MOCK_GCLOUD_SERVICES_REPLACE_INVOKED" "$EXIT_PREPARE" "$OUT_PREPARE"

assert_test "Independent 10: Prepare creates expected candidate" \
  "0" "READY: echonote-prod-00002-abc" "$EXIT_PREPARE" "$OUT_PREPARE"

assert_test "Independent 11: Legacy echonote remains protected" \
  "0" "Legacy production service remains untouched." "$EXIT_PREPARE" "$OUT_PREPARE"

assert_absent "Independent 12: Prepare never invokes update-traffic" \
  "MOCK_GCLOUD_SERVICES_UPDATE_TRAFFIC_INVOKED" "$OUT_PREPARE"

# ----------------------------------------------------------------------------
# 5. Premature traffic detection
# ----------------------------------------------------------------------------

setup_mock_gcloud \
  "echonote-2509" \
  "echonote-00009-w5m 100" \
  "echonote-prod-00002-abc 100" \
  "echonote-prod-00002-abc" \
  "echonote-prod-00003-xyz" \
  "True"

export MOCK_POST_REPLACE_PROD_TRAFFIC="echonote-prod-00003-xyz 100"

OUT_TRAFFIC=$(PATH="$MOCK_BIN:$PATH" "$MIGRATE_SCRIPT" prepare --digest="$VALID_TEST_DIGEST" 2>&1)
EXIT_TRAFFIC=$?

assert_test "Independent 13: Prepare aborts on unexpected traffic shift" \
  "nonzero" "ERROR: Independent service traffic changed unexpectedly" "$EXIT_TRAFFIC" "$OUT_TRAFFIC"

unset MOCK_POST_REPLACE_PROD_TRAFFIC

# ----------------------------------------------------------------------------
# 6. Readiness and image verification
# ----------------------------------------------------------------------------

setup_mock_gcloud \
  "echonote-2509" \
  "echonote-00009-w5m 100" \
  "echonote-prod-00001-6rt 100" \
  "echonote-prod-00001-6rt" \
  "echonote-prod-00002-abc" \
  "False"

OUT_UNREADY=$(PATH="$MOCK_BIN:$PATH" "$MIGRATE_SCRIPT" prepare --digest="$VALID_TEST_DIGEST" 2>&1)
EXIT_UNREADY=$?

assert_test "Independent 14: Unready candidate is rejected" \
  "nonzero" "ERROR: New revision is not Ready" "$EXIT_UNREADY" "$OUT_UNREADY"

setup_mock_gcloud \
  "echonote-2509" \
  "echonote-00009-w5m 100" \
  "echonote-prod-00001-6rt 100" \
  "echonote-prod-00001-6rt" \
  "echonote-prod-00002-abc" \
  "True" \
  "us-west1-docker.pkg.dev/echonote-2509/echonote/echonote@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

OUT_IMAGE=$(PATH="$MOCK_BIN:$PATH" "$MIGRATE_SCRIPT" prepare --digest="$VALID_TEST_DIGEST" 2>&1)
EXIT_IMAGE=$?

assert_test "Independent 15: Image digest mismatch is rejected" \
  "nonzero" "ERROR: Immutable image digest verification failed" "$EXIT_IMAGE" "$OUT_IMAGE"

# ----------------------------------------------------------------------------
# 7. Legacy service protection
# ----------------------------------------------------------------------------

setup_mock_gcloud \
  "echonote-2509" \
  "echonote-00008-lw9 100" \
  "echonote-prod-00001-6rt 100" \
  "echonote-prod-00001-6rt" \
  "echonote-prod-00002-abc" \
  "True"

OUT_LEGACY=$(PATH="$MOCK_BIN:$PATH" "$MIGRATE_SCRIPT" prepare --digest="$VALID_TEST_DIGEST" 2>&1)
EXIT_LEGACY=$?

assert_test "Independent 16: Legacy service baseline violation aborts" \
  "nonzero" "ERROR: Legacy production service is not safely on expected baseline" "$EXIT_LEGACY" "$OUT_LEGACY"

# ----------------------------------------------------------------------------
# 8. Promotion ownership and readiness guards
# ----------------------------------------------------------------------------

setup_mock_gcloud \
  "echonote-2509" \
  "echonote-00009-w5m 100" \
  "echonote-prod-00001-6rt 100" \
  "echonote-prod-00001-6rt" \
  "echonote-prod-00002-abc" \
  "True" \
  "us-west1-docker.pkg.dev/echonote-2509/echonote/echonote@$VALID_TEST_DIGEST" \
  "echonote-prod"

OUT_PROMOTE=$(PATH="$MOCK_BIN:$PATH" "$MIGRATE_SCRIPT" promote "echonote-prod-00002-abc" 2>&1)
EXIT_PROMOTE=$?

assert_test "Independent 17: Valid owned revision can be promoted" \
  "0" "100% traffic routed to echonote-prod-00002-abc." "$EXIT_PROMOTE" "$OUT_PROMOTE"

assert_test "Independent 18: Promotion invokes update-traffic" \
  "0" "MOCK_GCLOUD_SERVICES_UPDATE_TRAFFIC_INVOKED" "$EXIT_PROMOTE" "$OUT_PROMOTE"

# Wrong service ownership
setup_mock_gcloud \
  "echonote-2509" \
  "echonote-00009-w5m 100" \
  "echonote-prod-00001-6rt 100" \
  "echonote-prod-00001-6rt" \
  "echonote-prod-00002-abc" \
  "True" \
  "us-west1-docker.pkg.dev/echonote-2509/echonote/echonote@$VALID_TEST_DIGEST" \
  "echonote"

OUT_OWNER=$(PATH="$MOCK_BIN:$PATH" "$MIGRATE_SCRIPT" promote "echonote-prod-00002-abc" 2>&1)
EXIT_OWNER=$?

assert_test "Independent 19: Foreign-service revision is rejected" \
  "nonzero" "ERROR: Target revision does not belong to echonote-prod" "$EXIT_OWNER" "$OUT_OWNER"

# Unready owned revision
setup_mock_gcloud \
  "echonote-2509" \
  "echonote-00009-w5m 100" \
  "echonote-prod-00001-6rt 100" \
  "echonote-prod-00001-6rt" \
  "echonote-prod-00002-abc" \
  "False" \
  "us-west1-docker.pkg.dev/echonote-2509/echonote/echonote@$VALID_TEST_DIGEST" \
  "echonote-prod"

OUT_PROMOTE_UNREADY=$(PATH="$MOCK_BIN:$PATH" "$MIGRATE_SCRIPT" promote "echonote-prod-00002-abc" 2>&1)
EXIT_PROMOTE_UNREADY=$?

assert_test "Independent 20: Unready revision cannot be promoted" \
  "nonzero" "ERROR: Target revision is not Ready" "$EXIT_PROMOTE_UNREADY" "$OUT_PROMOTE_UNREADY"

# ----------------------------------------------------------------------------
# 10. Required Razorpay production configuration
# ----------------------------------------------------------------------------

SAVED_RAZORPAY_KEY_ID="${RAZORPAY_KEY_ID:-}"
unset RAZORPAY_KEY_ID

OUT_MISSING_KEY=$(
  PATH="$MOCK_BIN:$PATH" "$MIGRATE_SCRIPT" prepare     --image-digest="$VALID_TEST_DIGEST" 2>&1
)
EXIT_MISSING_KEY=$?

export RAZORPAY_KEY_ID="$SAVED_RAZORPAY_KEY_ID"

assert_test "Independent 22: Missing RAZORPAY_KEY_ID blocks prepare"   "nonzero"   "ERROR: RAZORPAY_KEY_ID is not set. Aborting production deployment."   "$EXIT_MISSING_KEY"   "$OUT_MISSING_KEY"

# ----------------------------------------------------------------------------
# 9. Secret redaction
# ----------------------------------------------------------------------------

assert_absent "Independent 21: Test output does not contain plaintext secret values" \
  "old_plaintext_key" "$OUT_PREPARE"

echo "======================================================================"
echo "TEST RESULTS SUMMARY: $PASSED_COUNT PASSED, $FAILED_COUNT FAILED"
echo "======================================================================"

if [ "$FAILED_COUNT" -gt 0 ]; then
  exit 1
fi

exit 0
