import React, { useState } from 'react';
import { motion } from 'motion/react';
import { 
  Mic, 
  Cpu, 
  Search, 
  ClipboardList, 
  ShieldCheck, 
  Users, 
  GitBranch, 
  CheckCircle2, 
  Clock, 
  Play, 
  Sparkles, 
  FileText, 
  Sliders, 
  Layers, 
  Database,
  ArrowRight,
  AlertTriangle,
  Lock,
  Zap,
  Activity,
  UserCheck,
  Calendar
} from 'lucide-react';
import { AuthStatus } from '../types';
import CTASection from '../components/CTASection';
import ProductWindow from '../components/public/ProductWindow';
import ProductMemoryFlow from '../components/public/ProductMemoryFlow';
import FAQAccordion from '../components/public/FAQAccordion';
import SectionHeader from '../components/public/SectionHeader';

interface FeaturesProps {
  onLogin: () => void;
  onStartFree: () => void;
  onNavigateToDemo: () => void;
  authStatus?: AuthStatus;
  onGoToDashboard?: () => void;
}

export const Features: React.FC<FeaturesProps> = ({
  onLogin,
  onStartFree,
  onNavigateToDemo,
  authStatus,
  onGoToDashboard
}) => {
  const [activeCategory, setActiveCategory] = useState<'capture' | 'understand' | 'remember' | 'execute' | 'govern'>('capture');

  const fadeIn = {
    initial: { opacity: 0, y: 16 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, margin: "-40px" },
    transition: { duration: 0.5 }
  };

  const featureStructuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "SoftwareApplication",
        "@id": "https://echonote-25.vercel.app/features#software",
        "name": "EchoNote Features",
        "applicationCategory": "BusinessApplication",
        "operatingSystem": "Web Browser",
        "description": "Comprehensive capabilities for turning conversations into structured decisions, clear ownership, actionable tasks, and traceable organizational memory.",
        "offers": {
          "@type": "Offer",
          "price": "0",
          "priceCurrency": "USD"
        }
      },
      {
        "@type": "FAQPage",
        "mainEntity": [
          {
            "@type": "Question",
            "name": "How does EchoNote capture and transcribe spoken conversations?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "EchoNote ingests audio files directly via file upload or live recording, applying multi-speaker identification and high-fidelity speech-to-text models that format spoken dialogue into time-coded speaker transcripts."
            }
          },
          {
            "@type": "Question",
            "name": "How does AI extract decisions instead of simple meeting summaries?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "EchoNote analyzes conversational dynamics to isolate explicit agreements, trade-offs evaluated, assigned owners, and implementation commitments, cataloging them into distinct decision records linked to source audio."
            }
          },
          {
            "@type": "Question",
            "name": "Can teams search decisions made months ago across multiple projects?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Yes. EchoNote's organizational memory search allows users to ask natural questions to instantly retrieve historical decisions, the underlying reasoning, responsible owners, and original recording timestamps."
            }
          }
        ]
      }
    ]
  };

  const faqs = [
    {
      q: "How does EchoNote capture and transcribe spoken conversations?",
      a: "EchoNote ingests audio recordings through direct drag-and-drop file uploads (MP3, WAV, M4A, etc.) or live in-browser recording. It identifies distinct speaker voices and generates synchronized, searchable transcripts linked directly to the playback timeline."
    },
    {
      q: "How does AI extract decisions instead of simple meeting summaries?",
      a: "Rather than producing generic summaries, EchoNote's deep analytical engine detects explicit points of consensus, strategic rationale, alternative options rejected, assigned owners, and action deadlines, structuring them into dedicated decision assets."
    },
    {
      q: "Can teams search decisions made months ago across multiple projects?",
      a: "Yes. EchoNote maintains a persistent organizational memory index. You can search by asking natural-language questions (e.g., 'What was our rationale for adopting PostgreSQL?') and instantly receive the structured decision, owner, date, and verbatim audio snippet."
    },
    {
      q: "How does EchoNote support project execution and follow-through?",
      a: "Every extracted decision can be assigned to owners with associated action items, milestone dates, and status updates (Formulated, In Progress, Implemented, Superseded), preventing settled choices from falling through the cracks."
    },
    {
      q: "What security and governance controls are available for organizations?",
      a: "EchoNote provides granular Role-Based Access Control (Owner, Editor, Viewer), project-level access boundaries, immutable audit activity logs, TLS 1.3 encryption in transit, AES-256 encryption at rest, and a strict zero-training AI policy."
    }
  ];

  return (
    <div className="bg-brand-background text-slate-900 overflow-x-hidden">
      {/* JSON-LD Structured Data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(featureStructuredData) }}
      />

      {/* ========================================================================= */}
      {/* 1. HERO SECTION                                                          */}
      {/* ========================================================================= */}
      <header className="pt-32 pb-16 md:pt-40 md:pb-24 px-6 border-b border-slate-200/80 bg-white">
        <div className="max-w-5xl mx-auto text-center space-y-6">
          
          <div className="inline-flex items-center space-x-2 px-3.5 py-1.5 rounded-full bg-blue-50 border border-blue-100 text-blue-800 text-[11px] font-bold uppercase tracking-wider shadow-sm">
            <Sparkles size={14} className="text-blue-600" />
            <span>Complete Platform Capabilities</span>
          </div>

          <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight text-slate-900 leading-[1.12]">
            Everything your team needs to turn conversations into <span className="text-blue-600">organizational memory.</span>
          </h1>

          <p className="text-slate-600 text-base sm:text-lg max-w-2xl mx-auto leading-relaxed">
            From conversational speech to durable institutional record: capture, understand, remember, execute, and govern the decisions that drive your organization forward.
          </p>

          <div className="pt-4 flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={onStartFree}
              className="bg-brand-primary text-slate-900 px-7 py-3.5 rounded-xl font-bold uppercase tracking-wider text-[12px] shadow-sm hover:bg-blue-400 transition-all flex items-center gap-2"
            >
              <span>Explore Platform Free</span>
              <ArrowRight size={14} />
            </button>
            <button
              onClick={onNavigateToDemo}
              className="bg-white text-slate-800 border border-slate-200 px-7 py-3.5 rounded-xl font-bold uppercase tracking-wider text-[12px] hover:bg-slate-50 transition-all flex items-center gap-2"
            >
              <span>Book a Technical Walkthrough</span>
              <Calendar size={14} className="text-slate-500" />
            </button>
          </div>

        </div>
      </header>

      {/* ========================================================================= */}
      {/* 2. THE 5 CORE PILLARS (Category Overview)                                */}
      {/* ========================================================================= */}
      <section className="py-20 md:py-28 px-6 max-w-7xl mx-auto space-y-24">
        
        {/* Product Memory Flow Diagram */}
        <ProductMemoryFlow theme="light" title="The 5 Stages of Decision & Execution Memory" />

        {/* ========================================================================= */}
        {/* PILLAR 1: CAPTURE                                                         */}
        {/* ========================================================================= */}
        <div id="capture" className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center pt-8">
          
          <div className="lg:col-span-5 space-y-6">
            <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-blue-50 border border-blue-100 text-blue-700 text-xs font-bold uppercase tracking-wider">
              <Mic size={14} />
              <span>01 • Capture</span>
            </div>
            
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900 leading-tight">
              Ingest conversations from any source without friction.
            </h2>
            
            <p className="text-slate-600 text-base leading-relaxed">
              Capture high-stakes meetings, strategy sessions, client calls, and architecture reviews. EchoNote transforms raw audio into timestamped, speaker-separated text with pinpoint accuracy.
            </p>

            <div className="space-y-3 pt-2">
              <div className="flex items-start gap-3 text-sm text-slate-700">
                <CheckCircle2 size={16} className="text-blue-600 shrink-0 mt-0.5" />
                <span><strong>Multi-Format Audio Ingestion:</strong> Drag and drop WAV, MP3, M4A, or record live directly in your browser.</span>
              </div>
              <div className="flex items-start gap-3 text-sm text-slate-700">
                <CheckCircle2 size={16} className="text-blue-600 shrink-0 mt-0.5" />
                <span><strong>Automated Speaker Identification:</strong> Disentangle multiple voices and preserve speaker turn-taking.</span>
              </div>
              <div className="flex items-start gap-3 text-sm text-slate-700">
                <CheckCircle2 size={16} className="text-blue-600 shrink-0 mt-0.5" />
                <span><strong>Synchronized Audio Playback:</strong> Click any transcript paragraph to jump immediately to the source timestamp.</span>
              </div>
            </div>
          </div>

          <div className="lg:col-span-7">
            <ProductWindow 
              title="echonote://audio/capture-ingest"
              badge="Audio Ingestion"
              footerText="Synchronized Audio Waveform & Speaker Separation"
              footerId="ING-2026-0904"
            >
              <div className="space-y-4">
                {/* Audio Player Bar Mockup */}
                <div className="p-4 rounded-xl bg-slate-900 text-white flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-blue-500/20 text-blue-400 flex items-center justify-center">
                      <Play size={18} className="fill-blue-400" />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-200">Architecture_Sync_Q4.wav</div>
                      <div className="text-[10px] text-slate-400">00:14:32 / 00:48:10 • 48.0 kHz WAV</div>
                    </div>
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    Live Synced
                  </span>
                </div>

                {/* Speaker Transcript Stream */}
                <div className="space-y-3 font-sans text-xs">
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-blue-700 flex items-center gap-1.5">
                        <Users size={12} />
                        Speaker 1 (VP Engineering)
                      </span>
                      <span className="font-mono text-[10px] text-slate-400">14:18</span>
                    </div>
                    <p className="text-slate-700 leading-relaxed">
                      "We evaluated both options, and we need to standardize on PostgreSQL for the auth service to guarantee ACID compliance."
                    </p>
                  </div>

                  <div className="p-3 rounded-xl bg-blue-50/50 border border-blue-100 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-800 flex items-center gap-1.5">
                        <Users size={12} />
                        Speaker 2 (Staff Architect)
                      </span>
                      <span className="font-mono text-[10px] text-slate-400">14:32</span>
                    </div>
                    <p className="text-slate-700 leading-relaxed">
                      "Agreed. I will own the schema migration script and target deployment for Sprint 24."
                    </p>
                  </div>
                </div>
              </div>
            </ProductWindow>
          </div>

        </div>

        {/* ========================================================================= */}
        {/* PILLAR 2: UNDERSTAND                                                      */}
        {/* ========================================================================= */}
        <div id="understand" className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center pt-16 border-t border-slate-200">
          
          <div className="lg:col-span-7 order-2 lg:order-1">
            <ProductWindow 
              title="echonote://intelligence/decision-extraction"
              badge="Decision Analysis"
              footerText="AI Structured Decision Extraction Engine"
              footerId="DEC-EXTRACT-084"
            >
              <div className="space-y-4">
                {/* Decision Block */}
                <div className="p-4 rounded-xl bg-blue-50/70 border border-blue-100 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-blue-900 flex items-center gap-1.5">
                      <CheckCircle2 size={13} className="text-blue-600" />
                      Isolated Agreement
                    </span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                      High Confidence
                    </span>
                  </div>
                  <p className="text-sm sm:text-base font-bold text-slate-900">
                    Standardize authentication service on PostgreSQL.
                  </p>
                </div>

                {/* Multi-Entity Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
                    <div className="font-bold text-slate-500 uppercase text-[10px]">Strategic Rationale (Why)</div>
                    <p className="text-slate-700 leading-snug">
                      Guarantees ACID transactions across distributed session tokens and prevents race conditions.
                    </p>
                  </div>

                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
                    <div className="font-bold text-slate-500 uppercase text-[10px]">Assigned Owner</div>
                    <p className="text-slate-900 font-semibold flex items-center gap-1.5 pt-0.5">
                      <Users size={12} className="text-blue-600" />
                      Staff Architect (Engineering)
                    </p>
                  </div>

                  <div className="p-3 rounded-lg bg-amber-50/60 border border-amber-200 space-y-1">
                    <div className="font-bold text-amber-800 uppercase text-[10px] flex items-center gap-1">
                      <AlertTriangle size={11} />
                      Evaluated Risk
                    </div>
                    <p className="text-slate-700 leading-snug">
                      Requires 30m maintenance window for initial schema migration during off-peak hours.
                    </p>
                  </div>

                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
                    <div className="font-bold text-slate-500 uppercase text-[10px]">Unresolved Topic</div>
                    <p className="text-slate-700 leading-snug">
                      Connection pooling thresholds to be benchmarked in staging environment.
                    </p>
                  </div>
                </div>
              </div>
            </ProductWindow>
          </div>

          <div className="lg:col-span-5 order-1 lg:order-2 space-y-6">
            <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-purple-50 border border-purple-100 text-purple-700 text-xs font-bold uppercase tracking-wider">
              <Cpu size={14} />
              <span>02 • Understand</span>
            </div>
            
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900 leading-tight">
              Extract decisions, trade-offs, and owners automatically.
            </h2>
            
            <p className="text-slate-600 text-base leading-relaxed">
              Don't get lost in pages of transcript text. EchoNote's specialized analytical models extract what matters most: agreed choices, the rationale behind them, who owns what, and potential operational risks.
            </p>

            <div className="space-y-3 pt-2">
              <div className="flex items-start gap-3 text-sm text-slate-700">
                <CheckCircle2 size={16} className="text-purple-600 shrink-0 mt-0.5" />
                <span><strong>Authoritative Decision Cards:</strong> Clearly defined choices isolated from casual conversation.</span>
              </div>
              <div className="flex items-start gap-3 text-sm text-slate-700">
                <CheckCircle2 size={16} className="text-purple-600 shrink-0 mt-0.5" />
                <span><strong>The "Why" Context:</strong> Explicit strategic rationale and alternative options rejected.</span>
              </div>
              <div className="flex items-start gap-3 text-sm text-slate-700">
                <CheckCircle2 size={16} className="text-purple-600 shrink-0 mt-0.5" />
                <span><strong>Risk & Open Topics:</strong> Unresolved questions flagged before they cause downstream delays.</span>
              </div>
            </div>
          </div>

        </div>

        {/* ========================================================================= */}
        {/* PILLAR 3: REMEMBER                                                        */}
        {/* ========================================================================= */}
        <div id="remember" className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center pt-16 border-t border-slate-200">
          
          <div className="lg:col-span-5 space-y-6">
            <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-indigo-50 border border-indigo-100 text-indigo-700 text-xs font-bold uppercase tracking-wider">
              <Database size={14} />
              <span>03 • Remember</span>
            </div>
            
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900 leading-tight">
              Query past decisions like searching a unified database.
            </h2>
            
            <p className="text-slate-600 text-base leading-relaxed">
              EchoNote provides unified semantic search across your entire organization. Ask natural questions to instantly surface the decision, historical rationale, and exact source recording.
            </p>

            <div className="space-y-3 pt-2">
              <div className="flex items-start gap-3 text-sm text-slate-700">
                <CheckCircle2 size={16} className="text-indigo-600 shrink-0 mt-0.5" />
                <span><strong>Natural Language Querying:</strong> Ask "What did we decide about Q4 pricing?" and receive instant structured results.</span>
              </div>
              <div className="flex items-start gap-3 text-sm text-slate-700">
                <CheckCircle2 size={16} className="text-indigo-600 shrink-0 mt-0.5" />
                <span><strong>Verifiable Provenance Trail:</strong> Trace every single decision back to the exact meeting and audio second.</span>
              </div>
              <div className="flex items-start gap-3 text-sm text-slate-700">
                <CheckCircle2 size={16} className="text-indigo-600 shrink-0 mt-0.5" />
                <span><strong>Cross-Meeting Continuity:</strong> Connect related decisions across multiple quarters and project teams.</span>
              </div>
            </div>
          </div>

          <div className="lg:col-span-7">
            <ProductWindow 
              title="echonote://memory/provenance-search"
              badge="Memory Search"
              footerText="Verifiable Provenance: Audio → Decision → Owner → Execution"
              footerId="MEM-QUERY-2026"
            >
              <div className="space-y-4">
                {/* Search Bar */}
                <div className="p-3.5 rounded-xl bg-slate-900 text-white flex items-center gap-3">
                  <Search size={16} className="text-blue-400 shrink-0" />
                  <span className="text-xs sm:text-sm font-medium text-slate-200">
                    "What was our database decision for the auth service?"
                  </span>
                </div>

                {/* Structured Memory Result */}
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900 text-sm">PostgreSQL Authentication Migration</span>
                    <span className="font-mono text-[10px] text-slate-400">Sep 04, 2026</span>
                  </div>
                  
                  <p className="text-slate-700 leading-relaxed">
                    Decided to migrate auth from Mongo to PostgreSQL to preserve transactional consistency during token revocation.
                  </p>

                  {/* Provenance Trail */}
                  <div className="pt-2 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                    <span className="text-slate-500 font-bold uppercase text-[10px]">Decision Provenance</span>
                    <div className="flex items-center gap-1.5 text-slate-600">
                      <span className="px-2 py-0.5 rounded bg-white border border-slate-200">Architecture Sync (14:32)</span>
                      <span>→</span>
                      <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-800 font-semibold">Active</span>
                    </div>
                  </div>
                </div>
              </div>
            </ProductWindow>
          </div>

        </div>

        {/* ========================================================================= */}
        {/* PILLAR 4: EXECUTE                                                         */}
        {/* ========================================================================= */}
        <div id="execute" className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center pt-16 border-t border-slate-200">
          
          <div className="lg:col-span-7 order-2 lg:order-1">
            <ProductWindow 
              title="echonote://execution/action-tracker"
              badge="Execution Tracking"
              footerText="Accountable Ownership & Progress Continuity"
              footerId="EXEC-TRACK-112"
            >
              <div className="space-y-3 text-xs">
                {/* Tracker Row 1 */}
                <div className="p-3.5 rounded-xl bg-white border border-slate-200 shadow-xs flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                      <CheckCircle2 size={14} />
                    </div>
                    <div>
                      <div className="font-bold text-slate-900">Draft PostgreSQL Schema Migration Script</div>
                      <div className="text-[10px] text-slate-500">Owner: Staff Architect • Linked to DEC-2026-ARCH-014</div>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold shrink-0">
                    Done
                  </span>
                </div>

                {/* Tracker Row 2 */}
                <div className="p-3.5 rounded-xl bg-white border border-slate-200 shadow-xs flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
                      <Clock size={14} />
                    </div>
                    <div>
                      <div className="font-bold text-slate-900">Benchmark connection pooling in staging</div>
                      <div className="text-[10px] text-slate-500">Owner: DevOps Lead • Due: Sprint 24</div>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 text-[10px] font-bold shrink-0">
                    In Progress
                  </span>
                </div>

                {/* Tracker Row 3 */}
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center shrink-0">
                      <Sliders size={14} />
                    </div>
                    <div>
                      <div className="font-bold text-slate-700">Schedule off-peak migration window</div>
                      <div className="text-[10px] text-slate-500">Owner: VP Engineering • Due: Sprint 25</div>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 text-[10px] font-bold shrink-0">
                    Planned
                  </span>
                </div>
              </div>
            </ProductWindow>
          </div>

          <div className="lg:col-span-5 order-1 lg:order-2 space-y-6">
            <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-100 text-emerald-700 text-xs font-bold uppercase tracking-wider">
              <ClipboardList size={14} />
              <span>04 • Execute</span>
            </div>
            
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900 leading-tight">
              Maintain continuity from agreement to execution.
            </h2>
            
            <p className="text-slate-600 text-base leading-relaxed">
              Decisions without follow-through become forgotten ideas. EchoNote maps assigned owners directly to extracted action items, tracking milestones until completion.
            </p>

            <div className="space-y-3 pt-2">
              <div className="flex items-start gap-3 text-sm text-slate-700">
                <CheckCircle2 size={16} className="text-emerald-600 shrink-0 mt-0.5" />
                <span><strong>Explicit Ownership:</strong> Assign responsible teammates to specific commitments.</span>
              </div>
              <div className="flex items-start gap-3 text-sm text-slate-700">
                <CheckCircle2 size={16} className="text-emerald-600 shrink-0 mt-0.5" />
                <span><strong>Status Lifecycle:</strong> Monitor execution progress across sprint cycles and reviews.</span>
              </div>
              <div className="flex items-start gap-3 text-sm text-slate-700">
                <CheckCircle2 size={16} className="text-emerald-600 shrink-0 mt-0.5" />
                <span><strong>Decision Evolution:</strong> Track when older decisions are updated, refined, or superseded.</span>
              </div>
            </div>
          </div>

        </div>

        {/* ========================================================================= */}
        {/* PILLAR 5: GOVERN                                                          */}
        {/* ========================================================================= */}
        <div id="govern" className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center pt-16 border-t border-slate-200">
          
          <div className="lg:col-span-5 space-y-6">
            <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-amber-50 border border-amber-100 text-amber-800 text-xs font-bold uppercase tracking-wider">
              <ShieldCheck size={14} />
              <span>05 • Govern</span>
            </div>
            
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900 leading-tight">
              Enterprise access boundaries, audit trails, and data isolation.
            </h2>
            
            <p className="text-slate-600 text-base leading-relaxed">
              Sensitive strategic conversations require strict boundaries. EchoNote enforces granular role-based permissions, real-time audit logging, and private data processing.
            </p>

            <div className="space-y-3 pt-2">
              <div className="flex items-start gap-3 text-sm text-slate-700">
                <CheckCircle2 size={16} className="text-amber-600 shrink-0 mt-0.5" />
                <span><strong>Role-Based Access Control (RBAC):</strong> Define Owners, Editors, and Viewers per workspace.</span>
              </div>
              <div className="flex items-start gap-3 text-sm text-slate-700">
                <CheckCircle2 size={16} className="text-amber-600 shrink-0 mt-0.5" />
                <span><strong>Immutable Audit Trails:</strong> Automatically track all audio uploads, transcript views, and role changes.</span>
              </div>
              <div className="flex items-start gap-3 text-sm text-slate-700">
                <CheckCircle2 size={16} className="text-amber-600 shrink-0 mt-0.5" />
                <span><strong>Zero-Training Guarantee:</strong> Your proprietary business discussions are never used to train global AI models.</span>
              </div>
            </div>
          </div>

          <div className="lg:col-span-7">
            <ProductWindow 
              title="echonote://admin/governance-audit"
              badge="Security & Governance"
              footerText="Enterprise RBAC & Security Enforced"
              footerId="AUDIT-LOG-2026"
            >
              <div className="space-y-3 text-xs">
                {/* Audit Item 1 */}
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <UserCheck size={14} className="text-blue-600" />
                    <div>
                      <span className="font-bold text-slate-900">Project Role Updated: </span>
                      <span className="text-slate-600">alex@company.com assigned Editor role</span>
                    </div>
                  </div>
                  <span className="font-mono text-[10px] text-slate-400">10:14 AM</span>
                </div>

                {/* Audit Item 2 */}
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <Activity size={14} className="text-emerald-600" />
                    <div>
                      <span className="font-bold text-slate-900">Decision Verified: </span>
                      <span className="text-slate-600">Pricing Tier 2026 set to Implemented</span>
                    </div>
                  </div>
                  <span className="font-mono text-[10px] text-slate-400">09:45 AM</span>
                </div>

                {/* Audit Item 3 */}
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <Lock size={14} className="text-amber-600" />
                    <div>
                      <span className="font-bold text-slate-900">Session Verified: </span>
                      <span className="text-slate-600">TLS 1.3 encrypted token handshake</span>
                    </div>
                  </div>
                  <span className="font-mono text-[10px] text-slate-400">08:30 AM</span>
                </div>
              </div>
            </ProductWindow>
          </div>

        </div>

      </section>

      {/* ========================================================================= */}
      {/* 3. FAQ SECTION                                                           */}
      {/* ========================================================================= */}
      <FAQAccordion items={faqs} title="Features & Capabilities FAQ" />

      {/* ========================================================================= */}
      {/* 4. CTA SECTION                                                           */}
      {/* ========================================================================= */}
      <CTASection 
        onStartFree={onStartFree}
        onNavigateToDemo={onNavigateToDemo}
        onGoToDashboard={onGoToDashboard}
        authStatus={authStatus}
        title="Ready to turn conversations into organizational memory?"
        subtitle="Start free with your team today or book a personalized technical walkthrough."
      />
    </div>
  );
};

export default Features;
