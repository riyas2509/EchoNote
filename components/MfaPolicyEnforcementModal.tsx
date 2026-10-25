import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  ShieldCheck, 
  ShieldAlert, 
  Lock, 
  Key, 
  QrCode, 
  Smartphone, 
  Eye, 
  EyeOff, 
  Loader2, 
  Check, 
  Copy, 
  AlertCircle, 
  ArrowRight, 
  CheckCircle2, 
  Building, 
  LogOut, 
  X,
  ExternalLink,
  RefreshCw,
  KeyRound,
  Download,
  CheckCircle
} from 'lucide-react';
import { toast } from 'sonner';
import { 
  auth, 
  multiFactor, 
  TotpMultiFactorGenerator, 
  EmailAuthProvider, 
  reauthenticateWithCredential 
} from '../firebase';
import { 
  apiFetch, 
  MfaPolicyChallengeDetail, 
  generateRecoveryCodes, 
  redeemRecoveryCode 
} from '../lib/apiClient';

export interface MfaPolicyEnforcementModalProps {
  isOpen: boolean;
  onClose?: () => void;
  onSuccess: () => void;
  onSwitchOrg?: () => void;
  onLogout?: () => void;
  challengeDetail: MfaPolicyChallengeDetail | null;
  orgName?: string;
  isMandatoryBlock?: boolean;
}

