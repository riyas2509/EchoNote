
import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Check, Crown, Zap, Sparkles, Building2, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useFirebase } from '../components/FirebaseProvider';
import { handleUpgrade, handleTopup } from '../services/subscriptionService';
import LandingNavbar from '../components/LandingNavbar';
import LandingFooter from '../components/LandingFooter';
import { AuthStatus } from '../types';

const PricingPage: React.FC = () => {
  const navigate = useNavigate();
  const { user, profile, isAuthReady } = useFirebase();
  const [billing, setBilling] = useState<'monthly' | 'yearly'>('monthly');

  const plans = [
    {
      id: 'free',
      name: 'Free',
      icon: <Zap className="text-blue-500" size={24} />,
      price: { monthly: 0, yearly: 0 },
      description: 'Perfect for individuals starting out with AI intelligence.',
      features: [
        '60 minutes transcription/mo',
        '10 Thinking Engine requests',
        'Decision Intelligence history',
        'Basic meeting summaries',
        'Email support'
      ],
      cta: 'Dashboard',
      highlighted: false
    },
    {
      id: 'pro',
      name: 'Pro',
      icon: <Crown className="text-echo-accent" size={24} />,
      price: { monthly: 999, yearly: 799 },
      description: 'For professionals needing deep strategic insights.',
      features: [
        '1200 minutes transcription/mo',
        'Unlimited Thinking Engine',
        'Advanced Strategic Analysis',
        'Full Execution Tracking',
        'Priority AI Processing',
        'Smart Reminders'
      ],
      cta: 'Upgrade',
      highlighted: true,
      badge: 'Most Popular'
    },
    {
      id: 'team',
      name: 'Team',
      icon: <Users className="text-purple-500" size={24} />,
      price: { monthly: 2499, yearly: 1999 },
      description: 'Collaborative intelligence for small teams.',
      features: [
        '5000 minutes transcription/mo',
        'Shared Thinking History',
        'Team Collaboration Tools',
        'Project Management Integration',
        'Custom Knowledge Base',
        'Admin Dashboard'
      ],
      cta: 'Upgrade',
      highlighted: false
    },
    {
      id: 'enterprise',
      name: 'Enterprise',
      icon: <Building2 className="text-emerald-500" size={24} />,
      price: { monthly: 'Custom', yearly: 'Custom' },
      description: 'Scale intelligence across your organization.',
      features: [
        'Unlimited Transcription',
        'SAML/SSO Authentication',
        'Dedicated Success Manager',
        'On-premise deployment options',
        'Custom AI model fine-tuning',
        'Advanced Security compliance'
      ],
      cta: 'Contact Sales',
      highlighted: false
    }
  ];

  const onPlanAction = (planId: string) => {
    if (planId === 'free') {
      navigate('/app');
      return;
    }
    if (planId === 'enterprise') {
      navigate('/contact');
      return;
    }

    if (!user) {
      navigate('/auth');
      return;
    }

    handleUpgrade(user.uid, user.email || '', profile?.displayName || '', planId, billing);
  };

  return (
    <div className="min-h-screen bg-brand-background flex flex-col">
      <LandingNavbar onLogin={() => navigate('/auth')} onStartFree={() => navigate('/app')} authStatus={user ? AuthStatus.LOGGED_IN : AuthStatus.GUEST} onGoToDashboard={() => navigate('/app')} />
      
      <main className="flex-1 py-24 px-6">
        <div className="max-w-7xl mx-auto text-center space-y-12">
          {/* Header */}
          <div className="space-y-4 max-w-2xl mx-auto">
            <h1 className="text-4xl md:text-6xl font-black text-brand-primary tracking-tight">Simple, Transparent Pricing</h1>
            <p className="text-lg text-slate-500 font-medium leading-relaxed">
              Choose the plan that fits your intelligence needs. All plans include our core AI transcription engine.
            </p>
          </div>

          {/* Billing Switch */}
          <div className="flex items-center justify-center gap-4">
            <span className={`text-sm font-bold uppercase tracking-widest ${billing === 'monthly' ? 'text-brand-primary' : 'text-slate-400'}`}>Monthly</span>
            <button 
              onClick={() => setBilling(b => b === 'monthly' ? 'yearly' : 'monthly')}
              className="w-14 h-8 bg-brand-primary/10 rounded-full p-1 relative transition-colors border border-brand-divider/20"
            >
              <motion.div 
                animate={{ x: billing === 'monthly' ? 0 : 24 }}
                className="w-6 h-6 bg-brand-primary rounded-full shadow-md shadow-brand-primary/20"
              />
            </button>
            <div className="flex items-center gap-2">
              <span className={`text-sm font-bold uppercase tracking-widest ${billing === 'yearly' ? 'text-brand-primary' : 'text-slate-400'}`}>Yearly</span>
              <span className="bg-emerald-100 text-emerald-700 text-[10px] font-black px-2 py-1 rounded-full uppercase tracking-widest">Save 20%</span>
            </div>
          </div>

          {/* Pricing Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 pt-12">
            {plans.map((plan) => (
              <motion.div
                key={plan.id}
                whileHover={{ y: -10 }}
                className={`relative flex flex-col p-8 rounded-3xl border transition-all duration-300 ${
                  plan.highlighted 
                    ? 'bg-brand-primary text-white border-brand-primary shadow-2xl scale-105 z-10' 
                    : 'bg-white border-brand-divider/20 text-brand-primary hover:shadow-xl'
                }`}
              >
                {plan.badge && (
                  <div className="absolute top-[-16px] left-1/2 -translate-x-1/2 bg-echo-accent text-brand-primary text-[10px] font-black px-4 py-1.5 rounded-full uppercase tracking-[0.2em] shadow-lg">
                    {plan.badge}
                  </div>
                )}

                <div className="mb-8 flex items-center gap-3">
                  <div className={`p-3 rounded-2xl ${plan.highlighted ? 'bg-white/10 shadow-inner' : 'bg-brand-background'}`}>
                    {plan.icon}
                  </div>
                  <h3 className="text-xl font-bold uppercase tracking-widest">{plan.name}</h3>
                </div>

                <div className="mb-6 h-20">
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-black">{typeof plan.price[billing] === 'number' ? `₹${plan.price[billing]}` : plan.price[billing]}</span>
                    {typeof plan.price[billing] === 'number' && (
                      <span className={`text-sm font-bold uppercase tracking-widest ${plan.highlighted ? 'text-white/60' : 'text-slate-400'}`}>/mo</span>
                    )}
                  </div>
                  <p className={`text-sm font-medium mt-2 leading-tight ${plan.highlighted ? 'text-white/70' : 'text-slate-500'}`}>
                    {plan.description}
                  </p>
                </div>

                <div className="space-y-4 mb-10 flex-1">
                  {plan.features.map((feature, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <div className={`shrink-0 mt-1 ${plan.highlighted ? 'text-echo-accent' : 'text-brand-primary'}`}>
                        <Check size={14} />
                      </div>
                      <span className={`text-[13px] font-semibold text-left leading-tight ${plan.highlighted ? 'text-white/90' : 'text-slate-600'}`}>
                        {feature}
                      </span>
                    </div>
                  ))}
                </div>

                <button
                  onClick={() => onPlanAction(plan.id)}
                  className={`w-full py-4 rounded-xl font-black tracking-[0.2em] text-[11px] uppercase transition-all shadow-lg active:scale-95 ${
                    plan.highlighted 
                      ? 'bg-echo-accent text-brand-primary hover:bg-white' 
                      : 'bg-brand-primary text-white hover:bg-brand-secondary'
                  }`}
                >
                  {plan.cta}
                </button>
              </motion.div>
            ))}
          </div>

          {/* Top-up Section */}
          <div className="pt-24 space-y-12">
            <div className="space-y-4 max-w-2xl mx-auto">
              <h2 className="text-3xl font-black text-brand-primary uppercase tracking-tight">One-time Top-ups</h2>
              <p className="text-slate-500 font-medium">Running low on storage? Buy extra minutes instantly. No subscription required.</p>
            </div>

            <div className="flex flex-wrap justify-center gap-8">
              {[
                { mins: 100, price: 99, icon: <Zap size={24} className="text-blue-500" /> },
                { mins: 350, price: 299, icon: <Sparkles size={24} className="text-echo-accent" />, popular: true }
              ].map((topup) => (
                <motion.div
                  key={topup.mins}
                  whileHover={{ y: -5 }}
                  className={`w-full max-w-[320px] p-8 rounded-3xl border-2 bg-white relative overflow-hidden transition-all duration-300 ${
                    topup.popular ? 'border-brand-primary shadow-xl scale-105' : 'border-slate-100 hover:border-brand-divider shadow-md'
                  }`}
                >
                  {topup.popular && (
                    <div className="absolute top-0 right-0 bg-brand-primary text-white text-[10px] font-black px-4 py-1.5 rounded-bl-2xl uppercase tracking-widest">
                      Most Selected
                    </div>
                  )}
                  
                  <div className="flex flex-col items-center text-center space-y-6">
                    <div className="p-4 rounded-2xl bg-brand-background shadow-inner">
                      {topup.icon}
                    </div>
                    <div>
                      <h4 className="text-3xl font-black text-brand-primary">+{topup.mins} <span className="text-lg text-slate-400 font-semibold">Mins</span></h4>
                      <p className="text-sm font-medium text-slate-500 mt-2">Instantly credited to account</p>
                    </div>
                    <div className="text-2xl font-black text-brand-primary">₹{topup.price}</div>
                    <button
                      onClick={() => {
                        if (!user) navigate('/auth');
                        else handleTopup(user.uid, user.email || '', profile?.displayName || '', topup.mins, topup.price);
                      }}
                      className={`w-full py-4 rounded-xl font-black tracking-[0.2em] text-[11px] uppercase transition-all shadow-lg active:scale-95 ${
                        topup.popular 
                          ? 'bg-brand-primary text-white hover:bg-brand-secondary' 
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      Buy Credits
                    </button>
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest leading-loose">
                      Minutes never expire. Used after monthly plan limits.
                    </p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </main>

      <LandingFooter />
    </div>
  );
};

export default PricingPage;
