import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { 
  ArrowRight, 
  CheckCircle2, 
  Search, 
  Users, 
  Mic, 
  Cpu, 
  ClipboardList, 
  ShieldCheck, 
  Lock, 
  FileText, 
  Layers, 
  History, 
  ChevronDown, 
  ChevronUp, 
  Database, 
  Sparkles, 
  GitBranch, 
  Clock, 
  FileCheck2, 
  Calendar, 
  Compass, 
  Check, 
  ExternalLink,
  Shield,
  HelpCircle,
  BarChart3,
  Server,
  Play,
  Share2,
  Bookmark,
  MessageSquare,
  FileCode,
  FolderGit2,
  Activity,
  UserCheck,
  AlertTriangle,
  ArrowUpRight,
  Zap,
  Sliders
} from 'lucide-react';
import { AuthStatus } from '../types';
import EchoNoteVisionAnimation from '../components/public/EchoNoteVisionAnimation';

interface HomeProps {
  onLogin: () => void;
  onStartFree: () => void;
  onNavigateToDemo: () => void;
  authStatus?: AuthStatus;
  onGoToDashboard: () => void;
}

export const Home: React.FC<HomeProps> = ({ 
  onLogin, 
  onStartFree, 
  onNavigateToDemo, 
  authStatus, 
  onGoToDashboard 
}) => {
  const isLoggedIn = authStatus === AuthStatus.LOGGED_IN;
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(null);

  const toggleFaq = (index: number) => {
    setOpenFaqIndex(prev => prev === index ? null : index);
  };

  const fadeIn = {
    initial: { opacity: 0, y: 16 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, margin: "-40px" },
    transition: { duration: 0.5 }
  };

  // Structured Data definitions for SEO & GEO
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": "https://echonote-25.vercel.app/#organization",
        "name": "EchoNote",
        "url": "https://echonote-25.vercel.app",
        "logo": "https://echonote-25.vercel.app/Logo-2.png",
        "description": "EchoNote is a decision and execution memory layer for coordination-heavy teams, turning conversations into structured decisions, clear ownership, and traceable organizational memory."
      },
      {
        "@type": "SoftwareApplication",
        "@id": "https://echonote-25.vercel.app/#software",
        "name": "EchoNote",
        "applicationCategory": "BusinessApplication",
        "operatingSystem": "Web Browser",
        "description": "Decision and execution memory platform that turns conversations into structured decisions, clear ownership, actionable tasks, and traceable organizational memory.",
        "offers": {
          "@type": "Offer",
          "price": "0",
          "priceCurrency": "USD"
        }
      },
      {
        "@type": "WebSite",
        "@id": "https://echonote-25.vercel.app/#website",
        "url": "https://echonote-25.vercel.app",
        "name": "EchoNote",
        "description": "Decision & Execution Memory for Coordination-Heavy Teams",
        "publisher": {
          "@id": "https://echonote-25.vercel.app/#organization"
        }
      },
      {
        "@type": "FAQPage",
        "@id": "https://echonote-25.vercel.app/#faq",
        "mainEntity": [
          {
            "@type": "Question",
            "name": "What is an AI meeting assistant?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "An AI meeting assistant is software that joins or processes recorded conversations to produce speech-to-text transcripts, high-level summaries, and basic task lists. While conventional meeting assistants focus purely on isolated meeting recaps, EchoNote extends this into continuous organizational memory that links decisions and context across all conversations over time."
            }
          },
          {
            "@type": "Question",
            "name": "What is organizational memory?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Organizational memory is the accumulated body of historical decisions, institutional knowledge, strategic rationale, and execution context preserved across a company. EchoNote creates persistent organizational memory so teams do not lose the 'why' behind past choices when personnel change or time passes."
            }
          },
          {
            "@type": "Question",
            "name": "How does EchoNote turn meetings into decisions?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "EchoNote utilizes deep natural language models to parse conversational speech, identifying points of agreement, strategic trade-offs, assigned owners, explicit commitments, and execution deadlines. It synthesizes these into structured decision cards linked directly to source audio timestamps."
            }
          },
          {
            "@type": "Question",
            "name": "How is EchoNote different from meeting transcription software?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Transcription software only turns spoken words into raw text. EchoNote structures the intelligence inside that text—extracting decisions, cataloging the rationale, recording ownership, highlighting unresolved topics, and tracking what happened next across multiple projects and timelines."
            }
          },
          {
            "@type": "Question",
            "name": "Can EchoNote help teams retrieve decisions from previous meetings?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Yes. EchoNote features unified historical decision search. Instead of re-listening to hours of audio or skimming disparate notes, you can query specific topics (e.g. 'What did we decide about Q4 pricing?') to instantly retrieve the structured decision, rationale, owner, date, and source recording."
            }
          },
          {
            "@type": "Question",
            "name": "What types of teams benefit from organizational decision memory?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Coordination-heavy teams benefit most: Product & Engineering teams managing architectural trade-offs, Operations teams executing cross-functional initiatives, Consulting & Professional Services firms tracking client commitments, and Financial or compliance-focused groups needing clear decision provenance."
            }
          },
          {
            "@type": "Question",
            "name": "Does EchoNote replace Microsoft Teams or Zoom?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "No. EchoNote complements your existing tools. You continue holding meetings on Zoom, Microsoft Teams, Google Meet, or in person, and bring the audio recordings into EchoNote to serve as your organization's decision and execution memory layer."
            }
          },
          {
            "@type": "Question",
            "name": "How does EchoNote track action items and ownership?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "EchoNote automatically extracts actionable commitments from conversational dialogue, associates each item with an explicit owner and timeline, and surfaces unresolved blockers so teams maintain continuity from decision to execution."
            }
          },
          {
            "@type": "Question",
            "name": "What is decision intelligence?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Decision intelligence is the systematic practice of understanding how decisions are formulated, who is accountable, what evidence was evaluated, and how outcomes unfold. EchoNote provides decision intelligence by making historical context searchable, verifiable, and connected."
            }
          },
          {
            "@type": "Question",
            "name": "How does EchoNote handle sensitive business conversations?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "EchoNote implements strict security controls including Firebase token authentication, server-side Firestore security rules, role-based access control (RBAC), TLS 1.3 in-transit encryption, AES-256 at-rest encryption, audit logging, and a zero-training AI policy where customer data is never used to train public models."
            }
          }
        ]
      }
    ]
  };

  const faqs = [
    {
      q: "What is an AI meeting assistant?",
      a: "An AI meeting assistant is software that joins or processes recorded conversations to produce speech-to-text transcripts, high-level summaries, and basic task lists. While conventional meeting assistants focus purely on isolated meeting recaps, EchoNote extends this capability into continuous organizational memory that links decisions and context across all conversations over time."
    },
    {
      q: "What is organizational memory?",
      a: "Organizational memory is the accumulated body of historical decisions, institutional knowledge, strategic rationale, and execution context preserved across an enterprise. EchoNote creates a persistent, searchable system of record so teams never lose the 'why' behind past choices when projects evolve or team members change."
    },
    {
      q: "How does EchoNote turn meetings into decisions?",
      a: "EchoNote analyzes conversational dialogue to isolate explicit agreements, trade-offs, assigned owners, and implementation timelines. Rather than burying decisions in lengthy prose, EchoNote structures each outcome into a distinct decision record with associated rationale, source timestamps, and execution status."
    },
    {
      q: "How is EchoNote different from meeting transcription software?",
      a: "Transcription software only converts spoken audio into raw text documents. EchoNote structures the intelligence inside that text—extracting authoritative decisions, cataloging the rationale, recording ownership, highlighting unresolved topics, and tracking what happened next across multiple projects and timelines."
    },
    {
      q: "Can EchoNote help teams retrieve decisions from previous meetings?",
      a: "Yes. EchoNote features unified historical decision search. Instead of searching through folders of audio files or skimming through disjointed notes, teams can ask specific questions (e.g. 'What did we decide about the Q4 pricing strategy?') and instantly retrieve the structured decision, rationale, owner, and source recording."
    },
    {
      q: "What types of teams benefit from organizational decision memory?",
      a: "EchoNote is built for coordination-heavy teams: Product & Engineering teams managing architectural trade-offs, Operations teams executing cross-functional initiatives, Consulting & Professional Services firms tracking client commitments, and Financial or compliance-conscious groups needing clear decision provenance."
    },
    {
      q: "Does EchoNote replace Microsoft Teams or Zoom?",
      a: "No. EchoNote complements your existing collaboration workflow. You continue conducting conversations in Zoom, Microsoft Teams, Google Meet, or conference rooms, and ingest the recordings into EchoNote to serve as the unified decision and execution memory layer for your organization."
    },
    {
      q: "How does EchoNote track action items and ownership?",
      a: "EchoNote automatically extracts actionable commitments from conversational dialogue, associates each item with an explicit owner and timeline, and surfaces unresolved blockers so teams maintain continuity from decision to execution."
    },
    {
      q: "What is decision intelligence?",
      a: "Decision intelligence is the systematic discipline of capturing, analyzing, and improving how organizations make and execute choices. EchoNote provides decision intelligence by making historical reasoning transparent, searchable, and connected to downstream outcomes."
    },
    {
      q: "How does EchoNote handle sensitive business conversations?",
      a: "EchoNote applies enterprise-grade access boundaries: Firebase token-authenticated sessions, server-enforced Firestore security rules, granular Role-Based Access Control (RBAC), TLS 1.3 transit encryption, AES-256 cloud encryption at rest, comprehensive audit logging, and a strict zero-training AI policy where customer data is never used to train public models."
    }
  ];

  return (
    <div className="bg-brand-background text-slate-900 overflow-x-hidden">
      {/* Structured Data for SEO & GEO */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />

      {/* ========================================================================= */}
      {/* 1. HERO SECTION (Two-Column with Realistic Product UI Preview)           */}
      {/* ========================================================================= */}
      <header className="relative pt-28 pb-20 md:pt-36 md:pb-28 px-6 overflow-hidden">
        {/* Subtle grid backdrop */}
        <div className="absolute inset-0 opacity-[0.03] bg-[linear-gradient(to_right,#5DA9FF_1px,transparent_1px),linear-gradient(to_bottom,#5DA9FF_1px,transparent_1px)] bg-[size:32px_32px] pointer-events-none" />
        <div className="absolute top-1/4 left-1/3 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] bg-gradient-to-tr from-brand-primary/15 via-brand-accent/10 to-transparent rounded-full blur-3xl pointer-events-none -z-10" />

        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-8 items-center relative z-10">
          
          {/* LEFT COLUMN: Strategic Copy & Action CTAs */}
          <div className="lg:col-span-6 flex flex-col items-start text-left space-y-6">
            {/* Eyebrow */}
            <div className="inline-flex items-center space-x-2 px-3.5 py-1.5 rounded-full bg-blue-50 border border-blue-100 text-blue-800 text-[11px] font-bold uppercase tracking-wider shadow-sm">
              <span className="w-2 h-2 rounded-full bg-blue-600 animate-pulse"></span>
              <span>AI-Powered Decision & Execution Memory</span>
            </div>

            {/* Canonical H1 */}
            <h1 className="text-4xl sm:text-5xl xl:text-6xl font-extrabold tracking-tight text-slate-900 leading-[1.12]">
              Remember what your organization decided — <span className="text-slate-500 block">and what happened next.</span>
            </h1>

            {/* Supporting Copy */}
            <p className="text-base sm:text-lg text-slate-600 leading-relaxed font-normal max-w-xl">
              EchoNote turns important conversations into searchable decisions, context, ownership, and follow-through — giving teams a persistent memory of how work gets decided and executed.
            </p>

            {/* Primary & Secondary Action CTAs */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-2 w-full sm:w-auto">
              {isLoggedIn ? (
                <button
                  id="hero-dashboard-btn"
                  onClick={onGoToDashboard}
                  className="bg-brand-primary text-slate-900 px-8 py-3.5 rounded-xl font-bold uppercase tracking-wider text-[12px] shadow-sm hover:bg-blue-400 hover:scale-[1.01] active:scale-[0.99] transition-all flex items-center justify-center space-x-2"
                >
                  <span>Go to Dashboard</span>
                  <ArrowRight size={15} />
                </button>
              ) : (
                <button
                  id="hero-start-free-btn"
                  onClick={onStartFree}
                  className="bg-brand-primary text-slate-900 px-8 py-3.5 rounded-xl font-bold uppercase tracking-wider text-[12px] shadow-sm hover:bg-blue-400 hover:scale-[1.01] active:scale-[0.99] transition-all flex items-center justify-center space-x-2"
                >
                  <span>Start Free</span>
                  <ArrowRight size={15} />
                </button>
              )}
              
              <button
                id="hero-book-demo-btn"
                onClick={onNavigateToDemo}
                className="bg-white text-slate-800 border border-slate-200 px-7 py-3.5 rounded-xl font-bold uppercase tracking-wider text-[12px] hover:bg-slate-50 transition-all text-center shadow-sm flex items-center justify-center space-x-2"
              >
                <span>Book a Demo</span>
                <Calendar size={15} className="text-slate-500" />
              </button>
            </div>

            {/* Reassurance Badges */}
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-1 text-[13px] text-slate-500 font-medium">
              <div className="flex items-center space-x-1.5">
                <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />
                <span>No credit card required</span>
              </div>
              <div className="flex items-center space-x-1.5">
                <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />
                <span>Works with your existing audio</span>
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN: Realistic EchoNote Product UI Mockup */}
          <div className="lg:col-span-6 relative">
            {/* Primary Product Window Frame */}
            <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xl overflow-hidden transition-all">
              
              {/* Window Header / Workspace Toolbar */}
              <div className="bg-slate-900 px-4 py-3 border-b border-slate-800 flex items-center justify-between text-white">
                <div className="flex items-center space-x-2">
                  <div className="flex space-x-1.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-rose-500/80"></div>
                    <div className="w-2.5 h-2.5 rounded-full bg-amber-500/80"></div>
                    <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/80"></div>
                  </div>
                  <span className="text-xs font-mono text-slate-400 pl-2">echonote://workspace/decisions</span>
                </div>
                <div className="flex items-center space-x-2 text-xs">
                  <span className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 font-semibold border border-blue-500/30">
                    Decision Intelligence
                  </span>
                </div>
              </div>

              {/* Product Body */}
              <div className="p-5 sm:p-6 space-y-5 bg-white">
                
                {/* Audio Source / Meeting Header Bar */}
                <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                  <div className="flex items-center space-x-3">
                    <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center text-blue-700">
                      <Mic size={18} />
                    </div>
                    <div>
                      <div className="text-sm font-bold text-slate-900">Pricing Strategy Review</div>
                      <div className="text-xs text-slate-500 flex items-center gap-2">
                        <span>Aug 18, 2026</span>
                        <span>•</span>
                        <span>48 min duration</span>
                        <span>•</span>
                        <span className="text-emerald-700 font-medium">Synchronized</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-200/70 text-slate-700">
                      Source: 42:18
                    </span>
                  </div>
                </div>

                {/* Structured Decision Intelligence Card */}
                <div className="p-4 rounded-xl bg-blue-50/60 border border-blue-100 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-blue-900 flex items-center gap-1.5">
                      <CheckCircle2 size={13} className="text-blue-700" />
                      Key Decision
                    </span>
                    <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-600"></span>
                      IMPLEMENTED
                    </span>
                  </div>
                  <p className="text-base font-bold text-slate-900">
                    Move the enterprise tier to mandatory annual billing contracts.
                  </p>
                  
                  {/* Rationale & Owner Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 text-xs">
                    <div className="p-2.5 rounded-lg bg-white border border-blue-100/80 space-y-1">
                      <div className="font-bold text-slate-500 uppercase text-[10px]">Strategic Rationale (Why)</div>
                      <p className="text-slate-700 leading-snug">
                        Improve annual recurring revenue predictability and streamline procurement cycles.
                      </p>
                    </div>
                    <div className="p-2.5 rounded-lg bg-white border border-blue-100/80 space-y-1">
                      <div className="font-bold text-slate-500 uppercase text-[10px]">Assigned Owner</div>
                      <p className="text-slate-900 font-semibold flex items-center gap-1.5 pt-0.5">
                        <Users size={13} className="text-blue-600" />
                        Revenue Operations
                      </p>
                    </div>
                  </div>
                </div>

                {/* Decision History Progression Tracker */}
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-3">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-600 flex items-center justify-between">
                    <span>Decision History & Follow-Through</span>
                    <span className="text-[10px] text-slate-400 font-normal">Updated 2 days ago</span>
                  </div>

                  <div className="space-y-2 text-xs">
                    <div className="flex items-center gap-2.5 text-slate-700">
                      <div className="w-2 h-2 rounded-full bg-blue-600 shrink-0"></div>
                      <span className="font-mono text-[11px] text-slate-400">Aug 18</span>
                      <span className="font-medium text-slate-900">Decision formulated during Strategy Review</span>
                    </div>
                    <div className="flex items-center gap-2.5 text-slate-700 pl-0.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-slate-400 shrink-0 ml-[1px]"></div>
                      <span className="font-mono text-[11px] text-slate-400">Aug 21</span>
                      <span>Contract templates revised by Legal & RevOps</span>
                    </div>
                    <div className="flex items-center gap-2.5 text-slate-700 pl-0.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-600 shrink-0 ml-[1px]"></div>
                      <span className="font-mono text-[11px] text-slate-400">Sep 02</span>
                      <span className="text-emerald-800 font-semibold">Implementation complete across billing systems</span>
                    </div>
                  </div>
                </div>

              </div>

              {/* Product UI Footer Status Bar */}
              <div className="bg-slate-100 px-4 py-2 border-t border-slate-200 flex items-center justify-between text-[11px] text-slate-500">
                <span className="flex items-center gap-1.5">
                  <Database size={12} className="text-blue-600" />
                  <span>Permanent Record: Synced to Organizational Memory</span>
                </span>
                <span className="font-mono text-[10px]">ID: DEC-2026-0818</span>
              </div>
            </div>

            {/* Floating Product Badge: "Ask EchoNote" Interactive Result */}
            <div className="hidden sm:block absolute -bottom-6 -left-6 bg-slate-900 text-white p-4 rounded-2xl border border-slate-700 shadow-xl max-w-xs transition-transform hover:-translate-y-1">
              <div className="flex items-center space-x-2 text-xs font-bold text-blue-400 mb-1.5">
                <Search size={14} />
                <span>Ask EchoNote</span>
              </div>
              <p className="text-xs text-slate-200 font-medium italic">
                "What did we decide about enterprise pricing?"
              </p>
              <div className="mt-2.5 pt-2 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-400">
                <span className="text-emerald-400 font-semibold">3 related decisions found</span>
                <span>→ View Provenance</span>
              </div>
            </div>

          </div>

        </div>
      </header>

      {/* ========================================================================= */}
      {/* 1.5 BRAND VISION ANIMATION (Conversation -> Decision -> Execution -> Memory)*/}
      {/* ========================================================================= */}
      <section className="pb-16 pt-2 px-6 max-w-7xl mx-auto -mt-6 sm:-mt-8 relative z-20" aria-label="Brand Vision & Intelligence Pipeline">
        <EchoNoteVisionAnimation />
      </section>

      {/* ========================================================================= */}
      {/* 2. PROBLEM SECTION (Text + Fragmented Information Visual Diagram)          */}
      {/* ========================================================================= */}
      <section className="py-20 md:py-28 px-6 border-y border-slate-200/80 bg-white" aria-labelledby="problem-heading">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          
          {/* Left: Problem Explanation */}
          <div className="lg:col-span-5 space-y-6">
            <div className="inline-flex items-center space-x-2 text-slate-500 text-xs font-bold uppercase tracking-widest">
              <History size={15} className="text-blue-600" />
              <span>The Coordination Dilemma</span>
            </div>
            
            <h2 id="problem-heading" className="text-3xl md:text-4xl font-bold tracking-tight text-slate-900 leading-tight">
              Your organization remembers the conversation. <br />
              <span className="text-slate-500">It forgets the decision.</span>
            </h2>
            
            <p className="text-slate-600 text-base leading-relaxed">
              Important decisions become buried across disparate meetings, video calls, Slack threads, doc comments, and email follow-ups. When context evaporates, teams spend valuable hours relitigating settled choices.
            </p>

            {/* Core Questions Checklist */}
            <div className="space-y-3 pt-2">
              <div className="flex items-start space-x-3 text-sm text-slate-700">
                <span className="w-5 h-5 rounded-full bg-red-100 text-red-700 flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">?</span>
                <span className="font-medium">"Why did we decide this?" (Lost strategic trade-offs)</span>
              </div>
              <div className="flex items-start space-x-3 text-sm text-slate-700">
                <span className="w-5 h-5 rounded-full bg-red-100 text-red-700 flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">?</span>
                <span className="font-medium">"Who agreed to do this?" (Ambiguous accountability)</span>
              </div>
              <div className="flex items-start space-x-3 text-sm text-slate-700">
                <span className="w-5 h-5 rounded-full bg-red-100 text-red-700 flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">?</span>
                <span className="font-medium">"What happened after that meeting?" (Broken follow-through)</span>
              </div>
              <div className="flex items-start space-x-3 text-sm text-slate-700">
                <span className="w-5 h-5 rounded-full bg-red-100 text-red-700 flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">?</span>
                <span className="font-medium">"What was the reasoning behind the decision?" (Vanished context)</span>
              </div>
            </div>
          </div>

          {/* Right: Visual Diagram of Fragmented Information vs Connected Memory */}
          <div className="lg:col-span-7 bg-slate-50 rounded-3xl border border-slate-200/90 p-6 sm:p-8 space-y-6">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Information Fragmentation Map</span>
              <span className="text-[11px] px-2 py-0.5 rounded bg-rose-100 text-rose-700 font-bold">The Status Quo</span>
            </div>

            {/* Disjointed Silos Flowing to Chaos */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 rounded-xl bg-white border border-slate-200 text-center space-y-1 shadow-sm">
                <div className="text-xs font-bold text-slate-800">Zoom Call</div>
                <div className="text-[10px] text-slate-400">45m recording</div>
              </div>
              <div className="p-3 rounded-xl bg-white border border-slate-200 text-center space-y-1 shadow-sm">
                <div className="text-xs font-bold text-slate-800">Slack Thread</div>
                <div className="text-[10px] text-slate-400">18 replies</div>
              </div>
              <div className="p-3 rounded-xl bg-white border border-slate-200 text-center space-y-1 shadow-sm">
                <div className="text-xs font-bold text-slate-800">Email Chain</div>
                <div className="text-[10px] text-slate-400">Scattered PDF</div>
              </div>
              <div className="p-3 rounded-xl bg-white border border-slate-200 text-center space-y-1 shadow-sm">
                <div className="text-xs font-bold text-slate-800">Doc Comments</div>
                <div className="text-[10px] text-slate-400">Unresolved</div>
              </div>
            </div>

            {/* The Disconnect Box */}
            <div className="p-4 rounded-xl bg-white border border-rose-200 shadow-sm text-center space-y-2">
              <div className="text-xs font-bold text-rose-700 uppercase tracking-wide">Resulting State: Context Amnesia</div>
              <p className="text-sm font-semibold text-slate-800">
                Settled decisions get relitigated. Ownership is blurred. Past reasoning disappears.
              </p>
            </div>

            {/* EchoNote Solution Connector */}
            <div className="p-5 rounded-2xl bg-blue-600 text-white space-y-2 shadow-md">
              <div className="flex items-center justify-between text-xs text-blue-200 font-mono">
                <span>ECHONOTE_ORGANIZATIONAL_MEMORY</span>
                <span className="text-emerald-300 font-bold">CONNECTED</span>
              </div>
              <p className="text-sm sm:text-base font-bold text-white">
                EchoNote connects conversations directly to structured decisions, verified rationale, and accountable ownership.
              </p>
            </div>
          </div>

        </div>
      </section>

      {/* ========================================================================= */}
      {/* 3. HOW ECHONOTE WORKS (Visual Process Pipeline)                           */}
      {/* ========================================================================= */}
      <section className="py-20 md:py-28 px-6 bg-slate-900 text-white relative overflow-hidden" aria-labelledby="how-it-works-heading">
        <div className="absolute inset-0 opacity-[0.03] bg-[linear-gradient(to_right,#FFFFFF_1px,transparent_1px),linear-gradient(to_bottom,#FFFFFF_1px,transparent_1px)] bg-[size:32px_32px] pointer-events-none" />
        
        <div className="max-w-7xl mx-auto space-y-16 relative z-10">
          <div className="text-center space-y-4 max-w-2xl mx-auto">
            <div className="inline-flex items-center space-x-2 text-blue-400 bg-blue-900/50 border border-blue-500/30 px-3.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider">
              <span>End-to-End Pipeline</span>
            </div>
            <h2 id="how-it-works-heading" className="text-3xl md:text-4xl font-extrabold tracking-tight text-white">
              How EchoNote Works
            </h2>
            <p className="text-slate-400 text-base md:text-lg">
              A continuous, structured process that converts raw conversations into durable organizational memory.
            </p>
          </div>

          {/* 3 Step Visual Product Pipeline */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            
            {/* Step 1: Capture */}
            <div className="p-6 sm:p-8 rounded-2xl bg-slate-800/80 border border-slate-700 space-y-5 flex flex-col justify-between">
              <div className="space-y-4">
                <div className="w-12 h-12 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400 font-bold">
                  <Mic size={24} />
                </div>
                <div className="space-y-1.5">
                  <div className="text-xs font-bold uppercase tracking-wider text-blue-400">Step 1: Ingest</div>
                  <h3 className="text-xl font-bold text-white">1. Capture Conversations</h3>
                  <p className="text-slate-400 text-sm leading-relaxed">
                    Important meetings, phone calls, and planning syncs enter EchoNote through browser recordings or direct file uploads.
                  </p>
                </div>
              </div>

              {/* Step 1 UI Micro-Mockup */}
              <div className="mt-4 p-3.5 rounded-xl bg-slate-900/90 border border-slate-700/80 space-y-2 text-xs font-mono">
                <div className="flex items-center justify-between text-slate-400 text-[11px]">
                  <span>audio_stream.wav</span>
                  <span className="text-emerald-400">● 48.0 kHz</span>
                </div>
                <div className="h-4 flex items-center gap-0.5">
                  {[40, 65, 80, 45, 90, 30, 70, 85, 40, 60, 95, 50, 75, 30, 85, 60, 40].map((h, i) => (
                    <div key={i} className="flex-1 bg-blue-400/80 rounded-full" style={{ height: `${h}%` }} />
                  ))}
                </div>
              </div>
            </div>

            {/* Step 2: Understand */}
            <div className="p-6 sm:p-8 rounded-2xl bg-slate-800/80 border border-slate-700 space-y-5 flex flex-col justify-between">
              <div className="space-y-4">
                <div className="w-12 h-12 rounded-xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400 font-bold">
                  <Cpu size={24} />
                </div>
                <div className="space-y-1.5">
                  <div className="text-xs font-bold uppercase tracking-wider text-purple-400">Step 2: Synthesize</div>
                  <h3 className="text-xl font-bold text-white">2. AI Understanding</h3>
                  <p className="text-slate-400 text-sm leading-relaxed">
                    Specialized AI isolates authoritative decisions, strategic rationale, assigned owners, explicit commitments, and unresolved topics.
                  </p>
                </div>
              </div>

              {/* Step 2 UI Micro-Mockup */}
              <div className="mt-4 p-3.5 rounded-xl bg-slate-900/90 border border-slate-700/80 space-y-1.5 text-xs">
                <div className="flex items-center justify-between text-purple-300 font-bold text-[11px]">
                  <span>Extracted Entities</span>
                  <span>5 detected</span>
                </div>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <span className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 text-[10px] border border-blue-500/30">Decision</span>
                  <span className="px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 text-[10px] border border-purple-500/30">Rationale</span>
                  <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] border border-emerald-500/30">Owner</span>
                  <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[10px] border border-amber-500/30">Risks</span>
                </div>
              </div>
            </div>

            {/* Step 3: Remember & Execute */}
            <div className="p-6 sm:p-8 rounded-2xl bg-slate-800/80 border border-slate-700 space-y-5 flex flex-col justify-between">
              <div className="space-y-4">
                <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-bold">
                  <ClipboardList size={24} />
                </div>
                <div className="space-y-1.5">
                  <div className="text-xs font-bold uppercase tracking-wider text-emerald-400">Step 3: Execute</div>
                  <h3 className="text-xl font-bold text-white">3. Remember & Execute</h3>
                  <p className="text-slate-400 text-sm leading-relaxed">
                    Teams search historical decisions instantly, verify the original trade-offs, track ownership, and follow through to completion.
                  </p>
                </div>
              </div>

              {/* Step 3 UI Micro-Mockup */}
              <div className="mt-4 p-3.5 rounded-xl bg-slate-900/90 border border-slate-700/80 space-y-1.5 text-xs">
                <div className="flex items-center justify-between text-emerald-300 font-bold text-[11px]">
                  <span>Execution State</span>
                  <span className="text-emerald-400">● Live</span>
                </div>
                <div className="text-slate-300 text-[11px] leading-snug">
                  Decision linked across 3 sprint cycles with active owner tracking.
                </div>
              </div>
            </div>

          </div>

          {/* Connected Process Flow Bar */}
          <div className="p-4 rounded-2xl bg-slate-800/60 border border-slate-700 flex flex-wrap items-center justify-center gap-2 sm:gap-4 text-xs font-semibold text-slate-300">
            <span>Conversation</span>
            <span className="text-slate-500">→</span>
            <span className="text-blue-400 font-bold">Capture</span>
            <span className="text-slate-500">→</span>
            <span className="text-purple-400 font-bold">AI Understanding</span>
            <span className="text-slate-500">→</span>
            <span className="text-white font-bold">Decision + Context + Owner</span>
            <span className="text-slate-500">→</span>
            <span className="text-emerald-400 font-bold">Decision History</span>
            <span className="text-slate-500">→</span>
            <span className="text-emerald-300 font-bold">Execution</span>
          </div>

        </div>
      </section>

      {/* ========================================================================= */}
      {/* 4. ASK YOUR ORGANIZATION'S MEMORY (Product Search Showcase)              */}
      {/* ========================================================================= */}
      <section className="py-24 md:py-32 px-6 bg-brand-background" aria-labelledby="memory-search-heading">
        <div className="max-w-7xl mx-auto space-y-16">
          
          <div className="text-center space-y-4 max-w-3xl mx-auto">
            <div className="inline-flex items-center space-x-2 text-blue-700 bg-blue-50 border border-blue-100 px-3.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider">
              <Sparkles size={14} />
              <span>Ask Your Organization's Memory</span>
            </div>
            <h2 id="memory-search-heading" className="text-3xl md:text-4xl font-bold tracking-tight text-slate-900">
              Query historical decisions like querying a database.
            </h2>
            <p className="text-slate-600 text-base md:text-lg leading-relaxed">
              Ask natural questions to retrieve the exact decision, rationale, assigned owner, and verified source recording in seconds.
            </p>
          </div>

          {/* Large Product Search & Intelligence UI Interface */}
          <div className="max-w-4xl mx-auto bg-white rounded-3xl border border-slate-200/90 shadow-xl overflow-hidden">
            
            {/* Search Top Bar */}
            <div className="bg-slate-900 p-6 md:p-8 space-y-4 text-white">
              <div className="flex items-center justify-between text-xs text-slate-400 font-mono">
                <span className="flex items-center gap-2">
                  <Search size={14} className="text-blue-400" />
                  <span>ORGANIZATIONAL_MEMORY_SEARCH</span>
                </span>
                <span className="bg-slate-800 text-slate-300 px-2.5 py-0.5 rounded text-[11px] font-sans">
                  Representative UI Example
                </span>
              </div>
              
              {/* Active Search Input Mockup */}
              <div className="flex items-center gap-3 bg-slate-800 rounded-2xl px-5 py-4 border border-slate-700 shadow-inner">
                <Search size={20} className="text-blue-400 shrink-0" />
                <span className="text-white font-medium text-base sm:text-lg">
                  What did we decide about the Q4 pricing strategy?
                </span>
              </div>
            </div>

            {/* High-Fidelity Result Body */}
            <div className="p-6 md:p-10 space-y-8 bg-white">
              
              <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                
                {/* Decision Block */}
                <div className="md:col-span-12 p-6 rounded-2xl bg-blue-50/60 border border-blue-100 space-y-2">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-blue-900 flex items-center justify-between">
                    <span>Authoritative Decision</span>
                    <span className="text-emerald-800 bg-emerald-100 text-[10px] font-bold px-2 py-0.5 rounded-full">
                      Verified Result
                    </span>
                  </div>
                  <p className="text-xl font-bold text-slate-900">
                    Move the enterprise plan to annual contracts.
                  </p>
                </div>

                {/* Rationale Block */}
                <div className="md:col-span-8 p-5 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    Strategic Rationale (Why)
                  </div>
                  <p className="text-sm sm:text-base text-slate-700 leading-relaxed font-medium">
                    The team agreed that annual contracts would improve revenue predictability, reduce churn in mid-market accounts, and simplify procurement invoicing.
                  </p>
                </div>

                {/* Owner & Date Block */}
                <div className="md:col-span-4 p-5 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-3">
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Owner</div>
                    <div className="text-sm font-bold text-slate-900 mt-0.5 flex items-center gap-1.5">
                      <Users size={14} className="text-blue-600" />
                      Revenue Operations
                    </div>
                  </div>
                  <div className="pt-1 border-t border-slate-200">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Decided On</div>
                    <div className="text-sm text-slate-700 mt-0.5">August 18, 2026</div>
                  </div>
                </div>

                {/* Source Recording Snippet & Status */}
                <div className="md:col-span-6 p-4 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between">
                  <div className="space-y-1">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Source Recording</div>
                    <div className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                      <Play size={13} className="text-blue-600 fill-blue-600" />
                      <span>Pricing Strategy Review — 42:18</span>
                    </div>
                  </div>
                </div>

                <div className="md:col-span-6 p-4 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between">
                  <div className="space-y-1">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Execution Status</div>
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-100/70 text-emerald-800 text-xs font-bold">
                      <CheckCircle2 size={13} className="text-emerald-700" />
                      <span>Implemented</span>
                    </div>
                  </div>
                </div>

              </div>

              {/* Provenance Trail */}
              <div className="pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-4 text-xs">
                <span className="font-bold text-slate-400 uppercase tracking-wider">Provenance Trail</span>
                <div className="flex items-center gap-2 text-slate-600 font-medium">
                  <span className="px-2.5 py-1 rounded bg-slate-100">Meeting Audio</span>
                  <span>→</span>
                  <span className="px-2.5 py-1 rounded bg-blue-50 text-blue-800 font-semibold">Decision</span>
                  <span>→</span>
                  <span className="px-2.5 py-1 rounded bg-slate-100">RevOps Owner</span>
                  <span>→</span>
                  <span className="px-2.5 py-1 rounded bg-emerald-50 text-emerald-800 font-semibold">Billing Live</span>
                </div>
              </div>

            </div>

          </div>

        </div>
      </section>

      {/* ========================================================================= */}
      {/* 5. DECISION HISTORY (Visual Timeline & Lifecycle Dashboard)               */}
      {/* ========================================================================= */}
      <section className="py-20 md:py-28 px-6 bg-white border-y border-slate-200/80" aria-labelledby="history-heading">
        <div className="max-w-7xl mx-auto space-y-16">
          
          <div className="text-center space-y-4 max-w-3xl mx-auto">
            <div className="inline-flex items-center space-x-2 text-slate-500 text-xs font-bold uppercase tracking-widest">
              <GitBranch size={15} className="text-purple-600" />
              <span>Persistent Organizational Memory</span>
            </div>
            <h2 id="history-heading" className="text-3xl md:text-4xl font-bold tracking-tight text-slate-900">
              Decision history that survives team transitions.
            </h2>
            <p className="text-slate-600 text-base md:text-lg leading-relaxed">
              When decisions evolve, EchoNote maintains the full evolutionary chain: what was decided, why, who owned it, and whether it remains active or was superseded.
            </p>
          </div>

          {/* Visual Decision History Timeline Card */}
          <div className="max-w-4xl mx-auto bg-slate-50 rounded-3xl border border-slate-200 p-6 md:p-10 shadow-sm space-y-8">
            
            <div className="flex items-center justify-between border-b border-slate-200 pb-4">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-emerald-500"></span>
                <span className="text-xs font-bold uppercase tracking-wider text-slate-700">Decision Lifecycle Timeline</span>
              </div>
              <span className="text-xs text-slate-400 font-mono">ID: DEC-2026-ARCH-014</span>
            </div>

            <div className="relative pl-6 sm:pl-8 space-y-8 before:content-[''] before:absolute before:left-2 sm:before:left-3 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-300">
              
              {/* Step 1: Decision */}
              <div className="relative space-y-1.5">
                <div className="absolute -left-6 sm:-left-8 top-1 w-3 h-3 rounded-full bg-blue-600 ring-4 ring-blue-100"></div>
                <div className="text-xs font-bold uppercase tracking-wider text-blue-700">1. Decision Established</div>
                <p className="text-base font-bold text-slate-900">
                  Adopt PostgreSQL as the primary relational database for enterprise multi-tenancy.
                </p>
              </div>

              {/* Step 2: Rationale */}
              <div className="relative space-y-1.5">
                <div className="absolute -left-6 sm:-left-8 top-1 w-3 h-3 rounded-full bg-purple-600 ring-4 ring-purple-100"></div>
                <div className="text-xs font-bold uppercase tracking-wider text-purple-700">2. Rationale & Trade-offs</div>
                <p className="text-sm text-slate-600 leading-relaxed">
                  PostgreSQL was selected over NoSQL for strict schema validation, ACID transactional guarantees, and native JSON query support for audit logs.
                </p>
              </div>

              {/* Step 3: Owner & Action */}
              <div className="relative space-y-1.5">
                <div className="absolute -left-6 sm:-left-8 top-1 w-3 h-3 rounded-full bg-slate-700 ring-4 ring-slate-200"></div>
                <div className="text-xs font-bold uppercase tracking-wider text-slate-700">3. Ownership & Immediate Action</div>
                <p className="text-sm text-slate-700 font-medium">
                  Owned by <span className="font-bold text-slate-900">Infrastructure Engineering</span>. Staging cluster provisioned and schema migration completed.
                </p>
              </div>

              {/* Step 4: Outcome & State */}
              <div className="relative space-y-1.5">
                <div className="absolute -left-6 sm:-left-8 top-1 w-3 h-3 rounded-full bg-emerald-600 ring-4 ring-emerald-100"></div>
                <div className="text-xs font-bold uppercase tracking-wider text-emerald-700">4. Outcome & Current State</div>
                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold border border-emerald-200">
                    <Check size={13} />
                    Current / Active
                  </span>
                  <span className="text-xs text-slate-500">
                    Recorded in Architecture Review #14. Zero regression during audit.
                  </span>
                </div>
              </div>

            </div>

          </div>

        </div>
      </section>

      {/* ========================================================================= */}
      {/* 6. MORE THAN MEETING NOTES (Visual Comparison)                            */}
      {/* ========================================================================= */}
      <section className="py-24 md:py-32 px-6 bg-brand-background" aria-labelledby="diff-heading">
        <div className="max-w-7xl mx-auto space-y-16">
          
          <div className="text-center space-y-4 max-w-3xl mx-auto">
            <div className="inline-flex items-center space-x-2 text-blue-700 bg-blue-50 border border-blue-100 px-3.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider">
              <span>Strategic Comparison</span>
            </div>
            <h2 id="diff-heading" className="text-3xl md:text-4xl font-bold tracking-tight text-slate-900">
              More than meeting notes.
            </h2>
            <p className="text-slate-600 text-base md:text-lg leading-relaxed">
              Standard meeting tools treat conversations as disposable, isolated events. EchoNote structures them into connected organizational knowledge.
            </p>
          </div>

          {/* Visual Comparison Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 max-w-5xl mx-auto">
            
            {/* Generic Meeting Assistant */}
            <div className="p-8 rounded-3xl bg-white border border-slate-200 shadow-sm space-y-6">
              <div className="space-y-1 border-b border-slate-100 pb-4">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Isolated Audio Tool</div>
                <h3 className="text-2xl font-bold text-slate-700">Generic Meeting Assistant</h3>
              </div>
              
              <ul className="space-y-4 text-sm text-slate-600">
                <li className="flex items-start gap-3">
                  <span className="text-slate-400 font-bold">✕</span>
                  <span>Generates raw transcripts and isolated meeting summaries</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-slate-400 font-bold">✕</span>
                  <span>Creates transient action lists with no historical memory</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-slate-400 font-bold">✕</span>
                  <span>Loses context as soon as the meeting concludes</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-slate-400 font-bold">✕</span>
                  <span>No concept of cross-meeting decision evolution</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-slate-400 font-bold">✕</span>
                  <span>Requires manual re-reading to locate past rationale</span>
                </li>
              </ul>
            </div>

            {/* EchoNote Decision & Execution Memory */}
            <div className="p-8 rounded-3xl bg-blue-50/50 border-2 border-blue-400 shadow-lg space-y-6">
              <div className="space-y-1 border-b border-blue-100 pb-4">
                <div className="text-xs font-bold uppercase tracking-wider text-blue-700">Decision & Execution Memory</div>
                <h3 className="text-2xl font-bold text-slate-900">EchoNote</h3>
              </div>
              
              <ul className="space-y-4 text-sm text-slate-800 font-medium">
                <li className="flex items-start gap-3">
                  <Check size={16} className="text-blue-600 shrink-0 mt-0.5" />
                  <span>Structures authoritative decisions with clear rationale</span>
                </li>
                <li className="flex items-start gap-3">
                  <Check size={16} className="text-blue-600 shrink-0 mt-0.5" />
                  <span>Builds persistent, cumulative organizational memory</span>
                </li>
                <li className="flex items-start gap-3">
                  <Check size={16} className="text-blue-600 shrink-0 mt-0.5" />
                  <span>Connects decisions across multiple meetings and timelines</span>
                </li>
                <li className="flex items-start gap-3">
                  <Check size={16} className="text-blue-600 shrink-0 mt-0.5" />
                  <span>Tracks explicit ownership and follow-through</span>
                </li>
                <li className="flex items-start gap-3">
                  <Check size={16} className="text-blue-600 shrink-0 mt-0.5" />
                  <span>Enables historical cross-meeting decision search and provenance</span>
                </li>
              </ul>
            </div>

          </div>

        </div>
      </section>

      {/* ========================================================================= */}
      {/* 7. USE CASES (Visual Product Cards)                                      */}
      {/* ========================================================================= */}
      <section className="py-20 md:py-28 px-6 bg-white border-y border-slate-200/80" aria-labelledby="usecases-heading">
        <div className="max-w-7xl mx-auto space-y-16">
          
          <div className="text-center space-y-4 max-w-3xl mx-auto">
            <h2 id="usecases-heading" className="text-3xl md:text-4xl font-bold tracking-tight text-slate-900">
              Tailored for coordination-heavy, high-stakes teams.
            </h2>
            <p className="text-slate-600 text-base md:text-lg leading-relaxed">
              When misalignment carries significant cost, EchoNote gives teams unambiguous clarity on commitments and decisions.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            
            {/* 1. Product & Engineering */}
            <div className="p-8 rounded-3xl bg-slate-50 border border-slate-200 space-y-5">
              <div className="flex items-center justify-between">
                <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center text-blue-700">
                  <Cpu size={20} />
                </div>
                <span className="text-[11px] font-mono text-slate-400">USE_CASE: ENG</span>
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-bold text-slate-900">Product & Engineering</h3>
                <p className="text-slate-600 text-sm leading-relaxed">
                  Keep architectural and product decisions from disappearing into meetings. Maintain traceability for RFCs, technical trade-offs, and roadmap pivots across release cycles.
                </p>
              </div>
              {/* Mini UI Fragment */}
              <div className="p-3 rounded-xl bg-white border border-slate-200 text-xs space-y-1">
                <div className="font-bold text-slate-800">RFC #42 Architecture Pivot</div>
                <div className="text-slate-500 text-[11px]">Decision: Adopt gRPC for internal services • Owner: Platform Team</div>
              </div>
            </div>

            {/* 2. Operations & Strategy */}
            <div className="p-8 rounded-3xl bg-slate-50 border border-slate-200 space-y-5">
              <div className="flex items-center justify-between">
                <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-700">
                  <Layers size={20} />
                </div>
                <span className="text-[11px] font-mono text-slate-400">USE_CASE: OPS</span>
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-bold text-slate-900">Operations & Strategy</h3>
                <p className="text-slate-600 text-sm leading-relaxed">
                  Preserve operational decisions, ownership, and follow-through across cross-functional teams. Prevent recurring debates and misaligned execution priorities.
                </p>
              </div>
              {/* Mini UI Fragment */}
              <div className="p-3 rounded-xl bg-white border border-slate-200 text-xs space-y-1">
                <div className="font-bold text-slate-800">Cross-Team SLA Alignment</div>
                <div className="text-slate-500 text-[11px]">Decision: 4h response window for Tier-1 tickets • Owner: Support Lead</div>
              </div>
            </div>

            {/* 3. Consulting & Professional Services */}
            <div className="p-8 rounded-3xl bg-slate-50 border border-slate-200 space-y-5">
              <div className="flex items-center justify-between">
                <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center text-purple-700">
                  <Users size={20} />
                </div>
                <span className="text-[11px] font-mono text-slate-400">USE_CASE: SERVICES</span>
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-bold text-slate-900">Consulting & Professional Services</h3>
                <p className="text-slate-600 text-sm leading-relaxed">
                  Maintain a persistent record of client decisions, context, scope adjustments, and agreed commitments to protect project margins and prevent scope creep.
                </p>
              </div>
              {/* Mini UI Fragment */}
              <div className="p-3 rounded-xl bg-white border border-slate-200 text-xs space-y-1">
                <div className="font-bold text-slate-800">Client Scope Agreement</div>
                <div className="text-slate-500 text-[11px]">Decision: Scope change approved with +$12k amendment • Owner: Partner</div>
              </div>
            </div>

            {/* 4. Financial & Compliance-Sensitive Teams */}
            <div className="p-8 rounded-3xl bg-slate-50 border border-slate-200 space-y-5">
              <div className="flex items-center justify-between">
                <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center text-amber-700">
                  <ShieldCheck size={20} />
                </div>
                <span className="text-[11px] font-mono text-slate-400">USE_CASE: GOVERNANCE</span>
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-bold text-slate-900">Financial & Compliance-Sensitive Teams</h3>
                <p className="text-slate-600 text-sm leading-relaxed">
                  Maintain traceable context around important conversations and decisions with rigorous data isolation, immutable activity logs, and granular access controls.
                </p>
              </div>
              {/* Mini UI Fragment */}
              <div className="p-3 rounded-xl bg-white border border-slate-200 text-xs space-y-1">
                <div className="font-bold text-slate-800">Audit Provenance Record</div>
                <div className="text-slate-500 text-[11px]">Decision: Dual-approval policy enabled • Verified by Audit Log</div>
              </div>
            </div>

          </div>

        </div>
      </section>

      {/* ========================================================================= */}
      {/* 8. WORKS WITH YOUR EXISTING WORKFLOW (Integration Visuals)               */}
      {/* ========================================================================= */}
      <section className="py-20 md:py-28 px-6 bg-brand-background" aria-labelledby="workflow-heading">
        <div className="max-w-7xl mx-auto space-y-16">
          
          <div className="text-center space-y-4 max-w-3xl mx-auto">
            <div className="inline-flex items-center space-x-2 text-blue-700 bg-blue-50 border border-blue-100 px-3.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider">
              <span>Frictionless Ingestion</span>
            </div>
            <h2 id="workflow-heading" className="text-3xl md:text-4xl font-bold tracking-tight text-slate-900">
              Keep your workflow. Give it a memory.
            </h2>
            <p className="text-slate-600 text-base md:text-lg leading-relaxed">
              EchoNote acts as the intelligent memory layer for the tools your team already uses. No need to replace your conferencing or productivity stack.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            
            <div className="p-6 rounded-2xl bg-white border border-slate-200 space-y-3 shadow-sm">
              <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-blue-700">
                <Mic size={20} />
              </div>
              <h3 className="text-lg font-bold text-slate-900">Universal Ingestion</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Import meeting recordings from Zoom, Teams, Meet, or phone audio across MP3, WAV, M4A, FLAC, and AAC formats.
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-white border border-slate-200 space-y-3 shadow-sm">
              <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center text-purple-700">
                <Users size={20} />
              </div>
              <h3 className="text-lg font-bold text-slate-900">Enterprise SSO</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Federate corporate identity with Google Workspace, Microsoft accounts, and Identity Platform SAML 2.0 / OIDC.
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-white border border-slate-200 space-y-3 shadow-sm">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-700">
                <FileCheck2 size={20} />
              </div>
              <h3 className="text-lg font-bold text-slate-900">Multi-Format Export</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Export structured decisions, action items, and transcripts as PDF, Word (.docx), CSV, JSON, or plain text.
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-white border border-slate-200 space-y-3 shadow-sm">
              <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center text-amber-700">
                <Layers size={20} />
              </div>
              <h3 className="text-lg font-bold text-slate-900">Project Workspaces</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Organize decisions by team, initiative, or client workspace with granular member access controls and tags.
              </p>
            </div>

          </div>

        </div>
      </section>

      {/* ========================================================================= */}
      {/* 9. SECURITY & TRUST (Product Admin Security Visual)                      */}
      {/* ========================================================================= */}
      <section className="py-20 md:py-28 px-6 bg-white border-y border-slate-200/80" aria-labelledby="security-heading">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          
          <div className="lg:col-span-5 space-y-6">
            <div className="inline-flex items-center space-x-2 text-emerald-700 bg-emerald-50 border border-emerald-100 px-3.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider">
              <ShieldCheck size={14} />
              <span>Enterprise Security Controls</span>
            </div>
            
            <h2 id="security-heading" className="text-3xl md:text-4xl font-bold tracking-tight text-slate-900 leading-tight">
              Your conversations contain sensitive information. <br />
              <span className="text-slate-500">EchoNote is built with that reality in mind.</span>
            </h2>
            
            <p className="text-slate-600 text-base leading-relaxed">
              We apply strict multi-tenant data isolation, verified token authentication, server-enforced security rules, and a strict zero-training privacy policy.
            </p>

            <div className="pt-2">
              <Link
                to="/security"
                className="inline-flex items-center gap-2 text-sm font-bold text-blue-600 hover:text-blue-800 transition-colors"
              >
                <span>Read our full Security & Governance Architecture</span>
                <ArrowRight size={15} />
              </Link>
            </div>
          </div>

          {/* Admin Security Dashboard Visual Card */}
          <div className="lg:col-span-7 bg-slate-900 text-white rounded-3xl border border-slate-800 p-6 sm:p-8 space-y-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center gap-2">
                <Shield size={16} className="text-emerald-400" />
                <span className="text-xs font-mono text-slate-300">SECURITY_GOVERNANCE_ACTIVE</span>
              </div>
              <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-semibold">
                Enforced
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div className="p-4 rounded-xl bg-slate-800/80 border border-slate-700 space-y-1.5">
                <div className="font-bold text-white flex items-center gap-1.5">
                  <Lock size={13} className="text-blue-400" />
                  <span>Encryption at Rest & Transit</span>
                </div>
                <p className="text-slate-400 leading-relaxed">
                  TLS 1.3 encryption for all data in transit and AES-256 cloud encryption at rest.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-slate-800/80 border border-slate-700 space-y-1.5">
                <div className="font-bold text-white flex items-center gap-1.5">
                  <Users size={13} className="text-purple-400" />
                  <span>Role-Based Access Control</span>
                </div>
                <p className="text-slate-400 leading-relaxed">
                  Granular Owner, Admin, Member, and Viewer permissions with strict organization boundaries.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-slate-800/80 border border-slate-700 space-y-1.5">
                <div className="font-bold text-white flex items-center gap-1.5">
                  <Activity size={13} className="text-emerald-400" />
                  <span>Immutable Audit Logging</span>
                </div>
                <p className="text-slate-400 leading-relaxed">
                  Complete activity tracking of access events, exports, configuration updates, and provisioning.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-slate-800/80 border border-slate-700 space-y-1.5">
                <div className="font-bold text-white flex items-center gap-1.5">
                  <Cpu size={13} className="text-amber-400" />
                  <span>Zero Model Training</span>
                </div>
                <p className="text-slate-400 leading-relaxed">
                  Your audio and transcribed decisions are never used to train public AI models.
                </p>
              </div>
            </div>
          </div>

        </div>
      </section>

      {/* ========================================================================= */}
      {/* 10. PRICING CTA (Concise Pointer to /pricing)                             */}
      {/* ========================================================================= */}
      <section className="py-20 md:py-24 px-6 bg-brand-background text-center" aria-labelledby="pricing-cta-heading">
        <div className="max-w-4xl mx-auto space-y-6">
          <h2 id="pricing-cta-heading" className="text-3xl md:text-4xl font-bold tracking-tight text-slate-900">
            Start with your team's workflow. Scale with your organization.
          </h2>
          <p className="text-slate-600 text-base md:text-lg max-w-2xl mx-auto leading-relaxed">
            Begin with our free sandbox to test decision memory, then upgrade as your team's volume and collaboration requirements expand.
          </p>
          <div className="pt-2 flex justify-center">
            <Link
              to="/pricing"
              className="inline-flex items-center gap-2 bg-slate-900 text-white px-8 py-3.5 rounded-xl font-bold uppercase tracking-wider text-xs hover:bg-slate-800 transition-all shadow-sm"
            >
              <span>View Plans & Pricing</span>
              <ArrowRight size={15} />
            </Link>
          </div>
        </div>
      </section>

      {/* ========================================================================= */}
      {/* 11. FAQ SECTION (SEO & GEO Friendly Accordion)                           */}
      {/* ========================================================================= */}
      <section className="py-20 md:py-28 px-6 bg-white border-t border-slate-200/80" aria-labelledby="faq-heading">
        <div className="max-w-4xl mx-auto space-y-12">
          
          <div className="text-center space-y-4">
            <h2 id="faq-heading" className="text-3xl md:text-4xl font-bold tracking-tight text-slate-900">
              Frequently Asked Questions
            </h2>
            <p className="text-slate-600 text-base">
              Clear answers about decision memory, organizational knowledge, and how EchoNote fits your workflow.
            </p>
          </div>

          <div className="space-y-4">
            {faqs.map((faq, index) => {
              const isOpen = openFaqIndex === index;
              return (
                <div 
                  key={index}
                  className="rounded-2xl border border-slate-200 bg-slate-50/50 overflow-hidden transition-colors"
                >
                  <button
                    onClick={() => toggleFaq(index)}
                    className="w-full p-6 text-left flex items-center justify-between gap-4 font-bold text-slate-900 hover:text-blue-600 transition-colors focus:outline-none"
                    aria-expanded={isOpen}
                  >
                    <span className="text-base sm:text-lg">{faq.q}</span>
                    <span className="p-1 rounded-lg bg-white border border-slate-200 text-slate-500 shrink-0">
                      {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </span>
                  </button>
                  
                  {isOpen && (
                    <div className="px-6 pb-6 pt-1 text-slate-600 text-sm sm:text-base leading-relaxed border-t border-slate-200/60 bg-white">
                      {faq.a}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

        </div>
      </section>

      {/* ========================================================================= */}
      {/* 12. FINAL CTA SECTION (Strong Visual Motif + Dual Actions)                */}
      {/* ========================================================================= */}
      <section className="py-24 md:py-32 px-6 bg-slate-900 text-white relative overflow-hidden" aria-labelledby="final-cta-heading">
        <div className="absolute inset-0 opacity-[0.05] bg-[linear-gradient(to_right,#5DA9FF_1px,transparent_1px),linear-gradient(to_bottom,#5DA9FF_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="max-w-4xl mx-auto text-center space-y-8 relative z-10">
          <h2 id="final-cta-heading" className="text-4xl md:text-5xl font-extrabold tracking-tight text-white leading-tight">
            Give your organization a memory.
          </h2>
          
          <p className="text-slate-300 text-lg md:text-xl max-w-2xl mx-auto leading-relaxed">
            Turn important conversations into decisions your team can find, understand, and act on.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
            {isLoggedIn ? (
              <button
                id="final-dashboard-btn"
                onClick={onGoToDashboard}
                className="w-full sm:w-auto bg-brand-primary text-slate-900 px-8 py-3.5 rounded-xl font-bold uppercase tracking-wider text-xs shadow-md hover:bg-blue-400 hover:scale-[1.01] active:scale-[0.99] transition-all flex items-center justify-center space-x-2"
              >
                <span>Go to Dashboard</span>
                <ArrowRight size={15} />
              </button>
            ) : (
              <button
                id="final-start-free-btn"
                onClick={onStartFree}
                className="w-full sm:w-auto bg-brand-primary text-slate-900 px-8 py-3.5 rounded-xl font-bold uppercase tracking-wider text-xs shadow-md hover:bg-blue-400 hover:scale-[1.01] active:scale-[0.99] transition-all flex items-center justify-center space-x-2"
              >
                <span>Start Free</span>
                <ArrowRight size={15} />
              </button>
            )}

            <button
              id="final-book-demo-btn"
              onClick={onNavigateToDemo}
              className="w-full sm:w-auto bg-slate-800 text-white border border-slate-700 px-8 py-3.5 rounded-xl font-bold uppercase tracking-wider text-xs hover:bg-slate-700 transition-all flex items-center justify-center space-x-2"
            >
              <span>Book a Demo</span>
              <Calendar size={15} className="text-slate-400" />
            </button>
          </div>

          <p className="text-slate-400 text-xs font-medium pt-2">
            Instant browser onboarding • No credit card required
          </p>
        </div>
      </section>

    </div>
  );
};

export default Home;
