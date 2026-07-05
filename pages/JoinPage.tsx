import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useFirebase } from '../components/FirebaseProvider';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowRight, UserPlus, CheckCircle2, AlertCircle, Loader2, Folder, Shield, XCircle, Clock, Home, X } from 'lucide-react';

interface InviteDetails {
  id: string;
  email: string;
  projectId: string;
  ownerId?: string;
  projectName: string;
  role: string;
  invitedBy?: string;
  status: 'pending' | 'accepted' | 'rejected' | 'expired';
}

const JoinPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const navigate = useNavigate();
  const { user, isAuthReady } = useFirebase();

  const [invite, setInvite] = useState<InviteDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [success, setSuccess] = useState<boolean | 'declined'>(false);

  useEffect(() => {
    if (!token) {
      setError('Missing invitation token');
      setLoading(false);
      return;
    }

    const fetchInvite = async () => {
      try {
        const response = await fetch(`/api/invite-details/${token}`);
        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Failed to load invitation');
        }
        const data = await response.json();
        setInvite(data);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchInvite();
  }, [token]);

  const handleJoin = async () => {
    if (!user) {
      // Save redirect in state or local storage for after login
      localStorage.setItem('redirectAfterLogin', `/join?token=${token}`);
      navigate('/auth');
      return;
    }

    if (!invite) return;

    setJoining(true);
    try {
      const response = await fetch('/api/invite-accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: invite.id,
          userId: user.uid,
          userEmail: user.email,
          userDisplayName: user.displayName || user.email?.split('@')[0] || 'User'
        })
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to join project');
      }

      setSuccess(true);
      setTimeout(() => {
        navigate('/app');
      }, 2500);
    } catch (err: any) {
      console.error('Join error:', err);
      setError(err.message || 'Failed to join project. You might already be a member.');
    } finally {
      setJoining(false);
    }
  };

  const handleDecline = async () => {
    if (!invite) return;

    setDeclining(true);
    try {
      const response = await fetch('/api/invite-decline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: invite.id,
          userId: user?.uid || null
        })
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to decline invitation');
      }

      setSuccess('declined');
      setTimeout(() => {
        navigate('/');
      }, 2500);
    } catch (err: any) {
      console.error('Decline error:', err);
      setError(err.message || 'Failed to decline invitation.');
    } finally {
      setDeclining(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-4">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-10 h-10 text-brand-primary animate-spin" />
          <p className="text-slate-500 font-medium">Validating invitation...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-white rounded-3xl p-8 shadow-2xl shadow-brand-primary/5 border border-slate-100 text-center"
        >
          <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <AlertCircle className="w-8 h-8 text-red-500" />
          </div>
          <h1 className="text-2xl font-black text-slate-800 uppercase tracking-tight mb-2">Invitation Error</h1>
          <p className="text-slate-500 mb-8 leading-relaxed">{error}</p>
          <button 
            onClick={() => navigate('/')}
            className="w-full py-4 bg-brand-primary text-white rounded-xl font-black uppercase tracking-widest text-[13px] shadow-lg shadow-brand-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all"
          >
            Go to Home
          </button>
        </motion.div>
      </div>
    );
  }

  // Handle cases where the invite is already processed
  if (invite && invite.status !== 'pending') {
    let statusTitle = "Invitation Processed";
    let statusDesc = "This invitation is no longer active.";
    let StatusIcon = AlertCircle;
    let iconBg = "bg-amber-50";
    let iconColor = "text-amber-500";

    if (invite.status === 'accepted') {
      statusTitle = "Already Accepted";
      statusDesc = `This invitation has already been accepted. You are a member of "${invite.projectName}".`;
      StatusIcon = CheckCircle2;
      iconBg = "bg-emerald-50";
      iconColor = "text-emerald-500";
    } else if (invite.status === 'rejected') {
      statusTitle = "Invitation Declined";
      statusDesc = "This invitation was declined and is no longer valid.";
      StatusIcon = XCircle;
      iconBg = "bg-rose-50";
      iconColor = "text-rose-500";
    } else if (invite.status === 'expired') {
      statusTitle = "Invitation Expired";
      statusDesc = "This invitation has expired. Please request a new one from the project owner.";
      StatusIcon = Clock;
      iconBg = "bg-slate-100";
      iconColor = "text-slate-400";
    }

    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-md w-full bg-white rounded-3xl p-8 shadow-2xl shadow-brand-primary/5 border border-slate-100 text-center"
        >
          <div className={`w-16 h-16 ${iconBg} rounded-2xl flex items-center justify-center mx-auto mb-6`}>
            <StatusIcon className={`w-8 h-8 ${iconColor}`} />
          </div>
          <h1 className="text-2xl font-black text-slate-800 uppercase tracking-tight mb-2">{statusTitle}</h1>
          <p className="text-slate-500 mb-8 leading-relaxed">{statusDesc}</p>
          <div className="space-y-3">
            <button 
              onClick={() => navigate('/app')}
              className="w-full py-4 bg-brand-primary text-white rounded-xl font-black uppercase tracking-widest text-[13px] shadow-lg shadow-brand-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all"
            >
              Go to Dashboard
            </button>
            <button 
              onClick={() => navigate('/')}
              className="w-full py-3 bg-slate-100 text-slate-600 rounded-xl font-bold uppercase tracking-wider text-[11px] hover:bg-slate-200 transition-all"
            >
              Back to Home
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-w-md w-full bg-white rounded-3xl p-8 shadow-2xl shadow-brand-primary/5 border border-slate-100"
      >
        <AnimatePresence mode="wait">
          {!success ? (
            <motion.div 
              key="invite"
              initial={{ opacity: 1 }}
              exit={{ opacity: 0, x: -50 }}
              className="space-y-8"
            >
              <div className="text-center">
                <div className="w-20 h-20 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto mb-6 relative">
                  <Folder className="w-10 h-10 text-brand-primary" />
                  <div className="absolute -bottom-1 -right-1 bg-brand-primary rounded-lg p-1.5 border-4 border-white shadow-sm">
                    <UserPlus className="w-4 h-4 text-white" />
                  </div>
                </div>
                <h1 className="text-2xl font-black text-slate-800 uppercase tracking-tight leading-tight">
                  Join Project:<br />{invite?.projectName}
                </h1>
                <p className="text-slate-400 font-medium text-sm mt-2">
                  Invited by <span className="text-brand-primary font-bold">{invite?.invitedBy}</span> as a <span className="text-brand-primary font-black uppercase tracking-tighter">{invite?.role}</span>
                </p>
              </div>

              <div className="bg-slate-50 rounded-2xl p-5 space-y-4 border border-slate-100">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center font-bold text-slate-500 text-sm">
                    {invite?.email.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Invited Email</p>
                    <p className="text-sm font-bold text-slate-800">{invite?.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-brand-primary/10 flex items-center justify-center text-brand-primary">
                    <Shield className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Your Role</p>
                    <p className="text-sm font-bold text-slate-800 capitalize">{invite?.role}</p>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <button 
                  onClick={handleJoin}
                  disabled={joining || declining}
                  className="w-full group flex items-center justify-center gap-3 py-4 bg-[#1A234E] text-white rounded-xl font-black uppercase tracking-widest text-[13px] shadow-xl shadow-brand-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:scale-100"
                >
                  {joining ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span>Joining...</span>
                    </>
                  ) : (
                    <>
                      <span>{user ? 'Accept & Join Project' : 'Login to Join'}</span>
                      <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                    </>
                  )}
                </button>

                <button 
                  onClick={handleDecline}
                  disabled={joining || declining}
                  className="w-full flex items-center justify-center gap-2 py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl font-bold uppercase tracking-wider text-[11px] active:scale-[0.98] transition-all disabled:opacity-50"
                >
                  {declining ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Declining...</span>
                    </>
                  ) : (
                    <>
                      <X className="w-4 h-4" />
                      <span>Decline Invitation</span>
                    </>
                  )}
                </button>

                <p className="text-[10px] text-center text-slate-400 font-medium px-4 pt-2">
                  By joining, you agree to EchoNote's collaboration terms and project-specific permissions.
                </p>
              </div>
            </motion.div>
          ) : success === 'declined' ? (
            <motion.div 
              key="declined-success"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center py-8"
            >
              <div className="w-20 h-20 bg-rose-50 rounded-3xl flex items-center justify-center mx-auto mb-8">
                <XCircle className="w-12 h-12 text-rose-500" />
              </div>
              <h2 className="text-3xl font-black text-slate-800 uppercase tracking-tight mb-3">Declined</h2>
              <p className="text-slate-500 font-medium mb-10 leading-relaxed">
                You have declined the invitation.<br />Redirecting you back home...
              </p>
              <div className="flex items-center justify-center gap-2">
                <div className="w-2 h-2 bg-rose-500 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                <div className="w-2 h-2 bg-rose-500 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                <div className="w-2 h-2 bg-rose-500 rounded-full animate-bounce"></div>
              </div>
            </motion.div>
          ) : (
            <motion.div 
              key="success"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center py-8"
            >
              <div className="w-20 h-20 bg-emerald-50 rounded-3xl flex items-center justify-center mx-auto mb-8">
                <CheckCircle2 className="w-12 h-12 text-emerald-500" />
              </div>
              <h2 className="text-3xl font-black text-slate-800 uppercase tracking-tight mb-3">Welcome Aboard!</h2>
              <p className="text-slate-500 font-medium mb-10 leading-relaxed">
                Invitation accepted successfully.<br />Redirecting you to the project dashboard...
              </p>
              <div className="flex items-center justify-center gap-2">
                <div className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                <div className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                <div className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce"></div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
};

export default JoinPage;
