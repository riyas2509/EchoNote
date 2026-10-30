#!/usr/bin/env bash
# ==============================================================================
# EchoNote Production Cloud Scheduler Configuration Preparation Script
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
# Target Infrastructure Locks (strictly matched from scripts/deploy-cloud-run.sh):
#   Project:           echonote-2509
#   Region:            us-west1
#   Canonical App URL: https://echonote-zfo2izdqla-uw.a.run.app
#   Scheduler SA:      echonote-scheduler-invoker@echonote-2509.iam.gserviceaccount.com
#   Secret Reference:  echonote-cron-secret:latest (CRON_SECRET)
#
# Authentication Modes Supported:
#   - OIDC (Recommended, Zero-Secret):
#     Uses Cloud Scheduler native OIDC token generation:
#       --oidc-service-account-email="echonote-scheduler-invoker@echonote-2509.iam.gserviceaccount.com"
#       --oidc-token-audience="https://echonote-zfo2izdqla-uw.a.run.app"
#     No shared secret stored in job definition headers.
#
#   - Header / Shared Secret (Legacy Fallback):
#     Uses header: x-cron-key=<CRON_SECRET_VALUE> fetched from Secret Manager.
#
# Safety Boundaries & Hardening:
#   - Idempotent provisioning: Check existing job state via describe and converge
#     using 'update' if present or 'create' if absent.
#   - Safe Secret Handling: In print / dry-run mode, secrets are NEVER resolved
#     or output to stdout/stderr. A non-sensitive placeholder <CRON_SECRET_VALUE>
#     is used in header mode. In OIDC mode, zero secrets are used.
#   - Default-off preservation: Neither job sets NOTIFICATION_DISPATCH_ENABLED.
#     The server-side dry-run mode remains active until manual environment configuration.
#   - Live execution requires explicit operator confirmation flag: --execute-live (LABEL: NOT EXECUTED by default).
# ==============================================================================

set -euo pipefail

# Production Hard-Locked Target Constants
readonly EXPECTED_PROJECT_ID="echonote-2509"
readonly EXPECTED_REGION="us-west1"
readonly EXPECTED_SERVICE_NAME="echonote"
readonly EXPECTED_SERVICE_ACCOUNT="echonote-scheduler-invoker@echonote-2509.iam.gserviceaccount.com"
readonly EXPECTED_SERVICE_URL="https://echonote-zfo2izdqla-uw.a.run.app"
readonly EXPECTED_SECRET_NAME="echonote-cron-secret"

# Job Identifiers
readonly JOB_RECOVERY_NAME="echonote-stale-dispatch-recovery"
readonly JOB_DISPATCH_NAME="echonote-notification-dispatch"

# Job Schedules & Cadences
# Rationale:
# - Stale dispatch recovery: 15 minutes (*/15 * * * *). Threshold is 10 minutes.
#   Scans for worker-crashed leases exceeding 10 min, moving them to ambiguous_delivery quarantine.
# - Notification dispatch: 5 minutes (*/5 * * * *). Default batch size is 10 (max 50).
#   Safe server default-off boundary ensures zero sends until explicit production activation.
readonly SCHEDULE_RECOVERY="*/15 * * * *"
readonly SCHEDULE_DISPATCH="*/5 * * * *"

# Target Endpoints
readonly URI_RECOVERY="${EXPECTED_SERVICE_URL}/api/internal/notifications/recover-stale-dispatches"
readonly URI_DISPATCH="${EXPECTED_SERVICE_URL}/api/internal/notifications/dispatch"

# Bounded Request Payloads
readonly PAYLOAD_RECOVERY='{"limit":50,"staleTimeoutMs":600000}'
readonly PAYLOAD_DISPATCH='{"batchSize":10}'

