import React from 'react';
import { motion } from 'motion/react';
import { 
  ShieldCheck, 
  Lock, 
  Users, 
  Activity, 
  Zap, 
  Check, 
  KeyRound, 
  Database, 
  Server, 
  FileCheck,
  Building2,
  Clock,
  ArrowRight,
  Sparkles
} from 'lucide-react';
import { Link } from 'react-router-dom';
import ProductWindow from './public/ProductWindow';
import FAQAccordion from './public/FAQAccordion';
import SectionHeader from './public/SectionHeader';

export const SecurityPage: React.FC = () => {
  const securityStructuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": "https://echonote-25.vercel.app/security#webpage",
        "name": "EchoNote Security & Data Governance Architecture",
        "description": "Comprehensive security architecture, role-based access control, zero-training AI policy, and encryption standards for EchoNote."
      },
      {
        "@type": "FAQPage",
        "mainEntity": [
          {
            "@type": "Question",
            "name": "Are conversations used to train AI models?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "No. EchoNote processes all audio, transcriptions, and decision intelligence via secure private API endpoints. Your conversational data is never utilized for global foundation model retraining."
            }
          },
          {
            "@type": "Question",
            "name": "How is project data isolated between different teams?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Data isolation is enforced at the database layer through Firestore security rules. Only users explicitly designated as Project Owners, Editors, or Viewers can read or modify project assets."
            }
          }
        ]
      }
    ]
  };

  const securityFAQs = [
    {
      q: "Does EchoNote use my audio or transcripts to train AI models?",
      a: "No. EchoNote operates under a strict zero-training policy. Audio uploads, transcripts, extracted decisions, and strategic analyses are processed via private, server-side API calls and are never retained for global AI model training."
    },
    {
      q: "How does EchoNote enforce data access boundaries?",
      a: "EchoNote enforces database-level security rules for every transaction. Requests are verified using cryptographically signed Firebase authentication tokens, ensuring users can only read or write within workspaces where they are explicit members."
    },
    {
      q: "What encryption standards protect data in transit and at rest?",
      a: "All network traffic is encrypted using TLS 1.3 in transit. Audio recordings, transcripts, and database records are encrypted at rest using AES-256 standard encryption algorithms."
    },
    {
      q: "What roles and permissions are available in EchoNote?",
      a: "Workspaces support three distinct roles: Owner (workspace management, billing, role assignment, project deletion), Editor (audio upload, transcription, decision editing, action tracking), and Viewer (read-only access to transcripts and verified decision logs)."
    },
    {
      q: "Can enterprise clients export or permanently delete their data?",
      a: "Yes. Project owners can export complete decision registries and transcripts in structured JSON/Markdown formats or permanently delete projects, audio files, and historical activity logs at any time."
    }
  ];

  return (
    <div className="bg-brand-background text-slate-900 pb-20 overflow-x-hidden">
      {/* JSON-LD Schema */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(securityStructuredData) }}
      />

      {/* ========================================================================= */}
      {/* 1. HERO SECTION                                                          */}
      {/* ========================================================================= */}
      <header className="pt-32 pb-16 md:pt-40 md:pb-24 px-6 border-b border-slate-200/80 bg-white">
        <div className="max-w-5xl mx-auto text-center space-y-6">
          
          <div className="inline-flex items-center space-x-2 px-3.5 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] font-bold uppercase tracking-wider shadow-sm">
            <ShieldCheck size={14} className="text-emerald-600" />
            <span>Security & Governance</span>
          </div>

          <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight text-slate-900 leading-[1.12]">
            Your organization's conversations deserve <span className="text-blue-600">careful handling.</span>
          </h1>

          <p className="text-slate-600 text-base sm:text-lg max-w-2xl mx-auto leading-relaxed">
            From cryptographically verified sessions to database-level access rules and zero-training AI processing, EchoNote is built for high-trust collaboration.
          </p>

          <div className="pt-4 flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/app"
              className="bg-brand-primary text-slate-900 px-7 py-3.5 rounded-xl font-bold uppercase tracking-wider text-[12px] shadow-sm hover:bg-blue-400 transition-all flex items-center gap-2"
            >
              <span>Explore Secure Workspace</span>
              <ArrowRight size={14} />
            </Link>
            <Link
              to="/contact"
              className="bg-white text-slate-800 border border-slate-200 px-7 py-3.5 rounded-xl font-bold uppercase tracking-wider text-[12px] hover:bg-slate-50 transition-all flex items-center gap-2"
            >
              <span>Request Security Review</span>
              <FileCheck size={14} className="text-slate-500" />
            </Link>
          </div>

        </div>
      </header>

      {/* ========================================================================= */}
      {/* 2. CORE IMPLEMENTED CAPABILITIES                                         */}
      {/* ========================================================================= */}
      <section className="py-20 md:py-28 px-6 max-w-7xl mx-auto space-y-24">
        
        <div className="text-center space-y-3 max-w-2xl mx-auto">
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900">
            Implemented Security Architecture
          </h2>
          <p className="text-slate-600 text-sm sm:text-base">
            Every layer of EchoNote enforces isolation, verification, and privacy by design.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[
            {
              icon: <Lock className="text-blue-600" size={22} />,
              title: "AES-256 & TLS 1.3 Encryption",
              desc: "All audio files and database records are encrypted at rest using AES-256. Web client communication is secured with modern TLS 1.3 protocol standards."
            },
            {
              icon: <Users className="text-indigo-600" size={22} />,
              title: "Granular RBAC Controls",
              desc: "Explicit Project Owner, Editor, and Viewer roles govern who can ingest audio, extract decisions, edit notes, or invite workspace collaborators."
            },
            {
              icon: <Server className="text-emerald-600" size={22} />,
              title: "Server-Side Firestore Rules",
              desc: "Database access rules run on Google Cloud servers for every single read and write, ensuring bulletproof cross-tenant data isolation."
            },
            {
              icon: <Zap className="text-amber-600" size={22} />,
              title: "Zero-Training AI Guarantee",
              desc: "Proprietary strategic conversations and transcript extracts are never used to train or refine global foundation AI models."
            },
            {
              icon: <Activity className="text-purple-600" size={22} />,
              title: "Immutable Activity Trails",
              desc: "Crucial project actions, audio uploads, decision status shifts, and role changes are recorded in a real-time chronological audit trail."
            },
            {
              icon: <KeyRound className="text-sky-600" size={22} />,
              title: "Corporate Identity & SSO",
              desc: "Seamless, secure authentication via Google Workspace and corporate Microsoft accounts with signed JWT session tokens."
            }
          ].map((item, idx) => (
            <div 
              key={idx}
              className="p-8 rounded-3xl bg-white border border-slate-200/90 shadow-sm hover:shadow-md transition-all space-y-4"
            >
              <div className="w-12 h-12 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-center">
                {item.icon}
              </div>
              <h3 className="text-lg font-bold text-slate-900">{item.title}</h3>
              <p className="text-slate-600 text-xs sm:text-sm leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>

        {/* ========================================================================= */}
        {/* ARCHITECTURE DIAGRAM MOCKUP                                               */}
        {/* ========================================================================= */}
        <div className="pt-8">
          <ProductWindow
            title="echonote://security/boundary-architecture"
            badge="Enforced Access Architecture"
            footerText="Server-Side Verification • TLS 1.3 Encrypted Handshake"
            footerId="SEC-ARCH-2026"
          >
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center text-xs">
                
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                  <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center mx-auto">
                    <KeyRound size={16} />
                  </div>
                  <div className="font-bold text-slate-900">1. Client Auth Layer</div>
                  <p className="text-slate-600 text-[11px] leading-snug">
                    Google / Microsoft SSO issuance of signed JWT session token.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-blue-50/60 border border-blue-100 space-y-2">
                  <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center mx-auto">
                    <ShieldCheck size={16} />
                  </div>
                  <div className="font-bold text-slate-900">2. Database Rules Engine</div>
                  <p className="text-slate-600 text-[11px] leading-snug">
                    Server evaluates token claims and project member list on every transaction.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                  <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto">
                    <Database size={16} />
                  </div>
                  <div className="font-bold text-slate-900">3. Encrypted Data Store</div>
                  <p className="text-slate-600 text-[11px] leading-snug">
                    AES-256 storage buckets & isolated Firestore collections.
                  </p>
                </div>

              </div>

              {/* RBAC Breakdown */}
              <div className="p-5 rounded-2xl bg-slate-900 text-white space-y-4">
                <div className="flex items-center justify-between text-xs border-b border-slate-800 pb-3">
                  <span className="font-bold text-blue-400 uppercase tracking-wider">Role-Based Access Control Matrix</span>
                  <span className="text-slate-400 font-mono text-[10px]">RBAC Policy v2.4</span>
                </div>
                
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <div className="p-3 rounded-lg bg-slate-800/80 space-y-1">
                    <span className="font-bold text-white flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                      Owner
                    </span>
                    <p className="text-slate-400 text-[11px]">Full admin rights, invite members, billing management, project deletion.</p>
                  </div>

                  <div className="p-3 rounded-lg bg-slate-800/80 space-y-1">
                    <span className="font-bold text-white flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-blue-400"></span>
                      Editor
                    </span>
                    <p className="text-slate-400 text-[11px]">Upload audio, run intelligence extractions, edit decisions, update action status.</p>
                  </div>

                  <div className="p-3 rounded-lg bg-slate-800/80 space-y-1">
                    <span className="font-bold text-white flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-slate-400"></span>
                      Viewer
                    </span>
                    <p className="text-slate-400 text-[11px]">Read-only access to transcripts, verified decisions, and provenance search.</p>
                  </div>
                </div>
              </div>
            </div>
          </ProductWindow>
        </div>

      </section>

      {/* ========================================================================= */}
      {/* 3. FAQ SECTION                                                           */}
      {/* ========================================================================= */}
      <FAQAccordion items={securityFAQs} title="Security & Compliance FAQs" />

      {/* ========================================================================= */}
      {/* 4. ENTERPRISE SECURITY CONTACT                                           */}
      {/* ========================================================================= */}
      <div className="max-w-4xl mx-auto px-6 pt-12 text-center">
        <div className="p-8 rounded-3xl bg-white border border-slate-200/90 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="text-left space-y-1">
            <h3 className="text-xl font-bold text-slate-900">Conducting vendor security diligence?</h3>
            <p className="text-slate-600 text-xs sm:text-sm">We provide security questionnaire responses and architecture whitepapers.</p>
          </div>
          <Link
            to="/contact"
            className="shrink-0 bg-slate-900 text-white px-6 py-3 rounded-xl font-bold uppercase tracking-wider text-[11px] hover:bg-slate-800 transition-all flex items-center gap-1.5"
          >
            <span>Request Security Questionnaire</span>
            <ArrowRight size={13} />
          </Link>
        </div>
      </div>

    </div>
  );
};

export default SecurityPage;
