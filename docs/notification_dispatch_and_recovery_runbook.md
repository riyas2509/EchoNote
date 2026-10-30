# EchoNote Operational Runbook: Notification Dispatch & Stale-Dispatch Recovery Scheduling

## 1. Overview & Operational Architecture

This runbook establishes standard operating procedures for the recurring execution, monitoring, error inspection, and emergency shutdown of EchoNote's task notification subsystem:
- **Notification Dispatch Worker**: Endpoint `POST /api/internal/notifications/dispatch`
- **Stale-Dispatch Recovery Worker**: Endpoint `POST /api/internal/notifications/recover-stale-dispatches`

### Safety Core Principles
1. **Server-Side Default-Off Activation**: Real email sending is gated strictly by `process.env.NOTIFICATION_DISPATCH_ENABLED === 'true'`. When this variable is unset or `false`, the dispatch endpoint runs in **dry-run mode**, scanning and returning metrics while claiming zero records, mutating zero documents, and initiating zero provider (Resend) API calls.
2. **In-Flight Dispatch Fence & Stale Lease Quarantine**: Dispatch workers mark claimed records as `dispatching` with a 10-minute timeout. If a worker terminates abnormally during a third-party call, the record is NOT blindly redispatched. Instead, the stale-dispatch recovery job transitions it to `ambiguous_delivery` quarantine for manual or verified administrative reconciliation.
3. **Bounded Work Batches**: Dispatch operations are bounded to 10 records per execution (server-enforced maximum 50). Stale-dispatch scans are bounded to 50 records per execution (server-enforced maximum 100).

---

## 2. Infrastructure Identity & Target Environment

| Attribute | Authoritative Production Value | Rationale / Reference |
| :--- | :--- | :--- |
| **GCP Project ID** | `echonote-2509` | Locked in `deploy-cloud-run-B1A.sh` & `firebase.ts` |
| **GCP Region** | `us-west1` | Cloud Run service location |
| **Cloud Run Service** | `echonote` | Primary backend application |
| **Canonical Service URL** | `https://echonote-zfo2izdqla-uw.a.run.app` | Defined in `.env.example` (`VITE_API_URL`) |
| **Cloud Run Service Account** | `200551109142-compute@developer.gserviceaccount.com` | Standard service identity |
| **Secret Manager Secret** | `echonote-cron-secret:latest` | Maps to `CRON_SECRET` on Cloud Run |

---

## 3. Secret Handling, IAM Exposure & Rotation Model

### Authentication Architecture Options

EchoNote supports two authentication modes for internal worker and scheduler endpoints:

#### Mode 1: Cloud Scheduler Native OIDC Identity Token (Primary & Authoritative)
- **Zero-Secret Architecture**: Cloud Scheduler uses Google Cloud's IAM token service to generate a cryptographically signed OpenID Connect (OIDC) identity token representing the dedicated scheduler service account (`echonote-scheduler-invoker@echonote-2509.iam.gserviceaccount.com`).
- **Signature & Claim Validation**: Validated server-side using `google-auth-library` (`OAuth2Client.verifyIdToken()`).
- **Cryptographic Guarantees**:
  - `iss`: Must be `https://accounts.google.com` or `accounts.google.com`.
  - `aud`: Must strictly match `process.env.SCHEDULER_OIDC_AUDIENCE` (configured to `https://echonote-zfo2izdqla-uw.a.run.app`).
  - `email`: Must strictly match `process.env.SCHEDULER_SERVICE_ACCOUNT` (`echonote-scheduler-invoker@echonote-2509.iam.gserviceaccount.com`).
  - `email_verified`: Must be `true`.
  - `exp`: Token must not be expired.
  - `nbf`: Optional Not-Before claim, if present, must be a finite numeric timestamp within allowed clock skew (300s); explicit `null` or malformed values are rejected.
- **Security & Least-Privilege Benefits**:
  - No shared secrets are stored inside Cloud Scheduler job definitions, eliminating all header inspection exposure via `cloudscheduler.jobs.get`.
  - The dedicated scheduler service account holds **zero GCP project roles** (no Secret Manager, no Firestore/Datastore, no Firebase, no Cloud Run admin access).
  - OIDC failure triggers explicit diagnostics rather than silent mechanism fallback.

#### Mode 2: Shared Header Secret (`x-cron-key`) (Legacy Fallback)
- **Header Secret**: Passes `x-cron-key: <CRON_SECRET_VALUE>` mapped from Secret Manager (`echonote-cron-secret:latest`).
- **Verification**: Validated using constant-time string comparison (`timingSafeStringCompare`).
- **Operational Policy**: Intended solely for disaster recovery or testing. Never combined with OIDC.

