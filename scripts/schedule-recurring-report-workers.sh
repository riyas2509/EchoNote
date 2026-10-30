#!/usr/bin/env bash
# ==============================================================================
# EchoNote Recurring Report Worker & Dispatcher Cloud Scheduler Provisioning
# ==============================================================================
# Prepares and validates recurring Cloud Scheduler jobs for:
#   1. echonote-recurring-report-worker:
#      Target Endpoint:   POST /api/internal/reports/process-recurring
#      Cadence:           */15 * * * * (Every 15 minutes)
#      Timeout:           300s (5 minutes)
#      Payload:           {"batchSize": 10}
#
#   2. echonote-recurring-report-dispatcher:
#      Target Endpoint:   POST /api/internal/reports/dispatch-deliveries
#      Cadence:           * * * * * (Every 1 minute)
#      Timeout:           120s (2 minutes)
#      Payload:           {"batchSize": 10}
#
# Environment Profiles Supported:
#   1. Production (--environment=production or --prod):
#      Project:         echonote-2509
#      Region:          us-west1
#      Canonical App:   https://echonote-zfo2izdqla-uw.a.run.app
#      Scheduler SA:    echonote-scheduler-invoker@echonote-2509.iam.gserviceaccount.com
#      Secret:          echonote-cron-secret:latest (CRON_SECRET)
#
#   2. Staging (--environment=staging or --staging):
#      Project:         echonote-staging
#      Region:          us-west1
#      Canonical App:   https://echonote-staging-3fgo4kkjgq-uw.a.run.app
#      Scheduler SA:    echonote-scheduler-invoker@echonote-staging.iam.gserviceaccount.com
#      Secret:          echonote-cron-secret:latest (CRON_SECRET)
#
# Authentication Modes:
#   - OIDC (Recommended, Zero-Secret):
#     Uses Cloud Scheduler native OIDC token generation:
#       --oidc-service-account-email="<SCHEDULER_SA>"
#       --oidc-token-audience="<APP_URL>"
#   - Header (Shared Secret Fallback):
#     Uses HTTP Header: x-cron-key=<CRON_SECRET_VALUE>
#
# Safety Boundaries & Hardening:
#   - Default execution is PRINT / DRY-RUN (safe, no mutations).
#   - Missing environment or required parameters displays clear usage and exits 1.
#   - Live mutation strictly requires explicit --execute-live flag.
#   - Validates that project ID and service URL match the selected environment.
#   - Staging and production are strictly isolated.
# ==============================================================================

set -euo pipefail

# Production Constants
readonly PROD_PROJECT_ID="echonote-2509"
readonly PROD_REGION="us-west1"
readonly PROD_SERVICE_URL="https://echonote-zfo2izdqla-uw.a.run.app"
readonly PROD_SERVICE_ACCOUNT="echonote-scheduler-invoker@echonote-2509.iam.gserviceaccount.com"
readonly PROD_SECRET_NAME="echonote-cron-secret"

# Staging Constants (strictly matched to verified staging Cloud Run URL)
readonly STAGING_PROJECT_ID="echonote-staging"
readonly STAGING_REGION="us-west1"
readonly STAGING_SERVICE_URL="https://echonote-staging-3fgo4kkjgq-uw.a.run.app"
readonly STAGING_SERVICE_ACCOUNT="echonote-scheduler-invoker@echonote-staging.iam.gserviceaccount.com"
readonly STAGING_SECRET_NAME="echonote-cron-secret"

# Job 1 Constants: Execution Worker
readonly JOB_WORKER_NAME="echonote-recurring-report-worker"
readonly SCHEDULE_WORKER="*/15 * * * *"
readonly TIMEZONE="Etc/UTC"
readonly DEADLINE_WORKER="300s"
readonly ENDPOINT_WORKER="/api/internal/reports/process-recurring"
readonly PAYLOAD_WORKER='{"batchSize":10}'

# Job 2 Constants: Delivery Dispatcher
readonly JOB_DISPATCHER_NAME="echonote-recurring-report-dispatcher"
readonly SCHEDULE_DISPATCHER="* * * * *"
readonly DEADLINE_DISPATCHER="120s"
readonly ENDPOINT_DISPATCHER="/api/internal/reports/dispatch-deliveries"
readonly PAYLOAD_DISPATCHER='{"batchSize":10}'

ENVIRONMENT=""
MODE="print"
AUTH_TYPE="oidc"

usage() {
  cat <<EOF
Usage: $0 --environment=<production|staging> [OPTIONS]

Required:
  --environment=<production|staging>   Target cloud environment profile (or --prod / --staging)

Options:
  --execute-live                       Execute live gcloud mutations (default is dry-run / print)
  --print, --dry-run                   Print configuration and plan without mutating (default)
  --auth=oidc                          Use Cloud Scheduler native OIDC authentication (default)
  --auth=header                        Use shared secret x-cron-key header authentication
  --help, -h                           Display this help message

Examples:
  # Dry-run inspection for production
  $0 --environment=production

  # Dry-run inspection for staging
  $0 --environment=staging

  # Live execution (requires operator authorization)
  $0 --environment=staging --execute-live
EOF
}