# Operation Mode & Auth Mode
MODE="print"
AUTH_TYPE="oidc"

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
    --help|-h)
      echo "Usage: $0 [--print | --dry-run | --execute-live] [--auth=oidc | --auth=header]"
      echo ""
      echo "Options:"
      echo "  --print, --dry-run   Print scheduler commands and inspect configuration (default, safe, secret-redacted)."
      echo "  --execute-live       Execute idempotent gcloud commands to create or update live Cloud Scheduler jobs."
      echo "  --auth=oidc          Use Cloud Scheduler native OIDC authentication (default, recommended, zero-secret)."
      echo "  --auth=header        Use legacy x-cron-key header authentication with Secret Manager value."
      exit 0
      ;;
    *)
      echo "ERROR: Unknown option '$arg'. Use --help for usage." >&2
      exit 1
      ;;
  esac
done

echo "======================================================================"
echo "EchoNote Cloud Scheduler Operational Configuration"
echo "======================================================================"
echo "Project ID:          $EXPECTED_PROJECT_ID"
echo "Region:              $EXPECTED_REGION"
echo "Service Account:     $EXPECTED_SERVICE_ACCOUNT"
echo "Cloud Run Target:    $EXPECTED_SERVICE_URL"
echo "Authentication Mode: $AUTH_TYPE"
if [ "$AUTH_TYPE" = "header" ]; then
  echo "Secret Manager Ref:  ${EXPECTED_SECRET_NAME}:latest"
else
  echo "OIDC Audience:       $EXPECTED_SERVICE_URL"
fi
echo "Operation Mode:      $MODE"
echo "======================================================================"
echo ""