### Identity Architecture & IAM Prerequisites for OIDC Scheduler Execution

The architecture strictly distinguishes four distinct operational identities:
1. **Cloud Scheduler Service Agent**: `service-200551109142@gcp-sa-cloudscheduler.iam.gserviceaccount.com`. Google-managed service identity for Cloud Scheduler in project `echonote-2509`.
2. **Scheduler OIDC Service Account (Caller Identity)**: `echonote-scheduler-invoker@echonote-2509.iam.gserviceaccount.com`. Dedicated, least-privilege client identity whose email appears in the OIDC token claims.
3. **Cloud Run Runtime Service Account**: `200551109142-compute@developer.gserviceaccount.com`. Service account attached to the Cloud Run container running EchoNote, holding application runtime permissions (Secret Manager accessor, Firebase admin).
4. **Provisioning Operator**: The human/CI administrator creating or updating Cloud Scheduler jobs.

#### Verified Google Cloud IAM Requirements

1. **Cloud Scheduler Service Agent Project Role**:
   The Cloud Scheduler service agent (`service-200551109142@gcp-sa-cloudscheduler.iam.gserviceaccount.com`) must retain `roles/cloudscheduler.serviceAgent` at the project level:
   - This role includes `iam.serviceAccounts.getOpenIdToken` and `run.routes.invoke`.
   - It is automatically provisioned by Google Cloud upon enabling `cloudscheduler.googleapis.com`.
   - An additional `roles/iam.serviceAccountTokenCreator` binding is **not** prescribed by default.
2. **Operator `actAs` Permission**:
   The provisioning operator configuring the job with `--oidc-service-account-email` requires `iam.serviceAccounts.actAs` on `echonote-scheduler-invoker@echonote-2509.iam.gserviceaccount.com`. This is commonly granted via `roles/iam.serviceAccountUser` on the service account:
   ```bash
   # [NOT EXECUTED] Grant Service Account User to deploying operator
   gcloud iam service-accounts add-iam-policy-binding echonote-scheduler-invoker@echonote-2509.iam.gserviceaccount.com \
     --project="echonote-2509" \
     --member="user:<OPERATOR_EMAIL>" \
     --role="roles/iam.serviceAccountUser"
   ```
3. **Cloud Run Invocation IAM**:
   If Cloud Run native IAM authentication is enforced, `echonote-scheduler-invoker@echonote-2509.iam.gserviceaccount.com` requires `roles/run.invoker` on service `echonote`.
   *Note*: In the current deployment, `run.googleapis.com/invoker-iam-disabled: "true"` is set, meaning Cloud Run network-level IAM is disabled. No invoker binding is currently required at the network edge.
4. **Application-Level Authorization (`authenticateInternalWorker`)**:
   EchoNote authorizes incoming calls by verifying the OIDC identity token against `SCHEDULER_SERVICE_ACCOUNT`.

---

## 4. Recurring Scheduler Job Specifications

### Job A: Stale-Dispatch Recovery (`echonote-stale-dispatch-recovery`)
- **Target Endpoint**: `POST https://echonote-zfo2izdqla-uw.a.run.app/api/internal/notifications/recover-stale-dispatches`
- **Cadence**: `*/15 * * * *` (Every 15 minutes)
- **Cadence Rationale**: The codebase defines `DEFAULT_STALE_DISPATCH_TIMEOUT_MS = 10 * 60 * 1000` (10 minutes). A 15-minute schedule guarantees that any in-flight lease abandoned by a crashed worker is quarantined within 15 to 25 minutes of initiation, without causing database read saturation or lock contention.
- **Authentication**:
  - Primary (OIDC): `--oidc-service-account-email="echonote-scheduler-invoker@echonote-2509.iam.gserviceaccount.com"` with `--oidc-token-audience="https://echonote-zfo2izdqla-uw.a.run.app"`
  - Headers: `Content-Type: application/json`
- **Request Body**:
  ```json
  {
    "limit": 50,
    "staleTimeoutMs": 600000
  }
  ```
- **Execution Deadline / Timeout**: `60s`

### Job B: Notification Dispatch Worker (`echonote-notification-dispatch`)
- **Target Endpoint**: `POST https://echonote-zfo2izdqla-uw.a.run.app/api/internal/notifications/dispatch`
- **Cadence**: `*/5 * * * *` (Every 5 minutes)
- **Cadence Rationale**: Bounded batches of 10 items executed every 5 minutes can process up to 120 items/hour (2,880 notifications/day), well within Resend free/standard tier burst rate limits and synchronous Cloud Run request budgets.
- **Authentication**:
  - Primary (OIDC): `--oidc-service-account-email="echonote-scheduler-invoker@echonote-2509.iam.gserviceaccount.com"` with `--oidc-token-audience="https://echonote-zfo2izdqla-uw.a.run.app"`
  - Headers: `Content-Type: application/json`
