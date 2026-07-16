import React, { useState } from 'react';
import { AuthStatus, UserProfile } from '../types';
import { PLAN_FEATURES } from '../config/planConfig';
import { 
  auth, 
  db, 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  sendPasswordResetEmail, 
  doc, 
  setDoc, 
  updateDoc,
  updateProfile, 
  serverTimestamp,
  signInWithPopup,
  GoogleAuthProvider,
  OAuthProvider
} from '../firebase';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { 
  Mail, 
  Lock, 
  Eye, 
  EyeOff, 
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
  Database,
  Building,
  ArrowRight,
  LogOut,
  Sparkle,
  Camera,
  Upload,
  Trash2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

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
  const [loading, setLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [ssoLoading, setSsoLoading] = useState<string | null>(null);

  const getApiUrl = (path: string) => {
    const baseUrl = import.meta.env.VITE_API_URL || "";
    return `${baseUrl}${path}`;
  };

  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [mode, setMode] = useState<'signin' | 'signup' | 'forgot'>('signin');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmPasswordVisible, setConfirmPasswordVisible] = useState(false);
  const [showSsoGuide, setShowSsoGuide] = useState(false);
  
  // Rate limiting / spam prevention state
  const [cooldownRemaining, setCooldownRemaining] = useState(0);

  // Profile Settings States
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editPhotoUrl, setEditPhotoUrl] = useState('');
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  // Initialize profile settings states
  useEffect(() => {
    if (userProfile && isSettingsMode) {
      setEditDisplayName(userProfile.displayName || userProfile.name || '');
      setEditPhotoUrl(userProfile.photoURL || userProfile.avatarUrl || '');
    }
  }, [userProfile, isSettingsMode]);

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
      toast.error('Please upload an image file (PNG, JPG, etc.).');
      return;
    }

    // Limit size to 512KB to prevent Firestore size limit issues with base64
    if (file.size > 512 * 1024) {
      toast.error('Image size should be less than 500KB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (uploadEvent) => {
      if (uploadEvent.target?.result) {
        setEditPhotoUrl(uploadEvent.target.result as string);
        toast.success('Image loaded successfully. Click save to update profile.');
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

      // 1. Update Firebase Authentication user profile
      await updateProfile(auth.currentUser, {
        displayName: displayNameTrimmed,
        photoURL: editPhotoUrl
      });

      // 2. Update Firestore user document
      const userDocRef = doc(db, 'users', auth.currentUser.uid);
      await updateDoc(userDocRef, {
        displayName: displayNameTrimmed,
        name: displayNameTrimmed, // Keep name field updated for backward compatibility
        photoURL: editPhotoUrl,
        avatarUrl: editPhotoUrl // Keep avatarUrl updated for backward compatibility
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

  // Form states
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Handle anti-spam cooldown countdown
  useEffect(() => {
    if (cooldownRemaining <= 0) return;
    const timer = setInterval(() => {
      setCooldownRemaining(prev => prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldownRemaining]);

  const validateEmail = (email: string) => {
    return String(email)
      .toLowerCase()
      .match(
        /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/
      );
  };

  const isEmailValid = email === '' || validateEmail(email);
  const isPasswordValid = password === '' || password.length >= 8;
  const passwordsMatch = mode === 'signin' || mode === 'forgot' || password === confirmPassword;
  const isNameValid = mode === 'signin' || mode === 'forgot' || name.trim() !== '';

  const isFormValid = 
    validateEmail(email) && 
    password.length >= 8 && 
    (mode === 'signin' || (name.trim() !== '' && password === confirmPassword));

  // Firebase standard auth action
  const handleAuthAction = async () => {
    if (!auth) return;

    setError('');
    setSuccess('');
    
    // Validation
    if (mode === 'signup' && !name.trim()) {
      setError('Please enter your full name.');
      return;
    }

    if (!validateEmail(email)) {
      setError('Invalid email format.');
      return;
    }

    if (password.length < 8) {
      setError('Password should be at least 8 characters.');
      return;
    }

    if (mode === 'signup' && password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const trimmedEmail = email.trim();
      const trimmedPassword = password;

      if (mode === 'signup') {
        const result = await createUserWithEmailAndPassword(auth, trimmedEmail, trimmedPassword);
        const user = result.user;

        // Update Auth Profile
        await updateProfile(user, {
          displayName: name.trim()
        });

        // Create user document in Firestore
        const userDocRef = doc(db, 'users', user.uid);
        const now = new Date();
        const renewalDate = new Date(now);
        renewalDate.setDate(renewalDate.getDate() + 30);

        const newProfile: UserProfile = {
          uid: user.uid,
          email: trimmedEmail,
          name: name.trim(),
          displayName: name.trim(),
          plan: 'free',
          minutesUsed: 0,
          thinkingUsed: 0,
          planExpiresAt: renewalDate.toISOString(),
          createdAt: now.toISOString()
        };
        await setDoc(userDocRef, newProfile);
        setSuccess('Account created successfully!');
        toast.success('Account created! Logging you in...');
      } else {
        await signInWithEmailAndPassword(auth, trimmedEmail, trimmedPassword);
        toast.success('Signed in successfully!');
      }
    } catch (err: any) {
      console.error("Auth action error:", err);
      if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential') {
        setError('Incorrect email or password.');
      } else if (err.code === 'auth/wrong-password') {
        setError('Incorrect email or password.');
      } else if (err.code === 'auth/email-already-in-use') {
        setError('Account already exists with this email. Please sign in instead.');
      } else if (err.code === 'auth/invalid-email') {
        setError('Invalid email format.');
      } else if (err.code === 'auth/weak-password') {
        setError('Password should be at least 8 characters.');
      } else if (err.code === 'auth/too-many-requests') {
        setError('Access has been temporarily disabled due to too many failed attempts. Please try again later or reset your password.');
      } else if (err.code === 'auth/user-disabled') {
        setError('This user account has been disabled by an administrator.');
      } else if (err.code === 'auth/network-request-failed') {
        setError('Network error. Please verify your connection.');
      } else {
        setError(err.message || 'Authentication failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  // Google SSO handler
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
      if (err.code === 'auth/operation-not-allowed') {
        setError("Google Sign-In is not enabled in your Firebase Console. See setup instructions below.");
      } else if (err.code === 'auth/popup-blocked') {
        setError("Popup was blocked by your browser. Please allow popups for this app to authenticate.");
      } else {
        setError(err.message || 'Google authentication failed.');
      }
    } finally {
      setSsoLoading(null);
    }
  };

  // Microsoft Microsoft SSO handler
  const handleMicrosoftSso = async () => {
    if (!auth) return;
    setError('');
    setSuccess('');
    setSsoLoading('microsoft');
    try {
      const provider = new OAuthProvider('microsoft.com');
      provider.setCustomParameters({
        prompt: 'select_account',
      });
      // Request standard Azure scopes
      provider.addScope('openid');
      provider.addScope('email');
      provider.addScope('profile');
      
      await signInWithPopup(auth, provider);
      setSuccess('Successfully authenticated with Microsoft SSO.');
      toast.success('Signed in with Microsoft!');
    } catch (err: any) {
      console.error("Microsoft SSO Error:", err);
      if (err.code === 'auth/operation-not-allowed' || err.code === 'auth/configuration-not-found') {
        setError("Microsoft Enterprise SSO is not yet enabled or configured in your Firebase Project. Refer to setup instructions below.");
        setShowSsoGuide(true);
      } else if (err.code === 'auth/popup-blocked') {
        setError("Popup was blocked. Please allow popups to connect your Microsoft account.");
      } else {
        setError(err.message || 'Microsoft SSO authentication failed.');
      }
    } finally {
      setSsoLoading(null);
    }
  };

  const handleResetPassword = async () => {
    if (!auth) return;

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError('Please enter your email address first.');
      setSuccess('');
      return;
    }

    if (!validateEmail(trimmedEmail)) {
      setError('Please enter a valid email address.');
      setSuccess('');
      return;
    }

    // Anti-spam / rate limit check
    if (cooldownRemaining > 0) {
      setError(`Please wait ${cooldownRemaining} seconds before requesting another password reset link.`);
      return;
    }

    setResetLoading(true);
    setError('');
    setSuccess('');
    
    try {
      await sendPasswordResetEmail(auth, trimmedEmail);
      const successMsg = 'A secure password reset link has been sent to your email. Please check your inbox and spam folder.';
      setSuccess(successMsg);
      toast.success(successMsg);
      
      // Set a 60-second cooldown to prevent spam requests
      setCooldownRemaining(60);
    } catch (err: any) {
      console.error("Password reset error:", err);
      let errorMsg = 'Failed to send reset email. Please try again.';
      if (err.code === 'auth/user-not-found') {
        errorMsg = 'No active account exists with this email address.';
      } else if (err.code === 'auth/invalid-email') {
        errorMsg = 'Please enter a valid email address.';
      } else if (err.code === 'auth/too-many-requests') {
        errorMsg = 'Too many requests. Please wait a moment and try again.';
      } else if (err.code === 'auth/network-request-failed') {
        errorMsg = 'Network error. Please verify your connection.';
      } else {
        errorMsg = err.message || 'Failed to request password reset.';
      }
      setError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setResetLoading(false);
    }
  };

  const handleGuestLogin = () => {
    localStorage.setItem('guest', 'true');
    onAuth(AuthStatus.GUEST);
    toast.info('Continuing in Guest Sandbox Mode');
  };

  const handleUpgradeToPro = async () => {
    if (!userProfile?.uid) return;
    
    setLoading(true);
    try {
      const resp = await fetch(getApiUrl("/api/create-order"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: userProfile.uid, planId: "pro" })
      });
      const order = await resp.json();

      if (order.error) throw new Error(order.error);

      const options = {
        key: order.key,
        amount: order.amount,
        currency: order.currency,
        name: "EchoNote Pro",
        description: "Monthly Subscription",
        order_id: order.id,
        handler: async (response: any) => {
          const verifyResp = await fetch(getApiUrl("/api/verify-payment"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...response,
              userId: userProfile.uid,
              planId: "pro"
            })
          });
          const result = await verifyResp.json();
          if (result.success) {
            try {
              const now = new Date();
              const subscriptionStartDate = now.toISOString();
              const nextRefreshDate = new Date(subscriptionStartDate);
              nextRefreshDate.setMonth(nextRefreshDate.getMonth() + 1);

              const expiryDate = new Date(now);
              expiryDate.setMonth(expiryDate.getMonth() + 1);

              await updateDoc(doc(db, "users", userProfile.uid), {
                plan: "pro",
                billingCycle: "monthly",
                subscriptionStartDate: subscriptionStartDate,
                nextRefreshDate: nextRefreshDate.toISOString(),
                billingStartDate: subscriptionStartDate,
                planExpiresAt: expiryDate.toISOString(),
                lastPaymentDate: serverTimestamp()
              });
            } catch (dbErr: any) {
              console.error("⚠️ Client-side AuthView user plan update failed:", dbErr);
            }

            toast.success("Welcome to EchoNote Pro!");
            onCloseSettings?.();
            window.location.reload();
          } else {
            toast.error("Payment verification failed.");
          }
        },
        prefill: {
          email: userProfile.email,
          name: userProfile.displayName || ""
        },
        theme: {
          color: "#5DA9FF"
        }
      };

      if (order.isDemo || (order.id && order.id.startsWith("order_mock_"))) {
        toast.info("Simulating Razorpay Payment (Demo/Sandbox Mode)...");
        setTimeout(async () => {
          await options.handler({
            razorpay_order_id: order.id,
            razorpay_payment_id: "pay_mock_" + Math.random().toString(36).substring(2, 10),
            razorpay_signature: "sig_mock_" + Math.random().toString(36).substring(2, 10),
          });
        }, 1500);
        return;
      }

      const rzp = new (window as any).Razorpay(options);
      rzp.open();
    } catch (err: any) {
      toast.error(err.message || "Failed to start payment process.");
    } finally {
      setLoading(false);
    }
  };

  const BrandHeader = () => (
    <div className="flex flex-col items-center gap-3 mb-4 text-center">
      {!isSettingsMode && (
        <div className="w-14 h-14 bg-gradient-to-tr from-brand-primary to-brand-secondary rounded-2xl flex items-center justify-center text-white shadow-xl shadow-brand-primary/10 mb-2 border border-white/10">
          <img 
            src="/Logo-2.png" 
            alt="EchoNote"
            className="h-9 w-9 object-contain"
            onError={(e) => {
              // Fallback to text icon if not available
              (e.target as HTMLElement).style.display = 'none';
            }}
          />
        </div>
      )}
      <div>
        <h1 className="text-2xl font-bold text-brand-primary tracking-tight md:text-3xl">
          {isSettingsMode ? 'Identity & Credentials' : 'Welcome to EchoNote'}
        </h1>
        <p className="text-xs text-slate-500 font-medium tracking-widest uppercase mt-1">
          {isSettingsMode ? 'Profile & Plan Settings' : 'INTELLIGENT AUDIO FOR ENTERPRISE'}
        </p>
      </div>
    </div>
  );

  // Settings Mode UI
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
              className="p-1.5 rounded-lg hover:bg-slate-50 text-slate-400 hover:text-slate-600 transition-all text-xs"
            >
              Esc Close
            </button>
          </div>

          <BrandHeader />
          
          <div className="space-y-5">
            <div className="bg-slate-50 p-5 rounded-xl border border-slate-200/50 space-y-4">
              {/* Profile Photo and Display Name Editing Section */}
              <div className="space-y-4 text-left">
                <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Your Identity</label>
                
                <div className="flex flex-col sm:flex-row gap-4 items-center sm:items-start bg-white p-4 rounded-xl border border-slate-100">
                  {/* Drag-and-drop avatar file uploader */}
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
                          <label className="cursor-pointer p-1 bg-white/20 hover:bg-white/40 text-white rounded-md transition-colors animate-in fade-in duration-200" title="Change Image">
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
                              toast.success('Profile picture cleared. Reverting to initials.');
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
                    id="upgrade-pro-btn"
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

            <div className="space-y-3 p-4 bg-slate-50/50 rounded-xl border border-slate-100">
              <h4 className="text-xs font-bold tracking-wider text-slate-400 uppercase">Compliance & Audit</h4>
              <div className="space-y-2 text-xs text-slate-500 leading-relaxed text-left">
                <p className="flex items-start gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                  Firebase Authentication tokens are securely managed via HTTPS-only sessions.
                </p>
                <p className="flex items-start gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                  SSO connections are mapped dynamically via Microsoft Azure AD & Google Cloud IAM.
                </p>
              </div>
            </div>

            {/* SSO Setup toggle inside security panel */}
            <div className="border border-slate-100 rounded-xl overflow-hidden">
              <button
                type="button"
                onClick={() => setShowSsoGuide(!showSsoGuide)}
                className="w-full px-4 py-3 bg-slate-50 hover:bg-slate-100/80 transition-colors flex items-center justify-between text-xs font-bold text-slate-600 uppercase tracking-wider"
              >
                <span className="flex items-center gap-1.5">
                  <Key className="w-4 h-4 text-brand-primary" />
                  SSO Administrator Guide
                </span>
                {showSsoGuide ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              
              <AnimatePresence>
                {showSsoGuide && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden bg-white border-t border-slate-100 text-left text-xs text-slate-600 p-4 space-y-4"
                  >
                    <div className="space-y-3">
                      <p className="font-semibold text-brand-primary">How to enable Google & Microsoft SSO in Firebase Console:</p>
                      
                      <div className="space-y-2.5">
                        <div className="border-l-2 border-slate-200 pl-3">
                          <p className="font-bold text-slate-700">1. Enable Google SSO:</p>
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            Open the <a href="https://console.firebase.google.com" target="_blank" rel="noreferrer" className="text-brand-primary underline hover:text-brand-secondary inline-flex items-center gap-0.5">Firebase Console <ExternalLink className="w-2.5 h-2.5" /></a>, navigate to Build &gt; Authentication &gt; Sign-in method, click "Add new provider", select Google, enable it, choose your support email, and click Save.
                          </p>
                        </div>

                        <div className="border-l-2 border-slate-200 pl-3">
                          <p className="font-bold text-slate-700">2. Enable Microsoft Azure AD SSO:</p>
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            Register an application in your <a href="https://portal.azure.com" target="_blank" rel="noreferrer" className="text-brand-primary underline hover:text-brand-secondary inline-flex items-center gap-0.5">Azure Active Directory <ExternalLink className="w-2.5 h-2.5" /></a>. Set redirect URI to: <code className="bg-slate-100 px-1 py-0.5 rounded font-mono text-[10px]">https://{auth?.app.options.authDomain}/__/auth/handler</code>. Then open the Firebase Console, select Microsoft under "Additional providers" and enter your Application Client ID and Secret Value.
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

  // Normal Sign-in / Sign-up view: Modern Double-Pane Layout
  return (
    <div className="fixed inset-0 bg-slate-50 flex items-center justify-center p-4 md:p-8 z-50 overflow-y-auto">
      <motion.div 
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-4xl w-full bg-white rounded-3xl shadow-xl border border-slate-100 overflow-hidden grid grid-cols-1 md:grid-cols-12 min-h-[580px]"
      >
        {/* Left Column: Premium Enterprise Branding */}
        <div className="md:col-span-5 bg-brand-secondary p-8 text-slate-800 flex flex-col justify-between relative overflow-hidden border-r border-slate-100">
          {/* Subtle grid background effect */}
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
                <ShieldCheck className="w-3.5 h-3.5 text-brand-primary" /> Enterprise Ready
              </span>
              <h2 className="text-2xl font-semibold leading-tight tracking-tight lg:text-3xl text-slate-900">
                The Secure Audio Intelligence Workspace.
              </h2>
              <p className="text-sm text-slate-600 leading-relaxed">
                Connect voice recordings to auto-generated transcripts, action-items, and strategic AI intelligence seamlessly.
              </p>
            </div>
          </div>

          <div className="relative z-10 space-y-4 pt-12">
            <div className="space-y-3.5">
              <div className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-full bg-brand-primary/10 flex items-center justify-center mt-0.5">
                  <CheckCircle className="w-3 h-3 text-brand-primary" />
                </div>
                <div className="text-xs text-slate-600">
                  <span className="font-semibold text-slate-900 block">SAML 2.0 & OpenID Connect</span>
                  Provision users directly with Azure or Google Workspace.
                </div>
              </div>
              
              <div className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-full bg-brand-primary/10 flex items-center justify-center mt-0.5">
                  <CheckCircle className="w-3 h-3 text-brand-primary" />
                </div>
                <div className="text-xs text-slate-600">
                  <span className="font-semibold text-slate-900 block">Auditable Data Workspaces</span>
                  Enterprise role mapping, guest sandboxing, and secure sharing.
                </div>
              </div>
            </div>

            <div className="pt-6 border-t border-slate-200 flex items-center justify-between text-[11px] text-slate-500 font-medium">
              <span>Compliance: ISO 27001</span>
              <span>Data Residency: In-Region</span>
            </div>
          </div>
        </div>

        {/* Right Column: Dynamic Form Fields */}
        <div className="md:col-span-7 p-6 md:p-10 flex flex-col justify-between space-y-6">
          <div>
            <BrandHeader />

            {/* Toggle Modes */}
            {mode !== 'forgot' ? (
              <div className="grid grid-cols-2 bg-slate-100 p-1 rounded-xl mb-6">
                <button 
                  type="button"
                  onClick={() => { setMode('signin'); setError(''); setSuccess(''); }}
                  className={`py-2 text-[12px] font-bold uppercase tracking-wider rounded-lg transition-all ${mode === 'signin' ? 'bg-white text-brand-primary shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                >
                  Sign In
                </button>
                <button 
                  type="button"
                  onClick={() => { setMode('signup'); setError(''); setSuccess(''); }}
                  className={`py-2 text-[12px] font-bold uppercase tracking-wider rounded-lg transition-all ${mode === 'signup' ? 'bg-white text-brand-primary shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                >
                  New Account
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 mb-6">
                <button
                  type="button"
                  onClick={() => { setMode('signin'); setError(''); setSuccess(''); }}
                  className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-brand-primary transition-colors flex items-center justify-center cursor-pointer"
                  title="Back to Sign In"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <span className="text-[12px] font-bold uppercase tracking-wider text-slate-500">Reset Password</span>
              </div>
            )}

            {/* Status alerts */}
            <AnimatePresence mode="wait">
              {error && (
                <motion.div 
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="flex items-start gap-2.5 bg-red-50 border border-red-100 text-red-700 p-3 rounded-xl text-xs mb-4 text-left"
                >
                  <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold block">Authentication issue:</span>
                    <span>{error}</span>
                  </div>
                </motion.div>
              )}
              
              {success && (
                <motion.div 
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="flex items-start gap-2.5 bg-emerald-50 border border-emerald-100 text-emerald-800 p-3 rounded-xl text-xs mb-4 text-left"
                >
                  <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold block">Success:</span>
                    <span>{success}</span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Form Fields */}
            <div className="space-y-4">
              {mode === 'forgot' ? (
                <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div className="text-left space-y-1">
                    <p className="text-[12px] text-slate-500 leading-relaxed">
                      Enter your registered business email address below. We'll email you a secure link to reset your account password.
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
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="name@company.com"
                        className={`w-full pl-10 pr-4 py-2.5 bg-slate-50 border rounded-xl text-[13px] focus:outline-none focus:ring-2 focus:ring-brand-primary/20 transition-all ${
                          !isEmailValid && email !== '' ? 'border-red-500 focus:border-red-500' : 'border-slate-200 focus:border-brand-primary'
                        }`}
                      />
                    </div>
                    {!isEmailValid && email !== '' && <p className="text-[10px] text-red-500 ml-1">Please enter a valid business email.</p>}
                  </div>

                  <button 
                    type="button"
                    disabled={resetLoading || !email || !validateEmail(email)}
                    onClick={handleResetPassword}
                    className="w-full py-3 bg-brand-primary hover:bg-brand-secondary text-white rounded-xl font-bold tracking-wider text-[12px] uppercase transition-all shadow-md active:scale-95 disabled:opacity-50 flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    {resetLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : cooldownRemaining > 0 ? (
                      <span>Resend in {cooldownRemaining}s</span>
                    ) : (
                      <span>Send Reset Link</span>
                    )}
                  </button>

                  <button 
                    type="button"
                    onClick={() => { setMode('signin'); setError(''); setSuccess(''); }}
                    className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-xs font-bold uppercase tracking-wider transition-colors active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>Return to Login</span>
                  </button>
                </div>
              ) : (
                <>
                  {mode === 'signup' && (
                    <div className="space-y-1 text-left">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 ml-1">Full Name</label>
                      <div className="relative">
                        <input 
                          type="text" 
                          required
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          placeholder="Jane Doe"
                          className={`w-full px-4 py-2.5 bg-slate-50 border rounded-xl text-[13px] focus:outline-none focus:ring-2 focus:ring-brand-primary/20 transition-all ${
                            !isNameValid ? 'border-red-500 focus:border-red-500' : 'border-slate-200 focus:border-brand-primary'
                          }`}
                        />
                      </div>
                    </div>
                  )}

                  <div className="space-y-1 text-left">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 ml-1">Work Email</label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-3.5 flex items-center pointer-events-none text-slate-400">
                        <Mail className="w-4 h-4" />
                      </div>
                      <input 
                        type="email" 
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="name@company.com"
                        className={`w-full pl-10 pr-4 py-2.5 bg-slate-50 border rounded-xl text-[13px] focus:outline-none focus:ring-2 focus:ring-brand-primary/20 transition-all ${
                          !isEmailValid && email !== '' ? 'border-red-500 focus:border-red-500' : 'border-slate-200 focus:border-brand-primary'
                        }`}
                      />
                    </div>
                    {!isEmailValid && email !== '' && <p className="text-[10px] text-red-500 ml-1">Please enter a valid business email.</p>}
                  </div>

                  <div className="space-y-1 text-left">
                    <div className="flex justify-between items-center ml-1">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Password</label>
                      {mode === 'signin' && (
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
                    {!isPasswordValid && password !== '' && <p className="text-[10px] text-red-500 ml-1">Password must be 8+ characters.</p>}
                  </div>

                  {mode === 'signup' && (
                    <div className="space-y-1 text-left">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 ml-1">Confirm Password</label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-3.5 flex items-center pointer-events-none text-slate-400">
                          <Lock className="w-4 h-4" />
                        </div>
                        <input 
                          type={confirmPasswordVisible ? "text" : "password"} 
                          required
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          placeholder="••••••••"
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
                      {!passwordsMatch && confirmPassword !== '' && <p className="text-[10px] text-red-500 ml-1">Passwords do not match.</p>}
                    </div>
                  )}

                  {/* standard submit */}
                  <button 
                    type="button"
                    disabled={loading || !isFormValid}
                    onClick={handleAuthAction}
                    className="w-full py-3 bg-brand-primary hover:bg-brand-secondary text-white rounded-xl font-bold tracking-wider text-[12px] uppercase transition-all shadow-md active:scale-95 disabled:opacity-50 flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <span>{mode === 'signin' ? 'Sign In with Email' : 'Register Account'}</span>}
                  </button>
                </>
              )}
            </div>

            {/* Divider */}
            {mode !== 'forgot' && (
              <>
                <div className="relative py-4">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-slate-200"></div>
                  </div>
                  <div className="relative flex justify-center text-[10px] uppercase tracking-widest font-black text-slate-400">
                    <span className="bg-white px-3">Or connect via SSO</span>
                  </div>
                </div>

                {/* SSO OAuth buttons */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Google SSO */}
                  <button
                    type="button"
                    disabled={ssoLoading !== null}
                    onClick={handleGoogleSso}
                    className="px-4 py-2.5 border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50 cursor-pointer"
                  >
                    {ssoLoading === 'google' ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <i className="fa-brands fa-google text-red-500 text-sm"></i>
                    )}
                    <span>Continue with Google</span>
                  </button>

                  {/* Microsoft SSO */}
                  <button
                    type="button"
                    disabled={ssoLoading !== null}
                    onClick={handleMicrosoftSso}
                    className="px-4 py-2.5 border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50 cursor-pointer"
                  >
                    {ssoLoading === 'microsoft' ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <i className="fa-brands fa-microsoft text-blue-500 text-sm"></i>
                    )}
                    <span>Continue with Microsoft</span>
                  </button>
                </div>

                {/* Admin toggle guide */}
                <div className="mt-3 text-center">
                  <button 
                    type="button"
                    onClick={() => setShowSsoGuide(!showSsoGuide)}
                    className="text-[10px] font-bold text-slate-400 hover:text-brand-primary uppercase tracking-wider inline-flex items-center gap-1 cursor-pointer"
                  >
                    <HelpCircle className="w-3.5 h-3.5" />
                    SSO Setup Documentation (Admins)
                    {showSsoGuide ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  </button>
                  
                  <AnimatePresence>
                    {showSsoGuide && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden text-left bg-slate-50 border border-slate-100 rounded-xl p-4 mt-3 text-[11px] text-slate-600 space-y-3 shadow-inner"
                      >
                        <div className="space-y-2">
                          <p className="font-bold text-brand-primary uppercase tracking-wider text-[10px]">Setup Azure AD Microsoft login in Firebase:</p>
                          <ol className="list-decimal list-inside space-y-1.5 leading-relaxed text-[11px]">
                            <li>
                              Go to the <a href="https://portal.azure.com" target="_blank" rel="noreferrer" className="text-brand-primary underline inline-flex items-center gap-0.5 font-bold">Azure Portal <ExternalLink className="w-2.5 h-2.5" /></a> and register a new multi-tenant application.
                            </li>
                            <li>
                              Set Redirect URI (Web) to: 
                              <code className="bg-slate-200/80 px-1.5 py-0.5 rounded font-mono text-[9px] block mt-1 break-all">
                                https://{auth?.app.options.authDomain || 'your-firebase-project.firebaseapp.com'}/__/auth/handler
                              </code>
                            </li>
                            <li>
                              Generate a **Client Secret** under "Certificates & secrets".
                            </li>
                            <li>
                              Open the <a href="https://console.firebase.google.com" target="_blank" rel="noreferrer" className="text-brand-primary underline inline-flex items-center gap-0.5 font-bold">Firebase Console <ExternalLink className="w-2.5 h-2.5" /></a> &gt; Build &gt; Authentication &gt; Sign-in method, click "Add new provider", select **Microsoft**, input Client ID & Client Secret, and enable it.
                            </li>
                          </ol>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </>
            )}
          </div>

          {/* Guest Access Sandbox */}
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
