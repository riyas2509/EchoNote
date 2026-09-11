import React, { useState } from 'react';
import { motion } from 'motion/react';
import { 
  Check, 
  Crown, 
  Zap, 
  Sparkles, 
  Building2, 
  Users, 
  HelpCircle, 
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
  X,
  CreditCard,
  Layers,
  MessageSquare
} from 'lucide-react';
import { useNavigate, Link } from 'react-router-dom';
import { useFirebase } from '../components/FirebaseProvider';
import { handleUpgrade, handleTopup } from '../services/subscriptionService';
import FAQAccordion from '../components/public/FAQAccordion';
import SectionHeader from '../components/public/SectionHeader';

export const PricingPage: React.FC = () => {
  const navigate = useNavigate();
  const { user, profile } = useFirebase();
  const [billing, setBilling] = useState<'monthly' | 'yearly'>('monthly');

  const plans = [
    {
      id: 'free',
      name: 'Free',
      badge: 'Starter',
      icon: <Zap className="text-blue-600" size={22} />,
      price: { monthly: '₹0', yearly: '₹0' },
      period: 'forever',
      description: 'For individuals exploring decision capture on key meetings.',
      features: [
        '60 minutes audio transcription / mo',
        '10 AI Intelligence requests / mo',
        'Decision & Rationale extraction',
        'Historical memory search',
        'Audio sync playback',
        'Community & Email support'
      ],
      cta: 'Get Started Free',
      highlighted: false
    },
    {
      id: 'pro',
      name: 'Pro',
      badge: 'Most Popular',
      icon: <Crown className="text-blue-600" size={22} />,
      price: { 
        monthly: '₹999', 
        yearly: '₹799' 
      },
      period: billing === 'yearly' ? 'per month (billed annually)' : 'per month',
      description: 'For power coordinators, tech leads, and consultants.',
      features: [
        '1,200 minutes audio transcription / mo',
        '250 AI Intelligence requests / mo',
        'Deep Strategic & Risk Analysis',
        'Full Execution & Owner Tracking',
        'Priority AI Processing queue',
        'Decision export & markdown sync',
        'Priority Email Support'
      ],
      cta: 'Upgrade to Pro',
      highlighted: true
    },
    {
      id: 'team',
      name: 'Team',
      badge: 'Collaborative',
      icon: <Users className="text-indigo-600" size={22} />,
      price: { 
        monthly: '₹2,499', 
        yearly: '₹1,999' 
      },
      period: billing === 'yearly' ? 'per month (billed annually)' : 'per month',
      description: 'For cross-functional teams needing shared organizational memory.',
      features: [
        '5,000 minutes transcription / mo',
        '1,500 AI Intelligence requests / mo (shared)',
        'Shared Organization Workspace',
        'Granular Role-Based Access (RBAC)',
        'Project activity & audit history',
        'Cross-project decision continuity',
        'Dedicated onboarding support'
      ],
      cta: 'Upgrade Team',
      highlighted: false
    },
    {
      id: 'enterprise',
      name: 'Enterprise',
      badge: 'Custom Governance',
      icon: <Building2 className="text-slate-800" size={22} />,
      price: { monthly: 'Custom', yearly: 'Custom' },
      period: 'tailored agreements',
      description: 'For regulated organizations requiring custom governance and scale.',
      features: [
        'Unlimited audio transcription',
        '10,000+ AI Intelligence requests / mo',
        'Corporate SSO / SAML Authentication',
        'Custom Data Retention policies',
        'Zero-training private infrastructure',
        'Dedicated Technical Account Manager',
        'Custom SLA & Invoicing'
      ],
      cta: 'Contact Sales',
      highlighted: false
    }
  ];

  const comparisonFeatures = [
    { name: 'Monthly Audio Transcription', free: '60 mins', pro: '1,200 mins', team: '5,000 mins', enterprise: 'Unlimited' },
    { name: 'AI Decision Requests', free: '10 / mo', pro: '250 / mo', team: '1,500 / mo', enterprise: '10,000+ / mo' },
    { name: 'Decision & Rationale Extraction', free: true, pro: true, team: true, enterprise: true },
    { name: 'Decision Provenance & Search', free: true, pro: true, team: true, enterprise: true },
    { name: 'Execution & Owner Tracking', free: 'Basic', pro: true, team: true, enterprise: true },
    { name: 'Shared Team Workspaces', free: false, pro: false, team: true, enterprise: true },
    { name: 'Role-Based Access Control (RBAC)', free: false, pro: false, team: true, enterprise: true },
    { name: 'Audit Activity Logs', free: false, pro: false, team: true, enterprise: true },
    { name: 'Single Sign-On (SAML / SSO)', free: false, pro: false, team: false, enterprise: true },
    { name: 'Zero-Training AI Guarantee', free: true, pro: true, team: true, enterprise: true },
    { name: 'Support SLA', free: 'Standard', pro: 'Priority Email', team: 'Priority Onboarding', enterprise: 'Dedicated Manager' },
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

  const pricingStructuredData = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "name": "EchoNote Pricing & Plans",
    "description": "Transparent pricing for EchoNote decision and execution memory platform. Free, Pro, Team, and Enterprise plans available.",
    "mainEntity": {
      "@type": "Product",
      "name": "EchoNote",
      "offers": [
        {
          "@type": "Offer",
          "name": "Free",
          "price": "0",
          "priceCurrency": "INR"
        },
        {
          "@type": "Offer",
          "name": "Pro",
          "price": billing === 'yearly' ? "799" : "999",
          "priceCurrency": "INR"
        },
        {
          "@type": "Offer",
          "name": "Team",
          "price": billing === 'yearly' ? "1999" : "2499",
          "priceCurrency": "INR"
        }
      ]
    }
  };

  const pricingFAQs = [
    {
      q: "How do transcription minutes work?",
      a: "Minutes are counted against the duration of audio processed. For example, uploading a 45-minute recording deducts 45 minutes from your monthly quota. Unused plan minutes refresh at the beginning of each billing cycle."
    },
    {
      q: "What counts as an AI Intelligence Request?",
      a: "An AI request is consumed when you run structured decision extraction, query the organizational memory, generate executive summaries, or perform risk and trade-off analysis on a meeting."
    },
    {
      q: "Can I purchase extra minutes without changing plans?",
      a: "Yes. You can purchase one-time minute top-up packs anytime. Top-up minutes never expire and are automatically used after your monthly plan allowance is exhausted."
    },
    {
      q: "What happens if our team needs custom billing or purchase orders?",
      a: "Our Enterprise plan supports invoicing, direct wire transfers, custom purchase orders, and tailored security addenda. Contact our enterprise solutions team to set up terms."
    }
  ];

  return (
    <div className="bg-brand-background text-slate-900 pb-20 overflow-x-hidden">
      {/* JSON-LD Schema */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(pricingStructuredData) }}
      />

      {/* ========================================================================= */}
      {/* 1. HERO & BILLING TOGGLE                                                  */}
      {/* ========================================================================= */}
      <header className="pt-32 pb-16 md:pt-40 md:pb-20 px-6 border-b border-slate-200/80 bg-white">
        <div className="max-w-5xl mx-auto text-center space-y-6">
          
          <div className="inline-flex items-center space-x-2 px-3.5 py-1.5 rounded-full bg-blue-50 border border-blue-100 text-blue-800 text-[11px] font-bold uppercase tracking-wider shadow-sm">
            <CreditCard size={14} className="text-blue-600" />
            <span>Transparent Pricing</span>
          </div>

          <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight text-slate-900 leading-[1.12]">
            Start with the workflow. <br />
            <span className="text-blue-600">Scale with your organization.</span>
          </h1>

          <p className="text-slate-600 text-base sm:text-lg max-w-2xl mx-auto leading-relaxed">
            All plans include core decision extraction, time-coded speaker transcription, and verifiable provenance trails.
          </p>

          {/* Billing Switch */}
          <div className="pt-6 flex items-center justify-center gap-4 select-none">
            <span className={`text-xs sm:text-sm font-bold uppercase tracking-wider ${billing === 'monthly' ? 'text-slate-900' : 'text-slate-400'}`}>
              Monthly Billing
            </span>
            <button 
              type="button"
              onClick={() => setBilling(b => b === 'monthly' ? 'yearly' : 'monthly')}
              aria-label="Toggle yearly billing"
              className="w-14 h-8 bg-slate-200 hover:bg-slate-300 rounded-full p-1 relative transition-colors focus:outline-none"
            >
              <motion.div 
                animate={{ x: billing === 'monthly' ? 0 : 24 }}
                transition={{ type: "spring", stiffness: 500, damping: 30 }}
                className="w-6 h-6 bg-blue-600 rounded-full shadow-sm"
              />
            </button>
            <div className="flex items-center gap-2">
              <span className={`text-xs sm:text-sm font-bold uppercase tracking-wider ${billing === 'yearly' ? 'text-slate-900' : 'text-slate-400'}`}>
                Yearly Billing
              </span>
              <span className="bg-emerald-100 text-emerald-800 text-[10px] font-extrabold px-2 py-0.5 rounded-full uppercase tracking-wider border border-emerald-200">
                Save 20%
              </span>
            </div>
          </div>

        </div>
      </header>

      {/* ========================================================================= */}
      {/* 2. PRICING CARDS                                                         */}
      {/* ========================================================================= */}
      <section className="py-16 md:py-24 px-6 max-w-7xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {plans.map((plan) => (
            <div
              key={plan.id}
              className={`p-6 sm:p-8 rounded-3xl border transition-all flex flex-col justify-between relative ${
                plan.highlighted 
                  ? 'bg-slate-900 border-blue-600 text-white shadow-2xl ring-2 ring-blue-500/20' 
                  : 'bg-white border-slate-200/90 text-slate-900 shadow-sm hover:shadow-md'
              }`}
            >
              {plan.highlighted && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-[10px] font-extrabold px-3 py-1 rounded-full uppercase tracking-wider shadow-sm">
                  {plan.badge}
                </div>
              )}

              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                    plan.highlighted ? 'bg-blue-500/20 text-blue-300' : 'bg-blue-50 text-blue-600'
                  }`}>
                    {plan.icon}
                  </div>
                  {!plan.highlighted && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-600 uppercase tracking-wider">
                      {plan.badge}
                    </span>
                  )}
                </div>

                <div>
                  <h3 className={`text-xl font-bold ${plan.highlighted ? 'text-white' : 'text-slate-900'}`}>
                    {plan.name}
                  </h3>
                  <p className={`text-xs mt-1 leading-relaxed ${plan.highlighted ? 'text-slate-300' : 'text-slate-500'}`}>
                    {plan.description}
                  </p>
                </div>

                <div className="pt-2">
                  <div className="flex items-baseline gap-1">
                    <span className="text-3xl sm:text-4xl font-extrabold tracking-tight">
                      {billing === 'yearly' ? plan.price.yearly : plan.price.monthly}
                    </span>
                  </div>
                  <span className={`text-[11px] font-medium block mt-0.5 ${plan.highlighted ? 'text-slate-400' : 'text-slate-500'}`}>
                    {plan.period}
                  </span>
                </div>

                <hr className={plan.highlighted ? 'border-slate-800' : 'border-slate-100'} />

                {/* Features List */}
                <ul className="space-y-2.5 text-xs">
                  {plan.features.map((feat, idx) => (
                    <li key={idx} className="flex items-start gap-2.5">
                      <Check size={14} className={`shrink-0 mt-0.5 ${plan.highlighted ? 'text-blue-400' : 'text-blue-600'}`} />
                      <span className={plan.highlighted ? 'text-slate-200' : 'text-slate-700'}>
                        {feat}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="pt-8">
                <button
                  type="button"
                  onClick={() => onPlanAction(plan.id)}
                  className={`w-full py-3 rounded-xl font-bold uppercase tracking-wider text-[11px] transition-all flex items-center justify-center gap-1.5 shadow-sm ${
                    plan.highlighted
                      ? 'bg-brand-primary text-slate-900 hover:bg-blue-400'
                      : 'bg-slate-900 text-white hover:bg-slate-800'
                  }`}
                >
                  <span>{plan.cta}</span>
                  <ArrowRight size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ========================================================================= */}
      {/* 3. ONE-TIME TOP-UPS                                                      */}
      {/* ========================================================================= */}
      <section className="py-16 px-6 max-w-5xl mx-auto">
        <div className="p-8 sm:p-12 rounded-3xl bg-white border border-slate-200/90 shadow-sm space-y-8">
          <div className="text-center space-y-2 max-w-xl mx-auto">
            <span className="text-[11px] font-bold uppercase tracking-wider text-blue-600">
              Need Extra Capacity?
            </span>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900">
              One-Time Minute Top-ups
            </h2>
            <p className="text-slate-600 text-xs sm:text-sm">
              Add extra transcription minutes instantly. Top-up credits never expire and activate automatically when your plan allowance runs out.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-2xl mx-auto">
            {[
              { mins: 100, price: 99, label: "Starter Top-up", popular: false },
              { mins: 350, price: 299, label: "Growth Top-up", popular: true }
            ].map((pack) => (
              <div 
                key={pack.mins} 
                className={`p-6 rounded-2xl border text-center space-y-4 relative ${
                  pack.popular ? 'border-blue-600 bg-blue-50/40 ring-1 ring-blue-500/20' : 'border-slate-200 bg-slate-50'
                }`}
              >
                {pack.popular && (
                  <span className="absolute -top-2.5 right-6 bg-blue-600 text-white text-[9px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                    Best Value
                  </span>
                )}
                <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">{pack.label}</div>
                <div className="text-3xl font-extrabold text-slate-900">
                  +{pack.mins} <span className="text-sm font-semibold text-slate-500">Mins</span>
                </div>
                <div className="text-lg font-bold text-blue-600">₹{pack.price}</div>
                
                <button
                  type="button"
                  onClick={() => {
                    if (!user) navigate('/auth');
                    else handleTopup(user.uid, user.email || '', profile?.displayName || '', pack.mins, pack.price);
                  }}
                  className="w-full py-2.5 rounded-lg bg-slate-900 text-white text-xs font-bold uppercase tracking-wider hover:bg-slate-800 transition-all"
                >
                  Buy Pack
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ========================================================================= */}
      {/* 4. PLAN COMPARISON MATRIX                                                */}
      {/* ========================================================================= */}
      <section className="py-16 md:py-24 px-6 max-w-7xl mx-auto">
        <div className="space-y-8">
          <div className="text-center space-y-3">
            <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900">
              Detailed Feature Comparison
            </h2>
            <p className="text-slate-600 text-sm max-w-xl mx-auto">
              Compare capabilities side-by-side to find the right fit for your team.
            </p>
          </div>

          <div className="bg-white rounded-3xl border border-slate-200/90 shadow-sm overflow-x-auto">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-700">
                  <th className="p-4 sm:p-5 font-bold">Platform Capability</th>
                  <th className="p-4 sm:p-5 font-bold text-center">Free</th>
                  <th className="p-4 sm:p-5 font-bold text-center text-blue-600">Pro</th>
                  <th className="p-4 sm:p-5 font-bold text-center">Team</th>
                  <th className="p-4 sm:p-5 font-bold text-center">Enterprise</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {comparisonFeatures.map((row, idx) => (
                  <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                    <td className="p-4 sm:p-5 font-semibold text-slate-800">{row.name}</td>
                    <td className="p-4 sm:p-5 text-center text-slate-600">
                      {typeof row.free === 'boolean' ? (
                        row.free ? <Check size={16} className="text-blue-600 mx-auto" /> : <X size={16} className="text-slate-300 mx-auto" />
                      ) : row.free}
                    </td>
                    <td className="p-4 sm:p-5 text-center font-semibold text-slate-900 bg-blue-50/30">
                      {typeof row.pro === 'boolean' ? (
                        row.pro ? <Check size={16} className="text-blue-600 mx-auto" /> : <X size={16} className="text-slate-300 mx-auto" />
                      ) : row.pro}
                    </td>
                    <td className="p-4 sm:p-5 text-center text-slate-600">
                      {typeof row.team === 'boolean' ? (
                        row.team ? <Check size={16} className="text-blue-600 mx-auto" /> : <X size={16} className="text-slate-300 mx-auto" />
                      ) : row.team}
                    </td>
                    <td className="p-4 sm:p-5 text-center text-slate-600">
                      {typeof row.enterprise === 'boolean' ? (
                        row.enterprise ? <Check size={16} className="text-blue-600 mx-auto" /> : <X size={16} className="text-slate-300 mx-auto" />
                      ) : row.enterprise}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ========================================================================= */}
      {/* 5. FAQ SECTION                                                           */}
      {/* ========================================================================= */}
      <FAQAccordion items={pricingFAQs} title="Pricing & Quota FAQs" />

      {/* ========================================================================= */}
      {/* 6. ENTERPRISE CONTACT PROMPT                                             */}
      {/* ========================================================================= */}
      <div className="max-w-4xl mx-auto px-6 pt-12 text-center">
        <div className="p-8 rounded-3xl bg-slate-900 text-white flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="text-left space-y-1">
            <h3 className="text-xl font-bold text-white">Need a customized enterprise rollout?</h3>
            <p className="text-slate-400 text-xs sm:text-sm">We provide custom SLAs, on-premise options, and SOC2/ISO security reviews.</p>
          </div>
          <Link
            to="/contact"
            className="shrink-0 bg-brand-primary text-slate-900 px-6 py-3 rounded-xl font-bold uppercase tracking-wider text-[11px] hover:bg-blue-400 transition-all flex items-center gap-1.5"
          >
            <span>Contact Enterprise Sales</span>
            <ArrowRight size={13} />
          </Link>
        </div>
      </div>

    </div>
  );
};

export default PricingPage;
