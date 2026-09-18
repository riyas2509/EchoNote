import { 
  Auth, 
  AuthProvider, 
  SAMLAuthProvider, 
  OAuthProvider, 
  signInWithPopup, 
  signInWithRedirect, 
  getRedirectResult, 
  User,
  UserCredential 
} from 'firebase/auth';
import { AuthDiscoveryResult, EnterpriseProviderType } from '../types';
import { apiFetch, getApiUrl } from './apiClient';

export interface EnterpriseSignInOptions {
  mode?: 'popup' | 'redirect';
  loginHint?: string;
}

export interface EnterpriseValidationResult {
  success: boolean;
  isEnterprise: boolean;
  isMember: boolean;
  orgId?: string;
  orgRole?: string;
  orgName?: string;
  departmentId?: string;
  departmentName?: string;
  wasProvisioned?: boolean;
  isNewUser?: boolean;
  roleChanged?: boolean;
  departmentChanged?: boolean;
  pending?: boolean;
  reason?: string;
  message?: string;
  code?: string;
}

/**
 * Resolves the deterministic providerId for an organization's SSO identity provider.
 */
export function resolveProviderId(discovery: AuthDiscoveryResult): string {
  if (discovery.providerId) return discovery.providerId;
  if (discovery.samlProviderId) return discovery.samlProviderId;
  
  const cleanOrgId = String(discovery.orgId || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/^-+|-+$/g, '');

  if (discovery.ssoProtocol === 'SAML') {
    return `saml.${cleanOrgId || 'enterprise'}`;
  }

  if (discovery.ssoProviderType === 'MICROSOFT_ENTRA' || discovery.entraTenantId) {
    return 'microsoft.com';
  }

  if (discovery.ssoProviderType === 'GOOGLE_WORKSPACE') {
    return 'google.com';
  }

  return `oidc.${cleanOrgId || 'enterprise'}`;
}

/**
 * Builds and configures the appropriate Firebase AuthProvider instance based on discovery metadata.
 */
export function buildEnterpriseAuthProvider(
  discovery: AuthDiscoveryResult,
  options?: EnterpriseSignInOptions
): AuthProvider {
  const protocol = discovery.ssoProtocol || 'OIDC';
  const providerId = resolveProviderId(discovery);

  if (protocol === 'SAML') {
    // Official Firebase SAMLAuthProvider for federated SAML 2.0 assertions
    return new SAMLAuthProvider(providerId);
  }

  // OIDC / OAuth Provider (Microsoft Entra ID, Google Workspace, Generic OIDC)
  const oidcProvider = new OAuthProvider(providerId);
  const customParams: Record<string, string> = {
    prompt: 'select_account'
  };

  if (options?.loginHint || discovery.domain) {
    customParams.login_hint = options?.loginHint || (discovery.domain ? `@${discovery.domain}` : '');
  }

  if (discovery.entraTenantId) {
    customParams.tenant = discovery.entraTenantId;
  }

  oidcProvider.setCustomParameters(customParams);
  oidcProvider.addScope('openid');
  oidcProvider.addScope('email');
  oidcProvider.addScope('profile');

  return oidcProvider;
}

/**
 * Initiates enterprise authentication using the official Firebase Auth SDK.
 * Applies multi-tenant context if Identity Platform tenant ID is configured.
 */
export async function initiateEnterpriseSignIn(
  authInstance: Auth,
  discovery: AuthDiscoveryResult,
  options?: EnterpriseSignInOptions
): Promise<UserCredential | null> {
  if (discovery.ssoConfigurationError) {
    throw new Error(discovery.ssoErrorMessage || "Enterprise SSO configuration has an issue. Please contact your administrator.");
  }

  // Multi-Tenancy Architecture:
  // If the organization uses a dedicated Identity Platform Tenant, set the tenantId on the Auth instance
  if (discovery.identityPlatformTenantId) {
    authInstance.tenantId = discovery.identityPlatformTenantId;
  }

  const provider = buildEnterpriseAuthProvider(discovery, options);
  const authMode = options?.mode || 'popup';

  if (authMode === 'redirect') {
    await signInWithRedirect(authInstance, provider);
    return null; // Will resume upon redirection
  }

  return await signInWithPopup(authInstance, provider);
}

/**
 * Authoritatively validates an enterprise authenticated user against the backend API,
 * executing JIT provisioning or identity attribute synchronization.
 */
export async function validateEnterpriseAuthSession(
  user: User,
  discovery?: AuthDiscoveryResult | null,
  apiUrlBase?: string
): Promise<EnterpriseValidationResult> {
  const endpoint = apiUrlBase 
    ? `${apiUrlBase.replace(/\/+$/, '')}/api/auth/sso/validate`
    : getApiUrl('/api/auth/sso/validate');

  const response = await apiFetch(endpoint, {
    method: "POST",
    body: JSON.stringify({
      orgId: discovery?.orgId,
      providerId: discovery ? resolveProviderId(discovery) : undefined,
      protocol: discovery?.ssoProtocol,
      tenantId: discovery?.identityPlatformTenantId || discovery?.entraTenantId
    })
  });

  const data = await response.json();

  if (!response.ok || data.error) {
    const errorResult: EnterpriseValidationResult = {
      success: false,
      isEnterprise: true,
      isMember: false,
      code: data.code || 'SSO_AUTHENTICATION_FAILED',
      message: data.message || data.error || 'Enterprise authentication verification failed.'
    };
    return errorResult;
  }

  // Force-refresh the user's ID token so authoritative Custom Claims are immediately reflected in the client session
  if (data.isMember) {
    await user.getIdToken(true);
  }

  return {
    success: true,
    isEnterprise: data.isEnterprise ?? true,
    isMember: data.isMember ?? true,
    orgId: data.orgId,
    orgRole: data.orgRole,
    orgName: data.orgName,
    departmentId: data.departmentId,
    departmentName: data.departmentName,
    wasProvisioned: data.wasProvisioned,
    isNewUser: data.isNewUser,
    roleChanged: data.roleChanged,
    departmentChanged: data.departmentChanged,
    pending: data.pending,
    reason: data.reason,
    message: data.message
  };
}
