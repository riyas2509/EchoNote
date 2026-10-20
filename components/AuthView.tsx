import React, { useState, useEffect, useCallback } from 'react';
import { AuthStatus, UserProfile, AuthDiscoveryResult } from '../types';
import { PLAN_FEATURES } from '../config/planConfig';
import { apiFetch, getApiUrl } from '../lib/apiClient';
import { handleUpgrade } from '../services/subscriptionService';
import { 
  initiateEnterpriseSignIn, 
  validateEnterpriseAuthSession, 
  resolveProviderId 
} from '../lib/enterpriseAuth';
import { 
  auth, 
  db, 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  sendPasswordResetEmail, 
  sendEmailVerification,
  doc, 
  setDoc, 
  updateDoc,
  updateProfile, 
  serverTimestamp,
  signInWithPopup, 
  GoogleAuthProvider, 
  OAuthProvider, 
  SAMLAuthProvider,
  multiFactor,
  TotpMultiFactorGenerator,
  getMultiFactorResolver,
  EmailAuthProvider,
  reauthenticateWithCredential
} from '../firebase';
import { toast } from 'sonner';
import { 
  Mail, 
  Lock, 
  Eye, 
  EyeOff, 
  User,
  ShieldCheck, 
  HelpCircle, 
  ArrowLeft, 
  Loader2, 
  Sparkles, 
  AlertCircle, 
  CheckCircle, 
  Info, 
  ChevronDown, 
  ChevronUp, 
  Globe, 
  Settings, 
  ExternalLink,
  Shield, 
  Key, 
  Building, 
  ArrowRight, 
  LogOut, 
  Sparkle, 
  Camera, 
  Trash2,
  RefreshCw,
  Smartphone,
  QrCode,
  Copy,
  Check,
  KeyRound,
  Download,
  ShieldAlert
} from 'lucide-react';
import { 
  getRecoveryCodesStatus, 
  generateRecoveryCodes, 
  redeemRecoveryCode, 
  RecoveryCodesStatus 
} from '../lib/apiClient';
import { motion, AnimatePresence } from 'motion/react';

function formatAuthError(err: any, fallbackMessage: string = 'Authentication failed.'): string {
  if (!err) return fallbackMessage;
  const code = err.code || '';
  if (code === 'auth/unauthorized-domain') {
    const currentHost = typeof window !== 'undefined' ? window.location.hostname : 'this domain';
    return `Domain "${currentHost}" is not authorized for Firebase Authentication. Please add "${currentHost}" to Authorized Domains in your Firebase Console (Authentication > Settings > Authorized domains).`;
  }
  if (code === 'auth/operation-not-allowed') {
    return 'This sign-in provider is not enabled in Firebase Authentication.';
  }
  if (code === 'auth/popup-blocked') {
    return 'Popup was blocked by your browser. Please allow popups to authenticate.';
  }
  if (code === 'auth/popup-closed-by-user') {
    return 'Sign-in popup was closed before completing authentication.';
  }
  return err.message || fallbackMessage;
}

interface AuthViewProps {
  onAuth: (status: AuthStatus, profile?: UserProfile, rememberMe?: boolean) => void;
  isSettingsMode?: boolean;
  onCloseSettings?: () => void;
  onLogout?: () => void;
  userProfile?: UserProfile;
  onBackToHome?: () => void;
}

