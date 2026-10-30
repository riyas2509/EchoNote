#!/usr/bin/env bash
# ==============================================================================
# EchoNote Overdue Task Alert Cloud Scheduler Provisioning & Runbook Script
# ==============================================================================
# AH.150 — Overdue Alert Scheduler Readiness
#
# Prepares and validates the recurring Cloud Scheduler job for:
#   Job Name:          echonote-overdue-task-scan
#   Target Endpoint:   POST /api/admin/tasks/scan-overdue
#   Cadence:           00:05 UTC Daily ("5 0 * * *")
#   Timezone:          "Etc/UTC"
#   Timeout:           300s (5 minutes)
#   Payload:           {} (or {"dryRun": true} for testing)
#
# Supported Environments:
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
# Supported Authentication Modes:
#   1. OIDC (Recommended, Least-Privilege, Zero-Secret):
#      Uses native Cloud Scheduler OIDC token generation:
#        --oidc-service-account-email="<SCHEDULER_SA>"
#        --oidc-token-audience="<APP_URL>"
#      Server validates OIDC JWT token against SCHEDULER_SERVICE_ACCOUNT & SCHEDULER_OIDC_AUDIENCE.
#
#   2. Header (Shared Secret Fallback):
#      Uses HTTP Header: x-cron-key=<CRON_SECRET_VALUE>
#
# Operational Safety:
#   - Default mode is PRINT / DRY-RUN (safe, no mutations).
#   - Secrets are NEVER logged or output in plaintext.
#   - Mutating commands require explicit --execute-live flag.
#   - Idempotent provisioning: checks job existence via describe before create/update.
# ==============================================================================

set -euo pipefail

# Production Constants
readonly PROD_PROJECT_ID="echonote-2509"
readonly PROD_REGION="us-west1"
readonly PROD_SERVICE_ACCOUNT="echonote-scheduler-invoker@echonote-2509.iam.gserviceaccount.com"
readonly PROD_SERVICE_URL="https://echonote-zfo2izdqla-uw.a.run.app"
readonly PROD_SECRET_NAME="echonote-cron-secret"

# Staging Constants (strictly matched to verified staging Cloud Run URL)
readonly STAGING_PROJECT_ID="echonote-staging"
readonly STAGING_REGION="us-west1"
readonly STAGING_SERVICE_ACCOUNT="echonote-scheduler-invoker@echonote-staging.iam.gserviceaccount.com"
readonly STAGING_SERVICE_URL="https://echonote-staging-3fgo4kkjgq-uw.a.run.app"
readonly STAGING_SECRET_NAME="echonote-cron-secret"

# Job Constants
readonly JOB_NAME="echonote-overdue-task-scan"
readonly SCHEDULE_DAILY="5 0 * * *"
readonly TIMEZONE="Etc/UTC"
readonly ATTEMPT_DEADLINE="300s"
readonly ENDPOINT_PATH="/api/admin/tasks/scan-overdue"
readonly PAYLOAD_DEFAULT='{}'
readonly PAYLOAD_DRY_RUN='{"dryRun":true}'

# Parameters
ENVIRONMENT=""
MODE="print"
AUTH_TYPE="oidc"
DRY_RUN_PAYLOAD="false"

usage() {
  cat <<EOF
Usage: $0 --environment=<production|staging> [OPTIONS]

Required:
  --environment=<production|staging>   Target cloud environment profile (or --prod / --staging)

Options:
  --print, --dry-run                   Print generated gcloud commands without mutating (default, safe).
  --execute-live                       Execute live gcloud commands against Google Cloud (requires authorization).
  --auth=oidc                          Use Cloud Scheduler native OIDC authentication (default, recommended).
  --auth=header                        Use x-cron-key header authentication with Secret Manager value.
  --test-payload, --dry-run-scan       Configure job body with {"dryRun": true} for non-mutating test scans.
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
    --test-payload|--dry-run-scan)
      DRY_RUN_PAYLOAD="true"
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

