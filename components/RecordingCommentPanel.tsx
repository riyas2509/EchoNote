import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  MessageSquare, Send, Reply, Edit2, Trash2, X, Check, Clock, 
  AlertCircle, Play, Shield, RefreshCw, CornerDownRight 
} from 'lucide-react';
import { 
  Comment, Project, UserProfile, OrgRole, TargetProjectRole, 
  AuthStatus, PlaybackMetadata, normalizeProjectRole 
} from '../types';
import { 
  getRecordingComments, createRecordingComment, updateComment, deleteComment 
} from '../lib/apiClient';

export interface RecordingCommentPanelProps {
  recordingId: string;
  recordingTitle?: string;
  originalAudioUrl?: string;
  currentTime?: number;
  onSeek?: (seconds: number) => void;
  onPlay?: (metadata: PlaybackMetadata, startTime?: number, endTime?: number) => void;
  currentUserRole?: TargetProjectRole;
  userProfile?: UserProfile;
  project?: Project | null;
  userOrgRole?: OrgRole;
  authStatus?: AuthStatus;
  addNotification?: (notif: { title?: string; message: string; type: 'error' | 'success' | 'info' }) => void;
  onClose?: () => void;
  className?: string;
}

/**
 * Resolves the user's effective project role following the canonical security model:
 * 1. Explicit role override (if passed)
 * 2. Guest -> viewer
 * 3. Platform Admin / Org Owner -> owner
 * 4. Org Admin -> admin
 * 5. Project Owner -> owner
 * 6. Explicit Project Member role (normalized: editor->admin, commenter, viewer)
 * 7. Org Team Manager -> admin
 * 8. Fallback -> viewer (least privilege)
 */
export function determineEffectiveRole({
  currentUserRole,
  userProfile,
  project,
  userOrgRole,
  authStatus,
}: {
  currentUserRole?: TargetProjectRole;
  userProfile?: UserProfile;
  project?: Project | null;
  userOrgRole?: OrgRole;
  authStatus?: AuthStatus;
}): TargetProjectRole {
  if (currentUserRole) return currentUserRole;
  if (authStatus === AuthStatus.GUEST) return 'viewer';

  // Platform Admin
  if (userProfile?.role === 'admin' || (userProfile as any)?.isPlatformAdmin) {
    return 'owner';
  }

  // Organization Level Roles
  if (userOrgRole === 'owner') return 'owner';
  if (userOrgRole === 'org_admin') return 'admin';

  if (!userProfile?.email) return 'viewer';
  const userEmailLower = userProfile.email.toLowerCase();

  // Project Owner
  if (
    (project?.ownerEmail && project.ownerEmail.toLowerCase() === userEmailLower) ||
    (project?.userId && project.userId === userProfile.uid)
  ) {
    return 'owner';
  }

  // Project Member Mapping
  if (project?.members && Array.isArray(project.members)) {
    const member = project.members.find(
      m => (m.email && m.email.toLowerCase() === userEmailLower) ||
           (m.uid && m.uid === userProfile.uid) ||
           (m.userId && m.userId === userProfile.uid)
    );
    if (member) {
      return normalizeProjectRole(member.role);
    }
  }

  // Safe default: viewer (least privilege)
  return 'viewer';
}

/**
 * Converts a seconds count into a clean MM:SS or HH:MM:SS string.
 */
