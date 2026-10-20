/**
 * lib/integrationSecurity.ts
 *
 * EchoNote Phase 1B: Integration Credential Sanitization and Server-Authoritative Storage.
 *
 * Step 1.2F: Versioned Encryption Keyring & Rotation Readiness.
 *
 * SECURITY DESIGN:
 * 1. Plaintext secrets (client secrets, bot tokens, api keys, webhook secrets, service accounts)
 *    are NEVER returned to client applications in API responses or public views.
 * 2. Secrets are stored encrypted with AES-256-GCM using an explicitly configured active key.
 * 3. Every encrypted payload carries its key version identifier (keyId).
 * 4. Decryption uses a controlled keyring mapping version IDs to 32-byte keys.
 *    - Uses the active key for current payloads.
 *    - Uses explicitly configured previous keys for historical payloads.
 *    - Rejects unknown versions, missing keys, malformed payloads, or tampered ciphertexts.
 * 5. If NO encryption key is configured, the server FAILS SAFELY (HTTP 422) rather than
 *    silently persisting plaintext or falling back to hardcoded keys.
 * 6. Non-secret integration settings and metadata remain fully operational.
 */

import crypto from "crypto";

export const KEY_ID_PREFIX = "local-aes-256-gcm:";
export const DEFAULT_KEY_VERSION = "v1";
export const DEFAULT_KEY_ID = "local-aes-256-gcm:v1";

/**
 * Known sensitive field identifiers that must never be exposed or returned to clients.
 */
export const SENSITIVE_INTEGRATION_FIELDS = new Set<string>([
  "clientSecret",
  "client_secret",
  "zoomClientSecret",
  "m365ClientSecret",
  "slackBotToken",
  "googleServiceAccount",
  "secret",
  "sharedSecret",
  "zapierSecret",
  "webhookSecret",
  "encryptedCredentials",
  "webhookSecretEncrypted",
  "rawKey",
  "keySecret"
]);

export interface EncryptedPayload {
  ciphertext: string;
  iv: string;
  tag: string;
  keyId: string;
}

export interface KeyringKeyEntry {
  version: string;
  keyId: string;
  key: Buffer;
  isActive: boolean;
}

export interface IntegrationKeyring {
  activeKeyId: string;
  activeVersion: string;
  activeKey: Buffer;
  keys: Map<string, KeyringKeyEntry>;
}

/**
 * Parses and validates an encryption key from a string.
 * Strictly guarantees that any returned Buffer is exactly 32 bytes (256 bits).
 * Supports:
 * - 64-character hexadecimal (32 bytes)
 * - 44-character base64 (32 bytes)
 * - 32-byte UTF-8 string
 * Returns null if the key format is invalid, ambiguous, or the resulting length is not 32 bytes.
 */
export function parseEncryptionKey(rawKey: string | undefined | null): Buffer | null {
  if (!rawKey || typeof rawKey !== "string") {
    return null;
  }

  const trimmed = rawKey.trim();
  if (!trimmed) {
    return null;
  }

  // 1. 64-char hexadecimal string (32 bytes)
  if (trimmed.length === 64 && /^[0-9a-fA-F]+$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }

  // 2. 44-char base64 string (32 bytes)
  if (trimmed.length === 44 && /^[A-Za-z0-9+/=]+$/.test(trimmed)) {
    try {
      const buf = Buffer.from(trimmed, "base64");
      if (buf.length === 32) return buf;
    } catch {
      return null;
    }
  }

  // 3. Exact 32-byte UTF-8 string
  if (Buffer.byteLength(trimmed, "utf8") === 32) {
    return Buffer.from(trimmed, "utf8");
  }

  return null;
}

/**
 * Strictly validates that a key version string follows canonical identifier syntax.
 * Rejects illegal characters, path traversal sequences, control chars, or excessive length.
 */