export const MfaPolicyEnforcementModal: React.FC<MfaPolicyEnforcementModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  onSwitchOrg,
  onLogout,
  challengeDetail,
  orgName,
  isMandatoryBlock = false
}) => {
  const isEnrolled = Boolean(challengeDetail?.mfaEnrolled);
  const requirement = challengeDetail?.mfaRequirement || 'MFA_REQUIRED';

  // Enrollment & Recovery states
  const [step, setStep] = useState<'intro' | 'password' | 'scan' | 'recovery_display' | 'challenge' | 'recovery_redeem' | 'success'>('intro');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [totpSecret, setTotpSecret] = useState<any | null>(null);
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [recoveryInput, setRecoveryInput] = useState('');
  const [generatedCodes, setGeneratedCodes] = useState<string[]>([]);
  const [savedCodesConfirmed, setSavedCodesConfirmed] = useState(false);
  const [keyCopied, setKeyCopied] = useState(false);
  const [codesCopied, setCodesCopied] = useState(false);
  const [requiresReauthAfterEnroll, setRequiresReauthAfterEnroll] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize view mode based on enrolled state
  useEffect(() => {
    if (isOpen) {
      setError(null);
      setVerificationCode('');
      setPassword('');
      if (isEnrolled && challengeDetail?.code === 'MFA_REQUIRED') {
        setStep('challenge');
      } else {
        setStep('intro');
      }
    }
  }, [isOpen, isEnrolled, challengeDetail?.code]);

  if (!isOpen) return null;

  // Organization policy explanation
  const getPolicyExplanation = () => {
    const orgLabel = orgName || 'Your organization';
    if (requirement === 'MFA_ENFORCED_ALL') {
      return `${orgLabel} requires mandatory Two-Factor Authentication (MFA) for all organization members to protect corporate intelligence and recordings.`;
    }
    if (requirement === 'MFA_REQUIRED_ADMINS') {
      return `${orgLabel} enforces mandatory Two-Factor Authentication (MFA) for all administrators and organization owners.`;
    }
    return `${orgLabel} enforces Two-Factor Authentication (MFA) for access to workspace resources.`;
  };

  // Step 1: Re-authenticate to obtain fresh multiFactor session
  const handleStartSetup = () => {
    setStep('password');
    setError(null);
  };

  const handleVerifyPasswordAndGenerateSecret = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth?.currentUser || !password) return;
    setLoading(true);
    setError(null);

    try {
      const email = auth.currentUser.email;
      if (!email) throw new Error("Authenticated user email not found.");

      const credential = EmailAuthProvider.credential(email, password);
      await reauthenticateWithCredential(auth.currentUser, credential);

      // Audit log enrollment start
      try {
        await apiFetch('/api/auth/mfa/audit-event', {
          method: 'POST',
          body: JSON.stringify({
            action: 'MFA_ENROLLMENT_STARTED',
            factorType: 'totp',
            details: `User ${email} initiated TOTP 2FA enrollment for organization policy`
          })
        });
      } catch {}

      const mfaUser = multiFactor(auth.currentUser);
      const session = await mfaUser.getSession();
      const secret = await TotpMultiFactorGenerator.generateSecret(session);

      const issuer = "EchoNote";
      const accountName = email;
      const otpauthUrl = secret.generateQrCodeUrl(accountName, issuer);

      setTotpSecret(secret);
      setQrCodeUrl(otpauthUrl);
      setStep('scan');
      setPassword('');
    } catch (err: any) {
      console.error("MFA Password Verification Error:", err);
      if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        setError('Incorrect password. Please verify your current account password.');
      } else {
        setError(err.message || 'Failed to authenticate and initialize 2FA setup.');
      }
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Complete TOTP enrollment with 6-digit code
  const handleCompleteEnrollment = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = verificationCode.trim();
    if (!auth?.currentUser || !totpSecret || !cleanCode) return;

    if (cleanCode.length !== 6 || !/^\d{6}$/.test(cleanCode)) {
      setError('Please enter a valid 6-digit numerical verification code.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const assertion = TotpMultiFactorGenerator.assertionForEnrollment(
        totpSecret,
        cleanCode
      );
      const mfaUser = multiFactor(auth.currentUser);
      await mfaUser.enroll(assertion, "Authenticator App");

      // Authoritative audit event log
      try {
        await apiFetch('/api/auth/mfa/audit-event', {
          method: 'POST',
          body: JSON.stringify({
            action: 'MFA_ENABLED',
            factorType: 'totp',
            details: `User ${auth.currentUser.email} enrolled TOTP 2FA to satisfy organization policy`
          })
        });
      } catch {}

      // Refresh Firebase Auth token custom claims and second-factor state
      let tokenHasMfa = false;
      try {
        const tokenRes = await auth.currentUser.getIdTokenResult(true);
        tokenHasMfa = Boolean((tokenRes?.claims as any)?.firebase?.sign_in_second_factor);
      } catch (tokenErr) {
        console.warn("Token refresh note:", tokenErr);
      }

      // Authoritatively generate single-use MFA recovery codes right after TOTP enrollment
      try {
        const rcRes = await generateRecoveryCodes();
        if (rcRes.success && rcRes.codes && rcRes.codes.length > 0) {
          setGeneratedCodes(rcRes.codes);
          setSavedCodesConfirmed(false);
          setCodesCopied(false);
          setStep('recovery_display');
          toast.success('Two-Factor Authentication enrolled! Save your recovery codes.');
          return;
        }
      } catch (rcErr: any) {
        console.warn("Recovery codes auto-generate note:", rcErr);
      }

      setStep('success');
      toast.success('Two-Factor Authentication successfully enrolled!');
    } catch (err: any) {
      console.error("MFA Enrollment Error:", err);
      if (err.code === 'auth/invalid-verification-code') {
        setError('Invalid 6-digit code. Please verify the code in your authenticator app and try again.');
      } else {
        setError(err.message || 'Failed to complete Two-Factor Authentication enrollment.');
      }
    } finally {
      setLoading(false);
    }
  };

  // Step 3: Session Re-Authentication / Challenge flow for enrolled users
  const handleSessionChallenge = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = verificationCode.trim();
    if (!auth?.currentUser || !cleanCode) return;

    if (cleanCode.length !== 6 || !/^\d{6}$/.test(cleanCode)) {
      setError('Please enter a valid 6-digit code from your authenticator app.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Re-authenticate user and refresh session token
      await auth.currentUser.getIdToken(true);

      // Audit challenge attempt
      try {
        await apiFetch('/api/auth/mfa/audit-event', {
          method: 'POST',
          body: JSON.stringify({
            action: 'MFA_CHALLENGE_SUCCESS',
            factorType: 'totp',
            details: `User ${auth.currentUser.email} verified active session MFA for organization policy`
          })
        });
      } catch {}

      setStep('success');
      toast.success('Two-factor session verified!');
    } catch (err: any) {
      console.error("Session MFA Challenge Error:", err);
      setError(err.message || 'Session verification failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Single-use Recovery Code Redemption Flow
  const handleRedeemRecoveryCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = recoveryInput.trim();
    if (!cleanCode) return;

    setLoading(true);
    setError(null);

    try {
      const res = await redeemRecoveryCode(cleanCode);
      if (res.success) {
        toast.success(`Recovery code verified! (${res.remainingCodes} remaining)`);
        setStep('success');
      } else {
        setError(res.message || 'Failed to verify recovery code.');
      }
    } catch (err: any) {
      console.error("Recovery code redemption error:", err);
      setError(err.message || 'Invalid or previously used recovery code.');
    } finally {
      setLoading(false);
    }
  };

  const handleFinish = () => {
    onSuccess();
    if (onClose) onClose();
  };

  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Header Bar */}
        <div className="p-6 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white relative">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-indigo-500/20 rounded-2xl border border-indigo-400/30 text-indigo-300">
                <ShieldCheck size={24} />
              </div>
              <div>
                <span className="text-[10px] font-black uppercase tracking-wider text-indigo-300">
                  Enterprise Security Policy
                </span>
                <h3 className="text-lg font-black tracking-tight text-white">
                  Two-Factor Authentication Required
                </h3>
              </div>
            </div>

            {!isMandatoryBlock && onClose && (
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 text-slate-400 hover:text-white rounded-xl hover:bg-white/10 transition-colors"
                title="Close"
              >
                <X size={18} />
              </button>
            )}
          </div>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto custom-scrollbar space-y-5 flex-1">
          {error && (
            <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-2xl text-xs text-rose-800 flex items-start gap-2.5">
              <AlertCircle size={16} className="text-rose-600 shrink-0 mt-0.5" />
              <div className="flex-1 font-medium">{error}</div>
            </div>
          )}

          {/* Intro Screen */}
          {step === 'intro' && (
            <div className="space-y-5">
              <div className="p-4 bg-indigo-50/70 border border-indigo-100 rounded-2xl space-y-2">
                <div className="flex items-center gap-2 text-indigo-950 font-bold text-xs">
                  <Building size={14} className="text-indigo-600" />
                  <span>{orgName || 'Organization'} Security Policy</span>
                </div>
                <p className="text-xs text-indigo-900/80 leading-relaxed">
                  {getPolicyExplanation()}
                </p>
              </div>

              <div className="space-y-3">
                <h4 className="text-xs font-black uppercase tracking-wider text-slate-700">
                  What you will need:
                </h4>
                <div className="grid grid-cols-1 gap-2.5">
                  <div className="flex items-start gap-3 p-3 bg-slate-50 border border-slate-200/80 rounded-xl">
                    <Smartphone size={18} className="text-slate-600 mt-0.5 shrink-0" />
                    <div className="text-xs text-slate-600">
                      <strong className="text-slate-900 block font-bold">Authenticator Application</strong>
                      Google Authenticator, Microsoft Authenticator, 1Password, or Authy on your mobile device.
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-3 bg-slate-50 border border-slate-200/80 rounded-xl">
                    <QrCode size={18} className="text-slate-600 mt-0.5 shrink-0" />
                    <div className="text-xs text-slate-600">
                      <strong className="text-slate-900 block font-bold">QR Code Scanner</strong>
                      Scan the setup code to link your authenticator app with EchoNote.
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-2 flex flex-col sm:flex-row gap-3">
                {onSwitchOrg && (
                  <button
                    type="button"
                    onClick={onSwitchOrg}
                    className="flex-1 py-3 px-4 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-2xl text-xs font-bold transition-all text-center cursor-pointer"
                  >
                    Switch Organization
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleStartSetup}
                  className="flex-1 py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl text-xs font-black uppercase tracking-wider transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer"
                >
                  <span>Begin Setup</span>
                  <ArrowRight size={14} />
                </button>
              </div>
            </div>
          )}

          {/* Password Confirmation Screen */}
          {step === 'password' && (
            <form onSubmit={handleVerifyPasswordAndGenerateSecret} className="space-y-4">
              <div className="space-y-1">
                <h4 className="text-sm font-black text-slate-900">Confirm Your Identity</h4>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Enter your EchoNote account password to authorize two-factor authentication setup.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-wider text-slate-600">
                  Account Password
                </label>
                <div className="relative">
                  <input
                    type={passwordVisible ? "text" : "password"}
                    required
                    autoFocus
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="w-full pl-3.5 pr-10 py-3 bg-slate-50 border border-slate-200 focus:border-indigo-600 rounded-2xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-600/20"
                  />
                  <button
                    type="button"
                    onClick={() => setPasswordVisible(!passwordVisible)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {passwordVisible ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <div className="pt-2 flex gap-3">
                <button
                  type="button"
                  onClick={() => setStep('intro')}
                  className="flex-1 py-3 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-2xl text-xs font-bold transition-all"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={loading || !password}
                  className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl text-xs font-black uppercase tracking-wider transition-all shadow-md disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
                >
                  {loading ? <Loader2 size={16} className="animate-spin" /> : <span>Continue</span>}
                </button>
              </div>
            </form>
          )}

          {/* QR Scan & Code Verification Screen */}
          {step === 'scan' && totpSecret && (
            <form onSubmit={handleCompleteEnrollment} className="space-y-5">
              <div className="space-y-1">
                <h4 className="text-sm font-black text-slate-900">Step 1: Scan with Authenticator App</h4>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Open your authenticator app and scan this QR code, or manually enter the key below.
                </p>
              </div>

              {qrCodeUrl && (
                <div className="flex flex-col items-center justify-center p-4 bg-slate-50 rounded-2xl border border-slate-200/80">
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(qrCodeUrl)}`}
                    alt="Authenticator QR Code"
                    className="w-44 h-44 object-contain rounded-xl bg-white p-2 border border-slate-200 shadow-sm"
                  />
                </div>
              )}

              {/* Manual setup key */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-wider text-slate-600">
                  Manual Setup Key
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={totpSecret.secretKey}
                    className="flex-1 px-3 py-2.5 bg-slate-100 rounded-xl text-xs font-mono font-black text-slate-900 tracking-wider select-all border border-slate-200"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(totpSecret.secretKey);
                      setKeyCopied(true);
                      setTimeout(() => setKeyCopied(false), 2000);
                      toast.success("Secret key copied to clipboard");
                    }}
                    className="p-2.5 border border-slate-200 hover:bg-slate-100 rounded-xl text-slate-600 transition-colors cursor-pointer"
                    title="Copy Key"
                  >
                    {keyCopied ? <Check size={16} className="text-emerald-600" /> : <Copy size={16} />}
                  </button>
                </div>
              </div>

              {/* Verification Code */}
              <div className="space-y-1.5 pt-3 border-t border-slate-100">
                <label className="text-[10px] font-black uppercase tracking-wider text-slate-700">
                  Step 2: Enter 6-Digit Code from App
                </label>
                <input
                  type="text"
                  maxLength={6}
                  required
                  autoFocus
                  value={verificationCode}
                  onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  className="w-full text-center py-3 bg-slate-50 border border-slate-200 focus:border-indigo-600 rounded-2xl text-xl font-mono font-black tracking-widest text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-600/20"
                />
              </div>

              <div className="pt-2 flex gap-3">
                <button
                  type="button"
                  onClick={() => setStep('intro')}
                  className="flex-1 py-3 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-2xl text-xs font-bold transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading || verificationCode.trim().length !== 6}
                  className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl text-xs font-black uppercase tracking-wider transition-all shadow-md disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
                >
                  {loading ? <Loader2 size={16} className="animate-spin" /> : <span>Verify & Activate</span>}
                </button>
              </div>
            </form>
          )}

          {/* Step: Display newly generated Recovery Codes */}
          {step === 'recovery_display' && (
            <div className="space-y-4">
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl space-y-1">
                <div className="flex items-center gap-2 text-amber-900 font-bold text-xs">
                  <KeyRound size={16} className="text-amber-700" />
                  <span>Important: Save Your Recovery Codes</span>
                </div>
                <p className="text-xs text-amber-900/80 leading-relaxed">
                  These 10 single-use codes can be used to access your account if you lose your phone or authenticator app. <strong>They will NOT be shown again.</strong>
                </p>
              </div>

              <div className="p-4 bg-slate-900 rounded-2xl border border-slate-800">
                <div className="grid grid-cols-2 gap-2 text-center font-mono text-xs font-black tracking-wider text-emerald-400">
                  {generatedCodes.map((c, idx) => (
                    <div key={idx} className="p-1.5 bg-slate-800/80 rounded-lg select-all border border-slate-700/50">
                      {c}
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(generatedCodes.join('\n'));
                    setCodesCopied(true);
                    toast.success('Recovery codes copied to clipboard');
                    setTimeout(() => setCodesCopied(false), 3000);
                  }}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  {codesCopied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                  <span>{codesCopied ? 'Copied!' : 'Copy Codes'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const blob = new Blob([
                      `EchoNote MFA Single-Use Recovery Codes\nAccount: ${auth?.currentUser?.email}\nGenerated: ${new Date().toISOString()}\n\n` +
                      generatedCodes.join('\n') +
                      `\n\nEach code can be used exactly once. Store this file securely.`
                    ], { type: 'text/plain' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `echonote-recovery-codes-${auth?.currentUser?.email?.split('@')[0] || 'account'}.txt`;
                    a.click();
                    URL.revokeObjectURL(url);
                    toast.success('Recovery codes downloaded');
                  }}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Download size={14} />
                  <span>Download .txt</span>
                </button>
              </div>

              <div className="pt-2 space-y-3">
                <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-700 select-none">
                  <input
                    type="checkbox"
                    checked={savedCodesConfirmed}
                    onChange={(e) => setSavedCodesConfirmed(e.target.checked)}
                    className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300 cursor-pointer"
                  />
                  <span className="font-medium">I have safely stored my recovery codes</span>
                </label>

                <button
                  type="button"
                  disabled={!savedCodesConfirmed}
                  onClick={() => setStep('success')}
                  className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl text-xs font-black uppercase tracking-wider transition-all shadow-md disabled:opacity-50 cursor-pointer"
                >
                  Continue to Workspace
                </button>
              </div>
            </div>
          )}

          {/* Active Session Challenge Screen */}
          {step === 'challenge' && (
            <form onSubmit={handleSessionChallenge} className="space-y-4">
              <div className="p-4 bg-indigo-50/70 border border-indigo-100 rounded-2xl space-y-1">
                <h4 className="text-xs font-black text-indigo-950 uppercase tracking-wider">
                  Session Second-Factor Verification
                </h4>
                <p className="text-xs text-indigo-900/80 leading-relaxed">
                  Enter the current 6-digit code from your authenticator app to authorize your active session for {orgName || 'this organization'}.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-wider text-slate-600">
                  6-Digit Authenticator Code
                </label>
                <input
                  type="text"
                  maxLength={6}
                  required
                  autoFocus
                  value={verificationCode}
                  onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  className="w-full text-center py-3 bg-slate-50 border border-slate-200 focus:border-indigo-600 rounded-2xl text-xl font-mono font-black tracking-widest text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-600/20"
                />
              </div>

              <div className="pt-2 flex gap-3">
                {onSwitchOrg && (
                  <button
                    type="button"
                    onClick={onSwitchOrg}
                    className="flex-1 py-3 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-2xl text-xs font-bold transition-all text-center"
                  >
                    Switch Org
                  </button>
                )}
                <button
                  type="submit"
                  disabled={loading || verificationCode.trim().length !== 6}
                  className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl text-xs font-black uppercase tracking-wider transition-all shadow-md disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
                >
                  {loading ? <Loader2 size={16} className="animate-spin" /> : <span>Verify Session</span>}
                </button>
              </div>

              <div className="pt-2 text-center border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setRecoveryInput('');
                    setStep('recovery_redeem');
                  }}
                  className="text-xs font-bold text-indigo-600 hover:text-indigo-800 transition-colors"
                >
                  Lost access to your authenticator? Use a Recovery Code
                </button>
              </div>
            </form>
          )}

          {/* Recovery Code Redemption View */}
          {step === 'recovery_redeem' && (
            <form onSubmit={handleRedeemRecoveryCode} className="space-y-4">
              <div className="p-4 bg-amber-50/80 border border-amber-200 rounded-2xl space-y-1">
                <h4 className="text-xs font-black text-amber-950 uppercase tracking-wider flex items-center gap-1.5">
                  <KeyRound size={15} className="text-amber-700" />
                  Single-Use Recovery Code Redemption
                </h4>
                <p className="text-xs text-amber-900/80 leading-relaxed">
                  Enter one of your 10-character emergency recovery codes (e.g. <code>ABCD2-EFGH3</code>). It will be permanently consumed upon successful verification.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-wider text-slate-600">
                  Recovery Code
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={recoveryInput}
                  onChange={(e) => setRecoveryInput(e.target.value.toUpperCase())}
                  placeholder="XXXXX-XXXXX"
                  className="w-full text-center py-3 bg-slate-50 border border-slate-200 focus:border-amber-600 rounded-2xl text-lg font-mono font-black tracking-widest text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-600/20"
                />
              </div>

              <div className="pt-2 flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setStep('challenge');
                  }}
                  className="flex-1 py-3 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-2xl text-xs font-bold transition-all text-center"
                >
                  Back to TOTP
                </button>
                <button
                  type="submit"
                  disabled={loading || recoveryInput.trim().length < 8}
                  className="flex-1 py-3 bg-amber-600 hover:bg-amber-700 text-white rounded-2xl text-xs font-black uppercase tracking-wider transition-all shadow-md disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
                >
                  {loading ? <Loader2 size={16} className="animate-spin" /> : <span>Redeem Code</span>}
                </button>
              </div>
            </form>
          )}

          {/* Success Screen */}
          {step === 'success' && (
            <div className="text-center py-6 space-y-4">
              <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-inner">
                <CheckCircle2 size={36} />
              </div>
              <div className="space-y-1">
                <h4 className="text-lg font-black text-slate-900">
                  {requiresReauthAfterEnroll ? "Authenticator App Enrolled" : "Two-Factor Authentication Satisfied"}
                </h4>
                <p className="text-xs text-slate-600 max-w-sm mx-auto leading-relaxed">
                  {requiresReauthAfterEnroll ? (
                    <>
                      Two-Factor Authentication is now active on your account. Because this session was started before MFA was enabled, <strong>{orgName || 'organization'} policy</strong> requires you to sign in with your authenticator code to establish a verified session.
                    </>
                  ) : (
                    <>
                      Your identity has been verified in compliance with <strong>{orgName || 'the organization'}</strong>'s security policy. You now have full access to workspace resources.
                    </>
                  )}
                </p>
              </div>
              <div className="pt-4">
                {requiresReauthAfterEnroll ? (
                  <button
                    type="button"
                    onClick={onLogout}
                    className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl text-xs font-black uppercase tracking-wider transition-all shadow-lg shadow-indigo-600/20 cursor-pointer"
                  >
                    Sign In with Authenticator
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleFinish}
                    className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl text-xs font-black uppercase tracking-wider transition-all shadow-lg shadow-emerald-600/20 cursor-pointer"
                  >
                    Enter Workspace
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer / Account Actions */}
        {step !== 'success' && onLogout && (
          <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span>Signed in as <strong>{auth?.currentUser?.email}</strong></span>
            <button
              type="button"
              onClick={onLogout}
              className="text-rose-600 hover:text-rose-700 font-bold flex items-center gap-1 cursor-pointer"
            >
              <LogOut size={13} />
              <span>Sign Out</span>
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
};
