
import React, { useState } from 'react';
import { AuthStatus, UserProfile } from '../types';
import { PLAN_FEATURES } from '../config/planConfig';
import { auth, db, signInWithPopup, signInWithRedirect, getRedirectResult, GoogleAuthProvider, createUserWithEmailAndPassword, signInWithEmailAndPassword, doc, setDoc, getDoc } from '../firebase';
import { useEffect } from 'react';

interface AuthViewProps {
  onAuth: (status: AuthStatus, profile?: UserProfile, rememberMe?: boolean) => void;
  isSettingsMode?: boolean;
  onCloseSettings?: () => void;
  onLogout?: () => void;
  userProfile?: UserProfile;
  onBackToHome?: () => void;
}

const AuthView: React.FC<AuthViewProps> = ({ onAuth, isSettingsMode, onCloseSettings, onLogout, userProfile, onBackToHome }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [rememberMe, setRememberMe] = useState(() => {
    return localStorage.getItem('echonote_remember_me') === 'true';
  });
  
  // Form states
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');

  // Handle redirect result
  useEffect(() => {
    const handleRedirect = async () => {
      if (!auth) return;
      try {
        const result = await getRedirectResult(auth);
        if (result) {
          const user = result.user;
          const userDocRef = doc(db, 'users', user.uid);
          const userDoc = await getDoc(userDocRef);
          
          if (!userDoc.exists()) {
            const newProfile: UserProfile = {
              uid: user.uid,
              email: user.email || '',
              name: user.displayName || '',
              plan: 'free',
              minutesUsed: 0,
              minutesLimit: 60,
              thinkingUsageCount: 0,
              createdAt: new Date().toISOString()
            };
            await setDoc(userDocRef, newProfile);
          }
        }
      } catch (err: any) {
        console.error('Redirect result error:', err);
        setError('Something went wrong. Please try again.');
      }
    };
    handleRedirect();
  }, []);

  const validateEmail = (email: string) => {
    return String(email)
      .toLowerCase()
      .match(
        /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/
      );
  };

  const calculatePasswordStrength = (pass: string) => {
    let strength = 0;
    if (pass.length >= 8) strength++;
    if (/[A-Z]/.test(pass)) strength++;
    if (/[0-9]/.test(pass)) strength++;
    if (/[^A-Za-z0-9]/.test(pass)) strength++;
    return strength;
  };

  const passwordStrength = calculatePasswordStrength(password);
  const isEmailValid = email === '' || validateEmail(email);

  const handleGoogleLogin = async () => {
    if (!auth || loading) return;

    setLoading(true);
    setError('');
    
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      
      try {
        const result = await signInWithPopup(auth, provider);
        const user = result.user;

        localStorage.setItem('echonote_remember_me', String(rememberMe));

        const userDocRef = doc(db, 'users', user.uid);
        const userDoc = await getDoc(userDocRef);
        
        if (!userDoc.exists()) {
          const newProfile: UserProfile = {
            uid: user.uid,
            email: user.email || '',
            name: user.displayName || '',
            plan: 'free',
            minutesUsed: 0,
            minutesLimit: PLAN_FEATURES.free.totalMinutesLimit,
            thinkingUsageCount: 0,
            createdAt: new Date().toISOString()
          };
          await setDoc(userDocRef, newProfile);
        }
      } catch (popupErr: any) {
        // If popup is closed by user, just stop loading and do nothing
        if (popupErr.code === 'auth/popup-closed-by-user') {
          setLoading(false);
          return;
        }
        
        // For other popup errors, try redirect as fallback
        console.warn('Popup failed, falling back to redirect:', popupErr);
        await signInWithRedirect(auth, provider);
      }
    } catch (err: any) {
      console.error('Google Login error:', err);
      setError('Something went wrong. Please try again.');
      setLoading(false);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth) return;

    setError('');
    
    // Validation
    if (!validateEmail(email)) {
      setError('Please enter a valid email address.');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    if (mode === 'signup' && password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    localStorage.setItem('echonote_remember_me', String(rememberMe));

    setLoading(true);
    try {
      if (mode === 'signup') {
        const result = await createUserWithEmailAndPassword(auth, email, password);
        const user = result.user;

        // Create user document in Firestore
        const userDocRef = doc(db, 'users', user.uid);
        const newProfile: UserProfile = {
          uid: user.uid,
          email: email,
          name: fullName || '',
          plan: 'free',
          minutesUsed: 0,
          minutesLimit: PLAN_FEATURES.free.totalMinutesLimit,
          thinkingUsageCount: 0,
          createdAt: new Date().toISOString()
        };
        await setDoc(userDocRef, newProfile);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (err: any) {
      console.error('Email Auth error:', err);
      if (err.code === 'auth/user-not-found') {
        setError('No account found. Please sign up first.');
      } else if (err.code === 'auth/wrong-password') {
        setError('Incorrect password.');
      } else if (err.code === 'auth/email-already-in-use') {
        setError('An account with this email already exists. Please try signing in instead.');
      } else if (err.code === 'auth/invalid-credential') {
        setError('Invalid email or password. Please check your credentials and try again.');
      } else if (err.code === 'auth/operation-not-allowed') {
        setError('Email/Password authentication is not enabled in the Firebase Console. To fix this, go to Authentication > Sign-in method in your Firebase project and enable Email/Password.');
      } else {
        setError(err.message || 'Authentication failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const BrandHeader = () => (
    <div className="flex flex-col items-center gap-4 mb-6">
      {!isSettingsMode && (
        <img 
          src="/Logo-1.jpg" 
          alt="EchoNote"
          className="h-16 w-auto object-contain"
        />
      )}
      <div className="text-center">
        <h1 className="text-3xl font-bold text-[#1B2A4E]">
          {isSettingsMode ? 'Security Center' : 'EchoNote'}
        </h1>
        <p className="text-sm text-gray-500 tracking-widest uppercase">
          {isSettingsMode ? 'Credential management' : 'INTELLIGENT AUDIO SOLUTIONS'}
        </p>
      </div>
    </div>
  );

  if (isSettingsMode) {
    return (
      <div className="fixed inset-0 bg-brand-primary/60 backdrop-blur-sm z-[200] flex items-center justify-center p-6">
        <div className="bg-white rounded-lg p-10 max-w-md w-full space-y-8 shadow-2xl animate-in zoom-in-95">
          <BrandHeader />
          
          <div className="space-y-6">
            <div className="bg-brand-background p-6 rounded-lg border border-brand-divider/20 space-y-4">
              <div className="flex items-center space-x-4">
                <div className="w-14 h-14 bg-brand-primary text-brand-accent flex items-center justify-center rounded-lg font-semibold text-xl shadow-lg shadow-brand-primary/10">
                  {userProfile?.name?.charAt(0) || userProfile?.email?.charAt(0) || 'U'}
                </div>
                <div className="text-left">
                  <p className="text-[16px] font-semibold text-brand-primary">{userProfile?.name || userProfile?.email || 'User'}</p>
                  <p className="text-[13px] font-medium text-slate-500">{userProfile?.email}</p>
                </div>
              </div>
              <div className="pt-4 border-t border-brand-divider/20 flex justify-between items-center">
                <span className="text-[13px] font-medium tracking-widest text-slate-400">Account status</span>
                <span className="px-2 py-1 bg-emerald-50 text-emerald-600 rounded-lg text-[11px] font-semibold tracking-widest">Active</span>
              </div>
            </div>

            <div className="h-px bg-brand-divider/10" />

            <div className="space-y-4">
              <h4 className="text-[13px] font-medium tracking-[0.2em] text-slate-400 ml-1 text-left">Security & access</h4>
              <p className="text-[13px] text-slate-500 text-left">Your account is secured via Firebase Authentication. Password management is handled by your primary account provider.</p>
            </div>
          </div>

          <div className="flex flex-col space-y-2 pt-2">
            <button type="button" onClick={onCloseSettings} className="w-full text-center text-[13px] font-medium text-slate-400 hover:text-brand-primary">Close Settings</button>
            {onLogout && (
              <button 
                type="button" 
                onClick={onLogout}
                className="w-full text-center text-[13px] font-medium text-red-400 hover:text-red-500 transition-colors pt-4 border-t border-brand-divider/10 mt-2"
              >
                Terminate Session (Sign Out)
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-brand-background flex items-center justify-center p-6 z-50">
      <div className="max-w-md w-full bg-white rounded-lg p-8 md:p-10 shadow-sm border border-brand-divider/20 space-y-6 animate-in fade-in zoom-in-95 duration-500">
        <BrandHeader />
        
        {/* Auth Tabs */}
        <div className="flex p-1 bg-brand-background rounded-lg border border-brand-divider/10">
          <button 
            onClick={() => setMode('signin')}
            className={`flex-1 py-2 text-[13px] font-semibold tracking-widest uppercase rounded-md transition-all ${mode === 'signin' ? 'bg-white text-brand-primary shadow-sm' : 'text-slate-400 hover:text-brand-primary'}`}
          >
            Sign In
          </button>
          <button 
            onClick={() => setMode('signup')}
            className={`flex-1 py-2 text-[13px] font-semibold tracking-widest uppercase rounded-md transition-all ${mode === 'signup' ? 'bg-white text-brand-primary shadow-sm' : 'text-slate-400 hover:text-brand-primary'}`}
          >
            Create Account
          </button>
        </div>

        <div className="space-y-4">
          {error && (
            <div className="flex items-center justify-center space-x-2 text-red-500 text-[13px] font-medium animate-in fade-in slide-in-from-top-1">
              <i className="fa-solid fa-circle-exclamation text-[12px]"></i>
              <span>{error}</span>
            </div>
          )}
          
          <button 
            onClick={handleGoogleLogin} 
            disabled={loading}
            className="w-full py-3.5 bg-white text-brand-primary rounded-lg font-semibold tracking-widest text-[13px] hover:bg-brand-background hover:shadow-md transition-all border border-brand-divider/20 shadow-sm active:scale-[0.97] flex items-center justify-center space-x-3 disabled:opacity-70 disabled:cursor-not-allowed group"
          >
            {loading ? (
              <>
                <i className="fa-solid fa-circle-notch animate-spin"></i>
                <span>Signing in...</span>
              </>
            ) : (
              <>
                <i className="fa-brands fa-google group-hover:scale-110 transition-transform"></i>
                <span>Continue with Google</span>
              </>
            )}
          </button>

          <div className="relative py-2">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-brand-divider/10"></div>
            </div>
            <div className="relative flex justify-center text-[11px] font-bold text-slate-400">
              <span className="bg-white px-3 tracking-widest uppercase">OR</span>
            </div>
          </div>

          <form onSubmit={handleEmailAuth} className="space-y-4">
            {mode === 'signup' && (
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold uppercase tracking-widest text-slate-400 ml-1">Full Name (Optional)</label>
                <input 
                  type="text" 
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="John Doe"
                  className="w-full px-4 py-3 bg-brand-background border border-brand-divider/20 rounded-lg text-[14px] focus:outline-none focus:border-brand-primary transition-colors"
                />
              </div>
            )}
            
            <div className="space-y-1.5">
              <div className="flex justify-between items-center ml-1">
                <label className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Email Address</label>
                {!isEmailValid && email !== '' && (
                  <span className="text-[10px] text-red-500 font-medium">Invalid Format</span>
                )}
              </div>
              <input 
                type="email" 
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
                className={`w-full px-4 py-3 bg-brand-background border rounded-lg text-[14px] focus:outline-none transition-colors ${
                  !isEmailValid && email !== '' ? 'border-red-500 focus:border-red-500' : 'border-brand-divider/20 focus:border-brand-primary'
                }`}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-bold uppercase tracking-widest text-slate-400 ml-1">Password</label>
              <input 
                type="password" 
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-4 py-3 bg-brand-background border border-brand-divider/20 rounded-lg text-[14px] focus:outline-none focus:border-brand-primary transition-colors"
              />
              {password !== '' && (
                <div className="px-1 space-y-1">
                  <div className="flex h-1 gap-1">
                    {[1, 2, 3, 4].map((step) => (
                      <div 
                        key={step}
                        className={`flex-1 rounded-full transition-colors ${
                          step <= passwordStrength 
                            ? (passwordStrength <= 1 ? 'bg-red-500' : passwordStrength <= 3 ? 'bg-yellow-500' : 'bg-emerald-500')
                            : 'bg-slate-200'
                        }`}
                      />
                    ))}
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-slate-400 font-medium tracking-wider uppercase">
                      {passwordStrength <= 1 ? 'Weak' : passwordStrength <= 3 ? 'Medium' : 'Strong'}
                    </span>
                    <span className="text-[9px] text-slate-300 font-medium">Min. 8 chars + Special</span>
                  </div>
                </div>
              )}
            </div>

            {mode === 'signup' && (
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold uppercase tracking-widest text-slate-400 ml-1">Confirm Password</label>
                <input 
                  type="password" 
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-4 py-3 bg-brand-background border border-brand-divider/20 rounded-lg text-[14px] focus:outline-none focus:border-brand-primary transition-colors"
                />
              </div>
            )}

            <div className="flex items-center space-x-2 ml-1 py-1">
              <input 
                type="checkbox" 
                id="rememberMe"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="w-4 h-4 rounded border-brand-divider/20 text-brand-primary focus:ring-brand-primary"
              />
              <label htmlFor="rememberMe" className="text-[12px] font-medium text-slate-500 cursor-pointer">Remember me</label>
            </div>

            <button 
              type="submit"
              disabled={loading}
              className="w-full py-4 bg-brand-primary text-white rounded-lg font-semibold tracking-widest text-[13px] hover:bg-brand-secondary transition-all shadow-xl active:scale-[0.98] flex items-center justify-center"
            >
              {loading ? <i className="fa-solid fa-circle-notch animate-spin"></i> : (
                <span>{mode === 'signin' ? 'Sign In' : 'Create Account'}</span>
              )}
            </button>
          </form>

          <div className="h-px bg-brand-divider/10 my-2" />

          <button 
            onClick={() => onAuth(AuthStatus.GUEST)} 
            className="w-full py-3 text-slate-400 rounded-lg font-medium tracking-widest text-[11px] hover:text-brand-primary transition-all active:scale-[0.98] flex flex-col items-center justify-center"
          >
            <span>Continue as Guest Preview</span>
          </button>

          {onBackToHome && (
            <button 
              onClick={onBackToHome}
              className="w-full py-2 text-slate-400 text-[12px] font-medium hover:text-brand-primary transition-colors flex items-center justify-center space-x-2"
            >
              <i className="fa-solid fa-arrow-left text-[10px]"></i>
              <span>Back to Home</span>
            </button>
          )}
        </div>
        <p className="text-center text-[11px] text-slate-400 leading-relaxed px-4 font-medium tracking-wider">Proprietary company software. Data residency compliant.</p>
      </div>
    </div>
  );
};

export default AuthView;
