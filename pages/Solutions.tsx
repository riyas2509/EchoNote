import React from 'react';
import { motion } from 'motion/react';
import { 
  Code2, 
  Briefcase, 
  Layers, 
  Landmark, 
  ShieldCheck, 
  CheckCircle2, 
  ArrowRight, 
  Users, 
  GitBranch, 
  Clock, 
  FileText, 
  Calendar,
  AlertCircle
} from 'lucide-react';
import { AuthStatus } from '../types';
import CTASection from '../components/CTASection';
import ProductWindow from '../components/public/ProductWindow';
import FAQAccordion from '../components/public/FAQAccordion';
import SectionHeader from '../components/public/SectionHeader';

interface SolutionsProps {
  onLogin: () => void;
  onStartFree: () => void;
  onNavigateToDemo: () => void;
  authStatus?: AuthStatus;
  onGoToDashboard: () => void;
}

export const Solutions: React.FC<SolutionsProps> = ({
  onLogin,
  onStartFree,
  onNavigateToDemo,
  authStatus,
  onGoToDashboard
}) => {
  const solutionsStructuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": "https://echonote-25.vercel.app/solutions#webpage",
        "name": "EchoNote Solutions for Coordination-Heavy Teams",
        "description": "Tailored decision intelligence and organizational memory workflows for Product & Engineering, Operations, Consulting, and Compliance-Sensitive Teams."
      },
      {
        "@type": "FAQPage",
        "mainEntity": [
          {
            "@type": "Question",
            "name": "How does EchoNote help Product & Engineering teams?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "EchoNote records architectural reviews and sprint retrospectives, turning verbal RFC agreements and trade-offs into permanent, searchable decision records so new engineers understand historical rationale."
            }
          },
          {
            "@type": "Question",
            "name": "How does EchoNote support client-facing Consulting and Advisory firms?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "EchoNote captures client scope changes and advisory commitments directly from discussions, linking agreed deliverables directly to timestamped audio clips for accountability."
            }
          }
        ]
      }
    ]
  };

  const faqs = [
    {
      q: "How does EchoNote integrate into existing engineering workflows?",
      a: "EchoNote complements your issue trackers and documentation tools. Rather than replacing Jira or GitHub, it captures the critical verbal context, debates, and RFC consensus that usually disappear after meetings conclude."
    },
    {
      q: "Can cross-functional teams share decisions across different project workspaces?",
      a: "Yes. Workspaces can be configured with granular access permissions. Operations, Product, and Finance teams can collaborate within shared projects or maintain isolated workspaces as needed."
    },
    {
      q: "How does EchoNote prevent scope creep in client consulting engagements?",
      a: "By extracting verbal agreements, revised deliverables, and scope boundaries directly from client meetings, EchoNote generates a verifiable decision log with audio provenance, eliminating ambiguity."
    },
    {
      q: "Is EchoNote suitable for teams with strict compliance requirements?",
      a: "Yes. EchoNote enforces AES-256 data encryption at rest, TLS 1.3 in transit, strict RBAC, immutable activity logs, and a strict zero-training AI policy ensuring your discussions remain private."
    }
  ];

  return (
    <div className="bg-brand-background text-slate-900 overflow-x-hidden">
      {/* Structured Data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(solutionsStructuredData) }}
      />

      {/* ========================================================================= */}
      {/* 1. HERO SECTION                                                          */}
      {/* ========================================================================= */}
      <header className="pt-32 pb-16 md:pt-40 md:pb-24 px-6 border-b border-slate-200/80 bg-white">
        <div className="max-w-5xl mx-auto text-center space-y-6">
          
          <div className="inline-flex items-center space-x-2 px-3.5 py-1.5 rounded-full bg-blue-50 border border-blue-100 text-blue-800 text-[11px] font-bold uppercase tracking-wider shadow-sm">
            <Layers size={14} className="text-blue-600" />
            <span>Tailored By Team & Function</span>
          </div>

          <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight text-slate-900 leading-[1.12]">
            Give every coordination-heavy team a memory of the <span className="text-blue-600">decisions that move work forward.</span>
          </h1>

          <p className="text-slate-600 text-base sm:text-lg max-w-2xl mx-auto leading-relaxed">
            When teams spend hours debating strategy, architecture, and scope, the greatest risk is forgetting why decisions were made. EchoNote preserves the context that prevents circular rework.
          </p>

          <div className="pt-4 flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={onStartFree}
              className="bg-brand-primary text-slate-900 px-7 py-3.5 rounded-xl font-bold uppercase tracking-wider text-[12px] shadow-sm hover:bg-blue-400 transition-all flex items-center gap-2"
            >
              <span>Start Free For Your Team</span>
              <ArrowRight size={14} />
            </button>
            <button
              onClick={onNavigateToDemo}
              className="bg-white text-slate-800 border border-slate-200 px-7 py-3.5 rounded-xl font-bold uppercase tracking-wider text-[12px] hover:bg-slate-50 transition-all flex items-center gap-2"
            >
              <span>Request Tailored Walkthrough</span>
              <Calendar size={14} className="text-slate-500" />
            </button>
          </div>

        </div>
      </header>

      {/* ========================================================================= */}
      {/* 2. SOLUTIONS BY DOMAIN                                                    */}
      {/* ========================================================================= */}
      <section className="py-20 md:py-28 px-6 max-w-7xl mx-auto space-y-28">

        {/* ------------------------------------------------------------------------- */}
        {/* DOMAIN 1: Product & Engineering                                           */}
        {/* ------------------------------------------------------------------------- */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          <div className="lg:col-span-5 space-y-6">
            <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-blue-50 border border-blue-100 text-blue-700 text-xs font-bold uppercase tracking-wider">
              <Code2 size={14} />
              <span>Product & Engineering</span>
            </div>

            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900 leading-tight">
              Preserve architectural trade-offs and RFC consensus across sprints.
            </h2>

            <div className="space-y-3 text-slate-600 text-sm leading-relaxed">
              <p>
                <strong>The Challenge:</strong> Engineering teams spend hours debating microservices vs. monoliths, database schemas, and API contracts. Six months later, new hires reopen settled debates because the trade-off context wasn't captured.
              </p>
              <p>
                <strong>EchoNote Solution:</strong> Ingest design reviews and architecture discussions. EchoNote extracts the explicit decision, alternatives evaluated, technical risks, and code owners.
              </p>
            </div>

            <div className="pt-2 space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
                <CheckCircle2 size={15} className="text-blue-600" />
                <span>Instant context retrieval for engineer onboarding</span>
              </div>
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
                <CheckCircle2 size={15} className="text-blue-600" />
                <span>RFC decision logs linked to audio timestamps</span>
              </div>
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
                <CheckCircle2 size={15} className="text-blue-600" />
                <span>Elimination of repeated architectural debates</span>
              </div>
            </div>
          </div>

          <div className="lg:col-span-7">
            <ProductWindow 
              title="echonote://eng/architecture-decisions"
              badge="Engineering Intelligence"
              footerText="RFC Consensus Record • Synced to Engineering Workspace"
              footerId="ENG-RFC-042"
            >
              <div className="space-y-4 text-xs">
                <div className="p-4 rounded-xl bg-blue-50/60 border border-blue-100 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-blue-900 uppercase tracking-wider">Architectural Decision</span>
                    <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold text-[10px]">Consensus Reached</span>
                  </div>
                  <h3 className="font-bold text-slate-900 text-sm sm:text-base">
                    Adopt gRPC for internal inter-service communication.
                  </h3>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
                    <span className="text-[10px] font-bold uppercase text-slate-500">Evaluated Trade-off</span>
                    <p className="text-slate-700 leading-snug">REST JSON overhead vs protobuf serialization latency in hot billing path.</p>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
                    <span className="text-[10px] font-bold uppercase text-slate-500">Responsible Lead</span>
                    <p className="text-slate-900 font-semibold flex items-center gap-1.5 pt-0.5">
                      <Users size={12} className="text-blue-600" />
                      Core Platform Lead (Sprint 24)
                    </p>
                  </div>
                </div>
              </div>
            </ProductWindow>
          </div>
        </div>

        {/* ------------------------------------------------------------------------- */}
        {/* DOMAIN 2: Operations & Strategy                                           */}
        {/* ------------------------------------------------------------------------- */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center pt-16 border-t border-slate-200">
          <div className="lg:col-span-7 order-2 lg:order-1">
            <ProductWindow 
              title="echonote://ops/initiative-tracking"
              badge="Operations Memory"
              footerText="Cross-Functional Alignment • Verified Stakeholders"
              footerId="OPS-REV-2026"
            >
              <div className="space-y-3 text-xs">
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">Vendor Selection</span>
                    <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-800 font-bold text-[10px]">Active Transition</span>
                  </div>
                  <h3 className="font-bold text-slate-900 text-sm">
                    Consolidate European logistics under Vendor B with 99.4% SLA requirement.
                  </h3>
                </div>

                <div className="p-3.5 rounded-lg bg-white border border-slate-200 flex items-center justify-between">
                  <div className="space-y-0.5">
                    <div className="font-bold text-slate-900">Contract Finalization & Escrow Setup</div>
                    <div className="text-[10px] text-slate-500">Assigned to: Head of Global Logistics</div>
                  </div>
                  <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                    Target: Q4 W2
                  </span>
                </div>
              </div>
            </ProductWindow>
          </div>

          <div className="lg:col-span-5 order-1 lg:order-2 space-y-6">
            <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-100 text-emerald-700 text-xs font-bold uppercase tracking-wider">
              <Layers size={14} />
              <span>Operations & Strategy</span>
            </div>

            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900 leading-tight">
              Align cross-functional initiatives without communication lag.
            </h2>

            <div className="space-y-3 text-slate-600 text-sm leading-relaxed">
              <p>
                <strong>The Challenge:</strong> Operations leads balance hundreds of moving parts across logistics, product releases, and vendor negotiations where a single misunderstood dependency causes weeks of delay.
              </p>
              <p>
                <strong>EchoNote Solution:</strong> Maintain an unbroken record of operational agreements, vendor commitments, and cross-departmental deadlines with automated ownership tracking.
              </p>
            </div>

            <div className="pt-2 space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
                <CheckCircle2 size={15} className="text-emerald-600" />
                <span>Single source of truth for cross-team dependencies</span>
              </div>
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
                <CheckCircle2 size={15} className="text-emerald-600" />
                <span>Clear accountability and verified owners</span>
              </div>
            </div>
          </div>
        </div>

        {/* ------------------------------------------------------------------------- */}
        {/* DOMAIN 3: Consulting & Professional Services                              */}
        {/* ------------------------------------------------------------------------- */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center pt-16 border-t border-slate-200">
          <div className="lg:col-span-5 space-y-6">
            <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-indigo-50 border border-indigo-100 text-indigo-700 text-xs font-bold uppercase tracking-wider">
              <Briefcase size={14} />
              <span>Consulting & Advisory</span>
            </div>

            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900 leading-tight">
              Protect client commitments and eliminate scope creep.
            </h2>

            <div className="space-y-3 text-slate-600 text-sm leading-relaxed">
              <p>
                <strong>The Challenge:</strong> Advisory engagements thrive on client trust. When verbal scope changes or milestone approvals are forgotten, firms face billing friction or uncompensated overtime.
              </p>
              <p>
                <strong>EchoNote Solution:</strong> Instantly catalog client decisions, advisory approvals, and deliverables with direct link to the exact spoken recording.
              </p>
            </div>

            <div className="pt-2 space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
                <CheckCircle2 size={15} className="text-indigo-600" />
                <span>Verifiable client decision history with audio links</span>
              </div>
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
                <CheckCircle2 size={15} className="text-indigo-600" />
                <span>Clear scope modification audit trails</span>
              </div>
            </div>
          </div>

          <div className="lg:col-span-7">
            <ProductWindow 
              title="echonote://advisory/client-commitments"
              badge="Client Provenance"
              footerText="Verifiable Milestone Log • Audit-Ready"
              footerId="ADV-SCOPE-108"
            >
              <div className="space-y-3 text-xs">
                <div className="p-4 rounded-xl bg-indigo-50/60 border border-indigo-100 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-indigo-900 uppercase tracking-wider">Scope Revision</span>
                    <span className="px-2 py-0.5 rounded bg-indigo-100 text-indigo-800 font-bold text-[10px]">Client Approved</span>
                  </div>
                  <h3 className="font-bold text-slate-900 text-sm">
                    Client approved Phase 2 security audit addition (+2 weeks deliverable extension).
                  </h3>
                </div>

                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Clock size={13} className="text-indigo-600" />
                    <span className="text-slate-700 font-medium">Spoken in Strategy Review (22:45)</span>
                  </div>
                  <span className="font-mono text-[10px] text-slate-400">Verbatim Verified</span>
                </div>
              </div>
            </ProductWindow>
          </div>
        </div>

        {/* ------------------------------------------------------------------------- */}
        {/* DOMAIN 4: Financial & Compliance-Sensitive Teams                           */}
        {/* ------------------------------------------------------------------------- */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center pt-16 border-t border-slate-200">
          <div className="lg:col-span-7 order-2 lg:order-1">
            <ProductWindow 
              title="echonote://governance/compliance-trails"
              badge="Governance & Risk"
              footerText="Immutable Decision History • Zero-Training Guarantee"
              footerId="GOV-AUDIT-901"
            >
              <div className="space-y-3 text-xs">
                <div className="p-4 rounded-xl bg-amber-50/60 border border-amber-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-amber-900 uppercase tracking-wider">Governance Policy</span>
                    <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 font-bold text-[10px]">Enforced</span>
                  </div>
                  <h3 className="font-bold text-slate-900 text-sm">
                    Policy 14-B Updated: Dual authorization required for fund reallocations above $50k.
                  </h3>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                    <div className="text-[10px] font-bold text-slate-500 uppercase">Audit Status</div>
                    <div className="text-slate-900 font-semibold pt-0.5">Complete Logging</div>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                    <div className="text-[10px] font-bold text-slate-500 uppercase">Data Isolation</div>
                    <div className="text-slate-900 font-semibold pt-0.5">AES-256 / TLS 1.3</div>
                  </div>
                </div>
              </div>
            </ProductWindow>
          </div>

          <div className="lg:col-span-5 order-1 lg:order-2 space-y-6">
            <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-amber-50 border border-amber-100 text-amber-800 text-xs font-bold uppercase tracking-wider">
              <Landmark size={14} />
              <span>Financial & Regulated Teams</span>
            </div>

            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900 leading-tight">
              Maintain audit-ready decision trails with strict governance.
            </h2>

            <div className="space-y-3 text-slate-600 text-sm leading-relaxed">
              <p>
                <strong>The Challenge:</strong> Highly regulated sectors require proof of why policies were adopted, who approved them, and that sensitive discussions remain completely isolated.
              </p>
              <p>
                <strong>EchoNote Solution:</strong> Combine granular RBAC, immutable activity logs, and zero-training AI protection to turn policy meetings into defensible institutional records.
              </p>
            </div>

            <div className="pt-2 space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
                <CheckCircle2 size={15} className="text-amber-600" />
                <span>Zero-training AI architecture protects proprietary data</span>
              </div>
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
                <CheckCircle2 size={15} className="text-amber-600" />
                <span>Immutable audit trails for compliance audits</span>
              </div>
            </div>
          </div>
        </div>

      </section>

      {/* ========================================================================= */}
      {/* 3. FAQ SECTION                                                           */}
      {/* ========================================================================= */}
      <FAQAccordion items={faqs} title="Solutions & Use Cases FAQ" />

      {/* ========================================================================= */}
      {/* 4. CTA SECTION                                                           */}
      {/* ========================================================================= */}
      <CTASection 
        onStartFree={onStartFree}
        onNavigateToDemo={onNavigateToDemo}
        onGoToDashboard={onGoToDashboard}
        authStatus={authStatus}
        title="Equip your team with institutional memory."
        subtitle="Start free today or schedule a tailored consultation for your department."
      />
    </div>
  );
};

export default Solutions;
