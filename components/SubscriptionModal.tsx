import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Check, Crown, X, Sparkles, Zap, ShieldCheck, PlusCircle, 
  Building2, Users, CreditCard, Calendar, ArrowUpRight, 
  Mail, UserPlus, Download, CheckCircle, Sliders, Shield, AlertTriangle,
  FileText, Receipt, History, DollarSign, CheckCircle2
} from 'lucide-react';
import { UserProfile } from '../types';
import { PLAN_FEATURES } from '../config/planConfig';
import { handleUpgrade, handleTopup, handleDowngradeToFree, handleDowngradePlan, handleThinkingTopup } from '../services/subscriptionService';
import { toast } from 'sonner';
import { db, collection, query, where, getDocs, orderBy } from '../firebase';

interface SubscriptionModalProps {
  isOpen: boolean;
  onClose: () => void;
  userProfile?: UserProfile;
}

const SubscriptionModal: React.FC<SubscriptionModalProps> = ({ isOpen, onClose, userProfile }) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'plans' | 'topup' | 'thinking-topup' | 'billing'>('plans');
  const [billing, setBilling] = useState<'monthly' | 'yearly'>('monthly');
  const [showAllPlansOverride, setShowAllPlansOverride] = useState(false);
  const [downgradeTarget, setDowngradeTarget] = useState<string | null>(null);

  interface Transaction {
    id: string;
    userId: string;
    paymentId: string;
    orderId: string;
    type: 'subscription' | 'topup' | 'thinking-topup' | 'downgrade';
    planId: string;
    billingCycle: string;
    amount: number;
    minutes?: number;
    createdAt: string;
    status: string;
  }

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loadingTransactions, setLoadingTransactions] = useState(false);

  React.useEffect(() => {
    if (!isOpen || !userProfile?.uid) return;

    const fetchTransactions = async () => {
      setLoadingTransactions(true);
      try {
        const txRef = collection(db, "transactions");
        const q = query(
          txRef,
          where("userId", "==", userProfile.uid),
          orderBy("createdAt", "desc")
        );
        const snapshot = await getDocs(q);
        const list: Transaction[] = [];
        snapshot.forEach((doc) => {
          list.push({ id: doc.id, ...doc.data() } as Transaction);
        });

        setTransactions(list);
      } catch (err) {
        console.warn("⚠️ Failed to fetch transactions from Firestore:", err);
      } finally {
        setLoadingTransactions(false);
      }
    };

    fetchTransactions();
  }, [isOpen, userProfile?.uid, activeTab]);

  // Interactive Team Seats State
  const [teamMembers, setTeamMembers] = useState(() => {
    if (userProfile?.email) {
      return [{ name: userProfile.displayName || userProfile.email.split('@')[0], email: userProfile.email, role: 'Owner', status: 'Active' }];
    }
    return [];
  });
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberRole, setNewMemberRole] = useState<'Editor' | 'Viewer'>('Editor');

  const handleAddMember = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMemberEmail || !newMemberName) {
      toast.error("Please fill in both name and email.");
      return;
    }
    setTeamMembers([
      ...teamMembers,
      { name: newMemberName, email: newMemberEmail, role: newMemberRole, status: 'Active' }
    ]);
    setNewMemberEmail('');
    setNewMemberName('');
    toast.success(`Successfully invited ${newMemberName} to your team workspace!`);
  };

  const handleRemoveMember = (email: string) => {
    setTeamMembers(teamMembers.filter(m => m.email !== email));
    toast.success("Team member removed.");
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return 'Next month';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch (e) {
      return dateStr;
    }
  };

  const plans = [
    {
      id: 'free',
      name: 'Free',
      icon: <Zap className="text-blue-500" size={20} />,
      price: { monthly: 0, yearly: 0 },
      description: 'Basics for individuals.',
      features: [
        '60 mins transcription/mo',
        '10 AI Requests/month',
        'Basic summaries',
        'Email support'
      ],
      cta: 'Current Plan',
      highlighted: false
    },
    {
      id: 'pro',
      name: 'Pro',
      icon: <Crown className="text-echo-accent" size={20} />,
      price: { monthly: 999, yearly: 799 },
      description: 'Strategic analysis.',
      features: [
        '1,200 transcription mins/mo',
        '250 AI Requests/month',
        'Strategic Analysis',
        'Decision Intelligence',
        'Full Tracking'
      ],
      cta: 'Upgrade',
      highlighted: true,
      badge: 'Most Popular'
    },
    {
      id: 'team',
      name: 'Team',
      icon: <Users className="text-purple-500" size={20} />,
      price: { monthly: 2499, yearly: 1999 },
      description: 'Collaborative intel.',
      features: [
        '5,000 shared transcription mins/mo',
        '1500 AI Requests/month (shared)',
        'Team Collaboration',
        'Custom Knowledge',
        'Admin Dashboard'
      ],
      cta: 'Upgrade',
      highlighted: false
    },
    {
      id: 'enterprise',
      name: 'Enterprise',
      icon: <Building2 className="text-emerald-500" size={20} />,
      price: { monthly: 'Custom', yearly: 'Custom' },
      description: 'Organization scale.',
      features: [
        '25,000+ transcription mins/mo',
        '10000+ AI Requests/month (custom)',
        'SAML/SSO Authentication',
        'Dedicated Success Manager',
        'Security & Compliance',
        'Custom AI Integrations',
        'Custom limits available'
      ],
      cta: 'Contact Sales',
      highlighted: false
    }
  ];

  const onPlanAction = async (planId: string) => {
    if (!userProfile) return;

    const planHierarchy: Record<string, number> = {
      free: 0,
      pro: 1,
      team: 2,
      enterprise: 3
    };

    const currentPlan = (userProfile.plan || 'free').toLowerCase();
    const currentRank = planHierarchy[currentPlan] ?? 0;
    const targetRank = planHierarchy[planId] ?? 0;

    if (currentPlan === planId) {
      onClose();
      return;
    }

    if (targetRank < currentRank) {
      setDowngradeTarget(planId);
      return;
    }

    if (planId === 'enterprise') {
      onClose();
      navigate('/contact');
      return;
    }
    
    setLoading(true);
    await handleUpgrade(userProfile.uid, userProfile.email, userProfile.displayName || '', planId, billing);
    setLoading(false);
  };

  const onTopupClick = async (minutes: number, price: number) => {
    if (!userProfile) return;
    setLoading(true);
    await handleTopup(userProfile.uid, userProfile.email, userProfile.displayName || '', minutes, price);
    setLoading(false);
  };

  const onThinkingTopupClick = async (requests: number, price: number) => {
    if (!userProfile) return;
    setLoading(true);
    await handleThinkingTopup(userProfile.uid, userProfile.email, userProfile.displayName || '', requests, price);
    setLoading(false);
  };

  const currentPlan = (userProfile?.plan || 'free').toLowerCase();

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 overflow-y-auto">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-brand-primary/60 backdrop-blur-sm fixed"
          />
          
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className={`relative bg-white rounded-3xl w-full ${activeTab === 'plans' && (currentPlan === 'free' || currentPlan === 'pro') ? 'max-w-6xl' : 'max-w-3xl'} overflow-hidden shadow-2xl transition-all duration-500 z-10 my-8`}
          >
            {/* Header with Visual Decor */}
            {downgradeTarget && (
              <div className="absolute inset-0 bg-white z-50 flex items-center justify-center p-6 md:p-12 animate-in fade-in duration-200">
                <div className="max-w-xl w-full space-y-6 text-left">
                  <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                    <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center text-amber-500">
                      <AlertTriangle size={20} />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-slate-900 font-sans">Confirm Subscription Downgrade</h3>
                      <p className="text-xs text-slate-400 font-bold uppercase tracking-wider font-sans">Plan Transition Process</p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <p className="text-sm text-slate-600 leading-relaxed font-sans font-medium">
                      You are about to downgrade your subscription from <span className="font-bold text-brand-primary uppercase">{currentPlan}</span> to <span className="font-bold text-amber-600 uppercase">{downgradeTarget}</span>.
                    </p>

                    <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200/60 space-y-3">
                      <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-500 font-mono">New Plan Limits:</h4>
                      <ul className="text-xs text-slate-600 space-y-2 font-sans">
                        <li className="flex items-center gap-2">
                          <span className="w-1.5 h-1.5 bg-slate-400 rounded-full" />
                          <span>Transcription Limit: <strong>{PLAN_FEATURES[downgradeTarget as any]?.totalMinutesLimit} minutes</strong> (down from {PLAN_FEATURES[currentPlan as any]?.totalMinutesLimit} mins)</span>
                        </li>
                        <li className="flex items-center gap-2">
                          <span className="w-1.5 h-1.5 bg-slate-400 rounded-full" />
                          <span>AI Requests: <strong>{PLAN_FEATURES[downgradeTarget as any]?.thinkingLimit} requests</strong></span>
                        </li>
                        <li className="flex items-center gap-2">
                          <span className="w-1.5 h-1.5 bg-slate-400 rounded-full" />
                          <span>Max Audio File Duration: <strong>{PLAN_FEATURES[downgradeTarget as any]?.minutesPerFileLimit} mins / file</strong></span>
                        </li>
                      </ul>
                    </div>

                    <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200/60 space-y-3">
                      <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-500 font-mono">Effective Date:</h4>
                      <p className="text-xs text-slate-600 leading-relaxed font-sans font-medium">
                        Your downgrade takes effect <strong>immediately</strong>. However, all your existing transcripts, intelligence reports, and recordings will be <strong>preserved perfectly</strong>.
                      </p>
                    </div>

                    <div className="bg-amber-50/50 p-5 rounded-2xl border border-amber-100 space-y-3">
                      <h4 className="text-[10px] font-black uppercase tracking-widest text-amber-800 font-mono">Features To Be Removed:</h4>
                      <ul className="text-xs text-amber-900 space-y-1.5 font-sans font-medium">
                        {downgradeTarget === 'free' && (
                          <>
                            <li className="flex items-center gap-2">❌ Advanced Strategic AI Analysis</li>
                            <li className="flex items-center gap-2">❌ Decision Intelligence Reports & Action Trackers</li>
                            <li className="flex items-center gap-2">❌ Custom Voice Synthesis (Text-to-Speech)</li>
                            <li className="flex items-center gap-2">❌ Smart Calendar Integrations</li>
                            <li className="flex items-center gap-2">❌ Export options (TXT, PDF, Word, MP3)</li>
                          </>
                        )}
                        {downgradeTarget === 'pro' && (
                          <>
                            <li className="flex items-center gap-2">❌ Multi-user Shared Team Collaboration</li>
                            <li className="flex items-center gap-2">❌ Seat management options</li>
                            <li className="flex items-center gap-2">❌ Shared organization folders & workspaces</li>
                          </>
                        )}
                        {downgradeTarget === 'team' && (
                          <>
                            <li className="flex items-center gap-2">❌ Dedicated processing priority</li>
                            <li className="flex items-center gap-2">❌ Custom Service-Level Agreement (SLA) support</li>
                          </>
                        )}
                      </ul>
                    </div>

                    <p className="text-[10px] text-slate-400 font-bold leading-relaxed uppercase tracking-wider text-center font-mono pt-2">
                      We never delete your audio assets, projects, or summaries. Existing data is fully protected.
                    </p>
                  </div>

                  <div className="flex gap-3 pt-4 border-t border-slate-100">
                    <button
                      disabled={loading}
                      onClick={async () => {
                        setLoading(true);
                        try {
                          await handleDowngradePlan(userProfile!.uid, downgradeTarget);
                          setDowngradeTarget(null);
                          onClose();
                        } catch (err: any) {
                          toast.error(`Downgrade failed: ${err.message}`);
                        } finally {
                          setLoading(false);
                        }
                      }}
                      className="flex-1 py-3.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold uppercase tracking-widest transition-colors flex items-center justify-center gap-2 shadow-lg shadow-red-600/10 font-sans"
                    >
                      {loading ? 'Processing...' : 'Confirm Downgrade'}
                    </button>
                    <button
                      disabled={loading}
                      onClick={() => setDowngradeTarget(null)}
                      className="flex-1 py-3.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold uppercase tracking-widest transition-colors font-sans"
                    >
                      Keep Current Plan
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Header with Visual Decor */}
            <div className="bg-brand-primary p-6 md:p-8 text-center relative overflow-hidden">
              <div className="absolute top-[-20%] right-[-10%] w-48 h-48 bg-white/5 rounded-full blur-3xl" />
              <div className="absolute bottom-[-20%] left-[-10%] w-48 h-48 bg-blue-500/10 rounded-full blur-3xl" />
              
              <h2 className="text-xl md:text-2xl font-black text-white uppercase tracking-tight mb-1">Subscription Center</h2>
              <p className="text-white/60 text-[11px] font-bold tracking-[0.2em] uppercase">Scale your intelligence</p>
              
              <button 
                onClick={onClose}
                className="absolute top-4 right-4 p-2 text-white/40 hover:text-white transition-colors z-10"
              >
                <X size={20} />
              </button>
            </div>
            
            <div className="p-6 md:p-8 space-y-8">
              {/* Tab Switcher */}
              <div className="flex bg-slate-100 p-1 rounded-xl w-fit mx-auto gap-1">
                <button
                  onClick={() => setActiveTab('plans')}
                  className={`px-6 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${
                    activeTab === 'plans' ? 'bg-white text-brand-primary shadow-sm' : 'text-slate-400 hover:text-slate-600'
                  }`}
                >
                  Subscription Plans
                </button>
                <button
                  onClick={() => setActiveTab('topup')}
                  className={`px-6 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${
                    activeTab === 'topup' ? 'bg-white text-brand-primary shadow-sm' : 'text-slate-400 hover:text-slate-600'
                  }`}
                >
                  Minute Top-up
                </button>
                <button
                  onClick={() => setActiveTab('thinking-topup')}
                  className={`px-6 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${
                    activeTab === 'thinking-topup' ? 'bg-white text-brand-primary shadow-sm' : 'text-slate-400 hover:text-slate-600'
                  }`}
                >
                  AI Request Top-Up
                </button>
                <button
                  onClick={() => setActiveTab('billing')}
                  className={`px-6 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${
                    activeTab === 'billing' ? 'bg-white text-brand-primary shadow-sm' : 'text-slate-400 hover:text-slate-600'
                  }`}
                >
                  Billing History
                </button>
              </div>

              {activeTab === 'plans' && (
                <div className="space-y-6">
                  
                  {/* Global Subscription Status Bar */}
                  <div className="bg-slate-50 rounded-2xl p-5 border border-slate-200/60 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <div className="p-3 bg-brand-primary/5 rounded-xl border border-brand-primary/10">
                        {currentPlan === 'free' ? <Zap className="text-blue-500" size={24} /> : 
                         currentPlan === 'pro' ? <Crown className="text-echo-accent" size={24} /> : 
                         currentPlan === 'team' ? <Users className="text-purple-500" size={24} /> : 
                         <Building2 className="text-emerald-500" size={24} />}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Active Plan</span>
                          <span className="bg-emerald-100 text-emerald-800 text-[8px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider flex items-center gap-1">
                            <CheckCircle size={8} /> Active
                          </span>
                        </div>
                        <h4 className="text-lg font-black text-brand-primary uppercase tracking-tight">
                          {currentPlan === 'free' ? 'Free Tier' : 
                           currentPlan === 'pro' ? 'Pro Member' : 
                           currentPlan === 'team' ? 'Team Workspace' : 
                           'Enterprise global'}
                        </h4>
                      </div>
                    </div>
                    
                    <div className="flex flex-wrap gap-x-6 gap-y-2 text-left sm:text-right border-t sm:border-t-0 pt-3 sm:pt-0 border-slate-200">
                      <div>
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Billing Period</p>
                        <p className="text-xs font-black text-brand-primary uppercase tracking-tight">
                          {userProfile?.billingCycle || billing}ly
                        </p>
                      </div>
                      <div>
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Next Renewal</p>
                        <p className="text-xs font-black text-brand-primary uppercase tracking-tight">
                          {formatDate(userProfile?.nextRefreshDate)}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* PLANS COMPARISON GRID (For Free/Pro, or when Team/Enterprise user overrides to switch plans) */}
                  {(currentPlan === 'free' || currentPlan === 'pro' || showAllPlansOverride) && (
                    <div className="space-y-8">
                      {showAllPlansOverride && (
                        <div className="flex justify-center mb-2">
                          <button
                            onClick={() => setShowAllPlansOverride(false)}
                            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-brand-primary text-[10px] font-black uppercase tracking-widest rounded-xl transition-all border border-slate-200"
                          >
                            ← Back to Account Dashboard
                          </button>
                        </div>
                      )}

                      {/* Billing switch */}
                      <div className="flex items-center justify-center gap-4">
                        <span className={`text-[10px] font-black uppercase tracking-widest ${billing === 'monthly' ? 'text-brand-primary' : 'text-slate-400'}`}>Monthly</span>
                        <button 
                          onClick={() => setBilling(b => b === 'monthly' ? 'yearly' : 'monthly')}
                          className="w-12 h-6 bg-brand-primary/10 rounded-full p-1 relative transition-colors border border-brand-divider/20"
                        >
                          <motion.div 
                            animate={{ x: billing === 'monthly' ? 0 : 24 }}
                            className="w-4 h-4 bg-brand-primary rounded-full shadow-md"
                          />
                        </button>
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] font-black uppercase tracking-widest ${billing === 'yearly' ? 'text-brand-primary' : 'text-slate-400'}`}>Yearly</span>
                          <span className="bg-emerald-100 text-emerald-700 text-[8px] font-black px-2 py-0.5 rounded-full uppercase tracking-widest">Save 20%</span>
                        </div>
                      </div>

                      {/* Pricing Grid */}
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                        {plans.map((plan) => {
                          const planHierarchy: Record<string, number> = {
                            free: 0,
                            pro: 1,
                            team: 2,
                            enterprise: 3
                          };
                          
                          const currentRank = planHierarchy[currentPlan] ?? 0;
                          const targetRank = planHierarchy[plan.id] ?? 0;

                          const isCurrent = currentPlan === plan.id;
                          let ctaText = plan.cta;
                          let isClickable = true;

                          if (isCurrent) {
                            ctaText = 'Current Plan';
                            isClickable = false;
                          } else if (targetRank < currentRank) {
                            ctaText = `Downgrade to ${plan.name}`;
                            isClickable = true;
                          } else if (targetRank > currentRank) {
                            if (plan.id === 'enterprise') {
                              ctaText = 'Contact Sales';
                            } else {
                              ctaText = `Upgrade to ${plan.name}`;
                            }
                            isClickable = true;
                          }

                          return (
                            <div
                              key={plan.id}
                              className={`relative flex flex-col p-6 rounded-2xl border transition-all duration-300 ${
                                plan.highlighted 
                                  ? 'bg-brand-primary text-white border-brand-primary shadow-xl scale-105 z-10' 
                                  : 'bg-white border-brand-divider/20 text-brand-primary hover:shadow-lg'
                              }`}
                            >
                              {plan.badge && (
                                <div className="absolute top-[-12px] left-1/2 -translate-x-1/2 bg-echo-accent text-brand-primary text-[8px] font-black px-3 py-1 rounded-full uppercase tracking-widest shadow-md">
                                  {plan.badge}
                                </div>
                              )}

                              <div className="mb-6 flex items-center gap-3">
                                <div className={`p-2 rounded-xl ${plan.highlighted ? 'bg-white/10' : 'bg-brand-background'}`}>
                                  {plan.highlighted 
                                    ? React.cloneElement(plan.icon as React.ReactElement, { className: '!text-[#D7B6FF]' })
                                    : plan.icon
                                  }
                                </div>
                                <h3 className="text-sm font-black uppercase tracking-[0.15em]">{plan.name}</h3>
                              </div>

                              <div className="mb-6">
                                <div className="flex items-baseline gap-1">
                                  <span className="text-2xl font-black">
                                    {typeof plan.price[billing] === 'number' ? `₹${plan.price[billing]}` : plan.price[billing]}
                                  </span>
                                  {typeof plan.price[billing] === 'number' && (
                                    <span className={`text-[10px] font-bold uppercase tracking-widest ${plan.highlighted ? 'text-white/60' : 'text-slate-400'}`}>/mo</span>
                                  )}
                                </div>
                                <p className={`text-[11px] font-medium mt-1 leading-tight ${plan.highlighted ? 'text-white/70' : 'text-slate-500'}`}>
                                  {plan.description}
                                </p>
                              </div>

                              <div className="space-y-3 mb-8 flex-1">
                                {plan.features.map((feature, i) => (
                                  <div key={i} className="flex items-start gap-2">
                                    <div className={`shrink-0 mt-0.5 ${plan.highlighted ? '!text-[#D7B6FF]' : 'text-brand-primary'}`}>
                                      <Check size={12} />
                                    </div>
                                    <span className={`text-[11px] font-semibold text-left leading-tight ${plan.highlighted ? 'text-white/90' : 'text-slate-600'}`}>
                                      {feature}
                                    </span>
                                  </div>
                                ))}
                              </div>

                              <button
                                onClick={() => isClickable && onPlanAction(plan.id)}
                                disabled={loading || !isClickable}
                                className={`w-full py-3 rounded-lg font-black tracking-[0.15em] text-[9px] uppercase transition-all shadow-md active:scale-95 ${
                                  isCurrent
                                    ? (plan.highlighted ? 'bg-white/20 text-white cursor-default' : 'bg-slate-50 text-slate-400 cursor-default border border-slate-200')
                                    : (plan.highlighted ? 'bg-echo-accent text-brand-primary hover:bg-white' : 'bg-brand-primary text-white hover:bg-brand-secondary')
                                }`}
                              >
                                {loading && !isCurrent ? '...' : ctaText}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                      
                      <p className="text-center text-[9px] text-slate-400 font-bold leading-relaxed px-4 uppercase tracking-widest">
                        Secure payment via Razorpay. Upgrade or downgrade anytime.
                      </p>
                    </div>
                  )}

                  {/* TEAM WORKSPACE SPECIFIC VIEW */}
                  {currentPlan === 'team' && !showAllPlansOverride && (
                    <div className="space-y-8 text-left">
                      
                      {/* Grid for Seat Management & Billing Details */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        
                        {/* Manage Seats Section */}
                        <div className="bg-slate-50/50 p-6 rounded-2xl border border-slate-200/60 space-y-4">
                          <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                            <h5 className="text-xs font-black text-brand-primary uppercase tracking-widest flex items-center gap-2">
                              <Users size={14} className="text-purple-500" />
                              <span>Manage Workspace Seats</span>
                            </h5>
                            <span className="text-[10px] font-black bg-purple-100 text-purple-800 px-2.5 py-1 rounded-full uppercase tracking-wider">
                              {teamMembers.length} / 10 Seats
                            </span>
                          </div>

                          {/* Invite Form */}
                          <form onSubmit={handleAddMember} className="space-y-3">
                            <div className="grid grid-cols-2 gap-2">
                              <input 
                                type="text"
                                placeholder="Full Name"
                                value={newMemberName}
                                onChange={(e) => setNewMemberName(e.target.value)}
                                className="px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-brand-primary"
                              />
                              <input 
                                type="email"
                                placeholder="Email Address"
                                value={newMemberEmail}
                                onChange={(e) => setNewMemberEmail(e.target.value)}
                                className="px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-brand-primary"
                              />
                            </div>
                            <div className="flex gap-2">
                              <select
                                value={newMemberRole}
                                onChange={(e) => setNewMemberRole(e.target.value as 'Editor' | 'Viewer')}
                                className="px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white text-slate-600 focus:outline-none focus:border-brand-primary shrink-0"
                              >
                                <option value="Editor">Editor</option>
                                <option value="Viewer">Viewer</option>
                              </select>
                              <button
                                type="submit"
                                className="flex-1 bg-brand-primary text-white hover:bg-brand-secondary text-[10px] font-black uppercase tracking-widest py-2 rounded-lg flex items-center justify-center gap-2 shadow"
                              >
                                <UserPlus size={12} />
                                <span>Invite Colleague</span>
                              </button>
                            </div>
                          </form>

                          {/* Seat Allocation List */}
                          <div className="space-y-2 max-h-[160px] overflow-y-auto custom-scrollbar pt-2">
                            {teamMembers.map((member, idx) => (
                              <div key={idx} className="flex items-center justify-between p-2.5 bg-white border border-slate-100 rounded-xl hover:shadow-sm transition-all">
                                <div className="leading-tight">
                                  <p className="text-xs font-bold text-slate-800">{member.name}</p>
                                  <p className="text-[10px] text-slate-400">{member.email}</p>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-[8px] font-black px-2 py-0.5 bg-slate-100 text-slate-600 rounded uppercase tracking-wider">
                                    {member.role}
                                  </span>
                                  {member.role !== 'Owner' && (
                                    <button 
                                      onClick={() => handleRemoveMember(member.email)}
                                      className="text-slate-300 hover:text-red-500 transition-colors p-1"
                                      title="Remove from Workspace"
                                    >
                                      <X size={12} />
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* View Billing & Payment Methods */}
                        <div className="bg-slate-50/50 p-6 rounded-2xl border border-slate-200/60 space-y-4">
                          <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                            <h5 className="text-xs font-black text-brand-primary uppercase tracking-widest flex items-center gap-2">
                              <CreditCard size={14} className="text-brand-primary" />
                              <span>Billing & Invoices</span>
                            </h5>
                          </div>

                          {/* Payment Card */}
                          <div className="bg-brand-primary text-white p-4 rounded-xl relative overflow-hidden shadow-md flex justify-between items-center">
                            <div className="space-y-1 z-10 relative">
                              <p className="text-[9px] uppercase tracking-widest text-white/50 font-bold">Primary Card</p>
                              <p className="text-sm font-bold tracking-widest">•••• •••• •••• 4242</p>
                              <p className="text-[9px] text-white/75">Expires 12 / 2028</p>
                            </div>
                            <div className="text-right z-10 relative">
                              <span className="bg-white/10 text-white text-[8px] font-black px-2.5 py-1 rounded-lg uppercase tracking-wider">
                                VISA
                              </span>
                            </div>
                            <div className="absolute top-[-50%] right-[-10%] w-32 h-32 bg-white/5 rounded-full blur-2xl" />
                          </div>

                          {/* Invoice History */}
                          <div className="space-y-2 pt-2">
                            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Recent Transactions</p>
                            
                            {[
                              { id: 'INV-2026-003', date: 'July 01, 2026', amount: '₹2,499.00' },
                              { id: 'INV-2026-002', date: 'June 01, 2026', amount: '₹2,499.00' }
                            ].map((inv) => (
                              <div key={inv.id} className="flex items-center justify-between p-2 bg-white border border-slate-100 rounded-xl">
                                <div className="leading-tight">
                                  <p className="text-[10px] font-black text-brand-primary uppercase tracking-wider">{inv.id}</p>
                                  <p className="text-[9px] text-slate-400">{inv.date}</p>
                                </div>
                                <div className="flex items-center gap-3">
                                  <span className="text-xs font-black text-brand-primary">{inv.amount}</span>
                                  <button 
                                    onClick={() => toast.success("Invoice PDF download started.")}
                                    className="p-1.5 text-slate-400 hover:text-brand-primary bg-slate-50 rounded-lg hover:bg-slate-100 transition-all border border-slate-100"
                                  >
                                    <Download size={10} />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                      </div>

                      {/* Upgrade CTA inside Team Plan */}
                      <div className="bg-gradient-to-r from-purple-500/10 to-blue-500/10 p-6 rounded-2xl border border-purple-100 flex flex-col md:flex-row items-center justify-between gap-4">
                        <div className="space-y-1">
                          <h6 className="text-sm font-black text-brand-primary uppercase tracking-tight flex items-center gap-2">
                            <Building2 size={16} className="text-emerald-500" />
                            <span>Scale To Enterprise</span>
                          </h6>
                          <p className="text-[11px] text-slate-500 leading-normal max-w-lg">
                            Need bespoke compliance parameters, Single Sign-On (SAML/SSO), unlimited transcription, or dedicated accounts? Unlock the absolute potential of EchoNote.
                          </p>
                        </div>
                        <button
                          onClick={() => { onClose(); navigate('/contact'); }}
                          className="w-full md:w-auto px-6 py-3 bg-brand-primary hover:bg-brand-secondary text-white text-[10px] font-black uppercase tracking-widest rounded-xl shadow flex items-center justify-center gap-2 shrink-0 transition-transform hover:scale-105"
                        >
                          <span>Upgrade to Enterprise</span>
                          <ArrowUpRight size={12} />
                        </button>
                      </div>

                      <div className="flex justify-between items-center pt-2">
                        <button
                          onClick={() => setShowAllPlansOverride(true)}
                          className="text-[10px] font-black text-slate-400 hover:text-brand-primary uppercase tracking-widest flex items-center gap-1.5 transition-all"
                        >
                          <Sliders size={12} />
                          <span>Switch or Downgrade Plan</span>
                        </button>
                      </div>

                    </div>
                  )}

                  {/* ENTERPRISE SPECIFIC VIEW */}
                  {currentPlan === 'enterprise' && !showAllPlansOverride && (
                    <div className="space-y-8 text-left">
                      
                      {/* Enterprise Panel Information instead of Upgrade CTA */}
                      <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200/60 grid grid-cols-1 md:grid-cols-2 gap-6">
                        
                        {/* Company Details */}
                        <div className="space-y-4">
                          <h5 className="text-xs font-black text-brand-primary uppercase tracking-widest flex items-center gap-2">
                            <ShieldCheck size={14} className="text-emerald-500" />
                            <span>Enterprise Architecture</span>
                          </h5>
                          
                          <div className="space-y-3 pt-2">
                            <div className="flex justify-between items-center text-xs border-b border-slate-100 pb-2">
                              <span className="text-slate-400 font-semibold">Security Level</span>
                              <span className="text-emerald-700 font-extrabold bg-emerald-100 px-2.5 py-0.5 rounded-full text-[9px] uppercase tracking-wider">SOC2 COMPLIANT</span>
                            </div>
                            <div className="flex justify-between items-center text-xs border-b border-slate-100 pb-2">
                              <span className="text-slate-400 font-semibold">Single Sign-On (SSO)</span>
                              <span className="text-blue-700 font-extrabold bg-blue-100 px-2.5 py-0.5 rounded-full text-[9px] uppercase tracking-wider">SAML 2.0 ACTIVE</span>
                            </div>
                            <div className="flex justify-between items-center text-xs border-b border-slate-100 pb-2">
                              <span className="text-slate-400 font-semibold">SLA Tier</span>
                              <span className="text-brand-primary font-black uppercase tracking-widest text-[9px]">Priority 1 Hour Response</span>
                            </div>
                            <div className="flex justify-between items-center text-xs pb-1">
                              <span className="text-slate-400 font-semibold">Enterprise Org Seats</span>
                              <span className="text-slate-800 font-bold">Unlimited Active Seats</span>
                            </div>
                          </div>
                        </div>

                        {/* Contact CSM Card */}
                        <div className="bg-brand-primary text-white p-6 rounded-2xl shadow-xl flex flex-col justify-between relative overflow-hidden">
                          <div className="absolute top-[-20%] right-[-15%] w-32 h-32 bg-white/5 rounded-full blur-3xl" />
                          
                          <div className="space-y-3 relative z-10">
                            <h6 className="text-xs font-black text-[#D7B6FF] uppercase tracking-widest">Your Success Partner</h6>
                            <div className="flex items-center gap-3">
                              <div className="w-12 h-12 rounded-full bg-[#D7B6FF] text-brand-primary font-black text-sm flex items-center justify-center uppercase shadow-md border-2 border-white">
                                SJ
                              </div>
                              <div>
                                <p className="text-sm font-black tracking-tight">Sarah Jenkins</p>
                                <p className="text-[10px] text-white/60">Dedicated Account Manager</p>
                              </div>
                            </div>
                          </div>

                          <div className="pt-6 relative z-10 space-y-2">
                            <a 
                              href="mailto:sarah.jenkins@echonote.com"
                              className="w-full bg-[#D7B6FF] hover:bg-white text-brand-primary text-[10px] font-black uppercase tracking-widest py-3 rounded-xl flex items-center justify-center gap-2 transition-all shadow-md"
                            >
                              <Mail size={12} />
                              <span>Contact Manager</span>
                            </a>
                            <button
                              onClick={() => { onClose(); navigate('/contact'); }}
                              className="w-full bg-white/10 hover:bg-white/20 text-white border border-white/10 text-[10px] font-black uppercase tracking-widest py-2.5 rounded-xl flex items-center justify-center gap-2 transition-all"
                            >
                              <span>Manage Enterprise settings</span>
                            </button>
                          </div>
                        </div>

                      </div>

                      <div className="flex justify-between items-center pt-2">
                        <button
                          onClick={() => setShowAllPlansOverride(true)}
                          className="text-[10px] font-black text-slate-400 hover:text-brand-primary uppercase tracking-widest flex items-center gap-1.5 transition-all"
                        >
                          <Sliders size={12} />
                          <span>Switch or Downgrade Plan</span>
                        </button>
                      </div>

                    </div>
                  )}

                </div>
              )}

              {activeTab === 'topup' && (
                <div className="space-y-6">
                  <div className="text-center mb-6">
                    <h3 className="text-xl font-bold text-brand-primary">Need more minutes?</h3>
                    <p className="text-sm text-slate-500 font-medium">Add credits instantly without changing your plan.</p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {[
                      { mins: 100, price: 99, popular: false },
                      { mins: 350, price: 299, popular: true }
                    ].map((card) => (
                      <div 
                        key={card.mins}
                        className={`p-6 rounded-2xl border-2 transition-all group overflow-hidden relative ${
                          card.popular ? 'border-brand-primary bg-brand-primary/5' : 'border-slate-100 bg-white'
                        }`}
                      >
                        {card.popular && (
                          <div className="absolute top-0 right-0 bg-brand-primary text-white text-[8px] font-black px-3 py-1 rounded-bl-xl uppercase tracking-widest">
                            Best Value
                          </div>
                        )}
                        <div className="flex flex-col items-center text-center space-y-4">
                          <div className="w-12 h-12 rounded-full bg-brand-primary/10 flex items-center justify-center text-brand-primary">
                            <PlusCircle size={24} />
                          </div>
                          <div>
                            <p className="text-2xl font-black text-brand-primary">+{card.mins}</p>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Minutes</p>
                          </div>
                          <div className="text-xl font-black text-brand-primary">₹{card.price}</div>
                          <button
                            onClick={() => onTopupClick(card.mins, card.price)}
                            disabled={loading}
                            className={`w-full py-3 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
                              card.popular 
                                ? 'bg-brand-primary text-white shadow-lg shadow-brand-primary/20 hover:scale-105' 
                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                            }`}
                          >
                            {loading ? 'Processing...' : 'Buy Now'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="bg-amber-50 p-4 rounded-xl border border-amber-100 flex gap-3">
                    <div className="shrink-0 text-amber-500 mt-1">
                      <Sparkles size={16} />
                    </div>
                    <p className="text-[11px] font-medium text-amber-900 leading-relaxed text-left">
                      <strong>Note:</strong> Top-up minutes do not expire and will be used after your monthly plan minutes are exhausted.
                    </p>
                  </div>
                </div>
              )}

              {activeTab === 'thinking-topup' && (
                <div className="space-y-6">
                  <div className="text-center mb-6">
                    <h3 className="text-xl font-bold text-brand-primary">Need More AI Requests?</h3>
                    <p className="text-sm text-slate-500 font-medium">Purchase additional AI Requests for deeper analysis, strategic reasoning, decision intelligence, meeting intelligence, and all other AI-powered features.</p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {[
                      { requests: 100, price: 99, popular: false, badge: 'Starter' },
                      { requests: 500, price: 399, popular: true, badge: 'Professional' },
                      { requests: 1500, price: 999, popular: false, badge: 'Business' }
                    ].map((card) => (
                      <div 
                        key={card.requests}
                        className={`p-6 rounded-2xl border-2 transition-all group overflow-hidden relative flex flex-col justify-between ${
                          card.popular ? 'border-brand-primary bg-brand-primary/5' : 'border-slate-100 bg-white'
                        }`}
                      >
                        {card.popular && (
                          <div className="absolute top-0 right-0 bg-brand-primary text-white text-[8px] font-black px-3 py-1 rounded-bl-xl uppercase tracking-widest">
                            Most Popular
                          </div>
                        )}
                        <div className="flex flex-col items-center text-center space-y-4">
                          <div className="w-12 h-12 rounded-full bg-brand-primary/10 flex items-center justify-center text-brand-primary">
                            <Zap size={24} />
                          </div>
                          <div>
                            <p className="text-[10px] font-black text-brand-primary/60 uppercase tracking-wider">{card.badge}</p>
                            <p className="text-2xl font-black text-brand-primary">+{card.requests}</p>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">AI Requests</p>
                          </div>
                          <div className="text-xl font-black text-brand-primary">₹{card.price}</div>
                          <button
                            onClick={() => onThinkingTopupClick(card.requests, card.price)}
                            disabled={loading}
                            className={`w-full py-3 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
                              card.popular 
                                ? 'bg-brand-primary text-white shadow-lg shadow-brand-primary/20 hover:scale-105' 
                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                            }`}
                          >
                            {loading ? 'Processing...' : 'Buy Now'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="bg-amber-50 p-4 rounded-xl border border-amber-100 flex gap-3">
                    <div className="shrink-0 text-amber-500 mt-1">
                      <Sparkles size={16} />
                    </div>
                    <p className="text-[11px] font-medium text-amber-900 leading-relaxed text-left">
                      Purchased AI Requests never expire and are automatically consumed only after your monthly AI Request allocation has been exhausted.
                    </p>
                  </div>
                </div>
              )}

              {activeTab === 'billing' && (
                <div className="space-y-6 animate-in fade-in duration-300 text-left">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                    <div>
                      <h3 className="text-base font-black text-brand-primary uppercase tracking-tight flex items-center gap-2">
                        <History size={18} className="text-brand-primary" />
                        <span>Billing & Invoice History</span>
                      </h3>
                      <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider mt-0.5">View your past transactions and download invoice receipts</p>
                    </div>
                  </div>

                  {loadingTransactions ? (
                    <div className="flex flex-col items-center justify-center py-12 space-y-4">
                      <div className="w-8 h-8 border-4 border-brand-primary/10 border-t-brand-primary rounded-full animate-spin" />
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Loading invoice logs...</p>
                    </div>
                  ) : transactions.length === 0 ? (
                    <div className="bg-slate-50 border border-slate-100 rounded-2xl p-8 text-center space-y-4">
                      <div className="w-12 h-12 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center mx-auto">
                        <Receipt size={24} />
                      </div>
                      <div className="space-y-1">
                        <h4 className="text-sm font-black text-slate-800 uppercase tracking-tight">No Billing History</h4>
                        <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
                          We couldn't find any transaction history for your account. When you upgrade to Pro or Team or buy minute top-ups, your invoices will appear here.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {/* Active Status Header Card */}
                      <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200/60 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="p-2.5 bg-brand-primary text-white rounded-xl">
                            <CreditCard size={18} />
                          </div>
                          <div>
                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-wider">Primary Card Status</p>
                            <p className="text-xs font-bold text-slate-800">VISA ending in •••• 4242</p>
                          </div>
                        </div>
                        <span className="bg-emerald-100 text-emerald-800 text-[9px] font-black px-3 py-1 rounded-full uppercase tracking-wider flex items-center gap-1.5">
                          <CheckCircle2 size={10} className="text-emerald-600" /> Active
                        </span>
                      </div>

                      {/* List of Invoices */}
                      <div className="space-y-2 max-h-[360px] overflow-y-auto custom-scrollbar pr-1">
                        {transactions.map((tx) => {
                          const formattedDate = new Date(tx.createdAt).toLocaleDateString('en-IN', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric'
                          });
                          const isTopup = tx.type === 'topup';

                          return (
                            <div 
                              key={tx.id} 
                              className="flex items-center justify-between p-3.5 bg-white border border-slate-100 rounded-2xl hover:shadow-md transition-all duration-300"
                            >
                              <div className="flex items-center gap-3">
                                <div className={`p-2 rounded-xl shrink-0 ${isTopup ? 'bg-amber-50 text-amber-500' : 'bg-[#D7B6FF]/25 text-brand-primary'}`}>
                                  {isTopup ? <PlusCircle size={16} /> : <Crown size={16} />}
                                </div>
                                <div className="leading-snug text-left">
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs font-black text-slate-800 uppercase tracking-tight">
                                      {isTopup ? `+${tx.minutes} Mins Top-up` : `${tx.planId.toUpperCase()} Subscription`}
                                    </span>
                                    <span className="text-[8px] font-black bg-emerald-50 text-emerald-700 border border-emerald-100 px-2 py-0.5 rounded uppercase tracking-wider">
                                      {tx.status}
                                    </span>
                                  </div>
                                  <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider mt-0.5">{formattedDate} • Ref: {tx.paymentId.substring(0, 12)}</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-3">
                                <span className="text-sm font-black text-brand-primary">₹{tx.amount.toLocaleString('en-IN')}.00</span>
                                <button 
                                  onClick={() => {
                                    toast.success(`Downloading invoice receipt_${tx.paymentId.substring(0,8)}.pdf`);
                                  }}
                                  className="p-2 text-slate-400 hover:text-brand-primary bg-slate-50 rounded-xl hover:bg-slate-100 transition-all border border-slate-100"
                                  title="Download Invoice PDF"
                                >
                                  <Download size={12} />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

export default SubscriptionModal;
