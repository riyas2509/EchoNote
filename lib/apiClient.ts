import { auth } from '../firebase';

/**
 * Returns the base API URL configured in the environment, or empty string for same-origin requests.
 * Safely trims and strips trailing slashes to prevent double slashes.
 */
export function getApiBaseUrl(): string {
  const envUrl = (typeof import.meta !== 'undefined' && (import.meta as any)?.env)
    ? (import.meta as any).env.VITE_API_URL
    : (typeof process !== 'undefined' && process.env ? process.env.VITE_API_URL : undefined);
  if (typeof envUrl === 'string') {
    const trimmed = envUrl.trim();
    if (
      trimmed.length > 0 &&
      trimmed.toUpperCase() !== 'NA' &&
      trimmed.toLowerCase() !== 'undefined' &&
      trimmed.toLowerCase() !== 'null'
    ) {
      // Remove all trailing slashes
      const cleanBase = trimmed.replace(/\/+$/, '');
      
      // Safety check: Warn if VITE_API_URL points to the frontend origin instead of the backend
      if (typeof window !== 'undefined' && window.location.origin) {
        try {
          const parsed = new URL(cleanBase);
          if (parsed.origin === window.location.origin && window.location.hostname.endsWith('.vercel.app')) {
            console.warn(
              "⚠️ [EchoNote Config Warning] VITE_API_URL is configured to the Vercel frontend domain itself. " +
              "It must point to your Cloud Run Express backend URL (e.g. https://<backend-service>.run.app)."
            );
          }
        } catch {
          // Ignore invalid URL parsing here
        }
      }

      return cleanBase;
    }
  }
  return '';
}

export interface MfaPolicyChallengeDetail {
  code: 'MFA_ENROLLMENT_REQUIRED' | 'MFA_REQUIRED';
  message: string;
  mfaRequirement: 'MFA_REQUIRED_ADMINS' | 'MFA_ENFORCED_ALL' | string;
  mfaEnrolled?: boolean;
  organizationId?: string;
  role?: string;
}

export function isMfaPolicyError(err: any): boolean {
  if (!err) return false;
  const code = err.code || err.data?.code;
  return code === 'MFA_ENROLLMENT_REQUIRED' || code === 'MFA_REQUIRED';
}

export interface ApiResponse<T = any> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
  code?: string;
}

/**
 * Robust response parser that safely reads the response text, distinguishes
 * successful/unsuccessful JSON, empty responses, and HTML/text fallbacks.
 * Prevents "Unexpected end of JSON input" errors.
 */
export async function parseApiResponse<T = any>(response: Response): Promise<ApiResponse<T>> {
  const status = response.status;
  const isOk = response.ok;

  let rawText = '';
  try {
    rawText = await response.text();
  } catch (err: any) {
    return {
      ok: false,
      status,
      data: null,
      error: `Network error reading response (HTTP ${status}): ${err?.message || 'Unknown read error'}`
    };
  }

  // Handle empty body (e.g. 204 or empty response)
  if (!rawText || rawText.trim().length === 0) {
    if (isOk) {
      return { ok: true, status, data: {} as T };
    }
    
    // Provide explicit, actionable diagnosis for HTTP 405 Method Not Allowed
    let errorDetail = `Server returned an empty error response (HTTP ${status})`;
    if (status === 405) {
      const hasApiUrl = Boolean(getApiBaseUrl());
      const isVercelHost = typeof window !== 'undefined' && window.location.hostname.endsWith('.vercel.app');
      errorDetail = `Server returned an empty error response (HTTP 405 Method Not Allowed). ${
        !hasApiUrl
          ? "The request was routed to the Vercel static frontend host because VITE_API_URL is not configured. Please set VITE_API_URL in your Vercel Project Settings to your Cloud Run backend URL and redeploy."
          : isVercelHost && getApiBaseUrl().includes('vercel.app')
          ? "VITE_API_URL is configured to the Vercel frontend host instead of the Cloud Run backend URL. Please point VITE_API_URL to your Cloud Run backend URL."
          : "The requested endpoint does not allow this HTTP method or was intercepted by a static web server."
      }`;
    }

    return {
      ok: false,
      status,
      data: null,
      error: errorDetail,
      code: status === 405 ? 'METHOD_NOT_ALLOWED' : undefined
    };
  }

  // Attempt JSON parsing
  try {
    const json = JSON.parse(rawText);
    const hasError = !isOk || Boolean(json.error) || json.success === false;
    const errorMsg = hasError
      ? (json.message || json.error || json.details || `Request failed with HTTP ${status}`)
      : undefined;

    return {
      ok: !hasError,
      status,
      data: json,
      error: errorMsg,
      code: json.code
    };
  } catch (parseErr) {
    // Non-JSON response (e.g., HTML fallback or plaintext error)
    if (status === 405) {
      const hasApiUrl = Boolean(getApiBaseUrl());
      const safeMsg = `Server returned HTTP 405 Method Not Allowed. ${
        !hasApiUrl
          ? "The request reached the Vercel static hosting layer because VITE_API_URL is not set. Please set VITE_API_URL to your Cloud Run backend URL in Vercel and redeploy."
          : "The static server rejected the request method. Check that VITE_API_URL points to the Cloud Run backend."
      }`;
      return {
        ok: false,
        status,
        data: null,
        error: safeMsg,
        code: "METHOD_NOT_ALLOWED"
      };
    }

    const isHtml = /<!DOCTYPE|<html/i.test(rawText);
    const preview = rawText.length > 150 ? rawText.slice(0, 150) + '...' : rawText;

    const safeMsg = isHtml
      ? `Server returned an HTML page (HTTP ${status}) instead of JSON. The backend service may be down, misconfigured, or unreachable at this route.`
      : `Server returned non-JSON response (HTTP ${status}): ${preview}`;

    return {
      ok: false,
      status,
      data: null,
      error: safeMsg
    };
  }
}

