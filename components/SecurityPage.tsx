
import React from 'react';
import { motion } from 'motion/react';
import { ShieldCheck, Lock, Users, BarChart3, Globe, Zap, Check } from 'lucide-react';

const SecurityPage: React.FC = () => {
  const fadeIn = {
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.6 }
  };

  const staggerContainer = {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    transition: { staggerChildren: 0.1 }
  };

  return (
    <div className="bg-brand-background pt-32 pb-24 px-6">
      <div className="max-w-7xl mx-auto space-y-24">
        <motion.div {...fadeIn} className="space-y-6 text-center max-w-3xl mx-auto">
          <div className="inline-flex items-center space-x-2 text-emerald-600 mb-4">
            <ShieldCheck size={24} />
            <span className="text-[14px] font-bold uppercase tracking-widest">Enterprise Security</span>
          </div>
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-brand-primary">Security is our core.</h1>
          <p className="text-brand-secondary/60 text-lg leading-relaxed">
            EchoNote is built from the ground up to meet the rigorous security and compliance requirements of the world's most regulated industries.
          </p>
        </motion.div>

        <motion.div 
          variants={staggerContainer}
          initial="initial"
          animate="animate"
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8"
        >
          {[
            { icon: <Lock />, title: 'Encryption Standards', desc: 'All communications are fully secured in transit using TLS 1.3, and database records are encrypted at rest using industry-standard AES-256.' },
            { icon: <Users />, title: 'Granular RBAC', desc: 'Strict role-based access control. Assign Owner, Editor, or Viewer roles to restrict who can view, transcribe, edit, or invite project members.' },
            { icon: <BarChart3 />, title: 'Project Activity Trail', desc: 'Core milestones, uploads, and collaborator modifications are automatically logged in an immutable, real-time activity timeline.' },
            { icon: <ShieldCheck />, title: 'Firestore Security Rules', desc: 'Server-side access policy checks enforced at the database layer on every single read and write, ensuring bulletproof user data isolation.' },
            { icon: <Zap />, title: 'Zero-Training AI Policy', desc: 'Your transcripts, decisions, and thinking tasks are processed via private API keys and are never used to retrain global models.' },
            { icon: <ShieldCheck />, title: 'Firebase Authentication', desc: 'Secure identity management, industry-standard password hashing, and secure token-based session validation.' }
          ].map((item, i) => (
            <motion.div 
              key={i}
              variants={fadeIn}
              className="p-8 rounded-2xl bg-white border border-brand-divider/20 shadow-sm hover:shadow-xl transition-all"
            >
              <div className="w-12 h-12 rounded-xl bg-brand-primary/5 flex items-center justify-center text-brand-primary mb-6">
                {item.icon}
              </div>
              <h3 className="text-xl font-bold text-brand-primary mb-4">{item.title}</h3>
              <p className="text-brand-secondary/60 text-sm leading-relaxed">{item.desc}</p>
            </motion.div>
          ))}
        </motion.div>

        {/* Enterprise Identity & SSO Section */}
        <motion.div {...fadeIn} className="space-y-12">
          <div className="text-center space-y-4 max-w-2xl mx-auto">
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-brand-primary">Identity & Access Control</h2>
            <p className="text-brand-secondary/60 text-base leading-relaxed">
              Verify credentials and regulate user workspaces with modern, enterprise-ready identity integration patterns.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-5xl mx-auto">
            {/* Active Integrations */}
            <div className="p-8 rounded-3xl bg-white border border-brand-divider/20 shadow-sm space-y-6">
              <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                <span>Active & Implemented</span>
              </div>
              <h3 className="text-xl font-bold text-brand-primary">Corporate Single Sign-On</h3>
              <p className="text-brand-secondary/60 text-sm leading-relaxed">
                EchoNote leverages fully active, secure identity integration architectures so teams can log in instantly with zero additional setup:
              </p>
              <ul className="space-y-3">
                <li className="flex items-start space-x-3 text-sm text-brand-secondary/70">
                  <div className="w-5 h-5 rounded-full bg-brand-primary/5 flex items-center justify-center text-brand-primary mt-0.5 shrink-0">
                    <Check size={12} className="text-emerald-600" />
                  </div>
                  <div>
                    <span className="font-bold text-brand-primary">Google Workspace:</span> Connect automatically with your company's Google accounts for instant, secure authentication and workspace onboarding.
                  </div>
                </li>
                <li className="flex items-start space-x-3 text-sm text-brand-secondary/70">
                  <div className="w-5 h-5 rounded-full bg-brand-primary/5 flex items-center justify-center text-brand-primary mt-0.5 shrink-0">
                    <Check size={12} className="text-emerald-600" />
                  </div>
                  <div>
                    <span className="font-bold text-brand-primary">Microsoft Authentication:</span> Log in directly with standard secure corporate Microsoft accounts to guarantee immediate identity verification.
                  </div>
                </li>
              </ul>
            </div>

            {/* Roadmap Integrations */}
            <div className="p-8 rounded-3xl bg-white border border-brand-divider/20 shadow-sm space-y-6">
              <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700">
                <span>Enterprise Roadmap</span>
              </div>
              <h3 className="text-xl font-bold text-brand-primary">Future Integrations</h3>
              <p className="text-brand-secondary/60 text-sm leading-relaxed">
                We are actively building deeper, central enterprise security controllers. The following systems are scheduled for upcoming production deployment:
              </p>
              <ul className="space-y-3">
                <li className="flex items-start space-x-3 text-sm text-brand-secondary/60">
                  <div className="w-5 h-5 rounded-full bg-amber-50 flex items-center justify-center text-amber-700 mt-0.5 shrink-0">
                    <span className="text-[9px] font-black uppercase">Roadmap</span>
                  </div>
                  <div>
                    <span className="font-bold text-brand-primary">SAML SSO:</span> Centralized federated single sign-on security linking organization directories with external networks.
                  </div>
                </li>
                <li className="flex items-start space-x-3 text-sm text-brand-secondary/60">
                  <div className="w-5 h-5 rounded-full bg-amber-50 flex items-center justify-center text-amber-700 mt-0.5 shrink-0">
                    <span className="text-[9px] font-black uppercase">Roadmap</span>
                  </div>
                  <div>
                    <span className="font-bold text-brand-primary">Okta Integration:</span> Universal directory sync, security policy coordination, and automated user provisioning.
                  </div>
                </li>
                <li className="flex items-start space-x-3 text-sm text-brand-secondary/60">
                  <div className="w-5 h-5 rounded-full bg-amber-50 flex items-center justify-center text-amber-700 mt-0.5 shrink-0">
                    <span className="text-[9px] font-black uppercase">Roadmap</span>
                  </div>
                  <div>
                    <span className="font-bold text-brand-primary">Microsoft Entra ID:</span> Direct cloud infrastructure directory sync for real-time security coordination.
                  </div>
                </li>
              </ul>
            </div>
          </div>
        </motion.div>

        <motion.div {...fadeIn} className="bg-brand-primary text-white p-12 md:p-24 rounded-[40px] text-center space-y-10 relative overflow-hidden">
          <div className="absolute inset-0 opacity-10 pointer-events-none">
            <div className="absolute -top-24 -left-24 w-96 h-96 bg-brand-accent rounded-full blur-[120px]"></div>
          </div>
          <div className="relative z-10 space-y-6">
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight">Need a security review?</h2>
            <p className="text-white/60 text-lg max-w-xl mx-auto">
              Our security team is ready to help your compliance department review our controls and documentation.
            </p>
            <button className="bg-white text-brand-primary px-10 py-5 rounded-xl font-bold uppercase tracking-widest text-[13px] shadow-2xl hover:bg-brand-background transition-all">
              Request Security Pack
            </button>
          </div>
        </motion.div>
      </div>
    </div>
  );
};

export default SecurityPage;
