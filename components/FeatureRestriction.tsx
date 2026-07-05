
import React from 'react';
import { Lock, UserPlus, Sparkles } from 'lucide-react';
import { AuthStatus, UserProfile } from '../types';

interface FeatureRestrictionProps {
  authStatus: AuthStatus;
  userProfile?: UserProfile;
  title: string;
  onSignUp: () => void;
  onUpgrade: () => void;
}

const FeatureRestriction: React.FC<FeatureRestrictionProps> = ({
  authStatus,
  userProfile,
  title,
  onSignUp,
  onUpgrade
}) => {
  const isGuest = authStatus === AuthStatus.GUEST;
  const isFree = authStatus === AuthStatus.LOGGED_IN && userProfile?.plan === 'free';
  const isPaid = authStatus === AuthStatus.LOGGED_IN && ['pro', 'team', 'enterprise'].includes(userProfile?.plan || '');

  // If paid, we shouldn't even be showing this, but safety check
  if (isPaid) return null;

  return (
    <div className="flex flex-col items-center justify-center h-full text-center space-y-8 animate-in fade-in duration-700 py-20">
      <div className="w-24 h-24 bg-brand-background rounded-lg flex items-center justify-center text-brand-primary text-4xl shadow-inner border border-brand-divider/20">
        <Lock size={40} />
      </div>
      <div className="space-y-4 max-w-md">
        <h2 className="text-[26px] font-medium text-brand-primary tracking-[-0.01em] leading-tight">{title}</h2>
        <p className="text-slate-600 text-[16px] font-medium">
          {isGuest 
            ? "This feature requires an account. Please sign up to continue."
            : "This feature is available in Pro. Upgrade to unlock full functionality."
          }
        </p>
      </div>
      <button 
        onClick={isGuest ? onSignUp : onUpgrade}
        className="px-10 py-4 bg-brand-primary text-white rounded-lg font-semibold uppercase tracking-widest text-[13px] shadow-xl hover:opacity-90 active:scale-95 transition-all flex items-center space-x-3 mx-auto"
      >
        {isGuest ? <UserPlus size={18} /> : <Sparkles size={18} />}
        <span>{isGuest ? "Sign Up to Continue" : "Upgrade to Pro"}</span>
      </button>
    </div>
  );
};

export default FeatureRestriction;
