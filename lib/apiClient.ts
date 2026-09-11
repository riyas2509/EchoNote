import { auth } from '../firebase';

/**
 * Returns the base API URL configured in the environment, or empty string for same-origin requests.
 */
export function getApiBaseUrl(): string {
  const envUrl = import.meta.env.VITE_API_URL;
  if (typeof envUrl === 'string') {
    const trimmed = envUrl.trim();
    if (
      trimmed.length > 0 &&
      trimmed.toUpperCase() !== 'NA' &&
      trimmed.toLowerCase() !== 'undefined' &&
      trimmed.toLowerCase() !== 'null'
    ) {
      return trimmed.replace(/\/+$/, '');
    }
  }
  return '';
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
    return {
      ok: false,
      status,
      data: null,
      error: `Server returned an empty error response (HTTP ${status})`
    };
  }

  // Attempt JSON parsing
  try {
    const json = JSON.parse(rawText);
    const hasError = !isOk || Boolean(json.error) || json.success === false;
    const errorMsg = hasError
      ? (json.error || json.message || json.details || `Request failed with HTTP ${status}`)
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
 */
export function getApiUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
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
 * Wrapper around standard fetch that:
 * 1. Automatically resolves relative endpoints via getApiUrl()
 * 2. Automatically attaches the Firebase ID token in Authorization header
 * 3. Provides clean error wrapping on network failure without leaking secrets
 */
export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  let finalInput = input;
  let targetUrlStr = typeof input === 'string' ? input : input.toString();

  if (typeof input === 'string' && input.startsWith('/')) {
    finalInput = getApiUrl(input);
    targetUrlStr = finalInput;
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
    return await fetch(finalInput, {
      ...init,
      headers,
    });
  } catch (err: any) {
    // If the browser threw TypeError: Failed to fetch, wrap it in a descriptive ApiNetworkError
    console.error(`[apiClient] Network request failed for ${targetUrlStr}:`, err?.message || err);
    throw new ApiNetworkError(targetUrlStr, err);
  }
}
