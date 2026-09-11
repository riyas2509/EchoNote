import React from 'react';
import { motion } from 'motion/react';
import { ArrowRight, Calendar, CheckCircle2 } from 'lucide-react';
import { AuthStatus } from '../types';

interface CTASectionProps {
  onLogin?: () => void;
  onStartFree?: () => void;
  onNavigateToDemo?: () => void;
  authStatus?: AuthStatus;
  onGoToDashboard?: () => void;
  title?: string;
  subtitle?: string;
  className?: string;
}

export const CTASection: React.FC<CTASectionProps> = ({ 
  onStartFree, 
  onNavigateToDemo, 
  authStatus, 
  onGoToDashboard,
  title = "Give your organization a memory.",
  subtitle = "Turn important conversations into searchable decisions, context, ownership, and follow-through.",
  className = ""
}) => {
  const isLoggedIn = authStatus === AuthStatus.LOGGED_IN;

  const fadeIn = {
    initial: { opacity: 0, y: 16 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true },
    transition: { duration: 0.5 }
  };

  return (
    <section className={`py-20 md:py-28 px-6 bg-brand-background ${className}`}>
      <div className="max-w-5xl mx-auto rounded-3xl bg-slate-900 text-white p-10 sm:p-16 md:p-20 text-center relative overflow-hidden border border-slate-800 shadow-2xl">
        {/* Subtle glow backdrop */}
        <div className="absolute inset-0 opacity-15 pointer-events-none">
          <div className="absolute -top-24 -left-24 w-96 h-96 bg-blue-500 rounded-full blur-[100px]"></div>
          <div className="absolute -bottom-24 -right-24 w-96 h-96 bg-indigo-500 rounded-full blur-[100px]"></div>
        </div>
        
        <motion.div {...fadeIn} className="relative z-10 space-y-6 max-w-2xl mx-auto">
          <div className="inline-flex items-center space-x-2 px-3.5 py-1 rounded-full bg-blue-900/60 border border-blue-500/30 text-blue-300 text-xs font-bold uppercase tracking-wider">
            <span>Organizational Memory</span>
          </div>

          <h2 className="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight leading-tight text-white">
            {title}
          </h2>
          
          <p className="text-slate-300 text-base sm:text-lg leading-relaxed font-normal">
            {subtitle}
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3.5 pt-4">
            {isLoggedIn ? (
              <button 
                onClick={onGoToDashboard}
                className="w-full sm:w-auto bg-brand-primary text-slate-900 px-8 py-3.5 rounded-xl font-bold uppercase tracking-wider text-[12px] shadow-sm hover:bg-blue-400 hover:scale-[1.01] active:scale-[0.99] transition-all flex items-center justify-center space-x-2"
              >
                <span>Go to Dashboard</span>
                <ArrowRight size={14} />
              </button>
            ) : (
              <button 
                onClick={onStartFree}
                className="w-full sm:w-auto bg-brand-primary text-slate-900 px-8 py-3.5 rounded-xl font-bold uppercase tracking-wider text-[12px] shadow-sm hover:bg-blue-400 hover:scale-[1.01] active:scale-[0.99] transition-all flex items-center justify-center space-x-2"
              >
                <span>Start Free</span>
                <ArrowRight size={14} />
              </button>
            )}
            
            <button 
              onClick={onNavigateToDemo}
              className="w-full sm:w-auto bg-slate-800 text-white border border-slate-700 hover:bg-slate-700 px-7 py-3.5 rounded-xl font-bold uppercase tracking-wider text-[12px] transition-all flex items-center justify-center space-x-2"
            >
              <span>Book a Demo</span>
              <Calendar size={14} className="text-slate-400" />
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-4 pt-2 text-xs text-slate-400 font-medium">
            <span className="flex items-center gap-1.5">
              <CheckCircle2 size={13} className="text-emerald-400" />
              No credit card required
            </span>
            <span className="flex items-center gap-1.5">
              <CheckCircle2 size={13} className="text-emerald-400" />
              Instant workspace access
            </span>
          </div>
        </motion.div>
      </div>
    </section>
  );
};

export default CTASection;
