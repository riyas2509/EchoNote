/**
 * EchoNote Cloud Functions (Conceptual Design)
 * 
 * These functions handle the heavy lifting asynchronously to ensure
 * the frontend remains responsive.
 */

import 'dotenv/config';
import { onCall, HttpsError, onRequest } from 'firebase-functions/v2/https';
import { onObjectFinalized } from 'firebase-functions/v2/storage';
import * as admin from 'firebase-admin';
import { GoogleGenAI } from '@google/genai';
import Razorpay from 'razorpay';
import { Resend } from 'resend';
import * as crypto from 'crypto';
import axios from 'axios';

admin.initializeApp();
const db = admin.firestore();
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

function getRazorpay() {
  // Force fresh read of environment variables from process.env
  const key_id = process.env.RAZORPAY_KEY_ID?.trim();
  const key_secret = process.env.RAZORPAY_KEY_SECRET?.trim();

  console.log("🔥 RAZORPAY KEY IN USE (Functions):", key_id);

  if (!key_id || !key_secret) {
    throw new Error("CRITICAL: Razorpay API keys are missing in functions environment.");
  }

  // Strict validation for TEST mode
  if (!key_id.startsWith("rzp_test_")) {
    console.error("❌ ERROR: Razorpay must use TEST keys (rzp_test_*). Found:", key_id.substring(0, 12) + "...");
    throw new Error("❌ Razorpay must use TEST keys (rzp_test_*). Please update your keys in the Settings menu.");
  }

  // Always return a fresh instance to ensure latest env values are used
  return new Razorpay({
    key_id,
    key_secret,
  });
}

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

/**
 * API Endpoint: Create Razorpay Subscription
 */
export const createSubscription = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'User must be logged in');

  const { plan } = request.data;
  if (!['pro', 'team', 'enterprise'].includes(plan)) {
    throw new HttpsError('invalid-argument', 'Invalid plan type');
  }

  const planId = plan === 'pro' ? process.env.RAZORPAY_PRO_PLAN_ID : 
                 plan === 'team' ? process.env.RAZORPAY_TEAM_PLAN_ID : 
                 process.env.RAZORPAY_ENTERPRISE_PLAN_ID;
  if (!planId) {
    console.error("Plan ID not configured for plan:", plan);
    console.error("Available env vars:", Object.keys(process.env).filter(k => k.startsWith('RAZORPAY')));
    throw new HttpsError('internal', `Plan ID not configured for ${plan}`);
  }

  try {
    const razorpay = getRazorpay();
    console.log("Creating Razorpay subscription for plan:", plan, "with planId:", planId);
    const subscription = await razorpay.subscriptions.create({
      plan_id: planId,
      customer_notify: 1,
      total_count: 12, // 1 year
      notes: {
        firebaseUid: request.auth.uid,
        plan: plan,
      },
    });

    const keyId = process.env.RAZORPAY_KEY_ID;
    if (!keyId) throw new HttpsError('internal', 'Razorpay Key ID not configured on server');

    return {
      subscriptionId: subscription.id,
      keyId: keyId,
    };
  } catch (error: any) {
    console.error("Razorpay Subscription Error:", error);
    const message = error?.error?.description || error?.message || 'Failed to create subscription';
    throw new HttpsError('internal', message);
  }
});

/**
 * API Endpoint: Verify Razorpay Payment
 */
export const verifyPayment = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'User must be logged in');

  const { razorpay_payment_id, razorpay_subscription_id, razorpay_signature } = request.data;

  const secret = process.env.RAZORPAY_KEY_SECRET || '';
  if (!secret) {
    console.error("RAZORPAY_KEY_SECRET not configured");
    throw new HttpsError('internal', 'Payment verification failed due to server configuration');
  }

  const generated_signature = crypto
    .createHmac('sha256', secret)
    .update(razorpay_payment_id + '|' + razorpay_subscription_id)
    .digest('hex');

  if (generated_signature === razorpay_signature) {
    console.log("Payment verified successfully for subscription:", razorpay_subscription_id);
    return { status: 'success' };
  } else {
    console.error("Invalid signature for subscription:", razorpay_subscription_id);
    console.error("Generated:", generated_signature);
    console.error("Received:", razorpay_signature);
    throw new HttpsError('permission-denied', 'Invalid signature');
  }
});

