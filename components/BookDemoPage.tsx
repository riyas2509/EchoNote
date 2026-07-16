
import React, { useState } from 'react';
import { motion } from 'motion/react';
import { CheckCircle2, ArrowRight, Calendar, Clock, Users, ShieldCheck } from 'lucide-react';

const BookDemoPage: React.FC = () => {
  const [isSubmitted, setIsSubmitted] = useState(false);

  const fadeIn = {
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.6 }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitted(true);
  };

  return (
    <div className="bg-brand-background pt-32 pb-24 px-6">
      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-24 items-start">
        <motion.div {...fadeIn} className="space-y-12">
          <div className="space-y-6">
            <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-brand-primary">See intelligence in action.</h1>
            <p className="text-brand-secondary/60 text-lg leading-relaxed max-w-lg">
              Schedule a 30-minute strategic walkthrough with our enterprise solutions team to see how EchoNote can transform your operations.
            </p>
          </div>

          <div className="space-y-8">
            <h3 className="text-[11px] font-bold uppercase tracking-widest text-brand-secondary/40">What to expect:</h3>
            <div className="space-y-6">
              {[
                { icon: <Users size={20} />, title: 'Personalized Walkthrough', desc: 'A deep dive into features tailored to your industry and use cases.' },
                { icon: <ShieldCheck size={20} />, title: 'Security & Compliance Review', desc: 'Detailed overview of our data protection and compliance controls.' },
                { icon: <Clock size={20} />, title: 'ROI Assessment', desc: 'Calculate the potential time and cost savings for your organization.' }
              ].map((item, i) => (
                <div key={i} className="flex items-start space-x-4">
                  <div className="w-10 h-10 rounded-xl bg-brand-primary/5 flex items-center justify-center text-brand-primary shrink-0">
                    {item.icon}
                  </div>
                  <div className="space-y-1">
                    <h4 className="font-bold text-brand-primary">{item.title}</h4>
                    <p className="text-brand-secondary/60 text-sm">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </motion.div>

        <motion.div 
          initial={{ opacity: 0, x: 30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="bg-white p-12 rounded-3xl shadow-[0_50px_100px_-20px_rgba(17,34,80,0.1)] border border-brand-divider/20"
        >
          {isSubmitted ? (
            <div className="text-center space-y-8 py-12">
              <div className="w-20 h-20 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-500 mx-auto">
                <CheckCircle2 size={40} />
              </div>
              <div className="space-y-4">
                <h2 className="text-3xl font-bold text-brand-primary">Demo Requested!</h2>
                <p className="text-brand-secondary/60">Thank you for your interest. A member of our team will reach out within 24 hours to schedule your demo.</p>
              </div>
              <button 
                onClick={() => setIsSubmitted(false)}
                className="text-brand-primary font-bold uppercase tracking-widest text-[13px] hover:opacity-70 transition-opacity"
              >
                Request another demo
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-2">
                  <label className="text-[11px] font-bold uppercase tracking-widest text-brand-secondary/40">Full Name</label>
                  <input required type="text" className="w-full bg-brand-background border border-brand-divider/20 rounded-xl px-4 py-4 text-brand-primary focus:outline-none focus:border-brand-primary transition-colors" placeholder="John Doe" />
                </div>
                <div className="space-y-2">
                  <label className="text-[11px] font-bold uppercase tracking-widest text-brand-secondary/40">Work Email</label>
                  <input required type="email" className="w-full bg-brand-background border border-brand-divider/20 rounded-xl px-4 py-4 text-brand-primary focus:outline-none focus:border-brand-primary transition-colors" placeholder="john@company.com" />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-2">
                  <label className="text-[11px] font-bold uppercase tracking-widest text-brand-secondary/40">Company Name</label>
                  <input required type="text" className="w-full bg-brand-background border border-brand-divider/20 rounded-xl px-4 py-4 text-brand-primary focus:outline-none focus:border-brand-primary transition-colors" placeholder="Acme Inc." />
                </div>
                <div className="space-y-2">
                  <label className="text-[11px] font-bold uppercase tracking-widest text-brand-secondary/40">Company Size</label>
                  <select className="w-full bg-brand-background border border-brand-divider/20 rounded-xl px-4 py-4 text-brand-primary focus:outline-none focus:border-brand-primary transition-colors appearance-none">
                    <option>1-50 employees</option>
                    <option>51-200 employees</option>
                    <option>201-1000 employees</option>
                    <option>1000+ employees</option>
                  </select>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[11px] font-bold uppercase tracking-widest text-brand-secondary/40">Industry</label>
                <select className="w-full bg-brand-background border border-brand-divider/20 rounded-xl px-4 py-4 text-brand-primary focus:outline-none focus:border-brand-primary transition-colors appearance-none">
                  <option>Financial Services</option>
                  <option>Legal Services</option>
                  <option>Compliance & Audit</option>
                  <option>Healthcare</option>
                  <option>Technology</option>
                  <option>Other</option>
                </select>
              </div>
              <button 
                type="submit"
                className="w-full bg-brand-primary text-white py-5 rounded-xl font-bold uppercase tracking-widest text-[13px] shadow-2xl hover:shadow-brand-primary/20 hover:-translate-y-1 transition-all flex items-center justify-center space-x-3"
              >
                <span>Schedule Demo</span>
                <ArrowRight size={18} />
              </button>
              <p className="text-center text-[11px] text-brand-secondary/40">By clicking "Schedule Demo", you agree to our Terms of Service and Privacy Policy.</p>
            </form>
          )}
        </motion.div>
      </div>
    </div>
  );
};

export default BookDemoPage;
