#!/usr/bin/env bash
# ==============================================================================
# EchoNote Independent Production Service ("echonote-prod") Migration Safety Tests
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
INDEPENDENT_SCRIPT="$PROJECT_ROOT/scripts/migrate-cloud-run-independent.sh"
MIGRATE_SCRIPT="$PROJECT_ROOT/scripts/migrate-cloud-run-declarative.sh"
DEPLOY_SCRIPT="$PROJECT_ROOT/scripts/deploy-cloud-run.sh"
chmod +x "$MIGRATE_SCRIPT" "$DEPLOY_SCRIPT" "$INDEPENDENT_SCRIPT"

PASSED_COUNT=0
FAILED_COUNT=0

VALID_TEST_DIGEST="sha256:ca1549df6662f01d7c489ed8ebdc536b0044c51ee55aa4d314e5522a9cd8820c"

echo "======================================================================"
echo "🚀 RUNNING ECHONOTE INDEPENDENT PRODUCTION SERVICE (echonote-prod) TESTS"
echo "======================================================================"

assert_test() {
  local test_name="$1"
  local expected_exit="$2"
  local expected_needle="$3"
  local actual_exit="$4"
  local actual_output="$5"

  local exit_ok=0
  if [ "$expected_exit" = "0" ] && [ "$actual_exit" -eq 0 ]; then
    exit_ok=1
  elif [ "$expected_exit" = "nonzero" ] && [ "$actual_exit" -ne 0 ]; then
    exit_ok=1
  fi

  local output_ok=0
  if echo "$actual_output" | grep -F -q "$expected_needle"; then
    output_ok=1
  fi

  if [ "$exit_ok" -eq 1 ] && [ "$output_ok" -eq 1 ]; then
    echo "  ✅ $test_name ... PASSED"
    PASSED_COUNT=$((PASSED_COUNT + 1))
  else
    echo "  ❌ $test_name ... FAILED"
    [ "$exit_ok" -eq 0 ] && echo "     Expected exit: $expected_exit, Got: $actual_exit"
    [ "$output_ok" -eq 0 ] && echo "     Missing needle in output: $expected_needle"
    echo "     Actual Output was: $actual_output"
    FAILED_COUNT=$((FAILED_COUNT + 1))
  fi
}

assert_absent() {
  local test_name="$1"
  local forbidden_needle="$2"
  local actual_output="$3"

  if echo "$actual_output" | grep -F -q "$forbidden_needle"; then
    echo "  ❌ $test_name ... FAILED (forbidden string '$forbidden_needle' found in output)"
    FAILED_COUNT=$((FAILED_COUNT + 1))
  else
    echo "  ✅ $test_name ... PASSED"
    PASSED_COUNT=$((PASSED_COUNT + 1))
  fi
}

# ----------------------------------------------------------------------------
# Setup Mock Environment
# ----------------------------------------------------------------------------
MOCK_DIR="$(mktemp -d)"
MOCK_BIN="$MOCK_DIR/bin"
mkdir -p "$MOCK_BIN"
trap 'rm -rf "$MOCK_DIR"' EXIT

REAL_NPM="$(command -v npm)"

setup_mock_npm() {
  cat << 'EOF' > "$MOCK_BIN/npm"
#!/usr/bin/env bash
if [ "$1" = "run" ] && [ "$2" = "lint" ]; then
  echo "Mock lint passed"
  exit 0
fi
if [ "$1" = "run" ] && [ "$2" = "build" ]; then
  echo "Mock build passed"
  exit 0
fi
exec "$REAL_NPM" "$@"
EOF
  chmod +x "$MOCK_BIN/npm"
}

