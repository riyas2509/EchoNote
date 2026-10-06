#!/usr/bin/env bash
# ==============================================================================
# EchoNote Safe Declarative Cloud Run Migration Script (Step 6M-I)
# ==============================================================================
# Resolves the Cloud Run environment-variable type conflict by executing
# an atomic declarative desired-state migration (gcloud run services replace).
#
# Key Guardrails:
# 1. Pinned immutable image digest (rejects mutable tags).
# 2. Hard-locked target constants (project, region, service, service account).
# 3. 100% production traffic remains on baseline revision (echonote-00009-w5m)
#    during creation, inspection, and verification of the new revision.
# 4. Explicit verification of traffic, revision readiness, and image digest.
# 5. Zero plaintext secrets in logs or stored files (temporary files in 0700 tmpdir,
#    cleaned up on EXIT).
# 6. Separate explicit action required to promote traffic (promote <REVISION>).
#
# Usage:
#   chmod +x scripts/migrate-cloud-run-declarative.sh
#   ./scripts/migrate-cloud-run-declarative.sh prepare [--digest=sha256:...]
#   ./scripts/migrate-cloud-run-declarative.sh promote <REVISION_NAME>
#   ./scripts/migrate-cloud-run-declarative.sh verify <URL>
# ==============================================================================

set -euo pipefail

# Production Hard-Locked Target Constants
readonly EXPECTED_PROJECT_ID="echonote-2509"
readonly EXPECTED_REGION="us-west1"
readonly EXPECTED_SERVICE_NAME="echonote"
readonly EXPECTED_SERVICE_ACCOUNT="200551109142-compute@developer.gserviceaccount.com"
readonly EXPECTED_ARTIFACT_REGISTRY="us-west1-docker.pkg.dev/echonote-2509/echonote/echonote"
readonly CURRENT_SERVING_PROD_REVISION="echonote-00009-w5m"
readonly LAST_KNOWN_PROD_REVISION="echonote-00008-lw9"

# Default pinned immutable image digest for Step 6M-I
readonly DEFAULT_IMMUTABLE_DIGEST="sha256:ca1549df6662f01d7c489ed8ebdc536b0044c51ee55aa4d314e5522a9cd8820c"

# Target variables (strictly validated against production constants)
SERVICE_NAME="${CLOUD_RUN_SERVICE:-$EXPECTED_SERVICE_NAME}"
REGION="${CLOUD_RUN_REGION:-$EXPECTED_REGION}"
PROJECT_ID="${GOOGLE_CLOUD_PROJECT:-$EXPECTED_PROJECT_ID}"

# Plan IDs configured for EchoNote
PLAN_PRO_MONTHLY="${RAZORPAY_PRO_MONTHLY_PLAN_ID-plan_TambUyuTkGL4zY}"
PLAN_PRO_YEARLY="${RAZORPAY_PRO_YEARLY_PLAN_ID-plan_Tamd1Ef89GKQNk}"
PLAN_TEAM_MONTHLY="${RAZORPAY_TEAM_MONTHLY_PLAN_ID-plan_TamdizBJ9W7kJo}"
PLAN_TEAM_YEARLY="${RAZORPAY_TEAM_YEARLY_PLAN_ID-plan_TameI4cjPUzRpn}"

# Razorpay Key ID for Cloud Run ordinary environment variable
RAZORPAY_KEY_ID="${RAZORPAY_KEY_ID:-}"

ACTION="${1:-prepare}"

# ------------------------------------------------------------------------------
# 1. Target Validation: Reject any mismatch with production constants
# ------------------------------------------------------------------------------
validate_target() {
  if [ "$PROJECT_ID" != "$EXPECTED_PROJECT_ID" ] || \
     [ "$REGION" != "$EXPECTED_REGION" ] || \
     [ "$SERVICE_NAME" != "$EXPECTED_SERVICE_NAME" ]; then
    echo "ERROR: Production deployment target mismatch." >&2
    echo "Expected:" >&2
    echo "  project: $EXPECTED_PROJECT_ID" >&2
    echo "  region:  $EXPECTED_REGION" >&2
    echo "  service: $EXPECTED_SERVICE_NAME" >&2
    echo "Received:" >&2
    echo "  project: $PROJECT_ID" >&2
    echo "  region:  $REGION" >&2
    echo "  service: $SERVICE_NAME" >&2
    exit 1
  fi
}

