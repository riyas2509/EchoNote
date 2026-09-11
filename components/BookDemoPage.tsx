import React, { useState } from 'react';
import { motion } from 'motion/react';
import { 
  CheckCircle2, 
  ArrowRight, 
  Calendar, 
  Clock, 
  Users, 
  ShieldCheck, 
  Sparkles,
  Search,
  Check
} from 'lucide-react';
import FAQAccordion from './public/FAQAccordion';
import ProductWindow from './public/ProductWindow';

export const BookDemoPage: React.FC = () => {
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [formData, setFormData] = useState({
    fullName: '',
    workEmail: '',
    companyName: '',
    teamSize: '10-50 employees',
    primaryGoal: 'Preserve Architectural & Engineering Decisions'
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitted(true);
  };

  const demoFAQs = [
    {
      q: "Who should attend the demonstration?",
      a: "Engineering managers, VP of Engineering, Operations heads, Product leaders, or anyone responsible for cross-functional alignment and organizational continuity."
    },
    {
      q: "How long is the walkthrough?",
      a: "Our standard walkthrough is 25 minutes, with 10 minutes reserved for technical Q&A and security discussions."
    },
    {
      q: "Can we test EchoNote with our own sample recordings?",
      a: "Yes. During the demo or trial period, we can show you how EchoNote extracts decisions and builds provenance trails from your representative audio files."
    }
  ];

  return (
    <div className="bg-brand-background text-slate-900 pb-20 overflow-x-hidden">
      {/* ========================================================================= */}
      {/* 1. HERO SECTION                                                          */}
      {/* ========================================================================= */}
      <header className="pt-32 pb-16 md:pt-40 md:pb-20 px-6 border-b border-slate-200/80 bg-white">
        <div className="max-w-4xl mx-auto text-center space-y-4">
          <div className="inline-flex items-center space-x-2 px-3.5 py-1.5 rounded-full bg-blue-50 border border-blue-100 text-blue-800 text-[11px] font-bold uppercase tracking-wider shadow-sm">
            <Calendar size={14} className="text-blue-600" />
            <span>Interactive Walkthrough</span>
          </div>
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight text-slate-900 leading-[1.12]">
            See decision intelligence <br />
            <span className="text-blue-600">in action.</span>
          </h1>
          <p className="text-slate-600 text-base sm:text-lg max-w-xl mx-auto leading-relaxed">
            Schedule a focused 25-minute walkthrough to see how EchoNote captures decisions, preserves rationale, and prevents forgotten commitments.
          </p>
        </div>
      </header>

      {/* ========================================================================= */}
      {/* 2. DEMO DETAILS & FORM                                                   */}
      {/* ========================================================================= */}
      <section className="py-16 md:py-24 px-6 max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-12 items-start">
        
        {/* Left: What to Expect */}
        <div className="lg:col-span-5 space-y-8">
          <div className="space-y-3">
            <h2 className="text-2xl font-extrabold text-slate-900">What to Expect</h2>
            <p className="text-slate-600 text-sm leading-relaxed">
              We focus directly on your coordination workflows rather than running through generic slide decks.
            </p>
          </div>

          <div className="space-y-4">
            {[
              {
                icon: <Sparkles size={18} className="text-blue-600" />,
                title: "Live Decision Extraction",
                desc: "See raw conversation audio transformed into structured decisions, rationale, and owner assignments."
              },
              {
                icon: <Search size={18} className="text-indigo-600" />,
                title: "Memory Provenance Search",
                desc: "Experience how teams query past decisions and jump straight to original spoken context."
              },
              {
                icon: <ShieldCheck size={18} className="text-emerald-600" />,
                title: "Security & Governance Review",
                desc: "Detailed overview of Firestore database rules, RBAC, and zero-training AI architecture."
              }
            ].map((item, idx) => (
              <div key={idx} className="p-5 rounded-2xl bg-white border border-slate-200/90 shadow-sm flex items-start gap-3.5">
                <div className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center shrink-0 mt-0.5">
                  {item.icon}
                </div>
                <div className="space-y-1">
                  <h3 className="font-bold text-slate-900 text-sm">{item.title}</h3>
                  <p className="text-slate-600 text-xs leading-relaxed">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="p-5 rounded-2xl bg-slate-900 text-white space-y-2">
            <div className="text-xs font-bold text-blue-400 uppercase tracking-wider flex items-center gap-1.5">
              <CheckCircle2 size={14} />
              <span>Direct Expert Consultation</span>
            </div>
            <p className="text-slate-300 text-xs leading-relaxed">
              Walkthroughs are conducted by senior solutions specialists who understand technical architecture and coordination bottlenecks.
            </p>
          </div>
        </div>

        {/* Right: Booking Form */}
        <div className="lg:col-span-7 bg-white p-8 sm:p-12 rounded-3xl border border-slate-200/90 shadow-lg">
          {isSubmitted ? (
            <div className="text-center space-y-6 py-12">
              <div className="w-16 h-16 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
                <CheckCircle2 size={36} />
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl font-bold text-slate-900">Walkthrough Requested!</h2>
                <p className="text-slate-600 text-sm max-w-md mx-auto">
                  Thank you, <strong>{formData.fullName || 'there'}</strong>. We've received your request and will reach out via <strong>{formData.workEmail || 'your email'}</strong> within 24 hours to finalize your demo schedule.
                </p>
              </div>
              <button 
                type="button"
                onClick={() => setIsSubmitted(false)}
                className="text-blue-600 font-bold uppercase tracking-wider text-xs hover:text-blue-800"
              >
                Schedule For Another Team
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-1">
                <h3 className="text-xl font-bold text-slate-900">Schedule Your Session</h3>
                <p className="text-slate-500 text-xs">Fill out the details below to receive a calendar invitation.</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Full Name</label>
                  <input 
                    required 
                    type="text" 
                    value={formData.fullName}
                    onChange={e => setFormData({...formData, fullName: e.target.value})}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-all" 
                    placeholder="Morgan Patel" 
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Work Email</label>
                  <input 
                    required 
                    type="email" 
                    value={formData.workEmail}
                    onChange={e => setFormData({...formData, workEmail: e.target.value})}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-all" 
                    placeholder="morgan@company.com" 
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Company Name</label>
                  <input 
                    required 
                    type="text" 
                    value={formData.companyName}
                    onChange={e => setFormData({...formData, companyName: e.target.value})}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-all" 
                    placeholder="Acme Technologies" 
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Team Size</label>
                  <select 
                    value={formData.teamSize}
                    onChange={e => setFormData({...formData, teamSize: e.target.value})}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-all"
                  >
                    <option>1-10 employees</option>
                    <option>10-50 employees</option>
                    <option>50-250 employees</option>
                    <option>250+ employees</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Primary Use Case</label>
                <select 
                  value={formData.primaryGoal}
                  onChange={e => setFormData({...formData, primaryGoal: e.target.value})}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-all"
                >
                  <option>Preserve Architectural & Engineering Decisions</option>
                  <option>Cross-Functional Initiative Alignment</option>
                  <option>Client Consulting & Scope Change Protection</option>
                  <option>Policy & Governance Compliance Records</option>
                  <option>General Organizational Memory</option>
                </select>
              </div>

              <button 
                type="submit"
                className="w-full bg-brand-primary text-slate-900 py-3.5 rounded-xl font-bold uppercase tracking-wider text-[12px] shadow-sm hover:bg-blue-400 hover:scale-[1.01] active:scale-[0.99] transition-all flex items-center justify-center gap-2"
              >
                <span>Confirm Walkthrough Request</span>
                <ArrowRight size={14} />
              </button>

              <p className="text-center text-[11px] text-slate-500">
                No credit card required. We respect your inbox privacy.
              </p>
            </form>
          )}
        </div>

      </section>

      {/* FAQs */}
      <FAQAccordion items={demoFAQs} title="Demo Walkthrough FAQ" />
    </div>
  );
};

export default BookDemoPage;