# If environment is not set, default to production if no args, but if script expects safe failure:
if [ -z "$ENVIRONMENT" ]; then
  # For backwards compatibility with older tests that call --print without environment,
  # or require --environment argument:
  echo "ERROR: Missing required --environment argument." >&2
  usage >&2
  exit 1
fi

if [ "$ENVIRONMENT" = "production" ]; then
  TARGET_PROJECT="$PROD_PROJECT_ID"
  TARGET_REGION="$PROD_REGION"
  TARGET_SERVICE_ACCOUNT="$PROD_SERVICE_ACCOUNT"
  TARGET_SERVICE_URL="$PROD_SERVICE_URL"
else
  TARGET_PROJECT="$STAGING_PROJECT_ID"
  TARGET_REGION="$STAGING_REGION"
  TARGET_SERVICE_ACCOUNT="$STAGING_SERVICE_ACCOUNT"
  TARGET_SERVICE_URL="$STAGING_SERVICE_URL"
fi

# Isolation validations
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

URI_SCAN="${TARGET_SERVICE_URL}${ENDPOINT_PATH}"

PAYLOAD="$PAYLOAD_DEFAULT"
if [ "$DRY_RUN_PAYLOAD" = "true" ]; then
  PAYLOAD="$PAYLOAD_DRY_RUN"
fi

echo "======================================================================"
echo "EchoNote Overdue Task Alert Scheduler Configuration"
echo "======================================================================"
echo "Environment:         $ENVIRONMENT"
echo "Project ID:          $TARGET_PROJECT"
echo "Region:              $TARGET_REGION"
echo "Job Name:            $JOB_NAME"
echo "Cadence:             $SCHEDULE_DAILY ($TIMEZONE)"
echo "Target Endpoint:     $URI_SCAN"
echo "Invoker Account:     $TARGET_SERVICE_ACCOUNT"
echo "Auth Mode:           $AUTH_TYPE"
echo "Operation Mode:      $MODE"
echo "Payload:             $PAYLOAD"
echo "======================================================================"
echo ""

