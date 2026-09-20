#!/usr/bin/env bash
# ==============================================================================
# EchoNote Production Cloud Run Deployment & Environment Variables Configuration
# ==============================================================================
# Hardened for production deployment safety.
#
# Production Target Lock:
#   Project:         echonote-2509
#   Region:          us-west1
#   Service:         echonote
#   Service Account: 200551109142-compute@developer.gserviceaccount.com
#   Razorpay Mode:   live
#
# Rollback Reference:
#   Last known verified production revision: echonote-00008-lw9
#   Rollback command:
#     gcloud run services update-traffic echonote \
#       --to-revisions=echonote-00008-lw9=100 \
#       --region=us-west1 \
#       --project=echonote-2509
#
# Usage:
#   chmod +x scripts/deploy-cloud-run.sh
#   ./scripts/deploy-cloud-run.sh [update-env | deploy | verify <URL>]
# ==============================================================================

set -euo pipefail

# Production Hard-Locked Target Constants
readonly EXPECTED_PROJECT_ID="echonote-2509"
readonly EXPECTED_REGION="us-west1"
readonly EXPECTED_SERVICE_NAME="echonote"
readonly EXPECTED_SERVICE_ACCOUNT="200551109142-compute@developer.gserviceaccount.com"
readonly LAST_KNOWN_PROD_REVISION="echonote-00008-lw9"

# Target variables (subject to strict validation against expected production constants)
SERVICE_NAME="${CLOUD_RUN_SERVICE:-$EXPECTED_SERVICE_NAME}"
REGION="${CLOUD_RUN_REGION:-$EXPECTED_REGION}"
PROJECT_ID="${GOOGLE_CLOUD_PROJECT:-$EXPECTED_PROJECT_ID}"

# Plan IDs configured for EchoNote
PLAN_PRO_MONTHLY="${RAZORPAY_PRO_MONTHLY_PLAN_ID-plan_TambUyuTkGL4zY}"
PLAN_PRO_YEARLY="${RAZORPAY_PRO_YEARLY_PLAN_ID-plan_Tamd1Ef89GKQNk}"
PLAN_TEAM_MONTHLY="${RAZORPAY_TEAM_MONTHLY_PLAN_ID-plan_TamdizBJ9W7kJo}"
PLAN_TEAM_YEARLY="${RAZORPAY_TEAM_YEARLY_PLAN_ID-plan_TameI4cjPUzRpn}"

# Production Secret Manager Mappings (Cloud Run Secret Integration)
# References use Secret Manager secret names and versions only; no plaintext secret values.
readonly SECRET_GEMINI_API_KEY="GEMINI_API_KEY=echonote-gemini-api-key:latest"
readonly SECRET_RAZORPAY_KEY_SECRET="RAZORPAY_KEY_SECRET=echonote-razorpay-key-secret:latest"
readonly SECRET_RAZORPAY_WEBHOOK_SECRET="RAZORPAY_WEBHOOK_SECRET=echonote-razorpay-webhook-secret:latest"
readonly SECRET_RESEND_API_KEY="RESEND_API_KEY=echonote-resend-api-key:latest"
readonly SECRET_PLAYBACK_SECRET="PLAYBACK_SECRET=echonote-playback-secret:latest"
readonly SECRET_CRON_SECRET="CRON_SECRET=echonote-cron-secret:latest"

readonly CLOUD_RUN_SECRETS="${SECRET_GEMINI_API_KEY},${SECRET_RAZORPAY_KEY_SECRET},${SECRET_RAZORPAY_WEBHOOK_SECRET},${SECRET_RESEND_API_KEY},${SECRET_PLAYBACK_SECRET},${SECRET_CRON_SECRET}"

TARGET_RAZORPAY_MODE="live"
ACTION="${1:-update-env}"

# ------------------------------------------------------------------------------
# 1. Target Validation: Reject any override differing from production
# ------------------------------------------------------------------------------
validate_target() {
  if [ "$PROJECT_ID" != "$EXPECTED_PROJECT_ID" ] || \
     [ "$REGION" != "$EXPECTED_REGION" ] || \
     [ "$SERVICE_NAME" != "$EXPECTED_SERVICE_NAME" ]; then
    echo "ERROR: Production deployment target mismatch." >&2
    echo "Expected:" >&2
    echo "  project: $EXPECTED_PROJECT_ID" >&2
    echo "  region: $EXPECTED_REGION" >&2
    echo "  service: $EXPECTED_SERVICE_NAME" >&2
    echo "Received:" >&2
    echo "  project: $PROJECT_ID" >&2
    echo "  region: $REGION" >&2
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
    echo "Active project: '$active_proj'" >&2
    echo "Expected project: '$EXPECTED_PROJECT_ID'" >&2
    echo "Please switch your active gcloud project using:" >&2
    echo "  gcloud config set project $EXPECTED_PROJECT_ID" >&2
    exit 1
  fi
}

