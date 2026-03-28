
import React, { useState } from 'react';
import { Brain, Sparkles, Copy, RotateCcw, FileText, Lightbulb, AlertTriangle, HelpCircle, CheckCircle, ArrowRight, ChevronDown, Lock } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { AudioToTextRecord, AuthStatus, UserProfile, DecisionIntelligenceResult } from '../types';
import { analyzeDecisionIntelligence } from '../services/geminiService';
import { db, collection, addDoc, serverTimestamp, OperationType, handleFirestoreError, doc, updateDoc, increment } from '../firebase';
import { PLAN_FEATURES } from '../config/planConfig';
import UpgradeModal from './UpgradeModal';

interface DecisionIntelligenceProps {
  audioHistory: AudioToTextRecord[];
  authStatus: AuthStatus;
  userProfile?: UserProfile;
  addNotification: (notif: any) => void;
  initialInput?: { text: string; type: 'transcript' | 'summary' };
}

const DecisionIntelligence: React.FC<DecisionIntelligenceProps> = ({
  audioHistory,
  authStatus,
  userProfile,
  addNotification,
  initialInput
}) => {
  const [inputType, setInputType] = useState<'transcript' | 'summary'>(initialInput?.type || 'transcript');
  const [inputText, setInputText] = useState(initialInput?.text || '');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<DecisionIntelligenceResult | null>(null);
  const [showTranscriptPicker, setShowTranscriptPicker] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  const handleAnalyze = async () => {
    if (!inputText.trim() || !userProfile) return;

    // Check plan limits
    const planFeatures = PLAN_FEATURES[userProfile.plan];
    if (planFeatures.thinkingLimit !== 'unlimited' && userProfile.thinkingUsageCount >= planFeatures.thinkingLimit) {
      setShowUpgradeModal(true);
      return;
    }
    
    setIsAnalyzing(true);
    try {
      const data = await analyzeDecisionIntelligence(inputText, inputType);
      setResult(data);

      // Save to Decision History
      const title = inputText.split(/\s+/).slice(0, 10).join(' ') + (inputText.split(/\s+/).length > 10 ? '...' : '');
      
      try {
        // Atomic update of usage count and save history
        await Promise.all([
          addDoc(collection(db, 'decisionHistory'), {
            userId: userProfile.uid,
            title,
            inputType,
            inputText,
            output: data,
            createdAt: serverTimestamp()
          }),
          updateDoc(doc(db, 'users', userProfile.uid), {
            thinkingUsageCount: increment(1)
          })
        ]);
      } catch (saveError) {
        handleFirestoreError(saveError, OperationType.WRITE, 'decisionHistory/users');
      }

      addNotification({
        title: 'Analysis Complete',
        message: 'Decision Intelligence has processed your thinking and saved to history.',
        type: 'success'
      });
    } catch (error) {
      console.error('Analysis failed:', error);
      addNotification({
        title: 'Analysis Failed',
        message: 'There was an error processing your request. Please try again.',
        type: 'error'
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    addNotification({
      title: 'Copied',
      message: 'Content copied to clipboard.',
      type: 'success'
    });
  };

  const handleUseTranscript = (transcript: string) => {
    setInputText(transcript);
    setShowTranscriptPicker(false);
  };

  return (
    <div className="max-w-5xl mx-auto py-8 px-6 space-y-10 animate-in fade-in duration-500 pb-40">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-brand-primary/10 rounded-lg flex items-center justify-center text-brand-primary">
            <Brain size={24} />
          </div>
          <h1 className="text-3xl font-bold text-brand-primary tracking-tight">Decision Intelligence</h1>
        </div>
        <p className="text-slate-500 text-lg">
          Transform conversations and ideas into structured, actionable decisions.
        </p>
      </div>

      {/* Input Section */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-6 space-y-6">
          {/* Toggle */}
          <div className="flex items-center justify-between">
            <div className="flex bg-slate-100 p-1 rounded-xl">
              <button
                onClick={() => setInputType('transcript')}
                className={`px-6 py-2 rounded-lg text-sm font-semibold transition-all ${
                  inputType === 'transcript'
                    ? 'bg-white text-brand-primary shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                Transcript
              </button>
              <button
                onClick={() => setInputType('summary')}
                className={`px-6 py-2 rounded-lg text-sm font-semibold transition-all ${
                  inputType === 'summary'
                    ? 'bg-white text-brand-primary shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                Summary / Idea
              </button>
            </div>

            {inputType === 'transcript' && (
              <div className="relative">
                <button
                  onClick={() => setShowTranscriptPicker(!showTranscriptPicker)}
                  className="flex items-center space-x-2 text-brand-primary text-sm font-bold hover:underline"
                >
                  <FileText size={16} />
                  <span>Use from Transcript</span>
                  <ChevronDown size={14} className={`transition-transform ${showTranscriptPicker ? 'rotate-180' : ''}`} />
                </button>
                
                <AnimatePresence>
                  {showTranscriptPicker && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 10 }}
                      className="absolute right-0 mt-2 w-72 bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden"
                    >
                      <div className="p-2 space-y-1 max-h-60 overflow-y-auto custom-scrollbar">
                        {audioHistory.length === 0 ? (
                          <p className="text-slate-400 text-xs italic text-center py-4">No transcripts found.</p>
                        ) : (
                          audioHistory.filter(h => !h.deletedAt).map(record => (
                            <button
                              key={record.id}
                              onClick={() => handleUseTranscript(record.transcript.map(s => `${record.speakerMap[s.speaker] || s.speaker}: ${s.text}`).join('\n'))}
                              className="w-full text-left p-3 rounded-lg hover:bg-slate-50 transition-all group"
                            >
                              <div className="flex flex-col">
                                <span className="text-xs font-bold text-slate-700 group-hover:text-brand-primary truncate">{record.fileName}</span>
                                <span className="text-[9px] text-slate-400 uppercase font-bold tracking-widest">{new Date(record.date).toLocaleDateString()}</span>
                              </div>
                            </button>
                          ))
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </div>

          {/* Textarea */}
          <div className="relative">
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder={
                inputType === 'transcript'
                  ? "Paste your meeting transcript here..."
                  : "Describe your idea, decision, or situation..."
              }
              className="w-full h-64 bg-slate-50 border border-slate-200 rounded-xl p-6 text-slate-700 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-brand-primary/20 transition-all resize-none font-medium"
            />
          </div>

          {/* Action Button */}
          <div className="flex justify-end">
            <button
              onClick={handleAnalyze}
              disabled={isAnalyzing || !inputText.trim()}
              className={`flex items-center space-x-3 px-10 py-4 rounded-xl font-bold tracking-widest text-sm uppercase transition-all shadow-xl active:scale-95 ${
                isAnalyzing || !inputText.trim()
                  ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                  : 'bg-brand-primary text-white hover:opacity-90'
              }`}
            >
              {isAnalyzing ? (
                <>
                  <RotateCcw size={18} className="animate-spin" />
                  <span>Analyzing Thinking...</span>
                </>
              ) : (
                <>
                  <Sparkles size={18} />
                  <span>Analyze Thinking</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Output Section */}
      <AnimatePresence>
        {result && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-8"
          >
            <div className="flex items-center justify-between border-b border-slate-200 pb-4">
              <h2 className="text-2xl font-bold text-brand-primary">Analysis Results</h2>
              <button
                onClick={handleAnalyze}
                className="flex items-center space-x-2 text-slate-500 hover:text-brand-primary text-sm font-bold transition-colors"
              >
                <RotateCcw size={16} />
                <span>Regenerate</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Key Decisions */}
              <ResultCard
                title="Key Decisions"
                icon={<CheckCircle size={20} className="text-emerald-500" />}
                items={result.keyDecisions}
                onCopy={() => copyToClipboard(result.keyDecisions.join('\n'))}
              />

              {/* Next Actions */}
              <ResultCard
                title="Next Actions"
                icon={<ArrowRight size={20} className="text-brand-primary" />}
                items={result.nextActions}
                onCopy={() => copyToClipboard(result.nextActions.join('\n'))}
              />

              {/* Risks & Gaps */}
              <ResultCard
                title="Risks & Gaps"
                icon={<AlertTriangle size={20} className="text-amber-500" />}
                items={result.risksAndGaps}
                onCopy={() => copyToClipboard(result.risksAndGaps.join('\n'))}
              />

              {/* Assumptions */}
              <ResultCard
                title="Assumptions"
                icon={<Lightbulb size={20} className="text-blue-500" />}
                items={result.assumptions}
                onCopy={() => copyToClipboard(result.assumptions.join('\n'))}
              />

              {/* Alternative Perspectives */}
              <ResultCard
                title="Alternative Perspectives"
                icon={<Sparkles size={20} className="text-purple-500" />}
                items={result.alternativePerspectives}
                onCopy={() => copyToClipboard(result.alternativePerspectives.join('\n'))}
              />

              {/* Ignored Questions */}
              <ResultCard
                title="Ignored Questions"
                icon={<HelpCircle size={20} className="text-slate-500" />}
                items={result.ignoredQuestions}
                onCopy={() => copyToClipboard(result.ignoredQuestions.join('\n'))}
              />
            </div>

            {/* Decision Clarity */}
            <div className="bg-brand-primary/5 border border-brand-primary/10 rounded-2xl p-8 space-y-4">
              <div className="flex items-center space-x-3">
                <Brain size={24} className="text-brand-primary" />
                <h3 className="text-xl font-bold text-brand-primary">Decision Clarity Assessment</h3>
              </div>
              <p className="text-slate-700 text-lg leading-relaxed font-medium italic">
                "{result.decisionClarity}"
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <UpgradeModal 
        isOpen={showUpgradeModal}
        onClose={() => setShowUpgradeModal(false)}
        reason="You have reached your Thinking Engine limit for this month."
      />
    </div>
  );
};

interface ResultCardProps {
  title: string;
  icon: React.ReactNode;
  items: string[];
  onCopy: () => void;
}

const ResultCard: React.FC<ResultCardProps> = ({ title, icon, items, onCopy }) => {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4 flex flex-col h-full">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          {icon}
          <h3 className="text-lg font-bold text-slate-800">{title}</h3>
        </div>
        <button
          onClick={onCopy}
          className="text-slate-400 hover:text-brand-primary transition-colors p-2 hover:bg-slate-50 rounded-lg"
          title="Copy to clipboard"
        >
          <Copy size={16} />
        </button>
      </div>
      <ul className="space-y-3 flex-1">
        {items.map((item, idx) => (
          <li key={idx} className="flex items-start space-x-3 text-slate-600 text-sm font-medium leading-relaxed">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-300 mt-2 flex-shrink-0" />
            <span>{item}</span>
          </li>
        ))}
        {items.length === 0 && (
          <li className="text-slate-400 text-sm italic">No specific items identified.</li>
        )}
      </ul>
    </div>
  );
};

export default DecisionIntelligence;
