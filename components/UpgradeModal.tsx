import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Check, Zap, Shield, Users, Download, Brain } from 'lucide-react';
import { SubscriptionTier } from '../types';

interface UpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  reason?: string;
}

const UpgradeModal: React.FC<UpgradeModalProps> = ({ isOpen, onClose, reason }) => {
  if (!isOpen) return null;

  const benefits = [
    { icon: <Brain size={18} className="text-purple-500" />, text: "Unlimited Thinking Engine analysis" },
    { icon: <Download size={18} className="text-blue-500" />, text: "Export transcripts to PDF, DOCX, and TXT" },
    { icon: <Zap size={18} className="text-amber-500" />, text: "Priority processing for all audio files" },
    { icon: <Users size={18} className="text-emerald-500" />, text: "Team collaboration and shared workspaces" },
    { icon: <Shield size={18} className="text-slate-500" />, text: "Advanced security and admin controls" },
  ];

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[1000] flex items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
        />
        
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl overflow-hidden"
        >
          {/* Header */}
          <div className="bg-brand-primary p-8 text-white relative">
            <button 
              onClick={onClose}
              className="absolute top-6 right-6 p-2 hover:bg-white/10 rounded-full transition-colors"
            >
              <X size={20} />
            </button>
            
            <div className="space-y-2">
              <div className="inline-flex items-center space-x-2 px-3 py-1 bg-white/20 rounded-full text-xs font-bold uppercase tracking-widest">
                <Zap size={12} fill="currentColor" />
                <span>Upgrade Required</span>
              </div>
              <h2 className="text-3xl font-bold tracking-tight">
                Upgrade your plan
              </h2>
              <p className="text-white/80 font-medium">
                {reason || "You've reached a feature limit on your current plan."}
              </p>
            </div>
          </div>

          {/* Body */}
          <div className="p-8 space-y-8">
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest">What you'll get:</h3>
              <div className="space-y-3">
                {benefits.map((benefit, idx) => (
                  <div key={idx} className="flex items-center space-x-3 text-slate-700 font-medium">
                    <div className="w-8 h-8 rounded-lg bg-slate-50 flex items-center justify-center flex-shrink-0">
                      {benefit.icon}
                    </div>
                    <span>{benefit.text}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <button 
                onClick={() => {
                  // In a real app, this would redirect to checkout
                  window.location.href = '/app/subscription';
                  onClose();
                }}
                className="w-full py-4 bg-brand-primary text-white rounded-xl font-bold tracking-widest text-sm uppercase shadow-xl shadow-brand-primary/20 hover:opacity-90 active:scale-[0.98] transition-all"
              >
                Upgrade to Pro
              </button>
              <p className="text-center text-xs text-slate-400 font-medium">
                Starting at just $12/month. Cancel anytime.
              </p>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

export default UpgradeModal;
