import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Mail, MessageSquare, ArrowRight, CheckCircle2, Building2, Clock, ShieldCheck } from 'lucide-react';
import FAQAccordion from './public/FAQAccordion';

export const ContactPage: React.FC = () => {
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    subject: 'General Inquiry',
    message: ''
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitted(true);
  };

  const contactFAQs = [
    {
      q: "What is the typical response time for support inquiries?",
      a: "Our customer success team responds to email support requests within 2 to 4 hours during business days. Enterprise customers have access to dedicated priority response channels."
    },
    {
      q: "Can I request custom enterprise contracts or security reviews?",
      a: "Yes. For organizations evaluating Team or Enterprise deployments, our solutions team can provide security whitepapers, complete vendor questionnaires, and establish tailored MSAs."
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
            <Mail size={14} className="text-blue-600" />
            <span>Direct Support & Sales</span>
          </div>
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight text-slate-900 leading-[1.12]">
            Get in touch with the <span className="text-blue-600">EchoNote team.</span>
          </h1>
          <p className="text-slate-600 text-base sm:text-lg max-w-xl mx-auto leading-relaxed">
            Have questions about decision intelligence, team plans, or security architecture? We're here to help.
          </p>
        </div>
      </header>

      {/* ========================================================================= */}
      {/* 2. CONTACT CONTENT GRID                                                   */}
      {/* ========================================================================= */}
      <section className="py-16 md:py-24 px-6 max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-12 items-start">
        
        {/* Left: Contact Channels */}
        <div className="lg:col-span-5 space-y-8">
          <div className="space-y-3">
            <h2 className="text-2xl font-extrabold text-slate-900">Reach Us Directly</h2>
            <p className="text-slate-600 text-sm leading-relaxed">
              Choose the right channel for your request, or submit the form to reach the entire team.
            </p>
          </div>

          <div className="space-y-4">
            <div className="p-6 rounded-2xl bg-white border border-slate-200/90 shadow-sm flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                <Mail size={20} />
              </div>
              <div className="space-y-1">
                <h3 className="font-bold text-slate-900 text-sm">Product & Technical Support</h3>
                <p className="text-blue-600 font-semibold text-sm">riya@echotechai.in</p>
                <p className="text-slate-500 text-xs flex items-center gap-1 pt-1">
                  <Clock size={12} />
                  Response time: ~2-4 hours
                </p>
              </div>
            </div>

            <div className="p-6 rounded-2xl bg-white border border-slate-200/90 shadow-sm flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                <Building2 size={20} />
              </div>
              <div className="space-y-1">
                <h3 className="font-bold text-slate-900 text-sm">Enterprise Sales & Solutions</h3>
                <p className="text-indigo-600 font-semibold text-sm">riyamshah2509@gmail.com</p>
                <p className="text-slate-500 text-xs flex items-center gap-1 pt-1">
                  <Clock size={12} />
                  Response time: ~24 hours
                </p>
              </div>
            </div>

            <div className="p-6 rounded-2xl bg-slate-900 text-white space-y-2">
              <div className="flex items-center gap-2 text-blue-400 text-xs font-bold uppercase tracking-wider">
                <ShieldCheck size={14} />
                <span>Zero-Spam Guarantee</span>
              </div>
              <p className="text-slate-300 text-xs leading-relaxed">
                We only communicate about your inquiry. Your information is never shared with third-party marketers.
              </p>
            </div>
          </div>
        </div>

        {/* Right: Contact Form */}
        <div className="lg:col-span-7 bg-white p-8 sm:p-12 rounded-3xl border border-slate-200/90 shadow-lg">
          {isSubmitted ? (
            <div className="text-center space-y-6 py-12">
              <div className="w-16 h-16 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
                <CheckCircle2 size={36} />
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl font-bold text-slate-900">Message Received</h2>
                <p className="text-slate-600 text-sm max-w-md mx-auto">
                  Thank you for contacting EchoNote. A member of our team will review your message and reply shortly.
                </p>
              </div>
              <button 
                type="button"
                onClick={() => setIsSubmitted(false)}
                className="text-blue-600 font-bold uppercase tracking-wider text-xs hover:text-blue-800"
              >
                Send Another Message
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">First Name</label>
                  <input 
                    required 
                    type="text" 
                    value={formData.firstName}
                    onChange={e => setFormData({...formData, firstName: e.target.value})}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-all" 
                    placeholder="Alex" 
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Last Name</label>
                  <input 
                    required 
                    type="text" 
                    value={formData.lastName}
                    onChange={e => setFormData({...formData, lastName: e.target.value})}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-all" 
                    placeholder="Rivers" 
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Work Email</label>
                <input 
                  required 
                  type="email" 
                  value={formData.email}
                  onChange={e => setFormData({...formData, email: e.target.value})}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-all" 
                  placeholder="alex@company.com" 
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Topic</label>
                <select 
                  value={formData.subject}
                  onChange={e => setFormData({...formData, subject: e.target.value})}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-all"
                >
                  <option>General Inquiry</option>
                  <option>Team / Enterprise Pricing</option>
                  <option>Security & Architecture Review</option>
                  <option>Technical Support</option>
                  <option>Partnership & Integration</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Message</label>
                <textarea 
                  required 
                  rows={4} 
                  value={formData.message}
                  onChange={e => setFormData({...formData, message: e.target.value})}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-all resize-none" 
                  placeholder="Tell us about your team's workflow and needs..."
                ></textarea>
              </div>

              <button 
                type="submit"
                className="w-full bg-brand-primary text-slate-900 py-3.5 rounded-xl font-bold uppercase tracking-wider text-[12px] shadow-sm hover:bg-blue-400 hover:scale-[1.01] active:scale-[0.99] transition-all flex items-center justify-center gap-2"
              >
                <span>Send Inquiry</span>
                <ArrowRight size={14} />
              </button>
            </form>
          )}
        </div>

      </section>

      {/* FAQ Section */}
      <FAQAccordion items={contactFAQs} title="Contact & Inquiries FAQ" />
    </div>
  );
};

export default ContactPage;
