#!/usr/bin/env bash
# ==============================================================================
# EchoNote Independent Production Service ("echonote-prod") Migration Tool
# ==============================================================================
# Manages declarative Cloud Run deployment specifically and exclusively for
# the independently managed production service "echonote-prod".
#
# Key Guardrails:
# 1. Hard-locked target constants (project: echonote-2509, region: us-west1, service: echonote-prod).
# 2. Rejects arbitrary service names.
# 3. Verifies that the legacy "echonote" service remains on echonote-00009-w5m
#    with 100% traffic before and during any operations.
# 4. Uses the current ready revision of "echonote-prod" as its baseline serving revision.
# 5. Never modifies the legacy "echonote" service.
# 6. Uses --service-name=echonote-prod when generating desired specification.
# 7. Zero plaintext secrets in logs or stored files (temporary files in 0700 tmpdir,
#    cleaned up on EXIT).
# 8. Separate explicit action required to promote traffic (promote <REVISION>).
#
# Usage:
#   chmod +x scripts/migrate-cloud-run-independent.sh
#   ./scripts/migrate-cloud-run-independent.sh prepare [--digest=sha256:...]
#   ./scripts/migrate-cloud-run-independent.sh promote <REVISION_NAME>
#   ./scripts/migrate-cloud-run-independent.sh verify <URL>
# ==============================================================================

set -euo pipefail

# Production Hard-Locked Target Constants
readonly EXPECTED_PROJECT_ID="echonote-2509"
readonly EXPECTED_REGION="us-west1"
readonly EXPECTED_SERVICE_NAME="echonote-prod"
readonly EXPECTED_SERVICE_ACCOUNT="200551109142-compute@developer.gserviceaccount.com"
readonly EXPECTED_ARTIFACT_REGISTRY="us-west1-docker.pkg.dev/echonote-2509/echonote/echonote"

# Legacy Service Guardrail Constants
readonly LEGACY_SERVICE_NAME="echonote"
readonly LEGACY_REQUIRED_REVISION="echonote-00009-w5m"

# Default pinned immutable image digest
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
# 1. Target Validation: Must strictly match echonote-prod (no arbitrary services)
# ------------------------------------------------------------------------------
validate_target() {
  if [ "$PROJECT_ID" != "$EXPECTED_PROJECT_ID" ] || \
     [ "$REGION" != "$EXPECTED_REGION" ] || \
     [ "$SERVICE_NAME" != "$EXPECTED_SERVICE_NAME" ]; then
    echo "ERROR: Production deployment target mismatch for independent service." >&2
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
  if [ "$mode" = "live" ] && ! [[ "$RAZORPAY_KEY_ID" =~ ^rzp_live_[A-Za-z0-9]+$ ]]; then
    echo "ERROR: Invalid RAZORPAY_KEY_ID for mode 'live': must start with 'rzp_live_'." >&2
    exit 1
  fi

  if [ "$mode" = "test" ] && ! [[ "$RAZORPAY_KEY_ID" =~ ^rzp_test_[A-Za-z0-9]+$ ]]; then
    echo "ERROR: Invalid RAZORPAY_KEY_ID for mode 'test': must start with 'rzp_test_'." >&2
    exit 1
  fi
}

# ------------------------------------------------------------------------------
# 4c. Legacy Echonote Service Protection Guardrail
# ------------------------------------------------------------------------------
verify_legacy_echonote_service() {
  echo "--> Verifying protected legacy '$LEGACY_SERVICE_NAME' service state..."
  local legacy_traffic
  legacy_traffic="$(gcloud run services describe "$LEGACY_SERVICE_NAME" \
    --project="$PROJECT_ID" \
    --region="$REGION" \
    --format='value(status.traffic[0].revisionName,status.traffic[0].percent)' 2>/dev/null || true)"

  if [ -z "$legacy_traffic" ]; then
    echo "ERROR: Failed to query legacy service '$LEGACY_SERVICE_NAME' status." >&2
    exit 1
  fi

  if ! echo "$legacy_traffic" | grep -q "$LEGACY_REQUIRED_REVISION" || ! echo "$legacy_traffic" | grep -q "100"; then
    echo "ERROR: Legacy service '$LEGACY_SERVICE_NAME' is NOT locked to 100% traffic on $LEGACY_REQUIRED_REVISION!" >&2
    echo "Actual traffic: '$legacy_traffic'" >&2
    exit 1
  fi

  echo "  [OK] Legacy service '$LEGACY_SERVICE_NAME' traffic locked 100% on $LEGACY_REQUIRED_REVISION"
}