# ------------------------------------------------------------------------------
# 3. Plan IDs Validation: Must match ^plan_[A-Za-z0-9]+$
# ------------------------------------------------------------------------------
validate_plan_ids() {
  local regex='^plan_[A-Za-z0-9]+$'
  local has_error=0

  if [ -z "$PLAN_PRO_MONTHLY" ] || ! [[ "$PLAN_PRO_MONTHLY" =~ $regex ]]; then
    echo "ERROR: Invalid or missing RAZORPAY_PRO_MONTHLY_PLAN_ID." >&2
    echo "Must be non-empty and match pattern ^plan_[A-Za-z0-9]+$" >&2
    has_error=1
  fi

  if [ -z "$PLAN_PRO_YEARLY" ] || ! [[ "$PLAN_PRO_YEARLY" =~ $regex ]]; then
    echo "ERROR: Invalid or missing RAZORPAY_PRO_YEARLY_PLAN_ID." >&2
    echo "Must be non-empty and match pattern ^plan_[A-Za-z0-9]+$" >&2
    has_error=1
  fi

  if [ -z "$PLAN_TEAM_MONTHLY" ] || ! [[ "$PLAN_TEAM_MONTHLY" =~ $regex ]]; then
    echo "ERROR: Invalid or missing RAZORPAY_TEAM_MONTHLY_PLAN_ID." >&2
    echo "Must be non-empty and match pattern ^plan_[A-Za-z0-9]+$" >&2
    has_error=1
  fi

  if [ -z "$PLAN_TEAM_YEARLY" ] || ! [[ "$PLAN_TEAM_YEARLY" =~ $regex ]]; then
    echo "ERROR: Invalid or missing RAZORPAY_TEAM_YEARLY_PLAN_ID." >&2
    echo "Must be non-empty and match pattern ^plan_[A-Za-z0-9]+$" >&2
    has_error=1
  fi

  if [ "$has_error" -ne 0 ]; then
    echo "Deployment aborted due to invalid Razorpay plan ID(s)." >&2
    exit 1
  fi
}

# ------------------------------------------------------------------------------
# 4. Razorpay Mode Validation: Must be strictly 'live'
# ------------------------------------------------------------------------------
validate_razorpay_mode() {
  if [ -n "${RAZORPAY_MODE:-}" ] && [ "$RAZORPAY_MODE" != "live" ]; then
    echo "ERROR: Invalid ambient RAZORPAY_MODE='$RAZORPAY_MODE'. Production deployment requires RAZORPAY_MODE=live." >&2
    exit 1
  fi
  TARGET_RAZORPAY_MODE="live"
}

# ------------------------------------------------------------------------------
# 5. Local Pre-flight: npm run lint && npm run build
# ------------------------------------------------------------------------------
run_preflight() {
  echo "======================================================================"
  echo "Running Local Pre-flight Checks (lint & build)..."
  echo "======================================================================"

  echo "--> Running: npm run lint"
  if ! npm run lint; then
    echo "ERROR: Local pre-flight failed at 'npm run lint'. Aborting deployment." >&2
    exit 1
  fi

  echo "--> Running: npm run build"
  if ! npm run build; then
    echo "ERROR: Local pre-flight failed at 'npm run build'. Aborting deployment." >&2
    exit 1
  fi

  echo ""
  echo "PRE-FLIGHT PASSED"
  echo "======================================================================"
}

