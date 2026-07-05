
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  ArrowRight, 
  CheckCircle2, 
  ShieldCheck, 
  Zap, 
  Users, 
  FileText, 
  BarChart3, 
  Lock, 
  Play, 
  Pause,
  ChevronRight,
  Search,
  MessageSquare,
  Clock,
  Check,
  Mic,
  Brain,
  Sparkles,
  ListTodo,
  Volume2,
  Archive,
  CreditCard
} from 'lucide-react';
import { MainView, AuthStatus } from '../types';

interface LandingPageProps {
  onNavigate: (view: MainView, hash?: string) => void;
  onLogin: () => void;
  onStartFree?: () => void;
  targetHash?: string | null;
  onHashHandled?: () => void;
  authStatus?: AuthStatus;
}

const LandingPage: React.FC<LandingPageProps> = ({ onNavigate, onLogin, onStartFree, targetHash, onHashHandled, authStatus }) => {
  const [activeDemoTab, setActiveDemoTab] = useState<'audio' | 'transcript' | 'summary'>('transcript');
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('yearly');
  const isLoggedIn = authStatus === AuthStatus.LOGGED_IN;

  useEffect(() => {
    if (targetHash) {
      const el = document.querySelector(targetHash);
      if (el) {
        setTimeout(() => {
          el.scrollIntoView({ behavior: 'auto' });
          if (onHashHandled) onHashHandled();
        }, 100);
      }
    }
  }, [targetHash, onHashHandled]);

  const fadeIn = {
    initial: { opacity: 0, y: 20 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true },
    transition: { duration: 0.6 }
  };

  const staggerContainer = {
    initial: { opacity: 0 },
    whileInView: { opacity: 1 },
    viewport: { once: true },
    transition: { staggerChildren: 0.1 }
  };

  return (
    <div className="bg-brand-background overflow-x-hidden">
      {/* 1. HERO SECTION */}
      <section className="relative pt-32 pb-24 md:pt-48 md:pb-40 px-6">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          <motion.div 
            initial={{ opacity: 0, x: -30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8 }}
            className="space-y-8"
          >
            <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-brand-accent/10 border border-brand-accent/20 text-brand-primary text-[12px] font-bold uppercase tracking-widest">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-accent opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-brand-accent"></span>
              </span>
              <span>Enterprise Decision Intelligence</span>
            </div>
            
            <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-brand-primary leading-[1.1]">
              Align team dialogue. <span className="text-brand-secondary">Accelerate decisive execution.</span>
            </h1>
            
            <div className="flex flex-col sm:flex-row items-center gap-4 pt-4">
              <button 
                onClick={isLoggedIn ? () => onNavigate(MainView.APP) : onStartFree}
                className="w-full sm:w-auto bg-brand-primary text-white px-10 py-5 rounded-xl font-bold uppercase tracking-widest text-[13px] shadow-2xl hover:shadow-brand-primary/20 hover:-translate-y-1 transition-all flex items-center justify-center space-x-3"
              >
                <span>Start Free</span>
                <ArrowRight size={18} />
              </button>
              {!isLoggedIn && (
                <button 
                  onClick={() => onNavigate(MainView.APP)}
                  className="w-full sm:w-auto bg-white text-brand-primary border border-brand-divider/40 px-10 py-5 rounded-xl font-bold uppercase tracking-widest text-[13px] hover:bg-brand-background transition-all"
                >
                  Upload Your First Call
                </button>
              )}
            </div>
            
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-4 text-[14px] text-brand-secondary/60">
              <div className="flex items-center space-x-2">
                <CheckCircle2 size={16} className="text-emerald-500" />
                <span>Decision Intelligence</span>
              </div>
              <div className="flex items-center space-x-2">
                <CheckCircle2 size={16} className="text-emerald-500" />
                <span>Strategic Execution</span>
              </div>
              <div className="flex items-center space-x-2">
                <CheckCircle2 size={16} className="text-emerald-500" />
                <span>Enterprise Collaboration</span>
              </div>
            </div>
          </motion.div>
          
          <motion.div 
            initial={{ opacity: 0, scale: 0.9, rotateY: -10 }}
            animate={{ opacity: 1, scale: 1, rotateY: 0 }}
            transition={{ duration: 1, delay: 0.2 }}
            className="relative perspective-1000"
          >
            <div className="relative z-10 bg-white rounded-2xl shadow-[0_50px_100px_-20px_rgba(17,34,80,0.15)] border border-brand-divider/20 overflow-hidden">
              <div className="bg-brand-primary/5 border-b border-brand-divider/20 p-4 flex items-center justify-between">
                <div className="flex space-x-1.5">
                  <div className="w-3 h-3 rounded-full bg-red-400"></div>
                  <div className="w-3 h-3 rounded-full bg-amber-400"></div>
                  <div className="w-3 h-3 rounded-full bg-emerald-400"></div>
                </div>
                <div className="text-[11px] font-bold uppercase tracking-widest text-brand-secondary/40">Compliance Review #428</div>
                <div className="w-6"></div>
              </div>
              <div className="p-8 space-y-6">
                <div 
                  className="flex items-start space-x-4 cursor-pointer hover:bg-brand-primary/5 transition-colors p-2 rounded-lg"
                  onClick={() => {
                    const el = document.getElementById('features');
                    if (el) el.scrollIntoView({ behavior: 'auto' });
                  }}
                >
                  <div className="w-10 h-10 rounded-full bg-brand-primary/10 flex items-center justify-center text-brand-primary font-bold text-xs">S1</div>
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] font-bold text-brand-primary">Compliance Officer</span>
                      <span className="text-[10px] text-brand-secondary/40">00:12</span>
                    </div>
                    <div className="h-4 bg-brand-divider/20 rounded w-full"></div>
                    <div className="h-4 bg-brand-divider/20 rounded w-3/4"></div>
                  </div>
                </div>
                <div 
                  className="flex items-start space-x-4 cursor-pointer hover:bg-brand-accent/5 transition-colors p-2 rounded-lg"
                  onClick={() => {
                    const el = document.getElementById('features');
                    if (el) el.scrollIntoView({ behavior: 'auto' });
                  }}
                >
                  <div className="w-10 h-10 rounded-full bg-brand-accent/20 flex items-center justify-center text-brand-primary font-bold text-xs">S2</div>
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] font-bold text-brand-primary">Account Manager</span>
                      <span className="text-[10px] text-brand-secondary/40">00:45</span>
                    </div>
                    <div className="h-4 bg-brand-divider/20 rounded w-full"></div>
                    <div className="h-4 bg-brand-divider/20 rounded w-1/2"></div>
                  </div>
                </div>
                <div 
                  className="pt-4 border-t border-brand-divider/10 cursor-pointer hover:bg-emerald-50/50 transition-colors p-2 rounded-lg"
                  onClick={() => {
                    const el = document.getElementById('product');
                    if (el) el.scrollIntoView({ behavior: 'auto' });
                  }}
                >
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-[11px] font-bold uppercase tracking-widest text-brand-secondary/40">AI Intelligence</span>
                    <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 text-[10px] font-bold">98.4% Accuracy</span>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-3 rounded-lg bg-brand-background border border-brand-divider/20 space-y-2">
                      <div className="h-2 bg-brand-divider/40 rounded w-1/2"></div>
                      <div className="h-2 bg-brand-divider/20 rounded w-full"></div>
                    </div>
                    <div className="p-3 rounded-lg bg-brand-background border border-brand-divider/20 space-y-2">
                      <div className="h-2 bg-brand-divider/40 rounded w-1/2"></div>
                      <div className="h-2 bg-brand-divider/20 rounded w-full"></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Decorative elements */}
            <div className="absolute -top-10 -right-10 w-40 h-40 bg-brand-accent/20 rounded-full blur-3xl -z-10"></div>
            <div className="absolute -bottom-10 -left-10 w-60 h-60 bg-brand-primary/10 rounded-full blur-3xl -z-10"></div>
          </motion.div>
        </div>
      </section>

      {/* 2. WHY ECHONOTE */}
      <section className="py-20 border-y border-brand-divider/20 bg-white/60">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center space-y-4 mb-16">
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-brand-primary">Why EchoNote</h2>
            <p className="text-brand-secondary/70 max-w-2xl mx-auto text-base">
              Moving beyond transcription. Aligning modern enterprise operations around structured decision models, swift execution paths, and secure team collaboration.
            </p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="p-6 rounded-xl bg-white border border-brand-divider/10 shadow-sm space-y-4">
              <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
                <i className="fa-solid fa-brain text-xl"></i>
              </div>
              <h3 className="font-bold text-lg text-brand-primary">Decision Intelligence</h3>
              <p className="text-brand-secondary/60 text-sm leading-relaxed">
                Automatically extract core choices, explicit trade-offs, and risk models directly from natural team dialogue. Turn raw voice into a clear corporate knowledge base.
              </p>
            </div>
            
            <div className="p-6 rounded-xl bg-white border border-brand-divider/10 shadow-sm space-y-4">
              <div className="w-10 h-10 rounded-lg bg-brand-primary/5 text-brand-primary flex items-center justify-center font-bold">
                <i className="fa-solid fa-list-check text-xl"></i>
              </div>
              <h3 className="font-bold text-lg text-brand-primary">Swift Execution</h3>
              <p className="text-brand-secondary/60 text-sm leading-relaxed">
                Instantly map tasks, assign clear ownership, and trigger reminders directly from recorded speech. Bridge the gap between meeting decisions and prompt field action.
              </p>
            </div>
            
            <div className="p-6 rounded-xl bg-white border border-brand-divider/10 shadow-sm space-y-4">
              <div className="w-10 h-10 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center font-bold">
                <i className="fa-solid fa-users-gear text-xl"></i>
              </div>
              <h3 className="font-bold text-lg text-brand-primary">Enterprise Collaboration</h3>
              <p className="text-brand-secondary/60 text-sm leading-relaxed">
                Seamless real-time shared workspace for cross-functional teams. Synchronize plans, share secure analytics, and audit changes with compliance-heavy confidence.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 3. PROBLEM SECTION */}
      <section id="product" className="py-32 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-24 items-center">
            <motion.div {...fadeIn} className="space-y-8">
              <h2 className="text-4xl md:text-5xl font-bold tracking-tight text-brand-primary leading-tight">
                You're not short on data. <br />
                <span className="text-brand-secondary">You're drowning in it.</span>
              </h2>
              <p className="text-lg text-brand-secondary/70 leading-relaxed">
                Teams waste hours re-listening to calls just to find one decision, one risk, or one missed detail. Manual review is slow, inconsistent, and dangerously error-prone.
              </p>
              
              <div className="space-y-6 pt-4">
                <div className="flex items-start space-x-4">
                  <div className="w-12 h-12 rounded-xl bg-red-50 flex items-center justify-center text-red-500 shrink-0">
                    <Clock size={24} />
                  </div>
                  <div>
                    <h4 className="font-bold text-brand-primary">4+ hours to review 1 hour of audio</h4>
                    <p className="text-brand-secondary/60 text-sm">Manual transcription is a massive bottleneck for high-stakes teams.</p>
                  </div>
                </div>
                <div className="flex items-start space-x-4">
                  <div className="w-12 h-12 rounded-xl bg-red-50 flex items-center justify-center text-red-500 shrink-0">
                    <Search size={24} />
                  </div>
                  <div>
                    <h4 className="font-bold text-brand-primary">Critical insights buried in long conversations</h4>
                    <p className="text-brand-secondary/60 text-sm">Finding specific details shouldn't require re-listening to the entire call.</p>
                  </div>
                </div>
                <div className="flex items-start space-x-4">
                  <div className="w-12 h-12 rounded-xl bg-red-50 flex items-center justify-center text-red-500 shrink-0">
                    <ShieldCheck size={24} />
                  </div>
                  <div>
                    <h4 className="font-bold text-brand-primary">Compliance risks missed due to human fatigue</h4>
                    <p className="text-brand-secondary/60 text-sm">Manual review is inconsistent and dangerously error-prone.</p>
                  </div>
                </div>
              </div>
            </motion.div>
            
            <motion.div 
              initial={{ opacity: 0, x: 30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="space-y-12"
            >
              <div className="text-center lg:text-left space-y-4">
                <h3 className="text-3xl font-bold text-brand-primary">From 4 hours → under 60 seconds.</h3>
              </div>
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-6 mt-12">
                  <div className="p-6 rounded-2xl bg-white shadow-xl border border-brand-divider/10 transform -rotate-2">
                    <div className="flex items-center space-x-2 mb-4">
                      <div className="w-2 h-2 rounded-full bg-red-500"></div>
                      <span className="text-[10px] font-bold uppercase tracking-widest text-brand-secondary/40">Manual Process</span>
                    </div>
                    <div className="space-y-2">
                      <div className="h-2 bg-brand-divider/20 rounded w-full"></div>
                      <div className="h-2 bg-brand-divider/20 rounded w-3/4"></div>
                      <div className="h-2 bg-brand-divider/20 rounded w-full"></div>
                    </div>
                    <div className="mt-6 text-center text-red-500 font-bold text-xl">4+ Hours</div>
                  </div>
                  <div className="p-6 rounded-2xl bg-white shadow-xl border border-brand-divider/10 transform rotate-1">
                    <div className="flex items-center space-x-2 mb-4 text-brand-secondary/40">
                      <Users size={14} />
                      <span className="text-[10px] font-bold uppercase tracking-widest">Team Fatigue</span>
                    </div>
                    <div className="h-20 bg-brand-divider/10 rounded-lg flex items-center justify-center">
                      <i className="fa-solid fa-face-tired text-brand-divider text-3xl"></i>
                    </div>
                  </div>
                </div>
                <div className="space-y-6">
                  <div className="p-6 rounded-2xl bg-brand-primary text-white shadow-2xl transform rotate-2">
                    <div className="flex items-center space-x-2 mb-4">
                      <div className="w-2 h-2 rounded-full bg-brand-accent"></div>
                      <span className="text-[10px] font-bold uppercase tracking-widest text-white/40">EchoNote AI</span>
                    </div>
                    <div className="space-y-2">
                      <div className="h-2 bg-white/20 rounded w-full"></div>
                      <div className="h-2 bg-white/20 rounded w-full"></div>
                      <div className="h-2 bg-white/20 rounded w-full"></div>
                    </div>
                    <div className="mt-6 text-center text-brand-accent font-bold text-xl">~45 Seconds</div>
                  </div>
                  <div className="p-6 rounded-2xl bg-white shadow-xl border border-brand-divider/10 transform -rotate-1">
                    <div className="flex items-center space-x-2 mb-4 text-brand-secondary/40">
                      <Zap size={14} />
                      <span className="text-[10px] font-bold uppercase tracking-widest">Instant Search</span>
                    </div>
                    <div className="h-2 bg-brand-primary/10 rounded w-full mb-2"></div>
                    <div className="h-2 bg-brand-primary/10 rounded w-2/3"></div>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* 4. TRANSFORMATION SECTION */}
      <section className="py-32 bg-brand-primary text-white overflow-hidden">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center space-y-6 mb-24">
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight">From raw audio to actionable intelligence</h2>
            <p className="text-white/60 max-w-2xl mx-auto text-lg">We don't just transcribe. We analyze, structure, and deliver actionable insights.</p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-12 relative">
            {/* Connection Lines (Desktop) */}
            <div className="hidden md:block absolute top-1/2 left-1/3 right-1/3 h-px bg-gradient-to-r from-white/0 via-white/20 to-white/0 -translate-y-1/2"></div>
            
            <motion.div {...fadeIn} transition={{ delay: 0.1 }} className="relative z-10 text-center space-y-8">
              <div className="w-24 h-24 rounded-3xl bg-white/5 border border-white/10 flex items-center justify-center mx-auto shadow-2xl">
                <i className="fa-solid fa-file-audio text-4xl text-brand-accent"></i>
              </div>
              <div className="space-y-4">
                <h3 className="text-xl font-bold">1. Upload or Record</h3>
                <p className="text-white/40 text-sm">Upload any recording or record live. Our engine handles background noise and accents with ease.</p>
              </div>
            </motion.div>
            
            <motion.div {...fadeIn} transition={{ delay: 0.3 }} className="relative z-10 text-center space-y-8">
              <div className="w-24 h-24 rounded-3xl bg-brand-accent text-brand-primary flex items-center justify-center mx-auto shadow-[0_0_50px_rgba(234,196,53,0.3)]">
                <Zap size={40} />
              </div>
              <div className="space-y-4">
                <h3 className="text-xl font-bold">2. AI Processing</h3>
                <p className="text-white/40 text-sm">Speaker identification, timestamping, and context-aware transcription happen in parallel.</p>
              </div>
            </motion.div>
            
            <motion.div {...fadeIn} transition={{ delay: 0.5 }} className="relative z-10 text-center space-y-8">
              <div className="w-24 h-24 rounded-3xl bg-white/5 border border-white/10 flex items-center justify-center mx-auto shadow-2xl">
                <i className="fa-solid fa-list-check text-4xl text-emerald-400"></i>
              </div>
              <div className="space-y-4">
                <h3 className="text-xl font-bold">3. Structured Output</h3>
                <p className="text-white/40 text-sm">Get a searchable, speaker-mapped transcript with automated summaries and action items.</p>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* 5. FEATURES SECTION */}
      <section id="features" className="py-32 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-8 mb-20">
            <div className="space-y-6">
              <h2 className="text-4xl md:text-5xl font-bold tracking-tight text-brand-primary">This isn’t transcription. <br /><span className="text-brand-secondary">It’s intelligence.</span></h2>
              <p className="text-brand-secondary/70 max-w-xl">Every feature is designed to reduce friction and increase the speed of intelligence.</p>
            </div>
            <button 
              onClick={onLogin}
              className="text-brand-primary font-bold uppercase tracking-widest text-[13px] flex items-center space-x-2 group"
            >
              <span>Explore all features</span>
              <ChevronRight size={18} className="group-hover:translate-x-1 transition-transform" />
            </button>
          </div>
          
          <motion.div 
            variants={staggerContainer}
            initial="initial"
            whileInView="whileInView"
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8"
          >
            {[
              { icon: <Mic />, title: 'Live Transcription', desc: 'Stream real-time audio or upload files with millisecond latency, custom speaker diarization, and precision speech-to-text.' },
              { icon: <Brain />, title: 'Decision Intelligence', desc: 'Instantly parse conversations to extract critical meeting choices, trade-offs, rationale, and definitive outcomes.' },
              { icon: <Sparkles />, title: 'Strategic Thinking Partner', desc: 'Engage the integrated AI strategic consultant to brainstorm options, evaluate ideas, and stress-test strategic concepts.' },
              { icon: <ListTodo />, title: 'Execution Tracking', desc: 'Convert collaborative dialogue directly into assigned tasks, clear ownership stakes, and dynamic milestone paths.' },
              { icon: <Volume2 />, title: 'Speech Synthesis', desc: 'Generate natural audio readouts of key meeting summaries and core decisions with premium neural text-to-speech.' },
              { icon: <Archive />, title: 'Intelligence Archive', desc: 'Maintain a permanent, structured corporate memory bank with advanced tag filtering, search patterns, and trend analysis.' },
              { icon: <Users />, title: 'Team Collaboration', desc: 'Work collectively in a shared multi-user environment with workspace activity streams and real-time team synchronization.' },
              { icon: <CreditCard />, title: 'Flexible Subscriptions', desc: 'Upgrade fluidly between guest, pro, and enterprise tiers with robust usage trackers and dynamic seat management.' }
            ].map((feature, i) => (
              <motion.div 
                key={i}
                variants={fadeIn}
                className="p-8 rounded-2xl bg-white border border-brand-divider/20 hover:shadow-2xl hover:-translate-y-2 transition-all group"
              >
                <div className="w-14 h-14 rounded-xl bg-brand-primary/5 flex items-center justify-center text-brand-primary mb-6 group-hover:bg-brand-primary group-hover:text-white transition-colors">
                  {feature.icon}
                </div>
                <h3 className="text-lg font-bold text-brand-primary mb-4">{feature.title}</h3>
                <p className="text-brand-secondary/60 text-sm leading-relaxed">{feature.desc}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* 6. INTERACTIVE DEMO SECTION */}
      <section className="py-32 bg-brand-background px-6">
        <div className="max-w-7xl mx-auto">
          <div className="bg-white rounded-3xl shadow-[0_50px_100px_-20px_rgba(17,34,80,0.1)] border border-brand-divider/20 overflow-hidden">
            <div className="grid grid-cols-1 lg:grid-cols-3">
              {/* Demo Controls */}
              <div className="p-12 bg-brand-primary text-white space-y-12">
                <div className="space-y-6">
                  <h3 className="text-3xl font-bold leading-tight">See intelligence in action.</h3>
                  <p className="text-white/60 text-sm">Experience how EchoNote transforms a complex financial review into structured data.</p>
                </div>
                
                <div className="space-y-4">
                  {[
                    { id: 'audio', icon: <Play size={16} />, label: 'Raw Audio Input' },
                    { id: 'transcript', icon: <FileText size={16} />, label: 'AI Transcription' },
                    { id: 'summary', icon: <BarChart3 size={16} />, label: 'Actionable Summary' }
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveDemoTab(tab.id as any)}
                      className={`w-full flex items-center space-x-4 p-4 rounded-xl transition-all ${
                        activeDemoTab === tab.id ? 'bg-white text-brand-primary shadow-lg' : 'hover:bg-white/5 text-white/60'
                      }`}
                    >
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${activeDemoTab === tab.id ? 'bg-brand-primary text-white' : 'bg-white/10'}`}>
                        {tab.icon}
                      </div>
                      <span className="font-bold text-[13px] uppercase tracking-widest">{tab.label}</span>
                    </button>
                  ))}
                </div>
                
                <div className="pt-8 border-t border-white/10">
                  <div className="flex items-center space-x-4">
                    <div className="flex -space-x-2">
                      {[1, 2, 3].map(i => (
                        <div key={i} className="w-8 h-8 rounded-full border-2 border-brand-primary bg-brand-divider"></div>
                      ))}
                    </div>
                    <span className="text-[12px] text-white/40">Used by 400+ compliance officers</span>
                  </div>
                </div>
              </div>
              
              {/* Demo Content */}
              <div className="lg:col-span-2 p-12 bg-white flex flex-col">
                <AnimatePresence mode="wait">
                  {activeDemoTab === 'audio' && (
                    <motion.div 
                      key="audio"
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      className="flex-1 flex flex-col items-center justify-center space-y-12"
                    >
                      <div className="w-full h-32 flex items-center justify-center space-x-1">
                        {[...Array(24)].map((_, i) => (
                          <motion.div 
                            key={i}
                            animate={{ height: [20, Math.random() * 80 + 20, 20] }}
                            transition={{ repeat: Infinity, duration: 1, delay: i * 0.05 }}
                            className="w-1 bg-brand-primary/20 rounded-full"
                          ></motion.div>
                        ))}
                      </div>
                      <div className="flex items-center space-x-8">
                        <button className="w-16 h-16 rounded-full bg-brand-primary text-white flex items-center justify-center shadow-xl hover:scale-105 transition-transform">
                          <Play fill="currentColor" size={24} />
                        </button>
                        <div className="space-y-1">
                          <div className="text-brand-primary font-bold">Q4_Financial_Review.mp3</div>
                          <div className="text-brand-secondary/40 text-[12px] font-mono">00:42 / 12:45</div>
                        </div>
                      </div>
                    </motion.div>
                  )}
                  
                  {activeDemoTab === 'transcript' && (
                    <motion.div 
                      key="transcript"
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      className="flex-1 space-y-8"
                    >
                      <div className="space-y-6">
                        <div className="flex items-start space-x-4">
                          <div className="w-10 h-10 rounded-full bg-brand-primary/10 flex items-center justify-center text-brand-primary font-bold text-xs">S1</div>
                          <div className="flex-1 space-y-2">
                            <div className="flex items-center space-x-2">
                              <span className="text-[12px] font-bold text-brand-primary">Sarah Jenkins</span>
                              <span className="text-[10px] text-brand-secondary/40">00:12</span>
                            </div>
                            <p className="text-brand-secondary/70 text-sm italic">"Can we confirm the risk assessment for the new portfolio?"</p>
                          </div>
                        </div>
                        <div className="flex items-start space-x-4">
                          <div className="w-10 h-10 rounded-full bg-brand-accent/20 flex items-center justify-center text-brand-primary font-bold text-xs">S2</div>
                          <div className="flex-1 space-y-2">
                            <div className="flex items-center space-x-2">
                              <span className="text-[12px] font-bold text-brand-primary">Mark Thompson</span>
                              <span className="text-[10px] text-brand-secondary/40">00:15</span>
                            </div>
                            <p className="text-brand-secondary/70 text-sm">"The assessment is complete. We've identified three key areas of concern regarding the international exposure..."</p>
                          </div>
                        </div>
                        <div className="flex items-start space-x-4 opacity-40">
                          <div className="w-10 h-10 rounded-full bg-brand-primary/10 flex items-center justify-center text-brand-primary font-bold text-xs">S1</div>
                          <div className="flex-1 space-y-2">
                            <div className="h-3 bg-brand-divider/20 rounded w-full"></div>
                            <div className="h-3 bg-brand-divider/20 rounded w-2/3"></div>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}
                  
                  {activeDemoTab === 'summary' && (
                    <motion.div 
                      key="summary"
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      className="flex-1 space-y-8"
                    >
                      <div className="p-6 rounded-2xl bg-brand-background border border-brand-divider/20 space-y-6">
                        <div className="space-y-2">
                          <h4 className="text-[11px] font-bold uppercase tracking-widest text-brand-secondary/40">Key Decisions</h4>
                          <ul className="space-y-2">
                            <li className="flex items-center space-x-3 text-sm text-brand-primary">
                              <Check size={14} className="text-emerald-500" />
                              <span>Approved international portfolio expansion</span>
                            </li>
                            <li className="flex items-center space-x-3 text-sm text-brand-primary">
                              <Check size={14} className="text-emerald-500" />
                              <span>Revised risk threshold to 4.5%</span>
                            </li>
                          </ul>
                        </div>
                        <div className="space-y-2">
                          <h4 className="text-[11px] font-bold uppercase tracking-widest text-brand-secondary/40">Action Items</h4>
                          <ul className="space-y-2">
                            <li className="flex items-center space-x-3 text-sm text-brand-primary">
                              <div className="w-4 h-4 rounded border border-brand-divider/40"></div>
                              <span>Sarah to finalize audit trail by Friday</span>
                            </li>
                            <li className="flex items-center space-x-3 text-sm text-brand-primary">
                              <div className="w-4 h-4 rounded border border-brand-divider/40"></div>
                              <span>Mark to schedule follow-up with Legal</span>
                            </li>
                          </ul>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 7. RESULTS / IMPACT */}
      <section className="py-32 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-24 items-center">
            <motion.div {...fadeIn} className="space-y-8 order-2 lg:order-1">
              <div className="grid grid-cols-2 gap-8">
                <div className="space-y-2">
                  <div className="text-5xl font-bold text-brand-primary">40-60%</div>
                  <p className="text-brand-secondary/60 text-sm font-medium">Reduction in manual documentation time</p>
                </div>
                <div className="space-y-2">
                  <div className="text-5xl font-bold text-brand-primary">98.4%</div>
                  <p className="text-brand-secondary/60 text-sm font-medium">Average transcription accuracy rate</p>
                </div>
                <div className="space-y-2">
                  <div className="text-5xl font-bold text-brand-primary">10x</div>
                  <p className="text-brand-secondary/60 text-sm font-medium">Faster search and retrieval of call data</p>
                </div>
                <div className="space-y-2">
                  <div className="text-5xl font-bold text-brand-primary">Zero</div>
                  <p className="text-brand-secondary/60 text-sm font-medium">Compliance breaches in pilot testing</p>
                </div>
              </div>
            </motion.div>
            
            <motion.div {...fadeIn} transition={{ delay: 0.2 }} className="space-y-8 order-1 lg:order-2">
              <h2 className="text-4xl md:text-5xl font-bold tracking-tight text-brand-primary">Measurable impact. <br /><span className="text-brand-secondary">Not just promises.</span></h2>
              <p className="text-lg text-brand-secondary/70 leading-relaxed">
                EchoNote isn't just a convenience tool. It's a strategic asset that frees your highest-value employees from clerical work, allowing them to focus on analysis and decision-making.
              </p>
              <div className="pt-4">
                <button 
                  onClick={isLoggedIn ? () => onNavigate(MainView.APP) : onStartFree}
                  className="bg-brand-primary text-white px-10 py-5 rounded-xl font-bold uppercase tracking-widest text-[13px] shadow-2xl hover:shadow-brand-primary/20 hover:-translate-y-1 transition-all"
                >
                  Start Free
                </button>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* 8. SECURITY & TRUST */}
      <section id="solutions" className="py-32 bg-white px-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center space-y-6 mb-24">
            <div className="inline-flex items-center space-x-2 text-emerald-600">
              <Lock size={18} />
              <span className="text-[12px] font-bold uppercase tracking-widest">Enterprise-Grade Security</span>
            </div>
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight text-brand-primary">Your data isn’t processed. It’s protected.</h2>
            <p className="text-brand-secondary/60 max-w-2xl mx-auto text-lg">We maintain the highest standards of data protection to ensure your sensitive conversations remain private and secure.</p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
            {[
              { icon: <ShieldCheck className="text-emerald-500" />, title: 'Secured Data Encryption', desc: 'AES-256 at-rest and TLS 1.3 in-transit encryption secures all raw transcripts and audio datasets.' },
              { icon: <Users className="text-brand-accent" />, title: 'Role-based access control', desc: 'Define exactly who can view, edit, or invite members to recordings using project-level permissions.' },
              { icon: <BarChart3 className="text-brand-secondary" />, title: 'Database Access Controls', desc: 'Server-side Firestore security rules validate and isolate all project files and real-time logs.' }
            ].map((item, i) => (
              <div key={i} className="space-y-6 p-8 rounded-2xl bg-brand-background border border-brand-divider/10">
                <div className="w-12 h-12 rounded-xl bg-white flex items-center justify-center shadow-md">
                  {item.icon}
                </div>
                <h3 className="text-xl font-bold text-brand-primary">{item.title}</h3>
                <p className="text-brand-secondary/60 text-sm leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
          
          <div className="mt-20 p-12 rounded-3xl bg-brand-primary text-white flex flex-col md:flex-row items-center justify-between gap-8">
            <div className="space-y-2">
              <h4 className="text-2xl font-bold">Ready for Enterprise?</h4>
              <p className="text-white/60">Learn more about our secure database architecture and team access controls.</p>
            </div>
            <button 
              onClick={() => onNavigate(MainView.SECURITY)}
              className="bg-white text-brand-primary px-8 py-4 rounded-xl font-bold uppercase tracking-widest text-[12px] whitespace-nowrap hover:bg-brand-background transition-all"
            >
              Security Whitepaper
            </button>
          </div>
        </div>
      </section>

      {/* 8. DIFFERENTIATOR SECTION */}
      <section className="py-32 bg-brand-background px-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center space-y-6 mb-24">
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight text-brand-primary">This isn’t transcription. <span className="text-brand-secondary">It’s intelligence.</span></h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
            {[
              { title: "Structured decisions, not raw text", icon: <CheckCircle2 className="text-brand-accent" /> },
              { title: "Instant retrieval, not manual search", icon: <Search className="text-brand-accent" /> },
              { title: "Context-aware analysis, not basic AI", icon: <Zap className="text-brand-accent" /> }
            ].map((item, i) => (
              <motion.div 
                key={i}
                {...fadeIn}
                transition={{ delay: i * 0.1 }}
                className="p-8 rounded-3xl bg-white border border-brand-divider/10 shadow-sm flex flex-col items-center text-center space-y-6"
              >
                <div className="w-16 h-16 rounded-2xl bg-brand-primary/5 flex items-center justify-center">
                  {React.cloneElement(item.icon as React.ReactElement, { size: 32 })}
                </div>
                <h3 className="text-xl font-bold text-brand-primary">{item.title}</h3>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* 9. USE CASES */}
      <section id="about" className="py-32 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center space-y-6 mb-24">
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight text-brand-primary">Built for teams where accuracy matters</h2>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            {[
              { title: 'Financial Services', icon: 'fa-shield-check', desc: 'Automate call monitoring and ensure every conversation meets regulatory standards.' },
              { title: 'Legal & Litigation', icon: 'fa-gavel', desc: 'Transform depositions and client consultations into structured, billable intelligence.' },
              { title: 'Enterprise Sales', icon: 'fa-chart-line-up', desc: 'Document analyst calls and sales meetings with perfect accuracy and searchable history.' },
              { title: 'Human Resources', icon: 'fa-users', desc: 'Streamline interview notes and internal reviews with automated summaries and action items.' }
            ].map((useCase, i) => (
              <div key={i} className="group cursor-pointer">
                <div className="relative h-64 rounded-3xl overflow-hidden mb-6">
                  <img 
                    src={`https://picsum.photos/seed/${useCase.title.toLowerCase()}/800/600`} 
                    alt={useCase.title}
                    className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"
                    referrerPolicy="no-referrer"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-brand-primary to-transparent opacity-60"></div>
                  <div className="absolute bottom-6 left-6 text-white">
                    <div className="w-10 h-10 rounded-lg bg-white/20 backdrop-blur-md flex items-center justify-center mb-2">
                      <i className={`fa-solid ${useCase.icon}`}></i>
                    </div>
                    <h3 className="text-xl font-bold">{useCase.title}</h3>
                  </div>
                </div>
                <p className="text-brand-secondary/60 text-sm leading-relaxed px-2">{useCase.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 9.5 PRICING SECTION */}
      <section id="pricing" className="py-32 bg-brand-background px-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center space-y-6 mb-12">
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight text-brand-primary">Simple, transparent pricing.</h2>
            <p className="text-brand-secondary/60 max-w-2xl mx-auto text-lg">Choose the plan that fits your team's scale and intelligence needs.</p>
          </div>

          <div className="flex items-center justify-center space-x-4 mb-24">
            <span className={`text-sm font-bold ${billingCycle === 'monthly' ? 'text-brand-primary' : 'text-slate-400'}`}>Monthly</span>
            <button 
              onClick={() => setBillingCycle(prev => prev === 'monthly' ? 'yearly' : 'monthly')}
              className="w-14 h-7 bg-slate-200 rounded-full relative p-1 transition-colors hover:bg-slate-300"
            >
              <div className={`w-5 h-5 bg-brand-primary rounded-full transition-transform ${billingCycle === 'yearly' ? 'translate-x-7' : 'translate-x-0'}`} />
            </button>
            <div className="flex items-center space-x-2">
              <span className={`text-sm font-bold ${billingCycle === 'yearly' ? 'text-brand-primary' : 'text-slate-400'}`}>Yearly</span>
              <span className="bg-emerald-100 text-emerald-700 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">Save 25%</span>
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            {[
              { 
                name: 'Free', 
                price: { monthly: '0', yearly: '0' }, 
                desc: 'Perfect for individuals exploring EchoNote.', 
                features: ['60 minutes/month', 'Basic transcription', 'Standard AI engine'] 
              },
              { 
                name: 'Pro', 
                price: { monthly: '799', yearly: '6999' }, 
                desc: 'For professionals who need high-volume intelligence.', 
                features: ['600 minutes/month', 'Speaker identification', 'Export features', 'Priority processing'], 
                popular: true 
              },
              { 
                name: 'Team', 
                price: { monthly: '1999', yearly: '21999' }, 
                desc: 'Collaborate with your entire team securely.', 
                features: ['1000 shared minutes', '3 users included', '₹399 per extra user', 'Shared workspace', 'Role-based access'] 
              },
              { 
                name: 'Enterprise', 
                price: { monthly: 'Custom', yearly: 'Custom' }, 
                desc: 'Bespoke solutions for high-compliance organizations.', 
                features: ['Custom pricing', 'Advanced features', 'Dedicated support', 'Full audit logs'] 
              }
            ].map((plan, i) => (
              <div key={i} className={`relative p-8 rounded-3xl border transition-all flex flex-col ${plan.popular ? 'bg-brand-primary text-white border-brand-primary shadow-2xl scale-105 z-10' : 'bg-white text-brand-primary border-brand-divider/20 shadow-sm hover:shadow-xl'}`}>
                {plan.popular && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-brand-accent text-brand-primary text-[10px] font-bold uppercase tracking-widest px-4 py-1 rounded-full shadow-lg">
                    Most Popular
                  </div>
                )}
                <div className="space-y-6 flex-1 flex flex-col">
                  <div>
                    <h3 className="text-xl font-bold">{plan.name}</h3>
                    <p className={`text-xs mt-2 ${plan.popular ? 'text-white/60' : 'text-brand-secondary/60'}`}>{plan.desc}</p>
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-baseline space-x-1">
                      <span className="text-2xl font-bold">{plan.price[billingCycle] === 'Custom' ? '' : '₹'}</span>
                      <span className="text-4xl font-bold tracking-tight">{plan.price[billingCycle]}</span>
                      {plan.price[billingCycle] !== 'Custom' && plan.price[billingCycle] !== '0' && (
                        <span className={`text-sm ${plan.popular ? 'text-white/60' : 'text-brand-secondary/60'}`}>
                          /{billingCycle === 'monthly' ? 'mo' : 'year'}
                        </span>
                      )}
                    </div>
                    {billingCycle === 'yearly' && plan.name === 'Pro' && (
                      <p className="text-[10px] font-bold text-emerald-400">Save ₹2,589 compared to monthly</p>
                    )}
                    {billingCycle === 'yearly' && plan.name === 'Team' && (
                      <p className="text-[10px] font-bold text-emerald-500">Save ₹1,989 compared to monthly</p>
                    )}
                  </div>
                  <ul className="space-y-4 pt-6 border-t border-brand-divider/10 flex-1">
                    {plan.features.map((feature, j) => (
                      <li key={j} className="flex items-start space-x-3 text-[12px] font-medium">
                        <Check size={14} className={`mt-0.5 ${plan.popular ? 'text-brand-accent' : 'text-emerald-500'}`} />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                  <button 
                    onClick={onLogin}
                    className={`w-full py-4 rounded-xl font-bold uppercase tracking-widest text-[11px] transition-all ${plan.popular ? 'bg-brand-accent text-brand-primary hover:brightness-110' : 'bg-brand-primary text-white hover:opacity-90'}`}
                  >
                    Start Free
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Add-ons Section */}
          <div className="mt-24 max-w-4xl mx-auto">
            <div className="bg-white rounded-[32px] border border-brand-divider/20 p-12 shadow-sm space-y-10">
              <div className="space-y-2">
                <h3 className="text-2xl font-bold text-brand-primary">Need more minutes?</h3>
                <p className="text-brand-secondary/60 text-sm">One-time top-ups for when you have a busy month. No subscription required.</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="flex items-center justify-between p-8 bg-brand-background rounded-2xl border border-brand-divider/10 hover:border-brand-primary/20 transition-colors">
                  <div className="text-left">
                    <div className="text-xl font-bold text-brand-primary">+100 minutes</div>
                    <div className="text-xs text-brand-secondary/60">One-time top-up</div>
                  </div>
                  <div className="text-2xl font-bold text-brand-secondary">₹99</div>
                </div>
                <div className="flex items-center justify-between p-8 bg-brand-background rounded-2xl border border-brand-divider/10 hover:border-brand-primary/20 transition-colors">
                  <div className="text-left">
                    <div className="text-xl font-bold text-brand-primary">+500 minutes</div>
                    <div className="text-xs text-brand-secondary/60">One-time top-up</div>
                  </div>
                  <div className="text-2xl font-bold text-brand-secondary">₹299</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 10. FINAL CTA */}
      <section className="py-32 px-6">
        <div className="max-w-5xl mx-auto rounded-[40px] bg-brand-primary text-white p-12 md:p-24 text-center relative overflow-hidden">
          {/* Decorative background */}
          <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none">
            <div className="absolute -top-24 -left-24 w-96 h-96 bg-brand-accent rounded-full blur-[120px]"></div>
            <div className="absolute -bottom-24 -right-24 w-96 h-96 bg-brand-secondary rounded-full blur-[120px]"></div>
          </div>
          
          <motion.div {...fadeIn} className="relative z-10 space-y-10">
            <h2 className="text-4xl md:text-6xl font-bold tracking-tight leading-tight">
              Stop listening. <br />
              Start understanding.
            </h2>
            <p className="text-white/60 text-lg max-w-xl mx-auto">
              Join the leading enterprise teams transforming their audio data into structured intelligence today.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-6 pt-4">
              <button 
                onClick={onLogin}
                className="w-full sm:w-auto bg-brand-accent text-brand-primary px-12 py-6 rounded-2xl font-bold uppercase tracking-widest text-[14px] shadow-2xl hover:shadow-brand-accent/20 hover:-translate-y-1 transition-all"
              >
                Start Free
              </button>
              <button 
                onClick={() => onNavigate(MainView.DEMO)}
                className="w-full sm:w-auto bg-white/10 text-white border border-white/20 px-12 py-6 rounded-2xl font-bold uppercase tracking-widest text-[14px] hover:bg-white/20 transition-all"
              >
                Upload Your First Call
              </button>
            </div>
            <p className="text-white/40 text-[13px] font-medium">No credit card required. Cancel anytime.</p>
          </motion.div>
        </div>
      </section>
    </div>
  );
};

export default LandingPage;