# ------------------------------------------------------------------------------
# 2. Active gcloud Project Verification
# ------------------------------------------------------------------------------
validate_active_gcloud_project() {
  if ! command -v gcloud &>/dev/null; then
    echo "ERROR: gcloud CLI is required but not found in PATH." >&2
    exit 1
  fi

  local active_proj
  active_proj="$(gcloud config get-value project 2>/dev/null || true)"
  if [ -z "$active_proj" ] || [ "$active_proj" = "(unset)" ]; then
    echo "ERROR: Active gcloud project is not set." >&2
    echo "Expected project: $EXPECTED_PROJECT_ID" >&2
    echo "Please set active project using: gcloud config set project $EXPECTED_PROJECT_ID" >&2
    exit 1
  fi

  if [ "$active_proj" != "$EXPECTED_PROJECT_ID" ]; then
    echo "ERROR: Active gcloud project mismatch." >&2
    echo "Active project:   '$active_proj'" >&2
    echo "Expected project: '$EXPECTED_PROJECT_ID'" >&2
    echo "Please switch your active gcloud project using:" >&2
    echo "  gcloud config set project $EXPECTED_PROJECT_ID" >&2
    exit 1
  fi
}

# ------------------------------------------------------------------------------
# 3. Plan IDs Validation
# ------------------------------------------------------------------------------
validate_plan_ids() {
  local regex='^plan_[A-Za-z0-9]+$'
  local has_error=0

  if [ -z "$PLAN_PRO_MONTHLY" ] || ! [[ "$PLAN_PRO_MONTHLY" =~ $regex ]]; then
    echo "ERROR: Invalid or missing RAZORPAY_PRO_MONTHLY_PLAN_ID." >&2
    has_error=1
  fi
  if [ -z "$PLAN_PRO_YEARLY" ] || ! [[ "$PLAN_PRO_YEARLY" =~ $regex ]]; then
    echo "ERROR: Invalid or missing RAZORPAY_PRO_YEARLY_PLAN_ID." >&2
    has_error=1
  fi
  if [ -z "$PLAN_TEAM_MONTHLY" ] || ! [[ "$PLAN_TEAM_MONTHLY" =~ $regex ]]; then
    echo "ERROR: Invalid or missing RAZORPAY_TEAM_MONTHLY_PLAN_ID." >&2
    has_error=1
  fi
  if [ -z "$PLAN_TEAM_YEARLY" ] || ! [[ "$PLAN_TEAM_YEARLY" =~ $regex ]]; then
    echo "ERROR: Invalid or missing RAZORPAY_TEAM_YEARLY_PLAN_ID." >&2
    has_error=1
  fi

  if [ "$has_error" -ne 0 ]; then
    echo "Declarative migration aborted due to invalid Razorpay plan ID(s)." >&2
    exit 1
  fi
}

# ------------------------------------------------------------------------------
# 4. Razorpay Mode Validation
# ------------------------------------------------------------------------------
validate_razorpay_mode() {
  if [ -n "${RAZORPAY_MODE:-}" ] && [ "$RAZORPAY_MODE" != "live" ]; then
    echo "ERROR: Invalid ambient RAZORPAY_MODE='$RAZORPAY_MODE'. Production requires RAZORPAY_MODE=live." >&2
    exit 1
  fi
}

# ------------------------------------------------------------------------------
# 4b. Razorpay Key ID Validation
# ------------------------------------------------------------------------------
validate_razorpay_key_id() {
  if [ -z "$RAZORPAY_KEY_ID" ]; then
    echo "ERROR: Missing required RAZORPAY_KEY_ID environment variable." >&2
    exit 1
  fi

  local mode="${RAZORPAY_MODE:-live}"
  if [ "$mode" = "live" ] && ! [[ "$RAZORPAY_KEY_ID" == rzp_live_* ]]; then
    echo "ERROR: Invalid RAZORPAY_KEY_ID for mode 'live': must start with 'rzp_live_'." >&2
    exit 1
  fi

  if [ "$mode" = "test" ] && ! [[ "$RAZORPAY_KEY_ID" == rzp_test_* ]]; then
    echo "ERROR: Invalid RAZORPAY_KEY_ID for mode 'test': must start with 'rzp_test_'." >&2
    exit 1
  fi
}

