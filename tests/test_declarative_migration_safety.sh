#!/usr/bin/env bash
# ==============================================================================
# EchoNote Declarative Migration Safety Test Suite (Step 6M-I)
# ==============================================================================
# Tests all invariants, mock execution paths, security guardrails, and
# zero-traffic isolation for declarative Cloud Run migration.
# Does NOT execute any real cloud mutation.
# ==============================================================================

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MIGRATE_SCRIPT="$WORKSPACE_ROOT/scripts/migrate-cloud-run-declarative.sh"
DEPLOY_SCRIPT="$WORKSPACE_ROOT/scripts/deploy-cloud-run.sh"
chmod +x "$MIGRATE_SCRIPT" "$DEPLOY_SCRIPT"

PASSED_COUNT=0
FAILED_COUNT=0

TEST_SANDBOX="$(mktemp -d)"
trap 'rm -rf "$TEST_SANDBOX"' EXIT

MOCK_BIN="$TEST_SANDBOX/bin"
mkdir -p "$MOCK_BIN"

REAL_NPM="$(command -v npm)"

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

setup_mock_gcloud() {
  local mock_project="${1:-echonote-2509}"
  local mock_serving_traffic="${2:-echonote-00009-w5m 100}"
  local mock_new_rev="${3:-echonote-00010-xyz}"
  local mock_ready="${4:-True}"
  local mock_image="${5:-us-west1-docker.pkg.dev/echonote-2509/echonote/echonote@sha256:ca1549df6662f01d7c489ed8ebdc536b0044c51ee55aa4d314e5522a9cd8820c}"
  local mock_export_file="${6:-$WORKSPACE_ROOT/tests/fixtures/sample_service.yaml}"

  cat <<EOF > "$MOCK_BIN/gcloud"
#!/usr/bin/env bash
if [ "\$1" = "config" ] && [ "\$2" = "get-value" ] && [ "\$3" = "project" ]; then
  echo "$mock_project"
  exit 0
fi

if [ "\$1" = "run" ] && [ "\$2" = "services" ] && [ "\$3" = "describe" ]; then
  if [[ "\$*" == *"--format=export"* ]]; then
    cat "$mock_export_file"
    exit 0
  fi
  if [[ "\$*" == *"status.traffic[0].revisionName"* ]]; then
    echo "${mock_serving_traffic%% *}"
    exit 0
  fi
  if [[ "\$*" == *"status.traffic[0].percent"* ]]; then
    echo "${mock_serving_traffic##* }"
    exit 0
  fi
  if [[ "\$*" == *"status.latestCreatedRevisionName"* ]]; then
    echo "$mock_new_rev"
    exit 0
  fi
  echo "$mock_new_rev"
  exit 0
fi

if [ "\$1" = "run" ] && [ "\$2" = "services" ] && [ "\$3" = "replace" ]; then
  if grep -q 'run.googleapis.com/sources' "\$4"; then
    echo "MOCK_FORBIDDEN_SOURCE_ANNOTATION_PRESENT" >&2
    exit 1
  fi
  echo "MOCK_GCLOUD_SERVICES_REPLACE_INVOKED: \$*"
  echo "MOCK_SOURCE_ANNOTATION_STRIPPED"
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

# Create fixture directory and sample service YAML
mkdir -p "$WORKSPACE_ROOT/tests/fixtures"
FIXTURE_YAML="$WORKSPACE_ROOT/tests/fixtures/sample_service.yaml"
cat <<'EOF' > "$FIXTURE_YAML"
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: echonote
  namespace: echonote-2509
  labels:
    cloud.googleapis.com/location: us-west1
  annotations:
    run.googleapis.com/ingress: all
spec:
  template:
    metadata:
      name: echonote-00009-w5m
      annotations:
        autoscaling.knative.dev/maxScale: '10'
        run.googleapis.com/sources: '{"app-container":"gs://run-sources-echonote-2509-us-west1/services/echonote/test-source.tar.gz"}'
    spec:
      containerConcurrency: 80
      timeoutSeconds: 300
      serviceAccountName: 200551109142-compute@developer.gserviceaccount.com
      containers:
      - image: us-west1-docker.pkg.dev/echonote-2509/echonote/echonote@sha256:old0000000000000000000000000000000000000000000000000000000000000
        ports:
        - containerPort: 3000
        env:
        - name: GEMINI_API_KEY
          value: old_plaintext_key
  traffic:
  - percent: 100
    revisionName: echonote-00009-w5m
EOF

echo "======================================================================"
echo "🚀 RUNNING ECHONOTE STEP 6M-I DECLARATIVE MIGRATION SAFETY TESTS"
echo "======================================================================"

setup_mock_npm 0 0
setup_mock_gcloud "echonote-2509"

# ----------------------------------------------------------------------------
# 1. Target and Environment Validations
# ----------------------------------------------------------------------------
OUT_P1=$(PATH="$MOCK_BIN:$PATH" GOOGLE_CLOUD_PROJECT="attacker-project" "$MIGRATE_SCRIPT" prepare 2>&1)
EXIT_P1=$?
assert_test "Migrate Inv 1: Rejects mismatched project ID" \
  "nonzero" "ERROR: Production deployment target mismatch" "$EXIT_P1" "$OUT_P1"

OUT_P2=$(PATH="$MOCK_BIN:$PATH" CLOUD_RUN_REGION="europe-west1" "$MIGRATE_SCRIPT" prepare 2>&1)
EXIT_P2=$?
assert_test "Migrate Inv 2: Rejects mismatched region" \
  "nonzero" "ERROR: Production deployment target mismatch" "$EXIT_P2" "$OUT_P2"

OUT_P3=$(PATH="$MOCK_BIN:$PATH" CLOUD_RUN_SERVICE="wrong-service" "$MIGRATE_SCRIPT" prepare 2>&1)
EXIT_P3=$?
assert_test "Migrate Inv 3: Rejects mismatched service name" \
  "nonzero" "ERROR: Production deployment target mismatch" "$EXIT_P3" "$OUT_P3"

OUT_P4=$(PATH="$MOCK_BIN:$PATH" RAZORPAY_MODE="test" "$MIGRATE_SCRIPT" prepare 2>&1)
EXIT_P4=$?
assert_test "Migrate Inv 4: Rejects non-live RAZORPAY_MODE" \
  "nonzero" "ERROR: Invalid ambient RAZORPAY_MODE" "$EXIT_P4" "$OUT_P4"

OUT_P4B=$(PATH="$MOCK_BIN:$PATH" "$MIGRATE_SCRIPT" prepare 2>&1)
EXIT_P4B=$?
assert_test "Migrate Inv 4b: Rejects missing image digest (stale fallback forbidden)" \
  "nonzero" "ERROR: Missing required immutable image digest" "$EXIT_P4B" "$OUT_P4B"

OUT_P4C=$(PATH="$MOCK_BIN:$PATH" "$MIGRATE_SCRIPT" prepare --digest="us-west1-docker.pkg.dev/wrong-project/wrong/echonote@sha256:ca1549df6662f01d7c489ed8ebdc536b0044c51ee55aa4d314e5522a9cd8820c" 2>&1)
EXIT_P4C=$?
assert_test "Migrate Inv 4c: Rejects image URI with wrong Artifact Registry repository" \
  "nonzero" "ERROR: Image repository mismatch" "$EXIT_P4C" "$OUT_P4C"

OUT_P5=$(PATH="$MOCK_BIN:$PATH" "$MIGRATE_SCRIPT" prepare --digest="latest" 2>&1)
EXIT_P5=$?
assert_test "Migrate Inv 5: Rejects mutable 'latest' tag" \
  "nonzero" "ERROR: Mutable 'latest' tag is strictly forbidden" "$EXIT_P5" "$OUT_P5"

OUT_P6=$(PATH="$MOCK_BIN:$PATH" "$MIGRATE_SCRIPT" prepare --digest="sha256:invalid" 2>&1)
EXIT_P6=$?
assert_test "Migrate Inv 6: Rejects malformed image digest format" \
  "nonzero" "ERROR: Invalid image digest format" "$EXIT_P6" "$OUT_P6"

VALID_TEST_DIGEST="sha256:ca1549df6662f01d7c489ed8ebdc536b0044c51ee55aa4d314e5522a9cd8820c"

# ----------------------------------------------------------------------------
# 2. Pre-flight Checks
# ----------------------------------------------------------------------------
setup_mock_npm 1 0
OUT_LINT=$(PATH="$MOCK_BIN:$PATH" "$MIGRATE_SCRIPT" prepare --digest="$VALID_TEST_DIGEST" 2>&1)
EXIT_LINT=$?
assert_test "Migrate Inv 7: Aborts if npm run lint fails" \
  "nonzero" "ERROR: Pre-flight failed at 'npm run lint'" "$EXIT_LINT" "$OUT_LINT"

setup_mock_npm 0 1
OUT_BUILD=$(PATH="$MOCK_BIN:$PATH" "$MIGRATE_SCRIPT" prepare --digest="$VALID_TEST_DIGEST" 2>&1)
EXIT_BUILD=$?
assert_test "Migrate Inv 8: Aborts if npm run build fails" \
  "nonzero" "ERROR: Pre-flight failed at 'npm run build'" "$EXIT_BUILD" "$OUT_BUILD"

setup_mock_npm 0 0

# ----------------------------------------------------------------------------
# 3. Dry-Run Execution
# ----------------------------------------------------------------------------
OUT_DRY=$(PATH="$MOCK_BIN:$PATH" DRY_RUN=1 "$MIGRATE_SCRIPT" prepare --digest="$VALID_TEST_DIGEST" 2>&1)
EXIT_DRY=$?
assert_test "Migrate Inv 9: DRY_RUN=1 succeeds and validates transformation" \
  "0" "DRY RUN: Manifest transformation and validations passed" "$EXIT_DRY" "$OUT_DRY"
assert_absent "Migrate Inv 9b: DRY_RUN does NOT invoke remote services replace" \
  "MOCK_GCLOUD_SERVICES_REPLACE_INVOKED" "$OUT_DRY"

# ----------------------------------------------------------------------------
# 4. Successful Declarative Preparation Workflow
# ----------------------------------------------------------------------------
setup_mock_gcloud "echonote-2509" "echonote-00009-w5m 100" "echonote-00010-xyz" "True"
OUT_SUCCESS=$(PATH="$MOCK_BIN:$PATH" "$MIGRATE_SCRIPT" prepare --digest="$VALID_TEST_DIGEST" 2>&1)
EXIT_SUCCESS=$?
assert_test "Migrate Inv 10: Successful prepare invokes services replace" \
  "0" "MOCK_GCLOUD_SERVICES_REPLACE_INVOKED: run services replace" "$EXIT_SUCCESS" "$OUT_SUCCESS"
assert_test "Migrate Inv 10a: Strips stale run.googleapis.com/sources annotation" \
  "0" "MOCK_SOURCE_ANNOTATION_STRIPPED" "$EXIT_SUCCESS" "$OUT_SUCCESS"
assert_test "Migrate Inv 11: Confirms verified revision is Ready" \
  "0" "Verified Revision:        echonote-00010-xyz (Ready: True" "$EXIT_SUCCESS" "$OUT_SUCCESS"
assert_test "Migrate Inv 12: Confirms 100% traffic remains safely on baseline revision" \
  "0" "Current Serving Traffic:  100% safely on echonote-00009-w5m" "$EXIT_SUCCESS" "$OUT_SUCCESS"
assert_test "Migrate Inv 13: Confirms new revision has 0% traffic" \
  "0" "New Revision Traffic:     0%" "$EXIT_SUCCESS" "$OUT_SUCCESS"
assert_test "Migrate Inv 14: Instructs operator with explicit promote command" \
  "0" "./scripts/migrate-cloud-run-declarative.sh promote echonote-00010-xyz" "$EXIT_SUCCESS" "$OUT_SUCCESS"
assert_absent "Migrate Inv 15: Prepare does NOT automatically shift traffic" \
  "MOCK_GCLOUD_SERVICES_UPDATE_TRAFFIC_INVOKED" "$OUT_SUCCESS"

# ----------------------------------------------------------------------------
# 5. Safety Failure Cases: Readiness and Digest Checks
# ----------------------------------------------------------------------------
# Readiness condition is False
setup_mock_gcloud "echonote-2509" "echonote-00009-w5m 100" "echonote-00010-xyz" "False"
OUT_UNREADY=$(PATH="$MOCK_BIN:$PATH" "$MIGRATE_SCRIPT" prepare --digest="$VALID_TEST_DIGEST" 2>&1)
EXIT_UNREADY=$?
assert_test "Migrate Inv 16: Aborts if new revision fails health check (Ready != True)" \
  "nonzero" "failed health check (Ready: 'False')" "$EXIT_UNREADY" "$OUT_UNREADY"
assert_absent "Migrate Inv 16b: No traffic shift if revision unready" \
  "MOCK_GCLOUD_SERVICES_UPDATE_TRAFFIC_INVOKED" "$OUT_UNREADY"

# Image digest mismatch
setup_mock_gcloud "echonote-2509" "echonote-00009-w5m 100" "echonote-00010-xyz" "True" "us-west1-docker.pkg.dev/echonote-2509/echonote/echonote@sha256:mismatch000000000000000000000000000000000000000000000000000000000"
OUT_MISMATCH=$(PATH="$MOCK_BIN:$PATH" "$MIGRATE_SCRIPT" prepare --digest="$VALID_TEST_DIGEST" 2>&1)
EXIT_MISMATCH=$?
assert_test "Migrate Inv 17: Aborts if new revision container image digest mismatches" \
  "nonzero" "image verification failed" "$EXIT_MISMATCH" "$OUT_MISMATCH"
assert_absent "Migrate Inv 17b: No traffic shift on image digest mismatch" \
  "MOCK_GCLOUD_SERVICES_UPDATE_TRAFFIC_INVOKED" "$OUT_MISMATCH"

# Premature traffic shift detection
setup_mock_gcloud "echonote-2509" "echonote-00010-xyz 100" "echonote-00010-xyz" "True"
OUT_TRAFFIC_ERR=$(PATH="$MOCK_BIN:$PATH" "$MIGRATE_SCRIPT" prepare --digest="$VALID_TEST_DIGEST" 2>&1)
EXIT_TRAFFIC_ERR=$?
assert_test "Migrate Inv 18: Alerts and aborts if traffic shifted prematurely" \
  "nonzero" "CRITICAL SAFETY ALERT: Traffic allocation mismatch" "$EXIT_TRAFFIC_ERR" "$OUT_TRAFFIC_ERR"

# ----------------------------------------------------------------------------
# 6. Separate Explicit Traffic Promotion Action
# ----------------------------------------------------------------------------
setup_mock_gcloud "echonote-2509" "echonote-00009-w5m 100" "echonote-00010-xyz" "True"
OUT_PROMOTE=$(PATH="$MOCK_BIN:$PATH" "$MIGRATE_SCRIPT" promote "echonote-00010-xyz" 2>&1)
EXIT_PROMOTE=$?
assert_test "Migrate Inv 19: Promote action routes 100% traffic to verified revision" \
  "0" "MOCK_GCLOUD_SERVICES_UPDATE_TRAFFIC_INVOKED: run services update-traffic echonote --to-revisions=echonote-00010-xyz=100" "$EXIT_PROMOTE" "$OUT_PROMOTE"
assert_test "Migrate Inv 20: Promotion reports success confirmation" \
  "0" "100% production traffic successfully routed to echonote-00010-xyz" "$EXIT_PROMOTE" "$OUT_PROMOTE"

# Promote rejects unready revision
setup_mock_gcloud "echonote-2509" "echonote-00009-w5m 100" "echonote-00010-xyz" "False"
OUT_PROMOTE_UNREADY=$(PATH="$MOCK_BIN:$PATH" "$MIGRATE_SCRIPT" promote "echonote-00010-xyz" 2>&1)
EXIT_PROMOTE_UNREADY=$?
assert_test "Migrate Inv 21: Promote rejects revision that is NOT Ready" \
  "nonzero" "is NOT Ready (status: 'False')" "$EXIT_PROMOTE_UNREADY" "$OUT_PROMOTE_UNREADY"

# ----------------------------------------------------------------------------
# 7. Integration with deploy-cloud-run.sh
# ----------------------------------------------------------------------------
setup_mock_gcloud "echonote-2509" "echonote-00009-w5m 100" "echonote-00010-xyz" "True"
OUT_DEPLOY_DEEP=$(PATH="$MOCK_BIN:$PATH" DRY_RUN=1 "$DEPLOY_SCRIPT" declarative-prepare --digest="$VALID_TEST_DIGEST" 2>&1)
EXIT_DEPLOY_DEEP=$?
assert_test "Migrate Inv 22: deploy-cloud-run.sh declarative-prepare integrates smoothly" \
  "0" "DRY RUN: Manifest transformation and validations passed" "$EXIT_DEPLOY_DEEP" "$OUT_DEPLOY_DEEP"

OUT_DEPLOY_PROMOTE=$(PATH="$MOCK_BIN:$PATH" DRY_RUN=1 "$DEPLOY_SCRIPT" promote-traffic "echonote-00010-xyz" 2>&1)
EXIT_DEPLOY_PROMOTE=$?
assert_test "Migrate Inv 23: deploy-cloud-run.sh promote-traffic integrates smoothly" \
  "0" "DRY RUN: Target revision verification passed" "$EXIT_DEPLOY_PROMOTE" "$OUT_DEPLOY_PROMOTE"

# ----------------------------------------------------------------------------
# 8. Secret Redaction & Leak Check
# ----------------------------------------------------------------------------
assert_absent "Migrate Inv 24a: No plaintext Gemini secret leaked in logs" "old_plaintext_key" "$OUT_SUCCESS"
assert_absent "Migrate Inv 24b: No plaintext Gemini secret leaked in promote logs" "old_plaintext_key" "$OUT_PROMOTE"

echo "======================================================================"
echo "TEST RESULTS SUMMARY: $PASSED_COUNT PASSED, $FAILED_COUNT FAILED"
echo "======================================================================"

if [ "$FAILED_COUNT" -gt 0 ]; then
  exit 1
fi
exit 0
