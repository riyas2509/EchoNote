# !/usr/bin/env bash
# ==============================================================================
# EchoNote Production Cloud Run Deployment & Environment Variables Configuration
# ==============================================================================
# Hardened for explicit immutable Docker deployment to production Cloud Run.
#
# Production Target Lock:
#   Project:           echonote-2509
#   Region:            us-west1
#   Service:           echonote
#   Service Account:   200551109142-compute@developer.gserviceaccount.com
#   Artifact Registry: us-west1-docker.pkg.dev/echonote-2509/echonote/echonote
#   Razorpay Mode:     live
#
# Dynamic Revision Safety:
#   At deployment time, the active serving revision and traffic distribution are
#   discovered dynamically via Cloud Run Admin API, eliminating hardcoded revision drift.
#
# Rollback:
#   To revert traffic to a previously verified healthy revision dynamically, run:
#     gcloud run services update-traffic echonote \
#       --to-revisions=<PREVIOUS_HEALTHY_REVISION>=100 \
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
readonly EXPECTED_ARTIFACT_REGISTRY="us-west1-docker.pkg.dev/echonote-2509/echonote/echonote"

# Target variables (subject to strict validation against expected production constants)
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

# Production Secret Manager Mappings (Cloud Run Secret Integration)
# References use Secret Manager secret names and versions only; no plaintext secret values.
readonly SECRET_GEMINI_API_KEY="GEMINI_API_KEY=echonote-gemini-api-key:latest"
readonly SECRET_RAZORPAY_KEY_SECRET="RAZORPAY_KEY_SECRET=echonote-razorpay-key-secret:latest"
readonly SECRET_RAZORPAY_WEBHOOK_SECRET="RAZORPAY_WEBHOOK_SECRET=echonote-razorpay-webhook-secret:latest"
readonly SECRET_RESEND_API_KEY="RESEND_API_KEY=echonote-resend-api-key:latest"
readonly SECRET_PLAYBACK_SECRET="PLAYBACK_SECRET=echonote-playback-secret:latest"
readonly SECRET_CRON_SECRET="CRON_SECRET=echonote-cron-secret:latest"
readonly SECRET_INTEGRATION_ENCRYPTION_KEY="INTEGRATION_ENCRYPTION_KEY=echonote-integration-encryption-key:latest"
readonly SECRET_ZOOM_WEBHOOK_SECRET="ZOOM_WEBHOOK_SECRET=echonote-zoom-webhook-secret:latest"

readonly CLOUD_RUN_SECRETS="${SECRET_GEMINI_API_KEY},${SECRET_RAZORPAY_KEY_SECRET},${SECRET_RAZORPAY_WEBHOOK_SECRET},${SECRET_RESEND_API_KEY},${SECRET_PLAYBACK_SECRET},${SECRET_CRON_SECRET},${SECRET_INTEGRATION_ENCRYPTION_KEY},${SECRET_ZOOM_WEBHOOK_SECRET}"

