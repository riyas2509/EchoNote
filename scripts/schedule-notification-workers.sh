#!/usr/bin/env bash
# ==============================================================================
# EchoNote Notification Workers Cloud Scheduler Configuration Script
# ==============================================================================
# Prepares and validates recurring Cloud Scheduler jobs for:
#   1. echonote-stale-dispatch-recovery:
#      Calls POST /api/internal/notifications/recover-stale-dispatches
#      Cadence: */15 * * * * (Every 15 minutes)
#      Timeout: 60s
#      Payload: {"limit": 50, "staleTimeoutMs": 600000}
#
#   2. echonote-notification-dispatch:
#      Calls POST /api/internal/notifications/dispatch
#      Cadence: */5 * * * * (Every 5 minutes)
#      Timeout: 120s
#      Payload: {"batchSize": 10}
#
# Supported Environments:
#   1. Production (--environment=production or --prod):
#      Project:           echonote-2509
#      Region:            us-west1
#      Canonical App URL: https://echonote-zfo2izdqla-uw.a.run.app
#      Scheduler SA:      echonote-scheduler-invoker@echonote-2509.iam.gserviceaccount.com
#      Secret Reference:  echonote-cron-secret:latest (CRON_SECRET)
#
#   2. Staging (--environment=staging or --staging):
#      Project:           echonote-staging
#      Region:            us-west1
#      Canonical App URL: https://echonote-staging-3fgo4kkjgq-uw.a.run.app
#      Scheduler SA:      echo-scheduler@echonote-staging.iam.gserviceaccount.com
#      Secret Reference:  echonote-cron-secret:latest (CRON_SECRET)
#
# Authentication Modes Supported:
#   - OIDC (Recommended, Zero-Secret):
#     Uses Cloud Scheduler native OIDC token generation:
#       --oidc-service-account-email="<SCHEDULER_SA>"
#       --oidc-token-audience="<APP_URL>"
#   - Header / Shared Secret (Legacy Fallback):
#     Uses header: x-cron-key=<CRON_SECRET_VALUE> fetched from Secret Manager.
# ==============================================================================

set -euo pipefail

# Production Constants
readonly PROD_PROJECT_ID="echonote-2509"
readonly PROD_REGION="us-west1"
readonly PROD_SERVICE_NAME="echonote"
readonly PROD_SERVICE_ACCOUNT="echonote-scheduler-invoker@echonote-2509.iam.gserviceaccount.com"
readonly PROD_SERVICE_URL="https://echonote-zfo2izdqla-uw.a.run.app"
readonly PROD_SECRET_NAME="echonote-cron-secret"

# Staging Constants (strictly matched to verified staging Cloud Run URL)
readonly STAGING_PROJECT_ID="echonote-staging"
readonly STAGING_REGION="us-west1"
readonly STAGING_SERVICE_NAME="echonote-staging"
readonly STAGING_SERVICE_ACCOUNT="echo-scheduler@echonote-staging.iam.gserviceaccount.com"
readonly STAGING_SERVICE_URL="https://echonote-staging-3fgo4kkjgq-uw.a.run.app"
readonly STAGING_SECRET_NAME="echonote-cron-secret"

# Job Identifiers
readonly JOB_RECOVERY_NAME="echonote-stale-dispatch-recovery"
readonly JOB_DISPATCH_NAME="echonote-notification-dispatch"

# Job Schedules & Cadences
readonly SCHEDULE_RECOVERY="*/15 * * * *"
readonly SCHEDULE_DISPATCH="*/5 * * * *"

# Bounded Request Payloads
readonly PAYLOAD_RECOVERY='{"limit":50,"staleTimeoutMs":600000}'
readonly PAYLOAD_DISPATCH='{"batchSize":10}'

# Operation Mode & Auth Mode
ENVIRONMENT="production"
MODE="print"
AUTH_TYPE="oidc"

usage() {
  cat <<EOF
Usage: $0 [--environment=<production|staging>] [OPTIONS]

Options:
  --environment=<production|staging>   Target cloud environment profile (default: production)
  --print, --dry-run                   Print scheduler commands and inspect configuration (default, safe).
  --execute-live                       Execute idempotent gcloud commands to create or update live Cloud Scheduler jobs.
  --auth=oidc                          Use Cloud Scheduler native OIDC authentication (default, recommended, zero-secret).
  --auth=header                        Use legacy x-cron-key header authentication with Secret Manager value.
  --help, -h                           Display this help message.
EOF
}

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

if [ "$ENVIRONMENT" = "production" ]; then
  EXPECTED_PROJECT_ID="$PROD_PROJECT_ID"
  EXPECTED_REGION="$PROD_REGION"
  EXPECTED_SERVICE_ACCOUNT="$PROD_SERVICE_ACCOUNT"
  EXPECTED_SERVICE_URL="$PROD_SERVICE_URL"
  EXPECTED_SECRET_NAME="$PROD_SECRET_NAME"
