import React, { useState, useEffect } from 'react';
import { 
  Video, 
  Calendar, 
  Clock, 
  Users, 
  Link2, 
  Unlink, 
  RefreshCw, 
  FileAudio, 
  FileText, 
  Search, 
  AlertCircle, 
  CheckCircle2, 
  ExternalLink,
  ChevronRight,
  ShieldAlert,
  Play,
  Sparkles,
  Scissors
} from 'lucide-react';
import { 
  Project, 
  UserProfile, 
  CollaborationRole,
  UnassociatedMeetingItem
} from '../types';
import { AudioTrimmerModal } from './AudioTrimmerModal';
import { toast } from 'sonner';
import { useDemoWorkspace, isDemoIdentifier } from '../lib/demoStateManager';
import {
  getProjectMeetings,
  getUnassociatedMeetings,
  associateMeeting
} from '../lib/apiClient';

interface ProjectMeetingsViewProps {
  project: Project;
  userProfile?: UserProfile;
  userRole: CollaborationRole;
  onSelectMeetingForReview?: (meeting: UnassociatedMeetingItem) => void;
}

export const ProjectMeetingsView: React.FC<ProjectMeetingsViewProps> = ({
  project,
  userProfile,
  userRole,
  onSelectMeetingForReview
}) => {
  const [meetings, setMeetings] = useState<UnassociatedMeetingItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  
  // Unassociated meetings modal state
  const [isAssociateModalOpen, setIsAssociateModalOpen] = useState<boolean>(false);
  const [unassociatedMeetings, setUnassociatedMeetings] = useState<UnassociatedMeetingItem[]>([]);
  const [loadingUnassociated, setLoadingUnassociated] = useState<boolean>(false);
  const [modalSearch, setModalSearch] = useState<string>('');
  const [associatingId, setAssociatingId] = useState<string | null>(null);
  const [disassociatingId, setDisassociatingId] = useState<string | null>(null);

  // Audio Trimmer Modal State
  const [trimmerMeeting, setTrimmerMeeting] = useState<UnassociatedMeetingItem | null>(null);

  const canManage = userRole === 'owner' || userRole === 'admin';

  const demoContext = useDemoWorkspace();
  const isDemoProject = Boolean(
    (demoContext?.isDemoMode && (!project?.id || isDemoIdentifier(project?.id) || project?.id === 'demo-proj-migration' || project?.name === 'Enterprise API Migration')) ||
    isDemoIdentifier(project?.id)
  );

  // Fetch meetings associated with active project
  const fetchProjectMeetings = async () => {
    if (!project?.id) return;
    if (isDemoProject) {
      setMeetings(demoContext?.demoMeetings || []);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await getProjectMeetings(project.id);
      if (res.ok && res.data) {
        setMeetings(res.data.meetings || []);
      } else {
        toast.error(res.error || 'Failed to load project meetings');
      }
    } catch (err: any) {
      console.error('Error fetching project meetings:', err);
      const errMsg = err?.safeMessage || err?.message || 'Failed to load project meetings';
      toast.error(errMsg);
    } finally {
      setLoading(false);
    }
  };

  // Fetch unassociated meetings for current user/organization
  const fetchUnassociatedMeetings = async () => {
    if (isDemoProject) {
      setUnassociatedMeetings([]);
      setLoadingUnassociated(false);
      return;
    }
    setLoadingUnassociated(true);
    try {
      const res = await getUnassociatedMeetings();
      if (res.ok && res.data) {
        setUnassociatedMeetings(res.data.meetings || []);
      } else {
        toast.error(res.error || 'Failed to load unassociated meetings');
      }
    } catch (err: any) {
      console.error('Error fetching unassociated meetings:', err);
      const errMsg = err?.safeMessage || err?.message || 'Failed to load unassociated meetings';
      toast.error(errMsg);
    } finally {
      setLoadingUnassociated(false);
    }
  };

  useEffect(() => {
    if (isDemoProject) {
      setMeetings(demoContext?.demoMeetings || []);
      setLoading(false);
    } else {
      fetchProjectMeetings();
    }
  }, [project.id, isDemoProject, demoContext?.demoMeetings]);

  const handleOpenAssociateModal = () => {
    if (isDemoProject) {
      toast.info('Meeting association is pre-configured in demo mode.');
      return;
    }
    setIsAssociateModalOpen(true);
    fetchUnassociatedMeetings();
  };

  const handleAssociateMeeting = async (sessionId: string) => {
    if (isDemoProject) {
      toast.info('Sample meeting is already associated with this demo project.');
      return;
    }
    if (associatingId) return; // Prevent double click / concurrent request
    setAssociatingId(sessionId);
    try {
      const res = await associateMeeting(sessionId, project.id);
      if (res.ok && res.data?.success) {
        toast.success(res.data.message || 'Meeting successfully associated with project');
        // Update local lists
        setUnassociatedMeetings(prev => prev.filter(m => m.id !== sessionId));
        fetchProjectMeetings();
      } else {
        toast.error(res.error || res.data?.message || 'Failed to associate meeting with project');
      }
    } catch (err: any) {
      console.error('Error associating meeting:', err);
      const errMsg = err?.safeMessage || err?.message || 'Failed to associate meeting';
      toast.error(errMsg);
    } finally {
      setAssociatingId(null);
    }
  };

  const handleDisassociateMeeting = async (sessionId: string, meetingTitle: string) => {
    if (isDemoProject) {
      toast.info('Meeting disassociation is disabled in demo mode to maintain tour integrity.');
      return;
    }
    if (disassociatingId) return;
    if (!confirm(`Are you sure you want to remove the association for "${meetingTitle}"? The meeting will remain preserved as an unassociated session.`)) {
      return;
    }

    setDisassociatingId(sessionId);
    try {
      const res = await associateMeeting(sessionId, null);
      if (res.ok && res.data?.success) {
        toast.success(res.data.message || 'Meeting association removed');
        setMeetings(prev => prev.filter(m => m.id !== sessionId));
      } else {
        toast.error(res.error || res.data?.message || 'Failed to remove meeting association');
      }
    } catch (err: any) {
      console.error('Error disassociating meeting:', err);
      const errMsg = err?.safeMessage || err?.message || 'Failed to remove meeting association';
      toast.error(errMsg);
    } finally {
      setDisassociatingId(null);
    }
  };

  const filteredMeetings = meetings.filter(m => {
    const q = searchQuery.toLowerCase();
    return (
      m.title.toLowerCase().includes(q) ||
      m.externalMeetingId.toLowerCase().includes(q) ||
      (m.meetingInstanceUuid && m.meetingInstanceUuid.toLowerCase().includes(q)) ||
      (m.participants && m.participants.some(p => p.name?.toLowerCase().includes(q) || p.email?.toLowerCase().includes(q)))
    );
  });

  const filteredUnassociated = unassociatedMeetings.filter(m => {
    const q = modalSearch.toLowerCase();
    return (
      m.title.toLowerCase().includes(q) ||
      m.externalMeetingId.toLowerCase().includes(q) ||
      (m.meetingInstanceUuid && m.meetingInstanceUuid.toLowerCase().includes(q)) ||
      (m.participants && m.participants.some(p => p.name?.toLowerCase().includes(q) || p.email?.toLowerCase().includes(q)))
    );
  });

  const formatDuration = (seconds?: number | null) => {
    if (!seconds) return '—';
    const mins = Math.round(seconds / 60);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `${hrs}h ${remMins}m`;
  };

  const formatDateTime = (isoString?: string | null) => {
    if (!isoString) return '—';
    try {
      const date = new Date(isoString);
      return date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return isoString;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Video className="w-5 h-5 text-indigo-600" />
            <h2 className="text-lg font-black text-slate-900 uppercase tracking-tight">
              Project Meetings & Provenance
            </h2>
          </div>
          <p className="text-xs text-slate-500">
            View imported meeting sessions, cloud recordings, AI transcripts, and immutable provenance manifests linked to {project.name}.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchProjectMeetings}
            disabled={loading}
            className="p-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-600 transition-colors"
            title="Refresh Meetings"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>

          {canManage && (
            <button
              onClick={handleOpenAssociateModal}
              className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black uppercase tracking-wider transition-all shadow-sm flex items-center gap-2"
            >
              <Link2 className="w-4 h-4" />
              <span>Associate Imported Meeting</span>
            </button>
          )}
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search meetings by topic, meeting ID, UUID, or participant..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 text-xs rounded-xl border border-slate-200 bg-slate-50 focus:outline-none focus:border-indigo-600 font-medium"
          />
        </div>
        <div className="text-xs font-bold text-slate-500">
          Showing {filteredMeetings.length} of {meetings.length} meetings
        </div>
      </div>

      {/* Meetings List / Cards */}
      {loading ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center shadow-sm">
          <RefreshCw className="w-8 h-8 text-indigo-500 animate-spin mx-auto mb-3" />
          <p className="text-sm font-bold text-slate-700">Loading project meetings...</p>
        </div>
      ) : filteredMeetings.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center shadow-sm">
          <div className="w-12 h-12 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center mx-auto mb-4 text-indigo-600">
            <Video className="w-6 h-6" />
          </div>
          <h3 className="text-base font-extrabold text-slate-900 mb-1">
            {searchQuery ? 'No matching meetings found' : 'No meetings associated with this project yet'}
          </h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto mb-6">
            {searchQuery
              ? 'Try modifying your search term or clear the filter.'
              : 'Imported Zoom cloud recordings and webhooks can be associated with this project to provide centralized transcript intelligence.'}
          </p>
          {canManage && !searchQuery && (
            <button
              onClick={handleOpenAssociateModal}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black uppercase tracking-wider inline-flex items-center gap-2 transition-all shadow-sm"
            >
              <Link2 className="w-4 h-4" />
              <span>Associate an Imported Meeting</span>
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredMeetings.map((meeting, mIdx) => {
            const isKickoff = meeting.title.includes('API Migration Kickoff') || meeting.id.includes('kickoff') || meeting.recordingId?.includes('kickoff');
            return (
              <div
                key={meeting.id}
                data-tour={isKickoff ? "meeting-row-kickoff" : (mIdx === 0 ? "meeting-item-first" : undefined)}
                data-tour-meeting={isKickoff ? "kickoff-sync" : undefined}
                className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between"
              >
              <div>
                {/* Header row */}
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-100 text-[10px] font-black uppercase tracking-wider flex items-center gap-1">
                      <Video className="w-3 h-3" />
                      {meeting.provider}
                    </span>
                    <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-[10px] font-bold">
                      ID: {meeting.externalMeetingId}
                    </span>
                    {meeting.meetingInstanceUuid && (
                      <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-500 text-[10px] font-mono truncate max-w-[140px]" title={meeting.meetingInstanceUuid}>
                        UUID: {meeting.meetingInstanceUuid}
                      </span>
                    )}
                  </div>

                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                    meeting.status === 'completed'
                      ? 'bg-emerald-100 text-emerald-800'
                      : meeting.status === 'failed'
                      ? 'bg-rose-100 text-rose-800'
                      : 'bg-amber-100 text-amber-800'
                  }`}>
                    {meeting.status}
                  </span>
                </div>

                {/* Title */}
                <h3 
                  onClick={() => onSelectMeetingForReview && onSelectMeetingForReview(meeting)}
                  className={`text-sm font-extrabold text-slate-900 mb-2 line-clamp-1 ${onSelectMeetingForReview ? 'cursor-pointer hover:text-indigo-600 transition-colors' : ''}`}
                  title={onSelectMeetingForReview ? "Click to inspect transcript and smart recap" : undefined}
                >
                  {meeting.title}
                </h3>

                {/* Metadata items */}
                <div className="grid grid-cols-2 gap-2 text-xs text-slate-600 mb-4 bg-slate-50/70 rounded-xl p-3 border border-slate-100">
                  <div className="flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-slate-400" />
                    <span className="truncate">{formatDateTime(meeting.actualStartTime)}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    <span>{formatDuration(meeting.durationSeconds)}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-slate-400" />
                    <span>{meeting.participants?.length || 0} participant(s)</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <FileAudio className="w-3.5 h-3.5 text-slate-400" />
                    <span>{meeting.recordingId ? 'Recording Ready' : 'Audio Pending'}</span>
                  </div>
                </div>

                {/* Participants Preview */}
                {meeting.participants && meeting.participants.length > 0 && (
                  <div className="flex items-center gap-1.5 mb-4 text-[11px] text-slate-500 overflow-hidden">
                    <span className="font-bold text-slate-700">Host/Participants:</span>
                    <span className="truncate">
                      {meeting.participants.map(p => p.email || p.name).join(', ')}
                    </span>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {meeting.recordingId && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100">
                      <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                      Recording Linked
                    </span>
                  )}
                  {meeting.provenanceManifestId && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100" title={`Manifest: ${meeting.provenanceManifestId}`}>
                      Provenance Verified
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  {onSelectMeetingForReview && (
                    <button
                      onClick={() => onSelectMeetingForReview(meeting)}
                      className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center gap-1 transition-colors shadow-xs"
                      title="Inspect Transcript & AI Smart Recap"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                      <span>Review Recap</span>
                    </button>
                  )}
                  {meeting.recordingId && (
                    <button
                      onClick={() => setTrimmerMeeting(meeting)}
                      className="px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold flex items-center gap-1 transition-colors"
                      title="Trim and Edit Recording Audio"
                    >
                      <Scissors className="w-3.5 h-3.5" />
                      <span>Trim Audio</span>
                    </button>
                  )}
                  {canManage && (
                    <button
                      onClick={() => handleDisassociateMeeting(meeting.id, meeting.title)}
                      disabled={disassociatingId === meeting.id}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                      title="Remove Association from Project"
                    >
                      <Unlink className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        </div>
      )}

      {/* Audio Trimmer Modal */}
      {trimmerMeeting && trimmerMeeting.recordingId && (
        <AudioTrimmerModal
          isOpen={!!trimmerMeeting}
          onClose={() => setTrimmerMeeting(null)}
          recordingId={trimmerMeeting.recordingId}
          recordingTitle={trimmerMeeting.title}
          initialDuration={trimmerMeeting.durationSeconds || 0}
          projectId={project.id}
          getIdToken={() => userProfile?.getIdToken?.() || Promise.resolve(undefined)}
          onTrimSuccess={() => {
            fetchProjectMeetings();
          }}
        />
      )}

      {/* Associate Meeting Modal */}
      {isAssociateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Link2 className="w-5 h-5 text-indigo-600" />
                  <h3 className="text-base font-black text-slate-900 uppercase tracking-tight">
                    Associate Meeting with {project.name}
                  </h3>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Select an unassociated meeting imported via Zoom to link its recording, transcript, and provenance to this project.
                </p>
              </div>
              <button
                onClick={() => setIsAssociateModalOpen(false)}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
              >
                ✕
              </button>
            </div>

            {/* Modal Search Bar */}
            <div className="p-4 bg-slate-50 border-b border-slate-100">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Filter by meeting topic, ID, UUID, or email..."
                  value={modalSearch}
                  onChange={(e) => setModalSearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 text-xs rounded-xl border border-slate-200 bg-white focus:outline-none focus:border-indigo-600 font-medium"
                />
              </div>
            </div>

            {/* Modal Content / List */}
            <div className="flex-1 overflow-y-auto p-6 space-y-3">
              {loadingUnassociated ? (
                <div className="text-center py-12">
                  <RefreshCw className="w-8 h-8 text-indigo-500 animate-spin mx-auto mb-3" />
                  <p className="text-sm font-bold text-slate-700">Loading unassociated meetings...</p>
                </div>
              ) : filteredUnassociated.length === 0 ? (
                <div className="text-center py-12">
                  <AlertCircle className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                  <h4 className="text-sm font-bold text-slate-700 mb-1">
                    {modalSearch ? 'No matching unassociated meetings' : 'No unassociated meetings found'}
                  </h4>
                  <p className="text-xs text-slate-400 max-w-sm mx-auto">
                    All imported meetings in your organization are already associated with projects, or no imports have occurred yet.
                  </p>
                </div>
              ) : (
                filteredUnassociated.map((meeting) => (
                  <div
                    key={meeting.id}
                    className="p-4 rounded-2xl border border-slate-200 hover:border-indigo-200 hover:bg-indigo-50/20 transition-all flex items-center justify-between gap-4"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 text-[10px] font-black uppercase">
                          {meeting.provider}
                        </span>
                        <span className="text-[10px] font-mono text-slate-500">
                          ID: {meeting.externalMeetingId}
                        </span>
                        {meeting.meetingInstanceUuid && (
                          <span className="text-[10px] font-mono text-slate-400 truncate max-w-[120px]" title={meeting.meetingInstanceUuid}>
                            UUID: {meeting.meetingInstanceUuid}
                          </span>
                        )}
                      </div>

                      <h4 className="text-xs font-bold text-slate-900 truncate">
                        {meeting.title}
                      </h4>

                      <div className="flex items-center gap-3 text-[11px] text-slate-500 mt-1">
                        <span>{formatDateTime(meeting.actualStartTime)}</span>
                        <span>•</span>
                        <span>{formatDuration(meeting.durationSeconds)}</span>
                        {meeting.participants && meeting.participants.length > 0 && (
                          <>
                            <span>•</span>
                            <span className="truncate max-w-[150px]">
                              {meeting.participants[0]?.email || meeting.participants[0]?.name}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    <button
                      onClick={() => handleAssociateMeeting(meeting.id)}
                      disabled={associatingId === meeting.id}
                      className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-indigo-600 disabled:bg-slate-300 text-white text-xs font-bold transition-colors shrink-0 flex items-center gap-1.5"
                    >
                      {associatingId === meeting.id ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          <span>Associating...</span>
                        </>
                      ) : (
                        <>
                          <Link2 className="w-3.5 h-3.5" />
                          <span>Associate</span>
                        </>
                      )}
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
              <span className="text-xs text-slate-500">
                {unassociatedMeetings.length} total unassociated meeting(s) available
              </span>
              <button
                onClick={() => setIsAssociateModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-200 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
