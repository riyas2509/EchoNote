
import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
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
            {isLoggedIn ? (
              <Link 
                to="/app"
                className="w-full sm:w-auto bg-brand-accent text-brand-primary px-12 py-6 rounded-2xl font-bold uppercase tracking-widest text-[14px] shadow-2xl hover:shadow-brand-accent/20 hover:-translate-y-1 transition-all text-center"
              >
                Dashboard
              </Link>
            ) : (
              <button 
                onClick={onStartFree}
                className="w-full sm:w-auto bg-brand-accent text-brand-primary px-12 py-6 rounded-2xl font-bold uppercase tracking-widest text-[14px] shadow-2xl hover:shadow-brand-accent/20 hover:-translate-y-1 transition-all text-center"
              >
                Start Free
              </button>
            )}
            {!isLoggedIn && (
              <button 
                onClick={onStartFree}
                className="w-full sm:w-auto bg-white/10 text-white border border-white/20 px-12 py-6 rounded-2xl font-bold uppercase tracking-widest text-[14px] hover:bg-white/20 transition-all text-center"
              >
                Upload Your First Call
              </button>
            )}
          </div>
          <p className="text-white/40 text-[13px] font-medium">No credit card required • Built for compliance-heavy teams</p>
        </motion.div>
      </div>
    </section>
  );
};

export default CTASection;
