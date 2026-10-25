import React from 'react';
import { 
  ShieldAlert, 
  Lock, 
  KeyRound, 
  ArrowRight, 
  Building2, 
  LogOut,
  RefreshCw,
  ShieldCheck
} from 'lucide-react';

export interface MfaWorkspaceGuardProps {
  orgName?: string;
  requirement?: string;
  userRole?: string;
  isEnrolled?: boolean;
  onOpenMfaModal: () => void;
  onSwitchOrg?: () => void;
  onLogout?: () => void;
}

export const MfaWorkspaceGuard: React.FC<MfaWorkspaceGuardProps> = ({
  orgName = 'Organization',
  requirement = 'MFA_REQUIRED_ADMINS',
  userRole = 'Member',
  isEnrolled = false,
  onOpenMfaModal,
  onSwitchOrg,
  onLogout
}) => {
  const isEnforcementAll = requirement === 'MFA_ENFORCED_ALL' || requirement === 'MFA_REQUIRED_ALL';
  const roleDisplay = userRole.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  return (
    <div className="min-h-[500px] flex items-center justify-center p-6 bg-slate-50/50">
      <div className="max-w-md w-full bg-white rounded-3xl shadow-xl border border-slate-200 p-8 text-center space-y-6">
        <div className="w-20 h-20 bg-indigo-50 border border-indigo-100 rounded-3xl flex items-center justify-center mx-auto text-indigo-600 shadow-inner">
          <ShieldAlert size={40} className="text-indigo-600 animate-pulse" />
        </div>

        <div className="space-y-2">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-50 border border-amber-200 rounded-full text-[11px] font-black uppercase tracking-wider text-amber-800">
            <Lock size={12} />
            <span>Access Policy Restricted</span>
          </div>

          <h2 className="text-xl font-black text-slate-900 tracking-tight">
            Two-Factor Authentication Required
          </h2>

          <p className="text-xs text-slate-600 leading-relaxed max-w-sm mx-auto">
            {isEnforcementAll ? (
              <>
                <strong>{orgName}</strong> requires mandatory Two-Factor Authentication (MFA) for all members before accessing workspaces, projects, or recordings.
              </>
            ) : (
              <>
                <strong>{orgName}</strong> requires Two-Factor Authentication (MFA) for administrative roles (your role: <strong>{roleDisplay}</strong>) under enterprise security policy.
              </>
            )}
          </p>
        </div>

        <div className="p-4 bg-slate-50 border border-slate-200/80 rounded-2xl text-left space-y-2">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
            <Building2 size={14} className="text-slate-500" />
            <span>Workspace Security Enforcement</span>
          </div>
          <p className="text-[11px] text-slate-500 leading-normal">
            {isEnrolled ? (
              "Your account is enrolled in Two-Factor Authentication, but this session requires a second-factor challenge."
            ) : (
              "You must set up an authenticator application (Google Authenticator, Microsoft Authenticator, or 1Password) to proceed."
            )}
          </p>
        </div>

        <div className="space-y-3 pt-2">
          <button
            type="button"
            onClick={onOpenMfaModal}
            className="w-full py-3.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl text-xs font-black uppercase tracking-wider transition-all shadow-lg shadow-indigo-600/20 flex items-center justify-center gap-2 cursor-pointer active:scale-98"
          >
            <span>{isEnrolled ? "Verify Active Session" : "Set Up Authenticator App"}</span>
            <ArrowRight size={14} />
          </button>

          <div className="flex items-center justify-center gap-4 text-xs font-bold pt-1">
            {onSwitchOrg && (
              <button
                type="button"
                onClick={onSwitchOrg}
                className="text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
              >
                Switch Organization
              </button>
            )}

            {onLogout && (
              <button
                type="button"
                onClick={onLogout}
                className="text-rose-600 hover:text-rose-700 transition-colors flex items-center gap-1 cursor-pointer"
              >
                <LogOut size={12} />
                <span>Sign Out</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
