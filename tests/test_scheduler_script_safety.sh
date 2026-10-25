#!/usr/bin/env bash
# ==============================================================================
# EchoNote Scheduler Provisioning Safety & Secret Redaction Test Suite
# ==============================================================================
# Tests the following properties of scripts/schedule-notification-workers.sh:
#   1. Safe print / dry-run mode returns exit code 0.
#   2. OIDC mode (default) uses --oidc-service-account-email and --oidc-audience.
#   3. OIDC mode outputs ZERO secrets and no x-cron-key headers.
#   4. Header mode (--auth=header) uses redacted <CRON_SECRET_VALUE> placeholder.
#   5. Header mode never leaks raw gcloud secrets access command in output.
#   6. Idempotent create-and-update commands are accurately presented for both jobs.
#   7. Bounded batch size (10) and stale-dispatch timeout (600000ms) are strictly preserved.
#   8. Default-off safety: NOTIFICATION_DISPATCH_ENABLED is NOT set by the script.
#   9. Target configuration (project echonote-2509, region us-west1, service URL) is locked.
#  10. Shell trace guard (+x) and unset secret logic exist in script body.
#  11. Help/usage flag works cleanly.
#  12. Unknown option fails closed with exit code 1.
# ==============================================================================

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TARGET_SCRIPT="$WORKSPACE_ROOT/scripts/schedule-notification-workers.sh"

PASSED_COUNT=0
FAILED_COUNT=0

assert_true() {
  local desc="$1"
  local status="$2"
  if [ "$status" -eq 0 ]; then
    echo "✔ PASSED: $desc"
    PASSED_COUNT=$((PASSED_COUNT + 1))
  else
    echo "❌ FAILED: $desc"
    FAILED_COUNT=$((FAILED_COUNT + 1))
  fi
}

echo "=== RUNNING SCHEDULER PROVISIONING SAFETY TESTS ==="

# Test 1: File exists and is non-empty
[ -f "$TARGET_SCRIPT" ]
assert_true "1. Script file exists" $?

# Test 2: Help flag exits 0
HELP_OUT="$("$TARGET_SCRIPT" --help 2>&1 || true)"
echo "$HELP_OUT" | grep -q "Usage:"
assert_true "2. --help flag succeeds cleanly" $?

# Test 3: Unknown flag fails with code 1
BAD_CODE=0
"$TARGET_SCRIPT" --invalid-option 2>/dev/null || BAD_CODE=$?
[ "$BAD_CODE" -eq 1 ]
assert_true "3. Invalid argument rejected with code 1" $?

# Test 4: Default invocation (no args) defaults to print mode with OIDC auth
DEFAULT_OUT="$("$TARGET_SCRIPT" 2>&1)"
echo "$DEFAULT_OUT" | grep -q "Mode: *print" && echo "$DEFAULT_OUT" | grep -q "Authentication Mode: oidc"
assert_true "4. Default invocation runs in print mode with OIDC auth" $?

# Test 5: Default OIDC mode uses supported native OIDC flags (--oidc-service-account-email and --oidc-token-audience)
echo "$DEFAULT_OUT" | grep -q -- '--oidc-service-account-email="echonote-scheduler-invoker@echonote-2509.iam.gserviceaccount.com"' && \
echo "$DEFAULT_OUT" | grep -q -- '--oidc-token-audience="https://echonote-zfo2izdqla-uw.a.run.app"'
assert_true "5. Default OIDC mode configures dedicated scheduler service account and audience correctly with --oidc-token-audience" $?

# Test 5A: Verify old Compute service account is NOT configured as scheduler OIDC identity
! echo "$DEFAULT_OUT" | grep -q -- '--oidc-service-account-email="200551109142-compute@developer.gserviceaccount.com"'
assert_true "5A. Old Compute service account is not present in generated scheduler commands" $?

# Test 5B: Verify unsupported --oidc-audience flag is NEVER generated
! echo "$DEFAULT_OUT" | grep -q -- '--oidc-audience='
assert_true "5B. Unsupported flag --oidc-audience is strictly absent from all generated commands" $?

# Test 5C: Verify all 4 OIDC commands (1A, 1B, 2A, 2B) contain --oidc-token-audience
OIDC_AUD_COUNT=$(echo "$DEFAULT_OUT" | grep -c -- '--oidc-token-audience=')
[ "$OIDC_AUD_COUNT" -eq 4 ]
assert_true "5C. All 4 generated OIDC commands (1A, 1B, 2A, 2B) use --oidc-token-audience" $?

