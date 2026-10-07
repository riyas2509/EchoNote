#!/usr/bin/env bash
# ==============================================================================
# EchoNote Independent Cloud Run Production Migration
#
# Target:
#   Service: echonote-prod
#   Project: echonote-2509
#   Region:  us-west1
#
# This script MUST NOT modify the legacy AI Studio-managed "echonote" service.
# ==============================================================================

set -euo pipefail

readonly EXPECTED_PROJECT_ID="echonote-2509"
readonly EXPECTED_REGION="us-west1"
readonly EXPECTED_SERVICE_NAME="echonote-prod"
readonly PROTECTED_LEGACY_SERVICE_NAME="echonote"
readonly EXPECTED_SERVICE_ACCOUNT="200551109142-compute@developer.gserviceaccount.com"
readonly EXPECTED_ARTIFACT_REGISTRY="us-west1-docker.pkg.dev/echonote-2509/echonote/echonote"

SERVICE_NAME="$EXPECTED_SERVICE_NAME"
REGION="$EXPECTED_REGION"
PROJECT_ID="$EXPECTED_PROJECT_ID"

PLAN_PRO_MONTHLY="${RAZORPAY_PRO_MONTHLY_PLAN_ID-plan_TambUyuTkGL4zY}"
PLAN_PRO_YEARLY="${RAZORPAY_PRO_YEARLY_PLAN_ID-plan_Tamd1Ef89GKQNk}"
PLAN_TEAM_MONTHLY="${RAZORPAY_TEAM_MONTHLY_PLAN_ID-plan_TamdizBJ9W7kJo}"
PLAN_TEAM_YEARLY="${RAZORPAY_TEAM_YEARLY_PLAN_ID-plan_TameI4cjPUzRpn}"

ACTION="${1:-prepare}"

validate_target() {
  if [ "$SERVICE_NAME" != "$EXPECTED_SERVICE_NAME" ]; then
    echo "ERROR: Independent deployment target mismatch." >&2
    exit 1
  fi

  if [ "$SERVICE_NAME" = "$PROTECTED_LEGACY_SERVICE_NAME" ]; then
    echo "ERROR: Refusing to target protected legacy service '$PROTECTED_LEGACY_SERVICE_NAME'." >&2
    exit 1
  fi

  if [ "$PROJECT_ID" != "$EXPECTED_PROJECT_ID" ]; then
    echo "ERROR: Project mismatch." >&2
    exit 1
  fi

  if [ "$REGION" != "$EXPECTED_REGION" ]; then
    echo "ERROR: Region mismatch." >&2
    exit 1
  fi
}

validate_active_gcloud_project() {
  local active_proj
  active_proj="$(gcloud config get-value project 2>/dev/null || true)"

  if [ "$active_proj" != "$EXPECTED_PROJECT_ID" ]; then
    echo "ERROR: Active gcloud project mismatch." >&2
    echo "Expected: $EXPECTED_PROJECT_ID" >&2
    echo "Actual:   $active_proj" >&2
    exit 1
  fi
}

validate_plan_ids() {
  local regex='^plan_[A-Za-z0-9]+$'

  for value in \
    "$PLAN_PRO_MONTHLY" \
    "$PLAN_PRO_YEARLY" \
    "$PLAN_TEAM_MONTHLY" \
    "$PLAN_TEAM_YEARLY"
  do
    if ! [[ "$value" =~ $regex ]]; then
      echo "ERROR: Invalid Razorpay plan ID." >&2
      exit 1
    fi
  done
}

validate_razorpay_mode() {
  if [ -n "${RAZORPAY_MODE:-}" ] && [ "$RAZORPAY_MODE" != "live" ]; then
    echo "ERROR: Production requires RAZORPAY_MODE=live." >&2
    exit 1
  fi
}

validate_razorpay_key_id() {
  if [ -z "${RAZORPAY_KEY_ID:-}" ]; then
    echo "ERROR: RAZORPAY_KEY_ID is not set. Aborting production deployment." >&2
    exit 1
  fi
}

