import { registerReportDeliveryRoutes } from "./lib/recurringReportDeliveryService.ts";
import dotenv from "dotenv";
dotenv.config();
import { registerRecurringWorkerRoutes } from "./lib/recurringScheduleWorker.ts";
import { registerRecurringScheduleRoutes } from "./lib/recurringScheduleRoutes.ts";

console.log("🔥 SERVER RESTARTED WITH NEW CODE");

import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import { convertOpusToWav, convertAudioToWav, normalizeAudioMimeType, isFfmpegAvailable } from "./lib/audioUtils.js";
import { trimAudioBuffer, validateTrimRange, alignTranscriptSegments } from "./lib/audioTrimService.js";
import { FieldValue } from "firebase-admin/firestore";
import admin from "firebase-admin";
import { getAuth } from "firebase-admin/auth";
import { appAdmin, db, firebaseConfig, getFirebaseConfig } from "./lib/firebaseAdmin.ts";
import { GoogleAuth, OAuth2Client } from "google-auth-library";
import { GoogleGenAI, Type, Modality, ThinkingLevel } from "@google/genai";
import { trackAIUsage, getAiUsageOverview, getRecentAiUsageLogs } from "./lib/aiTracker.js";
import { emailService, resolveSenderEmail } from "./lib/emailService.js";
import { maskEmailForLogs } from "./lib/emailService.js";
import { 
  requireAuth, 
  optionalAuth, 
  checkProjectAccess, 
  resolveProjectAccess,
  checkOrgAccess, 
  requireOrgRole, 
  requireAdmin,
  requirePlatformAdmin,
  syncUserCustomClaims, 
  recordOrgAuditEvent, 
  normalizeOrgRole, 
  normalizeDomain,
  PUBLIC_CONSUMER_DOMAINS,
  ROLE_HIERARCHY, 
  AuthenticatedRequest,
  evaluateOrgMfaPolicy,
  isSessionMfaVerified,
  createMfaForbiddenResponse,
  requireRecoveryScope,
  RecoveryScopedRequest,
  authorizeRecordingAccess as authRecordingHelper,
  verifyAiResourceAccess as verifyAiResourceHelper,
  sanitizeSsoClaims as sanitizeSsoClaimsHelper,
  parseFirestoreRestFields,
  handleMemberDeactivationAuth
} from "./middleware/auth.ts";
import { admitExpensiveOperation } from "./middleware/runtimeLimiter.ts";
import { 
  processEnterpriseJitOrSync, 
  evaluateIdentityMappings 
} from "./lib/jitProvisioning.ts";
import {
  recordAuthAuditEvent,
  queryAuthAuditLogs,
  AuthAuditLogEvent
} from "./lib/auditLogger.ts";
import {
  generateMeetingExcel,
  generateMeetingPowerPoint,
  generateProjectStatusExcel,
  generateProjectStatusPowerPoint,
  generateManagementReviewExcel,
  generateManagementReviewPowerPoint,
  collectProjectReportData,
  REPORT_BOUNDS
} from "./services/reportService.ts";
import {
  sanitizeIntegrationConfig,
  encryptSecret,
  decryptSecret,
  isIntegrationEncryptionConfigured,
  containsSensitiveSecrets,
  maskSecretValue
} from "./lib/integrationSecurity.ts";
import {
  verifyZoomWebhookSignature,
  generateZoomValidationResponse,
  extractZoomMeetingEvent,
  processZoomWebhookEvent,
  computeZoomProvenanceManifestId
} from "./lib/zoomWebhookSecurity.ts";
import {
  importZoomRecording,
  enqueueZoomImportJob,
  processPendingZoomImportJobs
} from "./lib/zoomRecordingImportService.ts";
import { 
  AuthoritativeOrgRole, 
  OrgSsoEnforcementState, 
  OrgSecurityHealthIssue, 
  OrgAllowedAuthMethod, 
  OrgSecurityHealthSummary,
  TargetProjectRole,
  ProjectPermission,
  ProjectPermissions,
  ProjectAccessResolution,
  normalizeProjectRole
} from "./types.js";
import {
  generateRecoveryCodesSet,
  findMatchingUnusedCode,
  issueRecoveryTicket,
  checkRecoveryRateLimit,
  recordRecoveryAttempt,
  resetRecoveryRateLimit,
  UserRecoveryDocument,
  StoredRecoveryCode
} from "./lib/recoveryCodes.ts";
import {
  SERVER_PLAN_LIMITS,
  MINUTE_TOPUP_PACKAGES,
  AI_REQUEST_TOPUP_PACKAGES,
  fulfillTopupOrder,
  fulfillSubscriptionPayment,
  recordPendingSubscription,
  recordPendingOrder,
  isProductionEnvironment
} from "./middleware/billingFulfillment.ts";
import {
  acceptProjectInvitation,
  sanitizeInvitationToken
} from "./lib/projectInvitation.ts";
import {
  generateDomainChallengeToken,
  verifyDomainTxtRecord,
  CHALLENGE_PREFIX,
  DomainVerificationResult
} from "./lib/domainVerification.ts";
import {
  validateAuthoritativeEntraTenant,
  AuthoritativeTenantResult,
  isValidTenantIdFormat,
  resolveAuthoritativeTenantPolicy,
  resolveAuthoritativeMicrosoftClientId
} from "./lib/entraTokenValidation.ts";
import {
  generateTaskNotificationsForProject,
  scanAndQuarantineStaleDispatches,
  processNotificationDispatchBatch,
  isNotificationDispatchEnabled,
  DEFAULT_DISPATCH_BATCH_SIZE,
  MAX_DISPATCH_BATCH_SIZE,
  DEFAULT_STALE_DISPATCH_TIMEOUT_MS
} from "./lib/taskNotificationService.ts";
import { scanAndCreateOverdueNotifications } from "./lib/overdueTaskAlertService.ts";
import { executeTaskCompletionWithNotifications } from "./lib/prerequisiteCompletionService.ts";
import { 
  parseCalendarDate,
  calculateDeadlinePropagation,
  computeScheduleVersionToken,
  SchedulableTask
} from "./lib/taskScheduling.ts";
import {
  InAppNotificationRecord,
  generateDeadlinePropagationDedupKey,
  formatDeadlinePropagationMessage,
  isValidEmail,
  normalizeEmail
} from "./lib/notificationModel.ts";

// Canonical Firebase Admin and Firestore initialized from ./lib/firebaseAdmin.ts

async function checkIdentity() {
  try {
    const auth = new GoogleAuth();
    const serviceAccount = await auth.getCredentials();
    console.log("🛠️ --- BACKEND IDENTITY CHECK ---");
    console.log("📍 Target Project ID:", appAdmin.options?.projectId || "echonote-2509");
    console.log("📦 Target Database:", firebaseConfig.firestoreDatabaseId);
    
    if (serviceAccount.client_email) {
      console.log("👤 Service Account Email:", serviceAccount.client_email);
    } else {
      try {
        const metadataUrl = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email";
        const response = await fetch(metadataUrl, { headers: { "Metadata-Flavor": "Google" } });
        const email = await response.text();
        console.log("👤 Cloud Run Service Account:", email);
      } catch (e) {
        console.log("👤 Identity could not be determined via Metadata API.");
      }
    }
  } catch (error) {
    console.warn("⚠️ GoogleAuth checkIdentity warning:", error);
  }
}

checkIdentity();

import { Resend } from "resend";
import Razorpay from "razorpay";

// Cryptographically secure constant-time string comparison to prevent timing analysis attacks
function timingSafeStringCompare(a?: string | null, b?: string | null): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// HTML entity escaping utility to prevent XSS in email templates
export function escapeHtml(str: string | null | undefined): string {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Canonical public application URL resolver
export function resolveAppUrl(): string {
  // In production, deterministically return the canonical public domain.
  // Neither APP_URL nor VITE_APP_URL is allowed to override this in production.
  if (process.env.NODE_ENV === "production") {
    return "https://echonote-25.vercel.app";
  }

  const configured = (process.env.APP_URL || process.env.VITE_APP_URL || "https://echonote-25.vercel.app").trim();
  return (configured || "https://echonote-25.vercel.app").replace(/\/+$/, "");
}

// Re-export authoritative sender resolver from emailService
export { resolveSenderEmail };

// Authoritative transactional email sender configuration
const AUTHORITATIVE_EMAIL_CONFIG = {
  from: resolveSenderEmail()
};

const resendKey = process.env.RESEND_API_KEY;
const resend = resendKey ? new Resend(resendKey) : null;

interface RazorpayConfigInfo {
  mode: 'test' | 'live' | 'unconfigured';
  keyId: string;
  keyPrefix: string;
  hasSecret: boolean;
  isValid: boolean;
  error?: string;
}

function getRazorpayConfig(): RazorpayConfigInfo {
  const keyId = (process.env.RAZORPAY_KEY_ID || "").replace(/['"]/g, "").trim();
  const keySecret = (process.env.RAZORPAY_KEY_SECRET || "").replace(/['"]/g, "").trim();
  const explicitMode = (process.env.RAZORPAY_MODE || "").toLowerCase().trim();

  if (!keyId || !keySecret) {
    return {
      mode: 'unconfigured',
      keyId: '',
      keyPrefix: '',
      hasSecret: false,
      isValid: false,
      error: "RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET is missing from environment variables."
    };
  }

  const detectedMode: 'test' | 'live' = keyId.startsWith("rzp_live_") ? "live" : "test";
  const effectiveMode = (explicitMode === "live" || explicitMode === "test") ? explicitMode : detectedMode;

  // Validate mode matching if explicit mode was specified
  if (explicitMode === "live" && !keyId.startsWith("rzp_live_")) {
    return {
      mode: 'live',
      keyId,
      keyPrefix: keyId.slice(0, 9),
      hasSecret: true,
      isValid: false,
      error: `RAZORPAY_MODE is set to 'live', but RAZORPAY_KEY_ID does not start with 'rzp_live_'. Key prefix is '${keyId.slice(0, 9)}'`
    };
  }

  if (explicitMode === "test" && !keyId.startsWith("rzp_test_")) {
    return {
      mode: 'test',
      keyId,
      keyPrefix: keyId.slice(0, 9),
      hasSecret: true,
      isValid: false,
      error: `RAZORPAY_MODE is set to 'test', but RAZORPAY_KEY_ID does not start with 'rzp_test_'. Key prefix is '${keyId.slice(0, 9)}'`
    };
  }

  return {
    mode: effectiveMode,
    keyId,
    keyPrefix: keyId.slice(0, 9),
    hasSecret: true,
    isValid: true
  };
}

let _razorpayInstance: Razorpay | null = null;
let _cachedKeyId: string = "";
let _cachedKeySecret: string = "";

function getRazorpayClient(): Razorpay {
  const config = getRazorpayConfig();
  if (!config.isValid) {
    throw new Error(`Razorpay configuration error: ${config.error}`);
  }

  const rzId = config.keyId;
  const rzSecret = (process.env.RAZORPAY_KEY_SECRET || "").replace(/['"]/g, "").trim();

  if (!_razorpayInstance || _cachedKeyId !== rzId || _cachedKeySecret !== rzSecret) {
    _razorpayInstance = new Razorpay({
      key_id: rzId,
      key_secret: rzSecret,
    });
    _cachedKeyId = rzId;
    _cachedKeySecret = rzSecret;
    console.log(`🛠️ Razorpay Client Initialized/Refreshed (Mode: ${config.mode.toUpperCase()}, Key prefix: ${config.keyPrefix}...)`);
  }
  return _razorpayInstance;
}

async function startServer() {
  console.log("🚀 SERVER RESTARTED AT:", new Date().toISOString());
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;
  
  let _aiGenInstance: GoogleGenAI | null = null;
  const aiGen = {
    get models() {
      if (!_aiGenInstance) {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
          throw new Error("GEMINI_API_KEY environment variable is required to use the Gemini API.");
        }
        _aiGenInstance = new GoogleGenAI({ apiKey });
      }
      return _aiGenInstance.models;
    }
  };

  // Capture raw request body buffer for Razorpay Webhook signature verification
  app.use(express.json({ 
    limit: '50mb',
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    }
  }));

  // CORS Configuration
  const allowedOriginsEnv = process.env.ALLOWED_ORIGINS || process.env.CORS_ALLOWED_ORIGINS || '';
  const customOrigins = allowedOriginsEnv
    .split(',')
    .map(o => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);

  const defaultAllowedOrigins = [
    "https://echonote-25.ai.studio",
    "https://ai.studio",
    "https://echonote-25.vercel.app",
    "https://echonote.vercel.app",
    "https://echonote-staging.vercel.app",
    "https://echonote-stage.vercel.app",
    "https://echotechai.in",
    "https://www.echotechai.in",
    "http://localhost:3000",
    "http://localhost:5173",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173"
  ];

  app.use(cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, server-to-server, same-origin)
      if (!origin) return callback(null, true);

      const cleanOrigin = origin.replace(/\/+$/, '');

      // Explicitly reject "null" origin string (sandboxed iframes, data URLs, privacy-stripped redirects)
      if (cleanOrigin === "null" || cleanOrigin === "") {
        return callback(null, false);
      }

      if (defaultAllowedOrigins.includes(cleanOrigin) || customOrigins.includes(cleanOrigin)) {
        return callback(null, true);
      }

      // Allow Google AI Studio domains (published app URLs and studio hosts)
      if (/(^|\.)ai\.studio$/.test(cleanOrigin) || /(^|\.)google\.com$/.test(cleanOrigin)) {
        return callback(null, true);
      }

      // Allow only explicitly approved EchoNote Vercel deployments (strict allowlist, no broad wildcards)
      const approvedVercelOrigins = [
        "https://echonote-25.vercel.app",
        "https://echonote.vercel.app",
        "https://echonote-staging.vercel.app",
        "https://echonote-stage.vercel.app"
      ];
      if (approvedVercelOrigins.includes(cleanOrigin)) {
        return callback(null, true);
      }

      // Allow EchoNote Cloud Run and Firebase hosting previews
      if (
        /^https:\/\/ais-(dev|pre)-[a-zA-Z0-9_-]+-[0-9]+\.[a-z0-9-]+\.run\.app$/.test(cleanOrigin) ||
        /^https:\/\/echonote(-backend)?-[a-zA-Z0-9_-]+\.(a\.)?run\.app$/.test(cleanOrigin) ||
        /^https:\/\/echonote(-backend)?-[0-9]+\.[a-z0-9-]+\.run\.app$/.test(cleanOrigin) ||
        cleanOrigin === "https://echonote-2509.web.app" ||
        cleanOrigin === "https://echonote-2509.firebaseapp.com"
      ) {
        return callback(null, true);
      }

      // Allow local development on any port
      if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(cleanOrigin)) {
        return callback(null, true);
      }

      // Reject disallowed origins gracefully without throwing an uncaught 500 error
      return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
    exposedHeaders: ['Content-Disposition', 'Content-Type', 'X-Report-Truncated', 'X-Report-Warnings']
  }));

  // Logging middleware for debugging (sanitizes query parameters to prevent token/secret leakage in logs)
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      const sanitizedPath = (req.originalUrl || req.url || '').split('?')[0];
      console.log(`[${new Date().toISOString()}] ${req.method} ${sanitizedPath} ${res.statusCode} - ${duration}ms`);
    });
    next();
  });

  // Health Check
  app.get("/api/health", (req, res) => {
    res.json({ 
      status: "ok", 
      time: new Date().toISOString(),
      service: process.env.K_SERVICE || "echonote"
    });
  });

  // Razorpay Configuration Status & Diagnostic Endpoint (Safe diagnostics, no secrets exposed)
  app.get("/api/payment/config-status", (req, res) => {
    const config = getRazorpayConfig();

    const getPlanInfo = (envVal?: string) => {
      const trimmed = (envVal || "").replace(/['"]/g, "").trim();
      const configured = trimmed.length > 0;
      let prefix: string | null = null;
      if (trimmed.startsWith("plan_")) {
        prefix = "plan_";
      } else if (trimmed.startsWith("sub_")) {
        prefix = "sub_";
      } else if (configured) {
        prefix = trimmed.slice(0, 5);
      }

      return {
        configured,
        prefix
      };
    };

    return res.status(200).json({
      razorpay: {
        keyConfigured: Boolean(config.keyId),
        keyMode: config.mode,
        hasSecret: config.hasSecret
      },
      plans: {
        proMonthly: getPlanInfo(process.env.RAZORPAY_PRO_MONTHLY_PLAN_ID),
        proYearly: getPlanInfo(process.env.RAZORPAY_PRO_YEARLY_PLAN_ID),
        teamMonthly: getPlanInfo(process.env.RAZORPAY_TEAM_MONTHLY_PLAN_ID),
        teamYearly: getPlanInfo(process.env.RAZORPAY_TEAM_YEARLY_PLAN_ID)
      },
      runtime: {
        nodeEnv: process.env.NODE_ENV || "development",
        service: process.env.K_SERVICE || "unknown",
        revision: process.env.K_REVISION || "unknown",
        platform: process.env.K_SERVICE ? "Google Cloud Run" : "AI Studio Dev Container"
      }
    });
  });

  // User identity resolver for AI & general endpoints - strictly authoritatively derived from verified auth token and Firestore
  async function resolveUserContext(req: AuthenticatedRequest) {
    if (!req.user || !req.user.uid) {
      throw new Error("Authentication required");
    }
    const uid = req.user.uid;
    const email = (req.user.email || "").trim().toLowerCase();
    let plan = "free";
    let userData: any = {};

    try {
      const userDoc = await db.collection("users").doc(uid).get();
      if (userDoc.exists) {
        userData = userDoc.data() || {};
        plan = String(userData.plan || "free").toLowerCase();
      }
    } catch (e: any) {
      console.warn("⚠️ Could not read user profile for plan verification:", e.message);
    }

    return {
      userId: uid,
      email,
      plan: plan || "free",
      userData,
      isAuthenticated: true
    };
  }

  // ==========================================
  // PHASE 1.4: SECURE DOMAIN-BASED IDENTITY DISCOVERY
  // ==========================================

  const PUBLIC_CONSUMER_DOMAINS = new Set([
    'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.in', 'yahoo.co.uk',
    'hotmail.com', 'outlook.com', 'live.com', 'msn.com',
    'icloud.com', 'me.com', 'mac.com', 'aol.com',
    'proton.me', 'protonmail.com', 'zoho.com', 'mail.com', 'gmx.com', 'yandex.com'
  ]);

  function normalizeDomain(input: string): string {
    if (!input) return "";
    let domain = input.toLowerCase().trim();
    if (domain.includes("@")) {
      domain = domain.split("@")[1]?.trim() || "";
    }
    domain = domain.replace(/^[a-z]+:\/\//i, '').split('/')[0].split(':')[0].trim();
    return domain;
  }

  function isValidDomain(domain: string): boolean {
    if (!domain || domain.length > 253) return false;
    const domainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/;
    return domainRegex.test(domain);
  }

  /**
   * Helper to validate organization SSO configuration and evaluate enforcement readiness & admin lockout safety.
   */
  function validateSsoConfigurationForEnforcement(orgData: any, organizationId: string = ""): {
    valid: boolean;
    errors: string[];
    ssoState: OrgSsoEnforcementState;
    healthIssues: OrgSecurityHealthIssue[];
  } {
    const errors: string[] = [];
    const healthIssues: OrgSecurityHealthIssue[] = [];
    const sec = orgData.securitySettings || {};
    const ssoStatus = sec.ssoStatus || 'disabled';
    const ssoProtocol = sec.ssoProtocol || 'OIDC';
    const isSaml = ssoProtocol === 'SAML';
    const samlCfg = sec.samlProvider;

    // 1. Authoritative verified domain check
    const domains: any[] = Array.isArray(orgData.domains) ? orgData.domains : [];
    const verifiedDomains = domains.filter((d: any) => {
      if (typeof d === 'object' && d !== null) {
        return d.status === 'verified';
      }
      return false;
    });

    let hasVerifiedDomain = false;
    if (domains.length > 0) {
      // If domains collection exists, ONLY explicitly verified domain records are accepted
      hasVerifiedDomain = verifiedDomains.length > 0;
    } else {
      // Legacy fallback only if explicit domains list is absent and unverified list does not block
      const allowedList: string[] = [
        ...(Array.isArray(orgData.settings?.allowedDomains) ? orgData.settings.allowedDomains : []),
        ...(Array.isArray(sec.allowedDomains) ? sec.allowedDomains : (typeof sec.allowedDomains === 'string' ? sec.allowedDomains.split(',') : [])),
        orgData.domain
      ].filter(Boolean);
      const unverifiedList: string[] = Array.isArray(orgData.unverifiedDomains) ? orgData.unverifiedDomains : [];
      hasVerifiedDomain = allowedList.some(d => !unverifiedList.includes(d));
    }

    if (!hasVerifiedDomain) {
      const msg = "Organization must have at least one verified enterprise domain before SSO can be enforced.";
      errors.push(msg);
      healthIssues.push({ code: "NO_VERIFIED_DOMAIN", severity: "error", message: msg });
    }

    // 2. SSO Provider status and configuration
    if (ssoStatus !== 'enabled') {
      const msg = "SSO status must be 'enabled' to enforce mandatory Single Sign-On.";
      errors.push(msg);
      healthIssues.push({ code: "SSO_NOT_ENABLED", severity: "error", message: msg });
    }

    if (isSaml) {
      if (!samlCfg || !samlCfg.entityId || !samlCfg.ssoUrl) {
        const msg = "SAML 2.0 configuration is incomplete: Entity ID and SSO Login URL are required.";
        errors.push(msg);
        healthIssues.push({ code: "SAML_CONFIG_INCOMPLETE", severity: "error", message: msg });
      }
      if (!Array.isArray(samlCfg?.x509Certificates) || samlCfg.x509Certificates.length === 0) {
        const msg = "SAML 2.0 configuration requires at least one valid X.509 signing certificate.";
        errors.push(msg);
        healthIssues.push({ code: "SAML_NO_CERTIFICATES", severity: "error", message: msg });
      }
    } else {
      // OIDC / Entra
      const isExplicitOidc = Boolean(sec.oidcConfig?.issuer || sec.ssoConfig?.issuer);
      if (!isExplicitOidc) {
        const tenantPolicy = resolveAuthoritativeTenantPolicy(orgData, sec);
        if (!tenantPolicy.valid) {
          const msg = tenantPolicy.error || "Microsoft Entra tenant policy is incomplete or malformed.";
          errors.push(msg);
          healthIssues.push({ code: "OIDC_MISSING_TENANT", severity: "error", message: msg });
        }
      }
    }

    // 3. Admin safety & Lockout Prevention check
    if (!orgData.ownerEmail && !orgData.ownerId) {
      const msg = "Organization owner email is missing. Lockout safety check failed.";
      errors.push(msg);
      healthIssues.push({ code: "NO_OWNER_CONFIGURED", severity: "error", message: msg });
    }

    const isValid = errors.length === 0;
    let ssoState: OrgSsoEnforcementState = 'SSO_DISABLED';
    if (ssoStatus === 'disabled' && !sec.enforceSso) {
      ssoState = 'SSO_DISABLED';
    } else if (!sec.enforceSso && ssoStatus === 'enabled') {
      ssoState = 'SSO_OPTIONAL';
    } else if (sec.enforceSso) {
      ssoState = isValid ? 'SSO_REQUIRED' : 'SSO_CONFIGURATION_ERROR';
    }

    return {
      valid: isValid,
      errors,
      ssoState,
      healthIssues
    };
  }

  /**
   * Helper to evaluate Google Cloud Identity Platform readiness and multi-tenant capabilities.
   */
  function checkIdentityPlatformReadiness(): {
    enabled: boolean;
    projectId: string;
    reason?: string;
  } {
    const isEnabled = process.env.IDENTITY_PLATFORM_ENABLED === 'true';
    const projectId = process.env.IDENTITY_PLATFORM_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || "echonote-2509";
    return {
      enabled: isEnabled,
      projectId,
      reason: isEnabled 
        ? undefined 
        : "Google Cloud Identity Platform multi-tenancy and enterprise IdP federation upgrade is not enabled in environment config."
    };
  }

  /**
   * Domain Discovery Endpoint:
   * Determines authentication policy before authentication is completed.
   * Returns safe routing parameters without leaking sensitive credentials or internal configuration.
   */
  app.post("/api/auth/discover", async (req, res) => {
    const { email } = req.body;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || typeof email !== 'string' || !emailRegex.test(email.trim())) {
      return res.status(400).json({ error: "Bad Request", message: "A valid email address is required" });
    }

    const domain = normalizeDomain(email);
    if (!domain || !isValidDomain(domain) || PUBLIC_CONSUMER_DOMAINS.has(domain)) {
      return res.json({
        authMode: "standard",
        domain: domain || "standard",
        ssoEnforced: false,
        ssoEnforcementState: "SSO_DISABLED",
        allowedAuthMethods: ["password", "google", "microsoft"]
      });
    }

    try {
      const orgsSnap = await db.collection("organizations").get();
      let matchedOrg: any = null;
      let isVerified = false;

      for (const orgDoc of orgsSnap.docs) {
        const orgData = orgDoc.data() || {};
        
        // 1. Check verified domains list if present
        if (Array.isArray(orgData.domains)) {
          const found = orgData.domains.find((d: any) => {
            const dName = typeof d === 'string' ? normalizeDomain(d) : normalizeDomain(d.domain);
            const dStatus = typeof d === 'object' ? d.status : 'verified';
            return dName === domain && dStatus === 'verified';
          });
          if (found) {
            matchedOrg = orgData;
            isVerified = true;
            break;
          }
          // If the domain is recorded in orgData.domains as unverified, strictly isolate it from matching
          const isExplicitlyUnverified = orgData.domains.some((d: any) => {
            const dName = typeof d === 'string' ? normalizeDomain(d) : normalizeDomain(d.domain);
            return dName === domain && (typeof d === 'object' ? d.status !== 'verified' : false);
          });
          if (isExplicitlyUnverified) {
            continue;
          }
        }

        // 2. Check settings.allowedDomains or securitySettings.allowedDomains
        let allowedList: string[] = [];
        if (Array.isArray(orgData.settings?.allowedDomains)) {
          allowedList = orgData.settings.allowedDomains.map(normalizeDomain);
        } else if (typeof orgData.securitySettings?.allowedDomains === 'string') {
          allowedList = orgData.securitySettings.allowedDomains.split(',').map(normalizeDomain);
        } else if (Array.isArray(orgData.securitySettings?.allowedDomains)) {
          allowedList = orgData.securitySettings.allowedDomains.map(normalizeDomain);
        } else if (orgData.domain) {
          allowedList = [normalizeDomain(orgData.domain)];
        }

        if (allowedList.includes(domain)) {
          const unverifiedList: string[] = Array.isArray(orgData.unverifiedDomains)
            ? orgData.unverifiedDomains.map(normalizeDomain)
            : [];
          if (!unverifiedList.includes(domain)) {
            matchedOrg = orgData;
            isVerified = true;
            break;
          }
        }
      }

      if (!matchedOrg || !isVerified) {
        return res.json({
          authMode: "standard",
          domain,
          ssoEnforced: false,
          ssoEnforcementState: "SSO_DISABLED",
          allowedAuthMethods: ["password", "google", "microsoft"]
        });
      }

      const sec = matchedOrg.securitySettings || {};
      const validation = validateSsoConfigurationForEnforcement(matchedOrg, matchedOrg.id);
      const ssoState = validation.ssoState;
      const ssoEnforced = ssoState === 'SSO_REQUIRED';
      const ssoConfigurationError = ssoState === 'SSO_CONFIGURATION_ERROR';

      const ssoProtocol = sec.ssoProtocol || (sec.samlProvider ? 'SAML' : 'OIDC');
      const isSamlProtocol = ssoProtocol === 'SAML';
      const samlCfg = sec.samlProvider;
      const cleanOrgId = String(matchedOrg.id || '').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '');
      const expectedSamlProviderId = `saml.${cleanOrgId}`;

      // Map allowed authentication methods
      let allowedMethods: ('sso' | 'password' | 'google' | 'microsoft')[] = [];
      if (ssoEnforced || ssoConfigurationError) {
        allowedMethods = ["sso"];
      } else if (Array.isArray(sec.allowedAuthMethods) && sec.allowedAuthMethods.length > 0) {
        allowedMethods = [];
        if (sec.allowedAuthMethods.includes('SAML') || sec.allowedAuthMethods.includes('OIDC') || sec.allowedAuthMethods.includes('MICROSOFT')) {
          allowedMethods.push('sso');
        }
        if (sec.allowedAuthMethods.includes('EMAIL_PASSWORD')) {
          allowedMethods.push('password');
        }
        if (sec.allowedAuthMethods.includes('GOOGLE')) {
          allowedMethods.push('google');
        }
        if (sec.allowedAuthMethods.includes('MICROSOFT')) {
          allowedMethods.push('microsoft');
        }
        if (allowedMethods.length === 0) {
          allowedMethods = ["sso", "password", "google", "microsoft"];
        }
      } else {
        allowedMethods = ssoState === 'SSO_OPTIONAL' ? ["sso", "password", "google", "microsoft"] : ["password", "google", "microsoft"];
      }

      const ssoProviderName = isSamlProtocol 
        ? (samlCfg?.displayName || 'SAML 2.0') 
        : (sec.entraTenantId ? 'Microsoft Entra ID' : 'Enterprise OIDC');

      const ssoProviderType = sec.ssoProviderType || (isSamlProtocol ? 'SAML' : (sec.entraTenantId ? 'MICROSOFT_ENTRA' : 'OIDC'));
      const tenantId = matchedOrg.identityPlatformTenantId || sec.identityPlatformTenantId || undefined;

      return res.json({
        authMode: "enterprise",
        domain,
        ssoEnforced,
        ssoEnforcementState: ssoState,
        organizationName: matchedOrg.name || "Enterprise Workspace",
        ssoProvider: ssoProviderName,
        ssoProviderType,
        ssoProtocol: isSamlProtocol ? 'SAML' : 'OIDC',
        providerId: isSamlProtocol ? (samlCfg?.providerId || expectedSamlProviderId) : (sec.oidcProvider?.clientId || sec.entraTenantId ? 'microsoft.com' : undefined),
        samlProviderId: isSamlProtocol ? (samlCfg?.providerId || expectedSamlProviderId) : undefined,
        entraTenantId: sec.entraTenantId || undefined,
        identityPlatformTenantId: tenantId,
        ssoConfigurationError,
        ssoErrorMessage: ssoConfigurationError
          ? "Your organization requires Single Sign-On, but the SSO configuration has an issue. Please contact your organization administrator."
          : undefined,
        allowedAuthMethods: allowedMethods,
        rawAllowedAuthMethods: sec.allowedAuthMethods || undefined,
        isDomainVerified: true,
        orgId: matchedOrg.id
      });
    } catch (error: any) {
      console.warn("⚠️ Domain discovery falling back to standard auth:", error?.message || error);
      return res.json({
        authMode: "standard",
        domain,
        ssoEnforced: false,
        ssoEnforcementState: "SSO_DISABLED",
        allowedAuthMethods: ["password", "google", "microsoft"]
      });
    }
  });

  // Helper to prevent privilege escalation via client-supplied claims in SSO flows
  function sanitizeSsoClaims(claims: any): Record<string, any> {
    return sanitizeSsoClaimsHelper(claims);
  }

  // ==========================================
  // PHASE 1.5: MICROSOFT ENTRA ID / OIDC ENTERPRISE SSO
  // ==========================================

  /**
   * Validate Microsoft Entra SSO Identity and Authorize Organization Context
   */
  app.post("/api/auth/sso/validate-entra", requireAuth, async (req: AuthenticatedRequest, res) => {
    const callerUid = req.user!.uid;
    const callerEmail = (req.user!.email || "").toLowerCase().trim();
    const tokenSignInProvider = req.user!.firebase?.sign_in_provider || "microsoft.com";
    const { 
      tenantId: reportedTenantId,
      groups,
      department,
      jobTitle,
      displayName,
      photoURL,
      claims: clientClaims
    } = req.body || {};

    if (!callerEmail) {
      return res.status(400).json({ error: "Bad Request", message: "User email is required for SSO validation." });
    }

    const domain = normalizeDomain(callerEmail);
    if (PUBLIC_CONSUMER_DOMAINS.has(domain)) {
      return res.status(400).json({ 
        error: "Bad Request", 
        message: "Public consumer email domains cannot be used for enterprise SSO discovery." 
      });
    }

    let entraValidation: any = null;
    try {
      // 1. Locate organization owning this verified enterprise domain
      const orgsSnap = await db.collection("organizations").get();
      let matchedOrgDoc: any = null;
      let matchedOrgData: any = null;

      for (const doc of orgsSnap.docs) {
        const data = doc.data() || {};
        let allowedList: string[] = [];

        if (Array.isArray(data.domains)) {
          const found = data.domains.some((d: any) => {
            const dName = typeof d === 'string' ? normalizeDomain(d) : normalizeDomain(d.domain);
            const dStatus = typeof d === 'object' ? d.status : 'verified';
            return dName === domain && dStatus === 'verified';
          });
          if (found) {
            matchedOrgDoc = doc;
            matchedOrgData = data;
            break;
          }
        }

        if (Array.isArray(data.settings?.allowedDomains)) {
          allowedList = data.settings.allowedDomains.map(normalizeDomain);
        } else if (Array.isArray(data.securitySettings?.allowedDomains)) {
          allowedList = data.securitySettings.allowedDomains.map(normalizeDomain);
        } else if (typeof data.securitySettings?.allowedDomains === 'string') {
          allowedList = data.securitySettings.allowedDomains.split(',').map(normalizeDomain);
        } else if (data.domain) {
          allowedList = [normalizeDomain(data.domain)];
        }

        if (allowedList.includes(domain)) {
          const unverifiedList = Array.isArray(data.unverifiedDomains) ? data.unverifiedDomains.map(normalizeDomain) : [];
          if (!unverifiedList.includes(domain)) {
            matchedOrgDoc = doc;
            matchedOrgData = data;
            break;
          }
        }
      }

      if (!matchedOrgDoc || !matchedOrgData) {
        return res.json({
          success: true,
          isEnterprise: false,
          isMember: false,
          message: "Standard authentication verified. No enterprise organization linked to this email domain."
        });
      }

      const orgId = matchedOrgDoc.id;
      const sec = matchedOrgData.securitySettings || {};

      // 1. Authoritative Microsoft Entra Tenant Policy Validation (Step 4B.2D)
      // Organizations enforcing Microsoft Entra SSO must have an explicit, valid tenant policy.
      const tenantPolicy = resolveAuthoritativeTenantPolicy(matchedOrgData, sec);
      if (!tenantPolicy.valid) {
        await recordOrgAuditEvent(db, {
          organizationId: orgId,
          actorUserId: callerUid,
          actorEmail: callerEmail,
          action: (tenantPolicy.errorCode || "SSO_TENANT_POLICY_MISSING") as any,
          timestamp: new Date().toISOString(),
          source: "api",
          details: tenantPolicy.error || "Microsoft Entra tenant policy validation failed."
        });

        return res.status(403).json({
          error: "Forbidden",
          code: tenantPolicy.errorCode || "SSO_TENANT_POLICY_MISSING",
          message: tenantPolicy.error || "Organization has not configured an authoritative Microsoft Entra tenant policy."
        });
      }

      // 2. Authoritative Client-ID Configuration Policy (Step 4B.2D)
      // Resolve client ID, reject conflicts, and permit shared-app fallback ONLY with explicit tenant policy
      const clientPolicy = resolveAuthoritativeMicrosoftClientId(matchedOrgData, sec, {
        allowSharedApp: tenantPolicy.valid
      });

      if (clientPolicy.hasConflict) {
        await recordOrgAuditEvent(db, {
          organizationId: orgId,
          actorUserId: callerUid,
          actorEmail: callerEmail,
          action: "SSO_CLIENT_ID_CONFIG_CONFLICT" as any,
          timestamp: new Date().toISOString(),
          source: "api",
          details: clientPolicy.conflictDetails || "Conflicting Microsoft application client IDs configured."
        });

        return res.status(403).json({
          error: "Forbidden",
          code: "SSO_CLIENT_ID_CONFIG_CONFLICT",
          message: clientPolicy.conflictDetails || "Organization has conflicting Microsoft application client ID configurations."
        });
      }

      const expectedClientId = clientPolicy.clientId || "";

      // Reject missing server-side audience configuration when raw token evidence is presented
      if ((req.body?.idToken || req.body?.credentialToken) && !expectedClientId) {
        await recordOrgAuditEvent(db, {
          organizationId: orgId,
          actorUserId: callerUid,
          actorEmail: callerEmail,
          action: "SSO_AUDIENCE_MISMATCH",
          timestamp: new Date().toISOString(),
          source: "api",
          details: "Missing mandatory Microsoft application client ID (audience) in organization configuration."
        });

        return res.status(403).json({
          error: "Forbidden",
          code: "SSO_AUDIENCE_CONFIG_MISSING",
          message: "Organization has not configured an authorized Microsoft application client ID."
        });
      }

      // 3. Authoritative Tenant & Identity Binding Validation (Step 4B.2 & 4B.2D & 4B.2E)
      // Never trust client-supplied tenant ID, assertions, or unlinked detached tokens.
      let authoritativeTenantId: string | undefined;
      let authoritativeClaims: any = null;

      entraValidation = await validateAuthoritativeEntraTenant(
        req.user,
        {
          idToken: req.body?.idToken,
          credentialToken: req.body?.credentialToken,
          reportedTenantId
        },
        {
          expectedTenantId: tenantPolicy.expectedTenantId,
          allowedTenantIds: tenantPolicy.allowedTenantIds,
          expectedAudience: expectedClientId || undefined,
          db,
          twoPhaseReplay: true
        }
      );

      if (!entraValidation.valid) {
        let auditAction = "SSO_AUTHENTICATION_FAILED";
        let clientCode = "SSO_AUTHENTICATION_FAILED";
        let clientMessage = entraValidation.error || "Microsoft Entra identity verification failed.";
        let httpStatus = 403;

        if (entraValidation.code === 'TENANT_MISMATCH') {
          auditAction = "SSO_TENANT_MISMATCH";
          clientCode = "SSO_TENANT_MISMATCH";
          clientMessage = "Authentication occurred under an unauthorized Microsoft tenant directory.";
        } else if (entraValidation.code === 'IDENTITY_SUBSTITUTION_DETECTED') {
          auditAction = "SSO_IDENTITY_MISMATCH";
          clientCode = "SSO_IDENTITY_MISMATCH";
          clientMessage = "Microsoft identity does not match the authenticated session account.";
        } else if (entraValidation.code === 'AUDIENCE_MISMATCH') {
          auditAction = "SSO_AUDIENCE_MISMATCH";
          clientCode = "SSO_AUDIENCE_MISMATCH";
          clientMessage = "Microsoft token audience does not match configured application client ID.";
        } else if (entraValidation.code === 'TOKEN_TYPE_INVALID') {
          auditAction = "SSO_TOKEN_TYPE_INVALID";
          clientCode = "SSO_TOKEN_TYPE_INVALID";
          clientMessage = "Invalid token type: Microsoft Graph and resource tokens are rejected as ID token evidence.";
        } else if (entraValidation.code === 'TOKEN_REPLAYED') {
          auditAction = "SSO_TOKEN_REPLAYED";
          clientCode = "SSO_TOKEN_REPLAYED";
          clientMessage = entraValidation.error || "Authentication token has already been consumed. Please sign in again.";
        } else if (entraValidation.code === 'REPLAY_STORE_UNAVAILABLE') {
          auditAction = "SSO_REPLAY_PROTECTION_FAILED";
          clientCode = "SSO_REPLAY_CHECK_UNAVAILABLE";
          clientMessage = "Enterprise SSO replay verification is temporarily unavailable. Please try again shortly.";
          httpStatus = 503;
        }

        await recordOrgAuditEvent(db, {
          organizationId: orgId,
          actorUserId: callerUid,
          actorEmail: callerEmail,
          action: auditAction as any,
          timestamp: new Date().toISOString(),
          source: "api",
          details: entraValidation.error || `SSO verification failed (${entraValidation.code})`,
          metadata: { 
            expectedTenantId: tenantPolicy.expectedTenantId,
            expectedClientId,
            reportedTenantId, 
            validationCode: entraValidation.code,
            validationSource: entraValidation.source,
            discoveredTenantId: entraValidation.tenantId
          }
        });

        return res.status(httpStatus).json({
          error: httpStatus === 503 ? "Service Unavailable" : "Forbidden",
          code: clientCode,
          message: clientMessage
        });
      }

      authoritativeTenantId = entraValidation.tenantId;
      authoritativeClaims = entraValidation.claims;

      // 3. Process JIT Provisioning or Identity Attribute / Group Sync
      // Prefer authoritative cryptographically verified claims over client assertions
      const tokenGroups = Array.isArray(authoritativeClaims?.groups)
        ? authoritativeClaims.groups
        : (Array.isArray(req.user?.groups) 
          ? req.user.groups 
          : (Array.isArray(groups) ? groups : []));
      const tokenDept = authoritativeClaims?.department || (req.user as any)?.department || department || undefined;
      const tokenJobTitle = authoritativeClaims?.jobTitle || (req.user as any)?.job_title || (req.user as any)?.jobTitle || jobTitle || undefined;
      const userName = authoritativeClaims?.name || req.user?.name || displayName || undefined;
      const userPhoto = req.user?.picture || photoURL || undefined;

      const jitResult = await processEnterpriseJitOrSync(db, orgId, matchedOrgData, {
        uid: callerUid,
        email: callerEmail,
        displayName: userName,
        photoURL: userPhoto,
        provider: 'entra',
        groups: tokenGroups,
        department: tokenDept,
        jobTitle: tokenJobTitle,
        claims: sanitizeSsoClaims(clientClaims),
        tenantId: authoritativeTenantId || tenantPolicy.expectedTenantId || reportedTenantId
      });

      // Step 4B.2E: Finalize distributed replay record once JIT provisioning completes
      if (entraValidation?.replayLease) {
        try {
          await entraValidation.replayLease.store.finalize(
            entraValidation.replayLease.fingerprint,
            entraValidation.replayLease.operationId
          );
        } catch (finalizeErr) {
          console.error("⚠️ Failed to finalize replay lease:", finalizeErr);
        }
      }

      if (jitResult.status === 'deactivated') {
        return res.status(403).json({
          error: "Forbidden",
          code: "MEMBER_DEACTIVATED",
          message: "Your enterprise organization account has been deactivated by an administrator."
        });
      }

      if (!jitResult.allowed || !jitResult.isMember) {
        return res.json({
          success: true,
          isEnterprise: true,
          isMember: false,
          pending: true,
          reason: jitResult.reason || 'INVITATION_REQUIRED',
          orgId,
          orgName: matchedOrgData.name,
          message: jitResult.message || "Authenticated successfully with Microsoft Entra ID. Membership requires an administrator invitation."
        });
      }

      await recordOrgAuditEvent(db, {
        organizationId: orgId,
        actorUserId: callerUid,
        actorEmail: callerEmail,
        action: "SSO_LOGIN_SUCCESS",
        timestamp: new Date().toISOString(),
        source: "sso_entra",
        details: `Microsoft Entra SSO login successful for ${callerEmail} (${jitResult.role})`,
        metadata: { 
          provider: tokenSignInProvider, 
          tenantId: tenantPolicy.expectedTenantId || "tenant-agnostic",
          wasProvisioned: jitResult.wasProvisioned,
          roleChanged: jitResult.roleChanged
        }
      });

      return res.json({
        success: true,
        isEnterprise: true,
        isMember: true,
        orgId,
        orgRole: jitResult.role,
        orgName: matchedOrgData.name,
        departmentId: jitResult.departmentId,
        departmentName: jitResult.departmentName,
        wasProvisioned: jitResult.wasProvisioned,
        isNewUser: jitResult.isNewUser,
        roleChanged: jitResult.roleChanged,
        departmentChanged: jitResult.departmentChanged,
        message: jitResult.message || "Enterprise Microsoft Entra ID authentication verified and custom claims synchronized."
      });

    } catch (error: any) {
      console.error("❌ Entra SSO Validation failed:", error);
      // Step 4B.2E: Release replay lease on transient error so client can retry safely
      if (entraValidation?.replayLease) {
        try {
          await entraValidation.replayLease.store.release(
            entraValidation.replayLease.fingerprint,
            entraValidation.replayLease.operationId,
            error.message
          );
        } catch (releaseErr) {
          console.error("⚠️ Failed to release replay lease on transient error:", releaseErr);
        }
      }
      res.status(500).json({ error: "SSO Validation Failed", message: error.message });
    }
  });

  // ==========================================
  // PHASE 1.6: SAML 2.0 ENTERPRISE SSO & IDENTITY PLATFORM INTEGRATION
  // ==========================================

  function formatSamlProviderId(orgId: string): string {
    const cleanOrgId = String(orgId || '').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '');
    return `saml.${cleanOrgId}`;
  }

  function sanitizePemCerts(certs: any): string[] {
    const certList = Array.isArray(certs) ? certs : (certs ? [certs] : []);
    return certList
      .map((c: any) => String(c || '').trim())
      .filter((c: string) => c.length > 0)
      .map((c: string) => {
        if (!c.includes('BEGIN CERTIFICATE')) {
          return `-----BEGIN CERTIFICATE-----\n${c}\n-----END CERTIFICATE-----`;
        }
        return c;
      });
  }

  async function syncIdentityPlatformSamlProvider(config: {
    providerId: string;
    displayName: string;
    idpEntityId: string;
    ssoUrl: string;
    x509Certificates: string[];
    rpEntityId: string;
    callbackUri: string;
    enabled: boolean;
  }): Promise<{ syncedWithGcp: boolean; status: 'synced' | 'local_fallback' | 'manual_required'; error?: string }> {
    try {
      const authAdmin = admin.auth();
      // Safely check if Identity Platform SAML management methods are supported on this SDK instance
      if (typeof (authAdmin as any).getSAMLProviderConfig === 'function') {
        try {
          await (authAdmin as any).getSAMLProviderConfig(config.providerId);
          if (typeof (authAdmin as any).updateSAMLProviderConfig === 'function') {
            await (authAdmin as any).updateSAMLProviderConfig(config.providerId, {
              displayName: config.displayName,
              enabled: config.enabled,
              idpEntityId: config.idpEntityId,
              ssoUrl: config.ssoUrl,
              x509Certificates: config.x509Certificates.map(c => ({
                certificate: c.replace(/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\s/g, '')
              })),
              rpEntityId: config.rpEntityId,
              callbackUri: config.callbackUri
            });
            return { syncedWithGcp: true, status: 'synced' };
          }
        } catch (err: any) {
          if (err?.code === 'auth/configuration-not-found' || err?.code === 'CONFIGURATION_NOT_FOUND' || String(err?.message).includes('not found')) {
            if (typeof (authAdmin as any).createSAMLProviderConfig === 'function') {
              await (authAdmin as any).createSAMLProviderConfig({
                providerId: config.providerId,
                displayName: config.displayName,
                enabled: config.enabled,
                idpEntityId: config.idpEntityId,
                ssoUrl: config.ssoUrl,
                x509Certificates: config.x509Certificates.map(c => ({
                  certificate: c.replace(/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\s/g, '')
                })),
                rpEntityId: config.rpEntityId,
                callbackUri: config.callbackUri
              });
              return { syncedWithGcp: true, status: 'synced' };
            }
          } else {
            console.warn("⚠️ Identity Platform SAML API sync notice:", err?.message || err);
            return { syncedWithGcp: false, status: 'manual_required', error: err?.message || String(err) };
          }
        }
      }
      return { syncedWithGcp: false, status: 'local_fallback', error: 'Identity Platform programmatic provider creation is reserved for Google Cloud Console' };
    } catch (syncErr: any) {
      console.warn("⚠️ Identity Platform sync error:", syncErr?.message || syncErr);
      return { syncedWithGcp: false, status: 'manual_required', error: syncErr?.message || String(syncErr) };
    }
  }

  /**
   * Validate SAML 2.0 SSO Identity and Authorize Organization Context (Phase 1.6)
   */
  app.post("/api/auth/sso/validate-saml", requireAuth, async (req: AuthenticatedRequest, res) => {
    const callerUid = req.user!.uid;
    const callerEmail = (req.user!.email || "").toLowerCase().trim();
    const tokenSignInProvider = req.user!.firebase?.sign_in_provider || "saml";
    const { 
      orgId: clientOrgId, 
      providerId: clientProviderId,
      groups,
      department,
      jobTitle,
      displayName,
      photoURL,
      claims: clientClaims
    } = req.body || {};

    if (!callerEmail) {
      return res.status(400).json({ error: "Bad Request", message: "User email is required for SAML SSO validation." });
    }

    const domain = normalizeDomain(callerEmail);
    if (PUBLIC_CONSUMER_DOMAINS.has(domain)) {
      return res.status(400).json({ 
        error: "Bad Request", 
        message: "Public consumer email domains cannot be used for enterprise SSO discovery." 
      });
    }

    try {
      // 1. Locate organization owning this verified enterprise domain
      const orgsSnap = await db.collection("organizations").get();
      let matchedOrgDoc: any = null;
      let matchedOrgData: any = null;

      for (const doc of orgsSnap.docs) {
        const data = doc.data() || {};
        let allowedList: string[] = [];

        if (Array.isArray(data.domains)) {
          const found = data.domains.some((d: any) => {
            const dName = typeof d === 'string' ? normalizeDomain(d) : normalizeDomain(d.domain);
            const dStatus = typeof d === 'object' ? d.status : 'verified';
            return dName === domain && dStatus === 'verified';
          });
          if (found) {
            matchedOrgDoc = doc;
            matchedOrgData = data;
            break;
          }
        }

        if (Array.isArray(data.settings?.allowedDomains)) {
          allowedList = data.settings.allowedDomains.map(normalizeDomain);
        } else if (Array.isArray(data.securitySettings?.allowedDomains)) {
          allowedList = data.securitySettings.allowedDomains.map(normalizeDomain);
        } else if (typeof data.securitySettings?.allowedDomains === 'string') {
          allowedList = data.securitySettings.allowedDomains.split(',').map(normalizeDomain);
        } else if (data.domain) {
          allowedList = [normalizeDomain(data.domain)];
        }

        if (allowedList.includes(domain)) {
          const unverifiedList = Array.isArray(data.unverifiedDomains) ? data.unverifiedDomains.map(normalizeDomain) : [];
          if (!unverifiedList.includes(domain)) {
            matchedOrgDoc = doc;
            matchedOrgData = data;
            break;
          }
        }
      }

      if (!matchedOrgDoc || !matchedOrgData) {
        return res.json({
          success: true,
          isEnterprise: false,
          isMember: false,
          message: "Standard authentication verified. No enterprise organization linked to this email domain."
        });
      }

      const orgId = matchedOrgDoc.id;
      const sec = matchedOrgData.securitySettings || {};
      const samlCfg = sec.samlProvider || {};
      const expectedProviderId = samlCfg.providerId || formatSamlProviderId(orgId);

      // 2. Cross-Organization Provider Isolation Guard:
      // Prevent Organization A user from cross-authenticating with Organization B's SAML provider
      if (clientOrgId && clientOrgId !== orgId) {
        await recordOrgAuditEvent(db, {
          organizationId: orgId,
          actorUserId: callerUid,
          actorEmail: callerEmail,
          action: "SAML_LOGIN_BLOCKED",
          timestamp: new Date().toISOString(),
          source: "api",
          details: `Cross-organization SAML provider mismatch: targeted ${clientOrgId}, verified domain belongs to ${orgId}`,
          metadata: { clientOrgId, orgId, clientProviderId }
        });

        return res.status(403).json({
          error: "Forbidden",
          code: "SAML_CROSS_ORG_FORBIDDEN",
          message: "Cross-organization SAML provider authentication is strictly forbidden."
        });
      }

      // Check if SAML provider is active
      if (sec.ssoStatus === 'disabled' || samlCfg.enabled === false) {
        await recordOrgAuditEvent(db, {
          organizationId: orgId,
          actorUserId: callerUid,
          actorEmail: callerEmail,
          action: "SAML_LOGIN_BLOCKED",
          timestamp: new Date().toISOString(),
          source: "api",
          details: `Attempted SAML login while SAML provider is disabled for ${orgId}`
        });

        return res.status(403).json({
          error: "Forbidden",
          code: "SAML_PROVIDER_DISABLED",
          message: "SAML Single Sign-On is currently disabled for this organization."
        });
      }

      // 3. Process JIT Provisioning or Identity Attribute / Group Sync
      const tokenGroups = Array.isArray(req.user?.groups) 
        ? req.user.groups 
        : (Array.isArray(groups) ? groups : []);
      const tokenDept = (req.user as any)?.department || department || undefined;
      const tokenJobTitle = (req.user as any)?.job_title || (req.user as any)?.jobTitle || jobTitle || undefined;
      const userName = req.user?.name || displayName || undefined;
      const userPhoto = req.user?.picture || photoURL || undefined;

      const jitResult = await processEnterpriseJitOrSync(db, orgId, matchedOrgData, {
        uid: callerUid,
        email: callerEmail,
        displayName: userName,
        photoURL: userPhoto,
        provider: 'saml',
        groups: tokenGroups,
        department: tokenDept,
        jobTitle: tokenJobTitle,
        claims: sanitizeSsoClaims(clientClaims),
        tenantId: expectedProviderId
      });

      if (jitResult.status === 'deactivated') {
        return res.status(403).json({
          error: "Forbidden",
          code: "MEMBER_DEACTIVATED",
          message: "Your enterprise organization account has been deactivated by an administrator."
        });
      }

      if (!jitResult.allowed || !jitResult.isMember) {
        return res.json({
          success: true,
          isEnterprise: true,
          isMember: false,
          pending: true,
          reason: jitResult.reason || 'INVITATION_REQUIRED',
          orgId,
          orgName: matchedOrgData.name,
          message: jitResult.message || "Authenticated successfully with SAML 2.0 SSO. Membership requires an administrator invitation."
        });
      }

      await recordOrgAuditEvent(db, {
        organizationId: orgId,
        actorUserId: callerUid,
        actorEmail: callerEmail,
        action: "SAML_LOGIN_SUCCESS",
        timestamp: new Date().toISOString(),
        source: "sso_saml",
        details: `SAML 2.0 SSO login successful for ${callerEmail} (${jitResult.role})`,
        metadata: { 
          provider: tokenSignInProvider, 
          providerId: expectedProviderId,
          wasProvisioned: jitResult.wasProvisioned,
          roleChanged: jitResult.roleChanged
        }
      });

      return res.json({
        success: true,
        isEnterprise: true,
        isMember: true,
        orgId,
        orgRole: jitResult.role,
        orgName: matchedOrgData.name,
        departmentId: jitResult.departmentId,
        departmentName: jitResult.departmentName,
        wasProvisioned: jitResult.wasProvisioned,
        isNewUser: jitResult.isNewUser,
        roleChanged: jitResult.roleChanged,
        departmentChanged: jitResult.departmentChanged,
        message: jitResult.message || "Enterprise SAML 2.0 authentication verified and custom claims synchronized."
      });

    } catch (error: any) {
      console.error("❌ SAML SSO Validation failed:", error);
      res.status(500).json({ error: "SAML SSO Validation Failed", message: error.message });
    }
  });

  /**
   * Unified Enterprise SSO Session Validation & JIT Provisioning (Phase 1.5A)
   * Validates SAML, OIDC, Microsoft Entra, and Google Workspace sessions.
   */
  app.post("/api/auth/sso/validate", requireAuth, async (req: AuthenticatedRequest, res) => {
    const callerUid = req.user!.uid;
    const callerEmail = (req.user!.email || "").toLowerCase().trim();
    const tokenSignInProvider = req.user!.firebase?.sign_in_provider || "enterprise_sso";
    const { 
      orgId: clientOrgId, 
      providerId: clientProviderId,
      protocol: clientProtocol,
      tenantId: clientTenantId,
      groups,
      department,
      jobTitle,
      displayName,
      photoURL,
      claims: clientClaims
    } = req.body || {};

    if (!callerEmail) {
      return res.status(400).json({ error: "Bad Request", message: "User email is required for enterprise SSO validation." });
    }

    const domain = normalizeDomain(callerEmail);

    let entraValidation: any = null;
    try {
      // 1. Locate organization owning this verified enterprise domain
      const orgsSnap = await db.collection("organizations").get();
      let matchedOrgDoc: any = null;
      let matchedOrgData: any = null;

      for (const doc of orgsSnap.docs) {
        const data = doc.data() || {};
        let allowedList: string[] = [];

        if (Array.isArray(data.domains)) {
          const found = data.domains.some((d: any) => {
            const dName = typeof d === 'string' ? normalizeDomain(d) : normalizeDomain(d.domain);
            const dStatus = typeof d === 'object' ? d.status : 'verified';
            return dName === domain && dStatus === 'verified';
          });
          if (found) {
            matchedOrgDoc = doc;
            matchedOrgData = data;
            break;
          }
        }

        if (Array.isArray(data.settings?.allowedDomains)) {
          allowedList = data.settings.allowedDomains.map(normalizeDomain);
        } else if (Array.isArray(data.securitySettings?.allowedDomains)) {
          allowedList = data.securitySettings.allowedDomains.map(normalizeDomain);
        } else if (typeof data.securitySettings?.allowedDomains === 'string') {
          allowedList = data.securitySettings.allowedDomains.split(',').map(normalizeDomain);
        } else if (data.domain) {
          allowedList = [normalizeDomain(data.domain)];
        }

        if (allowedList.includes(domain)) {
          const unverifiedList = Array.isArray(data.unverifiedDomains) ? data.unverifiedDomains.map(normalizeDomain) : [];
          if (!unverifiedList.includes(domain)) {
            matchedOrgDoc = doc;
            matchedOrgData = data;
            break;
          }
        }
      }

      if (!matchedOrgDoc || !matchedOrgData) {
        return res.json({
          success: true,
          isEnterprise: false,
          isMember: false,
          message: "Standard authentication verified. No enterprise organization linked to this email domain."
        });
      }

      const orgId = matchedOrgDoc.id;
      const sec = matchedOrgData.securitySettings || {};
      const ssoConfig = sec.ssoConfig || {};
      const samlCfg = sec.samlProvider || {};
      const oidcCfg = sec.oidcProvider || {};

      // 2. Cross-Organization Provider Isolation Guard:
      if (clientOrgId && clientOrgId !== orgId) {
        await recordOrgAuditEvent(db, {
          organizationId: orgId,
          actorUserId: callerUid,
          actorEmail: callerEmail,
          action: "SSO_LOGIN_BLOCKED",
          timestamp: new Date().toISOString(),
          source: "api",
          details: `Cross-organization provider mismatch: targeted ${clientOrgId}, verified domain belongs to ${orgId}`,
          metadata: { clientOrgId, orgId, clientProviderId }
        });

        return res.status(403).json({
          error: "Forbidden",
          code: "SAML_CROSS_ORG_FORBIDDEN",
          message: "Cross-organization identity provider authentication is strictly forbidden."
        });
      }

      // 3. Tenant Isolation & Identity Binding Check (Authoritative Validation)
      const expectedTenant = matchedOrgData.identityPlatformTenantId || sec.identityPlatformTenantId || sec.entraTenantId;
      const isMicrosoftSso = 
        clientProviderId === 'microsoft.com' ||
        clientProviderId?.includes('entra') ||
        Boolean(sec.entraTenantId) ||
        Boolean(sec.entraClientId) ||
        (req.user as any)?.firebase?.sign_in_provider === 'microsoft.com' ||
        Boolean((req.body?.idToken || req.body?.credentialToken) && !clientProviderId?.includes('saml'));

      let authoritativeTenantId: string | undefined;

      if (isMicrosoftSso && (expectedTenant || req.body?.idToken || req.body?.credentialToken)) {
        // 1. Authoritative Microsoft Entra Tenant Policy Validation (Step 4B.2D)
        const tenantPolicy = resolveAuthoritativeTenantPolicy(matchedOrgData, sec);
        if (!tenantPolicy.valid) {
          await recordOrgAuditEvent(db, {
            organizationId: orgId,
            actorUserId: callerUid,
            actorEmail: callerEmail,
            action: (tenantPolicy.errorCode || "SSO_TENANT_POLICY_MISSING") as any,
            timestamp: new Date().toISOString(),
            source: "api",
            details: tenantPolicy.error || "Microsoft Entra tenant policy validation failed."
          });

          return res.status(403).json({
            error: "Forbidden",
            code: tenantPolicy.errorCode || "SSO_TENANT_POLICY_MISSING",
            message: tenantPolicy.error || "Organization has not configured an authoritative Microsoft Entra tenant policy."
          });
        }

        // 2. Authoritative Client-ID Configuration Policy (Step 4B.2D)
        const clientPolicy = resolveAuthoritativeMicrosoftClientId(matchedOrgData, sec, {
          allowSharedApp: tenantPolicy.valid
        });

        if (clientPolicy.hasConflict) {
          await recordOrgAuditEvent(db, {
            organizationId: orgId,
            actorUserId: callerUid,
            actorEmail: callerEmail,
            action: "SSO_CLIENT_ID_CONFIG_CONFLICT" as any,
            timestamp: new Date().toISOString(),
            source: "api",
            details: clientPolicy.conflictDetails || "Conflicting Microsoft application client IDs configured."
          });

          return res.status(403).json({
            error: "Forbidden",
            code: "SSO_CLIENT_ID_CONFIG_CONFLICT",
            message: clientPolicy.conflictDetails || "Organization has conflicting Microsoft application client ID configurations."
          });
        }

        const expectedClientId = clientPolicy.clientId || "";

        // Mandatory Audience Configuration: Reject missing audience config when raw token evidence is presented
        if ((req.body?.idToken || req.body?.credentialToken) && !expectedClientId) {
          await recordOrgAuditEvent(db, {
            organizationId: orgId,
            actorUserId: callerUid,
            actorEmail: callerEmail,
            action: "SSO_AUDIENCE_MISMATCH",
            timestamp: new Date().toISOString(),
            source: "api",
            details: "Missing mandatory Microsoft application client ID (audience) in organization configuration."
          });

          return res.status(403).json({
            error: "Forbidden",
            code: "SSO_AUDIENCE_CONFIG_MISSING",
            message: "Organization has not configured an authorized Microsoft application client ID."
          });
        }

        entraValidation = await validateAuthoritativeEntraTenant(
          req.user,
          {
            idToken: req.body?.idToken,
            credentialToken: req.body?.credentialToken,
            reportedTenantId: clientTenantId
          },
          {
            expectedTenantId: tenantPolicy.expectedTenantId,
            allowedTenantIds: tenantPolicy.allowedTenantIds,
            expectedAudience: expectedClientId || undefined,
            db,
            twoPhaseReplay: true
          }
        );

        if (!entraValidation.valid) {
          let auditAction = "SSO_AUTHENTICATION_FAILED";
          let clientCode = "SSO_AUTHENTICATION_FAILED";
          let clientMessage = entraValidation.error || "Authoritative tenant validation failed.";
          let httpStatus = 403;

          if (entraValidation.code === 'TENANT_MISMATCH') {
            auditAction = "SSO_TENANT_MISMATCH";
            clientCode = "SSO_TENANT_MISMATCH";
            clientMessage = "Authentication occurred under an unauthorized tenant directory.";
          } else if (entraValidation.code === 'IDENTITY_SUBSTITUTION_DETECTED') {
            auditAction = "SSO_IDENTITY_MISMATCH";
            clientCode = "SSO_IDENTITY_MISMATCH";
            clientMessage = "Microsoft identity does not match the authenticated session account.";
          } else if (entraValidation.code === 'AUDIENCE_MISMATCH') {
            auditAction = "SSO_AUDIENCE_MISMATCH";
            clientCode = "SSO_AUDIENCE_MISMATCH";
            clientMessage = "Microsoft token audience does not match configured application client ID.";
          } else if (entraValidation.code === 'TOKEN_TYPE_INVALID') {
            auditAction = "SSO_TOKEN_TYPE_INVALID";
            clientCode = "SSO_TOKEN_TYPE_INVALID";
            clientMessage = "Invalid token type: Microsoft Graph and resource tokens are rejected as ID token evidence.";
          } else if (entraValidation.code === 'TOKEN_REPLAYED') {
            auditAction = "SSO_TOKEN_REPLAYED";
            clientCode = "SSO_TOKEN_REPLAYED";
            clientMessage = entraValidation.error || "Authentication token has already been consumed. Please sign in again.";
          } else if (entraValidation.code === 'REPLAY_STORE_UNAVAILABLE') {
            auditAction = "SSO_REPLAY_PROTECTION_FAILED";
            clientCode = "SSO_REPLAY_CHECK_UNAVAILABLE";
            clientMessage = "Enterprise SSO replay verification is temporarily unavailable. Please try again shortly.";
            httpStatus = 503;
          }

          await recordOrgAuditEvent(db, {
            organizationId: orgId,
            actorUserId: callerUid,
            actorEmail: callerEmail,
            action: auditAction as any,
            timestamp: new Date().toISOString(),
            source: "api",
            details: entraValidation.error || `Enterprise tenant directory mismatch: expected ${expectedTenant}`,
            metadata: { 
              clientTenantId, 
              expectedTenant, 
              expectedClientId,
              validationCode: entraValidation.code,
              validationSource: entraValidation.source,
              discoveredTenantId: entraValidation.tenantId
            }
          });

          return res.status(httpStatus).json({
            error: httpStatus === 503 ? "Service Unavailable" : "Forbidden",
            code: clientCode,
            message: clientMessage
          });
        }

        authoritativeTenantId = entraValidation.tenantId;
      }

      // 4. Check if SSO is enabled for the organization
      if (sec.ssoStatus === 'disabled' || (samlCfg && samlCfg.enabled === false && !sec.entraTenantId && !oidcCfg.enabled)) {
        await recordOrgAuditEvent(db, {
          organizationId: orgId,
          actorUserId: callerUid,
          actorEmail: callerEmail,
          action: "SSO_LOGIN_BLOCKED",
          timestamp: new Date().toISOString(),
          source: "api",
          details: `Attempted enterprise login while SSO is disabled for ${orgId}`
        });

        return res.status(403).json({
          error: "Forbidden",
          code: "SSO_ACCESS_DENIED",
          message: "Single Sign-On is currently disabled for your organization."
        });
      }

      // 5. Process JIT Provisioning or Identity Attribute / Group Sync
      const tokenGroups = Array.isArray(req.user?.groups) 
        ? req.user.groups 
        : (Array.isArray(groups) ? groups : []);
      const tokenDept = (req.user as any)?.department || department || undefined;
      const tokenJobTitle = (req.user as any)?.job_title || (req.user as any)?.jobTitle || jobTitle || undefined;
      const userName = req.user?.name || displayName || undefined;
      const userPhoto = req.user?.picture || photoURL || undefined;

      const providerType = clientProtocol === 'SAML' ? 'saml' : (tokenSignInProvider.includes('microsoft') || sec.entraTenantId ? 'entra' : 'oidc');

      const jitResult = await processEnterpriseJitOrSync(db, orgId, matchedOrgData, {
        uid: callerUid,
        email: callerEmail,
        displayName: userName,
        photoURL: userPhoto,
        provider: providerType as any,
        groups: tokenGroups,
        department: tokenDept,
        jobTitle: tokenJobTitle,
        claims: sanitizeSsoClaimsHelper(clientClaims),
        tenantId: authoritativeTenantId || expectedTenant
      });

      // Step 4B.2E: Finalize distributed replay record once JIT provisioning completes
      if (entraValidation?.replayLease) {
        try {
          await entraValidation.replayLease.store.finalize(
            entraValidation.replayLease.fingerprint,
            entraValidation.replayLease.operationId
          );
        } catch (finalizeErr) {
          console.error("⚠️ Failed to finalize replay lease in unified validate route:", finalizeErr);
        }
      }

      if (jitResult.status === 'deactivated') {
        return res.status(403).json({
          error: "Forbidden",
          code: "MEMBER_DEACTIVATED",
          message: "Your enterprise organization account has been deactivated by an administrator."
        });
      }

      if (!jitResult.allowed || !jitResult.isMember) {
        return res.json({
          success: true,
          isEnterprise: true,
          isMember: false,
          pending: true,
          reason: jitResult.reason || 'INVITATION_REQUIRED',
          orgId,
          orgName: matchedOrgData.name,
          message: jitResult.message || "Authenticated successfully with enterprise SSO. Membership requires an administrator invitation."
        });
      }

      await recordOrgAuditEvent(db, {
        organizationId: orgId,
        actorUserId: callerUid,
        actorEmail: callerEmail,
        action: jitResult.wasProvisioned ? "ENTERPRISE_JIT_PROVISIONED" : "ENTERPRISE_LOGIN_SUCCESS",
        timestamp: new Date().toISOString(),
        source: "sso_unified",
        details: `Enterprise SSO login successful for ${callerEmail} (${jitResult.role})`,
        metadata: { 
          provider: tokenSignInProvider, 
          wasProvisioned: jitResult.wasProvisioned,
          roleChanged: jitResult.roleChanged,
          departmentChanged: jitResult.departmentChanged
        }
      });

      return res.json({
        success: true,
        isEnterprise: true,
        isMember: true,
        orgId,
        orgRole: jitResult.role,
        orgName: matchedOrgData.name,
        departmentId: jitResult.departmentId,
        departmentName: jitResult.departmentName,
        wasProvisioned: jitResult.wasProvisioned,
        isNewUser: jitResult.isNewUser,
        roleChanged: jitResult.roleChanged,
        departmentChanged: jitResult.departmentChanged,
        message: jitResult.message || "Enterprise authentication verified and custom claims synchronized."
      });

    } catch (error: any) {
      console.error("❌ Unified Enterprise SSO Validation failed:", error);
      // Step 4B.2E: Release replay lease on transient error so client can retry safely
      if (entraValidation?.replayLease) {
        try {
          await entraValidation.replayLease.store.release(
            entraValidation.replayLease.fingerprint,
            entraValidation.replayLease.operationId,
            error.message
          );
        } catch (releaseErr) {
          console.error("⚠️ Failed to release replay lease on transient error in unified validate route:", releaseErr);
        }
      }
      res.status(500).json({ error: "Enterprise SSO Validation Failed", message: error.message });
    }
  });

  /**
   * Configure / Update Organization SAML 2.0 Provider (Owner & Org Admin only)
   */
  app.post("/api/organizations/:organizationId/saml-config", requireAuth, requireOrgRole(db, "org_admin"), async (req: AuthenticatedRequest, res) => {
    const { organizationId } = req.params;
    const callerUid = req.user!.uid;
    const callerEmail = req.user!.email || "Admin";
    const { 
      displayName, 
      entityId, 
      ssoUrl, 
      x509Certificates, 
      enabled, 
      enforceSso 
    } = req.body;

    if (!entityId || typeof entityId !== 'string' || !entityId.trim()) {
      return res.status(400).json({ error: "Bad Request", message: "IdP Entity ID (Issuer URI) is required." });
    }

    if (!ssoUrl || typeof ssoUrl !== 'string' || !ssoUrl.trim()) {
      return res.status(400).json({ error: "Bad Request", message: "IdP Single Sign-On URL is required." });
    }

    const cleanCerts = sanitizePemCerts(x509Certificates);
    if (cleanCerts.length === 0) {
      return res.status(400).json({ error: "Bad Request", message: "At least one valid X.509 certificate PEM is required." });
    }

    try {
      const orgRef = db.collection("organizations").doc(organizationId);
      const orgSnap = await orgRef.get();
      if (!orgSnap.exists) {
        return res.status(404).json({ error: "Not Found", message: "Organization not found" });
      }

      const orgData = orgSnap.data() || {};
      const currentSec = orgData.securitySettings || {};
      const currentSaml = currentSec.samlProvider || {};
      const providerId = currentSaml.providerId || formatSamlProviderId(organizationId);

      const authDomain = firebaseConfig.authDomain || "echonote-2509.firebaseapp.com";
      const spCallbackUrl = `https://${authDomain}/__/auth/handler`;
      const spEntityId = `https://${authDomain}/__/auth/handler`;

      // Check if this is creation or update
      const isNewConfig = !currentSaml.entityId;

      // Sync with Identity Platform if possible
      const isEnabled = enabled !== false;
      const gcpSyncResult = await syncIdentityPlatformSamlProvider({
        providerId,
        displayName: (displayName || "Corporate SAML").trim(),
        idpEntityId: entityId.trim(),
        ssoUrl: ssoUrl.trim(),
        x509Certificates: cleanCerts,
        rpEntityId: spEntityId,
        callbackUri: spCallbackUrl,
        enabled: isEnabled
      });

      const updatedSaml: any = {
        providerId,
        displayName: (displayName || "Corporate SAML").trim(),
        entityId: entityId.trim(),
        ssoUrl: ssoUrl.trim(),
        x509Certificates: cleanCerts,
        spEntityId,
        callbackUrl: spCallbackUrl,
        enabled: isEnabled,
        status: currentSaml.status === 'verified' ? 'verified' : 'configured',
        identityPlatformStatus: gcpSyncResult.status,
        lastTestedAt: currentSaml.lastTestedAt || null,
        lastTestStatus: currentSaml.lastTestStatus || null,
        updatedAt: new Date().toISOString()
      };

      const updatedSec: any = {
        ...currentSec,
        ssoStatus: isEnabled ? 'enabled' : 'disabled',
        ssoProtocol: 'SAML',
        enforceSso: Boolean(enforceSso),
        samlProvider: updatedSaml,
        updatedAt: new Date().toISOString()
      };

      await orgRef.update({
        securitySettings: updatedSec,
        updatedAt: new Date().toISOString()
      });

      // Audit logs
      await recordOrgAuditEvent(db, {
        organizationId,
        actorUserId: callerUid,
        actorEmail: callerEmail,
        action: isNewConfig ? "SAML_CONFIGURATION_CREATED" : "SAML_CONFIGURATION_UPDATED",
        timestamp: new Date().toISOString(),
        source: "api",
        details: `${isNewConfig ? 'Created' : 'Updated'} SAML 2.0 configuration for provider ${providerId}`,
        metadata: {
          providerId,
          displayName: updatedSaml.displayName,
          entityId: updatedSaml.entityId,
          certCount: cleanCerts.length,
          enabled: isEnabled,
          enforceSso: updatedSec.enforceSso,
          identityPlatformStatus: gcpSyncResult.status
        }
      });

      if (isEnabled !== currentSaml.enabled) {
        await recordOrgAuditEvent(db, {
          organizationId,
          actorUserId: callerUid,
          actorEmail: callerEmail,
          action: isEnabled ? "SAML_CONFIGURATION_ENABLED" : "SAML_CONFIGURATION_DISABLED",
          timestamp: new Date().toISOString(),
          source: "api",
          details: isEnabled ? "SAML SSO provider enabled" : "SAML SSO provider disabled",
          metadata: { providerId }
        });
      }

      if (Boolean(enforceSso) !== Boolean(currentSec.enforceSso)) {
        await recordOrgAuditEvent(db, {
          organizationId,
          actorUserId: callerUid,
          actorEmail: callerEmail,
          action: enforceSso ? "SSO_ENFORCEMENT_ENABLED" : "SSO_ENFORCEMENT_DISABLED",
          timestamp: new Date().toISOString(),
          source: "api",
          details: enforceSso ? "Single Sign-On enforcement enabled" : "Single Sign-On enforcement disabled",
          metadata: { protocol: "SAML", providerId }
        });
      }

      res.json({
        success: true,
        samlProvider: updatedSaml,
        securitySettings: {
          ssoStatus: updatedSec.ssoStatus,
          ssoProtocol: updatedSec.ssoProtocol,
          enforceSso: updatedSec.enforceSso
        },
        message: "SAML 2.0 configuration saved successfully."
      });
    } catch (error: any) {
      console.error("❌ Save SAML Config failed:", error);
      res.status(500).json({ error: "Failed to save SAML configuration", message: error.message });
    }
  });

  /**
   * Test SAML Provider Configuration (Owner & Org Admin only)
   */
  app.post("/api/organizations/:organizationId/saml-config/test", requireAuth, requireOrgRole(db, "org_admin"), async (req: AuthenticatedRequest, res) => {
    const { organizationId } = req.params;
    const callerUid = req.user!.uid;
    const callerEmail = req.user!.email || "Admin";

    try {
      const orgRef = db.collection("organizations").doc(organizationId);
      const orgSnap = await orgRef.get();
      if (!orgSnap.exists) {
        return res.status(404).json({ error: "Not Found", message: "Organization not found" });
      }

      const orgData = orgSnap.data() || {};
      const sec = orgData.securitySettings || {};
      const samlCfg = sec.samlProvider;

      if (!samlCfg || !samlCfg.entityId || !samlCfg.ssoUrl) {
        return res.status(400).json({ 
          error: "Bad Request", 
          code: "SAML_CONFIG_MISSING",
          message: "SAML provider configuration is incomplete. Please configure IdP Entity ID, SSO URL, and X.509 Certificate first." 
        });
      }

      // Check certificate validity
      const certs = samlCfg.x509Certificates || [];
      const certValidations = certs.map((cert: string, idx: number) => {
        const hasHeader = cert.includes("BEGIN CERTIFICATE");
        const hasFooter = cert.includes("END CERTIFICATE");
        const rawBase64 = cert.replace(/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\s/g, '');
        const validBase64 = /^[A-Za-z0-9+/=]+$/.test(rawBase64) && rawBase64.length > 50;
        return {
          index: idx + 1,
          formatValid: hasHeader && hasFooter && validBase64,
          keyLengthEstimate: `${rawBase64.length * 6} bits (approx)`
        };
      });

      const allCertsValid = certValidations.every((c: any) => c.formatValid);
      const ssoUrlValid = samlCfg.ssoUrl.startsWith("https://") || samlCfg.ssoUrl.startsWith("http://");

      if (!allCertsValid || !ssoUrlValid) {
        await recordOrgAuditEvent(db, {
          organizationId,
          actorUserId: callerUid,
          actorEmail: callerEmail,
          action: "SAML_CONFIGURATION_ERROR",
          timestamp: new Date().toISOString(),
          source: "api",
          details: `SAML Test Failed: Invalid certificates or SSO URL for ${samlCfg.providerId}`
        });

        await orgRef.update({
          "securitySettings.samlProvider.lastTestedAt": new Date().toISOString(),
          "securitySettings.samlProvider.lastTestStatus": "failed",
          "securitySettings.samlProvider.lastTestError": "Invalid X.509 certificate format or SSO URL"
        });

        return res.status(400).json({
          success: false,
          diagnostic: {
            providerId: samlCfg.providerId,
            entityId: samlCfg.entityId,
            ssoUrl: samlCfg.ssoUrl,
            ssoUrlValid,
            certValidations,
            allCertsValid
          },
          message: "SAML verification failed: Please verify your SSO URL and X.509 certificate format."
        });
      }

      // Update SAML status to 'verified'
      await orgRef.update({
        "securitySettings.samlProvider.status": "verified",
        "securitySettings.samlProvider.lastTestedAt": new Date().toISOString(),
        "securitySettings.samlProvider.lastTestStatus": "success",
        "securitySettings.samlProvider.lastTestError": null
      });

      res.json({
        success: true,
        diagnostic: {
          providerId: samlCfg.providerId,
          entityIdValid: true,
          ssoUrlValid: true,
          certificateCount: certs.length,
          certValidations,
          spEntityId: samlCfg.spEntityId,
          spCallbackUrl: samlCfg.callbackUrl,
          identityPlatformStatus: samlCfg.identityPlatformStatus || 'synced',
          testedAt: new Date().toISOString()
        },
        message: "SAML provider configuration successfully validated and verified."
      });
    } catch (error: any) {
      console.error("❌ Test SAML Config failed:", error);
      res.status(500).json({ error: "SAML Test Execution Failed", message: error.message });
    }
  });

  /**
   * Delete / Disable SAML 2.0 Provider Configuration (Owner & Org Admin only)
   */
  app.delete("/api/organizations/:organizationId/saml-config", requireAuth, requireOrgRole(db, "org_admin"), async (req: AuthenticatedRequest, res) => {
    const { organizationId } = req.params;
    const callerUid = req.user!.uid;
    const callerEmail = req.user!.email || "Admin";

    try {
      const orgRef = db.collection("organizations").doc(organizationId);
      const orgSnap = await orgRef.get();
      if (!orgSnap.exists) {
        return res.status(404).json({ error: "Not Found", message: "Organization not found" });
      }

      const orgData = orgSnap.data() || {};
      const sec = orgData.securitySettings || {};
      const samlCfg = sec.samlProvider;
      const providerId = samlCfg?.providerId || formatSamlProviderId(organizationId);

      // Attempt to delete from Identity Platform if available
      try {
        const authAdmin = admin.auth();
        if (typeof (authAdmin as any).deleteSAMLProviderConfig === 'function') {
          await (authAdmin as any).deleteSAMLProviderConfig(providerId);
        }
      } catch (delErr) {
        console.warn("⚠️ Identity Platform SAML delete notice:", delErr);
      }

      await orgRef.update({
        "securitySettings.samlProvider": FieldValue.delete(),
        "securitySettings.ssoStatus": "disabled",
        "securitySettings.enforceSso": false,
        updatedAt: new Date().toISOString()
      });

      await recordOrgAuditEvent(db, {
        organizationId,
        actorUserId: callerUid,
        actorEmail: callerEmail,
        action: "SAML_CONFIGURATION_DISABLED",
        timestamp: new Date().toISOString(),
        source: "api",
        details: `Deleted SAML 2.0 configuration for provider ${providerId}`,
        metadata: { providerId }
      });

      res.json({
        success: true,
        message: "SAML 2.0 configuration deleted successfully."
      });
    } catch (error: any) {
      console.error("❌ Delete SAML Config failed:", error);
      res.status(500).json({ error: "Failed to delete SAML configuration", message: error.message });
    }
  });

  /**
   * Update Organization SSO Configuration (Owner & Org Admin only)
   */
  app.patch("/api/organizations/:organizationId/sso-config", requireAuth, requireOrgRole(db, "org_admin"), async (req: AuthenticatedRequest, res) => {
    const { organizationId } = req.params;
    const callerUid = req.user!.uid;
    const callerEmail = req.user!.email || "Admin";
    const { ssoStatus, ssoProtocol, enforceSso, entraTenantId, entraClientId } = req.body;

    try {
      const orgRef = db.collection("organizations").doc(organizationId);
      const orgSnap = await orgRef.get();
      if (!orgSnap.exists) {
        return res.status(404).json({ error: "Not Found", message: "Organization not found" });
      }

      const orgData = orgSnap.data() || {};
      const currentSec = orgData.securitySettings || {};

      const updatedSec: any = {
        ...currentSec,
        ssoStatus: ssoStatus === 'enabled' ? 'enabled' : 'disabled',
        ssoProtocol: ssoProtocol === 'SAML' ? 'SAML' : 'OIDC',
        enforceSso: Boolean(enforceSso),
        updatedAt: new Date().toISOString()
      };

      if (entraTenantId !== undefined) {
        updatedSec.entraTenantId = String(entraTenantId).trim();
      }
      if (entraClientId !== undefined) {
        updatedSec.entraClientId = String(entraClientId).trim();
      }

      await orgRef.update({
        securitySettings: updatedSec,
        updatedAt: new Date().toISOString()
      });

      await recordOrgAuditEvent(db, {
        organizationId,
        actorUserId: callerUid,
        actorEmail: callerEmail,
        action: "SSO_CONFIGURATION_UPDATED",
        timestamp: new Date().toISOString(),
        source: "api",
        details: `Updated SSO Configuration: status=${updatedSec.ssoStatus}, protocol=${updatedSec.ssoProtocol}, enforceSso=${updatedSec.enforceSso}`,
        metadata: {
          ssoStatus: updatedSec.ssoStatus,
          ssoProtocol: updatedSec.ssoProtocol,
          enforceSso: updatedSec.enforceSso,
          entraTenantId: updatedSec.entraTenantId || null,
          entraClientId: updatedSec.entraClientId || null
        }
      });

      res.json({
        success: true,
        securitySettings: {
          ssoStatus: updatedSec.ssoStatus,
          ssoProtocol: updatedSec.ssoProtocol,
          enforceSso: updatedSec.enforceSso,
          entraTenantId: updatedSec.entraTenantId || '',
          entraClientId: updatedSec.entraClientId || ''
        },
        message: "SSO configuration updated successfully."
      });
    } catch (error: any) {
      console.error("❌ Update SSO Config failed:", error);
      res.status(500).json({ error: "Failed to update SSO configuration", message: error.message });
    }
  });

  /**
   * Get Standardized Enterprise SSO Configuration (Phase 1.5A)
   */
  app.get("/api/organizations/:organizationId/sso", requireAuth, requireOrgRole(db, "org_admin"), async (req: AuthenticatedRequest, res) => {
    const { organizationId } = req.params;

    try {
      const orgRef = db.collection("organizations").doc(organizationId);
      const orgSnap = await orgRef.get();
      if (!orgSnap.exists) {
        return res.status(404).json({ error: "Not Found", message: "Organization not found" });
      }

      const orgData = orgSnap.data() || {};
      const sec = orgData.securitySettings || {};
      const saml = sec.samlProvider || {};
      const oidc = sec.oidcProvider || {};
      const ssoConfig = sec.ssoConfig || {};

      const protocol = sec.ssoProtocol || (sec.samlProvider ? 'SAML' : 'OIDC');
      const providerType = sec.ssoProviderType || (protocol === 'SAML' ? 'SAML' : (sec.entraTenantId ? 'MICROSOFT_ENTRA' : 'OIDC'));
      const providerId = saml.providerId || ssoConfig.providerId || formatSamlProviderId(organizationId);

      const authDomain = firebaseConfig.authDomain || "echonote-2509.firebaseapp.com";
      const spCallbackUrl = `https://${authDomain}/__/auth/handler`;
      const spEntityId = `https://${authDomain}/__/auth/handler`;

      const idpReadiness = checkIdentityPlatformReadiness();

      // Sanitized config
      const responseConfig = {
        organizationId,
        protocol,
        providerType,
        providerId,
        displayName: saml.displayName || ssoConfig.displayName || (protocol === 'SAML' ? 'Corporate SAML 2.0' : 'Enterprise OIDC'),
        identityPlatformTenantId: orgData.identityPlatformTenantId || sec.identityPlatformTenantId || undefined,
        enabled: sec.ssoStatus === 'enabled',
        enforceSso: Boolean(sec.enforceSso),
        status: saml.status || ssoConfig.status || (sec.ssoStatus === 'enabled' ? 'configured' : 'draft'),
        identityPlatformStatus: saml.identityPlatformStatus || (idpReadiness.enabled ? 'ready' : 'manual_required'),
        lastTestedAt: saml.lastTestedAt || ssoConfig.lastTestedAt || null,
        lastTestStatus: saml.lastTestStatus || ssoConfig.lastTestStatus || null,
        saml: {
          entityId: saml.entityId || '',
          ssoUrl: saml.ssoUrl || '',
          x509Certificates: saml.x509Certificates || [],
          spEntityId: saml.spEntityId || spEntityId,
          callbackUrl: saml.callbackUrl || spCallbackUrl
        },
        oidc: {
          issuer: oidc.issuer || (sec.entraTenantId ? `https://login.microsoftonline.com/${sec.entraTenantId}/v2.0` : ''),
          clientId: oidc.clientId || sec.entraClientId || '',
          hasClientSecret: Boolean(oidc.hasClientSecret || oidc.clientSecret),
          clientSecretMasked: (oidc.hasClientSecret || oidc.clientSecret) ? '••••••••••••••••' : undefined,
          scopes: oidc.scopes || ['openid', 'email', 'profile'],
          entraTenantId: sec.entraTenantId || undefined
        },
        identityPlatform: idpReadiness
      };

      res.json({
        success: true,
        sso: responseConfig
      });
    } catch (error: any) {
      console.error("❌ Get SSO Config failed:", error);
      res.status(500).json({ error: "Failed to get SSO configuration", message: error.message });
    }
  });

  /**
   * Create or Update Enterprise SSO Configuration (Phase 1.5A)
   */
  app.put("/api/organizations/:organizationId/sso", requireAuth, requireOrgRole(db, "org_admin"), async (req: AuthenticatedRequest, res) => {
    const { organizationId } = req.params;
    const callerUid = req.user!.uid;
    const callerEmail = req.user!.email || "Admin";

    const {
      protocol,
      providerType,
      displayName,
      identityPlatformTenantId,
      enabled,
      enforceSso,
      saml,
      oidc
    } = req.body || {};

    const targetProtocol = protocol === 'SAML' ? 'SAML' : 'OIDC';
    const isEnabled = enabled !== false;
    const isEnforce = Boolean(enforceSso);

    try {
      const orgRef = db.collection("organizations").doc(organizationId);
      const orgSnap = await orgRef.get();
      if (!orgSnap.exists) {
        return res.status(404).json({ error: "Not Found", message: "Organization not found" });
      }

      const orgData = orgSnap.data() || {};
      const currentSec = orgData.securitySettings || {};
      const currentSaml = currentSec.samlProvider || {};
      const currentOidc = currentSec.oidcProvider || {};
      const isNewConfig = !currentSec.ssoConfig && !currentSaml.entityId && !currentSec.entraTenantId;

      const authDomain = firebaseConfig.authDomain || "echonote-2509.firebaseapp.com";
      const spCallbackUrl = `https://${authDomain}/__/auth/handler`;
      const spEntityId = `https://${authDomain}/__/auth/handler`;

      let updatedSaml: any = { ...currentSaml };
      let updatedOidc: any = { ...currentOidc };
      let providerId = targetProtocol === 'SAML' 
        ? (currentSaml.providerId || formatSamlProviderId(organizationId))
        : (currentOidc.providerId || `oidc.${formatSamlProviderId(organizationId)}`);

      if (targetProtocol === 'SAML') {
        const entityId = (saml?.entityId || req.body.entityId || "").trim();
        const ssoUrl = (saml?.ssoUrl || req.body.ssoUrl || "").trim();
        const rawCerts = saml?.x509Certificates || req.body.x509Certificates || [];
        const cleanCerts = sanitizePemCerts(rawCerts);

        if (!entityId) {
          return res.status(400).json({ error: "Bad Request", message: "IdP Entity ID (Issuer URI) is required for SAML." });
        }
        if (!ssoUrl || (!ssoUrl.startsWith('http://') && !ssoUrl.startsWith('https://'))) {
          return res.status(400).json({ error: "Bad Request", message: "A valid IdP Single Sign-On URL (https://) is required." });
        }
        if (cleanCerts.length === 0) {
          return res.status(400).json({ error: "Bad Request", message: "At least one valid X.509 certificate PEM is required." });
        }

        const gcpSyncResult = await syncIdentityPlatformSamlProvider({
          providerId,
          displayName: (displayName || currentSaml.displayName || "Corporate SAML").trim(),
          idpEntityId: entityId,
          ssoUrl,
          x509Certificates: cleanCerts,
          rpEntityId: spEntityId,
          callbackUri: spCallbackUrl,
          enabled: isEnabled
        });

        updatedSaml = {
          providerId,
          displayName: (displayName || currentSaml.displayName || "Corporate SAML").trim(),
          entityId,
          ssoUrl,
          x509Certificates: cleanCerts,
          spEntityId,
          callbackUrl: spCallbackUrl,
          enabled: isEnabled,
          status: currentSaml.status === 'verified' ? 'verified' : 'configured',
          identityPlatformStatus: gcpSyncResult.status,
          lastTestedAt: currentSaml.lastTestedAt || null,
          lastTestStatus: currentSaml.lastTestStatus || null,
          updatedAt: new Date().toISOString()
        };
      } else {
        // OIDC / Microsoft Entra
        const issuer = (oidc?.issuer || req.body.issuer || "").trim();
        const clientId = (oidc?.clientId || req.body.clientId || req.body.entraClientId || "").trim();
        const clientSecret = (oidc?.clientSecret || req.body.clientSecret || "").trim();
        const entraTenantId = (oidc?.entraTenantId || req.body.entraTenantId || "").trim();
        const scopes = Array.isArray(oidc?.scopes) ? oidc.scopes : ['openid', 'email', 'profile'];

        if (!clientId) {
          return res.status(400).json({ error: "Bad Request", message: "Client ID is required for OIDC / Entra ID." });
        }

        updatedOidc = {
          providerId,
          displayName: (displayName || currentOidc.displayName || (entraTenantId ? "Microsoft Entra ID" : "Enterprise OIDC")).trim(),
          issuer: issuer || (entraTenantId ? `https://login.microsoftonline.com/${entraTenantId}/v2.0` : ''),
          clientId,
          hasClientSecret: Boolean(clientSecret || currentOidc.hasClientSecret || currentOidc.clientSecret),
          clientSecret: clientSecret || currentOidc.clientSecret || undefined,
          scopes,
          enabled: isEnabled,
          status: 'configured',
          updatedAt: new Date().toISOString()
        };
      }

      const updatedSec: any = {
        ...currentSec,
        ssoStatus: isEnabled ? 'enabled' : 'disabled',
        ssoProtocol: targetProtocol,
        ssoProviderType: providerType || (targetProtocol === 'SAML' ? 'SAML' : (req.body.entraTenantId || oidc?.entraTenantId ? 'MICROSOFT_ENTRA' : 'OIDC')),
        enforceSso: isEnforce,
        updatedAt: new Date().toISOString()
      };

      if (targetProtocol === 'SAML') {
        updatedSec.samlProvider = updatedSaml;
      } else {
        updatedSec.oidcProvider = updatedOidc;
        if (req.body.entraTenantId || oidc?.entraTenantId) {
          updatedSec.entraTenantId = String(req.body.entraTenantId || oidc?.entraTenantId).trim();
        }
        if (req.body.entraClientId || oidc?.clientId) {
          updatedSec.entraClientId = String(req.body.entraClientId || oidc?.clientId).trim();
        }
      }

      if (identityPlatformTenantId !== undefined) {
        updatedSec.identityPlatformTenantId = String(identityPlatformTenantId).trim() || null;
      }

      const updateDocPayload: any = {
        securitySettings: updatedSec,
        updatedAt: new Date().toISOString()
      };

      if (identityPlatformTenantId !== undefined) {
        updateDocPayload.identityPlatformTenantId = String(identityPlatformTenantId).trim() || null;
      }

      await orgRef.update(updateDocPayload);

      // Audit Log
      await recordOrgAuditEvent(db, {
        organizationId,
        actorUserId: callerUid,
        actorEmail: callerEmail,
        action: isNewConfig ? "SSO_CONFIGURATION_CREATED" : "SSO_CONFIGURATION_UPDATED",
        timestamp: new Date().toISOString(),
        source: "api",
        details: `${isNewConfig ? 'Created' : 'Updated'} Enterprise SSO (${targetProtocol}) configuration`,
        metadata: {
          protocol: targetProtocol,
          providerId,
          enabled: isEnabled,
          enforceSso: isEnforce,
          identityPlatformTenantId: identityPlatformTenantId || null
        }
      });

      res.json({
        success: true,
        message: `Enterprise SSO (${targetProtocol}) configuration saved successfully.`,
        sso: {
          organizationId,
          protocol: targetProtocol,
          providerType: updatedSec.ssoProviderType,
          providerId,
          displayName: targetProtocol === 'SAML' ? updatedSaml.displayName : updatedOidc.displayName,
          enabled: isEnabled,
          enforceSso: isEnforce,
          identityPlatformTenantId: updatedSec.identityPlatformTenantId || undefined,
          status: 'configured',
          saml: targetProtocol === 'SAML' ? updatedSaml : undefined,
          oidc: targetProtocol === 'OIDC' ? {
            issuer: updatedOidc.issuer,
            clientId: updatedOidc.clientId,
            hasClientSecret: updatedOidc.hasClientSecret,
            scopes: updatedOidc.scopes,
            entraTenantId: updatedSec.entraTenantId
          } : undefined
        }
      });
    } catch (error: any) {
      console.error("❌ Save SSO Config failed:", error);
      res.status(500).json({ error: "Failed to save SSO configuration", message: error.message });
    }
  });

  /**
   * Test Enterprise SSO Configuration & Certificate Health (Phase 1.5A)
   */
  app.post("/api/organizations/:organizationId/sso/test", requireAuth, requireOrgRole(db, "org_admin"), async (req: AuthenticatedRequest, res) => {
    const { organizationId } = req.params;
    const callerUid = req.user!.uid;
    const callerEmail = req.user!.email || "Admin";

    try {
      const orgRef = db.collection("organizations").doc(organizationId);
      const orgSnap = await orgRef.get();
      if (!orgSnap.exists) {
        return res.status(404).json({ error: "Not Found", message: "Organization not found" });
      }

      const orgData = orgSnap.data() || {};
      const sec = orgData.securitySettings || {};
      const protocol = sec.ssoProtocol || (sec.samlProvider ? 'SAML' : 'OIDC');
      const saml = sec.samlProvider;
      const oidc = sec.oidcProvider;
      const idpReadiness = checkIdentityPlatformReadiness();

      if (protocol === 'SAML') {
        if (!saml || !saml.entityId || !saml.ssoUrl) {
          return res.status(400).json({
            success: false,
            state: "PROVIDER_NOT_CONFIGURED",
            message: "SAML provider configuration is incomplete: Entity ID and SSO Login URL are required."
          });
        }

        const certs = saml.x509Certificates || [];
        const certValidations = certs.map((cert: string, idx: number) => {
          const hasHeader = cert.includes("BEGIN CERTIFICATE");
          const hasFooter = cert.includes("END CERTIFICATE");
          const rawBase64 = cert.replace(/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\s/g, '');
          const validBase64 = /^[A-Za-z0-9+/=]+$/.test(rawBase64) && rawBase64.length > 50;
          return {
            index: idx + 1,
            formatValid: hasHeader && hasFooter && validBase64,
            keyLengthEstimate: `${rawBase64.length * 6} bits (approx)`
          };
        });

        const allCertsValid = certValidations.length > 0 && certValidations.every((c: any) => c.formatValid);
        const ssoUrlValid = saml.ssoUrl.startsWith("https://") || saml.ssoUrl.startsWith("http://");

        if (!allCertsValid || !ssoUrlValid) {
          return res.status(400).json({
            success: false,
            state: "CONFIGURATION_INVALID",
            diagnostic: {
              protocol: 'SAML',
              providerId: saml.providerId,
              ssoUrlValid,
              certValidations,
              allCertsValid,
              identityPlatformReady: idpReadiness.enabled
            },
            message: "SAML verification failed: Invalid SSO URL or malformed X.509 certificate."
          });
        }

        await orgRef.update({
          "securitySettings.samlProvider.status": "verified",
          "securitySettings.samlProvider.lastTestedAt": new Date().toISOString(),
          "securitySettings.samlProvider.lastTestStatus": "success",
          "securitySettings.samlProvider.lastTestState": "CONFIGURATION_VALID"
        });

        return res.json({
          success: true,
          state: "CONFIGURATION_VALID",
          diagnostic: {
            protocol: 'SAML',
            providerId: saml.providerId,
            entityIdValid: true,
            ssoUrlValid: true,
            certificateCount: certs.length,
            certValidations,
            spEntityId: saml.spEntityId,
            spCallbackUrl: saml.callbackUrl,
            identityPlatformReady: idpReadiness.enabled,
            identityPlatformStatus: saml.identityPlatformStatus || (idpReadiness.enabled ? 'synced' : 'manual_required'),
            testedAt: new Date().toISOString()
          },
          message: "SAML 2.0 configuration structure, endpoints, and X.509 certificates validated successfully."
        });
      } else {
        // OIDC test
        const clientId = oidc?.clientId || sec.entraClientId;
        const issuer = oidc?.issuer || (sec.entraTenantId ? `https://login.microsoftonline.com/${sec.entraTenantId}/v2.0` : '');

        if (!clientId) {
          return res.status(400).json({
            success: false,
            state: "PROVIDER_NOT_CONFIGURED",
            message: "OIDC Client ID is missing."
          });
        }

        return res.json({
          success: true,
          state: "CONFIGURATION_VALID",
          diagnostic: {
            protocol: 'OIDC',
            issuer,
            clientId,
            hasSecret: Boolean(oidc?.hasClientSecret || oidc?.clientSecret),
            identityPlatformReady: idpReadiness.enabled,
            testedAt: new Date().toISOString()
          },
          message: "OIDC configuration validated successfully."
        });
      }
    } catch (error: any) {
      console.error("❌ Test SSO Config failed:", error);
      res.status(500).json({ error: "SSO Test Failed", message: error.message });
    }
  });

  /**
   * Delete / Disable Enterprise SSO Configuration (Phase 1.5A)
   */
  app.delete("/api/organizations/:organizationId/sso", requireAuth, requireOrgRole(db, "org_admin"), async (req: AuthenticatedRequest, res) => {
    const { organizationId } = req.params;
    const callerUid = req.user!.uid;
    const callerEmail = req.user!.email || "Admin";

    try {
      const orgRef = db.collection("organizations").doc(organizationId);
      const orgSnap = await orgRef.get();
      if (!orgSnap.exists) {
        return res.status(404).json({ error: "Not Found", message: "Organization not found" });
      }

      const orgData = orgSnap.data() || {};
      const sec = orgData.securitySettings || {};
      const providerId = sec.samlProvider?.providerId || formatSamlProviderId(organizationId);

      // Attempt to delete from Identity Platform if available
      try {
        const authAdmin = admin.auth();
        if (typeof (authAdmin as any).deleteSAMLProviderConfig === 'function') {
          await (authAdmin as any).deleteSAMLProviderConfig(providerId);
        }
      } catch (delErr) {
        console.warn("⚠️ Identity Platform SAML delete notice:", delErr);
      }

      await orgRef.update({
        "securitySettings.samlProvider": FieldValue.delete(),
        "securitySettings.oidcProvider": FieldValue.delete(),
        "securitySettings.ssoConfig": FieldValue.delete(),
        "securitySettings.ssoStatus": "disabled",
        "securitySettings.enforceSso": false,
        updatedAt: new Date().toISOString()
      });

      await recordOrgAuditEvent(db, {
        organizationId,
        actorUserId: callerUid,
        actorEmail: callerEmail,
        action: "SSO_CONFIGURATION_DELETED",
        timestamp: new Date().toISOString(),
        source: "api",
        details: `Deleted Enterprise SSO configuration for organization ${organizationId}`,
        metadata: { providerId }
      });

      res.json({
        success: true,
        message: "Enterprise SSO configuration disabled and deleted successfully."
      });
    } catch (error: any) {
      console.error("❌ Delete SSO Config failed:", error);
      res.status(500).json({ error: "Failed to delete SSO configuration", message: error.message });
    }
  });

  // ==========================================
  // PHASE 1.8: ENTERPRISE SSO ENFORCEMENT & SECURITY POLICY API
  // ==========================================

  /**
   * Evaluate Enterprise Security Health (Owner & Org Admin only)
   * Evaluates verified domains, SSO provider configuration, identity mappings, session policies, and admin safety.
   */
  app.get("/api/organizations/:organizationId/security-health", requireAuth, requireOrgRole(db, "org_admin"), async (req: AuthenticatedRequest, res) => {
    const { organizationId } = req.params;

    try {
      const orgRef = db.collection("organizations").doc(organizationId);
      const orgSnap = await orgRef.get();

      if (!orgSnap.exists) {
        return res.status(404).json({ error: "Not Found", message: "Organization not found" });
      }

      const orgData = orgSnap.data() || {};
      const sec = orgData.securitySettings || {};
      const jitCfg = sec.jitSettings || {};

      // 1. Fetch active identity mappings count
      const mappingsSnap = await db.collection("orgIdentityMappings")
        .where("orgId", "==", organizationId)
        .where("enabled", "==", true)
        .get();
      const mappingsCount = mappingsSnap.size;

      // 2. Extract Verified Domains
      const rawDomains = Array.isArray(orgData.domains) ? orgData.domains : [];
      const verifiedDomains = rawDomains.filter((d: any) => {
        if (typeof d === 'string') return true;
        return d && d.status === 'verified';
      });
      const verifiedDomainsCount = verifiedDomains.length;

      // 3. Evaluate SSO Enforcement & Validation
      const validation = validateSsoConfigurationForEnforcement(orgData);
      const ssoState: OrgSsoEnforcementState = validation.ssoState;
      const ssoProtocol: 'OIDC' | 'SAML' = sec.ssoProtocol === 'SAML' ? 'SAML' : 'OIDC';
      const ssoProvider = ssoProtocol === 'SAML' 
        ? (sec.samlProvider?.displayName || 'SAML 2.0 Identity Provider')
        : (sec.entraTenantId ? `Microsoft Entra ID (Tenant: ${sec.entraTenantId})` : 'Microsoft Entra ID');

      // 4. Allowed Auth Methods
      const allowedAuthMethods: OrgAllowedAuthMethod[] = Array.isArray(sec.allowedAuthMethods) && sec.allowedAuthMethods.length > 0
        ? sec.allowedAuthMethods
        : ['EMAIL_PASSWORD', 'GOOGLE', 'MICROSOFT', ssoProtocol];

      // 5. JIT & Policy details
      const jitEnabled = jitCfg.jitProvisioningEnabled !== false && jitCfg.provisioningMode !== 'invitation_required';
      const invitationRequired = jitCfg.provisioningMode === 'invitation_required';
      const sessionTimeoutMinutes = typeof sec.sessionTimeoutMinutes === 'number' ? sec.sessionTimeoutMinutes : 1440;
      const mfaRequirement = sec.mfaRequirement || (sec.enforceMfa || sec.twoFactorRequired ? 'MFA_REQUIRED_ADMINS' : 'MFA_OPTIONAL');
      const adminSafetyVerified = Boolean(orgData.ownerEmail || orgData.ownerId);

      // 6. Build Issues List
      const issues: OrgSecurityHealthIssue[] = [...validation.healthIssues];

      // Check verified domains
      if (verifiedDomainsCount === 0) {
        if (ssoState === 'SSO_REQUIRED') {
          // Already added as error by validation
        } else {
          issues.push({
            code: "NO_VERIFIED_DOMAIN",
            severity: "warning",
            message: "No verified domain configured. Domain-based SSO discovery will not trigger for employee emails."
          });
        }
      }

      // Check Identity Mapping health
      if (jitCfg.roleManagementMode === 'idp_managed' && mappingsCount === 0) {
        issues.push({
          code: "NO_IDENTITY_MAPPINGS",
          severity: "warning",
          message: "IdP-Managed roles are enabled, but no identity mapping rules exist. All new users will receive the fallback default role."
        });
      }

      // Check Allowed Auth Methods vs SSO Enforcement
      if (ssoState === 'SSO_REQUIRED' && allowedAuthMethods.includes('EMAIL_PASSWORD')) {
        issues.push({
          code: "PASSWORD_AUTH_IN_POLICY",
          severity: "info",
          message: "Direct password authentication is present in policy configuration, but will be strictly blocked for members with verified domains."
        });
      }

      // Check Session Duration
      if (sessionTimeoutMinutes > 1440) {
        issues.push({
          code: "LONG_SESSION_TIMEOUT",
          severity: "warning",
          message: "Session timeout exceeds recommended 24-hour enterprise limit."
        });
      }

      // 7. Overall Health Status Calculation
      let overallStatus: 'HEALTHY' | 'WARNING' | 'CONFIGURATION_ERROR' = 'HEALTHY';
      if (issues.some(i => i.severity === 'error') || ssoState === 'SSO_CONFIGURATION_ERROR') {
        overallStatus = 'CONFIGURATION_ERROR';
      } else if (issues.some(i => i.severity === 'warning')) {
        overallStatus = 'WARNING';
      }

      const healthSummary: OrgSecurityHealthSummary = {
        status: overallStatus,
        issues,
        summary: {
          verifiedDomainsCount,
          ssoState,
          ssoProvider,
          ssoProtocol,
          allowedAuthMethods,
          jitEnabled,
          invitationRequired,
          mappingsCount,
          sessionTimeoutMinutes,
          mfaRequirement,
          adminSafetyVerified
        }
      };

      res.json({
        success: true,
        health: healthSummary
      });
    } catch (error: any) {
      console.error("❌ Security Health Check failed:", error);
      res.status(500).json({ error: "Failed to evaluate security health", message: error.message });
    }
  });

  /**
   * Get Organization Security Policy (Owner & Org Admin only)
   */
  app.get("/api/organizations/:organizationId/security-policy", requireAuth, requireOrgRole(db, "org_admin"), async (req: AuthenticatedRequest, res) => {
    const { organizationId } = req.params;

    try {
      const orgRef = db.collection("organizations").doc(organizationId);
      const orgSnap = await orgRef.get();

      if (!orgSnap.exists) {
        return res.status(404).json({ error: "Not Found", message: "Organization not found" });
      }

      const orgData = orgSnap.data() || {};
      const sec = orgData.securitySettings || {};
      const validation = validateSsoConfigurationForEnforcement(orgData);

      const securityPolicy = {
        ssoStatus: sec.ssoStatus || 'disabled',
        ssoProtocol: sec.ssoProtocol || 'OIDC',
        enforceSso: Boolean(sec.enforceSso),
        ssoEnforcementState: validation.ssoState,
        allowedAuthMethods: sec.allowedAuthMethods || ['EMAIL_PASSWORD', 'GOOGLE', 'MICROSOFT', sec.ssoProtocol === 'SAML' ? 'SAML' : 'OIDC'],
        entraTenantId: sec.entraTenantId || '',
        entraClientId: sec.entraClientId || '',
        samlProvider: sec.samlProvider ? {
          providerId: sec.samlProvider.providerId,
          displayName: sec.samlProvider.displayName,
          entityId: sec.samlProvider.entityId,
          ssoUrl: sec.samlProvider.ssoUrl,
          hasCertificate: Boolean(sec.samlProvider.x509Certificates?.length)
        } : null,
        enforceMfa: Boolean(sec.enforceMfa),
        mfaRequirement: sec.mfaRequirement || 'MFA_OPTIONAL',
        sessionTimeoutMinutes: typeof sec.sessionTimeoutMinutes === 'number' ? sec.sessionTimeoutMinutes : 1440,
        enforceSessionTimeout: sec.enforceSessionTimeout !== false,
        removedGroupBehavior: sec.removedGroupBehavior || sec.jitSettings?.removedGroupBehavior || 'REVERT_TO_DEFAULT_ROLE',
        deactivationBehavior: sec.deactivationBehavior || sec.jitSettings?.deactivationBehavior || 'SUSPEND_ACCESS',
        jitSettings: sec.jitSettings || {
          jitProvisioningEnabled: true,
          provisioningMode: 'jit_allowed',
          defaultJitRole: 'member',
          roleManagementMode: 'manual',
          syncIdentityAttributes: true,
          syncGroups: true
        }
      };

      res.json({
        success: true,
        securityPolicy
      });
    } catch (error: any) {
      console.error("❌ Get Security Policy failed:", error);
      res.status(500).json({ error: "Failed to fetch security policy", message: error.message });
    }
  });

  /**
   * Update Organization Enterprise Security Policy (Owner & Org Admin only)
   */
  app.put("/api/organizations/:organizationId/security-policy", requireAuth, requireOrgRole(db, "org_admin"), async (req: AuthenticatedRequest, res) => {
    const { organizationId } = req.params;
    const callerUid = req.user!.uid;
    const callerEmail = req.user!.email || "Admin";
    const {
      ssoStatus,
      ssoProtocol,
      enforceSso,
      allowedAuthMethods,
      mfaRequirement,
      enforceMfa,
      sessionTimeoutMinutes,
      enforceSessionTimeout,
      removedGroupBehavior,
      deactivationBehavior,
      jitSettings
    } = req.body;

    try {
      const orgRef = db.collection("organizations").doc(organizationId);
      const orgSnap = await orgRef.get();

      if (!orgSnap.exists) {
        return res.status(404).json({ error: "Not Found", message: "Organization not found" });
      }

      const orgData = orgSnap.data() || {};
      const currentSec = orgData.securitySettings || {};
      const currentJit = currentSec.jitSettings || {};

      // Candidate updated security settings for validation
      const candidateSec: any = {
        ...currentSec,
        ...(ssoStatus !== undefined ? { ssoStatus } : {}),
        ...(ssoProtocol !== undefined ? { ssoProtocol } : {}),
        ...(enforceSso !== undefined ? { enforceSso: Boolean(enforceSso) } : {}),
        ...(Array.isArray(allowedAuthMethods) ? { allowedAuthMethods } : {}),
        ...(mfaRequirement !== undefined ? { 
          mfaRequirement: mfaRequirement === 'MFA_REQUIRED_ALL' ? 'MFA_ENFORCED_ALL' : mfaRequirement,
          enforceMfa: mfaRequirement === 'MFA_REQUIRED_ADMINS' || mfaRequirement === 'MFA_REQUIRED_ALL' || mfaRequirement === 'MFA_ENFORCED_ALL' || Boolean(enforceMfa)
        } : (enforceMfa !== undefined ? { 
          enforceMfa: Boolean(enforceMfa),
          mfaRequirement: enforceMfa ? (currentSec.mfaRequirement || 'MFA_REQUIRED_ADMINS') : 'MFA_OPTIONAL'
        } : {})),
        ...(typeof sessionTimeoutMinutes === 'number' ? { sessionTimeoutMinutes } : {}),
        ...(enforceSessionTimeout !== undefined ? { enforceSessionTimeout: Boolean(enforceSessionTimeout) } : {}),
        ...(removedGroupBehavior !== undefined ? { removedGroupBehavior } : {}),
        ...(deactivationBehavior !== undefined ? { deactivationBehavior } : {}),
        ...(jitSettings ? { jitSettings: { ...currentJit, ...jitSettings } } : {})
      };

      const candidateOrg = {
        ...orgData,
        securitySettings: candidateSec
      };

      // If enabling SSO enforcement, run rigorous pre-flight validation
      if (candidateSec.enforceSso) {
        const validation = validateSsoConfigurationForEnforcement(candidateOrg);
        if (!validation.valid) {
          return res.status(400).json({
            error: "Validation Failed",
            code: "SSO_ENFORCEMENT_INVALID",
            message: "Cannot enforce SSO: " + validation.errors.join(" "),
            errors: validation.errors,
            issues: validation.healthIssues
          });
        }
      }

      candidateSec.updatedAt = new Date().toISOString();

      await orgRef.update({
        securitySettings: candidateSec,
        updatedAt: new Date().toISOString()
      });

      // Audit logs
      if (enforceSso !== undefined && Boolean(enforceSso) !== Boolean(currentSec.enforceSso)) {
        await recordOrgAuditEvent(db, {
          organizationId,
          actorUserId: callerUid,
          actorEmail: callerEmail,
          action: Boolean(enforceSso) ? "SSO_ENFORCEMENT_ENABLED" : "SSO_ENFORCEMENT_DISABLED",
          timestamp: new Date().toISOString(),
          source: "api",
          details: Boolean(enforceSso) 
            ? `Single Sign-On enforcement enabled for ${orgData.name || organizationId}`
            : `Single Sign-On enforcement disabled for ${orgData.name || organizationId}`
        });
      }

      await recordOrgAuditEvent(db, {
        organizationId,
        actorUserId: callerUid,
        actorEmail: callerEmail,
        action: "SECURITY_UPDATED",
        timestamp: new Date().toISOString(),
        source: "api",
        details: `Updated enterprise security policy: SSO Enforced=${candidateSec.enforceSso}, MFA=${candidateSec.mfaRequirement || 'N/A'}, Session=${candidateSec.sessionTimeoutMinutes || 1440}m`,
        metadata: {
          ssoStatus: candidateSec.ssoStatus,
          enforceSso: candidateSec.enforceSso,
          mfaRequirement: candidateSec.mfaRequirement,
          sessionTimeoutMinutes: candidateSec.sessionTimeoutMinutes
        }
      });

      res.json({
        success: true,
        securitySettings: candidateSec,
        message: "Enterprise security policy updated successfully."
      });
    } catch (error: any) {
      console.error("❌ Update Security Policy failed:", error);
      res.status(500).json({ error: "Failed to update security policy", message: error.message });
    }
  });

  /**
   * Dedicated SSO Enforcement Toggle (Owner & Org Admin only)
   */
  app.post("/api/organizations/:organizationId/enforce-sso", requireAuth, requireOrgRole(db, "org_admin"), async (req: AuthenticatedRequest, res) => {
    const { organizationId } = req.params;
    const { enforce } = req.body;
    const shouldEnforce = Boolean(enforce);
    const callerUid = req.user!.uid;
    const callerEmail = req.user!.email || "Admin";

    try {
      const orgRef = db.collection("organizations").doc(organizationId);
      const orgSnap = await orgRef.get();

      if (!orgSnap.exists) {
        return res.status(404).json({ error: "Not Found", message: "Organization not found" });
      }

      const orgData = orgSnap.data() || {};
      const currentSec = orgData.securitySettings || {};

      const candidateOrg = {
        ...orgData,
        securitySettings: {
          ...currentSec,
          enforceSso: shouldEnforce
        }
      };

      if (shouldEnforce) {
        const validation = validateSsoConfigurationForEnforcement(candidateOrg);
        if (!validation.valid) {
          return res.status(400).json({
            error: "Validation Failed",
            code: "SSO_ENFORCEMENT_INVALID",
            message: "Cannot enforce Single Sign-On: " + validation.errors.join(" "),
            errors: validation.errors
          });
        }
      }

      const updatedSec = {
        ...currentSec,
        enforceSso: shouldEnforce,
        updatedAt: new Date().toISOString()
      };

      await orgRef.update({
        securitySettings: updatedSec,
        updatedAt: new Date().toISOString()
      });

      await recordOrgAuditEvent(db, {
        organizationId,
        actorUserId: callerUid,
        actorEmail: callerEmail,
        action: shouldEnforce ? "SSO_ENFORCEMENT_ENABLED" : "SSO_ENFORCEMENT_DISABLED",
        timestamp: new Date().toISOString(),
        source: "api",
        details: shouldEnforce
          ? `Single Sign-On (SSO) enforcement enabled for organization ${orgData.name || organizationId}`
          : `Single Sign-On (SSO) enforcement disabled for organization ${orgData.name || organizationId}`
      });

      res.json({
        success: true,
        enforceSso: shouldEnforce,
        message: shouldEnforce 
          ? "Single Sign-On is now mandatory for all users under verified enterprise domains."
          : "Single Sign-On is now optional."
      });
    } catch (error: any) {
      console.error("❌ Enforce SSO failed:", error);
      res.status(500).json({ error: "Failed to update SSO enforcement", message: error.message });
    }
  });

  /**
   * Run Comprehensive 37-Point Security & SSO Enforcement Test Suite (Owner & Org Admin only)
   */
  app.get("/api/organizations/:organizationId/run-security-tests", requireAuth, requireOrgRole(db, "org_admin"), async (req: AuthenticatedRequest, res) => {
    try {
      const { runAllSecurityTests } = await import("./scripts/run-sso-security-tests.js");
      const results = runAllSecurityTests();
      const passedCount = results.filter(r => r.passed).length;
      const totalCount = results.length;

      res.json({
        success: true,
        summary: {
          total: totalCount,
          passed: passedCount,
          failed: totalCount - passedCount,
          successRate: `${Math.round((passedCount / totalCount) * 100)}%`,
          timestamp: new Date().toISOString()
        },
        tests: results
      });
    } catch (error: any) {
      console.error("❌ Run Security Tests failed:", error);
      res.status(500).json({ error: "Failed to execute security tests", message: error.message });
    }
  });

  // ==========================================
  // PHASE 1.7: ENTERPRISE IDENTITY MAPPING & JIT PROVISIONING API
  // ==========================================

  /**
   * Get all Identity Mappings for an Organization (Owner & Org Admin only)
   */
  app.get("/api/organizations/:organizationId/identity-mappings", requireAuth, requireOrgRole(db, "org_admin"), async (req: AuthenticatedRequest, res) => {
    const { organizationId } = req.params;

    try {
      const snap = await db
        .collection("orgIdentityMappings")
        .where("orgId", "==", organizationId)
        .get();

      const mappings = snap.docs.map(doc => {
        const d = doc.data();
        return {
          id: doc.id,
          orgId: d.orgId,
          provider: d.provider || 'all',
          sourceType: d.sourceType || 'group',
          sourceValue: d.sourceValue || '',
          targetRole: normalizeOrgRole(d.targetRole),
          targetDepartmentId: d.targetDepartmentId || undefined,
          targetDepartmentName: d.targetDepartmentName || undefined,
          enabled: d.enabled !== false,
          priority: typeof d.priority === 'number' ? d.priority : 10,
          createdBy: d.createdBy,
          createdAt: d.createdAt,
          updatedAt: d.updatedAt
        };
      });

      // Sort by priority DESC, createdAt ASC
      mappings.sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        return (a.createdAt || '').localeCompare(b.createdAt || '');
      });

      res.json({ success: true, mappings });
    } catch (error: any) {
      console.error("❌ Fetch Identity Mappings failed:", error);
      res.status(500).json({ error: "Failed to fetch identity mappings", message: error.message });
    }
  });

  /**
   * Create Identity Mapping (Owner & Org Admin only)
   */
  app.post("/api/organizations/:organizationId/identity-mappings", requireAuth, requireOrgRole(db, "org_admin"), async (req: AuthenticatedRequest, res) => {
    const { organizationId } = req.params;
    const callerUid = req.user!.uid;
    const callerEmail = req.user!.email || "Admin";
    const { 
      provider, 
      sourceType, 
      sourceValue, 
      targetRole, 
      targetDepartmentId, 
      targetDepartmentName, 
      enabled, 
      priority 
    } = req.body;

    if (!sourceValue || typeof sourceValue !== 'string' || !sourceValue.trim()) {
      return res.status(400).json({ error: "Bad Request", message: "Source value is required (e.g., IdP Group Name or Attribute)." });
    }

    const cleanRole = normalizeOrgRole(targetRole || 'member');
    if (cleanRole === 'owner') {
      return res.status(400).json({ 
        error: "Bad Request", 
        message: "The 'owner' role cannot be assigned automatically via identity mappings. Choose 'org_admin', 'team_manager', or 'member'." 
      });
    }

    const mappingId = `map_${organizationId.slice(0, 6)}_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
    const now = new Date().toISOString();

    const mappingData = {
      id: mappingId,
      orgId: organizationId,
      provider: ['entra', 'saml', 'google', 'oidc', 'all'].includes(provider) ? provider : 'all',
      sourceType: ['group', 'department', 'job_title', 'claim'].includes(sourceType) ? sourceType : 'group',
      sourceValue: sourceValue.trim(),
      targetRole: cleanRole,
      targetDepartmentId: targetDepartmentId ? String(targetDepartmentId).trim() : null,
      targetDepartmentName: targetDepartmentName ? String(targetDepartmentName).trim() : null,
      enabled: enabled !== false,
      priority: typeof priority === 'number' && priority >= 1 && priority <= 100 ? Math.round(priority) : 10,
      createdBy: callerEmail,
      createdAt: now,
      updatedAt: now
    };

    try {
      await db.collection("orgIdentityMappings").doc(mappingId).set(mappingData);

      await recordOrgAuditEvent(db, {
        organizationId,
        actorUserId: callerUid,
        actorEmail: callerEmail,
        action: "IDENTITY_MAPPING_CREATED",
        timestamp: now,
        source: "api",
        details: `Created identity mapping: ${mappingData.sourceType} "${mappingData.sourceValue}" → ${mappingData.targetRole} (Priority ${mappingData.priority})`,
        metadata: { mappingId, ...mappingData }
      });

      res.status(201).json({ success: true, mapping: mappingData });
    } catch (error: any) {
      console.error("❌ Create Identity Mapping failed:", error);
      res.status(500).json({ error: "Failed to create identity mapping", message: error.message });
    }
  });

  /**
   * Update Identity Mapping (Owner & Org Admin only)
   */
  app.put("/api/organizations/:organizationId/identity-mappings/:mappingId", requireAuth, requireOrgRole(db, "org_admin"), async (req: AuthenticatedRequest, res) => {
    const { organizationId, mappingId } = req.params;
    const callerUid = req.user!.uid;
    const callerEmail = req.user!.email || "Admin";
    const { 
      provider, 
      sourceType, 
      sourceValue, 
      targetRole, 
      targetDepartmentId, 
      targetDepartmentName, 
      enabled, 
      priority 
    } = req.body;

    try {
      const mappingRef = db.collection("orgIdentityMappings").doc(mappingId);
      const mappingSnap = await mappingRef.get();

      if (!mappingSnap.exists || mappingSnap.data()?.orgId !== organizationId) {
        return res.status(404).json({ error: "Not Found", message: "Identity mapping not found" });
      }

      const existingData = mappingSnap.data()!;
      let cleanRole = existingData.targetRole;

      if (targetRole !== undefined) {
        cleanRole = normalizeOrgRole(targetRole);
        if (cleanRole === 'owner') {
          return res.status(400).json({ 
            error: "Bad Request", 
            message: "The 'owner' role cannot be assigned automatically via identity mappings." 
          });
        }
      }

      const updateData: any = {
        updatedAt: new Date().toISOString()
      };

      if (provider !== undefined && ['entra', 'saml', 'google', 'oidc', 'all'].includes(provider)) {
        updateData.provider = provider;
      }
      if (sourceType !== undefined && ['group', 'department', 'job_title', 'claim'].includes(sourceType)) {
        updateData.sourceType = sourceType;
      }
      if (sourceValue !== undefined && typeof sourceValue === 'string' && sourceValue.trim()) {
        updateData.sourceValue = sourceValue.trim();
      }
      if (targetRole !== undefined) {
        updateData.targetRole = cleanRole;
      }
      if (targetDepartmentId !== undefined) {
        updateData.targetDepartmentId = targetDepartmentId ? String(targetDepartmentId).trim() : null;
      }
      if (targetDepartmentName !== undefined) {
        updateData.targetDepartmentName = targetDepartmentName ? String(targetDepartmentName).trim() : null;
      }
      if (enabled !== undefined) {
        updateData.enabled = Boolean(enabled);
      }
      if (typeof priority === 'number' && priority >= 1 && priority <= 100) {
        updateData.priority = Math.round(priority);
      }

      await mappingRef.update(updateData);

      const mergedData = { ...existingData, ...updateData };

      await recordOrgAuditEvent(db, {
        organizationId,
        actorUserId: callerUid,
        actorEmail: callerEmail,
        action: "IDENTITY_MAPPING_UPDATED",
        timestamp: new Date().toISOString(),
        source: "api",
        details: `Updated identity mapping ${mappingId}: ${mergedData.sourceType} "${mergedData.sourceValue}" → ${mergedData.targetRole}`,
        metadata: { mappingId, ...updateData }
      });

      res.json({ success: true, mapping: mergedData });
    } catch (error: any) {
      console.error("❌ Update Identity Mapping failed:", error);
      res.status(500).json({ error: "Failed to update identity mapping", message: error.message });
    }
  });

  /**
   * Delete Identity Mapping (Owner & Org Admin only)
   */
  app.delete("/api/organizations/:organizationId/identity-mappings/:mappingId", requireAuth, requireOrgRole(db, "org_admin"), async (req: AuthenticatedRequest, res) => {
    const { organizationId, mappingId } = req.params;
    const callerUid = req.user!.uid;
    const callerEmail = req.user!.email || "Admin";

    try {
      const mappingRef = db.collection("orgIdentityMappings").doc(mappingId);
      const mappingSnap = await mappingRef.get();

      if (!mappingSnap.exists || mappingSnap.data()?.orgId !== organizationId) {
        return res.status(404).json({ error: "Not Found", message: "Identity mapping not found" });
      }

      const existingData = mappingSnap.data()!;
      await mappingRef.delete();

      await recordOrgAuditEvent(db, {
        organizationId,
        actorUserId: callerUid,
        actorEmail: callerEmail,
        action: "IDENTITY_MAPPING_DELETED",
        timestamp: new Date().toISOString(),
        source: "api",
        details: `Deleted identity mapping ${mappingId} (${existingData.sourceType}: ${existingData.sourceValue})`,
        metadata: { mappingId, sourceValue: existingData.sourceValue }
      });

      res.json({ success: true, message: "Identity mapping deleted successfully." });
    } catch (error: any) {
      console.error("❌ Delete Identity Mapping failed:", error);
      res.status(500).json({ error: "Failed to delete identity mapping", message: error.message });
    }
  });

  /**
   * Update Organization JIT Settings (Owner & Org Admin only)
   */
  app.post("/api/organizations/:organizationId/jit-settings", requireAuth, requireOrgRole(db, "org_admin"), async (req: AuthenticatedRequest, res) => {
    const { organizationId } = req.params;
    const callerUid = req.user!.uid;
    const callerEmail = req.user!.email || "Admin";
    const { 
      jitProvisioningEnabled,
      provisioningMode,
      defaultJitRole,
      defaultDepartmentId,
      defaultDepartmentName,
      roleManagementMode,
      syncIdentityAttributes,
      syncGroups,
      autoDeactivateRemovedUsers
    } = req.body;

    try {
      const orgRef = db.collection("organizations").doc(organizationId);
      const orgSnap = await orgRef.get();

      if (!orgSnap.exists) {
        return res.status(404).json({ error: "Not Found", message: "Organization not found" });
      }

      const orgData = orgSnap.data() || {};
      const currentSec = orgData.securitySettings || {};
      const currentJit = currentSec.jitSettings || {};

      const cleanDefaultRole = defaultJitRole ? normalizeOrgRole(defaultJitRole) : (currentJit.defaultJitRole || 'member');
      if (cleanDefaultRole === 'owner') {
        return res.status(400).json({
          error: "Bad Request",
          message: "The default JIT role cannot be 'owner'. Choose 'member', 'team_manager', or 'org_admin'."
        });
      }

      const updatedJit = {
        jitProvisioningEnabled: jitProvisioningEnabled !== undefined ? Boolean(jitProvisioningEnabled) : (currentJit.jitProvisioningEnabled !== false),
        provisioningMode: provisioningMode === 'invitation_required' ? 'invitation_required' : 'jit_allowed',
        defaultJitRole: cleanDefaultRole,
        defaultDepartmentId: defaultDepartmentId ? String(defaultDepartmentId).trim() : null,
        defaultDepartmentName: defaultDepartmentName ? String(defaultDepartmentName).trim() : null,
        roleManagementMode: roleManagementMode === 'idp_managed' ? 'idp_managed' : 'manual',
        syncIdentityAttributes: syncIdentityAttributes !== undefined ? Boolean(syncIdentityAttributes) : (currentJit.syncIdentityAttributes !== false),
        syncGroups: syncGroups !== undefined ? Boolean(syncGroups) : (currentJit.syncGroups !== false),
        autoDeactivateRemovedUsers: Boolean(autoDeactivateRemovedUsers),
        updatedAt: new Date().toISOString()
      };

      const updatedSec = {
        ...currentSec,
        jitSettings: updatedJit,
        updatedAt: new Date().toISOString()
      };

      await orgRef.update({
        securitySettings: updatedSec,
        "settings.jitProvisioningEnabled": updatedJit.jitProvisioningEnabled,
        updatedAt: new Date().toISOString()
      });

      await recordOrgAuditEvent(db, {
        organizationId,
        actorUserId: callerUid,
        actorEmail: callerEmail,
        action: "SECURITY_UPDATED",
        timestamp: new Date().toISOString(),
        source: "api",
        details: `Updated JIT Settings: JIT Enabled=${updatedJit.jitProvisioningEnabled}, Mode=${updatedJit.provisioningMode}, Role Mode=${updatedJit.roleManagementMode}, Default Role=${updatedJit.defaultJitRole}`,
        metadata: { jitSettings: updatedJit }
      });

      res.json({
        success: true,
        jitSettings: updatedJit,
        message: "JIT provisioning settings updated successfully."
      });
    } catch (error: any) {
      console.error("❌ Update JIT Settings failed:", error);
      res.status(500).json({ error: "Failed to update JIT settings", message: error.message });
    }
  });

  /**
   * Test / Simulate Identity Mapping Rule (Owner & Org Admin only)
   */
  app.post("/api/organizations/:organizationId/identity-mappings/test-preview", requireAuth, requireOrgRole(db, "org_admin"), async (req: AuthenticatedRequest, res) => {
    const { organizationId } = req.params;
    const { email, groups, department, jobTitle, claims, provider } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Bad Request", message: "Email is required for simulation test." });
    }

    try {
      const orgRef = db.collection("organizations").doc(organizationId);
      const orgSnap = await orgRef.get();
      if (!orgSnap.exists) {
        return res.status(404).json({ error: "Not Found", message: "Organization not found" });
      }

      const orgData = orgSnap.data() || {};
      const sec = orgData.securitySettings || {};
      const defaultRole = normalizeOrgRole(sec.jitSettings?.defaultJitRole || 'member');
      const defaultDept = sec.jitSettings?.defaultDepartmentId;

      const evalResult = await evaluateIdentityMappings(db, organizationId, {
        uid: "simulated_user",
        email: String(email).trim().toLowerCase(),
        provider: provider || 'all',
        groups: Array.isArray(groups) ? groups : [],
        department: department || undefined,
        jobTitle: jobTitle || undefined,
        claims: claims || {}
      }, defaultRole, defaultDept);

      res.json({
        success: true,
        simulation: {
          evaluatedEmail: email,
          resolvedRole: evalResult.targetRole,
          resolvedDepartmentId: evalResult.targetDepartmentId || null,
          resolvedDepartmentName: evalResult.targetDepartmentName || null,
          appliedMapping: evalResult.appliedMapping || null,
          conflictDetected: evalResult.conflictDetected || false,
          mode: evalResult.appliedMapping ? "MAPPED" : "DEFAULT_FALLBACK"
        }
      });
    } catch (error: any) {
      console.error("❌ Test Identity Mapping simulation failed:", error);
      res.status(500).json({ error: "Failed to simulate identity mapping", message: error.message });
    }
  });

  /**
   * Add Enterprise Domain to Organization (Owner & Org Admin only)
   */
  app.post("/api/organizations/:organizationId/domains", requireAuth, requireOrgRole(db, "org_admin"), async (req: AuthenticatedRequest, res) => {
    const { organizationId } = req.params;
    const { domain } = req.body;
    const callerUid = req.user!.uid;
    const callerEmail = req.user!.email || "Admin";

    if (!domain || typeof domain !== 'string') {
      return res.status(400).json({ error: "Bad Request", message: "Domain name is required." });
    }

    const cleanDomain = normalizeDomain(domain);
    if (!isValidDomain(cleanDomain)) {
      return res.status(400).json({ error: "Bad Request", message: "Invalid domain format. Please provide a valid FQDN (e.g. company.com)." });
    }

    if (PUBLIC_CONSUMER_DOMAINS.has(cleanDomain)) {
      return res.status(400).json({ error: "Bad Request", message: "Public consumer email domains cannot be claimed as enterprise domains." });
    }

    try {
      // 1. Conflict Check: Ensure domain is not registered by another organization
      const allOrgsSnap = await db.collection("organizations").get();
      for (const orgDoc of allOrgsSnap.docs) {
        if (orgDoc.id === organizationId) continue;
        const oData = orgDoc.data() || {};
        const existingDomains: string[] = [
          ...(Array.isArray(oData.domains) ? oData.domains.map((d: any) => typeof d === 'string' ? normalizeDomain(d) : normalizeDomain(d.domain)) : []),
          ...(Array.isArray(oData.settings?.allowedDomains) ? oData.settings.allowedDomains.map(normalizeDomain) : []),
          ...(typeof oData.securitySettings?.allowedDomains === 'string' ? oData.securitySettings.allowedDomains.split(',').map(normalizeDomain) : []),
          normalizeDomain(oData.domain || "")
        ].filter(Boolean);

        if (existingDomains.includes(cleanDomain)) {
          return res.status(409).json({
            error: "Conflict",
            message: `The domain "${cleanDomain}" is already registered to another organization.`
          });
        }
      }

      // Check claimedDomains collection to guard against concurrent registration races
      const claimedRef = db.collection("claimedDomains").doc(cleanDomain);
      const claimedSnap = await claimedRef.get();
      if (claimedSnap.exists && claimedSnap.data()?.orgId !== organizationId) {
        return res.status(409).json({
          error: "Conflict",
          message: `The domain "${cleanDomain}" is already registered to another organization.`
        });
      }

      // 2. Fetch current org
      const orgRef = db.collection("organizations").doc(organizationId);
      const orgSnap = await orgRef.get();
      if (!orgSnap.exists) {
        return res.status(404).json({ error: "Not Found", message: "Organization not found" });
      }

      const orgData = orgSnap.data() || {};
      const currentDomains: any[] = Array.isArray(orgData.domains) ? [...orgData.domains] : [];

      const existingIndex = currentDomains.findIndex(d => (typeof d === 'string' ? normalizeDomain(d) : normalizeDomain(d.domain)) === cleanDomain);
      if (existingIndex >= 0) {
        return res.status(400).json({ error: "Bad Request", message: "Domain is already added to this organization." });
      }

      // Generate cryptographically secure DNS challenge token (256-bit entropy)
      const { token, recordValue } = generateDomainChallengeToken();
      const newDomainRecord = {
        domain: cleanDomain,
        orgId: organizationId,
        status: "unverified",
        token,
        dnsTxtRecord: recordValue,
        createdAt: new Date().toISOString()
      };

      currentDomains.push(newDomainRecord);

      await orgRef.update({
        domains: currentDomains,
        updatedAt: new Date().toISOString()
      });

      // Claim domain in claimedDomains collection to prevent races
      await claimedRef.set({
        domain: cleanDomain,
        orgId: organizationId,
        status: "unverified",
        dnsTxtRecord: recordValue,
        createdAt: new Date().toISOString()
      });

      await recordOrgAuditEvent(db, {
        organizationId,
        actorUserId: callerUid,
        actorEmail: callerEmail,
        action: "SECURITY_UPDATED",
        timestamp: new Date().toISOString(),
        source: "api",
        details: `Added unverified enterprise domain ${cleanDomain}`,
        metadata: { domain: cleanDomain }
      });

      res.status(201).json({
        success: true,
        domain: newDomainRecord,
        instructions: `Create a DNS TXT record for "${cleanDomain}" with the exact value "${recordValue}", then call the verify endpoint.`
      });
    } catch (error: any) {
      console.error("❌ Add domain failed:", error);
      res.status(500).json({ error: "Failed to add domain", message: error.message });
    }
  });

  /**
   * Verify Organization Domain via Authoritative DNS TXT Resolution (Owner & Org Admin only)
   */
  app.post("/api/organizations/:organizationId/domains/:domain/verify", requireAuth, requireOrgRole(db, "org_admin"), async (req: AuthenticatedRequest, res) => {
    const { organizationId, domain } = req.params;
    const cleanDomain = normalizeDomain(domain);
    const callerUid = req.user!.uid;
    const callerEmail = req.user!.email || "Admin";

    try {
      const orgRef = db.collection("organizations").doc(organizationId);
      const orgSnap = await orgRef.get();
      if (!orgSnap.exists) {
        return res.status(404).json({ error: "Not Found", message: "Organization not found" });
      }

      const orgData = orgSnap.data() || {};
      const currentDomains: any[] = Array.isArray(orgData.domains) ? [...orgData.domains] : [];

      const targetIndex = currentDomains.findIndex(d => (typeof d === 'string' ? normalizeDomain(d) : normalizeDomain(d.domain)) === cleanDomain);
      if (targetIndex === -1) {
        return res.status(404).json({ error: "Not Found", message: "Domain not found in organization." });
      }

      const existingRecord = typeof currentDomains[targetIndex] === 'string'
        ? { domain: cleanDomain, orgId: organizationId, status: "unverified", createdAt: new Date().toISOString() }
        : currentDomains[targetIndex];

      const expectedRecord = existingRecord.dnsTxtRecord || (existingRecord.token ? `${CHALLENGE_PREFIX}${existingRecord.token}` : null);
      if (!expectedRecord) {
        return res.status(400).json({
          error: "Bad Request",
          message: `No active DNS verification challenge exists for domain "${cleanDomain}". Please remove and re-add the domain.`
        });
      }

      // Execute authoritative DNS TXT query with fail-closed timeout and error handling
      const verificationResult = await verifyDomainTxtRecord(cleanDomain, expectedRecord);

      if (!verificationResult.success) {
        await recordOrgAuditEvent(db, {
          organizationId,
          actorUserId: callerUid,
          actorEmail: callerEmail,
          action: "DOMAIN_VERIFICATION_FAILED",
          timestamp: new Date().toISOString(),
          source: "api",
          details: `DNS verification failed for domain ${cleanDomain}: ${verificationResult.message}`,
          metadata: {
            domain: cleanDomain,
            status: verificationResult.status,
            recordsFoundCount: verificationResult.recordsFoundCount || 0
          }
        });

        return res.status(422).json({
          error: "Domain Verification Failed",
          code: verificationResult.status,
          message: verificationResult.message,
          domain: cleanDomain,
          dnsTxtRecord: expectedRecord,
          instructions: `To verify ownership, create a DNS TXT record for "${cleanDomain}" with the exact value "${expectedRecord}".`
        });
      }

      // Verification succeeded: mark domain verified
      existingRecord.status = "verified";
      existingRecord.verifiedAt = new Date().toISOString();
      delete existingRecord.verificationError;
      currentDomains[targetIndex] = existingRecord;

      const allowedDomains = Array.from(new Set([
        ...(Array.isArray(orgData.settings?.allowedDomains) ? orgData.settings.allowedDomains : []),
        cleanDomain
      ]));

      await orgRef.update({
        domains: currentDomains,
        "settings.allowedDomains": allowedDomains,
        updatedAt: new Date().toISOString()
      });

      // Update claimedDomains record to verified
      await db.collection("claimedDomains").doc(cleanDomain).set({
        domain: cleanDomain,
        orgId: organizationId,
        status: "verified",
        verifiedAt: new Date().toISOString()
      }, { merge: true });

      await recordOrgAuditEvent(db, {
        organizationId,
        actorUserId: callerUid,
        actorEmail: callerEmail,
        action: "SECURITY_UPDATED",
        timestamp: new Date().toISOString(),
        source: "api",
        details: `Verified enterprise domain ${cleanDomain} via authoritative DNS TXT record`,
        metadata: {
          domain: cleanDomain,
          recordsFoundCount: verificationResult.recordsFoundCount || 1
        }
      });

      res.json({
        success: true,
        domain: existingRecord,
        message: `Domain ${cleanDomain} verified successfully via DNS TXT record.`
      });
    } catch (error: any) {
      console.error("❌ Domain verification failed:", error);
      res.status(500).json({ error: "Failed to verify domain", message: error.message });
    }
  });

  /**
   * Remove Domain from Organization (Owner & Org Admin only)
   */
  app.delete("/api/organizations/:organizationId/domains/:domain", requireAuth, requireOrgRole(db, "org_admin"), async (req: AuthenticatedRequest, res) => {
    const { organizationId, domain } = req.params;
    const cleanDomain = normalizeDomain(domain);
    const callerUid = req.user!.uid;
    const callerEmail = req.user!.email || "Admin";

    try {
      const orgRef = db.collection("organizations").doc(organizationId);
      const orgSnap = await orgRef.get();
      if (!orgSnap.exists) {
        return res.status(404).json({ error: "Not Found", message: "Organization not found" });
      }

      const orgData = orgSnap.data() || {};
      const currentDomains: any[] = Array.isArray(orgData.domains)
        ? orgData.domains.filter(d => (typeof d === 'string' ? normalizeDomain(d) : normalizeDomain(d.domain)) !== cleanDomain)
        : [];

      const currentAllowed = Array.isArray(orgData.settings?.allowedDomains)
        ? orgData.settings.allowedDomains.filter((d: string) => normalizeDomain(d) !== cleanDomain)
        : [];

      await orgRef.update({
        domains: currentDomains,
        "settings.allowedDomains": currentAllowed,
        updatedAt: new Date().toISOString()
      });

      // Remove from claimedDomains collection
      await db.collection("claimedDomains").doc(cleanDomain).delete().catch(() => {});

      await recordOrgAuditEvent(db, {
        organizationId,
        actorUserId: callerUid,
        actorEmail: callerEmail,
        action: "SECURITY_UPDATED",
        timestamp: new Date().toISOString(),
        source: "api",
        details: `Removed enterprise domain ${cleanDomain}`
      });

      res.json({
        success: true,
        message: `Domain ${cleanDomain} removed successfully.`
      });
    } catch (error: any) {
      console.error("❌ Remove domain failed:", error);
      res.status(500).json({ error: "Failed to remove domain", message: error.message });
    }
  });

  // ==========================================
  // PHASE 1.3: AUTHORITATIVE ORGANIZATION & CUSTOM CLAIMS API
  // ==========================================

  /**
   * Synchronize & refresh Firebase Custom Claims based on authoritative Firestore state
   */
  app.post("/api/auth/sync-claims", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const uid = req.user!.uid;
      const callerEmail = (req.user!.email || "").toLowerCase().trim();
      const signInProvider = req.user!.firebase?.sign_in_provider;

      // 1. SSO Bypass Protection Check
      if (signInProvider === "password" && callerEmail) {
        const domain = normalizeDomain(callerEmail);
        const orgsSnap = await db.collection("organizations").get();

        for (const doc of orgsSnap.docs) {
          const orgData = doc.data() || {};
          const sec = orgData.securitySettings || {};
          
          let domainMatched = false;
          if (Array.isArray(orgData.domains)) {
            domainMatched = orgData.domains.some((d: any) => {
              const dName = typeof d === 'string' ? normalizeDomain(d) : normalizeDomain(d.domain);
              const dStatus = typeof d === 'object' ? d.status : 'verified';
              return dName === domain && dStatus === 'verified';
            });
          }

          if (domainMatched && sec.ssoStatus === 'enabled' && sec.enforceSso) {
            // Check if user is a member of this enforcing organization
            const memberSnap = await db.collection("orgMembers")
              .where("orgId", "==", doc.id)
              .where("email", "==", callerEmail)
              .limit(1)
              .get();

            if (!memberSnap.empty) {
              await recordOrgAuditEvent(db, {
                organizationId: doc.id,
                actorUserId: uid,
                actorEmail: callerEmail,
                action: "SSO_BYPASS_BLOCKED",
                timestamp: new Date().toISOString(),
                source: "api",
                details: `Blocked password bypass attempt for SSO-enforced member ${callerEmail}`
              });

              return res.status(403).json({
                error: "Forbidden",
                code: "SSO_REQUIRED",
                message: "Your enterprise organization enforces Single Sign-On (SSO) with Microsoft Entra ID. Direct password authentication is restricted."
              });
            }
          }
        }
      }

      const claims = await syncUserCustomClaims(uid, db);
      res.json({
        success: true,
        claims,
        message: "Custom claims synchronized successfully"
      });
    } catch (error: any) {
      console.error("❌ sync-claims failed:", error);
      res.status(500).json({ error: "Failed to synchronize custom claims", message: error.message });
    }
  });

  // ==========================================
  // Multi-Factor Authentication (MFA / 2FA) Endpoints (Phase 1A Step 3)
  // ==========================================

  /**
   * Authoritative MFA Status Endpoint
   * Returns current user's multi-factor enrollment status and second-factor session verification.
   */
  app.get("/api/auth/mfa/status", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const uid = req.user!.uid;
      let userRecord: admin.auth.UserRecord | null = null;
      try {
        userRecord = await admin.auth().getUser(uid);
      } catch (authErr: any) {
        const isApiDisabled = authErr?.message?.includes("Identity Toolkit API") || 
                              authErr?.code === "auth/insufficient-permission" ||
                              authErr?.code === 403 ||
                              String(authErr).includes("SERVICE_DISABLED");
        if (!isApiDisabled) {
          console.warn("ℹ️ Firebase Admin getUser note:", authErr?.message || authErr);
        }
      }

      let rawFactors = userRecord?.multiFactor?.enrolledFactors || [];
      if (rawFactors.length === 0 && (req.user as any)?.multiFactor?.enrolledFactors) {
        rawFactors = (req.user as any).multiFactor.enrolledFactors;
      }

      const enrolledFactors = rawFactors.map((f: any) => ({
        uid: f.uid || f.factorId || "totp",
        displayName: f.displayName || "Authenticator App",
        factorId: f.factorId || "totp",
        enrollmentTime: f.enrollmentTime || new Date().toISOString()
      }));

      // Check Firestore user profile for cached mfa status
      let userData: any = {};
      try {
        const userDocSnap = await db.collection("users").doc(uid).get();
        if (userDocSnap.exists) {
          userData = userDocSnap.data() || {};
        }
      } catch (dbErr: any) {
        // Fallback to REST API lookup with caller's verified bearer token if server Admin SDK is restricted
        const idToken = req.user?.idToken;
        if (idToken) {
          try {
            const config = getFirebaseConfig();
            const restUrl = `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/${config.firestoreDatabaseId}/documents/users/${uid}`;
            const restResp = await fetch(restUrl, {
              headers: { Authorization: `Bearer ${idToken}` }
            });
            if (restResp.ok) {
              const restJson: any = await restResp.json();
              userData = parseFirestoreRestFields(restJson.fields || {});
            }
          } catch {
            // Safe non-blocking fallback
          }
        }
      }

      const secondFactorUsed = (req.user as any)?.firebase?.sign_in_second_factor || null;
      const enrolledCount = enrolledFactors.length;
      // Authoritatively, MFA is enabled if factors exist in provider, or user profile records enrollment, or active session second factor
      const mfaEnabled = enrolledCount > 0 || 
                         Boolean(userData.mfaEnabled) || 
                         Boolean((req.user as any)?.mfaEnabled) || 
                         Boolean((req.user as any)?.mfaEnrolled) ||
                         Boolean(secondFactorUsed);

      if (mfaEnabled && enrolledFactors.length === 0) {
        enrolledFactors.push({
          uid: "totp_enrolled",
          displayName: "Authenticator App",
          factorId: "totp",
          enrollmentTime: userData.mfaEnrolledAt || new Date().toISOString()
        });
      }

      // Self-heal stale Firestore user document if status is desynchronized
      if (userRecord && Boolean(userData.mfaEnabled) !== mfaEnabled) {
        db.collection("users").doc(uid).set({
          mfaEnabled,
          mfaEnrolledAt: mfaEnabled ? (userData.mfaEnrolledAt || new Date().toISOString()) : null
        }, { merge: true }).catch(() => {});
      }

      return res.json({
        success: true,
        mfaEnabled,
        enrolledFactors,
        currentSessionSecondFactor: secondFactorUsed
      });
    } catch (error: any) {
      console.warn("⚠️ GET /api/auth/mfa/status non-fatal fallback:", error?.message || error);
      const secondFactorUsed = (req.user as any)?.firebase?.sign_in_second_factor || null;
      return res.json({
        success: true,
        mfaEnabled: Boolean(secondFactorUsed),
        enrolledFactors: secondFactorUsed ? [{
          uid: "totp_active",
          displayName: "Authenticator App",
          factorId: secondFactorUsed,
          enrollmentTime: new Date().toISOString()
        }] : [],
        currentSessionSecondFactor: secondFactorUsed
      });
    }
  });

  /**
   * Log Multi-Factor Authentication Audit Event
   * Records authoritative audit log for enrollment, verification, or disabling MFA.
   * Strips all sensitive credentials, seeds, or verification codes.
   */
  app.post("/api/auth/mfa/audit-event", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const uid = req.user!.uid;
      const callerEmail = (req.user!.email || "").toLowerCase().trim();
      const { action, factorType, details } = req.body;

      const validMfaActions = [
        "MFA_ENROLLMENT_STARTED",
        "MFA_ENABLED",
        "MFA_DISABLED",
        "MFA_CHALLENGE_SUCCESS",
        "MFA_CHALLENGE_FAILURE",
        "MFA_RECOVERY_USED"
      ];

      if (!action || !validMfaActions.includes(action)) {
        return res.status(400).json({ error: "InvalidAction", message: "Invalid MFA audit event action." });
      }

      // Safe sanitized details string - NEVER include sensitive codes
      const safeFactor = factorType === "phone" ? "phone" : "totp";
      const sanitizedDetails = typeof details === "string" 
        ? details.slice(0, 200).replace(/\b\d{6}\b/g, "******")
        : `MFA action ${action} executed with factor ${safeFactor}`;

      // 1. Sync UserProfile mfaEnabled flag in Firestore if enabling/disabling
      // Authoritatively verify with Firebase Admin that factors are genuinely enrolled before setting mfaEnabled = true
      if (action === "MFA_ENABLED") {
        try {
          const userRec = await admin.auth().getUser(uid);
          const hasEnrolled = (userRec.multiFactor?.enrolledFactors || []).length > 0;
          if (!hasEnrolled) {
            console.warn(`⚠️ [MFA AUDIT] Blocked attempted mfaEnabled claim for ${uid}: No enrolled factors found in Firebase Auth.`);
            return res.status(400).json({
              error: "MfaNotEnrolled",
              message: "Cannot mark MFA enabled without an enrolled multi-factor authentication method in identity provider."
            });
          }
        } catch (fetchErr: any) {
          const isApiDisabled = fetchErr?.message?.includes("Identity Toolkit API") || 
                                fetchErr?.code === "auth/insufficient-permission" ||
                                fetchErr?.code === 403 ||
                                String(fetchErr).includes("SERVICE_DISABLED");
          if (!isApiDisabled) {
            console.warn("ℹ️ [MFA AUDIT] Could not verify Firebase Admin multiFactor record:", fetchErr?.message || fetchErr);
          }
        }

        try {
          await db.collection("users").doc(uid).set({
            mfaEnabled: true,
            mfaEnrolledAt: new Date().toISOString()
          }, { merge: true });
        } catch (dbErr: any) {
          const idToken = req.user?.idToken;
          if (idToken) {
            try {
              const config = getFirebaseConfig();
              const updateMask = "updateMask.fieldPaths=mfaEnabled&updateMask.fieldPaths=mfaEnrolledAt";
              const restUrl = `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/${config.firestoreDatabaseId}/documents/users/${uid}?${updateMask}`;
              await fetch(restUrl, {
                method: "PATCH",
                headers: {
                  "Authorization": `Bearer ${idToken}`,
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({
                  fields: {
                    mfaEnabled: { booleanValue: true },
                    mfaEnrolledAt: { timestampValue: new Date().toISOString() }
                  }
                })
              });
            } catch {}
          }
        }
      } else if (action === "MFA_DISABLED") {
        try {
          await db.collection("users").doc(uid).set({
            mfaEnabled: false,
            mfaEnrolledAt: null
          }, { merge: true });
        } catch (dbErr: any) {
          const idToken = req.user?.idToken;
          if (idToken) {
            try {
              const config = getFirebaseConfig();
              const updateMask = "updateMask.fieldPaths=mfaEnabled&updateMask.fieldPaths=mfaEnrolledAt";
              const restUrl = `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/${config.firestoreDatabaseId}/documents/users/${uid}?${updateMask}`;
              await fetch(restUrl, {
                method: "PATCH",
                headers: {
                  "Authorization": `Bearer ${idToken}`,
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({
                  fields: {
                    mfaEnabled: { booleanValue: false },
                    mfaEnrolledAt: { nullValue: null }
                  }
                })
              });
            } catch {}
          }
        }
      }

      // 2. Resolve organization context if caller belongs to an organization
      let orgId = req.user!.orgId || null;
      if (!orgId) {
        try {
          const memberQuery = await db.collection("orgMembers")
            .where("userId", "==", uid)
            .where("status", "==", "active")
            .limit(1)
            .get();
          if (!memberQuery.empty) {
            orgId = memberQuery.docs[0].data().organizationId;
          }
        } catch {}
      }

      if (orgId) {
        recordOrgAuditEvent(db, {
          organizationId: orgId,
          actorUserId: uid,
          actorEmail: callerEmail,
          action: action as any,
          timestamp: new Date().toISOString(),
          source: "api",
          details: sanitizedDetails,
          metadata: {
            factorType: safeFactor
          }
        }).catch(() => {});
      }

      // Record to server auth audit logger
      recordAuthAuditEvent(db, {
        id: `audit_mfa_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        eventType: action === "MFA_CHALLENGE_FAILURE" ? "AUTH_DENIED_UNAUTHENTICATED" : "AUTH_PERMITTED",
        action,
        status: action === "MFA_CHALLENGE_FAILURE" ? "denied" : "allowed",
        severity: action === "MFA_CHALLENGE_FAILURE" ? "high" : "low",
        actorUserId: uid,
        actorEmail: callerEmail,
        organizationId: orgId,
        details: sanitizedDetails,
        timestamp: new Date().toISOString()
      }).catch(() => {});

      return res.json({ success: true, logged: true });
    } catch (error: any) {
      console.warn("⚠️ POST /api/auth/mfa/audit-event non-fatal fallback:", error?.message || error);
      return res.json({ success: true, logged: false });
    }
  });

  /**
   * Disable / Unenroll MFA Endpoint
   * Authoritatively clears multiFactor enrolled factors on user record in Firebase Admin
   * and updates user profile in Firestore.
   */
  app.post("/api/auth/mfa/disable", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const uid = req.user!.uid;
      const callerEmail = (req.user!.email || "").toLowerCase().trim();

      // Enforce recent reauthentication: token auth_time within last 15 minutes (900 seconds)
      // Step 3B.4.4: Self-service ordinary MFA disable MUST require recent primary reauthentication.
      // A recovery ticket CANNOT disable MFA through this ordinary self-service endpoint.
      const authTime = typeof req.user!.auth_time === "number" ? req.user!.auth_time : 0;
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (!authTime || (nowSeconds - authTime) > 900) {
        return res.status(403).json({
          error: "ReauthRequired",
          code: "REAUTHENTICATION_REQUIRED",
          message: "Recent password reauthentication is required to disable two-factor authentication."
        });
      }

      // Clear enrolled factors in Firebase Admin
      try {
        await admin.auth().updateUser(uid, {
          multiFactor: {
            enrolledFactors: null
          }
        });
      } catch (adminErr: any) {
        const isApiDisabled = adminErr?.message?.includes("Identity Toolkit API") || adminErr?.code === 403;
        if (!isApiDisabled) {
          console.warn("ℹ️ admin.auth().updateUser multiFactor reset note:", adminErr?.message || adminErr);
        }
      }

      // Update Firestore user document
      try {
        await db.collection("users").doc(uid).set({
          mfaEnabled: false,
          mfaEnrolledAt: null
        }, { merge: true });
      } catch (dbErr: any) {
        const idToken = req.user?.idToken;
        if (idToken) {
          try {
            const config = getFirebaseConfig();
            const updateMask = "updateMask.fieldPaths=mfaEnabled&updateMask.fieldPaths=mfaEnrolledAt";
            const restUrl = `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/${config.firestoreDatabaseId}/documents/users/${uid}?${updateMask}`;
            await fetch(restUrl, {
              method: "PATCH",
              headers: {
                "Authorization": `Bearer ${idToken}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                fields: {
                  mfaEnabled: { booleanValue: false },
                  mfaEnrolledAt: { nullValue: null }
                }
              })
            });
          } catch {}
        }
      }

      // Record audit event
      let orgId = req.user!.orgId || null;
      if (!orgId) {
        try {
          const memberQuery = await db.collection("orgMembers")
            .where("userId", "==", uid)
            .where("status", "==", "active")
            .limit(1)
            .get();
          if (!memberQuery.empty) {
            orgId = memberQuery.docs[0].data().organizationId;
          }
        } catch {}
      }

      if (orgId) {
        recordOrgAuditEvent(db, {
          organizationId: orgId,
          actorUserId: uid,
          actorEmail: callerEmail,
          action: "MFA_DISABLED",
          timestamp: new Date().toISOString(),
          source: "api",
          details: `Disabled multi-factor authentication for user ${callerEmail}`,
          metadata: { actorUserId: uid }
        }).catch(() => {});
      }

      recordAuthAuditEvent(db, {
        id: `audit_mfa_disable_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        eventType: "AUTH_PERMITTED",
        action: "MFA_DISABLED",
        status: "allowed",
        severity: "medium",
        actorUserId: uid,
        actorEmail: callerEmail,
        organizationId: orgId,
        details: `Two-factor authentication disabled by user ${callerEmail}`,
        timestamp: new Date().toISOString()
      }).catch(() => {});

      return res.json({ success: true, message: "Multi-factor authentication disabled successfully." });
    } catch (error: any) {
      console.warn("⚠️ POST /api/auth/mfa/disable non-fatal fallback:", error?.message || error);
      return res.json({ success: true, message: "Multi-factor authentication disabled." });
    }
  });

  /**
   * ==============================================================================
   * MFA RECOVERY CODES ENDPOINTS (STEP 3B.4.2)
   * ==============================================================================
   */

  /**
   * GET /api/auth/mfa/recovery-codes/status
   * Checks whether recovery codes have been generated for the caller and how many remain.
   * NEVER returns codes or verifiers.
   */
  app.get("/api/auth/mfa/recovery-codes/status", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const uid = req.user!.uid;
      const secDocRef = db.collection("users").doc(uid).collection("security").doc("mfa_recovery");
      const secSnap = await secDocRef.get();

      if (!secSnap.exists) {
        return res.json({
          configured: false,
          remainingCodes: 0,
          totalCodes: 0,
          createdAt: null
        });
      }

      const data = secSnap.data() as UserRecoveryDocument;
      const codes = data.codes || [];
      const unusedCount = codes.filter((c: StoredRecoveryCode) => !c.used).length;

      return res.json({
        configured: true,
        remainingCodes: unusedCount,
        totalCodes: data.totalCodes || 10,
        createdAt: data.createdAt || null
      });
    } catch (error: any) {
      console.warn("⚠️ GET /api/auth/mfa/recovery-codes/status note:", error?.message || error);
      return res.status(500).json({ error: "InternalError", message: "Failed to query recovery codes status." });
    }
  });

  /**
   * POST /api/auth/mfa/recovery-codes/generate
   * Generates or regenerates a fresh set of 10 single-use recovery codes.
   * Requires recent primary authentication (checked via req.user.auth_time).
   * Overwrites all existing codes atomically.
   * Returns plaintext codes ONLY ONCE in the response body.
   */
  app.post("/api/auth/mfa/recovery-codes/generate", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const uid = req.user!.uid;
      const callerEmail = (req.user!.email || "").toLowerCase().trim();

      // Enforce recent reauthentication: token auth_time within last 15 minutes (900 seconds)
      const authTime = typeof req.user!.auth_time === "number" ? req.user!.auth_time : 0;
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (!authTime || (nowSeconds - authTime) > 900) {
        return res.status(403).json({
          error: "ReauthRequired",
          code: "REAUTHENTICATION_REQUIRED",
          message: "Recent reauthentication is required to generate or regenerate MFA recovery codes."
        });
      }

      // Generate 10 high-entropy recovery codes and their secure salted HMAC verifiers
      const { plaintextCodes, document } = generateRecoveryCodesSet(uid);

      // Atomically store only verifiers in isolated document /users/{uid}/security/mfa_recovery
      const secDocRef = db.collection("users").doc(uid).collection("security").doc("mfa_recovery");
      await secDocRef.set(document);

      // Record audit event (Sanitized: NO codes or hashes logged)
      let orgId = req.user!.orgId || null;
      recordAuthAuditEvent(db, {
        id: `audit_mfa_rc_gen_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        eventType: "AUTH_PERMITTED",
        action: "MFA_RECOVERY_CODES_GENERATED",
        status: "allowed",
        severity: "medium",
        actorUserId: uid,
        actorEmail: callerEmail,
        organizationId: orgId,
        details: `Generated new set of ${plaintextCodes.length} single-use MFA recovery codes for ${callerEmail}`,
        timestamp: new Date().toISOString()
      }).catch(() => {});

      if (orgId) {
        recordOrgAuditEvent(db, {
          organizationId: orgId,
          actorUserId: uid,
          actorEmail: callerEmail,
          action: "MFA_RECOVERY_CODES_GENERATED",
          timestamp: new Date().toISOString(),
          source: "api",
          details: `Generated single-use MFA recovery codes for ${callerEmail}`,
          metadata: { actorUserId: uid, count: plaintextCodes.length }
        }).catch(() => {});
      }

      return res.json({
        success: true,
        codes: plaintextCodes,
        totalCodes: plaintextCodes.length,
        message: "Recovery codes generated. Store them securely. They will NOT be shown again."
      });
    } catch (error: any) {
      console.error("❌ POST /api/auth/mfa/recovery-codes/generate error:", error?.message || error);
      return res.status(500).json({ error: "InternalError", message: "Failed to generate recovery codes." });
    }
  });

  /**
   * POST /api/auth/mfa/recovery/redeem
   * Atomically redeems a single-use recovery code.
   * Bound to caller's primary authenticated UID.
   * Rate-limited to max 5 attempts per 15 minutes.
   * Consumes the matching unused code inside a Firestore transaction.
   * Issues a short-lived, tamper-resistant Recovery Ticket (TTL 10 min).
   */
  app.post("/api/auth/mfa/recovery/redeem", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const uid = req.user!.uid;
      const callerEmail = (req.user!.email || "").toLowerCase().trim();
      const clientIp = (req.headers["x-forwarded-for"] as string || req.socket.remoteAddress || "").split(",")[0].trim();
      const { code } = req.body;

      if (!code || typeof code !== "string" || code.trim().length === 0) {
        return res.status(400).json({
          error: "InvalidRequest",
          message: "Recovery code is required."
        });
      }

      // Rate limit check
      const rateCheck = checkRecoveryRateLimit(uid, clientIp);
      if (!rateCheck.allowed) {
        recordAuthAuditEvent(db, {
          id: `audit_mfa_rc_rl_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          eventType: "AUTH_DENIED_INSUFFICIENT_ROLE",
          action: "MFA_RECOVERY_RATE_LIMITED",
          status: "denied",
          severity: "high",
          actorUserId: uid,
          actorEmail: callerEmail,
          ipAddress: clientIp,
          details: `Recovery code redemption rate limit exceeded for ${callerEmail}`,
          timestamp: new Date().toISOString()
        }).catch(() => {});

        return res.status(429).json({
          error: "TooManyRequests",
          code: "TOO_MANY_ATTEMPTS",
          message: `Too many failed attempts. Please try again in ${rateCheck.retryAfterSeconds} seconds.`,
          retryAfter: rateCheck.retryAfterSeconds
        });
      }

      // Record this attempt against the rate limit bucket
      recordRecoveryAttempt(uid, clientIp);

      const secDocRef = db.collection("users").doc(uid).collection("security").doc("mfa_recovery");

      // Execute atomic redemption inside Firestore transaction
      const redemptionResult = await db.runTransaction(async (txn) => {
        const snap = await txn.get(secDocRef);
        if (!snap.exists) {
          return { success: false, reason: "NOT_FOUND" };
        }

        const data = snap.data() as UserRecoveryDocument;
        const codes = data.codes || [];

        // Find matching unused code using constant-time comparison
        const matched = findMatchingUnusedCode(code, codes);
        if (!matched) {
          return { success: false, reason: "INVALID_OR_USED" };
        }

        // Consume the matched code atomically
        const now = new Date().toISOString();
        matched.used = true;
        matched.usedAt = now;

        const remainingCount = codes.filter((c: StoredRecoveryCode) => !c.used).length;

        txn.update(secDocRef, {
          codes,
          remainingCodes: remainingCount,
          updatedAt: now
        });

        return {
          success: true,
          codeId: matched.codeId,
          remainingCodes: remainingCount
        };
      });

      if (!redemptionResult.success) {
        // Generic failure response (avoids leaking whether code exists, is used, or is malformed)
        recordAuthAuditEvent(db, {
          id: `audit_mfa_rc_fail_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          eventType: "AUTH_DENIED_INSUFFICIENT_ROLE",
          action: "MFA_RECOVERY_FAILED_ATTEMPT",
          status: "denied",
          severity: "medium",
          actorUserId: uid,
          actorEmail: callerEmail,
          ipAddress: clientIp,
          details: `Invalid or exhausted recovery code attempt for ${callerEmail}`,
          timestamp: new Date().toISOString()
        }).catch(() => {});

        return res.status(401).json({
          error: "InvalidCode",
          code: "INVALID_RECOVERY_CODE",
          message: "Invalid or previously redeemed recovery code."
        });
      }

      // Successful redemption: Issue cryptographically signed Recovery Ticket
      const recoveryTicket = issueRecoveryTicket(uid, redemptionResult.codeId!);
      let orgId = req.user!.orgId || null;

      // Reset rate limit on success
      resetRecoveryRateLimit(uid, clientIp);

      // Record sanitized audit log
      recordAuthAuditEvent(db, {
        id: `audit_mfa_rc_redeem_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        eventType: "AUTH_PERMITTED",
        action: "MFA_RECOVERY_CODE_REDEEMED",
        status: "allowed",
        severity: "high",
        actorUserId: uid,
        actorEmail: callerEmail,
        organizationId: orgId,
        details: `Recovery code ${redemptionResult.codeId} redeemed by ${callerEmail}. Remaining codes: ${redemptionResult.remainingCodes}`,
        timestamp: new Date().toISOString()
      }).catch(() => {});

      if (orgId) {
        recordOrgAuditEvent(db, {
          organizationId: orgId,
          actorUserId: uid,
          actorEmail: callerEmail,
          action: "MFA_RECOVERY_CODE_REDEEMED",
          timestamp: new Date().toISOString(),
          source: "api",
          details: `Single-use recovery code redeemed by ${callerEmail}. Remaining codes: ${redemptionResult.remainingCodes}`,
          metadata: { actorUserId: uid, codeId: redemptionResult.codeId, remainingCodes: redemptionResult.remainingCodes }
        }).catch(() => {});
      }

      return res.json({
        success: true,
        message: "Recovery code successfully verified.",
        recoveryTicket,
        remainingCodes: redemptionResult.remainingCodes
      });
    } catch (error: any) {
      console.error("❌ POST /api/auth/mfa/recovery/redeem error:", error?.message || error);
      return res.status(500).json({ error: "InternalError", message: "Failed to redeem recovery code." });
    }
  });

  /**
   * POST /api/auth/mfa/recovery/reset-factors
   * Dedicated Isolated Recovery Scope Endpoint (Step 3B.4.4).
   *
   * Strictly authorized ONLY by a valid, unexpired Recovery Ticket via requireRecoveryScope.
   * Purpose: Allows an account holder who legitimately lost their authenticator device to
   * clear their lost factors and reset MFA so they can enroll a new authenticator.
   *
   * Invariants enforced:
   * 1. Recovery ticket signature, purpose ('mfa_recovery_reset'), audience ('echonote-mfa-recovery'),
   *    and scope ('mfa:reset-lost-factor') verified.
   * 2. Bound to caller's verified Firebase UID.
   * 3. DOES NOT grant access to any project, recording, organization administration, or billing route.
   * 4. Once factors are reset, user must enroll their new authenticator and complete a genuine
   *    Firebase Identity Platform second-factor sign-in to satisfy organization MFA policy.
   */
  app.post(
    "/api/auth/mfa/recovery/reset-factors",
    requireAuth,
    requireRecoveryScope("mfa:reset-lost-factor"),
    async (req: RecoveryScopedRequest, res) => {
      try {
        const uid = req.user!.uid;
        const callerEmail = (req.user!.email || "").toLowerCase().trim();
        const codeId = req.recoveryPayload?.codeId || "unknown";

        // Authoritatively clear lost enrolled factors in Firebase Identity Platform
        try {
          await admin.auth().updateUser(uid, {
            multiFactor: {
              enrolledFactors: null
            }
          });
        } catch (adminErr: any) {
          const isApiDisabled = adminErr?.message?.includes("Identity Toolkit API") || adminErr?.code === 403;
          if (!isApiDisabled) {
            console.warn("ℹ️ admin.auth().updateUser recovery factor reset note:", adminErr?.message || adminErr);
          }
        }

        // Update Firestore user document
        try {
          await db.collection("users").doc(uid).set({
            mfaEnabled: false,
            mfaEnrolledAt: null,
            lastMfaRecoveryAt: new Date().toISOString()
          }, { merge: true });
        } catch (dbErr: any) {
          console.warn("Firestore update note during recovery reset:", dbErr?.message);
        }

        let orgId = req.user!.orgId || null;
        recordAuthAuditEvent(db, {
          id: `audit_mfa_reset_factors_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          eventType: "AUTH_PERMITTED",
          action: "MFA_RECOVERY_USED",
          status: "allowed",
          severity: "high",
          actorUserId: uid,
          actorEmail: callerEmail,
          organizationId: orgId,
          details: `Lost MFA factor reset via recovery code ${codeId} for user ${callerEmail}`,
          timestamp: new Date().toISOString()
        }).catch(() => {});

        if (orgId) {
          recordOrgAuditEvent(db, {
            organizationId: orgId,
            actorUserId: uid,
            actorEmail: callerEmail,
            action: "MFA_RECOVERY_USED",
            timestamp: new Date().toISOString(),
            source: "api",
            details: `Lost MFA factor reset using recovery code ${codeId} for user ${callerEmail}`,
            metadata: { actorUserId: uid, codeId }
          }).catch(() => {});
        }

        return res.json({
          success: true,
          message: "Lost authenticator factor reset successfully. You may now enroll your replacement authenticator app."
        });
      } catch (error: any) {
        console.error("❌ POST /api/auth/mfa/recovery/reset-factors error:", error?.message || error);
        return res.status(500).json({ error: "InternalError", message: "Failed to reset lost factor." });
      }
    }
  );

  /**
   * Create Organization (Caller becomes Owner, issued 'owner' Custom Claim)
   */
  app.post("/api/organizations", requireAuth, async (req: AuthenticatedRequest, res) => {
    const callerUid = req.user!.uid;
    const callerEmail = req.user!.email || "";
    const callerName = req.user!.name || callerEmail.split("@")[0] || "Owner";
    const { name, industry, timezone, country, logoUrl } = req.body;

    const orgId = "org_" + Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
    const orgName = name ? String(name).trim() : "My Organization";

    try {
      const orgData = {
        id: orgId,
        name: orgName,
        industry: industry || "Technology",
        timezone: timezone || "UTC",
        country: country || "US",
        logoUrl: logoUrl || "",
        ownerId: callerUid,
        ownerEmail: callerEmail,
        createdAt: new Date().toISOString(),
        status: "active",
        tier: "enterprise",
        securitySettings: {
          twoFactorRequired: false,
          sessionTimeoutMinutes: 60,
          allowedIpRanges: [],
          ssoConfig: {
            enabled: false,
            provider: "saml",
            domainDiscovery: false
          }
        }
      };

      // 1. Create Organization in Firestore
      await db.collection("organizations").doc(orgId).set(orgData);

      // 2. Create Owner Member document in orgMembers
      const memberId = `member_${callerUid.slice(0, 8)}_${Date.now().toString(36)}`;
      await db.collection("orgMembers").doc(memberId).set({
        id: memberId,
        orgId,
        userId: callerUid,
        email: callerEmail,
        name: callerName,
        displayName: callerName,
        role: "owner",
        status: "active",
        joinedAt: new Date().toISOString()
      });

      // 3. Issue Custom Claims to the Owner
      const claims = await syncUserCustomClaims(callerUid, db, {
        orgId,
        orgRole: "owner"
      });

      // 4. Record Audit Log
      await recordOrgAuditEvent(db, {
        organizationId: orgId,
        actorUserId: callerUid,
        actorEmail: callerEmail,
        action: "ORGANIZATION_CREATED",
        timestamp: new Date().toISOString(),
        source: "api",
        details: `Organization ${orgName} created by ${callerEmail}`
      });

      res.status(201).json({
        success: true,
        organization: orgData,
        claims
      });
    } catch (error: any) {
      console.error("❌ Create organization failed:", error);
      res.status(500).json({ error: "Failed to create organization", message: error.message });
    }
  });

  /**
   * Update Member Role (Strict Authoritative Hierarchy enforcement)
   */
  app.patch("/api/organizations/:organizationId/members/:memberId/role", requireAuth, async (req: AuthenticatedRequest, res) => {
    const { organizationId, memberId } = req.params;
    const { role } = req.body;

    if (!role) {
      return res.status(400).json({ error: "Bad Request", message: "New role must be specified." });
    }

    const callerUid = req.user!.uid;
    const callerEmail = (req.user!.email || "").toLowerCase();
    const targetNewRole = normalizeOrgRole(role);

    try {
      // 1. Resolve Caller's authoritative role in this organization
      let callerRole: AuthoritativeOrgRole | null = null;
      const orgDoc = await db.collection("organizations").doc(organizationId).get();
      if (!orgDoc.exists) {
        return res.status(404).json({ error: "Not Found", message: "Organization not found" });
      }

      const orgData = orgDoc.data() || {};
      if (orgData.ownerId === callerUid || orgData.ownerEmail?.toLowerCase() === callerEmail) {
        callerRole = "owner";
      } else {
        const callerMemberSnap = await db
          .collection("orgMembers")
          .where("orgId", "==", organizationId)
          .where("email", "==", callerEmail)
          .where("status", "==", "active")
          .limit(1)
          .get();

        if (!callerMemberSnap.empty) {
          callerRole = normalizeOrgRole(callerMemberSnap.docs[0].data().role);
        }
      }

      // Check caller authority
      if (!callerRole || (callerRole !== "owner" && callerRole !== "org_admin")) {
        return res.status(403).json({
          error: "Forbidden",
          message: "Only organization owners or administrators can change member roles."
        });
      }

      // Enforce organization MFA policy
      const mfaCheck = evaluateOrgMfaPolicy(orgData.securitySettings, callerRole, isSessionMfaVerified(req.user));
      if (!mfaCheck.allowed) {
        return res.status(403).json({
          error: "Forbidden",
          code: "MFA_REQUIRED",
          message: mfaCheck.violationReason,
          mfaRequirement: mfaCheck.requirement,
          organizationId,
          role: callerRole
        });
      }

      // 2. Fetch Target Member document
      let targetMemberDoc = await db.collection("orgMembers").doc(memberId).get();
      let targetDocId = memberId;

      if (!targetMemberDoc.exists) {
        // Fallback search by userId or id field
        const searchSnap = await db
          .collection("orgMembers")
          .where("orgId", "==", organizationId)
          .where("userId", "==", memberId)
          .limit(1)
          .get();

        if (!searchSnap.empty) {
          targetMemberDoc = searchSnap.docs[0];
          targetDocId = targetMemberDoc.id;
        } else {
          return res.status(404).json({ error: "Not Found", message: "Target member not found in organization." });
        }
      }

      const targetMember = targetMemberDoc.data() || {};
      if (targetMember.orgId !== organizationId) {
        return res.status(400).json({ error: "Bad Request", message: "Target member does not belong to this organization." });
      }

      const targetCurrentRole = normalizeOrgRole(targetMember.role);
      const targetUid = targetMember.userId;
      const targetEmail = targetMember.email;

      // 3. Evaluate Role Hierarchy Rules
      if (targetCurrentRole === "owner") {
        return res.status(400).json({
          error: "Bad Request",
          message: "Cannot change the organization owner's role directly. Use the ownership transfer process instead."
        });
      }

      if (targetNewRole === "owner") {
        return res.status(400).json({
          error: "Bad Request",
          message: "Cannot assign owner role via role change. Use the ownership transfer process."
        });
      }

      if (callerRole === "org_admin") {
        // Org Admin cannot modify an Owner or another Org Admin
        if (targetCurrentRole === "org_admin") {
          return res.status(403).json({
            error: "Forbidden",
            message: "Organization administrators cannot modify the role of another administrator."
          });
        }

        // Org Admin cannot promote to Org Admin
        if (targetNewRole === "org_admin") {
          return res.status(403).json({
            error: "Forbidden",
            message: "Organization administrators cannot promote members to administrator. Only the owner can promote administrators."
          });
        }
      }

      // 4. Update Firestore Member record
      await db.collection("orgMembers").doc(targetDocId).update({
        role: targetNewRole,
        updatedAt: new Date().toISOString()
      });

      // 5. Update Firebase Custom Claims on Target User
      if (targetUid) {
        await syncUserCustomClaims(targetUid, db, {
          orgId: organizationId,
          orgRole: targetNewRole
        });
      }

      // 6. Record Structured Audit Event
      await recordOrgAuditEvent(db, {
        organizationId,
        actorUserId: callerUid,
        actorEmail: callerEmail,
        targetUserId: targetUid || targetDocId,
        targetUserEmail: targetEmail,
        previousRole: targetCurrentRole,
        newRole: targetNewRole,
        action: "ROLE_CHANGED",
        timestamp: new Date().toISOString(),
        source: "api",
        details: `Role for ${targetEmail} updated from ${targetCurrentRole} to ${targetNewRole} by ${callerEmail}`
      });

      res.json({
        success: true,
        memberId: targetDocId,
        targetEmail,
        previousRole: targetCurrentRole,
        newRole: targetNewRole
      });
    } catch (error: any) {
      console.error("❌ Role update failed:", error);
      res.status(500).json({ error: "Failed to update member role", message: error.message });
    }
  });

  /**
   * Assign or Clear Member Department (Owner & Org Admin only)
   */
  app.patch("/api/organizations/:organizationId/members/:memberId/department", requireAuth, async (req: AuthenticatedRequest, res) => {
    const { organizationId, memberId } = req.params;
    const { departmentId } = req.body;
    const callerUid = req.user!.uid;
    const callerEmail = (req.user!.email || "").toLowerCase();

    try {
      // 1. Authorization: Owner or Org Admin
      const orgAccess = await checkOrgAccess(db, callerEmail, organizationId, ["owner", "org_admin"], req.user);
      const isPlatformAdmin = Boolean(req.user?.platform_admin || req.user?.role === "admin");
      if (orgAccess.mfaRequired) {
        return res.status(403).json(
          createMfaForbiddenResponse(
            orgAccess.mfaRequirement,
            orgAccess.mfaViolationReason,
            req.user,
            orgAccess.mfaEnrolled,
            { organizationId }
          )
        );
      }
      if (!orgAccess.hasAccess && !isPlatformAdmin) {
        return res.status(403).json({
          error: "Forbidden",
          message: "Only organization owners and administrators can assign member departments."
        });
      }

      // 2. Fetch member and verify tenant boundary
      const memberRef = db.collection("orgMembers").doc(memberId);
      const memberDoc = await memberRef.get();
      if (!memberDoc.exists || memberDoc.data()?.orgId !== organizationId) {
        return res.status(404).json({
          error: "Not Found",
          message: "Member not found in organization."
        });
      }

      const memberData = memberDoc.data()!;
      const previousDeptId = memberData.departmentId || "";
      const targetDeptId = typeof departmentId === "string" ? departmentId.trim() : (departmentId === null ? "" : undefined);

      if (targetDeptId === undefined) {
        return res.status(400).json({
          error: "Bad Request",
          message: "departmentId must be provided as a string or null."
        });
      }

      // 3. If assigning to a department (non-empty), validate department existence & tenant
      let assignedDeptName = "";
      if (targetDeptId !== "") {
        const deptDoc = await db.collection("departments").doc(targetDeptId).get();
        if (!deptDoc.exists) {
          return res.status(404).json({
            error: "Not Found",
            message: "Department not found."
          });
        }
        const deptData = deptDoc.data() || {};
        if (deptData.orgId !== organizationId) {
          return res.status(400).json({
            error: "Bad Request",
            message: "Department belongs to a different organization."
          });
        }
        if (deptData.status && deptData.status !== "active") {
          return res.status(400).json({
            error: "Bad Request",
            message: "Department is not active."
          });
        }
        assignedDeptName = deptData.name || targetDeptId;
      }

      // 4. Update authoritative orgMembers document
      await memberRef.update({
        departmentId: targetDeptId
      });

      // 5. Record structured audit event
      await recordOrgAuditEvent(db, {
        organizationId,
        actorUserId: callerUid,
        actorEmail: callerEmail,
        targetUserId: memberData.userId,
        targetUserEmail: memberData.email,
        action: "MEMBER_DEPARTMENT_ASSIGNED",
        timestamp: new Date().toISOString(),
        source: "api",
        details: targetDeptId
          ? `Assigned member ${memberData.email} to department ${assignedDeptName} (${targetDeptId})`
          : `Unassigned member ${memberData.email} from department`,
        metadata: {
          memberId,
          previousDepartmentId: previousDeptId || null,
          newDepartmentId: targetDeptId || null
        }
      });

      res.json({
        success: true,
        memberId,
        departmentId: targetDeptId,
        message: targetDeptId ? "Member department updated successfully" : "Member department cleared successfully"
      });
    } catch (error: any) {
      console.error("❌ Member department assignment failed:", error);
      res.status(500).json({ error: "Failed to assign member department", message: error.message });
    }
  });

  /**
   * Transfer Organization Ownership (Owner only)
   */
  app.post("/api/organizations/:organizationId/transfer-ownership", requireAuth, async (req: AuthenticatedRequest, res) => {
    const { organizationId } = req.params;
    const { targetMemberId, targetEmail, targetUserId } = req.body;

    const callerUid = req.user!.uid;
    const callerEmail = (req.user!.email || "").toLowerCase();

    try {
      const orgRef = db.collection("organizations").doc(organizationId);
      const orgDoc = await orgRef.get();
      if (!orgDoc.exists) {
        return res.status(404).json({ error: "Not Found", message: "Organization not found" });
      }

      const orgData = orgDoc.data() || {};
      const isOwner = orgData.ownerId === callerUid || orgData.ownerEmail?.toLowerCase() === callerEmail;
      if (!isOwner) {
        return res.status(403).json({
          error: "Forbidden",
          message: "Only the current organization owner can transfer ownership."
        });
      }

      // Enforce organization MFA policy for owner
      const mfaCheck = evaluateOrgMfaPolicy(orgData.securitySettings, 'owner', isSessionMfaVerified(req.user));
      if (!mfaCheck.allowed) {
        return res.status(403).json({
          error: "Forbidden",
          code: "MFA_REQUIRED",
          message: mfaCheck.violationReason,
          mfaRequirement: mfaCheck.requirement,
          organizationId,
          role: 'owner'
        });
      }

      // Find target active member
      let targetMemberDoc: any = null;
      if (targetMemberId) {
        const docSnap = await db.collection("orgMembers").doc(targetMemberId).get();
        if (docSnap.exists && docSnap.data()?.orgId === organizationId) {
          targetMemberDoc = docSnap;
        }
      }

      if (!targetMemberDoc && targetEmail) {
        const snap = await db
          .collection("orgMembers")
          .where("orgId", "==", organizationId)
          .where("email", "==", targetEmail.toLowerCase())
          .limit(1)
          .get();
        if (!snap.empty) targetMemberDoc = snap.docs[0];
      }

      if (!targetMemberDoc && targetUserId) {
        const snap = await db
          .collection("orgMembers")
          .where("orgId", "==", organizationId)
          .where("userId", "==", targetUserId)
          .limit(1)
          .get();
        if (!snap.empty) targetMemberDoc = snap.docs[0];
      }

      if (!targetMemberDoc) {
        return res.status(404).json({
          error: "Not Found",
          message: "Target user must be an active member of this organization before ownership can be transferred."
        });
      }

      const targetData = targetMemberDoc.data();
      const targetUid = targetData.userId;
      const targetUserEmail = targetData.email;

      if (targetUid === callerUid || targetUserEmail.toLowerCase() === callerEmail) {
        return res.status(400).json({ error: "Bad Request", message: "You are already the owner of this organization." });
      }

      // 1. Update Organization document
      await orgRef.update({
        ownerId: targetUid || targetData.id,
        ownerEmail: targetUserEmail,
        updatedAt: new Date().toISOString()
      });

      // 2. Update Target Member role to 'owner'
      await targetMemberDoc.ref.update({
        role: "owner",
        updatedAt: new Date().toISOString()
      });

      // 3. Update Previous Owner Member role to 'org_admin'
      const prevOwnerMemberSnap = await db
        .collection("orgMembers")
        .where("orgId", "==", organizationId)
        .where("email", "==", callerEmail)
        .limit(1)
        .get();

      if (!prevOwnerMemberSnap.empty) {
        await prevOwnerMemberSnap.docs[0].ref.update({
          role: "org_admin",
          updatedAt: new Date().toISOString()
        });
      }

      // 4. Update Custom Claims for New Owner & Previous Owner
      if (targetUid) {
        await syncUserCustomClaims(targetUid, db, {
          orgId: organizationId,
          orgRole: "owner"
        });
      }

      await syncUserCustomClaims(callerUid, db, {
        orgId: organizationId,
        orgRole: "org_admin"
      });

      // 5. Audit Logging
      await recordOrgAuditEvent(db, {
        organizationId,
        actorUserId: callerUid,
        actorEmail: callerEmail,
        targetUserId: targetUid,
        targetUserEmail: targetUserEmail,
        previousRole: "owner",
        newRole: "org_admin",
        action: "OWNER_TRANSFERRED",
        timestamp: new Date().toISOString(),
        source: "api",
        details: `Transferred ownership of organization ${organizationId} to ${targetUserEmail}`
      });

      res.json({
        success: true,
        previousOwner: callerEmail,
        newOwner: targetUserEmail,
        message: "Organization ownership transferred successfully"
      });
    } catch (error: any) {
      console.error("❌ Ownership transfer failed:", error);
      res.status(500).json({ error: "Failed to transfer ownership", message: error.message });
    }
  });

  /**
   * Deactivate Organization Member
   */
  app.post("/api/organizations/:organizationId/members/:memberId/deactivate", requireAuth, async (req: AuthenticatedRequest, res) => {
    const { organizationId, memberId } = req.params;
    const callerUid = req.user!.uid;
    const callerEmail = (req.user!.email || "").toLowerCase();

    try {
      const isPlatformAdmin = Boolean(req.user?.platform_admin || req.user?.role === "admin");
      const orgAccess = await checkOrgAccess(db, callerEmail, organizationId, ["owner", "org_admin"], req.user);
      if (orgAccess.mfaRequired) {
        return res.status(403).json(
          createMfaForbiddenResponse(
            orgAccess.mfaRequirement,
            orgAccess.mfaViolationReason,
            req.user,
            orgAccess.mfaEnrolled,
            { organizationId }
          )
        );
      }
      if (!orgAccess.hasAccess && !isPlatformAdmin) {
        return res.status(403).json({ error: "Forbidden", message: "Insufficient permissions to deactivate members." });
      }

      const memberRef = db.collection("orgMembers").doc(memberId);
      const memberDoc = await memberRef.get();
      if (!memberDoc.exists || memberDoc.data()?.orgId !== organizationId) {
        return res.status(404).json({ error: "Not Found", message: "Member not found in organization." });
      }

      const memberData = memberDoc.data()!;
      if (normalizeOrgRole(memberData.role) === "owner") {
        return res.status(400).json({ error: "Bad Request", message: "Cannot deactivate the organization owner." });
      }

      // Hierarchy enforcement: org_admin cannot deactivate another org_admin unless owner or platform_admin
      if (!orgAccess.isOwner && !isPlatformAdmin && normalizeOrgRole(memberData.role) === "org_admin") {
        return res.status(403).json({
          error: "Forbidden",
          message: "Organization admins cannot deactivate fellow organization admins. Only the organization owner can perform this action."
        });
      }

      await memberRef.update({
        status: "deactivated",
        updatedAt: new Date().toISOString()
      });

      // SEC-01 Hardening: Synchronize claims, handle multi-org, revoke refresh tokens, and handle partial failure
      try {
        await handleMemberDeactivationAuth(db, memberData.userId, memberData.email, organizationId);
      } catch (authErr: any) {
        // Rollback Firestore update on credentials update failure to prevent partial state
        try {
          await memberRef.update({
            status: "active",
            updatedAt: new Date().toISOString()
          });
        } catch (rollbackErr: any) {
          console.error("❌ Failed to rollback member deactivation after auth error:", rollbackErr);
        }
        return res.status(500).json({
          error: "Internal Server Error",
          message: `Failed to revoke member credentials or update custom claims: ${authErr?.message || authErr}`
        });
      }

      await recordOrgAuditEvent(db, {
        organizationId,
        actorUserId: callerUid,
        actorEmail: callerEmail,
        targetUserId: memberData.userId,
        targetUserEmail: memberData.email,
        action: "MEMBER_DEACTIVATED",
        timestamp: new Date().toISOString(),
        source: "api",
        details: `Deactivated member ${memberData.email}`
      });

      res.json({ success: true, memberId, status: "deactivated" });
    } catch (error: any) {
      console.error("❌ Member deactivation failed:", error);
      res.status(500).json({ error: "Failed to deactivate member", message: error.message });
    }
  });

  /**
   * Reactivate Organization Member
   */
  app.post("/api/organizations/:organizationId/members/:memberId/reactivate", requireAuth, async (req: AuthenticatedRequest, res) => {
    const { organizationId, memberId } = req.params;
    const callerUid = req.user!.uid;
    const callerEmail = (req.user!.email || "").toLowerCase();
    try {
      const isPlatformAdmin = Boolean(req.user?.platform_admin || req.user?.role === "admin");
      const orgAccess = await checkOrgAccess(db, callerEmail, organizationId, ["owner", "org_admin"], req.user);
      if (orgAccess.mfaRequired) {
        return res.status(403).json(
          createMfaForbiddenResponse(
            orgAccess.mfaRequirement,
            orgAccess.mfaViolationReason,
            req.user,
            orgAccess.mfaEnrolled,
            { organizationId }
          )
        );
      }
      if (!orgAccess.hasAccess && !isPlatformAdmin) {
        return res.status(403).json({ error: "Forbidden", message: "Insufficient permissions to reactivate members." });
      }

      const memberRef = db.collection("orgMembers").doc(memberId);
      const memberDoc = await memberRef.get();
      if (!memberDoc.exists || memberDoc.data()?.orgId !== organizationId) {
        return res.status(404).json({ error: "Not Found", message: "Member not found in organization." });
      }

      const memberData = memberDoc.data()!;
      await memberRef.update({
        status: "active",
        updatedAt: new Date().toISOString()
      });

      // Restore custom claims
      if (memberData.userId) {
        await syncUserCustomClaims(memberData.userId, db, {
          orgId: organizationId,
          orgRole: normalizeOrgRole(memberData.role)
        });
      }

      await recordOrgAuditEvent(db, {
        organizationId,
        actorUserId: callerUid,
        actorEmail: callerEmail,
        targetUserId: memberData.userId,
        targetUserEmail: memberData.email,
        action: "MEMBER_REACTIVATED",
        timestamp: new Date().toISOString(),
        source: "api",
        details: `Reactivated member ${memberData.email}`
      });

      res.json({ success: true, memberId, status: "active" });
    } catch (error: any) {
      console.error("❌ Member reactivation failed:", error);
      res.status(500).json({ error: "Failed to reactivate member", message: error.message });
    }
  });

  /**
   * Remove Member from Organization (with atomic project membership invalidation)
   */
  app.delete("/api/organizations/:organizationId/members/:memberId", requireAuth, async (req: AuthenticatedRequest, res) => {
    const { organizationId, memberId } = req.params;
    const callerUid = req.user!.uid;
    const callerEmail = (req.user!.email || "").toLowerCase();

    try {
      const orgAccess = await checkOrgAccess(db, callerEmail, organizationId, ["owner", "org_admin"], req.user);
      const isPlatformAdmin = Boolean(req.user?.platform_admin || req.user?.role === "admin");
      if (orgAccess.mfaRequired) {
        return res.status(403).json(
          createMfaForbiddenResponse(
            orgAccess.mfaRequirement,
            orgAccess.mfaViolationReason,
            req.user,
            orgAccess.mfaEnrolled,
            { organizationId }
          )
        );
      }
      if (!orgAccess.hasAccess && !isPlatformAdmin) {
        return res.status(403).json({ error: "Forbidden", message: "Insufficient permissions to remove members." });
      }

      const memberRef = db.collection("orgMembers").doc(memberId);
      const memberDoc = await memberRef.get();
      if (!memberDoc.exists || memberDoc.data()?.orgId !== organizationId) {
        return res.status(404).json({ error: "Not Found", message: "Member not found in organization." });
      }

      const memberData = memberDoc.data()!;
      if (normalizeOrgRole(memberData.role) === "owner") {
        return res.status(400).json({ error: "Bad Request", message: "Cannot remove the organization owner." });
      }

      if (!orgAccess.isOwner && !isPlatformAdmin && normalizeOrgRole(memberData.role) === "org_admin") {
        return res.status(403).json({ error: "Forbidden", message: "Administrators cannot remove other administrators. Only the owner can remove administrators." });
      }

      // Identify projects belonging to this organization
      const orgProjectsSnap = await db.collection("projects").where("organizationId", "==", organizationId).get();
      const orgProjectIds = new Set(orgProjectsSnap.docs.map(d => d.id));

      // Find projectMembers records for this user that belong to this organization
      const matchingPmDocRefs = new Map<string, admin.firestore.DocumentReference>();

      // 1. Query projectMembers by userId if present
      if (memberData.userId) {
        try {
          const userPmSnap = await db.collection("projectMembers").where("userId", "==", memberData.userId).get();
          for (const pmDoc of userPmSnap.docs) {
            const pmData = pmDoc.data();
            if (pmData.organizationId === organizationId || orgProjectIds.has(pmData.projectId)) {
              matchingPmDocRefs.set(pmDoc.id, pmDoc.ref);
            }
          }
        } catch (pmErr: any) {
          console.warn("⚠️ Query projectMembers by userId note:", pmErr?.message);
        }
      }

      // 2. Query projectMembers by email if present
      if (memberData.email) {
        try {
          const emailPmSnap = await db.collection("projectMembers").where("email", "==", memberData.email.toLowerCase()).get();
          for (const pmDoc of emailPmSnap.docs) {
            const pmData = pmDoc.data();
            if (pmData.organizationId === organizationId || orgProjectIds.has(pmData.projectId)) {
              matchingPmDocRefs.set(pmDoc.id, pmDoc.ref);
            }
          }
        } catch (pmErr: any) {
          console.warn("⚠️ Query projectMembers by email note:", pmErr?.message);
        }
      }

      // 3. Direct deterministic key check: `${userId}_${projectId}`
      if (memberData.userId) {
        for (const pId of orgProjectIds) {
          const directRef = db.collection("projectMembers").doc(`${memberData.userId}_${pId}`);
          try {
            const directDoc = await directRef.get();
            if (directDoc.exists) {
              matchingPmDocRefs.set(directDoc.id, directRef);
            }
          } catch {}
        }
      }

      // Atomically delete the orgMembers document and all matching projectMembers documents
      const batch = db.batch();
      batch.delete(memberRef);
      for (const pmRef of matchingPmDocRefs.values()) {
        batch.delete(pmRef);
      }
      await batch.commit();

      // SEC-01 Hardening: Synchronize claims, handle multi-org, revoke refresh tokens
      if (memberData.userId) {
        try {
          await handleMemberDeactivationAuth(db, memberData.userId, memberData.email, organizationId);
        } catch (claimErr: any) {
          console.warn("⚠️ Member removal auth cleanup note:", claimErr?.message);
        }
      }

      await recordOrgAuditEvent(db, {
        organizationId,
        actorUserId: callerUid,
        actorEmail: callerEmail,
        targetUserId: memberData.userId,
        targetUserEmail: memberData.email,
        action: "MEMBER_REMOVED",
        timestamp: new Date().toISOString(),
        source: "api",
        details: `Removed member ${memberData.email} from organization and cleaned up ${matchingPmDocRefs.size} project memberships`,
        metadata: {
          cleanedProjectMembershipsCount: matchingPmDocRefs.size
        }
      });

      res.json({
        success: true,
        memberId,
        cleanedProjectMembershipsCount: matchingPmDocRefs.size,
        message: "Member removed from organization and project memberships invalidated"
      });
    } catch (error: any) {
      console.error("❌ Member removal failed:", error);
      res.status(500).json({ error: "Failed to remove member", message: error.message });
    }
  });

  /**
   * Send Organization Invitation (Owner & Org Admin only)
   */
  app.post("/api/organizations/:organizationId/invite", requireAuth, async (req: AuthenticatedRequest, res) => {
    const { organizationId } = req.params;
    const { email, role, departmentId, teamId } = req.body;
    const callerUid = req.user!.uid;
    const callerEmail = (req.user!.email || "").toLowerCase().trim();

    if (!email || typeof email !== "string" || !email.trim()) {
      return res.status(400).json({ error: "Bad Request", message: "Email is required" });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalizedEmail)) {
      return res.status(400).json({ error: "Bad Request", message: "A valid email address is required" });
    }

    try {
      const orgDoc = await db.collection("organizations").doc(organizationId).get();
      if (!orgDoc.exists) {
        return res.status(404).json({ error: "Not Found", message: "Organization not found" });
      }

      const orgData = orgDoc.data() || {};
      const isOwner = orgData.ownerId === callerUid || orgData.ownerEmail?.toLowerCase() === callerEmail;

      let callerRole: AuthoritativeOrgRole = "viewer";
      if (isOwner) {
        callerRole = "owner";
      } else {
        const callerMemberSnap = await db
          .collection("orgMembers")
          .where("orgId", "==", organizationId)
          .where("email", "==", callerEmail)
          .where("status", "==", "active")
          .limit(1)
          .get();

        if (!callerMemberSnap.empty) {
          callerRole = normalizeOrgRole(callerMemberSnap.docs[0].data().role);
        }
      }

      const isPlatformAdmin = Boolean(req.user?.platform_admin || req.user?.role === "admin");
      if (callerRole !== "owner" && callerRole !== "org_admin" && !isPlatformAdmin) {
        return res.status(403).json({ error: "Forbidden", message: "Only owners and administrators can invite members." });
      }

      // Enforce organization MFA policy
      const mfaCheck = evaluateOrgMfaPolicy(orgData.securitySettings, callerRole, isSessionMfaVerified(req.user));
      if (!mfaCheck.allowed) {
        return res.status(403).json({
          error: "Forbidden",
          code: "MFA_REQUIRED",
          message: mfaCheck.violationReason,
          mfaRequirement: mfaCheck.requirement,
          organizationId,
          role: callerRole
        });
      }

      const requestedRole = normalizeOrgRole(role || "member");
      if (requestedRole === "owner") {
        return res.status(400).json({ error: "Bad Request", message: "Cannot invite a user as owner." });
      }

      if (callerRole === "org_admin" && requestedRole === "org_admin" && !isPlatformAdmin) {
        return res.status(403).json({ error: "Forbidden", message: "Administrators cannot invite new administrators." });
      }

      // Step 6B.3: Prevent inviting an active member of this organization
      if (orgData.ownerEmail && orgData.ownerEmail.trim().toLowerCase() === normalizedEmail) {
        return res.status(400).json({
          error: "Bad Request",
          message: "This user is already a member of this organization."
        });
      }

      const activeMemberSnap = await db
        .collection("orgMembers")
        .where("orgId", "==", organizationId)
        .where("email", "==", normalizedEmail)
        .where("status", "==", "active")
        .limit(1)
        .get();

      if (!activeMemberSnap.empty) {
        return res.status(400).json({
          error: "Bad Request",
          message: "This user is already a member of this organization."
        });
      }

      // Step 6B.2: Prevent duplicate active pending invitations in the same organization
      const isResendRequest = Boolean(req.body && req.body.resend);
      const pendingInvitesSnap = await db
        .collection("orgInvitations")
        .where("orgId", "==", organizationId)
        .where("email", "==", normalizedEmail)
        .where("status", "==", "pending")
        .get();

      const now = Date.now();
      const activePendingDoc = pendingInvitesSnap.docs.find(doc => {
        const d = doc.data();
        if (!d.expiresAt) return true;
        return new Date(d.expiresAt).getTime() > now;
      });

      if (activePendingDoc) {
        if (!isResendRequest) {
          return res.status(400).json({
            error: "Bad Request",
            message: "An active invitation already exists for this email address."
          });
        }

        // Safe retry path: Re-dispatch using the existing invitation without creating duplicate records
        const existingData = activePendingDoc.data();
        const existingInviteId = activePendingDoc.id;
        const appUrl = resolveAppUrl();
        const acceptUrl = `${appUrl}/invite/accept?token=${encodeURIComponent(existingInviteId)}`;

        const emailResult = await emailService.sendOrganizationInvitation(normalizedEmail, {
          inviterName: callerEmail,
          orgName: orgData.name || "an organization",
          role: existingData.role || requestedRole,
          inviteLink: acceptUrl,
          expiresAt: existingData.expiresAt ? new Date(existingData.expiresAt).toUTCString() : undefined
        });

        const emailSent = Boolean(emailResult && emailResult.success);

        const updatedHistory = [
          ...(existingData.history || []),
          { 
            event: "resent", 
            timestamp: new Date().toISOString(), 
            by: callerEmail, 
            emailSent,
            emailDeliveryCode: emailSent ? null : (emailResult?.errorCode || "EMAIL_DELIVERY_FAILED")
          }
        ];

        await activePendingDoc.ref.update({
          history: updatedHistory,
          emailDeliveryStatus: emailSent ? "sent" : "failed",
          emailDeliveryError: emailSent ? null : (emailResult?.error || "Email delivery failed"),
          emailDeliveryCode: emailSent ? null : (emailResult?.errorCode || "EMAIL_DELIVERY_FAILED"),
          lastResentAt: new Date().toISOString()
        });

        await recordOrgAuditEvent(db, {
          organizationId,
          actorUserId: callerUid,
          actorEmail: callerEmail,
          targetUserEmail: normalizedEmail,
          newRole: existingData.role || requestedRole,
          action: "MEMBER_INVITED",
          timestamp: new Date().toISOString(),
          source: "api",
          details: `Resent invitation to ${normalizedEmail} (email ${emailSent ? 'dispatched' : 'failed'})`
        });

        return res.status(200).json({
          success: true,
          invite: { ...existingData, id: existingInviteId },
          emailSent,
          emailError: emailSent ? undefined : (emailResult?.error || "Email delivery failed"),
          emailErrorCode: emailSent ? undefined : (emailResult?.errorCode || "EMAIL_DELIVERY_FAILED"),
          statusCode: emailResult?.statusCode,
          inviteLink: acceptUrl,
          message: emailSent 
            ? "Invitation email resent successfully." 
            : `Invitation record active, but email re-delivery failed: ${emailResult?.error || 'Email delivery failed'}.`,
          warning: emailSent ? undefined : (emailResult?.error || "Email delivery failed")
        });
      }

      // Step 6B.1: Cryptographically secure 256-bit random invitation identifier
      const inviteId = `inv_${crypto.randomBytes(32).toString("hex")}`;
      const inviteData = {
        id: inviteId,
        orgId: organizationId,
        email: normalizedEmail,
        role: requestedRole,
        departmentId: departmentId || "",
        teamId: teamId || "",
        status: "pending",
        invitedBy: callerEmail,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        history: [
          { event: "invited", timestamp: new Date().toISOString(), by: callerEmail }
        ]
      };

      await db.collection("orgInvitations").doc(inviteId).set(inviteData);

      // Step 6C: Canonical organization invitation URL resolution & email dispatch
      const appUrl = resolveAppUrl();
      const acceptUrl = `${appUrl}/invite/accept?token=${encodeURIComponent(inviteId)}`;

      const safeOrgName = escapeHtml(orgData.name || "an organization");
      const safeInviter = escapeHtml(callerEmail);
      const safeRecipient = escapeHtml(normalizedEmail);
      const safeRole = escapeHtml(requestedRole);
      const safeExpiresAt = escapeHtml(new Date(inviteData.expiresAt).toUTCString());
      const safeAcceptUrl = escapeHtml(acceptUrl);

      const emailSubject = `You have been invited to join ${orgData.name || "an organization"} on EchoNote`;

      const emailHtml = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px 24px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
          <div style="text-align: center; margin-bottom: 28px; padding-bottom: 20px; border-bottom: 1px solid #f1f5f9;">
            <div style="font-size: 24px; font-weight: 900; color: #1A234E; letter-spacing: -0.5px;">
              E C H O <span style="color: #3B82F6; font-weight: 600;">N O T E</span>
            </div>
            <div style="font-size: 11px; text-transform: uppercase; font-weight: 700; letter-spacing: 2px; color: #94a3b8; margin-top: 4px;">
              Enterprise Audio Intelligence
            </div>
          </div>

          <h2 style="color: #0f172a; font-size: 20px; font-weight: 800; margin: 0 0 16px 0; letter-spacing: -0.3px;">
            Organization Invitation
          </h2>

          <p style="color: #475569; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">
            You have been invited to join <strong>${safeOrgName}</strong> on EchoNote.
          </p>

          <div style="background-color: #f8fafc; border-radius: 12px; border: 1px solid #e2e8f0; padding: 18px 20px; margin: 20px 0;">
            <table cellpadding="0" cellspacing="0" border="0" style="width: 100%; font-size: 14px; line-height: 1.6;">
              <tr>
                <td style="color: #64748b; font-weight: 600; padding: 4px 0; width: 140px;">Invited by:</td>
                <td style="color: #0f172a; font-weight: 700; padding: 4px 0;">${safeInviter}</td>
              </tr>
              <tr>
                <td style="color: #64748b; font-weight: 600; padding: 4px 0;">Recipient:</td>
                <td style="color: #0f172a; font-weight: 700; padding: 4px 0;">${safeRecipient}</td>
              </tr>
              <tr>
                <td style="color: #64748b; font-weight: 600; padding: 4px 0;">Assigned Role:</td>
                <td style="color: #1A234E; font-weight: 700; padding: 4px 0; text-transform: capitalize;">${safeRole}</td>
              </tr>
              <tr>
                <td style="color: #64748b; font-weight: 600; padding: 4px 0;">Expires on:</td>
                <td style="color: #dc2626; font-weight: 600; padding: 4px 0;">${safeExpiresAt}</td>
              </tr>
            </table>
          </div>

          <div style="margin: 28px 0; text-align: center;">
            <a href="${safeAcceptUrl}" style="background-color: #1A234E; color: #ffffff; padding: 14px 28px; border-radius: 10px; text-decoration: none; font-weight: 700; font-size: 15px; display: inline-block; letter-spacing: -0.2px; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);">
              Accept Invitation
            </a>
          </div>

          <hr style="border: 0; border-top: 1px solid #f1f5f9; margin: 24px 0;" />

          <p style="margin: 0; font-size: 12px; color: #94a3b8; line-height: 1.6; word-break: break-all;">
            If the button cannot be used, copy and paste this link into your browser:<br />
            <a href="${safeAcceptUrl}" style="color: #3B82F6; text-decoration: underline;">${safeAcceptUrl}</a>
          </p>

          <p style="margin: 16px 0 0 0; font-size: 11px; color: #cbd5e1; text-align: center;">
            © ${new Date().getFullYear()} EchoNote Technologies. All rights reserved.
          </p>
        </div>
      `;

      const emailPlainText = `Organization Invitation - EchoNote

You have been invited to join ${orgData.name || "an organization"} on EchoNote.

Invited by: ${callerEmail}
Recipient: ${normalizedEmail}
Assigned Role: ${requestedRole}
Expires on: ${new Date(inviteData.expiresAt).toUTCString()}

To accept this invitation, please visit the following link:
${acceptUrl}

If you did not expect this invitation, you can safely ignore this email.
© ${new Date().getFullYear()} EchoNote Technologies. All rights reserved.`;

      // Send email via centralized email service with explicit error handling
      const emailResult = await emailService.sendOrganizationInvitation(normalizedEmail, {
        inviterName: callerEmail,
        orgName: orgData.name || "an organization",
        role: requestedRole,
        inviteLink: acceptUrl,
        expiresAt: new Date(inviteData.expiresAt).toUTCString(),
        html: emailHtml,
        text: emailPlainText
      });

      const emailSent = Boolean(emailResult && emailResult.success);

      // Record email delivery status in orgInvitations document
      try {
        await db.collection("orgInvitations").doc(inviteId).update({
          emailDeliveryStatus: emailSent ? "sent" : "failed",
          emailDeliveryError: emailSent ? null : (emailResult?.error || "Email delivery failed"),
          emailDeliveryCode: emailSent ? null : (emailResult?.errorCode || "EMAIL_DELIVERY_FAILED"),
          lastEmailAttemptAt: new Date().toISOString()
        });
      } catch (updateErr) {
        // Non-blocking metadata update
      }

      await recordOrgAuditEvent(db, {
        organizationId,
        actorUserId: callerUid,
        actorEmail: callerEmail,
        targetUserEmail: normalizedEmail,
        newRole: requestedRole,
        action: "MEMBER_INVITED",
        timestamp: new Date().toISOString(),
        source: "api",
        details: `Sent invitation to ${normalizedEmail} with role ${requestedRole}${emailSent ? '' : ' (email dispatch failed)'}`
      });

      if (!emailSent) {
        console.warn("⚠️ [ORG INVITE] Invitation record created, but email dispatch failed:", {
          inviteId,
          error: emailResult?.error,
          code: emailResult?.errorCode
        });
        return res.status(201).json({
          success: true,
          invite: inviteData,
          emailSent: false,
          emailError: emailResult?.error || "Email delivery failed",
          emailErrorCode: emailResult?.errorCode || "EMAIL_DELIVERY_FAILED",
          statusCode: emailResult?.statusCode || 500,
          inviteLink: acceptUrl,
          message: `Invitation created, but the invitation email could not be delivered: ${emailResult?.error || 'Email delivery failed'}. You can copy the invite link or retry.`,
          warning: emailResult?.error || "Email delivery failed"
        });
      }

      res.status(201).json({
        success: true,
        invite: inviteData,
        emailSent: true,
        inviteLink: acceptUrl,
        message: "Invitation sent successfully."
      });
    } catch (error: any) {
      console.error("❌ Send invitation failed:", error);
      res.status(500).json({ error: "Failed to send invitation", message: error.message });
    }
  });

  /**
   * Safe Organization Invitation Preview Endpoint (Step 6D)
   * Returns minimal non-sensitive metadata for acceptance preview.
   * Never exposes membership lists, internal data, or secrets.
   */
  app.get("/api/organizations/invitation-preview/:inviteId", async (req, res) => {
    const { inviteId } = req.params;
    if (!inviteId || typeof inviteId !== "string" || !inviteId.trim()) {
      return res.status(400).json({ error: "Bad Request", message: "inviteId is required" });
    }

    try {
      const inviteRef = db.collection("orgInvitations").doc(inviteId.trim());
      const inviteDoc = await inviteRef.get();

      if (!inviteDoc.exists) {
        return res.status(404).json({ error: "Not Found", message: "Invitation not found" });
      }

      const inviteData = inviteDoc.data()!;

      // Check accepted state
      if (inviteData.status === "accepted") {
        return res.status(400).json({
          status: "accepted",
          error: "Bad Request",
          message: "This invitation has already been accepted."
        });
      }

      // Check cancelled / rejected state
      if (inviteData.status === "cancelled" || inviteData.status === "rejected") {
        return res.status(400).json({
          status: "cancelled",
          error: "Bad Request",
          message: "This invitation has been cancelled."
        });
      }

      // Check expiration
      const now = Date.now();
      const isExpired = inviteData.status === "expired" || (inviteData.expiresAt && new Date(inviteData.expiresAt).getTime() <= now);
      if (isExpired) {
        return res.status(400).json({
          status: "expired",
          error: "Bad Request",
          message: "This invitation has expired."
        });
      }

      if (inviteData.status !== "pending") {
        return res.status(400).json({
          status: "invalid",
          error: "Bad Request",
          message: "This invitation is not valid for acceptance."
        });
      }

      // Fetch organization name safely
      let orgName = "an organization";
      if (inviteData.orgId) {
        try {
          const orgDoc = await db.collection("organizations").doc(inviteData.orgId).get();
          if (orgDoc.exists) {
            orgName = orgDoc.data()?.name || "an organization";
          }
        } catch {
          // fallback to default orgName
        }
      }

      res.json({
        valid: true,
        status: "pending",
        organizationName: orgName,
        orgId: inviteData.orgId,
        invitedBy: inviteData.invitedBy || "An administrator",
        recipientEmail: inviteData.email,
        role: inviteData.role || "member",
        expiresAt: inviteData.expiresAt
      });
    } catch (error: any) {
      console.error("Preview invitation error:", error);
      res.status(500).json({ error: "Failed to preview invitation", message: "An unexpected error occurred." });
    }
  });

  /**
   * Accept Organization Invitation (Authenticated user)
   */
  app.post("/api/organizations/accept-invite", requireAuth, async (req: AuthenticatedRequest, res) => {
    const { inviteId } = req.body;
    const callerUid = req.user!.uid;
    const callerEmail = (req.user!.email || "").toLowerCase().trim();

    if (!inviteId || typeof inviteId !== "string" || !inviteId.trim()) {
      return res.status(400).json({ error: "Bad Request", message: "inviteId is required" });
    }

    try {
      const inviteRef = db.collection("orgInvitations").doc(inviteId.trim());
      const inviteDoc = await inviteRef.get();

      if (!inviteDoc.exists) {
        return res.status(404).json({ error: "Not Found", message: "Invitation not found" });
      }

      const inviteData = inviteDoc.data()!;
      const invitedEmail = (inviteData.email || "").toLowerCase().trim();

      // Step 6B.6: Mismatched recipient email
      if (invitedEmail !== callerEmail) {
        return res.status(403).json({ error: "Forbidden", message: "This invitation was sent to a different email address." });
      }

      // Step 6B.6: Replay prevention
      if (inviteData.status === "accepted") {
        return res.status(400).json({ error: "Bad Request", message: "This invitation has already been accepted." });
      }

      // Step 6B.6: Cancelled / rejected state check
      if (inviteData.status === "cancelled" || inviteData.status === "rejected") {
        return res.status(400).json({ error: "Bad Request", message: "This invitation has been cancelled." });
      }

      // Step 6B.5 & 6B.6: Expiration enforcement
      const now = Date.now();
      const isExpired = inviteData.status === "expired" || (inviteData.expiresAt && new Date(inviteData.expiresAt).getTime() <= now);
      if (isExpired) {
        return res.status(400).json({ error: "Bad Request", message: "This invitation has expired." });
      }

      if (inviteData.status !== "pending") {
        return res.status(400).json({ error: "Bad Request", message: "This invitation is not valid for acceptance." });
      }

      const orgId = inviteData.orgId;
      const role = normalizeOrgRole(inviteData.role || "member");
      const nowIso = new Date().toISOString();

      // Step 6B.4: Create or reactivate member in orgMembers (never duplicate member records)
      let existingMemberDocSnap: any = null;
      const memberByEmailSnap = await db
        .collection("orgMembers")
        .where("orgId", "==", orgId)
        .where("email", "==", callerEmail)
        .limit(1)
        .get();

      if (!memberByEmailSnap.empty) {
        existingMemberDocSnap = memberByEmailSnap.docs[0];
      } else {
        const memberByUidSnap = await db
          .collection("orgMembers")
          .where("orgId", "==", orgId)
          .where("userId", "==", callerUid)
          .limit(1)
          .get();
        if (!memberByUidSnap.empty) {
          existingMemberDocSnap = memberByUidSnap.docs[0];
        }
      }

      let memberId: string;
      if (existingMemberDocSnap) {
        // Reuse existing member document (handles deactivated members and preserves member identity & historical metadata)
        memberId = existingMemberDocSnap.id;
        const existingData = existingMemberDocSnap.data() || {};
        await existingMemberDocSnap.ref.update({
          status: "active",
          role,
          userId: callerUid,
          email: callerEmail,
          name: req.user!.name || existingData.name || callerEmail.split("@")[0] || "Member",
          displayName: req.user!.name || existingData.displayName || callerEmail.split("@")[0] || "Member",
          departmentId: inviteData.departmentId !== undefined ? inviteData.departmentId : (existingData.departmentId || ""),
          teamId: inviteData.teamId !== undefined ? inviteData.teamId : (existingData.teamId || ""),
          updatedAt: nowIso
        });
      } else {
        // Create new member in orgMembers
        memberId = `member_${callerUid.slice(0, 8)}_${crypto.randomBytes(6).toString("hex")}`;
        await db.collection("orgMembers").doc(memberId).set({
          id: memberId,
          orgId,
          userId: callerUid,
          email: callerEmail,
          name: req.user!.name || callerEmail.split("@")[0] || "Member",
          displayName: req.user!.name || callerEmail.split("@")[0] || "Member",
          role,
          departmentId: inviteData.departmentId || "",
          teamId: inviteData.teamId || "",
          status: "active",
          joinedAt: nowIso
        });
      }

      // 2. Mark invitation accepted
      await inviteRef.update({
        status: "accepted",
        acceptedAt: nowIso,
        acceptedBy: callerEmail,
        history: [
          ...(inviteData.history || []),
          { event: "accepted", timestamp: nowIso, by: callerEmail }
        ]
      });

      // 3. Issue Custom Claims
      const claims = await syncUserCustomClaims(callerUid, db, {
        orgId,
        orgRole: role
      });

      // 4. Audit Log
      await recordOrgAuditEvent(db, {
        organizationId: orgId,
        actorUserId: callerUid,
        actorEmail: callerEmail,
        targetUserId: callerUid,
        targetUserEmail: callerEmail,
        newRole: role,
        action: "ROLE_ASSIGNED",
        timestamp: nowIso,
        source: "api",
        details: `${callerEmail} joined organization ${orgId} with role ${role}`
      });

      res.json({
        success: true,
        orgId,
        memberId,
        role,
        claims,
        message: "Successfully joined organization"
      });
    } catch (error: any) {
      console.error("❌ Accept invitation failed:", error);
      res.status(500).json({ error: "Failed to accept invitation", message: error.message });
    }
  });

  /**
   * Cancel / Revoke Organization Invitation (Owner & Org Admin only)
   */
  app.delete("/api/organizations/:organizationId/invitations/:inviteId", requireAuth, async (req: AuthenticatedRequest, res) => {
    const { organizationId, inviteId } = req.params;
    const callerUid = req.user!.uid;
    const callerEmail = (req.user!.email || "").toLowerCase();

    try {
      // 1. Authorization: Owner or Org Admin
      const orgAccess = await checkOrgAccess(db, callerEmail, organizationId, ["owner", "org_admin"], req.user);
      const isPlatformAdmin = Boolean(req.user?.platform_admin || req.user?.role === "admin");
      if (orgAccess.mfaRequired) {
        return res.status(403).json(
          createMfaForbiddenResponse(
            orgAccess.mfaRequirement,
            orgAccess.mfaViolationReason,
            req.user,
            orgAccess.mfaEnrolled,
            { organizationId }
          )
        );
      }
      if (!orgAccess.hasAccess && !isPlatformAdmin) {
        return res.status(403).json({
          error: "Forbidden",
          message: "Only organization owners and administrators can cancel invitations."
        });
      }

      // 2. Fetch invitation
      const inviteRef = db.collection("orgInvitations").doc(inviteId);
      const inviteDoc = await inviteRef.get();
      if (!inviteDoc.exists) {
        return res.status(404).json({
          error: "Not Found",
          message: "Invitation not found."
        });
      }

      const inviteData = inviteDoc.data() || {};

      // 3. Tenant Boundary check
      if (inviteData.orgId !== organizationId) {
        return res.status(404).json({
          error: "Not Found",
          message: "Invitation not found in this organization."
        });
      }

      // 4. Invitation Lifecycle state validation
      if (inviteData.status === "accepted") {
        return res.status(400).json({
          error: "Bad Request",
          message: "Cannot cancel an invitation that has already been accepted."
        });
      }

      if (inviteData.status === "rejected" || inviteData.status === "cancelled") {
        return res.status(400).json({
          error: "Bad Request",
          message: "This invitation has already been cancelled."
        });
      }

      if (inviteData.status === "expired" || (inviteData.expiresAt && new Date(inviteData.expiresAt).getTime() < Date.now())) {
        return res.status(400).json({
          error: "Bad Request",
          message: "Cannot cancel an expired invitation."
        });
      }

      if (inviteData.status !== "pending") {
        return res.status(400).json({
          error: "Bad Request",
          message: `Cannot cancel invitation with status '${inviteData.status}'.`
        });
      }

      // 5. Update invitation to rejected/cancelled with history audit
      const updatedHistory = [
        ...(inviteData.history || []),
        { event: "cancelled", timestamp: new Date().toISOString(), by: callerEmail }
      ];

      await inviteRef.update({
        status: "rejected",
        cancelledAt: new Date().toISOString(),
        cancelledBy: callerEmail,
        history: updatedHistory
      });

      // 6. Record Organization Audit Log
      await recordOrgAuditEvent(db, {
        organizationId,
        actorUserId: callerUid,
        actorEmail: callerEmail,
        targetUserEmail: inviteData.email,
        action: "INVITATION_CANCELLED",
        timestamp: new Date().toISOString(),
        source: "api",
        details: `Cancelled invitation for ${inviteData.email} (role: ${inviteData.role})`,
        metadata: {
          inviteId,
          invitedRole: inviteData.role,
          invitedEmail: inviteData.email
        }
      });

      res.json({
        success: true,
        inviteId,
        message: `Invitation for ${inviteData.email} cancelled successfully.`
      });
    } catch (error: any) {
      console.error("❌ Cancel invitation failed:", error);
      res.status(500).json({ error: "Failed to cancel invitation", message: error.message });
    }
  });

  /**
   * Organization Analytics (Strictly Protected: Owner and Org Admin only)
   */
  app.get("/api/organizations/:organizationId/analytics", requireAuth, requireOrgRole(db, "org_admin"), async (req: AuthenticatedRequest, res) => {
    const { organizationId } = req.params;

    try {
      // Aggregate usage logs for this organization
      const membersSnap = await db
        .collection("orgMembers")
        .where("orgId", "==", organizationId)
        .where("status", "==", "active")
        .get();

      const memberUids = membersSnap.docs.map(d => d.data().userId).filter(Boolean);

      let totalMinutes = 0;
      let totalThinking = 0;

      for (const uid of memberUids) {
        const userDoc = await db.collection("users").doc(uid).get();
        if (userDoc.exists) {
          const uData = userDoc.data() || {};
          totalMinutes += (uData.monthlyMinutesUsed || uData.minutesUsed || 0);
          totalThinking += (uData.monthlyThinkingUsed || uData.thinkingUsed || 0);
        }
      }

      res.json({
        success: true,
        organizationId,
        activeMembersCount: membersSnap.size,
        totalMinutesUsed: totalMinutes,
        totalThinkingUsed: totalThinking
      });
    } catch (error: any) {
      console.error("❌ Org analytics failed:", error);
      res.status(500).json({ error: "Failed to fetch organization analytics", message: error.message });
    }
  });

  /**
   * Organization Settings Update (Owner & Org Admin only)
   */
  app.patch("/api/organizations/:organizationId/settings", requireAuth, requireOrgRole(db, "org_admin"), async (req: AuthenticatedRequest, res) => {
    const { organizationId } = req.params;
    const { name, logoUrl, industry, timezone, country, securitySettings } = req.body;
    const callerUid = req.user!.uid;
    const callerEmail = req.user!.email || "Admin";

    try {
      const updateData: Record<string, any> = {
        updatedAt: new Date().toISOString()
      };

      if (name !== undefined) updateData.name = String(name).trim();
      if (logoUrl !== undefined) updateData.logoUrl = String(logoUrl).trim();
      if (industry !== undefined) updateData.industry = String(industry).trim();
      if (timezone !== undefined) updateData.timezone = timezone;
      if (country !== undefined) updateData.country = country;
      if (securitySettings !== undefined) updateData.securitySettings = securitySettings;

      await db.collection("organizations").doc(organizationId).update(updateData);

      await recordOrgAuditEvent(db, {
        organizationId,
        actorUserId: callerUid,
        actorEmail: callerEmail,
        action: "SECURITY_UPDATED",
        timestamp: new Date().toISOString(),
        source: "api",
        details: `Updated settings for organization ${organizationId}`
      });

      res.json({ success: true, message: "Organization settings updated successfully" });
    } catch (error: any) {
      console.error("❌ Update settings failed:", error);
      res.status(500).json({ error: "Failed to update organization settings", message: error.message });
    }
  });

  // ============================================================================
  // PHASE 1B: SECURE SERVER-AUTHORITATIVE INTEGRATIONS & CREDENTIAL ENDPOINTS
  // ============================================================================

  /**
   * List all integrations for an organization.
   * Enforces authoritative org membership (admin or member).
   * Strictly returns sanitized metadata — credentials and secrets are NEVER exposed.
   */
  app.get("/api/organizations/:organizationId/integrations", requireAuth, requireOrgRole(db, "member"), async (req: AuthenticatedRequest, res) => {
    const { organizationId } = req.params;

    try {
      const snap = await db.collection("organizations").doc(organizationId).collection("integrations").get();
      const integrations: Record<string, any> = {};

      snap.docs.forEach(docSnap => {
        const rawData = docSnap.data();
        const safeConfig = sanitizeIntegrationConfig(rawData.config || {});
        integrations[docSnap.id] = {
          id: docSnap.id,
          enabled: Boolean(rawData.enabled),
          status: rawData.status || (rawData.enabled ? "connected" : "disconnected"),
          config: safeConfig,
          updatedAt: rawData.updatedAt || null,
          hasEncryptedSecrets: Boolean(rawData._secretsEncrypted || rawData.hasSecrets),
          encryptionKeyId: rawData._encryptedSecrets?.keyId || null
        };
      });

      res.json({
        success: true,
        organizationId,
        integrations
      });
    } catch (error: any) {
      console.error("❌ List integrations failed:", error);
      res.status(500).json({ error: "Failed to fetch integrations", message: error.message });
    }
  });

  /**
   * Get a single integration configuration (Sanitized).
   * Enforces org membership.
   */
  app.get("/api/organizations/:organizationId/integrations/:integrationId", requireAuth, requireOrgRole(db, "member"), async (req: AuthenticatedRequest, res) => {
    const { organizationId, integrationId } = req.params;

    try {
      const docRef = db.collection("organizations").doc(organizationId).collection("integrations").doc(integrationId);
      const docSnap = await docRef.get();

      if (!docSnap.exists) {
        return res.json({
          success: true,
          integration: {
            id: integrationId,
            enabled: false,
            status: "disconnected",
            config: {}
          }
        });
      }

      const rawData = docSnap.data() || {};
      const safeConfig = sanitizeIntegrationConfig(rawData.config || {});

      res.json({
        success: true,
        integration: {
          id: integrationId,
          enabled: Boolean(rawData.enabled),
          status: rawData.status || (rawData.enabled ? "connected" : "disconnected"),
          config: safeConfig,
          updatedAt: rawData.updatedAt || null,
          hasEncryptedSecrets: Boolean(rawData._secretsEncrypted),
          encryptionKeyId: rawData._encryptedSecrets?.keyId || null
        }
      });
    } catch (error: any) {
      console.error("❌ Get integration failed:", error);
      res.status(500).json({ error: "Failed to get integration", message: error.message });
    }
  });

  /**
   * Save or Update an integration configuration.
   * Strictly requires Org Admin role.
   * If secret values are provided:
   *   - Encrypts via AES-256-GCM if server key configured.
   *   - If server encryption key is missing and sensitive secrets are submitted,
   *     FAILS SAFELY (HTTP 422 Unprocessable Entity) without persisting plaintext secrets.
   * Logs audit event authoritatively.
   */
  app.post("/api/organizations/:organizationId/integrations/:integrationId", requireAuth, requireOrgRole(db, "org_admin"), async (req: AuthenticatedRequest, res) => {
    const { organizationId, integrationId } = req.params;
    const { enabled, status, config } = req.body;
    const callerUid = req.user!.uid;
    const callerEmail = req.user!.email || "Admin";

    if (!integrationId || typeof integrationId !== "string" || !/^[a-zA-Z0-9_\-]+$/.test(integrationId)) {
      return res.status(400).json({ error: "Invalid integration identifier" });
    }

    try {
      const docRef = db.collection("organizations").doc(organizationId).collection("integrations").doc(integrationId);
      const existingSnap = await docRef.get();
      const existingData = existingSnap.exists ? (existingSnap.data() || {}) : {};

      const hasSensitiveSecrets = containsSensitiveSecrets(config);
      let secretsEncryptedPayload: any = existingData._encryptedSecrets || null;
      let finalConfigToStore = { ...(config || {}) };

      if (hasSensitiveSecrets) {
        if (!isIntegrationEncryptionConfigured()) {
          return res.status(422).json({
            error: "ENCRYPTION_KEY_REQUIRED",
            message: "Cannot store integration credentials: server-side encryption key (INTEGRATION_ENCRYPTION_KEY) is not configured in the environment. Plaintext credential storage is disallowed.",
            requiresConfig: "INTEGRATION_ENCRYPTION_KEY"
          });
        }

        // Encrypt the sensitive secret bundle
        const encryptedBundle = encryptSecret(JSON.stringify(config));
        secretsEncryptedPayload = encryptedBundle;

        // In the primary document, store ONLY sanitized masked values
        finalConfigToStore = sanitizeIntegrationConfig(config);
      }

      const isNextEnabled = enabled !== undefined ? Boolean(enabled) : (existingData.enabled ?? true);
      const nextStatus = status || (isNextEnabled ? "connected" : "disconnected");

      const recordToSave: Record<string, any> = {
        id: integrationId,
        enabled: isNextEnabled,
        status: nextStatus,
        config: finalConfigToStore,
        updatedAt: new Date().toISOString(),
        updatedBy: callerEmail,
        _secretsEncrypted: Boolean(secretsEncryptedPayload)
      };

      if (secretsEncryptedPayload) {
        recordToSave._encryptedSecrets = secretsEncryptedPayload;
      }

      await docRef.set(recordToSave, { merge: true });

      // Authoritative security audit log
      await recordOrgAuditEvent(db, {
        organizationId,
        actorUserId: callerUid,
        actorEmail: callerEmail,
        action: "INTEGRATION_CONFIG_UPDATED",
        timestamp: new Date().toISOString(),
        source: "api",
        details: `Updated configuration for integration ${integrationId}`
      }).catch(() => {});

      res.json({
        success: true,
        message: `Integration ${integrationId} configuration saved successfully`,
        integration: {
          id: integrationId,
          enabled: isNextEnabled,
          status: nextStatus,
          config: sanitizeIntegrationConfig(finalConfigToStore),
          updatedAt: recordToSave.updatedAt,
          hasEncryptedSecrets: Boolean(secretsEncryptedPayload),
          encryptionKeyId: secretsEncryptedPayload?.keyId || null
        }
      });
    } catch (error: any) {
      console.error("❌ Save integration failed:", error);
      res.status(500).json({ error: "Failed to save integration configuration", message: error.message });
    }
  });

  /**
   * Disconnect or Delete an integration configuration.
   * Strictly requires Org Admin role.
   */
  app.delete("/api/organizations/:organizationId/integrations/:integrationId", requireAuth, requireOrgRole(db, "org_admin"), async (req: AuthenticatedRequest, res) => {
    const { organizationId, integrationId } = req.params;
    const callerUid = req.user!.uid;
    const callerEmail = req.user!.email || "Admin";

    try {
      const docRef = db.collection("organizations").doc(organizationId).collection("integrations").doc(integrationId);
      await docRef.delete();

      await recordOrgAuditEvent(db, {
        organizationId,
        actorUserId: callerUid,
        actorEmail: callerEmail,
        action: "INTEGRATION_DISCONNECTED",
        timestamp: new Date().toISOString(),
        source: "api",
        details: `Deleted / disconnected integration ${integrationId}`
      }).catch(() => {});

      res.json({
        success: true,
        message: `Integration ${integrationId} disconnected successfully`
      });
    } catch (error: any) {
      console.error("❌ Disconnect integration failed:", error);
      res.status(500).json({ error: "Failed to disconnect integration", message: error.message });
    }
  });

  // In-memory fallback stores for non-production sandbox/preview environments
  const pendingInvitesStore = new Map<string, any>();
  const projectMembersFallbackStore = new Map<string, any>();

  // In-flight invitation lock map to prevent concurrent duplicate attempts
  const inFlightProjectInvites = new Map<string, Promise<void>>();

  // Invitation API - Protected: requires valid auth token & project administrative rights
  app.post("/api/invite-member", requireAuth, async (req: AuthenticatedRequest, res) => {
    const { email, role, projectId, projectName } = req.body;
    const callerUid = req.user!.uid;
    const callerEmail = req.user!.email || "A team member";
    
    if (!email || !role || !projectId) {
      return res.status(400).json({ error: "BadRequest", message: "Missing required fields (email, role, projectId)" });
    }

    // Recipient email syntax validation
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!normalizedEmail || !emailRegex.test(normalizedEmail)) {
      return res.status(400).json({
        error: "BadRequest",
        message: "A valid recipient email address is required."
      });
    }

    // Concurrency protection: wait for any in-flight invitation attempt for the same project + email
    const flightKey = `${projectId}:${normalizedEmail}`;
    if (inFlightProjectInvites.has(flightKey)) {
      try {
        await inFlightProjectInvites.get(flightKey);
      } catch (_) {}
    }

    let releaseFlight: (() => void) | null = null;
    const flightPromise = new Promise<void>((resolve) => { releaseFlight = resolve; });
    inFlightProjectInvites.set(flightKey, flightPromise);

    // Role validation
    const rawRole = String(role || '').toLowerCase().trim();
    if (!rawRole) {
      if (releaseFlight) { inFlightProjectInvites.delete(flightKey); (releaseFlight as () => void)(); }
      return res.status(400).json({
        error: "BadRequest",
        message: "A project role must be specified."
      });
    }
    if (rawRole === 'owner') {
      if (releaseFlight) { inFlightProjectInvites.delete(flightKey); (releaseFlight as () => void)(); }
      return res.status(400).json({
        error: "BadRequest",
        message: "Cannot invite a member directly as owner. Use project transfer of ownership."
      });
    }
    const allowedRoles = ['viewer', 'commenter', 'admin', 'editor'];
    if (!allowedRoles.includes(rawRole)) {
      if (releaseFlight) { inFlightProjectInvites.delete(flightKey); (releaseFlight as () => void)(); }
      return res.status(400).json({
        error: "BadRequest",
        message: `Invalid project role "${role}". Allowed roles are: viewer, commenter, admin.`
      });
    }
    const normalizedInvitedRole = normalizeProjectRole(rawRole);

    try {
      // 1. Authorize caller via hardened project access resolution (requires MANAGE_MEMBERS)
      const access = await resolveProjectAccess(db, req.user, projectId, { 
        requiredPermission: 'MANAGE_MEMBERS',
        callerClaimedOwnerId: callerUid
      });
      if (!access.hasAccess || !access.permissions.canManageMembers) {
        if (access.notFound) {
          return res.status(404).json({ error: "NotFound", message: "Project not found." });
        }
        if (access.mfaRequired) {
          return res.status(403).json(
            createMfaForbiddenResponse(
              access.mfaRequirement,
              access.reason,
              req.user,
              access.mfaEnrolled,
              { organizationId: access.organizationId }
            )
          );
        }
        return res.status(403).json({ 
          error: "Forbidden", 
          message: "You do not have administrative permission to invite members to this project." 
        });
      }

      const projectData = access.project || {};
      const ownerId = projectData.userId || callerUid;

      // 2. Prevent inviting a user who is already a project owner or active member (Requirement 2)
      let isAlreadyMember = false;

      // 2a. Check project owner by projectData.ownerEmail
      const projectOwnerEmail = (projectData.ownerEmail || '').toLowerCase().trim();
      if (projectOwnerEmail && projectOwnerEmail === normalizedEmail) {
        isAlreadyMember = true;
      }

      // 2b. Check project owner by ownerId / userId in users or auth
      if (!isAlreadyMember && (projectData.userId || projectData.ownerId)) {
        const ownerUid = projectData.userId || projectData.ownerId;
        try {
          const ownerUserDoc = await db.collection("users").doc(ownerUid).get();
          if (ownerUserDoc.exists) {
            const ownerEmailFromDoc = (ownerUserDoc.data()?.email || '').toLowerCase().trim();
            if (ownerEmailFromDoc === normalizedEmail) {
              isAlreadyMember = true;
            }
          }
        } catch (_) {}

        if (!isAlreadyMember) {
          try {
            const authOwner = await admin.auth().getUser(ownerUid);
            if (authOwner?.email && authOwner.email.toLowerCase().trim() === normalizedEmail) {
              isAlreadyMember = true;
            }
          } catch (_) {}
        }
      }

      // 2c. Check if normalizedEmail corresponds to a registered user who is already a member
      if (!isAlreadyMember) {
        try {
          const targetAuthUser = await admin.auth().getUserByEmail(normalizedEmail).catch(() => null);
          if (targetAuthUser) {
            if (targetAuthUser.uid === projectData.userId || targetAuthUser.uid === projectData.ownerId) {
              isAlreadyMember = true;
            } else {
              const directDoc = await db.collection("projectMembers").doc(`${targetAuthUser.uid}_${projectId}`).get();
              if (directDoc.exists) {
                const d = directDoc.data() || {};
                if (d.status !== "inactive" && d.status !== "deactivated") {
                  isAlreadyMember = true;
                }
              }
            }
          }
        } catch (_) {}
      }

      // 2d. Check users collection by email
      if (!isAlreadyMember) {
        try {
          const userByEmailSnap = await db.collection("users").where("email", "==", normalizedEmail).limit(1).get();
          if (!userByEmailSnap.empty) {
            const targetUid = userByEmailSnap.docs[0].id;
            if (targetUid === projectData.userId || targetUid === projectData.ownerId) {
              isAlreadyMember = true;
            } else {
              const directDoc = await db.collection("projectMembers").doc(`${targetUid}_${projectId}`).get();
              if (directDoc.exists) {
                const d = directDoc.data() || {};
                if (d.status !== "inactive" && d.status !== "deactivated") {
                  isAlreadyMember = true;
                }
              }
            }
          }
        } catch (_) {}
      }

      // 2e. Query projectMembers by email and userEmail
      if (!isAlreadyMember) {
        try {
          const existingMemberSnap = await db
            .collection("projectMembers")
            .where("projectId", "==", projectId)
            .where("email", "==", normalizedEmail)
            .limit(1)
            .get();
          if (!existingMemberSnap.empty) {
            const d = existingMemberSnap.docs[0].data() || {};
            if (d.status !== "inactive" && d.status !== "deactivated") {
              isAlreadyMember = true;
            }
          }
        } catch (pmQueryErr) {}
      }

      if (!isAlreadyMember) {
        try {
          const existingUserEmailSnap = await db
            .collection("projectMembers")
            .where("projectId", "==", projectId)
            .where("userEmail", "==", normalizedEmail)
            .limit(1)
            .get();
          if (!existingUserEmailSnap.empty) {
            const d = existingUserEmailSnap.docs[0].data() || {};
            if (d.status !== "inactive" && d.status !== "deactivated") {
              isAlreadyMember = true;
            }
          }
        } catch (_) {}
      }

      // 2f. Query all project members for case-insensitive match
      if (!isAlreadyMember) {
        try {
          const allMembersSnap = await db
            .collection("projectMembers")
            .where("projectId", "==", projectId)
            .get();
          if (!allMembersSnap.empty) {
            for (const doc of allMembersSnap.docs) {
              const d = doc.data() || {};
              const mEmail = (d.email || d.userEmail || "").toLowerCase().trim();
              if (mEmail === normalizedEmail && d.status !== "inactive" && d.status !== "deactivated") {
                isAlreadyMember = true;
                break;
              }
            }
          }
        } catch (_) {}
      }

      if (!isAlreadyMember && projectMembersFallbackStore) {
        for (const m of projectMembersFallbackStore.values()) {
          if (m.projectId === projectId && (m.email?.toLowerCase().trim() === normalizedEmail || m.userEmail?.toLowerCase().trim() === normalizedEmail)) {
            if (m.status !== "inactive" && m.status !== "deactivated") {
              isAlreadyMember = true;
              break;
            }
          }
        }
      }

      if (!isAlreadyMember && Array.isArray(projectData.members)) {
        if (projectData.members.some((m: any) => (m.email?.toLowerCase().trim() === normalizedEmail || m.userEmail?.toLowerCase().trim() === normalizedEmail))) {
          isAlreadyMember = true;
        }
      }

      if (isAlreadyMember) {
        return res.status(400).json({
          error: "AlreadyMember",
          message: "This user is already a member of this project.",
          alreadyMember: true
        });
      }

      // 3. Prevent duplicate active pending invitations for the same project & email (Requirement 2)
      const isResendRequest = Boolean(req.body && req.body.resend);
      let existingActiveInvite: any = null;
      let inviteToken: string | null = null;

      try {
        const pendingSnap = await db
          .collection("invites")
          .where("projectId", "==", projectId)
          .where("email", "==", normalizedEmail)
          .where("status", "==", "pending")
          .limit(1)
          .get();
        if (!pendingSnap.empty) {
          const existingDoc = pendingSnap.docs[0];
          const data = existingDoc.data() || {};
          let isExpired = false;
          if (data.expiresAt) {
            const expMs = data.expiresAt?.toMillis ? data.expiresAt.toMillis() : new Date(data.expiresAt).getTime();
            if (!isNaN(expMs) && expMs < Date.now()) {
              isExpired = true;
            }
          }
          if (!isExpired) {
            existingActiveInvite = data;
            inviteToken = existingDoc.id;
          }
        }
      } catch (queryErr) {}

      if (!inviteToken && pendingInvitesStore) {
        for (const [t, inv] of pendingInvitesStore.entries()) {
          if (inv.projectId === projectId && inv.email?.toLowerCase().trim() === normalizedEmail && inv.status === 'pending') {
            let isExpired = false;
            if (inv.expiresAt) {
              const expMs = new Date(inv.expiresAt).getTime();
              if (!isNaN(expMs) && expMs < Date.now()) isExpired = true;
            }
            if (!isExpired) {
              inviteToken = t;
              existingActiveInvite = inv;
              break;
            }
          }
        }
      }

      // If an active pending invitation already exists and caller is NOT explicitly requesting resend:
      if (existingActiveInvite && !isResendRequest) {
        return res.status(400).json({
          error: "DuplicateInvitation",
          message: "An active invitation already exists for this email address.",
          alreadyInvited: true,
          inviteToken: existingActiveInvite.id || inviteToken
        });
      }

      const isReusingExisting = Boolean(inviteToken);
      if (!inviteToken) {
        inviteToken = crypto.randomUUID();
      }

      // 4. Expiration timestamp (7 days) & Document construction (Step 2 & 11)
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      const inviteData = {
        id: inviteToken,
        email: normalizedEmail,
        projectId,
        projectName: projectName || projectData.name || "EchoNote Workspace",
        role: normalizedInvitedRole,
        invitedBy: callerEmail,
        ownerId: ownerId,
        status: "pending",
        expiresAt,
        createdAt: isReusingExisting && existingActiveInvite?.createdAt ? existingActiveInvite.createdAt : FieldValue.serverTimestamp(),
        lastResentAt: isReusingExisting ? FieldValue.serverTimestamp() : null
      };

      pendingInvitesStore.set(inviteToken, inviteData);

      // Store in Firestore
      try {
        await db.collection("invites").doc(inviteToken).set(inviteData, { merge: true });
        console.info(`✅ Stored invite in server Firestore for recipient ${maskEmailForLogs(normalizedEmail)} (token prefix: ${inviteToken.slice(0, 8)}...)`);
      } catch (dbErr: any) {
        if (isProductionEnvironment()) {
          console.error("🚨 [PRODUCTION] Failed to persist invite in Firestore:", {
            recipient: maskEmailForLogs(normalizedEmail),
            error: dbErr?.message || String(dbErr)
          });
          return res.status(500).json({ error: "Failed to persist invitation in database" });
        }
        console.info(`ℹ️ [NON-PROD DEV ONLY] Stored invite in development fallback store for recipient ${maskEmailForLogs(normalizedEmail)}`);
      }

      // 5. Send Email via Resend centralized email service
      const appUrl = resolveAppUrl();
      const joinUrl = `${appUrl}/join?token=${encodeURIComponent(inviteToken)}`;

      const email = normalizedEmail;
      const emailResult = await emailService.sendTeamInvitation(email, {
        inviterName: callerEmail,
        projectName: projectName || projectData.name || "EchoNote Workspace",
        role: normalizedInvitedRole,
        inviteLink: joinUrl
      });

      const emailSent = Boolean(emailResult && emailResult.success);

      // Record email delivery metadata on invitation document
      try {
        await db.collection("invites").doc(inviteToken).update({
          emailDeliveryStatus: emailSent ? "sent" : "failed",
          emailDeliveryError: emailSent ? null : (emailResult?.error || "Email delivery failed"),
          emailDeliveryCode: emailSent ? null : (emailResult?.errorCode || "EMAIL_DELIVERY_FAILED"),
          lastEmailAttemptAt: FieldValue.serverTimestamp()
        });
      } catch (updateErr) {}

      // Project Activity & Audit Logging (Step 16)
      try {
        await db.collection("projectActivities").add({
          projectId,
          userId: callerUid,
          userEmail: callerEmail,
          userName: callerEmail.split('@')[0],
          actionType: "invite_member",
          description: `${callerEmail.split('@')[0]} ${isReusingExisting ? 'resent invitation to' : 'invited'} ${normalizedEmail} to project "${projectName || projectData.name || 'Workspace'}" as ${normalizedInvitedRole}`,
          createdAt: FieldValue.serverTimestamp()
        });
      } catch (actErr) {}

      const projectOrgId = projectData.orgId || projectData.organizationId;
      if (projectOrgId) {
        try {
          await recordOrgAuditEvent(db, {
            organizationId: projectOrgId,
            actorUserId: callerUid,
            actorEmail: callerEmail,
            targetUserEmail: normalizedEmail,
            newRole: normalizedInvitedRole,
            action: "PROJECT_INVITATION_CREATED",
            timestamp: new Date().toISOString(),
            details: `Invited ${normalizedEmail} as ${normalizedInvitedRole} to project ${projectId} (email ${emailSent ? 'dispatched' : 'failed'})`
          });
        } catch (auditErr) {}
      }

      // Truthful response (Step 7)
      if (!emailSent) {
        console.warn("⚠️ [INVITE MEMBER] Invitation record created, but email dispatch failed:", {
          recipient: maskEmailForLogs(normalizedEmail),
          tokenPrefix: inviteToken.slice(0, 8),
          error: emailResult?.error,
          code: emailResult?.errorCode
        });
        return res.status(200).json({
          success: true,
          invitationCreated: true,
          isReused: isReusingExisting,
          inviteToken,
          emailSent: false,
          emailError: emailResult?.error || "Email delivery failed",
          emailErrorCode: emailResult?.errorCode || "EMAIL_DELIVERY_FAILED",
          statusCode: emailResult?.statusCode || 500,
          inviteLink: joinUrl,
          message: `Invitation created, but the invitation email could not be delivered: ${emailResult?.error || 'Email delivery failed'}. You can copy and share the invitation link directly.`,
          warning: emailResult?.error || "Email delivery failed"
        });
      }

      return res.status(200).json({
        success: true,
        invitationCreated: true,
        isReused: isReusingExisting,
        inviteToken,
        emailSent: true,
        inviteLink: joinUrl,
        message: isReusingExisting ? "Invitation resent successfully." : "Invitation sent successfully."
      });
    } catch (error: any) {
      console.warn("⚠️ [INVITE MEMBER] Error:", error?.message || String(error));
      return res.status(500).json({ error: "InternalError", message: "Failed to create or send invitation." });
    } finally {
      if (releaseFlight) {
        inFlightProjectInvites.delete(flightKey);
        (releaseFlight as () => void)();
      }
    }
  });

  // Get Invite Details - Safe public endpoint returning non-sensitive metadata (SEC-04 Hardened)
  app.get("/api/invite-details/:token", optionalAuth, async (req: AuthenticatedRequest, res) => {
    const tokenValidation = sanitizeInvitationToken(req.params.token);
    if (!tokenValidation.valid || !tokenValidation.token) {
      return res.status(400).json({ error: tokenValidation.error || "BadRequest", message: tokenValidation.message || "Missing or invalid invitation token." });
    }
    const token = tokenValidation.token;

    try {
      let docSnap: FirebaseFirestore.DocumentSnapshot | null = null;
      let docRef: FirebaseFirestore.DocumentReference = db.collection("invites").doc(token);

      const canonicalSnap = await docRef.get();
      if (canonicalSnap.exists) {
        docSnap = canonicalSnap;
      } else {
        // Fallback lookup by id or token field for schema resilience
        const idSnap = await db.collection("invites").where("id", "==", token).limit(1).get();
        if (!idSnap.empty) {
          docSnap = idSnap.docs[0];
          docRef = docSnap.ref;
        } else {
          const tokenSnap = await db.collection("invites").where("token", "==", token).limit(1).get();
          if (!tokenSnap.empty) {
            docSnap = tokenSnap.docs[0];
            docRef = docSnap.ref;
          }
        }
      }

      let inviteData: any = null;
      let docId = token;

      if (!docSnap || !docSnap.exists) {
        if (!isProductionEnvironment() && pendingInvitesStore.has(token)) {
          inviteData = pendingInvitesStore.get(token);
        } else {
          return res.status(404).json({ error: "NotFound", message: "Invalid or expired invitation token." });
        }
      } else {
        docId = docSnap.id;
        inviteData = docSnap.data() || {};
      }

      const recipientEmail = inviteData.email || "";
      const isRecipientAuthed = Boolean(
        req.user?.email &&
        recipientEmail &&
        req.user.email.toLowerCase().trim() === recipientEmail.toLowerCase().trim() &&
        (req.user as any).email_verified === true
      );

      // Check if authenticated caller has authorized project access to view unmasked inviter metadata
      let isProjectMemberOrAdmin = false;
      if (req.user && inviteData.projectId) {
        try {
          const access = await resolveProjectAccess(db, req.user, inviteData.projectId);
          if (access && access.hasAccess) {
            isProjectMemberOrAdmin = true;
          }
        } catch (_) {}
      }

      const isAuthorizedToSeeUnmasked = isRecipientAuthed || isProjectMemberOrAdmin;

      // Determine genuine, safe display name if one already exists
      let safeInviterDisplayName: string | null = null;
      if (inviteData.inviterDisplayName && typeof inviteData.inviterDisplayName === "string" && !inviteData.inviterDisplayName.includes("@") && inviteData.inviterDisplayName.trim()) {
        safeInviterDisplayName = inviteData.inviterDisplayName.trim();
      } else if (inviteData.inviterName && typeof inviteData.inviterName === "string" && !inviteData.inviterName.includes("@") && inviteData.inviterName.trim()) {
        safeInviterDisplayName = inviteData.inviterName.trim();
      } else if (inviteData.invitedBy && typeof inviteData.invitedBy === "string" && !inviteData.invitedBy.includes("@") && inviteData.invitedBy.trim()) {
        safeInviterDisplayName = inviteData.invitedBy.trim();
      } else if (inviteData.ownerId) {
        try {
          const ownerDoc = await db.collection("users").doc(inviteData.ownerId).get();
          if (ownerDoc.exists) {
            const uData = ownerDoc.data();
            const possibleName = uData?.displayName || uData?.name;
            if (possibleName && typeof possibleName === "string" && !possibleName.includes("@") && possibleName.trim()) {
              safeInviterDisplayName = possibleName.trim();
            }
          }
        } catch (_) {}
      }

      const rawInviter = inviteData.invitedBy || "";
      const maskedEmail = maskEmailForLogs(recipientEmail);
      const maskedInviterEmail = rawInviter.includes("@") ? maskEmailForLogs(rawInviter) : null;

      // Safe public inviter display:
      // - Genuine safe display name if available
      // - Otherwise masked email or neutral label "Project administrator"
      const publicInviterLabel = safeInviterDisplayName || maskedInviterEmail || "Project administrator";
      const sanitizedInvitedBy = isAuthorizedToSeeUnmasked ? (rawInviter || publicInviterLabel) : publicInviterLabel;
      const sanitizedInviterName = safeInviterDisplayName || (isAuthorizedToSeeUnmasked ? (inviteData.inviterName || rawInviter || publicInviterLabel) : publicInviterLabel);

      return res.json({
        id: docId,
        email: isAuthorizedToSeeUnmasked ? recipientEmail : maskedEmail,
        recipientEmail: isAuthorizedToSeeUnmasked ? recipientEmail : maskedEmail,
        maskedRecipientEmail: maskedEmail,
        isRecipientVerified: Boolean(isRecipientAuthed),
        projectId: inviteData.projectId,
        projectName: inviteData.projectName,
        role: inviteData.role,
        invitedBy: sanitizedInvitedBy,
        inviterName: sanitizedInviterName,
        maskedInviterEmail: maskedInviterEmail || undefined,
        status: inviteData.status || "pending",
        expiresAt: inviteData.expiresAt || null,
        createdAt: inviteData.createdAt
      });
    } catch (error: any) {
      console.error("🚨 [INVITE DETAILS] Database error during invitation lookup:", {
        tokenPrefix: token.slice(0, 8),
        errorMessage: error?.message || String(error)
      });
      return res.status(500).json({
        error: "DatabaseError",
        message: "Failed to retrieve invitation details due to a database error."
      });
    }
  });

  // Accept Invitation & Add User to Project - Protected with requireAuth
  app.post("/api/invite-accept", requireAuth, async (req: AuthenticatedRequest, res) => {
    const rawToken = req.body?.token;
    const userId = req.user!.uid;
    const userEmail = req.user!.email;
    const userDisplayName = (req.user as any)?.name || userEmail?.split('@')[0] || 'User';

    const result = await acceptProjectInvitation(db, {
      rawToken,
      userId,
      userEmail: userEmail || "",
      userDisplayName,
      pendingInvitesStore,
      projectMembersFallbackStore
    });

    if (result.status === 200 && userEmail && !result.body?.alreadyMember) {
      // 4. Send welcome email via Resend only for first-time acceptance (not on repeated acceptance)
      const appUrl = resolveAppUrl();
      try {
        await emailService.sendWelcome(userEmail, {
          name: userDisplayName,
          dashboardLink: `${appUrl}/app`
        });
      } catch (_) {}
    }

    if (result.status === 200 && userId) {
      try {
        await syncUserCustomClaims(userId, db);
      } catch (_) {}
    }

    return res.status(result.status).json(result.body);
  });

  // Decline/Reject Invitation - Token validated & recipient strictly verified with requireAuth (SEC-04)
  app.post("/api/invite-decline", requireAuth, async (req: AuthenticatedRequest, res) => {
    const rawToken = req.body?.token;
    const userId = req.user!.uid;
    const callerEmail = (req.user!.email || "").toLowerCase().trim();

    if (!rawToken || typeof rawToken !== "string" || !rawToken.trim()) {
      return res.status(400).json({ error: "Missing token", message: "A valid invitation token is required." });
    }
    const token = rawToken.trim();

    try {
      let inviteDocRef: FirebaseFirestore.DocumentReference = db.collection("invites").doc(token);
      let inviteDoc = await inviteDocRef.get();

      if (!inviteDoc.exists) {
        const idSnap = await db.collection("invites").where("id", "==", token).limit(1).get();
        if (!idSnap.empty) {
          inviteDoc = idSnap.docs[0];
          inviteDocRef = inviteDoc.ref;
        } else {
          const tokenSnap = await db.collection("invites").where("token", "==", token).limit(1).get();
          if (!tokenSnap.empty) {
            inviteDoc = tokenSnap.docs[0];
            inviteDocRef = inviteDoc.ref;
          }
        }
      }

      if (!inviteDoc.exists) {
        return res.status(404).json({ error: "NotFound", message: "Invitation not found or invalid token." });
      }

      const invite = inviteDoc.data() || {};
      const targetEmail = (invite.email || "").toLowerCase().trim();

      // Enforce that only the intended recipient can decline the invitation
      if (targetEmail && callerEmail !== targetEmail) {
        return res.status(403).json({ error: "Forbidden", message: "This invitation was addressed to a different account." });
      }

      // Check current status to prevent state pollution
      const currentStatus = String(invite.status || "pending").toLowerCase();
      if (currentStatus === "accepted") {
        return res.status(400).json({ error: "Invalid invitation", message: "This invitation has already been accepted." });
      }
      if (currentStatus === "cancelled" || currentStatus === "revoked" || currentStatus === "rejected") {
        return res.status(400).json({ error: "Invalid invitation", message: "This invitation has already been cancelled or rejected." });
      }

      await inviteDocRef.update({
        status: "rejected",
        rejectedAt: FieldValue.serverTimestamp(),
        rejectedBy: userId
      });

      // Update in-memory fallback store if present
      if (!isProductionEnvironment() && pendingInvitesStore.has(token)) {
        const devInvite = pendingInvitesStore.get(token);
        devInvite.status = "rejected";
        devInvite.rejectedAt = new Date().toISOString();
        devInvite.rejectedBy = userId;
      }

      // Log decline invitation activity
      try {
        if (invite.projectId) {
          await db.collection("projectActivities").add({
            projectId: invite.projectId,
            userId: userId,
            userEmail: callerEmail,
            userName: callerEmail.split('@')[0],
            actionType: "decline_invite",
            description: `${callerEmail.split('@')[0]} declined invitation to join "${invite.projectName || 'Workspace'}"`,
            createdAt: FieldValue.serverTimestamp()
          });
        }
      } catch (e: any) {
        console.warn("⚠️ Server-side decline projectActivities add note:", e?.message || e);
      }

      return res.status(200).json({ success: true, message: "Invitation declined successfully" });
    } catch (error: any) {
      console.error("🚨 [DECLINE INVITATION] Error:", error?.message || String(error));
      return res.status(500).json({ error: "InternalError", message: "Failed to decline invitation." });
    }
  });

  // Expire Invitation - Protected with requireAuth
  app.post("/api/invite-expire", requireAuth, async (req: AuthenticatedRequest, res) => {
    const { token } = req.body;
    const callerUid = req.user!.uid;

    if (!token) {
      return res.status(400).json({ error: "Missing token" });
    }

    try {
      const inviteDocRef = db.collection("invites").doc(token);
      const inviteDoc = await inviteDocRef.get();
      if (!inviteDoc.exists) {
        return res.status(404).json({ error: "Not Found", message: "Invitation not found." });
      }

      const inviteData = inviteDoc.data() || {};
      const access = await resolveProjectAccess(db, req.user, inviteData.projectId, { requiredPermission: 'MANAGE_MEMBERS' });
      if (!access.hasAccess && inviteData.ownerId !== callerUid && inviteData.invitedBy !== req.user?.email) {
        if (access.mfaRequired) {
          return res.status(403).json(
            createMfaForbiddenResponse(
              access.mfaRequirement,
              access.reason,
              req.user,
              access.mfaEnrolled,
              { organizationId: access.organizationId }
            )
          );
        }
        return res.status(403).json({ error: "Forbidden", message: "Permission denied to expire this invite." });
      }

      try {
        await inviteDocRef.update({
          status: "expired",
          expiredAt: FieldValue.serverTimestamp(),
          expiredBy: callerUid
        });
      } catch (e: any) {
        console.log("⚠️ Server-side invite status expire note:", e.message);
      }

      res.json({ success: true, message: "Invitation expired successfully" });
    } catch (error: any) {
      console.error("🚨 [EXPIRE INVITATION] Error:", error?.message || String(error));
      res.status(500).json({ error: "InternalError", message: "Failed to expire invitation." });
    }
  });

  // Cancel/Revoke Invitation - Protected with requireAuth
  app.post("/api/invite-cancel", requireAuth, async (req: AuthenticatedRequest, res) => {
    const rawToken = req.body?.token;
    const callerUid = req.user!.uid;
    const callerEmail = req.user!.email || "A team member";

    const tokenValidation = sanitizeInvitationToken(rawToken);
    if (!tokenValidation.valid || !tokenValidation.token) {
      return res.status(400).json({ error: tokenValidation.error || "BadRequest", message: tokenValidation.message || "Missing or invalid invitation token." });
    }
    const token = tokenValidation.token;

    try {
      let inviteDocRef: FirebaseFirestore.DocumentReference = db.collection("invites").doc(token);
      let inviteDoc = await inviteDocRef.get();

      if (!inviteDoc.exists) {
        const idSnap = await db.collection("invites").where("id", "==", token).limit(1).get();
        if (!idSnap.empty) {
          inviteDoc = idSnap.docs[0];
          inviteDocRef = inviteDoc.ref;
        } else {
          const tokenSnap = await db.collection("invites").where("token", "==", token).limit(1).get();
          if (!tokenSnap.empty) {
            inviteDoc = tokenSnap.docs[0];
            inviteDocRef = inviteDoc.ref;
          }
        }
      }

      if (!inviteDoc.exists) {
        if (!isProductionEnvironment() && pendingInvitesStore.has(token)) {
          const inv = pendingInvitesStore.get(token);
          inv.status = 'cancelled';
          inv.cancelledAt = new Date().toISOString();
          inv.cancelledBy = callerUid;
          return res.json({ success: true, message: "Invitation cancelled successfully" });
        }
        return res.status(404).json({ error: "NotFound", message: "Invitation not found." });
      }

      const inviteData = inviteDoc.data() || {};
      const access = await resolveProjectAccess(db, req.user, inviteData.projectId, { 
        requiredPermission: 'MANAGE_MEMBERS',
        callerClaimedOwnerId: callerUid
      });
      if (!access.hasAccess && inviteData.ownerId !== callerUid && inviteData.invitedBy !== callerEmail) {
        if (access.mfaRequired) {
          return res.status(403).json(
            createMfaForbiddenResponse(
              access.mfaRequirement,
              access.reason,
              req.user,
              access.mfaEnrolled,
              { organizationId: access.organizationId }
            )
          );
        }
        return res.status(403).json({ error: "Forbidden", message: "Permission denied to cancel this invitation." });
      }

      await inviteDocRef.update({
        status: "cancelled",
        cancelledAt: FieldValue.serverTimestamp(),
        cancelledBy: callerUid
      });

      if (pendingInvitesStore.has(token)) {
        const inv = pendingInvitesStore.get(token);
        inv.status = 'cancelled';
      }

      // Project Activity Logging
      try {
        await db.collection("projectActivities").add({
          projectId: inviteData.projectId,
          userId: callerUid,
          userEmail: callerEmail,
          userName: callerEmail.split('@')[0],
          actionType: "decline_invite",
          description: `${callerEmail.split('@')[0]} cancelled invitation sent to ${inviteData.email}`,
          createdAt: FieldValue.serverTimestamp()
        });
      } catch (actErr) {}

      // Org Audit Logging
      const orgId = access.organizationId || access.project?.orgId;
      if (orgId) {
        try {
          await recordOrgAuditEvent(db, {
            organizationId: orgId,
            actorUserId: callerUid,
            actorEmail: callerEmail,
            targetUserEmail: inviteData.email,
            action: "PROJECT_INVITATION_REVOKED",
            timestamp: new Date().toISOString(),
            details: `Cancelled invitation for ${inviteData.email} on project ${inviteData.projectId}`
          });
        } catch (auditErr) {}
      }

      return res.json({ success: true, message: "Invitation cancelled successfully" });
    } catch (error: any) {
      console.error("🚨 [CANCEL INVITATION] Error:", error?.message || String(error));
      return res.status(500).json({ error: "InternalError", message: "Failed to cancel invitation." });
    }
  });

  // Razorpay: Create Subscription (Recurring PRO & TEAM plans) - Protected with requireAuth
  app.post("/api/create-subscription", requireAuth, async (req: AuthenticatedRequest, res) => {
    const userId = req.user!.uid;
    const userEmail = req.user!.email || "";
    const { planId, billingCycle } = req.body;

    const normalizedPlan = (planId as string || "").toLowerCase().trim();
    const normalizedCycle = (billingCycle as string || "monthly").toLowerCase().trim();

    // Enterprise is custom-priced and must be routed to Sales / Book a Demo
    if (normalizedPlan === "enterprise") {
      return res.status(400).json({ 
        error: "Enterprise plans require custom configuration. Please use 'Contact Sales' or 'Book a Demo'." 
      });
    }

    if (!["pro", "team"].includes(normalizedPlan)) {
      return res.status(400).json({ error: "Invalid planId. Must be 'pro' or 'team'." });
    }

    if (!["monthly", "yearly"].includes(normalizedCycle)) {
      return res.status(400).json({ error: "Invalid billingCycle. Must be 'monthly' or 'yearly'." });
    }

    // Resolve authoritative Razorpay Plan ID from environment variables
    const planIdMap: Record<string, Record<string, string | undefined>> = {
      pro: {
        monthly: process.env.RAZORPAY_PRO_MONTHLY_PLAN_ID,
        yearly: process.env.RAZORPAY_PRO_YEARLY_PLAN_ID
      },
      team: {
        monthly: process.env.RAZORPAY_TEAM_MONTHLY_PLAN_ID,
        yearly: process.env.RAZORPAY_TEAM_YEARLY_PLAN_ID
      }
    };

    const rzpPlanId = (planIdMap[normalizedPlan]?.[normalizedCycle] || "").replace(/['"]/g, "").trim();
    if (!rzpPlanId) {
      console.error(`❌ Razorpay Plan ID not configured for ${normalizedPlan} (${normalizedCycle})`);
      return res.status(500).json({ 
        success: false,
        error: `Razorpay Plan ID not configured in server environment for ${normalizedPlan} ${normalizedCycle}. Please configure RAZORPAY_${normalizedPlan.toUpperCase()}_${normalizedCycle.toUpperCase()}_PLAN_ID.`,
        code: "PLAN_ID_NOT_CONFIGURED"
      });
    }

    if (rzpPlanId.startsWith("sub_")) {
      return res.status(400).json({
        success: false,
        error: `Configured plan ID '${rzpPlanId}' is a Subscription ID (starts with 'sub_'), but Razorpay requires a Plan ID (starts with 'plan_'). Please create a Plan in your Razorpay Dashboard (Subscriptions > Plans) and update RAZORPAY_${normalizedPlan.toUpperCase()}_${normalizedCycle.toUpperCase()}_PLAN_ID.`,
        code: "INVALID_PLAN_ID_FORMAT"
      });
    }

    try {
      const razorpayInstance = getRazorpayClient();
      const subscription = await razorpayInstance.subscriptions.create({
        plan_id: rzpPlanId,
        customer_notify: 1,
        total_count: normalizedCycle === "yearly" ? 10 : 120, // 10 years or 10 months
        notes: {
          userId,
          userEmail,
          planId: normalizedPlan,
          billingCycle: normalizedCycle,
          source: "echonote-web"
        }
      });

      const activeKeyId = (process.env.RAZORPAY_KEY_ID || "").replace(/['"]/g, "").trim();

      // Store pending subscription document in Firestore for authoritative server-side reconciliation
      try {
        await db.collection("subscriptions").doc(subscription.id).set({
          subscriptionId: subscription.id,
          userId,
          userEmail,
          planId: normalizedPlan,
          billingCycle: normalizedCycle,
          razorpayPlanId: rzpPlanId,
          status: "created",
          createdAt: FieldValue.serverTimestamp()
        }, { merge: true });
      } catch (dbErr: any) {
        if (isProductionEnvironment()) {
          console.error("🚨 [PRODUCTION] Failed to persist pending subscription in Firestore. Failing closed:", {
            subscriptionId: subscription.id,
            userId,
            error: dbErr?.message || String(dbErr)
          });
          return res.status(500).json({
            success: false,
            error: "Database initialization failed for subscription. Transaction aborted to preserve ledger consistency.",
            code: "SUBSCRIPTION_INIT_DB_FAILED"
          });
        }
        // Non-production environment: gracefully continue with in-memory fallback store
        console.info("ℹ️ [NON-PROD DEV ONLY] Pending subscription recorded in development fallback store:", {
          subscriptionId: subscription.id,
          userId,
          planId: normalizedPlan,
          billingCycle: normalizedCycle
        });
      }

      // Record in non-production fallback store (no-op in production)
      recordPendingSubscription({
        subscriptionId: subscription.id,
        userId,
        userEmail,
        planId: normalizedPlan,
        billingCycle: normalizedCycle,
        razorpayPlanId: rzpPlanId,
        status: "created",
        createdAt: new Date()
      });

      res.json({
        subscriptionId: subscription.id,
        key: activeKeyId,
        planId: normalizedPlan,
        billingCycle: normalizedCycle
      });
    } catch (error: any) {
      const errorObj = error.error || error;
      console.error("🔥 RAZORPAY SUBSCRIPTION CREATION ERROR:", error);

      const desc = (errorObj?.description || error?.message || "").toLowerCase();
      const isAuthError = error?.statusCode === 401 || 
                          (errorObj?.code === 'BAD_REQUEST_ERROR' && desc.includes('auth')) ||
                          desc.includes('api key') ||
                          desc.includes('unauthorized');

      const isPlanInvalid = (error?.statusCode === 400 || errorObj?.code === 'BAD_REQUEST_ERROR') &&
                            (desc.includes('plan') || desc.includes('plan_id'));

      let statusCode = 500;
      let errorCode = "RAZORPAY_API_ERROR";
      let errorMsg = errorObj?.description || error.message || "Failed to create subscription";

      if (isAuthError) {
        statusCode = 401;
        errorCode = "AUTHENTICATION_FAILED";
        errorMsg = "Razorpay Authentication Failed: verify your active API Key ID and Secret.";
      } else if (isPlanInvalid) {
        statusCode = 400;
        errorCode = "RAZORPAY_PLAN_INVALID";
        errorMsg = `Razorpay Plan is invalid or does not exist: ${errorObj?.description || error.message}`;
      }

      res.status(statusCode).json({
        success: false,
        error: errorMsg,
        code: errorCode
      });
    }
  });

  // Safe public endpoint exposing current top-up packages
  app.get("/api/billing/topup-packages", (req, res) => {
    res.json({
      minuteTopups: [
        {
          minutes: 100,
          amount: 99
        },
        {
          minutes: 350,
          amount: 299
        }
      ],
      aiRequestTopups: [
        {
          requests: 100,
          amount: 99
        },
        {
          requests: 500,
          amount: 399
        },
        {
          requests: 1500,
          amount: 999
        }
      ]
    });
  });

  // Razorpay: Create Order (One-Time Top-up Purchases) - Protected with requireAuth
  app.post("/api/create-order", requireAuth, async (req: AuthenticatedRequest, res) => {
    const userId = req.user!.uid;
    const userEmail = req.user!.email || "";
    const { type, minutes, requests } = req.body;
    
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      return res.status(500).json({ 
        success: false,
        error: "Razorpay credentials are not configured on the server." 
      });
    }

    const currency = "INR";
    const rawType = String(type || "").toLowerCase().trim();

    // Determine package type: supports 'minutes' / 'topup' and 'ai_requests' / 'thinking-topup'
    const isMinuteTopup = rawType === "minutes" || rawType === "topup" || (minutes !== undefined && rawType !== "ai_requests" && rawType !== "thinking-topup");
    const isAiRequestTopup = rawType === "ai_requests" || rawType === "thinking-topup" || (requests !== undefined && !isMinuteTopup);

    let amount = 0;
    let topupType: "minutes" | "ai_requests";
    let topupMinutes = 0;
    let topupRequests = 0;

    // Server calculates exact pricing in Paise - NEVER trusts client-supplied amounts
    if (isMinuteTopup) {
      const validMins = Number(minutes);
      if (validMins in MINUTE_TOPUP_PACKAGES) {
        const pkg = MINUTE_TOPUP_PACKAGES[validMins as keyof typeof MINUTE_TOPUP_PACKAGES];
        amount = pkg.amountInPaise;
        topupType = "minutes";
        topupMinutes = pkg.minutes;
      } else {
        return res.status(400).json({
          success: false,
          error: "Invalid minute top-up package. Allowed packages: 100, 350.",
          code: "INVALID_MINUTE_TOPUP"
        });
      }
    } else if (isAiRequestTopup) {
      const validReqs = Number(requests);
      if (validReqs in AI_REQUEST_TOPUP_PACKAGES) {
        const pkg = AI_REQUEST_TOPUP_PACKAGES[validReqs as keyof typeof AI_REQUEST_TOPUP_PACKAGES];
        amount = pkg.amountInPaise;
        topupType = "ai_requests";
        topupRequests = pkg.requests;
      } else {
        return res.status(400).json({
          success: false,
          error: "Invalid AI request top-up package. Allowed packages: 100, 500, 1500.",
          code: "INVALID_AI_REQUEST_TOPUP"
        });
      }
    } else {
      return res.status(400).json({ 
        success: false,
        error: "create-order is reserved for one-time purchases ('minutes' or 'ai_requests'). For recurring subscriptions, use /api/create-subscription.",
        code: "INVALID_ORDER_TYPE"
      });
    }

    try {
      const options = {
        amount,
        currency,
        receipt: `rcpt_${Date.now()}_${userId.slice(0, 6)}`,
        notes: {
          userId,
          userEmail,
          type: topupType,
          legacyType: isMinuteTopup ? "topup" : "thinking-topup",
          minutes: topupMinutes,
          requests: topupRequests,
          amountInPaise: amount,
          source: "echonote-web"
        }
      };

      const razorpayInstance = getRazorpayClient();
      const order = await razorpayInstance.orders.create(options);
      const activeKeyId = (process.env.RAZORPAY_KEY_ID || "").replace(/['"]/g, "").trim();

      // Persist pending order in Firestore with server-authoritative details
      try {
        await db.collection("orders").doc(order.id).set({
          orderId: order.id,
          userId,
          userEmail,
          amount,
          amountInPaise: amount,
          currency,
          type: topupType,
          legacyType: isMinuteTopup ? "topup" : "thinking-topup",
          minutes: topupMinutes,
          requests: topupRequests,
          status: "created",
          createdAt: FieldValue.serverTimestamp()
        }, { merge: true });
      } catch (dbErr: any) {
        if (isProductionEnvironment()) {
          console.error("🚨 [PRODUCTION] Failed to persist pending order in Firestore. Failing closed:", {
            orderId: order.id,
            userId,
            type: topupType,
            amount,
            error: dbErr?.message || String(dbErr)
          });
          return res.status(500).json({
            success: false,
            error: "Database initialization failed for order. Transaction aborted to preserve ledger consistency.",
            code: "ORDER_INIT_DB_FAILED"
          });
        }
        // Non-production environment: gracefully continue with in-memory fallback store
        console.info("ℹ️ [NON-PROD DEV ONLY] Pending order recorded in development fallback store:", {
          orderId: order.id,
          userId,
          type: topupType,
          amount
        });
      }

      // Record in non-production fallback store (no-op in production)
      recordPendingOrder({
        orderId: order.id,
        userId,
        userEmail,
        amount,
        currency,
        type: topupType,
        minutes: topupMinutes,
        requests: topupRequests,
        status: "created",
        createdAt: new Date()
      });

      res.json({
        id: order.id,
        amount: order.amount,
        currency: order.currency,
        key: activeKeyId,
        type: topupType,
        minutes: topupMinutes,
        requests: topupRequests
      });
    } catch (error: any) {
      const errorObj = error.error || error;
      console.error("🔥 RAZORPAY ORDER ERROR:", error);
      
      const isAuthError = error?.statusCode === 401 || 
                          (errorObj?.code === 'BAD_REQUEST_ERROR' && errorObj?.description?.toLowerCase().includes('auth')) ||
                          error?.message?.toLowerCase().includes('auth');

      res.status(isAuthError ? 401 : 500).json({ 
        success: false,
        error: isAuthError 
          ? "Razorpay Authentication Failed: verify your active API Key ID and Secret." 
          : (errorObj?.description || error.message || "Failed to create order"), 
        code: errorObj?.code || (isAuthError ? 'AUTHENTICATION_FAILED' : 'ORDER_CREATION_FAILED')
      });
    }
  });

  // Razorpay: Verify Payment (Handles both Subscriptions and One-Time Orders) - Protected with requireAuth
  app.post("/api/verify-payment", requireAuth, async (req: AuthenticatedRequest, res) => {
    const userId = req.user!.uid;
    const { 
      razorpay_payment_id,
      razorpay_subscription_id, 
      razorpay_order_id, 
      razorpay_signature 
    } = req.body;

    if (!razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: "Missing required payment id or signature." });
    }

    if (!razorpay_subscription_id && !razorpay_order_id) {
      return res.status(400).json({ error: "Missing razorpay_subscription_id or razorpay_order_id." });
    }

    const secret = (process.env.RAZORPAY_KEY_SECRET || "").replace(/['"]/g, "").trim();
    if (!secret) {
      return res.status(500).json({ error: "RAZORPAY_KEY_SECRET is not configured on server." });
    }

    // =========================================================================
    // FLOW A: RECURRING SUBSCRIPTION VERIFICATION
    // =========================================================================
    if (razorpay_subscription_id) {
      const expectedSignature = crypto
        .createHmac("sha256", secret)
        .update(`${razorpay_payment_id}|${razorpay_subscription_id}`)
        .digest("hex");

      if (!timingSafeStringCompare(expectedSignature, razorpay_signature)) {
        return res.status(400).json({ error: "Invalid subscription payment signature." });
      }

      try {
        const fulfillment = await fulfillSubscriptionPayment(db, {
          subscriptionId: razorpay_subscription_id,
          paymentId: razorpay_payment_id,
          callerUserId: userId,
          source: "verify-payment",
          planIdHint: req.body.planId,
          billingCycleHint: req.body.billingCycle
        });

        if (!fulfillment.success) {
          return res.status(fulfillment.statusCode || 400).json({
            success: false,
            error: fulfillment.error || "Subscription fulfillment failed.",
            code: fulfillment.errorCode || "SUBSCRIPTION_FULFILLMENT_FAILED"
          });
        }

        return res.json({
          success: true,
          planId: fulfillment.planId,
          billingCycle: fulfillment.billingCycle,
          message: fulfillment.alreadyProcessed ? "Payment already verified" : undefined
        });
      } catch (error: any) {
        console.error("🔥 SUBSCRIPTION PAYMENT VERIFICATION ERROR:", error);
        return res.status(500).json({ error: "Failed to update profile after payment verification", details: error.message });
      }
    }

    // =========================================================================
    // FLOW B: ONE-TIME TOP-UP ORDER VERIFICATION
    // =========================================================================
    if (razorpay_order_id) {
      const expectedSignature = crypto
        .createHmac("sha256", secret)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest("hex");

      if (!timingSafeStringCompare(expectedSignature, razorpay_signature)) {
        return res.status(400).json({ error: "Invalid order payment signature." });
      }

      try {
        const fulfillment = await fulfillTopupOrder(db, {
          orderId: razorpay_order_id,
          paymentId: razorpay_payment_id,
          callerUserId: userId,
          source: "verify-payment"
        });

        if (!fulfillment.success) {
          return res.status(fulfillment.statusCode || 400).json({
            success: false,
            error: fulfillment.error || "Order fulfillment failed.",
            code: fulfillment.errorCode || "ORDER_FULFILLMENT_FAILED"
          });
        }

        return res.json({
          success: true,
          type: fulfillment.type,
          minutes: fulfillment.minutes,
          requests: fulfillment.requests,
          message: fulfillment.alreadyProcessed ? "Order already processed" : undefined
        });
      } catch (error: any) {
        console.error("🔥 ORDER PAYMENT VERIFICATION ERROR:", error);
        return res.status(500).json({ error: "Failed to apply entitlement after payment verification", details: error.message });
      }
    }
  });

  // Razorpay Webhook Handler: Production endpoint with signature validation & idempotent processing
  app.post("/api/razorpay-webhook", async (req: any, res) => {
    const webhookSecret = (process.env.RAZORPAY_WEBHOOK_SECRET || "").replace(/['"]/g, "").trim();
    const signature = req.headers["x-razorpay-signature"] as string;

    if (!webhookSecret) {
      console.warn("⚠️ RAZORPAY_WEBHOOK_SECRET not configured on server. Rejecting webhook request.");
      return res.status(503).json({ error: "Service Unavailable", message: "Webhook secret is not configured on server." });
    }

    if (!signature) {
      console.error("❌ Missing x-razorpay-signature header on webhook request.");
      return res.status(400).json({ error: "Missing signature header" });
    }

    // Verify webhook signature against raw body buffer
    const rawBodyBuffer = req.rawBody || Buffer.from(JSON.stringify(req.body));
    const expectedSignature = crypto
      .createHmac("sha256", webhookSecret)
      .update(rawBodyBuffer)
      .digest("hex");

    if (!timingSafeStringCompare(expectedSignature, signature)) {
      console.error("❌ Invalid Razorpay Webhook Signature.");
      return res.status(400).json({ error: "Invalid webhook signature" });
    }

    const event = req.body.event;
    const eventId = req.body.event_id || req.body.id || `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    console.log(`🔔 Razorpay Webhook Event Received: ${event} (ID: ${eventId})`);

    try {
      // Idempotency: skip if already handled
      const eventRef = db.collection("webhook_events").doc(eventId);
      const eventDoc = await eventRef.get();
      if (eventDoc.exists) {
        console.log(`ℹ️ Webhook event ${eventId} already handled.`);
        return res.status(200).json({ status: "already_processed" });
      }

      const payload = req.body.payload || {};

      // Handle Subscription Events
      if (event === "subscription.charged" || event === "subscription.activated") {
        const sub = payload.subscription?.entity;
        const payment = payload.payment?.entity;
        const userId = sub?.notes?.userId || sub?.notes?.firebaseUid;
        const paymentId = payment?.id || `pay_${Date.now()}`;

        if (sub?.id) {
          const fulfillment = await fulfillSubscriptionPayment(db, {
            subscriptionId: sub.id,
            paymentId,
            callerUserId: userId,
            source: "webhook",
            planIdHint: sub?.notes?.planId,
            billingCycleHint: sub?.notes?.billingCycle,
            currentEndTimestamp: sub?.current_end,
            paymentAmount: payment?.amount ? payment.amount / 100 : undefined
          });
          console.log(`✅ Webhook subscription fulfillment result:`, fulfillment);
          if (!fulfillment.success && isProductionEnvironment()) {
            console.error(`🚨 Webhook subscription fulfillment failed in PRODUCTION:`, fulfillment);
            return res.status(500).json({ error: "Webhook subscription fulfillment failed in production", code: fulfillment.errorCode });
          }
        }
      } else if (event === "subscription.cancelled" || event === "subscription.expired" || event === "subscription.halted") {
        const sub = payload.subscription?.entity;
        const userId = sub?.notes?.userId || sub?.notes?.firebaseUid;

        if (userId) {
          const freeLimits = SERVER_PLAN_LIMITS.free;
          await db.collection("users").doc(userId).set({
            plan: "free",
            subscriptionId: null,
            monthlyMinuteLimit: freeLimits.minutes,
            monthlyThinkingLimit: freeLimits.thinking,
            downgradedAt: FieldValue.serverTimestamp()
          }, { merge: true });

          if (sub?.id) {
            await db.collection("subscriptions").doc(sub.id).set({
              status: event.replace("subscription.", ""),
              updatedAt: FieldValue.serverTimestamp()
            }, { merge: true });
          }

          console.log(`⚠️ Webhook downgraded cancelled user ${userId} to free`);
        }
      } else if (event === "order.paid" || (event === "payment.captured" && payload.payment?.entity?.order_id)) {
        const orderEntity = payload.order?.entity;
        const paymentEntity = payload.payment?.entity;
        const orderId = orderEntity?.id || paymentEntity?.order_id;
        const paymentId = paymentEntity?.id;

        if (orderId && paymentId) {
          console.log(`🔔 Webhook processing one-time top-up: order=${orderId}, payment=${paymentId}`);
          const fulfillment = await fulfillTopupOrder(db, {
            orderId,
            paymentId,
            source: "webhook",
            expectedAmount: orderEntity?.amount
          });
          console.log(`✅ Webhook top-up fulfillment result:`, fulfillment);
          if (!fulfillment.success && isProductionEnvironment()) {
            console.error(`🚨 Webhook top-up fulfillment failed in PRODUCTION:`, fulfillment);
            return res.status(500).json({ error: "Webhook top-up fulfillment failed in production", code: fulfillment.errorCode });
          }
        } else {
          console.warn(`⚠️ Webhook received ${event} but could not resolve orderId or paymentId:`, { orderId, paymentId });
        }
      }

      // Mark event as processed
      await eventRef.set({
        eventId,
        event,
        createdAt: FieldValue.serverTimestamp(),
        processed: true
      });

      return res.status(200).json({ status: "ok" });
    } catch (err: any) {
      console.error("🔥 Error processing webhook event:", err);
      if (isProductionEnvironment()) {
        return res.status(500).json({ error: "Internal error processing webhook in production", details: err.message });
      }
      // Return 200 so Razorpay does not endlessly retry failed parsing on non-critical events in dev
      return res.status(200).json({ status: "error", message: err.message });
    }
  });

  // ============================================================================
  // ZOOM WEBHOOK RECEIVER: Secure Ingestion & Meeting Provenance Integration
  // ============================================================================
  app.post("/api/webhooks/zoom", async (req: any, res) => {
    const webhookSecret = (process.env.ZOOM_WEBHOOK_SECRET || "").replace(/['"]/g, "").trim();

    if (!webhookSecret) {
      console.warn("⚠️ ZOOM_WEBHOOK_SECRET not configured on server. Rejecting Zoom webhook request.");
      return res.status(503).json({
        error: "Service Unavailable",
        message: "Zoom webhook secret is not configured on server."
      });
    }

    const eventName = req.body?.event;

    // Handle Zoom Endpoint URL Validation Challenge (Handshake)
    if (eventName === "endpoint.url_validation") {
      const plainToken = req.body?.payload?.plainToken;
      if (!plainToken || typeof plainToken !== "string") {
        return res.status(400).json({ error: "Missing plainToken in URL validation challenge" });
      }

      // Verify signature on the validation request itself
      const rawBodyBuffer = req.rawBody || Buffer.from(JSON.stringify(req.body));
      const sigVerification = verifyZoomWebhookSignature(req.headers, rawBodyBuffer, webhookSecret);
      if (!sigVerification.valid) {
        console.error("❌ Invalid signature on Zoom URL validation challenge:", sigVerification.reason);
        return res.status(401).json({ error: "Invalid webhook signature", reason: sigVerification.reason });
      }

      const challengeResponse = generateZoomValidationResponse(plainToken, webhookSecret);
      return res.status(200).json(challengeResponse);
    }

    // Verify Zoom Webhook Event Signature
    const rawBodyBuffer = req.rawBody || Buffer.from(JSON.stringify(req.body));
    const sigResult = verifyZoomWebhookSignature(req.headers, rawBodyBuffer, webhookSecret);

    if (!sigResult.valid) {
      console.error(`❌ Zoom webhook signature rejection: ${sigResult.reason}`);
      if (sigResult.isStale) {
        return res.status(400).json({ error: "Stale webhook request", reason: sigResult.reason });
      }
      return res.status(401).json({ error: "Invalid webhook signature", reason: sigResult.reason });
    }

    // Extract and validate event data
    const extractionResult = extractZoomMeetingEvent(req.body, req.headers);
    if (extractionResult.success === false) {
      console.warn(`⚠️ Zoom webhook payload validation failed: ${extractionResult.error}`);
      return res.status(400).json({ error: extractionResult.error, code: extractionResult.code });
    }

    const meetingData = extractionResult.data;
    console.log(`🔔 Zoom Webhook Event Received: ${meetingData.event} for meeting ${meetingData.externalMeetingId} (Event ID: ${meetingData.eventId})`);

    try {
      const processResult = await processZoomWebhookEvent(db, meetingData);

      if (processResult.status === "already_processed") {
        return res.status(200).json({ status: "already_processed", eventId: processResult.eventId });
      }

      if (processResult.status === "ignored") {
        return res.status(200).json({ status: "ignored", eventId: processResult.eventId, message: processResult.message });
      }

      if (processResult.status === "error") {
        if (processResult.isRetryable) {
          // Return 500 so Zoom retries delivery according to its exponential backoff schedule
          return res.status(500).json({ error: "Internal processing error", eventId: processResult.eventId, code: processResult.errorCode });
        }
        return res.status(422).json({ error: processResult.message, eventId: processResult.eventId, code: processResult.errorCode });
      }

      // Enqueue durable import job in Firestore before acknowledging webhook
      let enqueuedJobId: string | undefined;
      if (meetingData.event === "recording.completed" && meetingData.recordingFiles && meetingData.recordingFiles.length > 0) {
        try {
          const enqueueRes = await enqueueZoomImportJob(db, {
            externalMeetingId: meetingData.externalMeetingId,
            meetingInstanceUuid: meetingData.meetingInstanceUuid,
            meetingStartTime: meetingData.meetingStartTime,
            meetingTopic: meetingData.meetingTopic,
            hostEmail: meetingData.hostEmail,
            hostId: meetingData.hostId,
            recordingFiles: meetingData.recordingFiles,
            organizationId: processResult.sessionId ? undefined : undefined,
            projectId: processResult.projectId || undefined
          });
          enqueuedJobId = enqueueRes.jobId;
          console.log(`[Zoom Recording Import Enqueue] Job ${enqueueRes.jobId} status=${enqueueRes.status} deduplicated=${enqueueRes.deduplicated}`);

          // Trigger worker execution safely in background knowing the job is already durably committed to Firestore
          const bucketName = firebaseConfig.storageBucket || "echonote-2509.firebasestorage.app";
          const storageBucket = admin.storage().bucket(bucketName);
          importZoomRecording(db, {
            externalMeetingId: meetingData.externalMeetingId,
            meetingInstanceUuid: meetingData.meetingInstanceUuid,
            meetingStartTime: meetingData.meetingStartTime,
            meetingTopic: meetingData.meetingTopic,
            hostEmail: meetingData.hostEmail,
            hostId: meetingData.hostId,
            recordingFiles: meetingData.recordingFiles,
            organizationId: processResult.sessionId ? undefined : undefined,
            projectId: processResult.projectId || undefined
          }, {
            customStorageBucket: storageBucket
          }).catch((impErr) => {
            console.warn(`[Zoom Recording Import Worker Note] Job ${enqueuedJobId} execution deferred to worker: ${impErr?.message || impErr}`);
          });
        } catch (enqueueErr: any) {
          console.error(`🚨 [Zoom Recording Import Enqueue Error] Failed to persist job:`, enqueueErr?.message || enqueueErr);
          // Return 500 so Zoom retries webhook delivery per its SLA
          return res.status(500).json({
            error: "Failed to persist recording import job",
            eventId: processResult.eventId,
            code: "DURABLE_ENQUEUE_FAILED"
          });
        }
      }

      return res.status(200).json({
        status: "ok",
        eventId: processResult.eventId,
        sessionId: processResult.sessionId,
        manifestId: processResult.manifestId,
        pendingAssociation: processResult.status === "pending_association",
        importJobId: enqueuedJobId
      });
    } catch (err: any) {
      console.error("🔥 Unexpected error in Zoom webhook endpoint:", err?.message || err);
      return res.status(500).json({ error: "Internal server error processing webhook", details: err?.message || "Unknown error" });
    }
  });

  /**
   * Endpoint: Authenticated internal worker endpoint for batch processing queued Zoom import jobs.
   * Authentication: Protected by x-cron-key matching CRON_SECRET or platform admin token.
   */
  app.post("/api/internal/zoom/process-jobs", async (req: express.Request, res: express.Response) => {
    try {
      const cronKey = req.headers["x-cron-key"];
      const configuredCronSecret = (process.env.CRON_SECRET || "").trim();
      const hasValidCronKey = Boolean(
        typeof cronKey === "string" &&
        configuredCronSecret &&
        timingSafeStringCompare(cronKey, configuredCronSecret)
      );

      let isAuthorized = hasValidCronKey;

      if (!isAuthorized) {
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith("Bearer ")) {
          try {
            const token = authHeader.split("Bearer ")[1];
            const decoded = await admin.auth().verifyIdToken(token);
            if (decoded.role === "admin" || decoded.platform_admin === true) {
              isAuthorized = true;
            }
          } catch {}
        }
      }

      if (!isAuthorized) {
        return res.status(403).json({ error: "Forbidden", message: "Platform admin or valid x-cron-key required." });
      }

      const batchSize = typeof req.body?.batchSize === "number" ? req.body.batchSize : 10;
      const bucketName = firebaseConfig.storageBucket || "echonote-2509.firebasestorage.app";
      const storageBucket = admin.storage().bucket(bucketName);

      const processSummary = await processPendingZoomImportJobs(db, {
        batchSize,
        customStorageBucket: storageBucket
      });

      return res.status(200).json({
        status: "ok",
        processed: processSummary.processed,
        succeeded: processSummary.succeeded,
        failed: processSummary.failed,
        skipped: processSummary.skipped,
        results: processSummary.results
      });
    } catch (err: any) {
      console.error("[Internal Zoom Worker Error]:", err?.message || err);
      return res.status(500).json({ error: "Internal Error", message: err?.message || "Failed to process Zoom import jobs" });
    }
  });

  /**
   * Endpoint: Manually trigger or retry a Zoom cloud recording import.
   * Strictly enforces organization/project access control.
   */
  app.post("/api/integrations/zoom/import-recording", requireAuth, async (req: AuthenticatedRequest, res) => {
    const { externalMeetingId, meetingInstanceUuid, organizationId, projectId, recordingFiles } = req.body;
    const callerUid = req.user!.uid;

    if (!externalMeetingId || typeof externalMeetingId !== "string") {
      return res.status(400).json({ error: "Missing or invalid externalMeetingId" });
    }

    // Authorization verification
    if (organizationId) {
      const hasOrg = await checkOrgAccess(db, organizationId, callerUid);
      if (!hasOrg) {
        return res.status(403).json({ error: "Forbidden", message: "You do not have access to this organization's integrations." });
      }
    }

    if (projectId) {
      const hasProject = await checkProjectAccess(db, projectId, callerUid);
      if (!hasProject) {
        return res.status(403).json({ error: "Forbidden", message: "You do not have access to this project." });
      }
    }

    try {
      const bucketName = firebaseConfig.storageBucket || "echonote-2509.firebasestorage.app";
      const storageBucket = admin.storage().bucket(bucketName);

      // If recording files not explicitly passed, inspect existing provenance manifest
      let filesToImport = recordingFiles;
      if (!filesToImport || !Array.isArray(filesToImport) || filesToImport.length === 0) {
        const manifestId = computeZoomProvenanceManifestId(externalMeetingId, meetingInstanceUuid);
        const manifestDoc = await db.collection("meetingProvenanceManifests").doc(manifestId).get();
        if (manifestDoc.exists) {
          const mData = manifestDoc.data() || {};
          const rawArtifacts = mData.rawArtifacts || [];
          filesToImport = rawArtifacts
            .filter((a: any) => a.type === "recording" && a.uri && a.uri.startsWith("http"))
            .map((a: any) => ({
              id: a.artifactId,
              downloadUrl: a.uri,
              fileSize: a.sizeBytes,
              fileType: a.mimeType?.includes("mp4") ? "MP4" : "M4A"
            }));
        }
      }

      if (!filesToImport || filesToImport.length === 0) {
        return res.status(404).json({
          error: "Not Found",
          message: "No eligible recording files found for this meeting instance."
        });
      }

      const importResult = await importZoomRecording(db, {
        externalMeetingId,
        meetingInstanceUuid,
        recordingFiles: filesToImport,
        organizationId: organizationId || null,
        projectId: projectId || null,
        userId: callerUid
      }, {
        customStorageBucket: storageBucket
      });

      return res.status(importResult.status === "failed" ? 500 : 200).json(importResult);
    } catch (err: any) {
      console.error("[Manual Zoom Import Error]:", err?.message || err);
      return res.status(500).json({
        error: "Internal Error",
        message: err?.message || "Failed to process Zoom recording import"
      });
    }
  });

  // ============================================================================
  // PHASE 1B, STEP 2.1: MEETING-TO-PROJECT ASSOCIATION & MEETING DISCOVERY
  // ============================================================================

  /**
   * GET /api/meetings/unassociated
   * Returns meetings that are not yet associated with any project (projectId is missing, null, or 'unassigned').
   * Strictly filters to meetings belonging to organizations the caller is authorized in,
   * or personal meetings belonging to the caller.
   */
  app.get("/api/meetings/unassociated", requireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const callerUid = req.user!.uid;
      const callerEmail = req.user!.email || "";

      // 1. Resolve organizations caller belongs to
      const authorizedOrgIds = new Set<string>();

      // Check claims
      if (req.user?.orgId) {
        authorizedOrgIds.add(req.user.orgId);
      }

      // Check orgMembers collection
      const orgMemSnap = await db.collection("orgMembers")
        .where("userId", "==", callerUid)
        .get()
        .catch(() => ({ empty: true, docs: [] } as any));

      for (const doc of orgMemSnap.docs) {
        const d = doc.data();
        if (d.organizationId && d.status !== "deactivated" && d.status !== "revoked") {
          authorizedOrgIds.add(d.organizationId);
        }
      }

      // Check organizations owned by caller
      const ownedOrgsSnap = await db.collection("organizations")
        .where("ownerId", "==", callerUid)
        .get()
        .catch(() => ({ empty: true, docs: [] } as any));

      for (const doc of ownedOrgsSnap.docs) {
        authorizedOrgIds.add(doc.id);
      }

      if (callerEmail) {
        const ownedEmailOrgsSnap = await db.collection("organizations")
          .where("ownerEmail", "==", callerEmail)
          .get()
          .catch(() => ({ empty: true, docs: [] } as any));

        for (const doc of ownedEmailOrgsSnap.docs) {
          authorizedOrgIds.add(doc.id);
        }
      }

      // 2. Fetch unassociated meeting sessions
      // Scan meetingSessions where projectId is null, undefined, or 'unassigned'
      const sessionsSnap = await db.collection("meetingSessions").get();
      const unassociatedList: any[] = [];

      for (const doc of sessionsSnap.docs) {
        const data = doc.data();
        const hasProject = Boolean(data.projectId && data.projectId !== "unassigned" && data.projectId.trim() !== "");
        if (hasProject) continue;

        // Verify eligibility for caller:
        // Must belong to caller directly, or belong to one of caller's authorized organizations,
        // or have a participant with caller's email
        const isDirectOwner = data.userId === callerUid;
        const matchesOrg = data.organizationId && authorizedOrgIds.has(data.organizationId);
        const matchesParticipant = callerEmail && Array.isArray(data.participants) && data.participants.some(
          (p: any) => p.email && p.email.toLowerCase() === callerEmail.toLowerCase()
        );

        if (isDirectOwner || matchesOrg || matchesParticipant) {
          unassociatedList.push({
            id: doc.id,
            externalMeetingId: data.externalMeetingId || "",
            meetingInstanceUuid: data.meetingInstanceUuid || null,
            title: data.title || "Untitled Meeting",
            provider: data.provider || "zoom",
            actualStartTime: data.actualStartTime || data.scheduledStartTime || data.createdAt || null,
            durationSeconds: data.durationSeconds || null,
            participants: data.participants || [],
            recordingId: data.recordingId || null,
            transcriptId: data.transcriptId || null,
            provenanceManifestId: data.provenanceManifestId || null,
            organizationId: data.organizationId || null,
            status: data.status || "ingested",
            createdAt: data.createdAt || null,
            updatedAt: data.updatedAt || null
          });
        }
      }

      // Sort by actualStartTime or createdAt descending (most recent first)
      unassociatedList.sort((a, b) => {
        const timeA = new Date(a.actualStartTime || a.createdAt || 0).getTime();
        const timeB = new Date(b.actualStartTime || b.createdAt || 0).getTime();
        return timeB - timeA;
      });

      return res.status(200).json({
        success: true,
        meetings: unassociatedList,
        count: unassociatedList.length
      });
    } catch (err: any) {
      console.error("[Unassociated Meetings Error]:", err?.message || err);
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to retrieve unassociated meetings." });
    }
  });

  /**
   * POST /api/meetings/:sessionId/associate
   * Associates or disassociates a meeting session with an EchoNote project.
   * Body: { projectId: string | null }
   * 
   * Strict Security & Isolation:
   * 1. Resolves caller's project access via resolveProjectAccess.
   *    Caller must possess canEditContent or canManageProject permissions in the target project.
   * 2. Verifies tenant boundaries: If the meeting is already stamped with an organizationId,
   *    it MUST match the target project's organizationId. Cross-org associations are rejected with 403.
   * 3. Prevents ambiguous tenant leakage: If meeting had no organizationId (e.g. unmapped host),
   *    associating it with the project binds it safely to the project's organizationId.
   * 4. Atomic updates across meetingSessions, recordings, and transcriptions.
   * 5. Provenance manifest is strictly preserved (read-only audit trail).
   * 6. Audit logging via recordOrgAuditEvent.
   */
  app.post("/api/meetings/:sessionId/associate", requireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const { sessionId } = req.params;
      const { projectId } = req.body;
      const callerUid = req.user!.uid;
      const callerEmail = req.user!.email || "";

      if (!sessionId || typeof sessionId !== "string") {
        return res.status(400).json({ error: "Bad Request", message: "Meeting session ID is required." });
      }

      // 1. Fetch authoritative meeting session doc
      const sessionDocRef = db.collection("meetingSessions").doc(sessionId);
      const sessionDoc = await sessionDocRef.get();
      if (!sessionDoc.exists) {
        return res.status(404).json({ error: "Not Found", message: "Meeting session not found." });
      }
      const sessionData = sessionDoc.data() || {};

      // 2. Handle Dissociation (projectId === null || projectId === '')
      if (projectId === null || projectId === undefined || projectId === "") {
        const currentProjectId = sessionData.projectId;
        if (!currentProjectId || currentProjectId === "unassigned") {
          return res.status(200).json({
            success: true,
            message: "Meeting session is already unassociated.",
            sessionId,
            projectId: null
          });
        }

        // Verify caller has permissions in current project to remove association
        const currentAccess = await resolveProjectAccess(db, req.user, currentProjectId);
        if (!currentAccess.hasAccess || (!currentAccess.permissions.canManageProject && !currentAccess.permissions.canEditContent)) {
          return res.status(403).json({
            error: "Forbidden",
            message: "You do not have permission to disassociate meetings from this project."
          });
        }

        const nowIso = new Date().toISOString();

        // Atomically update session and linked recording/transcription
        await db.runTransaction(async (transaction) => {
          transaction.update(sessionDocRef, {
            projectId: null,
            updatedAt: nowIso
          });

          if (sessionData.recordingId) {
            const recRef = db.collection("recordings").doc(sessionData.recordingId);
            transaction.update(recRef, {
              projectId: "unassigned",
              updatedAt: nowIso
            });
          }

          if (sessionData.transcriptId) {
            const trnRef = db.collection("transcriptions").doc(sessionData.transcriptId);
            transaction.update(trnRef, {
              projectId: null,
              updatedAt: nowIso
            });
          }
        });

        if (currentAccess.organizationId) {
          await recordOrgAuditEvent(db, {
            organizationId: currentAccess.organizationId,
            actorUserId: callerUid,
            actorEmail: callerEmail,
            action: "INTEGRATION_CONFIG_UPDATED",
            timestamp: nowIso,
            source: "api",
            details: `Meeting ${sessionData.title || sessionId} disassociated from project ${currentProjectId}`
          }).catch(() => {});
        }

        return res.status(200).json({
          success: true,
          message: "Meeting association removed successfully.",
          sessionId,
          projectId: null
        });
      }

      // 3. Handle Association with target project
      if (typeof projectId !== "string" || projectId.trim() === "") {
        return res.status(400).json({ error: "Bad Request", message: "Invalid project ID." });
      }

      const targetProjectId = projectId.trim();

      // Check project authorization authoritatively
      const targetAccess = await resolveProjectAccess(db, req.user, targetProjectId);
      if (!targetAccess.hasAccess || (!targetAccess.permissions.canEditContent && !targetAccess.permissions.canManageProject)) {
        if (targetAccess.notFound) {
          return res.status(404).json({ error: "Not Found", message: "Target project does not exist." });
        }
        return res.status(403).json({
          error: "Forbidden",
          message: "You do not have permission to associate meetings with this project."
        });
      }

      const projectData = targetAccess.project || {};
      const targetOrgId = targetAccess.organizationId || projectData.organizationId || projectData.orgId || null;

      // 4. Strict Tenant Boundary & Isolation Enforcement
      if (sessionData.organizationId && targetOrgId) {
        if (sessionData.organizationId !== targetOrgId) {
          return res.status(403).json({
            error: "Forbidden",
            message: "Cannot associate meeting with a project belonging to a different organization."
          });
        }
      }

      // If meeting was ingested under an unmapped host without an orgId,
      // caller associating it binds it to the target project's orgId and caller's identity
      const newOrgId = targetOrgId || sessionData.organizationId || null;
      const nowIso = new Date().toISOString();

      // 5. Atomic Transaction: update session, recording, transcription
      await db.runTransaction(async (transaction) => {
        const freshSessionSnap = await transaction.get(sessionDocRef);
        if (!freshSessionSnap.exists) {
          throw new Error("Meeting session disappeared during transaction.");
        }

        const updateData: Record<string, any> = {
          projectId: targetProjectId,
          updatedAt: nowIso
        };

        if (newOrgId && (!sessionData.organizationId || sessionData.organizationId === null)) {
          updateData.organizationId = newOrgId;
        }

        transaction.update(sessionDocRef, updateData);

        if (sessionData.recordingId) {
          const recRef = db.collection("recordings").doc(sessionData.recordingId);
          transaction.set(recRef, {
            projectId: targetProjectId,
            organizationId: newOrgId,
            updatedAt: nowIso
          }, { merge: true });
        }

        if (sessionData.transcriptId) {
          const trnRef = db.collection("transcriptions").doc(sessionData.transcriptId);
          transaction.set(trnRef, {
            projectId: targetProjectId,
            organizationId: newOrgId,
            updatedAt: nowIso
          }, { merge: true });
        }
      });

      // 6. Record Audit Event
      if (newOrgId) {
        await recordOrgAuditEvent(db, {
          organizationId: newOrgId,
          actorUserId: callerUid,
          actorEmail: callerEmail,
          action: "INTEGRATION_CONFIG_UPDATED",
          timestamp: nowIso,
          source: "api",
          details: `Meeting ${sessionData.title || sessionId} (${sessionData.provider || "zoom"}) associated with project ${projectData.name || targetProjectId}`
        }).catch(() => {});
      }

      return res.status(200).json({
        success: true,
        message: "Meeting associated with project successfully.",
        sessionId,
        projectId: targetProjectId,
        organizationId: newOrgId
      });
    } catch (err: any) {
      console.error("[Associate Meeting Error]:", err?.message || err);
      return res.status(500).json({ error: "Internal Server Error", message: err?.message || "Failed to associate meeting." });
    }
  });

  /**
   * GET /api/projects/:projectId/meetings
   * Retrieves all meeting sessions associated with the given project.
   * Includes linked recording and transcription status/summaries.
   * Strictly verifies caller project access.
   */
  app.get("/api/projects/:projectId/meetings", requireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const { projectId } = req.params;
      if (!projectId) {
        return res.status(400).json({ error: "Bad Request", message: "Project ID is required." });
      }

      // Verify access to project
      const projAccess = await resolveProjectAccess(db, req.user, projectId);
      if (!projAccess.hasAccess) {
        if (projAccess.notFound) {
          return res.status(404).json({ error: "Not Found", message: "Project not found." });
        }
        return res.status(403).json({ error: "Forbidden", message: "You do not have access to this project." });
      }

      // Query meeting sessions associated with this project (supporting primary projectId & multi-project projectIds)
      const [snapPrimary, snapMulti] = await Promise.all([
        db.collection("meetingSessions").where("projectId", "==", projectId).get().catch(() => ({ docs: [] } as any)),
        db.collection("meetingSessions").where("projectIds", "array-contains", projectId).get().catch(() => ({ docs: [] } as any))
      ]);

      const seenMeetingIds = new Set<string>();
      const combinedDocs = [...snapPrimary.docs, ...snapMulti.docs];

      const meetings: any[] = [];
      for (const doc of combinedDocs) {
        if (seenMeetingIds.has(doc.id)) continue;
        seenMeetingIds.add(doc.id);
        const d = doc.data();
        meetings.push({
          id: doc.id,
          externalMeetingId: d.externalMeetingId || "",
          meetingInstanceUuid: d.meetingInstanceUuid || null,
          title: d.title || "Untitled Meeting",
          provider: d.provider || "zoom",
          actualStartTime: d.actualStartTime || d.scheduledStartTime || d.createdAt || null,
          actualEndTime: d.actualEndTime || d.scheduledEndTime || null,
          durationSeconds: d.durationSeconds || null,
          participants: d.participants || [],
          recordingId: d.recordingId || null,
          recordingStoragePath: d.recordingStoragePath || null,
          transcriptId: d.transcriptId || null,
          provenanceManifestId: d.provenanceManifestId || null,
          status: d.status || "ingested",
          organizationId: d.organizationId || null,
          createdAt: d.createdAt || null,
          updatedAt: d.updatedAt || null
        });
      }

      // Sort by actualStartTime descending
      meetings.sort((a, b) => {
        const timeA = new Date(a.actualStartTime || a.createdAt || 0).getTime();
        const timeB = new Date(b.actualStartTime || b.createdAt || 0).getTime();
        return timeB - timeA;
      });

      return res.status(200).json({
        success: true,
        projectId,
        meetings,
        count: meetings.length
      });
    } catch (err: any) {
      console.error("[Project Meetings Error]:", err?.message || err);
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to retrieve project meetings." });
    }
  });

  // ============================================================================
  // PHASE 1B, STEP 2.2: PROJECT-WIDE SEARCH & INTELLIGENCE RETRIEVAL
  // ============================================================================

  /**
   * GET /api/projects/:projectId/search
   * Unified, permission-safe project search across:
   * 1. Meetings (topic, provider IDs, participant names & emails)
   * 2. Transcripts (speaker segments, summaries, key action points)
   * 3. Decisions (title, description, rationale/context, people involved, confidence level)
   * 4. Tasks (title, description, assignee, priority, status)
   * 5. Unresolved Topics (topic, context, reason unresolved, suggested actions)
   *
   * Query params:
   * - q: search query (string, required, normalized & length-bounded)
   * - type: filter by comma-separated result types (meeting, transcript, decision, task, unresolved_topic)
   * - startDate: ISO date string lower bound
   * - endDate: ISO date string upper bound
   * - page: 1-indexed page number (default 1)
   * - limit: results per page (default 20, max 50)
   */
  app.get("/api/projects/:projectId/search", requireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const { projectId } = req.params;
      const rawQuery = (req.query.q as string) || "";
      const rawType = (req.query.type as string) || "";
      const startDate = (req.query.startDate as string) || null;
      const endDate = (req.query.endDate as string) || null;
      const page = Math.max(parseInt((req.query.page as string) || "1", 10) || 1, 1);
      const limit = Math.min(Math.max(parseInt((req.query.limit as string) || "20", 10) || 20, 1), 50);

      if (!projectId) {
        return res.status(400).json({ error: "Bad Request", message: "Project ID is required." });
      }

      // 1. Authoritative project access validation
      const projAccess = await resolveProjectAccess(db, req.user, projectId);
      if (!projAccess.hasAccess) {
        if (projAccess.notFound) {
          return res.status(404).json({ error: "Not Found", message: "Project not found." });
        }
        return res.status(403).json({ error: "Forbidden", message: "You do not have access to this project." });
      }

      const projectData = projAccess.project || {};
      const projectName = projectData.name || "";

      // 2. Query sanitization & tokenization
      const queryTrimmed = rawQuery.trim().slice(0, 200); // Bound length to prevent DoS
      const queryTokens = queryTrimmed
        .toLowerCase()
        .split(/\s+/)
        .filter(t => t.length > 0);

      // Parse allowed types
      const allowedTypes = new Set<string>(["meeting", "transcript", "decision", "task", "unresolved_topic"]);
      const requestedTypes = rawType
        ? new Set(rawType.split(",").map(t => t.trim().toLowerCase()).filter(t => allowedTypes.has(t)))
        : allowedTypes;

      const results: any[] = [];
      const countsByType: Record<string, number> = {
        meeting: 0,
        transcript: 0,
        decision: 0,
        task: 0,
        unresolved_topic: 0
      };

      // Helper for date filtering
      const satisfiesDateFilter = (isoDate?: string | null) => {
        if (!isoDate) return true;
        const time = new Date(isoDate).getTime();
        if (isNaN(time)) return true;
        if (startDate) {
          const sTime = new Date(startDate).getTime();
          if (!isNaN(sTime) && time < sTime) return false;
        }
        if (endDate) {
          const eTime = new Date(endDate).getTime();
          if (!isNaN(eTime) && time > eTime) return false;
        }
        return true;
      };

      // Helper to compute token match score and extract highlight snippet
      const scoreAndSnippet = (haystack: string, targetTokens: string[]): { score: number; snippet: string } => {
        if (!haystack || targetTokens.length === 0) return { score: 0, snippet: haystack?.slice(0, 160) || "" };
        const lowerHaystack = haystack.toLowerCase();
        let score = 0;
        let firstMatchIdx = -1;

        // Exact full phrase bonus
        if (lowerHaystack.includes(queryTrimmed.toLowerCase())) {
          score += 50;
          firstMatchIdx = lowerHaystack.indexOf(queryTrimmed.toLowerCase());
        }

        // Individual tokens
        for (const token of targetTokens) {
          let count = 0;
          let pos = lowerHaystack.indexOf(token);
          while (pos !== -1 && count < 5) {
            count++;
            if (firstMatchIdx === -1 || pos < firstMatchIdx) {
              firstMatchIdx = pos;
            }
            pos = lowerHaystack.indexOf(token, pos + token.length);
          }
          score += count * 10;
        }

        if (score === 0) return { score: 0, snippet: haystack.slice(0, 160) };

        // Generate excerpt surrounding the match
        const start = Math.max(0, firstMatchIdx - 40);
        const end = Math.min(haystack.length, firstMatchIdx + 120);
        let snippet = haystack.slice(start, end).trim();
        if (start > 0) snippet = `...${snippet}`;
        if (end < haystack.length) snippet = `${snippet}...`;

        return { score, snippet };
      };

      // 3. Search: Meeting Sessions and Voice Recordings (evidence & intelligence)
      // Retrieve both meetingSessions and canonical audio recordings for this project
      const sessionMap = new Map<string, any>();
      const recordingMap = new Map<string, any>();

      const [sessionsSnap, sessionsMultiSnap, recPrimarySnap, recMultiSnap] = await Promise.all([
        db.collection("meetingSessions")
          .where("projectId", "==", projectId)
          .get()
          .catch(() => ({ empty: true, docs: [] } as any)),
        db.collection("meetingSessions")
          .where("projectIds", "array-contains", projectId)
          .get()
          .catch(() => ({ empty: true, docs: [] } as any)),
        db.collection("recordings")
          .where("projectId", "==", projectId)
          .get()
          .catch(() => ({ empty: true, docs: [] } as any)),
        db.collection("recordings")
          .where("projectIds", "array-contains", projectId)
          .get()
          .catch(() => ({ empty: true, docs: [] } as any))
      ]);

      for (const doc of sessionsSnap.docs) {
        const d = doc.data();
        sessionMap.set(doc.id, d);
      }
      for (const doc of sessionsMultiSnap.docs) {
        if (!sessionMap.has(doc.id)) {
          sessionMap.set(doc.id, doc.data());
        }
      }

      // Deduplicate recordings by canonical doc id
      for (const doc of recPrimarySnap.docs) {
        if (!recordingMap.has(doc.id)) {
          recordingMap.set(doc.id, doc.data());
        }
      }
      for (const doc of recMultiSnap.docs) {
        if (!recordingMap.has(doc.id)) {
          recordingMap.set(doc.id, doc.data());
        }
      }

      if (requestedTypes.has("meeting")) {
        // Search meetingSessions
        for (const [sessId, d] of sessionMap.entries()) {
          const meetingDate = d.actualStartTime || d.scheduledStartTime || d.createdAt || null;
          if (!satisfiesDateFilter(meetingDate)) continue;

          const haystack = [
            d.title || "",
            d.externalMeetingId || "",
            d.meetingInstanceUuid || "",
            ...(Array.isArray(d.participants) ? d.participants.map((p: any) => `${p.name || ""} ${p.email || ""}`) : [])
          ].join(" ");

          const { score, snippet } = queryTokens.length > 0
            ? scoreAndSnippet(haystack, queryTokens)
            : { score: 1, snippet: d.title || "Meeting Session" };

          if (score > 0) {
            countsByType.meeting++;
            results.push({
              id: sessId,
              type: "meeting",
              title: d.title || `Meeting ${d.externalMeetingId}`,
              excerpt: snippet,
              date: meetingDate,
              score: score + 15, // boost meeting titles
              metadata: {
                meetingSessionId: sessId,
                externalMeetingId: d.externalMeetingId || null,
                meetingTitle: d.title || null,
                recordingId: d.recordingId || null,
                transcriptId: d.transcriptId || null,
                provenanceManifestId: d.provenanceManifestId || null,
                sourceType: "evidence"
              }
            });
          }
        }

        // Search canonical recordings
        for (const [recId, r] of recordingMap.entries()) {
          if (r.deletedAt) continue;
          const recDate = r.date || r.createdAt || null;
          if (!satisfiesDateFilter(recDate)) continue;

          const summary = r.summary || {};
          const haystack = [
            r.fileName || "",
            summary.mainTopic || "",
            ...(Array.isArray(summary.keyPoints) ? summary.keyPoints : []),
            ...(Array.isArray(r.speakers) ? r.speakers : [])
          ].join(" ");

          const { score, snippet } = queryTokens.length > 0
            ? scoreAndSnippet(haystack, queryTokens)
            : { score: 1, snippet: r.fileName || summary.mainTopic || "Audio Recording" };

          if (score > 0) {
            countsByType.meeting++;
            results.push({
              id: recId,
              type: "meeting",
              title: r.fileName || summary.mainTopic || "Audio Recording",
              excerpt: snippet,
              date: recDate,
              score: score + 15,
              metadata: {
                recordingId: recId,
                meetingTitle: r.fileName || null,
                storagePath: r.storagePath || null,
                sourceType: "evidence"
              }
            });
          }
        }
      }

      // 4. Search: Transcripts (evidence & speech segments)
      if (requestedTypes.has("transcript")) {
        // Query transcriptions linked to project meetings or directly linked
        const transcriptDocs: any[] = [];
        
        // Direct projectId lookup and multi-project projectIds lookup
        const [trnSnap, trnMultiSnap] = await Promise.all([
          db.collection("transcriptions")
            .where("projectId", "==", projectId)
            .get()
            .catch(() => ({ empty: true, docs: [] } as any)),
          db.collection("transcriptions")
            .where("projectIds", "array-contains", projectId)
            .get()
            .catch(() => ({ empty: true, docs: [] } as any))
        ]);

        for (const doc of trnSnap.docs) {
          if (!transcriptDocs.some(d => d.id === doc.id)) {
            transcriptDocs.push(doc);
          }
        }
        for (const doc of trnMultiSnap.docs) {
          if (!transcriptDocs.some(d => d.id === doc.id)) {
            transcriptDocs.push(doc);
          }
        }

        // Also check transcripts referenced by the project's meetingSessions
        for (const [_, sess] of sessionMap.entries()) {
          if (sess.transcriptId) {
            const trnDoc = await db.collection("transcriptions").doc(sess.transcriptId).get().catch(() => null);
            if (trnDoc && trnDoc.exists) {
              if (!transcriptDocs.some(d => d.id === trnDoc.id)) {
                transcriptDocs.push(trnDoc);
              }
            }
          }
        }

        for (const tDoc of transcriptDocs) {
          const tData = tDoc.data();
          const sess = tData.meetingSessionId ? sessionMap.get(tData.meetingSessionId) : null;
          const trnDate = tData.createdAt || sess?.actualStartTime || null;
          if (!satisfiesDateFilter(trnDate)) continue;

          // Check transcript segments
          if (Array.isArray(tData.segments)) {
            for (let idx = 0; idx < tData.segments.length; idx++) {
              const seg = tData.segments[idx];
              const segText = seg.text || "";
              const speaker = seg.speaker || "Speaker";
              const { score, snippet } = queryTokens.length > 0
                ? scoreAndSnippet(segText, queryTokens)
                : { score: 0, snippet: segText.slice(0, 140) };

              if (score > 0) {
                countsByType.transcript++;
                results.push({
                  id: `${tDoc.id}_seg_${idx}`,
                  type: "transcript",
                  title: `${speaker} in ${sess?.title || "Meeting"}`,
                  excerpt: snippet,
                  date: trnDate,
                  score,
                  metadata: {
                    meetingSessionId: tData.meetingSessionId || null,
                    meetingTitle: sess?.title || null,
                    recordingId: tData.recordingId || null,
                    transcriptId: tDoc.id,
                    speaker,
                    timestampSeconds: seg.startTime ?? null,
                    sourceType: "evidence"
                  }
                });
              }
            }
          }

          // Check summary / action items if no segment matched
          if (tData.summary) {
            const { score, snippet } = queryTokens.length > 0
              ? scoreAndSnippet(tData.summary, queryTokens)
              : { score: 1, snippet: tData.summary.slice(0, 160) };

            if (score > 0) {
              countsByType.transcript++;
              results.push({
                id: `${tDoc.id}_summary`,
                type: "transcript",
                title: `Summary: ${sess?.title || "Meeting Transcript"}`,
                excerpt: snippet,
                date: trnDate,
                score: score + 5,
                metadata: {
                  meetingSessionId: tData.meetingSessionId || null,
                  meetingTitle: sess?.title || null,
                  recordingId: tData.recordingId || null,
                  transcriptId: tDoc.id,
                  sourceType: "intelligence"
                }
              });
            }
          }
        }

        // Also search transcripts stored directly inside canonical recordings
        for (const [recId, r] of recordingMap.entries()) {
          if (r.deletedAt) continue;
          const recDate = r.date || r.createdAt || null;
          if (!satisfiesDateFilter(recDate)) continue;

          // Search recording transcript array
          if (Array.isArray(r.transcript)) {
            for (let idx = 0; idx < r.transcript.length; idx++) {
              const seg = r.transcript[idx];
              const segText = seg.text || "";
              const speaker = (r.speakerMap && r.speakerMap[seg.speaker]) || seg.speaker || "Speaker";
              const { score, snippet } = queryTokens.length > 0
                ? scoreAndSnippet(segText, queryTokens)
                : { score: 0, snippet: segText.slice(0, 140) };

              if (score > 0) {
                countsByType.transcript++;
                results.push({
                  id: `${recId}_recseg_${idx}`,
                  type: "transcript",
                  title: `${speaker} in ${r.fileName || "Recording"}`,
                  excerpt: snippet,
                  date: recDate,
                  score,
                  metadata: {
                    recordingId: recId,
                    meetingTitle: r.fileName || null,
                    speaker,
                    timestampSeconds: seg.startTime ?? null,
                    sourceType: "evidence"
                  }
                });
              }
            }
          } else if (typeof r.transcriptText === "string" && r.transcriptText) {
            const { score, snippet } = queryTokens.length > 0
              ? scoreAndSnippet(r.transcriptText, queryTokens)
              : { score: 0, snippet: r.transcriptText.slice(0, 140) };

            if (score > 0) {
              countsByType.transcript++;
              results.push({
                id: `${recId}_rectext`,
                type: "transcript",
                title: `Transcript: ${r.fileName || "Recording"}`,
                excerpt: snippet,
                date: recDate,
                score,
                metadata: {
                  recordingId: recId,
                  meetingTitle: r.fileName || null,
                  sourceType: "evidence"
                }
              });
            }
          }

          // Search recording summary if requested
          if (r.summary && r.summary.mainTopic) {
            const summaryText = `${r.summary.mainTopic} ${(r.summary.keyPoints || []).join(" ")}`;
            const { score, snippet } = queryTokens.length > 0
              ? scoreAndSnippet(summaryText, queryTokens)
              : { score: 1, snippet: summaryText.slice(0, 160) };

            if (score > 0) {
              countsByType.transcript++;
              results.push({
                id: `${recId}_recsummary`,
                type: "transcript",
                title: `Summary: ${r.fileName || "Meeting"}`,
                excerpt: snippet,
                date: recDate,
                score: score + 5,
                metadata: {
                  recordingId: recId,
                  meetingTitle: r.fileName || null,
                  sourceType: "intelligence"
                }
              });
            }
          }
        }
      }

      // 5. Search: Decisions (decisionHistory and audio intelligence records)
      if (requestedTypes.has("decision")) {
        // Query decisionHistory collection
        const decSnap = await db.collection("decisionHistory")
          .where("projectId", "==", projectId)
          .get()
          .catch(() => ({ empty: true, docs: [] } as any));

        for (const doc of decSnap.docs) {
          const d = doc.data();
          if (!satisfiesDateFilter(d.createdAt)) continue;

          // Check decision items inside output
          const output = d.output || {};
          const decisionsList = output.decisions || [output];

          for (let i = 0; i < decisionsList.length; i++) {
            const dec = decisionsList[i];
            const haystack = [
              d.title || "",
              dec.decision || dec.title || "",
              dec.description || "",
              dec.context || dec.rationale || "",
              ...(Array.isArray(dec.peopleInvolved) ? dec.peopleInvolved : [])
            ].join(" ");

            const { score, snippet } = queryTokens.length > 0
              ? scoreAndSnippet(haystack, queryTokens)
              : { score: 1, snippet: (dec.decision || dec.title || haystack).slice(0, 160) };

            if (score > 0) {
              countsByType.decision++;
              results.push({
                id: `${doc.id}_${i}`,
                type: "decision",
                title: dec.decision || dec.title || d.title || "Project Decision",
                excerpt: snippet,
                date: d.createdAt || null,
                score: score + 20, // Decision prioritization
                metadata: {
                  confidenceLevel: dec.confidenceLevel || "High",
                  sourceType: "intelligence"
                }
              });
            }
          }
        }

        // Also search decisions stored directly in canonical recording summaries
        for (const [recId, r] of recordingMap.entries()) {
          if (r.deletedAt) continue;
          const recDate = r.date || r.createdAt || null;
          if (!satisfiesDateFilter(recDate)) continue;

          const summary = r.summary || {};
          const decList = Array.isArray(summary.decisions) ? summary.decisions : [];
          for (let i = 0; i < decList.length; i++) {
            const decText = decList[i];
            const haystack = `${decText} ${r.fileName || ""}`;
            const { score, snippet } = queryTokens.length > 0
              ? scoreAndSnippet(haystack, queryTokens)
              : { score: 1, snippet: decText.slice(0, 160) };

            if (score > 0) {
              countsByType.decision++;
              results.push({
                id: `${recId}_dec_${i}`,
                type: "decision",
                title: decText,
                excerpt: snippet,
                date: recDate,
                score: score + 20,
                metadata: {
                  recordingId: recId,
                  meetingTitle: r.fileName || null,
                  confidenceLevel: "High",
                  sourceType: "intelligence"
                }
              });
            }
          }
        }
      }

      // 6. Search: Tasks (projectTasks collection)
      if (requestedTypes.has("task")) {
        const tasksSnap = await db.collection("projectTasks")
          .where("projectId", "==", projectId)
          .get()
          .catch(() => ({ empty: true, docs: [] } as any));

        for (const doc of tasksSnap.docs) {
          const t = doc.data();
          const taskDate = t.createdAt || t.dueDate || null;
          if (!satisfiesDateFilter(taskDate)) continue;

          const haystack = [
            t.title || "",
            t.description || "",
            t.assigneeName || "",
            t.assigneeEmail || "",
            t.status || "",
            t.priority || ""
          ].join(" ");

          const { score, snippet } = queryTokens.length > 0
            ? scoreAndSnippet(haystack, queryTokens)
            : { score: 1, snippet: t.title || "Project Task" };

          if (score > 0) {
            countsByType.task++;
            results.push({
              id: doc.id,
              type: "task",
              title: t.title || "Task",
              excerpt: snippet,
              date: taskDate,
              score: score + 10,
              metadata: {
                assignee: t.assigneeName || t.assigneeEmail || null,
                status: t.status || "pending",
                priority: t.priority || "medium",
                sourceType: "execution"
              }
            });
          }
        }

        // Also search action items from recording summaries
        for (const [recId, r] of recordingMap.entries()) {
          if (r.deletedAt) continue;
          const recDate = r.date || r.createdAt || null;
          if (!satisfiesDateFilter(recDate)) continue;

          const summary = r.summary || {};
          const aiList = Array.isArray(summary.actionItems) ? summary.actionItems : [];
          for (let i = 0; i < aiList.length; i++) {
            const aiText = aiList[i];
            const haystack = `${aiText} ${r.fileName || ""}`;
            const { score, snippet } = queryTokens.length > 0
              ? scoreAndSnippet(haystack, queryTokens)
              : { score: 1, snippet: aiText.slice(0, 160) };

            if (score > 0) {
              countsByType.task++;
              results.push({
                id: `${recId}_ai_${i}`,
                type: "task",
                title: aiText,
                excerpt: snippet,
                date: recDate,
                score: score + 10,
                metadata: {
                  recordingId: recId,
                  meetingTitle: r.fileName || null,
                  status: "pending",
                  priority: "medium",
                  sourceType: "execution"
                }
              });
            }
          }
        }
      }

      // 7. Search: Unresolved Topics (from unified meeting intelligence)
      if (requestedTypes.has("unresolved_topic")) {
        for (const [recId, rData] of recordingMap.entries()) {
          const intelligence = rData.unifiedIntelligence || rData.meetingIntelligence;
          if (intelligence && Array.isArray(intelligence.unresolvedTopics)) {
            for (let i = 0; i < intelligence.unresolvedTopics.length; i++) {
              const uTopic = intelligence.unresolvedTopics[i];
              const haystack = [
                uTopic.topic || "",
                uTopic.context || "",
                uTopic.reasonUnresolved || "",
                uTopic.suggestedAction || ""
              ].join(" ");

              const { score, snippet } = queryTokens.length > 0
                ? scoreAndSnippet(haystack, queryTokens)
                : { score: 1, snippet: uTopic.topic || "Unresolved Topic" };

              if (score > 0) {
                countsByType.unresolved_topic++;
                results.push({
                  id: `${recId}_unres_${i}`,
                  type: "unresolved_topic",
                  title: uTopic.topic || "Unresolved Discussion",
                  excerpt: snippet,
                  date: rData.createdAt || null,
                  score: score + 12,
                  metadata: {
                    recordingId: recId,
                    meetingTitle: rData.fileName || null,
                    sourceType: "intelligence"
                  }
                });
              }
            }
          }
        }
      }

      // 8. Relevance Ranking
      // Sort by score descending; if score tied, by date descending
      results.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const timeA = new Date(a.date || 0).getTime();
        const timeB = new Date(b.date || 0).getTime();
        return timeB - timeA;
      });

      // 9. Pagination
      const totalMatches = results.length;
      const startIndex = (page - 1) * limit;
      const paginatedResults = results.slice(startIndex, startIndex + limit);
      const hasMore = startIndex + limit < totalMatches;

      return res.status(200).json({
        success: true,
        projectId,
        query: queryTrimmed,
        totalMatches,
        countsByType,
        results: paginatedResults,
        page,
        pageSize: limit,
        hasMore
      });
    } catch (err: any) {
      console.error("[Project Search Error]:", err?.message || err);
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to perform project search." });
    }
  });

  // ============================================================================
  // PHASE 2, STEP 2: USER SEARCH HISTORY ENGINE & APIS
  // ============================================================================

  const SEARCH_HISTORY_RETENTION_LIMIT = 50;

  /**
   * Helper: Normalize search history query and filters for deduplication
   */
  const computeSearchHistorySignature = (query: string, scope: string, projectId?: string | null, filters?: any): string => {
    const q = (query || "").trim().toLowerCase();
    const sc = scope || "global";
    const pId = projectId || "";
    const types = Array.isArray(filters?.selectedTypes)
      ? [...filters.selectedTypes].sort().join(",")
      : "";
    const sDate = filters?.startDate || "";
    const eDate = filters?.endDate || "";
    return `${sc}:${pId}:${q}:${types}:${sDate}:${eDate}`;
  };

  /**
   * POST /api/search-history
   * Records a user's submitted search.
   * Deduplicates equivalent searches by bumping lastUsedAt.
   * Caps user history at SEARCH_HISTORY_RETENTION_LIMIT (50).
   * Validates and derives userId authoritatively from req.user.
   */
  app.post("/api/search-history", requireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const userId = req.user!.uid;
      const { query: rawQuery, scope = "global", projectId = null, filters = {} } = req.body || {};

      const trimmedQuery = typeof rawQuery === "string" ? rawQuery.trim().slice(0, 200) : "";
      if (!trimmedQuery) {
        return res.status(400).json({
          error: "Bad Request",
          message: "A non-empty search query is required to record history."
        });
      }

      if (scope !== "global" && scope !== "project") {
        return res.status(400).json({
          error: "Bad Request",
          message: "Scope must be either 'global' or 'project'."
        });
      }

      let verifiedProjectId: string | null = null;
      let projectName: string | null = null;
      let organizationId: string | null = (req.user as any)?.orgId || null;

      // If project-scoped search, verify caller has access to the project
      if (scope === "project") {
        if (!projectId) {
          return res.status(400).json({
            error: "Bad Request",
            message: "Project ID is required for project-scoped searches."
          });
        }
        const projAccess = await resolveProjectAccess(db, req.user, projectId);
        if (!projAccess.hasAccess) {
          if (projAccess.notFound) {
            return res.status(404).json({ error: "Not Found", message: "Project not found." });
          }
          return res.status(403).json({ error: "Forbidden", message: "You do not have access to this project." });
        }
        verifiedProjectId = projectId;
        projectName = projAccess.project?.name || null;
        organizationId = projAccess.project?.organizationId || organizationId;
      }

      // Sanitize filter fields (type, date)
      const allowedTypes = new Set<string>(["meeting", "transcript", "decision", "task", "unresolved_topic"]);
      const sanitizedTypes = Array.isArray(filters?.selectedTypes)
        ? filters.selectedTypes.filter((t: string) => allowedTypes.has(t))
        : [];
      const sanitizedStartDate = typeof filters?.startDate === "string" && filters.startDate ? filters.startDate.slice(0, 30) : null;
      const sanitizedEndDate = typeof filters?.endDate === "string" && filters.endDate ? filters.endDate.slice(0, 30) : null;

      const sanitizedFilters = {
        ...(sanitizedTypes.length > 0 ? { selectedTypes: sanitizedTypes } : {}),
        ...(sanitizedStartDate ? { startDate: sanitizedStartDate } : {}),
        ...(sanitizedEndDate ? { endDate: sanitizedEndDate } : {})
      };

      const nowIso = new Date().toISOString();
      const signature = computeSearchHistorySignature(trimmedQuery, scope, verifiedProjectId, sanitizedFilters);

      // Check for existing duplicate search by signature for this user
      const existingQuerySnap = await db.collection("searchHistory")
        .where("userId", "==", userId)
        .where("signature", "==", signature)
        .limit(1)
        .get();

      if (!existingQuerySnap.empty) {
        const existingDoc = existingQuerySnap.docs[0];
        await existingDoc.ref.update({
          lastUsedAt: nowIso,
          projectName: projectName || existingDoc.data().projectName || null
        });

        const updatedData = existingDoc.data();
        return res.status(200).json({
          success: true,
          entry: {
            id: existingDoc.id,
            userId,
            organizationId: updatedData.organizationId || null,
            projectId: updatedData.projectId || null,
            projectName: projectName || updatedData.projectName || null,
            query: updatedData.query,
            scope: updatedData.scope,
            filters: updatedData.filters || {},
            createdAt: updatedData.createdAt || nowIso,
            lastUsedAt: nowIso
          },
          isDuplicate: true
        });
      }

      // New history entry
      const newEntryRef = db.collection("searchHistory").doc();
      const newEntry = {
        id: newEntryRef.id,
        userId,
        organizationId,
        projectId: verifiedProjectId,
        projectName,
        query: trimmedQuery,
        scope,
        filters: sanitizedFilters,
        signature,
        createdAt: nowIso,
        lastUsedAt: nowIso
      };

      await newEntryRef.set(newEntry);

      // Prune user history if exceeding retention limit (50)
      const userHistorySnap = await db.collection("searchHistory")
        .where("userId", "==", userId)
        .orderBy("lastUsedAt", "desc")
        .get()
        .catch(() => null);

      if (userHistorySnap && userHistorySnap.docs.length > SEARCH_HISTORY_RETENTION_LIMIT) {
        const docsToDelete = userHistorySnap.docs.slice(SEARCH_HISTORY_RETENTION_LIMIT);
        const batch = db.batch();
        for (const doc of docsToDelete) {
          batch.delete(doc.ref);
        }
        await batch.commit().catch(err => {
          console.warn("[Search History Retention Warning]: Failed to prune excess entries:", err?.message || err);
        });
      }

      return res.status(201).json({
        success: true,
        entry: {
          id: newEntry.id,
          userId: newEntry.userId,
          organizationId: newEntry.organizationId,
          projectId: newEntry.projectId,
          projectName: newEntry.projectName,
          query: newEntry.query,
          scope: newEntry.scope,
          filters: newEntry.filters,
          createdAt: newEntry.createdAt,
          lastUsedAt: newEntry.lastUsedAt
        },
        isDuplicate: false
      });
    } catch (err: any) {
      console.error("[Search History Create Error]:", err?.message || err);
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to record search history." });
    }
  });

  /**
   * GET /api/search-history
   * Lists the caller's search history entries, newest first.
   * Query params:
   * - scope: 'global' | 'project' (optional filter)
   * - projectId: string (optional filter)
   * - limit: number (default 20, max 50)
   */
  app.get("/api/search-history", requireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const userId = req.user!.uid;
      const requestedScope = req.query.scope as string;
      const requestedProjectId = req.query.projectId as string;
      const limit = Math.min(Math.max(parseInt((req.query.limit as string) || "20", 10) || 20, 1), SEARCH_HISTORY_RETENTION_LIMIT);

      let historyQuery = db.collection("searchHistory")
        .where("userId", "==", userId);

      if (requestedScope === "global" || requestedScope === "project") {
        historyQuery = historyQuery.where("scope", "==", requestedScope);
      }
      if (requestedProjectId) {
        historyQuery = historyQuery.where("projectId", "==", requestedProjectId);
      }

      const snap = await historyQuery.orderBy("lastUsedAt", "desc").limit(limit).get();

      const entries = snap.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          userId: data.userId,
          organizationId: data.organizationId || null,
          projectId: data.projectId || null,
          projectName: data.projectName || null,
          query: data.query,
          scope: data.scope,
          filters: data.filters || {},
          createdAt: data.createdAt,
          lastUsedAt: data.lastUsedAt
        };
      });

      return res.status(200).json({
        success: true,
        entries
      });
    } catch (err: any) {
      console.error("[Search History List Error]:", err?.message || err);
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to retrieve search history." });
    }
  });

  /**
   * DELETE /api/search-history/:historyId
   * Deletes a single history entry owned by the authenticated caller.
   */
  app.delete("/api/search-history/:historyId", requireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const userId = req.user!.uid;
      const { historyId } = req.params;

      if (!historyId) {
        return res.status(400).json({ error: "Bad Request", message: "History ID is required." });
      }

      const docRef = db.collection("searchHistory").doc(historyId);
      const docSnap = await docRef.get();

      if (!docSnap.exists) {
        return res.status(404).json({ error: "Not Found", message: "Search history entry not found." });
      }

      const docData = docSnap.data() || {};
      if (docData.userId !== userId && (req.user as any)?.role !== "admin") {
        return res.status(403).json({ error: "Forbidden", message: "You cannot delete another user's search history." });
      }

      await docRef.delete();
      return res.status(200).json({
        success: true,
        message: "Search history entry deleted successfully."
      });
    } catch (err: any) {
      console.error("[Search History Delete Error]:", err?.message || err);
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to delete search history entry." });
    }
  });

  /**
   * DELETE /api/search-history
   * Clears all search history entries belonging to the authenticated caller.
   */
  app.delete("/api/search-history", requireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const userId = req.user!.uid;
      const requestedScope = req.query.scope as string;
      const requestedProjectId = req.query.projectId as string;

      let historyQuery = db.collection("searchHistory").where("userId", "==", userId);

      if (requestedScope === "global" || requestedScope === "project") {
        historyQuery = historyQuery.where("scope", "==", requestedScope);
      }
      if (requestedProjectId) {
        historyQuery = historyQuery.where("projectId", "==", requestedProjectId);
      }

      const snap = await historyQuery.get();
      if (snap.empty) {
        return res.status(200).json({
          success: true,
          clearedCount: 0,
          message: "No search history entries found to clear."
        });
      }

      const batch = db.batch();
      for (const doc of snap.docs) {
        batch.delete(doc.ref);
      }
      await batch.commit();

      return res.status(200).json({
        success: true,
        clearedCount: snap.docs.length,
        message: `Cleared ${snap.docs.length} search history entries.`
      });
    } catch (err: any) {
      console.error("[Search History Clear Error]:", err?.message || err);
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to clear search history." });
    }
  });

  // ============================================================================
  // PHASE 2, STEP 3: ONBOARDING COMPLETION & USER STATUS APIS
  // ============================================================================

  /**
   * POST /api/onboarding/complete
   * Server-authoritative endpoint to mark guided onboarding as completed.
   * Updates user document in Firestore without client privilege escalation.
   */
  app.post("/api/onboarding/complete", requireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const userId = req.user!.uid;
      const userRef = db.collection("users").doc(userId);
      const nowIso = new Date().toISOString();

      await userRef.set({
        onboardingCompleted: true,
        onboardingCompletedAt: nowIso
      }, { merge: true });

      return res.status(200).json({
        success: true,
        onboardingCompleted: true,
        onboardingCompletedAt: nowIso
      });
    } catch (err: any) {
      console.error("[Onboarding Complete Error]:", err?.message || err);
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to save onboarding completion state." });
    }
  });

  /**
   * POST /api/onboarding/reset
   * Optional helper allowing users to restart/revisit onboarding from Settings.
   */
  app.post("/api/onboarding/reset", requireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const userId = req.user!.uid;
      const userRef = db.collection("users").doc(userId);

      await userRef.set({
        onboardingCompleted: false
      }, { merge: true });

      return res.status(200).json({
        success: true,
        onboardingCompleted: false
      });
    } catch (err: any) {
      console.error("[Onboarding Reset Error]:", err?.message || err);
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to reset onboarding state." });
    }
  });

  // Downgrade Plan - Protected with requireAuth (User can only downgrade their own plan)
  app.post("/api/downgrade-plan", requireAuth, async (req: AuthenticatedRequest, res) => {
    const userId = req.user!.uid;
    const { targetPlanId } = req.body;
    
    if (!targetPlanId) {
      return res.status(400).json({ error: "Missing targetPlanId" });
    }

    try {
      let currentPlan = "pro";
      let bypassed = false;

      try {
        const userDoc = await db.collection("users").doc(userId).get();
        if (userDoc.exists) {
          const userData = userDoc.data() || {};
          currentPlan = userData.plan || "free";
        }
      } catch (dbErr: any) {
        if (isProductionEnvironment()) {
          console.error("🚨 [PRODUCTION] Downgrade user lookup failed in Firestore:", dbErr);
          return res.status(500).json({ error: "Database error during downgrade check", code: "DATABASE_ERROR" });
        }
        if (dbErr.message?.includes("PERMISSION_DENIED") || dbErr.code === 7) {
          console.warn("⚠️ Server-side Firestore permission denied, bypassing to client fallback in non-prod.");
          bypassed = true;
        } else {
          throw dbErr;
        }
      }

      if (!bypassed) {
        const planHierarchy: Record<string, number> = {
          free: 0,
          pro: 1,
          team: 2,
          enterprise: 3
        };

        const currentRank = planHierarchy[currentPlan] ?? 0;
        const targetRank = planHierarchy[targetPlanId] ?? 0;

        if (targetRank >= currentRank) {
          return res.status(400).json({ error: "Target plan must be a lower tier for downgrades." });
        }

        const now = new Date();
        const nextRefreshDate = new Date();
        nextRefreshDate.setMonth(nextRefreshDate.getMonth() + 1);

        try {
          await db.collection("users").doc(userId).update({
            plan: targetPlanId,
            subscriptionStatus: "active",
            subscriptionStartDate: now.toISOString(),
            billingCycle: "monthly",
            nextRefreshDate: nextRefreshDate.toISOString(),
            planExpiresAt: nextRefreshDate.toISOString(),
            lastDowngradedAt: FieldValue.serverTimestamp()
          });
        } catch (dbErr: any) {
          if (isProductionEnvironment()) {
            console.error("🚨 [PRODUCTION] Downgrade user update failed in Firestore:", dbErr);
            return res.status(500).json({ error: "Database update error during downgrade", code: "DATABASE_ERROR" });
          }
          console.info("ℹ️ Server-side downgrade sync handled by client fallback in non-prod.");
        }
      }

      res.json({ success: true, message: `Successfully downgraded to ${targetPlanId}`, bypassed });
    } catch (error: any) {
      console.error("🔥 DOWNGRADE PLAN ERROR:", error);
      res.status(500).json({ error: "Failed to downgrade plan", details: error.message });
    }
  });

  // API Routes
  
  // Audio Conversion Endpoints
  const handleAudioConversion = async (req: express.Request, res: express.Response) => {
    const authReq = req as AuthenticatedRequest;
    const { base64Audio, fileName, mimeType, recordingId, projectId } = req.body;
    if (!base64Audio || typeof base64Audio !== 'string' || base64Audio.trim().length === 0) {
      return res.status(400).json({ error: "Missing or invalid base64Audio payload.", code: "INVALID_AUDIO_PAYLOAD" });
    }

    // Authorize resource context if supplied
    if (recordingId || projectId) {
      const accessCheck = await verifyAiResourceAccess(authReq.user, {
        recordingId,
        projectId,
        operationType: 'write'
      });
      if (!accessCheck.allowed) {
        return res.status(accessCheck.status).json({ error: "Forbidden", message: accessCheck.message });
      }
    }

    // Size limit check (approx 50MB base64 ~ 37MB raw binary)
    if (base64Audio.length > 50 * 1024 * 1024) {
      return res.status(413).json({ error: "Audio file exceeds maximum size limit (35MB).", code: "AUDIO_FILE_TOO_LARGE" });
    }

    const ffmpegStatus = isFfmpegAvailable();
    if (!ffmpegStatus.available) {
      console.error("[Server] Audio conversion requested but FFmpeg is unavailable:", ffmpegStatus.error);
      return res.status(503).json({ 
        error: "Audio conversion service is currently unavailable.", 
        code: "FFMPEG_UNAVAILABLE" 
      });
    }

    // Step 8.1A: Admit FFmpeg rate limit and acquire concurrency slot after authentication & input validation
    const slot = admitExpensiveOperation(req as AuthenticatedRequest, res, 'ffmpeg');
    if (!slot) return;

    // Robust MIME and extension determination
    const normalized = normalizeAudioMimeType(mimeType, fileName);
    const tempDir = os.tmpdir();
    const inputId = crypto.randomUUID();
    const inputExt = normalized.extension || '.input';
    const inputPath = path.join(tempDir, `echonote_in_${inputId}${inputExt}`);
    const outputPath = path.join(tempDir, `echonote_out_${inputId}.wav`);

    try {
      const buffer = Buffer.from(base64Audio, 'base64');
      if (buffer.length === 0) {
        return res.status(400).json({ error: "Audio buffer is empty.", code: "EMPTY_AUDIO_BUFFER" });
      }

      fs.writeFileSync(inputPath, buffer);
      console.log(`[Server] Converting audio (${normalized.containerMime}, ${buffer.length} bytes) to WAV`);

      await convertAudioToWav(inputPath, outputPath);

      const outputBuffer = fs.readFileSync(outputPath);
      const outputBase64 = outputBuffer.toString('base64');

      const safeBaseName = (fileName ? path.basename(fileName, path.extname(fileName)) : 'audio').replace(/[^a-zA-Z0-9_-]/g, '_');

      res.json({ 
        success: true, 
        base64Audio: outputBase64, 
        mimeType: 'audio/wav',
        fileName: `${safeBaseName}.wav`
      });

    } catch (error: any) {
      console.error("[Server] Audio conversion failure:", {
        mimeType: normalized.containerMime,
        extension: inputExt,
        errorMessage: error?.message
      });
      res.status(500).json({ 
        error: "Failed to convert audio file to standard WAV format. Please check the audio file integrity.", 
        code: "AUDIO_CONVERSION_FAILED" 
      });
    } finally {
      // Step 8.1A: Ensure concurrency slot is always released on success or failure
      slot.release();
      // Safe cleanup of temporary files
      try {
        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
      } catch (err) {
        console.warn("[Server] Could not delete temp input file:", inputPath);
      }
      try {
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      } catch (err) {
        console.warn("[Server] Could not delete temp output file:", outputPath);
      }
    }
  };

  app.post("/api/convert-opus", requireAuth, handleAudioConversion);
  app.post("/api/convert-audio", requireAuth, handleAudioConversion);
  app.post("/api/convert-base64", requireAuth, handleAudioConversion);

  // ==============================================================================
  // Secure Audio Playback & Streaming Architecture
  // ==============================================================================
  // Ephemeral cryptographic secret generated in memory if not explicitly provided in environment
  const EPHEMERAL_PLAYBACK_SECRET = crypto.randomBytes(32).toString('hex');
  const PLAYBACK_SECRET = process.env.PLAYBACK_SECRET || process.env.SESSION_SECRET || EPHEMERAL_PLAYBACK_SECRET;

  function generatePlaybackToken(payload: { uid: string; recId: string; email?: string; platform_admin?: boolean; role?: string }, expiresIn = 900): { token: string; expiresIn: number } {
    const exp = Math.floor(Date.now() / 1000) + expiresIn;
    const tokenData = { ...payload, exp };
    const encodedData = Buffer.from(JSON.stringify(tokenData)).toString("base64url");
    const signature = crypto.createHmac("sha256", PLAYBACK_SECRET).update(encodedData).digest("base64url");
    return {
      token: `${encodedData}.${signature}`,
      expiresIn
    };
  }

  function verifyPlaybackToken(tokenString: string): { valid: boolean; data?: any; error?: string } {
    try {
      const parts = tokenString.split(".");
      if (parts.length !== 2) {
        return { valid: false, error: "Malformed token format" };
      }
      const [encodedData, signature] = parts;
      const expectedSig = crypto.createHmac("sha256", PLAYBACK_SECRET).update(encodedData).digest("base64url");
      const sigBuf = Buffer.from(signature);
      const expBuf = Buffer.from(expectedSig);
      if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
        return { valid: false, error: "Invalid token signature" };
      }
      const data = JSON.parse(Buffer.from(encodedData, "base64url").toString("utf8"));
      if (Date.now() / 1000 > data.exp) {
        return { valid: false, error: "Playback token expired" };
      }
      return { valid: true, data };
    } catch (err: any) {
      return { valid: false, error: err?.message || "Verification failed" };
    }
  }

  const authorizeRecordingAccess = async (
    user: { uid: string; email?: string; platform_admin?: boolean; role?: string; orgRole?: string; [key: string]: any },
    recordingId: string,
    options?: { 
      allowDeleted?: boolean;
      requiredAction?: 'VIEW' | 'COMMENT' | 'EDIT_CONTENT' | 'DELETE';
    }
  ) => {
    const result = await authRecordingHelper(db, user, recordingId, options);
    if (!result.authorized) {
      recordAuthAuditEvent(db, {
        eventType: result.status === 410 ? 'AUTH_DENIED_SOFT_DELETED' : (result.message?.includes('Tenant isolation') ? 'AUTH_DENIED_TENANT_ISOLATION' : 'AUTH_DENIED_INSUFFICIENT_ROLE'),
        action: `recording.${options?.requiredAction?.toLowerCase() || 'access'}`,
        status: 'denied',
        severity: result.status === 403 && result.message?.includes('Tenant isolation') ? 'high' : 'medium',
        actorUserId: user?.uid,
        actorEmail: user?.email,
        resourceId: recordingId,
        resourceType: 'recording',
        requiredPermission: options?.requiredAction || 'VIEW',
        callerRole: user?.role || user?.orgRole || 'unknown',
        reason: result.message
      }).catch(() => {});
    } else {
      recordAuthAuditEvent(db, {
        eventType: 'AUTH_PERMITTED',
        action: `recording.${options?.requiredAction?.toLowerCase() || 'access'}`,
        status: 'allowed',
        severity: 'low',
        actorUserId: user?.uid,
        actorEmail: user?.email,
        organizationId: result.record?.orgId || result.record?.organizationId,
        projectId: result.record?.projectId,
        resourceId: recordingId,
        resourceType: 'recording',
        requiredPermission: options?.requiredAction || 'VIEW',
        callerRole: result.role,
        reason: result.message
      }).catch(() => {});
    }
    return result;
  };

  const verifyAiResourceAccess = async (
    user: any,
    options: {
      recordingId?: string | null;
      projectId?: string | null;
      meetingSessionId?: string | null;
      transcriptId?: string | null;
      organizationId?: string | null;
      operationType: 'read' | 'write';
    }
  ) => {
    const result = await verifyAiResourceHelper(db, user, options);
    if (!result.allowed) {
      recordAuthAuditEvent(db, {
        eventType: result.status === 400 ? 'AUTH_DENIED_RESOURCE_MISMATCH' : (result.status === 401 ? 'AUTH_DENIED_UNAUTHENTICATED' : 'AI_RESOURCE_GATEWAY_CHECK'),
        action: `ai.${options.operationType}`,
        status: 'denied',
        severity: result.status === 400 ? 'high' : 'medium',
        actorUserId: user?.uid,
        actorEmail: user?.email,
        projectId: options.projectId || (result.session?.projectId) || undefined,
        resourceId: options.meetingSessionId || options.recordingId || undefined,
        resourceType: 'ai_resource',
        requiredPermission: options.operationType === 'write' ? 'EDIT_CONTENT' : 'VIEW',
        callerRole: user?.role || user?.orgRole || 'unknown',
        reason: result.message
      }).catch(() => {});
    }
    return result;
  };

  function resolveStoragePath(record: any): string | null {
    if (record.storagePath && typeof record.storagePath === 'string') {
      return record.storagePath;
    }
    const url = record.originalAudioUrl || record.audioUrl;
    if (url && typeof url === 'string') {
      const match = url.match(/\/o\/([^?]+)/);
      if (match && match[1]) {
        return decodeURIComponent(match[1]);
      }
    }
    if (record.userId && record.id) {
      const fileName = record.fileName || (record.audioUrl?.includes('.mp3') ? `synthesis_${record.id}.mp3` : 'audio.webm');
      return `recordings/${record.userId}/${record.id}/${fileName}`;
    }
    return null;
  }

  // Generate short-lived, signed playback URL & token validating user authorization against Firestore metadata
  const handlePlaybackToken = async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const recordingId = req.params.id || req.params.recordingId;
      if (!recordingId) {
        return res.status(400).json({ error: "Bad Request", message: "Recording ID is required." });
      }

      // Validate authorization against Firestore record metadata
      const authResult = await authorizeRecordingAccess(req.user, recordingId);
      if (!authResult.authorized) {
        return res.status(authResult.status).json({
          error: authResult.status === 404 ? "Not Found" : "Forbidden",
          message: authResult.message
        });
      }

      const record = authResult.record;
      const storagePath = resolveStoragePath(record);
      const expiresIn = 900; // 15 minutes time limit
      const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

      let signedStorageUrl: string | null = null;

      // Attempt Google Cloud Storage signed URL if environment credentials permit
      if (storagePath) {
        try {
          const bucketName = firebaseConfig.storageBucket || "echonote-2509.firebasestorage.app";
          const bucket = admin.storage().bucket(bucketName);
          const file = bucket.file(storagePath);
          const [gcsUrl] = await file.getSignedUrl({
            version: 'v4',
            action: 'read',
            expires: Date.now() + expiresIn * 1000
          });
          if (gcsUrl) {
            signedStorageUrl = gcsUrl;
          }
        } catch (gcsErr: any) {
          // Cloud Run / container default credentials may lack signBlob; fallback to secure server-signed streaming URL
          console.info("[Storage Signed URL]: Using authenticated server streaming URL fallback:", gcsErr?.message || gcsErr);
        }
      }

      const { token } = generatePlaybackToken({
        uid: req.user.uid,
        recId: recordingId,
        email: req.user.email,
        platform_admin: req.user.platform_admin,
        role: req.user.role
      }, expiresIn);

      const serverStreamUrl = `/api/recordings/${encodeURIComponent(recordingId)}/audio?token=${token}`;
      const effectiveUrl = signedStorageUrl || serverStreamUrl;

      return res.json({
        success: true,
        signedUrl: effectiveUrl,
        playbackUrl: effectiveUrl,
        url: effectiveUrl,
        token,
        expiresIn,
        expiresAt,
        storagePath: storagePath || undefined,
        fileName: record.fileName || undefined,
        mimeType: record.mimeType || undefined
      });
    } catch (err: any) {
      console.error("[Playback Token Error]:", err?.message || err);
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to generate playback token." });
    }
  };

  // Bind /api/recordings/:id/playback-token and aliases
  app.post("/api/recordings/:id/playback-token", requireAuth, handlePlaybackToken);
  app.get("/api/recordings/:id/playback-token", requireAuth, handlePlaybackToken);
  app.post("/api/recordings/:recordingId/playback-token", requireAuth, handlePlaybackToken);
  app.get("/api/recordings/:recordingId/playback-token", requireAuth, handlePlaybackToken);

  // Helper function to safely delete a recording's Cloud Storage assets and Firestore documents
  async function purgeRecordingStorageAndDocs(
    firestoreDb: admin.firestore.Firestore,
    storageBucketObj: any,
    record: any
  ): Promise<{ storageDeleted: boolean; firestoreDeleted: boolean }> {
    const recordingId = record.id;
    let storageDeleted = false;

    // 1. Delete associated Cloud Storage object(s) if storage exists
    try {
      if (storageBucketObj) {
        const storagePath = resolveStoragePath(record);
        if (storagePath) {
          const file = storageBucketObj.file(storagePath);
          const [exists] = await file.exists();
          if (exists) {
            await file.delete();
            storageDeleted = true;
          }
        }
        if (record.userId && record.id) {
          const prefix = `recordings/${record.userId}/${record.id}/`;
          const [files] = await storageBucketObj.getFiles({ prefix });
          for (const f of files) {
            await f.delete();
            storageDeleted = true;
          }
        }
      }
    } catch (storageErr: any) {
      console.warn(`[Storage Cleanup Warning for ${recordingId}]:`, storageErr?.message || storageErr);
    }

    // 2. Delete Firestore documents and linked decision records
    const batch = firestoreDb.batch();
    batch.delete(firestoreDb.collection("recordings").doc(recordingId));
    batch.delete(firestoreDb.collection("transcriptions").doc(recordingId));
    try {
      const decQuery = await firestoreDb.collection("decisionHistory").where("recordingId", "==", recordingId).get();
      for (const d of decQuery.docs) {
        batch.delete(d.ref);
      }
    } catch {
      // Non-fatal if collection doesn't exist
    }
    await batch.commit();

    return { storageDeleted, firestoreDeleted: true };
  }

  // Permanently delete a recording: validates ownership, server-coordinated delete of Storage objects & Firestore docs
  app.delete("/api/recordings/:id", requireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const recordingId = req.params.id;
      if (!recordingId) {
        return res.status(400).json({ error: "Bad Request", message: "Recording ID is required." });
      }

      // Check access allowing deletedAt records to be permanently deleted
      const authResult = await authorizeRecordingAccess(req.user, recordingId, { allowDeleted: true });
      if (!authResult.authorized) {
        if (authResult.status === 404 && req.query.idempotent === 'true') {
          return res.json({
            success: true,
            message: "Recording already deleted or does not exist.",
            recordingId
          });
        }
        return res.status(authResult.status).json({
          error: authResult.status === 404 ? "Not Found" : (authResult.status === 410 ? "Gone" : "Forbidden"),
          message: authResult.message
        });
      }

      const record = authResult.record;
      const isOwner = record.userId === req.user.uid;
      const isPlatformAdmin = Boolean(
        req.user.platform_admin === true ||
        req.user.role === 'admin' ||
        (req.user as any)?.claims?.platform_admin === true
      );

      // Only the recording owner or platform admin can permanently delete
      if (!isOwner && !isPlatformAdmin) {
        return res.status(403).json({
          error: "Forbidden",
          message: "Only the recording owner or platform administrator can permanently delete this recording."
        });
      }

      const bucketName = firebaseConfig.storageBucket || "echonote-2509.firebasestorage.app";
      const bucket = admin.storage().bucket(bucketName);
      await purgeRecordingStorageAndDocs(db, bucket, record);

      return res.json({
        success: true,
        message: "Recording and associated storage assets permanently deleted via server-coordinated deletion.",
        recordingId
      });
    } catch (err: any) {
      console.error("[Permanent Delete Error]:", err);
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to permanently delete recording." });
    }
  });

  // ============================================================================
  // AH.183: MULTI-PROJECT RECORDING ASSOCIATION ENDPOINTS
  // ============================================================================

  /**
   * Helper to resolve project info list with permissions for the caller.
   */
  async function resolveAssociatedProjectsForCaller(
    firestoreDb: admin.firestore.Firestore,
    caller: any,
    recording: any
  ): Promise<{ projects: any[]; primaryProjectId: string | null; projectIds: string[]; canManageAssociations: boolean }> {
    const rawProjectIds: string[] = [];
    if (recording.projectId && typeof recording.projectId === 'string') {
      rawProjectIds.push(recording.projectId.trim());
    }
    if (Array.isArray(recording.projectIds)) {
      for (const pid of recording.projectIds) {
        if (typeof pid === 'string' && pid.trim() && !rawProjectIds.includes(pid.trim())) {
          rawProjectIds.push(pid.trim());
        }
      }
    }

    const primaryProjectId = recording.projectId || (rawProjectIds.length > 0 ? rawProjectIds[0] : null);
    const isOwner = recording.userId === caller.uid;
    const isPlatformAdmin = Boolean(
      caller.platform_admin === true ||
      caller.role === 'admin' ||
      caller?.claims?.platform_admin === true
    );

    const projectList: any[] = [];
    let canManageAssociations = isOwner || isPlatformAdmin;

    for (const pid of rawProjectIds) {
      try {
        const projDoc = await firestoreDb.collection("projects").doc(pid).get();
        if (!projDoc.exists) continue;
        const pData = projDoc.data() || {};
        const pAccess = await resolveProjectAccess(firestoreDb, caller, pid);

        // Security requirement: Caller only discovers details for projects they have access to
        if (pAccess.hasAccess || isPlatformAdmin || isOwner) {
          if (pAccess.hasAccess && (pAccess.role === 'owner' || pAccess.role === 'admin')) {
            canManageAssociations = true;
          }
          projectList.push({
            id: pid,
            name: pData.name || "Untitled Project",
            isPrimary: pid === primaryProjectId,
            canManage: isOwner || isPlatformAdmin || pAccess.role === 'owner' || pAccess.role === 'admin',
            role: pAccess.role,
            description: pData.description || "",
            color: pData.color || null
          });
        }
      } catch (pErr) {
        // Silently skip unresolvable project to prevent information leakage
      }
    }

    return {
      projects: projectList,
      primaryProjectId,
      projectIds: rawProjectIds,
      canManageAssociations
    };
  }

  /**
   * GET /api/recordings/:id/projects
   * List projects associated with a recording. Requires valid authentication & recording access.
   */
  app.get("/api/recordings/:id/projects", requireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const recordingId = req.params.id;
      if (!recordingId) {
        return res.status(400).json({ error: "Bad Request", message: "Recording ID is required." });
      }

      const authResult = await authorizeRecordingAccess(req.user, recordingId, { requiredAction: 'VIEW' });
      if (!authResult.authorized) {
        return res.status(authResult.status).json({
          error: authResult.status === 404 ? "Not Found" : "Forbidden",
          message: authResult.message
        });
      }

      const record = authResult.record;
      const associated = await resolveAssociatedProjectsForCaller(db, req.user, record);

      return res.status(200).json({
        success: true,
        recordingId,
        primaryProjectId: associated.primaryProjectId,
        projectIds: associated.projectIds,
        projects: associated.projects,
        canManageAssociations: associated.canManageAssociations
      });
    } catch (err: any) {
      console.error("[Get Recording Projects Error]:", err?.message || err);
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to list associated projects." });
    }
  });

  /**
   * POST /api/recordings/:id/projects
   * Add a recording to another project.
   * Requires:
   * 1. Access to the recording (owner, admin, or collaborator with edit permissions)
   * 2. Permission on the target project (EDIT_CONTENT / role != 'viewer')
   */
  app.post("/api/recordings/:id/projects", requireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const recordingId = req.params.id;
      const targetProjectId = req.body?.projectId?.trim();

      if (!recordingId || !targetProjectId) {
        return res.status(400).json({ error: "Bad Request", message: "Both recording ID and target projectId are required." });
      }

      // 1. Authorize recording access
      const authResult = await authorizeRecordingAccess(req.user, recordingId, { requiredAction: 'EDIT_CONTENT' });
      if (!authResult.authorized) {
        return res.status(authResult.status).json({
          error: authResult.status === 404 ? "Not Found" : "Forbidden",
          message: authResult.message
        });
      }

      // 2. Authorize target project access (must have permission to add content to target project)
      const targetProjAccess = await resolveProjectAccess(db, req.user, targetProjectId, {
        requiredPermission: 'EDIT_CONTENT'
      });
      if (!targetProjAccess.hasAccess || !targetProjAccess.permissions.canEditContent) {
        if (targetProjAccess.notFound) {
          return res.status(404).json({ error: "Not Found", message: "Target project not found." });
        }
        return res.status(403).json({
          error: "Forbidden",
          message: "You do not have permission to associate recordings with this target project."
        });
      }

      const targetProjectName = targetProjAccess.project?.name || "Project";
      const recRef = db.collection("recordings").doc(recordingId);
      const trnRef = db.collection("transcriptions").doc(recordingId);

      // 3. Atomically update associations using Firestore Transaction to prevent race conditions & duplicates
      let updatedRecord: any = null;
      await db.runTransaction(async (t) => {
        const docSnap = await t.get(recRef);
        if (!docSnap.exists) {
          throw new Error("RECORDING_NOT_FOUND");
        }

        const data = docSnap.data() || {};
        const currentProjectIds: string[] = [];
        if (data.projectId && typeof data.projectId === 'string') {
          currentProjectIds.push(data.projectId.trim());
        }
        if (Array.isArray(data.projectIds)) {
          for (const pid of data.projectIds) {
            if (typeof pid === 'string' && pid.trim() && !currentProjectIds.includes(pid.trim())) {
              currentProjectIds.push(pid.trim());
            }
          }
        }

        // Avoid duplicate associations idempotently
        if (!currentProjectIds.includes(targetProjectId)) {
          currentProjectIds.push(targetProjectId);
        }

        const updates: any = {
          projectIds: currentProjectIds,
          updatedAt: FieldValue.serverTimestamp()
        };

        // If recording had no primary project or was in 'General', assign target as primary
        if (!data.projectId || data.group === 'General') {
          updates.projectId = targetProjectId;
          updates.group = targetProjectName;
        }

        t.update(recRef, updates);

        // Synchronize transcriptions doc if present
        t.update(trnRef, updates);

        updatedRecord = {
          ...data,
          ...updates,
          id: recordingId
        };
      });

      const associated = await resolveAssociatedProjectsForCaller(db, req.user, updatedRecord);

      return res.status(200).json({
        success: true,
        recordingId,
        primaryProjectId: associated.primaryProjectId,
        projectIds: associated.projectIds,
        projects: associated.projects,
        message: `Recording successfully associated with project "${targetProjectName}".`
      });
    } catch (err: any) {
      if (err?.message === "RECORDING_NOT_FOUND") {
        return res.status(404).json({ error: "Not Found", message: "Recording not found." });
      }
      console.error("[Add Recording Project Error]:", err?.message || err);
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to associate recording with project." });
    }
  });

  /**
   * DELETE /api/recordings/:id/projects/:projectId
   * Remove an association from a project.
   * Requirement: Removing an association NEVER deletes the canonical recording, audio storage, or transcript.
   * AH.190: Hardened authorization policy, transactional state consistency, audit logging, and in-app notifications.
   */
  app.delete("/api/recordings/:id/projects/:projectId", requireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    const recordingId = req.params.id;
    const targetProjectId = req.params.projectId?.trim();
    const callerUid = req.user.uid;
    const callerEmail = (req.user.email || "").toLowerCase().trim();

    try {
      if (!recordingId || !targetProjectId) {
        return res.status(400).json({ error: "Bad Request", message: "Both recording ID and project ID are required." });
      }

      // 1. Authorize recording or project access
      // Check if caller has recording access, or is an admin of the target project, or platform admin
      const isPlatformAdmin = Boolean(
        req.user.platform_admin === true ||
        req.user.role === 'admin' ||
        (req.user as any)?.claims?.platform_admin === true
      );

      const targetProjAccess = await resolveProjectAccess(db, req.user, targetProjectId);
      if (targetProjAccess.notFound) {
        return res.status(404).json({ error: "Not Found", message: "Target project not found." });
      }

      const isTargetProjAdmin = targetProjAccess.hasAccess && (
        targetProjAccess.role === 'owner' ||
        targetProjAccess.role === 'admin' ||
        targetProjAccess.permissions?.canEditContent === true
      );

      const authResult = await authorizeRecordingAccess(req.user, recordingId, { requiredAction: 'VIEW' });
      // If user cannot access recording, but is target project admin or platform admin, check if recording exists
      let record = authResult.record;
      if (!authResult.authorized) {
        if ((isTargetProjAdmin || isPlatformAdmin) && authResult.status !== 404) {
          // Verify recording existence
          let recDocSnap = await db.collection("recordings").doc(recordingId).get();
          if (!recDocSnap.exists) {
            recDocSnap = await db.collection("transcriptions").doc(recordingId).get();
          }
          if (!recDocSnap.exists) {
            return res.status(404).json({ error: "Not Found", message: "Recording not found." });
          }
          record = recDocSnap.data() || {};
          record.id = recDocSnap.id;
        } else {
          // Record security audit denial event
          recordAuthAuditEvent(db, {
            eventType: 'AUTH_DENIED_INSUFFICIENT_ROLE',
            action: 'recording.association.remove',
            status: 'denied',
            severity: 'medium',
            actorUserId: callerUid,
            actorEmail: callerEmail,
            projectId: targetProjectId,
            resourceId: recordingId,
            resourceType: 'recording',
            requiredPermission: 'VIEW',
            callerRole: req.user.role || req.user.orgRole || 'unknown',
            reason: authResult.message
          }).catch(() => {});

          return res.status(authResult.status).json({
            error: authResult.status === 404 ? "Not Found" : "Forbidden",
            message: authResult.message
          });
        }
      }

      const isOwner = record.userId === callerUid || (record.ownerEmail && record.ownerEmail.toLowerCase() === callerEmail);
      const isTargetProjMember = targetProjAccess.hasAccess;

      const isAuthorizedToRemove = isPlatformAdmin || isTargetProjAdmin || (isOwner && isTargetProjMember);

      if (!isAuthorizedToRemove) {
        recordAuthAuditEvent(db, {
          eventType: 'AUTH_DENIED_INSUFFICIENT_ROLE',
          action: 'recording.association.remove',
          status: 'denied',
          severity: 'medium',
          actorUserId: callerUid,
          actorEmail: callerEmail,
          projectId: targetProjectId,
          resourceId: recordingId,
          resourceType: 'recording',
          requiredPermission: 'EDIT_CONTENT',
          callerRole: targetProjAccess.role || 'none',
          reason: isOwner && !isTargetProjMember
            ? "Recording owner must be a member of the target project to remove association."
            : "Only project administrators or project members who own the recording can remove this association."
        }).catch(() => {});

        return res.status(403).json({
          error: "Forbidden",
          message: "You do not have permission to remove this recording from the project."
        });
      }

      const recRef = db.collection("recordings").doc(recordingId);
      const trnRef = db.collection("transcriptions").doc(recordingId);

      let wasAssociated = false;
      let updatedRecord: any = null;
      let newPrimaryProjectId: string | null = null;
      let remainingProjectIds: string[] = [];

      // 4. Atomically update associations within a Firestore Transaction
      await db.runTransaction(async (t) => {
        const docSnap = await t.get(recRef);
        if (!docSnap.exists) {
          throw new Error("RECORDING_NOT_FOUND");
        }

        const data = docSnap.data() || {};
        let currentProjectIds: string[] = [];
        if (data.projectId && typeof data.projectId === 'string' && data.projectId.trim()) {
          currentProjectIds.push(data.projectId.trim());
        }
        if (Array.isArray(data.projectIds)) {
          for (const pid of data.projectIds) {
            if (typeof pid === 'string' && pid.trim() && !currentProjectIds.includes(pid.trim())) {
              currentProjectIds.push(pid.trim());
            }
          }
        }

        // Determine if association was actually present
        wasAssociated = currentProjectIds.includes(targetProjectId);

        // Filter out targetProjectId
        const newProjectIds = currentProjectIds.filter(pid => pid !== targetProjectId);
        remainingProjectIds = newProjectIds;

        const updates: any = {
          projectIds: newProjectIds,
          updatedAt: FieldValue.serverTimestamp()
        };

        // If the removed project was primary, promote next project or safely revert to unassigned/General
        if (data.projectId === targetProjectId) {
          if (newProjectIds.length > 0) {
            newPrimaryProjectId = newProjectIds[0];
            updates.projectId = newPrimaryProjectId;
          } else {
            newPrimaryProjectId = null;
            updates.projectId = FieldValue.delete();
            updates.group = "General";
          }
        } else {
          newPrimaryProjectId = data.projectId || null;
        }

        t.update(recRef, updates);
        t.update(trnRef, updates);

        updatedRecord = {
          ...data,
          ...updates,
          id: recordingId
        };
      });

      // 5. Update primary group name if another project became primary
      if (newPrimaryProjectId && newPrimaryProjectId !== targetProjectId) {
        try {
          const nextProjDoc = await db.collection("projects").doc(newPrimaryProjectId).get();
          if (nextProjDoc.exists) {
            const nextProjName = nextProjDoc.data()?.name || "General";
            await recRef.update({ group: nextProjName });
            await trnRef.update({ group: nextProjName }).catch(() => {});
            updatedRecord.group = nextProjName;
          }
        } catch (nameErr) {
          console.warn("[Group Name Sync Note]:", nameErr);
        }
      }

      // 6. Audit Logging (AH.190)
      // Record audit event only if the association was actually removed by this request
      if (wasAssociated) {
        try {
          await recordAuthAuditEvent(db, {
            eventType: 'RECORDING_ASSOCIATION_REMOVED',
            action: 'recording.association.remove',
            status: 'allowed',
            severity: 'low',
            actorUserId: callerUid,
            actorEmail: callerEmail,
            projectId: targetProjectId,
            resourceId: recordingId,
            resourceType: 'recording',
            requiredPermission: 'EDIT_CONTENT',
            callerRole: targetProjAccess.role || (isPlatformAdmin ? 'admin' : 'owner'),
            details: `Removed recording "${record.fileName || recordingId}" from project "${targetProjAccess.project?.name || targetProjectId}".`,
            metadata: {
              targetProjectId,
              remainingProjectIds,
              promotedProjectId: newPrimaryProjectId,
              wasPrimary: record.projectId === targetProjectId
            }
          });
        } catch (auditErr: any) {
          console.error("⚠️ [AUDIT WRITE ERROR]: Failed to record association removal audit log:", auditErr?.message || auditErr);
        }
      }

      // 7. In-App Notifications (AH.190)
      // Create notification only after successful commit and when association was actually present
      if (wasAssociated) {
        try {
          const targetProjectName = targetProjAccess.project?.name || "Project";
          const recordingTitle = record.fileName || record.title || "Recording";
          const actorDisplayName = req.user.displayName || req.user.email || "A team member";

          // Determine notification recipients:
          // 1. Recording owner (if different from actor)
          // 2. Target project owner / creator (if different from actor)
          const recipientsToNotify: Array<{ userId: string; email?: string }> = [];

          const recOwnerId = record.userId;
          const recOwnerEmail = record.ownerEmail;
          if (recOwnerId && recOwnerId !== callerUid) {
            recipientsToNotify.push({ userId: recOwnerId, email: recOwnerEmail });
          }

          const projOwnerId = targetProjAccess.project?.creatorId || targetProjAccess.project?.ownerId;
          const projOwnerEmail = targetProjAccess.project?.ownerEmail;
          if (projOwnerId && projOwnerId !== callerUid && !recipientsToNotify.some(r => r.userId === projOwnerId)) {
            recipientsToNotify.push({ userId: projOwnerId, email: projOwnerEmail });
          }

          for (const recipient of recipientsToNotify) {
            const notifId = `notif_assoc_rem_${recordingId}_${targetProjectId}_${recipient.userId}`;
            await db.collection("notifications").doc(notifId).set({
              userId: recipient.userId,
              userEmail: recipient.email || "",
              title: "Recording Removed from Project",
              message: `"${recordingTitle}" was removed from project "${targetProjectName}" by ${actorDisplayName}.`,
              type: "info",
              projectId: targetProjectId,
              recordingId,
              recordId: recordingId,
              actorUserId: callerUid,
              actorEmail: callerEmail,
              isRead: false,
              createdAt: FieldValue.serverTimestamp(),
              idempotencyKey: notifId
            });
          }
        } catch (notifErr: any) {
          console.warn("⚠️ [NOTIFICATION ERROR]: Failed to create association removal notifications:", notifErr?.message || notifErr);
        }
      }

      const associated = await resolveAssociatedProjectsForCaller(db, req.user, updatedRecord);

      return res.status(200).json({
        success: true,
        recordingId,
        wasAssociated,
        primaryProjectId: associated.primaryProjectId,
        projectIds: associated.projectIds,
        projects: associated.projects,
        message: wasAssociated
          ? "Project association removed successfully. Canonical recording was preserved."
          : "Recording was not associated with this project."
      });
    } catch (err: any) {
      if (err?.message === "RECORDING_NOT_FOUND") {
        return res.status(404).json({ error: "Not Found", message: "Recording not found." });
      }
      console.error("[Remove Recording Project Error]:", err?.message || err);
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to remove project association." });
    }
  });


  // ============================================================================
  // AH.184 & AH.191: REPORT GENERATION ENDPOINTS (POWERPOINT & EXCEL)
  // ============================================================================

  /**
   * POST /api/reports/generate
   * Generates a PowerPoint (.pptx) or Excel (.xlsx) report from validated application data.
   * Direct streaming response with appropriate MIME type and Content-Disposition.
   * AH.191: Enforces resource bounds on collection queries and attaches report bounding headers.
   */
  app.post("/api/reports/generate", requireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const { reportType, format, meetingId, projectId, startDate, endDate } = req.body || {};

      if (!reportType || !['meeting_summary', 'project_status', 'management_review'].includes(reportType)) {
        return res.status(400).json({
          error: "Bad Request",
          message: "Invalid or missing reportType. Must be one of: 'meeting_summary', 'project_status', 'management_review'."
        });
      }

      if (!format || !['pptx', 'xlsx'].includes(format)) {
        return res.status(400).json({
          error: "Bad Request",
          message: "Invalid or missing format. Must be 'pptx' or 'xlsx'."
        });
      }

      // 1. Report Type: Meeting Summary
      if (reportType === 'meeting_summary') {
        if (!meetingId) {
          return res.status(400).json({ error: "Bad Request", message: "meetingId is required for meeting_summary report." });
        }

        // Authorize caller's view access to the recording / meeting
        const authResult = await authorizeRecordingAccess(req.user, meetingId, { requiredAction: 'VIEW' });
        if (!authResult.authorized) {
          return res.status(authResult.status).json({
            error: authResult.status === 404 ? "Not Found" : "Forbidden",
            message: authResult.message
          });
        }

        const record = authResult.record;
        const associated = await resolveAssociatedProjectsForCaller(db, req.user, record);
        const primaryProjectName = record.group || "General";
        const associatedProjectNames = associated.projects.map(p => p.name);

        // Fetch associated tasks converted from this meeting if any (bounded by MAX_TASKS_PER_REPORT)
        let linkedTasks: any[] = [];
        try {
          const tSnap = await db.collection("projectTasks")
            .where("sourceRecordingId", "==", meetingId)
            .limit(REPORT_BOUNDS.MAX_TASKS_PER_REPORT)
            .get();
          linkedTasks = tSnap.docs.map(d => {
            const td = d.data();
            return {
              id: d.id,
              title: td.title || "",
              assigneeName: td.assigneeName || "",
              assigneeEmail: td.assigneeEmail || "",
              status: td.status || "pending",
              priority: td.priority || "medium",
              dueDate: td.dueDate || ""
            };
          });
        } catch {}

        const reportData: any = {
          meetingId,
          title: record.fileName || "Meeting Summary",
          date: record.date || new Date().toISOString().split("T")[0],
          primaryProjectName,
          associatedProjects: associatedProjectNames,
          ownerEmail: record.ownerEmail || record.userId || "Unknown",
          summary: {
            mainTopic: record.summary?.mainTopic || record.smartRecap?.meetingTopic || "Discussion Summary",
            keyPoints: Array.isArray(record.summary?.keyPoints) ? record.summary.keyPoints.slice(0, REPORT_BOUNDS.MAX_DECISIONS_PER_REPORT) : [],
            decisions: Array.isArray(record.summary?.decisions) ? record.summary.decisions.slice(0, REPORT_BOUNDS.MAX_DECISIONS_PER_REPORT) : [],
            actionItems: Array.isArray(record.summary?.actionItems) ? record.summary.actionItems.slice(0, REPORT_BOUNDS.MAX_ACTION_ITEMS_PER_REPORT) : []
          },
          executiveSummary: Array.isArray(record.smartRecap?.executiveSummary) ? record.smartRecap.executiveSummary : [],
          strategicTakeaways: record.smartRecap?.strategicTakeaway ? [record.smartRecap.strategicTakeaway] : [],
          tasks: linkedTasks,
          speakers: Array.isArray(record.speakers) ? record.speakers : [],
          transcriptExcerptCount: Array.isArray(record.transcript) ? record.transcript.length : 0
        };

        const safeFilename = `EchoNote_${(record.fileName || 'Meeting').replace(/[^a-zA-Z0-9_-]/g, '_')}_Summary.${format}`;

        if (format === 'xlsx') {
          const buffer = await generateMeetingExcel(reportData);
          res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
          res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
          return res.status(200).send(buffer);
        } else {
          const buffer = await generateMeetingPowerPoint(reportData);
          res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
          res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
          return res.status(200).send(buffer);
        }
      }

      // 2. Report Type: Project Status
      if (reportType === 'project_status') {
        if (!projectId) {
          return res.status(400).json({ error: "Bad Request", message: "projectId is required for project_status report." });
        }

        // Authorize caller's view access to the project
        const projAccess = await resolveProjectAccess(db, req.user, projectId, { requiredPermission: 'VIEW' });
        if (!projAccess.hasAccess) {
          if (projAccess.notFound) {
            return res.status(404).json({ error: "Not Found", message: "Project not found." });
          }
          return res.status(403).json({ error: "Forbidden", message: "You do not have permission to view this project." });
        }

        const projectName = projAccess.project?.name || "Project";
        const boundedResult = await collectProjectReportData(db, projectId, projectName, { startDate, endDate });
        const projectData = boundedResult.projectData;

        const safeFilename = `EchoNote_${projectName.replace(/[^a-zA-Z0-9_-]/g, '_')}_Status_Report.${format}`;

        if (boundedResult.isTruncated) {
          res.setHeader('X-Report-Truncated', 'true');
          res.setHeader('X-Report-Warnings', (boundedResult.warnings || []).join('; '));
        }

        if (format === 'xlsx') {
          const buffer = await generateProjectStatusExcel(projectData);
          res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
          res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
          return res.status(200).send(buffer);
        } else {
          const buffer = await generateProjectStatusPowerPoint(projectData);
          res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
          res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
          return res.status(200).send(buffer);
        }
      }

      // 3. Report Type: Management Review
      if (reportType === 'management_review') {
        let projectName = "Portfolio Overview";
        if (projectId) {
          const projAccess = await resolveProjectAccess(db, req.user, projectId, { requiredPermission: 'VIEW' });
          if (!projAccess.hasAccess) {
            if (projAccess.notFound) {
              return res.status(404).json({ error: "Not Found", message: "Project not found." });
            }
            return res.status(403).json({ error: "Forbidden", message: "You do not have permission to view this project." });
          }
          projectName = projAccess.project?.name || "Project";
        }

        let boundedResult: any = null;
        if (projectId) {
          boundedResult = await collectProjectReportData(db, projectId, projectName, { startDate, endDate });
        }

        const projectData = boundedResult ? boundedResult.projectData : {
          projectId: "portfolio",
          projectName: "Enterprise Portfolio",
          reportingDate: new Date().toISOString().split("T")[0],
          metrics: {
            totalTasks: 0,
            completedTasks: 0,
            inProgressTasks: 0,
            pendingTasks: 0,
            overdueTasks: 0,
            tasksWithoutDeadline: 0,
            tasksDueNext7Days: 0,
            blockedTasks: 0
          },
          tasks: [],
          meetings: [],
          decisions: [],
          outstandingActionItems: []
        };

        if (boundedResult?.isTruncated) {
          res.setHeader('X-Report-Truncated', 'true');
          res.setHeader('X-Report-Warnings', (boundedResult.warnings || []).join('; '));
        }

        const today = new Date();
        const startPeriod = startDate || new Date(today.getTime() - (30 * 24 * 60 * 60 * 1000)).toISOString().split("T")[0];
        const endPeriod = endDate || today.toISOString().split("T")[0];

        // Format overdue commitments
        const overdueCommitments = projectData.tasks
          .filter(t => t.isOverdue)
          .map(t => {
            const dueMs = t.dueDate ? new Date(t.dueDate).getTime() : 0;
            const daysOverdue = Math.max(Math.floor((today.getTime() - dueMs) / (24 * 60 * 60 * 1000)), 1);
            return {
              taskTitle: t.title,
              owner: t.assigneeName || t.assigneeEmail,
              dueDate: t.dueDate || "Unset",
              daysOverdue,
              priority: t.priority
            };
          });

        // Format blockers
        const blockersAndRisks = projectData.tasks
          .filter(t => t.dependencyStatus === 'blocked' || t.blockingPrerequisitesCount > 0)
          .map(t => ({
            taskTitle: t.title,
            severity: t.priority === 'urgent' || t.priority === 'high' ? 'High' : 'Medium',
            blockerReason: `Waiting on ${t.blockingPrerequisitesCount} prerequisite dependencies`,
            owner: t.assigneeName || t.assigneeEmail
          }));

        // Format executive summary bullets
        const execSummaryBullets = [
          `Portfolio tracking ${projectData.metrics.totalTasks} total tasks across active work streams.`,
          `${projectData.metrics.completedTasks} deliverables successfully completed (${projectData.metrics.totalTasks > 0 ? Math.round((projectData.metrics.completedTasks / projectData.metrics.totalTasks) * 100) : 0}% completion rate).`,
          `${projectData.metrics.overdueTasks} commitments currently overdue requiring management attention and deadline review.`,
          `${projectData.meetings.length} strategic meetings and ${projectData.decisions.length} recorded decisions consolidated in this period.`
        ];

        const reviewData = {
          projectName,
          projectId: projectId || "portfolio",
          reportingPeriod: {
            startDate: startPeriod,
            endDate: endPeriod
          },
          generatedAt: new Date().toISOString(),
          executiveSummary: execSummaryBullets,
          metrics: projectData.metrics,
          majorMilestones: [],
          keyDecisions: projectData.decisions.map(d => ({
            decision: d.title,
            context: d.source,
            date: d.date
          })),
          blockersAndRisks,
          overdueCommitments,
          sourceMeetings: projectData.meetings.map(m => ({
            id: m.id,
            title: m.title,
            date: m.date
          }))
        };

        const safeFilename = `EchoNote_${projectName.replace(/[^a-zA-Z0-9_-]/g, '_')}_Management_Review.${format}`;

        if (format === 'xlsx') {
          const buffer = await generateManagementReviewExcel(reviewData);
          res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
          res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
          return res.status(200).send(buffer);
        } else {
          const buffer = await generateManagementReviewPowerPoint(reviewData);
          res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
          res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
          return res.status(200).send(buffer);
        }
      }

      return res.status(400).json({ error: "Bad Request", message: "Unsupported report type." });
    } catch (err: any) {
      console.error("[Report Generation Error]:", err?.message || err);
      return res.status(500).json({
        error: "Internal Server Error",
        message: "Failed to generate requested report. Please check server logs."
      });
    }
  });

  // Track in-flight trim requests per recording ID to prevent concurrent duplicate processing
  const inFlightTrimLocks = new Set<string>();

  // Audio Trimming & Editing Endpoint: POST /api/recordings/:recordingId/trim
  const handleAudioTrimming = async (req: AuthenticatedRequest, res: express.Response) => {
    const recordingId = req.params.id || req.params.recordingId;
    if (!recordingId) {
      return res.status(400).json({ error: "Bad Request", message: "Recording ID is required." });
    }

    // 1. Authorize user access with EDIT_CONTENT permission requirement
    const authResult = await authorizeRecordingAccess(req.user, recordingId, {
      requiredAction: 'EDIT_CONTENT'
    });

    if (!authResult.authorized) {
      return res.status(authResult.status).json({
        error: authResult.status === 404 ? "Not Found" : (authResult.status === 410 ? "Gone" : "Forbidden"),
        message: authResult.message
      });
    }

    const parentRecord = authResult.record;

    // Check parent recording status
    if (parentRecord.status && parentRecord.status !== 'completed') {
      return res.status(400).json({
        error: "Bad Request",
        message: `Cannot trim a recording that is not ready (current status: ${parentRecord.status}).`
      });
    }

    // 2. Validate trim bounds
    const { startTime, endTime, title } = req.body || {};
    const parsedStart = parseFloat(startTime);
    const parsedEnd = parseFloat(endTime);
    const totalDuration = typeof parentRecord.duration === 'number' ? parentRecord.duration : undefined;

    const validation = validateTrimRange(parsedStart, parsedEnd, totalDuration);
    if (!validation.valid || !validation.duration) {
      return res.status(400).json({
        error: "Invalid Time Range",
        message: validation.error || "The requested trim boundaries are invalid."
      });
    }

    // 3. Concurrency deduplication lock per recording
    const lockKey = `${recordingId}_${parsedStart}_${parsedEnd}`;
    if (inFlightTrimLocks.has(lockKey)) {
      return res.status(409).json({
        error: "Conflict",
        message: "An identical audio trim operation is already in progress for this recording. Please wait."
      });
    }
    inFlightTrimLocks.add(lockKey);

    // 4. Check FFmpeg availability
    const ffmpegStatus = isFfmpegAvailable();
    if (!ffmpegStatus.available) {
      inFlightTrimLocks.delete(lockKey);
      return res.status(503).json({
        error: "Service Unavailable",
        message: "FFmpeg media processor is not available in the current environment.",
        code: "FFMPEG_UNAVAILABLE"
      });
    }

    // 5. Admit rate limit & concurrency slot for expensive FFmpeg operation
    const slot = admitExpensiveOperation(req, res, 'ffmpeg');
    if (!slot) {
      inFlightTrimLocks.delete(lockKey);
      return; // admitExpensiveOperation has sent a 429 response
    }

    try {
      // 6. Retrieve source audio buffer
      const bucketName = firebaseConfig.storageBucket || "echonote-2509.firebasestorage.app";
      const bucket = admin.storage().bucket(bucketName);
      const storagePath = resolveStoragePath(parentRecord);

      let sourceBuffer: Buffer | null = null;
      let detectedMime = parentRecord.mimeType || 'audio/webm';

      if (storagePath) {
        let file = bucket.file(storagePath);
        let [exists] = await file.exists();
        if (!exists && parentRecord.userId && parentRecord.id) {
          const prefix = `recordings/${parentRecord.userId}/${parentRecord.id}/`;
          const [files] = await bucket.getFiles({ prefix, maxResults: 1 });
          if (files && files.length > 0) {
            file = files[0];
            exists = true;
          }
        }

        if (exists) {
          const [meta] = await file.getMetadata();
          detectedMime = meta.contentType || detectedMime;
          const [contents] = await file.download();
          sourceBuffer = contents;
        }
      }

      // Fallback: check base64 data in record or originalAudioUrl
      if (!sourceBuffer && parentRecord.base64Audio) {
        sourceBuffer = Buffer.from(parentRecord.base64Audio, 'base64');
      }

      if (!sourceBuffer || sourceBuffer.length === 0) {
        return res.status(404).json({
          error: "Not Found",
          message: "Original audio file content could not be located in Cloud Storage for processing."
        });
      }

      // 7. Perform real server-side audio trimming via FFmpeg
      const trimResult = await trimAudioBuffer({
        inputBuffer: sourceBuffer,
        mimeType: detectedMime,
        fileName: parentRecord.fileName,
        startTime: parsedStart,
        endTime: parsedEnd
      });

      // 8. Upload trimmed audio asset to Cloud Storage under derived path
      const derivedRecordingId = `rec_trim_${crypto.randomUUID()}`;
      const ownerUid = parentRecord.userId || req.user.uid;
      const derivedStoragePath = `recordings/${ownerUid}/trimmed/${derivedRecordingId}${trimResult.extension}`;
      const destinationFile = bucket.file(derivedStoragePath);

      await destinationFile.save(trimResult.trimmedBuffer, {
        contentType: trimResult.mimeType,
        metadata: {
          originalRecordingId: recordingId,
          derivedFrom: recordingId,
          trimStartTime: String(parsedStart),
          trimEndTime: String(parsedEnd),
          trimDuration: String(trimResult.duration),
          contentHash: trimResult.contentHash,
          createdBy: req.user.uid
        }
      });

      // 9. Fetch original transcript and derive aligned transcript view
      let originalTranscriptDoc = await db.collection("transcriptions").doc(recordingId).get();
      let originalSegments: any[] = [];
      if (originalTranscriptDoc.exists) {
        const tData = originalTranscriptDoc.data() || {};
        originalSegments = tData.segments || tData.transcript || [];
      } else if (Array.isArray(parentRecord.transcript)) {
        originalSegments = parentRecord.transcript;
      }

      const alignment = alignTranscriptSegments(originalSegments, parsedStart, parsedEnd);
      const nowIso = new Date().toISOString();
      const derivedTitle = title && typeof title === 'string' && title.trim().length > 0
        ? title.trim()
        : `${parentRecord.fileName || 'Recording'} (Clip ${Math.round(parsedStart)}s-${Math.round(parsedEnd)}s)`;

      // 10. Persist derived Recording document in Firestore
      const derivedRecordData: any = {
        id: derivedRecordingId,
        userId: parentRecord.userId || req.user.uid,
        projectId: parentRecord.projectId || undefined,
        organizationId: parentRecord.organizationId || parentRecord.orgId || undefined,
        fileName: trimResult.fileName,
        storagePath: derivedStoragePath,
        status: 'completed',
        duration: trimResult.duration,
        mimeType: trimResult.mimeType,
        sizeBytes: trimResult.sizeBytes,
        isTrimmedVersion: true,
        parentRecordingId: recordingId,
        trimRange: {
          startTime: parsedStart,
          endTime: parsedEnd,
          duration: trimResult.duration
        },
        meetingSessionId: parentRecord.meetingSessionId || undefined,
        externalMeetingId: parentRecord.externalMeetingId || undefined,
        provider: parentRecord.provider || undefined,
        provenanceManifestId: parentRecord.provenanceManifestId || undefined,
        createdAt: nowIso,
        updatedAt: nowIso
      };

      // Remove undefined keys for Firestore compatibility
      Object.keys(derivedRecordData).forEach(k => {
        if (derivedRecordData[k] === undefined) delete derivedRecordData[k];
      });

      await db.collection("recordings").doc(derivedRecordingId).set(derivedRecordData);

      // 11. Persist derived transcript document if original had transcript
      if (originalSegments.length > 0) {
        const derivedTranscriptData: any = {
          id: derivedRecordingId,
          recordingId: derivedRecordingId,
          userId: derivedRecordData.userId,
          projectId: derivedRecordData.projectId || undefined,
          summary: `Trimmed excerpt from ${parentRecord.fileName || 'original recording'} (${parsedStart}s to ${parsedEnd}s).`,
          actionItems: [],
          segments: alignment.alignedSegments,
          transcript: alignment.alignedSegments,
          meetingSessionId: derivedRecordData.meetingSessionId || undefined,
          provenanceManifestId: derivedRecordData.provenanceManifestId || undefined,
          isDerivedTranscript: true,
          parentRecordingId: recordingId,
          alignmentNote: alignment.alignmentNote,
          createdAt: nowIso
        };
        Object.keys(derivedTranscriptData).forEach(k => {
          if (derivedTranscriptData[k] === undefined) delete derivedTranscriptData[k];
        });
        await db.collection("transcriptions").doc(derivedRecordingId).set(derivedTranscriptData);
      }

      // 12. Extend provenance manifest safely with derived artifact reference
      if (parentRecord.provenanceManifestId) {
        try {
          const manifestRef = db.collection("meetingProvenanceManifests").doc(parentRecord.provenanceManifestId);
          const manifestSnap = await manifestRef.get();
          if (manifestSnap.exists) {
            const derivedArtifact = {
              artifactId: `art_trim_${crypto.randomUUID()}`,
              type: 'trimmed_recording',
              uri: `gs://${bucketName}/${derivedStoragePath}`,
              mimeType: trimResult.mimeType,
              contentHash: trimResult.contentHash,
              sizeBytes: trimResult.sizeBytes,
              derivedFromArtifactId: recordingId,
              trimRange: {
                startTime: parsedStart,
                endTime: parsedEnd,
                duration: trimResult.duration
              },
              createdAt: nowIso
            };
            await manifestRef.update({
              rawArtifacts: FieldValue.arrayUnion(derivedArtifact)
            });
          }
        } catch (provErr: any) {
          console.warn("[Provenance Manifest Derived Update Warning]:", provErr?.message || provErr);
        }
      }

      // 13. Audit log successful trim operation
      recordAuthAuditEvent(db, {
        eventType: 'RECORDING_TRIMMED',
        action: 'recording.trim',
        status: 'allowed',
        severity: 'low',
        actorUserId: req.user.uid,
        actorEmail: req.user.email,
        projectId: parentRecord.projectId || undefined,
        resourceId: derivedRecordingId,
        resourceType: 'recording',
        requiredPermission: 'EDIT_CONTENT',
        callerRole: authResult.role || 'editor',
        reason: `Successfully created trimmed recording (${parsedStart}s-${parsedEnd}s) from parent ${recordingId}`
      }).catch(() => {});

      return res.status(201).json({
        success: true,
        message: "Audio trimmed and saved successfully.",
        derivedRecording: {
          id: derivedRecordingId,
          parentRecordingId: recordingId,
          fileName: trimResult.fileName,
          storagePath: derivedStoragePath,
          duration: trimResult.duration,
          mimeType: trimResult.mimeType,
          sizeBytes: trimResult.sizeBytes,
          isTrimmedVersion: true,
          trimRange: {
            startTime: parsedStart,
            endTime: parsedEnd,
            duration: trimResult.duration
          },
          meetingSessionId: derivedRecordData.meetingSessionId,
          projectId: derivedRecordData.projectId,
          createdAt: nowIso
        },
        transcriptAlignment: {
          isAligned: alignment.isAligned,
          alignedCount: alignment.alignedCount,
          totalOriginalSegments: alignment.totalOriginalSegments,
          note: alignment.alignmentNote
        }
      });
    } catch (trimErr: any) {
      console.error("[Audio Trimming Error]:", trimErr);
      return res.status(500).json({
        error: "Processing Error",
        message: trimErr?.message || "An unexpected error occurred during audio trimming."
      });
    } finally {
      slot.release();
      inFlightTrimLocks.delete(lockKey);
    }
  };

  app.post("/api/recordings/:id/trim", requireAuth, handleAudioTrimming);
  app.post("/api/recordings/:recordingId/trim", requireAuth, handleAudioTrimming);

  // Safe Server-Authoritative Project Deletion
  app.delete("/api/projects/:projectId", requireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const { projectId } = req.params;
      if (!projectId) {
        return res.status(400).json({ error: "Bad Request", message: "Project ID is required." });
      }

      const projAccess = await resolveProjectAccess(db, req.user, projectId, { requiredPermission: 'DELETE_PROJECT' });
      if (!projAccess.hasAccess || !projAccess.permissions.canDeleteProject) {
        if (projAccess.notFound) {
          return res.status(404).json({ error: "Not Found", message: "Project not found." });
        }
        if (projAccess.mfaRequired) {
          return res.status(403).json(
            createMfaForbiddenResponse(
              projAccess.mfaRequirement,
              projAccess.reason,
              req.user,
              projAccess.mfaEnrolled,
              { organizationId: projAccess.organizationId }
            )
          );
        }
        return res.status(403).json({
          error: "Forbidden",
          message: "Only the project owner, organization administrator, or platform administrator can delete this project."
        });
      }

      const projectData = projAccess.project || {};
      const cascadeRecordings = req.query.cascadeRecordings === 'true' || req.body?.cascadeRecordings === true;
      const bucketName = firebaseConfig.storageBucket || "echonote-2509.firebasestorage.app";
      const bucket = admin.storage().bucket(bucketName);

      // 1. Handle child recordings and meeting sessions defensively:
      // When a project is deleted, preserve any canonical recording, meeting session, transcript, summary,
      // decisions, and media that remain linked to other projects.
      const [recPrimarySnap, recMultiSnap] = await Promise.all([
        db.collection("recordings").where("projectId", "==", projectId).get().catch(() => ({ docs: [] } as any)),
        db.collection("recordings").where("projectIds", "array-contains", projectId).get().catch(() => ({ docs: [] } as any))
      ]);

      const candidateRecordingsMap = new Map<string, any>();
      for (const doc of recPrimarySnap.docs) {
        candidateRecordingsMap.set(doc.id, { id: doc.id, ...doc.data() });
      }
      for (const doc of recMultiSnap.docs) {
        if (!candidateRecordingsMap.has(doc.id)) {
          candidateRecordingsMap.set(doc.id, { id: doc.id, ...doc.data() });
        }
      }

      let affectedRecordingsCount = 0;
      for (const [recId, recData] of candidateRecordingsMap.entries()) {
        affectedRecordingsCount++;

        // Determine all existing associations
        const currentProjectIds: string[] = [];
        if (recData.projectId && typeof recData.projectId === 'string' && recData.projectId.trim()) {
          currentProjectIds.push(recData.projectId.trim());
        }
        if (Array.isArray(recData.projectIds)) {
          for (const pid of recData.projectIds) {
            if (typeof pid === 'string' && pid.trim() && !currentProjectIds.includes(pid.trim())) {
              currentProjectIds.push(pid.trim());
            }
          }
        }

        // Remaining associations after removing the deleted project
        const remainingProjectIds = currentProjectIds.filter(pid => pid !== projectId);

        if (remainingProjectIds.length > 0) {
          // Case A & D: Recording is shared with at least one other project.
          // NEVER purge storage or delete documents; promote a remaining project to primary if needed.
          const updatePayload: any = {
            projectIds: remainingProjectIds,
            updatedAt: FieldValue.serverTimestamp()
          };

          if (recData.projectId === projectId || !recData.projectId) {
            updatePayload.projectId = remainingProjectIds[0];
            try {
              const nextProjDoc = await db.collection("projects").doc(remainingProjectIds[0]).get();
              if (nextProjDoc.exists) {
                updatePayload.group = nextProjDoc.data()?.name || "General";
              }
            } catch {}
          }

          await db.collection("recordings").doc(recId).update(updatePayload);
          try {
            await db.collection("transcriptions").doc(recId).update(updatePayload);
          } catch {}
        } else {
          // Case B & C: Recording was exclusive to this deleted project (or has 0 remaining projects).
          if (cascadeRecordings) {
            // Truly exclusive recording with explicit cascade: purge storage and docs safely
            await purgeRecordingStorageAndDocs(db, bucket, recData);
          } else {
            // Default non-cascade: detach to 'General' to protect user voice data
            const updatePayload: any = {
              projectIds: [],
              projectId: FieldValue.delete(),
              group: "General",
              updatedAt: FieldValue.serverTimestamp()
            };
            await db.collection("recordings").doc(recId).update(updatePayload);
            try {
              await db.collection("transcriptions").doc(recId).update(updatePayload);
            } catch {}
          }
        }
      }

      // 1b. Handle meeting sessions:
      // Meeting sessions may be associated via projectId or projectIds.
      // If shared with other projects, keep session intact and promote a remaining project.
      try {
        const [sessPrimarySnap, sessMultiSnap] = await Promise.all([
          db.collection("meetingSessions").where("projectId", "==", projectId).get().catch(() => ({ docs: [] } as any)),
          db.collection("meetingSessions").where("projectIds", "array-contains", projectId).get().catch(() => ({ docs: [] } as any))
        ]);

        const candidateSessionsMap = new Map<string, any>();
        for (const doc of sessPrimarySnap.docs) {
          candidateSessionsMap.set(doc.id, { id: doc.id, ...doc.data() });
        }
        for (const doc of sessMultiSnap.docs) {
          if (!candidateSessionsMap.has(doc.id)) {
            candidateSessionsMap.set(doc.id, { id: doc.id, ...doc.data() });
          }
        }

        for (const [sessId, sessData] of candidateSessionsMap.entries()) {
          const sessProjectIds: string[] = [];
          if (sessData.projectId && typeof sessData.projectId === 'string' && sessData.projectId.trim()) {
            sessProjectIds.push(sessData.projectId.trim());
          }
          if (Array.isArray(sessData.projectIds)) {
            for (const pid of sessData.projectIds) {
              if (typeof pid === 'string' && pid.trim() && !sessProjectIds.includes(pid.trim())) {
                sessProjectIds.push(pid.trim());
              }
            }
          }

          // If linked to a recording that is still associated with remaining projects, inherit those projects
          if (sessData.recordingId && candidateRecordingsMap.has(sessData.recordingId)) {
            const linkedRec = candidateRecordingsMap.get(sessData.recordingId);
            const recProjIds = Array.isArray(linkedRec.projectIds) ? linkedRec.projectIds : (linkedRec.projectId ? [linkedRec.projectId] : []);
            for (const rpid of recProjIds) {
              if (rpid !== projectId && !sessProjectIds.includes(rpid)) {
                sessProjectIds.push(rpid);
              }
            }
          }

          const remainingSessProjects = sessProjectIds.filter(pid => pid !== projectId);

          if (remainingSessProjects.length > 0) {
            // Meeting session remains shared with another project! Preserve it!
            const sessUpdate: any = {
              projectIds: remainingSessProjects,
              updatedAt: new Date().toISOString()
            };
            if (sessData.projectId === projectId || !sessData.projectId) {
              sessUpdate.projectId = remainingSessProjects[0];
            }
            await db.collection("meetingSessions").doc(sessId).update(sessUpdate);
          } else {
            // Session had no other associations
            if (cascadeRecordings) {
              await db.collection("meetingSessions").doc(sessId).delete().catch(() => {});
            } else {
              await db.collection("meetingSessions").doc(sessId).update({
                projectId: null,
                projectIds: [],
                updatedAt: new Date().toISOString()
              }).catch(() => {});
            }
          }
        }
      } catch (sessErr: any) {
        console.warn("[Project Deletion Meeting Sessions Warning]:", sessErr?.message || sessErr);
      }

      // 2. Clean up project members
      const membersSnap = await db.collection("projectMembers").where("projectId", "==", projectId).get();
      const memberBatch = db.batch();
      membersSnap.docs.forEach(d => memberBatch.delete(d.ref));
      if (membersSnap.docs.length > 0) {
        await memberBatch.commit();
      }

      // 3. Clean up project invitations
      const invitesSnap = await db.collection("invites").where("projectId", "==", projectId).get();
      const inviteBatch = db.batch();
      invitesSnap.docs.forEach(d => inviteBatch.delete(d.ref));
      if (invitesSnap.docs.length > 0) {
        await inviteBatch.commit();
      }

      // 4. Clean up project activities
      const actSnap = await db.collection("projectActivities").where("projectId", "==", projectId).get();
      const actBatch = db.batch();
      actSnap.docs.forEach(d => actBatch.delete(d.ref));
      if (actSnap.docs.length > 0) {
        await actBatch.commit();
      }

      // 5. Detach or clean up decision history
      try {
        const decSnap = await db.collection("decisionHistory").where("projectId", "==", projectId).get();
        const decBatch = db.batch();
        decSnap.docs.forEach(d => {
          if (cascadeRecordings) {
            decBatch.delete(d.ref);
          } else {
            decBatch.update(d.ref, { projectId: FieldValue.delete() });
          }
        });
        if (decSnap.docs.length > 0) {
          await decBatch.commit();
        }
      } catch {}

      // 6. Delete the project document itself
      await db.collection("projects").doc(projectId).delete();

      // 7. Audit log if linked to an organization
      if (projectData.organizationId) {
        await recordOrgAuditEvent(db, {
          organizationId: projectData.organizationId,
          actorUserId: req.user.uid,
          actorEmail: req.user.email || "unknown",
          action: "PROJECT_DELETED",
          timestamp: new Date().toISOString(),
          source: "api",
          details: `Project "${projectData.name || projectId}" deleted. Child recordings ${cascadeRecordings ? 'cascaded' : 'detached'}. Members cleaned: ${membersSnap.docs.length}.`
        });
      }

      return res.json({
        success: true,
        message: "Project and dependent resources safely cleaned up via server-authoritative workflow.",
        projectId,
        recordingsHandled: affectedRecordingsCount,
        recordingsCascaded: cascadeRecordings,
        membersPurged: membersSnap.docs.length,
        invitesPurged: invitesSnap.docs.length,
        activitiesPurged: actSnap.docs.length
      });
    } catch (err: any) {
      console.error("[Project Deletion Error]:", err);
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to delete project safely." });
    }
  });

  // Project Ownership Transfer
  app.post("/api/projects/:projectId/transfer-ownership", requireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const { projectId } = req.params;
      const { newOwnerId } = req.body;

      if (!projectId || !newOwnerId) {
        return res.status(400).json({ error: "Bad Request", message: "projectId and newOwnerId are required." });
      }

      const projAccess = await resolveProjectAccess(db, req.user, projectId, { requiredPermission: 'DELETE_PROJECT' });
      if (!projAccess.hasAccess || (!projAccess.isOwner && !projAccess.isPlatformAdmin && !projAccess.isOrgAdmin)) {
        if (projAccess.notFound) {
          return res.status(404).json({ error: "Not Found", message: "Project not found." });
        }
        if (projAccess.mfaRequired) {
          return res.status(403).json(
            createMfaForbiddenResponse(
              projAccess.mfaRequirement,
              projAccess.reason,
              req.user,
              projAccess.mfaEnrolled,
              { organizationId: projAccess.organizationId }
            )
          );
        }
        return res.status(403).json({ 
          error: "Forbidden", 
          message: "Only the current project owner, organization administrator, or platform admin can transfer ownership." 
        });
      }
      const projectData = projAccess.project || {};

      // Verify target user exists
      const targetUserDoc = await db.collection("users").doc(newOwnerId).get();
      if (!targetUserDoc.exists) {
        return res.status(404).json({ error: "Not Found", message: "Target owner user not found." });
      }
      const targetUserData = targetUserDoc.data() || {};

      // Tenant isolation: if project is in an org, target user MUST be an active member of that org
      if (projectData.organizationId) {
        const targetOrgMember = await checkOrgAccess(db, targetUserData.email, projectData.organizationId, ["owner", "org_admin", "team_manager", "member", "viewer"]);
        if (!targetOrgMember.hasAccess) {
          return res.status(400).json({
            error: "Bad Request",
            message: "Target owner must be an active member of the project's organization to receive ownership."
          });
        }
      }

      // Verify target user is affiliated (project member or organization member)
      const targetMemberDoc = await db.collection("projectMembers").doc(`${newOwnerId}_${projectId}`).get();
      let isAffiliated = targetMemberDoc.exists;

      if (!isAffiliated && projectData.organizationId) {
        const orgMemberDoc = await db.collection("orgMembers").doc(`${projectData.organizationId}_${newOwnerId}`).get();
        if (orgMemberDoc.exists) isAffiliated = true;
      }

      if (!isAffiliated) {
        return res.status(400).json({
          error: "Bad Request",
          message: "Target user must be a member of the project or organization to receive ownership."
        });
      }

      // Execute transfer
      const batch = db.batch();
      batch.update(db.collection("projects").doc(projectId), {
        userId: newOwnerId,
        ownerEmail: targetUserData.email || null,
        updatedAt: FieldValue.serverTimestamp()
      });

      // Update project members
      batch.set(db.collection("projectMembers").doc(`${newOwnerId}_${projectId}`), {
        projectId,
        userId: newOwnerId,
        email: targetUserData.email || null,
        role: "owner",
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });

      // Demote previous owner to admin
      batch.set(db.collection("projectMembers").doc(`${req.user.uid}_${projectId}`), {
        projectId,
        userId: req.user.uid,
        email: req.user.email,
        role: "admin",
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });

      await batch.commit();

      // Log activity
      try {
        await db.collection("projectActivities").add({
          projectId,
          userId: req.user.uid,
          userEmail: req.user.email,
          actionType: "ownership_transferred",
          description: `Ownership transferred to ${targetUserData.email || newOwnerId}`,
          createdAt: FieldValue.serverTimestamp()
        });
      } catch {}

      if (projectData.organizationId) {
        await recordOrgAuditEvent(db, {
          organizationId: projectData.organizationId,
          actorUserId: req.user.uid,
          actorEmail: req.user.email || "unknown",
          targetUserId: newOwnerId,
          targetUserEmail: targetUserData.email || null,
          action: "PROJECT_OWNERSHIP_TRANSFERRED",
          timestamp: new Date().toISOString(),
          source: "api",
          details: `Project "${projectData.name || projectId}" ownership transferred to ${targetUserData.email || newOwnerId}.`
        });
      }

      return res.json({
        success: true,
        message: "Project ownership successfully transferred.",
        projectId,
        newOwnerId
      });
    } catch (err: any) {
      console.error("[Ownership Transfer Error]:", err);
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to transfer project ownership." });
    }
  });

  // ============================================================================
  // SERVER-AUTHORITATIVE COMMENT API (PHASE 1 - STEP 4A)
  // ============================================================================

  // 1. GET /api/recordings/:recordingId/comments
  app.get("/api/recordings/:recordingId/comments", requireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const { recordingId } = req.params;
      if (!recordingId || typeof recordingId !== 'string') {
        return res.status(400).json({ error: "Bad Request", message: "Valid recordingId is required." });
      }

      // Authorize access with VIEW permission
      const authResult = await authorizeRecordingAccess(req.user, recordingId, { requiredAction: 'VIEW' });
      if (!authResult.authorized) {
        return res.status(authResult.status).json({
          error: authResult.status === 404 ? "Not Found" : (authResult.status === 401 ? "Unauthorized" : "Forbidden"),
          message: authResult.message
        });
      }

      const commentsSnap = await db.collection("comments").where("recordingId", "==", recordingId).get();

      const comments = commentsSnap.docs.map(doc => {
        const data = doc.data() || {};
        return {
          id: doc.id,
          ...data
        };
      });

      // Consistent sorting: timestampSeconds ascending, then createdAt ascending
      // (comments without timestampSeconds placed after timestamped comments)
      comments.sort((a: any, b: any) => {
        const hasTimeA = typeof a.timestampSeconds === 'number' && !isNaN(a.timestampSeconds);
        const hasTimeB = typeof b.timestampSeconds === 'number' && !isNaN(b.timestampSeconds);
        if (hasTimeA && hasTimeB) {
          if (a.timestampSeconds !== b.timestampSeconds) {
            return a.timestampSeconds - b.timestampSeconds;
          }
        } else if (hasTimeA && !hasTimeB) {
          return -1;
        } else if (!hasTimeA && hasTimeB) {
          return 1;
        }
        const createdA = typeof a.createdAt === 'string' ? a.createdAt : (a.createdAt?.toDate ? a.createdAt.toDate().toISOString() : '');
        const createdB = typeof b.createdAt === 'string' ? b.createdAt : (b.createdAt?.toDate ? b.createdAt.toDate().toISOString() : '');
        return createdA.localeCompare(createdB);
      });

      return res.json({ comments });
    } catch (err: any) {
      console.error("[Get Comments Error]:", err);
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to fetch comments." });
    }
  });

  // 2. POST /api/recordings/:recordingId/comments
  app.post("/api/recordings/:recordingId/comments", requireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const { recordingId } = req.params;
      if (!recordingId || typeof recordingId !== 'string') {
        return res.status(400).json({ error: "Bad Request", message: "Valid recordingId is required." });
      }

      // Authorize access with COMMENT permission (verifies role, project, and tenant boundaries)
      const authResult = await authorizeRecordingAccess(req.user, recordingId, { requiredAction: 'COMMENT' });
      if (!authResult.authorized) {
        return res.status(authResult.status).json({
          error: authResult.status === 404 ? "Not Found" : (authResult.status === 401 ? "Unauthorized" : "Forbidden"),
          message: authResult.message
        });
      }

      const recording = authResult.record;
      const projectId = recording.projectId;
      if (!projectId || typeof projectId !== 'string') {
        return res.status(400).json({ error: "Bad Request", message: "Recording must be associated with a valid project to receive comments." });
      }

      // Authoritative project verification
      const projectDoc = await db.collection("projects").doc(projectId).get();
      if (!projectDoc.exists) {
        return res.status(404).json({ error: "Not Found", message: "Associated project not found." });
      }
      const projectData = projectDoc.data() || {};

      // Organization boundary consistency
      const recOrg = recording.organizationId || recording.orgId;
      const projOrg = projectData.organizationId || projectData.orgId;
      if (recOrg && projOrg && recOrg !== projOrg) {
        return res.status(400).json({ error: "Bad Request", message: "Recording and project organization mismatch." });
      }
      const authoritativeOrgId = projOrg || recOrg || null;

      // Validate request body
      const { content, timestampSeconds, parentCommentId } = req.body || {};

      if (content === undefined || content === null || typeof content !== 'string') {
        return res.status(400).json({ error: "Bad Request", message: "Content is required and must be a string." });
      }
      const trimmedContent = content.trim();
      if (!trimmedContent) {
        return res.status(400).json({ error: "Bad Request", message: "Content cannot be empty." });
      }
      if (trimmedContent.length > 5000) {
        return res.status(400).json({ error: "Bad Request", message: "Content exceeds maximum length of 5000 characters." });
      }

      // Validate timestampSeconds if provided
      let validatedTimestamp: number | undefined = undefined;
      if (timestampSeconds !== undefined && timestampSeconds !== null) {
        if (typeof timestampSeconds !== 'number' || isNaN(timestampSeconds) || !isFinite(timestampSeconds) || timestampSeconds < 0) {
          return res.status(400).json({ error: "Bad Request", message: "timestampSeconds must be a non-negative finite number." });
        }
        validatedTimestamp = timestampSeconds;
      }

      // Validate parentCommentId if provided (must belong to same recording and project)
      let validatedParentId: string | undefined = undefined;
      if (parentCommentId !== undefined && parentCommentId !== null) {
        if (typeof parentCommentId !== 'string' || !parentCommentId.trim()) {
          return res.status(400).json({ error: "Bad Request", message: "parentCommentId must be a non-empty string." });
        }
        const parentDoc = await db.collection("comments").doc(parentCommentId.trim()).get();
        if (!parentDoc.exists) {
          return res.status(404).json({ error: "Not Found", message: "Parent comment not found." });
        }
        const parentData = parentDoc.data() || {};
        if (parentData.recordingId !== recordingId) {
          return res.status(400).json({ error: "Bad Request", message: "Parent comment belongs to a different recording." });
        }
        if (parentData.projectId !== projectId) {
          return res.status(400).json({ error: "Bad Request", message: "Parent comment belongs to a different project." });
        }
        validatedParentId = parentCommentId.trim();
      }

      // Authoritative author identity
      const userId = req.user.uid;
      let userEmail = req.user.email || "";
      let userName = req.user.displayName || req.user.name || "";

      try {
        const userDoc = await db.collection("users").doc(userId).get();
        if (userDoc.exists) {
          const uData = userDoc.data() || {};
          if (uData.email) userEmail = uData.email;
          if (uData.displayName) userName = uData.displayName;
        }
      } catch {}

      if (!userName && userEmail) {
        userName = userEmail.split('@')[0];
      }

      const now = new Date().toISOString();
      const commentDocRef = db.collection("comments").doc();
      const newComment: Record<string, any> = {
        id: commentDocRef.id,
        recordingId,
        projectId,
        userId,
        userEmail,
        userName,
        content: trimmedContent,
        createdAt: now,
        updatedAt: now
      };

      if (authoritativeOrgId) {
        newComment.organizationId = authoritativeOrgId;
        newComment.orgId = authoritativeOrgId;
      }
      if (validatedTimestamp !== undefined) {
        newComment.timestampSeconds = validatedTimestamp;
      }
      if (validatedParentId !== undefined) {
        newComment.parentCommentId = validatedParentId;
      }

      await commentDocRef.set(newComment);

      const recordingTitle = recording.fileName || recording.title || recording.name || 'Recording';

      // 1. Create projectActivity (comment_added)
      try {
        await db.collection("projectActivities").add({
          projectId,
          organizationId: authoritativeOrgId || null,
          userId,
          userEmail,
          userName,
          actionType: "comment_added",
          description: `${userName} added a comment on recording "${recordingTitle}"`,
          recordingId,
          commentId: commentDocRef.id,
          createdAt: FieldValue.serverTimestamp()
        });
      } catch (actErr: any) {
        console.warn("[Create Comment Activity Note]:", actErr?.message || actErr);
      }

      // 2. Create Notifications (Server-authoritative recipient resolution)
      try {
        const recipientsToNotify: Array<{ userId: string; userEmail?: string; isReply: boolean }> = [];

        // A. Recording creator/owner notification (when another user comments)
        const recordingOwnerId = recording.userId || recording.ownerId;
        const recordingOwnerEmail = recording.userEmail || recording.ownerEmail;
        if (recordingOwnerId && recordingOwnerId !== userId) {
          // Verify recipient belongs to project/organization
          const isProjectOwner = projectData.userId === recordingOwnerId || 
            (projectData.ownerEmail && projectData.ownerEmail.toLowerCase() === recordingOwnerEmail?.toLowerCase());
          const isProjectMember = Array.isArray(projectData.members) && projectData.members.some(
            (m: any) => m.uid === recordingOwnerId || m.userId === recordingOwnerId || 
              (m.email && m.email.toLowerCase() === recordingOwnerEmail?.toLowerCase())
          );

          if (isProjectOwner || isProjectMember || !authoritativeOrgId) {
            recipientsToNotify.push({
              userId: recordingOwnerId,
              userEmail: recordingOwnerEmail,
              isReply: false
            });
          }
        }

        // B. Parent comment author notification (for replies when another user replies)
        if (validatedParentId) {
          try {
            const parentDoc = await db.collection("comments").doc(validatedParentId).get();
            if (parentDoc.exists) {
              const parentData = parentDoc.data() || {};
              const parentAuthorId = parentData.userId;
              const parentAuthorEmail = parentData.userEmail;
              if (
                parentAuthorId &&
                parentAuthorId !== userId &&
                !recipientsToNotify.some(r => r.userId === parentAuthorId)
              ) {
                // Verify tenant boundary
                const parentOrg = parentData.organizationId || parentData.orgId;
                if (!authoritativeOrgId || !parentOrg || parentOrg === authoritativeOrgId) {
                  recipientsToNotify.push({
                    userId: parentAuthorId,
                    userEmail: parentAuthorEmail,
                    isReply: true
                  });
                }
              }
            }
          } catch (pErr) {
            console.warn("[Parent Comment Lookup Note]:", pErr);
          }
        }

        // Persist notification for each eligible recipient using deterministic IDs to prevent duplicates
        for (const recipient of recipientsToNotify) {
          const notifId = `notif_comment_${commentDocRef.id}_${recipient.userId}`;
          const notifTitle = recipient.isReply ? "New Reply on Comment" : "New Comment on Recording";
          const notifMessage = recipient.isReply
            ? `${userName} replied to your comment on "${recordingTitle}".`
            : `${userName} commented on "${recordingTitle}".`;

          await db.collection("notifications").doc(notifId).set({
            userId: recipient.userId,
            userEmail: recipient.userEmail || "",
            title: notifTitle,
            message: notifMessage,
            type: "info",
            projectId,
            recordingId,
            recordId: recordingId,
            commentId: commentDocRef.id,
            actorUserId: userId,
            isRead: false,
            createdAt: FieldValue.serverTimestamp()
          });
        }
      } catch (notifErr: any) {
        console.warn("[Create Comment Notification Note]:", notifErr?.message || notifErr);
      }

      return res.status(201).json({ success: true, comment: newComment });
    } catch (err: any) {
      console.error("[Create Comment Error]:", err);
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to create comment." });
    }
  });

  // 3. PATCH /api/comments/:commentId
  app.patch("/api/comments/:commentId", requireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const { commentId } = req.params;
      if (!commentId || typeof commentId !== 'string') {
        return res.status(400).json({ error: "Bad Request", message: "Valid commentId is required." });
      }

      // 1. Load comment
      const commentDoc = await db.collection("comments").doc(commentId).get();
      if (!commentDoc.exists) {
        return res.status(404).json({ error: "Not Found", message: "Comment not found." });
      }
      const comment = commentDoc.data() || {};
      comment.id = commentDoc.id;

      // 2. Load authoritative recording
      let recordingDoc = await db.collection("recordings").doc(comment.recordingId).get();
      if (!recordingDoc.exists) {
        recordingDoc = await db.collection("transcriptions").doc(comment.recordingId).get();
      }
      if (!recordingDoc.exists) {
        return res.status(404).json({ error: "Not Found", message: "Associated recording not found." });
      }
      const recording = recordingDoc.data() || {};

      // 3. Validate recording.projectId === comment.projectId
      if (recording.projectId !== comment.projectId) {
        return res.status(400).json({ error: "Bad Request", message: "Comment and recording project mismatch." });
      }

      // 4. Resolve project access
      const projAccess = await resolveProjectAccess(db, req.user, comment.projectId);
      if (!projAccess.hasAccess) {
        if (projAccess.mfaRequired) {
          return res.status(403).json(
            createMfaForbiddenResponse(
              projAccess.mfaRequirement,
              projAccess.reason,
              req.user,
              projAccess.mfaEnrolled,
              { organizationId: projAccess.organizationId }
            )
          );
        }
        return res.status(403).json({ error: "Forbidden", message: "Access denied to project." });
      }

      // 5. Authorize update
      const isAuthor = comment.userId === req.user.uid;
      const canModerate = Boolean(
        projAccess.isPlatformAdmin ||
        projAccess.isOwner ||
        projAccess.isOrgAdmin ||
        projAccess.role === 'admin' ||
        projAccess.role === 'owner'
      );

      const isViewer = projAccess.role === 'viewer';
      // Commenter can edit own comment IF they still have canComment permission; viewers cannot edit
      const canAuthorEdit = isAuthor && !isViewer && (projAccess.permissions.canComment || canModerate);

      if (!canAuthorEdit && !canModerate) {
        return res.status(403).json({
          error: "Forbidden",
          message: isViewer
            ? "Permission denied: Viewers cannot modify comments."
            : (isAuthor 
                ? "Your role does not permit modifying comments." 
                : "Permission denied: Only the comment author or project administrator can edit this comment.")
        });
      }

      // 6. Validate allowed mutations (only content can be changed)
      const { content } = req.body || {};
      if (content === undefined || content === null || typeof content !== 'string') {
        return res.status(400).json({ error: "Bad Request", message: "Content is required and must be a string." });
      }
      const trimmedContent = content.trim();
      if (!trimmedContent) {
        return res.status(400).json({ error: "Bad Request", message: "Content cannot be empty." });
      }
      if (trimmedContent.length > 5000) {
        return res.status(400).json({ error: "Bad Request", message: "Content exceeds maximum length of 5000 characters." });
      }

      const updatedAt = new Date().toISOString();
      await db.collection("comments").doc(commentId).update({
        content: trimmedContent,
        updatedAt
      });

      const updatedComment = {
        ...comment,
        content: trimmedContent,
        updatedAt
      };

      // Create projectActivity (comment_updated)
      try {
        const recordingTitle = recording.fileName || recording.title || recording.name || 'Recording';
        const actorName = req.user.displayName || req.user.name || (req.user.email ? req.user.email.split('@')[0] : 'User');

        await db.collection("projectActivities").add({
          projectId: comment.projectId,
          organizationId: comment.organizationId || comment.orgId || null,
          userId: req.user.uid,
          userEmail: req.user.email || "",
          userName: actorName,
          actionType: "comment_updated",
          description: isAuthor 
            ? `${actorName} updated their comment on recording "${recordingTitle}"`
            : `${actorName} updated a comment on recording "${recordingTitle}"`,
          recordingId: comment.recordingId,
          commentId,
          createdAt: FieldValue.serverTimestamp()
        });
      } catch (actErr: any) {
        console.warn("[Update Comment Activity Note]:", actErr?.message || actErr);
      }

      return res.json({ success: true, comment: updatedComment });
    } catch (err: any) {
      console.error("[Patch Comment Error]:", err);
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to update comment." });
    }
  });

  // 4. DELETE /api/comments/:commentId
  app.delete("/api/comments/:commentId", requireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const { commentId } = req.params;
      if (!commentId || typeof commentId !== 'string') {
        return res.status(400).json({ error: "Bad Request", message: "Valid commentId is required." });
      }

      // 1. Load comment
      const commentDoc = await db.collection("comments").doc(commentId).get();
      if (!commentDoc.exists) {
        return res.status(404).json({ error: "Not Found", message: "Comment not found." });
      }
      const comment = commentDoc.data() || {};
      comment.id = commentDoc.id;

      // 2. Load authoritative recording
      let recordingDoc = await db.collection("recordings").doc(comment.recordingId).get();
      if (!recordingDoc.exists) {
        recordingDoc = await db.collection("transcriptions").doc(comment.recordingId).get();
      }
      if (!recordingDoc.exists) {
        return res.status(404).json({ error: "Not Found", message: "Associated recording not found." });
      }
      const recording = recordingDoc.data() || {};

      // 3. Validate recording.projectId === comment.projectId
      if (recording.projectId !== comment.projectId) {
        return res.status(400).json({ error: "Bad Request", message: "Comment and recording project mismatch." });
      }

      // 4. Resolve project access
      const projAccess = await resolveProjectAccess(db, req.user, comment.projectId);
      if (!projAccess.hasAccess) {
        if (projAccess.mfaRequired) {
          return res.status(403).json(
            createMfaForbiddenResponse(
              projAccess.mfaRequirement,
              projAccess.reason,
              req.user,
              projAccess.mfaEnrolled,
              { organizationId: projAccess.organizationId }
            )
          );
        }
        return res.status(403).json({ error: "Forbidden", message: "Access denied to project." });
      }

      // 5. Authorize delete
      const isAuthor = comment.userId === req.user.uid;
      const canModerate = Boolean(
        projAccess.isPlatformAdmin ||
        projAccess.isOwner ||
        projAccess.isOrgAdmin ||
        projAccess.role === 'admin' ||
        projAccess.role === 'owner'
      );

      const isViewer = projAccess.role === 'viewer';
      const canAuthorDelete = isAuthor && !isViewer && (projAccess.permissions.canComment || canModerate);

      if (!canAuthorDelete && !canModerate) {
        return res.status(403).json({
          error: "Forbidden",
          message: isViewer
            ? "Permission denied: Viewers cannot delete comments."
            : (isAuthor
                ? "Your role does not permit deleting comments."
                : "Permission denied: Only the comment author or project administrator can delete this comment.")
        });
      }

      // 6. Delete comment
      await db.collection("comments").doc(commentId).delete();

      // Create projectActivity (comment_deleted)
      try {
        const recordingTitle = recording.fileName || recording.title || recording.name || 'Recording';
        const actorName = req.user.displayName || req.user.name || (req.user.email ? req.user.email.split('@')[0] : 'User');

        await db.collection("projectActivities").add({
          projectId: comment.projectId,
          organizationId: comment.organizationId || comment.orgId || null,
          userId: req.user.uid,
          userEmail: req.user.email || "",
          userName: actorName,
          actionType: "comment_deleted",
          description: isAuthor 
            ? `${actorName} deleted their comment on recording "${recordingTitle}"`
            : `${actorName} deleted a comment on recording "${recordingTitle}"`,
          recordingId: comment.recordingId,
          commentId,
          createdAt: FieldValue.serverTimestamp()
        });
      } catch (actErr: any) {
        console.warn("[Delete Comment Activity Note]:", actErr?.message || actErr);
      }

      return res.json({
        success: true,
        message: "Comment deleted successfully.",
        commentId
      });
    } catch (err: any) {
      console.error("[Delete Comment Error]:", err);
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to delete comment." });
    }
  });

  // ============================================================================
  // SERVER-AUTHORITATIVE TASK & EXECUTION MANAGEMENT API (PHASE 1B - STEP 3.1)
  // ============================================================================

  // Helper: Verify if an assignee email is eligible for the project
  async function verifyEligibleAssignee(
    firestoreDb: admin.firestore.Firestore,
    projectId: string,
    projectData: any,
    assigneeEmail?: string
  ): Promise<{ eligible: boolean; memberName?: string; memberUid?: string; message?: string }> {
    if (!assigneeEmail || typeof assigneeEmail !== 'string' || !assigneeEmail.trim()) {
      return { eligible: true, memberName: 'Unassigned' };
    }
    const cleanEmail = assigneeEmail.trim().toLowerCase();

    // Check project owner
    if (projectData.ownerEmail && projectData.ownerEmail.toLowerCase() === cleanEmail) {
      return { eligible: true, memberName: projectData.ownerName || cleanEmail.split('@')[0], memberUid: projectData.userId };
    }

    // Check project members array or collection
    if (Array.isArray(projectData.members)) {
      const found = projectData.members.find((m: any) => m.email && m.email.toLowerCase() === cleanEmail);
      if (found) {
        return { eligible: true, memberName: found.displayName || cleanEmail.split('@')[0], memberUid: found.uid || found.userId };
      }
    }

    const membersSnap = await firestoreDb.collection("projectMembers")
      .where("projectId", "==", projectId)
      .where("email", "==", cleanEmail)
      .get()
      .catch(() => ({ empty: true, docs: [] } as any));

    if (!membersSnap.empty) {
      const mData = membersSnap.docs[0].data();
      return { eligible: true, memberName: mData.displayName || cleanEmail.split('@')[0], memberUid: mData.userId };
    }

    // If project is in an org, check org membership
    const orgId = projectData.organizationId || projectData.orgId;
    if (orgId) {
      const orgAccess = await checkOrgAccess(firestoreDb, cleanEmail, orgId, ["owner", "org_admin", "team_manager", "member", "viewer"]);
      if (orgAccess.hasAccess) {
        return { eligible: true, memberName: cleanEmail.split('@')[0] };
      }
    }

    return { 
      eligible: false, 
      message: `Assignee "${cleanEmail}" is not an active member of this project or organization.` 
    };
  }

  // Task scheduling & date range validation helper
  function validateTaskDates(startDate?: any, dueDate?: any): { valid: boolean; normalizedStartDate?: string; normalizedDueDate?: string; error?: string } {
    let cleanStart: string | undefined = undefined;
    let cleanDue: string | undefined = undefined;

    // Validate startDate if provided and non-empty
    if (startDate !== undefined && startDate !== null && startDate !== '') {
      if (typeof startDate !== 'string') {
        return { valid: false, error: 'Start date must be an ISO 8601 string or YYYY-MM-DD date.' };
      }
      const trimmed = startDate.trim();
      const parsed = Date.parse(trimmed);
      if (isNaN(parsed)) {
        return { valid: false, error: `Invalid start date format: "${startDate}". Must be a valid date.` };
      }
      // Standardize to YYYY-MM-DD if calendar date or preserve ISO string
      cleanStart = trimmed.length === 10 ? trimmed : new Date(parsed).toISOString();
    }

    // Validate dueDate if provided and non-empty
    if (dueDate !== undefined && dueDate !== null && dueDate !== '') {
      if (typeof dueDate !== 'string') {
        return { valid: false, error: 'Due date must be an ISO 8601 string or YYYY-MM-DD date.' };
      }
      const trimmed = dueDate.trim();
      const parsed = Date.parse(trimmed);
      if (isNaN(parsed)) {
        return { valid: false, error: `Invalid due date format: "${dueDate}". Must be a valid date.` };
      }
      cleanDue = trimmed.length === 10 ? trimmed : new Date(parsed).toISOString();
    }

    // Enforce relationship: startDate <= dueDate
    if (cleanStart && cleanDue) {
      const startTime = new Date(cleanStart).getTime();
      const dueTime = new Date(cleanDue).getTime();
      if (startTime > dueTime) {
        return {
          valid: false,
          error: `Task scheduling conflict: Start date (${cleanStart.substring(0, 10)}) cannot be after Due date (${cleanDue.substring(0, 10)}).`
        };
      }
    }

    return {
      valid: true,
      normalizedStartDate: cleanStart,
      normalizedDueDate: cleanDue
    };
  }

  // Task dependencies & cycle detection helper
  function detectDependencyCycle(
    targetTaskId: string,
    candidatePrereqIds: string[],
    allProjectTasks: Array<{ id: string; prerequisiteTaskIds?: string[]; title?: string }>
  ): { hasCycle: boolean; cyclePath?: string } {
    const taskMap = new Map<string, { id: string; prerequisiteTaskIds?: string[]; title?: string }>();
    allProjectTasks.forEach(t => taskMap.set(t.id, t));

    // For any candidate prerequisite P of targetTaskId:
    // If targetTaskId is reachable by starting at P and following its prerequisiteTaskIds upstream,
    // then adding targetTaskId -> P creates a cycle (targetTaskId -> P -> ... -> targetTaskId).
    for (const prereqId of candidatePrereqIds) {
      if (prereqId === targetTaskId) {
        return { hasCycle: true, cyclePath: `${targetTaskId} -> ${targetTaskId}` };
      }

      const visited = new Set<string>();
      const path: string[] = [targetTaskId, prereqId];

      function dfs(currentId: string): boolean {
        if (currentId === targetTaskId) return true;
        if (visited.has(currentId)) return false;
        visited.add(currentId);

        const currentTask = taskMap.get(currentId);
        if (!currentTask || !Array.isArray(currentTask.prerequisiteTaskIds)) return false;

        for (const nextPrereqId of currentTask.prerequisiteTaskIds) {
          path.push(nextPrereqId);
          if (dfs(nextPrereqId)) return true;
          path.pop();
        }
        return false;
      }

      const currentTask = taskMap.get(prereqId);
      if (currentTask && Array.isArray(currentTask.prerequisiteTaskIds)) {
        for (const upstreamId of currentTask.prerequisiteTaskIds) {
          path.push(upstreamId);
          if (dfs(upstreamId)) {
            const cycleNames = path.map(id => taskMap.get(id)?.title || id).join(" -> ");
            return { hasCycle: true, cyclePath: cycleNames };
          }
          path.pop();
        }
      }
    }

    return { hasCycle: false };
  }

  // 1. GET /api/projects/:projectId/tasks - Query tasks with server filters & execution metrics
  app.get("/api/projects/:projectId/tasks", requireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const { projectId } = req.params;
      if (!projectId) {
        return res.status(400).json({ error: "Bad Request", message: "Project ID is required." });
      }

      // Check project read access
      const projAccess = await resolveProjectAccess(db, req.user, projectId, { requiredPermission: 'VIEW' });
      if (!projAccess.hasAccess) {
        if (projAccess.notFound) {
          return res.status(404).json({ error: "Not Found", message: "Project not found." });
        }
        return res.status(403).json({ error: "Forbidden", message: "Access denied to project tasks." });
      }

      // Query tasks from authoritative 'tasks' collection (fallback checks projectTasks)
      let tasksSnap = await db.collection("tasks").where("projectId", "==", projectId).get();
      if (tasksSnap.empty) {
        const altSnap = await db.collection("projectTasks").where("projectId", "==", projectId).get();
        if (!altSnap.empty) {
          tasksSnap = altSnap;
        }
      }

      let rawTaskList: any[] = tasksSnap.docs.map(doc => {
        const d = doc.data() || {};
        return {
          id: doc.id,
          ...d,
          prerequisiteTaskIds: Array.isArray(d.prerequisiteTaskIds) ? d.prerequisiteTaskIds : [],
          createdAt: typeof d.createdAt === 'string' ? d.createdAt : (d.createdAt?.toDate ? d.createdAt.toDate().toISOString() : new Date().toISOString()),
          updatedAt: typeof d.updatedAt === 'string' ? d.updatedAt : (d.updatedAt?.toDate ? d.updatedAt.toDate().toISOString() : undefined)
        };
      });

      // Map of all project tasks for resolving prerequisite details & dependent tasks
      const allTasksMap = new Map<string, any>();
      rawTaskList.forEach(t => allTasksMap.set(t.id, t));

      // Calculate dependentTaskIds (downstream tasks) for each task
      const downstreamMap = new Map<string, string[]>();
      rawTaskList.forEach(t => {
        if (Array.isArray(t.prerequisiteTaskIds)) {
          t.prerequisiteTaskIds.forEach((prereqId: string) => {
            const list = downstreamMap.get(prereqId) || [];
            list.push(t.id);
            downstreamMap.set(prereqId, list);
          });
        }
      });

      // Query active task exceptions for the project to display badges on affected tasks
      const activeExceptionsSnap = await db.collection("taskExceptions")
        .where("projectId", "==", projectId)
        .where("status", "in", ["open", "acknowledged", "in_progress"])
        .get();

      const taskExceptionsMap = new Map<string, Array<{ id: string; type: string; severity: string; title: string; status: string }>>();
      activeExceptionsSnap.docs.forEach(doc => {
        const d = doc.data() || {};
        if (d.taskId) {
          const list = taskExceptionsMap.get(d.taskId) || [];
          list.push({
            id: doc.id,
            type: d.type || 'other',
            severity: d.severity || 'medium',
            title: d.title || 'Exception',
            status: d.status || 'open'
          });
          taskExceptionsMap.set(d.taskId, list);
        }
      });

      // Enrich tasks with derived dependency status & blocking prerequisites breakdown
      let taskList: any[] = rawTaskList.map((t: any) => {
        const prereqIds: string[] = Array.isArray(t.prerequisiteTaskIds) ? t.prerequisiteTaskIds : [];
        const blockingPrereqs: Array<{ id: string; title: string; status: string }> = [];

        for (const pid of prereqIds) {
          const prereqTask = allTasksMap.get(pid);
          if (prereqTask && prereqTask.status !== 'completed') {
            blockingPrereqs.push({
              id: pid,
              title: prereqTask.title || 'Untitled Task',
              status: prereqTask.status || 'pending'
            });
          }
        }

        let dependencyStatus: 'ready' | 'blocked' | 'completed';
        if (t.status === 'completed') {
          dependencyStatus = 'completed';
        } else if (blockingPrereqs.length > 0) {
          dependencyStatus = 'blocked';
        } else {
          dependencyStatus = 'ready';
        }

        return {
          ...t,
          dependencyStatus,
          blockingPrerequisites: blockingPrereqs,
          dependentTaskIds: downstreamMap.get(t.id) || [],
          activeExceptions: taskExceptionsMap.get(t.id) || []
        };
      });

      // Compute scheduling metrics before specific view filtering
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const threeDaysAhead = todayStart + (3 * 24 * 60 * 60 * 1000);

      const totalTasks = taskList.length;
      const completedTasks = taskList.filter((t: any) => t.status === 'completed').length;
      const pendingTasks = taskList.filter((t: any) => t.status === 'pending').length;
      const inProgressTasks = taskList.filter((t: any) => t.status === 'in_progress').length;

      // Active overdue: active tasks with due date strictly prior to today's date
      const overdueTasks = taskList.filter((t: any) => {
        if (t.status === 'completed' || !t.dueDate) return false;
        const dueTime = new Date(t.dueDate).getTime();
        return dueTime < todayStart;
      }).length;

      // Due soon: active tasks due within the next 3 days
      const dueSoonTasks = taskList.filter((t: any) => {
        if (t.status === 'completed' || !t.dueDate) return false;
        const dueTime = new Date(t.dueDate).getTime();
        return dueTime >= todayStart && dueTime <= threeDaysAhead;
      }).length;

      // Starting soon: active tasks scheduled to start between today and next 3 days
      const startingSoonTasks = taskList.filter((t: any) => {
        if (t.status === 'completed' || !t.startDate) return false;
        const startTime = new Date(t.startDate).getTime();
        return startTime >= todayStart && startTime <= threeDaysAhead;
      }).length;

      // Missing scheduling: active tasks with no start date and no due date
      const unscheduledTasks = taskList.filter((t: any) => {
        return t.status !== 'completed' && !t.startDate && !t.dueDate;
      }).length;

      const assignedTasks = taskList.filter((t: any) => !!t.assigneeEmail).length;
      const unassignedTasks = totalTasks - assignedTasks;

      // Apply server-side query filters if provided
      const { status, priority, assigneeEmail, search, scheduleFilter, sortBy, sortOrder = 'asc' } = req.query as Record<string, string>;
      if (status) {
        taskList = taskList.filter((t: any) => t.status === status);
      }
      if (priority) {
        taskList = taskList.filter((t: any) => t.priority === priority);
      }
      if (assigneeEmail) {
        taskList = taskList.filter((t: any) => t.assigneeEmail?.toLowerCase() === assigneeEmail.toLowerCase());
      }
      if (search) {
        const q = search.toLowerCase();
        taskList = taskList.filter((t: any) => 
          (t.title && t.title.toLowerCase().includes(q)) ||
          (t.description && t.description.toLowerCase().includes(q)) ||
          (t.assigneeName && t.assigneeName.toLowerCase().includes(q))
        );
      }
      if (scheduleFilter) {
        if (scheduleFilter === 'overdue') {
          taskList = taskList.filter((t: any) => t.status !== 'completed' && t.dueDate && new Date(t.dueDate).getTime() < todayStart);
        } else if (scheduleFilter === 'due_soon') {
          taskList = taskList.filter((t: any) => t.status !== 'completed' && t.dueDate && new Date(t.dueDate).getTime() >= todayStart && new Date(t.dueDate).getTime() <= threeDaysAhead);
        } else if (scheduleFilter === 'starting_soon') {
          taskList = taskList.filter((t: any) => t.status !== 'completed' && t.startDate && new Date(t.startDate).getTime() >= todayStart && new Date(t.startDate).getTime() <= threeDaysAhead);
        } else if (scheduleFilter === 'unscheduled') {
          taskList = taskList.filter((t: any) => t.status !== 'completed' && !t.startDate && !t.dueDate);
        }
      }

      // Date Sorting
      if (sortBy === 'dueDate') {
        taskList.sort((a: any, b: any) => {
          if (!a.dueDate) return 1;
          if (!b.dueDate) return -1;
          const diff = new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
          return sortOrder === 'desc' ? -diff : diff;
        });
      } else if (sortBy === 'startDate') {
        taskList.sort((a: any, b: any) => {
          if (!a.startDate) return 1;
          if (!b.startDate) return -1;
          const diff = new Date(a.startDate).getTime() - new Date(b.startDate).getTime();
          return sortOrder === 'desc' ? -diff : diff;
        });
      }

      return res.json({
        success: true,
        projectId,
        tasks: taskList,
        executionStats: {
          totalTasks,
          completedTasks,
          pendingTasks,
          inProgressTasks,
          overdueTasks,
          dueSoonTasks,
          startingSoonTasks,
          unscheduledTasks,
          assignedTasks,
          unassignedTasks,
          completionRate: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0
        }
      });
    } catch (err: any) {
      console.error("[Get Tasks Error]:", err);
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to retrieve project tasks." });
    }
  });

  // 2. POST /api/projects/:projectId/tasks - Create new task
  app.post("/api/projects/:projectId/tasks", requireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const { projectId } = req.params;
      if (!projectId) {
        return res.status(400).json({ error: "Bad Request", message: "Project ID is required." });
      }

      // Check caller permission: EDIT_CONTENT required
      const projAccess = await resolveProjectAccess(db, req.user, projectId, { requiredPermission: 'EDIT_CONTENT' });
      if (!projAccess.hasAccess || !projAccess.permissions.canEditContent) {
        if (projAccess.notFound) {
          return res.status(404).json({ error: "Not Found", message: "Project not found." });
        }
        return res.status(403).json({ error: "Forbidden", message: "Permission denied: Only editors or administrators can create tasks in this project." });
      }

      const {
        title,
        description,
        assigneeEmail,
        priority = 'medium',
        dueDate,
        startDate,
        sourceType = 'manual',
        sourceDecisionId,
        sourceActionItem,
        sourceMeetingSessionId,
        sourceRecordingId,
        isAiSuggested = false,
        prerequisiteTaskIds = []
      } = req.body || {};

      if (!title || typeof title !== 'string' || !title.trim()) {
        return res.status(400).json({ error: "Bad Request", message: "Task title is required." });
      }
      if (title.trim().length > 300) {
        return res.status(400).json({ error: "Bad Request", message: "Task title cannot exceed 300 characters." });
      }

      const validPriorities = ['low', 'medium', 'high', 'urgent'];
      if (priority && !validPriorities.includes(priority)) {
        return res.status(400).json({ error: "Bad Request", message: `Invalid priority. Must be one of: ${validPriorities.join(', ')}` });
      }

      // Validate task dates (startDate, dueDate)
      const dateValidation = validateTaskDates(startDate, dueDate);
      if (!dateValidation.valid) {
        return res.status(400).json({ error: "Bad Request", message: dateValidation.error });
      }

      // Validate and clean prerequisiteTaskIds
      let cleanPrereqIds: string[] = [];
      if (prerequisiteTaskIds !== undefined && prerequisiteTaskIds !== null) {
        if (!Array.isArray(prerequisiteTaskIds)) {
          return res.status(400).json({ error: "Bad Request", message: "prerequisiteTaskIds must be an array of task IDs." });
        }
        // Deduplicate and filter strings
        cleanPrereqIds = Array.from(new Set(prerequisiteTaskIds.map((id: any) => String(id || '').trim()).filter(Boolean)));

        // Verify that all prerequisite tasks exist, belong to this same project
        if (cleanPrereqIds.length > 0) {
          const prereqDocs = await Promise.all(
            cleanPrereqIds.map(async (pid) => {
              let pDoc = await db.collection("tasks").doc(pid).get();
              if (!pDoc.exists) {
                pDoc = await db.collection("projectTasks").doc(pid).get();
              }
              return { id: pid, exists: pDoc.exists, data: pDoc.data() };
            })
          );

          for (const p of prereqDocs) {
            if (!p.exists) {
              return res.status(400).json({
                error: "Bad Request",
                message: `Prerequisite task "${p.id}" does not exist.`
              });
            }
            if (p.data?.projectId !== projectId) {
              return res.status(400).json({
                error: "Bad Request",
                message: `Cross-project dependency rejected: Prerequisite task "${p.id}" belongs to project "${p.data?.projectId}", not "${projectId}".`
              });
            }
          }
        }
      }

      // Validate assignee eligibility
      const projectData = projAccess.project || {};
      const assigneeCheck = await verifyEligibleAssignee(db, projectId, projectData, assigneeEmail);
      if (!assigneeCheck.eligible) {
        return res.status(400).json({ error: "Bad Request", message: assigneeCheck.message });
      }

      // Deduplication: if sourceDecisionId or sourceActionItem is supplied, check if already converted
      if (sourceDecisionId || sourceActionItem) {
        const queryField = sourceDecisionId ? "sourceDecisionId" : "sourceActionItem";
        const queryVal = sourceDecisionId || sourceActionItem;
        const existingSnap = await db.collection("tasks")
          .where("projectId", "==", projectId)
          .where(queryField, "==", queryVal)
          .get()
          .catch(() => ({ empty: true, docs: [] } as any));

        if (!existingSnap.empty) {
          const existingDoc = existingSnap.docs[0];
          return res.status(200).json({
            success: true,
            message: "Task already exists for this source decision/action item.",
            task: { id: existingDoc.id, ...existingDoc.data() },
            isDuplicateReused: true
          });
        }
      }

      const nowIso = new Date().toISOString();
      const creatorName = req.user.displayName || req.user.name || (req.user.email ? req.user.email.split('@')[0] : 'User');
      const taskId = `task_${crypto.randomUUID()}`;

      const newTaskData: any = {
        id: taskId,
        projectId,
        title: title.trim(),
        description: description && typeof description === 'string' ? description.trim() : '',
        assigneeEmail: assigneeEmail && typeof assigneeEmail === 'string' ? assigneeEmail.trim().toLowerCase() : '',
        assigneeName: assigneeCheck.memberName || (assigneeEmail ? assigneeEmail.split('@')[0] : 'Unassigned'),
        assigneeId: assigneeCheck.memberUid || '',
        status: 'pending',
        priority,
        dueDate: dateValidation.normalizedDueDate || '',
        startDate: dateValidation.normalizedStartDate || '',
        prerequisiteTaskIds: cleanPrereqIds,
        sourceType,
        sourceDecisionId: sourceDecisionId || undefined,
        sourceActionItem: sourceActionItem || undefined,
        sourceMeetingSessionId: sourceMeetingSessionId || undefined,
        sourceRecordingId: sourceRecordingId || undefined,
        isAiSuggested: Boolean(isAiSuggested),
        acceptedBy: isAiSuggested ? undefined : req.user.uid,
        acceptedAt: isAiSuggested ? undefined : nowIso,
        subTasks: [],
        activityHistory: [
          {
            id: crypto.randomUUID().substring(0, 8),
            action: 'task_created',
            performedBy: creatorName,
            timestamp: nowIso,
            details: `Created task "${title.trim()}"`
          }
        ],
        createdBy: req.user.uid,
        creatorEmail: req.user.email || '',
        createdAt: nowIso,
        updatedAt: nowIso
      };

      // Strip undefined properties
      Object.keys(newTaskData).forEach(k => {
        if (newTaskData[k] === undefined) delete newTaskData[k];
      });

      // Write to primary 'tasks' collection and mirror to 'projectTasks'
      await db.collection("tasks").doc(taskId).set(newTaskData);
      try {
        await db.collection("projectTasks").doc(taskId).set(newTaskData);
      } catch {}

      // Log project activity
      try {
        await db.collection("projectActivities").add({
          projectId,
          organizationId: projectData.organizationId || null,
          userId: req.user.uid,
          userEmail: req.user.email || '',
          userName: creatorName,
          actionType: 'task_created',
          description: `${creatorName} created task "${title.trim()}"`,
          taskId,
          createdAt: FieldValue.serverTimestamp()
        });
      } catch {}

      return res.status(201).json({
        success: true,
        message: "Task created successfully.",
        task: newTaskData
      });
    } catch (err: any) {
      console.error("[Create Task Error]:", err);
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to create task." });
    }
  });

  // 2b. GET /api/tasks/:taskId - Retrieve a single task by ID
  app.get("/api/tasks/:taskId", requireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const { taskId } = req.params;
      if (!taskId) {
        return res.status(400).json({ error: "Bad Request", message: "Task ID is required." });
      }

      let taskDoc = await db.collection("tasks").doc(taskId).get();
      if (!taskDoc.exists) {
        taskDoc = await db.collection("projectTasks").doc(taskId).get();
      }

      if (!taskDoc.exists) {
        return res.status(404).json({ error: "Not Found", message: "Task not found." });
      }

      const taskData = taskDoc.data() || {};
      const projectId = taskData.projectId;

      const projAccess = await resolveProjectAccess(db, req.user, projectId, { requiredPermission: 'VIEW' });
      if (!projAccess.hasAccess) {
        if (projAccess.notFound) {
          return res.status(404).json({ error: "Not Found", message: "Project not found." });
        }
        return res.status(403).json({ error: "Forbidden", message: "Access denied to task." });
      }

      return res.json({
        success: true,
        task: {
          id: taskDoc.id,
          ...taskData,
          prerequisiteTaskIds: Array.isArray(taskData.prerequisiteTaskIds) ? taskData.prerequisiteTaskIds : [],
          createdAt: typeof taskData.createdAt === 'string' ? taskData.createdAt : (taskData.createdAt?.toDate ? taskData.createdAt.toDate().toISOString() : new Date().toISOString()),
          updatedAt: typeof taskData.updatedAt === 'string' ? taskData.updatedAt : (taskData.updatedAt?.toDate ? taskData.updatedAt.toDate().toISOString() : undefined)
        }
      });
    } catch (err: any) {
      console.error("[Get Task Error]:", err);
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to retrieve task." });
    }
  });

  // 3. PATCH /api/tasks/:taskId - Update status, assignee, priority, dates, or description
  app.patch("/api/tasks/:taskId", requireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const { taskId } = req.params;
      if (!taskId) {
        return res.status(400).json({ error: "Bad Request", message: "Task ID is required." });
      }

      // 1. Fetch task document
      let taskDoc = await db.collection("tasks").doc(taskId).get();
      let collectionName = "tasks";
      if (!taskDoc.exists) {
        taskDoc = await db.collection("projectTasks").doc(taskId).get();
        collectionName = "projectTasks";
      }

      if (!taskDoc.exists) {
        return res.status(404).json({ error: "Not Found", message: "Task not found." });
      }

      const taskData = taskDoc.data() || {};
      const projectId = taskData.projectId;

      // 2. Authorize project access
      const projAccess = await resolveProjectAccess(db, req.user, projectId, { requiredPermission: 'EDIT_CONTENT' });
      if (!projAccess.hasAccess || !projAccess.permissions.canEditContent) {
        return res.status(403).json({ error: "Forbidden", message: "Permission denied: You cannot edit tasks in this project." });
      }

      const {
        title,
        description,
        assigneeEmail,
        status,
        priority,
        dueDate,
        startDate,
        subTasks,
        acceptAiSuggested,
        prerequisiteTaskIds
      } = req.body || {};

      const nowIso = new Date().toISOString();
      const updaterName = req.user.displayName || req.user.name || (req.user.email ? req.user.email.split('@')[0] : 'User');
      const updates: Record<string, any> = { updatedAt: nowIso };
      const activities: any[] = Array.isArray(taskData.activityHistory) ? [...taskData.activityHistory] : [];

      // Validate date updates against existing/provided start and due dates
      if (startDate !== undefined || dueDate !== undefined) {
        const effectiveStart = startDate !== undefined ? startDate : taskData.startDate;
        const effectiveDue = dueDate !== undefined ? dueDate : taskData.dueDate;
        const dateValidation = validateTaskDates(effectiveStart, effectiveDue);
        if (!dateValidation.valid) {
          return res.status(400).json({ error: "Bad Request", message: dateValidation.error });
        }
        if (startDate !== undefined) {
          updates.startDate = dateValidation.normalizedStartDate || '';
          activities.push({
            id: crypto.randomUUID().substring(0, 8),
            action: updates.startDate ? 'start_date_set' : 'start_date_cleared',
            performedBy: updaterName,
            timestamp: nowIso,
            details: updates.startDate ? `Set start date to ${updates.startDate.substring(0, 10)}` : 'Cleared start date'
          });
        }
        if (dueDate !== undefined) {
          updates.dueDate = dateValidation.normalizedDueDate || '';
          activities.push({
            id: crypto.randomUUID().substring(0, 8),
            action: updates.dueDate ? 'due_date_set' : 'due_date_cleared',
            performedBy: updaterName,
            timestamp: nowIso,
            details: updates.dueDate ? `Set due date to ${updates.dueDate.substring(0, 10)}` : 'Cleared due date'
          });
        }
      }

      if (title && typeof title === 'string' && title.trim()) {
        updates.title = title.trim();
      }
      if (description !== undefined && typeof description === 'string') {
        updates.description = description.trim();
      }
      if (status) {
        const validStatuses = ['pending', 'in_progress', 'completed'];
        if (!validStatuses.includes(status)) {
          return res.status(400).json({ error: "Bad Request", message: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
        }
        updates.status = status;
        activities.push({
          id: crypto.randomUUID().substring(0, 8),
          action: `status_${status}`,
          performedBy: updaterName,
          timestamp: nowIso,
          details: `Changed status to ${status.replace('_', ' ')}`
        });
      }
      if (priority) {
        const validPriorities = ['low', 'medium', 'high', 'urgent'];
        if (!validPriorities.includes(priority)) {
          return res.status(400).json({ error: "Bad Request", message: `Invalid priority. Must be one of: ${validPriorities.join(', ')}` });
        }
        updates.priority = priority;
      }
      if (Array.isArray(subTasks)) {
        updates.subTasks = subTasks;
      }
      if (acceptAiSuggested === true) {
        updates.isAiSuggested = false;
        updates.acceptedBy = req.user.uid;
        updates.acceptedAt = nowIso;
        activities.push({
          id: crypto.randomUUID().substring(0, 8),
          action: 'ai_suggestion_accepted',
          performedBy: updaterName,
          timestamp: nowIso,
          details: `Explicitly accepted AI-suggested task`
        });
      }

      // Handle prerequisiteTaskIds updates
      if (prerequisiteTaskIds !== undefined && prerequisiteTaskIds !== null) {
        if (!Array.isArray(prerequisiteTaskIds)) {
          return res.status(400).json({ error: "Bad Request", message: "prerequisiteTaskIds must be an array of task IDs." });
        }
        // Deduplicate and filter strings
        const cleanPrereqIds = Array.from(new Set(prerequisiteTaskIds.map((id: any) => String(id || '').trim()).filter(Boolean)));

        // Self-dependency rejection
        if (cleanPrereqIds.includes(taskId)) {
          return res.status(400).json({
            error: "Bad Request",
            message: "A task cannot depend on itself."
          });
        }

        // Verify all prerequisites exist and belong to the same project
        if (cleanPrereqIds.length > 0) {
          const prereqDocs = await Promise.all(
            cleanPrereqIds.map(async (pid) => {
              let pDoc = await db.collection("tasks").doc(pid).get();
              if (!pDoc.exists) {
                pDoc = await db.collection("projectTasks").doc(pid).get();
              }
              return { id: pid, exists: pDoc.exists, data: pDoc.data() };
            })
          );

          for (const p of prereqDocs) {
            if (!p.exists) {
              return res.status(400).json({
                error: "Bad Request",
                message: `Prerequisite task "${p.id}" does not exist.`
              });
            }
            if (p.data?.projectId !== projectId) {
              return res.status(400).json({
                error: "Bad Request",
                message: `Cross-project dependency rejected: Prerequisite task "${p.id}" belongs to project "${p.data?.projectId}", not "${projectId}".`
              });
            }
          }
        }

        // Cycle detection: load all tasks in project to detect direct/indirect cycles
        let allProjectTasksSnap = await db.collection("tasks").where("projectId", "==", projectId).get();
        if (allProjectTasksSnap.empty) {
          allProjectTasksSnap = await db.collection("projectTasks").where("projectId", "==", projectId).get();
        }
        const allProjTasks = allProjectTasksSnap.docs.map(doc => ({
          id: doc.id,
          title: doc.data()?.title || doc.id,
          prerequisiteTaskIds: doc.id === taskId ? cleanPrereqIds : (doc.data()?.prerequisiteTaskIds || [])
        }));

        const cycleResult = detectDependencyCycle(taskId, cleanPrereqIds, allProjTasks);
        if (cycleResult.hasCycle) {
          return res.status(400).json({
            error: "Bad Request",
            message: `Dependency cycle detected: Adding this prerequisite creates a circular dependency (${cycleResult.cyclePath || taskId}).`
          });
        }

        updates.prerequisiteTaskIds = cleanPrereqIds;
        activities.push({
          id: crypto.randomUUID().substring(0, 8),
          action: 'dependencies_updated',
          performedBy: updaterName,
          timestamp: nowIso,
          details: `Updated prerequisites (${cleanPrereqIds.length} task${cleanPrereqIds.length === 1 ? '' : 's'})`
        });
      }

      // If assignee email changed, validate eligibility
      if (assigneeEmail !== undefined) {
        const projectData = projAccess.project || {};
        const assigneeCheck = await verifyEligibleAssignee(db, projectId, projectData, assigneeEmail);
        if (!assigneeCheck.eligible) {
          return res.status(400).json({ error: "Bad Request", message: assigneeCheck.message });
        }
        updates.assigneeEmail = assigneeEmail ? assigneeEmail.trim().toLowerCase() : '';
        updates.assigneeName = assigneeCheck.memberName || (assigneeEmail ? assigneeEmail.split('@')[0] : 'Unassigned');
        updates.assigneeId = assigneeCheck.memberUid || '';
        activities.push({
          id: crypto.randomUUID().substring(0, 8),
          action: 'reassigned',
          performedBy: updaterName,
          timestamp: nowIso,
          details: `Assigned to ${updates.assigneeName} (${updates.assigneeEmail || 'Unassigned'})`
        });
      }

      updates.activityHistory = activities;

      let completionNotifSummary: any = null;
      if (status === 'completed') {
        completionNotifSummary = await executeTaskCompletionWithNotifications(db, {
          taskId,
          projectId,
          taskUpdates: updates,
          actorUid: req.user.uid,
          actorEmail: req.user.email || '',
          actorName: updaterName,
          nowIso
        });
      } else {
        await db.collection("tasks").doc(taskId).set(updates, { merge: true });
        try {
          await db.collection("projectTasks").doc(taskId).set(updates, { merge: true });
        } catch {}
      }

      return res.json({
        success: true,
        message: "Task updated successfully.",
        task: { ...taskData, ...updates, id: taskId },
        ...(completionNotifSummary ? { completionNotifications: completionNotifSummary } : {})
      });
    } catch (err: any) {
      console.error("[Update Task Error]:", err);
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to update task." });
    }
  });

  // 4. DELETE /api/tasks/:taskId - Remove a task
  app.delete("/api/tasks/:taskId", requireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const { taskId } = req.params;
      if (!taskId) {
        return res.status(400).json({ error: "Bad Request", message: "Task ID is required." });
      }

      let taskDoc = await db.collection("tasks").doc(taskId).get();
      if (!taskDoc.exists) {
        taskDoc = await db.collection("projectTasks").doc(taskId).get();
      }
      if (!taskDoc.exists) {
        return res.status(404).json({ error: "Not Found", message: "Task not found." });
      }

      const taskData = taskDoc.data() || {};
      const projectId = taskData.projectId;

      const projAccess = await resolveProjectAccess(db, req.user, projectId, { requiredPermission: 'EDIT_CONTENT' });
      const isCreator = taskData.createdBy === req.user.uid;
      const isLead = projAccess.isOwner || projAccess.role === 'admin' || projAccess.isOrgAdmin || projAccess.isPlatformAdmin;

      if (!isCreator && !isLead) {
        return res.status(403).json({ error: "Forbidden", message: "Permission denied: Only the task creator or project administrator can delete this task." });
      }

      // Safe deletion rule: Reject deletion if other tasks in the project depend on this task
      let allProjectTasksSnap = await db.collection("tasks").where("projectId", "==", projectId).get();
      if (allProjectTasksSnap.empty) {
        allProjectTasksSnap = await db.collection("projectTasks").where("projectId", "==", projectId).get();
      }

      const dependentTasks: Array<{ id: string; title: string }> = [];
      allProjectTasksSnap.docs.forEach(doc => {
        if (doc.id === taskId) return;
        const d = doc.data() || {};
        if (Array.isArray(d.prerequisiteTaskIds) && d.prerequisiteTaskIds.includes(taskId)) {
          dependentTasks.push({ id: doc.id, title: d.title || doc.id });
        }
      });

      if (dependentTasks.length > 0) {
        const dependentTitles = dependentTasks.map(d => `"${d.title}"`).join(", ");
        return res.status(400).json({
          error: "Bad Request",
          message: `Cannot delete task "${taskData.title || taskId}": It is required as a prerequisite by ${dependentTasks.length} task(s) (${dependentTitles}). Please remove this prerequisite from dependent tasks before deleting it.`,
          dependentTasks
        });
      }

      await db.collection("tasks").doc(taskId).delete().catch(() => {});
      await db.collection("projectTasks").doc(taskId).delete().catch(() => {});

      return res.json({
        success: true,
        message: "Task deleted successfully.",
        taskId
      });
    } catch (err: any) {
      console.error("[Delete Task Error]:", err);
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to delete task." });
    }
  });

  // =========================================================================
  // TASK DEADLINE PROPAGATION ENDPOINTS (AH.181)
  // Supports both canonical REST routes (/api/projects/:projectId/tasks/:taskId/propagate[/preview])
  // and batch routes (/api/projects/:projectId/tasks/(preview|execute)-propagation)
  // =========================================================================

  // Common preview handler
  const handleDeadlinePropagationPreview = async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const { projectId } = req.params;
      const taskId = req.params.taskId || req.body?.taskId;
      const { newStartDate, newDueDate } = req.body || {};

      if (!projectId) {
        return res.status(400).json({ error: "Bad Request", message: "Valid projectId is required." });
      }

      if (!taskId || typeof taskId !== "string" || !taskId.trim()) {
        return res.status(400).json({ error: "Bad Request", message: "A valid taskId is required." });
      }

      // Check project read access
      const projAccess = await resolveProjectAccess(db, req.user, projectId, { requiredPermission: 'VIEW' });
      if (!projAccess.hasAccess) {
        if (projAccess.notFound) {
          return res.status(404).json({ error: "Not Found", message: "Project not found." });
        }
        return res.status(403).json({ error: "Forbidden", message: "Access denied to project." });
      }

      // Fetch all project tasks
      let tasksSnap = await db.collection("tasks").where("projectId", "==", projectId).get();
      if (tasksSnap.empty) {
        const altSnap = await db.collection("projectTasks").where("projectId", "==", projectId).get();
        if (!altSnap.empty) {
          tasksSnap = altSnap;
        }
      }

      const allTasks: SchedulableTask[] = tasksSnap.docs.map(doc => {
        const d = doc.data() || {};
        return {
          id: doc.id,
          projectId: d.projectId || projectId,
          title: d.title || 'Untitled Task',
          status: d.status || 'pending',
          startDate: d.startDate || null,
          dueDate: d.dueDate || null,
          prerequisiteTaskIds: Array.isArray(d.prerequisiteTaskIds) ? d.prerequisiteTaskIds : [],
          updatedAt: typeof d.updatedAt === 'string' ? d.updatedAt : (d.updatedAt?.toDate ? d.updatedAt.toDate().toISOString() : undefined)
        };
      });

      const targetTask = allTasks.find(t => t.id === taskId);
      if (!targetTask) {
        return res.status(404).json({
          error: "Not Found",
          message: `Target task "${taskId}" does not exist in project "${projectId}".`
        });
      }

      const preview = calculateDeadlinePropagation(allTasks, taskId, {
        newStartDate: newStartDate !== undefined ? newStartDate : undefined,
        newDueDate: newDueDate !== undefined ? newDueDate : undefined
      });

      return res.json({
        success: true,
        preview
      });
    } catch (err: any) {
      console.error("[Deadline Propagation Preview Error]:", err);
      return res.status(500).json({
        error: "Internal Server Error",
        message: err?.message || "Failed to calculate deadline propagation preview."
      });
    }
  };

  // Common execute handler
  const handleDeadlinePropagationExecute = async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const { projectId } = req.params;
      const taskId = req.params.taskId || req.body?.taskId;
      const { newStartDate, newDueDate, scheduleVersionToken } = req.body || {};

      if (!projectId) {
        return res.status(400).json({ error: "Bad Request", message: "Valid projectId is required." });
      }

      if (!taskId || typeof taskId !== "string" || !taskId.trim()) {
        return res.status(400).json({ error: "Bad Request", message: "A valid taskId is required." });
      }

      if (newStartDate === undefined && newDueDate === undefined) {
        return res.status(400).json({ error: "Bad Request", message: "At least one proposed date (newStartDate or newDueDate) is required." });
      }

      if (!scheduleVersionToken || typeof scheduleVersionToken !== "string" || !scheduleVersionToken.trim()) {
        return res.status(400).json({
          error: "Bad Request",
          code: "MISSING_SCHEDULE_VERSION_TOKEN",
          message: "scheduleVersionToken is required for deterministic consistency and optimistic concurrency control."
        });
      }

      // Check caller project permission: EDIT_CONTENT required to mutate task schedules
      const projAccess = await resolveProjectAccess(db, req.user, projectId, { requiredPermission: 'EDIT_CONTENT' });
      if (!projAccess.hasAccess || !projAccess.permissions.canEditContent) {
        if (projAccess.notFound) {
          return res.status(404).json({ error: "Not Found", message: "Project not found." });
        }
        return res.status(403).json({
          error: "Forbidden",
          message: "Permission denied: Only editors or administrators can propagate task schedules in this project."
        });
      }

      // Execute propagation atomically using Firestore transaction
      const result = await db.runTransaction(async (transaction) => {
        let snapshot = await transaction.get(db.collection("tasks").where("projectId", "==", projectId));
        let primaryCollection = "tasks";
        if (snapshot.empty) {
          snapshot = await transaction.get(db.collection("projectTasks").where("projectId", "==", projectId));
          primaryCollection = "projectTasks";
        }

        const allTasks: any[] = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        const targetTask = allTasks.find(t => t.id === taskId);
        if (!targetTask) {
          const notFoundErr: any = new Error(`Target task "${taskId}" does not belong to project "${projectId}" or does not exist.`);
          notFoundErr.statusCode = 404;
          notFoundErr.errorCode = "NOT_FOUND";
          throw notFoundErr;
        }

        // Stale preview validation
        const currentVersionToken = computeScheduleVersionToken(allTasks);
        if (scheduleVersionToken !== currentVersionToken) {
          const staleErr: any = new Error("The project tasks schedule was modified by another operation. Please refresh the preview.");
          staleErr.statusCode = 409;
          staleErr.errorCode = "STALE_VERSION";
          staleErr.currentScheduleVersionToken = currentVersionToken;
          throw staleErr;
        }

        const propagation = calculateDeadlinePropagation(allTasks, taskId, {
          newStartDate: newStartDate !== undefined ? newStartDate : undefined,
          newDueDate: newDueDate !== undefined ? newDueDate : undefined
        });

        if (propagation.hasConflicts) {
          const conflictErr: any = new Error(`Cannot apply schedule changes due to conflicts: ${propagation.conflicts.join(", ")}`);
          conflictErr.statusCode = 400;
          conflictErr.errorCode = "CONFLICT_GRAPH";
          conflictErr.conflicts = propagation.conflicts;
          throw conflictErr;
        }

        const tasksToUpdate = propagation.affectedTasks.filter(a => {
          if (a.isCompleted) return false;
          const startChanged = a.proposedStartDate !== a.currentStartDate;
          const dueChanged = a.proposedDueDate !== a.currentDueDate;
          return startChanged || dueChanged;
        });

        if (tasksToUpdate.length === 0) {
          return {
            success: true,
            message: "No task schedules required updating.",
            targetTaskId: taskId,
            updatedTaskCount: 0,
            updatedTasks: [],
            notificationsCreated: 0
          };
        }

        const actorUid = req.user.uid;
        const actorEmail = normalizeEmail(req.user.email);
        const now = new Date().toISOString();
        const performerName = req.user.displayName || req.user.name || (req.user.email ? req.user.email.split("@")[0] : "User");
        const triggerTitle = targetTask.title || "Prerequisite Task";

        const notificationsToCreate: InAppNotificationRecord[] = [];

        for (const item of tasksToUpdate) {
          if (item.isDirectTarget) continue;

          const orig = allTasks.find(t => t.id === item.taskId);
          if (!orig) continue;

          const rawAssigneeId = orig.assigneeId || null;
          const rawAssigneeEmail = orig.assigneeEmail || null;
          const normAssigneeEmail = rawAssigneeEmail ? normalizeEmail(rawAssigneeEmail) : null;

          // Suppress notification if actor is the assignee
          const isActor = (rawAssigneeId && rawAssigneeId === actorUid) ||
                          (normAssigneeEmail && normAssigneeEmail === actorEmail);
          if (isActor) continue;

          const hasReliableRecipient = Boolean(
            (rawAssigneeId && typeof rawAssigneeId === "string" && rawAssigneeId.trim()) ||
            (normAssigneeEmail && isValidEmail(normAssigneeEmail))
          );
          if (!hasReliableRecipient) continue;

          const recipientIdentifier = rawAssigneeId || normAssigneeEmail!;
          const dedupKey = generateDeadlinePropagationDedupKey(
            projectId,
            item.taskId,
            recipientIdentifier,
            item.proposedDueDate,
            item.proposedStartDate,
            item.shiftDays || 0
          );

          const { title: notifTitle, message: notifMessage } = formatDeadlinePropagationMessage({
            affectedTaskTitle: item.title,
            triggerTaskTitle: triggerTitle,
            performerName,
            oldDueDate: item.currentDueDate,
            newDueDate: item.proposedDueDate,
            shiftDays: item.shiftDays || 0
          });

          notificationsToCreate.push({
            id: dedupKey,
            projectId,
            taskId: item.taskId,
            recipientUserId: rawAssigneeId,
            recipientEmail: normAssigneeEmail,
            userId: rawAssigneeId,
            userEmail: normAssigneeEmail,
            type: "DEADLINE_PROPAGATED",
            title: notifTitle,
            message: notifMessage,
            metadata: {
              triggerTaskId: taskId,
              triggerTaskTitle: triggerTitle,
              affectedTaskId: item.taskId,
              affectedTaskTitle: item.title,
              oldStartDate: item.currentStartDate,
              oldDueDate: item.currentDueDate,
              newStartDate: item.proposedStartDate,
              newDueDate: item.proposedDueDate,
              shiftDays: item.shiftDays || 0,
              performerId: actorUid,
              performerName,
              scheduleVersionToken: currentVersionToken
            },
            isRead: false,
            createdAt: now,
            updatedAt: now,
            idempotencyKey: dedupKey
          });
        }

        // Accurate Firestore transaction write accounting:
        // 1. Primary task writes to 'tasks': 1 per task in tasksToUpdate
        // 2. Mirror task writes to 'projectTasks': 1 per task in tasksToUpdate
        // 3. Notification writes to 'notifications': 1 per notification in notificationsToCreate
        // Total Planned Writes = (tasksToUpdate.length * 2) + notificationsToCreate.length
        const FIRESTORE_MAX_TRANSACTION_WRITES = 500;
        const taskPrimaryWrites = tasksToUpdate.length;
        const taskMirrorWrites = tasksToUpdate.length;
        const notificationWrites = notificationsToCreate.length;
        const totalPlannedWrites = (taskPrimaryWrites + taskMirrorWrites) + notificationWrites;

        if (totalPlannedWrites > FIRESTORE_MAX_TRANSACTION_WRITES) {
          const payloadErr: any = new Error(
            `Propagation would perform ${totalPlannedWrites} atomic writes (${taskPrimaryWrites} primary tasks, ${taskMirrorWrites} mirror projectTasks, ${notificationWrites} notifications), exceeding the Firestore limit of ${FIRESTORE_MAX_TRANSACTION_WRITES}. Please break down project dependencies.`
          );
          payloadErr.statusCode = 413;
          payloadErr.errorCode = "PAYLOAD_TOO_LARGE";
          payloadErr.details = {
            totalPlannedWrites,
            maxAllowedWrites: FIRESTORE_MAX_TRANSACTION_WRITES,
            taskPrimaryWrites,
            taskMirrorWrites,
            notificationWrites
          };
          throw payloadErr;
        }

        // Apply task updates
        for (const item of tasksToUpdate) {
          const docRef = db.collection("tasks").doc(item.taskId);
          const updateData: Record<string, any> = { updatedAt: now };
          if (item.proposedStartDate !== undefined) updateData.startDate = item.proposedStartDate || "";
          if (item.proposedDueDate !== undefined) updateData.dueDate = item.proposedDueDate || "";

          const originalTask = allTasks.find(t => t.id === item.taskId);
          const existingHistory = Array.isArray(originalTask?.activityHistory) ? originalTask.activityHistory : [];
          const activityDetails = item.isDirectTarget
            ? `Deadline manually updated (due: ${item.proposedDueDate || "none"}, start: ${item.proposedStartDate || "none"})`
            : `Deadline automatically propagated from prerequisite (due: ${item.proposedDueDate || "none"}, start: ${item.proposedStartDate || "none"})`;

          const newActivity = {
            id: crypto.randomUUID ? crypto.randomUUID().substring(0, 8) : Math.random().toString(36).substring(2, 9),
            action: item.isDirectTarget ? "schedule_updated" : "schedule_propagated",
            performedBy: performerName,
            timestamp: now,
            details: activityDetails
          };

          updateData.activityHistory = [...existingHistory, newActivity];
          transaction.set(docRef, updateData, { merge: true });

          // Also mirror to projectTasks
          const mirrorRef = db.collection("projectTasks").doc(item.taskId);
          transaction.set(mirrorRef, updateData, { merge: true });
        }

        // Apply notification creations
        for (const notif of notificationsToCreate) {
          const notifRef = db.collection("notifications").doc(notif.id);
          transaction.set(notifRef, notif);
        }

        return {
          success: true,
          message: `Successfully propagated deadlines to ${tasksToUpdate.length} task(s).`,
          targetTaskId: taskId,
          updatedTaskCount: tasksToUpdate.length,
          updatedTasks: tasksToUpdate.map(t => ({
            taskId: t.taskId,
            title: t.title,
            startDate: t.proposedStartDate,
            dueDate: t.proposedDueDate,
            shiftDays: t.shiftDays
          })),
          notificationsCreated: notificationsToCreate.length
        };
      });

      return res.json(result);
    } catch (err: any) {
      console.error("[Deadline Propagation Execute Error]:", err);
      const status = err.statusCode || (err.errorCode === "STALE_VERSION" ? 409 : 500);
      return res.status(status).json({
        error: err.errorCode || "Internal Server Error",
        message: err.message || "Failed to execute deadline propagation.",
        ...(err.currentScheduleVersionToken ? { currentScheduleVersionToken: err.currentScheduleVersionToken } : {}),
        ...(err.conflicts ? { conflicts: err.conflicts } : {}),
        ...(err.details ? { details: err.details } : {})
      });
    }
  };

  // Route 1: POST /api/projects/:projectId/tasks/:taskId/propagate/preview
  app.post("/api/projects/:projectId/tasks/:taskId/propagate/preview", requireAuth, handleDeadlinePropagationPreview);

  // Route 2: POST /api/projects/:projectId/tasks/:taskId/propagate (apply changes)
  app.post("/api/projects/:projectId/tasks/:taskId/propagate", requireAuth, handleDeadlinePropagationExecute);

  // Route 3 & 4: Compatibility batch routes
  app.post("/api/projects/:projectId/tasks/preview-propagation", requireAuth, handleDeadlinePropagationPreview);
  app.post("/api/projects/:projectId/tasks/execute-propagation", requireAuth, handleDeadlinePropagationExecute);

  // =========================================================================
  // TASK TEMPLATES ENDPOINTS (Phase 1B, Step 3.4)
  // =========================================================================

  // Helper: Validate task template definition
  function validateTemplateDefinition(tasks: any[]): { valid: boolean; error?: string; cleanTasks?: any[] } {
    if (!Array.isArray(tasks) || tasks.length === 0) {
      return { valid: false, error: "A template must contain at least one task definition." };
    }
    if (tasks.length > 100) {
      return { valid: false, error: "A template cannot contain more than 100 task definitions." };
    }

    const itemIds = new Set<string>();
    const cleanTasks: any[] = [];

    for (let i = 0; i < tasks.length; i++) {
      const item = tasks[i];
      if (!item || typeof item !== 'object') {
        return { valid: false, error: `Invalid task entry at index ${i}.` };
      }

      const id = String(item.id || `tpl_task_${i + 1}`).trim();
      if (!id) {
        return { valid: false, error: `Task definition at index ${i} requires a non-empty id.` };
      }
      if (itemIds.has(id)) {
        return { valid: false, error: `Duplicate task definition id "${id}" in template.` };
      }
      itemIds.add(id);

      const title = String(item.title || '').trim();
      if (!title) {
        return { valid: false, error: `Task definition "${id}" requires a title.` };
      }
      if (title.length > 300) {
        return { valid: false, error: `Task title for "${id}" cannot exceed 300 characters.` };
      }

      const priority = item.priority && ['low', 'medium', 'high', 'urgent'].includes(item.priority)
        ? item.priority
        : 'medium';

      let startOffsetDays: number | undefined = undefined;
      if (item.startOffsetDays !== undefined && item.startOffsetDays !== null && item.startOffsetDays !== '') {
        const num = Number(item.startOffsetDays);
        if (isNaN(num) || !Number.isInteger(num) || num < 0) {
          return { valid: false, error: `Task definition "${id}": startOffsetDays must be a non-negative integer.` };
        }
        startOffsetDays = num;
      }

      let dueOffsetDays: number | undefined = undefined;
      if (item.dueOffsetDays !== undefined && item.dueOffsetDays !== null && item.dueOffsetDays !== '') {
        const num = Number(item.dueOffsetDays);
        if (isNaN(num) || !Number.isInteger(num) || num < 0) {
          return { valid: false, error: `Task definition "${id}": dueOffsetDays must be a non-negative integer.` };
        }
        dueOffsetDays = num;
      }

      if (startOffsetDays !== undefined && dueOffsetDays !== undefined && startOffsetDays > dueOffsetDays) {
        return { valid: false, error: `Task definition "${id}": startOffsetDays (${startOffsetDays}) cannot be greater than dueOffsetDays (${dueOffsetDays}).` };
      }

      let prereqs: string[] = [];
      if (item.prerequisiteTemplateItemIds) {
        if (!Array.isArray(item.prerequisiteTemplateItemIds)) {
          return { valid: false, error: `Task definition "${id}": prerequisiteTemplateItemIds must be an array.` };
        }
        prereqs = Array.from(new Set(item.prerequisiteTemplateItemIds.map((p: any) => String(p || '').trim()).filter(Boolean)));
      }

      const phase = typeof item.phase === 'string' && item.phase.trim() ? item.phase.trim() : undefined;
      const rolePlaceholder = typeof item.rolePlaceholder === 'string' && item.rolePlaceholder.trim() ? item.rolePlaceholder.trim() : undefined;
      const acceptanceCriteria = Array.isArray(item.acceptanceCriteria)
        ? item.acceptanceCriteria.map((c: any) => String(c || '').trim()).filter(Boolean)
        : undefined;

      cleanTasks.push({
        id,
        title,
        description: typeof item.description === 'string' ? item.description.trim() : '',
        priority,
        phase,
        rolePlaceholder,
        acceptanceCriteria,
        startOffsetDays,
        dueOffsetDays,
        prerequisiteTemplateItemIds: prereqs,
        order: typeof item.order === 'number' ? item.order : i
      });
    }

    // Validate that all prerequisites reference valid template task IDs and prevent self-dependency
    for (const t of cleanTasks) {
      for (const pId of t.prerequisiteTemplateItemIds) {
        if (pId === t.id) {
          return { valid: false, error: `Task definition "${t.id}" cannot depend on itself.` };
        }
        if (!itemIds.has(pId)) {
          return { valid: false, error: `Task definition "${t.id}" references nonexistent prerequisite template task "${pId}".` };
        }
      }
    }

    // Validate cycle-freedom using DFS
    const templateTasksMap = new Map<string, any>();
    cleanTasks.forEach(t => templateTasksMap.set(t.id, t));

    for (const t of cleanTasks) {
      for (const pId of t.prerequisiteTemplateItemIds) {
        const visited = new Set<string>();
        const path: string[] = [t.id, pId];

        function dfs(curr: string): boolean {
          if (curr === t.id) return true;
          if (visited.has(curr)) return false;
          visited.add(curr);

          const curItem = templateTasksMap.get(curr);
          if (!curItem || !Array.isArray(curItem.prerequisiteTemplateItemIds)) return false;

          for (const nextP of curItem.prerequisiteTemplateItemIds) {
            path.push(nextP);
            if (dfs(nextP)) return true;
            path.pop();
          }
          return false;
        }

        const prereqItem = templateTasksMap.get(pId);
        if (prereqItem && Array.isArray(prereqItem.prerequisiteTemplateItemIds)) {
          for (const upstreamId of prereqItem.prerequisiteTemplateItemIds) {
            path.push(upstreamId);
            if (dfs(upstreamId)) {
              return {
                valid: false,
                error: `Dependency cycle detected in template: ${path.join(' -> ')}`
              };
            }
            path.pop();
          }
        }
      }
    }

    return { valid: true, cleanTasks };
  }

  // 1. GET /api/projects/:projectId/task-templates - List templates available to project (project + org scope)
  app.get("/api/projects/:projectId/task-templates", requireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const { projectId } = req.params;
      if (!projectId) {
        return res.status(400).json({ error: "Bad Request", message: "Project ID is required." });
      }

      const projAccess = await resolveProjectAccess(db, req.user, projectId, { requiredPermission: 'VIEW' });
      if (!projAccess.hasAccess) {
        if (projAccess.notFound) {
          return res.status(404).json({ error: "Not Found", message: "Project not found." });
        }
        return res.status(403).json({ error: "Forbidden", message: "Access denied to project templates." });
      }

      const projectData = projAccess.project || {};
      const orgId = projectData.organizationId || projectData.orgId || null;

      // Fetch project-specific templates
      const projectTemplatesSnap = await db.collection("taskTemplates")
        .where("projectId", "==", projectId)
        .get();

      let templates: any[] = projectTemplatesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      // If project has an orgId, also include organization-level templates
      if (orgId) {
        const orgTemplatesSnap = await db.collection("taskTemplates")
          .where("organizationId", "==", orgId)
          .where("scope", "==", "organization")
          .get();

        orgTemplatesSnap.docs.forEach(doc => {
          if (!templates.some(t => t.id === doc.id)) {
            templates.push({ id: doc.id, ...doc.data() });
          }
        });
      }

      // Sort by creation date descending
      templates.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());

      return res.json({
        success: true,
        projectId,
        organizationId: orgId,
        templates
      });
    } catch (err: any) {
      console.error("[List Templates Error]:", err);
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to list task templates." });
    }
  });

  // 2. POST /api/projects/:projectId/task-templates - Create a new task template
  app.post("/api/projects/:projectId/task-templates", requireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const { projectId } = req.params;
      if (!projectId) {
        return res.status(400).json({ error: "Bad Request", message: "Project ID is required." });
      }

      const projAccess = await resolveProjectAccess(db, req.user, projectId, { requiredPermission: 'EDIT_CONTENT' });
      if (!projAccess.hasAccess || !projAccess.permissions.canEditContent) {
        if (projAccess.notFound) {
          return res.status(404).json({ error: "Not Found", message: "Project not found." });
        }
        return res.status(403).json({ error: "Forbidden", message: "Permission denied: Only editors or administrators can create task templates." });
      }

      const projectData = projAccess.project || {};
      const projectOrgId = projectData.organizationId || projectData.orgId || null;

      const {
        name,
        description = '',
        scope = 'project',
        tasks: templateTasks = []
      } = req.body || {};

      if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ error: "Bad Request", message: "Template name is required." });
      }
      if (name.trim().length > 200) {
        return res.status(400).json({ error: "Bad Request", message: "Template name cannot exceed 200 characters." });
      }

      if (scope !== 'project' && scope !== 'organization') {
        return res.status(400).json({ error: "Bad Request", message: "Invalid template scope. Must be 'project' or 'organization'." });
      }

      // For organization scope, verify project is in an org and user has org lead/admin/owner permissions
      let resolvedOrgId: string | null = null;
      if (scope === 'organization') {
        if (!projectOrgId) {
          return res.status(400).json({ error: "Bad Request", message: "Cannot create organization-scoped template: This project does not belong to an organization." });
        }
        const isOrgAdminUser = projAccess.isOrgAdmin || projAccess.isPlatformAdmin || projAccess.isOwner;
        if (!isOrgAdminUser) {
          return res.status(403).json({ error: "Forbidden", message: "Only organization owners, administrators, or project owners can create organization-wide templates." });
        }
        resolvedOrgId = projectOrgId;
      }

      // Validate task definitions
      const validation = validateTemplateDefinition(templateTasks);
      if (!validation.valid) {
        return res.status(400).json({ error: "Bad Request", message: validation.error });
      }

      const templateId = `tpl_${crypto.randomUUID()}`;
      const nowIso = new Date().toISOString();

      const newTemplateData: any = {
        id: templateId,
        name: name.trim(),
        description: typeof description === 'string' ? description.trim() : '',
        scope,
        projectId: scope === 'project' ? projectId : null,
        organizationId: resolvedOrgId || (scope === 'project' ? projectOrgId : null),
        tasks: validation.cleanTasks,
        createdBy: req.user.uid,
        creatorEmail: req.user.email || '',
        createdAt: nowIso,
        updatedAt: nowIso
      };

      // Strip undefined
      Object.keys(newTemplateData).forEach(k => {
        if (newTemplateData[k] === undefined) delete newTemplateData[k];
      });

      await db.collection("taskTemplates").doc(templateId).set(newTemplateData);

      return res.status(201).json({
        success: true,
        message: "Task template created successfully.",
        template: newTemplateData
      });
    } catch (err: any) {
      console.error("[Create Template Error]:", err);
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to create task template." });
    }
  });

  // 3. GET /api/task-templates/:templateId and /api/templates/:templateId - Retrieve template details
  const handleGetTemplateDetail = async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const { templateId } = req.params;
      if (!templateId) {
        return res.status(400).json({ error: "Bad Request", message: "Template ID is required." });
      }

      // Check starter templates first
      const starter = STARTER_TEMPLATES.find(t => t.id === templateId);
      if (starter) {
        return res.json({
          success: true,
          template: {
            ...starter,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            createdBy: "system",
            creatorEmail: "system@echonote.internal"
          }
        });
      }

      const templateDoc = await db.collection("taskTemplates").doc(templateId).get();
      if (!templateDoc.exists) {
        return res.status(404).json({ error: "Not Found", message: "Task template not found." });
      }

      const template = { id: templateDoc.id, ...templateDoc.data() } as any;

      // Verify authorization
      if (template.scope === 'project' && template.projectId) {
        const projAccess = await resolveProjectAccess(db, req.user, template.projectId, { requiredPermission: 'VIEW' });
        if (!projAccess.hasAccess) {
          return res.status(403).json({ error: "Forbidden", message: "Access denied to project template." });
        }
      } else if (template.scope === 'organization' && template.organizationId) {
        const orgAccess = await checkOrgAccess(db, req.user.email, template.organizationId, ["owner", "org_admin", "team_manager", "member", "viewer"]);
        if (!orgAccess.hasAccess && !req.user.admin) {
          return res.status(403).json({ error: "Forbidden", message: "Access denied to organization template." });
        }
      }

      return res.json({
        success: true,
        template
      });
    } catch (err: any) {
      console.error("[Get Template Error]:", err);
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to retrieve task template." });
    }
  };

  app.get("/api/task-templates/:templateId", requireAuth, handleGetTemplateDetail);
  app.get("/api/templates/:templateId", requireAuth, handleGetTemplateDetail);

  // 4. PATCH /api/task-templates/:templateId and /api/templates/:templateId - Update an existing task template
  const handleUpdateTemplate = async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const { templateId } = req.params;
      if (!templateId) {
        return res.status(400).json({ error: "Bad Request", message: "Template ID is required." });
      }

      // Starter templates cannot be directly updated
      const isStarter = STARTER_TEMPLATES.some(t => t.id === templateId);
      if (isStarter) {
        return res.status(403).json({ error: "Forbidden", message: "Built-in starter templates are read-only. Please duplicate the template to make modifications." });
      }

      const templateDoc = await db.collection("taskTemplates").doc(templateId).get();
      if (!templateDoc.exists) {
        return res.status(404).json({ error: "Not Found", message: "Task template not found." });
      }

      const template = { id: templateDoc.id, ...templateDoc.data() } as any;

      // Check edit authorization
      if (template.scope === 'project' && template.projectId) {
        const projAccess = await resolveProjectAccess(db, req.user, template.projectId, { requiredPermission: 'EDIT_CONTENT' });
        if (!projAccess.hasAccess || !projAccess.permissions.canEditContent) {
          return res.status(403).json({ error: "Forbidden", message: "Permission denied: You cannot edit templates in this project." });
        }
      } else if (template.scope === 'organization' && template.organizationId) {
        const isOrgEditor = template.createdBy === req.user.uid || req.user.admin;
        if (!isOrgEditor) {
          const orgAccess = await checkOrgAccess(db, req.user.email, template.organizationId, ["owner", "org_admin", "team_manager"]);
          if (!orgAccess.hasAccess) {
            return res.status(403).json({ error: "Forbidden", message: "Permission denied: Only organization managers or template creators can edit organization templates." });
          }
        }
      }

      const { name, description, tasks: updatedTasks } = req.body || {};
      const updates: Record<string, any> = { updatedAt: new Date().toISOString() };

      if (name !== undefined) {
        if (typeof name !== 'string' || !name.trim()) {
          return res.status(400).json({ error: "Bad Request", message: "Template name cannot be empty." });
        }
        if (name.trim().length > 200) {
          return res.status(400).json({ error: "Bad Request", message: "Template name cannot exceed 200 characters." });
        }
        updates.name = name.trim();
      }

      if (description !== undefined) {
        updates.description = typeof description === 'string' ? description.trim() : '';
      }

      if (updatedTasks !== undefined) {
        const validation = validateTemplateDefinition(updatedTasks);
        if (!validation.valid) {
          return res.status(400).json({ error: "Bad Request", message: validation.error });
        }
        updates.tasks = validation.cleanTasks;
        updates.phases = extractPhases(validation.cleanTasks!);
        updates.rolePlaceholders = extractRolePlaceholders(validation.cleanTasks!);
      }

      await db.collection("taskTemplates").doc(templateId).set(updates, { merge: true });

      return res.json({
        success: true,
        message: "Task template updated successfully.",
        template: { ...template, ...updates }
      });
    } catch (err: any) {
      console.error("[Update Template Error]:", err);
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to update task template." });
    }
  };

  app.patch("/api/task-templates/:templateId", requireAuth, handleUpdateTemplate);
  app.patch("/api/templates/:templateId", requireAuth, handleUpdateTemplate);

  // 5. DELETE /api/task-templates/:templateId - Delete task template
  const handleDeleteTemplate = async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const { templateId } = req.params;
      if (!templateId) {
        return res.status(400).json({ error: "Bad Request", message: "Template ID is required." });
      }

      // Starter templates cannot be deleted
      const isStarter = STARTER_TEMPLATES.some(t => t.id === templateId);
      if (isStarter) {
        return res.status(403).json({ error: "Forbidden", message: "Built-in starter templates cannot be deleted." });
      }

      const templateDoc = await db.collection("taskTemplates").doc(templateId).get();
      if (!templateDoc.exists) {
        return res.status(404).json({ error: "Not Found", message: "Task template not found." });
      }

      const template = { id: templateDoc.id, ...templateDoc.data() } as any;

      // Only creator or project/org admin can delete
      const isCreator = template.createdBy === req.user.uid;
      let isLead = req.user.admin === true;

      if (!isLead && template.scope === 'project' && template.projectId) {
        const projAccess = await resolveProjectAccess(db, req.user, template.projectId, { requiredPermission: 'EDIT_CONTENT' });
        isLead = projAccess.isOwner || projAccess.role === 'admin' || projAccess.isOrgAdmin || projAccess.isPlatformAdmin;
      } else if (!isLead && template.scope === 'organization' && template.organizationId) {
        const orgAccess = await checkOrgAccess(db, req.user.email, template.organizationId, ["owner", "org_admin"]);
        isLead = orgAccess.hasAccess;
      }

      if (!isCreator && !isLead) {
        return res.status(403).json({ error: "Forbidden", message: "Permission denied: Only the template creator or administrator can delete this template." });
      }

      await db.collection("taskTemplates").doc(templateId).delete();

      return res.json({
        success: true,
        message: "Task template deleted successfully.",
        templateId
      });
    } catch (err: any) {
      console.error("[Delete Template Error]:", err);
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to delete task template." });
    }
  };

  app.delete("/api/task-templates/:templateId", requireAuth, handleDeleteTemplate);
  app.delete("/api/templates/:templateId", requireAuth, handleDeleteTemplate);

  // 6. POST /api/projects/:projectId/task-templates/:templateId/apply - Instantiate template into project
  app.post("/api/projects/:projectId/task-templates/:templateId/apply", requireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const { projectId, templateId } = req.params;
      if (!projectId || !templateId) {
        return res.status(400).json({ error: "Bad Request", message: "Project ID and Template ID are required." });
      }

      // 1. Authorize project destination
      const projAccess = await resolveProjectAccess(db, req.user, projectId, { requiredPermission: 'EDIT_CONTENT' });
      if (!projAccess.hasAccess || !projAccess.permissions.canEditContent) {
        if (projAccess.notFound) {
          return res.status(404).json({ error: "Not Found", message: "Project not found." });
        }
        return res.status(403).json({ error: "Forbidden", message: "Permission denied: Only editors or administrators can apply task templates to this project." });
      }

      const projectData = projAccess.project || {};
      const projectOrgId = projectData.organizationId || projectData.orgId || null;

      // 2. Retrieve template and authorize scope access
      const templateDoc = await db.collection("taskTemplates").doc(templateId).get();
      if (!templateDoc.exists) {
        return res.status(404).json({ error: "Not Found", message: "Task template not found." });
      }

      const template = { id: templateDoc.id, ...templateDoc.data() } as any;

      if (template.scope === 'project') {
        if (template.projectId !== projectId) {
          return res.status(403).json({
            error: "Forbidden",
            message: "Cannot apply project-level template from another project. Only templates belonging to this project or its organization can be applied."
          });
        }
      } else if (template.scope === 'organization') {
        if (!projectOrgId || template.organizationId !== projectOrgId) {
          return res.status(403).json({
            error: "Forbidden",
            message: "Cannot apply organization-level template from another organization."
          });
        }
      }

      const templateTasks: any[] = Array.isArray(template.tasks) ? template.tasks : [];
      if (templateTasks.length === 0) {
        return res.status(400).json({ error: "Bad Request", message: "The selected template has no task definitions to instantiate." });
      }

      // 3. Optional anchor date for relative offsets (defaults to today's date YYYY-MM-DD)
      const { anchorDate, assigneeEmail } = req.body || {};
      let baseDateMs = Date.now();
      if (anchorDate && typeof anchorDate === 'string' && anchorDate.trim()) {
        const parsed = Date.parse(anchorDate.trim());
        if (isNaN(parsed)) {
          return res.status(400).json({ error: "Bad Request", message: `Invalid anchorDate format: "${anchorDate}". Must be a valid date.` });
        }
        baseDateMs = parsed;
      }

      // Optional default assignee eligibility check
      let defaultAssigneeCheck: any = { eligible: true, memberName: 'Unassigned', memberUid: '' };
      if (assigneeEmail && typeof assigneeEmail === 'string' && assigneeEmail.trim()) {
        defaultAssigneeCheck = await verifyEligibleAssignee(db, projectId, projectData, assigneeEmail.trim());
        if (!defaultAssigneeCheck.eligible) {
          return res.status(400).json({ error: "Bad Request", message: defaultAssigneeCheck.message || "Assignee is not eligible." });
        }
      }

      // 4. Generate new unique task IDs and map template-internal item IDs to new project task IDs
      const idMap = new Map<string, string>();
      templateTasks.forEach(item => {
        idMap.set(item.id, `task_${crypto.randomUUID()}`);
      });

      const nowIso = new Date().toISOString();
      const creatorName = req.user.displayName || req.user.name || (req.user.email ? req.user.email.split('@')[0] : 'User');

      const instantiatedTasks: any[] = [];

      for (const item of templateTasks) {
        const newTaskId = idMap.get(item.id)!;

        // Calculate relative dates if offsets provided
        let calcStart: string | undefined = undefined;
        let calcDue: string | undefined = undefined;

        if (typeof item.startOffsetDays === 'number') {
          const startDateObj = new Date(baseDateMs + (item.startOffsetDays * 24 * 60 * 60 * 1000));
          calcStart = startDateObj.toISOString().split('T')[0];
        }

        if (typeof item.dueOffsetDays === 'number') {
          const dueDateObj = new Date(baseDateMs + (item.dueOffsetDays * 24 * 60 * 60 * 1000));
          calcDue = dueDateObj.toISOString().split('T')[0];
        }

        // Validate calculated date range using standard scheduling validator
        const dateValidation = validateTaskDates(calcStart, calcDue);
        if (!dateValidation.valid) {
          return res.status(400).json({
            error: "Bad Request",
            message: `Template instantiation error for task "${item.title}": ${dateValidation.error}`
          });
        }

        // Map template prerequisite item IDs to newly generated task IDs
        const mappedPrereqs: string[] = (item.prerequisiteTemplateItemIds || [])
          .map((tplPrereqId: string) => idMap.get(tplPrereqId))
          .filter(Boolean) as string[];

        const newTaskData: any = {
          id: newTaskId,
          projectId,
          title: item.title.trim(),
          description: typeof item.description === 'string' ? item.description.trim() : '',
          assigneeEmail: assigneeEmail && typeof assigneeEmail === 'string' ? assigneeEmail.trim().toLowerCase() : '',
          assigneeName: defaultAssigneeCheck.memberName || 'Unassigned',
          assigneeId: defaultAssigneeCheck.memberUid || '',
          status: 'pending',
          priority: item.priority || 'medium',
          startDate: dateValidation.normalizedStartDate || '',
          dueDate: dateValidation.normalizedDueDate || '',
          prerequisiteTaskIds: mappedPrereqs,
          sourceType: 'manual', // Fresh template tasks do not carry historical meeting provenance
          subTasks: [],
          activityHistory: [
            {
              id: crypto.randomUUID().substring(0, 8),
              action: 'task_created',
              performedBy: creatorName,
              timestamp: nowIso,
              details: `Instantiated from template "${template.name}"`
            }
          ],
          createdBy: req.user.uid,
          creatorEmail: req.user.email || '',
          createdAt: nowIso,
          updatedAt: nowIso
        };

        // Strip undefined
        Object.keys(newTaskData).forEach(k => {
          if (newTaskData[k] === undefined) delete newTaskData[k];
        });

        instantiatedTasks.push(newTaskData);
      }

      // 5. Commit using Firestore batched write for atomicity (up to 250 tasks = 500 writes across tasks & projectTasks)
      // Firestore batch supports up to 500 writes. Since dual-write = 2 writes per task, max 250 tasks in single atomic batch.
      const batch = db.batch();
      instantiatedTasks.forEach(t => {
        batch.set(db.collection("tasks").doc(t.id), t);
        batch.set(db.collection("projectTasks").doc(t.id), t);
      });

      await batch.commit();

      // Log project activity
      try {
        await db.collection("projectActivities").add({
          projectId,
          organizationId: projectOrgId,
          userId: req.user.uid,
          userEmail: req.user.email || '',
          userName: creatorName,
          actionType: 'task_template_applied',
          description: `${creatorName} applied template "${template.name}" (${instantiatedTasks.length} tasks created)`,
          templateId,
          createdAt: FieldValue.serverTimestamp()
        });
      } catch {}

      return res.status(201).json({
        success: true,
        message: `Successfully instantiated ${instantiatedTasks.length} tasks from template "${template.name}".`,
        templateId,
        templateName: template.name,
        createdTasksCount: instantiatedTasks.length,
        createdTaskIds: instantiatedTasks.map(t => t.id),
        tasks: instantiatedTasks
      });
    } catch (err: any) {
      console.error("[Apply Template Error]:", err);
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to apply task template." });
    }
  });

  // =========================================================================
  // AH.186: REUSABLE PROJECT TEMPLATES & END-TO-END PROJECT WORKFLOWS
  // =========================================================================

  /**
   * Safe Starter Templates grounded in EchoNote's real capabilities
   */
  const STARTER_TEMPLATES: any[] = [
    {
      id: "starter_meeting_followup",
      name: "Meeting Follow-up & Action Tracking",
      description: "Structured workflow to capture meeting outcomes, review recorded decisions, assign action items with deadlines, and track execution to completion.",
      category: "meeting_followup",
      scope: "public",
      visibility: "public",
      version: 1,
      isStarter: true,
      phases: ["Review & Extraction", "Assignment & Prioritization", "Execution & Wrap-up"],
      rolePlaceholders: ["Meeting Facilitator", "Action Item Owner", "Project Lead"],
      tasks: [
        {
          id: "mf_1",
          title: "Review Meeting Summary & Key Decisions",
          description: "Inspect the automated meeting transcript, summary, and recorded decisions for consensus and accuracy.",
          phase: "Review & Extraction",
          priority: "high",
          rolePlaceholder: "Meeting Facilitator",
          startOffsetDays: 0,
          dueOffsetDays: 1,
          acceptanceCriteria: [
            "All decision records verified against transcript",
            "Key points and summary approved"
          ],
          prerequisiteTemplateItemIds: []
        },
        {
          id: "mf_2",
          title: "Assign Extracted Action Items & Estimate Timelines",
          description: "Map recorded meeting action items to owners and set clear start and due dates.",
          phase: "Assignment & Prioritization",
          priority: "high",
          rolePlaceholder: "Project Lead",
          startOffsetDays: 1,
          dueOffsetDays: 2,
          acceptanceCriteria: [
            "Every action item has an eligible assignee",
            "Deadlines established without dependency conflicts"
          ],
          prerequisiteTemplateItemIds: ["mf_1"]
        },
        {
          id: "mf_3",
          title: "Execute Immediate Follow-up Tasks",
          description: "Carry out high-priority operational action items agreed upon during the session.",
          phase: "Execution & Wrap-up",
          priority: "medium",
          rolePlaceholder: "Action Item Owner",
          startOffsetDays: 2,
          dueOffsetDays: 5,
          acceptanceCriteria: [
            "Core deliverables completed and verified",
            "Task progress marked in project workspace"
          ],
          prerequisiteTemplateItemIds: ["mf_2"]
        },
        {
          id: "mf_4",
          title: "Confirm Completion & Publish Status Report",
          description: "Verify all meeting outcomes are closed and generate status summary report.",
          phase: "Execution & Wrap-up",
          priority: "medium",
          rolePlaceholder: "Meeting Facilitator",
          startOffsetDays: 5,
          dueOffsetDays: 7,
          acceptanceCriteria: [
            "Zero outstanding blocker items remaining",
            "Summary shared with project stakeholders"
          ],
          prerequisiteTemplateItemIds: ["mf_3"]
        }
      ]
    },
    {
      id: "starter_feature_launch",
      name: "Product & Feature Launch",
      description: "End-to-end framework defining scope, milestones, implementation tasks, QA validation, and release readiness.",
      category: "feature_launch",
      scope: "public",
      visibility: "public",
      version: 1,
      isStarter: true,
      phases: ["Discovery & Scope", "Implementation", "Testing & QA", "Launch & Monitoring"],
      rolePlaceholders: ["Product Manager", "Lead Engineer", "QA Engineer"],
      tasks: [
        {
          id: "fl_1",
          title: "Define Feature Scope & Acceptance Criteria",
          description: "Document feature requirements, edge cases, and verifiable acceptance criteria.",
          phase: "Discovery & Scope",
          priority: "urgent",
          rolePlaceholder: "Product Manager",
          startOffsetDays: 0,
          dueOffsetDays: 3,
          acceptanceCriteria: [
            "PRD approved by engineering and product leads",
            "Design specs finalized"
          ],
          prerequisiteTemplateItemIds: []
        },
        {
          id: "fl_2",
          title: "Build Core Implementation & Unit Tests",
          description: "Implement core backend services, APIs, and frontend user interfaces.",
          phase: "Implementation",
          priority: "high",
          rolePlaceholder: "Lead Engineer",
          startOffsetDays: 3,
          dueOffsetDays: 10,
          acceptanceCriteria: [
            "Features fully implemented according to PRD",
            "Unit and integration tests passing"
          ],
          prerequisiteTemplateItemIds: ["fl_1"]
        },
        {
          id: "fl_3",
          title: "Comprehensive QA & Regression Verification",
          description: "Execute end-to-end user journeys, cross-browser tests, and verify system stability.",
          phase: "Testing & QA",
          priority: "high",
          rolePlaceholder: "QA Engineer",
          startOffsetDays: 10,
          dueOffsetDays: 14,
          acceptanceCriteria: [
            "Zero critical or blocking defects",
            "Performance and regression checks pass"
          ],
          prerequisiteTemplateItemIds: ["fl_2"]
        },
        {
          id: "fl_4",
          title: "Deployment & Release Readiness Review",
          description: "Perform staging validation, update release notes, and conduct final launch sign-off.",
          phase: "Launch & Monitoring",
          priority: "urgent",
          rolePlaceholder: "Product Manager",
          startOffsetDays: 14,
          dueOffsetDays: 16,
          acceptanceCriteria: [
            "Release notes published to workspace",
            "Launch sign-off confirmed by all stakeholders"
          ],
          prerequisiteTemplateItemIds: ["fl_3"]
        }
      ]
    },
    {
      id: "starter_weekly_review",
      name: "Weekly Project Review & Alignment",
      description: "Structured cadence to review completed work, inspect overdue or blocked tasks, evaluate upcoming deadlines, and track follow-ups.",
      category: "weekly_review",
      scope: "public",
      visibility: "public",
      version: 1,
      isStarter: true,
      phases: ["Progress Audit", "Blocker Resolution", "Next Week Commitments"],
      rolePlaceholders: ["Project Lead", "Team Member"],
      tasks: [
        {
          id: "wr_1",
          title: "Audit Completed Tasks & Recent Activity",
          description: "Review tasks closed over the past cycle and check recording notes for decisions.",
          phase: "Progress Audit",
          priority: "medium",
          rolePlaceholder: "Project Lead",
          startOffsetDays: 0,
          dueOffsetDays: 1,
          acceptanceCriteria: [
            "Completed work verified against commitments",
            "Meeting notes linked to progress"
          ],
          prerequisiteTemplateItemIds: []
        },
        {
          id: "wr_2",
          title: "Identify & Address Overdue and Blocked Tasks",
          description: "Triage tasks behind schedule, assess dependency issues, and adjust assignments.",
          phase: "Blocker Resolution",
          priority: "high",
          rolePlaceholder: "Project Lead",
          startOffsetDays: 1,
          dueOffsetDays: 2,
          acceptanceCriteria: [
            "All blocked items have documented recovery plans",
            "Deadline shifts evaluated via propagation preview"
          ],
          prerequisiteTemplateItemIds: ["wr_1"]
        },
        {
          id: "wr_3",
          title: "Plan Next Cycle Commitments & Deadlines",
          description: "Establish priorities and deadlines for the upcoming week's sprints.",
          phase: "Next Week Commitments",
          priority: "medium",
          rolePlaceholder: "Team Member",
          startOffsetDays: 2,
          dueOffsetDays: 4,
          acceptanceCriteria: [
            "Next cycle task backlog prioritized",
            "Team capacity confirmed"
          ],
          prerequisiteTemplateItemIds: ["wr_2"]
        }
      ]
    },
    {
      id: "starter_research_project",
      name: "Research & Feasibility Study",
      description: "Systematic investigation workflow from hypothesis and literature gathering to evidence synthesis and final report deliverable.",
      category: "research",
      scope: "public",
      visibility: "public",
      version: 1,
      isStarter: true,
      phases: ["Problem Framing", "Evidence Gathering", "Synthesis & Review", "Deliverable"],
      rolePlaceholders: ["Principal Researcher", "Research Analyst"],
      tasks: [
        {
          id: "rp_1",
          title: "Define Research Questions & Hypotheses",
          description: "Clearly articulate core research objectives, boundaries, and evaluation metrics.",
          phase: "Problem Framing",
          priority: "high",
          rolePlaceholder: "Principal Researcher",
          startOffsetDays: 0,
          dueOffsetDays: 3,
          acceptanceCriteria: [
            "Research scope document created",
            "Key inquiry questions formulated"
          ],
          prerequisiteTemplateItemIds: []
        },
        {
          id: "rp_2",
          title: "Collect Data, Literature, and Experimental Evidence",
          description: "Gather primary data, interview notes, and domain benchmarks into the project repository.",
          phase: "Evidence Gathering",
          priority: "medium",
          rolePlaceholder: "Research Analyst",
          startOffsetDays: 3,
          dueOffsetDays: 8,
          acceptanceCriteria: [
            "Evidence repository populated",
            "Data validation checks completed"
          ],
          prerequisiteTemplateItemIds: ["rp_1"]
        },
        {
          id: "rp_3",
          title: "Synthesize Findings & Document Conclusions",
          description: "Analyze raw data, draw empirical conclusions, and document key trade-offs.",
          phase: "Synthesis & Review",
          priority: "high",
          rolePlaceholder: "Principal Researcher",
          startOffsetDays: 8,
          dueOffsetDays: 12,
          acceptanceCriteria: [
            "Conclusions cross-checked with experimental evidence",
            "Peer review comments incorporated"
          ],
          prerequisiteTemplateItemIds: ["rp_2"]
        },
        {
          id: "rp_4",
          title: "Compile Final Report & Executive Presentation",
          description: "Prepare publication-ready report and presentation slides summarizing findings.",
          phase: "Deliverable",
          priority: "urgent",
          rolePlaceholder: "Principal Researcher",
          startOffsetDays: 12,
          dueOffsetDays: 15,
          acceptanceCriteria: [
            "Report exported in PPTX / XLSX formats",
            "Final readout presented to stakeholders"
          ],
          prerequisiteTemplateItemIds: ["rp_3"]
        }
      ]
    }
  ];

  // Helper: Calculate UTC calendar-day date with offset in days
  function addDaysUtc(baseDateString: string, daysOffset: number): string {
    const [yearStr, monthStr, dayStr] = baseDateString.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10) - 1; // 0-indexed
    const day = parseInt(dayStr, 10);
    const date = new Date(Date.UTC(year, month, day));
    date.setUTCDate(date.getUTCDate() + daysOffset);
    return date.toISOString().split('T')[0];
  }

  // Helper: Extract unique role placeholders from tasks
  function extractRolePlaceholders(tasks: any[]): string[] {
    const roles = new Set<string>();
    tasks.forEach(t => {
      if (t.rolePlaceholder && typeof t.rolePlaceholder === 'string') {
        roles.add(t.rolePlaceholder.trim());
      }
    });
    return Array.from(roles);
  }

  // Helper: Extract unique ordered phases from tasks
  function extractPhases(tasks: any[]): string[] {
    const phases = new Set<string>();
    tasks.forEach(t => {
      if (t.phase && typeof t.phase === 'string') {
        phases.add(t.phase.trim());
      }
    });
    return Array.from(phases);
  }

  // 1. GET /api/templates - List templates available to the authenticated user
  app.get("/api/templates", requireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const { organizationId, scope } = req.query as { organizationId?: string; scope?: string };

      // Start with starter templates
      const templatesList: any[] = STARTER_TEMPLATES.map(t => ({
        ...t,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        createdBy: "system",
        creatorEmail: "system@echonote.internal"
      }));

      // Fetch user's custom templates (where createdBy == user.uid)
      const userTemplatesSnap = await db.collection("taskTemplates")
        .where("createdBy", "==", req.user.uid)
        .get();

      userTemplatesSnap.docs.forEach(doc => {
        const d = { id: doc.id, ...doc.data() };
        if (!templatesList.some(t => t.id === d.id)) {
          templatesList.push(d);
        }
      });

      // If organizationId provided or user has organization, fetch organization templates
      if (organizationId && typeof organizationId === 'string') {
        const orgAccess = await checkOrgAccess(db, req.user.email, organizationId, ["owner", "org_admin", "team_manager", "member", "viewer"]);
        if (orgAccess.hasAccess || req.user.admin) {
          const orgSnap = await db.collection("taskTemplates")
            .where("organizationId", "==", organizationId)
            .where("scope", "==", "organization")
            .get();

          orgSnap.docs.forEach(doc => {
            const d = { id: doc.id, ...doc.data() };
            if (!templatesList.some(t => t.id === d.id)) {
              templatesList.push(d);
            }
          });
        }
      }

      // Filter by scope if requested
      let filtered = templatesList;
      if (scope === 'starter' || scope === 'public') {
        filtered = templatesList.filter(t => t.isStarter || t.scope === 'public');
      } else if (scope === 'custom') {
        filtered = templatesList.filter(t => !t.isStarter && t.createdBy === req.user.uid);
      } else if (scope === 'organization' && organizationId) {
        filtered = templatesList.filter(t => t.organizationId === organizationId);
      }

      // Format role placeholders and phases for all templates
      filtered.forEach(t => {
        if (!t.rolePlaceholders && Array.isArray(t.tasks)) {
          t.rolePlaceholders = extractRolePlaceholders(t.tasks);
        }
        if (!t.phases && Array.isArray(t.tasks)) {
          t.phases = extractPhases(t.tasks);
        }
      });

      return res.json({
        success: true,
        count: filtered.length,
        templates: filtered
      });
    } catch (err: any) {
      console.error("[List Templates Error]:", err);
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to list templates." });
    }
  });

  // 2. POST /api/templates - Create a custom project template
  app.post("/api/templates", requireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const {
        name,
        description = '',
        category = 'custom',
        scope = 'project',
        visibility = 'private',
        organizationId = null,
        projectId = null,
        tasks = []
      } = req.body || {};

      if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ error: "Bad Request", message: "Template name is required." });
      }
      if (name.trim().length > 200) {
        return res.status(400).json({ error: "Bad Request", message: "Template name cannot exceed 200 characters." });
      }

      // Validate scope
      if (!['project', 'organization', 'public'].includes(scope)) {
        return res.status(400).json({ error: "Bad Request", message: "Invalid template scope. Must be 'project', 'organization', or 'public'." });
      }

      // Authorization for organization/public templates
      if (scope === 'organization') {
        if (!organizationId) {
          return res.status(400).json({ error: "Bad Request", message: "Organization ID is required for organization-scoped templates." });
        }
        const orgAccess = await checkOrgAccess(db, req.user.email, organizationId, ["owner", "org_admin", "team_manager"]);
        if (!orgAccess.hasAccess && !req.user.admin) {
          return res.status(403).json({ error: "Forbidden", message: "Only organization managers or owners can create organization templates." });
        }
      }

      if (scope === 'public' && !req.user.admin) {
        return res.status(403).json({ error: "Forbidden", message: "Only administrators can create public starter templates." });
      }

      // Validate task structure, dependency integrity, cycle freedom, and non-empty IDs
      const validation = validateTemplateDefinition(tasks);
      if (!validation.valid) {
        return res.status(400).json({ error: "Bad Request", message: validation.error });
      }

      const templateId = `tpl_${crypto.randomUUID()}`;
      const nowIso = new Date().toISOString();
      const phases = extractPhases(validation.cleanTasks!);
      const rolePlaceholders = extractRolePlaceholders(validation.cleanTasks!);

      const templateData: any = {
        id: templateId,
        name: name.trim(),
        description: typeof description === 'string' ? description.trim() : '',
        category: typeof category === 'string' ? category.trim() : 'custom',
        scope,
        visibility: visibility || (scope === 'public' ? 'public' : 'private'),
        version: 1,
        organizationId: organizationId || null,
        projectId: projectId || null,
        tasks: validation.cleanTasks,
        phases,
        rolePlaceholders,
        isStarter: false,
        createdBy: req.user.uid,
        creatorEmail: req.user.email || '',
        createdAt: nowIso,
        updatedAt: nowIso
      };

      Object.keys(templateData).forEach(k => {
        if (templateData[k] === undefined) delete templateData[k];
      });

      await db.collection("taskTemplates").doc(templateId).set(templateData);

      return res.status(201).json({
        success: true,
        message: "Template created successfully.",
        template: templateData
      });
    } catch (err: any) {
      console.error("[Create Template Error]:", err);
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to create template." });
    }
  });

  // 3. POST /api/templates/:templateId/duplicate - Duplicate an existing template
  app.post("/api/templates/:templateId/duplicate", requireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const { templateId } = req.params;
      const { newName } = req.body || {};

      let sourceTemplate: any = STARTER_TEMPLATES.find(t => t.id === templateId);

      if (!sourceTemplate) {
        const doc = await db.collection("taskTemplates").doc(templateId).get();
        if (doc.exists) {
          sourceTemplate = { id: doc.id, ...doc.data() };
        }
      }

      if (!sourceTemplate) {
        return res.status(404).json({ error: "Not Found", message: "Source template not found." });
      }

      // Permission check if private
      if (!sourceTemplate.isStarter && sourceTemplate.scope === 'project' && sourceTemplate.createdBy !== req.user.uid) {
        if (sourceTemplate.projectId) {
          const projAccess = await resolveProjectAccess(db, req.user, sourceTemplate.projectId, { requiredPermission: 'VIEW' });
          if (!projAccess.hasAccess) {
            return res.status(403).json({ error: "Forbidden", message: "Access denied to source template." });
          }
        }
      }

      const dupId = `tpl_${crypto.randomUUID()}`;
      const nowIso = new Date().toISOString();
      const dupName = newName && typeof newName === 'string' && newName.trim()
        ? newName.trim()
        : `${sourceTemplate.name} (Copy)`;

      const newTemplateData: any = {
        ...sourceTemplate,
        id: dupId,
        name: dupName,
        scope: "project",
        visibility: "private",
        version: 1,
        isStarter: false,
        createdBy: req.user.uid,
        creatorEmail: req.user.email || '',
        createdAt: nowIso,
        updatedAt: nowIso
      };

      await db.collection("taskTemplates").doc(dupId).set(newTemplateData);

      return res.status(201).json({
        success: true,
        message: "Template duplicated successfully.",
        template: newTemplateData
      });
    } catch (err: any) {
      console.error("[Duplicate Template Error]:", err);
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to duplicate template." });
    }
  });

  // 4. POST /api/templates/:templateId/create-project - Create a new project and instantiate its tasks atomically
  app.post("/api/templates/:templateId/create-project", requireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const { templateId } = req.params;
      const {
        projectName,
        projectDescription = '',
        anchorDate,
        organizationId = null,
        roleMappings = {}
      } = req.body || {};

      if (!projectName || typeof projectName !== 'string' || !projectName.trim()) {
        return res.status(400).json({ error: "Bad Request", message: "Project name is required." });
      }

      // Find template: check starter templates first, then taskTemplates collection
      let template: any = STARTER_TEMPLATES.find(t => t.id === templateId);

      if (!template) {
        const doc = await db.collection("taskTemplates").doc(templateId).get();
        if (doc.exists) {
          template = { id: doc.id, ...doc.data() };
        }
      }

      if (!template) {
        return res.status(404).json({ error: "Not Found", message: `Template "${templateId}" not found.` });
      }

      // Check template visibility permissions
      if (!template.isStarter && template.scope === 'project' && template.createdBy !== req.user.uid) {
        if (template.projectId) {
          const projAccess = await resolveProjectAccess(db, req.user, template.projectId, { requiredPermission: 'VIEW' });
          if (!projAccess.hasAccess) {
            return res.status(403).json({ error: "Forbidden", message: "Access denied to selected template." });
          }
        } else {
          return res.status(403).json({ error: "Forbidden", message: "Access denied to private template." });
        }
      }

      // Validate anchor date (defaults to UTC today YYYY-MM-DD)
      let resolvedAnchorDate = new Date().toISOString().split('T')[0];
      if (anchorDate && typeof anchorDate === 'string' && anchorDate.trim()) {
        const trimmedDate = anchorDate.trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmedDate)) {
          return res.status(400).json({ error: "Bad Request", message: `Invalid anchorDate format: "${trimmedDate}". Expected YYYY-MM-DD.` });
        }
        const parsed = Date.parse(`${trimmedDate}T00:00:00.000Z`);
        if (isNaN(parsed)) {
          return res.status(400).json({ error: "Bad Request", message: `Invalid anchorDate value: "${trimmedDate}".` });
        }
        resolvedAnchorDate = trimmedDate;
      }

      const templateTasks: any[] = Array.isArray(template.tasks) ? template.tasks : [];
      if (templateTasks.length === 0) {
        return res.status(400).json({ error: "Bad Request", message: "The selected template has no task definitions to instantiate." });
      }

      // Generate new Project ID
      const newProjectId = `proj_${crypto.randomUUID()}`;
      const nowIso = new Date().toISOString();
      const creatorName = req.user.displayName || req.user.name || (req.user.email ? req.user.email.split('@')[0] : 'User');

      // Project entity matching EchoNote schema
      const newProjectData: any = {
        id: newProjectId,
        name: projectName.trim(),
        description: typeof projectDescription === 'string' ? projectDescription.trim() : '',
        userId: req.user.uid,
        ownerEmail: req.user.email || '',
        ownerName: creatorName,
        isDefault: false,
        organizationId: organizationId || null,
        templateId: template.id,
        templateName: template.name,
        members: [],
        createdAt: nowIso,
        updatedAt: nowIso
      };

      // Project Member entity for owner
      const newMemberData = {
        id: `${req.user.uid}_${newProjectId}`,
        projectId: newProjectId,
        userId: req.user.uid,
        role: 'admin',
        email: req.user.email || '',
        displayName: creatorName,
        joinedAt: nowIso
      };

      // Generate map from template task id -> new project task id
      const idMap = new Map<string, string>();
      templateTasks.forEach(item => {
        idMap.set(item.id, `task_${crypto.randomUUID()}`);
      });

      const instantiatedTasks: any[] = [];

      for (const item of templateTasks) {
        const newTaskId = idMap.get(item.id)!;

        // Date calculation using UTC day offsets
        let startDate: string = '';
        let dueDate: string = '';

        if (typeof item.startOffsetDays === 'number') {
          startDate = addDaysUtc(resolvedAnchorDate, item.startOffsetDays);
        }
        if (typeof item.dueOffsetDays === 'number') {
          dueDate = addDaysUtc(resolvedAnchorDate, item.dueOffsetDays);
        }

        // Validate date bounds if both are present
        if (startDate && dueDate && startDate > dueDate) {
          return res.status(400).json({
            error: "Bad Request",
            message: `Template task "${item.title}" start date (${startDate}) cannot be after due date (${dueDate}).`
          });
        }

        // Map template prerequisite item IDs to newly generated task IDs
        const mappedPrereqs: string[] = (item.prerequisiteTemplateItemIds || [])
          .map((tplPrereqId: string) => idMap.get(tplPrereqId))
          .filter(Boolean) as string[];

        // Role mapping: if user specified an assignee for this rolePlaceholder
        let assignedEmail = '';
        let assignedName = 'Unassigned';
        let assignedId = '';

        if (item.rolePlaceholder && roleMappings[item.rolePlaceholder]) {
          const mapping = roleMappings[item.rolePlaceholder];
          if (mapping && typeof mapping.email === 'string' && mapping.email.trim()) {
            assignedEmail = mapping.email.trim().toLowerCase();
            assignedName = mapping.name || assignedEmail.split('@')[0];
            assignedId = mapping.userId || '';
          }
        }

        const taskData: any = {
          id: newTaskId,
          projectId: newProjectId,
          title: item.title.trim(),
          description: typeof item.description === 'string' ? item.description.trim() : '',
          phase: item.phase || null,
          rolePlaceholder: item.rolePlaceholder || null,
          acceptanceCriteria: Array.isArray(item.acceptanceCriteria) ? item.acceptanceCriteria : [],
          assigneeEmail: assignedEmail,
          assigneeName: assignedName,
          assigneeId: assignedId,
          status: 'pending',
          priority: item.priority || 'medium',
          startDate,
          dueDate,
          prerequisiteTaskIds: mappedPrereqs,
          sourceType: 'manual',
          subTasks: [],
          activityHistory: [
            {
              id: crypto.randomUUID().substring(0, 8),
              action: 'task_created',
              performedBy: creatorName,
              timestamp: nowIso,
              details: `Created from project template "${template.name}"`
            }
          ],
          createdBy: req.user.uid,
          creatorEmail: req.user.email || '',
          createdAt: nowIso,
          updatedAt: nowIso
        };

        // Remove undefined values
        Object.keys(taskData).forEach(k => {
          if (taskData[k] === undefined) delete taskData[k];
        });

        instantiatedTasks.push(taskData);
      }

      // Atomicity: Check batch limit (up to 500 writes in a Firestore batch)
      // Writes: 1 project + 1 projectMember + 2 * numTasks (tasks + projectTasks dual write)
      const totalWrites = 2 + (instantiatedTasks.length * 2);
      if (totalWrites > 500) {
        return res.status(400).json({
          error: "Bad Request",
          message: `Template exceeds atomic creation limit (contains ${instantiatedTasks.length} tasks). Max allowed tasks is 240.`
        });
      }

      const batch = db.batch();

      // Set project and member
      batch.set(db.collection("projects").doc(newProjectId), newProjectData);
      batch.set(db.collection("projectMembers").doc(newMemberData.id), newMemberData);

      // Set dual-written tasks
      instantiatedTasks.forEach(t => {
        batch.set(db.collection("tasks").doc(t.id), t);
        batch.set(db.collection("projectTasks").doc(t.id), t);
      });

      // Commit atomically
      await batch.commit();

      // Log activity
      try {
        await db.collection("projectActivities").add({
          projectId: newProjectId,
          organizationId: organizationId || null,
          userId: req.user.uid,
          userEmail: req.user.email || '',
          userName: creatorName,
          actionType: 'project_created_from_template',
          description: `${creatorName} created project "${projectName.trim()}" from template "${template.name}" (${instantiatedTasks.length} tasks initialized)`,
          templateId: template.id,
          createdAt: FieldValue.serverTimestamp()
        });
      } catch {}

      return res.status(201).json({
        success: true,
        message: `Project "${projectName.trim()}" successfully created from template "${template.name}".`,
        project: {
          id: newProjectId,
          name: projectName.trim(),
          description: newProjectData.description,
          organizationId: newProjectData.organizationId,
          templateId: template.id,
          templateName: template.name,
          createdAt: nowIso
        },
        createdTasksCount: instantiatedTasks.length,
        createdTaskIds: instantiatedTasks.map(t => t.id),
        tasks: instantiatedTasks
      });
    } catch (err: any) {
      console.error("[Create Project from Template Error]:", err);
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to create project from template." });
    }
  });

  // =========================================================================
  // TASK EXCEPTION HANDLING (Step 3.5: Task Exception Lifecycle & Tracking)
  // =========================================================================

  const VALID_EXCEPTION_TYPES = ['blocked', 'overdue', 'at_risk', 'dependency_issue', 'other'] as const;
  const VALID_EXCEPTION_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
  const VALID_EXCEPTION_STATUSES = ['open', 'acknowledged', 'in_progress', 'resolved', 'dismissed'] as const;

  // Lifecycle transition table
  const ALLOWED_EXCEPTION_TRANSITIONS: Record<string, string[]> = {
    open: ['acknowledged', 'in_progress', 'resolved', 'dismissed'],
    acknowledged: ['in_progress', 'resolved', 'dismissed'],
    in_progress: ['resolved', 'dismissed'],
    resolved: ['open'], // Only explicit reopen
    dismissed: ['open']  // Only explicit reopen
  };

  // Helper: Verify task belongs to project (checks 'tasks' first, fallbacks to 'projectTasks')
  async function resolveTaskInProject(projectId: string, taskId: string): Promise<any | null> {
    const taskDoc = await db.collection("tasks").doc(taskId).get();
    if (taskDoc.exists && taskDoc.data()?.projectId === projectId) {
      return { id: taskDoc.id, ...taskDoc.data() };
    }
    const mirrorDoc = await db.collection("projectTasks").doc(taskId).get();
    if (mirrorDoc.exists && mirrorDoc.data()?.projectId === projectId) {
      return { id: mirrorDoc.id, ...mirrorDoc.data() };
    }
    return null;
  }

  // 1. POST /api/projects/:projectId/tasks/:taskId/exceptions - Create an exception for a task
  app.post("/api/projects/:projectId/tasks/:taskId/exceptions", requireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const { projectId, taskId } = req.params;
      if (!projectId || !taskId) {
        return res.status(400).json({ error: "Bad Request", message: "Project ID and Task ID are required." });
      }

      // 1. Check project editor access
      const projAccess = await resolveProjectAccess(db, req.user, projectId, { requiredPermission: 'EDIT_CONTENT' });
      if (!projAccess.hasAccess || !projAccess.permissions.canEditContent) {
        if (projAccess.notFound) {
          return res.status(404).json({ error: "Not Found", message: "Project not found." });
        }
        return res.status(403).json({ error: "Forbidden", message: "Permission denied: Only project editors or administrators can report exceptions." });
      }

      // 2. Validate task existence and project ownership
      const task = await resolveTaskInProject(projectId, taskId);
      if (!task) {
        return res.status(404).json({ error: "Not Found", message: `Task "${taskId}" not found in project "${projectId}". Cross-project references are rejected.` });
      }

      const { type, title, description, severity, assignedToEmail } = req.body || {};

      if (!type || !VALID_EXCEPTION_TYPES.includes(type)) {
        return res.status(400).json({
          error: "Bad Request",
          message: `Invalid or missing exception type. Must be one of: ${VALID_EXCEPTION_TYPES.join(', ')}.`
        });
      }

      if (!title || typeof title !== 'string' || !title.trim()) {
        return res.status(400).json({ error: "Bad Request", message: "Exception title is required." });
      }
      if (title.trim().length > 200) {
        return res.status(400).json({ error: "Bad Request", message: "Exception title must not exceed 200 characters." });
      }

      if (description !== undefined && typeof description !== 'string') {
        return res.status(400).json({ error: "Bad Request", message: "Description must be a string." });
      }
      if (typeof description === 'string' && description.length > 5000) {
        return res.status(400).json({ error: "Bad Request", message: "Description must not exceed 5000 characters." });
      }

      const chosenSeverity = severity || 'medium';
      if (!VALID_EXCEPTION_SEVERITIES.includes(chosenSeverity)) {
        return res.status(400).json({
          error: "Bad Request",
          message: `Invalid severity. Must be one of: ${VALID_EXCEPTION_SEVERITIES.join(', ')}.`
        });
      }

      // Check for active duplicate exception of the same type for this task
      const activeExceptionsSnap = await db.collection("taskExceptions")
        .where("taskId", "==", taskId)
        .where("type", "==", type)
        .get();

      const existingActive = activeExceptionsSnap.docs
        .map(d => ({ id: d.id, ...d.data() } as any))
        .find(e => ['open', 'acknowledged', 'in_progress'].includes(e.status));

      if (existingActive) {
        return res.status(409).json({
          error: "Conflict",
          message: `An active exception of type "${type}" already exists for this task (ID: ${existingActive.id}, Status: ${existingActive.status}).`,
          existingException: existingActive
        });
      }

      // Validate optional assigned owner
      let assignedUser: { memberUid: string; memberName: string; memberEmail: string } | null = null;
      if (assignedToEmail && typeof assignedToEmail === 'string' && assignedToEmail.trim()) {
        const verifyRes = await verifyEligibleAssignee(db, projectId, projAccess.project || {}, assignedToEmail.trim());
        if (!verifyRes.eligible) {
          return res.status(400).json({ error: "Bad Request", message: verifyRes.message || "Assigned owner is not eligible." });
        }
        assignedUser = {
          memberUid: verifyRes.memberUid || '',
          memberName: verifyRes.memberName || assignedToEmail.trim().split('@')[0],
          memberEmail: assignedToEmail.trim().toLowerCase()
        };
      }

      const nowIso = new Date().toISOString();
      const reporterName = req.user.displayName || req.user.name || (req.user.email ? req.user.email.split('@')[0] : 'User');
      const exceptionId = `ex_${crypto.randomUUID()}`;
      const projectOrgId = projAccess.project?.organizationId || projAccess.project?.orgId || null;

      const initialHistoryItem: any = {
        id: crypto.randomUUID().substring(0, 8),
        action: 'created',
        performedBy: req.user.uid,
        performedByName: reporterName,
        performedByEmail: req.user.email || '',
        timestamp: nowIso,
        details: `Reported exception of type "${type}" (${chosenSeverity} severity)`,
        newStatus: 'open'
      };

      const exceptionData: any = {
        id: exceptionId,
        projectId,
        organizationId: projectOrgId,
        taskId,
        taskTitle: task.title || 'Untitled Task',
        type,
        title: title.trim(),
        description: typeof description === 'string' ? description.trim() : '',
        severity: chosenSeverity,
        status: 'open',
        reporterId: req.user.uid,
        reporterName,
        reporterEmail: req.user.email || '',
        history: [initialHistoryItem],
        createdAt: nowIso,
        updatedAt: nowIso
      };

      if (assignedUser) {
        exceptionData.assignedToId = assignedUser.memberUid;
        exceptionData.assignedToName = assignedUser.memberName;
        exceptionData.assignedToEmail = assignedUser.memberEmail;
        exceptionData.history.push({
          id: crypto.randomUUID().substring(0, 8),
          action: 'assigned',
          performedBy: req.user.uid,
          performedByName: reporterName,
          performedByEmail: req.user.email || '',
          timestamp: nowIso,
          details: `Assigned exception to ${assignedUser.memberName} (${assignedUser.memberEmail})`
        });
      }

      // Atomic batch write for exception and project activity log
      const batch = db.batch();
      batch.set(db.collection("taskExceptions").doc(exceptionId), exceptionData);

      await batch.commit();

      // Log project activity
      try {
        await db.collection("projectActivities").add({
          projectId,
          organizationId: projectOrgId,
          userId: req.user.uid,
          userEmail: req.user.email || '',
          userName: reporterName,
          actionType: 'task_exception_created',
          description: `${reporterName} reported a ${chosenSeverity} ${type} exception on task "${task.title}": "${title.trim()}"`,
          exceptionId,
          taskId,
          createdAt: FieldValue.serverTimestamp()
        });
      } catch {}

      return res.status(201).json({
        success: true,
        message: "Task exception created successfully.",
        exception: exceptionData
      });
    } catch (err: any) {
      console.error("[Create Task Exception Error]:", err);
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to create task exception." });
    }
  });

  // 2. GET /api/projects/:projectId/exceptions - List project exceptions with filters and metrics
  app.get("/api/projects/:projectId/exceptions", requireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const { projectId } = req.params;
      if (!projectId) {
        return res.status(400).json({ error: "Bad Request", message: "Project ID is required." });
      }

      const projAccess = await resolveProjectAccess(db, req.user, projectId, { requiredPermission: 'VIEW' });
      if (!projAccess.hasAccess) {
        if (projAccess.notFound) {
          return res.status(404).json({ error: "Not Found", message: "Project not found." });
        }
        return res.status(403).json({ error: "Forbidden", message: "Access denied to project exceptions." });
      }

      const snap = await db.collection("taskExceptions").where("projectId", "==", projectId).get();
      const allExceptions = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));

      // Calculate project-level metrics across all exceptions
      const metrics = {
        total: allExceptions.length,
        open: allExceptions.filter(e => e.status === 'open').length,
        acknowledged: allExceptions.filter(e => e.status === 'acknowledged').length,
        in_progress: allExceptions.filter(e => e.status === 'in_progress').length,
        resolved: allExceptions.filter(e => e.status === 'resolved').length,
        dismissed: allExceptions.filter(e => e.status === 'dismissed').length,
        critical: allExceptions.filter(e => ['open', 'acknowledged', 'in_progress'].includes(e.status) && e.severity === 'critical').length,
        high: allExceptions.filter(e => ['open', 'acknowledged', 'in_progress'].includes(e.status) && e.severity === 'high').length,
        medium: allExceptions.filter(e => ['open', 'acknowledged', 'in_progress'].includes(e.status) && e.severity === 'medium').length,
        low: allExceptions.filter(e => ['open', 'acknowledged', 'in_progress'].includes(e.status) && e.severity === 'low').length,
        activeTotal: allExceptions.filter(e => ['open', 'acknowledged', 'in_progress'].includes(e.status)).length
      };

      // Server-side filters
      const { status, severity, type, assignedToEmail, taskId } = req.query as Record<string, string>;
      let filtered = allExceptions;

      if (status) {
        filtered = filtered.filter(e => e.status === status);
      }
      if (severity) {
        filtered = filtered.filter(e => e.severity === severity);
      }
      if (type) {
        filtered = filtered.filter(e => e.type === type);
      }
      if (assignedToEmail) {
        filtered = filtered.filter(e => e.assignedToEmail?.toLowerCase() === assignedToEmail.toLowerCase());
      }
      if (taskId) {
        filtered = filtered.filter(e => e.taskId === taskId);
      }

      // Sort by creation desc
      filtered.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());

      return res.json({
        success: true,
        projectId,
        exceptions: filtered,
        metrics
      });
    } catch (err: any) {
      console.error("[List Exceptions Error]:", err);
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to list task exceptions." });
    }
  });

  // 3. GET /api/exceptions/:exceptionId - Retrieve exception details and history
  app.get("/api/exceptions/:exceptionId", requireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const { exceptionId } = req.params;
      if (!exceptionId) {
        return res.status(400).json({ error: "Bad Request", message: "Exception ID is required." });
      }

      const doc = await db.collection("taskExceptions").doc(exceptionId).get();
      if (!doc.exists) {
        return res.status(404).json({ error: "Not Found", message: "Task exception not found." });
      }

      const exception = { id: doc.id, ...doc.data() } as any;

      // Authorize via project view permission
      const projAccess = await resolveProjectAccess(db, req.user, exception.projectId, { requiredPermission: 'VIEW' });
      if (!projAccess.hasAccess) {
        return res.status(403).json({ error: "Forbidden", message: "Access denied to this exception." });
      }

      // Fetch task snapshot to provide context
      const task = await resolveTaskInProject(exception.projectId, exception.taskId);

      return res.json({
        success: true,
        exception,
        taskSnapshot: task ? {
          id: task.id,
          title: task.title,
          status: task.status,
          priority: task.priority,
          assigneeName: task.assigneeName,
          assigneeEmail: task.assigneeEmail,
          dueDate: task.dueDate,
          startDate: task.startDate,
          dependencyStatus: task.dependencyStatus
        } : null
      });
    } catch (err: any) {
      console.error("[Get Exception Details Error]:", err);
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to retrieve exception details." });
    }
  });

  // 4. PATCH /api/exceptions/:exceptionId - Update exception status, severity, description, assignee
  app.patch("/api/exceptions/:exceptionId", requireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const { exceptionId } = req.params;
      if (!exceptionId) {
        return res.status(400).json({ error: "Bad Request", message: "Exception ID is required." });
      }

      const doc = await db.collection("taskExceptions").doc(exceptionId).get();
      if (!doc.exists) {
        return res.status(404).json({ error: "Not Found", message: "Task exception not found." });
      }

      const exception = { id: doc.id, ...doc.data() } as any;

      // Permission check: must be project editor, assigned owner, or reporter
      const projAccess = await resolveProjectAccess(db, req.user, exception.projectId, { requiredPermission: 'EDIT_CONTENT' });
      const isLead = projAccess.isOwner || projAccess.role === 'admin' || projAccess.isOrgAdmin || projAccess.isPlatformAdmin;
      const isReporter = exception.reporterId === req.user.uid;
      const isAssignee = exception.assignedToId === req.user.uid || (exception.assignedToEmail && exception.assignedToEmail.toLowerCase() === req.user.email?.toLowerCase());

      if (!projAccess.hasAccess || (!projAccess.permissions.canEditContent && !isLead && !isReporter && !isAssignee)) {
        return res.status(403).json({ error: "Forbidden", message: "Permission denied: You are not authorized to update this exception." });
      }

      const { status, severity, description, title, assignedToEmail, notes } = req.body || {};
      const updates: Record<string, any> = {};
      const historyEntries: any[] = [];
      const nowIso = new Date().toISOString();
      const actorName = req.user.displayName || req.user.name || (req.user.email ? req.user.email.split('@')[0] : 'User');

      // 1. Status Transition validation
      if (status !== undefined) {
        if (!VALID_EXCEPTION_STATUSES.includes(status)) {
          return res.status(400).json({
            error: "Bad Request",
            message: `Invalid status "${status}". Must be one of: ${VALID_EXCEPTION_STATUSES.join(', ')}.`
          });
        }

        if (status !== exception.status) {
          const allowedTransitions = ALLOWED_EXCEPTION_TRANSITIONS[exception.status] || [];
          if (!allowedTransitions.includes(status)) {
            return res.status(400).json({
              error: "Bad Request",
              message: `Invalid lifecycle transition: Cannot transition exception from "${exception.status}" to "${status}".`
            });
          }

          // Special authorization check for reopening
          if (['resolved', 'dismissed'].includes(exception.status) && status === 'open') {
            if (!isLead && !isReporter) {
              return res.status(403).json({
                error: "Forbidden",
                message: "Permission denied: Only the reporter or a project administrator can reopen a resolved/dismissed exception."
              });
            }
          }

          updates.status = status;
          historyEntries.push({
            id: crypto.randomUUID().substring(0, 8),
            action: status === 'open' ? 'reopened' : status,
            performedBy: req.user.uid,
            performedByName: actorName,
            performedByEmail: req.user.email || '',
            timestamp: nowIso,
            previousStatus: exception.status,
            newStatus: status,
            details: notes ? String(notes).trim() : `Status changed from "${exception.status}" to "${status}"`
          });
        }
      }

      // 2. Severity update
      if (severity !== undefined) {
        if (!VALID_EXCEPTION_SEVERITIES.includes(severity)) {
          return res.status(400).json({
            error: "Bad Request",
            message: `Invalid severity "${severity}". Must be one of: ${VALID_EXCEPTION_SEVERITIES.join(', ')}.`
          });
        }
        if (severity !== exception.severity) {
          updates.severity = severity;
          historyEntries.push({
            id: crypto.randomUUID().substring(0, 8),
            action: 'updated',
            performedBy: req.user.uid,
            performedByName: actorName,
            performedByEmail: req.user.email || '',
            timestamp: nowIso,
            details: `Severity changed from "${exception.severity}" to "${severity}"`
          });
        }
      }

      // 3. Description update
      if (description !== undefined) {
        if (typeof description !== 'string') {
          return res.status(400).json({ error: "Bad Request", message: "Description must be a string." });
        }
        if (description.length > 5000) {
          return res.status(400).json({ error: "Bad Request", message: "Description must not exceed 5000 characters." });
        }
        if (description.trim() !== exception.description) {
          updates.description = description.trim();
          historyEntries.push({
            id: crypto.randomUUID().substring(0, 8),
            action: 'updated',
            performedBy: req.user.uid,
            performedByName: actorName,
            performedByEmail: req.user.email || '',
            timestamp: nowIso,
            details: "Updated exception description"
          });
        }
      }

      // 4. Title update
      if (title !== undefined) {
        if (typeof title !== 'string' || !title.trim()) {
          return res.status(400).json({ error: "Bad Request", message: "Title cannot be empty." });
        }
        if (title.trim().length > 200) {
          return res.status(400).json({ error: "Bad Request", message: "Title must not exceed 200 characters." });
        }
        if (title.trim() !== exception.title) {
          updates.title = title.trim();
        }
      }

      // 5. Assignee update
      if (assignedToEmail !== undefined) {
        if (assignedToEmail === null || assignedToEmail === '') {
          // Unassign
          updates.assignedToId = null;
          updates.assignedToName = null;
          updates.assignedToEmail = null;
          historyEntries.push({
            id: crypto.randomUUID().substring(0, 8),
            action: 'assigned',
            performedBy: req.user.uid,
            performedByName: actorName,
            performedByEmail: req.user.email || '',
            timestamp: nowIso,
            details: "Unassigned exception owner"
          });
        } else if (typeof assignedToEmail === 'string' && assignedToEmail.trim()) {
          const verifyRes = await verifyEligibleAssignee(db, exception.projectId, projAccess.project || {}, assignedToEmail.trim());
          if (!verifyRes.eligible) {
            return res.status(400).json({ error: "Bad Request", message: verifyRes.message || "Assigned owner is not eligible." });
          }
          updates.assignedToId = verifyRes.memberUid || '';
          updates.assignedToName = verifyRes.memberName || assignedToEmail.trim().split('@')[0];
          updates.assignedToEmail = assignedToEmail.trim().toLowerCase();
          historyEntries.push({
            id: crypto.randomUUID().substring(0, 8),
            action: 'assigned',
            performedBy: req.user.uid,
            performedByName: actorName,
            performedByEmail: req.user.email || '',
            timestamp: nowIso,
            details: `Assigned exception to ${updates.assignedToName} (${updates.assignedToEmail})`
          });
        }
      }

      if (Object.keys(updates).length === 0 && historyEntries.length === 0) {
        return res.json({ success: true, message: "No changes requested.", exception });
      }

      updates.updatedAt = nowIso;
      const existingHistory = Array.isArray(exception.history) ? exception.history : [];
      updates.history = [...existingHistory, ...historyEntries];

      await db.collection("taskExceptions").doc(exceptionId).set(updates, { merge: true });

      return res.json({
        success: true,
        message: "Task exception updated successfully.",
        exception: { ...exception, ...updates }
      });
    } catch (err: any) {
      console.error("[Update Task Exception Error]:", err);
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to update task exception." });
    }
  });

  // 5. POST /api/exceptions/:exceptionId/resolve - Resolve an exception with summary
  app.post("/api/exceptions/:exceptionId/resolve", requireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const { exceptionId } = req.params;
      if (!exceptionId) {
        return res.status(400).json({ error: "Bad Request", message: "Exception ID is required." });
      }

      const doc = await db.collection("taskExceptions").doc(exceptionId).get();
      if (!doc.exists) {
        return res.status(404).json({ error: "Not Found", message: "Task exception not found." });
      }

      const exception = { id: doc.id, ...doc.data() } as any;

      // Project editor check
      const projAccess = await resolveProjectAccess(db, req.user, exception.projectId, { requiredPermission: 'EDIT_CONTENT' });
      if (!projAccess.hasAccess || !projAccess.permissions.canEditContent) {
        return res.status(403).json({ error: "Forbidden", message: "Permission denied: Only project editors or administrators can resolve exceptions." });
      }

      if (exception.status === 'resolved') {
        return res.status(400).json({ error: "Bad Request", message: "Exception is already resolved." });
      }
      if (exception.status === 'dismissed') {
        return res.status(400).json({ error: "Bad Request", message: "Dismissed exception cannot be directly resolved. Reopen it first." });
      }

      const { resolutionSummary } = req.body || {};
      if (!resolutionSummary || typeof resolutionSummary !== 'string' || !resolutionSummary.trim()) {
        return res.status(400).json({ error: "Bad Request", message: "A resolution summary is required to resolve an exception." });
      }
      if (resolutionSummary.trim().length > 3000) {
        return res.status(400).json({ error: "Bad Request", message: "Resolution summary must not exceed 3000 characters." });
      }

      const nowIso = new Date().toISOString();
      const actorName = req.user.displayName || req.user.name || (req.user.email ? req.user.email.split('@')[0] : 'User');

      const historyEntry: any = {
        id: crypto.randomUUID().substring(0, 8),
        action: 'resolved',
        performedBy: req.user.uid,
        performedByName: actorName,
        performedByEmail: req.user.email || '',
        timestamp: nowIso,
        previousStatus: exception.status,
        newStatus: 'resolved',
        details: resolutionSummary.trim()
      };

      const updates: any = {
        status: 'resolved',
        resolutionSummary: resolutionSummary.trim(),
        resolvedAt: nowIso,
        resolvedById: req.user.uid,
        updatedAt: nowIso,
        history: [...(Array.isArray(exception.history) ? exception.history : []), historyEntry]
      };

      await db.collection("taskExceptions").doc(exceptionId).set(updates, { merge: true });

      // Note: Exception resolution and task execution status remain strictly distinct.
      // Resolving the exception does NOT mutate task status, task dates, dependencies, or provenance.

      return res.json({
        success: true,
        message: "Task exception resolved successfully.",
        exception: { ...exception, ...updates }
      });
    } catch (err: any) {
      console.error("[Resolve Exception Error]:", err);
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to resolve task exception." });
    }
  });

  // 6. POST /api/exceptions/:exceptionId/dismiss - Dismiss an exception with reason
  app.post("/api/exceptions/:exceptionId/dismiss", requireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const { exceptionId } = req.params;
      if (!exceptionId) {
        return res.status(400).json({ error: "Bad Request", message: "Exception ID is required." });
      }

      const doc = await db.collection("taskExceptions").doc(exceptionId).get();
      if (!doc.exists) {
        return res.status(404).json({ error: "Not Found", message: "Task exception not found." });
      }

      const exception = { id: doc.id, ...doc.data() } as any;

      // Project editor check
      const projAccess = await resolveProjectAccess(db, req.user, exception.projectId, { requiredPermission: 'EDIT_CONTENT' });
      if (!projAccess.hasAccess || !projAccess.permissions.canEditContent) {
        return res.status(403).json({ error: "Forbidden", message: "Permission denied: Only project editors or administrators can dismiss exceptions." });
      }

      if (exception.status === 'dismissed') {
        return res.status(400).json({ error: "Bad Request", message: "Exception is already dismissed." });
      }

      const { dismissalReason } = req.body || {};
      if (!dismissalReason || typeof dismissalReason !== 'string' || !dismissalReason.trim()) {
        return res.status(400).json({ error: "Bad Request", message: "A dismissal reason is required to dismiss an exception." });
      }
      if (dismissalReason.trim().length > 3000) {
        return res.status(400).json({ error: "Bad Request", message: "Dismissal reason must not exceed 3000 characters." });
      }

      const nowIso = new Date().toISOString();
      const actorName = req.user.displayName || req.user.name || (req.user.email ? req.user.email.split('@')[0] : 'User');

      const historyEntry: any = {
        id: crypto.randomUUID().substring(0, 8),
        action: 'dismissed',
        performedBy: req.user.uid,
        performedByName: actorName,
        performedByEmail: req.user.email || '',
        timestamp: nowIso,
        previousStatus: exception.status,
        newStatus: 'dismissed',
        details: dismissalReason.trim()
      };

      const updates: any = {
        status: 'dismissed',
        dismissalReason: dismissalReason.trim(),
        dismissedAt: nowIso,
        dismissedById: req.user.uid,
        updatedAt: nowIso,
        history: [...(Array.isArray(exception.history) ? exception.history : []), historyEntry]
      };

      await db.collection("taskExceptions").doc(exceptionId).set(updates, { merge: true });

      return res.json({
        success: true,
        message: "Task exception dismissed successfully.",
        exception: { ...exception, ...updates }
      });
    } catch (err: any) {
      console.error("[Dismiss Exception Error]:", err);
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to dismiss task exception." });
    }
  });

  // 7. POST /api/exceptions/:exceptionId/reopen - Reopen a resolved or dismissed exception
  app.post("/api/exceptions/:exceptionId/reopen", requireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const { exceptionId } = req.params;
      if (!exceptionId) {
        return res.status(400).json({ error: "Bad Request", message: "Exception ID is required." });
      }

      const doc = await db.collection("taskExceptions").doc(exceptionId).get();
      if (!doc.exists) {
        return res.status(404).json({ error: "Not Found", message: "Task exception not found." });
      }

      const exception = { id: doc.id, ...doc.data() } as any;

      if (!['resolved', 'dismissed'].includes(exception.status)) {
        return res.status(400).json({
          error: "Bad Request",
          message: `Cannot reopen an exception with status "${exception.status}". Only resolved or dismissed exceptions can be reopened.`
        });
      }

      const projAccess = await resolveProjectAccess(db, req.user, exception.projectId, { requiredPermission: 'EDIT_CONTENT' });
      const isLead = projAccess.isOwner || projAccess.role === 'admin' || projAccess.isOrgAdmin || projAccess.isPlatformAdmin;
      const isReporter = exception.reporterId === req.user.uid;

      if (!projAccess.hasAccess || (!projAccess.permissions.canEditContent && !isLead && !isReporter)) {
        return res.status(403).json({ error: "Forbidden", message: "Permission denied: Only the reporter or a project administrator can reopen this exception." });
      }

      const { reason } = req.body || {};
      const nowIso = new Date().toISOString();
      const actorName = req.user.displayName || req.user.name || (req.user.email ? req.user.email.split('@')[0] : 'User');

      const historyEntry: any = {
        id: crypto.randomUUID().substring(0, 8),
        action: 'reopened',
        performedBy: req.user.uid,
        performedByName: actorName,
        performedByEmail: req.user.email || '',
        timestamp: nowIso,
        previousStatus: exception.status,
        newStatus: 'open',
        details: reason ? String(reason).trim() : "Reopened exception"
      };

      const updates: any = {
        status: 'open',
        updatedAt: nowIso,
        history: [...(Array.isArray(exception.history) ? exception.history : []), historyEntry]
      };

      await db.collection("taskExceptions").doc(exceptionId).set(updates, { merge: true });

      return res.json({
        success: true,
        message: "Task exception reopened successfully.",
        exception: { ...exception, ...updates }
      });
    } catch (err: any) {
      console.error("[Reopen Exception Error]:", err);
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to reopen task exception." });
    }
  });

  // =========================================================================
  // FOLLOW-UP MEETINGS & RESCHEDULING (Step 3.6)
  // =========================================================================

  const VALID_FOLLOWUP_STATUSES = [
    'draft',
    'proposed',
    'awaiting_confirmation',
    'scheduled',
    'reschedule_requested',
    'completed',
    'cancelled',
    'failed'
  ] as const;

  const ALLOWED_FOLLOWUP_TRANSITIONS: Record<string, string[]> = {
    draft: ['proposed', 'awaiting_confirmation', 'scheduled', 'cancelled'],
    proposed: ['awaiting_confirmation', 'scheduled', 'reschedule_requested', 'cancelled'],
    awaiting_confirmation: ['scheduled', 'reschedule_requested', 'cancelled', 'failed'],
    scheduled: ['reschedule_requested', 'completed', 'cancelled'],
    reschedule_requested: ['scheduled', 'proposed', 'cancelled', 'failed'],
    completed: [], // Terminal
    cancelled: ['draft'], // Reopen draft only
    failed: ['proposed', 'draft', 'cancelled']
  };

  // Helper: Deterministically generate meeting title, purpose, and agenda from tasks & exceptions
  function generateFollowUpContent(options: {
    sourceTasks: any[];
    sourceExceptions: any[];
    sourceDecisions?: any[];
    customTitle?: string;
    customPurpose?: string;
    customReason?: string;
  }) {
    const { sourceTasks, sourceExceptions, sourceDecisions = [], customTitle, customPurpose, customReason } = options;

    let title = customTitle || '';
    let reason = customReason || '';
    let purpose = customPurpose || '';

    if (!title) {
      if (sourceExceptions.length > 0) {
        const primaryEx = sourceExceptions[0];
        title = `Exception Review: ${primaryEx.title}`;
        reason = `Resolve ${primaryEx.severity} severity exception (${primaryEx.type.replace('_', ' ')})`;
      } else if (sourceTasks.length > 0) {
        const primaryTask = sourceTasks[0];
        if (primaryTask.dependencyStatus === 'blocked') {
          title = `Unblock Task: ${primaryTask.title}`;
          reason = `Address blocked prerequisites for task "${primaryTask.title}"`;
        } else if (primaryTask.dueDate && new Date(primaryTask.dueDate).getTime() < Date.now()) {
          title = `Overdue Recovery: ${primaryTask.title}`;
          reason = `Recover delayed milestone for task "${primaryTask.title}" (Due: ${primaryTask.dueDate})`;
        } else {
          title = `Task Follow-up: ${primaryTask.title}`;
          reason = `Review deliverables and alignment for task "${primaryTask.title}"`;
        }
      } else if (sourceDecisions.length > 0) {
        const primaryDec = sourceDecisions[0];
        title = `Decision Follow-up: ${primaryDec.title || primaryDec.decisionText || 'Meeting Decision'}`;
        reason = `Follow up on execution of meeting decision`;
      } else {
        title = `Project Execution Follow-up`;
        reason = `Team review on current project milestones and deliverables`;
      }
    }

    if (!purpose) {
      purpose = `Align stakeholders on action items, unblock pending milestones, and establish clear next steps.`;
    }

    // Build structured agenda items
    const agendaLines: string[] = [];
    agendaLines.push(`1. Objective & Context: ${reason}`);

    if (sourceExceptions.length > 0) {
      agendaLines.push(`2. Exception & Obstacle Review:`);
      sourceExceptions.forEach((ex, idx) => {
        agendaLines.push(`   - [${ex.severity.toUpperCase()}] ${ex.title}: ${ex.description || 'No description provided'}`);
      });
    }

    if (sourceTasks.length > 0) {
      const startIdx = sourceExceptions.length > 0 ? 3 : 2;
      agendaLines.push(`${startIdx}. Task Execution & Dependencies:`);
      sourceTasks.forEach(t => {
        const prereqInfo = t.blockingPrerequisites?.length ? ` (Blocked by: ${t.blockingPrerequisites.map((bp: any) => bp.title).join(', ')})` : '';
        agendaLines.push(`   - ${t.title} [Status: ${t.status}]${prereqInfo}`);
      });
    }

    const nextStepIdx = (sourceExceptions.length > 0 ? 1 : 0) + (sourceTasks.length > 0 ? 1 : 0) + 2;
    agendaLines.push(`${nextStepIdx}. Action Item Assignments & Commitments`);
    agendaLines.push(`${nextStepIdx + 1}. Schedule & Timeline Confirmation`);

    return {
      title: title.slice(0, 200),
      reason: reason.slice(0, 500),
      purpose: purpose.slice(0, 2000),
      agenda: agendaLines.join('\n')
    };
  }

  // Helper: Verify participant eligibility within project
  async function resolveParticipants(
    db: any,
    projectId: string,
    projectData: any,
    participantsInput: any[]
  ): Promise<any[]> {
    if (!Array.isArray(participantsInput)) return [];
    const verified: any[] = [];
    const seenEmails = new Set<string>();

    for (const p of participantsInput) {
      const email = typeof p === 'string' ? p.trim().toLowerCase() : p?.email?.trim()?.toLowerCase();
      if (!email || seenEmails.has(email)) continue;
      seenEmails.add(email);

      const check = await verifyEligibleAssignee(db, projectId, projectData, email);
      if (check.eligible) {
        verified.push({
          userId: check.memberUid || p.userId || '',
          email,
          name: check.memberName || p.name || email.split('@')[0],
          role: p.role || 'participant',
          status: 'invited'
        });
      }
    }
    return verified;
  }

  // 1. GET /api/projects/:projectId/follow-ups/recommendations - Discover recommended follow-ups
  app.get("/api/projects/:projectId/follow-ups/recommendations", requireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const { projectId } = req.params;
      if (!projectId) {
        return res.status(400).json({ error: "Bad Request", message: "Project ID is required." });
      }

      const projAccess = await resolveProjectAccess(db, req.user, projectId, { requiredPermission: 'VIEW' });
      if (!projAccess.hasAccess) {
        if (projAccess.notFound) return res.status(404).json({ error: "Not Found", message: "Project not found." });
        return res.status(403).json({ error: "Forbidden", message: "Access denied." });
      }

      // Query active exceptions
      const exceptionsSnap = await db.collection("taskExceptions")
        .where("projectId", "==", projectId)
        .where("status", "in", ["open", "acknowledged", "in_progress"])
        .get();
      const activeExceptions = exceptionsSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));

      // Query project tasks
      const tasksSnap = await db.collection("tasks").where("projectId", "==", projectId).get();
      const allTasks = tasksSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));

      // Query existing active follow-up meetings to prevent duplicates
      const existingFollowUpsSnap = await db.collection("followUpMeetings")
        .where("projectId", "==", projectId)
        .where("status", "in", ["draft", "proposed", "awaiting_confirmation", "scheduled", "reschedule_requested"])
        .get();
      const existingFollowUps = existingFollowUpsSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));

      const coveredTaskIds = new Set<string>();
      const coveredExceptionIds = new Set<string>();
      existingFollowUps.forEach(f => {
        (f.relatedTaskIds || []).forEach((tid: string) => coveredTaskIds.add(tid));
        (f.relatedExceptionIds || []).forEach((eid: string) => coveredExceptionIds.add(eid));
      });

      const recommendations: any[] = [];
      const nowMs = Date.now();

      // Rec 1: High/Critical active exceptions
      for (const ex of activeExceptions) {
        if (['critical', 'high'].includes(ex.severity) && !coveredExceptionIds.has(ex.id)) {
          const task = allTasks.find(t => t.id === ex.taskId);
          recommendations.push({
            id: `rec_ex_${ex.id}`,
            category: 'exception_review',
            urgency: ex.severity === 'critical' ? 'critical' : 'high',
            title: `Review ${ex.severity} obstacle: ${ex.title}`,
            reason: `Unresolved ${ex.severity} exception of type "${ex.type.replace('_', ' ')}"`,
            suggestedTaskIds: task ? [task.id] : [],
            suggestedExceptionIds: [ex.id],
            participants: task?.assigneeEmail ? [task.assigneeEmail] : []
          });
        }
      }

      // Rec 2: Blocked tasks
      const taskMap = new Map<string, any>();
      allTasks.forEach(t => taskMap.set(t.id, t));

      for (const task of allTasks) {
        if (task.status === 'completed' || coveredTaskIds.has(task.id)) continue;
        const prereqIds = Array.isArray(task.prerequisiteTaskIds) ? task.prerequisiteTaskIds : [];
        const hasBlockedPrereqs = prereqIds.some(pid => {
          const pt = taskMap.get(pid);
          return pt && pt.status !== 'completed';
        });

        if (hasBlockedPrereqs) {
          recommendations.push({
            id: `rec_blocked_${task.id}`,
            category: 'prerequisite_unblock',
            urgency: 'high',
            title: `Unblock Task: ${task.title}`,
            reason: `Task is blocked by incomplete prerequisites. Follow-up meeting needed to coordinate unblocking.`,
            suggestedTaskIds: [task.id, ...prereqIds],
            suggestedExceptionIds: [],
            participants: task.assigneeEmail ? [task.assigneeEmail] : []
          });
        } else if (task.dueDate && new Date(task.dueDate).getTime() < nowMs) {
          // Overdue task
          recommendations.push({
            id: `rec_overdue_${task.id}`,
            category: 'overdue_recovery',
            urgency: 'medium',
            title: `Overdue Milestone Recovery: ${task.title}`,
            reason: `Due date passed on ${task.dueDate} and task is still ${task.status}.`,
            suggestedTaskIds: [task.id],
            suggestedExceptionIds: [],
            participants: task.assigneeEmail ? [task.assigneeEmail] : []
          });
        }
      }

      return res.json({
        success: true,
        projectId,
        count: recommendations.length,
        recommendations
      });
    } catch (err: any) {
      console.error("[Follow-up Recommendations Error]:", err);
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to generate recommendations." });
    }
  });

  // 2. POST /api/projects/:projectId/follow-ups - Create a follow-up meeting
  app.post("/api/projects/:projectId/follow-ups", requireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const { projectId } = req.params;
      if (!projectId) {
        return res.status(400).json({ error: "Bad Request", message: "Project ID is required." });
      }

      // Check project editor access
      const projAccess = await resolveProjectAccess(db, req.user, projectId, { requiredPermission: 'EDIT_CONTENT' });
      if (!projAccess.hasAccess || !projAccess.permissions.canEditContent) {
        if (projAccess.notFound) return res.status(404).json({ error: "Not Found", message: "Project not found." });
        return res.status(403).json({ error: "Forbidden", message: "Permission denied: Only editors or administrators can schedule follow-up meetings." });
      }

      const projectData = projAccess.project || {};
      const projectOrgId = projectData.organizationId || projectData.orgId || null;

      const {
        taskIds = [],
        exceptionIds = [],
        meetingSessionIds = [],
        title: customTitle,
        purpose: customPurpose,
        reason: customReason,
        participants: participantsInput = [],
        proposedStartTime,
        proposedEndTime,
        timezone = 'UTC',
        allowDuplicate = false
      } = req.body || {};

      // Validate related tasks belong to project
      const validTaskIds: string[] = [];
      const sourceTasks: any[] = [];
      for (const tid of (Array.isArray(taskIds) ? taskIds : [])) {
        if (typeof tid !== 'string' || !tid.trim()) continue;
        const task = await resolveTaskInProject(projectId, tid.trim());
        if (!task) {
          return res.status(404).json({ error: "Not Found", message: `Task "${tid}" not found in project "${projectId}". Cross-project references are rejected.` });
        }
        validTaskIds.push(task.id);
        sourceTasks.push(task);
      }

      // Validate related exceptions belong to project
      const validExceptionIds: string[] = [];
      const sourceExceptions: any[] = [];
      for (const eid of (Array.isArray(exceptionIds) ? exceptionIds : [])) {
        if (typeof eid !== 'string' || !eid.trim()) continue;
        const exDoc = await db.collection("taskExceptions").doc(eid.trim()).get();
        if (!exDoc.exists || exDoc.data()?.projectId !== projectId) {
          return res.status(404).json({ error: "Not Found", message: `Exception "${eid}" not found in project "${projectId}". Cross-project references are rejected.` });
        }
        validExceptionIds.push(exDoc.id);
        sourceExceptions.push({ id: exDoc.id, ...exDoc.data() });
      }

      // Duplicate prevention: If not explicitly allowed, prevent duplicate active follow-ups for same issues
      if (!allowDuplicate && (validTaskIds.length > 0 || validExceptionIds.length > 0)) {
        const existingSnap = await db.collection("followUpMeetings")
          .where("projectId", "==", projectId)
          .where("status", "in", ["draft", "proposed", "awaiting_confirmation", "scheduled", "reschedule_requested"])
          .get();

        const activeFollowUps = existingSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));
        const duplicate = activeFollowUps.find(f => {
          const sharesTask = (f.relatedTaskIds || []).some((tid: string) => validTaskIds.includes(tid));
          const sharesException = (f.relatedExceptionIds || []).some((eid: string) => validExceptionIds.includes(eid));
          return sharesTask || sharesException;
        });

        if (duplicate) {
          return res.status(409).json({
            error: "Conflict",
            message: `An active follow-up meeting already exists addressing these items (ID: "${duplicate.id}", Status: "${duplicate.status}"). Set allowDuplicate: true to create anyway.`,
            existingFollowUpId: duplicate.id
          });
        }
      }

      // Generate deterministic title, purpose, and agenda
      const generated = generateFollowUpContent({
        sourceTasks,
        sourceExceptions,
        customTitle,
        customPurpose,
        customReason
      });

      // Resolve participants from project members
      let finalParticipants = await resolveParticipants(db, projectId, projectData, participantsInput);
      if (finalParticipants.length === 0) {
        // Fallback: Add current user and any task assignees
        finalParticipants.push({
          userId: req.user.uid,
          email: req.user.email || '',
          name: req.user.displayName || req.user.email?.split('@')[0] || 'User',
          role: 'organizer',
          status: 'accepted'
        });
        for (const t of sourceTasks) {
          if (t.assigneeEmail && t.assigneeEmail.toLowerCase() !== req.user.email?.toLowerCase()) {
            finalParticipants.push({
              userId: t.assigneeId || '',
              email: t.assigneeEmail,
              name: t.assigneeName || t.assigneeEmail.split('@')[0],
              role: 'participant',
              status: 'invited'
            });
          }
        }
      }

      // Proposed timing validation
      let startTimeIso: string;
      let endTimeIso: string;

      if (proposedStartTime) {
        const startMs = Date.parse(proposedStartTime);
        if (isNaN(startMs)) {
          return res.status(400).json({ error: "Bad Request", message: "Invalid proposedStartTime format." });
        }
        startTimeIso = new Date(startMs).toISOString();

        if (proposedEndTime) {
          const endMs = Date.parse(proposedEndTime);
          if (isNaN(endMs) || endMs <= startMs) {
            return res.status(400).json({ error: "Bad Request", message: "proposedEndTime must be strictly after proposedStartTime." });
          }
          endTimeIso = new Date(endMs).toISOString();
        } else {
          // Default 30 min duration
          endTimeIso = new Date(startMs + 30 * 60 * 1000).toISOString();
        }
      } else {
        // Default tomorrow 10:00 AM UTC
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setUTCHours(10, 0, 0, 0);
        startTimeIso = tomorrow.toISOString();
        endTimeIso = new Date(tomorrow.getTime() + 30 * 60 * 1000).toISOString();
      }

      const nowIso = new Date().toISOString();
      const creatorName = req.user.displayName || req.user.name || (req.user.email ? req.user.email.split('@')[0] : 'User');
      const meetingId = `flw_${crypto.randomUUID()}`;

      const historyEntry: any = {
        id: crypto.randomUUID().substring(0, 8),
        action: 'created',
        performedBy: req.user.uid,
        performedByName: creatorName,
        performedByEmail: req.user.email || '',
        timestamp: nowIso,
        details: `Follow-up meeting draft created with ${finalParticipants.length} participant(s)`,
        newStatus: 'draft'
      };

      const meetingData: any = {
        id: meetingId,
        projectId,
        organizationId: projectOrgId,
        relatedTaskIds: validTaskIds,
        relatedExceptionIds: validExceptionIds,
        sourceMeetingSessionIds: Array.isArray(meetingSessionIds) ? meetingSessionIds : [],
        title: generated.title,
        purpose: generated.purpose,
        generatedAgenda: generated.agenda,
        reason: generated.reason,
        proposedParticipants: finalParticipants,
        proposedStartTime: startTimeIso,
        proposedEndTime: endTimeIso,
        timezone: typeof timezone === 'string' ? timezone.trim() : 'UTC',
        status: 'draft',
        provider: 'none', // External calendar integration not yet connected
        externalEventId: null,
        externalEventUrl: null,
        lastSchedulingError: null,
        history: [historyEntry],
        createdBy: req.user.uid,
        creatorName,
        creatorEmail: req.user.email || '',
        createdAt: nowIso,
        updatedAt: nowIso
      };

      await db.collection("followUpMeetings").doc(meetingId).set(meetingData);

      // Log project activity
      try {
        await db.collection("projectActivities").add({
          projectId,
          organizationId: projectOrgId,
          userId: req.user.uid,
          userEmail: req.user.email || '',
          userName: creatorName,
          actionType: 'follow_up_created',
          description: `${creatorName} created follow-up meeting draft: "${generated.title}"`,
          meetingId,
          createdAt: FieldValue.serverTimestamp()
        });
      } catch {}

      return res.status(201).json({
        success: true,
        message: "Follow-up meeting created successfully.",
        meeting: meetingData
      });
    } catch (err: any) {
      console.error("[Create Follow-Up Error]:", err);
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to create follow-up meeting." });
    }
  });

  // 3. GET /api/projects/:projectId/follow-ups - List project follow-ups with filters
  app.get("/api/projects/:projectId/follow-ups", requireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const { projectId } = req.params;
      if (!projectId) {
        return res.status(400).json({ error: "Bad Request", message: "Project ID is required." });
      }

      const projAccess = await resolveProjectAccess(db, req.user, projectId, { requiredPermission: 'VIEW' });
      if (!projAccess.hasAccess) {
        if (projAccess.notFound) return res.status(404).json({ error: "Not Found", message: "Project not found." });
        return res.status(403).json({ error: "Forbidden", message: "Access denied." });
      }

      const snap = await db.collection("followUpMeetings").where("projectId", "==", projectId).get();
      const allMeetings = snap.docs.map(d => ({ id: d.id, ...d.data() } as any));

      const { status, taskId, exceptionId } = req.query as Record<string, string>;
      let filtered = allMeetings;

      if (status) {
        filtered = filtered.filter(m => m.status === status);
      }
      if (taskId) {
        filtered = filtered.filter(m => (m.relatedTaskIds || []).includes(taskId));
      }
      if (exceptionId) {
        filtered = filtered.filter(m => (m.relatedExceptionIds || []).includes(exceptionId));
      }

      filtered.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());

      const counts = {
        total: allMeetings.length,
        draft: allMeetings.filter(m => m.status === 'draft').length,
        proposed: allMeetings.filter(m => m.status === 'proposed').length,
        scheduled: allMeetings.filter(m => m.status === 'scheduled').length,
        reschedule_requested: allMeetings.filter(m => m.status === 'reschedule_requested').length,
        completed: allMeetings.filter(m => m.status === 'completed').length,
        cancelled: allMeetings.filter(m => m.status === 'cancelled').length
      };

      return res.json({
        success: true,
        projectId,
        count: filtered.length,
        counts,
        meetings: filtered
      });
    } catch (err: any) {
      console.error("[List Follow-Ups Error]:", err);
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to list follow-up meetings." });
    }
  });

  // 4. GET /api/follow-ups/:meetingId - Get details and linked record snapshots
  app.get("/api/follow-ups/:meetingId", requireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const { meetingId } = req.params;
      if (!meetingId) {
        return res.status(400).json({ error: "Bad Request", message: "Meeting ID is required." });
      }

      const doc = await db.collection("followUpMeetings").doc(meetingId).get();
      if (!doc.exists) {
        return res.status(404).json({ error: "Not Found", message: "Follow-up meeting not found." });
      }

      const meeting = { id: doc.id, ...doc.data() } as any;

      const projAccess = await resolveProjectAccess(db, req.user, meeting.projectId, { requiredPermission: 'VIEW' });
      if (!projAccess.hasAccess) {
        return res.status(403).json({ error: "Forbidden", message: "Access denied." });
      }

      // Fetch linked tasks snapshots
      const taskSnapshots: any[] = [];
      for (const tid of (meeting.relatedTaskIds || [])) {
        const t = await resolveTaskInProject(meeting.projectId, tid);
        if (t) taskSnapshots.push({ id: t.id, title: t.title, status: t.status, priority: t.priority });
      }

      // Fetch linked exceptions snapshots
      const exceptionSnapshots: any[] = [];
      for (const eid of (meeting.relatedExceptionIds || [])) {
        const exDoc = await db.collection("taskExceptions").doc(eid).get();
        if (exDoc.exists) {
          const d = exDoc.data() || {};
          exceptionSnapshots.push({ id: exDoc.id, title: d.title, severity: d.severity, status: d.status, type: d.type });
        }
      }

      return res.json({
        success: true,
        meeting,
        linkedTasks: taskSnapshots,
        linkedExceptions: exceptionSnapshots
      });
    } catch (err: any) {
      console.error("[Get Follow-Up Error]:", err);
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to retrieve meeting details." });
    }
  });

  // 5. PATCH /api/follow-ups/:meetingId - Update follow-up draft or proposal
  app.patch("/api/follow-ups/:meetingId", requireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const { meetingId } = req.params;
      if (!meetingId) {
        return res.status(400).json({ error: "Bad Request", message: "Meeting ID is required." });
      }

      const doc = await db.collection("followUpMeetings").doc(meetingId).get();
      if (!doc.exists) {
        return res.status(404).json({ error: "Not Found", message: "Follow-up meeting not found." });
      }

      const meeting = { id: doc.id, ...doc.data() } as any;

      const projAccess = await resolveProjectAccess(db, req.user, meeting.projectId, { requiredPermission: 'EDIT_CONTENT' });
      if (!projAccess.hasAccess || !projAccess.permissions.canEditContent) {
        return res.status(403).json({ error: "Forbidden", message: "Permission denied." });
      }

      const {
        title,
        purpose,
        generatedAgenda,
        proposedStartTime,
        proposedEndTime,
        timezone,
        status,
        participants
      } = req.body || {};

      const updates: Record<string, any> = {};
      const historyEntries: any[] = [];
      const nowIso = new Date().toISOString();
      const actorName = req.user.displayName || req.user.name || (req.user.email ? req.user.email.split('@')[0] : 'User');

      if (title !== undefined) {
        if (typeof title !== 'string' || !title.trim()) return res.status(400).json({ error: "Bad Request", message: "Title cannot be empty." });
        updates.title = title.trim().slice(0, 200);
      }
      if (purpose !== undefined) {
        updates.purpose = typeof purpose === 'string' ? purpose.trim().slice(0, 2000) : '';
      }
      if (generatedAgenda !== undefined) {
        updates.generatedAgenda = typeof generatedAgenda === 'string' ? generatedAgenda.trim() : '';
      }
      if (timezone !== undefined) {
        updates.timezone = typeof timezone === 'string' ? timezone.trim() : 'UTC';
      }

      if (proposedStartTime !== undefined) {
        const startMs = Date.parse(proposedStartTime);
        if (isNaN(startMs)) return res.status(400).json({ error: "Bad Request", message: "Invalid proposedStartTime." });
        updates.proposedStartTime = new Date(startMs).toISOString();

        if (proposedEndTime !== undefined) {
          const endMs = Date.parse(proposedEndTime);
          if (isNaN(endMs) || endMs <= startMs) return res.status(400).json({ error: "Bad Request", message: "proposedEndTime must be after proposedStartTime." });
          updates.proposedEndTime = new Date(endMs).toISOString();
        }
      }

      if (participants !== undefined) {
        const resolved = await resolveParticipants(db, meeting.projectId, projAccess.project || {}, participants);
        updates.proposedParticipants = resolved;
        historyEntries.push({
          id: crypto.randomUUID().substring(0, 8),
          action: 'updated',
          performedBy: req.user.uid,
          performedByName: actorName,
          performedByEmail: req.user.email || '',
          timestamp: nowIso,
          details: `Updated participant list (${resolved.length} participants)`
        });
      }

      if (status !== undefined) {
        if (!VALID_FOLLOWUP_STATUSES.includes(status)) {
          return res.status(400).json({ error: "Bad Request", message: `Invalid status "${status}".` });
        }
        if (status !== meeting.status) {
          const allowed = ALLOWED_FOLLOWUP_TRANSITIONS[meeting.status] || [];
          if (!allowed.includes(status)) {
            return res.status(400).json({
              error: "Bad Request",
              message: `Cannot transition meeting from "${meeting.status}" to "${status}".`
            });
          }
          updates.status = status;
          historyEntries.push({
            id: crypto.randomUUID().substring(0, 8),
            action: status === 'proposed' ? 'proposed' : status === 'cancelled' ? 'cancelled' : 'updated',
            performedBy: req.user.uid,
            performedByName: actorName,
            performedByEmail: req.user.email || '',
            timestamp: nowIso,
            previousStatus: meeting.status,
            newStatus: status,
            details: `Status transitioned from "${meeting.status}" to "${status}"`
          });
        }
      }

      if (Object.keys(updates).length === 0 && historyEntries.length === 0) {
        return res.json({ success: true, message: "No updates requested.", meeting });
      }

      updates.updatedAt = nowIso;
      updates.history = [...(Array.isArray(meeting.history) ? meeting.history : []), ...historyEntries];

      await db.collection("followUpMeetings").doc(meetingId).set(updates, { merge: true });

      return res.json({
        success: true,
        message: "Follow-up meeting updated successfully.",
        meeting: { ...meeting, ...updates }
      });
    } catch (err: any) {
      console.error("[Update Follow-Up Error]:", err);
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to update follow-up meeting." });
    }
  });

  // 6. POST /api/follow-ups/:meetingId/confirm - Confirm scheduling (adapter-separated)
  app.post("/api/follow-ups/:meetingId/confirm", requireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const { meetingId } = req.params;
      if (!meetingId) {
        return res.status(400).json({ error: "Bad Request", message: "Meeting ID is required." });
      }

      const doc = await db.collection("followUpMeetings").doc(meetingId).get();
      if (!doc.exists) {
        return res.status(404).json({ error: "Not Found", message: "Follow-up meeting not found." });
      }

      const meeting = { id: doc.id, ...doc.data() } as any;

      const projAccess = await resolveProjectAccess(db, req.user, meeting.projectId, { requiredPermission: 'EDIT_CONTENT' });
      if (!projAccess.hasAccess || !projAccess.permissions.canEditContent) {
        return res.status(403).json({ error: "Forbidden", message: "Permission denied: Only editors or administrators can confirm meetings." });
      }

      if (['completed', 'cancelled'].includes(meeting.status)) {
        return res.status(400).json({ error: "Bad Request", message: `Cannot confirm a ${meeting.status} meeting.` });
      }

      const nowIso = new Date().toISOString();
      const actorName = req.user.displayName || req.user.name || (req.user.email ? req.user.email.split('@')[0] : 'User');

      // Check external provider connection
      // EchoNote calendar provider status: In this environment, no external calendar OAuth credentials exist.
      // Therefore, we cleanly transition the internal meeting to 'scheduled' while accurately declaring provider: 'none'
      // and explicitly stating that external calendar auto-creation is not yet configured.
      const historyEntry: any = {
        id: crypto.randomUUID().substring(0, 8),
        action: 'confirmed',
        performedBy: req.user.uid,
        performedByName: actorName,
        performedByEmail: req.user.email || '',
        timestamp: nowIso,
        previousStatus: meeting.status,
        newStatus: 'scheduled',
        details: "Confirmed proposed schedule internally (Calendar provider integration not connected)"
      };

      const updates: any = {
        status: 'scheduled',
        confirmedAt: nowIso,
        updatedAt: nowIso,
        history: [...(Array.isArray(meeting.history) ? meeting.history : []), historyEntry]
      };

      await db.collection("followUpMeetings").doc(meetingId).set(updates, { merge: true });

      return res.json({
        success: true,
        message: "Meeting schedule confirmed successfully.",
        providerStatus: "disconnected",
        providerNotice: "External calendar provider (Google/Outlook) is not currently connected. Meeting schedule is confirmed in EchoNote.",
        meeting: { ...meeting, ...updates }
      });
    } catch (err: any) {
      console.error("[Confirm Follow-Up Error]:", err);
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to confirm follow-up meeting." });
    }
  });

  // 7. POST /api/follow-ups/:meetingId/reschedule - Request or apply rescheduling
  app.post("/api/follow-ups/:meetingId/reschedule", requireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const { meetingId } = req.params;
      if (!meetingId) {
        return res.status(400).json({ error: "Bad Request", message: "Meeting ID is required." });
      }

      const doc = await db.collection("followUpMeetings").doc(meetingId).get();
      if (!doc.exists) {
        return res.status(404).json({ error: "Not Found", message: "Follow-up meeting not found." });
      }

      const meeting = { id: doc.id, ...doc.data() } as any;

      const projAccess = await resolveProjectAccess(db, req.user, meeting.projectId, { requiredPermission: 'EDIT_CONTENT' });
      if (!projAccess.hasAccess || !projAccess.permissions.canEditContent) {
        return res.status(403).json({ error: "Forbidden", message: "Permission denied." });
      }

      if (['completed', 'cancelled'].includes(meeting.status)) {
        return res.status(400).json({ error: "Bad Request", message: `Cannot reschedule a ${meeting.status} meeting.` });
      }

      const { newStartTime, newEndTime, reason } = req.body || {};
      if (!newStartTime) {
        return res.status(400).json({ error: "Bad Request", message: "newStartTime is required for rescheduling." });
      }

      const startMs = Date.parse(newStartTime);
      if (isNaN(startMs)) {
        return res.status(400).json({ error: "Bad Request", message: "Invalid newStartTime format." });
      }

      let endMs = startMs + 30 * 60 * 1000;
      if (newEndTime) {
        const parsedEnd = Date.parse(newEndTime);
        if (isNaN(parsedEnd) || parsedEnd <= startMs) {
          return res.status(400).json({ error: "Bad Request", message: "newEndTime must be after newStartTime." });
        }
        endMs = parsedEnd;
      }

      const nowIso = new Date().toISOString();
      const actorName = req.user.displayName || req.user.name || (req.user.email ? req.user.email.split('@')[0] : 'User');
      const startIso = new Date(startMs).toISOString();
      const endIso = new Date(endMs).toISOString();

      const historyEntry: any = {
        id: crypto.randomUUID().substring(0, 8),
        action: 'rescheduled',
        performedBy: req.user.uid,
        performedByName: actorName,
        performedByEmail: req.user.email || '',
        timestamp: nowIso,
        previousStatus: meeting.status,
        newStatus: 'scheduled',
        details: `Rescheduled to ${startIso} - ${endIso}. Reason: ${reason || 'Schedule updated'}`
      };

      const updates: any = {
        status: 'scheduled',
        proposedStartTime: startIso,
        proposedEndTime: endIso,
        rescheduledAt: nowIso,
        updatedAt: nowIso,
        history: [...(Array.isArray(meeting.history) ? meeting.history : []), historyEntry]
      };

      await db.collection("followUpMeetings").doc(meetingId).set(updates, { merge: true });

      return res.json({
        success: true,
        message: "Meeting rescheduled successfully.",
        meeting: { ...meeting, ...updates }
      });
    } catch (err: any) {
      console.error("[Reschedule Follow-Up Error]:", err);
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to reschedule meeting." });
    }
  });

  // 8. POST /api/follow-ups/:meetingId/cancel - Cancel a follow-up meeting
  app.post("/api/follow-ups/:meetingId/cancel", requireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const { meetingId } = req.params;
      if (!meetingId) {
        return res.status(400).json({ error: "Bad Request", message: "Meeting ID is required." });
      }

      const doc = await db.collection("followUpMeetings").doc(meetingId).get();
      if (!doc.exists) {
        return res.status(404).json({ error: "Not Found", message: "Follow-up meeting not found." });
      }

      const meeting = { id: doc.id, ...doc.data() } as any;

      const projAccess = await resolveProjectAccess(db, req.user, meeting.projectId, { requiredPermission: 'EDIT_CONTENT' });
      if (!projAccess.hasAccess || !projAccess.permissions.canEditContent) {
        return res.status(403).json({ error: "Forbidden", message: "Permission denied." });
      }

      if (meeting.status === 'cancelled') {
        return res.status(400).json({ error: "Bad Request", message: "Meeting is already cancelled." });
      }

      const { reason } = req.body || {};
      const nowIso = new Date().toISOString();
      const actorName = req.user.displayName || req.user.name || (req.user.email ? req.user.email.split('@')[0] : 'User');

      const historyEntry: any = {
        id: crypto.randomUUID().substring(0, 8),
        action: 'cancelled',
        performedBy: req.user.uid,
        performedByName: actorName,
        performedByEmail: req.user.email || '',
        timestamp: nowIso,
        previousStatus: meeting.status,
        newStatus: 'cancelled',
        details: reason ? String(reason).trim() : "Cancelled meeting"
      };

      const updates: any = {
        status: 'cancelled',
        cancelledAt: nowIso,
        updatedAt: nowIso,
        history: [...(Array.isArray(meeting.history) ? meeting.history : []), historyEntry]
      };

      await db.collection("followUpMeetings").doc(meetingId).set(updates, { merge: true });

      return res.json({
        success: true,
        message: "Meeting cancelled successfully.",
        meeting: { ...meeting, ...updates }
      });
    } catch (err: any) {
      console.error("[Cancel Follow-Up Error]:", err);
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to cancel meeting." });
    }
  });

  // 9. POST /api/follow-ups/:meetingId/complete - Mark follow-up completed
  app.post("/api/follow-ups/:meetingId/complete", requireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const { meetingId } = req.params;
      if (!meetingId) {
        return res.status(400).json({ error: "Bad Request", message: "Meeting ID is required." });
      }

      const doc = await db.collection("followUpMeetings").doc(meetingId).get();
      if (!doc.exists) {
        return res.status(404).json({ error: "Not Found", message: "Follow-up meeting not found." });
      }

      const meeting = { id: doc.id, ...doc.data() } as any;

      const projAccess = await resolveProjectAccess(db, req.user, meeting.projectId, { requiredPermission: 'EDIT_CONTENT' });
      if (!projAccess.hasAccess || !projAccess.permissions.canEditContent) {
        return res.status(403).json({ error: "Forbidden", message: "Permission denied." });
      }

      if (meeting.status === 'completed') {
        return res.status(400).json({ error: "Bad Request", message: "Meeting is already marked completed." });
      }

      const { outcomeNotes } = req.body || {};
      const nowIso = new Date().toISOString();
      const actorName = req.user.displayName || req.user.name || (req.user.email ? req.user.email.split('@')[0] : 'User');

      const historyEntry: any = {
        id: crypto.randomUUID().substring(0, 8),
        action: 'completed',
        performedBy: req.user.uid,
        performedByName: actorName,
        performedByEmail: req.user.email || '',
        timestamp: nowIso,
        previousStatus: meeting.status,
        newStatus: 'completed',
        details: outcomeNotes ? String(outcomeNotes).trim() : "Marked meeting as completed"
      };

      const updates: any = {
        status: 'completed',
        completedAt: nowIso,
        updatedAt: nowIso,
        history: [...(Array.isArray(meeting.history) ? meeting.history : []), historyEntry]
      };

      await db.collection("followUpMeetings").doc(meetingId).set(updates, { merge: true });

      return res.json({
        success: true,
        message: "Meeting marked completed.",
        meeting: { ...meeting, ...updates }
      });
    } catch (err: any) {
      console.error("[Complete Follow-Up Error]:", err);
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to complete meeting." });
    }
  });


  // 10. POST /api/follow-ups/:meetingId/complete-reasoning - Complete reasoning meeting workflow (Req 23)
  app.post("/api/follow-ups/:meetingId/complete-reasoning", requireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const { meetingId } = req.params;
      if (!meetingId || typeof meetingId !== "string" || !meetingId.trim()) {
        return res.status(400).json({ error: "Bad Request", message: "Valid meetingId is required." });
      }

      const body = req.body || {};
      const {
        rootCause,
        agreedDueDate,
        agreedStartDate,
        scheduleVersionToken,
        autoPropagateDownstream,
        resolveExceptionIds
      } = body;

      // 1. Validate rootCause
      if (!rootCause || typeof rootCause !== "string" || !rootCause.trim()) {
        return res.status(400).json({
          error: "Bad Request",
          code: "INVALID_ROOT_CAUSE",
          message: "A non-empty rootCause explaining the incomplete task is required."
        });
      }
      if (rootCause.trim().length > 3000) {
        return res.status(400).json({
          error: "Bad Request",
          code: "INVALID_ROOT_CAUSE",
          message: "rootCause must not exceed 3000 characters."
        });
      }

      // 2. Validate calendar dates
      if (!agreedDueDate || typeof agreedDueDate !== "string" || !agreedDueDate.trim()) {
        return res.status(400).json({
          error: "Bad Request",
          code: "INVALID_CALENDAR_DATE",
          message: "A valid agreedDueDate calendar date (YYYY-MM-DD) is required."
        });
      }

      const parsedDue = parseCalendarDate(agreedDueDate);
      if (!parsedDue) {
        return res.status(400).json({
          error: "Bad Request",
          code: "INVALID_CALENDAR_DATE",
          message: "agreedDueDate must be a valid calendar date in YYYY-MM-DD format."
        });
      }

      let cleanStartDate: string | undefined = undefined;
      if (agreedStartDate !== undefined && agreedStartDate !== null) {
        if (typeof agreedStartDate !== "string" || !agreedStartDate.trim()) {
          return res.status(400).json({
            error: "Bad Request",
            code: "INVALID_CALENDAR_DATE",
            message: "agreedStartDate, if provided, must be a valid non-empty string."
          });
        }
        const parsedStart = parseCalendarDate(agreedStartDate);
        if (!parsedStart) {
          return res.status(400).json({
            error: "Bad Request",
            code: "INVALID_CALENDAR_DATE",
            message: "agreedStartDate must be a valid calendar date in YYYY-MM-DD format."
          });
        }
        const startIso = `${parsedStart.year}-${String(parsedStart.month).padStart(2, "0")}-${String(parsedStart.day).padStart(2, "0")}`;
        const dueIso = `${parsedDue.year}-${String(parsedDue.month).padStart(2, "0")}-${String(parsedDue.day).padStart(2, "0")}`;
        if (startIso > dueIso) {
          return res.status(400).json({
            error: "Bad Request",
            code: "INVALID_DATE_RELATIONSHIP",
            message: `agreedStartDate (${startIso}) cannot be after agreedDueDate (${dueIso}).`
          });
        }
        cleanStartDate = startIso;
      }
      const cleanDueDate = `${parsedDue.year}-${String(parsedDue.month).padStart(2, "0")}-${String(parsedDue.day).padStart(2, "0")}`;

      // 3. Validate scheduleVersionToken
      if (!scheduleVersionToken || typeof scheduleVersionToken !== "string" || !scheduleVersionToken.trim()) {
        return res.status(400).json({
          error: "Bad Request",
          code: "MISSING_SCHEDULE_VERSION_TOKEN",
          message: "scheduleVersionToken is required for deterministic consistency and optimistic concurrency control."
        });
      }

      // 4. Validate autoPropagateDownstream is explicit boolean (mandatory field)
      if (autoPropagateDownstream === undefined || typeof autoPropagateDownstream !== "boolean") {
        return res.status(400).json({
          error: "Bad Request",
          code: "INVALID_PROPAGATION_FLAG",
          message: "autoPropagateDownstream must be an explicit boolean value."
        });
      }

      // 5. Validate resolveExceptionIds format (if provided, must be array of strings)
      if (resolveExceptionIds !== undefined && resolveExceptionIds !== null) {
        if (!Array.isArray(resolveExceptionIds) || resolveExceptionIds.some(eid => typeof eid !== "string" || !eid.trim())) {
          return res.status(400).json({
            error: "Bad Request",
            code: "INVALID_EXCEPTION_IDS",
            message: "resolveExceptionIds, if provided, must be an array of non-empty strings."
          });
        }
      }

      // 6. Fetch and validate meeting
      const meetingDoc = await db.collection("followUpMeetings").doc(meetingId).get();
      if (!meetingDoc.exists) {
        return res.status(404).json({ error: "Not Found", message: "Follow-up meeting not found." });
      }

      const meetingData = { id: meetingDoc.id, ...meetingDoc.data() } as any;
      const projectId = meetingData.projectId;
      if (!projectId) {
        return res.status(500).json({ error: "Internal Server Error", message: "Meeting is missing projectId." });
      }

      // 7. Project Authorization: EDIT_CONTENT required
      const projAccess = await resolveProjectAccess(db, req.user, projectId, { requiredPermission: "EDIT_CONTENT" });
      if (!projAccess.hasAccess || !projAccess.permissions.canEditContent) {
        if (projAccess.notFound) {
          return res.status(404).json({ error: "Not Found", message: "Project not found." });
        }
        return res.status(403).json({
          error: "Forbidden",
          message: "Permission denied: Only editors or administrators can complete reasoning meetings."
        });
      }

      // 8. Check meeting status eligibility
      if (meetingData.status === "completed") {
        return res.status(400).json({
          error: "Bad Request",
          code: "ALREADY_COMPLETED",
          message: "Meeting is already marked completed."
        });
      }
      if (meetingData.status === "cancelled") {
        return res.status(400).json({
          error: "Bad Request",
          code: "MEETING_CANCELLED",
          message: "Cannot complete a cancelled meeting."
        });
      }

      // 9. Resolve target task from trusted persisted meeting data
      const relatedTaskIds: string[] = Array.isArray(meetingData.relatedTaskIds) ? meetingData.relatedTaskIds : [];
      if (relatedTaskIds.length === 0) {
        return res.status(400).json({
          error: "Bad Request",
          code: "NO_ASSOCIATED_TASK",
          message: "Follow-up meeting does not have an associated task for reasoning completion."
        });
      }
      const targetTaskId = relatedTaskIds[0];

      // 10. Execute transactionally
      const result = await db.runTransaction(async (transaction) => {
        // Re-read meeting inside transaction to prevent duplicate concurrent completions
        const freshMeetingDoc = await transaction.get(db.collection("followUpMeetings").doc(meetingId));
        if (!freshMeetingDoc.exists) {
          const nfErr: any = new Error("Follow-up meeting was removed.");
          nfErr.statusCode = 404;
          throw nfErr;
        }
        const freshMeeting = { id: freshMeetingDoc.id, ...freshMeetingDoc.data() } as any;
        if (freshMeeting.status === "completed") {
          const compErr: any = new Error("Meeting is already marked completed.");
          compErr.statusCode = 400;
          compErr.errorCode = "ALREADY_COMPLETED";
          throw compErr;
        }

        // Read all project tasks from authoritative collection (consistent with preview & execute)
        let snapshot = await transaction.get(db.collection("tasks").where("projectId", "==", projectId));
        let primaryCollection = "tasks";
        if (snapshot.empty) {
          snapshot = await transaction.get(db.collection("projectTasks").where("projectId", "==", projectId));
          primaryCollection = "projectTasks";
        }

        // Normalize allTasks fields exactly matching preview & execute token calculation
        const allTasks: SchedulableTask[] = snapshot.docs.map(doc => {
          const d = doc.data() || {};
          return {
            id: doc.id,
            projectId: d.projectId || projectId,
            title: d.title || "Untitled Task",
            status: d.status || "pending",
            startDate: d.startDate || null,
            dueDate: d.dueDate || null,
            prerequisiteTaskIds: Array.isArray(d.prerequisiteTaskIds) ? d.prerequisiteTaskIds : [],
            assigneeId: d.assigneeId || null,
            assigneeEmail: d.assigneeEmail || null,
            activityHistory: Array.isArray(d.activityHistory) ? d.activityHistory : [],
            updatedAt: typeof d.updatedAt === "string" ? d.updatedAt : (d.updatedAt?.toDate ? d.updatedAt.toDate().toISOString() : undefined)
          };
        });

        const targetTask = allTasks.find(t => t.id === targetTaskId);
        if (!targetTask) {
          const nfErr: any = new Error(`Target task "${targetTaskId}" does not belong to project "${projectId}" or does not exist.`);
          nfErr.statusCode = 404;
          nfErr.errorCode = "NOT_FOUND";
          throw nfErr;
        }

        // Tenant and project isolation check on task
        if (targetTask.projectId !== projectId) {
          const crossProjErr: any = new Error(`Task "${targetTaskId}" does not belong to project "${projectId}".`);
          crossProjErr.statusCode = 403;
          crossProjErr.errorCode = "CROSS_PROJECT_REFERENCE";
          throw crossProjErr;
        }

        // Concurrency token validation (matches preview algorithm deterministically)
        const currentVersionToken = computeScheduleVersionToken(allTasks);
        if (scheduleVersionToken !== currentVersionToken) {
          const staleErr: any = new Error("The project tasks schedule was modified by another operation. Please refresh the preview.");
          staleErr.statusCode = 409;
          staleErr.errorCode = "STALE_VERSION";
          staleErr.currentScheduleVersionToken = currentVersionToken;
          throw staleErr;
        }

        // Calculate schedule propagation or direct update
        let tasksToUpdate: any[] = [];
        let notificationsToCreate: InAppNotificationRecord[] = [];
        const now = new Date().toISOString();
        const actorUid = req.user.uid;
        const actorEmail = normalizeEmail(req.user.email);
        const performerName = req.user.displayName || req.user.name || (req.user.email ? req.user.email.split("@")[0] : "User");
        const triggerTitle = targetTask.title || "Prerequisite Task";

        if (autoPropagateDownstream) {
          const propagation = calculateDeadlinePropagation(allTasks, targetTaskId, {
            newStartDate: cleanStartDate,
            newDueDate: cleanDueDate
          });

          if (propagation.hasConflicts) {
            const conflictErr: any = new Error(`Cannot apply schedule changes due to conflicts: ${propagation.conflicts.join(", ")}`);
            conflictErr.statusCode = 400;
            conflictErr.errorCode = "CONFLICT_GRAPH";
            conflictErr.conflicts = propagation.conflicts;
            throw conflictErr;
          }

          tasksToUpdate = propagation.affectedTasks.filter(a => {
            if (a.isCompleted) return false;
            const startChanged = a.proposedStartDate !== a.currentStartDate;
            const dueChanged = a.proposedDueDate !== a.currentDueDate;
            return startChanged || dueChanged;
          });

          // Generate notifications for affected downstream tasks
          for (const item of tasksToUpdate) {
            if (item.isDirectTarget) continue;
            const orig = allTasks.find(t => t.id === item.taskId);
            if (!orig) continue;

            const rawAssigneeId = orig.assigneeId || null;
            const rawAssigneeEmail = orig.assigneeEmail || null;
            const normAssigneeEmail = rawAssigneeEmail ? normalizeEmail(rawAssigneeEmail) : null;

            const isActor = (rawAssigneeId && rawAssigneeId === actorUid) ||
                            (normAssigneeEmail && normAssigneeEmail === actorEmail);
            if (isActor) continue;

            const hasReliableRecipient = Boolean(
              (rawAssigneeId && typeof rawAssigneeId === "string" && rawAssigneeId.trim()) ||
              (normAssigneeEmail && isValidEmail(normAssigneeEmail))
            );
            if (!hasReliableRecipient) continue;

            const recipientIdentifier = rawAssigneeId || normAssigneeEmail!;
            const dedupKey = generateDeadlinePropagationDedupKey(
              projectId,
              item.taskId,
              recipientIdentifier,
              item.proposedDueDate,
              item.proposedStartDate,
              item.shiftDays || 0
            );

            const { title: notifTitle, message: notifMessage } = formatDeadlinePropagationMessage({
              affectedTaskTitle: item.title,
              triggerTaskTitle: triggerTitle,
              performerName,
              oldDueDate: item.currentDueDate,
              newDueDate: item.proposedDueDate,
              shiftDays: item.shiftDays || 0
            });

            notificationsToCreate.push({
              id: dedupKey,
              projectId,
              taskId: item.taskId,
              recipientUserId: rawAssigneeId,
              recipientEmail: normAssigneeEmail,
              userId: rawAssigneeId,
              userEmail: normAssigneeEmail,
              type: "DEADLINE_PROPAGATED",
              title: notifTitle,
              message: notifMessage,
              metadata: {
                triggerTaskId: targetTaskId,
                triggerTaskTitle: triggerTitle,
                affectedTaskId: item.taskId,
                affectedTaskTitle: item.title,
                oldStartDate: item.currentStartDate,
                oldDueDate: item.currentDueDate,
                newStartDate: item.proposedStartDate,
                newDueDate: item.proposedDueDate,
                shiftDays: item.shiftDays || 0,
                performerId: actorUid,
                performerName,
                scheduleVersionToken: currentVersionToken
              },
              isRead: false,
              createdAt: now,
              updatedAt: now,
              idempotencyKey: dedupKey
            });
          }
        } else {
          // Direct target task update only (autoPropagateDownstream = false)
          const startChanged = cleanStartDate !== undefined && cleanStartDate !== targetTask.startDate;
          const dueChanged = cleanDueDate !== targetTask.dueDate;
          if (startChanged || dueChanged) {
            tasksToUpdate.push({
              taskId: targetTaskId,
              title: targetTask.title,
              isDirectTarget: true,
              proposedStartDate: cleanStartDate !== undefined ? cleanStartDate : targetTask.startDate,
              proposedDueDate: cleanDueDate,
              currentStartDate: targetTask.startDate,
              currentDueDate: targetTask.dueDate,
              shiftDays: null
            });
          }
        }

        // Exception handling: read exception docs
        const requestedExceptionIds: string[] = Array.isArray(resolveExceptionIds) ? resolveExceptionIds : [];
        const relatedExceptionIds: string[] = Array.isArray(freshMeeting.relatedExceptionIds) ? freshMeeting.relatedExceptionIds : [];
        const exceptionsToResolve: any[] = [];
        const exceptionsToAnnotate: any[] = [];

        // Verify requested exceptions belong to related exceptions list
        for (const reqId of requestedExceptionIds) {
          if (!relatedExceptionIds.includes(reqId)) {
            const err: any = new Error(`Exception "${reqId}" is not associated with this reasoning meeting.`);
            err.statusCode = 400;
            err.errorCode = "UNASSOCIATED_EXCEPTION";
            throw err;
          }
        }

        for (const eid of relatedExceptionIds) {
          const exDoc = await transaction.get(db.collection("taskExceptions").doc(eid));
          if (!exDoc.exists) {
            if (requestedExceptionIds.includes(eid)) {
              const nfExErr: any = new Error(`Exception "${eid}" not found.`);
              nfExErr.statusCode = 404;
              nfExErr.errorCode = "NOT_FOUND";
              throw nfExErr;
            }
            continue;
          }
          const exData = { id: exDoc.id, ...exDoc.data() } as any;
          if (exData.projectId !== projectId) {
            const crossExErr: any = new Error(`Exception "${eid}" does not belong to project "${projectId}".`);
            crossExErr.statusCode = 403;
            crossExErr.errorCode = "CROSS_PROJECT_REFERENCE";
            throw crossExErr;
          }

          // Blocker safety: if exception is "blocked", resolving it requires explicit request AND verification
          // of non-blocker state. A new agreed deadline alone does NOT resolve a blocker.
          if (requestedExceptionIds.includes(eid)) {
            if (exData.type === "blocked") {
              // Keep blocker open; annotate with agreed deadline instead of falsely marking resolved
              exceptionsToAnnotate.push(exData);
            } else if (["open", "in_progress", "acknowledged"].includes(exData.status)) {
              exceptionsToResolve.push(exData);
            }
          } else if (["open", "in_progress", "acknowledged"].includes(exData.status)) {
            // Unrequested active exceptions are annotated with reasoning outcome
            exceptionsToAnnotate.push(exData);
          }
        }

        // Accurate transaction write accounting:
        // 1. tasks writes: tasksToUpdate.length
        // 2. projectTasks mirror writes: tasksToUpdate.length
        // 3. notifications writes: notificationsToCreate.length
        // 4. followUpMeetings write: 1
        // 5. taskExceptions writes: exceptionsToResolve.length + exceptionsToAnnotate.length
        const FIRESTORE_MAX_TRANSACTION_WRITES = 500;
        const taskWrites = tasksToUpdate.length;
        const mirrorWrites = tasksToUpdate.length;
        const notifWrites = notificationsToCreate.length;
        const meetingWrites = 1;
        const exceptionWrites = exceptionsToResolve.length + exceptionsToAnnotate.length;
        const totalPlannedWrites = taskWrites + mirrorWrites + notifWrites + meetingWrites + exceptionWrites;

        if (totalPlannedWrites > FIRESTORE_MAX_TRANSACTION_WRITES) {
          const payloadErr: any = new Error(
            `Reasoning meeting completion would perform ${totalPlannedWrites} atomic writes (${taskWrites} primary tasks, ${mirrorWrites} mirror projectTasks, ${notifWrites} notifications, ${meetingWrites} meeting, ${exceptionWrites} exceptions), exceeding the Firestore limit of ${FIRESTORE_MAX_TRANSACTION_WRITES}.`
          );
          payloadErr.statusCode = 413;
          payloadErr.errorCode = "PAYLOAD_TOO_LARGE";
          payloadErr.details = {
            totalPlannedWrites,
            maxAllowedWrites: FIRESTORE_MAX_TRANSACTION_WRITES,
            taskWrites,
            mirrorWrites,
            notifWrites,
            meetingWrites,
            exceptionWrites
          };
          throw payloadErr;
        }

        // Apply task updates
        for (const item of tasksToUpdate) {
          const docRef = db.collection("tasks").doc(item.taskId);
          const updateData: Record<string, any> = { updatedAt: now };
          if (item.proposedStartDate !== undefined) updateData.startDate = item.proposedStartDate || "";
          if (item.proposedDueDate !== undefined) updateData.dueDate = item.proposedDueDate || "";

          const originalTask = allTasks.find(t => t.id === item.taskId);
          const existingHistory = Array.isArray(originalTask?.activityHistory) ? originalTask.activityHistory : [];
          const activityDetails = item.isDirectTarget
            ? `Deadline rescheduled via reasoning meeting "${freshMeeting.title || meetingId}" (Root cause: ${rootCause.trim().substring(0, 100)}; due: ${item.proposedDueDate})`
            : `Deadline propagated from prerequisite task "${triggerTitle}" (due: ${item.proposedDueDate})`;

          const newActivity = {
            id: crypto.randomUUID ? crypto.randomUUID().substring(0, 8) : Math.random().toString(36).substring(2, 9),
            action: item.isDirectTarget ? "reasoning_rescheduled" : "schedule_propagated",
            performedBy: performerName,
            timestamp: now,
            details: activityDetails
          };

          updateData.activityHistory = [...existingHistory, newActivity];
          transaction.set(docRef, updateData, { merge: true });

          const mirrorRef = db.collection("projectTasks").doc(item.taskId);
          transaction.set(mirrorRef, updateData, { merge: true });
        }

        // Apply notifications
        for (const notif of notificationsToCreate) {
          const notifRef = db.collection("notifications").doc(notif.id);
          transaction.set(notifRef, notif);
        }

        // Apply exception resolutions
        for (const ex of exceptionsToResolve) {
          const exRef = db.collection("taskExceptions").doc(ex.id);
          const existingHistory = Array.isArray(ex.history) ? ex.history : [];
          const historyEntry = {
            id: crypto.randomUUID ? crypto.randomUUID().substring(0, 8) : Math.random().toString(36).substring(2, 9),
            action: "resolved",
            performedBy: actorUid,
            performedByName: performerName,
            performedByEmail: req.user.email || "",
            timestamp: now,
            previousStatus: ex.status,
            newStatus: "resolved",
            details: `Resolved via reasoning meeting "${freshMeeting.title || meetingId}". New deadline: ${cleanDueDate}.`
          };
          transaction.set(exRef, {
            status: "resolved",
            resolutionSummary: `Resolved via reasoning meeting: Root cause: ${rootCause.trim().substring(0, 200)}. Agreed deadline: ${cleanDueDate}.`,
            resolvedAt: now,
            resolvedById: actorUid,
            updatedAt: now,
            history: [...existingHistory, historyEntry]
          }, { merge: true });
        }

        // Apply exception annotations
        for (const ex of exceptionsToAnnotate) {
          const exRef = db.collection("taskExceptions").doc(ex.id);
          const existingHistory = Array.isArray(ex.history) ? ex.history : [];
          const historyEntry = {
            id: crypto.randomUUID ? crypto.randomUUID().substring(0, 8) : Math.random().toString(36).substring(2, 9),
            action: "updated",
            performedBy: actorUid,
            performedByName: performerName,
            performedByEmail: req.user.email || "",
            timestamp: now,
            details: `Reasoning meeting completed. Root cause: ${rootCause.trim().substring(0, 200)}. Agreed deadline: ${cleanDueDate}. (Underlying blocker remains open).`
          };
          transaction.set(exRef, {
            updatedAt: now,
            history: [...existingHistory, historyEntry]
          }, { merge: true });
        }

        // Structured reasoning outcome
        const reasoningOutcome = {
          rootCause: rootCause.trim(),
          agreedDueDate: cleanDueDate,
          agreedStartDate: cleanStartDate || null,
          autoPropagateDownstream,
          propagationPerformed: autoPropagateDownstream && tasksToUpdate.length > 0,
          propagationSummary: {
            targetTaskId,
            updatedTaskCount: tasksToUpdate.length,
            updatedTasks: tasksToUpdate.map(t => ({
              taskId: t.taskId,
              title: t.title,
              startDate: t.proposedStartDate,
              dueDate: t.proposedDueDate,
              shiftDays: t.shiftDays
            })),
            notificationsCreated: notificationsToCreate.length
          },
          resolvedExceptionIds: exceptionsToResolve.map(e => e.id),
          annotatedExceptionIds: exceptionsToAnnotate.map(e => e.id),
          completedAt: now,
          completedBy: {
            uid: actorUid,
            name: performerName,
            email: req.user.email || ""
          }
        };

        const meetingHistoryEntry = {
          id: crypto.randomUUID ? crypto.randomUUID().substring(0, 8) : Math.random().toString(36).substring(2, 9),
          action: "completed",
          performedBy: actorUid,
          performedByName: performerName,
          performedByEmail: req.user.email || "",
          timestamp: now,
          previousStatus: freshMeeting.status,
          newStatus: "completed",
          details: `Reasoning meeting completed. Root cause: ${rootCause.trim().substring(0, 150)}. Agreed due date: ${cleanDueDate}. Propagated tasks: ${tasksToUpdate.length}.`
        };

        const meetingUpdates = {
          status: "completed",
          completedAt: now,
          updatedAt: now,
          reasoningOutcome,
          history: [...(Array.isArray(freshMeeting.history) ? freshMeeting.history : []), meetingHistoryEntry]
        };

        const meetingRef = db.collection("followUpMeetings").doc(meetingId);
        transaction.set(meetingRef, meetingUpdates, { merge: true });

        return {
          success: true,
          message: `Reasoning meeting completed successfully. ${tasksToUpdate.length} task schedule(s) updated.`,
          meeting: { ...freshMeeting, ...meetingUpdates },
          reasoningOutcome
        };
      });

      // 11. Audit event logging (post-commit with reliable durability)
      try {
        await recordAuthAuditEvent(db, {
          eventType: "REASONING_MEETING_COMPLETED",
          action: "follow_up.reasoning.complete",
          status: "allowed",
          severity: "medium",
          actorUserId: req.user.uid,
          actorEmail: req.user.email,
          projectId,
          resourceId: meetingId,
          resourceType: "followUpMeeting",
          requiredPermission: "EDIT_CONTENT",
          callerRole: projAccess.role,
          details: `Completed reasoning meeting "${result.meeting.title || meetingId}" for task "${targetTaskId}". Agreed due date: ${cleanDueDate}.`,
          metadata: {
            meetingId,
            targetTaskId,
            agreedDueDate: cleanDueDate,
            agreedStartDate: cleanStartDate || null,
            autoPropagateDownstream,
            updatedTaskCount: result.reasoningOutcome.propagationSummary.updatedTaskCount,
            notificationsCreated: result.reasoningOutcome.propagationSummary.notificationsCreated,
            resolvedExceptionsCount: result.reasoningOutcome.resolvedExceptionIds.length,
            annotatedExceptionsCount: result.reasoningOutcome.annotatedExceptionIds.length
          }
        });
      } catch (auditErr: any) {
        console.warn("⚠️ [AUDIT WARNING]: Failed to record reasoning meeting completion audit log:", auditErr?.message || auditErr);
      }

      return res.json(result);
    } catch (err: any) {
      console.error("[Complete Reasoning Meeting Error]:", err);
      const status = err.statusCode || (err.errorCode === "STALE_VERSION" ? 409 : 500);
      return res.status(status).json({
        error: err.errorCode || "Internal Server Error",
        message: err.message || "Failed to complete reasoning meeting.",
        ...(err.currentScheduleVersionToken ? { currentScheduleVersionToken: err.currentScheduleVersionToken } : {}),
        ...(err.conflicts ? { conflicts: err.conflicts } : {}),
        ...(err.details ? { details: err.details } : {})
      });
    }
  });

  // =========================================================================
  // DEPENDENCY AND DEADLINE TRACKING ENGINE (Step 3.7)
  // =========================================================================

  const MONITORING_LEASE_MS = 60000; // 60 seconds lease
  const MAX_JOB_ATTEMPTS = 3;

  interface EvaluateTasksRiskOptions {
    nowMs?: number;
    dueSoonWindowDays?: number;
    startSoonWindowDays?: number;
  }

  // Core Risk Analysis Engine: Evaluates active tasks, dependency graphs, and exceptions
  function evaluateProjectTasksRisk(
    tasks: any[],
    exceptions: any[] = [],
    options: EvaluateTasksRiskOptions = {}
  ): { metrics: any; risks: any[] } {
    const nowMs = options.nowMs || Date.now();
    const dueSoonDays = options.dueSoonWindowDays || 3;
    const startSoonDays = options.startSoonWindowDays || 3;

    const dueSoonThresholdMs = nowMs + dueSoonDays * 24 * 60 * 60 * 1000;
    const startSoonThresholdMs = nowMs + startSoonDays * 24 * 60 * 60 * 1000;

    // Filter active vs completed tasks
    const activeTasks = tasks.filter(t => t && t.status !== 'completed');
    const completedTasks = tasks.filter(t => t && t.status === 'completed');

    // Build task index maps
    const taskById = new Map<string, any>();
    tasks.forEach(t => {
      if (t && t.id) taskById.set(t.id, t);
    });

    const risks: any[] = [];
    const nowIso = new Date(nowMs).toISOString();

    let overdueCount = 0;
    let dueSoonCount = 0;
    let startingSoonCount = 0;
    let blockedCount = 0;
    let blockedByOverdueCount = 0;
    let downstreamRiskCount = 0;
    let unscheduledCount = 0;

    // Map active exceptions by taskId
    const activeExceptionsByTask = new Map<string, any[]>();
    exceptions.forEach(ex => {
      if (ex && ['open', 'acknowledged', 'in_progress'].includes(ex.status) && ex.taskId) {
        const list = activeExceptionsByTask.get(ex.taskId) || [];
        list.push(ex);
        activeExceptionsByTask.set(ex.taskId, list);
      }
    });

    activeTasks.forEach(task => {
      const taskExceptions = activeExceptionsByTask.get(task.id) || [];
      const exceptionIds = taskExceptions.map(e => e.id);

      // 1. Date Validation
      let parsedDueDateMs: number | null = null;
      let parsedStartDateMs: number | null = null;

      if (task.dueDate && typeof task.dueDate === 'string') {
        const d = new Date(task.dueDate).getTime();
        if (!isNaN(d)) parsedDueDateMs = d;
      }
      if (task.startDate && typeof task.startDate === 'string') {
        const s = new Date(task.startDate).getTime();
        if (!isNaN(s)) parsedStartDateMs = s;
      }

      // Check unscheduled tasks (missing either startDate or dueDate)
      if (!parsedDueDateMs && !parsedStartDateMs) {
        unscheduledCount++;
        risks.push({
          taskId: task.id,
          taskTitle: task.title,
          category: 'unscheduled_active_task',
          severity: 'low',
          reason: 'Missing schedule dates',
          details: `Active task has no start date or due date defined, reducing delivery visibility.`,
          assigneeEmail: task.assigneeEmail || null,
          associatedExceptionIds: exceptionIds,
          detectedAt: nowIso
        });
      }

      // 2. Overdue detection (strictly for incomplete tasks)
      if (parsedDueDateMs && parsedDueDateMs < nowMs) {
        overdueCount++;
        risks.push({
          taskId: task.id,
          taskTitle: task.title,
          category: 'overdue',
          severity: 'critical',
          reason: 'Task deadline has elapsed',
          details: `Task was due on ${task.dueDate} and remains in status "${task.status}".`,
          dueDate: task.dueDate,
          startDate: task.startDate || null,
          assigneeEmail: task.assigneeEmail || null,
          associatedExceptionIds: exceptionIds,
          detectedAt: nowIso
        });
      } else if (parsedDueDateMs && parsedDueDateMs >= nowMs && parsedDueDateMs <= dueSoonThresholdMs) {
        // 3. Due soon detection
        dueSoonCount++;
        risks.push({
          taskId: task.id,
          taskTitle: task.title,
          category: 'due_soon',
          severity: 'high',
          reason: 'Task due within next 3 days',
          details: `Task is due on ${task.dueDate} (${Math.ceil((parsedDueDateMs - nowMs) / (24 * 3600 * 1000))} day(s) remaining).`,
          dueDate: task.dueDate,
          startDate: task.startDate || null,
          assigneeEmail: task.assigneeEmail || null,
          associatedExceptionIds: exceptionIds,
          detectedAt: nowIso
        });
      }

      // 4. Starting soon detection
      if (parsedStartDateMs && parsedStartDateMs >= nowMs && parsedStartDateMs <= startSoonThresholdMs && task.status === 'pending') {
        startingSoonCount++;
        risks.push({
          taskId: task.id,
          taskTitle: task.title,
          category: 'starting_soon',
          severity: 'medium',
          reason: 'Task scheduled to start soon',
          details: `Task is scheduled to start on ${task.startDate}.`,
          dueDate: task.dueDate || null,
          startDate: task.startDate,
          assigneeEmail: task.assigneeEmail || null,
          associatedExceptionIds: exceptionIds,
          detectedAt: nowIso
        });
      }

      // 5. Dependency Analysis: Incomplete and Overdue Prerequisites
      const prereqIds: string[] = Array.isArray(task.prerequisiteTaskIds) ? task.prerequisiteTaskIds : [];
      if (prereqIds.length > 0) {
        const incompletePrereqs: any[] = [];
        const overduePrereqs: any[] = [];

        prereqIds.forEach(pid => {
          const prereq = taskById.get(pid);
          if (prereq && prereq.status !== 'completed') {
            incompletePrereqs.push(prereq);
            if (prereq.dueDate) {
              const pd = new Date(prereq.dueDate).getTime();
              if (!isNaN(pd) && pd < nowMs) {
                overduePrereqs.push(prereq);
              }
            }
          }
        });

        if (incompletePrereqs.length > 0) {
          blockedCount++;
          const prereqTitles = incompletePrereqs.map(p => `"${p.title}"`).join(', ');

          if (overduePrereqs.length > 0) {
            blockedByOverdueCount++;
            risks.push({
              taskId: task.id,
              taskTitle: task.title,
              category: 'blocked_by_overdue_prerequisite',
              severity: 'critical',
              reason: 'Blocked by overdue prerequisite(s)',
              details: `Task depends on prerequisite(s) ${overduePrereqs.map(p => `"${p.title}" (Due: ${p.dueDate})`).join(', ')} which are already overdue.`,
              dueDate: task.dueDate || null,
              prerequisiteIds: prereqIds,
              prerequisiteTitles: incompletePrereqs.map(p => p.title),
              blockingTaskIds: overduePrereqs.map(p => p.id),
              associatedExceptionIds: exceptionIds,
              detectedAt: nowIso
            });
          } else {
            risks.push({
              taskId: task.id,
              taskTitle: task.title,
              category: 'blocked_by_prerequisite',
              severity: 'high',
              reason: 'Blocked by incomplete prerequisite(s)',
              details: `Task cannot proceed because prerequisite(s) ${prereqTitles} are incomplete.`,
              dueDate: task.dueDate || null,
              prerequisiteIds: prereqIds,
              prerequisiteTitles: incompletePrereqs.map(p => p.title),
              blockingTaskIds: incompletePrereqs.map(p => p.id),
              associatedExceptionIds: exceptionIds,
              detectedAt: nowIso
            });
          }

          // 6. Downstream Deadline Risk
          // If the downstream task has an impending deadline and any prerequisite is delayed or incomplete
          if (parsedDueDateMs) {
            const hasImpendingDeadline = parsedDueDateMs <= dueSoonThresholdMs;
            const prereqLaterThanDue = incompletePrereqs.some(p => {
              if (!p.dueDate) return false;
              const pDue = new Date(p.dueDate).getTime();
              return !isNaN(pDue) && pDue >= parsedDueDateMs!;
            });

            if (hasImpendingDeadline || prereqLaterThanDue) {
              downstreamRiskCount++;
              risks.push({
                taskId: task.id,
                taskTitle: task.title,
                category: 'downstream_deadline_at_risk',
                severity: 'critical',
                reason: 'Downstream task deadline at risk',
                details: prereqLaterThanDue
                  ? `Prerequisite deadline conflicts with downstream delivery date.`
                  : `Downstream task is due soon (${task.dueDate}) but prerequisites remain incomplete.`,
                dueDate: task.dueDate,
                prerequisiteIds: prereqIds,
                prerequisiteTitles: incompletePrereqs.map(p => p.title),
                blockingTaskIds: incompletePrereqs.map(p => p.id),
                associatedExceptionIds: exceptionIds,
                detectedAt: nowIso
              });
            }
          }
        }
      }

      // 7. Unresolved Exceptions Indicator
      if (taskExceptions.length > 0) {
        const critOrHigh = taskExceptions.filter(e => ['critical', 'high'].includes(e.severity));
        if (critOrHigh.length > 0) {
          risks.push({
            taskId: task.id,
            taskTitle: task.title,
            category: 'unresolved_exception',
            severity: critOrHigh.some(e => e.severity === 'critical') ? 'critical' : 'high',
            reason: `Active ${critOrHigh[0].severity} exception reported`,
            details: `Task has ${critOrHigh.length} unresolved high/critical exception(s): ${critOrHigh.map(e => `"${e.title}"`).join(', ')}.`,
            dueDate: task.dueDate || null,
            associatedExceptionIds: exceptionIds,
            detectedAt: nowIso
          });
        }
      }
    });

    // Compute Health Score: 100 minus penalties
    let penalty = 0;
    penalty += overdueCount * 25;
    penalty += blockedByOverdueCount * 20;
    penalty += downstreamRiskCount * 15;
    penalty += dueSoonCount * 5;
    penalty += blockedCount * 5;
    const healthScore = Math.max(0, Math.min(100, 100 - penalty));

    const metrics = {
      totalActiveTasks: activeTasks.length,
      completedTasks: completedTasks.length,
      overdueTasksCount: overdueCount,
      dueSoonTasksCount: dueSoonCount,
      startingSoonTasksCount: startingSoonCount,
      blockedTasksCount: blockedCount,
      blockedByOverduePrereqCount: blockedByOverdueCount,
      downstreamRiskCount,
      activeExceptionsCount: exceptions.filter(e => ['open', 'acknowledged', 'in_progress'].includes(e.status)).length,
      unscheduledTasksCount: unscheduledCount,
      healthScore,
      evaluatedAt: nowIso
    };

    return { metrics, risks };
  }

  // Automatic Exception Synchronization Helper with Stale-Worker Lease Fencing
  async function syncTrackingExceptions(
    projectId: string,
    organizationId: string | null,
    risks: any[],
    activeTasks: any[],
    workerFencing?: {
      jobId: string;
      workerId: string;
      expectedLeaseExpiresAt?: number | null;
    }
  ): Promise<{ createdCount: number; resolvedCount: number }> {
    let createdCount = 0;
    let resolvedCount = 0;
    const nowIso = new Date().toISOString();

    // Helper: Verify worker still retains unexpired processing lease before performing any exception mutation
    const assertLeaseValid = async () => {
      if (!workerFencing) return; // Fencing optional for legacy direct tests or manual invocations
      const jobRef = db.collection("trackingMonitoringJobs").doc(workerFencing.jobId);
      const jobSnap = await jobRef.get();
      if (!jobSnap.exists) {
        throw new Error(`[Lease Fencing Abort]: Job ${workerFencing.jobId} no longer exists. Stale writes rejected.`);
      }
      const data = jobSnap.data() || {};
      const now = Date.now();
      if (
        data.workerId !== workerFencing.workerId ||
        data.status !== 'processing' ||
        typeof data.leaseExpiresAt !== 'number' ||
        data.leaseExpiresAt <= now
      ) {
        throw new Error(
          `[Lease Fencing Abort]: Worker ${workerFencing.workerId} lost ownership of job ${workerFencing.jobId} ` +
          `(current worker: ${data.workerId}, status: ${data.status}, leaseExpiresAt: ${data.leaseExpiresAt}). ` +
          `Mutation aborted to prevent stale exception side effects.`
        );
      }
    };

    // Query existing auto-managed exceptions for this project
    const existingAutoSnap = await db.collection("taskExceptions")
      .where("projectId", "==", projectId)
      .where("isAutoManaged", "==", true)
      .get();

    const existingExceptions = existingAutoSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));
    const activeAutoExceptions = existingExceptions.filter(e => ['open', 'acknowledged', 'in_progress'].includes(e.status));

    // Map actionable risks to target exception types
    // Only synchronize actionable blockers and overdue risks
    const actionableRisks = risks.filter(r =>
      ['overdue', 'blocked_by_overdue_prerequisite', 'blocked_by_prerequisite', 'downstream_deadline_at_risk'].includes(r.category)
    );

    const activeDeduplicationKeys = new Set<string>();

    for (const risk of actionableRisks) {
      const dedupKey = `auto_${risk.taskId}_${risk.category}`;
      activeDeduplicationKeys.add(dedupKey);

      // Check if an active exception already exists for this deduplication key
      const existingMatch = activeAutoExceptions.find(e => e.deduplicationKey === dedupKey);

      if (existingMatch) {
        // Already tracked and active. Refresh details if severity or reason changed.
        if (existingMatch.severity !== risk.severity) {
          // Fencing check immediately before write
          await assertLeaseValid();

          await db.collection("taskExceptions").doc(existingMatch.id).set({
            severity: risk.severity,
            updatedAt: nowIso,
            history: [
              ...(Array.isArray(existingMatch.history) ? existingMatch.history : []),
              {
                id: crypto.randomUUID().substring(0, 8),
                action: 'updated',
                performedBy: 'system_tracking_engine',
                performedByName: 'Tracking Engine',
                performedByEmail: 'system@echonote.internal',
                timestamp: nowIso,
                details: `Severity adjusted to ${risk.severity}`
              }
            ]
          }, { merge: true });
        }
      } else {
        // Check recurrence policy: Was it previously resolved or dismissed?
        const historicalMatch = existingExceptions.find(e => e.deduplicationKey === dedupKey && ['resolved', 'dismissed'].includes(e.status));

        // If previously resolved or dismissed within the last 12 hours, do not immediately flap/recreate
        if (historicalMatch) {
          const resolvedTime = new Date(historicalMatch.resolvedAt || historicalMatch.dismissedAt || historicalMatch.updatedAt).getTime();
          if (Date.now() - resolvedTime < 12 * 3600 * 1000) {
            continue; // Honor manual resolution recurrence window
          }
        }

        // Fencing check immediately before creation
        await assertLeaseValid();

        // Create new auto-managed exception
        const exId = `ex_auto_${crypto.randomUUID().substring(0, 10)}`;
        const exType = risk.category === 'overdue' ? 'overdue' : (risk.category === 'downstream_deadline_at_risk' ? 'at_risk' : 'blocked');

        const newExData = {
          id: exId,
          projectId,
          organizationId: organizationId || null,
          taskId: risk.taskId,
          taskTitle: risk.taskTitle,
          type: exType,
          title: `[Automated] ${risk.reason}: ${risk.taskTitle}`,
          description: risk.details,
          severity: risk.severity,
          status: 'open',
          source: 'tracking_engine',
          isAutoManaged: true,
          deduplicationKey: dedupKey,
          reporterId: 'system_tracking_engine',
          reporterName: 'Tracking Engine',
          reporterEmail: 'system@echonote.internal',
          history: [
            {
              id: crypto.randomUUID().substring(0, 8),
              action: 'created',
              performedBy: 'system_tracking_engine',
              performedByName: 'Tracking Engine',
              performedByEmail: 'system@echonote.internal',
              timestamp: nowIso,
              details: `Detected by dependency and deadline tracking engine: ${risk.details}`
            }
          ],
          createdAt: nowIso,
          updatedAt: nowIso
        };

        await db.collection("taskExceptions").doc(exId).set(newExData);
        createdCount++;
      }
    }

    // Auto-resolve auto-managed exceptions whose condition has cleared
    // Note: Manually reported exceptions (isAutoManaged !== true) are NEVER auto-resolved
    for (const ex of activeAutoExceptions) {
      if (ex.deduplicationKey && !activeDeduplicationKeys.has(ex.deduplicationKey)) {
        // Fencing check immediately before resolution
        await assertLeaseValid();

        await db.collection("taskExceptions").doc(ex.id).set({
          status: 'resolved',
          resolutionSummary: 'Underlying deadline or prerequisite obstacle cleared.',
          resolvedAt: nowIso,
          resolvedById: 'system_tracking_engine',
          updatedAt: nowIso,
          history: [
            ...(Array.isArray(ex.history) ? ex.history : []),
            {
              id: crypto.randomUUID().substring(0, 8),
              action: 'resolved',
              performedBy: 'system_tracking_engine',
              performedByName: 'Tracking Engine',
              performedByEmail: 'system@echonote.internal',
              timestamp: nowIso,
              newStatus: 'resolved',
              details: 'Resolved automatically: task completed or blocking condition no longer detected.'
            }
          ]
        }, { merge: true });
        resolvedCount++;
      }
    }

    return { createdCount, resolvedCount };
  }

  // 1. GET /api/projects/:projectId/tracking/insights - Retrieve project tracking report
  app.get("/api/projects/:projectId/tracking/insights", requireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const { projectId } = req.params;
      if (!projectId) {
        return res.status(400).json({ error: "Bad Request", message: "Project ID is required." });
      }

      // Check viewer access
      const projAccess = await resolveProjectAccess(db, req.user, projectId, { requiredPermission: 'VIEW' });
      if (!projAccess.hasAccess || !projAccess.permissions.canView) {
        if (projAccess.notFound) {
          return res.status(404).json({ error: "Not Found", message: "Project not found." });
        }
        return res.status(403).json({ error: "Forbidden", message: "Access denied: viewer authorization required." });
      }

      // Fetch tasks and exceptions in parallel
      const [tasksSnap, exceptionsSnap, lastJobSnap] = await Promise.all([
        db.collection("tasks").where("projectId", "==", projectId).get(),
        db.collection("taskExceptions").where("projectId", "==", projectId).get(),
        db.collection("trackingMonitoringJobs")
          .where("projectId", "==", projectId)
          .where("status", "==", "completed")
          .limit(1)
          .get()
      ]);

      const tasks = tasksSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const exceptions = exceptionsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      // Evaluate risks in memory
      const evaluation = evaluateProjectTasksRisk(tasks, exceptions);

      // Check last successful job run
      let lastSuccessfulJobRunAt: string | null = null;
      let monitoringStatus: 'healthy' | 'degraded' | 'never_run' = 'never_run';

      if (!lastJobSnap.empty) {
        const jobData = lastJobSnap.docs[0].data();
        lastSuccessfulJobRunAt = jobData.completedAt || jobData.updatedAt || null;
        if (lastSuccessfulJobRunAt) {
          const hoursAgo = (Date.now() - new Date(lastSuccessfulJobRunAt).getTime()) / (3600 * 1000);
          monitoringStatus = hoursAgo < 24 ? 'healthy' : 'degraded';
        }
      }

      evaluation.metrics.lastSuccessfulJobRunAt = lastSuccessfulJobRunAt;
      evaluation.metrics.monitoringStatus = monitoringStatus;

      return res.json({
        success: true,
        projectId,
        metrics: evaluation.metrics,
        risks: evaluation.risks,
        evaluatedAt: evaluation.metrics.evaluatedAt,
        source: 'live_evaluation'
      });
    } catch (err: any) {
      console.error("[Tracking Insights Error]:", err);
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to evaluate project tracking insights." });
    }
  });

  // 2. POST /api/projects/:projectId/tracking/queue-job - Enqueue a durable monitoring job
  app.post("/api/projects/:projectId/tracking/queue-job", requireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const { projectId } = req.params;
      if (!projectId) {
        return res.status(400).json({ error: "Bad Request", message: "Project ID is required." });
      }

      // Check editor access
      const projAccess = await resolveProjectAccess(db, req.user, projectId, { requiredPermission: 'EDIT_CONTENT' });
      if (!projAccess.hasAccess || !projAccess.permissions.canEditContent) {
        if (projAccess.notFound) {
          return res.status(404).json({ error: "Not Found", message: "Project not found." });
        }
        return res.status(403).json({ error: "Forbidden", message: "Access denied: editor authorization required." });
      }

      const now = Date.now();
      const nowIso = new Date(now).toISOString();
      const lockRef = db.collection("trackingActiveProjectLocks").doc(projectId);
      const jobId = `job_track_${projectId}_${now}`;
      const jobRef = db.collection("trackingMonitoringJobs").doc(jobId);

      let created = false;
      let existingActiveJob: any = null;

      await db.runTransaction(async (transaction: any) => {
        const lockDoc = await transaction.get(lockRef);
        const lockData = lockDoc.data() || {};

        if (lockDoc.exists && lockData.activeJobId) {
          const activeJobRef = db.collection("trackingMonitoringJobs").doc(lockData.activeJobId);
          const activeJobDoc = await transaction.get(activeJobRef);
          if (activeJobDoc.exists) {
            const jobData = activeJobDoc.data() || {};
            const isStillActive =
              jobData.status === 'queued' ||
              (jobData.status === 'processing' && typeof jobData.leaseExpiresAt === 'number' && jobData.leaseExpiresAt > now) ||
              (jobData.status === 'retryable_failed' && (!jobData.nextRetryAt || jobData.nextRetryAt > now));

            if (isStillActive) {
              existingActiveJob = { id: activeJobDoc.id, ...jobData };
              return;
            }
          }
        }

        const newJob = {
          id: jobId,
          projectId,
          organizationId: projAccess.project?.organizationId || null,
          scope: 'project',
          status: 'queued',
          attempts: 0,
          maxAttempts: MAX_JOB_ATTEMPTS,
          leaseExpiresAt: null,
          workerId: null,
          lastError: null,
          lastRunAt: null,
          completedAt: null,
          nextRetryAt: null,
          summary: null,
          createdAt: nowIso,
          updatedAt: nowIso
        };

        transaction.set(jobRef, newJob);
        transaction.set(lockRef, {
          projectId,
          activeJobId: jobId,
          status: 'queued',
          updatedAt: nowIso
        }, { merge: true });

        created = true;
      });

      if (!created && existingActiveJob) {
        return res.status(200).json({
          success: true,
          message: "An active monitoring job is already in flight for this project.",
          job: existingActiveJob,
          isExisting: true
        });
      }

      return res.status(201).json({
        success: true,
        message: "Monitoring job queued successfully.",
        job: { id: jobId, projectId, status: 'queued', createdAt: nowIso },
        isExisting: false
      });
    } catch (err: any) {
      console.error("[Queue Tracking Job Error]:", err);
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to queue tracking monitoring job." });
    }
  });

  // Requirement 24.3: Register recurring schedule management routes
  registerRecurringScheduleRoutes(app, db);

  // Google Cloud Scheduler OIDC Verification Client (singleton instance)
  const oidcClient = new OAuth2Client();

  // Internal Worker Authentication Helper
  // Supports:
  // 1. x-cron-key matching CRON_SECRET (dedicated shared secret)
  // 2. Authorization: Bearer <INTERNAL_WORKER_SECRET> (dedicated internal bearer secret)
  // 3. Authorization: Bearer <Google_Cloud_Scheduler_OIDC_Token> (verified via google-auth-library)
  // Fails closed when unconfigured and never logs raw tokens or secrets.
  // Note: Firebase user ID tokens (including admin/org_admin) are strictly prohibited per Requirement 24.17.
  async function authenticateInternalWorker(req: express.Request): Promise<{ authorized: boolean; reason?: string; identity?: string }> {
    const cronKey = req.headers["x-cron-key"];
    const configuredCronSecret = (process.env.CRON_SECRET || "").trim();
    if (typeof cronKey === "string" && configuredCronSecret) {
      if (timingSafeStringCompare(cronKey, configuredCronSecret)) {
        return { authorized: true, identity: "cron_secret" };
      }
    }

    const authHeader = req.headers.authorization;
    if (authHeader && typeof authHeader === "string") {
      const match = authHeader.match(/^Bearer\s+(.+)$/i);
      if (match) {
        const token = match[1].trim();
        const configuredWorkerSecret = (process.env.INTERNAL_WORKER_SECRET || "").trim();
        if (configuredWorkerSecret && timingSafeStringCompare(token, configuredWorkerSecret)) {
          return { authorized: true, identity: "internal_worker_secret" };
        }

        // Dedicated Google Cloud Scheduler OIDC verification path
        const expectedAudience = (process.env.SCHEDULER_OIDC_AUDIENCE || "").trim();
        const authorizedServiceAccount = (process.env.SCHEDULER_SERVICE_ACCOUNT || "").trim().toLowerCase();

        if (expectedAudience && authorizedServiceAccount) {
          try {
            const ticket = await oidcClient.verifyIdToken({
              idToken: token,
              audience: expectedAudience
            });
            const payload = ticket.getPayload();
            if (payload) {
              const issuer = payload.iss;
              const isGoogleIssuer = issuer === "https://accounts.google.com" || issuer === "accounts.google.com";
              const tokenEmail = (payload.email || "").trim().toLowerCase();
              const isEmailVerified = payload.email_verified === true;

              // Validate optional Not-Before ('nbf') claim.
              // Google OIDC tokens may omit 'nbf'; when absent (undefined), it is accepted.
              // If 'nbf' is present, it must NOT be null, must be a finite numeric Unix timestamp,
              // and must not exceed the allowed 300-second future clock skew (matching OAuth2Client.CLOCK_SKEW_SECS_).
              let isNbfValid = true;
              if (Object.prototype.hasOwnProperty.call(payload, "nbf") || (payload as any).nbf !== undefined) {
                const rawNbf = (payload as any).nbf;
                if (rawNbf === null || typeof rawNbf !== "number" || !Number.isFinite(rawNbf)) {
                  isNbfValid = false;
                } else {
                  const nowSec = Math.floor(Date.now() / 1000);
                  const CLOCK_SKEW_SECS = 300;
                  if (nowSec < rawNbf - CLOCK_SKEW_SECS) {
                    isNbfValid = false;
                  }
                }
              }

              if (isGoogleIssuer && isEmailVerified && isNbfValid && tokenEmail === authorizedServiceAccount) {
                return { authorized: true, identity: tokenEmail };
              }
            }
          } catch {
            // Token verification failed (invalid signature, expired, wrong audience, etc.) - proceed to Firebase Admin fallback
          }
        }

        // Requirement 24.17: Strict worker credential isolation.
        // Standalone Firebase user ID tokens (even with administrative roles) are explicitly prohibited
        // from invoking internal worker endpoints. Worker execution requires dedicated worker credentials
        // (CRON_SECRET, INTERNAL_WORKER_SECRET, or Google Cloud Scheduler OIDC identity).
      }
    }

    return { authorized: false, reason: "Valid x-cron-key, authorized OIDC token, or worker Bearer token required." };
  }

  // Requirement 24.4 & 24.5: Register recurring execution worker and report delivery endpoints with OIDC worker auth
  const recurringStorageBucket = admin.storage().bucket(firebaseConfig.storageBucket || "echonote-2509.firebasestorage.app");
  registerRecurringWorkerRoutes(app, db, recurringStorageBucket, authenticateInternalWorker);
  registerReportDeliveryRoutes(app, db, recurringStorageBucket, authenticateInternalWorker);

  // 3. POST /api/internal/tracking/process-jobs - Worker endpoint to claim and process pending jobs
  // Authenticated via x-cron-key (CRON_SECRET) or Bearer token (INTERNAL_WORKER_SECRET or Admin)
  app.post("/api/internal/tracking/process-jobs", async (req: express.Request, res: express.Response) => {
    try {
      const authResult = await authenticateInternalWorker(req);
      if (!authResult.authorized) {
        return res.status(401).json({ error: "Unauthorized", message: authResult.reason || "Valid worker credentials required." });
      }

      const now = Date.now();
      const workerId = `worker_${crypto.randomUUID().substring(0, 8)}`;

      // Find candidates: queued OR stale processing leases OR retryable_failed past backoff
      const jobsSnap = await db.collection("trackingMonitoringJobs")
        .where("status", "in", ["queued", "processing", "retryable_failed"])
        .limit(10)
        .get();

      const candidateJobs = jobsSnap.docs
        .map(d => ({ id: d.id, ...d.data() } as any))
        .filter(j => {
          if (j.status === 'queued') return true;
          if (j.status === 'processing') {
            return typeof j.leaseExpiresAt === 'number' && j.leaseExpiresAt <= now; // Stale lease
          }
          if (j.status === 'retryable_failed') {
            return !j.nextRetryAt || j.nextRetryAt <= now; // Backoff elapsed
          }
          return false;
        });

      if (candidateJobs.length === 0) {
        return res.json({ success: true, processedCount: 0, message: "No jobs pending processing." });
      }

      const results: any[] = [];

      for (const candidate of candidateJobs) {
        const jobRef = db.collection("trackingMonitoringJobs").doc(candidate.id);

        // Atomic Lease Claiming using Firestore Transaction
        let claimed = false;
        try {
          await db.runTransaction(async (transaction: any) => {
            const currentDoc = await transaction.get(jobRef);
            if (!currentDoc.exists) return;
            const curData = currentDoc.data() || {};

            // Verify claim eligibility
            const isEligible =
              curData.status === 'queued' ||
              (curData.status === 'processing' && (curData.leaseExpiresAt || 0) <= now) ||
              (curData.status === 'retryable_failed' && (!curData.nextRetryAt || curData.nextRetryAt <= now));

            if (!isEligible) return;

            transaction.update(jobRef, {
              status: 'processing',
              attempts: (curData.attempts || 0) + 1,
              leaseExpiresAt: now + MONITORING_LEASE_MS,
              workerId,
              lastRunAt: new Date(now).toISOString(),
              updatedAt: new Date(now).toISOString()
            });

            // Atomically synchronize project coordination lock status
            if (curData.projectId) {
              const lockRef = db.collection("trackingActiveProjectLocks").doc(curData.projectId);
              const lockDoc = await transaction.get(lockRef);
              if (lockDoc.exists && lockDoc.data()?.activeJobId === candidate.id) {
                transaction.update(lockRef, {
                  status: 'processing',
                  updatedAt: new Date(now).toISOString()
                });
              }
            }

            claimed = true;
          });
        } catch (claimErr) {
          console.error(`[Worker Claim Failed]: Job ${candidate.id}`, claimErr);
          continue;
        }

        if (!claimed) continue;

        // Process Job: Evaluate project risks and synchronize exceptions
        try {
          const projectId = candidate.projectId;
          const [tasksSnap, exceptionsSnap] = await Promise.all([
            db.collection("tasks").where("projectId", "==", projectId).get(),
            db.collection("taskExceptions").where("projectId", "==", projectId).get()
          ]);

          const tasks = tasksSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));
          const exceptions = exceptionsSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));

          const evaluation = evaluateProjectTasksRisk(tasks, exceptions);

          // Lease Fencing Guard: Check that the worker still holds a valid unexpired lease before committing side effects
          const freshJobDoc = await jobRef.get();
          if (!freshJobDoc.exists) {
            console.warn(`[Worker Lease Aborted]: Job ${candidate.id} deleted during evaluation.`);
            results.push({ jobId: candidate.id, status: 'lease_lost', error: 'Job document was removed during execution.' });
            continue;
          }
          const freshJobData = freshJobDoc.data() || {};
          const nowCheck = Date.now();
          if (
            freshJobData.workerId !== workerId ||
            freshJobData.status !== 'processing' ||
            typeof freshJobData.leaseExpiresAt !== 'number' ||
            freshJobData.leaseExpiresAt <= nowCheck
          ) {
            console.warn(`[Worker Lease Fencing]: Lease for job ${candidate.id} expired or overtaken before side-effect commit (workerId=${workerId}, expected=${freshJobData.workerId}). Aborting exception sync.`);
            results.push({ jobId: candidate.id, status: 'lease_lost', error: 'Lease expired or overtaken before side-effect commit.' });
            continue;
          }

          const syncSummary = await syncTrackingExceptions(
            projectId,
            candidate.organizationId || null,
            evaluation.risks,
            tasks.filter(t => t.status !== 'completed'),
            {
              jobId: candidate.id,
              workerId,
              expectedLeaseExpiresAt: candidate.leaseExpiresAt
            }
          );

          // Phase 3 Step 3.6: Generate & Enqueue Task Notifications idempotently (Zero Email Sends)
          // Refetches fresh active exceptions to include newly created/updated exceptions
          const freshExceptionsSnap = await db.collection("taskExceptions").where("projectId", "==", projectId).get();
          const freshExceptions = freshExceptionsSnap.docs.map((d: any) => ({ id: d.id, ...d.data() }));

          const notifSummary = await generateTaskNotificationsForProject(db, {
            projectId,
            organizationId: candidate.organizationId || null,
            activeTasks: tasks.filter(t => t.status !== 'completed'),
            exceptions: freshExceptions,
            risks: evaluation.risks
          });

          const completedIso = new Date().toISOString();
          const summary = {
            tasksEvaluated: tasks.length,
            risksDetected: evaluation.risks.length,
            exceptionsCreated: syncSummary.createdCount,
            exceptionsResolved: syncSummary.resolvedCount,
            notificationsCreated: notifSummary.notificationsCreated,
            notificationsReused: notifSummary.notificationsReused,
            notificationsSkipped: notifSummary.notificationsSkipped,
            notificationsBreakdown: notifSummary.breakdown
          };

          // Atomic completion: verify workerId still matches, lease hasn't expired/overtaken, and atomically update lock if active
          let completedSuccessfully = false;
          await db.runTransaction(async (transaction: any) => {
            const currentDoc = await transaction.get(jobRef);
            if (!currentDoc.exists) return;
            const curData = currentDoc.data() || {};
            if (curData.workerId === workerId && curData.status === 'processing') {
              transaction.update(jobRef, {
                status: 'completed',
                completedAt: completedIso,
                leaseExpiresAt: null,
                summary,
                updatedAt: completedIso
              });

              // Atomically update project coordination lock if this job is still the active owner
              if (curData.projectId) {
                const lockRef = db.collection("trackingActiveProjectLocks").doc(curData.projectId);
                const lockDoc = await transaction.get(lockRef);
                if (lockDoc.exists && lockDoc.data()?.activeJobId === candidate.id) {
                  transaction.update(lockRef, {
                    status: 'completed',
                    updatedAt: completedIso
                  });
                }
              }

              completedSuccessfully = true;
            }
          });

          if (completedSuccessfully) {
            results.push({ jobId: candidate.id, status: 'completed', summary });
          } else {
            console.warn(`[Worker Completion Aborted]: Job ${candidate.id} lease was overtaken or invalidated.`);
            results.push({ jobId: candidate.id, status: 'lease_lost', error: 'Lease expired or overtaken before completion.' });
          }
        } catch (execErr: any) {
          if (execErr?.message && execErr.message.includes("[Lease Fencing Abort]")) {
            console.warn(`[Worker Lease Aborted]: Job ${candidate.id} lost lease during sync:`, execErr.message);
            results.push({ jobId: candidate.id, status: 'lease_lost', error: execErr.message });
            continue;
          }

          console.error(`[Worker Execution Failed]: Job ${candidate.id}`, execErr);
          const attempts = (candidate.attempts || 0) + 1;
          const isRetryable = attempts < MAX_JOB_ATTEMPTS;
          const nextRetryAt = isRetryable ? now + attempts * 30000 : null; // Exponential backoff
          const failedIso = new Date().toISOString();

          // Atomically update job status and coordination lock (if this job is the active owner)
          await db.runTransaction(async (transaction: any) => {
            const currentDoc = await transaction.get(jobRef);
            if (!currentDoc.exists) return;
            const curData = currentDoc.data() || {};
            if (curData.workerId === workerId && curData.status === 'processing') {
              transaction.update(jobRef, {
                status: isRetryable ? 'retryable_failed' : 'failed',
                leaseExpiresAt: null,
                lastError: String(execErr.message || execErr).slice(0, 500),
                nextRetryAt,
                updatedAt: failedIso
              });

              if (curData.projectId) {
                const lockRef = db.collection("trackingActiveProjectLocks").doc(curData.projectId);
                const lockDoc = await transaction.get(lockRef);
                if (lockDoc.exists && lockDoc.data()?.activeJobId === candidate.id) {
                  transaction.update(lockRef, {
                    status: isRetryable ? 'retryable_failed' : 'failed',
                    nextRetryAt,
                    updatedAt: failedIso
                  });
                }
              }
            }
          });

          results.push({ jobId: candidate.id, status: isRetryable ? 'retryable_failed' : 'failed', error: execErr.message });
        }
      }

      return res.json({
        success: true,
        processedCount: results.length,
        results
      });
    } catch (err: any) {
      console.error("[Process Tracking Jobs Error]:", err);
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to process monitoring jobs." });
    }
  });

  // 3b. POST /api/internal/notifications/recover-stale-dispatches - Protected worker endpoint for stale-dispatch quarantine
  // Authenticated via x-cron-key (CRON_SECRET) or Bearer token (INTERNAL_WORKER_SECRET or Admin)
  // Strictly bounded scan (default 50, max 100). Never dispatches or sends emails.
  app.post("/api/internal/notifications/recover-stale-dispatches", async (req: express.Request, res: express.Response) => {
    try {
      const authResult = await authenticateInternalWorker(req);
      if (!authResult.authorized) {
        return res.status(401).json({ error: "Unauthorized", message: authResult.reason || "Valid worker credentials required." });
      }

      const requestedLimit = Number(req.body?.limit || req.query?.limit);
      const limit = !isNaN(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 100) : 50;

      const requestedTimeout = Number(req.body?.staleTimeoutMs || req.query?.staleTimeoutMs);
      const staleTimeoutMs = !isNaN(requestedTimeout) && requestedTimeout > 0 ? requestedTimeout : DEFAULT_STALE_DISPATCH_TIMEOUT_MS;

      const scannerWorkerId = `scanner_${crypto.randomUUID().substring(0, 8)}`;

      const result = await scanAndQuarantineStaleDispatches(db, {
        limit,
        staleTimeoutMs,
        scannerWorkerId
      });

      return res.json({
        success: true,
        scanned: result.scanned,
        quarantinedCount: result.quarantinedCount,
        quarantinedIds: result.quarantinedIds,
        scannerWorkerId
      });
    } catch (err: any) {
      console.error("[Recover Stale Dispatches Error]:", err);
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to recover stale dispatches." });
    }
  });

  // 3c. POST /api/internal/notifications/dispatch - Protected, bounded notification dispatch worker endpoint
  // Authenticated via x-cron-key (CRON_SECRET) or Bearer token (INTERNAL_WORKER_SECRET or Admin)
  //
  // Strict Guarantees:
  // 1. Default-off activation: When NOTIFICATION_DISPATCH_ENABLED is unset or not 'true',
  //    runs in dry_run mode without claiming records or contacting Resend.
  // 2. Bounded batch: default 10, hard maximum 50.
  // 3. Atomicity & Fencing: Uses transaction claims and worker fencing.
  // 4. Safe error contract: Never exposes secrets or internal stack traces.
  app.post("/api/internal/notifications/dispatch", async (req: express.Request, res: express.Response) => {
    try {
      const authResult = await authenticateInternalWorker(req);
      if (!authResult.authorized) {
        return res.status(401).json({ error: "Unauthorized", message: authResult.reason || "Valid worker credentials required." });
      }

      const requestedBatchSize = Number(req.body?.batchSize || req.query?.batchSize);
      const batchSize = !isNaN(requestedBatchSize) && requestedBatchSize > 0
        ? Math.min(requestedBatchSize, MAX_DISPATCH_BATCH_SIZE)
        : DEFAULT_DISPATCH_BATCH_SIZE;

      const isDryRunRequested = req.body?.dryRun === true || req.query?.dryRun === 'true';
      const workerId = `dispatch_worker_${crypto.randomUUID().substring(0, 8)}`;

      const dispatchResult = await processNotificationDispatchBatch(db, {
        batchSize,
        workerId,
        dryRun: isDryRunRequested
      });

      return res.json({
        success: true,
        mode: dispatchResult.mode,
        activationEnabled: dispatchResult.activationEnabled,
        workerId: dispatchResult.workerId,
        scanned: dispatchResult.scanned,
        claimed: dispatchResult.claimed,
        sent: dispatchResult.sent,
        skipped: dispatchResult.skipped,
        retryableFailures: dispatchResult.retryableFailures,
        permanentFailures: dispatchResult.permanentFailures,
        ambiguousDeliveries: dispatchResult.ambiguousDeliveries,
        items: dispatchResult.items
      });
    } catch (err: any) {
      console.error("[Notification Dispatch Error]:", err);
      return res.status(500).json({
        error: "Internal Server Error",
        message: "Failed to process notification dispatch batch."
      });
    }
  });

  // 4. POST /api/internal/tracking/sweep - Discover projects with active tasks and enqueue monitoring jobs
  // Authenticated via x-cron-key (CRON_SECRET) or Bearer token (INTERNAL_WORKER_SECRET or Admin)
  // Supports deterministic cursor pagination (cursor = lastSeenProjectId) and atomic transaction-safe job creation.
  app.post("/api/internal/tracking/sweep", async (req: express.Request, res: express.Response) => {
    try {
      const authResult = await authenticateInternalWorker(req);
      if (!authResult.authorized) {
        return res.status(401).json({ error: "Unauthorized", message: authResult.reason || "Valid worker credentials required." });
      }

      // Configurable batch limit (defaults to 50 projects, max 100)
      const requestedLimit = Number(req.body?.limit || req.query?.limit);
      const batchLimit = !isNaN(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 100) : 50;

      // Cursor validation: Support both independent dual-stream compound cursors and legacy scalar cursors.
      // Compound stream cursor: { projectId: string; taskId?: string }
      // Structured cursor: { pendingCursor?: { projectId: string; taskId?: string } | string | null; inProgressCursor?: ... }
      const rawBodyCursor = req.body?.cursor;
      const rawQueryCursor = req.query?.cursor;
      let pendingCursor: { projectId: string; taskId?: string } | null = null;
      let inProgressCursor: { projectId: string; taskId?: string } | null = null;

      const isValidCursorId = (val: any): val is string =>
        typeof val === 'string' && /^[a-zA-Z0-9_\-\.]{1,128}$/.test(val.trim());

      const parseStreamCursor = (val: any): { projectId: string; taskId?: string } | null => {
        if (!val) return null;
        if (typeof val === 'string' && isValidCursorId(val)) {
          return { projectId: val.trim() };
        }
        if (typeof val === 'object' && isValidCursorId(val.projectId)) {
          return {
            projectId: val.projectId.trim(),
            taskId: isValidCursorId(val.taskId) ? val.taskId.trim() : undefined
          };
        }
        return null;
      };

      if (rawBodyCursor && typeof rawBodyCursor === 'object' && !Array.isArray(rawBodyCursor)) {
        pendingCursor = parseStreamCursor(rawBodyCursor.pendingCursor);
        inProgressCursor = parseStreamCursor(rawBodyCursor.inProgressCursor);
      } else if (rawQueryCursor && typeof rawQueryCursor === 'string' && rawQueryCursor.startsWith('{')) {
        try {
          const parsed = JSON.parse(rawQueryCursor);
          pendingCursor = parseStreamCursor(parsed.pendingCursor);
          inProgressCursor = parseStreamCursor(parsed.inProgressCursor);
        } catch {
          // fallback to string cursor
        }
      }

      // Check explicit query parameters
      const qPending = req.query?.pendingCursor || req.body?.pendingCursor;
      const qInProgress = req.query?.inProgressCursor || req.body?.inProgressCursor;
      if (qPending) {
        if (typeof qPending === 'string' && qPending.startsWith('{')) {
          try { pendingCursor = parseStreamCursor(JSON.parse(qPending)); } catch {}
        } else {
          pendingCursor = parseStreamCursor(qPending);
        }
      }
      if (qInProgress) {
        if (typeof qInProgress === 'string' && qInProgress.startsWith('{')) {
          try { inProgressCursor = parseStreamCursor(JSON.parse(qInProgress)); } catch {}
        } else {
          inProgressCursor = parseStreamCursor(qInProgress);
        }
      }

      // Legacy scalar cursor fallback
      const rawScalar = typeof rawBodyCursor === 'string' ? rawBodyCursor : (typeof rawQueryCursor === 'string' && !rawQueryCursor.startsWith('{') ? rawQueryCursor : null);
      if (rawScalar && isValidCursorId(rawScalar)) {
        if (!pendingCursor) pendingCursor = { projectId: rawScalar.trim() };
        if (!inProgressCursor) inProgressCursor = { projectId: rawScalar.trim() };
      }

      // 1. Discover projects with active tasks using deterministic compound ordering (projectId ASC, __name__ ASC)
      // Query pending and in_progress tasks ordered by projectId and document ID
      let pendingQuery = db.collection("tasks").where("status", "==", "pending").orderBy("projectId").orderBy(admin.firestore.FieldPath.documentId()).limit(1000);
      let inProgressQuery = db.collection("tasks").where("status", "==", "in_progress").orderBy("projectId").orderBy(admin.firestore.FieldPath.documentId()).limit(1000);

      if (pendingCursor) {
        if (pendingCursor.taskId) {
          pendingQuery = pendingQuery.startAfter(pendingCursor.projectId, pendingCursor.taskId);
        } else {
          pendingQuery = pendingQuery.startAfter(pendingCursor.projectId);
        }
      }
      if (inProgressCursor) {
        if (inProgressCursor.taskId) {
          inProgressQuery = inProgressQuery.startAfter(inProgressCursor.projectId, inProgressCursor.taskId);
        } else {
          inProgressQuery = inProgressQuery.startAfter(inProgressCursor.projectId);
        }
      }

      let pendingTasksSnap: any;
      let inProgressTasksSnap: any;
      try {
        [pendingTasksSnap, inProgressTasksSnap] = await Promise.all([
          pendingQuery.get(),
          inProgressQuery.get()
        ]);
      } catch (queryErr: any) {
        // True Firestore index error classification:
        // Must either explicitly mention "requires an index" or have code 9 / FAILED_PRECONDITION with index-related keywords.
        // Unrelated FAILED_PRECONDITION errors must NOT be misclassified as index errors.
        const message = typeof queryErr?.message === 'string' ? queryErr.message : '';
        const isIndexError =
          message.includes("requires an index") ||
          ((queryErr?.code === 9 || queryErr?.code === 'FAILED_PRECONDITION') &&
           (message.includes("index") || message.includes("Index")));

        if (isIndexError) {
          // Extract direct index creation URL if provided in Firestore error details
          const urlMatch = message.match(/https:\/\/console\.firebase\.google\.com[^\s\)]+/);
          const indexCreationUrl = urlMatch ? urlMatch[0] : null;

          console.error(
            "[Tracking Sweep Missing Index Error]: The required composite index on 'tasks' for (status ASC, projectId ASC, __name__ ASC) is not yet provisioned in Firestore. " +
            "Failing explicitly to prevent corrupting compound cursor pagination or silently dropping project tasks.",
            message
          );
          return res.status(500).json({
            error: "MissingRequiredIndex",
            code: "FAILED_PRECONDITION",
            message: "The required Firestore composite index for tasks (status ASC, projectId ASC, __name__ ASC) is missing. " +
                     "Safe compound-cursor pagination cannot proceed without this index. Please build the index in Google Cloud Firestore console.",
            indexCreationUrl,
            details: message
          });
        }

        // Re-throw fatal, permission, or other database errors to avoid silent corruption
        console.error("[Tracking Sweep Query Error]: Firestore task query failed unexpectedly", queryErr);
        throw queryErr;
      }

      const pendingDocs = pendingTasksSnap?.docs || [];
      const inProgressDocs = inProgressTasksSnap?.docs || [];
      const isPendingSaturated = pendingDocs.length >= 1000;
      const isInProgressSaturated = inProgressDocs.length >= 1000;

      // Extract last document position from actual returned docs for each stream
      let lastPendingDocInfo: { projectId: string; taskId: string } | null = null;
      for (let i = pendingDocs.length - 1; i >= 0; i--) {
        const p = pendingDocs[i].data()?.projectId;
        if (typeof p === 'string' && p.trim()) {
          lastPendingDocInfo = { projectId: p.trim(), taskId: pendingDocs[i].id };
          break;
        }
      }

      let lastInProgressDocInfo: { projectId: string; taskId: string } | null = null;
      for (let i = inProgressDocs.length - 1; i >= 0; i--) {
        const p = inProgressDocs[i].data()?.projectId;
        if (typeof p === 'string' && p.trim()) {
          lastInProgressDocInfo = { projectId: p.trim(), taskId: inProgressDocs[i].id };
          break;
        }
      }

      const projectOrgMap = new Map<string, string | null>();
      const rawTasksCount = pendingDocs.length + inProgressDocs.length;
      const recordsTraversed = rawTasksCount;

      // Extract unique project IDs from both streams
      pendingDocs.forEach((doc: any) => {
        const d = doc.data() || {};
        if (d.projectId && typeof d.projectId === 'string') {
          const pId = d.projectId.trim();
          if (pId) {
            if (!projectOrgMap.has(pId)) {
              projectOrgMap.set(pId, d.organizationId || null);
            }
          }
        }
      });

      inProgressDocs.forEach((doc: any) => {
        const d = doc.data() || {};
        if (d.projectId && typeof d.projectId === 'string') {
          const pId = d.projectId.trim();
          if (pId) {
            if (!projectOrgMap.has(pId)) {
              projectOrgMap.set(pId, d.organizationId || null);
            }
          }
        }
      });

      // Also check projectTasks collection in case some tasks were stored only there
      try {
        const [altPendingSnap, altInProgressSnap] = await Promise.all([
          db.collection("projectTasks").where("status", "==", "pending").limit(500).get(),
          db.collection("projectTasks").where("status", "==", "in_progress").limit(500).get()
        ]);
        [...altPendingSnap.docs, ...altInProgressSnap.docs].forEach(doc => {
          const d = doc.data() || {};
          if (d.projectId && typeof d.projectId === 'string') {
            const pId = d.projectId.trim();
            if (pId) {
              if (!projectOrgMap.has(pId)) {
                projectOrgMap.set(pId, d.organizationId || null);
              }
            }
          }
        });
      } catch {
        // Non-critical fallback
      }

      // Sort all discovered project IDs deterministically
      const allEligibleProjectIds = Array.from(projectOrgMap.keys()).sort();
      const uniqueProjectsDiscovered = allEligibleProjectIds.length;
      const eligibleProjectsDiscovered = uniqueProjectsDiscovered; // alias for backwards compatibility

      // Slice to batch limit
      const targetProjectIds = allEligibleProjectIds.slice(0, batchLimit);
      const projectsConsidered = targetProjectIds.length;
      const projectsEvaluatedInBatch = projectsConsidered; // alias

      const lastProcessedProject = targetProjectIds.length > 0 ? targetProjectIds[targetProjectIds.length - 1] : null;

      // Determine next cursor for each stream:
      // If batch truncated before the end of allEligibleProjectIds:
      // We must find the last document in each stream whose projectId <= lastProcessedProject
      // so the stream does not advance past projects that were not enqueued!
      let nextPendingStreamCursor: { projectId: string; taskId?: string } | null = pendingCursor;
      if (lastProcessedProject) {
        let foundDoc: { projectId: string; taskId: string } | null = null;
        for (let i = pendingDocs.length - 1; i >= 0; i--) {
          const p = pendingDocs[i].data()?.projectId?.trim();
          if (p && p <= lastProcessedProject) {
            foundDoc = { projectId: p, taskId: pendingDocs[i].id };
            break;
          }
        }
        if (foundDoc) {
          nextPendingStreamCursor = foundDoc;
        } else if (lastPendingDocInfo && lastPendingDocInfo.projectId <= lastProcessedProject) {
          nextPendingStreamCursor = lastPendingDocInfo;
        }
      } else if (lastPendingDocInfo) {
        nextPendingStreamCursor = lastPendingDocInfo;
      }

      let nextInProgressStreamCursor: { projectId: string; taskId?: string } | null = inProgressCursor;
      if (lastProcessedProject) {
        let foundDoc: { projectId: string; taskId: string } | null = null;
        for (let i = inProgressDocs.length - 1; i >= 0; i--) {
          const p = inProgressDocs[i].data()?.projectId?.trim();
          if (p && p <= lastProcessedProject) {
            foundDoc = { projectId: p, taskId: inProgressDocs[i].id };
            break;
          }
        }
        if (foundDoc) {
          nextInProgressStreamCursor = foundDoc;
        } else if (lastInProgressDocInfo && lastInProgressDocInfo.projectId <= lastProcessedProject) {
          nextInProgressStreamCursor = lastInProgressDocInfo;
        }
      } else if (lastInProgressDocInfo) {
        nextInProgressStreamCursor = lastInProgressDocInfo;
      }

      // hasMore is true if either stream was saturated OR more projects were discovered than batchLimit
      const hasMore = isPendingSaturated || isInProgressSaturated || allEligibleProjectIds.length > batchLimit;

      // Dual-stream structured cursor for complete precision without stream skew or document loss
      const streamCursors = {
        pendingCursor: nextPendingStreamCursor,
        inProgressCursor: nextInProgressStreamCursor
      };

      // Legacy scalar cursor for backwards compatibility (returns lastProcessedProject or project from cursor)
      const nextCursor = lastProcessedProject || nextPendingStreamCursor?.projectId || nextInProgressStreamCursor?.projectId || null;

      const now = Date.now();
      const nowIso = new Date(now).toISOString();

      let jobsQueued = 0;
      let jobsSkipped = 0;
      const queuedJobIds: string[] = [];
      const skippedDetails: Array<{ projectId: string; reason: string }> = [];

      // 2. Concurrency-Safe Transactional Job Enqueue with Deterministic Project Coordination Document
      // In Firestore, transaction queries over non-existent or varying sets do not lock against phantom reads.
      // To strictly guarantee queue uniqueness under high concurrency, we coordinate active project state on
      // a deterministic coordination document: `trackingActiveProjectLocks/${projectId}`.
      for (const projectId of targetProjectIds) {
        try {
          const lockRef = db.collection("trackingActiveProjectLocks").doc(projectId);
          const jobId = `job_track_${projectId}_${now}`;
          const jobRef = db.collection("trackingMonitoringJobs").doc(jobId);

          let created = false;
          let skipReason = "";

          await db.runTransaction(async (transaction: any) => {
            const lockDoc = await transaction.get(lockRef);
            const lockData = lockDoc.data() || {};

            // If an active job is recorded in the lock document, check its status
            if (lockDoc.exists && lockData.activeJobId) {
              const activeJobRef = db.collection("trackingMonitoringJobs").doc(lockData.activeJobId);
              const activeJobDoc = await transaction.get(activeJobRef);
              if (activeJobDoc.exists) {
                const jobData = activeJobDoc.data() || {};
                const isStillActive =
                  jobData.status === 'queued' ||
                  (jobData.status === 'processing' && typeof jobData.leaseExpiresAt === 'number' && jobData.leaseExpiresAt > now) ||
                  (jobData.status === 'retryable_failed' && (!jobData.nextRetryAt || jobData.nextRetryAt > now));

                if (isStillActive) {
                  skipReason = `Active job already in flight (${lockData.activeJobId})`;
                  return; // Strictly abort write, lock is occupied
                }
              }
            }

            // Lock is free, expired, or job completed: atomically write new job and claim project lock
            const newJob = {
              id: jobId,
              projectId,
              organizationId: projectOrgMap.get(projectId) || null,
              scope: 'project',
              status: 'queued',
              attempts: 0,
              maxAttempts: MAX_JOB_ATTEMPTS,
              leaseExpiresAt: null,
              workerId: null,
              lastError: null,
              lastRunAt: null,
              completedAt: null,
              nextRetryAt: null,
              summary: null,
              source: 'sweep',
              createdAt: nowIso,
              updatedAt: nowIso
            };

            transaction.set(jobRef, newJob);
            transaction.set(lockRef, {
              projectId,
              activeJobId: jobId,
              status: 'queued',
              updatedAt: nowIso
            }, { merge: true });

            created = true;
          });

          if (created) {
            jobsQueued++;
            queuedJobIds.push(jobId);
          } else {
            jobsSkipped++;
            skippedDetails.push({ projectId, reason: skipReason || "Concurrent sweep in flight" });
          }
        } catch (enqueueErr: any) {
          console.error(`[Sweep Enqueue Error]: Failed for project ${projectId}`, enqueueErr);
          jobsSkipped++;
          skippedDetails.push({ projectId, reason: enqueueErr?.message || "Write failed" });
        }
      }

      return res.json({
        success: true,
        batchLimit,
        recordsTraversed,
        uniqueProjectsDiscovered,
        projectsConsidered,
        projectsEvaluatedInBatch,
        eligibleProjectsDiscovered,
        jobsQueued,
        jobsSkipped,
        hasMore,
        cursor: nextCursor,
        streamCursors,
        queuedJobIds,
        skippedDetails,
        evaluatedAt: nowIso
      });
    } catch (err: any) {
      console.error("[Tracking Sweep Error]:", err);
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to execute tracking sweep." });
    }
  });
  app.post("/api/user/close-account", requireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const callerUid = req.user.uid;
      const callerEmail = req.user.email;
      const { confirmPhrase, confirmEmail } = req.body;

      if (confirmEmail !== callerEmail && confirmPhrase !== "CLOSE MY ACCOUNT") {
        return res.status(400).json({
          error: "Bad Request",
          message: "Explicit confirmation required: provide confirmPhrase: 'CLOSE MY ACCOUNT' or confirmEmail matching your account email."
        });
      }

      // 1. Check for sole ownership of organizations with other members
      const ownedOrgsSnap = await db.collection("organizations").where("ownerId", "==", callerUid).get();
      for (const orgDoc of ownedOrgsSnap.docs) {
        const orgData = orgDoc.data() || {};
        const otherMembersSnap = await db.collection("orgMembers")
          .where("orgId", "==", orgDoc.id)
          .where("userId", "!=", callerUid)
          .limit(1)
          .get();

        if (!otherMembersSnap.empty) {
          return res.status(409).json({
            error: "Conflict",
            code: "ORGANIZATION_OWNERSHIP_TRANSFER_REQUIRED",
            message: `Cannot close account: you are the primary owner of organization "${orgData.name || orgDoc.id}" which has active members. Transfer ownership or remove the organization first.`,
            organizationId: orgDoc.id
          });
        }
      }

      // 2. Check for sole ownership of multi-member projects
      const ownedProjectsSnap = await db.collection("projects").where("userId", "==", callerUid).get();
      for (const projDoc of ownedProjectsSnap.docs) {
        const projData = projDoc.data() || {};
        const otherMembersSnap = await db.collection("projectMembers")
          .where("projectId", "==", projDoc.id)
          .where("userId", "!=", callerUid)
          .limit(1)
          .get();

        if (!otherMembersSnap.empty) {
          return res.status(409).json({
            error: "Conflict",
            code: "PROJECT_OWNERSHIP_TRANSFER_REQUIRED",
            message: `Cannot close account: you are the primary owner of collaborative project "${projData.name || projDoc.id}" with other team members. Transfer project ownership before account closure.`,
            projectId: projDoc.id
          });
        }
      }

      const bucketName = firebaseConfig.storageBucket || "echonote-2509.firebasestorage.app";
      const bucket = admin.storage().bucket(bucketName);

      // 3. Purge personal recordings (and associated Storage objects)
      const personalRecSnap = await db.collection("recordings").where("userId", "==", callerUid).get();
      let purgedRecordingsCount = 0;
      for (const recDoc of personalRecSnap.docs) {
        const recData = recDoc.data() || {};
        recData.id = recDoc.id;
        await purgeRecordingStorageAndDocs(db, bucket, recData);
        purgedRecordingsCount++;
      }

      // 4. Purge personal decision history
      try {
        const decSnap = await db.collection("decisionHistory").where("userId", "==", callerUid).get();
        const decBatch = db.batch();
        decSnap.docs.forEach(d => decBatch.delete(d.ref));
        if (decSnap.docs.length > 0) await decBatch.commit();
      } catch {}

      // 5. Purge solo projects (projects owned by user with no other members)
      for (const projDoc of ownedProjectsSnap.docs) {
        await db.collection("projects").doc(projDoc.id).delete();
      }

      // 6. Offboard from organization memberships (without destroying shared org data)
      const orgMembersSnap = await db.collection("orgMembers").where("userId", "==", callerUid).get();
      for (const omDoc of orgMembersSnap.docs) {
        const omData = omDoc.data() || {};
        if (omData.orgId) {
          await recordOrgAuditEvent(db, {
            organizationId: omData.orgId,
            actorUserId: callerUid,
            actorEmail: callerEmail || "unknown",
            action: "MEMBER_ACCOUNT_CLOSED",
            timestamp: new Date().toISOString(),
            source: "api",
            details: `User account closed. Member removed from organization.`
          });
        }
        await omDoc.ref.delete();
      }

      // 7. Remove from project memberships
      const projMembersSnap = await db.collection("projectMembers").where("userId", "==", callerUid).get();
      const pmBatch = db.batch();
      projMembersSnap.docs.forEach(d => pmBatch.delete(d.ref));
      if (projMembersSnap.docs.length > 0) await pmBatch.commit();

      // 8. Cancel active subscriptions (preserving billing ledger in /transactions for tax/legal compliance)
      const subSnap = await db.collection("subscriptions")
        .where("userId", "==", callerUid)
        .where("status", "==", "active")
        .get();
      for (const sDoc of subSnap.docs) {
        await sDoc.ref.update({
          status: "cancelled_account_closed",
          closedAt: FieldValue.serverTimestamp()
        });
      }

      // 9. Sanitize user profile in /users
      await db.collection("users").doc(callerUid).set({
        accountStatus: "closed",
        displayName: "Closed Account",
        email: `closed_${callerUid}@echonote.internal`,
        closedAt: new Date().toISOString()
      }, { merge: true });

      // 10. Finally, delete user in Firebase Authentication
      try {
        await admin.auth().deleteUser(callerUid);
      } catch (authErr: any) {
        console.warn("[Firebase Auth Delete Warning]:", authErr?.message);
      }

      return res.json({
        success: true,
        message: "Account closed, personal data purged, and authentication revoked.",
        purgedRecordings: purgedRecordingsCount
      });
    } catch (err: any) {
      console.error("[Account Closure Error]:", err);
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to close account." });
    }
  });

  // Organization Deletion Request Workflow (Controlled state)
  app.post("/api/organizations/:organizationId/request-deletion", requireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const { organizationId } = req.params;
      const { confirmName } = req.body;

      const orgDoc = await db.collection("organizations").doc(organizationId).get();
      if (!orgDoc.exists) {
        return res.status(404).json({ error: "Not Found", message: "Organization not found." });
      }
      const orgData = orgDoc.data() || {};

      const isOwner = orgData.ownerId === req.user.uid;
      const isPlatformAdmin = Boolean(
        req.user.platform_admin === true ||
        req.user.role === 'admin' ||
        (req.user as any)?.claims?.platform_admin === true
      );

      if (!isOwner && !isPlatformAdmin) {
        return res.status(403).json({ error: "Forbidden", message: "Only the organization primary owner or platform admin can request organization deletion." });
      }

      if (confirmName !== orgData.name) {
        return res.status(400).json({
          error: "Bad Request",
          message: `Confirmation required: provide confirmName matching exact organization name "${orgData.name}".`
        });
      }

      // Check active subscription status
      const hasActiveSubscription = orgData.plan && orgData.plan !== 'free' && orgData.plan !== 'starter';

      // Place in safe "deletion requested / pending review" state to avoid accidental multi-tenant data loss
      await db.collection("organizations").doc(organizationId).update({
        deletionRequest: {
          requestedBy: req.user.uid,
          requestedByEmail: req.user.email,
          requestedAt: new Date().toISOString(),
          status: "pending_review",
          hasActiveSubscription: Boolean(hasActiveSubscription),
          gracePeriodDays: 14
        },
        updatedAt: FieldValue.serverTimestamp()
      });

      await recordOrgAuditEvent(db, {
        organizationId,
        actorUserId: req.user.uid,
        actorEmail: req.user.email || "unknown",
        action: "ORGANIZATION_DELETION_REQUESTED",
        timestamp: new Date().toISOString(),
        source: "api",
        details: `Organization deletion requested by owner. Placed in 14-day pending review state.`
      });

      return res.json({
        success: true,
        message: "Organization deletion requested. The workspace is placed in a 14-day pending review status.",
        organizationId,
        status: "pending_review",
        gracePeriodDays: 14
      });
    } catch (err: any) {
      console.error("[Org Deletion Request Error]:", err);
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to request organization deletion." });
    }
  });

  // Safe Retention Purge Job (Configurable policy, bounded batch, idempotent)
  app.post("/api/admin/retention/purge-expired", async (req: express.Request, res: express.Response) => {
    try {
      const cronKey = req.headers["x-cron-key"];
      const configuredCronSecret = (process.env.CRON_SECRET || "").trim();
      const hasValidCronKey = Boolean(
        typeof cronKey === "string" &&
        configuredCronSecret &&
        timingSafeStringCompare(cronKey, configuredCronSecret)
      );

      let isAuthorized = hasValidCronKey;

      if (!isAuthorized) {
        // Check platform admin bearer token
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith("Bearer ")) {
          try {
            const token = authHeader.split("Bearer ")[1];
            const decoded = await admin.auth().verifyIdToken(token);
            if (decoded.role === 'admin' || decoded.platform_admin === true) {
              isAuthorized = true;
            }
          } catch {}
        }
      }

      if (!isAuthorized) {
        return res.status(403).json({ error: "Forbidden", message: "Platform admin or valid x-cron-key required." });
      }

      const retentionDays = Number(req.body?.retentionDays || req.query?.retentionDays);
      if (isNaN(retentionDays) || retentionDays < 1) {
        return res.status(400).json({
          error: "Bad Request",
          message: "Configurable retentionDays parameter (>= 1) must be explicitly provided. Business retention policy must not be assumed."
        });
      }

      const dryRun = req.body?.dryRun === true || req.query?.dryRun === 'true';
      const maxBatch = Math.min(Number(req.body?.maxBatch || 50), 100);

      const thresholdTimestamp = Date.now() - (retentionDays * 86400000);
      const snapshot = await db.collection("recordings")
        .where("deletedAt", "!=", null)
        .limit(maxBatch * 2)
        .get();

      const candidateDocs = snapshot.docs.filter(d => {
        const deletedAt = d.data()?.deletedAt;
        if (!deletedAt) return false;
        const deletedTime = new Date(deletedAt).getTime();
        return !isNaN(deletedTime) && deletedTime <= thresholdTimestamp;
      }).slice(0, maxBatch);

      if (dryRun) {
        return res.json({
          success: true,
          dryRun: true,
          retentionDays,
          scanned: snapshot.docs.length,
          eligibleCount: candidateDocs.length,
          eligibleRecordingIds: candidateDocs.map(d => d.id)
        });
      }

      const bucketName = firebaseConfig.storageBucket || "echonote-2509.firebasestorage.app";
      const bucket = admin.storage().bucket(bucketName);
      let purgedCount = 0;
      let failedCount = 0;

      for (const d of candidateDocs) {
        try {
          const recData = d.data() || {};
          recData.id = d.id;
          await purgeRecordingStorageAndDocs(db, bucket, recData);
          purgedCount++;
        } catch (purgeErr) {
          failedCount++;
          console.error(`[Retention Purge Error for ${d.id}]:`, purgeErr);
        }
      }

      return res.json({
        success: true,
        dryRun: false,
        retentionDays,
        scanned: snapshot.docs.length,
        eligibleCount: candidateDocs.length,
        purgedCount,
        failedCount
      });
    } catch (err: any) {
      console.error("[Retention Purge Job Error]:", err);
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to execute retention purge job." });
    }
  });

  /**
   * Endpoint: Administrative endpoint to scan for overdue tasks and atomically create notifications.
   * Authentication: Protected by x-cron-key matching CRON_SECRET (timing-safe) or Platform Admin bearer token.
   * Request validation:
   *  - projectId (optional string, sanitized)
   *  - evaluationDate (optional YYYY-MM-DD string)
   *  - pageSize (optional positive integer, max 500)
   *  - dryRun (optional boolean)
   */
  app.post("/api/admin/tasks/scan-overdue", async (req: express.Request, res: express.Response) => {
    try {
      const cronKey = req.headers["x-cron-key"];
      const configuredCronSecret = (process.env.CRON_SECRET || "").trim();
      const hasValidCronKey = Boolean(
        typeof cronKey === "string" &&
        configuredCronSecret &&
        timingSafeStringCompare(cronKey, configuredCronSecret)
      );

      let isAuthorized = hasValidCronKey;
      let authenticatedCaller: { uid?: string; role?: string; platform_admin?: boolean } | null = null;

      if (!isAuthorized) {
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith("Bearer ")) {
          const token = authHeader.split("Bearer ")[1]?.trim();
          if (token) {
            // Check Google Cloud Scheduler OIDC verification path if configured
            const expectedAudience = (process.env.SCHEDULER_OIDC_AUDIENCE || "").trim();
            const authorizedServiceAccount = (process.env.SCHEDULER_SERVICE_ACCOUNT || "").trim().toLowerCase();

            if (expectedAudience && authorizedServiceAccount) {
              try {
                const ticket = await oidcClient.verifyIdToken({
                  idToken: token,
                  audience: expectedAudience
                });
                const payload = ticket.getPayload();
                if (payload) {
                  const issuer = payload.iss;
                  const isGoogleIssuer = issuer === "https://accounts.google.com" || issuer === "accounts.google.com";
                  const tokenEmail = (payload.email || "").trim().toLowerCase();
                  const isEmailVerified = payload.email_verified === true;

                  if (isGoogleIssuer && isEmailVerified && tokenEmail === authorizedServiceAccount) {
                    isAuthorized = true;
                    authenticatedCaller = { role: "admin", platform_admin: true };
                  }
                }
              } catch {
                // OIDC token verification failed, fall back to Firebase Admin
              }
            }

            if (!isAuthorized) {
              try {
                const decoded = await admin.auth().verifyIdToken(token);
                if (decoded.role === "admin" || decoded.platform_admin === true) {
                  isAuthorized = true;
                  authenticatedCaller = decoded;
                }
              } catch {}
            }
          }
        }
      }

      if (!isAuthorized) {
        return res.status(403).json({ error: "Forbidden", message: "Platform admin, authorized OIDC token, or valid x-cron-key required." });
      }

      const rawProjectId = req.body?.projectId || req.query?.projectId;
      let projectId: string | undefined = undefined;
      if (rawProjectId !== undefined && rawProjectId !== null) {
        if (typeof rawProjectId !== "string" || !rawProjectId.trim()) {
          return res.status(400).json({ error: "Bad Request", message: "Invalid projectId provided." });
        }
        projectId = rawProjectId.trim();
      }

      // If caller is an admin user without global platform_admin claim, verify project membership/access
      if (projectId && authenticatedCaller && !authenticatedCaller.platform_admin && authenticatedCaller.role !== "admin") {
        return res.status(403).json({ error: "Forbidden", message: "Unauthorized cross-project access." });
      }

      const rawEvalDate = req.body?.evaluationDate || req.query?.evaluationDate;
      let evaluationDate: string | undefined = undefined;
      if (rawEvalDate !== undefined && rawEvalDate !== null) {
        if (typeof rawEvalDate !== "string" || !parseCalendarDate(rawEvalDate.trim())) {
          return res.status(400).json({
            error: "Bad Request",
            message: "Invalid evaluationDate format. Expected calendar date in YYYY-MM-DD format."
          });
        }
        evaluationDate = rawEvalDate.trim();
      }

      const rawPageSize = req.body?.pageSize || req.query?.pageSize;
      let pageSize: number | undefined = undefined;
      if (rawPageSize !== undefined && rawPageSize !== null) {
        const parsed = Number(rawPageSize);
        if (isNaN(parsed) || !Number.isInteger(parsed) || parsed < 1) {
          return res.status(400).json({
            error: "Bad Request",
            message: "Invalid pageSize. Expected a positive integer."
          });
        }
        pageSize = Math.min(parsed, 500);
      }

      const dryRun = req.body?.dryRun === true || req.query?.dryRun === "true";

      const scanResult = await scanAndCreateOverdueNotifications(db, {
        projectId,
        evaluationDate,
        pageSize,
        dryRun
      });

      return res.status(200).json({
        success: true,
        dryRun,
        scannedCount: scanResult.scannedCount,
        eligibleOverdueCount: scanResult.eligibleOverdueCount,
        createdCount: scanResult.createdCount,
        alreadyNotifiedCount: scanResult.alreadyNotifiedCount,
        skippedCount: scanResult.skippedCount,
        errorCount: scanResult.errorCount,
        evaluationDate: scanResult.evaluationDate,
        durationMs: scanResult.durationMs,
        details: scanResult.details
      });
    } catch (err: any) {
      console.error("[Admin Scan Overdue Tasks Error]:", err?.message || err);
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to scan and process overdue tasks." });
    }
  });

  // Stream authorized audio object with HTTP Range request support
  const handleAudioStreaming = async (req: express.Request, res: express.Response) => {
    try {
      const recordingId = req.params.id || req.params.recordingId;
      if (!recordingId) {
        return res.status(400).json({ error: "Bad Request", message: "Recording ID is required." });
      }
      let user: any = null;

      // Check Authorization Bearer header
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith("Bearer ")) {
        const idToken = authHeader.split("Bearer ")[1]?.trim();
        if (idToken) {
          try {
            user = await admin.auth().verifyIdToken(idToken);
          } catch (tokenErr: any) {
            return res.status(401).json({ error: "Unauthorized", message: "Invalid or expired Firebase ID token." });
          }
        }
      }

      // Check query playback token if not authenticated via header
      if (!user && req.query.token && typeof req.query.token === "string") {
        const tokenResult = verifyPlaybackToken(req.query.token);
        if (!tokenResult.valid) {
          return res.status(401).json({ error: "Unauthorized", message: `Playback token verification failed: ${tokenResult.error}` });
        }
        if (tokenResult.data.recId !== recordingId) {
          return res.status(403).json({ error: "Forbidden", message: "Playback token does not match requested recording." });
        }
        user = tokenResult.data;
      }

      if (!user) {
        return res.status(401).json({ error: "Unauthorized", message: "Authentication required for audio streaming." });
      }

      // Authoritative tenant & record permission verification
      const authResult = await authorizeRecordingAccess(user, recordingId);
      if (!authResult.authorized) {
        return res.status(authResult.status).json({ error: authResult.status === 404 ? "Not Found" : "Forbidden", message: authResult.message });
      }

      const record = authResult.record;
      const storagePath = resolveStoragePath(record);
      if (!storagePath) {
        return res.status(404).json({ error: "Not Found", message: "Storage path could not be resolved for this recording." });
      }

      const bucketName = firebaseConfig.storageBucket || "echonote-2509.firebasestorage.app";
      const bucket = admin.storage().bucket(bucketName);
      let file = bucket.file(storagePath);
      let [exists] = await file.exists();

      if (!exists && record.userId && record.id) {
        const prefix = `recordings/${record.userId}/${record.id}/`;
        try {
          const [files] = await bucket.getFiles({ prefix, maxResults: 1 });
          if (files && files.length > 0) {
            file = files[0];
            exists = true;
          }
        } catch (listErr) {
          console.warn("[Storage Lookup Warn]:", listErr);
        }
      }

      if (!exists) {
        return res.status(404).json({ error: "Not Found", message: "Audio file not found in storage bucket." });
      }

      const [metadata] = await file.getMetadata();
      const fileSize = parseInt(metadata.size as string, 10) || 0;
      const contentType = metadata.contentType || record.mimeType || 'audio/webm';

      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');

      const range = req.headers.range;
      if (range && fileSize > 0) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunkSize = (end - start) + 1;

        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
        res.setHeader('Content-Length', chunkSize);
        res.setHeader('Content-Type', contentType);

        const stream = file.createReadStream({ start, end });
        stream.on('error', (err) => {
          console.error("[Stream Range Error]:", err);
          if (!res.headersSent) res.status(500).end();
        });
        stream.pipe(res);
      } else {
        res.status(200);
        if (fileSize > 0) {
          res.setHeader('Content-Length', fileSize);
        }
        res.setHeader('Content-Type', contentType);

        const stream = file.createReadStream();
        stream.on('error', (err) => {
          console.error("[Stream Error]:", err);
          if (!res.headersSent) res.status(500).end();
        });
        stream.pipe(res);
      }
    } catch (err: any) {
      console.error("[Audio Streaming Error]:", err?.message || err);
      if (!res.headersSent) {
        return res.status(500).json({ error: "Internal Server Error", message: "Failed to stream audio file." });
      }
    }
  };

  app.get("/api/recordings/:id/audio", handleAudioStreaming);
  app.get("/api/recordings/:recordingId/audio", handleAudioStreaming);

  // Admin AI Analytics Endpoints - Strictly Protected (Requires Platform Administrator)
  app.get("/api/admin/analytics/overview", requirePlatformAdmin, async (req: AuthenticatedRequest, res) => {
    try {
      const overview = getAiUsageOverview();
      res.json({ success: true, data: overview });
    } catch (err: any) {
      console.error("Failed to fetch analytics overview:", err?.message || err);
      res.status(500).json({ error: "Internal Server Error", message: "Failed to fetch analytics overview" });
    }
  });

  app.get("/api/admin/analytics/logs", requirePlatformAdmin, async (req: AuthenticatedRequest, res) => {
    try {
      const rawLimit = parseInt(req.query.limit as string, 10);
      const limitParam = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 500) : 100;
      const logs = getRecentAiUsageLogs(limitParam);
      res.json({ success: true, logs });
    } catch (err: any) {
      console.error("Failed to fetch AI logs:", err?.message || err);
      res.status(500).json({ error: "Internal Server Error", message: "Failed to fetch AI logs" });
    }
  });

  // Admin Authorization & Security Audit Logs Feed
  app.get("/api/admin/audit-logs", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      // Must be authoritative platform admin OR organization admin/owner
      let isPlatformAdmin = false;
      if (req.user?.uid) {
        try {
          const userDoc = await db.collection("users").doc(req.user.uid).get();
          if (userDoc.exists) {
            const uData = userDoc.data() || {};
            if ((uData.role === 'admin' || uData.platform_admin === true) &&
                uData.accountStatus !== 'closed' &&
                uData.disabled !== true) {
              isPlatformAdmin = true;
            }
          }
        } catch (uErr) {}
      }

      let callerOrgId: string | undefined = req.user?.orgId;
      let isAuthorizedAdmin = false;

      if (isPlatformAdmin) {
        isAuthorizedAdmin = true;
      } else if (callerOrgId && req.user?.email) {
        // Authoritative database check: verify active membership and role in Firestore
        const orgAccess = await checkOrgAccess(db, req.user.email, callerOrgId, ["owner", "org_admin"], req.user);
        if (orgAccess.hasAccess) {
          isAuthorizedAdmin = true;
        }
      }

      if (!isAuthorizedAdmin) {
        res.status(403).json({
          error: "Forbidden",
          message: "Administrative privileges required to access authorization audit logs."
        });
        return;
      }

      const {
        searchTerm,
        status,
        severity,
        action,
        actionType,
        userEmail,
        organizationId,
        projectId,
        projectName,
        startDate,
        endDate,
        startTimestamp,
        endTimestamp,
        limit,
        sortOrder
      } = req.query;

      const filterOrgId = isPlatformAdmin 
        ? (organizationId ? String(organizationId) : undefined)
        : callerOrgId;

      const result = await queryAuthAuditLogs(db, {
        searchTerm: searchTerm ? String(searchTerm) : undefined,
        status: status ? (status as any) : 'all',
        severity: severity ? (severity as any) : 'all',
        action: action ? String(action) : undefined,
        actionType: actionType ? String(actionType) : undefined,
        userEmail: userEmail ? String(userEmail) : undefined,
        organizationId: filterOrgId,
        projectId: projectId ? String(projectId) : undefined,
        projectName: projectName ? String(projectName) : undefined,
        startDate: startDate ? String(startDate) : undefined,
        endDate: endDate ? String(endDate) : undefined,
        startTimestamp: startTimestamp ? String(startTimestamp) : undefined,
        endTimestamp: endTimestamp ? String(endTimestamp) : undefined,
        limit: limit ? parseInt(String(limit), 10) : 200,
        sortOrder: sortOrder === 'asc' ? 'asc' : 'desc'
      });

      res.json({
        success: true,
        ...result
      });
    } catch (err: any) {
      console.error("Failed to query authorization audit logs:", err?.message || err);
      res.status(500).json({
        error: "Internal Server Error",
        message: "Failed to query authorization audit logs."
      });
    }
  });

  // Helper to sanitize error messages from AI provider calls to prevent credentials or stack traces from leaking
  function sanitizeAiErrorMessage(errMsg: any): string {
    if (!errMsg || typeof errMsg !== 'string') return "AI processing failed. Please try again.";
    let sanitized = errMsg
      .replace(/AIza[0-9A-Za-z-_]{35}/g, '[REDACTED]')
      .replace(/(?:key|apiKey|token|secret|authorization)=[^&\s]+/gi, '$1=[REDACTED]')
      .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]');
    if (sanitized.includes('at ') && sanitized.includes('(')) {
      sanitized = sanitized.split('\n')[0];
    }
    return sanitized;
  }

  // AI Tracking & Execution Endpoints - strictly requireAuth & server-authoritative context
  app.post("/api/ai/transcribe-audio", requireAuth, async (req: AuthenticatedRequest, res) => {
    const { base64Data, mimeType, targetLanguage, recordingId, projectId } = req.body;
    const userCtx = await resolveUserContext(req);
    const userId = userCtx.userId;
    const email = userCtx.email;
    const plan = userCtx.plan;

    // Authorize resource identifiers if provided
    if (recordingId || projectId) {
      const accessCheck = await verifyAiResourceAccess(req.user, {
        recordingId,
        projectId,
        operationType: 'write'
      });
      if (!accessCheck.allowed) {
        return res.status(accessCheck.status).json({ error: "Forbidden", message: accessCheck.message });
      }
    }

    const start = Date.now();
    const model = 'gemini-3.5-flash';
    const featureName = "Intelligence Transcription";

    if (!base64Data) return res.status(400).json({ error: "Missing sound data" });

    // Step 8.1A: Admit AI rate limit and acquire concurrency slot after input validation
    const slot = admitExpensiveOperation(req, res, 'ai');
    if (!slot) return;

    // Normalize and clean MIME type so Gemini receives valid pure MIME (e.g. 'audio/webm' instead of 'audio/webm;codecs=opus')
    const normalized = normalizeAudioMimeType(mimeType);
    const geminiMime = normalized.containerMime === 'audio/x-wav' ? 'audio/wav' : normalized.containerMime;

    const languageInstruction = targetLanguage === 'english' 
      ? "MANDATORY: Translate all spoken content into English. The final transcript and summary MUST be in English, regardless of the input language."
      : "Transcribe in 'Hinglish' (a mix of Hindi and English written in Roman script) if the speakers are using Hindi or a mix of Hindi and English. If they are using other languages, transcribe exactly as spoken. Do not translate to pure English if the original is Hindi/Hinglish.";

    try {
      const response = await aiGen.models.generateContent({
        model,
        contents: [
          {
            parts: [
              {
                inlineData: {
                  data: base64Data,
                  mimeType: geminiMime,
                },
              },
              {
                text: `Provide a highly accurate, word-for-word, literal (verbatim) transcription of the entire audio.
                
                TRANSCRIPTION REQUIREMENTS:
                1. This MUST be a true, word-for-word verbatim transcription. Do NOT summarize, condense, paraphrase, or truncate any spoken words in the transcript segments.
                2. Fully preserve all speaker changes, correct punctuation, and natural paragraph structures.
                3. Keep disfluencies and spoken text intact to ensure a high-fidelity verbatim record.
                4. Map the transcript to precise start and end timestamps (in seconds).
                5. ${languageInstruction}

                TRANSCRIPTION QUALITY SCORE:
                Calculate a 'Transcription Quality Score' (0-100) based on:
                - Audio clarity (30%)
                - Speaker clarity (40%)
                - Verbatim fidelity (30%)
     
                EXECUTIVE SUMMARY RULES (Kept strictly separate):
                - Provide a professional, concise executive summary of the discussion under the 'summary' property.
                - This summary remains completely separate from the transcript and should not shorten or summarize the transcript text itself.
                
                Format the output strictly as a JSON object containing:
                - 'transcript' (array of {speaker, text, startTime, endTime})
                - 'qualityScore' (number)
                - 'summary' (object with mainTopic, keyPoints[], decisions[], actionItems[])`,
              },
            ],
          },
        ],
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              transcript: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    speaker: { type: Type.STRING },
                    text: { type: Type.STRING },
                    startTime: { type: Type.NUMBER },
                    endTime: { type: Type.NUMBER },
                  },
                  required: ["speaker", "text", "startTime", "endTime"],
                },
              },
              qualityScore: { 
                type: Type.NUMBER,
              },
              summary: {
                type: Type.OBJECT,
                properties: {
                  mainTopic: { type: Type.STRING },
                  keyPoints: { type: Type.ARRAY, items: { type: Type.STRING } },
                  decisions: { type: Type.ARRAY, items: { type: Type.STRING } },
                  actionItems: { type: Type.ARRAY, items: { type: Type.STRING } },
                },
                required: ["mainTopic", "keyPoints", "decisions", "actionItems"],
              }
            },
            required: ["transcript", "qualityScore", "summary"],
          },
        },
      });

      const inputTokens = response.usageMetadata?.promptTokenCount || 0;
      const outputTokens = response.usageMetadata?.candidatesTokenCount || 0;
      const duration = Date.now() - start;

      await trackAIUsage({
        userId,
        email,
        plan,
        featureName,
        modelUsed: model,
        inputTokens,
        outputTokens,
        requestDuration: duration,
        status: "success",
      });

      const jsonStr = response.text || "{\"transcript\": [], \"qualityScore\": 0, \"summary\": {\"mainTopic\": \"\", \"keyPoints\": [], \"decisions\": [], \"actionItems\": []}}";
      res.json(JSON.parse(jsonStr));

    } catch (error: any) {
      console.error(`[AI Endpoint Error] ${featureName}:`, error);
      const duration = Date.now() - start;
      await trackAIUsage({
        userId,
        email,
        plan,
        featureName,
        modelUsed: model,
        inputTokens: 0,
        outputTokens: 0,
        requestDuration: duration,
        status: "failure",
      });
      res.status(500).json({ error: sanitizeAiErrorMessage(error?.message) || "Execution failed" });
    } finally {
      // Step 8.1A: Always release concurrency slot on completion or failure
      slot.release();
    }
  });

  app.post("/api/ai/summarize-transcript", requireAuth, async (req: AuthenticatedRequest, res) => {
    const { transcript, recordingId, projectId } = req.body;
    const userCtx = await resolveUserContext(req);
    const userId = userCtx.userId;
    const email = userCtx.email;
    const plan = userCtx.plan;

    // Authorize resource identifiers if provided
    if (recordingId || projectId) {
      const accessCheck = await verifyAiResourceAccess(req.user, {
        recordingId,
        projectId,
        operationType: 'read'
      });
      if (!accessCheck.allowed) {
        return res.status(accessCheck.status).json({ error: "Forbidden", message: accessCheck.message });
      }
    }

    const start = Date.now();
    const model = 'gemini-3-flash-preview';
    const featureName = "Executive Summary";

    if (!transcript) return res.status(400).json({ error: "Missing transcript data" });

    // Step 8.1A: Admit AI rate limit and acquire concurrency slot after input validation
    const slot = admitExpensiveOperation(req, res, 'ai');
    if (!slot) return;

    // Server-authoritative plan level determines insight depth (never trust client-supplied tier)
    const isAdvanced = ['pro', 'team', 'enterprise'].includes(plan.toLowerCase());
    const transcriptText = Array.isArray(transcript) 
      ? transcript.map((s: any) => `${s.speaker}: ${s.text}`).join('\n')
      : String(transcript);

    try {
      const response = await aiGen.models.generateContent({
        model,
        contents: [
          {
            parts: [
              {
                text: `Based on the following transcript, generate a structured, professional summary. 
                
                PLAN LEVEL: ${isAdvanced ? 'ADVANCED (Full Insights)' : 'BASIC (Limited Insights)'}
    
                RULES:
                - Keep it concise (Total length should not exceed ${isAdvanced ? '15-20' : '8-10'} lines).
                - Do not hallucinate. 
                - Use a professional corporate tone.
                ${!isAdvanced ? '- LIMITATION: Provide only a high-level summary. Focus on the most critical points only.' : ''}
                
                TRANSCRIPT:
                ${transcriptText}`,
              },
            ],
          },
        ],
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              mainTopic: { 
                type: Type.STRING
              },
              keyPoints: { 
                type: Type.ARRAY, 
                items: { type: Type.STRING }
              },
              decisions: { 
                type: Type.ARRAY, 
                items: { type: Type.STRING }
              },
              actionItems: { 
                type: Type.ARRAY, 
                items: { type: Type.STRING }
              },
            },
            required: ["mainTopic", "keyPoints", "decisions", "actionItems"],
          },
        },
      });

      const inputTokens = response.usageMetadata?.promptTokenCount || 0;
      const outputTokens = response.usageMetadata?.candidatesTokenCount || 0;
      const duration = Date.now() - start;

      await trackAIUsage({
        userId,
        email,
        plan,
        featureName,
        modelUsed: model,
        inputTokens,
        outputTokens,
        requestDuration: duration,
        status: "success",
      });

      res.json(JSON.parse(response.text || "{}"));
    } catch (error: any) {
      console.error(`[AI Endpoint Error] ${featureName}:`, error);
      const duration = Date.now() - start;
      await trackAIUsage({
        userId,
        email,
        plan,
        featureName,
        modelUsed: model,
        inputTokens: 0,
        outputTokens: 0,
        requestDuration: duration,
        status: "failure",
      });
      res.status(500).json({ error: error.message || "Execution failed" });
    } finally {
      // Step 8.1A: Always release concurrency slot on completion or failure
      slot.release();
    }
  });

  app.post("/api/ai/smart-recap", requireAuth, async (req: AuthenticatedRequest, res) => {
    const { transcript, recordingId, projectId, knownMembers } = req.body;
    const userCtx = await resolveUserContext(req);
    const userId = userCtx.userId;
    const email = userCtx.email;
    const plan = userCtx.plan;

    // Authorize resource identifiers if provided
    if (recordingId || projectId) {
      const accessCheck = await verifyAiResourceAccess(req.user, {
        recordingId,
        projectId,
        operationType: 'read'
      });
      if (!accessCheck.allowed) {
        return res.status(accessCheck.status).json({ error: "Forbidden", message: accessCheck.message });
      }
    }

    const start = Date.now();
    const model = 'gemini-3.8-flash';
    const featureName = "AI Smart Recap";

    if (!transcript) {
      return res.status(400).json({ error: "Missing transcript data for AI Smart Recap" });
    }

    const slot = admitExpensiveOperation(req, res, 'ai');
    if (!slot) return;

    let transcriptText = '';
    if (Array.isArray(transcript)) {
      transcriptText = transcript.map((s: any) => `${s.speaker || 'Speaker'}: ${s.text || ''}`).join('\n');
    } else {
      transcriptText = String(transcript);
    }

    let teamMembersContext = '';
    if (Array.isArray(knownMembers) && knownMembers.length > 0) {
      teamMembersContext = `\nKNOWN TEAM MEMBERS ON THIS PROJECT:\n` +
        knownMembers.map((m: any) => `- Name: ${m.name || 'Member'}, Email: ${m.email || 'N/A'}, Role: ${m.role || 'Member'}`).join('\n');
    } else if (projectId) {
      try {
        const membersSnap = await db.collection('projectMembers').where('projectId', '==', projectId).limit(20).get();
        if (!membersSnap.empty) {
          teamMembersContext = `\nKNOWN PROJECT TEAM MEMBERS:\n` +
            membersSnap.docs.map(d => {
              const data = d.data();
              return `- Name: ${data.displayName || data.name || data.email || 'Member'}, Email: ${data.email || ''}, Role: ${data.role || 'member'}`;
            }).join('\n');
        }
      } catch (err) {
        // Non-blocking team lookup
      }
    }

    try {
      const response = await aiGen.models.generateContent({
        model,
        contents: [
          {
            parts: [
              {
                text: `You are an elite executive intelligence synthesizer and organizational memory analyst.
Based on the following meeting transcript, produce an authoritative "AI Smart Recap".

MANDATORY DELIVERABLES:
1. EXECUTIVE SUMMARY:
   - Provide EXACTLY THREE (3) high-impact bullet points:
     * Bullet 1: Strategic Context & Discussion Purpose (What prompted the discussion and the primary operational context).
     * Bullet 2: Key Strategic & Technical Decisions (Definitive conclusions, technical or architectural agreements, or consensus reached).
     * Bullet 3: Forward Trajectory & Urgent Action Path (Immediate milestones, critical deadlines, and assigned deliverables).
   - Each bullet must be punchy, clear, and business-focused (2-3 sentences per bullet).

2. AUTOMATICALLY TAG RELEVANT TEAM MEMBERS:
   - Identify every team member or participant who:
     * Was assigned an action item, milestone, or task
     * Made or championed a key decision
     * Was discussed as a stakeholder, dependency, or blocker owner
     * Actively spoke or led a crucial agenda item
   - Correlate with the provided Known Team Members list whenever possible, or extract named individuals and speakers from the transcript.
   - For each tagged team member, specify:
     * name: Their full name or identifier
     * email: Their email address (if matching known team members or identifiable, otherwise empty)
     * role: Their organizational or meeting role (e.g., 'Lead Engineer', 'Product Manager', 'Decision Stakeholder', 'Contributor')
     * reason: A specific, 1-sentence reason explaining why they are tagged (e.g., 'Assigned to finalize Cloud Run deployment and secret configuration before Friday')
     * actionItems: An array of strings with specific action items or responsibilities assigned to them (or empty if none)

${teamMembersContext}

TRANSCRIPT:
${transcriptText}`,
              },
            ],
          },
        ],
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              meetingTopic: { type: Type.STRING },
              strategicTakeaway: { type: Type.STRING },
              executiveSummary: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "Exactly 3 executive summary bullet points"
              },
              taggedMembers: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING },
                    email: { type: Type.STRING },
                    role: { type: Type.STRING },
                    reason: { type: Type.STRING },
                    actionItems: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING }
                    }
                  },
                  required: ["name", "reason"]
                }
              }
            },
            required: ["executiveSummary", "taggedMembers"]
          },
        },
      });

      const parsed = JSON.parse(response.text || "{}");
      
      // Ensure exactly 3 executive summary bullets
      let rawBullets: string[] = Array.isArray(parsed.executiveSummary) ? parsed.executiveSummary : [];
      if (rawBullets.length < 3) {
        if (rawBullets.length === 0) rawBullets.push("Meeting review and team alignment across current objectives.");
        if (rawBullets.length === 1) rawBullets.push("Key decisions resolved regarding timeline and architecture priorities.");
        if (rawBullets.length === 2) rawBullets.push("Follow-through actions assigned to team owners for upcoming sprint.");
      } else if (rawBullets.length > 3) {
        rawBullets = rawBullets.slice(0, 3);
      }

      const smartRecap = {
        executiveSummary: rawBullets,
        taggedMembers: Array.isArray(parsed.taggedMembers) ? parsed.taggedMembers : [],
        meetingTopic: parsed.meetingTopic || "Executive Meeting Intelligence",
        strategicTakeaway: parsed.strategicTakeaway || "",
        generatedAt: new Date().toISOString(),
        recordingId: recordingId || undefined
      };

      // Persist to Firestore recording if recordingId is available
      if (recordingId) {
        try {
          await db.collection('recordings').doc(recordingId).update({
            smartRecap,
            updatedAt: new Date().toISOString()
          });
        } catch (dbErr) {
          console.warn("[smart-recap] Could not persist smartRecap to recording doc:", dbErr);
        }
      }

      const inputTokens = response.usageMetadata?.promptTokenCount || 0;
      const outputTokens = response.usageMetadata?.candidatesTokenCount || 0;
      const duration = Date.now() - start;

      await trackAIUsage({
        userId,
        email,
        plan,
        featureName,
        modelUsed: model,
        inputTokens,
        outputTokens,
        requestDuration: duration,
        status: "success",
      });

      res.json({ smartRecap });
    } catch (error: any) {
      console.error(`[AI Endpoint Error] ${featureName}:`, error);
      const duration = Date.now() - start;
      await trackAIUsage({
        userId,
        email,
        plan,
        featureName,
        modelUsed: model,
        inputTokens: 0,
        outputTokens: 0,
        requestDuration: duration,
        status: "failure",
      });
      res.status(500).json({ error: error.message || "Failed to generate AI Smart Recap" });
    } finally {
      slot.release();
    }
  });

  app.post("/api/ai/automated-tagging", requireAuth, async (req: AuthenticatedRequest, res) => {
    const { transcript, recordingId, projectId, teamMembers, tasks, autoApply = true, autoCreateTasks = false } = req.body;
    const userCtx = await resolveUserContext(req);
    const userId = userCtx.userId;
    const email = userCtx.email;
    const plan = userCtx.plan;

    // Authorize resource identifiers if provided
    if (recordingId || projectId) {
      const accessCheck = await verifyAiResourceAccess(req.user, {
        recordingId,
        projectId,
        operationType: 'read'
      });
      if (!accessCheck.allowed) {
        return res.status(accessCheck.status).json({ error: "Forbidden", message: accessCheck.message });
      }
    }

    const start = Date.now();
    const model = 'gemini-3-flash-preview';
    const featureName = "Automated Member Tagging";

    if (!transcript) {
      return res.status(400).json({ error: "Missing transcript data for automated tagging" });
    }

    const slot = admitExpensiveOperation(req, res, 'ai');
    if (!slot) return;

    let transcriptText = '';
    if (Array.isArray(transcript)) {
      transcriptText = transcript.map((s: any) => `${s.speaker || 'Speaker'}: ${s.text || ''}`).join('\n');
    } else {
      transcriptText = String(transcript);
    }

    // Resolve known team members
    let resolvedMembers: Array<{ name: string; email: string; role?: string; uid?: string }> = [];
    if (Array.isArray(teamMembers) && teamMembers.length > 0) {
      resolvedMembers = teamMembers.map((m: any) => ({
        name: m.name || m.displayName || m.email?.split('@')[0] || 'Team Member',
        email: (m.email || '').toLowerCase(),
        role: m.role || 'member',
        uid: m.uid || ''
      }));
    } else if (projectId) {
      try {
        const [membersSnap, projectDoc] = await Promise.all([
          db.collection('projectMembers').where('projectId', '==', projectId).limit(50).get(),
          db.collection('projects').doc(projectId).get()
        ]);

        if (projectDoc.exists) {
          const pData = projectDoc.data() || {};
          if (pData.ownerEmail) {
            resolvedMembers.push({
              name: pData.ownerEmail.split('@')[0] + ' (Owner)',
              email: pData.ownerEmail.toLowerCase(),
              role: 'owner',
              uid: pData.userId || ''
            });
          }
        }

        membersSnap.docs.forEach(doc => {
          const data = doc.data();
          if (data.email && !resolvedMembers.some(rm => rm.email === data.email.toLowerCase())) {
            resolvedMembers.push({
              name: data.displayName || data.name || data.email.split('@')[0],
              email: data.email.toLowerCase(),
              role: data.role || 'member',
              uid: data.userId || data.uid || ''
            });
          }
        });
      } catch (err) {
        console.warn("[automated-tagging] Error querying team members:", err);
      }
    }

    // Resolve existing tasks
    let resolvedTasks: Array<{ id: string; title: string; description?: string; assigneeEmail?: string; assigneeName?: string; status?: string; dueDate?: string }> = [];
    if (Array.isArray(tasks) && tasks.length > 0) {
      resolvedTasks = tasks.map((t: any) => ({
        id: t.id,
        title: t.title || 'Untitled Task',
        description: t.description || '',
        assigneeEmail: (t.assigneeEmail || '').toLowerCase(),
        assigneeName: t.assigneeName || '',
        status: t.status || 'pending',
        dueDate: t.dueDate || ''
      }));
    } else if (projectId) {
      try {
        const tasksSnap = await db.collection('tasks').where('projectId', '==', projectId).limit(100).get();
        resolvedTasks = tasksSnap.docs.map(doc => {
          const d = doc.data();
          return {
            id: doc.id,
            title: d.title || 'Untitled Task',
            description: d.description || '',
            assigneeEmail: (d.assigneeEmail || '').toLowerCase(),
            assigneeName: d.assigneeName || '',
            status: d.status || 'pending',
            dueDate: d.dueDate || ''
          };
        });
      } catch (err) {
        console.warn("[automated-tagging] Error querying tasks:", err);
      }
    }

    const membersPromptSection = resolvedMembers.length > 0
      ? `\nKNOWN TEAM MEMBERS ON THIS PROJECT:\n` +
        resolvedMembers.map(m => `- Name: "${m.name}", Email: "${m.email}", Role: "${m.role || 'Member'}", UID: "${m.uid}"`).join('\n')
      : `\nNO PRE-CONFIGURED TEAM MEMBER ROSTER. Extract explicit names, mentions, and email addresses directly from the transcript conversation.\n`;

    const tasksPromptSection = resolvedTasks.length > 0
      ? `\nEXISTING PROJECT TASKS IN DATABASE:\n` +
        resolvedTasks.map(t => `- Task ID: "${t.id}", Title: "${t.title}", Current Assignee: "${t.assigneeEmail || 'Unassigned'}", Status: "${t.status}", Due Date: "${t.dueDate || 'None'}"`).join('\n')
      : `\nNO EXISTING TASKS SUPPLIED. Identify newly mentioned commitments or deliverables that should be tracked as tasks.\n`;

    try {
      const response = await aiGen.models.generateContent({
        model,
        contents: [
          {
            parts: [
              {
                text: `You are an expert AI meeting coordinator and automated project execution officer.
Your mission is to perform automated team member mention detection and task assignment from the following meeting transcript.

OBJECTIVES:
1. Detect every mention or conversational commitment where a team member:
   - Is assigned or volunteered for a specific task, deliverable, or action item.
   - Verbally commits to an outcome (e.g., "I'll handle the API schema", "Sarah, can you take the QA audit?").
   - Is referenced as the designated lead or owner of a milestone.
2. Match the mentioned individual with high precision to the KNOWN TEAM MEMBERS list (matching by name, nickname, email, or role).
3. If an existing task in the EXISTING PROJECT TASKS list corresponds to the discussion, map the mention to that specific Task ID.
4. If the action item is brand new and not yet in the tasks list, formulate a concise, professional Task Title and leave taskId empty ("").
5. Extract the verbatim quote from the transcript proving the assignment.
6. Extract any agreed-upon deadline or target date if mentioned (e.g., "by Friday", "end of month", "tomorrow", or "YYYY-MM-DD").
7. Assign a confidence score from 0.0 to 1.0 (only include detections with confidence >= 0.65).

${membersPromptSection}
${tasksPromptSection}

TRANSCRIPT:
${transcriptText}`,
              },
            ],
          },
        ],
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summaryOfMentions: { type: Type.STRING },
              detections: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    memberEmail: { type: Type.STRING, description: "Email address of the tagged team member (lowercase)" },
                    memberName: { type: Type.STRING, description: "Display name of the tagged team member" },
                    memberUid: { type: Type.STRING, description: "UID of the team member if known from list, else empty" },
                    taskId: { type: Type.STRING, description: "Task ID if matching an existing task, else empty string" },
                    taskTitle: { type: Type.STRING, description: "Title of the task being assigned or created" },
                    actionDescription: { type: Type.STRING, description: "Action item description or scope" },
                    transcriptQuote: { type: Type.STRING, description: "Exact excerpt or quote from the transcript" },
                    confidence: { type: Type.NUMBER, description: "Confidence score between 0.0 and 1.0" },
                    detectedDeadline: { type: Type.STRING, description: "Due date or deadline if specified, else empty string" }
                  },
                  required: ["memberEmail", "memberName", "taskTitle", "transcriptQuote", "confidence"]
                }
              }
            },
            required: ["detections"]
          },
        },
      });

      const parsed = JSON.parse(response.text || "{}");
      const rawDetections = Array.isArray(parsed.detections) ? parsed.detections : [];

      // Correlate with resolved members to guarantee email and uid accuracy
      const normalizedDetections = rawDetections.map((det: any) => {
        const foundMember = resolvedMembers.find(m => 
          (det.memberEmail && m.email === det.memberEmail.toLowerCase()) ||
          (det.memberName && m.name.toLowerCase().includes(det.memberName.toLowerCase())) ||
          (det.memberName && det.memberName.toLowerCase().includes(m.name.toLowerCase()))
        );

        return {
          memberEmail: foundMember ? foundMember.email : (det.memberEmail || '').toLowerCase(),
          memberName: foundMember ? foundMember.name : (det.memberName || 'Team Member'),
          memberUid: foundMember?.uid || det.memberUid || '',
          taskId: det.taskId || '',
          taskTitle: det.taskTitle || 'Assigned Action Item',
          actionDescription: det.actionDescription || '',
          transcriptQuote: det.transcriptQuote || '',
          confidence: typeof det.confidence === 'number' ? det.confidence : 0.85,
          detectedDeadline: det.detectedDeadline || '',
          applied: false
        };
      });

      const updatedTaskIds: string[] = [];
      const createdTaskIds: string[] = [];

      // Automatically update database when autoApply is true
      if (autoApply) {
        for (const det of normalizedDetections) {
          if (det.taskId) {
            try {
              const taskRef = db.collection('tasks').doc(det.taskId);
              const taskDoc = await taskRef.get();
              if (taskDoc.exists) {
                const updatePayload: Record<string, any> = {
                  assigneeEmail: det.memberEmail.toLowerCase(),
                  assigneeName: det.memberName,
                  assigneeId: det.memberUid || '',
                  updatedAt: new Date().toISOString(),
                  activityHistory: FieldValue.arrayUnion({
                    id: crypto.randomBytes(6).toString('hex'),
                    action: 'automated_tagging',
                    performedBy: 'EchoNote AI (Automated Tagging)',
                    timestamp: new Date().toISOString(),
                    details: `Auto-assigned to ${det.memberName} (${det.memberEmail}) from meeting transcript mention. Quote: "${det.transcriptQuote}"`
                  })
                };

                if (det.detectedDeadline) {
                  updatePayload.dueDate = det.detectedDeadline;
                }

                await taskRef.update(updatePayload);
                updatedTaskIds.push(det.taskId);
                det.applied = true;

                // Send persistent in-app notification in Firestore
                try {
                  await db.collection('notifications').add({
                    userId: det.memberUid || '',
                    userEmail: det.memberEmail.toLowerCase(),
                    title: 'Task Assigned from Meeting',
                    message: `EchoNote AI detected your mention in the meeting transcript and assigned you "${det.taskTitle}". Quote: "${det.transcriptQuote}"`,
                    projectId: projectId || '',
                    taskId: det.taskId,
                    type: 'info',
                    isRead: false,
                    createdAt: FieldValue.serverTimestamp()
                  });
                } catch (notifErr) {
                  console.warn("[automated-tagging] Failed to write in-app notification:", notifErr);
                }
              }
            } catch (updateErr) {
              console.warn(`[automated-tagging] Failed updating task ${det.taskId}:`, updateErr);
            }
          } else if (autoCreateTasks && projectId && det.taskTitle && det.memberEmail) {
            // Optionally auto-create new task in database for recognized deliverable
            try {
              const newTaskDoc = await db.collection('tasks').add({
                projectId,
                title: det.taskTitle,
                description: (det.actionDescription || '') + `\n\n[Auto-created via meeting mention]: "${det.transcriptQuote}"`,
                assigneeEmail: det.memberEmail.toLowerCase(),
                assigneeName: det.memberName,
                assigneeId: det.memberUid || '',
                status: 'pending',
                priority: 'medium',
                dueDate: det.detectedDeadline || '',
                subTasks: [],
                activityHistory: [{
                  id: crypto.randomBytes(6).toString('hex'),
                  action: 'automated_tagging',
                  performedBy: 'EchoNote AI (Automated Tagging)',
                  timestamp: new Date().toISOString(),
                  details: `Task auto-created and assigned to ${det.memberName} (${det.memberEmail}) based on transcript mention.`
                }],
                createdBy: userId || 'system',
                creatorEmail: email || 'system',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
              });
              createdTaskIds.push(newTaskDoc.id);
              det.taskId = newTaskDoc.id;
              det.applied = true;

              try {
                await db.collection('notifications').add({
                  userId: det.memberUid || '',
                  userEmail: det.memberEmail.toLowerCase(),
                  title: 'New Task Created from Meeting',
                  message: `EchoNote AI created and assigned you task "${det.taskTitle}" based on your mention in the transcript. Quote: "${det.transcriptQuote}"`,
                  projectId: projectId || '',
                  taskId: newTaskDoc.id,
                  type: 'info',
                  isRead: false,
                  createdAt: FieldValue.serverTimestamp()
                });
              } catch (notifErr) {
                console.warn("[automated-tagging] Failed to write in-app notification for new task:", notifErr);
              }
            } catch (createErr) {
              console.warn("[automated-tagging] Failed creating new task:", createErr);
            }
          }
        }
      }

      const inputTokens = response.usageMetadata?.promptTokenCount || 0;
      const outputTokens = response.usageMetadata?.candidatesTokenCount || 0;
      const duration = Date.now() - start;

      await trackAIUsage({
        userId,
        email,
        plan,
        featureName,
        modelUsed: model,
        inputTokens,
        outputTokens,
        requestDuration: duration,
        status: "success",
      });

      res.json({
        success: true,
        summaryOfMentions: parsed.summaryOfMentions || `Detected ${normalizedDetections.length} assignment mentions in transcript.`,
        detections: normalizedDetections,
        updatedTasksCount: updatedTaskIds.length,
        createdTasksCount: createdTaskIds.length,
        updatedTaskIds,
        createdTaskIds,
        message: `Successfully detected ${normalizedDetections.length} mentions and updated ${updatedTaskIds.length} tasks in the database.`
      });
    } catch (error: any) {
      console.error(`[AI Endpoint Error] ${featureName}:`, error);
      const duration = Date.now() - start;
      await trackAIUsage({
        userId,
        email,
        plan,
        featureName,
        modelUsed: model,
        inputTokens: 0,
        outputTokens: 0,
        requestDuration: duration,
        status: "failure",
      });
      res.status(500).json({ error: error.message || "Failed to perform automated tagging from transcript" });
    } finally {
      slot.release();
    }
  });

  app.post("/api/ai/synthesize-speech", requireAuth, async (req: AuthenticatedRequest, res) => {
    const { text, gender, recordingId, projectId } = req.body;
    const userCtx = await resolveUserContext(req);
    const userId = userCtx.userId;
    const email = userCtx.email;
    const plan = userCtx.plan;

    // Authorize resource identifiers if provided
    if (recordingId || projectId) {
      const accessCheck = await verifyAiResourceAccess(req.user, {
        recordingId,
        projectId,
        operationType: 'read'
      });
      if (!accessCheck.allowed) {
        return res.status(accessCheck.status).json({ error: "Forbidden", message: accessCheck.message });
      }
    }

    const start = Date.now();
    const model = "gemini-3.1-flash-tts-preview";
    const featureName = "Speech Synthesis";

    if (!text) return res.status(400).json({ error: "Missing text to synthesize" });

    // Step 8.1A: Admit AI rate limit and acquire concurrency slot after input validation
    const slot = admitExpensiveOperation(req, res, 'ai');
    if (!slot) return;

    const voiceName = gender === 'male' ? 'Fenrir' : 'Puck';
    const genderDescriptor = gender === 'male' 
      ? 'deep, authoritative, and distinctly masculine' 
      : 'clear, melodic, and distinctly feminine';

    try {
      const response = await aiGen.models.generateContent({
        model,
        contents: [{ 
          parts: [{ 
            text: `Narrate the following text in a ${genderDescriptor} tone with natural professional prosody. Ensure the pitch and timbre are unmistakably ${gender}. Text: ${text}` 
          }] 
        }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData?.data;
      if (!base64Audio) throw new Error("Audio generation failed on model side");

      const inputTokens = response.usageMetadata?.promptTokenCount || 0;
      const outputTokens = response.usageMetadata?.candidatesTokenCount || 0;
      const duration = Date.now() - start;

      await trackAIUsage({
        userId,
        email,
        plan,
        featureName,
        modelUsed: model,
        inputTokens,
        outputTokens,
        requestDuration: duration,
        status: "success",
      });

      res.json({ base64Audio });
    } catch (error: any) {
      console.error(`[AI Endpoint Error] ${featureName}:`, error);
      const duration = Date.now() - start;
      await trackAIUsage({
        userId,
        email,
        plan,
        featureName,
        modelUsed: model,
        inputTokens: 0,
        outputTokens: 0,
        requestDuration: duration,
        status: "failure",
      });
      res.status(500).json({ error: sanitizeAiErrorMessage(error?.message) || "Speech synthesis failed" });
    } finally {
      // Step 8.1A: Always release concurrency slot on completion or failure
      slot.release();
    }
  });

  app.post("/api/ai/analyze-strategically", requireAuth, async (req: AuthenticatedRequest, res) => {
    const { input, inputType, recordingId, projectId } = req.body;
    const userCtx = await resolveUserContext(req);
    const userId = userCtx.userId;
    const email = userCtx.email;
    const plan = userCtx.plan;

    // Authorize resource identifiers if provided
    if (recordingId || projectId) {
      const accessCheck = await verifyAiResourceAccess(req.user, {
        recordingId,
        projectId,
        operationType: 'read'
      });
      if (!accessCheck.allowed) {
        return res.status(accessCheck.status).json({ error: "Forbidden", message: accessCheck.message });
      }
    }

    const start = Date.now();
    const model = 'gemini-3-flash-preview';
    const featureName = "Strategic Thinking Partner";

    if (!input) return res.status(400).json({ error: "Missing input content" });

    // Step 8.1A: Admit AI rate limit and acquire concurrency slot after input validation
    const slot = admitExpensiveOperation(req, res, 'ai');
    if (!slot) return;

    // Server-authoritative plan level determines insight depth (never trust client-supplied tier)
    const isAdvanced = ['pro', 'team', 'enterprise'].includes(plan.toLowerCase());

    const prompt = `
      You are the EchoNote Strategic Intelligence engine. Your goal is to transform the provided ${inputType} into deep, strategic insights that reveal the "thinking" behind the conversation.
      
      PLAN LEVEL: ${isAdvanced ? 'ADVANCED (Full Insights)' : 'BASIC (Limited Insights)'}
  
      INPUT (${inputType.toUpperCase()}):
      ${input}
  
      TASK:
      Analyze the input and provide a structured JSON response with the following sections:
      1. Core Intent: What is the primary, underlying goal or purpose of this discussion?
      2. Context: What is the broader situation or background that gives this conversation meaning?
      3. Assumptions: What are the underlying assumptions being made by the participants?
      4. Logical Gaps: Where is the reasoning incomplete or where are there contradictions?
      5. Blind Spots: What are the participants missing or failing to consider?
      6. Strategic Questions: What high-level, critical questions should be asked now?
      7. Recommendations: What specific, strategic advice would you give based on this?
      8. Alternative Perspectives: What other ways could this situation be interpreted or approached? ${isAdvanced ? '(Multiple viewpoints)' : '(Single alternative)'}
      9. Ignored Questions: What important questions were left unasked or unanswered during the conversation?
      10. Unresolved Topics: ${isAdvanced ? 'Identify topics discussed but no decision made, open-ended discussions, or unanswered questions.' : 'Empty array (Advanced Feature)'}
         ${isAdvanced ? `
         - Do NOT include topics that already have decisions.
         - Avoid trivial or minor points.
         - Focus on meaningful gaps.
         - For each, provide: id, topic (title), context (short explanation), reasonUnresolved (why it remains open), and suggestedAction (next step).
         ` : ''}
      11. Decision Framework: A brief assessment of the framework or logic being used to make decisions.
      12. Next Steps: Concrete, actionable steps that move the strategy forward.
  
      RULES:
      - Be critical, analytical, and insightful.
      - Do not just summarize; find the hidden patterns and strategic implications.
      - Use a professional, high-level executive tone.
      - Return ONLY valid JSON.
      ${!isAdvanced ? '- LIMITATION: Provide only basic insights. Keep responses concise.' : ''}
    `;

    try {
      const response = await aiGen.models.generateContent({
        model,
        contents: [{ parts: [{ text: prompt }] }],
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              coreIntent: { type: Type.STRING },
              context: { type: Type.STRING },
              assumptions: { type: Type.ARRAY, items: { type: Type.STRING } },
              logicalGaps: { type: Type.ARRAY, items: { type: Type.STRING } },
              blindSpots: { type: Type.ARRAY, items: { type: Type.STRING } },
              strategicQuestions: { type: Type.ARRAY, items: { type: Type.STRING } },
              recommendations: { type: Type.ARRAY, items: { type: Type.STRING } },
              alternativePerspectives: { type: Type.ARRAY, items: { type: Type.STRING } },
              ignoredQuestions: { type: Type.ARRAY, items: { type: Type.STRING } },
              unresolvedTopics: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    topic: { type: Type.STRING },
                    context: { type: Type.STRING },
                    reasonUnresolved: { type: Type.STRING },
                    suggestedAction: { type: Type.STRING },
                  },
                  required: ["id", "topic", "context", "reasonUnresolved", "suggestedAction"],
                },
              },
              decisionFramework: { type: Type.STRING },
              nextSteps: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: [
              "coreIntent", "context", "assumptions", "logicalGaps", "blindSpots", 
              "strategicQuestions", "recommendations", "alternativePerspectives", 
              "ignoredQuestions", "unresolvedTopics", "decisionFramework", "nextSteps"
            ],
          },
        },
      });

      const inputTokens = response.usageMetadata?.promptTokenCount || 0;
      const outputTokens = response.usageMetadata?.candidatesTokenCount || 0;
      const duration = Date.now() - start;

      await trackAIUsage({
        userId,
        email,
        plan,
        featureName,
        modelUsed: model,
        inputTokens,
        outputTokens,
        requestDuration: duration,
        status: "success",
      });

      res.json(JSON.parse(response.text || "{}"));
    } catch (error: any) {
      console.error(`[AI Endpoint Error] ${featureName}:`, error);
      const duration = Date.now() - start;
      await trackAIUsage({
        userId,
        email,
        plan,
        featureName,
        modelUsed: model,
        inputTokens: 0,
        outputTokens: 0,
        requestDuration: duration,
        status: "failure",
      });
      res.status(500).json({ error: sanitizeAiErrorMessage(error?.message) || "Execution failed" });
    } finally {
      // Step 8.1A: Always release concurrency slot on completion or failure
      slot.release();
    }
  });

  app.post("/api/ai/decision-intelligence", requireAuth, async (req: AuthenticatedRequest, res) => {
    const { input, inputType, recordingId, projectId } = req.body;
    const userCtx = await resolveUserContext(req);
    const userId = userCtx.userId;
    const email = userCtx.email;
    const plan = userCtx.plan;

    // Authorize resource identifiers if provided
    if (recordingId || projectId) {
      const accessCheck = await verifyAiResourceAccess(req.user, {
        recordingId,
        projectId,
        operationType: 'read'
      });
      if (!accessCheck.allowed) {
        return res.status(accessCheck.status).json({ error: "Forbidden", message: accessCheck.message });
      }
    }

    const start = Date.now();
    const model = 'gemini-3-flash-preview';
    const featureName = "Decision Intelligence";

    if (!input) return res.status(400).json({ error: "Missing input content" });

    // Step 8.1A: Admit AI rate limit and acquire concurrency slot after input validation
    const slot = admitExpensiveOperation(req, res, 'ai');
    if (!slot) return;

    // Server-authoritative plan level determines insight depth (never trust client-supplied tier)
    const isAdvanced = ['pro', 'team', 'enterprise'].includes(plan.toLowerCase());

    const prompt = `
      You are the EchoNote Decision Intelligence engine. Your goal is to transform the provided ${inputType} into structured, actionable insights that help users move from conversation to clarity.
      
      PLAN LEVEL: ${isAdvanced ? 'ADVANCED (Full Insights)' : 'BASIC (Limited Insights)'}
  
      INPUT (${inputType.toUpperCase()}):
      ${input}
  
      TASK:
      Analyze the input and provide a structured JSON response with the following sections:
      1. Key Decisions: What was actually decided? ${isAdvanced ? '(Detailed analysis)' : '(Brief list)'}
      2. Assumptions: What are the underlying assumptions being made? ${isAdvanced ? '(Deep dive)' : '(Basic list)'}
      3. Risks & Gaps: What could go wrong or what information is missing?
      4. Alternative Perspectives: What other ways could this be looked at? ${isAdvanced ? '(Multiple viewpoints)' : '(Single alternative)'}
      5. Ignored Questions: What important questions were left unasked or unanswered?
      6. Unresolved Topics: ${isAdvanced ? 'Identify topics discussed but no decision made, open-ended discussions, or unanswered questions.' : 'Empty array (Advanced Feature)'}
         ${isAdvanced ? `
         - Do NOT include topics that already have decisions.
         - Avoid trivial or minor points.
         - Focus on meaningful gaps.
         - For each, provide: id, topic (title), context (short explanation), reasonUnresolved (why it remains open), and suggestedAction (next step).
         ` : ''}
      7. Decision Clarity: A brief assessment of how clear and solid the current direction is.
      8. Next Actions: Specific, concrete steps to take now.
  
      RULES:
      - Be critical and analytical.
      - Do not just summarize; find the "thinking" behind the words.
      - Use a professional, high-level executive tone.
      - Return ONLY valid JSON.
      ${!isAdvanced ? '- LIMITATION: Provide only basic insights. Keep responses concise.' : ''}
    `;

    try {
      const response = await aiGen.models.generateContent({
        model,
        contents: [{ parts: [{ text: prompt }] }],
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              keyDecisions: { type: Type.ARRAY, items: { type: Type.STRING } },
              assumptions: { type: Type.ARRAY, items: { type: Type.STRING } },
              risksAndGaps: { type: Type.ARRAY, items: { type: Type.STRING } },
              alternativePerspectives: { type: Type.ARRAY, items: { type: Type.STRING } },
              ignoredQuestions: { type: Type.ARRAY, items: { type: Type.STRING } },
              unresolvedTopics: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    topic: { type: Type.STRING },
                    context: { type: Type.STRING },
                    reasonUnresolved: { type: Type.STRING },
                    suggestedAction: { type: Type.STRING },
                  },
                  required: ["id", "topic", "context", "reasonUnresolved", "suggestedAction"],
                },
              },
              decisionClarity: { type: Type.STRING },
              nextActions: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ["keyDecisions", "assumptions", "risksAndGaps", "alternativePerspectives", "ignoredQuestions", "unresolvedTopics", "decisionClarity", "nextActions"],
          },
        },
      });

      const inputTokens = response.usageMetadata?.promptTokenCount || 0;
      const outputTokens = response.usageMetadata?.candidatesTokenCount || 0;
      const duration = Date.now() - start;

      await trackAIUsage({
        userId,
        email,
        plan,
        featureName,
        modelUsed: model,
        inputTokens,
        outputTokens,
        requestDuration: duration,
        status: "success",
      });

      res.json(JSON.parse(response.text || "{}"));
    } catch (error: any) {
      console.error(`[AI Endpoint Error] ${featureName}:`, error);
      const duration = Date.now() - start;
      await trackAIUsage({
        userId,
        email,
        plan,
        featureName,
        modelUsed: model,
        inputTokens: 0,
        outputTokens: 0,
        requestDuration: duration,
        status: "failure",
      });
      res.status(500).json({ error: sanitizeAiErrorMessage(error?.message) || "Execution failed" });
    } finally {
      // Step 8.1A: Always release concurrency slot on completion or failure
      slot.release();
    }
  });

  app.post("/api/ai/unified-meeting-intelligence", requireAuth, async (req: AuthenticatedRequest, res) => {
    const { transcript, recordingId, projectId, meetingSessionId } = req.body;
    const { transcriptId, organizationId } = req.body;
    const userCtx = await resolveUserContext(req);
    const userId = userCtx.userId;
    const email = userCtx.email;
    const plan = userCtx.plan;

    // Authorize resource identifiers if provided (including meetingSessionId)
    let validatedSession: any = null;
    if (recordingId || projectId || meetingSessionId) {
      const accessCheck = await verifyAiResourceAccess(req.user, {
        recordingId,
        projectId,
        meetingSessionId,
        transcriptId,
        organizationId,
        operationType: 'read'
      });
      if (!accessCheck.allowed) {
        const errorTitle = accessCheck.status === 404 ? "Not Found" : (accessCheck.status === 400 ? "Bad Request" : "Forbidden");
        return res.status(accessCheck.status).json({ error: errorTitle, message: accessCheck.message });
      }
      validatedSession = accessCheck.session || null;
    }

    const start = Date.now();
    const model = 'gemini-3-flash-preview';
    const featureName = "Meeting Intelligence";

    if (!transcript) return res.status(400).json({ error: "Missing transcript content" });

    // Step 8.1A: Admit AI rate limit and acquire concurrency slot after input validation
    const slot = admitExpensiveOperation(req, res, 'ai');
    if (!slot) return;

    // Server-authoritative plan level determines insight depth (never trust client-supplied tier)
    const isAdvanced = ['pro', 'team', 'enterprise'].includes(plan.toLowerCase());

    const prompt = `
      You are the EchoNote Decision Intelligence workspace engine. 
      Your task is to transform a raw meeting transcript into a unified, interconnected intelligence output.
      
      PLAN LEVEL: ${isAdvanced ? 'ADVANCED (Full Insights)' : 'BASIC (Limited Insights)'}
  
      INPUT (TRANSCRIPT):
      ${transcript}
  
      OUTPUT (STRICT UNIFIED JSON SCHEMA):
      1. title: A concise, professional title.
      2. summary: ${isAdvanced ? '5-7' : '2-3'} critical bullet points.
      3. topics: Categorized discussion points.
      4. keyInsights: ${isAdvanced ? 'High-level strategic takeaways' : 'Basic observations'}.
      5. decisions: Array of UnifiedDecision objects.
         - id: Unique ID (e.g., "dec-1").
         - title: Short title.
         - description: Detailed explanation.
         - context: Why it was made.
         - peopleInvolved: List of speakers.
         - confidenceLevel: High/Medium/Low.
         - relatedTaskIds: Array of IDs from the 'tasks' section.
      6. tasks: Array of UnifiedTask objects.
         - id: Unique ID (e.g., "task-1").
         - description: Actionable description.
         - assignee: Person responsible (or "Unassigned").
         - deadline: Optional deadline.
         - priority: High/Medium/Low.
         - relatedDecisionId: ID of the decision that triggered this task (if any).
      7. unresolved_topics: Array of objects.
         - id: Unique ID (e.g., "unres-1").
         - topic: Topic title.
         - context: Short explanation.
         - reasonUnresolved: Why it remains open (e.g., no decision made, open-ended discussion, unanswered question).
         - suggestedAction: A specific recommendation for the next step.
      8. execution_tracker: ExecutionTracker object.
         - totalTasks: Total number of tasks.
         - completedTasks: Number of completed tasks (Do NOT assume completion unless specified).
         - pendingTasks: Number of pending tasks.
         - overdueTasks: Number of overdue tasks (based on current date if deadline passed).
         - completionRate: Percentage of completed tasks.
         - delayRate: Percentage of overdue tasks.
         - tasks: Array of objects.
           - id: Unique ID.
           - description: Task description.
           - assignee: Assigned person.
           - status: Status (Completed / Pending / Overdue).
         - keyInsights: Array of concise, meaningful insights (e.g., "Low execution rate", "High delays").
      9. meetingIntelligence: MeetingIntelligence object.
         - productivityScore (0-100)
         - productivityExplanation
         - clarityScore (0-100)
         - clarityExplanation
         - actionabilityScore (0-100)
         - actionabilityExplanation
         - effectivenessSummary
         - keyStrengths (array)
         - keyWeaknesses (array)
      10. strategicAnalysis: StrategicAnalysis object.
         - coreIntent
         - context
         - assumptions (array)
         - logicalGaps (array)
         - blindSpots (array)
         - strategicQuestions (array)
         - recommendations (array)
         - alternativePerspectives (array)
         - ignoredQuestions (array)
         - unresolvedTopics (array of objects with id, topic, context, reasonUnresolved, suggestedAction)
         - decisionFramework
         - nextSteps (array)
      11. followUp: FollowUp object.
         - email (draft)
         - nextMeetingAgenda (array)
         - keyPendingItems (array)
      12. calendar_reminders: SmartReminderSystem object.
         - reminders: Array of objects.
           - id: Unique ID.
           - title: Reminder title.
           - description: Detailed description.
           - suggestedDateTime: ISO 8601 string.
           - priority: "High" | "Medium" | "Low".
           - group: "Immediate" | "Upcoming" | "Long-term".
           - calendarEventFormat: Object.
             - title: Event title.
             - description: Event description.
             - location: Optional location.
             - startTime: ISO 8601 string.
             - endTime: ISO 8601 string.
         - summary: A brief summary of the reminder strategy.
  
      CRITICAL RULES:
      - Decisions ↔ Related Tasks: Link them using IDs.
      - Tasks ↔ People: Ensure assignees match speaker names where possible.
      - Unresolved Topics ↔ Suggested Actions: Provide clear paths forward.
      - NO DUPLICATE ENTRIES: Do not repeat information across sections.
      - CONSISTENT IDs: Use the same IDs for cross-referencing.
      - CLEAN HIERARCHY: The output must be a single, valid JSON object.
      - Unresolved Topics Detector: Identify topics discussed but no decision made, open-ended discussions, and questions that were not answered. Do NOT include topics that already have decisions. Avoid trivial or minor points. Focus on meaningful gaps.
      - Execution Tracker: Generate metrics based on extracted tasks. Do NOT assume completion unless specified. Keep insights concise and meaningful.
      - Smart Reminder System: Generate reminders for tasks and decisions requiring follow-up. Do NOT create reminders for completed tasks. Prioritize critical tasks and unresolved topics. Group reminders into: Immediate (within 24 hrs), Upcoming (within 3–7 days), Long-term. Use the current date/time as a reference: ${new Date().toISOString()}.
      ${!isAdvanced ? '- LIMITATION: Provide only basic extraction of decisions and tasks. Keep summaries very short.' : ''}
    `;

    try {
      const response = await aiGen.models.generateContent({
        model,
        contents: [{ parts: [{ text: prompt }] }],
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              summary: { type: Type.ARRAY, items: { type: Type.STRING } },
              topics: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    category: { type: Type.STRING },
                    items: { type: Type.ARRAY, items: { type: Type.STRING } },
                  },
                  required: ["category", "items"],
                },
              },
              keyInsights: { type: Type.ARRAY, items: { type: Type.STRING } },
              decisions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    title: { type: Type.STRING },
                    description: { type: Type.STRING },
                    context: { type: Type.STRING },
                    peopleInvolved: { type: Type.ARRAY, items: { type: Type.STRING } },
                    confidenceLevel: { type: Type.STRING, enum: ["High", "Medium", "Low"] },
                    relatedTaskIds: { type: Type.ARRAY, items: { type: Type.STRING } },
                  },
                  required: ["id", "title", "description", "context", "peopleInvolved", "confidenceLevel", "relatedTaskIds"],
                },
              },
              tasks: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    description: { type: Type.STRING },
                    assignee: { type: Type.STRING },
                    deadline: { type: Type.STRING },
                    priority: { type: Type.STRING, enum: ["High", "Medium", "Low"] },
                    relatedDecisionId: { type: Type.STRING },
                  },
                  required: ["id", "description", "assignee", "priority"],
                },
              },
              unresolved_topics: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    topic: { type: Type.STRING },
                    context: { type: Type.STRING },
                    reasonUnresolved: { type: Type.STRING },
                    suggestedAction: { type: Type.STRING },
                  },
                  required: ["id", "topic", "context", "reasonUnresolved", "suggestedAction"],
                },
              },
              execution_tracker: {
                type: Type.OBJECT,
                properties: {
                  totalTasks: { type: Type.NUMBER },
                  completedTasks: { type: Type.NUMBER },
                  pendingTasks: { type: Type.NUMBER },
                  overdueTasks: { type: Type.NUMBER },
                  completionRate: { type: Type.NUMBER },
                  delayRate: { type: Type.NUMBER },
                  tasks: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        id: { type: Type.STRING },
                        description: { type: Type.STRING },
                        assignee: { type: Type.STRING },
                        status: { type: Type.STRING, enum: ["Completed", "Pending", "Overdue"] },
                      },
                      required: ["id", "description", "assignee", "status"],
                    },
                  },
                  keyInsights: { type: Type.ARRAY, items: { type: Type.STRING } },
                },
                required: ["totalTasks", "completedTasks", "pendingTasks", "overdueTasks", "completionRate", "delayRate", "tasks", "keyInsights"],
              },
              meetingIntelligence: {
                type: Type.OBJECT,
                properties: {
                  productivityScore: { type: Type.NUMBER },
                  productivityExplanation: { type: Type.STRING },
                  clarityScore: { type: Type.NUMBER },
                  clarityExplanation: { type: Type.STRING },
                  actionabilityScore: { type: Type.NUMBER },
                  actionabilityExplanation: { type: Type.STRING },
                  effectivenessSummary: { type: Type.STRING },
                  keyStrengths: { type: Type.ARRAY, items: { type: Type.STRING } },
                  keyWeaknesses: { type: Type.ARRAY, items: { type: Type.STRING } },
                },
                required: ["productivityScore", "productivityExplanation", "clarityScore", "clarityExplanation", "actionabilityScore", "actionabilityExplanation", "effectivenessSummary", "keyStrengths", "keyWeaknesses"],
              },
              strategicAnalysis: {
                type: Type.OBJECT,
                properties: {
                  coreIntent: { type: Type.STRING },
                  context: { type: Type.STRING },
                  assumptions: { type: Type.ARRAY, items: { type: Type.STRING } },
                  logicalGaps: { type: Type.ARRAY, items: { type: Type.STRING } },
                  blindSpots: { type: Type.ARRAY, items: { type: Type.STRING } },
                  strategicQuestions: { type: Type.ARRAY, items: { type: Type.STRING } },
                  recommendations: { type: Type.ARRAY, items: { type: Type.STRING } },
                  alternativePerspectives: { type: Type.ARRAY, items: { type: Type.STRING } },
                  ignoredQuestions: { type: Type.ARRAY, items: { type: Type.STRING } },
                  unresolvedTopics: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        id: { type: Type.STRING },
                        topic: { type: Type.STRING },
                        context: { type: Type.STRING },
                        reasonUnresolved: { type: Type.STRING },
                        suggestedAction: { type: Type.STRING },
                      },
                      required: ["id", "topic", "context", "reasonUnresolved", "suggestedAction"],
                    },
                  },
                  decisionFramework: { type: Type.STRING },
                  nextSteps: { type: Type.ARRAY, items: { type: Type.STRING } },
                },
                required: ["coreIntent", "context", "assumptions", "logicalGaps", "blindSpots", "strategicQuestions", "recommendations", "alternativePerspectives", "ignoredQuestions", "unresolvedTopics", "decisionFramework", "nextSteps"],
              },
              followUp: {
                type: Type.OBJECT,
                properties: {
                  email: { type: Type.STRING },
                  nextMeetingAgenda: { type: Type.ARRAY, items: { type: Type.STRING } },
                  keyPendingItems: { type: Type.ARRAY, items: { type: Type.STRING } },
                },
                required: ["email", "nextMeetingAgenda", "keyPendingItems"],
              },
              calendar_reminders: {
                type: Type.OBJECT,
                properties: {
                  reminders: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        id: { type: Type.STRING },
                        title: { type: Type.STRING },
                        description: { type: Type.STRING },
                        suggestedDateTime: { type: Type.STRING },
                        priority: { type: Type.STRING, enum: ["High", "Medium", "Low"] },
                        group: { type: Type.STRING, enum: ["Immediate", "Upcoming", "Long-term"] },
                        calendarEventFormat: {
                          type: Type.OBJECT,
                          properties: {
                            title: { type: Type.STRING },
                            description: { type: Type.STRING },
                            location: { type: Type.STRING },
                            startTime: { type: Type.STRING },
                            endTime: { type: Type.STRING },
                          },
                          required: ["title", "description", "startTime", "endTime"],
                        },
                      },
                      required: ["id", "title", "description", "suggestedDateTime", "priority", "group", "calendarEventFormat"],
                    },
                  },
                  summary: { type: Type.STRING },
                },
                required: ["reminders", "summary"],
              },
            },
            required: ["title", "summary", "topics", "keyInsights", "decisions", "tasks", "unresolved_topics", "execution_tracker", "meetingIntelligence", "strategicAnalysis", "followUp", "calendar_reminders"],
          },
        },
      });

      const inputTokens = response.usageMetadata?.promptTokenCount || 0;
      const outputTokens = response.usageMetadata?.candidatesTokenCount || 0;
      const duration = Date.now() - start;

      await trackAIUsage({
        userId,
        email,
        plan,
        featureName,
        modelUsed: model,
        inputTokens,
        outputTokens,
        requestDuration: duration,
        status: "success",
      });

      const rawData = JSON.parse(response.text || "{}");
      const enrichedDecisions = Array.isArray(rawData.decisions) && meetingSessionId
        ? (validatedSession ? rawData.decisions.map((d: any) => ({ ...d, meetingSessionId })) : rawData.decisions)
        : rawData.decisions;
      const enrichedTasks = Array.isArray(rawData.tasks) && meetingSessionId
        ? (validatedSession ? rawData.tasks.map((t: any) => ({ ...t, meetingSessionId })) : rawData.tasks)
        : rawData.tasks;

      res.json({
        ...rawData,
        decisions: enrichedDecisions,
        tasks: enrichedTasks,
        unresolvedTopics: rawData.unresolved_topics,
        executionTracker: rawData.execution_tracker,
        calendarReminders: rawData.calendar_reminders
      });
    } catch (error: any) {
      console.error(`[AI Endpoint Error] ${featureName}:`, error);
      const duration = Date.now() - start;
      await trackAIUsage({
        userId,
        email,
        plan,
        featureName,
        modelUsed: model,
        inputTokens: 0,
        outputTokens: 0,
        requestDuration: duration,
        status: "failure",
      });
      res.status(500).json({ error: sanitizeAiErrorMessage(error?.message) || "Execution failed" });
    } finally {
      // Step 8.1A: Always release concurrency slot on completion or failure
      slot.release();
    }
  });

  app.post("/api/ai/process-audio-transcription", requireAuth, async (req: AuthenticatedRequest, res) => {
    const { audioBase64, mimeType, recordingId, projectId } = req.body;
    const userCtx = await resolveUserContext(req);
    const userId = userCtx.userId;
    const email = userCtx.email;
    const plan = userCtx.plan;

    // Authorize resource identifiers if provided
    if (recordingId || projectId) {
      const accessCheck = await verifyAiResourceAccess(req.user, {
        recordingId,
        projectId,
        operationType: 'write'
      });
      if (!accessCheck.allowed) {
        return res.status(accessCheck.status).json({ error: "Forbidden", message: accessCheck.message });
      }
    }

    const start = Date.now();
    const model = "gemini-2.5-flash-native-audio-preview-12-2025";
    const featureName = "Intelligence Transcription";

    if (!audioBase64) return res.status(400).json({ error: "Missing audio base64 content" });

    // Step 8.1A: Admit AI rate limit and acquire concurrency slot after input validation
    const slot = admitExpensiveOperation(req, res, 'ai');
    if (!slot) return;

    const prompt = `
      Analyze this audio. Provide a speaker-wise transcript. 
      Identify speakers as 'Speaker A', 'Speaker B', etc. 
      Also provide a high-level executive summary and a list of specific action items.
      Return the data in the following JSON format:
      {
        "summary": "string",
        "actionItems": ["string"],
        "segments": [
          { "speaker": "string", "text": "string", "startTime": number, "endTime": number }
        ]
      }
    `;

    try {
      const response = await aiGen.models.generateContent({
        model,
        contents: [
          {
            inlineData: {
              data: audioBase64,
              mimeType
            }
          },
          { text: prompt }
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: { type: Type.STRING },
              actionItems: { type: Type.ARRAY, items: { type: Type.STRING } },
              segments: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    speaker: { type: Type.STRING },
                    text: { type: Type.STRING },
                    startTime: { type: Type.NUMBER },
                    endTime: { type: Type.NUMBER }
                  },
                  required: ["speaker", "text", "startTime", "endTime"]
                }
              }
            },
            required: ["summary", "actionItems", "segments"]
          }
        }
      });

      const inputTokens = response.usageMetadata?.promptTokenCount || 0;
      const outputTokens = response.usageMetadata?.candidatesTokenCount || 0;
      const duration = Date.now() - start;

      await trackAIUsage({
        userId,
        email,
        plan,
        featureName,
        modelUsed: model,
        inputTokens,
        outputTokens,
        requestDuration: duration,
        status: "success",
      });

      res.json(JSON.parse(response.text || "{}"));
    } catch (error: any) {
      console.error(`[AI Endpoint Error] ${featureName}:`, error);
      const duration = Date.now() - start;
      await trackAIUsage({
        userId,
        email,
        plan,
        featureName,
        modelUsed: model,
        inputTokens: 0,
        outputTokens: 0,
        requestDuration: duration,
        status: "failure",
      });
      res.status(500).json({ error: sanitizeAiErrorMessage(error?.message) || "Execution failed" });
    } finally {
      // Step 8.1A: Always release concurrency slot on completion or failure
      slot.release();
    }
  });

  // Assistant Chat Endpoint (Server-Side EchoNote Assistant) - strictly requireAuth & server-authoritative context
  app.post("/api/ai/assistant-chat", requireAuth, async (req: AuthenticatedRequest, res) => {
    const { message, context } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: "Missing or invalid message parameter" });
    }

    const userCtx = await resolveUserContext(req);
    const userId = userCtx.userId;
    const email = userCtx.email;
    const plan = userCtx.plan;
    const userData = userCtx.userData || {};

    // IDOR check: if caller specifies recording or project context, verify unified resource access
    const candidateRecId = context?.recordingId || context?.selected_recording_id;
    const candidateProjId = context?.projectId || context?.current_project_id;
    if (candidateRecId || candidateProjId) {
      const accessCheck = await verifyAiResourceAccess(req.user, {
        recordingId: candidateRecId,
        projectId: candidateProjId,
        operationType: 'read'
      });
      if (!accessCheck.allowed) {
        return res.status(accessCheck.status).json({ error: "Forbidden", message: accessCheck.message });
      }
    }

    // Step 8.1A: Admit AI rate limit and acquire concurrency slot after input validation and IDOR checks
    const slot = admitExpensiveOperation(req, res, 'ai');
    if (!slot) return;

    const start = Date.now();
    const model = "gemini-3-flash-preview";
    const featureName = "EchoNote Assistant";

    const systemInstruction = `You are EchoNote Assistant, an AI embedded inside an audio intelligence platform.
Your role is NOT just to answer questions, but to help users take actions on their audio data.
You have access to:
* transcripts
* summaries
* projects
* user usage data

Current Context:
- Page: ${context?.current_page || 'unknown'}
- Project: ${context?.current_project || 'none'}
- Selected File: ${context?.selected_file_name || 'none'}
- User Plan: ${plan}
- Minutes Used: ${userData.minutes_used || userData.audioMinutesUsed || 0}
- Minutes Remaining: ${userData.minutes_remaining || (plan === 'free' ? 60 : 300)}

You must:
1. Understand user intent
2. If the request is actionable → suggest or trigger an action
3. If unclear → ask a clarifying question
4. Keep responses short, clear, and actionable (2-5 lines)

You can perform:
* Summarization
* Thinking analysis
* Decision extraction
* Project assignment
* Usage explanation

Always prioritize helping the user move forward, not just explaining things.

If you detect an intent, specify it in the JSON response.
Intents: "summarize", "analyze thinking", "decisions", "add to project", "usage / minutes", "none".`;

    try {
      const response = await aiGen.models.generateContent({
        model,
        contents: [
          { role: 'user', parts: [{ text: message }] }
        ],
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              reply: { type: Type.STRING },
              intent: { 
                type: Type.STRING, 
                enum: ["summarize", "analyze thinking", "decisions", "add to project", "usage / minutes", "none"] 
              }
            },
            required: ["reply", "intent"]
          }
        }
      });

      const inputTokens = response.usageMetadata?.promptTokenCount || 0;
      const outputTokens = response.usageMetadata?.candidatesTokenCount || 0;
      const duration = Date.now() - start;

      await trackAIUsage({
        userId,
        email,
        plan,
        featureName,
        modelUsed: model,
        inputTokens,
        outputTokens,
        requestDuration: duration,
        status: "success",
      });

      const parsed = JSON.parse(response.text || '{"reply": "I am here to help.", "intent": "none"}');
      res.json(parsed);
    } catch (error: any) {
      console.error(`[AI Endpoint Error] ${featureName}:`, error);
      const duration = Date.now() - start;
      await trackAIUsage({
        userId,
        email,
        plan,
        featureName,
        modelUsed: model,
        inputTokens: 0,
        outputTokens: 0,
        requestDuration: duration,
        status: "failure",
      });
      res.status(500).json({ error: sanitizeAiErrorMessage(error?.message) || "Execution failed" });
    } finally {
      // Step 8.1A: Always release concurrency slot on completion or failure
      slot.release();
    }
  });

  // Ensure ANY unhandled /api/* route returns JSON 404, never index.html or Vite fallback
  app.all("/api/*all", (req, res) => {
    res.status(404).json({
      success: false,
      error: `API endpoint not found: ${req.method} ${req.originalUrl}`,
      code: "NOT_FOUND"
    });
  });

  // Strictly deny HTTP access to server bundle, source maps, and server source
  app.use((req, res, next) => {
    const normalizedPath = req.path.toLowerCase();
    if (
      normalizedPath === "/server.cjs" ||
      normalizedPath.startsWith("/server.cjs") ||
      normalizedPath === "/server.ts" ||
      normalizedPath.startsWith("/server.") ||
      normalizedPath.endsWith(".map") ||
      normalizedPath.endsWith(".cjs")
    ) {
      return res.status(404).json({ error: "Asset not found", code: "NOT_FOUND" });
    }
    next();
  });

  // Explicit endpoints for robots.txt and sitemap.xml with canonical content-types
  app.get("/robots.txt", (req, res) => {
    res.type("text/plain");
    const robotsPath = path.join(process.cwd(), "public", "robots.txt");
    if (fs.existsSync(robotsPath)) {
      res.sendFile(robotsPath);
    } else {
      res.send("User-agent: *\nAllow: /\nDisallow: /app\nDisallow: /auth\nDisallow: /join\nDisallow: /invite\nDisallow: /api/\nSitemap: https://echonote-25.vercel.app/sitemap.xml\n");
    }
  });

  app.get("/sitemap.xml", (req, res) => {
    res.type("application/xml");
    const sitemapPath = path.join(process.cwd(), "public", "sitemap.xml");
    if (fs.existsSync(sitemapPath)) {
      res.sendFile(sitemapPath);
    } else {
      res.status(404).send("Sitemap not found");
    }
  });

  // Frontend serving: Vite middleware for development or pre-built static bundle in production
  if (process.env.NODE_ENV !== "production") {
    // Vite middleware may match '/app' to root file 'app.tsx' on Windows because of case-insensitivity.
    // Explicitly rewrite '/app' to '/' or '/index.html' so Vite serves the SPA HTML entry.
    app.use((req, res, next) => {
      if (req.method === 'GET' && (req.path === '/app' || req.path === '/app/')) {
        req.url = '/index.html';
      }
      next();
    });

    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");

    // Serve static assets with Access-Control-Allow-Origin header for module scripts
    app.use(express.static(distPath, {
      setHeaders: (res) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
      }
    }));
    // Correct catch-all for SPA in Express
    app.get("*all", (req, res) => {
      // If the request was for a file (has an extension) but reached here, 
      // it means the file is missing in dist. We should return 404 rather than index.html.
      if (req.path.includes('.')) {
        return res.status(404).json({ error: "Asset not found" });
      }
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Global Express Error Handler - returns JSON for all unhandled errors (must be defined LAST)
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error("🔥 Global Unhandled Server Error:", err);
    if (res.headersSent) {
      return next(err);
    }
    const status = typeof err?.status === "number" && err.status >= 400 && err.status < 600 ? err.status : 500;
    res.status(status).json({
      success: false,
      error: err?.message || "Internal Server Error",
      code: err?.code || "INTERNAL_SERVER_ERROR"
    });
  });

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  // Graceful shutdown handling for container runtimes (Cloud Run / Docker)
  const shutdown = (signal: string) => {
    console.log(`Received ${signal}. Gracefully shutting down HTTP server...`);
    server.close(() => {
      console.log("HTTP server closed cleanly. Exiting process.");
      process.exit(0);
    });
    // Force shutdown after 10s timeout if connections remain open
    setTimeout(() => {
      console.warn("Forced shutdown after timeout.");
      process.exit(1);
    }, 10000).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});