# Parse Arguments
for arg in "$@"; do
  case "$arg" in
    --environment=production|--environment=prod|--prod)
      ENVIRONMENT="production"
      ;;
    --environment=staging|--environment=stage|--staging)
      ENVIRONMENT="staging"
      ;;
    --environment=*)
      echo "ERROR: Invalid environment '${arg#*=}': must be 'production' or 'staging'." >&2
      exit 1
      ;;
    --execute-live)
      MODE="execute"
      ;;
    --print|--dry-run|--inspect)
      MODE="print"
      ;;
    --auth=oidc|--oidc)
      AUTH_TYPE="oidc"
      ;;
    --auth=header|--header|--cron-key)
      AUTH_TYPE="header"
      ;;
    --auth=*)
      echo "ERROR: Invalid auth mode '${arg#*=}': must be 'oidc' or 'header'." >&2
      exit 1
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "ERROR: Unknown option '$arg'." >&2
      usage >&2
      exit 1
      ;;
  esac
done

# Validate Required Environment
if [ -z "$ENVIRONMENT" ]; then
  echo "ERROR: Missing required --environment argument." >&2
  usage >&2
  exit 1
fi

# Resolve Environment-Specific Targets
if [ "$ENVIRONMENT" = "production" ]; then
  TARGET_PROJECT="$PROD_PROJECT_ID"
  TARGET_REGION="$PROD_REGION"
  TARGET_SERVICE_URL="$PROD_SERVICE_URL"
  TARGET_SERVICE_ACCOUNT="$PROD_SERVICE_ACCOUNT"
  TARGET_SECRET_NAME="$PROD_SECRET_NAME"
else
  TARGET_PROJECT="$STAGING_PROJECT_ID"
  TARGET_REGION="$STAGING_REGION"
  TARGET_SERVICE_URL="$STAGING_SERVICE_URL"
  TARGET_SERVICE_ACCOUNT="$STAGING_SERVICE_ACCOUNT"
  TARGET_SECRET_NAME="$STAGING_SECRET_NAME"
fi

URI_WORKER="${TARGET_SERVICE_URL}${ENDPOINT_WORKER}"
URI_DISPATCHER="${TARGET_SERVICE_URL}${ENDPOINT_DISPATCHER}"

# Staging / Production Isolation Sanity Checks
if [ "$ENVIRONMENT" = "staging" ]; then
  if [ "$TARGET_PROJECT" = "$PROD_PROJECT_ID" ]; then
    echo "ERROR: Staging environment cannot target production project '$PROD_PROJECT_ID'." >&2
    exit 1
  fi
  if [ "$TARGET_SERVICE_URL" = "$PROD_SERVICE_URL" ]; then
    echo "ERROR: Staging environment cannot target production service URL." >&2
    exit 1
  fi
fi

if [ "$ENVIRONMENT" = "production" ]; then
  if [ "$TARGET_PROJECT" != "$PROD_PROJECT_ID" ]; then
    echo "ERROR: Production environment requires project '$PROD_PROJECT_ID', got '$TARGET_PROJECT'." >&2
    exit 1
  fi
  if [ "$TARGET_SERVICE_URL" != "$PROD_SERVICE_URL" ]; then
    echo "ERROR: Production environment requires production URL '$PROD_SERVICE_URL', got '$TARGET_SERVICE_URL'." >&2
    exit 1
  fi
fi

echo "=============================================================================="
echo "EchoNote Recurring Report Worker & Dispatcher Cloud Scheduler Provisioning Plan"
echo "=============================================================================="
echo "  Environment:         $ENVIRONMENT"
echo "  Target Project:      $TARGET_PROJECT"
echo "  Target Region:       $TARGET_REGION"
echo "  Target Base URL:          $TARGET_SERVICE_URL"
echo "  Target Service Account:   $TARGET_SERVICE_ACCOUNT"
echo "  Authentication:      $AUTH_TYPE"
echo "  Execution Mode:           $MODE"
echo ""
echo "  Job 1 (Execution Worker): $JOB_WORKER_NAME"
echo "    - Endpoint:             $URI_WORKER"
echo "    - Cadence:              $SCHEDULE_WORKER ($TIMEZONE)"
echo "    - Timeout:              $DEADLINE_WORKER"
echo "    - Payload:              $PAYLOAD_WORKER"
echo ""
echo "  Job 2 (Delivery Dispatch):$JOB_DISPATCHER_NAME"
echo "    - Endpoint:             $URI_DISPATCHER"
echo "    - Cadence:              $SCHEDULE_DISPATCHER ($TIMEZONE)"
echo "    - Timeout:              $DEADLINE_DISPATCHER"
echo "    - Payload:              $PAYLOAD_DISPATCHER"
echo "=============================================================================="