export function isValidKeyVersion(version: string | undefined | null): boolean {
  if (!version || typeof version !== "string") {
    return false;
  }
  const trimmed = version.trim();
  if (!trimmed || trimmed.length > 64) {
    return false;
  }
  // Matches canonical formats: 'v1', 'v2', 'local-aes-256-gcm:v1', etc.
  return /^(local-aes-256-gcm:)?[a-zA-Z0-9_\-\.]+$/.test(trimmed);
}

/**
 * Normalizes a key version string into a canonical keyId (e.g. 'v1' -> 'local-aes-256-gcm:v1').
 */
export function normalizeKeyId(rawVersion: string): string {
  const trimmed = (rawVersion || DEFAULT_KEY_VERSION).trim();
  if (trimmed.startsWith(KEY_ID_PREFIX)) {
    return trimmed;
  }
  return `${KEY_ID_PREFIX}${trimmed}`;
}

/**
 * Extracts the short version from a keyId (e.g. 'local-aes-256-gcm:v1' -> 'v1').
 */
export function extractShortVersion(keyId: string): string {
  const trimmed = (keyId || DEFAULT_KEY_VERSION).trim();
  if (trimmed.startsWith(KEY_ID_PREFIX)) {
    return trimmed.slice(KEY_ID_PREFIX.length);
  }
  return trimmed;
}

/**
 * Parses previous keys from environment variables.
 * Supports:
 * - INTEGRATION_ENCRYPTION_PREVIOUS_KEYS (JSON object mapping version -> key or env var name, or comma-separated pairs: v1=key,v2=key)
 * - INTEGRATION_ENCRYPTION_PREVIOUS_KEY (single key; defaults to v1 or PREVIOUS_KEY_VERSION)
 * - INTEGRATION_ENCRYPTION_KEY_<VERSION> environment variables
 * Safely rejects duplicate, ambiguous, or conflicting key definitions without leaking key material.
 */
