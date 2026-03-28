
import React from 'react';
import { motion } from 'framer-motion';
import { ShieldCheck, Lock, Users, BarChart3, Globe, Zap } from 'lucide-react';

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
            { icon: <Lock />, title: 'End-to-End Encryption', desc: 'All data is encrypted at rest using AES-256 and in transit using TLS 1.3. Your keys are managed using FIPS 140-2 Level 3 hardware security modules.' },
            { icon: <Users />, title: 'Granular RBAC', desc: 'Implement strict Role-Based Access Control (RBAC) across your entire organization. Define custom roles and permissions at the project level.' },
            { icon: <BarChart3 />, title: 'Audit Logging', desc: 'Every action taken within EchoNote is logged in a comprehensive, immutable audit trail. Export logs directly to your SIEM for real-time monitoring.' },
            { icon: <Globe />, title: 'Data Residency', desc: 'Choose where your data is stored. We offer data residency options in the US, EU, and APAC to help you meet local regulatory requirements.' },
            { icon: <Zap />, title: 'Zero-Knowledge AI', desc: 'Your data is never used to train our global AI models. We use isolated, single-tenant processing environments for every enterprise customer.' },
            { icon: <ShieldCheck />, title: 'Compliance Standards', desc: 'We are SOC2 Type II, GDPR, and HIPAA compliant. Our security controls are independently audited annually.' }
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