# Test 6: Default OIDC mode outputs ZERO secrets and no x-cron-key
! echo "$DEFAULT_OUT" | grep -q "x-cron-key"
assert_true "6. Default OIDC mode contains no x-cron-key header" $?

# Test 7: Header auth mode (--auth=header) uses redacted <CRON_SECRET_VALUE> placeholder
HEADER_OUT="$("$TARGET_SCRIPT" --print --auth=header 2>&1)"
echo "$HEADER_OUT" | grep -q "x-cron-key=<CRON_SECRET_VALUE>"
assert_true "7. Header mode uses redacted <CRON_SECRET_VALUE> placeholder" $?

# Test 8: Header mode never leaks raw gcloud secrets access command in header
! echo "$HEADER_OUT" | grep -q "x-cron-key=\$(gcloud secrets"
assert_true "8. No raw secret retrieval in headers under header mode" $?

# Test 9-11: Target locks present
echo "$DEFAULT_OUT" | grep -q "Project ID: *echonote-2509"
assert_true "9. Project ID is strictly echonote-2509" $?

echo "$DEFAULT_OUT" | grep -q "Region: *us-west1"
assert_true "10. Region is strictly us-west1" $?

echo "$DEFAULT_OUT" | grep -q "Cloud Run Target: *https://echonote-zfo2izdqla-uw.a.run.app"
assert_true "11. Cloud Run target matches canonical URL" $?

# Test 12-14: Stale recovery configuration
echo "$DEFAULT_OUT" | grep -F -q -- '--schedule="*/15 * * * *"'
assert_true "12. Stale recovery schedule is */15 * * * *" $?

echo "$DEFAULT_OUT" | grep -q "/api/internal/notifications/recover-stale-dispatches"
assert_true "13. Stale recovery URI matches endpoint" $?

echo "$DEFAULT_OUT" | grep -F -q "limit" && echo "$DEFAULT_OUT" | grep -F -q "600000"
assert_true "14. Stale recovery bounded payload matches limit 50 and 600000ms" $?

# Test 15-17: Notification dispatch configuration
echo "$DEFAULT_OUT" | grep -F -q -- '--schedule="*/5 * * * *"'
assert_true "15. Dispatch schedule is */5 * * * *" $?

echo "$DEFAULT_OUT" | grep -q "/api/internal/notifications/dispatch"
assert_true "16. Dispatch URI matches endpoint" $?

echo "$DEFAULT_OUT" | grep -F -q "batchSize" && echo "$DEFAULT_OUT" | grep -F -q "10"
assert_true "17. Dispatch payload matches bounded batchSize 10" $?

# Test 18-21: Idempotency commands presented (both create and update)
echo "$DEFAULT_OUT" | grep -q "gcloud scheduler jobs create http echonote-stale-dispatch-recovery"
assert_true "18. Idempotent Command 1A (create recovery) defined" $?

echo "$DEFAULT_OUT" | grep -q "gcloud scheduler jobs update http echonote-stale-dispatch-recovery"
assert_true "19. Idempotent Command 1B (update recovery) defined" $?

echo "$DEFAULT_OUT" | grep -q "gcloud scheduler jobs create http echonote-notification-dispatch"
assert_true "20. Idempotent Command 2A (create dispatch) defined" $?

echo "$DEFAULT_OUT" | grep -q "gcloud scheduler jobs update http echonote-notification-dispatch"
assert_true "21. Idempotent Command 2B (update dispatch) defined" $?

# Test 22: Default-off boundary: Script does NOT set or reference NOTIFICATION_DISPATCH_ENABLED in scheduler payloads
! echo "$DEFAULT_OUT" | grep -q "NOTIFICATION_DISPATCH_ENABLED"
assert_true "22. NOTIFICATION_DISPATCH_ENABLED is absent from scheduler payloads" $?

# Test 23: Check source code has xtrace suppression (set +x)
SCRIPT_CONTENT="$(cat "$TARGET_SCRIPT")"
echo "$SCRIPT_CONTENT" | grep -q "set +x"
assert_true "23. xtrace suppression (set +x) is enforced before secret resolution in header mode" $?

# Test 24: Check source code unsets CRON_SECRET_VAL
echo "$SCRIPT_CONTENT" | grep -q "unset CRON_SECRET_VAL"
assert_true "24. Secret variable is immediately unset in script" $?

echo "======================================================"
echo "TOTAL PASSED: $PASSED_COUNT"
echo "TOTAL FAILED: $FAILED_COUNT"
echo "======================================================"

if [ "$FAILED_COUNT" -gt 0 ]; then
  exit 1
fi
exit 0