setup_mock_gcloud() {
  local project_val="${1:-echonote-2509}"
  local legacy_traffic="${2:-echonote-00009-w5m 100}"
  local prod_traffic="${3:-echonote-prod-00001-xyz 100}"
  local new_rev="${4:-echonote-prod-00002-abc}"
  local is_ready="${5:-True}"
  local image_digest="${6:-$VALID_TEST_DIGEST}"

  cat << 'EOF' > "$MOCK_BIN/gcloud"
#!/usr/bin/env bash
cmd="$*"

if [ "$1" = "config" ] && [ "$2" = "get-value" ]; then
  echo "$MOCK_GCLOUD_PROJECT"
  exit 0
fi

if [ "$1" = "run" ] && [ "$2" = "services" ] && [ "$3" = "describe" ]; then
  service="$4"
  if echo "$cmd" | grep -q "format=export"; then
    cat << MANIFEST_EOF
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: $service
  namespace: echonote-2509
  annotations:
    run.googleapis.com/client-name: gcloud
    run.googleapis.com/sources: gs://stale-bucket/stale.tar.gz
spec:
  template:
    metadata:
      name: ${service}-00001-old
      annotations:
        run.googleapis.com/execution-environment: gen2
        run.googleapis.com/sources: gs://stale-bucket/stale.tar.gz
    spec:
      serviceAccountName: 200551109142-compute@developer.gserviceaccount.com
      containers:
      - image: us-west1-docker.pkg.dev/echonote-2509/echonote/echonote@sha256:olddigest000000000000000000000000000000000000000000000000000000000
        ports:
        - containerPort: 3000
        env:
        - name: RAZORPAY_MODE
          value: live
        - name: NODE_ENV
          value: production
        - name: APP_URL
          value: https://echonote-25.ai.studio
        - name: GEMINI_API_KEY
          value: old_plaintext_key
        - name: RAZORPAY_KEY_SECRET
          value: old_plaintext_secret
MANIFEST_EOF
    exit 0
  fi

  if echo "$cmd" | grep -q "status.traffic"; then
    if [ "$service" = "echonote" ]; then
      echo "$MOCK_LEGACY_TRAFFIC"
    else
      if echo "$cmd" | grep -q "percent"; then
        echo "$MOCK_PROD_TRAFFIC"
      else
        echo "$MOCK_PROD_TRAFFIC" | cut -d' ' -f1
      fi
    fi
    exit 0
  fi

  if echo "$cmd" | grep -q "status.latestCreatedRevisionName"; then
    echo "$MOCK_NEW_REV"
    exit 0
  fi

  if echo "$cmd" | grep -q "status.latestReadyRevisionName"; then
    echo "$MOCK_PROD_TRAFFIC" | cut -d' ' -f1
    exit 0
  fi
fi

if [ "$1" = "run" ] && [ "$2" = "revisions" ] && [ "$3" = "describe" ]; then
  if echo "$cmd" | grep -q "status.conditions"; then
    echo "$MOCK_IS_READY"
    exit 0
  fi
  if echo "$cmd" | grep -q "spec.containers\[0\].image"; then
    echo "us-west1-docker.pkg.dev/echonote-2509/echonote/echonote@$MOCK_IMAGE_DIGEST"
    exit 0
  fi
fi

if [ "$1" = "run" ] && [ "$2" = "services" ] && [ "$3" = "replace" ]; then
  echo "MOCK_GCLOUD_SERVICES_REPLACE_INVOKED: $cmd"
  exit 0
fi

if [ "$1" = "run" ] && [ "$2" = "services" ] && [ "$3" = "update-traffic" ]; then
  echo "MOCK_GCLOUD_SERVICES_UPDATE_TRAFFIC_INVOKED: $cmd"
  exit 0
fi

echo "MOCK_GCLOUD_UNRECOGNIZED: $cmd" >&2
exit 1
EOF
  chmod +x "$MOCK_BIN/gcloud"

  setup_mock_npm
  export MOCK_GCLOUD_PROJECT="$project_val"
  export MOCK_LEGACY_TRAFFIC="$legacy_traffic"
  export MOCK_PROD_TRAFFIC="$prod_traffic"
  export MOCK_NEW_REV="$new_rev"
  export MOCK_IS_READY="$is_ready"
  export MOCK_IMAGE_DIGEST="$image_digest"
}

export RAZORPAY_KEY_ID="rzp_live_mockdummykey123"

# ----------------------------------------------------------------------------
# Test Suite: Target & Hard-Lock Validation
# ----------------------------------------------------------------------------
setup_mock_gcloud

# Test 1: Rejects arbitrary service name
OUT_BAD_SVC=$(PATH="$MOCK_BIN:$PATH" CLOUD_RUN_SERVICE="arbitrary-service" "$INDEPENDENT_SCRIPT" prepare 2>&1 || true)
assert_test "Independent Inv 1: Rejects arbitrary service name" \
  "nonzero" "service: echonote-prod" "1" "$OUT_BAD_SVC"