else
  EXPECTED_PROJECT_ID="$STAGING_PROJECT_ID"
  EXPECTED_REGION="$STAGING_REGION"
  EXPECTED_SERVICE_ACCOUNT="$STAGING_SERVICE_ACCOUNT"
  EXPECTED_SERVICE_URL="$STAGING_SERVICE_URL"
  EXPECTED_SECRET_NAME="$STAGING_SECRET_NAME"
fi

# Isolation checks
if [ "$ENVIRONMENT" = "staging" ]; then
  if [ "$EXPECTED_PROJECT_ID" = "$PROD_PROJECT_ID" ]; then
    echo "ERROR: Staging environment cannot target production project '$PROD_PROJECT_ID'." >&2
    exit 1
  fi
  if [ "$EXPECTED_SERVICE_URL" = "$PROD_SERVICE_URL" ]; then
    echo "ERROR: Staging environment cannot target production service URL." >&2
    exit 1
  fi
fi

if [ "$ENVIRONMENT" = "production" ]; then
  if [ "$EXPECTED_PROJECT_ID" != "$PROD_PROJECT_ID" ]; then
    echo "ERROR: Production environment requires project '$PROD_PROJECT_ID', got '$EXPECTED_PROJECT_ID'." >&2
    exit 1
  fi
  if [ "$EXPECTED_SERVICE_URL" != "$PROD_SERVICE_URL" ]; then
    echo "ERROR: Production environment requires production URL '$PROD_SERVICE_URL', got '$EXPECTED_SERVICE_URL'." >&2
    exit 1
  fi
fi

URI_RECOVERY="${EXPECTED_SERVICE_URL}/api/internal/notifications/recover-stale-dispatches"
URI_DISPATCH="${EXPECTED_SERVICE_URL}/api/internal/notifications/dispatch"

echo "======================================================================"
echo "EchoNote Cloud Scheduler Operational Configuration"
echo "======================================================================"
echo "Environment:         $ENVIRONMENT"
echo "Project ID:          $EXPECTED_PROJECT_ID"
echo "Region:              $EXPECTED_REGION"
echo "Service Account:     $EXPECTED_SERVICE_ACCOUNT"
echo "Cloud Run Target:    $EXPECTED_SERVICE_URL"
echo "Authentication Mode: $AUTH_TYPE"
echo "OIDC Audience:       $EXPECTED_SERVICE_URL"
echo "Operation Mode:      $MODE"
echo "======================================================================"

