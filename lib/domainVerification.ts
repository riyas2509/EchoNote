import crypto from 'crypto';
import dns from 'dns';
import { normalizeDomain, isValidDomain, PUBLIC_CONSUMER_DOMAINS } from '../middleware/auth.js';

export const CHALLENGE_PREFIX = 'echonote-domain-verification=';

export type DnsTxtResolver = (hostname: string) => Promise<string[][]>;

export type DomainVerificationStatus =
  | 'VERIFIED'
  | 'CHALLENGE_NOT_FOUND'
  | 'TOKEN_MISMATCH'
  | 'DNS_TIMEOUT'
  | 'DNS_ERROR'
  | 'INVALID_DOMAIN'
  | 'INVALID_CHALLENGE';

export interface DomainVerificationResult {
  success: boolean;
  status: DomainVerificationStatus;
  domain: string;
  message: string;
  recordsFoundCount?: number;
  matchedRecord?: string;
  dnsErrorDetails?: string;
}

export interface VerifyDomainOptions {
  resolver?: DnsTxtResolver;
  timeoutMs?: number;
}

// Module-level resolver holder for dependency injection in tests
let activeResolver: DnsTxtResolver = dns.promises.resolveTxt;

/**
 * Configure a custom DNS resolver for dependency injection (e.g. deterministic unit/integration testing).
 * Passing null resets to the standard Node.js dns.promises.resolveTxt resolver.
 */
export function setCustomDnsResolver(resolver: DnsTxtResolver | null): void {
  activeResolver = resolver || dns.promises.resolveTxt;
}

/**
 * Returns the currently active DNS resolver.
 */
export function getActiveDnsResolver(): DnsTxtResolver {
  return activeResolver;
}

/**
 * Resets the active DNS resolver to standard Node.js dns.promises.resolveTxt.
 */
export function resetCustomDnsResolver(): void {
  activeResolver = dns.promises.resolveTxt;
}

/**
 * Generates a cryptographically secure random domain verification token and formatted DNS TXT record value.
 * Uses 32 cryptographically random bytes (256 bits of entropy) hex-encoded.
 */
export function generateDomainChallengeToken(): {
  token: string;
  recordValue: string;
} {
  const token = crypto.randomBytes(32).toString('hex');
  return {
    token,
    recordValue: `${CHALLENGE_PREFIX}${token}`
  };
}

/**
 * Normalizes and checks if a domain candidate is eligible for enterprise claiming.
 */
export function checkDomainEligibility(domain: string): {
  eligible: boolean;
  normalizedDomain: string;
  reason?: string;
} {
  const clean = normalizeDomain(domain);
  if (!clean || !isValidDomain(clean)) {
    return {
      eligible: false,
      normalizedDomain: clean,
      reason: 'Invalid domain format. Please provide a valid fully qualified domain name (FQDN).'
    };
  }

  if (PUBLIC_CONSUMER_DOMAINS.has(clean)) {
    return {
      eligible: false,
      normalizedDomain: clean,
      reason: 'Public consumer email domains cannot be claimed as enterprise domains.'
    };
  }

  return {
    eligible: true,
    normalizedDomain: clean
  };
}

/**
 * Flattens RFC 1035 / RFC 4408 TXT record character string chunks.
 * In DNS, individual TXT records exceeding 255 bytes are chunked into arrays of strings.
 * These chunks must be concatenated to reconstruct the authoritative record string.
 */
export function flattenTxtRecordChunks(records: string[][]): string[] {
  if (!Array.isArray(records)) return [];
  return records.map(entry => {
    if (Array.isArray(entry)) {
      return entry.join('').trim();
    }
    return String(entry || '').trim();
  }).filter(Boolean);
}

/**
 * Authoritatively verifies a claimed domain by resolving its DNS TXT records and
 * asserting an EXACT, case-sensitive match against the expected server-issued challenge record.
 *
 * Exact Domain Ownership Rule:
 * - Queries the EXACT hostname claimed. A record at a parent or sibling domain does NOT verify the target domain.
 * - Substring matches, partial prefixes, or extra attributes are strictly rejected.
 * - Fail-closed: missing records, DNS failures, or timeouts result in success: false.
 */
