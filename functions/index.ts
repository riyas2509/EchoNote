/**
 * EchoNote Cloud Functions (Conceptual Design)
 * 
 * These functions handle the heavy lifting asynchronously to ensure
 * the frontend remains responsive.
 */

import 'dotenv/config';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onObjectFinalized } from 'firebase-functions/v2/storage';
import * as admin from 'firebase-admin';
import { GoogleGenAI } from '@google/genai';
import { Resend } from 'resend';
import * as crypto from 'crypto';
import axios from 'axios';
import { db } from '../lib/firebaseAdmin.ts';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

const resend = new Resend(process.env.RESEND_API_KEY);

const PLAN_LIMITS = {
  free: 60,
  pro: 600,
  team: 1000,
  enterprise: 10000,
};

/**
 * Triggered when a new audio file is uploaded to Storage.
 * This is the primary entry point for AI processing.
 */
export const onAudioUpload = onObjectFinalized(async (event) => {
  const object = event.data;
  const filePath = object.name; // e.g., recordings/{uid}/{recordingId}/{fileName}
  if (!filePath?.startsWith('recordings/')) return;

  const [_, uid, recordingId, fileName] = filePath.split('/');
  const recordingRef = db.collection('recordings').doc(recordingId);
  const usageRef = db.collection('usage').doc(uid);

  try {
    // 0. Check Usage
    const usageDoc = await usageRef.get();
    const usageData = usageDoc.data();
    if (usageData && usageData.minutesUsed >= usageData.monthlyLimit) {
      throw new Error("Monthly usage limit exceeded");
    }

    // 1. Update status to processing
    await recordingRef.update({ status: 'processing' });

    // 2. Fetch file from Storage
    const bucket = admin.storage().bucket(object.bucket);
    const file = bucket.file(filePath);
    const [buffer] = await file.download();
    const base64Audio = buffer.toString('base64');

    // 3. Call Gemini AI
    const model = ai.models.get({ model: "gemini-2.5-flash-native-audio-preview-12-2025" });
    const prompt = `Analyze this audio. Provide a speaker-wise transcript, summary, and action items in JSON format.`;
    
    const result = await ai.models.generateContent({
      model: "gemini-2.5-flash-native-audio-preview-12-2025",
      contents: [
        { inlineData: { data: base64Audio, mimeType: object.contentType || 'audio/mpeg' } },
        { text: prompt }
      ]
    });

    const aiOutput = JSON.parse(result.text);

    // 4. Store Transcription
    const transcriptionId = db.collection('transcriptions').doc().id;
    const transcriptionRef = db.collection('transcriptions').doc(transcriptionId);
    await transcriptionRef.set({
      transcriptionId,
      recordingId,
      userId: uid,
      summary: aiOutput.summary,
      actionItems: aiOutput.actionItems,
      segments: aiOutput.segments,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // 5. Update Recording Status
    await recordingRef.update({ 
      status: 'completed',
      duration: object.size // Simplified duration tracking
    });

    // 6. Update User Usage
    await usageRef.set({
      minutesUsed: admin.firestore.FieldValue.increment(1) // Simplified increment
    }, { merge: true });

  } catch (error) {
    console.error("Cloud Function Error:", error);
    await recordingRef.update({ 
      status: 'error',
      errorMessage: error instanceof Error ? error.message : "Internal processing error"
    });
  }
});

// NOTE: All Razorpay payment operations (Subscriptions, Orders, Payment Verification,
// and Webhooks) are authoritatively unified and handled by the Express backend running
// on Google Cloud Run (server.ts). Legacy duplicate Cloud Functions have been retired.

/**
 * API Endpoint: Create Project
 */
export const createProject = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'User must be logged in');

  const { name } = request.data;
  const projectRef = db.collection('projects').doc();
  
  await projectRef.set({
    projectId: projectRef.id,
    name,
    userId: request.auth.uid,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });

  // Add owner as admin member
  await db.collection('projectMembers').doc(`${request.auth.uid}_${projectRef.id}`).set({
    projectId: projectRef.id,
    userId: request.auth.uid,
    email: request.auth.token.email,
    role: 'admin',
    joinedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  return { projectId: projectRef.id };
});

/**
 * API Endpoint: Send Invitation
 */
export const sendInviteEmail = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'User must be logged in');

  const { email, projectId, role, origin } = request.data;
  
  // Verify inviter is project admin
  const memberRef = db.collection('projectMembers').doc(`${request.auth.uid}_${projectId}`);
  const memberDoc = await memberRef.get();
  if (!memberDoc.exists || memberDoc.data()?.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Only project admins can invite others');
  }

  const inviteRef = db.collection('invitations').doc();
  await inviteRef.set({
    id: inviteRef.id,
    email,
    projectId,
    role,
    status: 'pending',
    invitedBy: request.auth.uid,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });

  const inviteLink = `${origin}/accept-invite?id=${inviteRef.id}`;

  try {
    await resend.emails.send({
      from: 'EchoNote <invites@echonote.ai>',
      to: [email],
      subject: 'You are invited to collaborate on EchoNote',
      html: `
        <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
          <h2>Collaboration Invite</h2>
          <p>You have been invited to join a project on EchoNote.</p>
          <p>Click the link below to accept the invitation:</p>
          <a href="${inviteLink}" style="display: inline-block; padding: 10px 20px; background: #000; color: #fff; text-decoration: none; border-radius: 5px;">Accept Invitation</a>
          <p style="margin-top: 20px; font-size: 12px; color: #666;">If you did not expect this, you can safely ignore this email.</p>
        </div>
      `
    });
  } catch (error) {
    console.error("Email Error:", error);
    throw new HttpsError('internal', 'Failed to send invite email');
  }

  return { success: true };
});