resolve_digest() {
  local raw="${IMAGE_DIGEST:-}"

  for arg in "$@"; do
    if [[ "$arg" == --digest=* ]]; then
      raw="${arg#--digest=}"
    fi
  done

  if [ -z "$raw" ]; then
    echo "ERROR: Explicit immutable image digest required." >&2
    exit 1
  fi

  if [[ "$raw" == *"@"* ]]; then
    local repo="${raw%@*}"
    raw="${raw#*@}"

    if [ "$repo" != "$EXPECTED_ARTIFACT_REGISTRY" ]; then
      echo "ERROR: Image repository mismatch." >&2
      exit 1
    fi
  fi

  if ! [[ "$raw" =~ ^sha256:[a-f0-9]{64}$ ]]; then
    echo "ERROR: Invalid immutable image digest." >&2
    exit 1
  fi

  echo "$raw"
}

resolve_current_revision() {
  gcloud run services describe "$SERVICE_NAME" \
    --project="$PROJECT_ID" \
    --region="$REGION" \
    --format='value(status.latestReadyRevisionName)'
}



verify_revision_belongs_to_service() {
  local revision="$1"
  local revision_service

  revision_service="$(gcloud run revisions describe "$revision" \
    --project="$PROJECT_ID" \
    --region="$REGION" \
    --format='value(metadata.labels[serving.knative.dev/service])' \
    2>/dev/null || true)"

  if [ "$revision_service" != "$SERVICE_NAME" ]; then
    echo "ERROR: Target revision does not belong to $SERVICE_NAME." >&2
    echo "Revision: $revision" >&2
    echo "Detected service: ${revision_service:-unknown}" >&2
    exit 1
  fi
}

verify_independent_service_traffic() {
  local expected_revision="$1"
  local traffic

  traffic="$(gcloud run services describe "$SERVICE_NAME" \
    --project="$PROJECT_ID" \
    --region="$REGION" \
    --format='value(status.traffic[0].revisionName,status.traffic[0].percent)' \
    2>/dev/null || true)"

  echo "Independent service traffic: $traffic"

  if [[ "$traffic" != *"$expected_revision"* ]] || [[ "$traffic" != *"100"* ]]; then
    echo "ERROR: Independent service traffic changed unexpectedly." >&2
    echo "Expected 100% traffic on baseline revision: $expected_revision" >&2
    exit 1
  fi
}

verify_legacy_service_untouched() {
  local traffic

  traffic="$(gcloud run services describe "$PROTECTED_LEGACY_SERVICE_NAME" \
    --project="$PROJECT_ID" \
    --region="$REGION" \
    --format='value(status.traffic[0].revisionName,status.traffic[0].percent)' \
    2>/dev/null || true)"

  echo "Legacy service traffic: $traffic"

  if [[ "$traffic" != *"echonote-00009-w5m"* ]] || [[ "$traffic" != *"100"* ]]; then
    echo "ERROR: Legacy production service is not safely on expected baseline." >&2
    exit 1
  fi
}