# ------------------------------------------------------------------------------
# 6. Safe Deployment Summary (No secrets, only validity status)
# ------------------------------------------------------------------------------
print_deployment_summary() {
  echo "======================================================================"
  echo "Production deployment target:"
  echo "  Project: $EXPECTED_PROJECT_ID"
  echo "  Region: $EXPECTED_REGION"
  echo "  Service: $EXPECTED_SERVICE_NAME"
  echo "  Service Account: $EXPECTED_SERVICE_ACCOUNT"
  echo "  Razorpay Mode: $TARGET_RAZORPAY_MODE"
  echo "  Razorpay Pro Monthly Plan: VALID"
  echo "  Razorpay Pro Yearly Plan: VALID"
  echo "  Razorpay Team Monthly Plan: VALID"
  echo "  Razorpay Team Yearly Plan: VALID"
  echo "  Secret Manager References (6 production secrets):"
  echo "    - GEMINI_API_KEY -> echonote-gemini-api-key:latest"
  echo "    - RAZORPAY_KEY_SECRET -> echonote-razorpay-key-secret:latest"
  echo "    - RAZORPAY_WEBHOOK_SECRET -> echonote-razorpay-webhook-secret:latest"
  echo "    - RESEND_API_KEY -> echonote-resend-api-key:latest"
  echo "    - PLAYBACK_SECRET -> echonote-playback-secret:latest"
  echo "    - CRON_SECRET -> echonote-cron-secret:latest"
  echo "  Rollback Reference Revision: $LAST_KNOWN_PROD_REVISION"
  echo "======================================================================"
}

case "$ACTION" in
  update-env)
    validate_target
    validate_active_gcloud_project
    validate_plan_ids
    validate_razorpay_mode
    print_deployment_summary

    echo "Updating Cloud Run Service Environment Variables & Secret References"
    echo "Service: $SERVICE_NAME (Region: $REGION, Project: $PROJECT_ID)"

    if [ "${DRY_RUN:-0}" = "1" ]; then
      echo "DRY RUN: Validation passed. Skipping remote gcloud execution."
      exit 0
    fi

    gcloud run services update "$SERVICE_NAME" \
      --project="$PROJECT_ID" \
      --region="$REGION" \
      --update-env-vars="RAZORPAY_MODE=live,\
NODE_ENV=production,\
RAZORPAY_PRO_MONTHLY_PLAN_ID=$PLAN_PRO_MONTHLY,\
RAZORPAY_PRO_YEARLY_PLAN_ID=$PLAN_PRO_YEARLY,\
RAZORPAY_TEAM_MONTHLY_PLAN_ID=$PLAN_TEAM_MONTHLY,\
RAZORPAY_TEAM_YEARLY_PLAN_ID=$PLAN_TEAM_YEARLY" \
      --set-secrets="$CLOUD_RUN_SECRETS"

    echo "✅ Cloud Run environment variables successfully updated."
    echo "100% of traffic is automatically routed to the newly deployed revision."
    ;;

  deploy)
    validate_target
    validate_active_gcloud_project
    validate_plan_ids
    validate_razorpay_mode
    run_preflight
    print_deployment_summary

    echo "Building and Deploying New Image to Cloud Run"
    echo "Service: $SERVICE_NAME (Region: $REGION, Project: $PROJECT_ID)"

    if [ "${DRY_RUN:-0}" = "1" ]; then
      echo "DRY RUN: Pre-flight and safety validations passed. Skipping remote gcloud execution."
      exit 0
    fi

    gcloud run deploy "$SERVICE_NAME" \
      --source . \
      --project="$PROJECT_ID" \
      --region="$REGION" \
      --service-account="$EXPECTED_SERVICE_ACCOUNT" \
      --allow-unauthenticated \
      --port=3000 \
      --update-env-vars="RAZORPAY_MODE=live,\
NODE_ENV=production,\
RAZORPAY_PRO_MONTHLY_PLAN_ID=$PLAN_PRO_MONTHLY,\
RAZORPAY_PRO_YEARLY_PLAN_ID=$PLAN_PRO_YEARLY,\
RAZORPAY_TEAM_MONTHLY_PLAN_ID=$PLAN_TEAM_MONTHLY,\
RAZORPAY_TEAM_YEARLY_PLAN_ID=$PLAN_TEAM_YEARLY" \
      --set-secrets="$CLOUD_RUN_SECRETS"

    echo "✅ Deployment completed and active."
    ;;

  verify)
    if [ -z "${2:-}" ]; then
      echo "Usage: ./scripts/deploy-cloud-run.sh verify <BACKEND_URL>"
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
    echo "Usage: ./scripts/deploy-cloud-run.sh [update-env | deploy | verify <URL>]"
    exit 1
    ;;
esac
