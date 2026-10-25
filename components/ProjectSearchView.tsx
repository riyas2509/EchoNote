import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Search, 
  X, 
  Filter, 
  Calendar, 
  Clock, 
  Video, 
  FileText, 
  CheckSquare, 
  HelpCircle, 
  ChevronRight, 
  ArrowUpDown, 
  AlertCircle, 
  Loader2, 
  ExternalLink,
  Sparkles,
  Layers,
  History,
  Trash2,
  RotateCcw
} from 'lucide-react';
import { 
  Project, 
  UserProfile, 
  CollaborationRole, 
  ProjectSearchResultItem, 
  ProjectSearchResultType,
  ProjectSearchResponse,
  SearchHistoryEntry
} from '../types';
import { 
  searchProject, 
  getSearchHistory, 
  recordSearchHistory, 
  deleteSearchHistoryEntry, 
  clearSearchHistory 
} from '../lib/apiClient';
import { toast } from 'sonner';

interface ProjectSearchViewProps {
  project: Project;
  userProfile?: UserProfile;
  userRole: CollaborationRole;
  onNavigateToRecord?: (result: ProjectSearchResultItem) => void;
}

const TYPE_CONFIG: Record<ProjectSearchResultType, { label: string; icon: any; color: string; bg: string }> = {
  meeting: {
    label: 'Meeting',
    icon: Video,
    color: 'text-indigo-600',
    bg: 'bg-indigo-50 border-indigo-100 text-indigo-700'
  },
  transcript: {
    label: 'Transcript',
    icon: FileText,
    color: 'text-blue-600',
    bg: 'bg-blue-50 border-blue-100 text-blue-700'
  },
  decision: {
    label: 'Decision',
    icon: Sparkles,
    color: 'text-amber-600',
    bg: 'bg-amber-50 border-amber-100 text-amber-700'
  },
  task: {
    label: 'Task',
    icon: CheckSquare,
    color: 'text-emerald-600',
    bg: 'bg-emerald-50 border-emerald-100 text-emerald-700'
  },
  unresolved_topic: {
    label: 'Unresolved',
    icon: HelpCircle,
    color: 'text-rose-600',
    bg: 'bg-rose-50 border-rose-100 text-rose-700'
  }
};