export function parsePreviousKeysFromEnv(activeVersion: string, activeKeyBuf?: Buffer): Map<string, Buffer> {
  const previousMap = new Map<string, Buffer>();
  const conflictingVersions = new Set<string>();

  const activeCanonical = normalizeKeyId(activeVersion);
  const activeShort = extractShortVersion(activeVersion);

  const registerKey = (ver: string, keyBuf: Buffer) => {
    if (!ver || !isValidKeyVersion(ver)) {
      return;
    }
    const canonicalKeyId = normalizeKeyId(ver);
    const shortVer = extractShortVersion(ver);

    // If already marked as conflicting, do not accept any key for this version
    if (conflictingVersions.has(canonicalKeyId) || conflictingVersions.has(shortVer)) {
      return;
    }

    // If it conflicts with active key material, reject safe fail
    if (activeKeyBuf && (canonicalKeyId === activeCanonical || shortVer === activeShort)) {
      if (!activeKeyBuf.equals(keyBuf)) {
        conflictingVersions.add(canonicalKeyId);
        conflictingVersions.add(shortVer);
        previousMap.delete(canonicalKeyId);
        previousMap.delete(shortVer);
        return;
      }
      // Matches active key: active key is already authoritative, skip previous duplicate
      return;
    }

    // Check if version was already registered in previousMap
    const existing = previousMap.get(canonicalKeyId) || previousMap.get(shortVer);
    if (existing) {
      if (!existing.equals(keyBuf)) {
        // Conflicting key material detected for same version! Reject both safely.
        conflictingVersions.add(canonicalKeyId);
        conflictingVersions.add(shortVer);
        previousMap.delete(canonicalKeyId);
        previousMap.delete(shortVer);
        return;
      }
      // Identical duplicate: idempotent, safe
      return;
    }

    previousMap.set(canonicalKeyId, keyBuf);
    previousMap.set(shortVer, keyBuf);
  };

  const resolveKeyValue = (val: string): Buffer | null => {
    if (!val || typeof val !== "string") return null;
    const trimmed = val.trim();
    // 1. Check if trimmed string directly parses as 32-byte key (hex, base64, or utf8)
    const directKey = parseEncryptionKey(trimmed);
    if (directKey) return directKey;
    // 2. Check if trimmed string references an environment variable name
    if (process.env[trimmed] && typeof process.env[trimmed] === "string") {
      return parseEncryptionKey(process.env[trimmed]);
    }
    return null;
  };

  // 1. Check INTEGRATION_ENCRYPTION_PREVIOUS_KEYS
  const rawPrevKeys = process.env.INTEGRATION_ENCRYPTION_PREVIOUS_KEYS;
  if (rawPrevKeys && typeof rawPrevKeys === "string" && rawPrevKeys.trim()) {
    const trimmed = rawPrevKeys.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          for (const [ver, val] of Object.entries(parsed)) {
            if (typeof val === "string") {
              const keyBuf = resolveKeyValue(val);
              if (keyBuf) {
                registerKey(ver, keyBuf);
              }
            }
          }
        }
      } catch {
        // Safe fail: unparseable JSON safely ignored
      }
    } else {
      // Comma-separated pairs: v1=key1,v2=key2 or v1:key1
      const pairs = trimmed.split(",");
      for (const pair of pairs) {
        const [ver, val] = pair.includes("=") ? pair.split("=") : pair.split(":");
        if (ver && val) {
          const keyBuf = resolveKeyValue(val.trim());
          if (keyBuf) {
            registerKey(ver.trim(), keyBuf);
          }
        }
      }
    }
  }

  // 2. Check single INTEGRATION_ENCRYPTION_PREVIOUS_KEY
  const singlePrevKey = process.env.INTEGRATION_ENCRYPTION_PREVIOUS_KEY;
  if (singlePrevKey && typeof singlePrevKey === "string" && singlePrevKey.trim()) {
    const keyBuf = resolveKeyValue(singlePrevKey);
    if (keyBuf) {
      const explicitVer = process.env.INTEGRATION_ENCRYPTION_PREVIOUS_KEY_VERSION?.trim();
      const fallbackVer = explicitVer || (activeVersion === "v2" || activeVersion === "local-aes-256-gcm:v2" ? "v1" : "v1");
      registerKey(fallbackVer, keyBuf);
    }
  }

  // 3. Check individual version variables: INTEGRATION_ENCRYPTION_KEY_<VER>
  for (const [envVar, envVal] of Object.entries(process.env)) {
    if (envVar.startsWith("INTEGRATION_ENCRYPTION_KEY_") && envVal && typeof envVal === "string") {
      const suffix = envVar.slice("INTEGRATION_ENCRYPTION_KEY_".length).toLowerCase();
      if (suffix === "version" || suffix === "previous" || suffix === "previous_keys") {
        continue;
      }
      const keyBuf = resolveKeyValue(envVal);
      if (keyBuf) {
        registerKey(suffix, keyBuf);
      }
    }
  }

  return previousMap;
}

/**
 * Builds and returns the authoritative integration encryption keyring from environment configuration.
 * Preserves strict precedence: INTEGRATION_ENCRYPTION_KEY takes precedence over legacy INTEGRATION_SECRET_KEY.
 * Returns null if no valid active key is configured.
 */