print_commands() {
  echo "--- [NOT EXECUTED] Idempotent Provisioning Pattern for Cloud Scheduler ($AUTH_TYPE auth) ---"
  echo "The script uses an idempotent describe-check followed by create or update."
  echo "Below are the exact commands prepared for both states:"
  echo ""

  if [ "$AUTH_TYPE" = "oidc" ]; then
    echo "--- Command 1A (If Job Absent): Create Stale-Dispatch Recovery Job (OIDC) ---"
    echo "gcloud scheduler jobs create http ${JOB_RECOVERY_NAME} \\"
    echo "  --project=\"${EXPECTED_PROJECT_ID}\" \\"
    echo "  --location=\"${EXPECTED_REGION}\" \\"
    echo "  --schedule=\"${SCHEDULE_RECOVERY}\" \\"
    echo "  --uri=\"${URI_RECOVERY}\" \\"
    echo "  --http-method=\"POST\" \\"
    echo "  --time-zone=\"Etc/UTC\" \\"
    echo "  --attempt-deadline=\"60s\" \\"
    echo "  --oidc-service-account-email=\"${EXPECTED_SERVICE_ACCOUNT}\" \\"
    echo "  --oidc-token-audience=\"${EXPECTED_SERVICE_URL}\" \\"
    echo "  --headers=\"Content-Type=application/json\" \\"
    echo "  --message-body='${PAYLOAD_RECOVERY}' \\"
    echo "  --description=\"Quarantines notifications abandoned in dispatching status for >10 minutes (bounded batch: 50).\""
    echo ""
    echo "--- Command 1B (If Job Exists): Update Stale-Dispatch Recovery Job (OIDC) ---"
    echo "gcloud scheduler jobs update http ${JOB_RECOVERY_NAME} \\"
    echo "  --project=\"${EXPECTED_PROJECT_ID}\" \\"
    echo "  --location=\"${EXPECTED_REGION}\" \\"
    echo "  --schedule=\"${SCHEDULE_RECOVERY}\" \\"
    echo "  --uri=\"${URI_RECOVERY}\" \\"
    echo "  --http-method=\"POST\" \\"
    echo "  --time-zone=\"Etc/UTC\" \\"
    echo "  --attempt-deadline=\"60s\" \\"
    echo "  --oidc-service-account-email=\"${EXPECTED_SERVICE_ACCOUNT}\" \\"
    echo "  --oidc-token-audience=\"${EXPECTED_SERVICE_URL}\" \\"
    echo "  --headers=\"Content-Type=application/json\" \\"
    echo "  --message-body='${PAYLOAD_RECOVERY}' \\"
    echo "  --description=\"Quarantines notifications abandoned in dispatching status for >10 minutes (bounded batch: 50).\""
    echo ""
    echo "--- Command 2A (If Job Absent): Create Notification Dispatch Worker Job (OIDC) ---"
    echo "gcloud scheduler jobs create http ${JOB_DISPATCH_NAME} \\"
    echo "  --project=\"${EXPECTED_PROJECT_ID}\" \\"
    echo "  --location=\"${EXPECTED_REGION}\" \\"
    echo "  --schedule=\"${SCHEDULE_DISPATCH}\" \\"
    echo "  --uri=\"${URI_DISPATCH}\" \\"
    echo "  --http-method=\"POST\" \\"
    echo "  --time-zone=\"Etc/UTC\" \\"
    echo "  --attempt-deadline=\"120s\" \\"
    echo "  --oidc-service-account-email=\"${EXPECTED_SERVICE_ACCOUNT}\" \\"
    echo "  --oidc-token-audience=\"${EXPECTED_SERVICE_URL}\" \\"
    echo "  --headers=\"Content-Type=application/json\" \\"
    echo "  --message-body='${PAYLOAD_DISPATCH}' \\"
    echo "  --description=\"Processes pending task notification dispatch batch (bounded batch: 10, default-off safety preserved).\""
    echo ""
    echo "--- Command 2B (If Job Exists): Update Notification Dispatch Worker Job (OIDC) ---"
    echo "gcloud scheduler jobs update http ${JOB_DISPATCH_NAME} \\"
    echo "  --project=\"${EXPECTED_PROJECT_ID}\" \\"
    echo "  --location=\"${EXPECTED_REGION}\" \\"
    echo "  --schedule=\"${SCHEDULE_DISPATCH}\" \\"
    echo "  --uri=\"${URI_DISPATCH}\" \\"
    echo "  --http-method=\"POST\" \\"
    echo "  --time-zone=\"Etc/UTC\" \\"
    echo "  --attempt-deadline=\"120s\" \\"
    echo "  --oidc-service-account-email=\"${EXPECTED_SERVICE_ACCOUNT}\" \\"
    echo "  --oidc-token-audience=\"${EXPECTED_SERVICE_URL}\" \\"
    echo "  --headers=\"Content-Type=application/json\" \\"
    echo "  --message-body='${PAYLOAD_DISPATCH}' \\"
    echo "  --description=\"Processes pending task notification dispatch batch (bounded batch: 10, default-off safety preserved).\""
  else
    echo "--- Command 1A (If Job Absent): Create Stale-Dispatch Recovery Job (Header) ---"
    echo "gcloud scheduler jobs create http ${JOB_RECOVERY_NAME} \\"
    echo "  --project=\"${EXPECTED_PROJECT_ID}\" \\"
    echo "  --location=\"${EXPECTED_REGION}\" \\"
    echo "  --schedule=\"${SCHEDULE_RECOVERY}\" \\"
    echo "  --uri=\"${URI_RECOVERY}\" \\"
    echo "  --http-method=\"POST\" \\"
    echo "  --time-zone=\"Etc/UTC\" \\"
    echo "  --attempt-deadline=\"60s\" \\"
    echo "  --headers=\"Content-Type=application/json,x-cron-key=<CRON_SECRET_VALUE>\" \\"
    echo "  --message-body='${PAYLOAD_RECOVERY}' \\"
    echo "  --description=\"Quarantines notifications abandoned in dispatching status for >10 minutes (bounded batch: 50).\""
    echo ""
    echo "--- Command 1B (If Job Exists): Update Stale-Dispatch Recovery Job (Header) ---"
    echo "gcloud scheduler jobs update http ${JOB_RECOVERY_NAME} \\"
    echo "  --project=\"${EXPECTED_PROJECT_ID}\" \\"
    echo "  --location=\"${EXPECTED_REGION}\" \\"
    echo "  --schedule=\"${SCHEDULE_RECOVERY}\" \\"
    echo "  --uri=\"${URI_RECOVERY}\" \\"
    echo "  --http-method=\"POST\" \\"
    echo "  --time-zone=\"Etc/UTC\" \\"
    echo "  --attempt-deadline=\"60s\" \\"
    echo "  --headers=\"Content-Type=application/json,x-cron-key=<CRON_SECRET_VALUE>\" \\"
    echo "  --message-body='${PAYLOAD_RECOVERY}' \\"
    echo "  --description=\"Quarantines notifications abandoned in dispatching status for >10 minutes (bounded batch: 50).\""
    echo ""
    echo "--- Command 2A (If Job Absent): Create Notification Dispatch Worker Job (Header) ---"
    echo "gcloud scheduler jobs create http ${JOB_DISPATCH_NAME} \\"
    echo "  --project=\"${EXPECTED_PROJECT_ID}\" \\"
    echo "  --location=\"${EXPECTED_REGION}\" \\"
    echo "  --schedule=\"${SCHEDULE_DISPATCH}\" \\"
    echo "  --uri=\"${URI_DISPATCH}\" \\"
    echo "  --http-method=\"POST\" \\"
    echo "  --time-zone=\"Etc/UTC\" \\"
    echo "  --attempt-deadline=\"120s\" \\"
    echo "  --headers=\"Content-Type=application/json,x-cron-key=<CRON_SECRET_VALUE>\" \\"
    echo "  --message-body='${PAYLOAD_DISPATCH}' \\"
    echo "  --description=\"Processes pending task notification dispatch batch (bounded batch: 10, default-off safety preserved).\""
    echo ""
    echo "--- Command 2B (If Job Exists): Update Notification Dispatch Worker Job (Header) ---"
    echo "gcloud scheduler jobs update http ${JOB_DISPATCH_NAME} \\"
    echo "  --project=\"${EXPECTED_PROJECT_ID}\" \\"
    echo "  --location=\"${EXPECTED_REGION}\" \\"
    echo "  --schedule=\"${SCHEDULE_DISPATCH}\" \\"
    echo "  --uri=\"${URI_DISPATCH}\" \\"
    echo "  --http-method=\"POST\" \\"
    echo "  --time-zone=\"Etc/UTC\" \\"
    echo "  --attempt-deadline=\"120s\" \\"
    echo "  --headers=\"Content-Type=application/json,x-cron-key=<CRON_SECRET_VALUE>\" \\"
    echo "  --message-body='${PAYLOAD_DISPATCH}' \\"
    echo "  --description=\"Processes pending task notification dispatch batch (bounded batch: 10, default-off safety preserved).\""
  fi

  echo ""
  echo "--- [NOT EXECUTED] Inspection & Verification Commands ---"
  echo "gcloud scheduler jobs list --project=\"${EXPECTED_PROJECT_ID}\" --location=\"${EXPECTED_REGION}\""
  echo "gcloud scheduler jobs describe ${JOB_RECOVERY_NAME} --project=\"${EXPECTED_PROJECT_ID}\" --location=\"${EXPECTED_REGION}\""
  echo "gcloud scheduler jobs describe ${JOB_DISPATCH_NAME} --project=\"${EXPECTED_PROJECT_ID}\" --location=\"${EXPECTED_REGION}\""
  echo ""
  echo "--- [NOT EXECUTED] Job Management Commands (Pause / Resume / Delete) ---"
  echo "gcloud scheduler jobs pause ${JOB_DISPATCH_NAME} --project=\"${EXPECTED_PROJECT_ID}\" --location=\"${EXPECTED_REGION}\""
  echo "gcloud scheduler jobs resume ${JOB_DISPATCH_NAME} --project=\"${EXPECTED_PROJECT_ID}\" --location=\"${EXPECTED_REGION}\""
  echo "gcloud scheduler jobs pause ${JOB_RECOVERY_NAME} --project=\"${EXPECTED_PROJECT_ID}\" --location=\"${EXPECTED_REGION}\""
  echo "gcloud scheduler jobs resume ${JOB_RECOVERY_NAME} --project=\"${EXPECTED_PROJECT_ID}\" --location=\"${EXPECTED_REGION}\""
  echo "======================================================================"
}