/**
 * Razorpay Webhook Handler
 */
export const razorpayWebhook = onRequest(async (req, res) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET || '';
  const signature = req.headers['x-razorpay-signature'] as string;

  // Use rawBody for signature verification
  const rawBody = (req as any).rawBody;
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  if (expectedSignature !== signature) {
    res.status(400).send('Invalid signature');
    return;
  }

  const event = req.body;
  const subscription = event.payload.subscription.entity;
  const firebaseUid = subscription.notes?.firebaseUid;

  if (!firebaseUid) {
    res.status(200).send('No firebaseUid found in notes');
    return;
  }

  const plan = subscription.notes?.plan || 'pro';

  switch (event.event) {
    case 'subscription.activated':
    case 'subscription.charged':
      await db.collection('users').doc(firebaseUid).update({
        plan: plan,
      });

      await db.collection('subscriptions').doc(subscription.id).set({
        userId: firebaseUid,
        plan: plan,
        status: subscription.status,
        razorpaySubscriptionId: subscription.id,
        razorpayPlanId: subscription.plan_id,
        currentPeriodEnd: new Date(subscription.current_end * 1000).toISOString(),
        billingCycle: 'monthly',
      });

      await db.collection('usage').doc(firebaseUid).set({
        monthlyLimit: PLAN_LIMITS[plan as keyof typeof PLAN_LIMITS],
      }, { merge: true });
      break;

    case 'subscription.cancelled':
    case 'subscription.expired':
      await db.collection('users').doc(firebaseUid).update({
        plan: 'free',
      });
      await db.collection('usage').doc(firebaseUid).update({
        monthlyLimit: PLAN_LIMITS.free,
      });
      break;
  }

  res.status(200).send('Success');
});

/**
 * API Endpoint: Simulate Webhook (TESTING ONLY)
 * This allows testing the webhook logic without an external trigger.
 */
export const simulateWebhook = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'User must be logged in');
  
  // Only allow admins or specific test users if needed
  // For this prototype, we'll allow the current user to simulate for themselves
  
  const { event, plan } = request.data;
  const mockSubscriptionId = `sub_test_${Date.now()}`;
  
  const mockPayload = {
    event: event || 'subscription.activated',
    payload: {
      subscription: {
        entity: {
          id: mockSubscriptionId,
          status: 'active',
          plan_id: plan === 'pro' ? process.env.RAZORPAY_PRO_PLAN_ID : 
                   plan === 'team' ? process.env.RAZORPAY_TEAM_PLAN_ID : 
                   process.env.RAZORPAY_ENTERPRISE_PLAN_ID,
          current_end: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60),
          notes: {
            firebaseUid: request.auth.uid,
            plan: plan || 'pro'
          }
        }
      }
    }
  };

  // We bypass the signature check here because it's an internal call
  // but we use the same logic as the real webhook
  
  const subscription = mockPayload.payload.subscription.entity;
  const firebaseUid = subscription.notes.firebaseUid;
  const planType = subscription.notes.plan;

  await db.collection('users').doc(firebaseUid).update({
    plan: planType,
  });

  await db.collection('subscriptions').doc(subscription.id).set({
    userId: firebaseUid,
    plan: planType,
    status: subscription.status,
    razorpaySubscriptionId: subscription.id,
    razorpayPlanId: subscription.plan_id,
    currentPeriodEnd: new Date(subscription.current_end * 1000).toISOString(),
    billingCycle: 'monthly',
  });

  await db.collection('usage').doc(firebaseUid).set({
    monthlyLimit: PLAN_LIMITS[planType as keyof typeof PLAN_LIMITS],
  }, { merge: true });

  return { success: true, subscriptionId: mockSubscriptionId };
});

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