export function getIntegrationKeyring(): IntegrationKeyring | null {
  let activeRawKey = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!activeRawKey || !activeRawKey.trim()) {
    activeRawKey = process.env.INTEGRATION_SECRET_KEY;
  }

  const activeKeyBuf = parseEncryptionKey(activeRawKey);
  if (!activeKeyBuf) {
    return null;
  }

  const rawActiveVersion = (process.env.INTEGRATION_ENCRYPTION_KEY_VERSION || DEFAULT_KEY_VERSION).trim();
  if (!isValidKeyVersion(rawActiveVersion)) {
    return null;
  }

  const activeKeyId = normalizeKeyId(rawActiveVersion);
  const activeVersion = extractShortVersion(activeKeyId);

  const keysMap = new Map<string, KeyringKeyEntry>();

  // Register active key entry under both canonical keyId and short version
  const activeEntry: KeyringKeyEntry = {
    version: activeVersion,
    keyId: activeKeyId,
    key: activeKeyBuf,
    isActive: true
  };
  keysMap.set(activeKeyId, activeEntry);
  keysMap.set(activeVersion, activeEntry);

  // Register all configured previous keys (passing activeKeyBuf for conflict safety)
  const prevKeys = parsePreviousKeysFromEnv(activeVersion, activeKeyBuf);
  for (const [id, keyBuf] of prevKeys.entries()) {
    const canonicalKeyId = normalizeKeyId(id);
    const shortVer = extractShortVersion(id);

    // Active key always takes precedence and cannot be replaced or overwritten by historical definitions
    if (canonicalKeyId === activeKeyId || shortVer === activeVersion) {
      continue;
    }

    if (!keysMap.has(canonicalKeyId)) {
      const prevEntry: KeyringKeyEntry = {
        version: shortVer,
        keyId: canonicalKeyId,
        key: keyBuf,
        isActive: false
      };
      keysMap.set(canonicalKeyId, prevEntry);
      keysMap.set(shortVer, prevEntry);
    }
  }

  return {
    activeKeyId,
    activeVersion,
    activeKey: activeKeyBuf,
    keys: keysMap
  };
}

/**
 * Backward-compatible helper returning the active encryption key Buffer, or null.
 */
export function getIntegrationEncryptionKey(): Buffer | null {
  const keyring = getIntegrationKeyring();
  return keyring ? keyring.activeKey : null;
}

/**
 * Checks whether server-side encryption capability is active.
 */
export function isIntegrationEncryptionConfigured(): boolean {
  return getIntegrationKeyring() !== null;
}

/**
 * Returns the active keyId (e.g. 'local-aes-256-gcm:v1').
 */
export function getActiveEncryptionKeyId(): string {
  const keyring = getIntegrationKeyring();
  return keyring ? keyring.activeKeyId : DEFAULT_KEY_ID;
}

/**
 * Returns the list of all available key IDs in the keyring.
 */
export function getKeyringKeyIds(): string[] {
  const keyring = getIntegrationKeyring();
  if (!keyring) return [];
  const keyIds = new Set<string>();
  for (const entry of keyring.keys.values()) {
    keyIds.add(entry.keyId);
  }
  return Array.from(keyIds);
}

/**
 * Checks whether a specific keyId is present in the keyring.
 */
export function isKeyVersionAvailable(keyId: string): boolean {
  const keyring = getIntegrationKeyring();
  if (!keyring || !keyId || typeof keyId !== "string" || !isValidKeyVersion(keyId)) return false;
  return keyring.keys.has(keyId) || keyring.keys.has(normalizeKeyId(keyId)) || keyring.keys.has(extractShortVersion(keyId));
}

/**
 * Encrypts a sensitive string using AES-256-GCM using the active configured key.
 * Optionally allows specifying an overrideKeyId if available in the keyring.
 * Fails safely by throwing an explicit Error if encryption is not configured.
 */
export function encryptSecret(plaintext: string, targetKeyId?: string): EncryptedPayload {
  const keyring = getIntegrationKeyring();
  if (!keyring) {
    throw new Error(
      "ENCRYPTION_KEY_REQUIRED: Integration credential encryption is not configured (CONFIGURATION_REQUIRED). " +
      "Set INTEGRATION_ENCRYPTION_KEY (32-byte hex/base64) or configure Cloud KMS to persist credentials."
    );
  }

  let keyToUse = keyring.activeKey;
  let keyIdToUse = keyring.activeKeyId;

  if (targetKeyId) {
    if (!isValidKeyVersion(targetKeyId)) {
      throw new Error(`KEY_VERSION_NOT_FOUND: Specified encryption key version "${targetKeyId}" is not valid or available in the keyring.`);
    }
    const entry = keyring.keys.get(targetKeyId) ||
                  keyring.keys.get(normalizeKeyId(targetKeyId)) ||
                  keyring.keys.get(extractShortVersion(targetKeyId));
    if (!entry) {
      throw new Error(`KEY_VERSION_NOT_FOUND: Specified encryption key version "${targetKeyId}" is not available in the keyring.`);
    }
    keyToUse = entry.key;
    keyIdToUse = entry.keyId;
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyToUse, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    keyId: keyIdToUse
  };
}