if [ "$MODE" = "print" ]; then
  print_commands
  echo "NOTICE: Running in print / dry-run mode. Secret values are never resolved or printed."
  echo "No live cloud resources were created or modified."
  exit 0
fi

# If --execute-live was explicitly passed:
echo "SAFETY CHECK: Live resource modification requested."
echo "CRITICAL: Live scheduler deployment should only be executed in verified deployment windows."
read -p "Proceed with live Cloud Scheduler configuration in project ${EXPECTED_PROJECT_ID}? (y/N): " -r CONFIRM
if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
  echo "Aborted by operator. No live resources modified."
  exit 0
fi

CRON_SECRET_VAL=""
if [ "$AUTH_TYPE" = "header" ]; then
  # Ensure xtrace is disabled so secrets are not echoed if someone runs with bash -x
  set +x
  echo "--> Fetching cron secret from Secret Manager (${EXPECTED_SECRET_NAME}:latest)..."
  CRON_SECRET_VAL="$(gcloud secrets versions access latest --secret="${EXPECTED_SECRET_NAME}" --project="${EXPECTED_PROJECT_ID}" 2>/dev/null || true)"

  if [ -z "$CRON_SECRET_VAL" ]; then
    echo "ERROR: Failed to retrieve secret from Secret Manager or secret value is empty." >&2
    exit 1
  fi