# Test 2: Rejects legacy echonote service as target
OUT_LEGACY_TARGET=$(PATH="$MOCK_BIN:$PATH" CLOUD_RUN_SERVICE="echonote" "$INDEPENDENT_SCRIPT" prepare 2>&1 || true)
assert_test "Independent Inv 2: Rejects legacy echonote service name" \
  "nonzero" "service: echonote-prod" "1" "$OUT_LEGACY_TARGET"

# Test 3: Rejects mismatched project
OUT_BAD_PROJ=$(PATH="$MOCK_BIN:$PATH" GOOGLE_CLOUD_PROJECT="other-project" "$INDEPENDENT_SCRIPT" prepare 2>&1 || true)
assert_test "Independent Inv 3: Rejects mismatched project ID" \
  "nonzero" "project: echonote-2509" "1" "$OUT_BAD_PROJ"

# Test 4: Rejects mismatched region
OUT_BAD_REG=$(PATH="$MOCK_BIN:$PATH" CLOUD_RUN_REGION="us-central1" "$INDEPENDENT_SCRIPT" prepare 2>&1 || true)
assert_test "Independent Inv 4: Rejects mismatched region" \
  "nonzero" "region:  us-west1" "1" "$OUT_BAD_REG"

# ----------------------------------------------------------------------------
# Test Suite: Guardrail for Legacy echonote Service
# ----------------------------------------------------------------------------

# Test 5: Aborts if legacy echonote service traffic is not 100% on echonote-00009-w5m
setup_mock_gcloud "echonote-2509" "echonote-00010-bad 100" "echonote-prod-00001-xyz 100"
OUT_LEGACY_DRIFT=$(PATH="$MOCK_BIN:$PATH" "$INDEPENDENT_SCRIPT" prepare 2>&1 || true)
assert_test "Independent Inv 5: Aborts if legacy echonote traffic drifted from echonote-00009-w5m" \
  "nonzero" "Legacy service 'echonote' is NOT locked to 100% traffic on echonote-00009-w5m" "1" "$OUT_LEGACY_DRIFT"

# ----------------------------------------------------------------------------
# Test Suite: Key & Mode Validation
# ----------------------------------------------------------------------------
setup_mock_gcloud

# Test 6: Rejects missing RAZORPAY_KEY_ID
OUT_NO_KEY=$(PATH="$MOCK_BIN:$PATH" RAZORPAY_KEY_ID="" "$INDEPENDENT_SCRIPT" prepare 2>&1 || true)
assert_test "Independent Inv 6: Rejects missing RAZORPAY_KEY_ID" \
  "nonzero" "ERROR: Missing required RAZORPAY_KEY_ID environment variable" "1" "$OUT_NO_KEY"

# Test 7: Rejects non-live RAZORPAY_MODE
OUT_NON_LIVE=$(PATH="$MOCK_BIN:$PATH" RAZORPAY_MODE="test" RAZORPAY_KEY_ID="rzp_test_123" "$INDEPENDENT_SCRIPT" prepare 2>&1 || true)
assert_test "Independent Inv 7: Rejects non-live RAZORPAY_MODE" \
  "nonzero" "Production requires RAZORPAY_MODE=live" "1" "$OUT_NON_LIVE"

# Test 8: Rejects test key in live mode
OUT_BAD_PREFIX=$(PATH="$MOCK_BIN:$PATH" RAZORPAY_MODE="live" RAZORPAY_KEY_ID="rzp_test_123" "$INDEPENDENT_SCRIPT" prepare 2>&1 || true)
assert_test "Independent Inv 8: Rejects rzp_test_ key in live mode" \
  "nonzero" "Invalid RAZORPAY_KEY_ID for mode 'live'" "1" "$OUT_BAD_PREFIX"

# ----------------------------------------------------------------------------
# Test Suite: Dry Run Preparation
# ----------------------------------------------------------------------------
setup_mock_gcloud
OUT_DRY=$(PATH="$MOCK_BIN:$PATH" DRY_RUN=1 "$INDEPENDENT_SCRIPT" prepare 2>&1)
EXIT_DRY=$?
assert_test "Independent Inv 9: DRY_RUN=1 succeeds and verifies echonote-prod" \
  "0" "DRY RUN: Manifest transformation and validations passed." "$EXIT_DRY" "$OUT_DRY"
assert_test "Independent Inv 10: Summary lists echonote-prod as target service" \
  "0" "Service Name:                echonote-prod" "$EXIT_DRY" "$OUT_DRY"