# ------------------------------------------------------------------------------
# 5. Resolve & Validate Immutable Image Digest
# ------------------------------------------------------------------------------
resolve_digest() {
  local raw_input="${IMAGE_DIGEST:-}"
  for arg in "$@"; do
    if [[ "$arg" =~ ^--digest=(.*)$ ]]; then
      raw_input="${BASH_REMATCH[1]}"
    fi
  done

  local digest="${raw_input:-$DEFAULT_IMMUTABLE_DIGEST}"

  if [ -z "$digest" ]; then
    echo "ERROR: Missing required image digest. Stale image fallbacks are forbidden." >&2
    exit 1
  fi

  if [ "$digest" = "latest" ] || [[ "$digest" =~ ^latest@ ]] || [[ "$digest" =~ :latest$ ]]; then
    echo "ERROR: Mutable image tag 'latest' is strictly forbidden in production. Must use immutable sha256 digest." >&2
    exit 1
  fi

  if ! [[ "$digest" =~ ^sha256:[a-f0-9]{64}$ ]]; then
    echo "ERROR: Invalid immutable image digest format: '$digest'." >&2
    echo "Digest must match sha256:<64 hex characters>." >&2
    exit 1
  fi

  echo "$digest"
}

# ------------------------------------------------------------------------------
# 5b. Resolve Current Ready Baseline Revision for echonote-prod
# ------------------------------------------------------------------------------
resolve_baseline_serving_revision() {
  echo "--> Resolving current baseline revision for '$SERVICE_NAME'..." >&2
  local current_prod_rev
  current_prod_rev="$(gcloud run services describe "$SERVICE_NAME" \
    --project="$PROJECT_ID" \
    --region="$REGION" \
    --format='value(status.traffic[0].revisionName)' 2>/dev/null || true)"

  if [ -z "$current_prod_rev" ]; then
    current_prod_rev="$(gcloud run services describe "$SERVICE_NAME" \
      --project="$PROJECT_ID" \
      --region="$REGION" \
      --format='value(status.latestReadyRevisionName)' 2>/dev/null || true)"
  fi

  if [ -z "$current_prod_rev" ]; then
    echo "ERROR: Failed to resolve current baseline revision for '$SERVICE_NAME'. Aborting." >&2
    exit 1
  fi

  echo "$current_prod_rev"
}

# ------------------------------------------------------------------------------
# 6. Pre-flight Quality & Security Checks
# ------------------------------------------------------------------------------
run_preflight() {
  echo "======================================================================"
  echo "Running Pre-Flight Quality & Security Checks..."
  echo "======================================================================"

  echo "--> Running: npm run lint..."
  if ! npm run lint; then
    echo "ERROR: Code linting failed (npm run lint). Aborting deployment." >&2
    exit 1
  fi

  echo "--> Running: npm run build..."
  if ! npm run build; then
    echo "ERROR: Application build failed (npm run build). Aborting deployment." >&2
    exit 1
  fi

  echo "✅ Pre-flight checks passed."
}