/**
 * API Endpoint: Accept Invitation
 */
export const acceptInvite = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'User must be logged in');

  const { inviteId } = request.data;
  const inviteRef = db.collection('invitations').doc(inviteId);
  const inviteDoc = await inviteRef.get();

  if (!inviteDoc.exists) throw new HttpsError('not-found', 'Invitation not found');
  
  const inviteData = inviteDoc.data();
  if (inviteData?.status !== 'pending') throw new HttpsError('failed-precondition', 'Invitation already processed');
  if (inviteData?.email !== request.auth.token.email) throw new HttpsError('permission-denied', 'Email mismatch');

  // 1. Add to projectMembers
  await db.collection('projectMembers').doc(`${request.auth.uid}_${inviteData.projectId}`).set({
    projectId: inviteData.projectId,
    userId: request.auth.uid,
    email: request.auth.token.email,
    role: inviteData.role,
    joinedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  // 2. Update invitation status
  await inviteRef.update({ status: 'accepted' });

  return { projectId: inviteData.projectId };
});

/**
 * API Endpoint: Get Jira Auth URL
 */
export const getJiraAuthUrl = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'User must be logged in');

  const clientId = process.env.JIRA_CLIENT_ID;
  const redirectUri = process.env.JIRA_REDIRECT_URI;
  const state = crypto.randomBytes(16).toString('hex');

  // Store state in Firestore to verify later
  await db.collection('jiraStates').doc(request.auth.uid).set({
    state,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });

  const scopes = [
    'read:jira-work',
    'write:jira-work',
    'read:jira-user',
    'offline_access'
  ].join(' ');

  const authUrl = `https://auth.atlassian.com/authorize?audience=api.atlassian.com&client_id=${clientId}&scope=${encodeURIComponent(scopes)}&redirect_uri=${encodeURIComponent(redirectUri || '')}&state=${state}&response_type=code&prompt=consent`;

  return { authUrl };
});

/**
 * API Endpoint: Exchange Jira Code for Token
 */
