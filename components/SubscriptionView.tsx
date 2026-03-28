import React, { useState } from 'react';
import { UsageStats, SubscriptionTier, AuthStatus } from '../types';
import { createRazorpaySubscription } from '../services/razorpayService';
import { PLAN_FEATURES } from '../config/planConfig';

interface SubscriptionViewProps {
  usageStats: UsageStats;
  onUpgrade: (tier: SubscriptionTier) => void;
  onBuyAddOn: (minutes: number) => void;
  authStatus: AuthStatus;
  onSignInClick: () => void;
  addNotification: (notif: any) => void;
}

const SubscriptionView: React.FC<SubscriptionViewProps> = ({ usageStats, onUpgrade, onBuyAddOn, authStatus, onSignInClick, addNotification }) => {
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('yearly');
  const [confirmUpgrade, setConfirmUpgrade] = useState<SubscriptionTier | null>(null);
  const [confirmAddOn, setConfirmAddOn] = useState<{ name: string, minutes: number, price: string } | null>(null);
  const [paymentStep, setPaymentStep] = useState<'none' | 'method' | 'confirm' | 'processing' | 'success'>('none');
  const [selectedMethod, setSelectedMethod] = useState<'card' | 'upi' | 'netbanking'>('card');
  const [showContactInfo, setShowContactInfo] = useState(false);
  const [paymentDetails, setPaymentDetails] = useState({
    cardNumber: '',
    expiry: '',
    cvv: '',
    upiId: '',
    bankName: ''
  });

  const handleFinalize = async (type: 'upgrade' | 'addon') => {
    if (type === 'upgrade' && confirmUpgrade) {
      setPaymentStep('processing');
      try {
        await createRazorpaySubscription(confirmUpgrade as 'pro' | 'team' | 'enterprise', billingCycle);
        setPaymentStep('success');
        onUpgrade(confirmUpgrade);
        addNotification({
          title: 'Upgrade Successful',
          message: `You are now on the ${confirmUpgrade.toUpperCase()} plan.`,
          type: 'success'
        });
      } catch (error: any) {
        console.error("Payment failed", error);
        setPaymentStep('none');
        const msg = error?.message || "Payment failed. Please try again.";
        addNotification({
          title: 'Payment Failed',
          message: msg,
          type: 'error'
        });
      }
    } else if (type === 'addon' && confirmAddOn) {
      // Add-on logic could also be Razorpay-based, but for now we'll keep it simple or mock it
      setPaymentStep('processing');
      setTimeout(() => {
        onBuyAddOn(confirmAddOn.minutes);
        setPaymentStep('success');
      }, 500);
    }
  };

  const handleClose = () => {
    setConfirmUpgrade(null);
    setConfirmAddOn(null);
    setPaymentStep('none');
  };

  const plans = [
    {
      id: 'free' as SubscriptionTier,
      name: 'FREE',
      price: { monthly: '₹0', yearly: '₹0' },
      subtitle: 'For trying the core intelligence',
      features: [
        '60 minutes / month',
        'Basic transcription',
        '3 Thinking Engine uses / day',
        'Decision history (last 5 only)',
        'No exports',
        'No team access'
      ],
      cta: usageStats.plan === 'free' ? 'Current Plan' : 'Start Free',
      isCurrent: usageStats.plan === 'free'
    },
    {
      id: 'pro' as SubscriptionTier,
      name: 'PRO',
      price: { monthly: '₹799', yearly: '₹6999' },
      subtitle: 'Save ₹2,589 yearly',
      description: 'For individuals who actually want leverage',
      features: [
        '600 minutes / month',
        'Advanced transcription + speaker identification',
        'Unlimited Thinking Engine',
        'Unlimited Decision History',
        'Export (PDF, text, insights)',
        'Priority processing'
      ],
      cta: usageStats.plan === 'pro' ? 'Current Plan' : 'Upgrade to Pro',
      isCurrent: usageStats.plan === 'pro',
      highlight: true,
      tag: 'MOST POPULAR'
    },
    {
      id: 'team' as SubscriptionTier,
      name: 'TEAM',
      price: { monthly: '₹1999', yearly: '₹17999' },
      subtitle: 'Save ₹5,989 yearly',
      description: 'For teams that don’t want chaos',
      features: [
        '1000 shared minutes / month',
        'Everything in Pro',
        'Shared workspace',
        'Team collaboration',
        'Role-based access',
        'Shared decision intelligence'
      ],
      cta: usageStats.plan === 'team' ? 'Current Plan' : 'Start Team Plan',
      isCurrent: usageStats.plan === 'team'
    },
    {
      id: 'enterprise' as SubscriptionTier,
      name: 'ENTERPRISE',
      price: { monthly: 'Custom', yearly: 'Custom' },
      description: 'For organizations that need control + compliance',
      features: [
        'Unlimited usage',
        'Advanced security',
        'Audit logs',
        'Dedicated support',
        'Custom integrations'
      ],
      cta: usageStats.plan === 'enterprise' ? 'Current Plan' : 'Contact Sales',
      isCurrent: usageStats.plan === 'enterprise'
    }
  ];

  const addOns = [
    { name: '+100 Minutes', price: '₹99', minutes: 100 },
    { name: '+350 Minutes', price: '₹299', minutes: 350 }
  ];

  const usedPercentage = Math.round((usageStats.usedMinutes / usageStats.totalMinutes) * 100);

  return (
    <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-700">
      {/* Payment Method Modal Overlay */}
      {(confirmUpgrade || confirmAddOn) && (paymentStep === 'method' || paymentStep === 'processing' || paymentStep === 'success') && (
        <div className="fixed inset-0 bg-brand-primary/60 backdrop-blur-sm z-[200] flex items-center justify-center p-6">
          <div className="bg-white rounded-lg p-10 max-w-md w-full space-y-8 shadow-2xl animate-in zoom-in-95">
            {paymentStep === 'method' && (
              <>
                <div className="text-center space-y-2">
                  <h2 className="text-[26px] font-medium text-brand-primary tracking-[-0.01em] leading-tight">Confirm {confirmUpgrade ? 'upgrade' : 'add-on'}</h2>
                  <p className="text-slate-500 text-[16px] font-medium">You will be redirected to Razorpay to complete your payment.</p>
                </div>

                <div className="flex flex-col space-y-3">
                  <button 
                    onClick={() => handleFinalize(confirmUpgrade ? 'upgrade' : 'addon')}
                    className="w-full py-4 bg-brand-accent text-brand-primary rounded-lg font-semibold tracking-widest text-[13px] shadow-xl shadow-brand-accent/10 active:scale-95 transition-all"
                  >
                    Proceed to Payment
                  </button>
                  <button 
                    onClick={handleClose} 
                    className="text-[13px] font-medium text-slate-400 text-center hover:text-slate-600 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}

            {paymentStep === 'processing' && (
              <div className="py-12 text-center space-y-6">
                <div className="w-20 h-20 border-4 border-brand-accent/20 border-t-brand-accent rounded-full animate-spin mx-auto"></div>
                <div className="space-y-2">
                  <h3 className="text-[26px] font-medium text-brand-primary tracking-[-0.01em] leading-tight">Processing payment</h3>
                  <p className="text-slate-500 text-[16px] font-medium">Securing your transaction with {selectedMethod.toUpperCase()}...</p>
                </div>
              </div>
            )}

            {paymentStep === 'success' && (
              <div className="py-8 text-center space-y-8 animate-in zoom-in-95">
                <div className="w-24 h-24 bg-emerald-500 text-white rounded-full flex items-center justify-center mx-auto shadow-xl shadow-emerald-500/20">
                  <i className="fa-solid fa-check text-4xl"></i>
                </div>
                <div className="space-y-2">
                  <h2 className="text-[26px] font-medium text-brand-primary tracking-[-0.01em] leading-tight">Transaction successful!</h2>
                  <p className="text-slate-500 text-[16px] font-medium">Your {confirmUpgrade ? 'plan' : 'minutes'} have been updated. Thank you for choosing EchoNote.</p>
                </div>
                <button 
                  onClick={handleClose}
                  className="w-full py-4 bg-brand-primary text-white rounded-lg font-semibold tracking-widest text-[13px] shadow-xl active:scale-95 transition-all"
                >
                  Return to dashboard
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Header & Current Usage */}
      <div className="bg-white rounded-lg p-10 shadow-sm border border-brand-divider/20 flex flex-col md:flex-row justify-between items-center gap-10">
        <div className="space-y-4 text-center md:text-left">
          <h1 className="text-[38px] font-semibold text-brand-primary tracking-[-0.02em] leading-tight">Subscription & usage</h1>
          <p className="text-slate-500 text-[16px] font-medium">Manage your enterprise transcription limits and billing cycles.</p>
          <div className="flex items-center justify-center md:justify-start space-x-3">
            <span className="text-[13px] font-medium tracking-widest text-slate-400">Current plan:</span>
            <span className="px-3 py-1 bg-brand-accent text-brand-primary rounded-full text-[11px] font-semibold tracking-widest capitalize">
              {usageStats.plan === 'guest' ? 'Guest Preview' : usageStats.plan}
            </span>
          </div>
        </div>

        <div className="w-full md:w-80 space-y-4">
          <div className="flex justify-between items-end">
            <span className="text-[13px] font-medium tracking-widest text-slate-400 uppercase">Usage Status</span>
            <span className="text-[16px] font-semibold text-brand-primary font-mono">{usageStats.usedMinutes} / {usageStats.totalMinutes} used</span>
          </div>
          <div className="h-3 bg-brand-background rounded-full overflow-hidden">
            <div 
              className={`h-full transition-all duration-1000 ${usedPercentage >= 100 ? 'bg-red-500' : usedPercentage >= 80 ? 'bg-brand-accent' : 'bg-brand-primary'}`}
              style={{ width: `${Math.min(100, usedPercentage)}%` }}
            />
          </div>
          <div className="flex justify-between text-[11px] font-semibold tracking-widest">
            <div className="flex flex-col">
              <span className={`font-mono ${usedPercentage >= 80 ? 'text-brand-accent' : 'text-slate-400'}`}>
                {usedPercentage}% used
              </span>
              <span className="text-brand-primary font-bold mt-1">
                {Math.max(0, usageStats.totalMinutes - usageStats.usedMinutes)} minutes remaining
              </span>
            </div>
            <div className="text-right">
              <span className="text-slate-400 font-mono block">Resets on: {usageStats.renewalDate}</span>
              <span className="text-[9px] text-brand-secondary/40 uppercase mt-1 block">Reset cycle: Monthly</span>
            </div>
          </div>
          
          <div className="flex gap-2 pt-2">
            <button 
              onClick={() => {
                if (authStatus === AuthStatus.GUEST) {
                  addNotification({
                    title: 'Account Required',
                    message: 'Please sign in to upgrade your plan.',
                    type: 'error'
                  });
                  return;
                }
                const proPlan = plans.find(p => p.id === 'pro');
                if (proPlan && !proPlan.isCurrent) {
                  setConfirmUpgrade('pro');
                  setPaymentStep('method');
                }
              }}
              disabled={authStatus === AuthStatus.GUEST}
              className={`flex-1 py-2 rounded-lg text-[10px] font-bold tracking-widest transition-all shadow-md ${authStatus === AuthStatus.GUEST ? 'bg-slate-200 text-slate-400 cursor-not-allowed' : 'bg-brand-primary text-white hover:bg-brand-secondary'}`}
            >
              UPGRADE PLAN
            </button>
            <button 
              onClick={() => {
                if (authStatus === AuthStatus.GUEST) {
                  addNotification({
                    title: 'Account Required',
                    message: 'Please sign in to purchase add-ons.',
                    type: 'error'
                  });
                  return;
                }
                const firstAddOn = addOns[0];
                setConfirmAddOn(firstAddOn);
                setPaymentStep('method');
              }}
              disabled={authStatus === AuthStatus.GUEST}
              className={`flex-1 py-2 rounded-lg text-[10px] font-bold tracking-widest transition-all shadow-md ${authStatus === AuthStatus.GUEST ? 'bg-slate-200 text-slate-400 cursor-not-allowed' : 'bg-brand-accent text-brand-primary hover:brightness-110'}`}
            >
              BUY ADD-ON
            </button>
          </div>
        </div>
      </div>

      {/* Billing Toggle */}
      <div className="flex items-center justify-center space-x-4">
        <span className={`text-sm font-semibold ${billingCycle === 'monthly' ? 'text-brand-primary' : 'text-slate-400'}`}>Monthly</span>
        <button 
          onClick={() => setBillingCycle(prev => prev === 'monthly' ? 'yearly' : 'monthly')}
          className="w-14 h-7 bg-slate-200 rounded-full relative p-1 transition-colors hover:bg-slate-300"
        >
          <div className={`w-5 h-5 bg-brand-primary rounded-full transition-transform ${billingCycle === 'yearly' ? 'translate-x-7' : 'translate-x-0'}`} />
        </button>
        <div className="flex items-center space-x-2">
          <span className={`text-sm font-semibold ${billingCycle === 'yearly' ? 'text-brand-primary' : 'text-slate-400'}`}>Yearly</span>
          <span className="bg-emerald-100 text-emerald-700 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">Save 25%</span>
        </div>
      </div>

      {/* Plans Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {plans.map((plan) => (
          <div 
            key={plan.id} 
            className={`rounded-xl p-8 shadow-sm border transition-all duration-300 flex flex-col relative ${
              plan.id === 'pro' 
                ? 'bg-brand-primary text-white border-brand-primary shadow-2xl scale-105 z-10' 
                : plan.id === 'team' 
                  ? 'bg-white text-brand-primary border-brand-divider/20 hover:border-brand-accent/30' 
                  : plan.id === 'enterprise' 
                    ? 'bg-white text-brand-primary border-brand-divider/20 hover:border-brand-accent/30' 
                    : 'bg-white text-brand-primary border-brand-divider/20 hover:border-brand-accent/30'
            }`}
          >
            {plan.tag && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-brand-accent text-brand-primary text-[10px] font-bold px-4 py-1 rounded-full uppercase tracking-widest shadow-lg">
                {plan.tag}
              </div>
            )}
            <div className="mb-6 text-left">
              <h3 className={`text-[12px] font-bold tracking-widest uppercase mb-2 ${plan.id === 'pro' ? 'text-brand-accent' : 'text-brand-secondary/40'}`}>
                {plan.name}
              </h3>
              <div className="flex items-baseline">
                <span className={`text-4xl font-bold ${plan.id === 'pro' ? 'text-white' : 'text-brand-primary'}`}>
                  {plan.price[billingCycle]}
                </span>
                {plan.id !== 'enterprise' && plan.id !== 'free' && (
                  <span className={`text-sm ml-1 ${plan.id === 'pro' ? 'text-white/60' : 'text-brand-secondary/40'}`}>
                    /{billingCycle === 'monthly' ? 'mo' : 'year'}
                  </span>
                )}
              </div>
              {plan.subtitle && (
                <p className={`text-[11px] font-bold mt-1 ${plan.id === 'pro' ? 'text-emerald-400' : 'text-emerald-600'}`}>
                  {plan.subtitle}
                </p>
              )}
              {plan.description && (
                <p className={`text-xs mt-2 ${plan.id === 'pro' ? 'text-white/60' : 'text-brand-secondary/60'}`}>
                  {plan.description}
                </p>
              )}
            </div>

            <div className="space-y-4 flex-1 text-left">
              <ul className="space-y-2">
                {plan.features.map((feature, i) => (
                  <li key={i} className={`flex items-start text-sm font-medium ${plan.id === 'pro' ? 'text-white/80' : 'text-slate-600'}`}>
                    <i className="fa-solid fa-check text-emerald-500 mr-3 mt-1 text-xs"></i>
                    {feature}
                  </li>
                ))}
              </ul>
            </div>

            <button 
              onClick={() => { 
                if (plan.isCurrent) return;
                if (authStatus === AuthStatus.GUEST) {
                  addNotification({
                    title: 'Account Required',
                    message: 'Please sign in to upgrade your plan.',
                    type: 'error'
                  });
                  return;
                }
                if (plan.id === 'enterprise') {
                  setShowContactInfo(true);
                } else if (plan.id === 'free') {
                  onUpgrade('free');
                  setPaymentStep('success');
                } else {
                  setConfirmUpgrade(plan.id); 
                  setPaymentStep('method'); 
                }
              }}
              disabled={plan.isCurrent || authStatus === AuthStatus.GUEST}
              className={`mt-8 w-full py-4 rounded-xl font-bold uppercase tracking-widest text-[11px] transition-all shadow-xl ${
                plan.isCurrent 
                  ? 'bg-slate-100 text-slate-400 cursor-not-allowed shadow-none' 
                  : authStatus === AuthStatus.GUEST 
                    ? 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none' 
                    : plan.id === 'pro' 
                      ? 'bg-brand-accent text-brand-primary shadow-brand-accent/10 hover:brightness-110 active:scale-95' 
                      : 'bg-brand-primary text-white hover:bg-brand-secondary active:scale-95'
              }`}
            >
              {plan.cta}
            </button>
          </div>
        ))}
      </div>

      {/* Add-On Packs */}
      <div className={`bg-brand-background rounded-lg p-10 border border-brand-divider/20 ${authStatus === AuthStatus.GUEST ? 'opacity-50 grayscale-[0.5]' : ''}`}>
        <div className="flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="space-y-2 text-center md:text-left">
            <h3 className={`text-[20px] font-semibold text-brand-primary tracking-widest`}>One-time minute top-ups</h3>
            <p className="text-slate-500 text-[16px] font-medium">
              {authStatus === AuthStatus.GUEST 
                ? "Add-on packs are available for Pro and Enterprise plans." 
                : "Purchase one-time minute top-ups for when you have a busy month."}
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-4">
            {addOns.map((pack, i) => (
              <div 
                key={i}
                className="bg-white border border-brand-divider/20 p-6 rounded-lg shadow-sm hover:border-brand-accent hover:shadow-md transition-all group flex flex-col items-center space-y-4"
              >
                <div className="text-center">
                  <div className="text-[13px] font-medium text-slate-400 tracking-widest mb-1 group-hover:text-brand-accent font-mono">{pack.name}</div>
                  <div className="text-[20px] font-semibold text-brand-primary font-mono">{pack.price}</div>
                </div>
                <button 
                  onClick={() => { 
                    if (authStatus === AuthStatus.GUEST) {
                      addNotification({
                        title: 'Account Required',
                        message: 'Please sign in to purchase add-ons.',
                        type: 'error'
                      });
                      return;
                    }
                    setConfirmAddOn(pack); 
                    setPaymentStep('method'); 
                  }}
                  disabled={authStatus === AuthStatus.GUEST}
                  className={`w-full py-2.5 rounded-lg text-[10px] font-bold tracking-widest transition-all active:scale-95 ${authStatus === AuthStatus.GUEST ? 'bg-slate-200 text-slate-400 cursor-not-allowed' : 'bg-brand-primary text-white hover:bg-brand-secondary'}`}
                >
                  BUY NOW
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Upgrade Confirmation Modal */}
      {confirmUpgrade && paymentStep === 'confirm' && (
        <div className="fixed inset-0 bg-brand-primary/60 backdrop-blur-sm z-[200] flex items-center justify-center p-6">
          <div className="bg-white rounded-lg p-10 max-w-md w-full space-y-8 shadow-2xl animate-in zoom-in-95">
            <div className="text-center space-y-4">
              <div className="w-20 h-20 bg-brand-accent/10 rounded-full flex items-center justify-center mx-auto">
                <i className="fa-solid fa-rocket text-brand-accent text-3xl"></i>
              </div>
              <h2 className="text-[26px] font-medium text-brand-primary tracking-[-0.01em] leading-tight">Confirm upgrade</h2>
              <p className="text-slate-500 text-[16px] font-medium">Are you sure you want to upgrade to the <span className="text-brand-accent font-semibold">{confirmUpgrade}</span> plan? Your new limits will be applied immediately.</p>
              
              <div className="space-y-4">
                <div className="bg-brand-background p-4 rounded-lg flex items-center justify-between">
                  <span className="text-[13px] font-medium text-slate-400">Payment method</span>
                  <span className="text-[13px] font-semibold text-brand-primary">{selectedMethod}</span>
                </div>

                {selectedMethod === 'card' && (
                  <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
                    <input 
                      type="tel" 
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={16}
                      placeholder="Card Number (16 digits)" 
                      className="w-full px-4 py-3 rounded-lg bg-brand-background border border-brand-divider/30 text-sm outline-none focus:ring-2 focus:ring-brand-primary"
                      value={paymentDetails.cardNumber}
                      onChange={(e) => {
                        const val = e.target.value.replace(/\D/g, '');
                        setPaymentDetails({...paymentDetails, cardNumber: val});
                      }}
                    />
                    <div className="grid grid-cols-2 gap-3">
                      <input 
                        type="text" 
                        placeholder="MM/YY" 
                        maxLength={5}
                        className="w-full px-4 py-3 rounded-lg bg-brand-background border border-brand-divider/30 text-sm outline-none focus:ring-2 focus:ring-brand-primary"
                        value={paymentDetails.expiry}
                        onChange={(e) => {
                          let val = e.target.value.replace(/[^\d/]/g, '');
                          if (val.length === 2 && !val.includes('/')) val += '/';
                          setPaymentDetails({...paymentDetails, expiry: val});
                        }}
                      />
                      <input 
                        type="password" 
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={3}
                        placeholder="CVV" 
                        className="w-full px-4 py-3 rounded-lg bg-brand-background border border-brand-divider/30 text-sm outline-none focus:ring-2 focus:ring-brand-primary"
                        value={paymentDetails.cvv}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, '');
                          setPaymentDetails({...paymentDetails, cvv: val});
                        }}
                      />
                    </div>
                  </div>
                )}

                {selectedMethod === 'upi' && (
                  <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
                    <input 
                      type="text" 
                      placeholder="Enter UPI ID (e.g., user@upi)" 
                      className="w-full px-4 py-3 rounded-lg bg-brand-background border border-brand-divider/30 text-sm outline-none focus:ring-2 focus:ring-brand-primary"
                      value={paymentDetails.upiId}
                      onChange={(e) => setPaymentDetails({...paymentDetails, upiId: e.target.value})}
                    />
                  </div>
                )}

                {selectedMethod === 'netbanking' && (
                  <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
                    <select 
                      className="w-full px-4 py-3 rounded-lg bg-brand-background border border-brand-divider/30 text-sm outline-none focus:ring-2 focus:ring-brand-primary"
                      value={paymentDetails.bankName}
                      onChange={(e) => setPaymentDetails({...paymentDetails, bankName: e.target.value})}
                    >
                      <option value="">Select your bank</option>
                      <option value="HDFC">HDFC Bank</option>
                      <option value="SBI">State Bank of India</option>
                      <option value="ICICI">ICICI Bank</option>
                      <option value="AXIS">Axis Bank</option>
                    </select>
                  </div>
                )}
              </div>
            </div>
            <div className="flex flex-col space-y-3">
              <button 
                onClick={() => handleFinalize('upgrade')} 
                className="w-full py-4 bg-brand-accent text-brand-primary rounded-lg font-semibold tracking-widest text-[13px] shadow-xl shadow-brand-accent/10 active:scale-95 transition-all"
              >
                Confirm & pay
              </button>
              <button onClick={() => setPaymentStep('method')} className="text-[13px] font-medium text-slate-400 text-center hover:text-slate-600 transition-colors">Back to Methods</button>
            </div>
          </div>
        </div>
      )}

      {/* Add-On Confirmation Modal */}
      {confirmAddOn && paymentStep === 'confirm' && (
        <div className="fixed inset-0 bg-brand-primary/60 backdrop-blur-sm z-[200] flex items-center justify-center p-6">
          <div className="bg-white rounded-lg p-10 max-w-md w-full space-y-8 shadow-2xl animate-in zoom-in-95">
            <div className="text-center space-y-4">
              <div className="w-20 h-20 bg-emerald-50 rounded-full flex items-center justify-center mx-auto">
                <i className="fa-solid fa-plus text-emerald-500 text-3xl"></i>
              </div>
              <h2 className="text-[26px] font-medium text-brand-primary tracking-[-0.01em] leading-tight">Confirm Purchase</h2>
              <p className="text-slate-500 text-[16px] font-medium">Are you sure you want to purchase <span className="text-emerald-600 font-semibold">{confirmAddOn.minutes} minutes</span> for <span className="text-brand-primary font-semibold">{confirmAddOn.price}</span>?</p>
              
              <div className="space-y-4">
                <div className="bg-brand-background p-4 rounded-lg flex items-center justify-between">
                  <span className="text-[13px] font-medium text-slate-400">Payment method</span>
                  <span className="text-[13px] font-semibold text-brand-primary">{selectedMethod}</span>
                </div>

                {selectedMethod === 'card' && (
                  <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
                    <input 
                      type="text" 
                      placeholder="Card Number" 
                      className="w-full px-4 py-3 rounded-lg bg-brand-background border border-brand-divider/30 text-sm outline-none focus:ring-2 focus:ring-brand-primary"
                      value={paymentDetails.cardNumber}
                      onChange={(e) => setPaymentDetails({...paymentDetails, cardNumber: e.target.value})}
                    />
                    <div className="grid grid-cols-2 gap-3">
                      <input 
                        type="text" 
                        placeholder="MM/YY" 
                        className="w-full px-4 py-3 rounded-lg bg-brand-background border border-brand-divider/30 text-sm outline-none focus:ring-2 focus:ring-brand-primary"
                        value={paymentDetails.expiry}
                        onChange={(e) => setPaymentDetails({...paymentDetails, expiry: e.target.value})}
                      />
                      <input 
                        type="password" 
                        placeholder="CVV" 
                        className="w-full px-4 py-3 rounded-lg bg-brand-background border border-brand-divider/30 text-sm outline-none focus:ring-2 focus:ring-brand-primary"
                        value={paymentDetails.cvv}
                        onChange={(e) => setPaymentDetails({...paymentDetails, cvv: e.target.value})}
                      />
                    </div>
                  </div>
                )}

                {selectedMethod === 'upi' && (
                  <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
                    <input 
                      type="text" 
                      placeholder="UPI ID" 
                      className="w-full px-4 py-3 rounded-lg bg-brand-background border border-brand-divider/30 text-sm outline-none focus:ring-2 focus:ring-brand-primary"
                      value={paymentDetails.upiId}
                      onChange={(e) => setPaymentDetails({...paymentDetails, upiId: e.target.value})}
                    />
                  </div>
                )}

                {selectedMethod === 'netbanking' && (
                  <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
                    <select 
                      className="w-full px-4 py-3 rounded-lg bg-brand-background border border-brand-divider/30 text-sm outline-none focus:ring-2 focus:ring-brand-primary"
                      value={paymentDetails.bankName}
                      onChange={(e) => setPaymentDetails({...paymentDetails, bankName: e.target.value})}
                    >
                      <option value="">Select your bank</option>
                      <option value="HDFC">HDFC Bank</option>
                      <option value="SBI">State Bank of India</option>
                      <option value="ICICI">ICICI Bank</option>
                      <option value="AXIS">Axis Bank</option>
                    </select>
                  </div>
                )}
              </div>
            </div>
            <div className="flex flex-col space-y-3">
              <button 
                onClick={() => handleFinalize('addon')} 
                className="w-full py-4 bg-emerald-500 text-white rounded-lg font-semibold tracking-widest text-[13px] shadow-xl shadow-emerald-500/20 active:scale-95 transition-all"
              >
                Confirm & pay
              </button>
              <button onClick={() => setPaymentStep('method')} className="text-[13px] font-medium text-slate-400 text-center hover:text-slate-600 transition-colors">Back to Methods</button>
            </div>
          </div>
        </div>
      )}
      {/* Contact Info Modal */}
      {showContactInfo && (
        <div className="fixed inset-0 bg-brand-primary/60 backdrop-blur-sm z-[200] flex items-center justify-center p-6">
          <div className="bg-white rounded-lg p-10 max-w-md w-full space-y-8 shadow-2xl animate-in zoom-in-95">
            <div className="text-center space-y-4">
              <div className="w-20 h-20 bg-brand-accent/10 rounded-full flex items-center justify-center mx-auto">
                <i className="fa-solid fa-headset text-brand-accent text-3xl"></i>
              </div>
              <h2 className="text-[26px] font-medium text-brand-primary tracking-[-0.01em] leading-tight">Contact Sales</h2>
              <p className="text-slate-500 text-[16px] font-medium">For Enterprise solutions, please reach out to our dedicated team.</p>
              
              <div className="space-y-4 text-left pt-4">
                <div className="flex items-center space-x-4 p-4 bg-brand-background rounded-lg border border-brand-divider/20">
                  <div className="w-10 h-10 bg-white rounded-md flex items-center justify-center text-brand-primary shadow-sm">
                    <i className="fa-solid fa-envelope"></i>
                  </div>
                  <div>
                    <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Email</p>
                    <p className="text-sm font-semibold text-brand-primary">enterprise@echonote.ai</p>
                  </div>
                </div>
                <div className="flex items-center space-x-4 p-4 bg-brand-background rounded-lg border border-brand-divider/20">
                  <div className="w-10 h-10 bg-white rounded-md flex items-center justify-center text-brand-primary shadow-sm">
                    <i className="fa-solid fa-phone"></i>
                  </div>
                  <div>
                    <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Phone</p>
                    <p className="text-sm font-semibold text-brand-primary">+1 (888) ECHO-ENT</p>
                  </div>
                </div>
              </div>
            </div>
            <button 
              onClick={() => setShowContactInfo(false)} 
              className="w-full py-4 bg-brand-primary text-white rounded-lg font-semibold tracking-widest text-[13px] shadow-xl active:scale-95 transition-all"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default SubscriptionView;