- **Request Body**:
  ```json
  {
    "batchSize": 10
  }
  ```
- **Execution Deadline / Timeout**: `120s`

---

## 5. Environment Variables Specification

The service relies on the following environment variables (named here, never populated with plaintext secrets):

| Variable Name | Provisioning Source | Purpose & Expected Value |
| :--- | :--- | :--- |
| `SCHEDULER_OIDC_AUDIENCE` | Cloud Run Env Var | Expected token audience (`https://echonote-zfo2izdqla-uw.a.run.app`) for OIDC token verification. |
| `SCHEDULER_SERVICE_ACCOUNT` | Cloud Run Env Var | Authorized dedicated service account email (`echonote-scheduler-invoker@echonote-2509.iam.gserviceaccount.com`) allowed to invoke internal endpoints via OIDC. |
| `CRON_SECRET` | Secret Manager (`echonote-cron-secret:latest`) | Legacy shared secret for internal worker authentication via `x-cron-key`. |
| `NOTIFICATION_DISPATCH_ENABLED` | Cloud Run Env Var / Secret | Production activation flag. Must be strictly `'true'` to send emails; unset or `'false'` defaults to dry-run mode. |
| `RESEND_API_KEY` | Secret Manager (`echonote-resend-api-key:latest`) | Resend provider API key used to deliver emails during live dispatch. |
| `RESEND_FROM_EMAIL` | Cloud Run Env Var | Canonical sender address (`EchoNote <invitations@echotechai.in>`). |
| `APP_URL` | Cloud Run Env Var | Public base URL (`https://echonote-25.ai.studio`) for email action links. |
| `INTERNAL_WORKER_SECRET` | Secret Manager (Optional) | Optional secondary bearer token for authorized workers. |

---

## 6. Scheduler Configuration & Management Commands

> [!NOTE]
> All commands in this section are presented for operator execution during approved deployment windows.
> None of these commands have been automatically executed.

### Preparation & Inspection (Safe / Read-Only)

```bash
# [NOT EXECUTED] View prepared OIDC gcloud scheduler commands without modifying live state (default, zero-secret)
bash scripts/schedule-notification-workers.sh --print

# [NOT EXECUTED] View prepared legacy header-based commands
bash scripts/schedule-notification-workers.sh --print --auth=header

# [NOT EXECUTED] List active scheduler jobs in the project
gcloud scheduler jobs list --project="echonote-2509" --location="us-west1"

# [NOT EXECUTED] Inspect detailed job definitions
gcloud scheduler jobs describe echonote-stale-dispatch-recovery --project="echonote-2509" --location="us-west1"
gcloud scheduler jobs describe echonote-notification-dispatch --project="echonote-2509" --location="us-west1"
```

### Idempotent Provisioning / Updating Scheduled Jobs

The deployment script executes a `describe` check first. If a job exists, it runs `gcloud scheduler jobs update http`; if absent, it runs `gcloud scheduler jobs create http`. This guarantees convergence on repeated runs:

```bash
# [NOT EXECUTED] Create or update jobs idempotently using OIDC authentication (default)
bash scripts/schedule-notification-workers.sh --execute-live

# [NOT EXECUTED] Create or update jobs idempotently using legacy header authentication
bash scripts/schedule-notification-workers.sh --execute-live --auth=header
```

### Emergency Disabling / Pausing Jobs

If anomalous behavior, unexpected load, or provider outages occur, jobs can be paused immediately without redeploying code:

```bash
# [NOT EXECUTED] Pause recurring notification dispatch
gcloud scheduler jobs pause echonote-notification-dispatch --project="echonote-2509" --location="us-west1"

# [NOT EXECUTED] Pause recurring stale-dispatch recovery
gcloud scheduler jobs pause echonote-stale-dispatch-recovery --project="echonote-2509" --location="us-west1"

# [NOT EXECUTED] Resume paused jobs
gcloud scheduler jobs resume echonote-notification-dispatch --project="echonote-2509" --location="us-west1"
gcloud scheduler jobs resume echonote-stale-dispatch-recovery --project="echonote-2509" --location="us-west1"
```

---

## 7. Verifying Dry-Run Operation & Response Metrics

Before enabling real notification dispatch, verify that the scheduler successfully invokes the endpoints and inspect the returned response payloads.

