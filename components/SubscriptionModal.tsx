
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Check, Crown, X, Sparkles, Zap, ShieldCheck, PlusCircle, Building2, Users } from 'lucide-react';
import { UserProfile } from '../types';
import { handleUpgrade, handleTopup } from '../services/subscriptionService';
import { toast } from 'sonner';

interface SubscriptionModalProps {
  isOpen: boolean;
  onClose: () => void;
  userProfile?: UserProfile;
}

const SubscriptionModal: React.FC<SubscriptionModalProps> = ({ isOpen, onClose, userProfile }) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'plans' | 'topup'>('plans');
  const [billing, setBilling] = useState<'monthly' | 'yearly'>('monthly');

  const plans = [
    {
      id: 'free',
      name: 'Free',
      icon: <Zap className="text-blue-500" size={20} />,
      price: { monthly: 0, yearly: 0 },
      description: 'Basics for individuals.',
      features: ['60 mins transcription/mo', '10 Thinking Engine reqs', 'Basic summaries', 'Email support'],
      cta: 'Current Plan',
      highlighted: false
    },
    {
      id: 'pro',
      name: 'Pro',
      icon: <Crown className="text-echo-accent" size={20} />,
      price: { monthly: 999, yearly: 799 },
      description: 'Strategic analysis.',
      features: ['1200 mins transcription/mo', 'Unlimited Thinking', 'Strategic Analysis', 'Full Tracking'],
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
      features: ['5000 mins transcription/mo', 'Team Collaboration', 'Custom Knowledge', 'Admin Dashboard'],
      cta: 'Upgrade',
      highlighted: false
    },
    {
      id: 'enterprise',
      name: 'Enterprise',
      icon: <Building2 className="text-emerald-500" size={20} />,
      price: { monthly: 'Custom', yearly: 'Custom' },
      description: 'Organization scale.',
      features: ['Unlimited minutes', 'SAML/SSO Auth', 'Dedicated Support', 'Security compliance'],
      cta: 'Contact',
      highlighted: false
    }
  ];

  const onPlanAction = async (planId: string) => {
    if (planId === 'free' || userProfile?.plan === planId) {
      onClose();
      return;
    }
    if (planId === 'enterprise') {
      onClose();
      navigate('/contact');
      return;
    }
    if (!userProfile) return;
    
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

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-brand-primary/60 backdrop-blur-sm"
          />
          
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className={`relative bg-white rounded-3xl w-full ${activeTab === 'plans' ? 'max-w-6xl' : 'max-w-xl'} overflow-hidden shadow-2xl transition-all duration-500`}
          >
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
              <div className="flex bg-slate-100 p-1 rounded-xl w-fit mx-auto">
                <button
                  onClick={() => setActiveTab('plans')}
                  className={`px-8 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${
                    activeTab === 'plans' ? 'bg-white text-brand-primary shadow-sm' : 'text-slate-400 hover:text-slate-600'
                  }`}
                >
                  Subscription Plans
                </button>
                <button
                  onClick={() => setActiveTab('topup')}
                  className={`px-8 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${
                    activeTab === 'topup' ? 'bg-white text-brand-primary shadow-sm' : 'text-slate-400 hover:text-slate-600'
                  }`}
                >
                  Minute Top-up
                </button>
              </div>

              {activeTab === 'plans' ? (
                <div className="space-y-8">
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
                    {plans.map((plan) => (
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
                            <span className="text-2xl font-black">{typeof plan.price[billing] === 'number' ? `₹${plan.price[billing]}` : plan.price[billing]}</span>
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
                          onClick={() => onPlanAction(plan.id)}
                          disabled={loading}
                          className={`w-full py-3 rounded-lg font-black tracking-[0.15em] text-[9px] uppercase transition-all shadow-md active:scale-95 ${
                            userProfile?.plan === plan.id
                              ? (plan.highlighted ? 'bg-white/20 text-white cursor-default' : 'bg-slate-50 text-slate-400 cursor-default border border-slate-200')
                              : (plan.highlighted ? 'bg-echo-accent text-brand-primary hover:bg-white' : 'bg-brand-primary text-white hover:bg-brand-secondary')
                          }`}
                        >
                          {userProfile?.plan === plan.id ? 'Current Plan' : (loading ? '...' : plan.cta)}
                        </button>
                      </div>
                    ))}
                  </div>
                  
                  <p className="text-center text-[9px] text-slate-400 font-bold leading-relaxed px-4 uppercase tracking-widest">
                    Secure payment via Razorpay. Upgrade or downgrade anytime.
                  </p>
                </div>
              ) : (
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
                    <p className="text-[11px] font-medium text-amber-900 leading-relaxed">
                      <strong>Note:</strong> Top-up minutes do not expire and will be used after your monthly plan minutes are exhausted.
                    </p>
                  </div>
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