fi

# Helper function to idempotently provision or update an HTTP Cloud Scheduler job
# Arguments:
#   $1 - Job Name
#   $2 - Schedule expression
#   $3 - Target URI
#   $4 - Request Body
#   $5 - Timeout / Attempt Deadline
#   $6 - Description
provision_scheduler_job() {
  local job_name="$1"
  local schedule="$2"
  local uri="$3"
  local body="$4"
  local deadline="$5"
  local description="$6"

  echo "--> Checking existence of job: ${job_name}..."
  local exists=0
  if gcloud scheduler jobs describe "${job_name}" --project="${EXPECTED_PROJECT_ID}" --location="${EXPECTED_REGION}" &>/dev/null; then
    exists=1
  fi

  local action="create"
  if [ "$exists" -eq 1 ]; then
    action="update"
    echo "Job ${job_name} already exists. Updating configuration idempotently..."
  else
    echo "Job ${job_name} does not exist. Creating new job..."
  fi

  if [ "$AUTH_TYPE" = "oidc" ]; then
    gcloud scheduler jobs "$action" http "${job_name}" \
      --project="${EXPECTED_PROJECT_ID}" \
      --location="${EXPECTED_REGION}" \
      --schedule="${schedule}" \
      --uri="${uri}" \
      --http-method="POST" \
      --time-zone="Etc/UTC" \
      --attempt-deadline="${deadline}" \
      --oidc-service-account-email="${EXPECTED_SERVICE_ACCOUNT}" \
      --oidc-token-audience="${EXPECTED_SERVICE_URL}" \
      --headers="Content-Type=application/json" \
      --message-body="${body}" \
      --description="${description}"
  else
    gcloud scheduler jobs "$action" http "${job_name}" \
      --project="${EXPECTED_PROJECT_ID}" \
      --location="${EXPECTED_REGION}" \
      --schedule="${schedule}" \
      --uri="${uri}" \
      --http-method="POST" \
      --time-zone="Etc/UTC" \
      --attempt-deadline="${deadline}" \
      --headers="Content-Type=application/json,x-cron-key=${CRON_SECRET_VAL}" \
      --message-body="${body}" \
      --description="${description}"
  fi

  echo "Successfully applied job: ${job_name}."
}

echo "--> Provisioning Stale-Dispatch Recovery Job..."
provision_scheduler_job \
  "${JOB_RECOVERY_NAME}" \
  "${SCHEDULE_RECOVERY}" \
  "${URI_RECOVERY}" \
  "${PAYLOAD_RECOVERY}" \
  "60s" \
  "Quarantines notifications abandoned in dispatching status for >10 minutes (bounded batch: 50)."

echo "--> Provisioning Notification Dispatch Worker Job..."
provision_scheduler_job \
  "${JOB_DISPATCH_NAME}" \
  "${SCHEDULE_DISPATCH}" \
  "${URI_DISPATCH}" \
  "${PAYLOAD_DISPATCH}" \
  "120s" \
  "Processes pending task notification dispatch batch (bounded batch: 10, default-off safety preserved)."

# Clear secret variable immediately
unset CRON_SECRET_VAL

echo ""
echo "✅ Cloud Scheduler configuration converged successfully."