# Build gcloud flags
AUTH_FLAGS=()
if [ "$AUTH_TYPE" = "oidc" ]; then
  AUTH_FLAGS=(
    "--oidc-service-account-email=$TARGET_SERVICE_ACCOUNT"
    "--oidc-token-audience=$TARGET_SERVICE_URL"
  )
else
  AUTH_FLAGS=(
    "--headers=Content-Type=application/json,x-cron-key=<CRON_SECRET_VALUE>"
  )
fi

CMD_WORKER_DESCRIBE="gcloud scheduler jobs describe $JOB_WORKER_NAME --project=$TARGET_PROJECT --location=$TARGET_REGION"
CMD_WORKER_CREATE="gcloud scheduler jobs create http $JOB_WORKER_NAME \
  --project=$TARGET_PROJECT \
  --location=$TARGET_REGION \
  --schedule=\"$SCHEDULE_WORKER\" \
  --time-zone=\"$TIMEZONE\" \
  --attempt-deadline=$DEADLINE_WORKER \
  --uri=\"$URI_WORKER\" \
  --http-method=POST \
  --message-body='$PAYLOAD_WORKER' \
  ${AUTH_FLAGS[*]}"

CMD_WORKER_UPDATE="gcloud scheduler jobs update http $JOB_WORKER_NAME \
  --project=$TARGET_PROJECT \
  --location=$TARGET_REGION \
  --schedule=\"$SCHEDULE_WORKER\" \
  --time-zone=\"$TIMEZONE\" \
  --attempt-deadline=$DEADLINE_WORKER \
  --uri=\"$URI_WORKER\" \
  --http-method=POST \
  --message-body='$PAYLOAD_WORKER' \
  ${AUTH_FLAGS[*]}"

CMD_DISPATCHER_DESCRIBE="gcloud scheduler jobs describe $JOB_DISPATCHER_NAME --project=$TARGET_PROJECT --location=$TARGET_REGION"
CMD_DISPATCHER_CREATE="gcloud scheduler jobs create http $JOB_DISPATCHER_NAME \
  --project=$TARGET_PROJECT \
  --location=$TARGET_REGION \
  --schedule=\"$SCHEDULE_DISPATCHER\" \
  --time-zone=\"$TIMEZONE\" \
  --attempt-deadline=$DEADLINE_DISPATCHER \
  --uri=\"$URI_DISPATCHER\" \
  --http-method=POST \
  --message-body='$PAYLOAD_DISPATCHER' \
  ${AUTH_FLAGS[*]}"

CMD_DISPATCHER_UPDATE="gcloud scheduler jobs update http $JOB_DISPATCHER_NAME \
  --project=$TARGET_PROJECT \
  --location=$TARGET_REGION \
  --schedule=\"$SCHEDULE_DISPATCHER\" \
  --time-zone=\"$TIMEZONE\" \
  --attempt-deadline=$DEADLINE_DISPATCHER \
  --uri=\"$URI_DISPATCHER\" \
  --http-method=POST \
  --message-body='$PAYLOAD_DISPATCHER' \
  ${AUTH_FLAGS[*]}"

if [ "$MODE" = "print" ]; then
  echo ""
  echo "[DRY-RUN / PRINT MODE]: No mutations will be executed."
  echo ""
  echo "--- Job 1: $JOB_WORKER_NAME ---"
  echo "Existence Check:"
  echo "  $CMD_WORKER_DESCRIBE"
  echo "Create (if absent):"
  echo "  $CMD_WORKER_CREATE"
  echo "Update (if exists):"
  echo "  $CMD_WORKER_UPDATE"
  echo ""
  echo "--- Job 2: $JOB_DISPATCHER_NAME ---"
  echo "Existence Check:"
  echo "  $CMD_DISPATCHER_DESCRIBE"
  echo "Create (if absent):"
  echo "  $CMD_DISPATCHER_CREATE"
  echo "Update (if exists):"
  echo "  $CMD_DISPATCHER_UPDATE"
  echo ""
  echo "To execute these commands, re-run with: --execute-live"
  exit 0
fi

# Live Execution requires explicit operator confirmation
echo ""
echo "LIVE EXECUTION: Applying Cloud Scheduler changes to project $TARGET_PROJECT..."

apply_job() {
  local name="$1"
  local desc_cmd="$2"
  local create_cmd="$3"
  local update_cmd="$4"

  if eval "$desc_cmd" &>/dev/null; then
    echo "Job '$name' exists. Updating..."
    eval "$update_cmd"
    echo "Job '$name' updated successfully."
  else
    echo "Job '$name' absent. Creating..."
    eval "$create_cmd"
    echo "Job '$name' created successfully."
  fi
}

apply_job "$JOB_WORKER_NAME" "$CMD_WORKER_DESCRIBE" "$CMD_WORKER_CREATE" "$CMD_WORKER_UPDATE"
apply_job "$JOB_DISPATCHER_NAME" "$CMD_DISPATCHER_DESCRIBE" "$CMD_DISPATCHER_CREATE" "$CMD_DISPATCHER_UPDATE"
echo ""
echo "✅ All recurring report worker and dispatcher jobs applied successfully."