export const exchangeJiraCode = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'User must be logged in');

  const { code, state } = request.data;
  
  // Verify state
  const stateDoc = await db.collection('jiraStates').doc(request.auth.uid).get();
  if (!stateDoc.exists || stateDoc.data()?.state !== state) {
    throw new HttpsError('invalid-argument', 'Invalid state parameter');
  }

  const clientId = process.env.JIRA_CLIENT_ID;
  const clientSecret = process.env.JIRA_CLIENT_SECRET;
  const redirectUri = process.env.JIRA_REDIRECT_URI;

  try {
    const response = await axios.post('https://auth.atlassian.com/oauth/token', {
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri
    });

    const { access_token, refresh_token, expires_in } = response.data;

    // Store tokens in a private collection
    await db.collection('userIntegrations').doc(request.auth.uid).set({
      jira: {
        accessToken: access_token,
        refreshToken: refresh_token,
        expiresAt: Date.now() + (expires_in * 1000),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }
    }, { merge: true });

    // Get accessible resources (Cloud ID)
    const resourcesResponse = await axios.get('https://api.atlassian.com/oauth/token/accessible-resources', {
      headers: { Authorization: `Bearer ${access_token}` }
    });

    if (resourcesResponse.data && resourcesResponse.data.length > 0) {
      const cloudId = resourcesResponse.data[0].id;
      await db.collection('userIntegrations').doc(request.auth.uid).set({
        jira: { cloudId }
      }, { merge: true });
    }

    return { success: true };
  } catch (error: any) {
    console.error("Jira Token Exchange Error:", error.response?.data || error.message);
    throw new HttpsError('internal', 'Failed to exchange Jira code');
  }
});

/**
 * API Endpoint: Sync to Jira
 */
export const syncToJira = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'User must be logged in');

  const { title, description, projectKey, issueType } = request.data;
  
  const integrationDoc = await db.collection('userIntegrations').doc(request.auth.uid).get();
  const jiraData = integrationDoc.data()?.jira;

  if (!jiraData || !jiraData.accessToken || !jiraData.cloudId) {
    throw new HttpsError('failed-precondition', 'Jira integration not configured');
  }

  let accessToken = jiraData.accessToken;

  // Refresh token if expired
  if (Date.now() >= jiraData.expiresAt - 60000) {
    try {
      const refreshResponse = await axios.post('https://auth.atlassian.com/oauth/token', {
        grant_type: 'refresh_token',
        client_id: process.env.JIRA_CLIENT_ID,
        client_secret: process.env.JIRA_CLIENT_SECRET,
        refresh_token: jiraData.refreshToken
      });

      accessToken = refreshResponse.data.access_token;
      await db.collection('userIntegrations').doc(request.auth.uid).set({
        jira: {
          accessToken,
          refreshToken: refreshResponse.data.refresh_token,
          expiresAt: Date.now() + (refreshResponse.data.expires_in * 1000),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }
      }, { merge: true });
    } catch (error: any) {
      console.error("Jira Token Refresh Error:", error.response?.data || error.message);
      throw new HttpsError('internal', 'Failed to refresh Jira token');
    }
  }

  try {
    const issueResponse = await axios.post(`https://api.atlassian.com/ex/jira/${jiraData.cloudId}/rest/api/3/issue`, {
      fields: {
        project: { key: projectKey || 'PROJ' }, // Default to PROJ if not provided
        summary: title,
        description: {
          type: 'doc',
          version: 1,
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: description
                }
              ]
            }
          ]
        },
        issuetype: { name: issueType || 'Task' }
      }
    }, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    return { success: true, issueKey: issueResponse.data.key, issueUrl: `https://${jiraData.cloudId}.atlassian.net/browse/${issueResponse.data.key}` };
  } catch (error: any) {
    console.error("Jira Sync Error:", error.response?.data || error.message);
    throw new HttpsError('internal', 'Failed to create Jira issue');
  }
});
