
import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { CheckCircle2, ArrowRight } from 'lucide-react';
import CTASection from '../components/CTASection';
import { AuthStatus } from '../types';

interface PricingProps {
  onLogin: () => void;
  onStartFree: () => void;
  onNavigateToDemo: () => void;
  authStatus?: AuthStatus;
  onGoToDashboard: () => void;
}

const Pricing: React.FC<PricingProps> = ({ onLogin, onStartFree, onNavigateToDemo, authStatus, onGoToDashboard }) => {
  const [billingCycle, setBillingCycle] = React.useState<'monthly' | 'yearly'>('yearly');
  const isLoggedIn = authStatus === AuthStatus.LOGGED_IN;

  const fadeIn = {
    initial: { opacity: 0, y: 20 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true },
    transition: { duration: 0.6 }
  };

  const plans = [
    {
      name: "FREE",
      price: { monthly: "0", yearly: "0" },
      subtitle: "For trying the core intelligence",
      description: "",
      features: [
        "60 minutes / month",
        "Basic transcription",
        "3 Thinking Engine uses / day",
        "Decision history (last 5 only)",
        "No exports",
        "No team access"
      ],
      cta: "Start Free",
      highlighted: false
    },
    {
      name: "PRO",
      price: { monthly: "799", yearly: "6999" },
      subtitle: "Save ₹2,589 yearly",
      description: "For individuals who actually want leverage",
      features: [
        "600 minutes / month",
        "Advanced transcription + speaker identification",
        "Unlimited Thinking Engine",
        "Unlimited Decision History",
        "Export (PDF, text, insights)",
        "Priority processing"
      ],
      cta: "Upgrade to Pro",
      highlighted: true,
      popular: true
    },
    {
      name: "TEAM",
      price: { monthly: "1999", yearly: "17999" },
      subtitle: "Save ₹5,989 yearly",
      description: "For teams that don’t want chaos",
      features: [
        "1000 shared minutes / month",
        "Everything in Pro",
        "Shared workspace",
        "Team collaboration",
        "Role-based access",
        "Shared decision intelligence"
      ],
      cta: "Start Team Plan",
      highlighted: false
    },
    {
      name: "ENTERPRISE",
      price: { monthly: "Custom", yearly: "Custom" },
      subtitle: "",
      description: "For organizations that need control + compliance",
      features: [
        "Unlimited usage",
        "Advanced security",
        "Audit logs",
        "Dedicated support",
        "Custom integrations"
      ],
      cta: "Contact Sales",
      highlighted: false
    }
  ];

  return (
    <div className="bg-brand-background pt-32 pb-24 px-6">
      <div className="max-w-7xl mx-auto">
        <div className="text-center space-y-6 mb-16">
          <h2 className="text-4xl md:text-5xl font-bold tracking-tight text-brand-primary">Simple, transparent <span className="text-brand-secondary">pricing.</span></h2>
          <p className="text-brand-secondary/60 max-w-2xl mx-auto text-lg">Choose the plan that fits your team's scale and transcription intelligence needs.</p>
          
          <div className="flex items-center justify-center space-x-4 mt-8">
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
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {plans.map((plan, index) => (
            <motion.div 
              key={index}
              {...fadeIn}
              transition={{ delay: index * 0.1 }}
              className={`p-8 rounded-[32px] border transition-all flex flex-col relative ${
                plan.highlighted 
                ? 'bg-brand-primary text-white border-brand-primary shadow-2xl scale-105 z-10' 
                : 'bg-white text-brand-primary border-brand-divider/20 shadow-sm hover:shadow-xl'
              }`}
            >
              {plan.popular && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-brand-accent text-brand-primary text-[10px] font-bold px-4 py-1 rounded-full uppercase tracking-widest shadow-lg">
                  MOST POPULAR
                </div>
              )}
              
              <div className="space-y-2 mb-6">
                <h3 className={`text-[12px] font-bold uppercase tracking-widest ${plan.highlighted ? 'text-brand-accent' : 'text-brand-secondary/40'}`}>
                  {plan.name}
                </h3>
                <div className="flex items-baseline space-x-1">
                  <span className="text-2xl font-bold">{plan.price[billingCycle] === 'Custom' ? '' : '₹'}</span>
                  <span className="text-4xl font-bold tracking-tight">{plan.price[billingCycle]}</span>
                  {plan.price[billingCycle] !== 'Custom' && plan.price[billingCycle] !== '0' && (
                    <span className={`text-sm ${plan.highlighted ? 'text-white/40' : 'text-brand-secondary/40'}`}>
                      /{billingCycle === 'monthly' ? 'mo' : 'year'}
                    </span>
                  )}
                </div>
                {plan.subtitle && (
                  <p className={`text-[11px] font-bold mt-1 ${plan.highlighted ? 'text-emerald-400' : 'text-emerald-600'}`}>
                    {plan.subtitle}
                  </p>
                )}
                {plan.description && (
                  <p className={`text-xs mt-2 ${plan.highlighted ? 'text-white/60' : 'text-brand-secondary/60'}`}>
                    {plan.description}
                  </p>
                )}
              </div>
              
              <div className="space-y-3 mb-10 flex-1">
                {plan.features.map((feature, i) => (
                  <div key={i} className="flex items-start space-x-3">
                    <CheckCircle2 size={16} className={`mt-0.5 ${plan.highlighted ? 'text-brand-accent' : 'text-emerald-500'}`} />
                    <span className={`text-sm font-medium ${plan.highlighted ? 'text-white/80' : 'text-brand-primary/80'}`}>{feature}</span>
                  </div>
                ))}
              </div>
              
              <Link 
                to={plan.cta === 'Contact Sales' ? "/demo" : (isLoggedIn ? "/app" : "/auth")}
                className={`w-full py-4 rounded-xl font-bold uppercase tracking-widest text-[11px] transition-all flex items-center justify-center space-x-2 ${
                  plan.highlighted 
                  ? 'bg-brand-accent text-brand-primary shadow-xl hover:brightness-110' 
                  : 'bg-brand-primary text-white hover:bg-brand-secondary'
                }`}
              >
                <span>{isLoggedIn && plan.cta !== 'Contact Sales' ? 'Dashboard' : plan.cta}</span>
                <ArrowRight size={14} />
              </Link>
            </motion.div>
          ))}
        </div>
        
        <div className="mt-24 p-12 rounded-[32px] bg-white border border-brand-divider/20 text-center space-y-12">
          <div className="space-y-4">
            <h3 className="text-2xl font-bold text-brand-primary">Need more minutes?</h3>
            <p className="text-brand-secondary/60 max-w-xl mx-auto">One-time top-ups for when you have a busy month. No subscription required.</p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl mx-auto">
            <div className="flex items-center justify-between p-8 bg-brand-background rounded-2xl border border-brand-divider/10 hover:border-brand-primary/20 transition-colors">
              <div className="text-left">
                <div className="text-xl font-bold text-brand-primary">+100 minutes</div>
                <div className="text-xs text-brand-secondary/60">One-time top-up</div>
              </div>
              <div className="text-2xl font-bold text-brand-secondary">₹99</div>
            </div>
            <div className="flex items-center justify-between p-8 bg-brand-background rounded-2xl border border-brand-divider/10 hover:border-brand-primary/20 transition-colors">
              <div className="text-left">
                <div className="text-xl font-bold text-brand-primary">+350 minutes</div>
                <div className="text-xs text-brand-secondary/60">One-time top-up</div>
              </div>
              <div className="text-2xl font-bold text-brand-secondary">₹299</div>
            </div>
          </div>

          <div className="pt-8 border-t border-brand-divider/10">
            <h3 className="text-xl font-bold text-brand-primary">Need a custom solution?</h3>
            <p className="text-brand-secondary/60 max-w-xl mx-auto mt-2">We offer tailored packages for high-volume users and specialized industries. Let's talk about your specific requirements.</p>
            <button className="mt-6 text-brand-primary font-bold uppercase tracking-widest text-[13px] border-b-2 border-brand-accent pb-1 hover:text-brand-secondary transition-colors">
              Talk to our experts
            </button>
          </div>
        </div>
      </div>
      <CTASection onLogin={onLogin} onStartFree={onStartFree} onNavigateToDemo={onNavigateToDemo} authStatus={authStatus} onGoToDashboard={onGoToDashboard} />
    </div>
  );
};

export default Pricing;