# ------------------------------------------------------------------------------
# 5. Resolve & Validate Immutable Image Digest
# ------------------------------------------------------------------------------
resolve_digest() {
  local raw_input="${IMAGE_DIGEST:-}"

  # Check command-line arguments for --digest=...
  for arg in "$@"; do
    if [[ "$arg" == --digest=* ]]; then
      raw_input="${arg#--digest=}"
    fi
  done

  if [ -z "$raw_input" ]; then
    echo "ERROR: Missing required immutable image digest. You must provide an explicit digest via --digest=sha256:<64-hex> or IMAGE_DIGEST=sha256:<64-hex>. Silent fallback to stale default digest is prohibited." >&2
    exit 1
  fi

  if [ "$raw_input" = "latest" ]; then
    echo "ERROR: Mutable 'latest' tag is strictly forbidden. An immutable image digest (sha256:...) is required." >&2
    exit 1
  fi

  local digest="$raw_input"

  # If a full image URI was provided (e.g., repo@sha256:...), validate repo and extract digest
  if [[ "$raw_input" == *"@"* ]]; then
    local repo="${raw_input%@*}"
    digest="${raw_input#*@}"
    if [ "$repo" != "$EXPECTED_ARTIFACT_REGISTRY" ]; then
      echo "ERROR: Image repository mismatch '$repo'. Expected '$EXPECTED_ARTIFACT_REGISTRY'." >&2
      exit 1
    fi
  fi

  if ! [[ "$digest" =~ ^sha256:[a-f0-9]{64}$ ]]; then
    echo "ERROR: Invalid image digest format '$digest'. Expected sha256:<64 hex characters>." >&2
    exit 1
  fi

  echo "$digest"
}

# ------------------------------------------------------------------------------
# 6. Local Pre-flight (lint & build)
# ------------------------------------------------------------------------------
run_preflight() {
  if [ "${SKIP_PREFLIGHT:-0}" = "1" ]; then
    echo "Skipping local pre-flight checks (SKIP_PREFLIGHT=1)"
    return 0
  fi

  echo "======================================================================"
  echo "Running Local Pre-flight Checks (lint & build)..."
  echo "======================================================================"
  if ! npm run lint; then
    echo "ERROR: Pre-flight failed at 'npm run lint'. Aborting migration." >&2
    exit 1
  fi
  if ! npm run build; then
    echo "ERROR: Pre-flight failed at 'npm run build'. Aborting migration." >&2
    exit 1
  fi
  echo "PRE-FLIGHT PASSED"
  echo "======================================================================"
}

# ------------------------------------------------------------------------------
# Safe Summary (Zero secrets logged)
# ------------------------------------------------------------------------------
print_migration_summary() {
  local digest="$1"
  echo "======================================================================"
  echo "EchoNote Safe Declarative Cloud Run Migration"
  echo "Target Specifications:"
  echo "  Project:                     $EXPECTED_PROJECT_ID"
  echo "  Region:                      $EXPECTED_REGION"
  echo "  Service:                     $EXPECTED_SERVICE_NAME"
  echo "  Service Account:             $EXPECTED_SERVICE_ACCOUNT"
  echo "  Artifact Registry:           $EXPECTED_ARTIFACT_REGISTRY"
  echo "  Immutable Image Digest:      $digest"
  echo "  Migration Mechanism:         Atomic Declarative Specification (services replace)"
  echo "  Razorpay Mode:               live"
  echo "  Ordinary Variables (9):      RAZORPAY_MODE, RAZORPAY_KEY_ID, NODE_ENV, APP_URL,"
  echo "                               RESEND_FROM_EMAIL, RAZORPAY_PRO_MONTHLY_PLAN_ID,"
  echo "                               RAZORPAY_PRO_YEARLY_PLAN_ID, RAZORPAY_TEAM_MONTHLY_PLAN_ID,"
  echo "                               RAZORPAY_TEAM_YEARLY_PLAN_ID"
  echo "  Secret Manager Mappings (6): GEMINI_API_KEY -> echonote-gemini-api-key:latest"
  echo "                               RAZORPAY_KEY_SECRET -> echonote-razorpay-key-secret:latest"
  echo "                               RAZORPAY_WEBHOOK_SECRET -> echonote-razorpay-webhook-secret:latest"
  echo "                               RESEND_API_KEY -> echonote-resend-api-key:latest"
  echo "                               PLAYBACK_SECRET -> echonote-playback-secret:latest"
  echo "                               CRON_SECRET -> echonote-cron-secret:latest"
  echo "  Current Serving Revision:    $CURRENT_SERVING_PROD_REVISION (100% traffic locked)"
  echo "  New Revision Traffic Target: 0% (traffic promotion requires explicit action)"
  echo "======================================================================"
}

