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
# Production Hard-Locked Target Constants (from scripts/deploy-cloud-run.sh):
#   Project:           echonote-2509
#   Region:            us-west1
#   Canonical App URL: https://echonote-zfo2izdqla-uw.a.run.app
#   Scheduler SA:      echonote-scheduler-invoker@echonote-2509.iam.gserviceaccount.com
#   Secret Reference:  echonote-cron-secret:latest (CRON_SECRET)
#
# Supported Authentication Modes:
#   1. OIDC (Recommended, Least-Privilege, Zero-Secret):
#      Uses native Cloud Scheduler OIDC token generation:
#        --oidc-service-account-email="echonote-scheduler-invoker@echonote-2509.iam.gserviceaccount.com"
#        --oidc-token-audience="https://echonote-zfo2izdqla-uw.a.run.app"
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
readonly EXPECTED_PROJECT_ID="echonote-2509"
readonly EXPECTED_REGION="us-west1"
readonly EXPECTED_SERVICE_ACCOUNT="echonote-scheduler-invoker@echonote-2509.iam.gserviceaccount.com"
readonly EXPECTED_SERVICE_URL="https://echonote-zfo2izdqla-uw.a.run.app"
readonly EXPECTED_SECRET_NAME="echonote-cron-secret"

# Job Constants
readonly JOB_NAME="echonote-overdue-task-scan"
readonly SCHEDULE_DAILY="5 0 * * *"
readonly TIMEZONE="Etc/UTC"
readonly ATTEMPT_DEADLINE="300s"
readonly URI_SCAN="${EXPECTED_SERVICE_URL}/api/admin/tasks/scan-overdue"
readonly PAYLOAD_DEFAULT='{}'
readonly PAYLOAD_DRY_RUN='{"dryRun":true}'

# Parameters
MODE="print"
AUTH_TYPE="oidc"
DRY_RUN_PAYLOAD="false"

for arg in "$@"; do
  case "$arg" in
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
      echo "Usage: $0 [--print | --execute-live] [--auth=oidc | --auth=header] [--dry-run-scan]"
      echo ""
      echo "Options:"
      echo "  --print, --dry-run     Print generated gcloud commands without mutating (default, safe)."
      echo "  --execute-live         Execute live gcloud commands against Google Cloud (requires authorization)."
      echo "  --auth=oidc            Use Cloud Scheduler native OIDC authentication (default, recommended)."
      echo "  --auth=header          Use x-cron-key header authentication with Secret Manager value."
      echo "  --dry-run-scan         Configure job body with {\"dryRun\": true} for non-mutating test scans."
      exit 0
      ;;
    *)
      echo "ERROR: Unknown option '$arg'. Use --help for usage." >&2
      exit 1
      ;;
  esac
done

PAYLOAD="$PAYLOAD_DEFAULT"
if [ "$DRY_RUN_PAYLOAD" = "true" ]; then
  PAYLOAD="$PAYLOAD_DRY_RUN"
fi

echo "======================================================================"
echo "EchoNote Overdue Task Alert Scheduler Configuration"
echo "======================================================================"
echo "Project ID:          $EXPECTED_PROJECT_ID"
echo "Region:              $EXPECTED_REGION"
echo "Job Name:            $JOB_NAME"
echo "Cadence:             $SCHEDULE_DAILY ($TIMEZONE)"
echo "Target Endpoint:     $URI_SCAN"
echo "Invoker Account:     $EXPECTED_SERVICE_ACCOUNT"
echo "Auth Mode:           $AUTH_TYPE"
echo "Operation Mode:      $MODE"
echo "Payload:             $PAYLOAD"
echo "======================================================================"
echo ""

