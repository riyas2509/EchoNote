
import React from 'react';
import { motion } from 'motion/react';
import { Zap, Shield, Search, Users, BarChart3, Globe } from 'lucide-react';
import CTASection from '../components/CTASection';
import { AuthStatus } from '../types';

interface FeaturesProps {
  onLogin: () => void;
  onStartFree: () => void;
  onNavigateToDemo: () => void;
  authStatus?: AuthStatus;
  onGoToDashboard: () => void;
}

const Features: React.FC<FeaturesProps> = ({ onLogin, onStartFree, onNavigateToDemo, authStatus, onGoToDashboard }) => {
  const fadeIn = {
    initial: { opacity: 0, y: 20 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true },
    transition: { duration: 0.6 }
  };

  const features = [
    {
      icon: <Zap className="text-brand-accent" />,
      title: "Real-time Transcription",
      description: "Transcribe live or recorded audio with speaker separation and high accuracy."
    },
    {
      icon: <Users className="text-brand-accent" />,
      title: "Speaker Intelligence",
      description: "Automatically identify and track speakers across conversations."
    },
    {
      icon: <Shield className="text-brand-accent" />,
      title: "Compliance Detection",
      description: "Flag sensitive keywords and regulatory risks instantly."
    },
    {
      icon: <Search className="text-brand-accent" />,
      title: "Semantic Search",
      description: "Search meaning, not words, across your entire audio archive."
    },
    {
      icon: <BarChart3 className="text-brand-accent" />,
      title: "Smart Summaries",
      description: "Generate structured summaries with decisions and action items."
    },
    {
      icon: <Globe className="text-brand-accent" />,
      title: "Multi-language Support",
      description: "Process multiple languages and accents with context awareness."
    }
  ];

  return (
    <div className="bg-brand-background pt-32 pb-24 px-6">
      <div className="max-w-7xl mx-auto">
        <div className="text-center space-y-6 mb-24">
          <h2 className="text-4xl md:text-5xl font-bold tracking-tight text-brand-primary">This isn’t transcription. <span className="text-brand-secondary">It’s intelligence.</span></h2>
          <p className="text-brand-secondary/60 max-w-2xl mx-auto text-lg">Powerful features designed to handle the complexity of professional conversations.</p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {features.map((feature, index) => (
            <motion.div 
              key={index}
              {...fadeIn}
              transition={{ delay: index * 0.1 }}
              className="p-10 rounded-[32px] bg-white border border-brand-divider/10 shadow-sm hover:shadow-xl hover:-translate-y-2 transition-all group"
            >
              <div className="w-14 h-14 rounded-2xl bg-brand-primary/5 flex items-center justify-center mb-8 group-hover:bg-brand-primary group-hover:text-white transition-colors">
                {React.cloneElement(feature.icon as React.ReactElement, { size: 28 })}
              </div>
              <h3 className="text-xl font-bold text-brand-primary mb-4">{feature.title}</h3>
              <p className="text-brand-secondary/60 leading-relaxed">{feature.description}</p>
            </motion.div>
          ))}
        </div>

        {/* 6. INTERACTIVE DEMO SECTION */}
        <section className="mt-32">
          <div className="max-w-7xl mx-auto rounded-[40px] bg-white border border-brand-divider/20 shadow-2xl overflow-hidden">
            <div className="grid grid-cols-1 lg:grid-cols-2">
              <div className="p-12 md:p-20 space-y-8">
                <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-emerald-100 text-emerald-700 text-[11px] font-bold uppercase tracking-widest">
                  Live Preview
                </div>
                <h2 className="text-4xl font-bold tracking-tight text-brand-primary leading-tight">Experience the <br />intelligence in action.</h2>
                <p className="text-brand-secondary/70 leading-relaxed">
                  Our interactive dashboard provides a bird's-eye view of your audio ecosystem. Monitor compliance, track sentiment, and extract value from every word.
                </p>
                <ul className="space-y-4">
                  {['Instant speaker mapping', 'Automated summary generation', 'Keyword violation flagging'].map((item, i) => (
                    <li key={i} className="flex items-center space-x-3 text-brand-primary font-medium">
                      <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center text-white">
                        <i className="fa-solid fa-check text-[10px]"></i>
                      </div>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="bg-brand-primary/5 p-12 flex items-center justify-center relative overflow-hidden">
                <div className="absolute inset-0 opacity-20">
                  <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-brand-accent via-transparent to-transparent"></div>
                </div>
                <div className="relative z-10 w-full max-w-md bg-white rounded-2xl shadow-2xl border border-brand-divider/20 p-6 space-y-6">
                  <div className="flex items-center justify-between">
                    <div className="flex space-x-2">
                      <div className="w-3 h-3 rounded-full bg-red-400"></div>
                      <div className="w-3 h-3 rounded-full bg-amber-400"></div>
                      <div className="w-3 h-3 rounded-full bg-emerald-400"></div>
                    </div>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-brand-secondary/40">Active Analysis</div>
                  </div>
                  <div className="h-40 bg-brand-background rounded-xl border border-brand-divider/10 flex items-center justify-center">
                    <div className="flex items-end space-x-1 h-12">
                      {[40, 70, 45, 90, 65, 80, 50, 85, 60, 75].map((h, i) => (
                        <motion.div 
                          key={i}
                          animate={{ height: [`${h}%`, `${h+10}%`, `${h}%`] }}
                          transition={{ duration: 1.5, repeat: Infinity, delay: i * 0.1 }}
                          className="w-2 bg-brand-primary rounded-t-sm"
                        ></motion.div>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-[11px] font-bold">
                      <span className="text-brand-secondary/40 uppercase tracking-widest">Sentiment</span>
                      <span className="text-emerald-600">Positive (88%)</span>
                    </div>
                    <div className="w-full h-2 bg-brand-divider/20 rounded-full overflow-hidden">
                      <div className="w-[88%] h-full bg-emerald-500"></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
      <CTASection onLogin={onLogin} onStartFree={onStartFree} onNavigateToDemo={onNavigateToDemo} authStatus={authStatus} onGoToDashboard={onGoToDashboard} />
    </div>
  );
};

export default Features;