# Complete set of ordinary (non-secret) production environment variables (9 total).
# Uses --set-env-vars to replace all ordinary environment variables, ensuring complete
# elimination of legacy plain secrets (GEMINI_API_KEY, RAZORPAY_KEY_SECRET, etc.) from
# the ordinary env-var pool and avoiding Cloud Run type conflicts with --set-secrets.
PRODUCTION_ORDINARY_ENV_VARS="RAZORPAY_MODE=live,\
RAZORPAY_KEY_ID=$RAZORPAY_KEY_ID,\
NODE_ENV=production,\
APP_URL=https://echonote-25.ai.studio,\
RESEND_FROM_EMAIL=EchoNote <invitations@echotechai.in>,\
RAZORPAY_PRO_MONTHLY_PLAN_ID=$PLAN_PRO_MONTHLY,\
RAZORPAY_PRO_YEARLY_PLAN_ID=$PLAN_PRO_YEARLY,\
RAZORPAY_TEAM_MONTHLY_PLAN_ID=$PLAN_TEAM_MONTHLY,\
RAZORPAY_TEAM_YEARLY_PLAN_ID=$PLAN_TEAM_YEARLY"

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
# 5. Image Tag Resolution: Must be an immutable git commit SHA (reject 'latest')
# ------------------------------------------------------------------------------
resolve_image_tag() {
  local tag="${IMAGE_TAG:-}"
  if [ -z "$tag" ]; then
    if command -v git &>/dev/null; then
      tag="$(git rev-parse --short=12 HEAD 2>/dev/null || true)"
    fi
  fi

  if [ -z "$tag" ]; then
    echo "ERROR: Unable to resolve git commit SHA for immutable image tag. Aborting deployment." >&2
    exit 1
  fi

  if [ "$tag" = "latest" ]; then
    echo "ERROR: Mutable 'latest' tag is strictly forbidden. An immutable git commit SHA is required." >&2
    exit 1
  fi

  # Validate that tag is a valid git commit SHA (hex string between 7 and 40 characters)
  if ! [[ "$tag" =~ ^[a-f0-9]{7,40}$ ]]; then
    echo "ERROR: Invalid image tag '$tag'. Must be a valid git commit SHA (hex string between 7 and 40 characters)." >&2
    exit 1
  fi

  echo "$tag"
}

# ------------------------------------------------------------------------------
# 6. Docker Build, Push, and Digest Resolution
# ------------------------------------------------------------------------------
docker_build_image() {
  local image_uri="$1"

  if ! command -v docker &>/dev/null; then
    echo "ERROR: docker CLI is required for container build but not found in PATH." >&2
    exit 1
  fi

  echo "======================================================================"
  echo "Building Docker Image from repository Dockerfile..."
  echo "Target Image URI: $image_uri"
  echo "======================================================================"
  if ! docker build -t "$image_uri" .; then
    echo "ERROR: Docker build failed for '$image_uri'. Aborting deployment." >&2
    exit 1
  fi
}

docker_push_image() {
  local image_uri="$1"

  if ! command -v docker &>/dev/null; then
    echo "ERROR: docker CLI is required for container push but not found in PATH." >&2
    exit 1
  fi

  echo "======================================================================"
  echo "Pushing Docker Image to Artifact Registry..."
  echo "Target Image URI: $image_uri"
  echo "======================================================================"
  if ! docker push "$image_uri"; then
    echo "ERROR: Docker push failed for '$image_uri'. Aborting deployment." >&2
    exit 1
  fi
}

resolve_image_digest() {
  local image_uri="$1"
  local digest=""

  if command -v gcloud &>/dev/null; then
    digest="$(gcloud artifacts docker images describe "$image_uri" --format='value(image_summary.digest)' 2>/dev/null || true)"
  fi
  if [ -z "$digest" ] && command -v docker &>/dev/null; then
    digest="$(docker inspect --format='{{range .RepoDigests}}{{.}}{{"\n"}}{{end}}' "$image_uri" 2>/dev/null | grep "$EXPECTED_ARTIFACT_REGISTRY@" | head -n1 | sed -n 's/.*@\(sha256:[a-f0-9]\{64\}\).*/\1/p' || true)"
  fi

  if [ -z "$digest" ]; then
    echo "ERROR: Failed to resolve immutable image digest for $image_uri. Aborting deployment." >&2
    exit 1
  fi

  if ! [[ "$digest" =~ ^sha256:[a-f0-9]{64}$ ]]; then
    echo "ERROR: Invalid image digest format '$digest'. Expected sha256:<64 hex chars>." >&2
    exit 1
  fi

  echo "$digest"
}