/**
 * Decrypts a sensitive payload using AES-256-GCM.
 * Selects the decryption key based on trusted keyId metadata from the payload.
 * Fails closed if the key version is not present, payload is malformed, or authentication fails.
 * Never prints or leaks keys, ciphertext, or decrypted values.
 */
export function decryptSecret(payload: EncryptedPayload): string {
  if (!payload || typeof payload !== "object") {
    throw new Error("INVALID_ENCRYPTED_PAYLOAD: Encrypted payload is missing or not an object (INVALID_PAYLOAD).");
  }

  const { ciphertext, iv, tag, keyId } = payload;

  if (!ciphertext || typeof ciphertext !== "string" ||
      !iv || typeof iv !== "string" ||
      !tag || typeof tag !== "string" ||
      !keyId || typeof keyId !== "string") {
    throw new Error("INVALID_ENCRYPTED_PAYLOAD: Encrypted payload is missing required fields (ciphertext, iv, tag, keyId) (INVALID_PAYLOAD).");
  }

  // Treat keyId as untrusted input and validate canonical format
  if (!isValidKeyVersion(keyId)) {
    const sanitizedKeyId = keyId.replace(/[^a-zA-Z0-9_\-\.:]/g, "");
    throw new Error(`KEY_VERSION_NOT_FOUND: Encryption key version "${sanitizedKeyId || "invalid"}" is not available in the configured keyring (INVALID_ENCRYPTED_PAYLOAD).`);
  }

  const keyring = getIntegrationKeyring();
  if (!keyring) {
    throw new Error(
      "ENCRYPTION_KEY_REQUIRED: Integration credential decryption key is not configured (CONFIGURATION_REQUIRED)."
    );
  }

  const entry = keyring.keys.get(keyId) ||
                keyring.keys.get(normalizeKeyId(keyId)) ||
                keyring.keys.get(extractShortVersion(keyId));

  if (!entry) {
    const sanitizedKeyId = keyId.replace(/[^a-zA-Z0-9_\-\.:]/g, "");
    throw new Error(
      `KEY_VERSION_NOT_FOUND: Encryption key version "${sanitizedKeyId}" is not available in the configured keyring.`
    );
  }

  let ivBuf: Buffer;
  let tagBuf: Buffer;
  let cipherBuf: Buffer;

  try {
    ivBuf = Buffer.from(iv, "base64");
    tagBuf = Buffer.from(tag, "base64");
    cipherBuf = Buffer.from(ciphertext, "base64");
  } catch {
    throw new Error("INVALID_ENCRYPTED_PAYLOAD: Failed to decode base64 components in encrypted payload (MALFORMED_PAYLOAD).");
  }

  if (ivBuf.length !== 12) {
    throw new Error(`INVALID_ENCRYPTED_PAYLOAD: Expected 12-byte IV for AES-GCM, received ${ivBuf.length} bytes (INVALID_IV_LENGTH).`);
  }

  if (tagBuf.length !== 16) {
    throw new Error(`INVALID_ENCRYPTED_PAYLOAD: Expected 16-byte authentication tag for AES-GCM, received ${tagBuf.length} bytes (INVALID_TAG_LENGTH).`);
  }

  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", entry.key, ivBuf);
    decipher.setAuthTag(tagBuf);
    const decrypted = Buffer.concat([decipher.update(cipherBuf), decipher.final()]);
    return decrypted.toString("utf8");
  } catch {
    throw new Error(
      "AUTHENTICATION_FAILED: Decryption failed; authentication tag verification failed or corrupted ciphertext."
    );
  }
}

