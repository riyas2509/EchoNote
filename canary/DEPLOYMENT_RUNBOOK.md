# EchoNote Gemini Canary Deployment Runbook (Isolated Evaluation)

## 1. Safety and Pre-Deployment Verification

> [!WARNING]
> **READ-ONLY / DRAFT NOTICE**: This document represents a proposed deployment procedure for the isolated Gemini canary evaluation service (`echonote-gemini-canary`).
> No build, deployment, secret mutation, IAM assignment, or remote API execution has been performed or is authorized by updating this runbook.
>
> All values enclosed in `<...>` are placeholders. **Never execute commands with unvalidated placeholders, mutable tags, or the string `latest`.**

### 1.1 Scope and Invariants
- **Isolated Service**: The canary service executes ONLY `canary/gemini-canary.ts` compiled into `dist/canary.cjs` (packaged via `canary/Dockerfile.canary` and started via entrypoint `node dist/canary.cjs`). It must **never** start the EchoNote production web application or mount production handlers.
- **Dedicated Secret Resource**: Secret Manager IAM permissions apply to the entire secret resource, not individual versions. Therefore, the canary **must use a dedicated secret resource** (e.g. `echonote-gemini-canary-key`), completely isolated from any production secret (such as `echonote-gemini-api-key`).
- **Effective Permissions Gate**: Granting a resource-level binding on `echonote-gemini-canary-key` is necessary but does **not** by itself prove that the runtime identity cannot access other secrets. Inherited project-level, folder-level, or organization-level roles (or broader predefined roles) may confer access to production secrets. The operator must verify that the effective permissions of the runtime identity (`echonote-canary-sa@echonote-2509.iam.gserviceaccount.com`) include **zero** access to production secrets, zero Firestore access, zero Cloud Storage access, zero Cloud SQL access, zero email/SMS credentials, and zero external integration permissions.
- **Strict Ingress**: The canary service must be deployed with `--no-allow-unauthenticated`. Public or anonymous invocations are prohibited; authentication is enforced at the Cloud Run IAM boundary.

---

## 2. Dedicated Canary Container Build Configuration

### 2.1 Dedicated Build File
The dedicated Cloud Build configuration is authored locally at:
`canary/cloudbuild-canary.yaml`

> [!IMPORTANT]
> **Static Local Validation Only**: `canary/cloudbuild-canary.yaml` has been authored and statically validated locally. It has **NOT** been submitted to or validated by a live Cloud Build execution.
> The build step explicitly specifies `--file=canary/Dockerfile.canary` and uses the repository root (`.`) as the build context.

### 2.2 Authorized Cloud Build Command (Future Execution)
When a build is authorized, the operator must execute Cloud Build using `canary/cloudbuild-canary.yaml` and **must explicitly supply the substitution `_IMAGE_NAME`** with the target Artifact Registry repository, image name, and unique tag.

```bash
# Future authorized Cloud Build command:
gcloud builds submit . \
  --config=canary/cloudbuild-canary.yaml \
  --substitutions=_IMAGE_NAME="<REGION>-docker.pkg.dev/<PROJECT_ID>/<ARTIFACT_REGISTRY_REPO>/echonote-gemini-canary:<UNIQUE_BUILD_TAG>"
```

> [!CAUTION]
> - **Explicit Substitution Mandatory**: `_IMAGE_NAME` defaults to an empty string (`''`) in `canary/cloudbuild-canary.yaml`. Never rely on the default. An explicit, fully-qualified image path and unique tag must be passed via `--substitutions`.
> - **Do Not Execute Prematurely**: Do not submit this command until container build authorization and Artifact Registry setup are confirmed.

### 2.3 Cloud Build ID and Immutable Digest Gate
Once the authorized build completes:
1. Record the Cloud Build execution ID (`BUILD_ID`).
2. Query Artifact Registry or Cloud Build logs to extract the **immutable sha256 image digest**:
   ```bash
   gcloud artifacts docker images describe \
     "<REGION>-docker.pkg.dev/<PROJECT_ID>/<ARTIFACT_REGISTRY_REPO>/echonote-gemini-canary:<UNIQUE_BUILD_TAG>" \
     --format="value(image_summary.digest)"
   ```
3. **Immutable Digest Gate**:
   - Verify that the digest matches the artifact produced by the specific Cloud Build execution.
   - **Do not deploy using a mutable tag** (such as `:canary-test` or `:latest`). Mutable tags do not provide cryptographic provenance or deployment reproducibility.
   - If the immutable digest cannot be obtained and verified against the completed build ID, **block deployment immediately**.

---

