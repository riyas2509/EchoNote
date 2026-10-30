/**
 * Playback Token Service
 *
 * Provides cryptographic HMAC-SHA256 signing and verification for audio playback tokens.
 *
 * Security & Architectural Invariants:
 * 1. Dedicated Secret Only: Tokens are signed using HMAC-SHA256 strictly with the dedicated
 *    PLAYBACK_SECRET environment variable. SESSION_SECRET fallback is strictly removed.
 * 2. Cross-Instance Verification: Cloud Run instances sharing the same configured PLAYBACK_SECRET
 *    must deterministically generate and verify each other's tokens.
 * 3. Fail-Closed in Staging & Production: When PLAYBACK_SECRET is missing in staging or production:
 *    - Application startup and health checks (/api/health) do NOT crash.
 *    - Token generation throws a clear CONFIG_ERROR.
 *    - Token verification returns { valid: false, error: '...' } with a clear configuration message.
 *    - No secret values or sensitive data are exposed in errors or logs.
 * 4. Safe Local Development Mode: If and only if running in local development (non-cloud,
 *    non-staging, non-production), an in-memory ephemeral secret is permitted for single-process testing,
 *    with explicit diagnostic notice.
 * 5. Staging Isolation: When STAGING_ISOLATION_REQUIRED=true, zero fallback to production secrets,
 *    fixtures, or derivation is permitted.
 * 6. Strict Timing-Safe Comparison: Uses crypto.timingSafeEqual to prevent side-channel timing attacks.
 * 7. Explicit Expiration & Scoping: Enforces token TTL (default 15 minutes) and recording ID validation.
 */

import crypto from 'crypto';

export interface PlaybackTokenPayload {
  uid: string;
  recId: string;
  email?: string;
  platform_admin?: boolean;
  role?: string;
  [key: string]: any;
}

export interface PlaybackTokenData extends PlaybackTokenPayload {
  exp: number;
}

export interface PlaybackTokenResult {
  token: string;
  expiresIn: number;
  expiresAt: number;
}

export interface PlaybackVerificationOptions {
  expectedRecId?: string;
  secretOverride?: string;
}

export interface PlaybackVerificationResult {
  valid: boolean;
  data?: PlaybackTokenData;
  error?: string;
}

export interface PlaybackSecretResolution {
  configured: boolean;
  secret: string | null;
  isEphemeral: boolean;
  source: 'PLAYBACK_SECRET' | 'EPHEMERAL_DEV' | 'NONE';
}

// In-memory ephemeral secret permitted ONLY in local development mode
let devEphemeralSecret: string | null = null;
let hasLoggedConfigWarning = false;
let hasLoggedDevNotice = false;

/**
 * Returns true if running in a restricted cloud, staging, or production environment
 * where ephemeral fallback is strictly forbidden and PLAYBACK_SECRET is required.
 */
export function isRestrictedEnvironment(): boolean {
  return (
    process.env.NODE_ENV === 'production' ||
    process.env.NODE_ENV === 'staging' ||
    process.env.STAGING_ISOLATION_REQUIRED === 'true' ||
    Boolean(process.env.K_SERVICE)
  );
}

/**
 * Resolves the active playback signing secret.
 *
 * In staging and production:
 * - If PLAYBACK_SECRET is present: returns configured secret.
 * - If PLAYBACK_SECRET is missing: returns configured: false (does NOT crash startup).
 *
 * In local development:
 * - If PLAYBACK_SECRET is present: returns configured secret.
 * - If PLAYBACK_SECRET is missing: falls back to in-memory ephemeral secret for local testing.
 */
export function getPlaybackSecret(options?: {
  strict?: boolean;
}): PlaybackSecretResolution {
  const isRestricted = isRestrictedEnvironment();
  const rawSecret = process.env.PLAYBACK_SECRET;

  // 1. Validate dedicated PLAYBACK_SECRET environment variable
  if (rawSecret && typeof rawSecret === 'string' && rawSecret.trim().length > 0) {
    const trimmed = rawSecret.trim();

    // Staging isolation guard: reject accidental production fixture or placeholder substitution
    if (process.env.STAGING_ISOLATION_REQUIRED === 'true') {
      if (
        trimmed === 'echonote-playback-secret' ||
        trimmed.includes('2509') ||
        trimmed === 'echonote-playback-secret:latest'
      ) {
        throw new Error(
          '[STAGING ISOLATION BREACH]: Production secret name or fixture cannot be used as PLAYBACK_SECRET in staging.'
        );
      }
    }

    return {
      configured: true,
      secret: trimmed,
      isEphemeral: false,
      source: 'PLAYBACK_SECRET',
    };
  }

  // 2. Strict mode requested by caller
  if (options?.strict) {
    throw new Error(
      'CONFIG_ERROR: PLAYBACK_SECRET is not configured. A dedicated high-entropy secret is required.'
    );
  }

  // 3. In restricted environments (staging, production, Cloud Run):
  // Do NOT throw at startup or health check time; report unconfigured so operations fail closed.
  if (isRestricted) {
    if (!hasLoggedConfigWarning) {
      console.warn(
        '⚠️ [PlaybackTokenService] WARNING: PLAYBACK_SECRET is not configured. ' +
          'Audio playback token generation and verification are disabled in this environment.'
      );
      hasLoggedConfigWarning = true;
    }

    return {
      configured: false,
      secret: null,
      isEphemeral: false,
      source: 'NONE',
    };
  }

  // 4. Local development mode ONLY:
  // Safely permit in-memory ephemeral secret for single-process local development.
  if (!devEphemeralSecret) {
    devEphemeralSecret = crypto.randomBytes(32).toString('hex');
  }

  if (!hasLoggedDevNotice) {
    console.info(
      'ℹ️ [PlaybackTokenService] NOTICE: Running in local development mode without PLAYBACK_SECRET. ' +
        'Using ephemeral in-memory secret for local single-process testing.'
    );
    hasLoggedDevNotice = true;
  }

  return {
    configured: true,
    secret: devEphemeralSecret,
    isEphemeral: true,
    source: 'EPHEMERAL_DEV',
  };
}

