import React from 'react';
import { motion } from 'motion/react';
import { FileText, ShieldCheck, CheckCircle2 } from 'lucide-react';

export const TermsOfService: React.FC = () => {
  return (
    <div className="bg-brand-background text-slate-900 pb-24 overflow-x-hidden">
      {/* Header */}
      <header className="pt-32 pb-16 md:pt-40 md:pb-20 px-6 border-b border-slate-200/80 bg-white">
        <div className="max-w-4xl mx-auto text-center space-y-4">
          <div className="inline-flex items-center space-x-2 px-3.5 py-1.5 rounded-full bg-blue-50 border border-blue-100 text-blue-800 text-[11px] font-bold uppercase tracking-wider shadow-sm">
            <FileText size={14} className="text-blue-600" />
            <span>Customer Agreement</span>
          </div>
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-slate-900">
            Terms of Service
          </h1>
          <p className="text-slate-500 text-sm">
            Last Updated: September 04, 2026 • Version 2.4
          </p>
        </div>
      </header>

      {/* Main Content */}
      <div className="max-w-4xl mx-auto px-6 pt-16 space-y-12">
        <div className="bg-white p-8 sm:p-12 rounded-3xl border border-slate-200/90 shadow-sm space-y-10 text-slate-700 text-sm leading-relaxed">
          
          <section className="space-y-4">
            <h2 className="text-xl font-bold text-slate-900">1. Acceptance of Terms</h2>
            <p>
              By accessing or using the EchoNote platform, web application, and related services ("Service"), you agree to be bound by these Terms of Service. If you are accepting on behalf of an organization or corporate entity, you represent and warrant that you have authority to bind that organization.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-bold text-slate-900">2. Service Description & Intellectual Property</h2>
            <p>
              EchoNote provides transcription, decision extraction, organizational memory, and execution tracking tools. You retain full intellectual property rights to all audio recordings, transcripts, and business content uploaded to your workspace.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-bold text-slate-900">3. Usage Quotas and Subscriptions</h2>
            <p>
              Free and paid tiers are subject to monthly transcription minute allowances and AI request quotas as described in the pricing schedule. Paid subscriptions renew automatically unless canceled before the next renewal date. One-time top-up minutes do not expire and roll over indefinitely.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-bold text-slate-900">4. Responsible Conduct & Authorized Recording</h2>
            <p>
              You represent that you have acquired all necessary consents from participants before recording or transcribing spoken conversations in compliance with applicable local, state, and national wiretapping and privacy regulations.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-bold text-slate-900">5. Limitation of Liability & Warranties</h2>
            <p>
              EchoNote provides automated AI intelligence services on an "as is" and "as available" basis. While we strive for maximum transcription and decision extraction accuracy, teams should verify mission-critical decisions prior to commercial commitments.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-bold text-slate-900">6. Termination & Contact</h2>
            <p>
              Either party may terminate the workspace agreement at any time. Upon termination, project owners may export data or request immediate permanent database deletion. For legal notices, contact:
            </p>
            <p className="font-semibold text-slate-900">
              Email: legal@echonote.ai / riyamshah2509@gmail.com
            </p>
          </section>

        </div>
      </div>
    </div>
  );
};

export default TermsOfService;
