
import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Mail, MessageSquare, Globe, ArrowRight, CheckCircle2 } from 'lucide-react';

const ContactPage: React.FC = () => {
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
            <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-brand-primary">Get in touch.</h1>
            <p className="text-brand-secondary/60 text-lg leading-relaxed max-w-lg">
              Have questions about EchoNote? Our team is here to help you understand how our platform can transform your enterprise audio intelligence.
            </p>
          </div>

          <div className="space-y-8">
            <div className="flex items-start space-x-6">
              <div className="w-12 h-12 rounded-xl bg-brand-primary/5 flex items-center justify-center text-brand-primary shrink-0">
                <Mail size={24} />
              </div>
              <div className="space-y-1">
                <h3 className="font-bold text-brand-primary">Email Support</h3>
                <p className="text-brand-secondary/60 text-sm">riya@echotechai.in</p>
                <p className="text-brand-secondary/40 text-[12px]">Response time: ~2 hours</p>
              </div>
            </div>
            <div className="flex items-start space-x-6">
              <div className="w-12 h-12 rounded-xl bg-brand-primary/5 flex items-center justify-center text-brand-primary shrink-0">
                <MessageSquare size={24} />
              </div>
              <div className="space-y-1">
                <h3 className="font-bold text-brand-primary">Sales Inquiry</h3>
                <p className="text-brand-secondary/60 text-sm">riyamshah2509@gmail.com</p>
                <p className="text-brand-secondary/40 text-[12px]">Response time: ~24 hours</p>
              </div>
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
                <h2 className="text-3xl font-bold text-brand-primary">Message Sent!</h2>
                <p className="text-brand-secondary/60">Thank you for reaching out. Our team will get back to you shortly.</p>
              </div>
              <button 
                onClick={() => setIsSubmitted(false)}
                className="text-brand-primary font-bold uppercase tracking-widest text-[13px] hover:opacity-70 transition-opacity"
              >
                Send another message
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-2">
                  <label className="text-[11px] font-bold uppercase tracking-widest text-brand-secondary/40">First Name</label>
                  <input required type="text" className="w-full bg-brand-background border border-brand-divider/20 rounded-xl px-4 py-4 text-brand-primary focus:outline-none focus:border-brand-primary transition-colors" placeholder="John" />
                </div>
                <div className="space-y-2">
                  <label className="text-[11px] font-bold uppercase tracking-widest text-brand-secondary/40">Last Name</label>
                  <input required type="text" className="w-full bg-brand-background border border-brand-divider/20 rounded-xl px-4 py-4 text-brand-primary focus:outline-none focus:border-brand-primary transition-colors" placeholder="Doe" />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[11px] font-bold uppercase tracking-widest text-brand-secondary/40">Work Email</label>
                <input required type="email" className="w-full bg-brand-background border border-brand-divider/20 rounded-xl px-4 py-4 text-brand-primary focus:outline-none focus:border-brand-primary transition-colors" placeholder="john@company.com" />
              </div>
              <div className="space-y-2">
                <label className="text-[11px] font-bold uppercase tracking-widest text-brand-secondary/40">Message</label>
                <textarea required rows={4} className="w-full bg-brand-background border border-brand-divider/20 rounded-xl px-4 py-4 text-brand-primary focus:outline-none focus:border-brand-primary transition-colors resize-none" placeholder="Tell us about your needs..."></textarea>
              </div>
              <button 
                type="submit"
                className="w-full bg-brand-primary text-white py-5 rounded-xl font-bold uppercase tracking-widest text-[13px] shadow-2xl hover:shadow-brand-primary/20 hover:-translate-y-1 transition-all flex items-center justify-center space-x-3"
              >
                <span>Send Message</span>
                <ArrowRight size={18} />
              </button>
            </form>
          )}
        </motion.div>
      </div>
    </div>
  );
};

export default ContactPage;