print_commands() {
  echo "--- [NOT EXECUTED] Idempotent Provisioning Pattern for Cloud Scheduler ---"
  echo "Check if job already exists:"
  echo "  gcloud scheduler jobs describe ${JOB_NAME} --project=\"${EXPECTED_PROJECT_ID}\" --location=\"${EXPECTED_REGION}\""
  echo ""

  if [ "$AUTH_TYPE" = "oidc" ]; then
    echo "--- Option A: Create New Job (OIDC Authentication) ---"
    echo "gcloud scheduler jobs create http ${JOB_NAME} \\"
    echo "  --project=\"${EXPECTED_PROJECT_ID}\" \\"
    echo "  --location=\"${EXPECTED_REGION}\" \\"
    echo "  --schedule=\"${SCHEDULE_DAILY}\" \\"
    echo "  --uri=\"${URI_SCAN}\" \\"
    echo "  --http-method=\"POST\" \\"
    echo "  --time-zone=\"${TIMEZONE}\" \\"
    echo "  --attempt-deadline=\"${ATTEMPT_DEADLINE}\" \\"
    echo "  --oidc-service-account-email=\"${EXPECTED_SERVICE_ACCOUNT}\" \\"
    echo "  --oidc-token-audience=\"${EXPECTED_SERVICE_URL}\" \\"
    echo "  --headers=\"Content-Type=application/json\" \\"
    echo "  --message-body='${PAYLOAD}' \\"
    echo "  --description=\"Daily 00:05 UTC scan for overdue tasks and in-app alert notifications.\""
    echo ""
    echo "--- Option B: Update Existing Job (OIDC Authentication) ---"
    echo "gcloud scheduler jobs update http ${JOB_NAME} \\"
    echo "  --project=\"${EXPECTED_PROJECT_ID}\" \\"
    echo "  --location=\"${EXPECTED_REGION}\" \\"
    echo "  --schedule=\"${SCHEDULE_DAILY}\" \\"
    echo "  --uri=\"${URI_SCAN}\" \\"
    echo "  --http-method=\"POST\" \\"
    echo "  --time-zone=\"${TIMEZONE}\" \\"
    echo "  --attempt-deadline=\"${ATTEMPT_DEADLINE}\" \\"
    echo "  --oidc-service-account-email=\"${EXPECTED_SERVICE_ACCOUNT}\" \\"
    echo "  --oidc-token-audience=\"${EXPECTED_SERVICE_URL}\" \\"
    echo "  --headers=\"Content-Type=application/json\" \\"
    echo "  --message-body='${PAYLOAD}' \\"
    echo "  --description=\"Daily 00:05 UTC scan for overdue tasks and in-app alert notifications.\""
  else
    echo "--- Option A: Create New Job (Header Authentication) ---"
    echo "gcloud scheduler jobs create http ${JOB_NAME} \\"
    echo "  --project=\"${EXPECTED_PROJECT_ID}\" \\"
    echo "  --location=\"${EXPECTED_REGION}\" \\"
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
    echo "  --project=\"${EXPECTED_PROJECT_ID}\" \\"
    echo "  --location=\"${EXPECTED_REGION}\" \\"
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
  echo "   gcloud scheduler jobs run ${JOB_NAME} --project=\"${EXPECTED_PROJECT_ID}\" --location=\"${EXPECTED_REGION}\""
  echo ""
  echo "2. View Recent Job Executions & Status:"
  echo "   gcloud scheduler jobs describe ${JOB_NAME} --project=\"${EXPECTED_PROJECT_ID}\" --location=\"${EXPECTED_REGION}\""
  echo ""
  echo "3. Tail Cloud Run Logs for Overdue Scan Events:"
  echo "   gcloud logging read 'resource.type=\"cloud_run_revision\" AND jsonPayload.message=~\"Admin Scan Overdue\"' \\"
  echo "     --project=\"${EXPECTED_PROJECT_ID}\" --limit=20 --format=\"table(timestamp,jsonPayload.message)\""
  echo ""
  echo "4. Pause Scheduled Job (Safe Maintenance):"
  echo "   gcloud scheduler jobs pause ${JOB_NAME} --project=\"${EXPECTED_PROJECT_ID}\" --location=\"${EXPECTED_REGION}\""
  echo ""
  echo "5. Delete Scheduled Job (Decommissioning):"
  echo "   gcloud scheduler jobs delete ${JOB_NAME} --project=\"${EXPECTED_PROJECT_ID}\" --location=\"${EXPECTED_REGION}\" --quiet"
}

if [ "$MODE" = "print" ]; then
  print_commands
else
  echo "ERROR: --execute-live requested, but live execution is locked in this environment."
  echo "Please review the printed commands and execute via an authorized deployment pipeline."
  exit 1
fi