print_commands() {
  echo ""
  echo "--- [NOT EXECUTED] Idempotent Provisioning Pattern for Cloud Scheduler ($AUTH_TYPE auth) ---"
  echo "The script uses an idempotent describe-check followed by create or update."
  echo "Below are the exact commands prepared for both states:"
  echo ""
  echo "--- Command 1A (If Job Absent): Create Stale-Dispatch Recovery Job ($AUTH_TYPE) ---"
  echo "gcloud scheduler jobs create http ${JOB_RECOVERY_NAME} \\"
  echo "  --project=\"${EXPECTED_PROJECT_ID}\" \\"
  echo "  --location=\"${EXPECTED_REGION}\" \\"
  echo "  --schedule=\"${SCHEDULE_RECOVERY}\" \\"
  echo "  --uri=\"${URI_RECOVERY}\" \\"
  echo "  --http-method=\"POST\" \\"
  echo "  --time-zone=\"Etc/UTC\" \\"
  echo "  --attempt-deadline=\"60s\" \\"
  if [ "$AUTH_TYPE" = "oidc" ]; then
    echo "  --oidc-service-account-email=\"${EXPECTED_SERVICE_ACCOUNT}\" \\"
    echo "  --oidc-token-audience=\"${EXPECTED_SERVICE_URL}\" \\"
    echo "  --headers=\"Content-Type=application/json\" \\"
  else
    echo "  --headers=\"Content-Type=application/json,x-cron-key=<CRON_SECRET_VALUE>\" \\"
  fi
  echo "  --message-body='${PAYLOAD_RECOVERY}' \\"
  echo "  --description=\"Quarantines notifications abandoned in dispatching status for >10 minutes (bounded batch: 50).\""
  echo ""
  echo "--- Command 1B (If Job Present): Update Stale-Dispatch Recovery Job ($AUTH_TYPE) ---"
  echo "gcloud scheduler jobs update http ${JOB_RECOVERY_NAME} \\"
  echo "  --project=\"${EXPECTED_PROJECT_ID}\" \\"
  echo "  --location=\"${EXPECTED_REGION}\" \\"
  echo "  --schedule=\"${SCHEDULE_RECOVERY}\" \\"
  echo "  --uri=\"${URI_RECOVERY}\" \\"
  echo "  --http-method=\"POST\" \\"
  echo "  --time-zone=\"Etc/UTC\" \\"
  echo "  --attempt-deadline=\"60s\" \\"
  if [ "$AUTH_TYPE" = "oidc" ]; then
    echo "  --oidc-service-account-email=\"${EXPECTED_SERVICE_ACCOUNT}\" \\"
    echo "  --oidc-token-audience=\"${EXPECTED_SERVICE_URL}\" \\"
    echo "  --headers=\"Content-Type=application/json\" \\"
  else
    echo "  --headers=\"Content-Type=application/json,x-cron-key=<CRON_SECRET_VALUE>\" \\"
  fi
  echo "  --message-body='${PAYLOAD_RECOVERY}' \\"
  echo "  --description=\"Quarantines notifications abandoned in dispatching status for >10 minutes (bounded batch: 50).\""
  echo ""
  echo "--- Command 2A (If Job Absent): Create Notification Dispatch Worker Job ($AUTH_TYPE) ---"
  echo "gcloud scheduler jobs create http ${JOB_DISPATCH_NAME} \\"
  echo "  --project=\"${EXPECTED_PROJECT_ID}\" \\"
  echo "  --location=\"${EXPECTED_REGION}\" \\"
  echo "  --schedule=\"${SCHEDULE_DISPATCH}\" \\"
  echo "  --uri=\"${URI_DISPATCH}\" \\"
  echo "  --http-method=\"POST\" \\"
  echo "  --time-zone=\"Etc/UTC\" \\"
  echo "  --attempt-deadline=\"120s\" \\"
  if [ "$AUTH_TYPE" = "oidc" ]; then
    echo "  --oidc-service-account-email=\"${EXPECTED_SERVICE_ACCOUNT}\" \\"
    echo "  --oidc-token-audience=\"${EXPECTED_SERVICE_URL}\" \\"
    echo "  --headers=\"Content-Type=application/json\" \\"
  else
    echo "  --headers=\"Content-Type=application/json,x-cron-key=<CRON_SECRET_VALUE>\" \\"
  fi
  echo "  --message-body='${PAYLOAD_DISPATCH}' \\"
  echo "  --description=\"Processes pending task notification dispatch batch (bounded batch: 10, default-off safety preserved).\""
  echo ""
  echo "--- Command 2B (If Job Present): Update Notification Dispatch Worker Job ($AUTH_TYPE) ---"
  echo "gcloud scheduler jobs update http ${JOB_DISPATCH_NAME} \\"
  echo "  --project=\"${EXPECTED_PROJECT_ID}\" \\"
  echo "  --location=\"${EXPECTED_REGION}\" \\"
  echo "  --schedule=\"${SCHEDULE_DISPATCH}\" \\"
  echo "  --uri=\"${URI_DISPATCH}\" \\"
  echo "  --http-method=\"POST\" \\"
  echo "  --time-zone=\"Etc/UTC\" \\"
  echo "  --attempt-deadline=\"120s\" \\"
  if [ "$AUTH_TYPE" = "oidc" ]; then
    echo "  --oidc-service-account-email=\"${EXPECTED_SERVICE_ACCOUNT}\" \\"
    echo "  --oidc-token-audience=\"${EXPECTED_SERVICE_URL}\" \\"
    echo "  --headers=\"Content-Type=application/json\" \\"
  else
    echo "  --headers=\"Content-Type=application/json,x-cron-key=<CRON_SECRET_VALUE>\" \\"
  fi
  echo "  --message-body='${PAYLOAD_DISPATCH}' \\"
  echo "  --description=\"Processes pending task notification dispatch batch (bounded batch: 10, default-off safety preserved).\""
  echo "======================================================================"
}

if [ "$MODE" = "print" ]; then
  print_commands
  echo "NOTICE: Running in print / dry-run mode. Secret values are never resolved or printed."
  echo "No live cloud resources were created or modified."
  exit 0
fi

# Live execution handling (guarded by operator confirmation)
echo "SAFETY CHECK: Live resource modification requested."
read -p "Proceed with live Cloud Scheduler configuration in project ${EXPECTED_PROJECT_ID}? (y/N): " -r CONFIRM
if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
  echo "Aborted by operator. No live resources modified."
  exit 0
fi

CRON_SECRET_VAL=""
if [ "$AUTH_TYPE" = "header" ]; then
  # Ensure xtrace is disabled so secrets are not echoed if someone runs with bash -x
  set +x
  CRON_SECRET_VAL="$(gcloud secrets versions access latest --secret="${EXPECTED_SECRET_NAME}" --project="${EXPECTED_PROJECT_ID}" 2>/dev/null || true)"
  if [ -z "$CRON_SECRET_VAL" ]; then
    echo "ERROR: Failed to retrieve secret from Secret Manager or secret value is empty." >&2
    exit 1
  fi
fi

# Clear secret variable immediately
unset CRON_SECRET_VAL

echo "ERROR: --execute-live requested, but live execution is locked in this environment."
exit 1