### Verifying Job Invocations via Manual Trigger
```bash
# [NOT EXECUTED] Manually trigger a single run of the dispatch job
gcloud scheduler jobs run echonote-notification-dispatch --project="echonote-2509" --location="us-west1"
```

### Expected Dry-Run JSON Response Contract
When `NOTIFICATION_DISPATCH_ENABLED` is unset or `false`, the response strictly reflects:
```json
{
  "success": true,
  "mode": "dry_run",
  "activationEnabled": false,
  "workerId": "dispatch_worker_a1b2c3d4",
  "scanned": 3,
  "claimed": 0,
  "sent": 0,
  "skipped": 3,
  "retryableFailures": 0,
  "permanentFailures": 0,
  "ambiguousDeliveries": 0,
  "items": [
    {
      "notificationId": "notif_task_123_abc",
      "recipientEmailMasked": "j***e@company.com",
      "action": "dry_run_scanned",
      "reason": "Dispatch activation disabled; dry-run mode active"
    }
  ]
}
```
**Verification Points**:
- `mode` must be `"dry_run"`.
- `activationEnabled` must be `false`.
- `claimed` must be `0`.
- `sent` must be `0`.
- `recipientEmailMasked` must mask the recipient email.

### Expected Stale-Dispatch Recovery Response Contract
```json
{
  "success": true,
  "scanned": 0,
  "quarantinedCount": 0,
  "quarantinedIds": [],
  "scannerWorkerId": "scanner_e5f6a7b8"
}
```

---

## 8. Log Inspection & Troubleshooting

### Viewing Cloud Run Invocations
```bash
# [NOT EXECUTED] Query Cloud Run logs for recent notification dispatch worker runs
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="echonote" AND textPayload=~"\[Notification Dispatch" OR jsonPayload.message=~"\[Notification Dispatch"' \
  --project="echonote-2509" \
  --limit=50 \
  --format="json"
```

### Viewing Ambiguous Delivery Alerts
Any delivery ambiguity triggers a high-severity emergency log:
```bash
# [NOT EXECUTED] Query emergency logs for quarantined ambiguous deliveries
gcloud logging read 'resource.type="cloud_run_revision" AND textPayload=~"\[AMBIGUOUS_DELIVERY_EMERGENCY\]"' \
  --project="echonote-2509" \
  --limit=20
```

### Investigating Quarantined & Retryable Records in Firestore
To review notifications requiring administrative attention:
1. Open the GCP Cloud Console Firestore Viewer for `echonote-2509`.
2. Inspect the `taskNotifications` collection:
   - Filter `status == "ambiguous_delivery"`: Notifications where provider dispatch succeeded or timed out, but Firestore confirmation failed or timed out.
   - Filter `status == "retryable_failed"`: Notifications encountering transient provider rate limits or network errors awaiting exponential backoff.
   - Filter `status == "failed"`: Permanent rejections (e.g., recipient membership revoked, invalid email).
3. If an `ambiguous_delivery` notification was verified delivered in the Resend dashboard, execute administrative reconciliation via the authenticated endpoint or Firestore Admin SDK by supplying `reconciledProviderMessageId`, `reconciledBy`, and `reconciliationReason`.

---

## 9. Explicit Pre-Activation Procedure for Real Email Dispatch

Before enabling real delivery in production (`NOTIFICATION_DISPATCH_ENABLED=true`), the following checklist must be satisfied:

1. **Verify Cloud Scheduler Stability**: Run scheduled jobs in dry-run mode for at least 24 hours. Confirm zero 500 errors and stable `dry_run` responses.
2. **Verify Firestore Composite Indexes**: Ensure composite indexes on `taskNotifications` (`status` + `leaseExpiresAt`, `status` + `nextRetryAt`, `status` + `dispatchStartedAt`) are in `READY` status.
3. **Verify Resend Domain Verification**: Confirm the sender domain `echotechai.in` is in `Verified` status in the Resend Console with valid SPF, DKIM, and DMARC records.
4. **Deploy Activation Variable**:
   Update the Cloud Run service environment variables to set `NOTIFICATION_DISPATCH_ENABLED=true`:
   ```bash
   # [NOT EXECUTED] Update Cloud Run environment to activate live email dispatch
   gcloud run services update echonote \
     --project="echonote-2509" \
     --region="us-west1" \
     --update-env-vars="NOTIFICATION_DISPATCH_ENABLED=true"
   ```
5. **Post-Activation Verification**:
   Trigger a test dispatch or wait for the next scheduled 5-minute run. Inspect response logs to confirm:
   - `mode: "live_dispatch"`
   - `sent > 0`
   - Zero `ambiguousDeliveries`