# ------------------------------------------------------------------------------
# Execution Router
# ------------------------------------------------------------------------------
case "$ACTION" in
  prepare)
    validate_target
    validate_active_gcloud_project
    validate_plan_ids
    validate_razorpay_key_id
    validate_razorpay_mode
    run_preflight

    DIGEST="$(resolve_digest "$@")"
    print_migration_summary "$DIGEST"

    # Create access-restricted temporary working directory for manifest processing
    TMP_DIR="$(mktemp -d)"
    chmod 700 "$TMP_DIR"
    trap 'rm -rf "$TMP_DIR"' EXIT INT TERM

    EXPORTED_YAML="$TMP_DIR/service-exported.yaml"
    DESIRED_YAML="$TMP_DIR/service-desired.yaml"

    echo "--> Exporting current Cloud Run service manifest..."
    if ! gcloud run services describe "$SERVICE_NAME" \
      --project="$PROJECT_ID" \
      --region="$REGION" \
      --format=export > "$EXPORTED_YAML"; then
      echo "ERROR: Failed to export Cloud Run service '$SERVICE_NAME'. Aborting." >&2
      exit 1
    fi

    # Verify exported manifest is non-empty
    if [ ! -s "$EXPORTED_YAML" ]; then
      echo "ERROR: Exported service manifest is empty. Aborting." >&2
      exit 1
    fi

    echo "--> Generating atomic desired-state service specification..."
    RAZORPAY_KEY_ID="$RAZORPAY_KEY_ID" \
    RAZORPAY_PRO_MONTHLY_PLAN_ID="$PLAN_PRO_MONTHLY" \
    RAZORPAY_PRO_YEARLY_PLAN_ID="$PLAN_PRO_YEARLY" \
    RAZORPAY_TEAM_MONTHLY_PLAN_ID="$PLAN_TEAM_MONTHLY" \
    RAZORPAY_TEAM_YEARLY_PLAN_ID="$PLAN_TEAM_YEARLY" \
    npx tsx scripts/prepare-declarative-service.ts \
      --input="$EXPORTED_YAML" \
      --output="$DESIRED_YAML" \
      --digest="$DIGEST" \
      --serving-revision="$CURRENT_SERVING_PROD_REVISION"

    if [ ! -s "$DESIRED_YAML" ]; then
      echo "ERROR: Generated desired-state manifest is missing or empty. Aborting." >&2
      exit 1
    fi

    if [ "${DRY_RUN:-0}" = "1" ]; then
      echo "DRY RUN: Manifest transformation and validations passed."
      echo "Skipping remote gcloud services replace and traffic verification."
      exit 0
    fi

    echo "======================================================================"
    echo "Executing Atomic Declarative Service Replacement"
    echo "Service: $SERVICE_NAME (Region: $REGION, Project: $PROJECT_ID)"
    echo "======================================================================"

    gcloud run services replace "$DESIRED_YAML" \
      --project="$PROJECT_ID" \
      --region="$REGION"

    echo "--> Verifying traffic specification after service replace..."
    # Ensure traffic is still 100% routed to the baseline revision
    SERVING_TRAFFIC_REV="$(gcloud run services describe "$SERVICE_NAME" \
      --project="$PROJECT_ID" \
      --region="$REGION" \
      --format='value(status.traffic[0].revisionName)' 2>/dev/null || true)"
    SERVING_TRAFFIC_PCT="$(gcloud run services describe "$SERVICE_NAME" \
      --project="$PROJECT_ID" \
      --region="$REGION" \
      --format='value(status.traffic[0].percent)' 2>/dev/null || true)"

    echo "Current serving revision in status: '$SERVING_TRAFFIC_REV' ($SERVING_TRAFFIC_PCT%)"

    if [ "$SERVING_TRAFFIC_REV" != "$CURRENT_SERVING_PROD_REVISION" ] || [ "$SERVING_TRAFFIC_PCT" != "100" ]; then
      echo "CRITICAL SAFETY ALERT: Traffic allocation mismatch!" >&2
      echo "Expected revision '$CURRENT_SERVING_PROD_REVISION' to have 100% traffic." >&2
      echo "Actual: '$SERVING_TRAFFIC_REV' has '$SERVING_TRAFFIC_PCT'%." >&2
      exit 1
    fi

    echo "--> Resolving newly created revision name..."
    NEW_REVISION="$(gcloud run services describe "$SERVICE_NAME" \
      --project="$PROJECT_ID" \
      --region="$REGION" \
      --format='value(status.latestCreatedRevisionName)' 2>/dev/null || true)"

    if [ -z "$NEW_REVISION" ] || [ "$NEW_REVISION" = "$CURRENT_SERVING_PROD_REVISION" ]; then
      echo "ERROR: Failed to resolve newly created revision name (got: '$NEW_REVISION'). Aborting." >&2
      exit 1
    fi

    echo "Newly deployed revision: $NEW_REVISION"

    echo "--> Verifying readiness condition of $NEW_REVISION..."
    IS_READY="$(gcloud run revisions describe "$NEW_REVISION" \
      --project="$PROJECT_ID" \
      --region="$REGION" \
      --format='value(status.conditions[0].status)' 2>/dev/null || true)"

    if [ "$IS_READY" != "True" ]; then
      echo "ERROR: Revision $NEW_REVISION failed health check (Ready: '$IS_READY'). Refusing to promote traffic!" >&2
      echo "100% of production traffic remains safely on: $CURRENT_SERVING_PROD_REVISION" >&2
      exit 1
    fi

    echo "--> Verifying container image digest of $NEW_REVISION..."
    REVISION_IMAGE="$(gcloud run revisions describe "$NEW_REVISION" \
      --project="$PROJECT_ID" \
      --region="$REGION" \
      --format='value(spec.containers[0].image)' 2>/dev/null || true)"

    if ! echo "$REVISION_IMAGE" | grep -q "$DIGEST"; then
      echo "ERROR: Revision $NEW_REVISION image verification failed!" >&2
      echo "Expected digest: $DIGEST" >&2
      echo "Actual image:    $REVISION_IMAGE" >&2
      echo "100% of production traffic remains safely on: $CURRENT_SERVING_PROD_REVISION" >&2
      exit 1
    fi

    echo "======================================================================"
    echo "✅ DECLARATIVE MIGRATION PREPARATION & VERIFICATION SUCCEEDED!"
    echo "======================================================================"
    echo "  Verified Revision:        $NEW_REVISION (Ready: True, Digest: $DIGEST)"
    echo "  Current Serving Traffic:  100% safely on $CURRENT_SERVING_PROD_REVISION"
    echo "  New Revision Traffic:     0%"
    echo ""
    echo "To shift 100% production traffic to the new revision, run the explicit promote command:"
    echo "  ./scripts/migrate-cloud-run-declarative.sh promote $NEW_REVISION"
    echo "======================================================================"
    ;;

  promote)
    validate_target
    validate_active_gcloud_project

    TARGET_REVISION="${2:-}"
    if [ -z "$TARGET_REVISION" ]; then
      echo "ERROR: Missing target revision to promote." >&2
      echo "Usage: ./scripts/migrate-cloud-run-declarative.sh promote <REVISION_NAME>" >&2
      exit 1
    fi

    echo "======================================================================"
    echo "Promoting Traffic to Revision: $TARGET_REVISION"
    echo "Service: $SERVICE_NAME (Region: $REGION, Project: $PROJECT_ID)"
    echo "======================================================================"

    echo "--> Verifying target revision $TARGET_REVISION is Ready..."
    IS_READY="$(gcloud run revisions describe "$TARGET_REVISION" \
      --project="$PROJECT_ID" \
      --region="$REGION" \
      --format='value(status.conditions[0].status)' 2>/dev/null || true)"

    if [ "$IS_READY" != "True" ]; then
      echo "ERROR: Target revision $TARGET_REVISION is NOT Ready (status: '$IS_READY'). Refusing to promote traffic!" >&2
      exit 1
    fi

    if [ "${DRY_RUN:-0}" = "1" ]; then
      echo "DRY RUN: Target revision verification passed. Skipping remote update-traffic."
      exit 0
    fi

    echo "--> Shifting 100% production traffic to $TARGET_REVISION..."
    gcloud run services update-traffic "$SERVICE_NAME" \
      --to-revisions="$TARGET_REVISION=100" \
      --project="$PROJECT_ID" \
      --region="$REGION"

    echo "✅ 100% production traffic successfully routed to $TARGET_REVISION."
    ;;

  verify)
    if [ -z "${2:-}" ]; then
      echo "Usage: ./scripts/migrate-cloud-run-declarative.sh verify <BACKEND_URL>"
      exit 1
    fi
    BACKEND_URL="${2%/}"
    echo "Verifying Health: $BACKEND_URL/api/health"
    curl -s "$BACKEND_URL/api/health" | grep -o '"status":"[^"]*"' || true
    echo ""
    echo "Verifying Payment Diagnostics: $BACKEND_URL/api/payment/config-status"
    curl -s "$BACKEND_URL/api/payment/config-status"
    echo ""
    ;;

  *)
    echo "Unknown action: $ACTION"
    echo "Usage: ./scripts/migrate-cloud-run-declarative.sh [prepare [--digest=...] | promote <REVISION> | verify <URL>]"
    exit 1
    ;;
esac