const AuthView: React.FC<AuthViewProps> = ({ 
  onAuth, 
  isSettingsMode, 
  onCloseSettings, 
  onLogout, 
  userProfile, 
  onBackToHome 
}) => {
  // Global loading states
  const [loading, setLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [ssoLoading, setSsoLoading] = useState<string | null>(null);
  const [discoveryLoading, setDiscoveryLoading] = useState(false);

  // Feedback states
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Primary view mode: 'signin' | 'signup' | 'forgot' | 'sso'
  const [mode, setMode] = useState<'signin' | 'signup' | 'forgot' | 'sso'>('signin');

  // Input form states
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [ssoOrgInput, setSsoOrgInput] = useState('');

  // Password visibility
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmPasswordVisible, setConfirmPasswordVisible] = useState(false);

  // SSO and Enterprise Discovery State
  const [authDiscovery, setAuthDiscovery] = useState<AuthDiscoveryResult | null>(null);
  const [lastDiscoveredEmail, setLastDiscoveredEmail] = useState('');

  // Password reset cooldown
  const [cooldownRemaining, setCooldownRemaining] = useState(0);

  // Admin Settings guide toggle (only in Settings Mode)
  const [showAdminSsoGuide, setShowAdminSsoGuide] = useState(false);

  // MFA Login Challenge state (Phase 1A Step 3)
  const [mfaResolver, setMfaResolver] = useState<any | null>(null);
  const [mfaChallengeCode, setMfaChallengeCode] = useState('');
  const [isVerifyingMfa, setIsVerifyingMfa] = useState(false);

  // User Settings 2FA state (Phase 1A Step 3)
  const [mfaLoading, setMfaLoading] = useState(false);
  const [mfaEnrolled, setMfaEnrolled] = useState<boolean>(false);
  const [mfaFactors, setMfaFactors] = useState<any[]>([]);
  const [showMfaEnrollModal, setShowMfaEnrollModal] = useState(false);
  const [mfaEnrollStep, setMfaEnrollStep] = useState<'password' | 'scan'>('password');
  const [mfaPassword, setMfaPassword] = useState('');
  const [mfaTotpSecret, setMfaTotpSecret] = useState<any | null>(null);
  const [mfaQrCodeUrl, setMfaQrCodeUrl] = useState('');
  const [mfaVerifyCode, setMfaVerifyCode] = useState('');
  const [isEnrollingMfa, setIsEnrollingMfa] = useState(false);
  const [mfaKeyCopied, setMfaKeyCopied] = useState(false);
  const [showDisableMfaModal, setShowDisableMfaModal] = useState(false);
  const [disableMfaPassword, setDisableMfaPassword] = useState('');
  const [isDisablingMfa, setIsDisablingMfa] = useState(false);

  // Recovery Codes Management States (Step 3B.4.2)
  const [recoveryStatus, setRecoveryStatus] = useState<RecoveryCodesStatus | null>(null);
  const [showRecoveryModal, setShowRecoveryModal] = useState(false);
  const [freshRecoveryCodes, setFreshRecoveryCodes] = useState<string[]>([]);
  const [isGeneratingRecoveryCodes, setIsGeneratingRecoveryCodes] = useState(false);
  const [recoveryReauthPassword, setRecoveryReauthPassword] = useState('');
  const [recoveryModalStep, setRecoveryModalStep] = useState<'status' | 'reauth' | 'display'>('status');
  const [recoveryCodesCopied, setRecoveryCodesCopied] = useState(false);

  // Sign-in Emergency Recovery Redeem State
  const [showSignInRecovery, setShowSignInRecovery] = useState(false);
  const [signInRecoveryInput, setSignInRecoveryInput] = useState('');
  const [isRedeemingSignInRecovery, setIsRedeemingSignInRecovery] = useState(false);

  // Fetch Authoritative MFA Status on Settings Open
  const refreshMfaStatus = useCallback(async () => {
    if (!auth?.currentUser) return;
    setMfaLoading(true);
    try {
      const clientFactors = multiFactor(auth.currentUser).enrolledFactors || [];
      if (clientFactors.length > 0) {
        setMfaEnrolled(true);
        setMfaFactors(clientFactors);
      } else {
        const res = await apiFetch('/api/auth/mfa/status');
        if (res.ok) {
          const data = await res.json();
          setMfaEnrolled(Boolean(data.mfaEnabled));
          setMfaFactors(data.enrolledFactors || []);
        } else {
          setMfaEnrolled(Boolean(userProfile?.mfaEnabled));
        }
      }

      // If user has MFA enrolled, fetch recovery codes status (never codes themselves)
      try {
        const rcStatus = await getRecoveryCodesStatus();
        setRecoveryStatus(rcStatus);
      } catch (rcErr) {
        console.warn("Recovery codes status inspection note:", rcErr);
      }
    } catch (err) {
      console.warn("MFA status inspection note:", err);
      setMfaEnrolled(Boolean(userProfile?.mfaEnabled));
    } finally {
      setMfaLoading(false);
    }
  }, [userProfile?.mfaEnabled]);

  // Handle reauthentication and generating recovery codes
  const handleGenerateRecoveryCodesSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth?.currentUser || !recoveryReauthPassword) return;

    setIsGeneratingRecoveryCodes(true);
    setError('');

    try {
      const email = auth.currentUser.email;
      if (!email) throw new Error("Authenticated email not found.");

      const cred = EmailAuthProvider.credential(email, recoveryReauthPassword);
      await reauthenticateWithCredential(auth.currentUser, cred);

      const genRes = await generateRecoveryCodes();
      if (genRes.success && genRes.codes) {
        setFreshRecoveryCodes(genRes.codes);
        setRecoveryCodesCopied(false);
        setRecoveryModalStep('display');
        setRecoveryReauthPassword('');
        toast.success("New recovery codes generated! Please save them immediately.");
        await refreshMfaStatus();
      } else {
        setError(genRes.message || "Failed to generate recovery codes.");
      }
    } catch (err: any) {
      console.error("Recovery code generation error:", err);
      if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        setError("Incorrect password. Please verify your current password.");
      } else {
        setError(err.message || "Failed to generate recovery codes.");
      }
    } finally {
      setIsGeneratingRecoveryCodes(false);
    }
  };

  // Handle redeeming emergency recovery code from Sign-In challenge
  const handleSignInRecoveryRedeem = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = signInRecoveryInput.trim();
    if (!cleanCode) return;

    setIsRedeemingSignInRecovery(true);
    setError('');

    try {
      const res = await redeemRecoveryCode(cleanCode);
      if (res.success) {
        toast.success(`Recovery code redeemed successfully! (${res.remainingCodes} remaining)`);
        setMfaResolver(null);
        setShowSignInRecovery(false);
        setSignInRecoveryInput('');
      } else {
        setError(res.message || "Failed to redeem recovery code.");
      }
    } catch (err: any) {
      console.error("Recovery redeem error:", err);
      setError(err.message || "Invalid or already used recovery code.");
    } finally {
      setIsRedeemingSignInRecovery(false);
    }
  };

  useEffect(() => {
    if (isSettingsMode && auth?.currentUser) {
      refreshMfaStatus();
    }
  }, [isSettingsMode, refreshMfaStatus]);

  // Profile Settings editing
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editPhotoUrl, setEditPhotoUrl] = useState('');
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  // Sync profile settings when in settings mode
  useEffect(() => {
    if (userProfile && isSettingsMode) {
      setEditDisplayName(userProfile.displayName || userProfile.name || '');
      setEditPhotoUrl(userProfile.photoURL || userProfile.avatarUrl || '');
    }
  }, [userProfile, isSettingsMode]);

  // Anti-spam cooldown timer
  useEffect(() => {
    if (cooldownRemaining <= 0) return;
    const timer = setInterval(() => {
      setCooldownRemaining(prev => prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldownRemaining]);

  // Email format validation
  const validateEmail = (val: string) => {
    return String(val)
      .toLowerCase()
      .trim()
      .match(
        /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/
      );
  };

  // Perform domain discovery on valid email
  const checkDomainDiscovery = useCallback(async (targetEmail: string) => {
    const trimmed = targetEmail.trim().toLowerCase();
    if (!trimmed || !validateEmail(trimmed)) {
      setAuthDiscovery(null);
      return;
    }

    if (trimmed === lastDiscoveredEmail) return;

    setDiscoveryLoading(true);
    try {
      const res = await apiFetch(getApiUrl("/api/auth/discover"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed })
      });
      const data: AuthDiscoveryResult = await res.json();
      setAuthDiscovery(data);
      setLastDiscoveredEmail(trimmed);
    } catch (err) {
      console.warn("⚠️ Domain discovery error:", err);
      setAuthDiscovery(null);
    } finally {
      setDiscoveryLoading(false);
    }
  }, [lastDiscoveredEmail]);

  // Debounced auto-discovery when user finishes typing domain
  useEffect(() => {
    const trimmed = email.trim();
    if (trimmed.includes('@') && trimmed.split('@')[1]?.includes('.') && trimmed.split('@')[1].length >= 3) {
      const debounceTimer = setTimeout(() => {
        checkDomainDiscovery(trimmed);
      }, 500);
      return () => clearTimeout(debounceTimer);
    } else {
      if (authDiscovery) setAuthDiscovery(null);
    }
  }, [email, checkDomainDiscovery, authDiscovery]);

  // Validation helpers
  const isEmailValid = email === '' || !!validateEmail(email);
  const isPasswordValid = password === '' || password.length >= 8;
  const passwordsMatch = mode !== 'signup' || (password !== '' && password === confirmPassword);
  const isNameValid = mode !== 'signup' || name.trim().length > 0;

  // SSO Execution Handlers
  const handleGoogleSso = async () => {
    if (!auth) return;
    setError('');
    setSuccess('');
    setSsoLoading('google');
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({
        prompt: 'select_account'
      });
      await signInWithPopup(auth, provider);
      setSuccess('Successfully authenticated with Google.');
      toast.success('Signed in with Google!');
    } catch (err: any) {
      console.error("Google SSO Error:", err);
      setError(formatAuthError(err, 'Google authentication failed.'));
    } finally {
      setSsoLoading(null);
    }
  };

  const handleMicrosoftSso = async () => {
    if (!auth) return;
    setError('');
    setSuccess('');
    setSsoLoading('microsoft');
    try {
      const provider = new OAuthProvider('microsoft.com');
      const customParams: Record<string, string> = {
        prompt: 'select_account',
      };

      if (email.trim()) {
        customParams.login_hint = email.trim();
      }

      if (authDiscovery?.entraTenantId) {
        customParams.tenant = authDiscovery.entraTenantId;
      }

      provider.setCustomParameters(customParams);
      provider.addScope('openid');
      provider.addScope('email');
      provider.addScope('profile');
      
      const result = await signInWithPopup(auth, provider);
      
      // Extract authoritative Microsoft ID Token credential
      const credential = OAuthProvider.credentialFromResult(result);
      const microsoftIdToken = credential?.idToken;
      
      if (authDiscovery?.authMode === 'enterprise' || authDiscovery?.entraTenantId) {
        try {
          const response = await apiFetch("/api/auth/sso/validate-entra", {
            method: "POST",
            body: JSON.stringify({
              idToken: microsoftIdToken,
              tenantId: authDiscovery?.entraTenantId
            })
          });

          const data = await response.json();

          if (!response.ok || data.error) {
            if (data.code === 'MEMBER_DEACTIVATED') {
              await auth.signOut();
              setError("Your enterprise organization account has been deactivated by an administrator.");
              return;
            } else if (data.code === 'SSO_TENANT_MISMATCH') {
              await auth.signOut();
              setError("Authentication occurred under an unauthorized Microsoft tenant directory.");
              return;
            } else if (data.code === 'SSO_IDENTITY_MISMATCH') {
              await auth.signOut();
              setError("Microsoft identity does not match the authenticated session account.");
              return;
            } else if (data.code === 'SSO_AUDIENCE_MISMATCH' || data.code === 'SSO_AUDIENCE_CONFIG_MISSING') {
              await auth.signOut();
              setError("SSO application audience verification failed. Please contact your organization administrator.");
              return;
            } else if (data.code === 'SSO_TOKEN_REPLAYED') {
              await auth.signOut();
              setError("This authentication token has already been consumed. Please sign in again.");
              return;
            } else {
              setError(data.message || "Enterprise SSO verification failed.");
              return;
            }
          }

          if (data.isMember) {
            await result.user.getIdToken(true);
            toast.success(`Welcome to ${data.orgName || 'your organization'}!`);
          }
        } catch (valErr: any) {
          console.warn("SSO backend validation warning:", valErr);
        }
      }

      setSuccess('Successfully authenticated with Microsoft.');
      toast.success('Signed in with Microsoft!');
    } catch (err: any) {
      console.error("Microsoft SSO Error:", err);
      setError(formatAuthError(err, 'Microsoft SSO authentication failed.'));
    } finally {
      setSsoLoading(null);
    }
  };

  const handleSamlSso = async () => {
    if (!auth) return;
    setError('');
    setSuccess('');
    setSsoLoading('saml');

    const providerId = authDiscovery?.samlProviderId || (authDiscovery?.orgId ? `saml.${authDiscovery.orgId.toLowerCase().replace(/[^a-z0-9-]/g, '-')}` : 'saml.enterprise');

    try {
      if (authDiscovery?.ssoConfigurationError) {
        setError(authDiscovery.ssoErrorMessage || "Your organization's SSO is currently unavailable. Please contact your administrator.");
        return;
      }

      const provider = new SAMLAuthProvider(providerId);
      const result = await signInWithPopup(auth, provider);

      const response = await apiFetch("/api/auth/sso/validate-saml", {
        method: "POST",
        body: JSON.stringify({
          orgId: authDiscovery?.orgId,
          providerId
        })
      });

      const data = await response.json();

      if (!response.ok || data.error) {
        if (data.code === 'MEMBER_DEACTIVATED') {
          await auth.signOut();
          setError("Your enterprise account has been deactivated by an administrator.");
          return;
        } else if (data.code === 'SAML_CROSS_ORG_FORBIDDEN') {
          await auth.signOut();
          setError("Authentication provider does not match your organization's verified domain.");
          return;
        } else if (data.code === 'SAML_PROVIDER_DISABLED') {
          await auth.signOut();
          setError("SAML Single Sign-On is currently disabled for your organization.");
          return;
        } else {
          setError(data.message || "SAML 2.0 Enterprise SSO verification failed.");
          return;
        }
      }

      if (data.isMember) {
        await result.user.getIdToken(true);
        toast.success(`Welcome to ${data.orgName || 'your organization'}!`);
      }

      setSuccess('Successfully authenticated with SAML 2.0 SSO.');
      toast.success('Signed in with Enterprise SAML!');
    } catch (err: any) {
      console.error("SAML SSO Error:", err);
      setError(formatAuthError(err, 'SAML Enterprise SSO authentication failed.'));
    } finally {
      setSsoLoading(null);
    }
  };

  const handleEnterpriseSsoAction = async (preferredMode: 'popup' | 'redirect' = 'popup') => {
    if (!auth) return;
    if (!authDiscovery) {
      setError("Please enter your corporate email address or organization domain first.");
      return;
    }
    if (authDiscovery.ssoConfigurationError) {
      setError(authDiscovery.ssoErrorMessage || "Your organization's SSO is currently unavailable. Please contact your administrator.");
      return;
    }

    setError('');
    setSuccess('');
    setSsoLoading(authDiscovery.ssoProtocol?.toLowerCase() || 'enterprise');

    try {
      const cred = await initiateEnterpriseSignIn(auth, authDiscovery, {
        mode: preferredMode,
        loginHint: email.trim() || undefined
      });

      if (cred?.user) {
        const valResult = await validateEnterpriseAuthSession(cred.user, authDiscovery, getApiUrl(""));
        if (!valResult.success) {
          if (valResult.code === 'MEMBER_DEACTIVATED') {
            await auth.signOut();
            setError("Your enterprise account has been deactivated by an organization administrator.");
            return;
          }
          if (valResult.code === 'SSO_TENANT_MISMATCH') {
            await auth.signOut();
            setError("Authentication occurred under an unauthorized directory tenant.");
            return;
          }
          if (valResult.code === 'SAML_CROSS_ORG_FORBIDDEN') {
            await auth.signOut();
            setError("Authentication provider does not match your organization's verified domain.");
            return;
          }
          setError(valResult.message || "Enterprise SSO verification failed.");
          return;
        }

        toast.success(`Welcome to ${valResult.orgName || authDiscovery.organizationName || 'your organization'}!`);
        setSuccess(`Signed in to ${valResult.orgName || authDiscovery.organizationName || 'organization'} successfully.`);
      }
    } catch (err: any) {
      console.error("Enterprise SSO Error:", err);
      if (err.code === 'auth/operation-not-allowed' || err.code === 'auth/configuration-not-found') {
        const provId = resolveProviderId(authDiscovery);
        setError(`Enterprise identity provider "${provId}" is not configured in Google Identity Platform.`);
      } else if (err.code === 'auth/popup-blocked') {
        setError("Popup was blocked by your browser. Please allow popups to continue.");
      } else if (err.code === 'auth/popup-closed-by-user') {
        setError("Sign in popup was closed before completing authentication.");
      } else if (err.code === 'auth/invalid-credential' || err.code === 'auth/user-mismatch') {
        setError("Identity assertion could not be validated. Please check your credentials.");
      } else {
        setError(err.message || 'Enterprise SSO authentication failed.');
      }
    } finally {
      setSsoLoading(null);
    }
  };

  // Sign In Flow (Email & Password)
  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth) return;

    setError('');
    setSuccess('');

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !validateEmail(trimmedEmail)) {
      setError('Please enter a valid work email address.');
      return;
    }

    if (!password) {
      setError('Please enter your password.');
      return;
    }

    // SSO Enforcement Check
    if (authDiscovery?.authMode === 'enterprise' && authDiscovery.ssoEnforced) {
      setError(`Single Sign-On (SSO) is enforced for ${authDiscovery.organizationName || 'your organization'}. Please sign in using Organization SSO.`);
      return;
    }

    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, trimmedEmail, password);
      toast.success('Signed in successfully!');
    } catch (err: any) {
      console.error("Sign In Error:", err);
      if (err.code === 'auth/multi-factor-auth-required') {
        const resolver = getMultiFactorResolver(auth, err);
        setMfaResolver(resolver);
        setMfaChallengeCode('');
        setError('');
        toast.info('Two-Factor Authentication required. Enter the code from your authenticator app.');
        return;
      }
      if (err.code === 'auth/unauthorized-domain') {
        setError(formatAuthError(err));
      } else if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        setError('Incorrect email or password.');
      } else if (err.code === 'auth/invalid-email') {
        setError('Invalid email address format.');
      } else if (err.code === 'auth/too-many-requests') {
        setError('Access has been temporarily disabled due to too many failed attempts. Please try again later or reset your password.');
      } else if (err.code === 'auth/user-disabled') {
        setError('This user account has been disabled by an administrator.');
      } else if (err.code === 'auth/network-request-failed') {
        setError('Network error. Please verify your connection.');
      } else {
        setError(formatAuthError(err, 'Failed to sign in. Please try again.'));
      }
    } finally {
      setLoading(false);
    }
  };

  // Handle Multi-Factor Authentication Challenge during Sign In (Phase 1A Step 3)
  const handleVerifyMfaChallenge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth || !mfaResolver || !mfaChallengeCode.trim()) return;

    setIsVerifyingMfa(true);
    setError('');

    try {
      const selectedHint = mfaResolver.hints?.[0];
      if (!selectedHint) {
        throw new Error('No enrolled multi-factor authentication method found.');
      }

      const assertion = TotpMultiFactorGenerator.assertionForSignIn(
        selectedHint.uid,
        mfaChallengeCode.trim()
      );

      const userCredential = await mfaResolver.resolveSignIn(assertion);

      // Audit Log on Success
      try {
        await apiFetch('/api/auth/mfa/audit-event', {
          method: 'POST',
          body: JSON.stringify({
            action: 'MFA_CHALLENGE_SUCCESS',
            factorType: 'totp',
            details: `User ${userCredential.user.email} verified 2FA challenge successfully`
          })
        });
      } catch {}

      toast.success('Two-factor authentication verified!');
      setMfaResolver(null);
      setMfaChallengeCode('');
    } catch (verifyErr: any) {
      console.error("MFA Challenge Verification Error:", verifyErr);
      // Audit Log on Failure
      try {
        await apiFetch('/api/auth/mfa/audit-event', {
          method: 'POST',
          body: JSON.stringify({
            action: 'MFA_CHALLENGE_FAILURE',
            factorType: 'totp',
            details: 'Invalid or failed MFA verification code entered'
          })
        });
      } catch {}

      if (verifyErr.code === 'auth/invalid-verification-code') {
        setError('Invalid verification code. Please check your authenticator app and try again.');
      } else if (verifyErr.code === 'auth/code-expired') {
        setError('The verification code has expired. Please check your app for the new code.');
      } else if (verifyErr.code === 'auth/too-many-requests') {
        setError('Too many failed verification attempts. Access is temporarily restricted. Please try again later.');
      } else {
        setError(verifyErr.message || 'Two-factor verification failed. Please try again.');
      }
    } finally {
      setIsVerifyingMfa(false);
    }
  };

  // User 2FA Enrollment Handlers (Phase 1A Step 3)
  const handleStartMfaSetup = () => {
    setShowMfaEnrollModal(true);
    setMfaEnrollStep('password');
    setMfaPassword('');
    setMfaTotpSecret(null);
    setMfaQrCodeUrl('');
    setMfaVerifyCode('');
    setMfaKeyCopied(false);
    setError('');
  };

  const handleConfirmPasswordAndGenerateSecret = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth?.currentUser || !mfaPassword) return;
    setIsEnrollingMfa(true);
    setError('');
    try {
      const credential = EmailAuthProvider.credential(auth.currentUser.email!, mfaPassword);
      await reauthenticateWithCredential(auth.currentUser, credential);

      // Log enrollment started audit
      try {
        await apiFetch('/api/auth/mfa/audit-event', {
          method: 'POST',
          body: JSON.stringify({
            action: 'MFA_ENROLLMENT_STARTED',
            factorType: 'totp',
            details: `User ${auth.currentUser.email} initiated TOTP 2FA enrollment`
          })
        });
      } catch {}

      const mfaUser = multiFactor(auth.currentUser);
      const session = await mfaUser.getSession();
      const secret = await TotpMultiFactorGenerator.generateSecret(session);

      const issuer = "EchoNote";
      const accountName = auth.currentUser.email || "user";
      const otpauthUrl = secret.generateQrCodeUrl(accountName, issuer);

      setMfaTotpSecret(secret);
      setMfaQrCodeUrl(otpauthUrl);
      setMfaEnrollStep('scan');
      setMfaPassword('');
    } catch (err: any) {
      console.error("MFA Reauth & Generate Secret Error:", err);
      if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        setError('Incorrect password. Please verify your current password.');
      } else if (err.code === 'auth/operation-not-allowed' || err.code === 'auth/admin-restricted-operation') {
        setError('Multi-Factor Authentication (TOTP) requires Identity Platform MFA to be enabled in your Firebase / Google Cloud Console.');
      } else {
        setError(err.message || 'Failed to initiate 2FA setup.');
      }
    } finally {
      setIsEnrollingMfa(false);
    }
  };

  const handleCompleteMfaEnrollment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth?.currentUser || !mfaTotpSecret || !mfaVerifyCode.trim()) return;
    setIsEnrollingMfa(true);
    setError('');
    try {
      const assertion = TotpMultiFactorGenerator.assertionForEnrollment(
        mfaTotpSecret,
        mfaVerifyCode.trim()
      );
      const mfaUser = multiFactor(auth.currentUser);
      await mfaUser.enroll(assertion, "Authenticator App");

      // Log authoritative audit event
      try {
        await apiFetch('/api/auth/mfa/audit-event', {
          method: 'POST',
          body: JSON.stringify({
            action: 'MFA_ENABLED',
            factorType: 'totp',
            details: `User ${auth.currentUser.email} successfully enrolled TOTP 2FA`
          })
        });
      } catch {}

      toast.success('Two-Factor Authentication is now enabled!');
      setMfaEnrolled(true);
      setMfaFactors(mfaUser.enrolledFactors);
      setShowMfaEnrollModal(false);
      setMfaTotpSecret(null);
      setMfaVerifyCode('');
      await refreshMfaStatus();
    } catch (err: any) {
      console.error("MFA Enrollment Error:", err);
      if (err.code === 'auth/invalid-verification-code') {
        setError('Invalid 6-digit verification code. Please check your authenticator app and try again.');
      } else {
        setError(err.message || 'Failed to verify and activate Two-Factor Authentication.');
      }
    } finally {
      setIsEnrollingMfa(false);
    }
  };

  const handleDisableMfaConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth?.currentUser || !disableMfaPassword) return;
    setIsDisablingMfa(true);
    setError('');
    try {
      const credential = EmailAuthProvider.credential(auth.currentUser.email!, disableMfaPassword);
      await reauthenticateWithCredential(auth.currentUser, credential);

      const mfaUser = multiFactor(auth.currentUser);
      const enrolled = mfaUser.enrolledFactors;
      if (enrolled && enrolled.length > 0) {
        for (const factor of enrolled) {
          try {
            await mfaUser.unenroll(factor);
          } catch (unenrollErr) {
            console.warn("Client unenroll factor note:", unenrollErr);
          }
        }
      }

      // Authoritative backend disable
      await apiFetch('/api/auth/mfa/disable', {
        method: 'POST'
      });

      toast.success('Two-Factor Authentication has been disabled.');
      setMfaEnrolled(false);
      setMfaFactors([]);
      setShowDisableMfaModal(false);
      setDisableMfaPassword('');
      await refreshMfaStatus();
    } catch (err: any) {
      console.error("MFA Disable Error:", err);
      if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        setError('Incorrect password. Please verify your current password to disable 2FA.');
      } else {
        setError(err.message || 'Failed to disable Two-Factor Authentication.');
      }
    } finally {
      setIsDisablingMfa(false);
    }
  };

  // Sign Up Flow (Registration with Name, Email, Password, Verification)
  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth) return;

    setError('');
    setSuccess('');

    const trimmedName = name.trim();
    const trimmedEmail = email.trim();

    if (!trimmedName) {
      setError('Please enter your full name.');
      return;
    }

    if (!trimmedEmail || !validateEmail(trimmedEmail)) {
      setError('Please enter a valid work email address.');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match. Please re-enter your password.');
      return;
    }

    // SSO Enforcement Check for registration
    if (authDiscovery?.authMode === 'enterprise' && authDiscovery.ssoEnforced) {
      setError(`${authDiscovery.organizationName || 'Your organization'} enforces Single Sign-On (SSO). Please continue with Organization SSO to activate your account.`);
      return;
    }

    setLoading(true);
    try {
      const result = await createUserWithEmailAndPassword(auth, trimmedEmail, password);
      const user = result.user;

      // Update Auth Profile Display Name
      await updateProfile(user, {
        displayName: trimmedName
      });

      // Send Email Verification
      try {
        await sendEmailVerification(user);
        toast.info('Verification email sent! Please check your inbox.');
      } catch (verErr) {
        console.warn("⚠️ Email verification sending notice:", verErr);
      }

      // Initialize Firestore User Document
      const userDocRef = doc(db, 'users', user.uid);
      const now = new Date();
      const nowStr = now.toISOString();
      const renewalDate = new Date(now);
      renewalDate.setDate(renewalDate.getDate() + 30);
      const nextRefreshStr = renewalDate.toISOString();

      const newProfile: UserProfile = {
        uid: user.uid,
        email: trimmedEmail,
        name: trimmedName,
        displayName: trimmedName,
        photoURL: '',
        avatarUrl: '',
        role: 'user',
        plan: 'free',
        minutesUsed: 0,
        thinkingUsed: 0,
        extraMinutes: 0,
        billingStartDate: nowStr,
        lastResetDate: nowStr,
        planExpiresAt: nextRefreshStr,
        createdAt: nowStr,
        subscriptionStartDate: nowStr,
        billingCycle: 'monthly',
        nextRefreshDate: nextRefreshStr,
        lastUsageResetDate: nowStr,
        monthlyMinuteLimit: 60,
        monthlyMinutesUsed: 0,
        minuteTopupBalance: 0,
        monthlyThinkingLimit: 10,
        monthlyThinkingUsed: 0,
        thinkingTopupBalance: 0
      };

      try {
        await setDoc(userDocRef, newProfile);
      } catch (profileErr: any) {
        console.warn("⚠️ Initial profile document setup notice:", profileErr);
      }
      setSuccess('Account created successfully! Logging you in...');
      toast.success('Welcome to EchoNote!');
    } catch (err: any) {
      if (err.code === 'auth/email-already-in-use') {
        setError('An account with this email address already exists. Please sign in instead.');
        toast.info('An account with this email address already exists. Please sign in.');
      } else if (err.code === 'auth/unauthorized-domain') {
        setError(formatAuthError(err));
      } else if (err.code === 'auth/invalid-email') {
        setError('Invalid email address format.');
      } else if (err.code === 'auth/weak-password') {
        setError('Password is too weak. Please use at least 8 characters.');
      } else if (err.code === 'auth/operation-not-allowed') {
        setError('Email/password registration is not enabled.');
      } else if (err.code === 'auth/network-request-failed') {
        setError('Network error. Please check your internet connection.');
      } else if (err.code === 'permission-denied') {
        console.warn("⚠️ Firestore profile setup permission notice (relying on server provisioning):", err);
        setSuccess('Account created! Initializing workspace...');
      } else {
        console.warn("⚠️ Sign Up error:", err?.message || err);
        setError(formatAuthError(err, 'Failed to create account. Please try again.'));
      }
    } finally {
      setLoading(false);
    }
  };

  // Password Reset Flow
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth) return;

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !validateEmail(trimmedEmail)) {
      setError('Please enter a valid work email address.');
      return;
    }

    if (cooldownRemaining > 0) {
      setError(`Please wait ${cooldownRemaining}s before requesting another reset email.`);
      return;
    }

    setResetLoading(true);
    setError('');
    setSuccess('');

    try {
      await sendPasswordResetEmail(auth, trimmedEmail);
      const successMsg = 'Password reset link sent! Please check your inbox and spam folder.';
      setSuccess(successMsg);
      toast.success(successMsg);
      setCooldownRemaining(60);
    } catch (err: any) {
      console.error("Password reset error:", err);
      if (err.code === 'auth/user-not-found') {
        // Provide consistent user feedback for privacy & security
        setError('No active account found with this email address.');
      } else if (err.code === 'auth/invalid-email') {
        setError('Invalid email address format.');
      } else if (err.code === 'auth/too-many-requests') {
        setError('Too many requests. Please wait a few moments before trying again.');
      } else {
        setError(err.message || 'Failed to send password reset email.');
      }
    } finally {
      setResetLoading(false);
    }
  };

  // Dedicated Enterprise SSO Search / Discovery
  const handleDiscoverAndLaunchSso = async (e: React.FormEvent) => {
    e.preventDefault();
    const query = (ssoOrgInput || email).trim();
    if (!query) {
      setError('Please enter your work email or company domain (e.g. acme.com).');
      return;
    }

    const domainToCheck = query.includes('@') ? query : `user@${query}`;
    if (!validateEmail(domainToCheck)) {
      setError('Please enter a valid company domain or corporate email.');
      return;
    }

    setDiscoveryLoading(true);
    setError('');
    setSuccess('');

    try {
      const res = await apiFetch(getApiUrl("/api/auth/discover"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: domainToCheck })
      });
      const data: AuthDiscoveryResult = await res.json();
      setAuthDiscovery(data);

      if (data.authMode === 'enterprise') {
        if (query.includes('@')) setEmail(query);
        // Automatically prompt or launch SSO
        if (data.ssoConfigurationError) {
          setError(data.ssoErrorMessage || "Your organization's SSO configuration requires administrator attention.");
        } else {
          setSuccess(`Discovered enterprise SSO for ${data.organizationName || 'your organization'}.`);
        }
      } else {
        setError(`No enterprise Single Sign-On configured for "${data.domain}". You can sign in using standard email and password.`);
      }
    } catch (err: any) {
      setError('Failed to check enterprise SSO directory. Please verify your connection.');
    } finally {
      setDiscoveryLoading(false);
    }
  };

  // Guest Sandbox Login
  const handleGuestLogin = () => {
    localStorage.setItem('guest', 'true');
    onAuth(AuthStatus.GUEST);
    toast.info('Continuing in Guest Sandbox Mode');
  };

  // Profile Settings Actions
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  };

  const handleFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('Please upload an image file (PNG, JPG, WebP).');
      return;
    }
    if (file.size > 512 * 1024) {
      toast.error('Image size should be less than 500KB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (uploadEvent) => {
      if (uploadEvent.target?.result) {
        setEditPhotoUrl(uploadEvent.target.result as string);
        toast.success('Image loaded. Click Save Profile to apply changes.');
      }
    };
    reader.onerror = () => {
      toast.error('Failed to read image file.');
    };
    reader.readAsDataURL(file);
  };

  const handleSaveProfile = async () => {
    if (!auth || !auth.currentUser) return;
    setIsSavingProfile(true);
    setError('');
    setSuccess('');

    try {
      const displayNameTrimmed = editDisplayName.trim();
      if (!displayNameTrimmed) {
        setError('Display name cannot be empty.');
        toast.error('Display name cannot be empty.');
        setIsSavingProfile(false);
        return;
      }

      await updateProfile(auth.currentUser, {
        displayName: displayNameTrimmed,
        photoURL: editPhotoUrl
      });

      const userDocRef = doc(db, 'users', auth.currentUser.uid);
      await updateDoc(userDocRef, {
        displayName: displayNameTrimmed,
        name: displayNameTrimmed,
        photoURL: editPhotoUrl,
        avatarUrl: editPhotoUrl
      });

      setSuccess('Profile updated successfully!');
      toast.success('Profile updated successfully!');
    } catch (err: any) {
      console.error('Error updating profile:', err);
      setError(err.message || 'Failed to update profile.');
      toast.error('Failed to update profile.');
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleUpgradeToPro = async () => {
    if (!userProfile?.uid) return;
    setLoading(true);
    try {
      await handleUpgrade(
        userProfile.uid,
        userProfile.email || '',
        userProfile.displayName || '',
        'pro',
        'monthly'
      );
      onCloseSettings?.();
    } catch (err: any) {
      toast.error(err.message || "Failed to start payment process.");
    } finally {
      setLoading(false);
    }
  };

  const BrandHeader = () => (
    <div className="flex flex-col items-center gap-2 mb-6 text-center">
      {!isSettingsMode && (
        <div className="w-12 h-12 bg-gradient-to-tr from-brand-primary to-brand-secondary rounded-2xl flex items-center justify-center text-white shadow-lg shadow-brand-primary/10 mb-1 border border-white/20">
          <img 
            src="/Logo-2.png" 
            alt="EchoNote"
            className="h-8 w-8 object-contain"
            onError={(e) => {
              (e.target as HTMLElement).style.display = 'none';
            }}
          />
        </div>
      )}
      <div>
        <h1 className="text-2xl font-bold text-brand-primary tracking-tight">
          {isSettingsMode ? 'Account & Security' : mfaResolver ? 'Two-Factor Verification' : mode === 'signup' ? 'Create Your Account' : mode === 'forgot' ? 'Reset Password' : mode === 'sso' ? 'Enterprise Single Sign-On' : 'Sign in to EchoNote'}
        </h1>
        <p className="text-xs text-slate-500 font-medium tracking-wider uppercase mt-1">
          {isSettingsMode ? 'Identity & Access Controls' : mfaResolver ? 'Enter 6-Digit Authenticator Code' : 'Audio Intelligence Workspace'}
        </p>
      </div>
    </div>
  );

  // Settings Mode Modal UI
  if (isSettingsMode) {
    return (
      <div className="fixed inset-0 bg-brand-primary/40 backdrop-blur-md z-[200] flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          className="bg-white rounded-2xl p-6 md:p-8 max-w-lg w-full space-y-6 shadow-2xl border border-slate-100 max-h-[90vh] overflow-y-auto custom-scrollbar"
        >
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-brand-primary" />
              <span className="font-semibold text-brand-primary text-lg">Security Center</span>
            </div>
            <button 
              type="button" 
              onClick={onCloseSettings}
              className="p-1.5 rounded-lg hover:bg-slate-50 text-slate-400 hover:text-slate-600 transition-all text-xs font-semibold"
            >
              Close (Esc)
            </button>
          </div>

          <BrandHeader />
          
          <div className="space-y-5">
            <div className="bg-slate-50 p-5 rounded-xl border border-slate-200/50 space-y-4">
              {/* Profile Photo and Display Name Editing Section */}
              <div className="space-y-4 text-left">
                <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Your Identity</label>
                
                <div className="flex flex-col sm:flex-row gap-4 items-center sm:items-start bg-white p-4 rounded-xl border border-slate-100">
                  <div 
                    onDragEnter={handleDrag}
                    onDragOver={handleDrag}
                    onDragLeave={handleDrag}
                    onDrop={handleDrop}
                    className={`relative w-20 h-20 rounded-xl border-2 border-dashed flex flex-col items-center justify-center overflow-hidden transition-all group shrink-0 ${
                      dragActive ? 'border-brand-primary bg-brand-primary/5' : 'border-slate-200 hover:border-brand-primary'
                    }`}
                  >
                    {editPhotoUrl ? (
                      <>
                        <img 
                          src={editPhotoUrl} 
                          alt="Avatar" 
                          className="w-full h-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5">
                          <label className="cursor-pointer p-1 bg-white/20 hover:bg-white/40 text-white rounded-md transition-colors" title="Change Image">
                            <Camera className="w-3.5 h-3.5" />
                            <input 
                              type="file" 
                              accept="image/*" 
                              className="hidden" 
                              onChange={handleFileChange} 
                            />
                          </label>
                          <button 
                            type="button"
                            onClick={() => {
                              setEditPhotoUrl('');
                              toast.success('Profile picture cleared.');
                            }}
                            className="p-1 bg-white/20 hover:bg-rose-500/80 text-white rounded-md transition-colors" 
                            title="Remove Image"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="w-10 h-10 bg-brand-primary/5 text-brand-primary rounded-lg flex items-center justify-center font-black text-sm">
                          {(editDisplayName?.charAt(0) || userProfile?.email?.charAt(0) || 'U').toUpperCase()}
                        </div>
                        <p className="text-[9px] text-slate-400 font-bold mt-1 uppercase tracking-wider text-center">Drag Image</p>
                        <label className="absolute inset-0 cursor-pointer flex items-center justify-center bg-transparent">
                          <input 
                            type="file" 
                            accept="image/*" 
                            className="hidden" 
                            onChange={handleFileChange} 
                          />
                        </label>
                      </>
                    )}
                  </div>

                  <div className="flex-1 w-full space-y-3">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Display Name</label>
                      <input 
                        type="text"
                        value={editDisplayName}
                        onChange={(e) => setEditDisplayName(e.target.value)}
                        placeholder="e.g. Jane Doe"
                        className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 focus:border-brand-primary rounded-lg text-[13px] focus:outline-none focus:ring-1 focus:ring-brand-primary/20 transition-all font-medium text-brand-primary"
                      />
                    </div>

                    <div className="flex justify-between items-center text-[11px] text-slate-500">
                      <span className="truncate max-w-[150px]" title={userProfile?.email}>{userProfile?.email}</span>
                      <button
                        type="button"
                        disabled={isSavingProfile || !editDisplayName.trim()}
                        onClick={handleSaveProfile}
                        className="px-3 py-1 bg-brand-primary hover:bg-brand-secondary text-white rounded-md font-bold text-[10px] uppercase tracking-wider transition-all shadow-sm flex items-center gap-1 cursor-pointer disabled:opacity-50"
                      >
                        {isSavingProfile ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Save Profile'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-200/50 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-[11px] font-bold tracking-wider text-slate-400 uppercase">Subscription Level</span>
                  <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black tracking-widest uppercase flex items-center gap-1 ${(userProfile?.plan || 'free') === 'pro' ? 'bg-amber-100 text-amber-800 border border-amber-200' : 'bg-slate-200 text-slate-700'}`}>
                    {(userProfile?.plan || 'free') === 'pro' && <Sparkles className="w-3 h-3 text-amber-600" />}
                    {userProfile?.plan || 'free'}
                  </span>
                </div>
                
                {(userProfile && (userProfile?.plan || 'free') !== 'pro') && (
                  <button 
                    onClick={handleUpgradeToPro}
                    disabled={loading}
                    className="w-full py-3 bg-brand-primary hover:bg-brand-secondary text-white rounded-lg text-xs font-black tracking-widest uppercase transition-all shadow-md active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4 text-brand-accent animate-pulse" />}
                    Upgrade to Pro (₹999/mo)
                  </button>
                )}

                {userProfile?.plan === 'pro' && (
                  <div className="text-center p-3.5 bg-emerald-50 rounded-xl border border-emerald-100">
                    <p className="text-[11px] text-emerald-800 font-bold tracking-wide">
                      <span className="flex items-center justify-center gap-1 text-emerald-700 uppercase tracking-wider text-[10px] mb-1">
                        <CheckCircle className="w-3.5 h-3.5" /> Pro Access Active
                      </span>
                      Auto-renews or expires on: <span className="font-extrabold text-emerald-900">{userProfile?.planExpiresAt ? new Date(userProfile.planExpiresAt).toLocaleDateString() : 'N/A'}</span>
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Two-Factor Authentication (2FA / MFA) Section (Phase 1A Step 3) */}
            <div className="bg-slate-50 p-5 rounded-xl border border-slate-200/50 space-y-4 text-left">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-brand-primary" />
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                    Two-Factor Authentication (2FA)
                  </span>
                </div>
                <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${
                  mfaEnrolled ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' : 'bg-slate-200 text-slate-700'
                }`}>
                  {mfaLoading ? 'Checking...' : mfaEnrolled ? 'Enabled' : 'Not Configured'}
                </span>
              </div>

              <p className="text-xs text-slate-600 leading-relaxed">
                Add an extra layer of protection to your EchoNote account. When enabled, signing in requires a 6-digit verification code from your authenticator app (Google Authenticator, Microsoft Authenticator, or 1Password).
              </p>

              {mfaEnrolled ? (
                <div className="space-y-3 pt-2 border-t border-slate-200/50">
                  <div className="flex items-center justify-between p-3 bg-white rounded-xl border border-slate-100">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center">
                        <Smartphone className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-slate-800">Authenticator App (TOTP)</p>
                        <p className="text-[10px] text-slate-400 font-medium">Standard 6-digit time-based one-time password</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setShowDisableMfaModal(true);
                        setDisableMfaPassword('');
                        setError('');
                      }}
                      className="px-3 py-1.5 border border-rose-200 hover:bg-rose-50 text-rose-600 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer"
                    >
                      Disable
                    </button>
                  </div>

                  <div className="p-3.5 bg-slate-50/80 rounded-xl border border-slate-200 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
                        <KeyRound className="w-4 h-4 text-brand-primary" />
                        <span>MFA Recovery Codes</span>
                      </div>
                      <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${
                        recoveryStatus?.remainingCodes && recoveryStatus.remainingCodes > 0
                          ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                          : 'bg-rose-100 text-rose-800 border border-rose-200'
                      }`}>
                        {recoveryStatus?.configured ? `${recoveryStatus.remainingCodes} Remaining` : 'Not Generated'}
                      </span>
                    </div>

                    <p className="text-[11px] text-slate-500 leading-relaxed">
                      Emergency single-use codes let you access your account if your authenticator app is lost. Codes are never stored in plaintext on servers.
                    </p>

                    <div className="pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          setRecoveryModalStep('reauth');
                          setRecoveryReauthPassword('');
                          setError('');
                          setShowRecoveryModal(true);
                        }}
                        className="w-full py-2 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
                      >
                        <RefreshCw className="w-3.5 h-3.5 text-brand-primary" />
                        <span>{recoveryStatus?.configured ? 'Regenerate Recovery Codes' : 'Generate Recovery Codes'}</span>
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="pt-2 border-t border-slate-200/50">
                  <button
                    type="button"
                    onClick={handleStartMfaSetup}
                    disabled={mfaLoading}
                    className="w-full py-2.5 bg-brand-primary hover:bg-brand-secondary text-white rounded-xl text-xs font-black tracking-widest uppercase transition-all shadow-md active:scale-95 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    <Smartphone className="w-4 h-4" />
                    <span>Set Up Authenticator App</span>
                  </button>
                </div>
              )}
            </div>

            {/* MFA Enrollment Modal Dialog */}
            <AnimatePresence>
              {showMfaEnrollModal && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[250] flex items-center justify-center p-4">
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 10 }}
                    className="bg-white rounded-2xl p-6 max-w-md w-full space-y-5 shadow-2xl border border-slate-100 text-left"
                  >
                    <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                      <div className="flex items-center gap-2">
                        <Smartphone className="w-5 h-5 text-brand-primary" />
                        <h3 className="font-bold text-slate-800 text-sm">Two-Factor Authentication Setup</h3>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setShowMfaEnrollModal(false);
                          setMfaTotpSecret(null);
                          setError('');
                        }}
                        className="text-slate-400 hover:text-slate-600 text-xs font-semibold"
                      >
                        Cancel
                      </button>
                    </div>

                    {error && (
                      <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                        <span>{error}</span>
                      </div>
                    )}

                    {mfaEnrollStep === 'password' && (
                      <form onSubmit={handleConfirmPasswordAndGenerateSecret} className="space-y-4">
                        <p className="text-xs text-slate-600 leading-relaxed">
                          For your security, please confirm your current account password to begin authenticator setup.
                        </p>
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Current Password</label>
                          <div className="relative">
                            <input
                              type={passwordVisible ? "text" : "password"}
                              required
                              autoFocus
                              value={mfaPassword}
                              onChange={(e) => setMfaPassword(e.target.value)}
                              placeholder="••••••••"
                              className="w-full pl-3 pr-10 py-2.5 bg-slate-50 border border-slate-200 focus:border-brand-primary rounded-xl text-xs font-medium focus:outline-none focus:ring-1 focus:ring-brand-primary/20"
                            />
                            <button
                              type="button"
                              onClick={() => setPasswordVisible(!passwordVisible)}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                            >
                              {passwordVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                          </div>
                        </div>

                        <div className="flex gap-2 pt-2">
                          <button
                            type="button"
                            onClick={() => setShowMfaEnrollModal(false)}
                            className="flex-1 py-2.5 border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl text-xs font-bold uppercase tracking-wider transition-all"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            disabled={isEnrollingMfa || !mfaPassword}
                            className="flex-1 py-2.5 bg-brand-primary hover:bg-brand-secondary text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all shadow-md active:scale-95 disabled:opacity-50 flex items-center justify-center gap-1.5 cursor-pointer"
                          >
                            {isEnrollingMfa ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <span>Continue</span>}
                          </button>
                        </div>
                      </form>
                    )}

                    {mfaEnrollStep === 'scan' && mfaTotpSecret && (
                      <form onSubmit={handleCompleteMfaEnrollment} className="space-y-4">
                        <div className="space-y-3">
                          <p className="text-xs text-slate-600 leading-relaxed">
                            1. Open your authenticator app (Google Authenticator, Microsoft Authenticator, or 1Password) and scan the QR code below.
                          </p>

                          {mfaQrCodeUrl && (
                            <div className="flex flex-col items-center justify-center p-3 bg-slate-50 rounded-xl border border-slate-200/80">
                              <img
                                src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(mfaQrCodeUrl)}`}
                                alt="MFA QR Code"
                                className="w-40 h-40 object-contain rounded-lg shadow-sm bg-white p-2 border border-slate-200"
                              />
                            </div>
                          )}

                          <div className="space-y-1">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                              Manual Setup Key
                            </label>
                            <div className="flex items-center gap-2">
                              <input
                                type="text"
                                readOnly
                                value={mfaTotpSecret.secretKey}
                                className="flex-1 px-3 py-2 bg-slate-100 rounded-lg text-xs font-mono font-bold text-slate-800 tracking-wider select-all border border-slate-200"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  navigator.clipboard.writeText(mfaTotpSecret.secretKey);
                                  setMfaKeyCopied(true);
                                  setTimeout(() => setMfaKeyCopied(false), 2000);
                                  toast.success("Secret key copied to clipboard");
                                }}
                                className="p-2 border border-slate-200 hover:bg-slate-100 rounded-lg text-slate-600 transition-colors cursor-pointer"
                                title="Copy Key"
                              >
                                {mfaKeyCopied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                              </button>
                            </div>
                          </div>

                          <div className="space-y-1.5 pt-2 border-t border-slate-100">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-700">
                              2. Enter 6-digit verification code
                            </label>
                            <input
                              type="text"
                              inputMode="numeric"
                              autoComplete="one-time-code"
                              maxLength={6}
                              autoFocus
                              value={mfaVerifyCode}
                              onChange={(e) => setMfaVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                              placeholder="123456"
                              className="w-full text-center text-xl font-mono font-bold tracking-[0.3em] py-2.5 bg-slate-50 border border-slate-200 focus:border-brand-primary rounded-xl focus:outline-none focus:ring-1 focus:ring-brand-primary/20 text-slate-900"
                            />
                          </div>
                        </div>

                        <div className="flex gap-2 pt-2">
                          <button
                            type="button"
                            onClick={() => {
                              setShowMfaEnrollModal(false);
                              setMfaTotpSecret(null);
                            }}
                            className="flex-1 py-2.5 border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl text-xs font-bold uppercase tracking-wider transition-all"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            disabled={isEnrollingMfa || mfaVerifyCode.length < 6}
                            className="flex-1 py-2.5 bg-brand-primary hover:bg-brand-secondary text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all shadow-md active:scale-95 disabled:opacity-50 flex items-center justify-center gap-1.5 cursor-pointer"
                          >
                            {isEnrollingMfa ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <span>Activate 2FA</span>}
                          </button>
                        </div>
                      </form>
                    )}
                  </motion.div>
                </div>
              )}
            </AnimatePresence>

            {/* Disable MFA Confirmation Modal */}
            <AnimatePresence>
              {showDisableMfaModal && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[250] flex items-center justify-center p-4">
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 10 }}
                    className="bg-white rounded-2xl p-6 max-w-sm w-full space-y-4 shadow-2xl border border-slate-100 text-left"
                  >
                    <div className="flex items-center gap-2.5 text-rose-600">
                      <AlertCircle className="w-5 h-5 shrink-0" />
                      <h3 className="font-bold text-sm text-slate-900">Disable Two-Factor Authentication?</h3>
                    </div>

                    <p className="text-xs text-slate-600 leading-relaxed">
                      Disabling 2FA removes the extra security layer. Your account will only be protected by your password.
                    </p>

                    {error && (
                      <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700">
                        {error}
                      </div>
                    )}

                    <form onSubmit={handleDisableMfaConfirm} className="space-y-4">
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Confirm Password</label>
                        <input
                          type="password"
                          required
                          autoFocus
                          value={disableMfaPassword}
                          onChange={(e) => setDisableMfaPassword(e.target.value)}
                          placeholder="••••••••"
                          className="w-full px-3 py-2 bg-slate-50 border border-slate-200 focus:border-rose-500 rounded-xl text-xs font-medium focus:outline-none"
                        />
                      </div>

                      <div className="flex gap-2 pt-2">
                        <button
                          type="button"
                          onClick={() => {
                            setShowDisableMfaModal(false);
                            setDisableMfaPassword('');
                            setError('');
                          }}
                          className="flex-1 py-2.5 border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl text-xs font-bold uppercase tracking-wider transition-all"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={isDisablingMfa || !disableMfaPassword}
                          className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all shadow-md active:scale-95 disabled:opacity-50 flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          {isDisablingMfa ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <span>Disable 2FA</span>}
                        </button>
                      </div>
                    </form>
                  </motion.div>
                </div>
              )}
            </AnimatePresence>

            {/* Recovery Codes Generation & View Modal Dialog */}
            <AnimatePresence>
              {showRecoveryModal && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[250] flex items-center justify-center p-4">
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 10 }}
                    className="bg-white rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl border border-slate-100 text-left"
                  >
                    <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                      <div className="flex items-center gap-2">
                        <KeyRound className="w-5 h-5 text-brand-primary" />
                        <h3 className="font-bold text-slate-800 text-sm">Emergency MFA Recovery Codes</h3>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setShowRecoveryModal(false);
                          setFreshRecoveryCodes([]);
                          setError('');
                        }}
                        className="text-slate-400 hover:text-slate-600 text-xs font-semibold"
                      >
                        Close
                      </button>
                    </div>

                    {error && (
                      <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                        <span>{error}</span>
                      </div>
                    )}

                    {recoveryModalStep === 'reauth' && (
                      <form onSubmit={handleGenerateRecoveryCodesSubmit} className="space-y-4">
                        <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-xs text-amber-900 leading-relaxed">
                          Generating new recovery codes will <strong>immediately invalidate all previously issued codes</strong>. Confirm your password to proceed.
                        </div>

                        <div className="space-y-1">
                          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Confirm Current Password</label>
                          <input
                            type="password"
                            required
                            autoFocus
                            value={recoveryReauthPassword}
                            onChange={(e) => setRecoveryReauthPassword(e.target.value)}
                            placeholder="••••••••"
                            className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 focus:border-brand-primary rounded-xl text-xs font-medium focus:outline-none"
                          />
                        </div>

                        <div className="flex gap-2 pt-2">
                          <button
                            type="button"
                            onClick={() => setShowRecoveryModal(false)}
                            className="flex-1 py-2.5 border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl text-xs font-bold uppercase tracking-wider transition-all"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            disabled={isGeneratingRecoveryCodes || !recoveryReauthPassword}
                            className="flex-1 py-2.5 bg-brand-primary hover:bg-brand-secondary text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all shadow-md active:scale-95 disabled:opacity-50 flex items-center justify-center gap-1.5 cursor-pointer"
                          >
                            {isGeneratingRecoveryCodes ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <span>Generate 10 Codes</span>}
                          </button>
                        </div>
                      </form>
                    )}

                    {recoveryModalStep === 'display' && (
                      <div className="space-y-4">
                        <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-xs text-amber-900 leading-relaxed font-medium">
                          Store these 10 recovery codes safely. Each code can be redeemed exactly once. <strong>They will NOT be shown again.</strong>
                        </div>

                        <div className="p-3 bg-slate-900 rounded-xl border border-slate-800">
                          <div className="grid grid-cols-2 gap-2 text-center font-mono text-xs font-black tracking-wider text-emerald-400">
                            {freshRecoveryCodes.map((c, idx) => (
                              <div key={idx} className="p-1.5 bg-slate-800/80 rounded select-all border border-slate-700/50">
                                {c}
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(freshRecoveryCodes.join('\n'));
                              setRecoveryCodesCopied(true);
                              toast.success('Codes copied to clipboard');
                              setTimeout(() => setRecoveryCodesCopied(false), 3000);
                            }}
                            className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                          >
                            {recoveryCodesCopied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                            <span>{recoveryCodesCopied ? 'Copied' : 'Copy All'}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const blob = new Blob([
                                `EchoNote MFA Single-Use Recovery Codes\nAccount: ${auth?.currentUser?.email}\nGenerated: ${new Date().toISOString()}\n\n` +
                                freshRecoveryCodes.join('\n') +
                                `\n\nEach code can be used exactly once. Store securely.`
                              ], { type: 'text/plain' });
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement('a');
                              a.href = url;
                              a.download = `echonote-mfa-recovery-codes-${auth?.currentUser?.email?.split('@')[0] || 'user'}.txt`;
                              a.click();
                              URL.revokeObjectURL(url);
                              toast.success('Downloaded recovery codes file');
                            }}
                            className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>Download .txt</span>
                          </button>
                        </div>

                        <div className="pt-2">
                          <button
                            type="button"
                            onClick={() => {
                              setShowRecoveryModal(false);
                              setFreshRecoveryCodes([]);
                            }}
                            className="w-full py-2.5 bg-brand-primary hover:bg-brand-secondary text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all shadow-md cursor-pointer"
                          >
                            I Have Saved These Codes
                          </button>
                        </div>
                      </div>
                    )}
                  </motion.div>
                </div>
              )}
            </AnimatePresence>

            <div className="space-y-3 p-4 bg-slate-50/50 rounded-xl border border-slate-100">
              <h4 className="text-xs font-bold tracking-wider text-slate-400 uppercase">Compliance & Security</h4>
              <div className="space-y-2 text-xs text-slate-500 leading-relaxed text-left">
                <p className="flex items-start gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                  Authenticated via Firebase Authentication with HTTPS-only encrypted sessions.
                </p>
                <p className="flex items-start gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                  Enterprise access policies enforced through Authoritative Custom Claims.
                </p>
              </div>
            </div>

            {/* Admin SSO Setup Guide */}
            <div className="border border-slate-100 rounded-xl overflow-hidden">
              <button
                type="button"
                onClick={() => setShowAdminSsoGuide(!showAdminSsoGuide)}
                className="w-full px-4 py-3 bg-slate-50 hover:bg-slate-100/80 transition-colors flex items-center justify-between text-xs font-bold text-slate-600 uppercase tracking-wider"
              >
                <span className="flex items-center gap-1.5">
                  <Key className="w-4 h-4 text-brand-primary" />
                  SSO Administrator Guide
                </span>
                {showAdminSsoGuide ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              
              <AnimatePresence>
                {showAdminSsoGuide && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden bg-white border-t border-slate-100 text-left text-xs text-slate-600 p-4 space-y-4"
                  >
                    <div className="space-y-3">
                      <p className="font-semibold text-brand-primary">Configuring SSO in Google Cloud Identity Platform & Azure AD:</p>
                      
                      <div className="space-y-2.5">
                        <div className="border-l-2 border-slate-200 pl-3">
                          <p className="font-bold text-slate-700">1. Microsoft Entra ID (OIDC):</p>
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            Register an App in <a href="https://portal.azure.com" target="_blank" rel="noreferrer" className="text-brand-primary underline hover:text-brand-secondary inline-flex items-center gap-0.5">Azure Portal <ExternalLink className="w-2.5 h-2.5" /></a>. Set Redirect URI to: <code className="bg-slate-100 px-1 py-0.5 rounded font-mono text-[10px]">https://{auth?.app.options.authDomain}/__/auth/handler</code>.
                          </p>
                        </div>

                        <div className="border-l-2 border-slate-200 pl-3">
                          <p className="font-bold text-slate-700">2. SAML 2.0 (Okta, Ping, Google Workspace):</p>
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            In your IdP, configure ACS URL to <code className="bg-slate-100 px-1 py-0.5 rounded font-mono text-[10px]">https://{auth?.app.options.authDomain}/__/auth/handler</code> and Entity ID to your configured Google Identity Platform SAML Provider ID.
                          </p>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          <div className="flex flex-col space-y-3 pt-4 border-t border-slate-100">
            <button 
              type="button" 
              onClick={onCloseSettings} 
              className="w-full py-3 border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-xl text-xs font-bold uppercase tracking-wider transition-all"
            >
              Close Settings
            </button>
            {onLogout && (
              <button 
                type="button" 
                onClick={onLogout}
                className="w-full py-3 bg-rose-50 text-rose-600 hover:bg-rose-100 rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2"
              >
                <LogOut className="w-4 h-4" />
                Sign Out / Terminate Session
              </button>
            )}
          </div>
        </motion.div>
      </div>
    );
  }

  // Authentication View (Sign In, Sign Up, Forgot Password, Enterprise SSO)
  return (
    <div className="fixed inset-0 bg-slate-50 flex items-center justify-center p-4 md:p-8 z-50 overflow-y-auto">
      <motion.div 
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-4xl w-full bg-white rounded-3xl shadow-xl border border-slate-100 overflow-hidden grid grid-cols-1 md:grid-cols-12 min-h-[580px]"
      >
        {/* Left Column: Brand & Security Guarantee */}
        <div className="md:col-span-5 bg-brand-secondary p-8 text-slate-800 flex flex-col justify-between relative overflow-hidden border-r border-slate-100">
          <div className="absolute inset-0 opacity-20 bg-[linear-gradient(to_right,#5DA9FF_1px,transparent_1px),linear-gradient(to_bottom,#5DA9FF_1px,transparent_1px)] bg-[size:24px_24px]" />
          
          <div className="relative z-10 space-y-8">
            <div className="flex items-center gap-2 cursor-pointer" onClick={onBackToHome}>
              <div className="w-9 h-9 bg-brand-primary/10 rounded-xl flex items-center justify-center border border-brand-primary/20">
                <Sparkle className="w-5 h-5 text-brand-primary" />
              </div>
              <span className="text-lg font-bold tracking-tight text-slate-900">EchoNote</span>
            </div>

            <div className="space-y-4">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-brand-primary/10 rounded-full text-[10px] font-bold uppercase tracking-widest border border-brand-primary/20 text-brand-primary">
                <ShieldCheck className="w-3.5 h-3.5 text-brand-primary" /> Enterprise Grade
              </span>
              <h2 className="text-2xl font-semibold leading-tight tracking-tight lg:text-3xl text-slate-900">
                Secure Audio Intelligence for Modern Teams.
              </h2>
              <p className="text-sm text-slate-600 leading-relaxed">
                Transform voice meetings into structured intelligence, decisions, and action items with real enterprise security.
              </p>
            </div>
          </div>

          <div className="relative z-10 space-y-4 pt-8">
            <div className="space-y-3.5">
              <div className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-full bg-brand-primary/10 flex items-center justify-center mt-0.5 shrink-0">
                  <CheckCircle className="w-3 h-3 text-brand-primary" />
                </div>
                <div className="text-xs text-slate-600">
                  <span className="font-semibold text-slate-900 block">SAML 2.0 & Entra ID SSO</span>
                  Seamless corporate Single Sign-On with verified domain routing.
                </div>
              </div>
              
              <div className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-full bg-brand-primary/10 flex items-center justify-center mt-0.5 shrink-0">
                  <CheckCircle className="w-3 h-3 text-brand-primary" />
                </div>
                <div className="text-xs text-slate-600">
                  <span className="font-semibold text-slate-900 block">Encrypted & Audited</span>
                  Role-based workspace isolation and tamper-resistant audit logs.
                </div>
              </div>
            </div>

            <div className="pt-6 border-t border-slate-200/80 flex items-center justify-between text-[11px] text-slate-500 font-medium">
              <span>SOC 2 & ISO 27001 Ready</span>
              <span>256-bit AES Encryption</span>
            </div>
          </div>
        </div>

        {/* Right Column: Authentication Form */}
        <div className="md:col-span-7 p-6 md:p-10 flex flex-col justify-between space-y-6">
          <div>
            <BrandHeader />

            {/* Top Navigation Tabs for Sign In vs. New Account */}
            {mode !== 'forgot' && mode !== 'sso' ? (
              <div className="grid grid-cols-2 bg-slate-100 p-1 rounded-xl mb-6">
                <button 
                  type="button"
                  onClick={() => { 
                    setMode('signin'); 
                    setError(''); 
                    setSuccess(''); 
                  }}
                  className={`py-2 text-[12px] font-bold uppercase tracking-wider rounded-lg transition-all ${
                    mode === 'signin' 
                      ? 'bg-white text-brand-primary shadow-sm' 
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  Sign In
                </button>
                <button 
                  type="button"
                  onClick={() => { 
                    setMode('signup'); 
                    setError(''); 
                    setSuccess(''); 
                  }}
                  className={`py-2 text-[12px] font-bold uppercase tracking-wider rounded-lg transition-all ${
                    mode === 'signup' 
                      ? 'bg-white text-brand-primary shadow-sm' 
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  New Account
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between mb-6 pb-2 border-b border-slate-100">
                <button
                  type="button"
                  onClick={() => { 
                    setMode('signin'); 
                    setError(''); 
                    setSuccess(''); 
                  }}
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600 hover:text-brand-primary transition-colors cursor-pointer"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>Back to Sign In</span>
                </button>
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  {mode === 'forgot' ? 'Password Recovery' : 'Enterprise SSO'}
                </span>
              </div>
            )}

            {/* Error and Success Notifications */}
            <AnimatePresence mode="wait">
              {error && (
                <motion.div 
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="flex items-start gap-2.5 bg-red-50 border border-red-100 text-red-700 p-3.5 rounded-xl text-xs mb-4 text-left"
                >
                  <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold block">Authentication Notice:</span>
                    <span>{error}</span>
                  </div>
                </motion.div>
              )}
              
              {success && (
                <motion.div 
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="flex items-start gap-2.5 bg-emerald-50 border border-emerald-100 text-emerald-800 p-3.5 rounded-xl text-xs mb-4 text-left"
                >
                  <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold block">Success:</span>
                    <span>{success}</span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ========================================================================= */}
            {/* VIEW 1: SIGN IN MODE */}
            {/* ========================================================================= */}
            {mode === 'signin' && (
              <div className="space-y-4 animate-in fade-in duration-200">
                {/* Discovered Enterprise Organization Notice */}
                {authDiscovery?.authMode === 'enterprise' && (
                  <div className="p-3.5 bg-brand-primary/5 border border-brand-primary/15 rounded-xl text-left space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-brand-primary flex items-center gap-1.5">
                        <Building className="w-4 h-4 text-brand-primary" />
                        {authDiscovery.organizationName || 'Enterprise Workspace'}
                      </span>
                      <span className="text-[9px] uppercase tracking-wider font-extrabold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center gap-1">
                        <ShieldCheck className="w-3 h-3 text-emerald-600" />
                        Verified Domain
                      </span>
                    </div>

                    {authDiscovery.ssoEnforced ? (
                      <p className="text-[11px] text-slate-600 leading-relaxed">
                        Your organization enforces Single Sign-On. Standard password login is restricted.
                      </p>
                    ) : (
                      <p className="text-[11px] text-slate-600 leading-relaxed">
                        Single Sign-On is available for your domain. You can sign in with SSO or your password.
                      </p>
                    )}
                  </div>
                )}

                {/* SSO Enforced Path: Direct button */}
                {authDiscovery?.authMode === 'enterprise' && authDiscovery.ssoEnforced ? (
                  <div className="space-y-3">
                    <div className="space-y-1 text-left">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 ml-1">Work Email</label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-3.5 flex items-center pointer-events-none text-slate-400">
                          <Mail className="w-4 h-4" />
                        </div>
                        <input 
                          type="email" 
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 focus:border-brand-primary rounded-xl text-[13px] focus:outline-none"
                        />
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={ssoLoading !== null}
                      onClick={handleEnterpriseSsoAction}
                      className="w-full py-3 bg-brand-primary hover:bg-brand-secondary text-white rounded-xl font-bold tracking-wider text-[12px] uppercase transition-all shadow-md active:scale-95 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                    >
                      {ssoLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Key className="w-4 h-4 text-amber-300" />
                      )}
                      <span>Continue with {authDiscovery.organizationName || 'Organization'} SSO</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setEmail('');
                        setAuthDiscovery(null);
                        setError('');
                      }}
                      className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-xs font-semibold transition-colors"
                    >
                      Use a different email address
                    </button>
                  </div>
                ) : mfaResolver ? (
                  /* Two-Factor Authentication Challenge Form (Phase 1A Step 3) */
                  <form onSubmit={handleVerifyMfaChallenge} className="space-y-4 text-left">
                    <div className="bg-brand-primary/5 border border-brand-primary/20 rounded-xl p-4 flex items-start gap-3">
                      <ShieldCheck className="w-5 h-5 text-brand-primary shrink-0 mt-0.5" />
                      <div>
                        <h3 className="text-xs font-black uppercase tracking-wider text-brand-primary">Two-Factor Authentication Required</h3>
                        <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                          Enter the 6-digit verification code from your authenticator app to complete sign-in.
                        </p>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex justify-between items-center ml-1">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Security Code</label>
                        <span className="text-[10px] text-slate-400 font-medium">6 digits</span>
                      </div>
                      <input
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={6}
                        autoFocus
                        value={mfaChallengeCode}
                        onChange={(e) => setMfaChallengeCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="123456"
                        className="w-full text-center text-2xl font-mono font-bold tracking-[0.35em] py-3 bg-slate-50 border border-slate-200 focus:border-brand-primary rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-primary/20 transition-all text-slate-900"
                      />
                    </div>

                    {!showSignInRecovery ? (
                      <>
                        <button
                          type="submit"
                          disabled={isVerifyingMfa || mfaChallengeCode.length < 6}
                          className="w-full py-3 bg-brand-primary hover:bg-brand-secondary text-white rounded-xl font-bold tracking-wider text-[12px] uppercase transition-all shadow-md active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
                        >
                          {isVerifyingMfa ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                          <span>{isVerifyingMfa ? 'Verifying...' : 'Verify & Sign In'}</span>
                        </button>

                        <div className="pt-2 text-center border-t border-slate-100 space-y-2">
                          <button
                            type="button"
                            onClick={() => {
                              setShowSignInRecovery(true);
                              setSignInRecoveryInput('');
                              setError('');
                            }}
                            className="text-xs font-bold text-brand-primary hover:underline transition-all cursor-pointer block mx-auto"
                          >
                            Lost your authenticator device? Use a Recovery Code
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setMfaResolver(null);
                              setMfaChallengeCode('');
                              setError('');
                            }}
                            className="w-full py-1 text-xs font-semibold text-slate-400 hover:text-slate-600 transition-colors text-center"
                          >
                            Cancel & Return to Password Sign In
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="space-y-3 pt-2 border-t border-slate-100">
                        <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-xs text-amber-900 leading-relaxed">
                          <strong>Emergency Single-Use Recovery Code:</strong> Enter one of your 10-character codes (e.g. <code>ABCD2-EFGH3</code>).
                        </div>

                        <div className="space-y-1">
                          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Recovery Code</label>
                          <input
                            type="text"
                            required
                            autoFocus
                            value={signInRecoveryInput}
                            onChange={(e) => setSignInRecoveryInput(e.target.value.toUpperCase())}
                            placeholder="XXXXX-XXXXX"
                            className="w-full text-center text-lg font-mono font-bold tracking-widest py-2.5 bg-slate-50 border border-slate-200 focus:border-amber-600 rounded-xl focus:outline-none"
                          />
                        </div>

                        <button
                          type="button"
                          onClick={handleSignInRecoveryRedeem}
                          disabled={isRedeemingSignInRecovery || signInRecoveryInput.trim().length < 8}
                          className="w-full py-3 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-bold tracking-wider text-[12px] uppercase transition-all shadow-md active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
                        >
                          {isRedeemingSignInRecovery ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                          <span>{isRedeemingSignInRecovery ? 'Redeeming...' : 'Redeem Recovery Code'}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setShowSignInRecovery(false);
                            setError('');
                          }}
                          className="w-full py-1.5 text-xs font-bold text-slate-500 hover:text-slate-700 transition-colors text-center"
                        >
                          Back to Authenticator App (TOTP)
                        </button>
                      </div>
                    )}
                  </form>
                ) : (
                  /* Standard Password Sign In Form */
                  <form onSubmit={handleSignIn} className="space-y-4">
                    {/* Optional SSO button if detected */}
                    {authDiscovery?.authMode === 'enterprise' && !authDiscovery.ssoEnforced && (
                      <div className="pb-3 border-b border-slate-100">
                        <button
                          type="button"
                          disabled={ssoLoading !== null}
                          onClick={handleEnterpriseSsoAction}
                          className="w-full py-2.5 bg-brand-primary/10 hover:bg-brand-primary/15 text-brand-primary border border-brand-primary/30 rounded-xl font-bold tracking-wider text-[11px] uppercase transition-all flex items-center justify-center gap-2 cursor-pointer"
                        >
                          {ssoLoading ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Key className="w-3.5 h-3.5 text-brand-primary" />
                          )}
                          <span>Sign in with {authDiscovery.organizationName || 'Organization'} SSO</span>
                        </button>
                      </div>
                    )}

                    <div className="space-y-1 text-left">
                      <div className="flex justify-between items-center ml-1">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Work Email</label>
                        {discoveryLoading && (
                          <span className="text-[10px] text-slate-400 flex items-center gap-1">
                            <Loader2 className="w-2.5 h-2.5 animate-spin" /> Checking domain...
                          </span>
                        )}
                      </div>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-3.5 flex items-center pointer-events-none text-slate-400">
                          <Mail className="w-4 h-4" />
                        </div>
                        <input 
                          type="email" 
                          required
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          onBlur={() => checkDomainDiscovery(email)}
                          placeholder="name@company.com"
                          className={`w-full pl-10 pr-4 py-2.5 bg-slate-50 border rounded-xl text-[13px] focus:outline-none focus:ring-2 focus:ring-brand-primary/20 transition-all ${
                            !isEmailValid && email !== '' ? 'border-red-500 focus:border-red-500' : 'border-slate-200 focus:border-brand-primary'
                          }`}
                        />
                      </div>
                      {!isEmailValid && email !== '' && (
                        <p className="text-[10px] text-red-500 ml-1">Please enter a valid work email.</p>
                      )}
                    </div>

                    <div className="space-y-1 text-left">
                      <div className="flex justify-between items-center ml-1">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Password</label>
                        <button 
                          type="button"
                          onClick={() => {
                            setMode('forgot');
                            setError('');
                            setSuccess('');
                          }}
                          className="text-[10px] font-bold uppercase tracking-wider text-brand-primary hover:underline cursor-pointer bg-transparent border-none p-0"
                        >
                          Forgot Password?
                        </button>
                      </div>
                      
                      <div className="relative">
                        <div className="absolute inset-y-0 left-3.5 flex items-center pointer-events-none text-slate-400">
                          <Lock className="w-4 h-4" />
                        </div>
                        <input 
                          type={passwordVisible ? "text" : "password"} 
                          required
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="••••••••"
                          className={`w-full pl-10 pr-10 py-2.5 bg-slate-50 border rounded-xl text-[13px] focus:outline-none focus:ring-2 focus:ring-brand-primary/20 transition-all ${
                            !isPasswordValid && password !== '' ? 'border-red-500 focus:border-red-500' : 'border-slate-200 focus:border-brand-primary'
                          }`}
                        />
                        <button
                          type="button"
                          onClick={() => setPasswordVisible(!passwordVisible)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-brand-primary transition-colors cursor-pointer"
                        >
                          {passwordVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    <button 
                      type="submit"
                      disabled={loading || !email || !password || !validateEmail(email)}
                      className="w-full py-3 bg-brand-primary hover:bg-brand-secondary text-white rounded-xl font-bold tracking-wider text-[12px] uppercase transition-all shadow-md active:scale-95 disabled:opacity-50 flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <span>Sign In</span>}
                    </button>

                    <div className="relative py-2">
                      <div className="absolute inset-0 flex items-center">
                        <div className="w-full border-t border-slate-200"></div>
                      </div>
                      <div className="relative flex justify-center text-[10px] uppercase tracking-widest font-black text-slate-400">
                        <span className="bg-white px-3">Or continue with</span>
                      </div>
                    </div>

                    {/* Social & Enterprise SSO Providers */}
                    <div className="grid grid-cols-2 gap-2.5">
                      <button
                        type="button"
                        disabled={ssoLoading !== null}
                        onClick={handleGoogleSso}
                        className="w-full px-3 py-2.5 border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50 cursor-pointer"
                      >
                        {ssoLoading === 'google' ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <i className="fa-brands fa-google text-red-500 text-sm"></i>
                        )}
                        <span>Google</span>
                      </button>

                      <button
                        type="button"
                        disabled={ssoLoading !== null}
                        onClick={handleMicrosoftSso}
                        className="w-full px-3 py-2.5 border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50 cursor-pointer"
                      >
                        {ssoLoading === 'microsoft' ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <i className="fa-brands fa-microsoft text-sky-600 text-sm"></i>
                        )}
                        <span>Microsoft</span>
                      </button>
                    </div>

                    {/* Dedicated SSO trigger link */}
                    <div className="pt-2 text-center">
                      <button
                        type="button"
                        onClick={() => {
                          setMode('sso');
                          setError('');
                          setSuccess('');
                          setSsoOrgInput(email);
                        }}
                        className="text-xs font-semibold text-brand-primary hover:text-brand-secondary hover:underline inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Building className="w-3.5 h-3.5" />
                        <span>Sign in with Enterprise SSO (SAML / Okta / Azure)</span>
                      </button>
                    </div>
                  </form>
                )}
              </div>
            )}

            {/* ========================================================================= */}
            {/* VIEW 2: NEW ACCOUNT (SIGN UP) MODE */}
            {/* ========================================================================= */}
            {mode === 'signup' && (
              <div className="space-y-4 animate-in fade-in duration-200">
                {/* Discovered Enterprise Organization Notice for Registration */}
                {authDiscovery?.authMode === 'enterprise' && (
                  <div className="p-3.5 bg-brand-primary/5 border border-brand-primary/15 rounded-xl text-left space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-brand-primary flex items-center gap-1.5">
                        <Building className="w-4 h-4 text-brand-primary" />
                        {authDiscovery.organizationName || 'Enterprise Workspace'}
                      </span>
                      <span className="text-[9px] uppercase tracking-wider font-extrabold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                        SSO Required
                      </span>
                    </div>

                    <p className="text-[11px] text-slate-600 leading-relaxed">
                      {authDiscovery.organizationName || 'Your organization'} manages access via Single Sign-On. You don't need a separate password.
                    </p>

                    <button
                      type="button"
                      disabled={ssoLoading !== null}
                      onClick={handleEnterpriseSsoAction}
                      className="w-full mt-2 py-2.5 bg-brand-primary hover:bg-brand-secondary text-white rounded-xl font-bold tracking-wider text-[11px] uppercase transition-all flex items-center justify-center gap-2 cursor-pointer"
                    >
                      {ssoLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Key className="w-3.5 h-3.5 text-amber-300" />}
                      <span>Join with Organization SSO</span>
                    </button>
                  </div>
                )}

                {/* Standard Registration Form */}
                <form onSubmit={handleSignUp} className="space-y-4">
                  <div className="space-y-1 text-left">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 ml-1">Full Name</label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-3.5 flex items-center pointer-events-none text-slate-400">
                        <User className="w-4 h-4" />
                      </div>
                      <input 
                        type="text" 
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Jane Doe"
                        className={`w-full pl-10 pr-4 py-2.5 bg-slate-50 border rounded-xl text-[13px] focus:outline-none focus:ring-2 focus:ring-brand-primary/20 transition-all ${
                          !isNameValid ? 'border-red-500 focus:border-red-500' : 'border-slate-200 focus:border-brand-primary'
                        }`}
                      />
                    </div>
                  </div>

                  <div className="space-y-1 text-left">
                    <div className="flex justify-between items-center ml-1">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Work Email</label>
                      {discoveryLoading && (
                        <span className="text-[10px] text-slate-400 flex items-center gap-1">
                          <Loader2 className="w-2.5 h-2.5 animate-spin" /> Checking domain...
                        </span>
                      )}
                    </div>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-3.5 flex items-center pointer-events-none text-slate-400">
                        <Mail className="w-4 h-4" />
                      </div>
                      <input 
                        type="email" 
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        onBlur={() => checkDomainDiscovery(email)}
                        placeholder="name@company.com"
                        className={`w-full pl-10 pr-4 py-2.5 bg-slate-50 border rounded-xl text-[13px] focus:outline-none focus:ring-2 focus:ring-brand-primary/20 transition-all ${
                          !isEmailValid && email !== '' ? 'border-red-500 focus:border-red-500' : 'border-slate-200 focus:border-brand-primary'
                        }`}
                      />
                    </div>
                  </div>

                  <div className="space-y-1 text-left">
                    <div className="flex justify-between items-center ml-1">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Create Password</label>
                      {password.length > 0 && (
                        <span className={`text-[10px] font-bold ${password.length >= 8 ? 'text-emerald-600' : 'text-amber-600'}`}>
                          {password.length >= 8 ? 'Strong length' : `${password.length}/8 min characters`}
                        </span>
                      )}
                    </div>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-3.5 flex items-center pointer-events-none text-slate-400">
                        <Lock className="w-4 h-4" />
                      </div>
                      <input 
                        type={passwordVisible ? "text" : "password"} 
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="At least 8 characters"
                        className={`w-full pl-10 pr-10 py-2.5 bg-slate-50 border rounded-xl text-[13px] focus:outline-none focus:ring-2 focus:ring-brand-primary/20 transition-all ${
                          !isPasswordValid && password !== '' ? 'border-red-500 focus:border-red-500' : 'border-slate-200 focus:border-brand-primary'
                        }`}
                      />
                      <button
                        type="button"
                        onClick={() => setPasswordVisible(!passwordVisible)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-brand-primary transition-colors cursor-pointer"
                      >
                        {passwordVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1 text-left">
                    <div className="flex justify-between items-center ml-1">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Confirm Password</label>
                      {confirmPassword.length > 0 && (
                        <span className={`text-[10px] font-bold ${password === confirmPassword ? 'text-emerald-600' : 'text-red-500'}`}>
                          {password === confirmPassword ? 'Passwords match' : 'Must match'}
                        </span>
                      )}
                    </div>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-3.5 flex items-center pointer-events-none text-slate-400">
                        <Lock className="w-4 h-4" />
                      </div>
                      <input 
                        type={confirmPasswordVisible ? "text" : "password"} 
                        required
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Re-enter password"
                        className={`w-full pl-10 pr-10 py-2.5 bg-slate-50 border rounded-xl text-[13px] focus:outline-none focus:ring-2 focus:ring-brand-primary/20 transition-all ${
                          !passwordsMatch && confirmPassword !== '' ? 'border-red-500 focus:border-red-500' : 'border-slate-200 focus:border-brand-primary'
                        }`}
                      />
                      <button
                        type="button"
                        onClick={() => setConfirmPasswordVisible(!confirmPasswordVisible)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-brand-primary transition-colors cursor-pointer"
                      >
                        {confirmPasswordVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <button 
                    type="submit"
                    disabled={loading || !name.trim() || !email || password.length < 8 || password !== confirmPassword}
                    className="w-full py-3 bg-brand-primary hover:bg-brand-secondary text-white rounded-xl font-bold tracking-wider text-[12px] uppercase transition-all shadow-md active:scale-95 disabled:opacity-50 flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <span>Create Account</span>}
                  </button>

                  <div className="relative py-2">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-slate-200"></div>
                    </div>
                    <div className="relative flex justify-center text-[10px] uppercase tracking-widest font-black text-slate-400">
                      <span className="bg-white px-3">Or register with</span>
                    </div>
                  </div>

                  {/* Social Sign Up Options */}
                  <div className="grid grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      disabled={ssoLoading !== null}
                      onClick={handleGoogleSso}
                      className="w-full px-3 py-2.5 border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50 cursor-pointer"
                    >
                      {ssoLoading === 'google' ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <i className="fa-brands fa-google text-red-500 text-sm"></i>
                      )}
                      <span>Google</span>
                    </button>

                    <button
                      type="button"
                      disabled={ssoLoading !== null}
                      onClick={handleMicrosoftSso}
                      className="w-full px-3 py-2.5 border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50 cursor-pointer"
                    >
                      {ssoLoading === 'microsoft' ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <i className="fa-brands fa-microsoft text-sky-600 text-sm"></i>
                      )}
                      <span>Microsoft</span>
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* ========================================================================= */}
            {/* VIEW 3: FORGOT PASSWORD MODE */}
            {/* ========================================================================= */}
            {mode === 'forgot' && (
              <form onSubmit={handleResetPassword} className="space-y-4 animate-in fade-in duration-200">
                <div className="text-left space-y-1.5">
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Enter the email address associated with your EchoNote account. We will send a secure password reset link directly to your inbox.
                  </p>
                </div>

                <div className="space-y-1 text-left">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 ml-1">Work Email</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-3.5 flex items-center pointer-events-none text-slate-400">
                      <Mail className="w-4 h-4" />
                    </div>
                    <input 
                      type="email" 
                      required
                      autoFocus
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="name@company.com"
                      className={`w-full pl-10 pr-4 py-2.5 bg-slate-50 border rounded-xl text-[13px] focus:outline-none focus:ring-2 focus:ring-brand-primary/20 transition-all ${
                        !isEmailValid && email !== '' ? 'border-red-500 focus:border-red-500' : 'border-slate-200 focus:border-brand-primary'
                      }`}
                    />
                  </div>
                </div>

                <button 
                  type="submit"
                  disabled={resetLoading || !email || !validateEmail(email) || cooldownRemaining > 0}
                  className="w-full py-3 bg-brand-primary hover:bg-brand-secondary text-white rounded-xl font-bold tracking-wider text-[12px] uppercase transition-all shadow-md active:scale-95 disabled:opacity-50 flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  {resetLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : cooldownRemaining > 0 ? (
                    <span>Resend in {cooldownRemaining}s</span>
                  ) : (
                    <span>Send Password Reset Link</span>
                  )}
                </button>

                <button 
                  type="button"
                  onClick={() => {
                    setMode('signin');
                    setError('');
                    setSuccess('');
                  }}
                  className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-xs font-bold uppercase tracking-wider transition-colors active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Return to Sign In</span>
                </button>
              </form>
            )}

            {/* ========================================================================= */}
            {/* VIEW 4: DEDICATED ENTERPRISE SSO DIRECTORY DISCOVERY */}
            {/* ========================================================================= */}
            {mode === 'sso' && (
              <div className="space-y-4 animate-in fade-in duration-200 text-left">
                <div className="space-y-1.5">
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Enter your organization's work email or domain to route to your company's Identity Provider (SAML 2.0 or Microsoft Entra ID).
                  </p>
                </div>

                <form onSubmit={handleDiscoverAndLaunchSso} className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 ml-1">Company Email or Domain</label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-3.5 flex items-center pointer-events-none text-slate-400">
                        <Globe className="w-4 h-4" />
                      </div>
                      <input 
                        type="text" 
                        required
                        autoFocus
                        value={ssoOrgInput}
                        onChange={(e) => setSsoOrgInput(e.target.value)}
                        placeholder="e.g. name@acme.com or acme.com"
                        className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 focus:border-brand-primary rounded-xl text-[13px] focus:outline-none focus:ring-2 focus:ring-brand-primary/20 transition-all"
                      />
                    </div>
                  </div>

                  <button 
                    type="submit"
                    disabled={discoveryLoading || !ssoOrgInput.trim()}
                    className="w-full py-3 bg-brand-primary hover:bg-brand-secondary text-white rounded-xl font-bold tracking-wider text-[12px] uppercase transition-all shadow-md active:scale-95 disabled:opacity-50 flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    {discoveryLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <span>Discover Organization SSO</span>}
                  </button>
                </form>

                {authDiscovery?.authMode === 'enterprise' && (
                  <div className="p-4 bg-brand-primary/5 border border-brand-primary/15 rounded-xl space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-brand-primary flex items-center gap-1.5">
                        <Building className="w-4 h-4" />
                        {authDiscovery.organizationName}
                      </span>
                      <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full border border-emerald-200">
                        {authDiscovery.ssoProtocol || 'SSO'} Enabled
                      </span>
                    </div>

                    <p className="text-xs text-slate-600">
                      Identity Provider: <span className="font-semibold">{authDiscovery.ssoProvider || 'Enterprise IdP'}</span>
                    </p>

                    <button
                      type="button"
                      disabled={ssoLoading !== null}
                      onClick={handleEnterpriseSsoAction}
                      className="w-full py-2.5 bg-brand-primary hover:bg-brand-secondary text-white rounded-xl font-bold tracking-wider text-xs uppercase transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm"
                    >
                      {ssoLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Key className="w-3.5 h-3.5 text-amber-300" />}
                      <span>Launch {authDiscovery.organizationName} SSO</span>
                    </button>
                  </div>
                )}

                <button 
                  type="button"
                  onClick={() => {
                    setMode('signin');
                    setError('');
                    setSuccess('');
                  }}
                  className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-xs font-bold uppercase tracking-wider transition-colors active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Return to Standard Sign In</span>
                </button>
              </div>
            )}
          </div>

          {/* Bottom Guest Access Section */}
          {mode !== 'forgot' && (
            <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-center sm:text-left">
              <div>
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Evaluating EchoNote?</p>
                <p className="text-[11px] text-slate-400 mt-0.5">Explore full features using a sandboxed guest credentials session.</p>
              </div>
              
              <button
                type="button"
                onClick={handleGuestLogin}
                className="px-4 py-2 border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl text-xs font-bold uppercase tracking-wider transition-colors active:scale-95 shrink-0 cursor-pointer"
              >
                Continue as Guest
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
};

export default AuthView;