## 3. Dedicated Secret Resource and Secret Version Pinning

### 3.1 Isolated Secret Resource
The canary must use its own dedicated Secret Manager secret to prevent the canary service account from reading any other secret:
- Proposed Secret Name: `echonote-gemini-canary-key`
- Project: `echonote-2509`

### 3.2 Secret Version Pinning
- The secret version must be explicitly pinned to an exact integer version number (e.g., `1`).
- **Never use `latest`**: Using `latest` allows unexpected credential updates without a deployment audit and prevents reproducible rollback.
- Secret Manager Accessor permission (`roles/secretmanager.secretAccessor`) must be granted to `echonote-canary-sa` **strictly on the resource `echonote-gemini-canary-key`**, not at the project level:
  ```bash
  # Pre-deployment IAM binding on the dedicated secret resource:
  gcloud secrets add-iam-policy-binding echonote-gemini-canary-key \
    --project=echonote-2509 \
    --member="serviceAccount:echonote-canary-sa@echonote-2509.iam.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"
  ```

### 3.3 Runtime Identity Effective IAM Review Gate
> [!CRITICAL]
> **Resource-Level Policy Does Not Rule Out Inherited Access**:
> Inspecting the IAM policy of `echonote-gemini-canary-key` confirms only what is bound directly to that secret. It does **not** rule out project-level, folder-level, or broader roles granted to `echonote-canary-sa`.
>
> Prior to deployment, the operator must inspect the project IAM policy to verify the runtime identity holds no unintended broader access:
>
> ```bash
> # Illustrative check: inspect project-level bindings for the runtime service account
> gcloud projects get-iam-policy echonote-2509 \
>   --flatten="bindings[].members" \
>   --filter="bindings.members:serviceAccount:echonote-canary-sa@echonote-2509.iam.gserviceaccount.com" \
>   --format="table(bindings.role)"
> ```
>
> **Mandatory Deployment Gate**:
> - Confirm that `echonote-canary-sa` has **no project-wide `roles/secretmanager.secretAccessor`**, `roles/secretmanager.admin`, `roles/editor`, `roles/owner`, or other broad roles.
> - Confirm that `echonote-canary-sa` has **no Firestore (`roles/datastore.*`), Cloud Storage (`roles/storage.*`), or Cloud SQL roles**.
> - If any inherited or broader grant confers access to production secrets or application databases, **the deployment gate FAILS and deployment must remain BLOCKED** until the runtime identity is stripped to least privilege.

---

## 4. Cloud Run Deployment Specification

### 4.1 Target Environment & Identifiers
- **Service Name**: `echonote-gemini-canary`
- **Project ID**: `echonote-2509`
- **Region**: `us-west1`
- **Runtime Identity**: `echonote-canary-sa@echonote-2509.iam.gserviceaccount.com`
- **Ingress**: Authenticated invocations only (`--no-allow-unauthenticated`)
- **Port Handling**: The application reads `process.env.PORT` and defaults to port `3000` (`startCanaryServer()` at `canary/gemini-canary.ts:429`). Cloud Run dynamically injects `PORT` (conventionally `8080`) into container instances at runtime. No explicit manual `PORT` override is required in environment variables.
- **Model & Timeout Configuration**:
  - The model is **hardcoded as `gemini-3.5-flash`** in `canary/gemini-canary.ts:277,415`. The application does not read or support a `GEMINI_MODEL` environment variable.
  - The verification operation timeout is **15 seconds** (15,000 ms, configured via application logic in `canary/gemini-canary.ts:200`). The application does not read `GEMINI_TIMEOUT_MS`.
  - Cloud Run container request timeout is set to `60s` to accommodate network latency and TLS negotiation ahead of the 15-second model execution window.

### 4.2 Cloud Run Deployment Command Template
```bash
# Template for future authorized deployment:
gcloud run deploy echonote-gemini-canary \
  --project=echonote-2509 \
  --region=us-west1 \
  --image="<REGION>-docker.pkg.dev/<PROJECT_ID>/<ARTIFACT_REGISTRY_REPO>/echonote-gemini-canary@sha256:<VERIFIED_IMMUTABLE_DIGEST>" \
  --service-account="echonote-canary-sa@echonote-2509.iam.gserviceaccount.com" \
  --no-allow-unauthenticated \
  --set-secrets="GEMINI_API_KEY=echonote-gemini-canary-key:<PINNED_SECRET_VERSION_NUMBER>" \
  --cpu=1 \
  --memory=512Mi \
  --min-instances=0 \
  --max-instances=1 \
  --timeout=60s
```

---

