#!/usr/bin/env bash
# ==============================================================================
# EchoNote Production Cloud Run Deployment & Environment Variables Configuration
# ==============================================================================
# This script configures runtime environment variables on the production
# Google Cloud Run backend service and verifies the active revision.
#
# Usage:
#   chmod +x scripts/deploy-cloud-run.sh
#   ./scripts/deploy-cloud-run.sh [update-env | deploy | verify]
# ==============================================================================

set -euo pipefail

SERVICE_NAME="${CLOUD_RUN_SERVICE:-echonote-backend}"
REGION="${CLOUD_RUN_REGION:-asia-southeast1}"
PROJECT_ID="${GOOGLE_CLOUD_PROJECT:-echonote-2509}"

# Plan IDs configured for EchoNote
PLAN_PRO_MONTHLY="${RAZORPAY_PRO_MONTHLY_PLAN_ID:-plan_TambUyuTkGL4zY}"
PLAN_PRO_YEARLY="${RAZORPAY_PRO_YEARLY_PLAN_ID:-plan_Tamd1Ef89GKQNk}"
PLAN_TEAM_MONTHLY="${RAZORPAY_TEAM_MONTHLY_PLAN_ID:-plan_TamdizBJ9W7kJo}"
PLAN_TEAM_YEARLY="${RAZORPAY_TEAM_YEARLY_PLAN_ID:-plan_TameI4cjPUzRpn}"

ACTION="${1:-update-env}"

case "$ACTION" in
  update-env)
    echo "======================================================================"
    echo "Updating Cloud Run Service Environment Variables"
    echo "Service: $SERVICE_NAME (Region: $REGION, Project: $PROJECT_ID)"
    echo "======================================================================"
    
    gcloud run services update "$SERVICE_NAME" \
      --project="$PROJECT_ID" \
      --region="$REGION" \
      --update-env-vars="RAZORPAY_MODE=live,\
RAZORPAY_PRO_MONTHLY_PLAN_ID=$PLAN_PRO_MONTHLY,\
RAZORPAY_PRO_YEARLY_PLAN_ID=$PLAN_PRO_YEARLY,\
RAZORPAY_TEAM_MONTHLY_PLAN_ID=$PLAN_TEAM_MONTHLY,\
RAZORPAY_TEAM_YEARLY_PLAN_ID=$PLAN_TEAM_YEARLY"

    echo "✅ Cloud Run environment variables successfully updated."
    echo "100% of traffic is automatically routed to the newly deployed revision."
    ;;

  deploy)
    echo "======================================================================"
    echo "Building and Deploying New Image to Cloud Run"
    echo "Service: $SERVICE_NAME (Region: $REGION, Project: $PROJECT_ID)"
    echo "======================================================================"
    
    gcloud run deploy "$SERVICE_NAME" \
      --source . \
      --project="$PROJECT_ID" \
      --region="$REGION" \
      --allow-unauthenticated \
      --port=3000 \
      --update-env-vars="RAZORPAY_MODE=live,\
RAZORPAY_PRO_MONTHLY_PLAN_ID=$PLAN_PRO_MONTHLY,\
RAZORPAY_PRO_YEARLY_PLAN_ID=$PLAN_PRO_YEARLY,\
RAZORPAY_TEAM_MONTHLY_PLAN_ID=$PLAN_TEAM_MONTHLY,\
RAZORPAY_TEAM_YEARLY_PLAN_ID=$PLAN_TEAM_YEARLY"

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
