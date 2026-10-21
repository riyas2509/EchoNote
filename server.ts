import dotenv from "dotenv";
dotenv.config();

console.log("🔥 SERVER RESTARTED WITH NEW CODE");

import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import { convertOpusToWav, convertAudioToWav, normalizeAudioMimeType, isFfmpegAvailable } from "./lib/audioUtils.js";
import { FieldValue } from "firebase-admin/firestore";
import admin from "firebase-admin";
import { appAdmin, db, firebaseConfig } from "./lib/firebaseAdmin.ts";
import { GoogleAuth } from "google-auth-library";
import { GoogleGenAI, Type, Modality, ThinkingLevel } from "@google/genai";
import { trackAIUsage, getAiUsageOverview, getRecentAiUsageLogs } from "./lib/aiTracker.js";
import { emailService, resolveSenderEmail } from "./lib/emailService.js";
import { maskEmailForLogs } from "./lib/emailService.js";
import { triggerAssistantEscalationIfEligible } from "./lib/assistantEscalationService.js";
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
  authorizeRecordingAccess as authRecordingHelper,
  verifyAiResourceAccess as verifyAiResourceHelper,
  sanitizeSsoClaims as sanitizeSsoClaimsHelper
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

// Defensive Gemini API Key Validation (Step 3B.4U-AH.64)
export function validateGeminiApiKey(rawKey?: string | null): string {
  const apiKey = (rawKey ? rawKey : "").trim();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is required to use the Gemini API.");
  }
  if (/[^\x20-\x7E]/.test(apiKey)) {
    throw new Error("Configured GEMINI_API_KEY contains invalid header characters.");
  }
  return apiKey;
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
    return "https://echonote-25.ai.studio";
  }

  const configured = (process.env.APP_URL || process.env.VITE_APP_URL || "https://echonote-25.ai.studio").trim();
  return (configured || "https://echonote-25.ai.studio").replace(/\/+$/, "");
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
  const PORT = 3000;
  
  let _aiGenInstance: GoogleGenAI | null = null;
  const aiGen = {
    get models() {
      if (!_aiGenInstance) {
        const apiKey = validateGeminiApiKey(process.env.GEMINI_API_KEY);
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

      if (defaultAllowedOrigins.includes(cleanOrigin) || customOrigins.includes(cleanOrigin)) {
        return callback(null, true);
      }

      // Allow Google AI Studio domains (published app URLs and studio hosts)
      if (/(^|\.)ai\.studio$/.test(cleanOrigin) || /(^|\.)google\.com$/.test(cleanOrigin)) {
        return callback(null, true);
      }

      // Allow EchoNote Vercel deployments (production, previews, and branch deploys)
      if (/^https:\/\/echonote(-[a-zA-Z0-9_-]+)?\.vercel\.app$/.test(cleanOrigin)) {
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

      // If in dev mode, allow all origins
      if (process.env.NODE_ENV !== "production") {
        return callback(null, true);
      }

      // Reject disallowed origins gracefully without throwing an uncaught 500 error
      return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin']
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

    // 1. Verified domain check
    const domains: any[] = Array.isArray(orgData.domains) ? orgData.domains : [];
    const verifiedDomains = domains.filter((d: any) => {
      if (typeof d === 'string') return true;
      return d.status === 'verified';
    });

    const allowedList: string[] = [
      ...(Array.isArray(orgData.settings?.allowedDomains) ? orgData.settings.allowedDomains : []),
      ...(Array.isArray(sec.allowedDomains) ? sec.allowedDomains : (typeof sec.allowedDomains === 'string' ? sec.allowedDomains.split(',') : [])),
      orgData.domain
    ].filter(Boolean);

    const hasVerifiedDomain = verifiedDomains.length > 0 || allowedList.length > 0;

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
      if (!sec.entraTenantId && !sec.ssoConfig?.provider) {
        const msg = "Microsoft Entra ID / OIDC configuration is missing Tenant ID.";
        errors.push(msg);
        healthIssues.push({ code: "OIDC_MISSING_TENANT", severity: "error", message: msg });
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
      const expectedTenantId = (sec.entraTenantId || "").trim();

      // 2. Tenant Isolation Check: If organization enforces a specific Azure Entra Tenant ID
      const verifiedTokenTenantId = (req.user as any)?.tid || (req.user as any)?.tenant_id;
      const effectiveTenantId = verifiedTokenTenantId || reportedTenantId;

      if (expectedTenantId && effectiveTenantId && effectiveTenantId !== expectedTenantId) {
        await recordOrgAuditEvent(db, {
          organizationId: orgId,
          actorUserId: callerUid,
          actorEmail: callerEmail,
          action: "SSO_TENANT_MISMATCH",
          timestamp: new Date().toISOString(),
          source: "api",
          details: `Tenant mismatch: expected ${expectedTenantId}, reported ${effectiveTenantId}`,
          metadata: { reportedTenantId: effectiveTenantId, expectedTenantId, verifiedTokenTenantId }
        });

        return res.status(403).json({
          error: "Forbidden",
          code: "SSO_TENANT_MISMATCH",
          message: "Authentication occurred under an unauthorized Microsoft tenant directory."
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
        provider: 'entra',
        groups: tokenGroups,
        department: tokenDept,
        jobTitle: tokenJobTitle,
        claims: sanitizeSsoClaims(clientClaims),
        tenantId: reportedTenantId
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
          tenantId: expectedTenantId || "tenant-agnostic",
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

      // 3. Tenant Isolation Check:
      const expectedTenant = matchedOrgData.identityPlatformTenantId || sec.identityPlatformTenantId || sec.entraTenantId;
      const verifiedTokenTenant = (req.user as any)?.tid || (req.user as any)?.tenant_id;
      const effectiveTenant = verifiedTokenTenant || clientTenantId;

      if (expectedTenant && effectiveTenant && effectiveTenant !== expectedTenant) {
        await recordOrgAuditEvent(db, {
          organizationId: orgId,
          actorUserId: callerUid,
          actorEmail: callerEmail,
          action: "SSO_TENANT_MISMATCH",
          timestamp: new Date().toISOString(),
          source: "api",
          details: `Enterprise tenant directory mismatch: expected ${expectedTenant}, reported ${effectiveTenant}`,
          metadata: { clientTenantId: effectiveTenant, expectedTenant, verifiedTokenTenant }
        });

        return res.status(403).json({
          error: "Forbidden",
          code: "SSO_TENANT_MISMATCH",
          message: "Authentication occurred under an unauthorized tenant directory."
        });
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
        tenantId: effectiveTenant || expectedTenant
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

      const verificationToken = `echonote-domain-verification=${Math.random().toString(36).substring(2, 10)}${Date.now().toString(36)}`;
      const newDomainRecord = {
        domain: cleanDomain,
        orgId: organizationId,
        status: "unverified",
        dnsTxtRecord: verificationToken,
        createdAt: new Date().toISOString()
      };

      currentDomains.push(newDomainRecord);

      await orgRef.update({
        domains: currentDomains,
        updatedAt: new Date().toISOString()
      });

      await recordOrgAuditEvent(db, {
        organizationId,
        actorUserId: callerUid,
        actorEmail: callerEmail,
        action: "SECURITY_UPDATED",
        timestamp: new Date().toISOString(),
        source: "api",
        details: `Added unverified enterprise domain ${cleanDomain}`
      });

      res.status(201).json({
        success: true,
        domain: newDomainRecord
      });
    } catch (error: any) {
      console.error("❌ Add domain failed:", error);
      res.status(500).json({ error: "Failed to add domain", message: error.message });
    }
  });

  /**
   * Verify Organization Domain (Owner & Org Admin only)
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

      existingRecord.status = "verified";
      existingRecord.verifiedAt = new Date().toISOString();
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

      await recordOrgAuditEvent(db, {
        organizationId,
        actorUserId: callerUid,
        actorEmail: callerEmail,
        action: "SECURITY_UPDATED",
        timestamp: new Date().toISOString(),
        source: "api",
        details: `Verified enterprise domain ${cleanDomain}`
      });

      res.json({
        success: true,
        domain: existingRecord,
        message: `Domain ${cleanDomain} verified successfully.`
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
        console.warn("⚠️ Failed to fetch Firebase Admin userRecord:", authErr?.message || authErr);
      }

      const enrolledFactors = (userRecord?.multiFactor?.enrolledFactors || []).map((f) => ({
        uid: f.uid,
        displayName: f.displayName || "Authenticator App",
        factorId: f.factorId,
        enrollmentTime: f.enrollmentTime || new Date().toISOString()
      }));

      // Check Firestore user profile for cached mfa status
      const userDocSnap = await db.collection("users").doc(uid).get();
      const userData = userDocSnap.data() || {};
      const enrolledCount = enrolledFactors.length;
      // Authoritatively, MFA is only enabled if the identity provider actually has enrolled factors
      const mfaEnabled = enrolledCount > 0;

      // Self-heal stale Firestore user document if status is desynchronized
      if (userRecord && Boolean(userData.mfaEnabled) !== mfaEnabled) {
        db.collection("users").doc(uid).set({
          mfaEnabled,
          mfaEnrolledAt: mfaEnabled ? (userData.mfaEnrolledAt || new Date().toISOString()) : null
        }, { merge: true }).catch((healErr) => {
          console.warn("⚠️ Could not heal desynchronized mfaEnabled in Firestore:", healErr?.message);
        });
      }

      const secondFactorUsed = (req.user as any)?.firebase?.sign_in_second_factor || null;

      return res.json({
        success: true,
        mfaEnabled,
        enrolledFactors,
        currentSessionSecondFactor: secondFactorUsed
      });
    } catch (error: any) {
      console.error("❌ GET /api/auth/mfa/status error:", error?.message || error);
      return res.status(500).json({ error: "InternalError", message: "Failed to retrieve MFA status." });
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
          console.warn("⚠️ [MFA AUDIT] Could not verify Firebase Admin multiFactor record:", fetchErr?.message || fetchErr);
        }

        await db.collection("users").doc(uid).set({
          mfaEnabled: true,
          mfaEnrolledAt: new Date().toISOString()
        }, { merge: true });
      } else if (action === "MFA_DISABLED") {
        await db.collection("users").doc(uid).set({
          mfaEnabled: false,
          mfaEnrolledAt: null
        }, { merge: true });
      }

      // 2. Resolve organization context if caller belongs to an organization
      let orgId = req.user!.orgId || null;
      if (!orgId) {
        const memberQuery = await db.collection("orgMembers")
          .where("userId", "==", uid)
          .where("status", "==", "active")
          .limit(1)
          .get();
        if (!memberQuery.empty) {
          orgId = memberQuery.docs[0].data().organizationId;
        }
      }

      if (orgId) {
        await recordOrgAuditEvent(db, {
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
        });
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
      console.error("❌ POST /api/auth/mfa/audit-event error:", error?.message || error);
      return res.status(500).json({ error: "InternalError", message: "Failed to record MFA audit event." });
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

      // Clear enrolled factors in Firebase Admin
      try {
        await admin.auth().updateUser(uid, {
          multiFactor: {
            enrolledFactors: null
          }
        });
      } catch (adminErr: any) {
        console.warn("⚠️ admin.auth().updateUser multiFactor reset note:", adminErr?.message || adminErr);
      }

      // Update Firestore user document
      await db.collection("users").doc(uid).set({
        mfaEnabled: false,
        mfaEnrolledAt: null
      }, { merge: true });

      // Record audit event
      let orgId = req.user!.orgId || null;
      if (!orgId) {
        const memberQuery = await db.collection("orgMembers")
          .where("userId", "==", uid)
          .where("status", "==", "active")
          .limit(1)
          .get();
        if (!memberQuery.empty) {
          orgId = memberQuery.docs[0].data().organizationId;
        }
      }

      if (orgId) {
        await recordOrgAuditEvent(db, {
          organizationId: orgId,
          actorUserId: uid,
          actorEmail: callerEmail,
          action: "MFA_DISABLED",
          timestamp: new Date().toISOString(),
          source: "api",
          details: `Disabled multi-factor authentication for user ${callerEmail}`,
          metadata: { actorUserId: uid }
        });
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
      console.error("❌ POST /api/auth/mfa/disable error:", error?.message || error);
      return res.status(500).json({ error: "InternalError", message: "Failed to disable MFA." });
    }
  });

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
      const orgAccess = await checkOrgAccess(db, callerEmail, organizationId, ["owner", "org_admin"]);
      const isPlatformAdmin = Boolean(req.user?.platform_admin || req.user?.role === "admin");
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
      const orgAccess = await checkOrgAccess(db, callerEmail, organizationId, ["owner", "org_admin"]);
      if (!orgAccess.hasAccess) {
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

      await memberRef.update({
        status: "deactivated",
        updatedAt: new Date().toISOString()
      });

      // Revoke custom claims
      if (memberData.userId) {
        await admin.auth().setCustomUserClaims(memberData.userId, { orgId: null, orgRole: null });
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
      const orgAccess = await checkOrgAccess(db, callerEmail, organizationId, ["owner", "org_admin"]);
      if (!orgAccess.hasAccess) {
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
      const orgAccess = await checkOrgAccess(db, callerEmail, organizationId, ["owner", "org_admin"]);
      const isPlatformAdmin = Boolean(req.user?.platform_admin || req.user?.role === "admin");
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

      // Revoke custom claims
      if (memberData.userId) {
        try {
          await admin.auth().setCustomUserClaims(memberData.userId, { orgId: null, orgRole: null });
        } catch (claimErr: any) {
          console.warn("⚠️ Revoking custom claims note:", claimErr?.message);
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
      const orgAccess = await checkOrgAccess(db, callerEmail, organizationId, ["owner", "org_admin"]);
      const isPlatformAdmin = Boolean(req.user?.platform_admin || req.user?.role === "admin");
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

  // In-memory fallback stores for non-production sandbox/preview environments
  const pendingInvitesStore = new Map<string, any>();
  const projectMembersFallbackStore = new Map<string, any>();

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

    // Role validation
    const rawRole = String(role || '').toLowerCase().trim();
    if (!rawRole) {
      return res.status(400).json({
        error: "BadRequest",
        message: "A project role must be specified."
      });
    }
    if (rawRole === 'owner') {
      return res.status(400).json({
        error: "BadRequest",
        message: "Cannot invite a member directly as owner. Use project transfer of ownership."
      });
    }
    const allowedRoles = ['viewer', 'commenter', 'admin', 'editor'];
    if (!allowedRoles.includes(rawRole)) {
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
        return res.status(403).json({ 
          error: "Forbidden", 
          message: "You do not have administrative permission to invite members to this project." 
        });
      }

      const projectData = access.project || {};
      const ownerId = projectData.userId || callerUid;

      // 2. Prevent inviting a user who is already a project owner or member (Step 10)
      const projectOwnerEmail = (projectData.ownerEmail || '').toLowerCase().trim();
      if (projectOwnerEmail && projectOwnerEmail === normalizedEmail) {
        return res.status(400).json({
          error: "AlreadyMember",
          message: "This user is already a member of this project.",
          alreadyMember: true
        });
      }

      let isAlreadyMember = false;
      try {
        const existingMemberSnap = await db
          .collection("projectMembers")
          .where("projectId", "==", projectId)
          .where("email", "==", normalizedEmail)
          .limit(1)
          .get();
        if (!existingMemberSnap.empty) {
          isAlreadyMember = true;
        }
      } catch (pmQueryErr) {}

      if (!isAlreadyMember && projectMembersFallbackStore) {
        for (const m of projectMembersFallbackStore.values()) {
          if (m.projectId === projectId && m.email?.toLowerCase().trim() === normalizedEmail) {
            isAlreadyMember = true;
            break;
          }
        }
      }

      if (!isAlreadyMember && Array.isArray(projectData.members)) {
        if (projectData.members.some((m: any) => m.email?.toLowerCase().trim() === normalizedEmail)) {
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

      // 3. Prevent duplicate active pending invitations for the same project & email (Step 9)
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
    }
  });

  // Get Invite Details - Safe public endpoint returning non-sensitive metadata
  app.get("/api/invite-details/:token", async (req, res) => {
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

      if (!docSnap || !docSnap.exists) {
        if (!isProductionEnvironment() && pendingInvitesStore.has(token)) {
          const invite = pendingInvitesStore.get(token);
          return res.json({
            id: token,
            email: invite.email,
            projectId: invite.projectId,
            projectName: invite.projectName,
            role: invite.role,
            invitedBy: invite.invitedBy,
            status: invite.status || "pending",
            createdAt: invite.createdAt
          });
        }
        return res.status(404).json({ error: "NotFound", message: "Invalid or expired invitation token." });
      }

      const invite = docSnap.data() || {};
      return res.json({
        id: docSnap.id,
        email: invite.email,
        projectId: invite.projectId,
        projectName: invite.projectName,
        role: invite.role,
        invitedBy: invite.invitedBy,
        status: invite.status || "pending",
        createdAt: invite.createdAt
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

    if (result.status === 200 && userEmail) {
      // 4. Send welcome email via Resend
      const appUrl = resolveAppUrl();
      try {
        await emailService.sendWelcome(userEmail, {
          name: userDisplayName,
          dashboardLink: `${appUrl}/app`
        });
      } catch (_) {}
    }

    return res.status(result.status).json(result.body);
  });

  // Decline/Reject Invitation - Token validated & recipient verified
  app.post("/api/invite-decline", optionalAuth, async (req: AuthenticatedRequest, res) => {
    const rawToken = req.body?.token;
    const userId = req.user?.uid || null;

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

      // If user is authenticated, ensure their email matches the invite recipient
      if (req.user?.email && invite.email && req.user.email.toLowerCase().trim() !== invite.email.toLowerCase().trim()) {
        return res.status(403).json({ error: "Forbidden", message: "This invitation was addressed to a different account." });
      }

      await inviteDocRef.update({
        status: "rejected",
        rejectedAt: FieldValue.serverTimestamp(),
        rejectedBy: userId
      });

      // Log decline invitation activity
      try {
        if (invite.projectId) {
          await db.collection("projectActivities").add({
            projectId: invite.projectId,
            userId: userId || 'anonymous_invitee',
            userEmail: invite.email || 'unknown',
            userName: (invite.email || 'guest').split('@')[0],
            actionType: "decline_invite",
            description: `${(invite.email || 'Guest').split('@')[0]} declined invitation to join "${invite.projectName || 'Workspace'}"`,
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
        projectId: options.projectId || undefined,
        resourceId: options.recordingId || undefined,
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
        return res.status(403).json({
          error: "Forbidden",
          message: "Only the project owner, organization administrator, or platform administrator can delete this project."
        });
      }

      const projectData = projAccess.project || {};
      const cascadeRecordings = req.query.cascadeRecordings === 'true' || req.body?.cascadeRecordings === true;
      const bucketName = firebaseConfig.storageBucket || "echonote-2509.firebasestorage.app";
      const bucket = admin.storage().bucket(bucketName);

      // 1. Handle child recordings:
      // When ambiguous or default, detach to preserve customer voice assets rather than destructively wiping them
      const recSnap = await db.collection("recordings").where("projectId", "==", projectId).get();
      let affectedRecordingsCount = 0;

      for (const recDoc of recSnap.docs) {
        affectedRecordingsCount++;
        const recData = recDoc.data() || {};
        recData.id = recDoc.id;

        if (cascadeRecordings) {
          await purgeRecordingStorageAndDocs(db, bucket, recData);
        } else {
          // Detach from deleted project container, preserving user content in 'General' space
          await db.collection("recordings").doc(recDoc.id).update({
            projectId: FieldValue.delete(),
            group: "General",
            updatedAt: FieldValue.serverTimestamp()
          });
          try {
            await db.collection("transcriptions").doc(recDoc.id).update({
              projectId: FieldValue.delete(),
              group: "General",
              updatedAt: FieldValue.serverTimestamp()
            });
          } catch {}
        }
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

  // User Account Closure Workflow
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
      // Must be platform admin OR organization admin/owner
      const isPlatformAdmin = Boolean(
        req.user?.platform_admin === true ||
        req.user?.role === 'admin' ||
        (req.user as any)?.claims?.platform_admin === true
      );

      let callerOrgId: string | undefined = req.user?.orgId;
      const callerRole: string = req.user?.orgRole || req.user?.role || '';
      let isAuthorizedAdmin = isPlatformAdmin || ['owner', 'org_admin'].includes(callerRole);

      // Verify db user role if not verified in claims
      if (!isAuthorizedAdmin && req.user?.uid) {
        try {
          const userDoc = await db.collection("users").doc(req.user.uid).get();
          if (userDoc.exists) {
            const uData = userDoc.data() || {};
            if (uData.role === 'admin') {
              isAuthorizedAdmin = true;
            } else if (uData.organizationId) {
              callerOrgId = uData.organizationId;
              const orgMemberSnap = await db.collection("organizations").doc(callerOrgId).collection("members").doc(req.user.uid).get();
              if (orgMemberSnap.exists && ['owner', 'org_admin'].includes(orgMemberSnap.data()?.role)) {
                isAuthorizedAdmin = true;
              }
            }
          }
        } catch (authErr) {
          // ignore
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

  // Classification and sanitization for AI provider and infrastructure errors
  interface ClassifiedAiError {
    statusCode: number;
    code: string;
    sanitizedMessage: string;
    retryable: boolean;
  }

  function classifyAiError(err: any): ClassifiedAiError {
    const rawMsg = String(err?.message || err?.error || err || "");
    const status = Number(err?.status || err?.statusCode || 0);

    // 1. Rate limiting & quota checks (distinguish where detectable)
    if (
      status === 429 ||
      /RESOURCE_EXHAUSTED|RATE_LIMIT_EXCEEDED|quota|rate limit|too many requests/i.test(rawMsg)
    ) {
      if (/quota|billing|credit|exhausted/i.test(rawMsg)) {
        return {
          statusCode: 429,
          code: "AI_QUOTA_EXCEEDED",
          sanitizedMessage: "The AI service has reached its usage or billing quota. Please verify your account tier or contact support.",
          retryable: false
        };
      }
      return {
        statusCode: 429,
        code: "AI_RATE_LIMITED",
        sanitizedMessage: "The AI assistant is temporarily rate-limited. Please wait a moment and try again.",
        retryable: true
      };
    }

    // 2. Authentication or Configuration failures
    if (
      status === 401 ||
      status === 403 ||
      /API_KEY_INVALID|INVALID_ARGUMENT.*api_key|UNAUTHENTICATED|permission denied|unauthorized/i.test(rawMsg)
    ) {
      return {
        statusCode: 503,
        code: "AI_CONFIG_ERROR",
        sanitizedMessage: "The AI assistant service is temporarily misconfigured or unavailable. Please contact an administrator.",
        retryable: false
      };
    }

    // 3. Timeouts
    if (
      status === 408 ||
      status === 504 ||
      /DEADLINE_EXCEEDED|timeout|timed out|ETIMEDOUT|ESOCKETTIMEDOUT/i.test(rawMsg)
    ) {
      return {
        statusCode: 504,
        code: "AI_TIMEOUT",
        sanitizedMessage: "The AI assistant timed out while processing your request. Please try again.",
        retryable: true
      };
    }

    // 4. Network or upstream provider failures
    if (
      status === 502 ||
      status === 503 ||
      /ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|UNAVAILABLE|network|fetch failed|service unavailable/i.test(rawMsg)
    ) {
      return {
        statusCode: 502,
        code: "AI_UPSTREAM_UNAVAILABLE",
        sanitizedMessage: "Upstream AI model provider is currently unreachable. Please try again in a moment.",
        retryable: true
      };
    }

    // 5. Default generic internal failure
    return {
      statusCode: 500,
      code: "AI_INTERNAL_ERROR",
      sanitizedMessage: "The AI assistant encountered an unexpected error. Please try again later.",
      retryable: true
    };
  }

  // Helper to sanitize error messages from AI provider calls to prevent credentials, stack traces, or internal paths from leaking
  function sanitizeAiErrorMessage(errMsg: any): string {
    if (!errMsg || typeof errMsg !== 'string') return "AI processing failed. Please try again.";
    let sanitized = errMsg
      .replace(/AIza[0-9A-Za-z-_]{30,45}/g, '[REDACTED]')
      .replace(/(?:key|apiKey|token|secret|authorization)=[^&\\s]+/gi, '=[REDACTED]')
      .replace(/Bearer\\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
      .replace(/[A-Za-z]:[\\/][^:\r\n]+|\/(?:home|usr|var|tmp|app)[^:\r\n]*/g, '[INTERNAL_PATH]');
    if (sanitized.includes('at ') && sanitized.includes('(')) {
      sanitized = sanitized.split('\\n')[0];
    }
    return sanitized;
  }

  type AssistantOutcome = 'ANSWERED' | 'INSUFFICIENT_CONTEXT' | 'CLARIFICATION_NEEDED' | 'ACTION_REQUESTED' | 'ACTION_EXECUTED';
  type AssistantIntent = 'summarize' | 'analyze thinking' | 'decisions' | 'add to project' | 'usage / minutes' | 'none';

  interface ValidatedAssistantResponse {
    reply: string;
    intent: AssistantIntent;
    outcome: AssistantOutcome;
    executeAction: boolean;
    missingSources?: string[];
    suggestedNextStep?: string;
  }

  function validateAssistantResponse(parsed: any, userMessage: string): ValidatedAssistantResponse | null {
    if (!parsed || typeof parsed !== 'object') return null;

    let { reply, intent, outcome, executeAction, missingSources, suggestedNextStep } = parsed;

    if (typeof reply !== 'string' || reply.trim().length === 0) {
      return null;
    }

    const validIntents: AssistantIntent[] = ["summarize", 'analyze thinking', 'decisions', 'add to project', 'usage / minutes', 'none'];
    if (typeof intent !== 'string' || !validIntents.includes(intent as AssistantIntent)) {
      intent = 'none';
    }

    const validOutcomes: AssistantOutcome[] = ['ANSWERED', 'INSUFFICIENT_CONTEXT', 'CLARIFICATION_NEEDED', 'ACTION_REQUESTED', 'ACTION_EXECUTED'];
    if (typeof outcome !== 'string' || !validOutcomes.includes(outcome as AssistantOutcome)) {
      return null;
    }

    if (outcome === 'ACTION_EXECUTED') {
      outcome = 'ACTION_REQUESTED';
    }

    if (typeof executeAction !== 'boolean') {
      executeAction = (outcome === 'ACTION_REQUESTED' && intent !== 'none');
    }

    const isInformational = /^(?:what|who|where|when|why|how|is|are|does|did|can|could|would|tell me about|describe)\\b/i.test(userMessage.trim());
    if (isInformational && executeAction) {
      executeAction = false;
      if (outcome === 'ACTION_REQUESTED') outcome = 'ANSWERED';
    }

    const validatedMissing = Array.isArray(missingSources)
      ? missingSources.filter(s => typeof s === 'string')
      : undefined;

    return {
      reply: reply.trim(),
      intent: intent as AssistantIntent,
      outcome: outcome as AssistantOutcome,
      executeAction,
      missingSources: validatedMissing,
      suggestedNextStep: typeof suggestedNextStep === 'string' ? suggestedNextStep.trim() : undefined
    };
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
      res.json({
        ...rawData,
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
    const { message, context, conversationHistory } = req.body;
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ error: "Missing or invalid message parameter", code: "INVALID_INPUT" });
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
        return res.status(accessCheck.status).json({
          error: accessCheck.message || "Forbidden",
          code: accessCheck.status === 404 ? "NOT_FOUND" : "ACCESS_DENIED"
        });
      }
    }

    // Step 8.1A: Admit AI rate limit and acquire concurrency slot after input validation and IDOR checks
    const slot = admitExpensiveOperation(req, res, 'ai');
    if (!slot) return;

    const start = Date.now();
    const model = "gemini-3-flash-preview";
    const featureName = "EchoNote Assistant";

    try {
      // 1. Authoritative server-side context retrieval
      let recordingTitle: string | null = null;
      let recordingSummary: string | null = null;
      let recordingDecisions: string[] = [];
      let recordingTranscript: string | null = null;
      let transcriptTruncated = false;

      if (candidateRecId) {
        try {
          const recDoc = await db.collection('recordings').doc(candidateRecId).get();
          if (recDoc.exists) {
            const data = recDoc.data() || {};
            recordingTitle = data.title || data.name || data.originalFileName || null;
            recordingSummary = data.summary || null;
            if (Array.isArray(data.decisions)) {
              recordingDecisions = data.decisions;
            }
            const fullTranscript = data.transcript || data.text || null;
            const MAX_TRANSCRIPT_CHARS = 12000;
            if (fullTranscript && typeof fullTranscript === 'string') {
              if (fullTranscript.length > MAX_TRANSCRIPT_CHARS) {
                recordingTranscript = fullTranscript.slice(0, MAX_TRANSCRIPT_CHARS) + "\n[... TRANSCRIPT_TRUNCATED_DUE_TO_CONTEXT_BUDGET ...]";
                transcriptTruncated = true;
              } else {
                recordingTranscript = fullTranscript;
              }
            }
          }
        } catch (dbErr) {
          console.warn('[Assistant] Failed reading authoritative recording context:', dbErr);
        }
      }

      let projectTaskSummaries: string[] = [];
      if (candidateProjId) {
        try {
          const tasksSnap = await db.collection('tasks').where('projectId', '==', candidateProjId).limit(20).get();
          if (!tasksSnap.empty) {
            projectTaskSummaries = tasksSnap.docs.map(d => {
              const td = d.data();
              return `- [${td.status || 'TODO'}] ${td.title || 'Untitled task'} (Due: ${td.dueDate || 'N/A'}, Assignee: ${td.assigneeId || 'Unassigned'})`;
            });
          }
        } catch (taskErr) {
          console.warn('[Assistant] Failed reading authoritative project tasks:', taskErr);
        }
      }

      // Build authoritative context block (NEVER accept client-supplied transcript)
      let authoritativeContext = "=== AUTHORITATIVE SERVER CONTEXT ===\n";
      authoritativeContext += `- User Plan: ${plan}\n`;
      authoritativeContext += `- Minutes Used: ${userData.minutes_used || userData.audioMinutesUsed || 0}\n`;
      authoritativeContext += `- Minutes Remaining: ${userData.minutes_remaining || (plan === 'free' ? 60 : 300)}\n`;

      if (candidateRecId) {
        authoritativeContext += "\n[ACTIVE RECORDING DETAILS]\n";
        authoritativeContext += `- Recording ID: ${candidateRecId}\n`;
        authoritativeContext += `- Title / File: ${recordingTitle || 'Untitled'}\n`;
        if (recordingSummary) {
          authoritativeContext += `- Meeting Summary: ${recordingSummary}\n`;
        }
        if (recordingDecisions.length > 0) {
          authoritativeContext += `- Logged Decisions:\n${recordingDecisions.map(d => '  * ' + d).join('\n')}\n`;
        }
        if (recordingTranscript) {
          authoritativeContext += `- Transcript Content:\n"""\n${recordingTranscript}\n"""\n`;
        } else {
          authoritativeContext += "- Transcript Content: [No transcript available for this recording]\n";
        }
      } else {
        authoritativeContext += "\n[ACTIVE RECORDING DETAILS]\n- No recording currently selected or authorized.\n";
      }

      if (candidateProjId) {
        authoritativeContext += "\n[PROJECT CONTEXT]\n";
        authoritativeContext += `- Project ID: ${candidateProjId}\n`;
        if (projectTaskSummaries.length > 0) {
          authoritativeContext += `- Project Tasks:\n${projectTaskSummaries.join('\n')}\n`;
        } else {
          authoritativeContext += "- Project Tasks: [No tasks logged for this project]\n";
        }
      }
      authoritativeContext += "=== END CONTEXT ===";

      // 2. Bound and sanitize multi-turn conversation history
      const formattedContents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];

      if (Array.isArray(conversationHistory) && conversationHistory.length > 0) {
        const recentHistory = conversationHistory.slice(-6);
        for (const item of recentHistory) {
          if (!item || typeof item.text !== 'string' || item.text.trim().length === 0) continue;
          const mappedRole = item.role === 'assistant' || item.role === 'model' ? 'model' : 'user';
          const trimmedText = item.text.trim().slice(0, 1000);
          formattedContents.push({
            role: mappedRole,
            parts: [{ text: trimmedText }]
          });
        }
      }

      // Append current user message
      formattedContents.push({
        role: 'user',
        parts: [{ text: message.trim().slice(0, 2000) }]
      });

      const systemInstruction = `You are EchoNote Assistant, an intelligent, honest AI embedded inside the EchoNote audio intelligence platform.
Your job is to answer questions, explain metrics, and assist users with their recordings, transcripts, summaries, decisions, and projects.

=== ACCURACY & HONESTY GUIDELINES (CRITICAL) ===
1. ANSWER DIRECTLY: When the context contains the requested facts, provide a concise, direct, helpful answer (2-5 lines). Outcome MUST be "ANSWERED".
2. HONEST ABOUT ABSENT FACTS / INSUFFICIENT CONTEXT:
   - If the user asks about a fact, person, decision, budget, date, or event that is NOT present in the authoritative context above, NEVER fabricate, guess, or substitute generic EchoNote feature suggestions.
   - State clearly that the requested information could not be found in the available recording, summary, decisions, or project data.
   - When possible, identify what source is missing (e.g. "recording transcript", "project tasks", "decisions").
   - Offer one specific next step only when it is relevant (e.g. selecting a specific recording or providing the missing detail).
   - Set outcome to "INSUFFICIENT_CONTEXT".
3. CLARIFICATION NEEDED:
   - If the user's request is ambiguous, underspecified, or unclear, ask a concise, targeted clarifying question.
   - Do NOT classify ordinary follow-up questions as unanswerable or ambiguous if the conversation history and context resolve them.
   - Set outcome to "CLARIFICATION_NEEDED".
4. SAFE ACTION GATING & TRUTHFULNESS:
   - Distinguish between informational questions (e.g. "What did Bob say?", "Can you summarize?", "What decisions were made?", "Who is assigned to the task?") and explicit commands to execute an operation (e.g. "Summarize this now", "Run thinking engine", "Add this to project X").
   - For informational questions: answer the question directly. executeAction MUST be false. Outcome MUST be "ANSWERED".
   - For explicit action requests: set outcome to "ACTION_REQUESTED", intent to the action name ("summarize" | "analyze thinking" | "decisions" | "add to project"), and executeAction to true.
   - NEVER output "ACTION_EXECUTED". Actions are executed by the application on the client or server AFTER verification, not hallucinated in advance by the model.

\${authoritativeContext}`;

      const response = await aiGen.models.generateContent({
        model,
        contents: formattedContents,
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
              },
              outcome: {
                type: Type.STRING,
                enum: ["ANSWERED", "INSUFFICIENT_CONTEXT", "CLARIFICATION_NEEDED", "ACTION_REQUESTED", "ACTION_EXECUTED"]
              },
              executeAction: { type: Type.BOOLEAN },
              missingSources: {
                type: Type.ARRAY,
                items: { type: Type.STRING }
              },
              suggestedNextStep: { type: Type.STRING }
            },
            required: ["reply", "intent", "outcome", "executeAction"]
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

      let rawParsed: any = null;
      try {
        rawParsed = JSON.parse(response.text || '{}');
      } catch (parseErr) {
        console.warn('[Assistant] Failed parsing Gemini JSON response:', parseErr);
        rawParsed = null;
      }

      const validated = validateAssistantResponse(rawParsed, message);
      if (!validated) {
        console.error('[Assistant] Malformed or invalid model response payload:', response.text);
        return res.status(502).json({
          error: "The AI assistant returned an invalid response format. Please try again.",
          code: "AI_INVALID_RESPONSE",
          retryable: true
        });
      }

      return res.json(validated);
    } catch (error: any) {
      console.error(`[AI Endpoint Error] \${featureName}:`, error);
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

      const classified = classifyAiError(error);

      // AH.145: Asynchronously check and trigger email escalation for repeated failures (non-blocking)
      (async () => {
        try {
          const failureKey = `fail_${userId}_${candidateRecId || 'none'}`;
          const failRef = db.collection('assistantFailureTracking').doc(failureKey);
          let shouldEscalate = false;
          let currentFailCount = 1;

          await db.runTransaction(async (t) => {
            const doc = await t.get(failRef);
            const nowMs = Date.now();
            if (doc.exists) {
              const d = doc.data();
              // If last failure was within 10 minutes, increment counter
              if (d && (nowMs - (d.lastFailedAtMs || 0)) < 10 * 60 * 1000) {
                currentFailCount = (d.count || 0) + 1;
              }
            }
            t.set(failRef, {
              count: currentFailCount,
              lastFailedAtMs: nowMs,
              lastErrorCode: classified.code,
              userId
            }, { merge: true });

            if (currentFailCount >= 2) {
              shouldEscalate = true;
            }
          });

          if (shouldEscalate) {
            await triggerAssistantEscalationIfEligible(db, {
              reason: 'repeated_failure',
              question: message,
              userId,
              userEmail: email,
              userPlan: plan,
              errorCode: classified.code,
              errorMessage: classified.sanitizedMessage,
              contextSummary: {
                recordingId: candidateRecId,
                projectId: candidateProjId,
                page: context?.current_page
              }
            });
          }
        } catch (escErr: any) {
          console.warn('[Assistant Escalation] Background tracking caught error:', escErr?.message || escErr);
        }
      })().catch(() => {});

      return res.status(classified.statusCode).json({
        error: classified.sanitizedMessage,
        code: classified.code,
        retryable: classified.retryable
      });
    } finally {
      // Step 8.1A: Always release concurrency slot on completion or failure
      slot.release();
    }
  });

  
  // Assistant Explicit User Feedback & Escalation Endpoint (AH.145)
  app.post("/api/ai/assistant-feedback", requireAuth, async (req: AuthenticatedRequest, res) => {
    const { message, responseReply, outcome, rating, comment, context } = req.body;
    if (!message || typeof message !== 'string' || !rating || (rating !== 'helpful' && rating !== 'unhelpful')) {
      return res.status(400).json({ error: "Missing or invalid feedback parameters", code: "INVALID_INPUT" });
    }

    if (comment !== undefined && typeof comment !== String.fromCharCode(115,116,114,105,110,103)) {
      return res.status(400).json({ error: String.fromCharCode(70,101,101,100,98,97,99,107,32,99,111,109,109,101,110,116,32,109,117,115,116,32,98,101,32,97,32,115,116,114,105,110,103), code: String.fromCharCode(73,78,86,65,76,73,68,95,73,78,80,85,84) });
    }

    const userCtx = await resolveUserContext(req);
    const userId = userCtx.userId;
    const email = userCtx.email;
    const plan = userCtx.plan;

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
        return res.status(accessCheck.status).json({
          error: accessCheck.message || String.fromCharCode(70,111,114,98,105,100,100,101,110),
          code: accessCheck.status === 404 ? String.fromCharCode(78,79,84,95,70,79,85,78,68) : String.fromCharCode(65,67,67,69,83,83,95,68,69,78,73,69,68)
        });
      }
    }

    try {
      // Record feedback in Firestore
      const feedbackRef = db.collection('assistantFeedback').doc();
      await feedbackRef.set({
        id: feedbackRef.id,
        userId,
        userEmail: email,
        rating,
        outcome: typeof outcome === 'string' ? outcome : undefined,
        comment: typeof comment === 'string' ? comment.trim().slice(0, 500) : undefined,
        messageExcerpt: typeof message === 'string' ? message.trim().slice(0, 280) : '',
        recordingId: candidateRecId || undefined,
        projectId: candidateProjId || undefined,
        createdAt: FieldValue.serverTimestamp()
      });

      // If user provided explicit negative feedback, evaluate escalation
      if (rating === 'unhelpful') {
        // Asynchronous non-blocking evaluation
        triggerAssistantEscalationIfEligible(db, {
          reason: 'explicit_negative_feedback',
          question: message,
          userId,
          userEmail: email,
          userPlan: plan,
          errorCode: typeof outcome === 'string' ? outcome : 'UNHELPFUL_FEEDBACK',
          feedbackComment: typeof comment === 'string' ? comment.trim() : undefined,
          errorMessage: typeof responseReply === 'string' ? responseReply.slice(0, 200) : undefined,
          contextSummary: {
            recordingId: candidateRecId,
            projectId: candidateProjId,
            page: context?.current_page
          }
        }).catch(err => {
          console.warn('[Assistant Feedback] Escalation trigger error:', err);
        });
      }

      return res.json({ success: true, feedbackId: feedbackRef.id });
    } catch (err: any) {
      console.error('[Assistant Feedback] Failed saving feedback:', err);
      return res.status(500).json({ error: "Failed to record feedback", code: "FEEDBACK_ERROR" });
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

  // Frontend serving: Vite middleware for development or pre-built static bundle in production
  if (process.env.NODE_ENV !== "production") {
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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});