/**
 * Safely parses the response as JSON or throws a clean, descriptive Error with status & code.
 */
export async function safeApiJson<T = any>(response: Response): Promise<T> {
  const parsed = await parseApiResponse<T>(response);
  if (!parsed.ok || !parsed.data) {
    const err: any = new Error(parsed.error || `Request failed with HTTP ${parsed.status}`);
    err.status = parsed.status;
    err.code = parsed.code;
    err.data = parsed.data;
    throw err;
  }
  return parsed.data;
}

/**
 * Constructs a fully qualified or clean relative URL for an API endpoint.
 * Ensures consistent routing regardless of same-origin or multi-origin deployment.
 * Completely eliminates double slashes.
 */
export function getApiUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    try {
      const parsed = new URL(path);
      parsed.pathname = parsed.pathname.replace(/\/+/g, '/');
      return parsed.toString();
    } catch {
      return path;
    }
  }
  const cleanPath = '/' + path.replace(/^\/+/, '');
  const baseUrl = getApiBaseUrl();
  return baseUrl ? `${baseUrl}${cleanPath}` : cleanPath;
}

/**
 * Custom Error type representing network connectivity, offline state, or CORS issues.
 */
export class ApiNetworkError extends Error {
  public endpoint: string;
  public isNetworkError: boolean = true;
  public isCorsOrOffline: boolean;
  public safeMessage: string;

  constructor(endpoint: string, originalError: any) {
    const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
    const baseUrl = getApiBaseUrl();
    const safeEndpoint = endpoint.replace(/(\?|&)(token|key|secret|password)=[^&]*/gi, '');
    
    let message = isOffline
      ? `You appear to be offline. Unable to reach EchoNote server at ${safeEndpoint}.`
      : `Unable to reach EchoNote API at ${safeEndpoint}. Check API base URL (${baseUrl || 'same-origin'}), server status, or network connection.`;

    super(message);
    this.name = 'ApiNetworkError';
    this.endpoint = safeEndpoint;
    this.isCorsOrOffline = isOffline;
    this.safeMessage = message;
  }
}

/**
 * Performs a lightweight health check against the backend server.
 */
export async function checkApiHealth(): Promise<{ ok: boolean; status?: string; latencyMs?: number; error?: string }> {
  const start = Date.now();
  const url = getApiUrl('/api/health');
  try {
    const res = await fetch(url, { method: 'GET', cache: 'no-store' });
    const latencyMs = Date.now() - start;
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: true, status: data.status || 'ok', latencyMs };
    }
    return { ok: false, status: `HTTP_${res.status}`, latencyMs, error: `HTTP ${res.status}: ${res.statusText}` };
  } catch (err: any) {
    return { ok: false, latencyMs: Date.now() - start, error: err?.message || 'Network unreachable' };
  }
}

/**
 * Retrieves the current Firebase Auth ID Token for the logged-in user.
 * Returns null if the user is not authenticated.
 */
