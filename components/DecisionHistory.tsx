
import React, { useState, useEffect, useMemo } from 'react';
import { 
  History, Search, Filter, Calendar, ChevronDown, ChevronUp, 
  Trash2, Copy, Play, Clock, FileText, Brain, AlertTriangle, 
  CheckCircle, Lightbulb, HelpCircle, ArrowRight, Sparkles, Lock
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { DecisionHistoryItem, UserProfile } from '../types';
import { db, collection, query, where, orderBy, limit, onSnapshot, deleteDoc, doc, OperationType, handleFirestoreError } from '../firebase';
import { PLAN_FEATURES } from '../config/planConfig';
import UpgradeModal from './UpgradeModal';

interface DecisionHistoryProps {
  userProfile: UserProfile;
  addNotification: (notif: any) => void;
  onReuse: (text: string, type: 'transcript' | 'summary') => void;
}

const DecisionHistory: React.FC<DecisionHistoryProps> = ({
  userProfile,
  addNotification,
  onReuse
}) => {
  const [history, setHistory] = useState<DecisionHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'transcript' | 'summary'>('all');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  const planFeatures = PLAN_FEATURES[userProfile.plan];

  useEffect(() => {
    if (!userProfile) return;

    const q = query(
      collection(db, 'decisionHistory'),
      where('userId', '==', userProfile.uid),
      orderBy('createdAt', sortOrder),
      limit(50)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const items: DecisionHistoryItem[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        items.push({
          id: doc.id,
          ...data,
          createdAt: data.createdAt?.toDate()?.toISOString() || new Date().toISOString()
        } as DecisionHistoryItem);
      });
      setHistory(items);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'decisionHistory');
      setLoading(false);
    });

    return () => unsubscribe();
  }, [userProfile, sortOrder]);

  const filteredHistory = useMemo(() => {
    const filtered = history.filter(item => {
      const matchesSearch = 
        item.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.inputText.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.output.keyDecisions.some(d => d.toLowerCase().includes(searchTerm.toLowerCase()));
      
      const matchesType = filterType === 'all' || item.inputType === filterType;
      
      return matchesSearch && matchesType;
    });

    // Apply plan limits
    if (planFeatures.decisionHistoryLimit !== 'unlimited') {
      return filtered.slice(0, planFeatures.decisionHistoryLimit);
    }
    return filtered;
  }, [history, searchTerm, filterType, planFeatures.decisionHistoryLimit]);

  const hasHiddenItems = history.length > (planFeatures.decisionHistoryLimit === 'unlimited' ? Infinity : planFeatures.decisionHistoryLimit);

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('Are you sure you want to delete this decision insight?')) return;

    try {
      await deleteDoc(doc(db, 'decisionHistory', id));
      addNotification({
        title: 'Deleted',
        message: 'Decision insight removed from history.',
        type: 'success'
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `decisionHistory/${id}`);
    }
  };

  const copyInsights = (item: DecisionHistoryItem, e: React.MouseEvent) => {
    e.stopPropagation();
    const text = `
Decision: ${item.title}
Key Decisions: ${item.output.keyDecisions.join('\n')}
Next Actions: ${item.output.nextActions.join('\n')}
Decision Clarity: ${item.output.decisionClarity}
    `.trim();
    
    navigator.clipboard.writeText(text);
    addNotification({
      title: 'Copied',
      message: 'Insights copied to clipboard.',
      type: 'success'
    });
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 space-y-4">
        <div className="w-12 h-12 border-4 border-brand-primary/20 border-t-brand-primary rounded-full animate-spin" />
        <p className="text-slate-400 font-medium">Loading decision history...</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto py-8 px-6 space-y-8 animate-in fade-in duration-500 pb-40">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-brand-primary/10 rounded-lg flex items-center justify-center text-brand-primary">
            <History size={24} />
          </div>
          <h1 className="text-3xl font-bold text-brand-primary tracking-tight">Decision History</h1>
        </div>
        <p className="text-slate-500 text-lg">
          Review past decisions and insights generated by the Thinking Engine.
        </p>
      </div>

      {/* Controls */}
      <div className="flex flex-col md:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            type="text"
            placeholder="Search by keywords, decisions, or content..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-12 pr-4 py-3 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-brand-primary/20 transition-all font-medium text-slate-700"
          />
        </div>
        
        <div className="flex gap-2">
          <div className="relative">
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as any)}
              className="appearance-none pl-10 pr-10 py-3 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-brand-primary/20 transition-all font-bold text-sm text-slate-600 cursor-pointer"
            >
              <option value="all">All Types</option>
              <option value="transcript">Transcripts</option>
              <option value="summary">Summaries</option>
            </select>
            <Filter className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={14} />
          </div>

          <button
            onClick={() => setSortOrder(prev => prev === 'desc' ? 'asc' : 'desc')}
            className="flex items-center space-x-2 px-4 py-3 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-all font-bold text-sm text-slate-600"
          >
            <Calendar size={16} className="text-slate-400" />
            <span>{sortOrder === 'desc' ? 'Recent First' : 'Oldest First'}</span>
          </button>
        </div>
      </div>

      {/* List */}
      <div className="space-y-4">
        {filteredHistory.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 border-dashed p-12 text-center space-y-4">
            <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto text-slate-300">
              <Brain size={32} />
            </div>
            <div className="space-y-1">
              <h3 className="text-lg font-bold text-slate-700">No decisions analyzed yet</h3>
              <p className="text-slate-400 text-sm max-w-xs mx-auto">
                Once you analyze a transcript or summary in the Thinking Engine, it will appear here.
              </p>
            </div>
          </div>
        ) : (
          filteredHistory.map((item) => (
            <div 
              key={item.id}
              className={`bg-white rounded-2xl border transition-all overflow-hidden ${
                expandedId === item.id ? 'border-brand-primary shadow-lg' : 'border-slate-200 hover:border-brand-primary/50 shadow-sm'
              }`}
            >
              {/* Card Header */}
              <div 
                onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                className="p-6 cursor-pointer flex items-start justify-between group"
              >
                <div className="space-y-3 flex-1">
                  <div className="flex items-center space-x-3">
                    <span className={`px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-widest ${
                      item.inputType === 'transcript' ? 'bg-indigo-50 text-indigo-600' : 'bg-amber-50 text-amber-600'
                    }`}>
                      {item.inputType}
                    </span>
                    <div className="flex items-center space-x-1.5 text-slate-400">
                      <Clock size={12} />
                      <span className="text-[11px] font-bold uppercase tracking-wider">
                        {new Date(item.createdAt).toLocaleDateString()} • {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                  
                  <h3 className="text-xl font-bold text-slate-800 group-hover:text-brand-primary transition-colors leading-tight">
                    {item.title}
                  </h3>
                  
                  <p className="text-slate-500 text-sm font-medium line-clamp-1">
                    {item.inputText}
                  </p>
                </div>

                <div className="flex items-center space-x-2 ml-4">
                  <button
                    onClick={(e) => copyInsights(item, e)}
                    className="p-2 text-slate-400 hover:text-brand-primary hover:bg-slate-50 rounded-lg transition-all"
                    title="Copy Insights"
                  >
                    <Copy size={18} />
                  </button>
                  <button
                    onClick={(e) => handleDelete(item.id, e)}
                    className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                    title="Delete"
                  >
                    <Trash2 size={18} />
                  </button>
                  <div className={`p-2 text-slate-300 transition-transform ${expandedId === item.id ? 'rotate-180' : ''}`}>
                    <ChevronDown size={20} />
                  </div>
                </div>
              </div>

              {/* Expanded Content */}
              <AnimatePresence>
                {expandedId === item.id && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="border-t border-slate-100 bg-slate-50/50"
                  >
                    <div className="p-8 space-y-8">
                      {/* Action Bar */}
                      <div className="flex justify-end space-x-3">
                        <button
                          onClick={() => onReuse(item.inputText, item.inputType)}
                          className="flex items-center space-x-2 px-4 py-2 bg-brand-primary text-white rounded-lg text-xs font-bold uppercase tracking-widest shadow-lg hover:opacity-90 active:scale-95 transition-all"
                        >
                          <Play size={14} />
                          <span>Reuse in Thinking Engine</span>
                        </button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <InsightSection 
                          title="Key Decisions" 
                          icon={<CheckCircle size={18} className="text-emerald-500" />}
                          items={item.output.keyDecisions}
                        />
                        <InsightSection 
                          title="Next Actions" 
                          icon={<ArrowRight size={18} className="text-brand-primary" />}
                          items={item.output.nextActions}
                        />
                        <InsightSection 
                          title="Risks & Gaps" 
                          icon={<AlertTriangle size={18} className="text-amber-500" />}
                          items={item.output.risksAndGaps}
                        />
                        <InsightSection 
                          title="Assumptions" 
                          icon={<Lightbulb size={18} className="text-blue-500" />}
                          items={item.output.assumptions}
                        />
                        <InsightSection 
                          title="Alternative Perspectives" 
                          icon={<Sparkles size={18} className="text-purple-500" />}
                          items={item.output.alternativePerspectives}
                        />
                        <InsightSection 
                          title="Ignored Questions" 
                          icon={<HelpCircle size={18} className="text-slate-500" />}
                          items={item.output.ignoredQuestions}
                        />
                      </div>

                      {/* Clarity */}
                      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
                        <div className="flex items-center space-x-2">
                          <Brain size={20} className="text-brand-primary" />
                          <h4 className="text-sm font-bold text-slate-800 uppercase tracking-widest">Decision Clarity</h4>
                        </div>
                        <p className="text-slate-600 text-sm font-medium italic leading-relaxed">
                          "{item.output.decisionClarity}"
                        </p>
                      </div>

                      {/* Original Input */}
                      <div className="space-y-3">
                        <div className="flex items-center space-x-2">
                          <FileText size={16} className="text-slate-400" />
                          <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Original Input</h4>
                        </div>
                        <div className="bg-white border border-slate-200 rounded-xl p-4 max-h-40 overflow-y-auto custom-scrollbar">
                          <p className="text-slate-500 text-xs font-medium whitespace-pre-wrap leading-relaxed">
                            {item.inputText}
                          </p>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))
        )}

        {hasHiddenItems && (
          <div className="bg-slate-50 rounded-2xl border border-slate-200 p-8 text-center space-y-4 border-dashed">
            <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center mx-auto text-slate-400 shadow-sm">
              <Lock size={20} />
            </div>
            <div className="space-y-1">
              <h3 className="text-lg font-bold text-slate-700">More history is hidden</h3>
              <p className="text-slate-400 text-sm max-w-xs mx-auto">
                Your current plan only shows the last {planFeatures.decisionHistoryLimit} insights. Upgrade to unlock your full history.
              </p>
            </div>
            <button
              onClick={() => setShowUpgradeModal(true)}
              className="px-6 py-2 bg-brand-primary text-white rounded-lg text-xs font-bold uppercase tracking-widest shadow-lg hover:opacity-90 transition-all"
            >
              Upgrade Now
            </button>
          </div>
        )}
      </div>

      <UpgradeModal 
        isOpen={showUpgradeModal}
        onClose={() => setShowUpgradeModal(false)}
        reason={`Your current plan only shows the last ${planFeatures.decisionHistoryLimit} insights. Upgrade to unlock your full history.`}
      />
    </div>
  );
};

interface InsightSectionProps {
  title: string;
  icon: React.ReactNode;
  items: string[];
}

const InsightSection: React.FC<InsightSectionProps> = ({ title, icon, items }) => (
  <div className="space-y-3">
    <div className="flex items-center space-x-2">
      {icon}
      <h4 className="text-xs font-bold text-slate-800 uppercase tracking-widest">{title}</h4>
    </div>
    <ul className="space-y-2">
      {items.map((text, i) => (
        <li key={i} className="flex items-start space-x-2 text-xs font-medium text-slate-600 leading-relaxed">
          <span className="w-1 h-1 rounded-full bg-slate-300 mt-1.5 flex-shrink-0" />
          <span>{text}</span>
        </li>
      ))}
      {items.length === 0 && (
        <li className="text-slate-400 text-xs italic">No items identified.</li>
      )}
    </ul>
  </div>
);

export default DecisionHistory;
