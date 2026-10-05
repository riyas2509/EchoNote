import { db } from '../firebase';
import { collection, doc, updateDoc, addDoc, serverTimestamp, arrayUnion } from 'firebase/firestore';
import { detectAndAssignTeamMentions } from './geminiService';
import { ProjectTask, ProjectMember, AutomatedTaggingDetection, AutomatedTaggingResult } from '../types';

export interface RunAutomatedTaggingOptions {
  transcript: any;
  projectId?: string;
  recordingId?: string;
  members: ProjectMember[];
  tasks: ProjectTask[];
  currentUser?: {
    uid?: string;
    email?: string;
    displayName?: string;
  };
  autoApply?: boolean;
  autoCreateTasks?: boolean;
}

export const runAutomatedTaggingService = async (
  options: RunAutomatedTaggingOptions
): Promise<AutomatedTaggingResult> => {
  const {
    transcript,
    projectId,
    recordingId,
    members,
    tasks,
    currentUser,
    autoApply = true,
    autoCreateTasks = false
  } = options;

  if (!transcript || (Array.isArray(transcript) && transcript.length === 0)) {
    throw new Error('No transcript provided to analyze for team member mentions.');
  }

  // Map known members for backend payload
  const teamMembersPayload = members.map(m => ({
    name: m.displayName || (m as any).name || m.email.split('@')[0],
    email: m.email.toLowerCase(),
    role: m.role || 'member',
    uid: m.uid || (m as any).userId || ''
  }));

  // Map existing tasks for backend payload
  const tasksPayload = tasks.map(t => ({
    id: t.id,
    title: t.title,
    description: t.description || '',
    assigneeEmail: (t.assigneeEmail || '').toLowerCase(),
    assigneeName: t.assigneeName || '',
    status: t.status,
    dueDate: t.dueDate || ''
  }));

  try {
    // 1. Call Gemini-powered backend service
    const apiResult = await detectAndAssignTeamMentions({
      transcript,
      recordingId,
      projectId,
      teamMembers: teamMembersPayload,
      tasks: tasksPayload,
      autoApply,
      autoCreateTasks
    });

    const detections: AutomatedTaggingDetection[] = apiResult.detections || [];
    let updatedTasksCount = apiResult.updatedTasksCount || 0;
    const updatedTaskIds = [...(apiResult.updatedTaskIds || [])];
    let createdTasksCount = apiResult.createdTasksCount || 0;
    const createdTaskIds = [...(apiResult.createdTaskIds || [])];

    // 2. Client-side fallback / reinforcement in case the backend was unable to write due to connection or offline state
    if (autoApply && updatedTasksCount === 0 && detections.length > 0 && db) {
      for (const det of detections) {
        if (det.taskId && !updatedTaskIds.includes(det.taskId)) {
          try {
            const taskDocRef = doc(db, 'tasks', det.taskId);
            const matchedMember = members.find(m => m.email.toLowerCase() === det.memberEmail.toLowerCase());

            const activityEntry = {
              id: Math.random().toString(36).substring(2, 9),
              action: 'automated_tagging',
              performedBy: 'EchoNote AI (Automated Tagging)',
              timestamp: new Date().toISOString(),
              details: `Auto-assigned to ${det.memberName} (${det.memberEmail}) from transcript mention. Quote: "${det.transcriptQuote}"`
            };

            const updatePayload: Record<string, any> = {
              assigneeEmail: det.memberEmail.toLowerCase(),
              assigneeName: det.memberName,
              assigneeId: matchedMember?.uid || det.memberUid || '',
              updatedAt: new Date().toISOString(),
              activityHistory: arrayUnion(activityEntry)
            };

            if (det.detectedDeadline) {
              updatePayload.dueDate = det.detectedDeadline;
            }

            await updateDoc(taskDocRef, updatePayload);
            updatedTaskIds.push(det.taskId);
            updatedTasksCount++;
            det.applied = true;

            // Add notification
            try {
              await addDoc(collection(db, 'notifications'), {
                userId: matchedMember?.uid || det.memberUid || '',
                userEmail: det.memberEmail.toLowerCase(),
                title: 'Task Assigned from Meeting',
                message: `EchoNote AI detected your mention in the transcript and assigned you "${det.taskTitle}". Quote: "${det.transcriptQuote}"`,
                projectId: projectId || '',
                taskId: det.taskId,
                type: 'info',
                isRead: false,
                createdAt: serverTimestamp()
              });
            } catch (err) {
              console.warn('[automatedTaggingService] Notification write error:', err);
            }
          } catch (err) {
            console.warn(`[automatedTaggingService] Client fallback update failed for ${det.taskId}:`, err);
          }
        }
      }
    }

    return {
      success: true,
      detections,
      updatedTasksCount,
      createdTasksCount,
      updatedTaskIds,
      createdTaskIds,
      message: apiResult.message || `Assigned ${updatedTasksCount} task(s) based on transcript mentions.`
    };
  } catch (err: any) {
    console.error('[automatedTaggingService] Error executing automated tagging:', err);
    throw err;
  }
};