export async function getAuthToken(): Promise<string | null> {
  try {
    if (!auth || !auth.currentUser) return null;
    return await auth.currentUser.getIdToken();
  } catch (error) {
    console.warn("⚠️ Failed to retrieve auth token:", error);
    return null;
  }
}

/**
 * Returns common headers including Authorization: Bearer <token> if available.
 */
export async function getAuthHeaders(extraHeaders: Record<string, string> = {}): Promise<HeadersInit> {
  const token = await getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...extraHeaders,
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  return headers;
}

/**
 * Safe frontend diagnostic helper that reports configuration status without leaking any secrets.
 */
export interface FrontendDiagnostic {
  apiBaseUrlConfigured: boolean;
  apiBaseUrlOrigin: string | null;
  firebaseConfigured: boolean;
  clientOrigin: string;
}

export function getFrontendDiagnostic(): FrontendDiagnostic {
  const baseUrl = getApiBaseUrl();
  let apiBaseUrlOrigin: string | null = null;
  if (baseUrl) {
    try {
      apiBaseUrlOrigin = new URL(baseUrl).origin;
    } catch {
      apiBaseUrlOrigin = baseUrl;
    }
  }

  const clientOrigin = typeof window !== 'undefined' ? window.location.origin : '';

  return {
    apiBaseUrlConfigured: Boolean(baseUrl && baseUrl.length > 0),
    apiBaseUrlOrigin,
    firebaseConfigured: Boolean(auth && auth.app),
    clientOrigin
  };
}

if (typeof window !== 'undefined') {
  (window as any).__ECHONOTE_DIAGNOSTICS__ = getFrontendDiagnostic;
}

// In-memory single-use MFA Recovery Ticket for active recovery session (TTL 10 min)
let activeRecoveryTicket: string | null = null;

export function setRecoveryTicket(ticket: string | null): void {
  activeRecoveryTicket = ticket;
}

export function getRecoveryTicket(): string | null {
  return activeRecoveryTicket;
}

export function clearRecoveryTicket(): void {
  activeRecoveryTicket = null;
}

/**
 * Wrapper around standard fetch that:
 * 1. Automatically resolves relative endpoints via getApiUrl()
 * 2. Automatically attaches the Firebase ID token in Authorization header
 * 3. Recovery tickets are strictly NEVER attached automatically to general API requests (dedicated recovery calls only)
 * 4. Provides clean error wrapping on network failure without leaking secrets
 */
export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  let finalInput = input;
  let targetUrlStr = typeof input === 'string' ? input : input.toString();

  if (typeof input === 'string') {
    if (input.startsWith('/') || (!input.startsWith('http://') && !input.startsWith('https://'))) {
      finalInput = getApiUrl(input);
      targetUrlStr = finalInput;
    }
  }

  const token = await getAuthToken();
  const headers = new Headers(init.headers || {});

  if (!headers.has('Content-Type') && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  try {
    const res = await fetch(finalInput, {
      ...init,
      headers,
    });

    if (res.status === 403) {
      try {
        const clone = res.clone();
        const json = await clone.json();
        if (json && (json.code === 'MFA_ENROLLMENT_REQUIRED' || json.code === 'MFA_REQUIRED')) {
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('echonote:mfa-policy-challenge', {
              detail: {
                code: json.code,
                message: json.message || 'Two-factor authentication required by organization policy.',
                mfaRequirement: json.mfaRequirement || 'MFA_REQUIRED',
                mfaEnrolled: Boolean(json.mfaEnrolled),
                organizationId: json.organizationId,
                role: json.role
              }
            }));
          }
        }
      } catch {
        // Safe ignore non-JSON error bodies
      }
    }

    return res;
  } catch (err: any) {
    // If the browser threw TypeError: Failed to fetch, wrap it in a descriptive ApiNetworkError
    console.error(`[apiClient] Network request failed for ${targetUrlStr}:`, err?.message || err);
    throw new ApiNetworkError(targetUrlStr, err);
  }
}

/* ==========================================================================
   RECORDING COMMENTS API METHODS (Phase 1, Step 4B)
   ========================================================================== */

export interface CreateCommentPayload {
  content: string;
  timestampSeconds?: number;
  parentCommentId?: string;
}

export interface UpdateCommentPayload {
  content: string;
}

/**
 * Fetches all comments associated with a specific recording.
 * Requires authenticated session and VIEW permission on the enclosing project.
 */
export async function getRecordingComments(recordingId: string): Promise<{ comments: import('../types').Comment[] }> {
  const res = await apiFetch(`/api/recordings/${encodeURIComponent(recordingId)}/comments`, {
    method: 'GET',
  });
  return safeApiJson<{ comments: import('../types').Comment[] }>(res);
}