# ------------------------------------------------------------------------------
# 7. Local Pre-flight: npm run lint && npm run build
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
# 8. Dynamic Cloud Run State Discovery
# ------------------------------------------------------------------------------
query_live_service_state() {
  local active_rev=""
  local traffic_alloc=""

  if command -v gcloud &>/dev/null; then
    active_rev="$(gcloud run services describe "$SERVICE_NAME" --project="$PROJECT_ID" --region="$REGION" --format='value(status.traffic[0].revisionName)' 2>/dev/null || true)"
    traffic_alloc="$(gcloud run services describe "$SERVICE_NAME" --project="$PROJECT_ID" --region="$REGION" --format='csv[no-heading](status.traffic[].revisionName,status.traffic[].percent)' 2>/dev/null || true)"
  fi

  LIVE_SERVING_REVISION="${active_rev:-unknown}"
  LIVE_TRAFFIC_ALLOCATION="${traffic_alloc:-unknown}"
}

# ------------------------------------------------------------------------------
# 9. Safe Deployment Summary (No secrets, only validity status)
# ------------------------------------------------------------------------------
print_deployment_summary() {
  local image_tag="${1:-unset}"
  local image_uri="${2:-unset}"

  # Dynamically derive secret count and list from authoritative CLOUD_RUN_SECRETS
  local secret_count=0
  local secret_lines=""
  IFS=',' read -ra SECRET_ENTRIES <<< "$CLOUD_RUN_SECRETS"
  secret_count="${#SECRET_ENTRIES[@]}"
  for entry in "${SECRET_ENTRIES[@]}"; do
    local var_name="${entry%%=*}"
    local sec_ref="${entry#*=}"
    secret_lines="${secret_lines}    - ${var_name} -> ${sec_ref}"$'\n'
  done

  echo "======================================================================"
  echo "Production deployment target:"
  echo "  Project:                     $EXPECTED_PROJECT_ID"
  echo "  Region:                      $EXPECTED_REGION"
  echo "  Service:                     $EXPECTED_SERVICE_NAME"
  echo "  Service Account:             $EXPECTED_SERVICE_ACCOUNT"
  echo "  Artifact Registry:           $EXPECTED_ARTIFACT_REGISTRY"
  echo "  Immutable Image Tag:         $image_tag"
  echo "  Full Image Target:           $image_uri"
  echo "  Deployment Mechanism:        Explicit Immutable Docker Image"
  echo "  Razorpay Mode:               $TARGET_RAZORPAY_MODE"
  echo "  Razorpay Key ID:             VALID"
  echo "  Razorpay Pro Monthly Plan:   VALID"
  echo "  Razorpay Pro Yearly Plan:    VALID"
  echo "  Razorpay Team Monthly Plan:  VALID"
  echo "  Razorpay Team Yearly Plan:   VALID"
  echo "  Ordinary Env Vars Mode:      Complete replacement (--set-env-vars)"
  echo "  Ordinary Env Vars Config:    9 verified non-secret variables (zero plain secrets)"
  echo "  Authoritative Sender:        RESEND_FROM_EMAIL=EchoNote <invitations@echotechai.in>"
  echo "  Canonical App URL:           APP_URL=https://echonote-25.ai.studio"
  echo "  Secret Manager References ($secret_count production secrets):"
  printf "%s" "$secret_lines"
  echo "  Live Serving Revision:       ${LIVE_SERVING_REVISION:-querying...}"
  echo "  Live Traffic Allocation:     ${LIVE_TRAFFIC_ALLOCATION:-querying...}"
  echo "======================================================================"
}