export function formatSecondsToTimestamp(totalSeconds?: number | null): string {
  if (totalSeconds === undefined || totalSeconds === null || isNaN(totalSeconds) || totalSeconds < 0) {
    return '00:00';
  }
  const s = Math.floor(totalSeconds);
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (hrs > 0) {
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Parses user input (e.g. "1:23" or "83" or "01:23") into seconds. Returns undefined if invalid.
 */
export function parseTimestampInput(input: string): number | undefined {
  const trimmed = input.trim();
  if (!trimmed) return undefined;

  // Single number case
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const val = parseFloat(trimmed);
    return isFinite(val) && val >= 0 ? Math.floor(val) : undefined;
  }

  // MM:SS or HH:MM:SS case
  const parts = trimmed.split(':').map(p => Number(p.trim()));
  if (parts.some(p => isNaN(p) || p < 0)) return undefined;

  if (parts.length === 2) {
    const [mins, secs] = parts;
    return mins * 60 + secs;
  }
  if (parts.length === 3) {
    const [hrs, mins, secs] = parts;
    return hrs * 3600 + mins * 60 + secs;
  }
  return undefined;
}

/**
 * Relative date formatter
 */
function formatRelativeTime(dateStr?: string): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  if (isNaN(diffMs)) return dateStr;
  
  const diffSecs = Math.floor(diffMs / 1000);
  if (diffSecs < 60) return 'Just now';
  const diffMins = Math.floor(diffSecs / 60);
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export const RecordingCommentPanel: React.FC<RecordingCommentPanelProps> = ({
  recordingId,
  recordingTitle = 'Recording',
  originalAudioUrl,
  currentTime,
  onSeek,
  onPlay,
  currentUserRole: explicitRole,
  userProfile,
  project,
  userOrgRole,
  authStatus,
  addNotification,
  onClose,
  className = '',
}) => {
  // 1. Role and Capability Resolution
  const effectiveRole = useMemo(() => {
    return determineEffectiveRole({
      currentUserRole: explicitRole,
      userProfile,
      project,
      userOrgRole,
      authStatus,
    });
  }, [explicitRole, userProfile, project, userOrgRole, authStatus]);

  const canComment = effectiveRole === 'owner' || effectiveRole === 'admin' || effectiveRole === 'commenter';
  const isModerator = effectiveRole === 'owner' || effectiveRole === 'admin';

  // 2. Component State
  const [comments, setComments] = useState<Comment[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Main Composer State
  const [content, setContent] = useState<string>('');
  const [includeTimestamp, setIncludeTimestamp] = useState<boolean>(false);
  const [manualTimestamp, setManualTimestamp] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Reply Composer State
  const [replyingToCommentId, setReplyingToCommentId] = useState<string | null>(null);
  const [replyContent, setReplyContent] = useState<string>('');
  const [isSubmittingReply, setIsSubmittingReply] = useState<boolean>(false);

  // Inline Edit State
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState<string>('');
  const [isSubmittingEdit, setIsSubmittingEdit] = useState<boolean>(false);

  // Deletion State
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  // Helper: map raw API error to safe, user-friendly copy
  const getSafeErrorMessage = (err: any): string => {
    const status = err?.status;
    if (status === 401) return 'Please sign in to view or post comments.';
    if (status === 403) return "You don't have permission to perform this action.";
    if (status === 404) return 'This recording or comment is no longer available.';
    if (status === 400) return err?.message || 'Invalid request. Please verify your comment and try again.';
    if (status === 500) return 'Something went wrong on the server. Please try again.';
    return err?.message || 'Unable to complete request. Please try again.';
  };

  // 3. Fetch Comments on Mount or Recording Change
  const fetchComments = useCallback(async () => {
    if (!recordingId) return;
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await getRecordingComments(recordingId);
      setComments(res?.comments || []);
    } catch (err: any) {
      const friendly = getSafeErrorMessage(err);
      setErrorMsg(friendly);
    } finally {
      setIsLoading(false);
    }
  }, [recordingId]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  // 4. Seek / Audio Jump Action
  const handleJumpToTimestamp = (timestampSeconds?: number) => {
    if (timestampSeconds === undefined || timestampSeconds === null || timestampSeconds < 0) return;

    if (onSeek) {
      onSeek(timestampSeconds);
      return;
    }

    if (onPlay && originalAudioUrl) {
      onPlay(
        { id: recordingId, title: recordingTitle, url: originalAudioUrl },
        timestampSeconds
      );
    }
  };

  // 5. Create Comment Handler
  const handleCreateComment = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = content.trim();
    if (!trimmed || trimmed.length > 5000 || isSubmitting) return;

    let timestampSeconds: number | undefined = undefined;
    if (includeTimestamp) {
      if (manualTimestamp.trim()) {
        timestampSeconds = parseTimestampInput(manualTimestamp);
      } else if (currentTime !== undefined && currentTime >= 0) {
        timestampSeconds = Math.floor(currentTime);
      }
    }

    setIsSubmitting(true);
    try {
      const res = await createRecordingComment(recordingId, {
        content: trimmed,
        timestampSeconds,
      });

      if (res?.comment) {
        setComments(prev => {
          // Check if already in list
          if (prev.some(c => c.id === res.comment.id)) return prev;
          return [...prev, res.comment];
        });
        setContent('');
        setIncludeTimestamp(false);
        setManualTimestamp('');
        if (addNotification) {
          addNotification({ title: 'Comment Posted', message: 'Your comment has been added.', type: 'success' });
        }
      } else {
        // Fallback: refresh
        await fetchComments();
      }
    } catch (err: any) {
      const friendly = getSafeErrorMessage(err);
      if (addNotification) {
        addNotification({ title: 'Error', message: friendly, type: 'error' });
      } else {
        alert(friendly);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // 6. Create Reply Handler
  const handleCreateReply = async (parentCommentId: string) => {
    const trimmed = replyContent.trim();
    if (!trimmed || trimmed.length > 5000 || isSubmittingReply) return;

    setIsSubmittingReply(true);
    try {
      const res = await createRecordingComment(recordingId, {
        content: trimmed,
        parentCommentId,
      });

      if (res?.comment) {
        setComments(prev => {
          if (prev.some(c => c.id === res.comment.id)) return prev;
          return [...prev, res.comment];
        });
        setReplyingToCommentId(null);
        setReplyContent('');
        if (addNotification) {
          addNotification({ title: 'Reply Posted', message: 'Your reply has been added.', type: 'success' });
        }
      } else {
        await fetchComments();
        setReplyingToCommentId(null);
        setReplyContent('');
      }
    } catch (err: any) {
      const friendly = getSafeErrorMessage(err);
      if (addNotification) {
        addNotification({ title: 'Error', message: friendly, type: 'error' });
      } else {
        alert(friendly);
      }
    } finally {
      setIsSubmittingReply(false);
    }
  };

  // 7. Update Comment Handler (Inline Edit)
  const handleSaveEdit = async (commentId: string) => {
    const trimmed = editContent.trim();
    if (!trimmed || trimmed.length > 5000 || isSubmittingEdit) return;

    setIsSubmittingEdit(true);
    try {
      const res = await updateComment(commentId, { content: trimmed });
      if (res?.comment) {
        setComments(prev => prev.map(c => (c.id === commentId ? { ...c, ...res.comment } : c)));
        setEditingCommentId(null);
        setEditContent('');
        if (addNotification) {
          addNotification({ title: 'Comment Updated', message: 'Your comment was updated.', type: 'success' });
        }
      }
    } catch (err: any) {
      const friendly = getSafeErrorMessage(err);
      if (addNotification) {
        addNotification({ title: 'Error', message: friendly, type: 'error' });
      } else {
        alert(friendly);
      }
    } finally {
      setIsSubmittingEdit(false);
    }
  };

  // 8. Delete Comment Handler
  const handleDeleteComment = async (commentId: string) => {
    if (isDeleting) return;
    setIsDeleting(true);
    try {
      await deleteComment(commentId);
      // Remove deleted comment and any orphaned child replies locally
      setComments(prev => prev.filter(c => c.id !== commentId && c.parentCommentId !== commentId));
      setConfirmDeleteId(null);
      if (addNotification) {
        addNotification({ title: 'Deleted', message: 'Comment was removed.', type: 'success' });
      }
    } catch (err: any) {
      const friendly = getSafeErrorMessage(err);
      if (addNotification) {
        addNotification({ title: 'Error', message: friendly, type: 'error' });
      } else {
        alert(friendly);
      }
    } finally {
      setIsDeleting(false);
    }
  };

  // 9. Threading Organization: Group root comments and child replies
  const { rootComments, repliesByParent } = useMemo(() => {
    const roots: Comment[] = [];
    const replies: Record<string, Comment[]> = {};

    // Grouping
    comments.forEach(c => {
      if (c.parentCommentId) {
        if (!replies[c.parentCommentId]) replies[c.parentCommentId] = [];
        replies[c.parentCommentId].push(c);
      } else {
        roots.push(c);
      }
    });

    // If any replies have missing parents, treat them as root
    const rootIds = new Set(roots.map(r => r.id));
    Object.keys(replies).forEach(parentId => {
      if (!rootIds.has(parentId)) {
        roots.push(...replies[parentId]);
        delete replies[parentId];
      }
    });

    return { rootComments: roots, repliesByParent: replies };
  }, [comments]);

  // Helper: Can user edit a specific comment?
  const canEditComment = (comment: Comment): boolean => {
    if (!canComment) return false;
    const isAuthor = userProfile?.uid === comment.userId || 
      (userProfile?.email && userProfile.email.toLowerCase() === comment.userEmail?.toLowerCase());
    return Boolean(isAuthor);
  };

  // Helper: Can user delete a specific comment?
  const canDeleteComment = (comment: Comment): boolean => {
    if (isModerator) return true;
    if (!canComment) return false;
    const isAuthor = userProfile?.uid === comment.userId || 
      (userProfile?.email && userProfile.email.toLowerCase() === comment.userEmail?.toLowerCase());
    return Boolean(isAuthor);
  };

  // Render a single comment item (used for both root and reply)
  const renderCommentItem = (comment: Comment, isReply = false) => {
    const isEditingThis = editingCommentId === comment.id;
    const isConfirmingDelete = confirmDeleteId === comment.id;
    const isAuthor = userProfile?.uid === comment.userId || 
      (userProfile?.email && userProfile.email.toLowerCase() === comment.userEmail?.toLowerCase());
    const isModeratorDeletion = !isAuthor && isModerator;
    const hasTimestamp = comment.timestampSeconds !== undefined && comment.timestampSeconds !== null && comment.timestampSeconds >= 0;
    const isReplying = replyingToCommentId === comment.id;

    return (
      <div 
        key={comment.id}
        data-testid={`comment-item-${comment.id}`}
        className={`group relative rounded-xl transition-all duration-200 ${
          isReply 
            ? 'bg-slate-50/80 border border-slate-200/60 p-3.5 mt-2.5' 
            : 'bg-white border border-slate-200/80 p-4 shadow-sm hover:border-slate-300'
        }`}
      >
        {/* Author Header */}
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2.5 min-w-0">
            {/* Avatar Initial */}
            <div className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs shrink-0 select-none ${
              isAuthor 
                ? 'bg-brand-primary text-white' 
                : isReply ? 'bg-slate-300 text-slate-700' : 'bg-brand-accent/20 text-brand-primary'
            }`}>
              {(comment.userName?.charAt(0) || comment.userEmail?.charAt(0) || 'U').toUpperCase()}
            </div>

            {/* Author Name and Badges */}
            <div className="flex items-center gap-1.5 flex-wrap text-left truncate">
              <span className="text-xs font-bold text-slate-800 truncate" title={comment.userName || comment.userEmail}>
                {comment.userName || comment.userEmail || 'Team Member'}
              </span>
              {isAuthor && (
                <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-brand-primary/10 text-brand-primary tracking-wide">
                  You
                </span>
              )}
              {comment.createdAt && (
                <span className="text-[11px] text-slate-400 font-medium">
                  • {formatRelativeTime(comment.createdAt)}
                </span>
              )}
              {comment.updatedAt && comment.updatedAt !== comment.createdAt && (
                <span className="text-[10px] text-slate-400 italic">
                  (edited)
                </span>
              )}
            </div>
          </div>

          {/* Timestamp Jump Badge if present */}
          {hasTimestamp && (
            <button
              onClick={() => handleJumpToTimestamp(comment.timestampSeconds)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-bold font-mono bg-indigo-50 text-indigo-700 hover:bg-indigo-100 hover:text-indigo-900 border border-indigo-200/60 transition-colors shrink-0 active:scale-95"
              title={`Jump audio to ${formatSecondsToTimestamp(comment.timestampSeconds)}`}
              aria-label={`Jump audio to ${formatSecondsToTimestamp(comment.timestampSeconds)}`}
              data-testid={`comment-timestamp-${comment.id}`}
            >
              <Play className="w-2.5 h-2.5 fill-current" />
              <span>{formatSecondsToTimestamp(comment.timestampSeconds)}</span>
            </button>
          )}
        </div>

        {/* Comment Content or Inline Editor */}
        {isEditingThis ? (
          <div className="mt-2 space-y-2 text-left" data-testid={`comment-edit-box-${comment.id}`}>
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              maxLength={5000}
              rows={3}
              className="w-full text-xs font-normal text-slate-800 bg-white border border-brand-primary/40 rounded-lg p-2.5 focus:ring-2 focus:ring-brand-primary/20 focus:outline-none resize-none"
              placeholder="Edit your comment..."
              autoFocus
            />
            <div className="flex items-center justify-between">
              <span className={`text-[10px] font-mono ${editContent.length > 4800 ? 'text-red-500 font-bold' : 'text-slate-400'}`}>
                {editContent.length}/5000
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => { setEditingCommentId(null); setEditContent(''); }}
                  disabled={isSubmittingEdit}
                  className="px-2.5 py-1 text-xs font-bold text-slate-600 hover:text-slate-800 rounded-md hover:bg-slate-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => handleSaveEdit(comment.id)}
                  disabled={!editContent.trim() || editContent.length > 5000 || isSubmittingEdit}
                  className="inline-flex items-center gap-1 px-3 py-1 text-xs font-bold text-white bg-brand-primary hover:bg-brand-primary/90 disabled:opacity-50 rounded-md transition-colors shadow-sm"
                  data-testid={`comment-save-edit-${comment.id}`}
                >
                  {isSubmittingEdit ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                  Save
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-xs text-slate-700 leading-relaxed text-left whitespace-pre-wrap break-words">
            {comment.content}
          </div>
        )}

        {/* Confirmation State for Deletion */}
        {isConfirmingDelete && (
          <div className="mt-3 p-2.5 rounded-lg bg-red-50 border border-red-200 text-left space-y-2 animate-in fade-in-50" data-testid={`comment-delete-confirm-${comment.id}`}>
            <p className="text-xs font-medium text-red-800">
              {isModeratorDeletion ? 'Moderate: Permanently delete this team member comment?' : 'Permanently delete your comment?'}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleDeleteComment(comment.id)}
                disabled={isDeleting}
                className="px-2.5 py-1 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors"
                data-testid={`comment-confirm-delete-btn-${comment.id}`}
              >
                {isDeleting ? 'Deleting...' : 'Yes, Delete'}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDeleteId(null)}
                disabled={isDeleting}
                className="px-2.5 py-1 text-xs font-bold text-slate-600 hover:text-slate-800 rounded-md hover:bg-red-100/50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Actions Bar: Reply, Edit, Delete */}
        {!isEditingThis && !isConfirmingDelete && (
          <div className="flex items-center justify-between gap-2 mt-3 pt-2 border-t border-slate-100 text-[11px]">
            {/* Reply action (allowed for commenter, admin, owner) */}
            <div>
              {canComment && !isReply && (
                <button
                  type="button"
                  onClick={() => {
                    setReplyingToCommentId(isReplying ? null : comment.id);
                    setReplyContent('');
                  }}
                  className="inline-flex items-center gap-1 text-slate-500 hover:text-brand-primary font-bold transition-colors"
                  aria-label="Reply to comment"
                  data-testid={`comment-reply-btn-${comment.id}`}
                >
                  <Reply className="w-3 h-3" />
                  <span>Reply</span>
                </button>
              )}
            </div>

            {/* Author / Moderation Actions */}
            <div className="flex items-center gap-2">
              {canEditComment(comment) && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingCommentId(comment.id);
                    setEditContent(comment.content);
                  }}
                  className="inline-flex items-center gap-1 text-slate-400 hover:text-slate-700 font-medium transition-colors"
                  title="Edit comment"
                  data-testid={`comment-edit-btn-${comment.id}`}
                >
                  <Edit2 className="w-3 h-3" />
                  <span>Edit</span>
                </button>
              )}

              {canDeleteComment(comment) && (
                <button
                  type="button"
                  onClick={() => setConfirmDeleteId(comment.id)}
                  className={`inline-flex items-center gap-1 font-medium transition-colors ${
                    isModeratorDeletion 
                      ? 'text-amber-600 hover:text-amber-800' 
                      : 'text-slate-400 hover:text-red-600'
                  }`}
                  title={isModeratorDeletion ? 'Moderate / Delete comment' : 'Delete comment'}
                  data-testid={`comment-delete-btn-${comment.id}`}
                >
                  <Trash2 className="w-3 h-3" />
                  <span>{isModeratorDeletion ? 'Moderate' : 'Delete'}</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Inline Reply Composer */}
        {isReplying && (
          <div className="mt-3 pt-3 border-t border-slate-200/60 text-left space-y-2" data-testid={`comment-reply-composer-${comment.id}`}>
            <div className="flex items-center gap-1 text-[11px] font-bold text-slate-500">
              <CornerDownRight className="w-3 h-3 text-brand-primary" />
              <span>Replying to {comment.userName || 'comment'}</span>
            </div>
            <textarea
              value={replyContent}
              onChange={(e) => setReplyContent(e.target.value)}
              maxLength={5000}
              rows={2}
              className="w-full text-xs font-normal text-slate-800 bg-white border border-slate-200 rounded-lg p-2.5 focus:ring-2 focus:ring-brand-primary/20 focus:outline-none resize-none"
              placeholder="Write your reply..."
              autoFocus
            />
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono text-slate-400">{replyContent.length}/5000</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => { setReplyingToCommentId(null); setReplyContent(''); }}
                  disabled={isSubmittingReply}
                  className="px-2.5 py-1 text-xs font-bold text-slate-600 hover:text-slate-800 rounded-md hover:bg-slate-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => handleCreateReply(comment.id)}
                  disabled={!replyContent.trim() || replyContent.length > 5000 || isSubmittingReply}
                  className="inline-flex items-center gap-1 px-3 py-1 text-xs font-bold text-white bg-brand-primary hover:bg-brand-primary/90 disabled:opacity-50 rounded-md transition-colors shadow-sm"
                  data-testid={`comment-submit-reply-${comment.id}`}
                >
                  {isSubmittingReply ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                  Reply
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Render Child Replies if any */}
        {!isReply && repliesByParent[comment.id] && repliesByParent[comment.id].length > 0 && (
          <div className="mt-3 pl-3 border-l-2 border-slate-200 space-y-2">
            {repliesByParent[comment.id].map(reply => renderCommentItem(reply, true))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div 
      className={`bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden flex flex-col ${className}`}
      data-testid="recording-comment-panel"
    >
      {/* Header */}
      <div className="px-5 py-4 bg-slate-50/70 border-b border-slate-200/80 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-brand-primary/10 text-brand-primary flex items-center justify-center">
            <MessageSquare className="w-4 h-4" />
          </div>
          <div className="text-left">
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-800">
                Comments & Discussion
              </h3>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-200/70 text-slate-700">
                {comments.length}
              </span>
            </div>
            <p className="text-[10px] text-slate-500 font-medium">
              Role: <span className="font-bold uppercase text-brand-primary">{effectiveRole}</span>
              {isModerator && ' (Moderator)'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={fetchComments}
            disabled={isLoading}
            className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
            title="Refresh comments"
            aria-label="Refresh comments"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
              title="Close panel"
              aria-label="Close comment panel"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="p-5 space-y-5 flex-1 overflow-y-auto max-h-[600px]">
        {/* Error Banner */}
        {errorMsg && (
          <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 flex items-start gap-2.5 text-left" data-testid="comments-error-banner">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-xs font-bold text-red-900">Unable to load comments</p>
              <p className="text-xs text-red-700 mt-0.5">{errorMsg}</p>
            </div>
            <button
              type="button"
              onClick={fetchComments}
              className="text-xs font-bold text-red-800 hover:underline shrink-0"
            >
              Retry
            </button>
          </div>
        )}

        {/* Loading Skeleton */}
        {isLoading && (
          <div className="space-y-3 py-4" data-testid="comments-loading-state">
            <div className="h-16 bg-slate-100 rounded-xl animate-pulse" />
            <div className="h-16 bg-slate-100 rounded-xl animate-pulse" />
          </div>
        )}

        {/* Empty State */}
        {!isLoading && !errorMsg && comments.length === 0 && (
          <div className="py-12 text-center space-y-2 text-slate-400" data-testid="comments-empty-state">
            <MessageSquare className="w-8 h-8 mx-auto stroke-1 text-slate-300" />
            <p className="text-xs font-bold text-slate-600">No comments on this recording yet</p>
            <p className="text-[11px] text-slate-400 max-w-xs mx-auto">
              {canComment 
                ? 'Be the first to leave feedback, tag a moment, or start a discussion.'
                : 'Comments will appear here once added by project team members.'}
            </p>
          </div>
        )}

        {/* Comments List */}
        {!isLoading && comments.length > 0 && (
          <div className="space-y-3" data-testid="comments-list">
            {rootComments.map(c => renderCommentItem(c, false))}
          </div>
        )}
      </div>

      {/* Footer / Composer Area */}
      <div className="p-4 bg-slate-50 border-t border-slate-200/80">
        {canComment ? (
          <form onSubmit={handleCreateComment} className="space-y-3 text-left" data-testid="comment-composer">
            <div className="relative">
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                maxLength={5000}
                rows={3}
                placeholder="Add a comment to this recording..."
                disabled={isSubmitting}
                className="w-full text-xs font-normal text-slate-800 bg-white border border-slate-200 rounded-xl p-3 focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary focus:outline-none resize-none transition-all shadow-inner"
                data-testid="comment-textarea"
              />
            </div>

            {/* Timestamp Toggle & Manual Input */}
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2">
                <label className="inline-flex items-center gap-1.5 cursor-pointer text-[11px] font-bold text-slate-600 select-none">
                  <input
                    type="checkbox"
                    checked={includeTimestamp}
                    onChange={(e) => {
                      setIncludeTimestamp(e.target.checked);
                      if (e.target.checked && currentTime !== undefined && currentTime >= 0) {
                        setManualTimestamp(formatSecondsToTimestamp(currentTime));
                      }
                    }}
                    className="w-3.5 h-3.5 rounded text-brand-primary focus:ring-brand-primary/20"
                    data-testid="comment-timestamp-checkbox"
                  />
                  <Clock className="w-3 h-3 text-slate-400" />
                  <span>Attach timestamp</span>
                </label>

                {includeTimestamp && (
                  <div className="flex items-center gap-1.5 animate-in fade-in-50">
                    <input
                      type="text"
                      value={manualTimestamp}
                      onChange={(e) => setManualTimestamp(e.target.value)}
                      placeholder="MM:SS"
                      className="w-16 px-2 py-1 text-xs font-mono font-bold bg-white border border-slate-200 rounded-md focus:ring-1 focus:ring-brand-primary focus:outline-none text-center"
                      title="Enter time in MM:SS format or seconds"
                      data-testid="comment-timestamp-input"
                    />
                    {currentTime !== undefined && currentTime >= 0 && (
                      <button
                        type="button"
                        onClick={() => setManualTimestamp(formatSecondsToTimestamp(currentTime))}
                        className="text-[10px] font-bold text-brand-primary hover:underline"
                        title="Use currently active playback position"
                      >
                        Use current ({formatSecondsToTimestamp(currentTime)})
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Submit Button & Character Counter */}
              <div className="flex items-center gap-3">
                <span className={`text-[10px] font-mono ${content.length > 4800 ? 'text-red-500 font-bold' : 'text-slate-400'}`}>
                  {content.length}/5000
                </span>
                <button
                  type="submit"
                  disabled={!content.trim() || content.length > 5000 || isSubmitting}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider text-white bg-brand-primary hover:bg-brand-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm active:scale-95"
                  data-testid="comment-submit-btn"
                >
                  {isSubmitting ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Posting...</span>
                    </>
                  ) : (
                    <>
                      <Send className="w-3.5 h-3.5" />
                      <span>Comment</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </form>
        ) : (
          /* Read-only / Viewer Notice */
          <div 
            className="p-3 bg-slate-100/80 rounded-xl border border-slate-200/80 text-center text-xs text-slate-500 flex items-center justify-center gap-2"
            data-testid="comment-viewer-notice"
          >
            <Shield className="w-3.5 h-3.5 text-slate-400" />
            <span>You have view-only access to this project. Commenting is disabled.</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default RecordingCommentPanel;