export const ProjectSearchView: React.FC<ProjectSearchViewProps> = ({
  project,
  userProfile,
  userRole,
  onNavigateToRecord
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selectedTypes, setSelectedTypes] = useState<Set<ProjectSearchResultType>>(new Set());
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [searchResponse, setSearchResponse] = useState<ProjectSearchResponse | null>(null);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [selectedResult, setSelectedResult] = useState<ProjectSearchResultItem | null>(null);

  const [searchHistory, setSearchHistory] = useState<SearchHistoryEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // Active request controller ref to cancel in-flight queries
  const abortControllerRef = useRef<AbortController | null>(null);

  // Fetch private search history for the user within this project
  const fetchSearchHistory = useCallback(async () => {
    if (!userProfile) return;
    setLoadingHistory(true);
    try {
      const res = await getSearchHistory({ scope: 'project', projectId: project.id, limit: 10 });
      if (res.ok && res.data) {
        setSearchHistory(res.data.entries || []);
      }
    } catch (err) {
      console.error('Failed to fetch search history:', err);
    } finally {
      setLoadingHistory(false);
    }
  }, [project.id, userProfile]);

  useEffect(() => {
    fetchSearchHistory();
  }, [fetchSearchHistory]);

  // Record a submitted search
  const recordSubmittedSearch = useCallback(async (queryToRecord: string, types: Set<ProjectSearchResultType>, sDate: string, eDate: string) => {
    const q = queryToRecord.trim();
    if (!q || !userProfile) return;

    try {
      const res = await recordSearchHistory({
        query: q,
        scope: 'project',
        projectId: project.id,
        filters: {
          selectedTypes: Array.from(types),
          startDate: sDate || null,
          endDate: eDate || null
        }
      });

      if (res.ok) {
        fetchSearchHistory();
      }
    } catch (err) {
      console.warn('Failed to record search history:', err);
    }
  }, [project.id, userProfile, fetchSearchHistory]);

  // Debounce interactive typing (350ms)
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedQuery(searchTerm.trim());
      setPage(1); // Reset to page 1 on query modification
    }, 350);

    return () => clearTimeout(handler);
  }, [searchTerm]);

  const executeSearch = useCallback(async (targetPage = 1) => {
    if (!project?.id) return;

    // Abort previous in-flight search request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);

    try {
      const res = await searchProject(
        project.id,
        {
          q: debouncedQuery || undefined,
          type: selectedTypes.size > 0 ? Array.from(selectedTypes) : undefined,
          startDate: startDate || null,
          endDate: endDate || null,
          page: targetPage,
          limit: 20
        },
        controller.signal
      );

      if (res.ok && res.data) {
        setSearchResponse(res.data);
      } else {
        toast.error(res.error || 'Failed to execute project search');
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error('Project search error:', err);
        toast.error('Network error during project search');
      }
    } finally {
      if (abortControllerRef.current === controller) {
        setLoading(false);
      }
    }
  }, [project.id, debouncedQuery, selectedTypes, startDate, endDate]);

  useEffect(() => {
    executeSearch(page);
  }, [page, executeSearch]);

  // Explicit user submission (press Enter or click Search) records the search
  const handleSearchSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const q = searchTerm.trim();
    if (!q) return;
    setDebouncedQuery(q);
    setPage(1);
    recordSubmittedSearch(q, selectedTypes, startDate, endDate);
  };

  // Restore a previous search from history
  const handleRestoreSearch = (entry: SearchHistoryEntry) => {
    setSearchTerm(entry.query);
    setDebouncedQuery(entry.query);
    const restoredTypes = new Set<ProjectSearchResultType>(entry.filters?.selectedTypes || []);
    setSelectedTypes(restoredTypes);
    setStartDate(entry.filters?.startDate || '');
    setEndDate(entry.filters?.endDate || '');
    setPage(1);
    toast.success(`Restored search: "${entry.query}"`);
    // Re-record to bump lastUsedAt
    recordSubmittedSearch(entry.query, restoredTypes, entry.filters?.startDate || '', entry.filters?.endDate || '');
  };

  // Delete an individual search history entry
  const handleDeleteHistoryEntry = async (e: React.MouseEvent, entryId: string) => {
    e.stopPropagation();
    if (!userProfile) return;
    try {
      const res = await deleteSearchHistoryEntry(entryId);
      if (res.ok) {
        setSearchHistory(prev => prev.filter(item => item.id !== entryId));
        toast.success('Search history item removed');
      } else {
        toast.error(res.error || 'Failed to remove search history item');
      }
    } catch {
      toast.error('Error removing search history item');
    }
  };

  // Clear all search history for this project
  const handleClearHistory = async () => {
    if (!userProfile) return;
    try {
      const res = await clearSearchHistory({ scope: 'project', projectId: project.id });
      if (res.ok) {
        setSearchHistory([]);
        setShowClearConfirm(false);
        toast.success('Search history cleared');
      } else {
        toast.error(res.error || 'Failed to clear search history');
      }
    } catch {
      toast.error('Error clearing search history');
    }
  };

  const toggleTypeFilter = (type: ProjectSearchResultType) => {
    setSelectedTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
    setPage(1);
  };

  const clearAllFilters = () => {
    setSearchTerm('');
    setDebouncedQuery('');
    setSelectedTypes(new Set());
    setStartDate('');
    setEndDate('');
    setPage(1);
  };

  const formatDate = (dateStr?: string | null) => {
    if (!dateStr) return '—';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
    } catch {
      return dateStr;
    }
  };

  const formatTimestamp = (seconds?: number | null) => {
    if (seconds == null) return null;
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const totalResults = searchResponse?.totalMatches ?? 0;
  const counts = searchResponse?.countsByType ?? {
    meeting: 0,
    transcript: 0,
    decision: 0,
    task: 0,
    unresolved_topic: 0
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Search className="w-5 h-5 text-indigo-600" />
            <h2 className="text-lg font-black text-slate-900 uppercase tracking-tight">
              Project Search & Intelligence
            </h2>
          </div>
          <p className="text-xs text-slate-500">
            Search across all meeting recordings, transcripts, decisions, tasks, and discussions within {project.name}.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsFilterOpen(!isFilterOpen)}
            aria-expanded={isFilterOpen}
            aria-controls="project-search-filters-panel"
            className={`px-3.5 py-2 rounded-xl text-xs font-bold border transition-all flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
              isFilterOpen || selectedTypes.size > 0 || startDate || endDate
                ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            <Filter className="w-4 h-4" />
            <span>Filters</span>
            {(selectedTypes.size > 0 || startDate || endDate) && (
              <span className="w-2 h-2 rounded-full bg-indigo-600" />
            )}
          </button>
        </div>
      </div>

      {/* Main Search Bar & Quick Type Filters */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3">
        <form onSubmit={handleSearchSubmit} className="relative flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              aria-label="Search within project"
              placeholder="Search transcripts, decisions, tasks, or meeting topics in this project..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-10 py-2.5 text-sm rounded-xl border border-slate-200 bg-slate-50 focus:outline-none focus:border-indigo-600 font-medium"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600"
                aria-label="Clear query input"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <button
            type="submit"
            className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs shrink-0 flex items-center gap-1.5"
          >
            <Search className="w-3.5 h-3.5" />
            <span>Search</span>
          </button>
        </form>

        {/* Recent Searches (Phase 2 Step 2) */}
        {userProfile && (
          <div className="pt-2 border-t border-slate-100 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 font-bold text-slate-500 uppercase tracking-wider text-[11px]">
                <History className="w-3.5 h-3.5 text-indigo-500" />
                <span>Recent Searches</span>
              </div>
              {searchHistory.length > 0 && (
                <div>
                  {showClearConfirm ? (
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-rose-600 font-semibold">Clear all?</span>
                      <button
                        type="button"
                        onClick={handleClearHistory}
                        className="text-[11px] font-bold text-rose-700 hover:underline"
                      >
                        Yes, Clear
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowClearConfirm(false)}
                        className="text-[11px] font-bold text-slate-500 hover:underline"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowClearConfirm(true)}
                      className="text-[11px] font-semibold text-slate-400 hover:text-rose-600 transition-colors flex items-center gap-1"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>Clear History</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            {loadingHistory ? (
              <div className="flex items-center gap-2 text-xs text-slate-400 py-1">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>Loading recent searches...</span>
              </div>
            ) : searchHistory.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                {searchHistory.map((entry) => (
                  <div
                    key={entry.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleRestoreSearch(entry)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleRestoreSearch(entry);
                      }
                    }}
                    className="group inline-flex items-center gap-1.5 px-3 py-1 bg-slate-50 hover:bg-indigo-50 border border-slate-200 hover:border-indigo-200 rounded-lg text-xs font-semibold text-slate-700 hover:text-indigo-900 transition-all cursor-pointer shadow-2xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    title={`Restores query "${entry.query}" with filters`}
                    aria-label={`Restore recent search: ${entry.query}`}
                  >
                    <RotateCcw className="w-3 h-3 text-slate-400 group-hover:text-indigo-600 shrink-0" />
                    <span className="font-bold truncate max-w-[140px] sm:max-w-none">{entry.query}</span>
                    {entry.filters?.selectedTypes && entry.filters.selectedTypes.length > 0 && (
                      <span className="text-[10px] bg-slate-200/80 px-1 py-0.2 rounded text-slate-600 font-mono shrink-0">
                        {entry.filters.selectedTypes.length} types
                      </span>
                    )}
                    <span className="text-[10px] text-slate-400 font-normal shrink-0">
                      {(() => {
                        try {
                          const diff = Date.now() - new Date(entry.lastUsedAt).getTime();
                          const mins = Math.floor(diff / 60000);
                          if (mins < 1) return 'just now';
                          if (mins < 60) return `${mins}m ago`;
                          const hours = Math.floor(mins / 60);
                          if (hours < 24) return `${hours}h ago`;
                          return `${Math.floor(hours / 24)}d ago`;
                        } catch {
                          return '';
                        }
                      })()}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => handleDeleteHistoryEntry(e, entry.id)}
                      className="ml-1 text-slate-400 hover:text-rose-600 p-0.5 rounded transition-colors shrink-0 focus:outline-none focus:ring-1 focus:ring-rose-500"
                      title="Remove from history"
                      aria-label={`Remove ${entry.query} from history`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-slate-400 italic">
                No recent searches in this project. Submitting a search will save it here for fast rerun.
              </p>
            )}
          </div>
        )}

        {/* Quick Type Filter Pills */}
        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-100">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mr-1">
            Sources:
          </span>
          {(Object.keys(TYPE_CONFIG) as ProjectSearchResultType[]).map((type) => {
            const conf = TYPE_CONFIG[type];
            const isSelected = selectedTypes.has(type);
            const count = counts[type] || 0;
            const Icon = conf.icon;

            return (
              <button
                key={type}
                onClick={() => toggleTypeFilter(type)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 border ${
                  isSelected
                    ? conf.bg
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{conf.label}</span>
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                  isSelected ? 'bg-white/50' : 'bg-slate-200 text-slate-700'
                }`}>
                  {count}
                </span>
              </button>
            );
          })}

          {(selectedTypes.size > 0 || startDate || endDate || searchTerm) && (
            <button
              onClick={clearAllFilters}
              className="text-xs font-bold text-slate-400 hover:text-rose-600 ml-auto transition-colors"
            >
              Clear all
            </button>
          )}
        </div>

        {/* Expandable Advanced Date Filters */}
        {isFilterOpen && (
          <div 
            id="project-search-filters-panel"
            className="pt-3 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-50/50 p-3 rounded-xl"
          >
            <div>
              <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
                From Date
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  setPage(1);
                }}
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 bg-white focus:outline-none focus:border-indigo-600 font-medium"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
                To Date
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  setPage(1);
                }}
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 bg-white focus:outline-none focus:border-indigo-600 font-medium"
              />
            </div>
          </div>
        )}
      </div>

      {/* Results Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between text-xs text-slate-500 font-bold px-1">
          <span>
            {loading ? 'Searching...' : `Found ${totalResults} matching result${totalResults === 1 ? '' : 's'}`}
          </span>
          {searchResponse && searchResponse.results.length > 0 && (
            <span>
              Page {searchResponse.page} of {Math.max(1, Math.ceil(totalResults / searchResponse.pageSize))}
            </span>
          )}
        </div>

        {loading ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center shadow-sm">
            <Loader2 className="w-8 h-8 text-indigo-500 animate-spin mx-auto mb-3" />
            <p className="text-sm font-bold text-slate-700">Searching project knowledge...</p>
          </div>
        ) : totalResults === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center shadow-sm">
            <div className="w-12 h-12 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center mx-auto mb-4 text-indigo-600">
              <Search className="w-6 h-6" />
            </div>
            <h3 className="text-base font-extrabold text-slate-900 mb-1">
              {debouncedQuery ? `No results found for "${debouncedQuery}"` : 'No matching records in this project'}
            </h3>
            <p className="text-xs text-slate-500 max-w-md mx-auto mb-4">
              {debouncedQuery
                ? 'Try broadening your search term, checking for typos, or clearing the type filters.'
                : 'Project search crawls all imported meetings, transcript speeches, logged decisions, and tasks.'}
            </p>
            {(selectedTypes.size > 0 || startDate || endDate || searchTerm) && (
              <button
                onClick={clearAllFilters}
                className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-indigo-600 text-white text-xs font-bold transition-all shadow-sm"
              >
                Reset search filters
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {searchResponse?.results.map((result) => {
              const conf = TYPE_CONFIG[result.type] || TYPE_CONFIG.meeting;
              const Icon = conf.icon;
              const formattedTime = formatTimestamp(result.metadata.timestampSeconds);

              return (
                <div
                  key={result.id}
                  onClick={() => setSelectedResult(result)}
                  className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs hover:shadow-md hover:border-indigo-200 transition-all cursor-pointer flex flex-col justify-between group"
                >
                  <div>
                    {/* Header: Type Pill, Meeting Reference, Date */}
                    <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider border flex items-center gap-1 ${conf.bg}`}>
                          <Icon className="w-3 h-3" />
                          {conf.label}
                        </span>

                        {result.metadata.meetingTitle && (
                          <span className="text-[11px] font-bold text-slate-700 truncate max-w-xs flex items-center gap-1">
                            <span>in</span>
                            <span className="text-indigo-600">{result.metadata.meetingTitle}</span>
                          </span>
                        )}

                        {result.metadata.sourceType && (
                          <span className="text-[9px] font-black uppercase px-1.5 py-0.2 rounded bg-slate-100 text-slate-500">
                            {result.metadata.sourceType}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 text-[11px] text-slate-400 font-medium">
                        {formattedTime && (
                          <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-slate-600 text-[10px]">
                            {formattedTime}
                          </span>
                        )}
                        <span>{formatDate(result.date)}</span>
                      </div>
                    </div>

                    {/* Result Title */}
                    <h4 className="text-sm font-bold text-slate-900 group-hover:text-indigo-600 transition-colors mb-1.5">
                      {result.title}
                    </h4>

                    {/* Excerpt with highlight */}
                    <p className="text-xs text-slate-600 leading-relaxed font-normal bg-slate-50/60 p-2.5 rounded-xl border border-slate-100">
                      {result.excerpt}
                    </p>
                  </div>

                  {/* Metadata Footer */}
                  <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                    <div className="flex items-center gap-3">
                      {result.metadata.speaker && (
                        <span>Speaker: <strong className="text-slate-700">{result.metadata.speaker}</strong></span>
                      )}
                      {result.metadata.assignee && (
                        <span>Assignee: <strong className="text-slate-700">{result.metadata.assignee}</strong></span>
                      )}
                      {result.metadata.status && (
                        <span className="capitalize">Status: <strong className="text-slate-700">{result.metadata.status}</strong></span>
                      )}
                    </div>

                    <div className="flex items-center gap-1 text-indigo-600 font-bold group-hover:translate-x-0.5 transition-transform">
                      <span>View Source</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination Controls */}
        {searchResponse && searchResponse.totalMatches > searchResponse.pageSize && (
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex items-center justify-between">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
              className="px-3.5 py-1.5 text-xs font-bold rounded-xl border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Previous
            </button>
            <span className="text-xs font-bold text-slate-600">
              Page {page} of {Math.ceil(searchResponse.totalMatches / searchResponse.pageSize)}
            </span>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={!searchResponse.hasMore || loading}
              className="px-3.5 py-1.5 text-xs font-bold rounded-xl border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          </div>
        )}
      </div>

      {/* Detail Slide-over / Modal */}
      {selectedResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-lg w-full max-h-[80vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded-md text-[10px] font-black uppercase border ${TYPE_CONFIG[selectedResult.type]?.bg}`}>
                  {TYPE_CONFIG[selectedResult.type]?.label}
                </span>
                <h3 className="text-sm font-black text-slate-900 truncate max-w-xs">
                  {selectedResult.title}
                </h3>
              </div>
              <button
                onClick={() => setSelectedResult(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4">
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
                  Source Excerpt
                </label>
                <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-100 text-xs text-slate-700 leading-relaxed font-medium">
                  {selectedResult.excerpt}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs bg-slate-50 p-3 rounded-xl border border-slate-100">
                <div>
                  <span className="text-[10px] font-bold uppercase text-slate-400 block">Date</span>
                  <span className="font-bold text-slate-800">{formatDate(selectedResult.date)}</span>
                </div>
                {selectedResult.metadata.timestampSeconds != null && (
                  <div>
                    <span className="text-[10px] font-bold uppercase text-slate-400 block">Time in Audio</span>
                    <span className="font-bold text-slate-800">{formatTimestamp(selectedResult.metadata.timestampSeconds)}</span>
                  </div>
                )}
                {selectedResult.metadata.meetingTitle && (
                  <div className="col-span-2">
                    <span className="text-[10px] font-bold uppercase text-slate-400 block">Meeting</span>
                    <span className="font-bold text-slate-800">{selectedResult.metadata.meetingTitle}</span>
                  </div>
                )}
                {selectedResult.metadata.speaker && (
                  <div>
                    <span className="text-[10px] font-bold uppercase text-slate-400 block">Speaker</span>
                    <span className="font-bold text-slate-800">{selectedResult.metadata.speaker}</span>
                  </div>
                )}
                {selectedResult.metadata.assignee && (
                  <div>
                    <span className="text-[10px] font-bold uppercase text-slate-400 block">Assignee</span>
                    <span className="font-bold text-slate-800">{selectedResult.metadata.assignee}</span>
                  </div>
                )}
                {selectedResult.metadata.status && (
                  <div>
                    <span className="text-[10px] font-bold uppercase text-slate-400 block">Status</span>
                    <span className="font-bold text-slate-800 capitalize">{selectedResult.metadata.status}</span>
                  </div>
                )}
                {selectedResult.metadata.provenanceManifestId && (
                  <div className="col-span-2">
                    <span className="text-[10px] font-bold uppercase text-slate-400 block">Provenance Manifest</span>
                    <span className="font-mono text-[10px] text-slate-600 truncate block">
                      {selectedResult.metadata.provenanceManifestId}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-end">
              <button
                onClick={() => setSelectedResult(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-slate-900 hover:bg-slate-800 text-white transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