assert_test "Independent Inv 11: Summary lists legacy protected service" \
  "0" "Legacy Protected Service:    echonote (locked on echonote-00009-w5m)" "$EXIT_DRY" "$OUT_DRY"

# ----------------------------------------------------------------------------
# Test Suite: Remote Execution Replacement & Verification
# ----------------------------------------------------------------------------
setup_mock_gcloud
OUT_PREPARE=$(PATH="$MOCK_BIN:$PATH" "$INDEPENDENT_SCRIPT" prepare 2>&1)
EXIT_PREPARE=$?
assert_test "Independent Inv 12: Prepare executes gcloud replace targeting echonote-prod" \
  "0" "Executing Atomic Declarative Service Replacement" "$EXIT_PREPARE" "$OUT_PREPARE"
assert_test "Independent Inv 13: Replaces echonote-prod manifest" \
  "0" "Service: echonote-prod (Region: us-west1, Project: echonote-2509)" "$EXIT_PREPARE" "$OUT_PREPARE"
assert_test "Independent Inv 14: Confirms legacy service remained locked" \
  "0" "Legacy service 'echonote' traffic locked 100% on echonote-00009-w5m" "$EXIT_PREPARE" "$OUT_PREPARE"
assert_test "Independent Inv 15: Confirms verified revision is Ready" \
  "0" "Verified Revision:        echonote-prod-00002-abc (Ready: True" "$EXIT_PREPARE" "$OUT_PREPARE"

# ----------------------------------------------------------------------------
# Test Suite: Traffic Promotion
# ----------------------------------------------------------------------------
setup_mock_gcloud
OUT_PROMOTE=$(PATH="$MOCK_BIN:$PATH" "$INDEPENDENT_SCRIPT" promote "echonote-prod-00002-abc" 2>&1)
EXIT_PROMOTE=$?
assert_test "Independent Inv 16: Promote routes 100% traffic to verified revision on echonote-prod" \
  "0" "MOCK_GCLOUD_SERVICES_UPDATE_TRAFFIC_INVOKED: run services update-traffic echonote-prod --to-revisions=echonote-prod-00002-abc=100" "$EXIT_PROMOTE" "$OUT_PROMOTE"
assert_test "Independent Inv 17: Promotion re-verifies legacy echonote remains locked" \
  "0" "Legacy service 'echonote' traffic locked 100% on echonote-00009-w5m" "$EXIT_PROMOTE" "$OUT_PROMOTE"

# Test 18: Promote rejects unready revision
setup_mock_gcloud "echonote-2509" "echonote-00009-w5m 100" "echonote-prod-00001-xyz 100" "echonote-prod-00002-abc" "False"
OUT_PROMOTE_UNREADY=$(PATH="$MOCK_BIN:$PATH" "$INDEPENDENT_SCRIPT" promote "echonote-prod-00002-abc" 2>&1 || true)
assert_test "Independent Inv 18: Promote rejects revision that is NOT Ready" \
  "nonzero" "is NOT Ready (status: 'False')" "1" "$OUT_PROMOTE_UNREADY"

# ----------------------------------------------------------------------------
# Test Suite: Secret Redaction & Leak Check
# ----------------------------------------------------------------------------
assert_absent "Independent Inv 19: No plaintext secrets leaked in prepare logs" "old_plaintext_key" "$OUT_PREPARE"
assert_absent "Independent Inv 20: No plaintext secrets leaked in promote logs" "old_plaintext_key" "$OUT_PROMOTE"

# Test 21: Existing migrate-cloud-run-declarative.sh remains unchanged and passing
OUT_EXISTING=$(PATH="$MOCK_BIN:$PATH" DRY_RUN=1 "$MIGRATE_SCRIPT" prepare --digest="$VALID_TEST_DIGEST" 2>&1)
EXIT_EXISTING=$?
assert_test "Independent Inv 21: Existing migrate-cloud-run-declarative.sh behavior unchanged" \
  "0" "Service:                     echonote" "$EXIT_EXISTING" "$OUT_EXISTING"

echo "======================================================================"
echo "TEST RESULTS SUMMARY: $PASSED_COUNT PASSED, $FAILED_COUNT FAILED"
echo "======================================================================"

if [ "$FAILED_COUNT" -gt 0 ]; then
  exit 1
fi
exit 0
