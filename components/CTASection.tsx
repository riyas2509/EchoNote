
import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { ArrowRight } from 'lucide-react';
import { AuthStatus } from '../types';

interface CTASectionProps {
  onLogin: () => void;
  onStartFree: () => void;
  onNavigateToDemo: () => void;
  authStatus?: AuthStatus;
  onGoToDashboard: () => void;
}

const CTASection: React.FC<CTASectionProps> = ({ onLogin, onStartFree, onNavigateToDemo, authStatus, onGoToDashboard }) => {
  const isLoggedIn = authStatus === AuthStatus.LOGGED_IN;

  const fadeIn = {
    initial: { opacity: 0, y: 20 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true },
    transition: { duration: 0.6 }
  };

  return (
    <section className="py-32 px-6">
      <div className="max-w-5xl mx-auto rounded-[32px] bg-slate-900 text-white p-12 md:p-20 text-center relative overflow-hidden border border-slate-800">
        {/* Decorative background */}
        <div className="absolute top-0 left-0 w-full h-full opacity-15 pointer-events-none">
          <div className="absolute -top-24 -left-24 w-96 h-96 bg-blue-500 rounded-full blur-[120px]"></div>
          <div className="absolute -bottom-24 -right-24 w-96 h-96 bg-purple-500 rounded-full blur-[120px]"></div>
        </div>
        
        <motion.div {...fadeIn} className="relative z-10 space-y-8 max-w-2xl mx-auto">
          <h2 className="text-3xl md:text-5xl font-extrabold tracking-tight leading-tight text-white">
            Stop listening. <br />
            <span className="text-blue-400">Start understanding.</span>
          </h2>
          <p className="text-slate-400 text-base md:text-lg max-w-xl mx-auto leading-relaxed">
            Join the leading enterprise teams transforming their audio data into structured intelligence today.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
            {isLoggedIn ? (
              <button 
                onClick={onGoToDashboard}
                className="w-full sm:w-auto bg-brand-primary text-slate-900 px-8 py-3.5 rounded-xl font-bold uppercase tracking-wider text-[11px] shadow-md hover:bg-blue-400 hover:scale-[1.02] active:scale-[0.98] transition-all text-center flex items-center justify-center space-x-2"
              >
                <span>DASHBOARD</span>
                <ArrowRight size={14} />
              </button>
            ) : (
              <button 
                onClick={onStartFree}
                className="w-full sm:w-auto bg-brand-primary text-slate-900 px-8 py-3.5 rounded-xl font-bold uppercase tracking-wider text-[11px] shadow-md hover:bg-blue-400 hover:scale-[1.02] active:scale-[0.98] transition-all text-center flex items-center justify-center space-x-2"
              >
                <span>START FREE</span>
                <ArrowRight size={14} />
              </button>
            )}
            {!isLoggedIn && (
              <button 
                onClick={onStartFree}
                className="w-full sm:w-auto bg-slate-800 text-white border border-slate-700 hover:bg-slate-700 hover:scale-[1.02] active:scale-[0.98] px-8 py-3.5 rounded-xl font-bold uppercase tracking-wider text-[11px] transition-all text-center flex items-center justify-center"
              >
                Upload Your First Call
              </button>
            )}
          </div>
          <p className="text-slate-500 text-[11px] font-bold uppercase tracking-widest pt-2">No credit card required • Built for compliance-heavy teams</p>
        </motion.div>
      </div>
    </section>
  );
};

export default CTASection;