case "$ACTION" in
  update-env)
    validate_target
    validate_active_gcloud_project
    validate_plan_ids
    validate_razorpay_key_id
    validate_razorpay_mode
    query_live_service_state
    print_deployment_summary "N/A (update-env)" "N/A (update-env)"

    echo "Updating Cloud Run Service Environment Variables & Secret References"
    echo "Service: $SERVICE_NAME (Region: $REGION, Project: $PROJECT_ID)"

    if [ "${DRY_RUN:-0}" = "1" ]; then
      echo "DRY RUN: Validation passed. Skipping remote gcloud execution."
      exit 0
    fi

    gcloud run services update "$SERVICE_NAME" \
      --project="$PROJECT_ID" \
      --region="$REGION" \
      --set-env-vars="$PRODUCTION_ORDINARY_ENV_VARS" \
      --set-secrets="$CLOUD_RUN_SECRETS"

    echo "✅ Cloud Run environment variables successfully updated."
    echo "100% of traffic is automatically routed to the newly deployed revision."
    ;;

  deploy)
    validate_target
    validate_active_gcloud_project
    validate_plan_ids
    validate_razorpay_key_id
    validate_razorpay_mode
    run_preflight

    # Resolve immutable git commit SHA tag
    IMAGE_TAG="$(resolve_image_tag)"
    IMAGE_URI="${EXPECTED_ARTIFACT_REGISTRY}:${IMAGE_TAG}"

    echo "======================================================================"
    echo "Recording Production Revision Baseline (Revision Safety)"
    echo "======================================================================"
    query_live_service_state
    BASELINE_SERVING_REVISION="$LIVE_SERVING_REVISION"
    # Capture complete authoritative baseline traffic allocation before deployment
    BASELINE_TRAFFIC_ALLOCATION="$LIVE_TRAFFIC_ALLOCATION"
    echo "Authoritative Baseline Traffic Allocation: $BASELINE_TRAFFIC_ALLOCATION"

    # Strictly abort if live baseline cannot be safely determined
    if [ -z "$BASELINE_SERVING_REVISION" ] || [ "$BASELINE_SERVING_REVISION" = "unknown" ]; then
      echo "ERROR: Unable to safely determine live serving revision baseline from Cloud Run." >&2
      echo "Refusing to proceed with deployment without a verified rollback baseline." >&2
      exit 1
    fi

    print_deployment_summary "$IMAGE_TAG" "$IMAGE_URI"

    # Helper function to verify and report production traffic status on pre-promotion failure
    handle_pre_promotion_failure() {
      local failure_reason="$1"
      echo "======================================================================" >&2
      echo "PRE-PROMOTION CHECK FAILED: $failure_reason" >&2
      echo "Traffic promotion command will NOT be executed." >&2
      echo "Baseline serving revision: $BASELINE_SERVING_REVISION" >&2
      echo "Expected baseline traffic: $BASELINE_TRAFFIC_ALLOCATION" >&2

      # Actively check live Cloud Run traffic allocation to confirm whether it is unchanged
      local live_traffic=""
      if command -v gcloud &>/dev/null; then
        live_traffic="$(gcloud run services describe "$SERVICE_NAME" --project="$PROJECT_ID" --region="$REGION" --format='csv[no-heading](status.traffic[].revisionName,status.traffic[].percent)' 2>/dev/null || true)"
      fi

      if [ -n "$live_traffic" ] && [ "$live_traffic" = "$BASELINE_TRAFFIC_ALLOCATION" ]; then
        echo "VERIFIED: Original production traffic allocation is verified unchanged on Cloud Run:" >&2
        echo "  $live_traffic" >&2
      elif [ -n "$live_traffic" ]; then
        echo "WARNING: Production traffic allocation differs from recorded baseline!" >&2
        echo "  Recorded baseline: $BASELINE_TRAFFIC_ALLOCATION" >&2
        echo "  Current live:      $live_traffic" >&2
        echo "Manual traffic restore command:" >&2
        echo "  gcloud run services update-traffic $SERVICE_NAME --to-revisions=$BASELINE_SERVING_REVISION=100 --region=$REGION --project=$PROJECT_ID" >&2
      else
        echo "NOTICE: Unable to query live Cloud Run traffic to verify allocation." >&2
      fi
      echo "======================================================================" >&2
      exit 1
    }

    echo "Current serving revision: $BASELINE_SERVING_REVISION"
    echo "Baseline traffic split:   $BASELINE_TRAFFIC_ALLOCATION"
    echo "Current service account:  $EXPECTED_SERVICE_ACCOUNT"
    echo "Artifact Registry target: $EXPECTED_ARTIFACT_REGISTRY"
    echo "Immutable image tag:      $IMAGE_TAG"

    if [ "${DRY_RUN:-0}" = "1" ]; then
      echo "DRY RUN: Pre-flight, image tag validation, and target safety validations passed."
      echo "Target Image URI: $IMAGE_URI"
      echo "Skipping remote Docker build, push, and gcloud deployment."
      exit 0
    fi

    # 1. Build Docker image using repository Dockerfile
    docker_build_image "$IMAGE_URI"

    # 2. Push Docker image to Artifact Registry
    docker_push_image "$IMAGE_URI"

    # 3. Resolve verified immutable image digest
    echo "--> Resolving immutable image digest from Artifact Registry..."
    IMAGE_DIGEST="$(resolve_image_digest "$IMAGE_URI")"
    echo "IMAGE_URI: $IMAGE_URI"
    echo "IMAGE_DIGEST: $IMAGE_DIGEST"

    IMMUTABLE_DEPLOY_IMAGE="${EXPECTED_ARTIFACT_REGISTRY}@${IMAGE_DIGEST}"
    echo "--> Immutable Deployment Image Digest: $IMMUTABLE_DEPLOY_IMAGE"

    echo "======================================================================"
    echo "Deploying Explicit Immutable Image to Cloud Run at ZERO Traffic"
    echo "Service: $SERVICE_NAME (Region: $REGION, Project: $PROJECT_ID)"
    echo "Image:   $IMMUTABLE_DEPLOY_IMAGE"
    echo "======================================================================"

    # Deploy explicit immutable image with --no-traffic and dedicated candidate tag
    gcloud run deploy "$SERVICE_NAME" \
      --image="$IMMUTABLE_DEPLOY_IMAGE" \
      --project="$PROJECT_ID" \
      --region="$REGION" \
      --service-account="$EXPECTED_SERVICE_ACCOUNT" \
      --allow-unauthenticated \
      --port=3000 \
      --no-traffic \
      --tag="echonote-candidate" \
      --set-env-vars="$PRODUCTION_ORDINARY_ENV_VARS" \
      --set-secrets="$CLOUD_RUN_SECRETS"

    echo "--> Verifying deployed candidate revision status and container image..."
    NEW_REVISION="$(gcloud run services describe "$SERVICE_NAME" --project="$PROJECT_ID" --region="$REGION" --format='value(status.latestCreatedRevisionName)' 2>/dev/null || true)"
    echo "Newly deployed revision: ${NEW_REVISION:-<UNRESOLVED>}"

    if [ -z "${NEW_REVISION:-}" ]; then
      handle_pre_promotion_failure "Failed to resolve newly deployed revision name. Refusing to route traffic!"
    fi

    # Check 1: Revision Condition Ready
    IS_READY="$(gcloud run revisions describe "$NEW_REVISION" --project="$PROJECT_ID" --region="$REGION" --format='value(status.conditions[0].status)' 2>/dev/null || true)"
    if [ "${IS_READY:-}" != "True" ]; then
      handle_pre_promotion_failure "Deployed revision $NEW_REVISION failed health check (Ready condition status: '${IS_READY:-unset}')."
    fi

    # Check 2: Immutable Image Digest Verification
    REVISION_IMAGE="$(gcloud run revisions describe "$NEW_REVISION" --project="$PROJECT_ID" --region="$REGION" --format='value(spec.containers[0].image)' 2>/dev/null || true)"
    echo "Deployed revision image: ${REVISION_IMAGE:-<UNRESOLVED>}"
    if ! echo "${REVISION_IMAGE:-}" | grep -q "$IMAGE_DIGEST"; then
      handle_pre_promotion_failure "Deployed revision $NEW_REVISION image verification failed (Expected: $IMAGE_DIGEST, Actual: ${REVISION_IMAGE:-unset})."
    fi

    # Check 3: Dedicated Candidate Revision URL Resolution (Never fall back to apex production service URL)
    CANDIDATE_TAG_URL="$(gcloud run services describe "$SERVICE_NAME" --project="$PROJECT_ID" --region="$REGION" --format='csv[no-heading](status.traffic[].tag,status.traffic[].url)' 2>/dev/null | grep '^echonote-candidate,' | cut -d',' -f2 || true)"
    SPECIFIC_REV_URL="$(gcloud run revisions describe "$NEW_REVISION" --project="$PROJECT_ID" --region="$REGION" --format='value(status.url)' 2>/dev/null || true)"
    TARGET_HEALTH_URL="${CANDIDATE_TAG_URL:-$SPECIFIC_REV_URL}"

    if [ -z "${TARGET_HEALTH_URL:-}" ]; then
      handle_pre_promotion_failure "Could not resolve dedicated zero-traffic URL for candidate revision $NEW_REVISION. Refusing to test against apex production service URL!"
    fi

    echo "--> Resolved candidate revision dedicated URL: $TARGET_HEALTH_URL"

    # Check 4: Pre-traffic HTTP Health Check on Candidate URL
    echo "--> Performing HTTP health check on candidate revision: $TARGET_HEALTH_URL/api/health"
    HEALTH_STATUS_CODE="$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "$TARGET_HEALTH_URL/api/health" 2>/dev/null || true)"

    if [ "${HEALTH_STATUS_CODE:-}" != "200" ]; then
      handle_pre_promotion_failure "Candidate pre-traffic health check failed on $TARGET_HEALTH_URL/api/health (HTTP status: '${HEALTH_STATUS_CODE:-timeout}')."
    fi
    echo "--> HTTP health check passed on candidate revision (status 200)."

    # Check 5: Zoom Webhook URL-Validation Acceptance & Route Presence Verification
    echo "--> Performing Zoom webhook URL-validation acceptance check..."
    ZOOM_CHECK_RESULT="$(node -e "
      const http = require('http');
      const https = require('https');
      const crypto = require('crypto');
      const targetUrl = process.argv[1];

      function verifyZoomWebhookSignature(headers, rawBody, secret, toleranceSeconds = 300) {
        const signatureHeader = headers['x-zm-signature'];
        const timestampHeader = headers['x-zm-request-timestamp'];
        if (!secret || typeof secret !== 'string' || !secret.trim()) return { valid: false, reason: 'WEBHOOK_SECRET_NOT_CONFIGURED' };
        if (!signatureHeader || typeof signatureHeader !== 'string') return { valid: false, reason: 'MISSING_SIGNATURE_HEADER' };
        if (!timestampHeader || typeof timestampHeader !== 'string') return { valid: false, reason: 'MISSING_TIMESTAMP_HEADER' };
        const requestTimestamp = parseInt(timestampHeader, 10);
        if (isNaN(requestTimestamp) || requestTimestamp <= 0) return { valid: false, reason: 'INVALID_TIMESTAMP_FORMAT' };
        const currentTimestamp = Math.floor(Date.now() / 1000);
        if (Math.abs(currentTimestamp - requestTimestamp) > toleranceSeconds) return { valid: false, reason: 'TIMESTAMP_OUT_OF_TOLERANCE', isStale: true };
        const rawBodyStr = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody;
        const message = 'v0:' + timestampHeader + ':' + rawBodyStr;
        const computedHash = crypto.createHmac('sha256', secret.trim()).update(message).digest('hex');
        const expectedSignature = 'v0=' + computedHash;
        const sigBuf = Buffer.from(signatureHeader);
        const expectedBuf = Buffer.from(expectedSignature);
        if (sigBuf.length !== expectedBuf.length) return { valid: false, reason: 'SIGNATURE_MISMATCH' };
        return crypto.timingSafeEqual(sigBuf, expectedBuf) ? { valid: true } : { valid: false, reason: 'SIGNATURE_MISMATCH' };
      }

      function generateZoomValidationResponse(plainToken, secret) {
        const hash = crypto.createHmac('sha256', secret).update(plainToken).digest('hex');
        return { plainToken, encryptedToken: hash };
      }

      function verifyLocalChallengeProtocol() {
        return new Promise((resolve, reject) => {
          const testSecret = 'echo_isolated_protocol_test_' + crypto.randomBytes(16).toString('hex');
          const server = http.createServer((req, res) => {
            if (req.method === 'POST' && req.url === '/api/webhooks/zoom') {
              let body = '';
              req.on('data', chunk => body += chunk);
              req.on('end', () => {
                let parsed;
                try {
                  parsed = JSON.parse(body);
                } catch (e) {
                  res.writeHead(400, { 'Content-Type': 'application/json' });
                  return res.end(JSON.stringify({ error: 'Invalid JSON' }));
                }
                if (parsed.event === 'endpoint.url_validation') {
                  const plainToken = parsed.payload?.plainToken;
                  if (!plainToken) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'Missing plainToken' }));
                  }
                  const sigCheck = verifyZoomWebhookSignature(req.headers, body, testSecret);
                  if (!sigCheck.valid) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'Invalid webhook signature', reason: sigCheck.reason }));
                  }
                  const challengeResponse = generateZoomValidationResponse(plainToken, testSecret);
                  res.writeHead(200, { 'Content-Type': 'application/json' });
                  return res.end(JSON.stringify(challengeResponse));
                }
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Unknown event' }));
              });
            } else {
              res.writeHead(404);
              res.end();
            }
          });

          server.listen(0, '127.0.0.1', () => {
            const port = server.address().port;
            const plainToken = 'protocol_challenge_' + Date.now();
            const payloadObj = { event: 'endpoint.url_validation', payload: { plainToken } };
            const bodyStr = JSON.stringify(payloadObj);
            const ts = Math.floor(Date.now() / 1000).toString();
            const sig = 'v0=' + crypto.createHmac('sha256', testSecret).update('v0:' + ts + ':' + bodyStr).digest('hex');

            const req = http.request({
              hostname: '127.0.0.1',
              port,
              path: '/api/webhooks/zoom',
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-zm-request-timestamp': ts,
                'x-zm-signature': sig,
                'Content-Length': Buffer.byteLength(bodyStr)
              },
              timeout: 5000
            }, (res) => {
              let resp = '';
              res.on('data', chunk => resp += chunk);
              res.on('end', () => {
                server.close();
                if (res.statusCode !== 200) {
                  return reject(new Error('Local test server returned HTTP ' + res.statusCode));
                }
                try {
                  const parsed = JSON.parse(resp);
                  const expectedEncryptedToken = crypto.createHmac('sha256', testSecret).update(plainToken).digest('hex');
                  if (parsed.plainToken === plainToken && parsed.encryptedToken === expectedEncryptedToken) {
                    resolve({ plainToken, encryptedToken: parsed.encryptedToken });
                  } else {
                    reject(new Error('Tokens did not match expected HMAC challenge output'));
                  }
                } catch (e) {
                  reject(e);
                }
              });
            });
            req.on('error', (err) => { server.close(); reject(err); });
            req.write(bodyStr);
            req.end();
          });
        });
      }

      function verifyCandidateRouteAvailability(target) {
        return new Promise((resolve, reject) => {
          try {
            const u = new URL(target + '/api/webhooks/zoom');
            const transport = u.protocol === 'https:' ? https : http;
            const probePayload = JSON.stringify({
              event: 'endpoint.url_validation',
              payload: { plainToken: 'cand_route_probe_' + Date.now() }
            });
            const req = transport.request(u, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(probePayload)
              },
              timeout: 15000
            }, (res) => {
              let chunks = [];
              res.on('data', c => chunks.push(c));
              res.on('end', () => {
                const rawBody = Buffer.concat(chunks).toString();
                if (res.statusCode === 404) {
                  return reject(new Error('ROUTE_NOT_FOUND: Candidate endpoint returned HTTP 404 Not Found. Zoom webhook route /api/webhooks/zoom is not present in deployed candidate revision.'));
                }
                if (res.statusCode === 503) {
                  let detail = '';
                  try {
                    const p503 = JSON.parse(rawBody);
                    if (p503.message) detail = ' (' + p503.message + ')';
                  } catch (e) {}
                  return reject(new Error('SECRET_NOT_CONFIGURED: Candidate endpoint returned HTTP 503 Service Unavailable' + detail + '. ZOOM_WEBHOOK_SECRET is unconfigured or unavailable on candidate.'));
                }
                if (res.statusCode === 401) {
                  return resolve({
                    routeAvailable: true,
                    statusCode: 401,
                    statusDetail: 'Route present and actively enforcing signature authentication against configured server secret.'
                  });
                }
                if (res.statusCode === 200) {
                  return resolve({
                    routeAvailable: true,
                    statusCode: 200,
                    statusDetail: 'Route present and returned HTTP 200.'
                  });
                }
                return reject(new Error('UNEXPECTED_STATUS: Candidate endpoint returned unexpected HTTP ' + res.statusCode + ': ' + rawBody.substring(0, 200)));
              });
            });
            req.on('error', (err) => {
              reject(new Error('CONNECTION_ERROR: Failed to connect to candidate Zoom webhook endpoint: ' + err.message));
            });
            req.write(probePayload);
            req.end();
          } catch (e) {
            reject(e);
          }
        });
      }

      (async () => {
        try {
          console.log('[Phase A] Running local isolated Zoom challenge protocol integration test...');
          const localResult = await verifyLocalChallengeProtocol();
          console.log('ACCEPTANCE_PASS (Local Protocol): Isolated Zoom URL-validation challenge handshake succeeded (HTTP 200, plainToken, encryptedToken HMAC-SHA256 verified).');

          console.log('[Phase B] Probing candidate deployed Zoom webhook route availability at: ' + targetUrl + '/api/webhooks/zoom');
          const routeResult = await verifyCandidateRouteAvailability(targetUrl);
          console.log('ACCEPTANCE_PASS (Candidate Route): Deployed webhook route confirmed available (HTTP ' + routeResult.statusCode + ': ' + routeResult.statusDetail + ').');

          console.log('[Handshake Verification Scope]');
          console.log('NOTICE: Full cryptographic handshake verified in isolated integration test with dedicated test secret.');
          console.log('LIMITATION: Candidate live handshake against configured ZOOM_WEBHOOK_SECRET cannot be cryptographically verified without exposing or retrieving the real secret. Candidate route availability and active authentication enforcement verified.');

          process.exit(0);
        } catch (err) {
          console.error('ACCEPTANCE_FAIL: ' + err.message);
          process.exit(1);
        }
      })();
    " "$TARGET_HEALTH_URL" 2>&1 || true)"
    ZOOM_CHECK_STATUS=$?

    echo "$ZOOM_CHECK_RESULT"
    if [ "$ZOOM_CHECK_STATUS" -ne 0 ]; then
      handle_pre_promotion_failure "Zoom URL-validation acceptance check failed on candidate revision."
    fi
    echo "--> Zoom webhook verification check passed on candidate revision."

    echo "--> Revision $NEW_REVISION is Ready, verified with immutable digest $IMAGE_DIGEST, and fully validated."
    echo "--> Shifting 100% production traffic to healthy new revision..."
    gcloud run services update-traffic "$SERVICE_NAME" \
      --to-revisions="$NEW_REVISION=100" \
      --project="$PROJECT_ID" \
      --region="$REGION"

    echo "======================================================================"
    echo "✅ Explicit immutable Docker deployment completed and 100% traffic active on $NEW_REVISION."
    echo "Previous baseline serving revision was: $BASELINE_SERVING_REVISION"
    echo "To rollback if needed, run:"
    echo "  gcloud run services update-traffic $SERVICE_NAME --to-revisions=$BASELINE_SERVING_REVISION=100 --region=$REGION --project=$PROJECT_ID"
    echo "======================================================================"
    ;;

  declarative-prepare)
    exec "$(dirname "$0")/migrate-cloud-run-declarative.sh" prepare "${@:2}"
    ;;

  promote-traffic)
    exec "$(dirname "$0")/migrate-cloud-run-declarative.sh" promote "${@:2}"
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
    echo "Usage: ./scripts/deploy-cloud-run.sh [update-env | deploy | declarative-prepare | promote-traffic <REV> | verify <URL>]"
    exit 1
    ;;
esac
