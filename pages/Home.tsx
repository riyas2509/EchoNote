
import React from 'react';
import { NavLink, Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { ArrowRight, CheckCircle2, Clock, Search, Zap, Users, Mic, Cpu, ClipboardList } from 'lucide-react';
import { AuthStatus } from '../types';
import CTASection from '../components/CTASection';

interface HomeProps {
  onLogin: () => void;
  onStartFree: () => void;
  onNavigateToDemo: () => void;
  authStatus?: AuthStatus;
  onGoToDashboard: () => void;
}

const Home: React.FC<HomeProps> = ({ onLogin, onStartFree, onNavigateToDemo, authStatus, onGoToDashboard }) => {
  const isLoggedIn = authStatus === AuthStatus.LOGGED_IN;

  const fadeIn = {
    initial: { opacity: 0, y: 20 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true },
    transition: { duration: 0.6 }
  };

  return (
    <div className="bg-brand-background overflow-x-hidden">
      {/* 1. HERO SECTION */}
      <section className="relative pt-32 pb-24 md:pt-40 md:pb-36 px-6 overflow-hidden">
        {/* Decorative Grid & Glow Backgrounds */}
        <div className="absolute inset-0 opacity-[0.03] bg-[linear-gradient(to_right,#5DA9FF_1px,transparent_1px),linear-gradient(to_bottom,#5DA9FF_1px,transparent_1px)] bg-[size:32px_32px]" />
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-gradient-to-tr from-brand-primary/10 via-brand-accent/5 to-transparent rounded-full blur-3xl pointer-events-none -z-10" />
        
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-center">
          {/* Left Content */}
          <motion.div 
            initial={{ opacity: 0, x: -30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8 }}
            className="lg:col-span-7 space-y-8 flex flex-col items-start"
          >
            <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-purple-50 border border-purple-100 text-purple-700 text-[11px] font-extrabold uppercase tracking-widest shadow-sm">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-purple-500"></span>
              </span>
              <span>Enterprise Audio Intelligence</span>
            </div>
            
            <h1 className="text-4xl sm:text-5xl lg:text-6xl xl:text-7xl font-extrabold tracking-tight text-slate-900 leading-[1.1] max-w-2xl">
              Stop listening to calls. <span className="text-slate-500 block sm:inline">Start extracting decisions.</span>
            </h1>
            
            <p className="text-base md:text-lg text-slate-600 max-w-lg leading-relaxed font-medium">
              EchoNote turns hours of raw conversations into structured intelligence — with speaker attribution, instant summaries, and compliance-ready insights in seconds.
            </p>
            
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 pt-2 w-full sm:w-auto">
              {isLoggedIn ? (
                <button 
                  onClick={onGoToDashboard}
                  className="bg-brand-primary text-slate-900 px-8 py-3.5 rounded-xl font-bold uppercase tracking-wider text-[11px] shadow-md hover:bg-blue-400 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center space-x-2"
                >
                  <span>DASHBOARD</span>
                  <ArrowRight size={15} />
                </button>
              ) : (
                <button 
                  onClick={onStartFree}
                  className="bg-brand-primary text-slate-900 px-8 py-3.5 rounded-xl font-bold uppercase tracking-wider text-[11px] shadow-md hover:bg-blue-400 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center space-x-2"
                >
                  <span>START FREE</span>
                  <ArrowRight size={15} />
                </button>
              )}
              {!isLoggedIn && (
                <button 
                  onClick={onStartFree}
                  className="bg-white text-slate-800 border border-slate-200 px-8 py-3.5 rounded-xl font-bold uppercase tracking-wider text-[11px] hover:bg-slate-50 transition-all text-center shadow-sm"
                >
                  Upload Your First Call
                </button>
              )}
            </div>
            
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 pt-4 text-[13px] text-slate-500 font-semibold">
              <div className="flex items-center space-x-2">
                <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />
                <span>No credit card required</span>
              </div>
              <div className="flex items-center space-x-2">
                <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />
                <span>Built for compliance-heavy teams</span>
              </div>
            </div>
          </motion.div>
          
          {/* Right Content */}
          <motion.div 
            initial={{ opacity: 0, scale: 0.9, rotateY: -10 }}
            animate={{ opacity: 1, scale: 1, rotateY: 0 }}
            transition={{ duration: 1, delay: 0.2 }}
            className="lg:col-span-5 relative perspective-1000 w-full max-w-lg lg:max-w-none mx-auto"
          >
            <div className="relative z-10 bg-white rounded-2xl shadow-[0_50px_100px_-20px_rgba(17,34,80,0.15)] border border-brand-divider/20 overflow-hidden">
              <div className="bg-brand-primary/5 border-b border-brand-divider/20 p-4 flex items-center justify-between">
                <div className="flex space-x-1.5">
                  <div className="w-3 h-3 rounded-full bg-red-400"></div>
                  <div className="w-3 h-3 rounded-full bg-amber-400"></div>
                  <div className="w-3 h-3 rounded-full bg-emerald-400"></div>
                </div>
                <div className="text-[11px] font-extrabold uppercase tracking-widest text-slate-400">Compliance Review #428</div>
                <div className="w-6"></div>
              </div>
              <div className="p-8 space-y-6">
                <div className="flex items-start space-x-4 p-2 rounded-lg">
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
                <div className="flex items-start space-x-4 p-2 rounded-lg">
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
                <div className="pt-4 border-t border-brand-divider/10 p-2 rounded-lg">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-[11px] font-extrabold uppercase tracking-widest text-slate-400">AI Intelligence</span>
                    <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-600 border border-emerald-100/40 text-[10px] font-bold">98.4% Accuracy</span>
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
            <div className="absolute -top-10 -right-10 w-40 h-40 bg-brand-accent/20 rounded-full blur-3xl -z-10"></div>
            <div className="absolute -bottom-10 -left-10 w-60 h-60 bg-brand-primary/10 rounded-full blur-3xl -z-10"></div>
          </motion.div>
        </div>
      </section>


      {/* 3. PROBLEM SECTION */}
      <section className="py-32 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-24 items-center">
            <motion.div {...fadeIn} className="space-y-8">
              <h2 className="text-4xl md:text-5xl font-bold tracking-tight text-brand-primary leading-tight">
                You're not short on data. <br />
                <span className="text-brand-secondary">You're drowning in it.</span>
              </h2>
              <p className="text-lg text-brand-secondary/70 leading-relaxed">
                Teams waste hours re-listening to calls just to find one decision, one risk, or one missed detail. EchoNote eliminates the manual review bottleneck, turning raw audio into searchable intelligence instantly.
              </p>
              
              <div className="space-y-6 pt-4">
                <div className="flex items-start space-x-4">
                  <div className="w-12 h-12 rounded-xl bg-red-50 flex items-center justify-center text-red-500 shrink-0">
                    <Clock size={24} />
                  </div>
                  <div>
                    <h4 className="font-bold text-brand-primary">4+ hours to review 1 hour of audio</h4>
                    <p className="text-brand-secondary/60 text-sm">Manual transcription is a massive drain on high-value resources.</p>
                  </div>
                </div>
                <div className="flex items-start space-x-4">
                  <div className="w-12 h-12 rounded-xl bg-red-50 flex items-center justify-center text-red-500 shrink-0">
                    <Search size={24} />
                  </div>
                  <div>
                    <h4 className="font-bold text-brand-primary">Critical insights buried in long conversations</h4>
                    <p className="text-brand-secondary/60 text-sm">Finding specific compliance violations shouldn't require re-listening to the entire call.</p>
                  </div>
                </div>
                <div className="flex items-start space-x-4">
                  <div className="w-12 h-12 rounded-xl bg-red-50 flex items-center justify-center text-red-500 shrink-0">
                    <CheckCircle2 size={24} />
                  </div>
                  <div>
                    <h4 className="font-bold text-brand-primary">Compliance risks missed due to human fatigue</h4>
                    <p className="text-brand-secondary/60 text-sm">Automated detection ensures nothing slips through the cracks.</p>
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
      <section className="py-32 bg-slate-900 text-white overflow-hidden relative">
        <div className="absolute inset-0 opacity-[0.02] bg-[linear-gradient(to_right,#FFFFFF_1px,transparent_1px),linear-gradient(to_bottom,#FFFFFF_1px,transparent_1px)] bg-[size:32px_32px]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-brand-primary/10 rounded-full blur-[150px] pointer-events-none -z-10" />
        
        <div className="max-w-7xl mx-auto px-6 relative z-10">
          <div className="text-center space-y-6 mb-24">
            <h2 className="text-4xl md:text-5xl font-extrabold tracking-tight text-white leading-tight">
              From raw audio to <span className="text-blue-400">actionable intelligence</span>.
            </h2>
            <p className="text-slate-400 max-w-2xl mx-auto text-base md:text-lg font-medium">
              We don't just transcribe. We analyze, structure, and deliver compliance-ready decisions.
            </p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-12 lg:gap-16 relative">
            <div className="hidden md:block absolute top-10 left-1/4 right-1/4 h-[1px] bg-gradient-to-r from-transparent via-slate-800 to-transparent -translate-y-1/2"></div>
            
            <motion.div {...fadeIn} transition={{ delay: 0.1 }} className="relative z-10 text-center space-y-6">
              <div className="w-20 h-20 rounded-2xl bg-slate-800/80 border border-slate-700/60 flex items-center justify-center mx-auto shadow-xl hover:scale-105 transition-transform duration-300">
                <Mic size={32} className="text-blue-400" />
              </div>
              <div className="space-y-3">
                <h3 className="text-xl font-bold text-white">1. Upload or Record</h3>
                <p className="text-slate-400 text-sm leading-relaxed max-w-xs mx-auto">Upload any recording or record live. Our engine handles background noise and accents with ease.</p>
              </div>
            </motion.div>
            
            <motion.div {...fadeIn} transition={{ delay: 0.3 }} className="relative z-10 text-center space-y-6">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center mx-auto shadow-xl hover:scale-105 transition-transform duration-300">
                <Cpu size={32} className="text-white" />
              </div>
              <div className="space-y-3">
                <h3 className="text-xl font-bold text-white">2. AI Processing</h3>
                <p className="text-slate-400 text-sm leading-relaxed max-w-xs mx-auto">Speaker identification, timestamping, and context-aware transcription happen in parallel.</p>
              </div>
            </motion.div>
            
            <motion.div {...fadeIn} transition={{ delay: 0.5 }} className="relative z-10 text-center space-y-6">
              <div className="w-20 h-20 rounded-2xl bg-slate-800/80 border border-slate-700/60 flex items-center justify-center mx-auto shadow-xl hover:scale-105 transition-transform duration-300">
                <ClipboardList size={32} className="text-emerald-400" />
              </div>
              <div className="space-y-3">
                <h3 className="text-xl font-bold text-white">3. Structured Output</h3>
                <p className="text-slate-400 text-sm leading-relaxed max-w-xs mx-auto">Get a searchable, speaker-mapped transcript with automated summaries and action items.</p>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* 7. RESULTS / IMPACT */}
      <section className="py-32 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-24 items-center">
            <motion.div {...fadeIn} className="space-y-8 order-2 lg:order-1">
              <div className="grid grid-cols-2 gap-8 md:gap-12">
                <div className="space-y-2 border-l-2 border-brand-primary/10 pl-6">
                  <div className="text-5xl font-black text-brand-accent tracking-tight">40-60%</div>
                  <p className="text-slate-500 text-sm font-semibold uppercase tracking-wider">Manual Review Cut</p>
                </div>
                <div className="space-y-2 border-l-2 border-brand-primary/10 pl-6">
                  <div className="text-5xl font-black text-brand-accent tracking-tight">98.4%</div>
                  <p className="text-slate-500 text-sm font-semibold uppercase tracking-wider">Word Accuracy</p>
                </div>
                <div className="space-y-2 border-l-2 border-brand-primary/10 pl-6">
                  <div className="text-5xl font-black text-brand-accent tracking-tight">10x</div>
                  <p className="text-slate-500 text-sm font-semibold uppercase tracking-wider">Retrieval Speed</p>
                </div>
                <div className="space-y-2 border-l-2 border-brand-primary/10 pl-6">
                  <div className="text-5xl font-black text-brand-accent tracking-tight">0</div>
                  <p className="text-slate-500 text-sm font-semibold uppercase tracking-wider">Missed Compliance Risks</p>
                </div>
              </div>
            </motion.div>
            
            <motion.div {...fadeIn} transition={{ delay: 0.2 }} className="space-y-8 order-1 lg:order-2">
              <h2 className="text-4xl md:text-5xl font-bold tracking-tight text-brand-primary">Measurable impact. <br /><span className="text-brand-secondary">Not just promises.</span></h2>
              <p className="text-lg text-brand-secondary/70 leading-relaxed">
                EchoNote isn't just a convenience tool. It's a strategic asset that frees your highest-value employees from clerical work, allowing them to focus on analysis and decision-making.
              </p>
              <div className="pt-4">
                {isLoggedIn ? (
                  <button 
                    onClick={onGoToDashboard}
                    className="bg-brand-primary text-slate-900 px-8 py-3.5 rounded-xl font-bold uppercase tracking-wider text-[11px] shadow-md hover:bg-blue-400 hover:scale-[1.02] active:scale-[0.98] transition-all inline-flex items-center space-x-2"
                  >
                    <span>DASHBOARD</span>
                    <ArrowRight size={14} />
                  </button>
                ) : (
                  <button 
                    onClick={onStartFree}
                    className="bg-brand-primary text-slate-900 px-8 py-3.5 rounded-xl font-bold uppercase tracking-wider text-[11px] shadow-md hover:bg-blue-400 hover:scale-[1.02] active:scale-[0.98] transition-all inline-flex items-center space-x-2"
                  >
                    <span>START FREE</span>
                    <ArrowRight size={14} />
                  </button>
                )}
              </div>
            </motion.div>
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

      {/* 10. FINAL CTA */}
      <CTASection onLogin={onLogin} onStartFree={onStartFree} onNavigateToDemo={onNavigateToDemo} authStatus={authStatus} onGoToDashboard={onGoToDashboard} />
    </div>
  );
};

export default Home;
