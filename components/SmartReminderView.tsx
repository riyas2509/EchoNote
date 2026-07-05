
import React from 'react';
import { Calendar, Clock, AlertCircle, ExternalLink, CheckCircle2, BellRing } from 'lucide-react';
import { motion } from 'motion/react';
import { SmartReminderSystem, CalendarReminder } from '../types';

interface SmartReminderViewProps {
  reminders: SmartReminderSystem;
}

const SmartReminderView: React.FC<SmartReminderViewProps> = ({ reminders }) => {
  const formatGoogleCalendarUrl = (reminder: CalendarReminder) => {
    const { title, description, location, startTime, endTime } = reminder.calendarEventFormat;
    
    const formatDate = (dateStr: string) => {
      return dateStr.replace(/[-:]/g, '').split('.')[0] + 'Z';
    };

    const start = formatDate(startTime);
    const end = formatDate(endTime);

    const baseUrl = 'https://www.google.com/calendar/render?action=TEMPLATE';
    const params = new URLSearchParams({
      text: title,
      details: description,
      location: location || '',
      dates: `${start}/${end}`,
    });

    return `${baseUrl}&${params.toString()}`;
  };

  const groups = {
    'Immediate': reminders.reminders.filter(r => r.group === 'Immediate'),
    'Upcoming': reminders.reminders.filter(r => r.group === 'Upcoming'),
    'Long-term': reminders.reminders.filter(r => r.group === 'Long-term'),
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'High': return 'text-rose-500 bg-rose-50 border-rose-100';
      case 'Medium': return 'text-amber-500 bg-amber-50 border-amber-100';
      case 'Low': return 'text-emerald-500 bg-emerald-50 border-emerald-100';
      default: return 'text-slate-500 bg-slate-50 border-slate-100';
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between border-b border-slate-100 pb-4">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-brand-primary/10 rounded-xl flex items-center justify-center text-brand-primary">
            <BellRing size={20} />
          </div>
          <div>
            <h3 className="text-xl font-bold text-slate-800 tracking-tight">Smart Reminder System</h3>
            <p className="text-sm text-slate-500 font-medium">Actionable follow-ups synced with your schedule</p>
          </div>
        </div>
      </div>

      <div className="bg-brand-primary/5 border border-brand-primary/10 rounded-2xl p-6">
        <p className="text-slate-700 text-sm leading-relaxed font-medium">
          <span className="text-brand-primary font-bold mr-2">Strategy:</span>
          {reminders.summary}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {(['Immediate', 'Upcoming', 'Long-term'] as const).map((groupName) => (
          <div key={groupName} className="space-y-4">
            <div className="flex items-center space-x-2 px-2">
              <div className={`w-2 h-2 rounded-full ${
                groupName === 'Immediate' ? 'bg-rose-500' : 
                groupName === 'Upcoming' ? 'bg-amber-500' : 'bg-emerald-500'
              }`} />
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest">{groupName}</h4>
              <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-md font-bold">
                {groups[groupName].length}
              </span>
            </div>

            <div className="space-y-3">
              {groups[groupName].length === 0 ? (
                <div className="bg-slate-50/50 border border-dashed border-slate-200 rounded-xl p-6 text-center">
                  <p className="text-xs text-slate-400 italic">No {groupName.toLowerCase()} reminders.</p>
                </div>
              ) : (
                groups[groupName].map((reminder) => (
                  <motion.div
                    key={reminder.id}
                    whileHover={{ y: -2 }}
                    className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm hover:shadow-md transition-all group"
                  >
                    <div className="space-y-3">
                      <div className="flex items-start justify-between">
                        <div className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${getPriorityColor(reminder.priority)}`}>
                          {reminder.priority} Priority
                        </div>
                        <div className="text-slate-400 group-hover:text-brand-primary transition-colors">
                          <Clock size={14} />
                        </div>
                      </div>

                      <div>
                        <h5 className="text-sm font-bold text-slate-800 leading-snug group-hover:text-brand-primary transition-colors">
                          {reminder.title}
                        </h5>
                        <p className="text-xs text-slate-500 mt-1 line-clamp-2 leading-relaxed">
                          {reminder.description}
                        </p>
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-slate-50">
                        <div className="flex items-center space-x-1.5 text-slate-400">
                          <Calendar size={12} />
                          <span className="text-[10px] font-bold uppercase tracking-wider">
                            {new Date(reminder.suggestedDateTime).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                          </span>
                        </div>
                        
                        <a
                          href={formatGoogleCalendarUrl(reminder)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center space-x-1 text-brand-primary hover:text-brand-primary/80 text-[10px] font-bold uppercase tracking-widest transition-colors"
                        >
                          <span>Sync</span>
                          <ExternalLink size={10} />
                        </a>
                      </div>
                    </div>
                  </motion.div>
                ))
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default SmartReminderView;
