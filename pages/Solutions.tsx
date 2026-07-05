
import React from 'react';
import { motion } from 'motion/react';
import { Shield, Lock, CheckCircle2, Globe, Scale, Building2, Briefcase, Landmark } from 'lucide-react';
import CTASection from '../components/CTASection';
import { AuthStatus } from '../types';

interface SolutionsProps {
  onLogin: () => void;
  onStartFree: () => void;
  onNavigateToDemo: () => void;
  authStatus?: AuthStatus;
  onGoToDashboard: () => void;
}

const Solutions: React.FC<SolutionsProps> = ({ onLogin, onStartFree, onNavigateToDemo, authStatus, onGoToDashboard }) => {
  const fadeIn = {
    initial: { opacity: 0, y: 20 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true },
    transition: { duration: 0.6 }
  };

  return (
    <div className="bg-brand-background pt-32 pb-24 px-6">
      <div className="max-w-7xl mx-auto">
        {/* 8. SECURITY & TRUST SECTION */}
        <section className="mb-32">
          <div className="text-center space-y-6 mb-24">
            <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-brand-primary/5 border border-brand-primary/10 text-brand-primary text-[11px] font-bold uppercase tracking-widest">
              Enterprise Grade
            </div>
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight text-brand-primary">Your data isn’t processed. <span className="text-brand-secondary">It’s protected.</span></h2>
            <p className="text-brand-secondary/60 max-w-2xl mx-auto text-lg">We maintain strong security patterns and data access controls to protect your sensitive conversations.</p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
            <motion.div {...fadeIn} className="p-10 rounded-[32px] bg-white border border-brand-divider/10 shadow-sm space-y-6">
              <div className="w-16 h-16 rounded-2xl bg-brand-primary/5 flex items-center justify-center text-brand-primary">
                <Shield size={32} />
              </div>
              <h3 className="text-xl font-bold text-brand-primary">Project Access Isolation</h3>
              <p className="text-brand-secondary/60 leading-relaxed">Server-side security rules validate project-level access so that only explicitly assigned members can read transcripts.</p>
            </motion.div>
            
            <motion.div {...fadeIn} transition={{ delay: 0.2 }} className="p-10 rounded-[32px] bg-white border border-brand-divider/10 shadow-sm space-y-6">
              <div className="w-16 h-16 rounded-2xl bg-brand-primary/5 flex items-center justify-center text-brand-primary">
                <Lock size={32} />
              </div>
              <h3 className="text-xl font-bold text-brand-primary">Standard Data Encryption</h3>
              <p className="text-brand-secondary/60 leading-relaxed">AES-256 encryption at rest and TLS 1.3 encryption in transit protect all transcripts and platform communications.</p>
            </motion.div>
            
            <motion.div {...fadeIn} transition={{ delay: 0.4 }} className="p-10 rounded-[32px] bg-white border border-brand-divider/10 shadow-sm space-y-6">
              <div className="w-16 h-16 rounded-2xl bg-brand-primary/5 flex items-center justify-center text-brand-primary">
                <Globe size={32} />
              </div>
              <h3 className="text-xl font-bold text-brand-primary">Zero-training AI policy</h3>
              <p className="text-brand-secondary/60 leading-relaxed">Transcripts and strategic analyses are processed via secure server-side API queries and never utilized for global model retraining.</p>
            </motion.div>
          </div>
        </section>

        {/* 9. USE CASES SECTION */}
        <section>
          <div className="text-center space-y-6 mb-24">
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight text-brand-primary">Built for teams where <span className="text-brand-secondary">accuracy matters.</span></h2>
            <p className="text-brand-secondary/60 max-w-2xl mx-auto text-lg">EchoNote adapts to the specific terminology and compliance needs of specialized sectors.</p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <motion.div {...fadeIn} className="group p-8 rounded-[32px] bg-white border border-brand-divider/10 hover:border-brand-primary/20 transition-all flex items-start space-x-8">
              <div className="w-16 h-16 rounded-2xl bg-brand-background flex items-center justify-center text-brand-primary shrink-0 group-hover:bg-brand-primary group-hover:text-white transition-all">
                <Landmark size={28} />
              </div>
              <div className="space-y-4">
                <h3 className="text-xl font-bold text-brand-primary">Financial Services</h3>
                <p className="text-brand-secondary/60 text-sm leading-relaxed">Automate trade confirmation reviews and ensure MiFID II / Dodd-Frank compliance across all voice channels.</p>
              </div>
            </motion.div>
            
            <motion.div {...fadeIn} transition={{ delay: 0.1 }} className="group p-8 rounded-[32px] bg-white border border-brand-divider/10 hover:border-brand-primary/20 transition-all flex items-start space-x-8">
              <div className="w-16 h-16 rounded-2xl bg-brand-background flex items-center justify-center text-brand-primary shrink-0 group-hover:bg-brand-primary group-hover:text-white transition-all">
                <Scale size={28} />
              </div>
              <div className="space-y-4">
                <h3 className="text-xl font-bold text-brand-primary">Legal & Litigation</h3>
                <p className="text-brand-secondary/60 text-sm leading-relaxed">Transform depositions and client meetings into searchable, billable intelligence with perfect speaker attribution.</p>
              </div>
            </motion.div>
            
            <motion.div {...fadeIn} transition={{ delay: 0.2 }} className="group p-8 rounded-[32px] bg-white border border-brand-divider/10 hover:border-brand-primary/20 transition-all flex items-start space-x-8">
              <div className="w-16 h-16 rounded-2xl bg-brand-background flex items-center justify-center text-brand-primary shrink-0 group-hover:bg-brand-primary group-hover:text-white transition-all">
                <Building2 size={28} />
              </div>
              <div className="space-y-4">
                <h3 className="text-xl font-bold text-brand-primary">Enterprise Sales</h3>
                <p className="text-brand-secondary/60 text-sm leading-relaxed">Extract deal intelligence from discovery calls and automatically sync action items to your CRM.</p>
              </div>
            </motion.div>
            
            <motion.div {...fadeIn} transition={{ delay: 0.3 }} className="group p-8 rounded-[32px] bg-white border border-brand-divider/10 hover:border-brand-primary/20 transition-all flex items-start space-x-8">
              <div className="w-16 h-16 rounded-2xl bg-brand-background flex items-center justify-center text-brand-primary shrink-0 group-hover:bg-brand-primary group-hover:text-white transition-all">
                <Briefcase size={28} />
              </div>
              <div className="space-y-4">
                <h3 className="text-xl font-bold text-brand-primary">Human Resources</h3>
                <p className="text-brand-secondary/60 text-sm leading-relaxed">Maintain objective records of interviews and internal reviews while ensuring privacy and data protection.</p>
              </div>
            </motion.div>
          </div>
        </section>
      </div>
      <CTASection onLogin={onLogin} onStartFree={onStartFree} onNavigateToDemo={onNavigateToDemo} authStatus={authStatus} onGoToDashboard={onGoToDashboard} />
    </div>
  );
};

export default Solutions;