export async function verifyDomainTxtRecord(
  domain: string,
  expectedChallengeValue: string,
  options?: VerifyDomainOptions
): Promise<DomainVerificationResult> {
  const cleanDomain = normalizeDomain(domain);

  if (!cleanDomain || !isValidDomain(cleanDomain)) {
    return {
      success: false,
      status: 'INVALID_DOMAIN',
      domain: cleanDomain || domain,
      message: 'Invalid domain name format.'
    };
  }

  if (!expectedChallengeValue || typeof expectedChallengeValue !== 'string') {
    return {
      success: false,
      status: 'INVALID_CHALLENGE',
      domain: cleanDomain,
      message: 'Expected DNS challenge record is missing or invalid.'
    };
  }

  const expectedRecord = expectedChallengeValue.trim();
  if (!expectedRecord.startsWith(CHALLENGE_PREFIX) || expectedRecord.length <= CHALLENGE_PREFIX.length) {
    return {
      success: false,
      status: 'INVALID_CHALLENGE',
      domain: cleanDomain,
      message: `Expected challenge must start with "${CHALLENGE_PREFIX}" followed by a valid token.`
    };
  }

  const resolver = options?.resolver || activeResolver;
  const timeoutMs = typeof options?.timeoutMs === 'number' && options.timeoutMs > 0 ? options.timeoutMs : 5000;

  try {
    // Execute DNS TXT resolution with fail-closed timeout defense
    const rawRecords = await Promise.race([
      resolver(cleanDomain),
      new Promise<string[][]>((_, reject) => {
        const timer = setTimeout(() => {
          const timeoutErr: any = new Error(`DNS TXT query for "${cleanDomain}" timed out after ${timeoutMs}ms.`);
          timeoutErr.code = 'ETIMEDOUT';
          reject(timeoutErr);
        }, timeoutMs);
        if (typeof timer.unref === 'function') {
          timer.unref();
        }
      })
    ]);

    const flattened = flattenTxtRecordChunks(rawRecords);

    if (flattened.length === 0) {
      return {
        success: false,
        status: 'CHALLENGE_NOT_FOUND',
        domain: cleanDomain,
        recordsFoundCount: 0,
        message: `No DNS TXT records were found on "${cleanDomain}". Please add the TXT record to your DNS configuration.`
      };
    }

    // Exact string match check (no substring, no partial token, no trailing text)
    const exactMatch = flattened.find(record => record === expectedRecord);

    if (exactMatch) {
      return {
        success: true,
        status: 'VERIFIED',
        domain: cleanDomain,
        recordsFoundCount: flattened.length,
        matchedRecord: exactMatch,
        message: `Domain "${cleanDomain}" successfully verified via DNS TXT record.`
      };
    }

    // Check if an incorrect echonote-domain-verification token was present
    const mismatchedChallenge = flattened.find(record => record.startsWith(CHALLENGE_PREFIX));
    if (mismatchedChallenge) {
      return {
        success: false,
        status: 'TOKEN_MISMATCH',
        domain: cleanDomain,
        recordsFoundCount: flattened.length,
        message: `A DNS challenge record was found on "${cleanDomain}", but the token does not match the active challenge for this organization.`
      };
    }

    return {
      success: false,
      status: 'CHALLENGE_NOT_FOUND',
      domain: cleanDomain,
      recordsFoundCount: flattened.length,
      message: `The expected DNS TXT record "${CHALLENGE_PREFIX}..." was not found on "${cleanDomain}". Found ${flattened.length} other TXT record(s).`
    };

  } catch (error: any) {
    const errCode = error?.code || '';
    const errMsg = error?.message || String(error);

    if (errCode === 'ETIMEDOUT' || errMsg.includes('timed out')) {
      return {
        success: false,
        status: 'DNS_TIMEOUT',
        domain: cleanDomain,
        dnsErrorDetails: 'Query timed out',
        message: `DNS resolution for "${cleanDomain}" timed out. Please verify that your DNS nameservers are responsive and try again.`
      };
    }

    if (errCode === 'ENOTFOUND' || errCode === 'ENODATA' || errCode === 'NXDOMAIN') {
      return {
        success: false,
        status: 'CHALLENGE_NOT_FOUND',
        domain: cleanDomain,
        dnsErrorDetails: errCode,
        message: `No DNS TXT records exist for "${cleanDomain}" (${errCode}).`
      };
    }

    // Fail-closed for all other resolution errors (e.g. SERVFAIL, REFUSED, network failures)
    return {
      success: false,
      status: 'DNS_ERROR',
      domain: cleanDomain,
      dnsErrorDetails: errCode || errMsg,
      message: `DNS resolution failed for "${cleanDomain}". Error: ${errCode || 'DNS query failed'}.`
    };
  }
}