case "$ACTION" in

  prepare)
    validate_target
    validate_active_gcloud_project
    validate_plan_ids
    validate_razorpay_mode
    validate_razorpay_key_id
    verify_legacy_service_untouched

    DIGEST="$(resolve_digest "$@")"
    BASELINE_REVISION="$(resolve_current_revision)"

    if [ -z "$BASELINE_REVISION" ]; then
      echo "ERROR: Could not resolve current ready revision of $SERVICE_NAME." >&2
      exit 1
    fi

    echo "======================================================================"
    echo "EchoNote Independent Cloud Run Deployment"
    echo "======================================================================"
    echo "Project:          $PROJECT_ID"
    echo "Region:           $REGION"
    echo "Service:          $SERVICE_NAME"
    echo "Baseline:         $BASELINE_REVISION"
    echo "Image digest:     $DIGEST"
    echo "Legacy service:   PROTECTED"
    echo "======================================================================"

    TMP_DIR="$(mktemp -d)"
    chmod 700 "$TMP_DIR"
    trap 'rm -rf "$TMP_DIR"' EXIT INT TERM

    EXPORTED_YAML="$TMP_DIR/service-exported.yaml"
    DESIRED_YAML="$TMP_DIR/service-desired.yaml"

    gcloud run services describe "$SERVICE_NAME" \
      --project="$PROJECT_ID" \
      --region="$REGION" \
      --format=export > "$EXPORTED_YAML"

    RAZORPAY_KEY_ID="${RAZORPAY_KEY_ID:-}" \
    RAZORPAY_PRO_MONTHLY_PLAN_ID="$PLAN_PRO_MONTHLY" \
    RAZORPAY_PRO_YEARLY_PLAN_ID="$PLAN_PRO_YEARLY" \
    RAZORPAY_TEAM_MONTHLY_PLAN_ID="$PLAN_TEAM_MONTHLY" \
    RAZORPAY_TEAM_YEARLY_PLAN_ID="$PLAN_TEAM_YEARLY" \
    npx tsx scripts/prepare-declarative-service.ts \
      --input="$EXPORTED_YAML" \
      --output="$DESIRED_YAML" \
      --digest="$DIGEST" \
      --serving-revision="$BASELINE_REVISION" \
      --service-name="$SERVICE_NAME"

    if [ ! -s "$DESIRED_YAML" ]; then
      echo "ERROR: Generated manifest is missing or empty." >&2
      exit 1
    fi

    if [ "${DRY_RUN:-0}" = "1" ]; then
      echo "DRY RUN PASSED."
      exit 0
    fi

    gcloud run services replace "$DESIRED_YAML" \
      --project="$PROJECT_ID" \
      --region="$REGION"

    verify_independent_service_traffic "$BASELINE_REVISION"

    NEW_REVISION="$(gcloud run services describe "$SERVICE_NAME" \
      --project="$PROJECT_ID" \
      --region="$REGION" \
      --format='value(status.latestCreatedRevisionName)')"

    echo "Created revision: $NEW_REVISION"

    IS_READY="$(gcloud run revisions describe "$NEW_REVISION" \
      --project="$PROJECT_ID" \
      --region="$REGION" \
      --format='value(status.conditions[0].status)' 2>/dev/null || true)"

    if [ "$IS_READY" != "True" ]; then
      echo "ERROR: New revision is not Ready." >&2
      echo "Legacy production service remains untouched." >&2
      exit 1
    fi

    REVISION_IMAGE="$(gcloud run revisions describe "$NEW_REVISION" \
      --project="$PROJECT_ID" \
      --region="$REGION" \
      --format='value(spec.containers[0].image)')"

    if [[ "$REVISION_IMAGE" != *"$DIGEST"* ]]; then
      echo "ERROR: Immutable image digest verification failed." >&2
      exit 1
    fi

    echo "======================================================================"
    echo "READY: $NEW_REVISION"
    echo "Digest verified: $DIGEST"
    echo "Legacy production service remains untouched."
    echo "======================================================================"

    ;;

  promote)
    validate_target
    validate_active_gcloud_project
    verify_legacy_service_untouched

    TARGET_REVISION="${2:-}"

    if [ -z "$TARGET_REVISION" ]; then
      echo "ERROR: Missing target revision." >&2
      exit 1
    fi

    verify_revision_belongs_to_service "$TARGET_REVISION"

    IS_READY="$(gcloud run revisions describe "$TARGET_REVISION" \
      --project="$PROJECT_ID" \
      --region="$REGION" \
      --format='value(status.conditions[0].status)' 2>/dev/null || true)"

    if [ "$IS_READY" != "True" ]; then
      echo "ERROR: Target revision is not Ready." >&2
      exit 1
    fi

    gcloud run services update-traffic "$SERVICE_NAME" \
      --to-revisions="$TARGET_REVISION=100" \
      --project="$PROJECT_ID" \
      --region="$REGION"

    echo "100% traffic routed to $TARGET_REVISION."
    ;;

  verify)
    BACKEND_URL="${2:-}"

    if [ -z "$BACKEND_URL" ]; then
      echo "Usage: $0 verify <URL>" >&2
      exit 1
    fi

    curl -fsS "$BACKEND_URL/api/health"
    echo
    curl -fsS "$BACKEND_URL/api/payment/config-status"
    echo

    verify_legacy_service_untouched
    ;;

  *)
    echo "Usage:"
    echo "  $0 prepare --digest=sha256:..."
    echo "  $0 promote <REVISION>"
    echo "  $0 verify <URL>"
    exit 1
    ;;
esac