## 5. Invocation and IAM Verification

### 5.1 Invoker Privilege
Only authorized evaluator identities (e.g. the operator's user account or dedicated test runner) may be granted `roles/run.invoker` on `echonote-gemini-canary`.

### 5.2 Verification of IAM Policy
Before sending traffic and after any IAM change:
```bash
# Verify only authorized invoker members exist:
gcloud run services get-iam-policy echonote-gemini-canary \
  --project=echonote-2509 \
  --region=us-west1 \
  --format=yaml
```
Confirm `allUsers` and `allAuthenticatedUsers` are **absent**.

### 5.3 Controlled Authorized Invocation
Cloud Run IAM authentication requires an OpenID Connect (OIDC) identity token specifically minted with the deployed service URL as its audience (`--audiences="${CANARY_URL}"`). A generic token without `--audiences` will be rejected by Cloud Run with HTTP 401.

```bash
# Retrieve Cloud Run service URL:
CANARY_URL=$(gcloud run services describe echonote-gemini-canary \
  --project=echonote-2509 \
  --region=us-west1 \
  --format="value(status.url)")

# Mint audience-scoped identity token:
CANARY_TOKEN=$(gcloud auth print-identity-token --audiences="${CANARY_URL}")

# 1. Health Check (Actual endpoint: GET /health):
curl -s -H "Authorization: Bearer ${CANARY_TOKEN}" \
  "${CANARY_URL}/health"

# Expected Health Response:
# {"status":"HEALTHY","service":"echonote-gemini-canary","timestamp":"..."}

# 2. Canary Audio Verification (Actual endpoint: POST /verify):
# Supported audio MIME types: audio/wav, audio/webm, audio/mp3, audio/mpeg,
#                            audio/ogg, audio/flac, audio/aac, audio/mp4, audio/m4a
# Optional targetLanguage: "english" | "original"
curl -s -X POST \
  -H "Authorization: Bearer ${CANARY_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"audioBase64":"<BASE64_ENCODED_AUDIO_PAYLOAD>","mimeType":"audio/wav","targetLanguage":"english"}' \
  "${CANARY_URL}/verify"
```

> [!CAUTION]
> **Synthetic Placeholders Are Not Transcription Evidence**:
> Do not use arbitrary non-speech Base64 strings (such as `dGVzdA==`) as evidence of transcription capability. While `dGVzdA==` validates the Base64 syntax and body limit, it contains no spoken words.

---

## 6. Real Speech Transcription Gate & Observability

### 6.1 Transcription Quality Gate and Intentional Transcript Omission
The canary verification endpoint implements a **strict privacy-preserving design**:
- The service **NEVER returns transcript text, segment text, speaker names, or executive summaries** to the caller.
- The successful HTTP 200 response (`CanaryVerifyResponse`) contains only safe aggregated metadata:
  ```json
  {
    "status": "SUCCESS",
    "modelUsed": "gemini-3.5-flash",
    "catalogReachable": true,
    "transcriptionValid": true,
    "qualityScore": 98,
    "segmentCount": 1
  }
  ```

#### Real Speech Validation Requirements:
1. Provide a **controlled, non-sensitive speech recording** containing known spoken English.
2. Confirm successful HTTP response handling and `status === "SUCCESS"`.
3. Verify that `transcriptionValid === true`, `catalogReachable === true`, and `segmentCount > 0`.
4. Record the returned `modelUsed` (must be `gemini-3.5-flash`) and `qualityScore` (0-100).
5. **Necessary vs. Sufficient Limitation**:
   - These metadata fields are **necessary signals** that Gemini processed the audio stream and parsed it against the transcription schema without throwing errors.
   - However, because the response intentionally omits transcript text to protect sensitive spoken content, these metadata fields are **not sufficient proof of word-level recognition accuracy**.
   - **Do not weaken or bypass transcript omission** in `canary/gemini-canary.ts` to make verification easier.
   - If word-level correctness must be independently established without exposing raw transcripts in response payloads, this limitation must be explicitly recorded, and a separately reviewed privacy-preserving validation method (e.g. offline acoustic evaluation or one-way cryptographic hash of expected text) must be established before claiming transcription accuracy.

### 6.2 Log Verification and Zero-Leakage Audit
Inspect Cloud Logging for the canary revision:
1. Verify **no secret leakage**: Ensure `GEMINI_API_KEY` or raw header authorization values never appear in logs.
2. Verify **no raw audio leakage**: Ensure `audioBase64` payloads are not logged.
3. Verify **no full transcript leakage**: Ensure transcripts are never written to Cloud Logging.

---

## 7. Emergency Revocation and Teardown Procedures

If suspicious activity, unexpected model behavior, or configuration drift is detected, use the following verified revocation and decommissioning procedures.

> [!NOTE]
> Setting `--max-instances=0` does not disable ingress, revoke IAM permissions, or prevent incoming requests from queuing at the proxy; ingress must be revoked at the IAM policy level or via service deletion.

### 7.1 Verified Complete IAM Invocation Revocation
Removing a single IAM binding for one user does **not** prove that all callers are blocked. Additional members, service accounts, groups, or inherited project-level roles may still hold invocation access.

To perform a complete and verifiable invocation revocation:

1. **Inspect Complete Service IAM Policy**:
   Retrieve and inspect the complete IAM policy for the service:
   ```bash
   gcloud run services get-iam-policy echonote-gemini-canary \
     --project=echonote-2509 \
     --region=us-west1 \
     --format=yaml
   ```
2. **Identify Every Invoker Binding**:
   Identify every principal bound to `roles/run.invoker` (including user accounts, service accounts, and Google Groups). Check specifically for public principals (`allUsers`, `allAuthenticatedUsers`).
3. **Explicitly Remove Each Unauthorized Binding**:
   For each member holding `roles/run.invoker`, execute an explicitly authorized removal command.
   *(Illustrative example for a specific authorized member — do not execute in bulk or via unreviewed scripts)*:
   ```bash
   gcloud run services remove-iam-policy-binding echonote-gemini-canary \
     --project=echonote-2509 \
     --region=us-west1 \
     --member="<SPECIFIC_MEMBER_TO_REVOKE>" \
     --role="roles/run.invoker"
   ```
4. **Recheck Complete Policy After Changes**:
   Re-run `gcloud run services get-iam-policy` to confirm that the `roles/run.invoker` role contains **no members** or only strictly necessary break-glass administrative identities.
5. **Effective Access Verification Limitation**:
   Note that removing service-level invoker bindings does not override project-level or folder-level roles (e.g., project `Editor`, `Owner`, or project-wide `roles/run.admin` / `roles/run.invoker`). If immediate, complete containment is required and IAM policy verification cannot definitively eliminate all caller paths, use **destructive service deletion (Section 7.2)** as an explicitly authorized containment alternative.

### 7.2 Service Deletion (Destructive Cloud Run Containment)
Service deletion is a destructive containment action that removes the deployed Cloud Run service after the deletion operation completes.

> [!CAUTION]
> **Realistic Containment Scope for Service Deletion**:
> - Deleting the service **does not guarantee immediate cancellation of HTTP requests already in-flight** or actively executing inside a container instance before termination completes.
> - After the deletion command completes, the operator **must explicitly verify that the service is absent** (e.g. confirming that `gcloud run services describe echonote-gemini-canary` returns a NOT_FOUND error).
> - Deleting the service does **not** prevent a sufficiently privileged operator or automated pipeline from subsequently recreating the service.
> - Any stronger or permanent containment actions (such as project-wide permission revocations, key destruction, or organization policy constraints) must be separately authorized and must **never** be represented as completed simply by issuing a service deletion command.

```bash
# Destructive action: requires explicit operator authorization
gcloud run services delete echonote-gemini-canary \
  --project=echonote-2509 \
  --region=us-west1 \
  --quiet

# Verification of absence after deletion completes:
gcloud run services describe echonote-gemini-canary \
  --project=echonote-2509 \
  --region=us-west1
# Must return: ERROR: (gcloud.run.services.describe) Cannot find service [echonote-gemini-canary]
```

### 7.3 Independent Lifecycle of Related Resources
Deleting the Cloud Run service removes the runtime compute service only. **It does NOT delete or clean up other evaluation resources.** The operator must separately manage the lifecycle of each associated resource:

- **Cloud Logging Records**: Log entries generated by Cloud Run and Cloud Build remain in Cloud Logging according to the project's log bucket retention policies.
- **Artifact Registry Container Images**: Container images pushed during Cloud Build (e.g. `echonote-gemini-canary@sha256:...`) remain in Artifact Registry until explicitly deleted or pruned by lifecycle rules.
- **Secret Manager Resources**: The dedicated secret `echonote-gemini-canary-key` and its version(s) remain active in Secret Manager until explicitly disabled or destroyed.
- **Service Accounts & IAM Roles**: The runtime service account `echonote-canary-sa` and its Secret Manager accessor bindings remain until explicitly decommissioned.
- **Cloud Build History**: Build records, execution logs, and provenance metadata remain recorded in Cloud Build history.