/**
 * Generates an HMAC-SHA256 signed playback token.
 *
 * In staging/production: throws clear CONFIG_ERROR if PLAYBACK_SECRET is not configured.
 */
export function generatePlaybackToken(
  payload: PlaybackTokenPayload,
  expiresIn = 900,
  secretOverride?: string
): PlaybackTokenResult {
  if (!payload || !payload.uid || !payload.recId) {
    throw new Error('INVALID_PAYLOAD: Playback token requires non-empty uid and recId.');
  }

  let signingSecret: string;

  if (secretOverride) {
    signingSecret = secretOverride;
  } else {
    const resolution = getPlaybackSecret();
    if (!resolution.configured || !resolution.secret) {
      throw new Error(
        'CONFIG_ERROR: PLAYBACK_SECRET is not configured. Audio playback token generation is disabled in staging/production.'
      );
    }
    signingSecret = resolution.secret;
  }

  const exp = Math.floor(Date.now() / 1000) + expiresIn;
  const tokenData: PlaybackTokenData = { ...payload, exp };
  const encodedData = Buffer.from(JSON.stringify(tokenData)).toString('base64url');

  const signature = crypto.createHmac('sha256', signingSecret).update(encodedData).digest('base64url');

  return {
    token: `${encodedData}.${signature}`,
    expiresIn,
    expiresAt: exp * 1000,
  };
}

/**
 * Verifies an HMAC-SHA256 signed playback token.
 *
 * In staging/production: returns valid: false with clear configuration error
 * if PLAYBACK_SECRET is not configured.
 */
export function verifyPlaybackToken(
  tokenString: string,
  optionsOrSecretOverride?: PlaybackVerificationOptions | string
): PlaybackVerificationResult {
  try {
    if (!tokenString || typeof tokenString !== 'string') {
      return { valid: false, error: 'Malformed token format' };
    }

    const parts = tokenString.split('.');
    if (parts.length !== 2) {
      return { valid: false, error: 'Malformed token format' };
    }

    const [encodedData, signature] = parts;
    if (!encodedData || !signature) {
      return { valid: false, error: 'Malformed token format' };
    }

    let verificationSecret: string;
    let expectedRecId: string | undefined;

    if (typeof optionsOrSecretOverride === 'string') {
      verificationSecret = optionsOrSecretOverride;
    } else {
      expectedRecId = optionsOrSecretOverride?.expectedRecId;
      if (optionsOrSecretOverride?.secretOverride) {
        verificationSecret = optionsOrSecretOverride.secretOverride;
      } else {
        const resolution = getPlaybackSecret();
        if (!resolution.configured || !resolution.secret) {
          return {
            valid: false,
            error: 'Playback token verification unavailable: PLAYBACK_SECRET is not configured.',
          };
        }
        verificationSecret = resolution.secret;
      }
    }

    const expectedSig = crypto.createHmac('sha256', verificationSecret).update(encodedData).digest('base64url');

    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expectedSig);

    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return { valid: false, error: 'Invalid token signature' };
    }

    const data: PlaybackTokenData = JSON.parse(Buffer.from(encodedData, 'base64url').toString('utf8'));

    // Validate token expiry (default 15 minutes / exp timestamp)
    if (Date.now() / 1000 > data.exp) {
      return { valid: false, error: 'Playback token expired' };
    }

    // Validate recording ID scoping if specified
    if (expectedRecId && data.recId !== expectedRecId) {
      return {
        valid: false,
        error: 'Playback token does not match requested recording.',
      };
    }

    return { valid: true, data };
  } catch (err: any) {
    return { valid: false, error: err?.message || 'Verification failed' };
  }
}