# ------------------------------------------------------------------------------
# Summary Log
# ------------------------------------------------------------------------------
print_migration_summary() {
  local digest="$1"
  local baseline_rev="$2"
  echo "======================================================================"
  echo "EchoNote Independent Production Migration Configuration"
  echo "======================================================================"
  echo "  Service Name:                $SERVICE_NAME"
  echo "  Legacy Protected Service:    $LEGACY_SERVICE_NAME (locked on $LEGACY_REQUIRED_REVISION)"
  echo "  Cloud Run Project:           $PROJECT_ID"
  echo "  Cloud Run Region:            $REGION"
  echo "  Service Account:             $EXPECTED_SERVICE_ACCOUNT"
  echo "  Artifact Registry Repo:      $EXPECTED_ARTIFACT_REGISTRY"
  echo "  Immutable Image Digest:      $digest"
  echo "  Baseline Serving Revision:   $baseline_rev"
  echo "  Secret Manager Mappings (6): GEMINI_API_KEY, RAZORPAY_KEY_SECRET,"
  echo "                               RAZORPAY_WEBHOOK_SECRET, RESEND_API_KEY,"
  echo "                               PLAYBACK_SECRET, CRON_SECRET"
  echo "  Ordinary Variables (9):      RAZORPAY_MODE, RAZORPAY_KEY_ID, NODE_ENV, APP_URL,"
  echo "                               RESEND_FROM_EMAIL, RAZORPAY_PRO_MONTHLY_PLAN_ID,"
  echo "                               RAZORPAY_PRO_YEARLY_PLAN_ID, RAZORPAY_TEAM_MONTHLY_PLAN_ID,"
  echo "                               RAZORPAY_TEAM_YEARLY_PLAN_ID"
  echo "  Razorpay Mode:               live"
  echo "  Razorpay Key ID:             VALID"
  echo "  Plan IDs Validation:         VALID"
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
    verify_legacy_echonote_service
    run_preflight

    DIGEST="$(resolve_digest "$@")"
    BASELINE_SERVING_REVISION="$(resolve_baseline_serving_revision)"
    print_migration_summary "$DIGEST" "$BASELINE_SERVING_REVISION"

    # Create access-restricted temporary working directory for manifest processing
    TMP_DIR="$(mktemp -d)"
    chmod 700 "$TMP_DIR"
    trap 'rm -rf "$TMP_DIR"' EXIT INT TERM

    EXPORTED_YAML="$TMP_DIR/service-exported.yaml"
    DESIRED_YAML="$TMP_DIR/service-desired.yaml"

    echo "--> Exporting current Cloud Run service manifest for $SERVICE_NAME..."
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

    echo "--> Generating atomic desired-state service specification for $SERVICE_NAME..."
    RAZORPAY_KEY_ID="$RAZORPAY_KEY_ID" \
    RAZORPAY_PRO_MONTHLY_PLAN_ID="$PLAN_PRO_MONTHLY" \
    RAZORPAY_PRO_YEARLY_PLAN_ID="$PLAN_PRO_YEARLY" \
    RAZORPAY_TEAM_MONTHLY_PLAN_ID="$PLAN_TEAM_MONTHLY" \
    RAZORPAY_TEAM_YEARLY_PLAN_ID="$PLAN_TEAM_YEARLY" \
    npx tsx scripts/prepare-declarative-service.ts \
      --input="$EXPORTED_YAML" \
      --output="$DESIRED_YAML" \
      --digest="$DIGEST" \
      --serving-revision="$BASELINE_SERVING_REVISION" \
      --service-name="$SERVICE_NAME"

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

    # Re-verify legacy echonote was never touched
    verify_legacy_echonote_service

    echo "--> Verifying traffic safety after service replacement..."
    CURRENT_TRAFFIC="$(gcloud run services describe "$SERVICE_NAME" \
      --project="$PROJECT_ID" \
      --region="$REGION" \
      --format='value(status.traffic[0].revisionName,status.traffic[0].percent)' 2>/dev/null || true)"

    if [ -z "$CURRENT_TRAFFIC" ]; then
      echo "ERROR: Could not verify Cloud Run traffic for '$SERVICE_NAME'. Aborting." >&2
      exit 1
    fi

    if ! echo "$CURRENT_TRAFFIC" | grep -q "$BASELINE_SERVING_REVISION" || ! echo "$CURRENT_TRAFFIC" | grep -q "100"; then
      echo "CRITICAL ALERT: Production traffic on '$SERVICE_NAME' is NOT 100% on baseline revision ($BASELINE_SERVING_REVISION)!" >&2
      echo "Current traffic distribution: $CURRENT_TRAFFIC" >&2
      exit 1
    fi

    echo "--> Resolving newly created revision name..."
    NEW_REVISION="$(gcloud run services describe "$SERVICE_NAME" \
      --project="$PROJECT_ID" \
      --region="$REGION" \
      --format='value(status.latestCreatedRevisionName)' 2>/dev/null || true)"

    if [ -z "$NEW_REVISION" ] || [ "$NEW_REVISION" = "$BASELINE_SERVING_REVISION" ]; then
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
      echo "100% of production traffic remains safely on: $BASELINE_SERVING_REVISION" >&2
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
      echo "100% of production traffic remains safely on: $BASELINE_SERVING_REVISION" >&2
      exit 1
    fi

    echo "======================================================================"
    echo "✅ DECLARATIVE MIGRATION PREPARATION & VERIFICATION SUCCEEDED!"
    echo "======================================================================"
    echo "  Service:                  $SERVICE_NAME"
    echo "  Verified Revision:        $NEW_REVISION (Ready: True, Digest: $DIGEST)"
    echo "  Current Serving Traffic:  100% safely on $BASELINE_SERVING_REVISION"
    echo "  New Revision Traffic:     0%"
    echo "  Legacy Service:           100% safely on $LEGACY_REQUIRED_REVISION"
    echo ""
    echo "To shift 100% production traffic to the new revision, run the explicit promote command:"
    echo "  ./scripts/migrate-cloud-run-independent.sh promote $NEW_REVISION"
    echo "======================================================================"
    ;;

  promote)
    validate_target
    validate_active_gcloud_project
    verify_legacy_echonote_service

    TARGET_REVISION="${2:-}"
    if [ -z "$TARGET_REVISION" ]; then
      echo "ERROR: Missing target revision to promote." >&2
      echo "Usage: ./scripts/migrate-cloud-run-independent.sh promote <REVISION_NAME>" >&2
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

    echo "--> Shifting 100% production traffic to $TARGET_REVISION on $SERVICE_NAME..."
    gcloud run services update-traffic "$SERVICE_NAME" \
      --to-revisions="$TARGET_REVISION=100" \
      --project="$PROJECT_ID" \
      --region="$REGION"

    verify_legacy_echonote_service

    echo "✅ 100% production traffic successfully routed to $TARGET_REVISION on $SERVICE_NAME."
    ;;

  verify)
    if [ -z "${2:-}" ]; then
      echo "Usage: ./scripts/migrate-cloud-run-independent.sh verify <BACKEND_URL>"
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
    echo "Usage: ./scripts/migrate-cloud-run-independent.sh [prepare [--digest=...] | promote <REVISION> | verify <URL>]"
    exit 1
    ;;
esac