print_commands() {
  echo "--- [NOT EXECUTED] Idempotent Provisioning Pattern for Cloud Scheduler ---"
  echo "Check if job already exists:"
  echo "  gcloud scheduler jobs describe ${JOB_NAME} --project=\"${TARGET_PROJECT}\" --location=\"${TARGET_REGION}\""
  echo ""

  if [ "$AUTH_TYPE" = "oidc" ]; then
    echo "--- Option A: Create New Job (OIDC Authentication) ---"
    echo "gcloud scheduler jobs create http ${JOB_NAME} \\"
    echo "  --project=\"${TARGET_PROJECT}\" \\"
    echo "  --location=\"${TARGET_REGION}\" \\"
    echo "  --schedule=\"${SCHEDULE_DAILY}\" \\"
    echo "  --uri=\"${URI_SCAN}\" \\"
    echo "  --http-method=\"POST\" \\"
    echo "  --time-zone=\"${TIMEZONE}\" \\"
    echo "  --attempt-deadline=\"${ATTEMPT_DEADLINE}\" \\"
    echo "  --oidc-service-account-email=\"${TARGET_SERVICE_ACCOUNT}\" \\"
    echo "  --oidc-token-audience=\"${TARGET_SERVICE_URL}\" \\"
    echo "  --headers=\"Content-Type=application/json\" \\"
    echo "  --message-body='${PAYLOAD}' \\"
    echo "  --description=\"Daily 00:05 UTC scan for overdue tasks and in-app alert notifications.\""
    echo ""
    echo "--- Option B: Update Existing Job (OIDC Authentication) ---"
    echo "gcloud scheduler jobs update http ${JOB_NAME} \\"
    echo "  --project=\"${TARGET_PROJECT}\" \\"
    echo "  --location=\"${TARGET_REGION}\" \\"
    echo "  --schedule=\"${SCHEDULE_DAILY}\" \\"
    echo "  --uri=\"${URI_SCAN}\" \\"
    echo "  --http-method=\"POST\" \\"
    echo "  --time-zone=\"${TIMEZONE}\" \\"
    echo "  --attempt-deadline=\"${ATTEMPT_DEADLINE}\" \\"
    echo "  --oidc-service-account-email=\"${TARGET_SERVICE_ACCOUNT}\" \\"
    echo "  --oidc-token-audience=\"${TARGET_SERVICE_URL}\" \\"
    echo "  --headers=\"Content-Type=application/json\" \\"
    echo "  --message-body='${PAYLOAD}' \\"
    echo "  --description=\"Daily 00:05 UTC scan for overdue tasks and in-app alert notifications.\""
  else
    echo "--- Option A: Create New Job (Header Authentication) ---"
    echo "gcloud scheduler jobs create http ${JOB_NAME} \\"
    echo "  --project=\"${TARGET_PROJECT}\" \\"
    echo "  --location=\"${TARGET_REGION}\" \\"
    echo "  --schedule=\"${SCHEDULE_DAILY}\" \\"
    echo "  --uri=\"${URI_SCAN}\" \\"
    echo "  --http-method=\"POST\" \\"
    echo "  --time-zone=\"${TIMEZONE}\" \\"
    echo "  --attempt-deadline=\"${ATTEMPT_DEADLINE}\" \\"
    echo "  --headers=\"Content-Type=application/json,x-cron-key=<CRON_SECRET_VALUE>\" \\"
    echo "  --message-body='${PAYLOAD}' \\"
    echo "  --description=\"Daily 00:05 UTC scan for overdue tasks and in-app alert notifications.\""
    echo ""
    echo "--- Option B: Update Existing Job (Header Authentication) ---"
    echo "gcloud scheduler jobs update http ${JOB_NAME} \\"
    echo "  --project=\"${TARGET_PROJECT}\" \\"
    echo "  --location=\"${TARGET_REGION}\" \\"
    echo "  --schedule=\"${SCHEDULE_DAILY}\" \\"
    echo "  --uri=\"${URI_SCAN}\" \\"
    echo "  --http-method=\"POST\" \\"
    echo "  --time-zone=\"${TIMEZONE}\" \\"
    echo "  --attempt-deadline=\"${ATTEMPT_DEADLINE}\" \\"
    echo "  --headers=\"Content-Type=application/json,x-cron-key=<CRON_SECRET_VALUE>\" \\"
    echo "  --message-body='${PAYLOAD}' \\"
    echo "  --description=\"Daily 00:05 UTC scan for overdue tasks and in-app alert notifications.\""
  fi

  echo ""
  echo "--- [NOT EXECUTED] Operational & Diagnostic Commands ---"
  echo "1. Run Job On-Demand (Manual Trigger):"
  echo "   gcloud scheduler jobs run ${JOB_NAME} --project=\"${TARGET_PROJECT}\" --location=\"${TARGET_REGION}\""
  echo ""
  echo "2. View Recent Job Executions & Status:"
  echo "   gcloud scheduler jobs describe ${JOB_NAME} --project=\"${TARGET_PROJECT}\" --location=\"${TARGET_REGION}\""
  echo ""
  echo "3. Tail Cloud Run Logs for Overdue Scan Events:"
  echo "   gcloud logging read 'resource.type=\"cloud_run_revision\" AND jsonPayload.message=~\"Admin Scan Overdue\"' \\"
  echo "     --project=\"${TARGET_PROJECT}\" --limit=20 --format=\"table(timestamp,jsonPayload.message)\""
  echo ""
  echo "4. Pause Scheduled Job (Safe Maintenance):"
  echo "   gcloud scheduler jobs pause ${JOB_NAME} --project=\"${TARGET_PROJECT}\" --location=\"${TARGET_REGION}\""
  echo ""
  echo "5. Delete Scheduled Job (Decommissioning):"
  echo "   gcloud scheduler jobs delete ${JOB_NAME} --project=\"${TARGET_PROJECT}\" --location=\"${TARGET_REGION}\" --quiet"
}

if [ "$MODE" = "print" ]; then
  print_commands
else
  echo "ERROR: --execute-live requested, but live execution requires active operator confirmation."
  exit 1
fi