/**
 * Creates a new comment or reply attached to a recording.
 * Requires authenticated session and COMMENT permission on the enclosing project.
 * Derives userId, userEmail, userName, projectId, and orgId server-side.
 */
export async function createRecordingComment(
  recordingId: string,
  payload: CreateCommentPayload
): Promise<{ success: boolean; comment: import('../types').Comment }> {
  const res = await apiFetch(`/api/recordings/${encodeURIComponent(recordingId)}/comments`, {
    method: 'POST',
    body: JSON.stringify({
      content: payload.content,
      timestampSeconds: payload.timestampSeconds,
      parentCommentId: payload.parentCommentId,
    }),
  });
  return safeApiJson<{ success: boolean; comment: import('../types').Comment }>(res);
}

/**
 * Updates an existing comment's text content.
 * Authorized for author (with COMMENT permission) or moderator (admin/owner/platform_admin).
 */
export async function updateComment(
  commentId: string,
  payload: UpdateCommentPayload
): Promise<{ success: boolean; comment: import('../types').Comment }> {
  const res = await apiFetch(`/api/comments/${encodeURIComponent(commentId)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      content: payload.content,
    }),
  });
  return safeApiJson<{ success: boolean; comment: import('../types').Comment }>(res);
}

/**
 * Permanently deletes a comment.
 * Authorized for author (with COMMENT permission) or moderator (admin/owner/platform_admin).
 */
export async function deleteComment(
  commentId: string
): Promise<{ success: boolean; message: string; commentId: string }> {
  const res = await apiFetch(`/api/comments/${encodeURIComponent(commentId)}`, {
    method: 'DELETE',
  });
  return safeApiJson<{ success: boolean; message: string; commentId: string }>(res);
}

/* ==========================================================================
   ORGANIZATION ADMINISTRATION API METHODS (Phase 1A, Step 5D)
   ========================================================================== */

/**
 * Cancels a pending organization invitation.
 * Server-authoritative endpoint enforcing owner/org_admin role and tenant boundary.
 */
export async function cancelOrgInvitation(
  organizationId: string,
  inviteId: string
): Promise<{ success: boolean; message: string }> {
  const res = await apiFetch(
    `/api/organizations/${encodeURIComponent(organizationId)}/invitations/${encodeURIComponent(inviteId)}`,
    {
      method: 'DELETE'
    }
  );
  return safeApiJson<{ success: boolean; message: string }>(res);
}

/**
 * Assigns or clears a member's department.
 * Server-authoritative endpoint enforcing owner/org_admin role and tenant boundary.
 */
export async function assignMemberDepartment(
  organizationId: string,
  memberId: string,
  departmentId: string | null
): Promise<{ success: boolean; memberId: string; departmentId: string; message: string }> {
  const res = await apiFetch(
    `/api/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(memberId)}/department`,
    {
      method: 'PATCH',
      body: JSON.stringify({ departmentId })
    }
  );
  return safeApiJson<{ success: boolean; memberId: string; departmentId: string; message: string }>(res);
}

/**
 * Deactivates an organization member.
 * Server-authoritative endpoint enforcing owner/org_admin role; owner cannot be deactivated.
 */
export async function deactivateMember(
  organizationId: string,
  memberId: string
): Promise<{ success: boolean; memberId: string; status: 'deactivated' }> {
  const res = await apiFetch(
    `/api/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(memberId)}/deactivate`,
    {
      method: 'POST'
    }
  );
  return safeApiJson<{ success: boolean; memberId: string; status: 'deactivated' }>(res);
}

/**
 * Reactivates a deactivated organization member.
 * Server-authoritative endpoint enforcing owner/org_admin role.
 */
export async function reactivateMember(
  organizationId: string,
  memberId: string
): Promise<{ success: boolean; memberId: string; status: 'active' }> {
  const res = await apiFetch(
    `/api/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(memberId)}/reactivate`,
    {
      method: 'POST'
    }
  );
  return safeApiJson<{ success: boolean; memberId: string; status: 'active' }>(res);
}

/**
 * Transfers organization ownership to an active eligible member.
 * Strictly owner-only endpoint.
 */
export async function transferOrgOwnership(
  organizationId: string,
  payload: { targetMemberId?: string; targetEmail?: string; targetUserId?: string }
): Promise<{ success: boolean; previousOwner: string; newOwner: string; message: string }> {
  const res = await apiFetch(
    `/api/organizations/${encodeURIComponent(organizationId)}/transfer-ownership`,
    {
      method: 'POST',
      body: JSON.stringify(payload)
    }
  );
  return safeApiJson<{ success: boolean; previousOwner: string; newOwner: string; message: string }>(res);
}

/**
 * Removes a member from an organization and cleans up their project memberships.
 * Enforces owner/org_admin permissions.
 */
export async function removeOrgMember(
  organizationId: string,
  memberId: string
): Promise<{ success: boolean; memberId: string; cleanedProjectMemberships: number; message: string }> {
  const res = await apiFetch(
    `/api/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(memberId)}`,
    {
      method: 'DELETE'
    }
  );
  return safeApiJson<{ success: boolean; memberId: string; cleanedProjectMemberships: number; message: string }>(res);
}

/**
 * Updates an organization member's role.
 * Server-authoritative endpoint enforcing owner/org_admin role.
 */
export async function updateMemberRole(
  organizationId: string,
  memberId: string,
  role: string
): Promise<{ success: boolean; memberId: string; role: string; message: string }> {
  const res = await apiFetch(
    `/api/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(memberId)}/role`,
    {
      method: 'PATCH',
      body: JSON.stringify({ role })
    }
  );
  return safeApiJson<{ success: boolean; memberId: string; role: string; message: string }>(res);
}

/**
 * Sends an organization invitation via the authoritative server API.
 */
export async function sendOrgInvite(
  organizationId: string,
  payload: { email: string; role: string; departmentId?: string; teamId?: string; resend?: boolean }
): Promise<{ 
  success: boolean; 
  message?: string; 
  emailSent?: boolean; 
  emailError?: string; 
  emailErrorCode?: string; 
  warning?: string; 
  invite?: any 
}> {
  const res = await apiFetch(
    `/api/organizations/${encodeURIComponent(organizationId)}/invite`,
    {
      method: 'POST',
      body: JSON.stringify(payload)
    }
  );
  return safeApiJson<{ 
    success: boolean; 
    message?: string; 
    emailSent?: boolean; 
    emailError?: string; 
    emailErrorCode?: string; 
    warning?: string; 
    invite?: any 
  }>(res);
}

export interface OrgInvitationPreview {
  valid: boolean;
  status: 'pending' | 'accepted' | 'cancelled' | 'rejected' | 'expired' | 'invalid' | 'unavailable';
  organizationName?: string;
  orgId?: string;
  invitedBy?: string;
  recipientEmail?: string;
  role?: string;
  expiresAt?: string;
  message?: string;
}

/**
 * Safely previews non-sensitive organization invitation metadata (Step 6D & 6G).
 * Accurately detects non-JSON/HTML responses (e.g. from static host SPA catch-all rewrites)
 * and distinguishes API unavailability from invalid invitations without logging tokens.
 */
export async function previewOrgInvite(inviteId: string): Promise<OrgInvitationPreview> {
  const safeServiceErrorMessage = 'EchoNote could not connect to the invitation service. Please try again.';

  let res: Response;
  try {
    res = await apiFetch(`/api/organizations/invitation-preview/${encodeURIComponent(inviteId)}`, {
      method: 'GET'
    });
  } catch (netErr: any) {
    console.error("⚠️ [apiClient] Invitation preview network failure:", netErr?.safeMessage || netErr?.message || 'Network unreachable');
    return {
      valid: false,
      status: 'unavailable',
      message: safeServiceErrorMessage
    };
  }

  const contentType = res.headers.get('content-type') || '';
  let rawText = '';
  try {
    rawText = await res.text();
  } catch {
    console.error("⚠️ [apiClient] Failed to read invitation preview response stream");
    return {
      valid: false,
      status: 'unavailable',
      message: safeServiceErrorMessage
    };
  }

  // Detect HTML response (e.g. static hosting SPA fallback or proxy error pages)
  const isHtml = /<!DOCTYPE|<html/i.test(rawText) || contentType.toLowerCase().includes('text/html');
  if (isHtml) {
    console.error(
      `⚠️ [apiClient] Expected JSON from invitation preview, but received HTML (HTTP ${res.status}). ` +
      `Verify that VITE_API_URL is configured in your frontend host environment.`
    );
    return {
      valid: false,
      status: 'unavailable',
      message: safeServiceErrorMessage
    };
  }

  // Attempt JSON parsing
  let data: any = null;
  try {
    data = JSON.parse(rawText);
  } catch {
    console.error(`⚠️ [apiClient] Failed to parse JSON response for invitation preview (HTTP ${res.status})`);
    return {
      valid: false,
      status: 'unavailable',
      message: safeServiceErrorMessage
    };
  }

  if (!res.ok) {
    if (res.status === 404) {
      return {
        valid: false,
        status: 'invalid',
        message: data?.message || data?.error || 'Invitation not found. Please request a new invitation.'
      };
    }

    if (data?.status === 'expired' || data?.status === 'cancelled' || data?.status === 'rejected' || data?.status === 'accepted') {
      return {
        valid: false,
        status: data.status,
        message: data.message || data.error
      };
    }

    if (res.status >= 500) {
      return {
        valid: false,
        status: 'unavailable',
        message: safeServiceErrorMessage
      };
    }

    return {
      valid: false,
      status: data?.status || 'invalid',
      message: data?.message || data?.error || 'Failed to resolve invitation.'
    };
  }

  if (!data || typeof data !== 'object' || !data.status) {
    console.error("⚠️ [apiClient] Invitation preview returned unexpected response structure");
    return {
      valid: false,
      status: 'unavailable',
      message: safeServiceErrorMessage
    };
  }

  return data;
}

/**
 * Accepts an organization invitation via authoritative server API (Step 6D).
 * The server is authoritative for role, orgId, and recipient identity.
 */
export async function acceptOrgInvite(inviteId: string): Promise<{
  success: boolean;
  memberId: string;
  orgId: string;
  role: string;
  message?: string;
}> {
  const res = await apiFetch('/api/organizations/accept-invite', {
    method: 'POST',
    body: JSON.stringify({ inviteId })
  });
  return safeApiJson(res);
}

/* ==========================================================================
   MFA RECOVERY CODES API METHODS (Step 3B.4.2)
   ========================================================================== */

export interface RecoveryCodesStatus {
  configured: boolean;
  remainingCodes: number;
  totalCodes: number;
  createdAt: string | null;
}

export interface GeneratedRecoveryCodesResponse {
  success: boolean;
  codes: string[];
  totalCodes: number;
  message: string;
}

export interface RedeemRecoveryCodeResponse {
  success: boolean;
  message: string;
  recoveryTicket: string;
  remainingCodes: number;
}

/**
 * Fetches status of user's MFA recovery codes (count and whether configured).
 * Does not leak codes or verifiers.
 */
export async function getRecoveryCodesStatus(): Promise<RecoveryCodesStatus> {
  const res = await apiFetch('/api/auth/mfa/recovery-codes/status', {
    method: 'GET'
  });
  return safeApiJson<RecoveryCodesStatus>(res);
}

/**
 * Generates or regenerates a fresh set of 10 single-use recovery codes.
 * Requires recent reauthentication. Codes are only shown once.
 */
export async function generateRecoveryCodes(): Promise<GeneratedRecoveryCodesResponse> {
  const res = await apiFetch('/api/auth/mfa/recovery-codes/generate', {
    method: 'POST'
  });
  return safeApiJson<GeneratedRecoveryCodesResponse>(res);
}

/**
 * Atomically redeems a single-use recovery code and sets active recovery ticket.
 */
export async function redeemRecoveryCode(code: string): Promise<RedeemRecoveryCodeResponse> {
  const res = await apiFetch('/api/auth/mfa/recovery/redeem', {
    method: 'POST',
    body: JSON.stringify({ code })
  });
  const data = await safeApiJson<RedeemRecoveryCodeResponse>(res);
  if (data?.recoveryTicket) {
    setRecoveryTicket(data.recoveryTicket);
  }
  return data;
}

/**
 * Explicitly sends the recovery ticket to the dedicated recovery reset endpoint.
 * This is the ONLY endpoint permitted to consume the recovery ticket.
 */
export async function resetLostFactorWithRecovery(recoveryTicket?: string): Promise<{ success: boolean; message: string }> {
  const ticket = recoveryTicket || getRecoveryTicket();
  if (!ticket) {
    throw new Error("No recovery ticket available. Please redeem a recovery code first.");
  }

  const res = await apiFetch('/api/auth/mfa/recovery/reset-factors', {
    method: 'POST',
    headers: {
      'X-MFA-Recovery-Ticket': ticket
    }
  });

  const data = await safeApiJson<{ success: boolean; message: string }>(res);
  // Clear the ticket in-memory immediately after successful single-use factor reset
  clearRecoveryTicket();
  return data;
}