/**
 * Re-encrypts an encrypted payload with the active key (or specified targetKeyId).
 * Decrypts with the payload's original key version, then re-encrypts with the target key version.
 * Used during controlled rotation migrations.
 */
export function reencryptSecret(payload: EncryptedPayload, targetKeyId?: string): EncryptedPayload {
  const plaintext = decryptSecret(payload);
  return encryptSecret(plaintext, targetKeyId);
}

/**
 * Masks a sensitive secret for display, preserving only last 4 chars if long enough.
 */
export function maskSecretValue(value: string): string {
  if (!value || typeof value !== "string") return "";
  const trimmed = value.trim();
  if (trimmed.length <= 4) return "••••";
  return `••••••••••••${trimmed.slice(-4)}`;
}

/**
 * Deeply sanitizes an integration configuration object.
 * Strips all sensitive fields and replaces them with hasConfigured: true flags or masked values.
 */
export function sanitizeIntegrationConfig(config: any): Record<string, any> {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return {};
  }

  const sanitized: Record<string, any> = {};

  for (const [key, value] of Object.entries(config)) {
    // Check if the key itself indicates a sensitive secret
    const isSensitive = SENSITIVE_INTEGRATION_FIELDS.has(key) ||
      key.toLowerCase().includes("secret") ||
      key.toLowerCase().includes("token") ||
      key.toLowerCase().includes("serviceaccount");

    if (isSensitive) {
      if (value && typeof value === "string" && value.trim().length > 0) {
        sanitized[`has_${key}`] = true;
        sanitized[key] = maskSecretValue(value);
      }
      continue;
    }

    // Special handling for webhooks list
    if (key === "endpoints" && Array.isArray(value)) {
      sanitized.endpoints = value.map((wh: any) => {
        if (!wh || typeof wh !== "object") return wh;
        const { secret, ...safeWh } = wh;
        return {
          ...safeWh,
          hasSecret: Boolean(secret && String(secret).trim().length > 0),
          secret: secret ? maskSecretValue(String(secret)) : undefined
        };
      });
      continue;
    }

    // Special handling for REST API keys
    if (key === "keys" && Array.isArray(value)) {
      sanitized.keys = value.map((k: any) => {
        if (!k || typeof k !== "object") return k;
        const { rawKey, keySecret, ...safeKey } = k;
        return {
          ...safeKey,
          key: safeKey.key ? (safeKey.key.includes("••••") ? safeKey.key : maskSecretValue(String(safeKey.key))) : undefined
        };
      });
      continue;
    }

    // Special handling for OAuth clients
    if (key === "clients" && Array.isArray(value)) {
      sanitized.clients = value.map((cl: any) => {
        if (!cl || typeof cl !== "object") return cl;
        const { secret, ...safeClient } = cl;
        return {
          ...safeClient,
          hasSecret: Boolean(secret && String(secret).trim().length > 0)
        };
      });
      continue;
    }

    // Recursively handle nested safe objects if any
    if (value && typeof value === "object" && !Array.isArray(value)) {
      sanitized[key] = sanitizeIntegrationConfig(value);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Checks whether an incoming configuration object contains any sensitive secrets.
 */
export function containsSensitiveSecrets(config: any): boolean {
  if (!config || typeof config !== "object") return false;

  for (const [key, value] of Object.entries(config)) {
    if (
      SENSITIVE_INTEGRATION_FIELDS.has(key) ||
      key.toLowerCase().includes("secret") ||
      key.toLowerCase().includes("token") ||
      key.toLowerCase().includes("serviceaccount")
    ) {
      if (typeof value === "string" && value.trim().length > 0 && !value.includes("••••")) {
        return true;
      }
    }
    if (key === "endpoints" && Array.isArray(value)) {
      if (value.some((wh: any) => wh && wh.secret && !String(wh.secret).includes("••••"))) {
        return true;
      }
    }
    if (key === "clients" && Array.isArray(value)) {
      if (value.some((cl: any) => cl && cl.secret && !String(cl.secret).includes("••••"))) {
        return true;
      }
    }
  }

  return false;
}
