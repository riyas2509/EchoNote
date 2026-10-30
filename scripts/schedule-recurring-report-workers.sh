#!/usr/bin/env bash
# ==============================================================================
# EchoNote Recurring Report Worker Cloud Scheduler Provisioning Script
# ==============================================================================
# Prepares and validates recurring Cloud Scheduler jobs for:
#   Job Name:          echonote-recurring-report-worker
#   Target Endpoint:   POST /api/internal/reports/process-recurring
#   Cadence:           */15 * * * * (Every 15 minutes)
#   Timezone:          "Etc/UTC"
#   Timeout:           300s (5 minutes)
#   Payload:           {"batchSize": 10}
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
#      Canonical App:   https://echonote-staging-zfo2izdqla-uw.a.run.app
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

# Staging Constants
readonly STAGING_PROJECT_ID="echonote-staging"
readonly STAGING_REGION="us-west1"
readonly STAGING_SERVICE_URL="https://echonote-staging-zfo2izdqla-uw.a.run.app"
readonly STAGING_SERVICE_ACCOUNT="echonote-scheduler-invoker@echonote-staging.iam.gserviceaccount.com"
readonly STAGING_SECRET_NAME="echonote-cron-secret"

# Job Constants
readonly JOB_NAME="echonote-recurring-report-worker"
readonly SCHEDULE="*/15 * * * *"
readonly TIMEZONE="Etc/UTC"
readonly ATTEMPT_DEADLINE="300s"
readonly ENDPOINT_PATH="/api/internal/reports/process-recurring"
readonly PAYLOAD='{"batchSize":10}'

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

TARGET_URI="${TARGET_SERVICE_URL}${ENDPOINT_PATH}"

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
echo "EchoNote Recurring Report Worker Cloud Scheduler Provisioning Plan"
echo "=============================================================================="
echo "  Environment:         $ENVIRONMENT"
echo "  Target Project:      $TARGET_PROJECT"
echo "  Target Region:       $TARGET_REGION"
echo "  Job Name:            $JOB_NAME"
echo "  Cadence:             $SCHEDULE ($TIMEZONE)"
echo "  Timeout:             $ATTEMPT_DEADLINE"
echo "  Target Endpoint:     $TARGET_URI"
echo "  Payload:             $PAYLOAD"
echo "  Authentication:      $AUTH_TYPE"
echo "  Execution Mode:      $MODE"
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

CMD_DESCRIBE="gcloud scheduler jobs describe $JOB_NAME --project=$TARGET_PROJECT --location=$TARGET_REGION"
CMD_CREATE="gcloud scheduler jobs create http $JOB_NAME \
  --project=$TARGET_PROJECT \
  --location=$TARGET_REGION \
  --schedule=\"$SCHEDULE\" \
  --time-zone=\"$TIMEZONE\" \
  --attempt-deadline=$ATTEMPT_DEADLINE \
  --uri=\"$TARGET_URI\" \
  --http-method=POST \
  --message-body='$PAYLOAD' \
  ${AUTH_FLAGS[*]}"

CMD_UPDATE="gcloud scheduler jobs update http $JOB_NAME \
  --project=$TARGET_PROJECT \
  --location=$TARGET_REGION \
  --schedule=\"$SCHEDULE\" \
  --time-zone=\"$TIMEZONE\" \
  --attempt-deadline=$ATTEMPT_DEADLINE \
  --uri=\"$TARGET_URI\" \
  --http-method=POST \
  --message-body='$PAYLOAD' \
  ${AUTH_FLAGS[*]}"

if [ "$MODE" = "print" ]; then
  echo ""
  echo "[DRY-RUN / PRINT MODE]: No mutations will be executed."
  echo ""
  echo "Existence Check Command:"
  echo "  $CMD_DESCRIBE"
  echo ""
  echo "Create Command (if job is absent):"
  echo "  $CMD_CREATE"
  echo ""
  echo "Update Command (if job already exists):"
  echo "  $CMD_UPDATE"
  echo ""
  echo "To execute these commands, re-run with: --execute-live"
  exit 0
fi

# Live Execution requires explicit operator confirmation
echo ""
echo "LIVE EXECUTION: Applying Cloud Scheduler changes to project $TARGET_PROJECT..."

if $CMD_DESCRIBE &>/dev/null; then
  echo "Job '$JOB_NAME' exists. Updating..."
  eval "$CMD_UPDATE"
  echo "Job '$JOB_NAME' updated successfully."
else
  echo "Job '$JOB_NAME' absent. Creating..."
  eval "$CMD_CREATE"
  echo "Job '$JOB_NAME' created successfully."
fi
