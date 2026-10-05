import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { useFirebase } from '../components/FirebaseProvider';
import { auth } from '../firebase';
import { previewOrgInvite, acceptOrgInvite, OrgInvitationPreview } from '../lib/apiClient';
import { 
  Building2, 
  CheckCircle2, 
  AlertCircle, 
  Clock, 
  XCircle, 
  Loader2, 
  ShieldCheck, 
  ArrowRight, 
  LogOut, 
  Mail, 
  UserPlus, 
  LogIn,
  AlertTriangle,
  RefreshCw
} from 'lucide-react';

export const OrgInviteAcceptPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const navigate = useNavigate();
  const { user, isAuthReady, refreshClaims } = useFirebase();

  // Preserved invitation token state (Phase 1B Step 6C/6D)
  const [preservedToken] = useState<string | null>(token ? token.trim() : null);
  const cleanToken = preservedToken;
  const [preview, setPreview] = useState<OrgInvitationPreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [acceptedDetails, setAcceptedDetails] = useState<{ orgName: string; role: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Fetch safe non-sensitive invitation preview metadata
  const fetchPreview = useCallback(async (inviteId: string) => {
    setLoadingPreview(true);
    setActionError(null);
    try {
      const data = await previewOrgInvite(inviteId);
      setPreview(data);
    } catch {
      setPreview({
        valid: false,
        status: 'unavailable',
        message: 'EchoNote could not connect to the invitation service. Please try again.'
      });
    } finally {
      setLoadingPreview(false);
    }
  }, []);

  useEffect(() => {
    if (!cleanToken) {
      setLoadingPreview(false);
      return;
    }
    fetchPreview(cleanToken);
  }, [cleanToken, fetchPreview]);

  // Handle redirect to authentication with token preservation in sessionStorage
  const handleAuthRedirect = (mode: 'signin' | 'signup') => {
    if (cleanToken) {
      try {
        sessionStorage.setItem('redirectAfterLogin', `/invite/accept?token=${encodeURIComponent(cleanToken)}`);
      } catch {
        // Safe fallback if sessionStorage is restricted
      }
    }
    navigate('/auth', { state: { mode } });
  };

  // Handle Sign Out to allow switching to the invited account
  const handleSignOut = async () => {
    try {
      if (auth) {
        await auth.signOut();
      }
      if (cleanToken) {
        sessionStorage.setItem('redirectAfterLogin', `/invite/accept?token=${encodeURIComponent(cleanToken)}`);
      }
      navigate('/auth');
    } catch (err: any) {
      console.error('Sign out error:', err);
      setActionError('Failed to sign out. Please try again.');
    }
  };

  // Authoritative Acceptance Submission
  const handleAcceptInvite = async () => {
    if (!cleanToken || accepting || accepted || !user) return;

    setAccepting(true);
    setActionError(null);

    try {
      // Step 6D: Submit authoritative invitation acceptance (only token identifier provided)
      const result = await acceptOrgInvite(cleanToken);

      // Step 6D & Section 8: Force refresh Firebase Auth ID token custom claims
      try {
        if (typeof refreshClaims === 'function') {
          await refreshClaims();
        } else if (auth.currentUser) {
          await auth.currentUser.getIdToken(true);
        }
      } catch (claimErr) {
        console.warn('⚠️ Custom claims token refresh note:', claimErr);
      }

      // Record success details and clean up session redirect
      setAccepted(true);
      setAcceptedDetails({
        orgName: preview?.organizationName || 'the organization',
        role: result.role || preview?.role || 'member'
      });

      try {
        sessionStorage.removeItem('redirectAfterLogin');
      } catch {
        // Ignore storage cleanup issues
      }
    } catch (err: any) {
      console.error('Accept invite error:', err);
      const msg = err.message || '';
      if (msg.includes('different email address') || msg.includes('Forbidden')) {
        setPreview(prev => prev ? { ...prev, status: 'invalid', message: 'This invitation was sent to a different email address.' } : null);
        setActionError('This invitation was sent to a different email address.');
      } else if (msg.includes('expired')) {
        setPreview(prev => prev ? { ...prev, status: 'expired' } : null);
      } else if (msg.includes('cancelled') || msg.includes('rejected')) {
        setPreview(prev => prev ? { ...prev, status: 'cancelled' } : null);
      } else if (msg.includes('already been accepted')) {
        setPreview(prev => prev ? { ...prev, status: 'accepted' } : null);
      } else {
        setActionError(msg || 'Failed to accept invitation. Please check your network and try again.');
      }
    } finally {
      setAccepting(false);
    }
  };

  // Final success navigation to standard application entry point
  const handleContinueToApp = () => {
    navigate('/app');
  };

  // Helper formatting for role
  const formatRole = (roleStr?: string) => {
    if (!roleStr) return 'Member';
    return roleStr
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  };

  // Helper formatting for expiration
  const formatExpiration = (expiresAtStr?: string) => {
    if (!expiresAtStr) return 'in 7 days';
    try {
      const d = new Date(expiresAtStr);
      return d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return expiresAtStr;
    }
  };

  // Compute Active State
  const hasToken = Boolean(cleanToken && cleanToken.length > 0);
  const normalizedUserEmail = (user?.email || '').toLowerCase().trim();
  const normalizedInvitedEmail = (preview?.recipientEmail || '').toLowerCase().trim();
  const isEmailMismatch = Boolean(
    user && 
    preview && 
    preview.recipientEmail && 
    normalizedUserEmail !== normalizedInvitedEmail
  );

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-between" data-testid="org-invite-accept-page">
      {/* Top Navigation */}
      <header className="px-6 py-4 bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3 group w-fit focus:outline-none focus:ring-2 focus:ring-[#1A234E] rounded-lg">
            <img 
              src="/Logo-2.png" 
              alt="EchoNote" 
              className="h-9 w-auto object-contain"
            />
            <span className="text-xl font-black text-[#1A234E] tracking-tight">
              EchoNote
            </span>
          </Link>
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>Secure Enterprise Onboarding</span>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl border border-slate-200 p-8 sm:p-10 text-center">
          
          {/* STATE B: Missing Token */}
          {!hasToken && (
            <div className="space-y-6" data-testid="state-missing-token" id="token-missing-state">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-amber-50 border border-amber-200 text-amber-600 mb-2">
                <AlertCircle className="w-7 h-7" />
              </div>
              <h1 className="text-2xl font-black text-slate-900 tracking-tight">
                Invalid invitation
              </h1>
              <div className="p-4 bg-amber-50/70 rounded-xl border border-amber-200 text-sm text-amber-900 leading-relaxed text-left">
                <div className="font-semibold mb-1">Invalid or Missing Invitation Link</div>
                This invitation link is missing its invitation code. Please check your invitation email and click the complete link provided, or contact your organization administrator.
              </div>
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => navigate('/')}
                  className="w-full py-3.5 px-4 rounded-xl bg-[#1A234E] hover:bg-[#253270] text-white font-bold text-sm shadow-md transition-colors flex items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#1A234E]"
                >
                  Return to EchoNote
                </button>
              </div>
            </div>
          )}

          {/* STATE A: Loading Preview */}
          {hasToken && (loadingPreview || !isAuthReady) && (
            <div className="space-y-6 py-6" data-testid="state-loading" id="token-present-state" aria-live="polite">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-indigo-50 border border-indigo-100 text-indigo-600 mb-2">
                <Loader2 className="w-7 h-7 animate-spin text-indigo-600" />
              </div>
              <h1 className="text-2xl font-black text-slate-900 tracking-tight">
                Preparing Invitation
              </h1>
              <p className="text-sm text-slate-500 leading-relaxed max-w-sm mx-auto">
                Preparing your invitation... Resolving your workspace security verification. You're invited to join an organization.
              </p>
            </div>
          )}

          {/* STATE J: Successful Acceptance */}
          {hasToken && !loadingPreview && accepted && (
            <div className="space-y-6 py-2" data-testid="state-success">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-600 mb-2">
                <CheckCircle2 className="w-9 h-9" />
              </div>
              <div>
                <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight mb-2">
                  You're in.
                </h1>
                <p className="text-base font-medium text-slate-600">
                  You've joined <strong className="text-slate-900">{acceptedDetails?.orgName}</strong> as <span className="font-semibold text-indigo-600">{formatRole(acceptedDetails?.role)}</span>.
                </p>
              </div>
              <div className="p-4 bg-emerald-50/70 rounded-xl border border-emerald-200 text-xs text-emerald-800 text-left">
                Your organization workspace and role permissions have been synchronized. You can now access organization projects, team members, and enterprise tools.
              </div>
              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleContinueToApp}
                  className="w-full py-4 px-6 rounded-xl bg-[#1A234E] hover:bg-[#253270] text-white font-black text-sm uppercase tracking-wider shadow-lg shadow-indigo-900/10 transition-all flex items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#1A234E]"
                >
                  <span>Continue to EchoNote</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* STATE F: Expired */}
          {hasToken && !loadingPreview && !accepted && preview?.status === 'expired' && (
            <div className="space-y-6" data-testid="state-expired">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-slate-100 border border-slate-200 text-slate-500 mb-2">
                <Clock className="w-7 h-7" />
              </div>
              <h1 className="text-2xl font-black text-slate-900 tracking-tight">
                This invitation has expired.
              </h1>
              <p className="text-sm text-slate-600 leading-relaxed text-left bg-slate-50 p-4 rounded-xl border border-slate-200">
                Organization invitations are valid for 7 days. This invitation code is no longer active. Please reach out to your organization administrator to request a new invitation.
              </p>
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => navigate('/')}
                  className="w-full py-3.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-[#1A234E]"
                >
                  Return to Home
                </button>
              </div>
            </div>
          )}

          {/* STATE G: Cancelled */}
          {hasToken && !loadingPreview && !accepted && preview?.status === 'cancelled' && (
            <div className="space-y-6" data-testid="state-cancelled">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-rose-50 border border-rose-200 text-rose-600 mb-2">
                <XCircle className="w-7 h-7" />
              </div>
              <h1 className="text-2xl font-black text-slate-900 tracking-tight">
                This invitation has been cancelled.
              </h1>
              <p className="text-sm text-rose-900/80 leading-relaxed text-left bg-rose-50/60 p-4 rounded-xl border border-rose-200">
                The administrator who issued this invitation has revoked or cancelled it. If you believe this is an error, please contact your organization administrator.
              </p>
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => navigate('/')}
                  className="w-full py-3.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-[#1A234E]"
                >
                  Return to Home
                </button>
              </div>
            </div>
          )}

          {/* STATE H: Already Accepted */}
          {hasToken && !loadingPreview && !accepted && preview?.status === 'accepted' && (
            <div className="space-y-6" data-testid="state-already-accepted">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-indigo-50 border border-indigo-200 text-indigo-600 mb-2">
                <CheckCircle2 className="w-7 h-7" />
              </div>
              <h1 className="text-2xl font-black text-slate-900 tracking-tight">
                This invitation has already been accepted.
              </h1>
              <p className="text-sm text-slate-600 leading-relaxed text-left bg-slate-50 p-4 rounded-xl border border-slate-200">
                This invitation link was already used to join the organization workspace. You can proceed directly to your EchoNote dashboard.
              </p>
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => navigate('/app')}
                  className="w-full py-3.5 px-4 rounded-xl bg-[#1A234E] hover:bg-[#253270] text-white font-bold text-sm shadow-md transition-colors flex items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#1A234E]"
                >
                  <span>Go to EchoNote Dashboard</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* STATE: Service Unavailable / Connection / Non-JSON Error */}
          {hasToken && !loadingPreview && !accepted && preview && !preview.valid && preview.status === 'unavailable' && (
            <div className="space-y-6" data-testid="state-unavailable">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-amber-50 border border-amber-200 text-amber-600 mb-2">
                <AlertTriangle className="w-7 h-7" />
              </div>
              <h1 className="text-2xl font-black text-slate-900 tracking-tight">
                Unable to load invitation
              </h1>
              <p className="text-sm text-slate-600 leading-relaxed text-left bg-slate-50 p-4 rounded-xl border border-slate-200">
                {preview.message || 'EchoNote could not connect to the invitation service. Please try again.'}
              </p>
              <div className="space-y-3 pt-2">
                <button
                  type="button"
                  onClick={() => cleanToken && fetchPreview(cleanToken)}
                  className="w-full py-3.5 px-4 rounded-xl bg-[#1A234E] hover:bg-[#253270] text-white font-bold text-sm shadow-md transition-colors flex items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#1A234E]"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span>Try Again</span>
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/')}
                  className="w-full py-3.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-[#1A234E]"
                >
                  Return to Home
                </button>
              </div>
            </div>
          )}

          {/* Invalid or Not Found Token */}
          {hasToken && !loadingPreview && !accepted && preview && !preview.valid && !['expired', 'cancelled', 'accepted', 'unavailable'].includes(preview.status) && (
            <div className="space-y-6" data-testid="state-invalid">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-rose-50 border border-rose-200 text-rose-600 mb-2">
                <AlertTriangle className="w-7 h-7" />
              </div>
              <h1 className="text-2xl font-black text-slate-900 tracking-tight">
                Invalid invitation
              </h1>
              <p className="text-sm text-rose-900/80 leading-relaxed text-left bg-rose-50/60 p-4 rounded-xl border border-rose-200">
                {preview.message || 'This invitation could not be found or has expired. Please request a new invitation.'}
              </p>
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => navigate('/')}
                  className="w-full py-3.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-[#1A234E]"
                >
                  Return to Home
                </button>
              </div>
            </div>
          )}

          {/* STATE C: Valid token, Unauthenticated User */}
          {hasToken && !loadingPreview && !accepted && (!preview || preview.valid) && !user && (
            <div className="space-y-6" data-testid="state-unauthenticated">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-indigo-50 border border-indigo-100 text-indigo-600 mb-2">
                <Building2 className="w-7 h-7" />
              </div>
              <div>
                <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight mb-2">
                  You've been invited to EchoNote
                </h1>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Please sign in or create an account before accepting this organization invitation.
                </p>
              </div>

              {preview?.organizationName && (
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-left text-xs space-y-1.5">
                  <div className="font-semibold text-slate-500 uppercase tracking-wider">Invitation Details</div>
                  <div className="text-sm font-bold text-slate-900">{preview.organizationName}</div>
                  {preview.role && (
                    <div className="text-slate-600">Assigned Role: <span className="font-semibold text-indigo-600">{formatRole(preview.role)}</span></div>
                  )}
                </div>
              )}

              <div className="space-y-3 pt-2">
                <button
                  type="button"
                  onClick={() => handleAuthRedirect('signin')}
                  className="w-full py-3.5 px-4 rounded-xl bg-[#1A234E] hover:bg-[#253270] text-white font-bold text-sm shadow-md transition-colors flex items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#1A234E]"
                >
                  <LogIn className="w-4 h-4" />
                  <span>Sign In</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleAuthRedirect('signup')}
                  className="w-full py-3.5 px-4 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 text-slate-800 font-bold text-sm transition-colors flex items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-[#1A234E]"
                >
                  <UserPlus className="w-4 h-4 text-slate-500" />
                  <span>Create Account</span>
                </button>
              </div>

              <div className="text-xs text-slate-400">
                Your invitation will be ready to accept as soon as you sign in.
              </div>
            </div>
          )}

          {/* STATE E: Authenticated, WRONG EMAIL */}
          {hasToken && !loadingPreview && !accepted && preview?.valid && user && isEmailMismatch && (
            <div className="space-y-6" data-testid="state-wrong-email">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-amber-50 border border-amber-200 text-amber-600 mb-2">
                <AlertCircle className="w-7 h-7" />
              </div>
              <div>
                <h1 className="text-2xl font-black text-slate-900 tracking-tight mb-2">
                  This invitation was sent to a different email address.
                </h1>
                <p className="text-sm text-slate-600 leading-relaxed">
                  You are currently signed in with an email that does not match this invitation.
                </p>
              </div>

              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-left space-y-2 text-xs">
                <div className="flex items-center justify-between text-slate-500">
                  <span>Currently signed in as:</span>
                  <span className="font-bold text-slate-900">{user.email}</span>
                </div>
                {preview.recipientEmail && (
                  <div className="flex items-center justify-between text-slate-500 pt-2 border-t border-slate-200">
                    <span>Invited recipient:</span>
                    <span className="font-bold text-indigo-700">{preview.recipientEmail}</span>
                  </div>
                )}
              </div>

              <div className="space-y-3 pt-2">
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="w-full py-3.5 px-4 rounded-xl bg-[#1A234E] hover:bg-[#253270] text-white font-bold text-sm shadow-md transition-colors flex items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#1A234E]"
                >
                  <LogIn className="w-4 h-4" />
                  <span>Sign in with {preview.recipientEmail || 'the invited email'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleSignOut}
                  className="w-full py-3 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition-colors flex items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-slate-300"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Sign out</span>
                </button>
              </div>
            </div>
          )}

          {/* STATE D & I: Authenticated, Correct Email, Ready for Acceptance */}
          {hasToken && !loadingPreview && !accepted && preview?.valid && user && !isEmailMismatch && (
            <div className="space-y-6" data-testid="state-authenticated-ready">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-indigo-50 border border-indigo-100 text-indigo-600 mb-2">
                <Building2 className="w-7 h-7" />
              </div>

              <div>
                <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight mb-2">
                  You've been invited to join {preview.organizationName || 'an organization'}
                </h1>
                <p className="text-sm text-slate-500 leading-relaxed">
                  Review the invitation details below and confirm acceptance into your organization workspace.
                </p>
              </div>

              {actionError && (
                <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 text-left flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <span>{actionError}</span>
                </div>
              )}

              {/* Invitation Information Card */}
              <div className="p-5 bg-slate-50 rounded-xl border border-slate-200 text-left space-y-3">
                <table className="w-full text-sm text-slate-600">
                  <tbody>
                    <tr className="border-b border-slate-200/60">
                      <td className="py-2 text-slate-500 font-medium w-36">Organization:</td>
                      <td className="py-2 font-bold text-slate-900">{preview.organizationName || 'EchoNote Enterprise'}</td>
                    </tr>
                    <tr className="border-b border-slate-200/60">
                      <td className="py-2 text-slate-500 font-medium">Invited by:</td>
                      <td className="py-2 font-medium text-slate-800">{preview.invitedBy || 'Organization Administrator'}</td>
                    </tr>
                    <tr className="border-b border-slate-200/60">
                      <td className="py-2 text-slate-500 font-medium">Assigned Role:</td>
                      <td className="py-2 font-bold text-indigo-700 capitalize">{formatRole(preview.role)}</td>
                    </tr>
                    <tr className="border-b border-slate-200/60">
                      <td className="py-2 text-slate-500 font-medium">Recipient:</td>
                      <td className="py-2 font-medium text-slate-800">{user.email}</td>
                    </tr>
                    <tr>
                      <td className="py-2 text-slate-500 font-medium">Expiration:</td>
                      <td className="py-2 text-slate-700 font-medium">{formatExpiration(preview.expiresAt)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* STATE I & Primary CTA: Accept Invitation */}
              <div className="space-y-3 pt-2">
                <button
                  type="button"
                  disabled={accepting}
                  onClick={handleAcceptInvite}
                  data-testid="accept-invitation-button"
                  className="w-full py-4 px-6 rounded-xl bg-[#1A234E] hover:bg-[#253270] disabled:bg-slate-400 text-white font-black text-sm uppercase tracking-wider shadow-lg shadow-indigo-900/10 transition-all flex items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#1A234E] disabled:cursor-not-allowed"
                >
                  {accepting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Joining organization...</span>
                    </>
                  ) : (
                    <>
                      <span>Accept Invitation</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>

                <p className="text-[11px] text-slate-400">
                  By accepting, you will join this organization workspace under the assigned role.
                </p>
              </div>
            </div>
          )}

        </div>
      </main>

      {/* Footer */}
      <footer className="py-6 px-6 text-center text-xs text-slate-400 border-t border-slate-200 bg-white">
        © {new Date().getFullYear()} EchoNote Technologies. All rights reserved.
      </footer>
    </div>
  );
};

export default OrgInviteAcceptPage;
