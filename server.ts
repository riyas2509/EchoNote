import dotenv from "dotenv";
dotenv.config();

console.log("🔥 SERVER RESTARTED WITH NEW CODE");

import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import { convertOpusToWav } from "./lib/audioUtils.js";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import admin from "firebase-admin";
import { GoogleAuth } from "google-auth-library";
import { GoogleGenAI, Type, Modality, ThinkingLevel } from "@google/genai";
import { trackAIUsage } from "./lib/aiTracker.js";
import { emailService } from "./lib/emailService.js";

// Initialize Firebase Admin
const firebaseConfig = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'firebase-applet-config.json'), 'utf8'));

const appAdmin = !getApps().length 
  ? initializeApp({ 
      credential: admin.credential.applicationDefault(),
      projectId: process.env.GOOGLE_CLOUD_PROJECT || firebaseConfig.projectId || "echonote-2509",
    })
  : getApps()[0];

const db = getFirestore(appAdmin, firebaseConfig.firestoreDatabaseId);

async function checkIdentity() {
  const auth = new GoogleAuth();
  try {
    const client = await auth.getClient();
    const serviceAccount = await auth.getCredentials();
    console.log("🛠️ --- BACKEND IDENTITY CHECK ---");
    console.log("📍 Target Project ID:", appAdmin.options.projectId);
    console.log("📦 Target Database:", firebaseConfig.firestoreDatabaseId);
    
    if (serviceAccount.client_email) {
      console.log("👤 Service Account Email:", serviceAccount.client_email);
    } else {
      // In Cloud Run, we can fetch the service account via the metadata server
      try {
        const metadataUrl = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email";
        const response = await fetch(metadataUrl, { headers: { "Metadata-Flavor": "Google" } });
        const email = await response.text();
        console.log("👤 Cloud Run Service Account:", email);
      } catch (e) {
        console.log("👤 Identity could not be determined via Metadata API.");
      }
    }
  } catch (error) {
    console.error("❌ Failed to discover identity:", error);
  }
}

checkIdentity();

import { Resend } from "resend";
import Razorpay from "razorpay";

const resend = new Resend(process.env.RESEND_API_KEY);

const razorpay = new Razorpay({
  key_id: (process.env.RAZORPAY_KEY_ID || "").trim(),
  key_secret: (process.env.RAZORPAY_KEY_SECRET || "").trim(),
});

const rzId = (process.env.RAZORPAY_KEY_ID || "").trim();
const rzSecret = (process.env.RAZORPAY_KEY_SECRET || "").trim();

console.log("🛠️ Razorpay Initialization Check:");
console.log(`   - Key ID starts with: ${rzId.slice(0, 8)}...`);
console.log(`   - Key ID Length: ${rzId.length}`);
console.log(`   - Key Secret Length: ${rzSecret.length}`);

if (!rzId || !rzSecret) {
  console.warn("⚠️ WARNING: RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET is missing from environment variables!");
}

async function startServer() {
  console.log("🚀 SERVER RESTARTED AT:", new Date().toISOString());
  const app = express();
  const PORT = 3000;
  
  let _aiGenInstance: GoogleGenAI | null = null;
  const aiGen = {
    get models() {
      if (!_aiGenInstance) {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
          throw new Error("GEMINI_API_KEY environment variable is required to use the Gemini API.");
        }
        _aiGenInstance = new GoogleGenAI({ apiKey });
      }
      return _aiGenInstance.models;
    }
  };

  app.use(express.json({ limit: '50mb' }));

  // CORS Configuration
  app.use(cors({
    origin: [
      "https://echotechai.in",
      "https://www.echotechai.in",
      "http://localhost:3000",
      "http://localhost:5173",
      /\.run\.app$/ // Allow common Cloud Run preview URLs
    ],
    credentials: true
  }));

  // Logging middleware for debugging
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} ${res.statusCode} - ${duration}ms`);
    });
    next();
  });

  // Health Check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", time: new Date().toISOString() });
  });

  // Invitation API
  app.post("/api/invite-member", async (req, res) => {
    const { email, role, projectId, invitedBy, projectName, ownerId } = req.body;
    
    if (!email || !role || !projectId) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    try {
      const inviteToken = crypto.randomUUID();
      const inviteData = {
        id: inviteToken,
        email,
        projectId,
        projectName: projectName || "Unnamed Project",
        role,
        invitedBy: invitedBy || "System",
        ownerId: ownerId || null, // Capture the project owner's ID
        status: "pending",
        createdAt: FieldValue.serverTimestamp()
      };

      // Store in Firestore
      await db.collection("invites").doc(inviteToken).set(inviteData);

      // Send Email via Resend centralized email service
      const appUrl = process.env.VITE_APP_URL || `https://${req.get('host')}`;
      const joinUrl = `${appUrl}/join?token=${inviteToken}`;

      await emailService.sendTeamInvitation(email, {
        inviterName: invitedBy || "A team member",
        projectName: projectName || "EchoNote Workspace",
        role: role,
        inviteLink: joinUrl
      });

      res.json({ success: true, inviteToken });
    } catch (error: any) {
      console.error("🔥 INVITE ERROR:", error);
      res.status(500).json({ error: "Failed to send invitation", details: error.message });
    }
  });

  // Get Invite Details
  app.get("/api/invite-details/:token", async (req, res) => {
    const { token } = req.params;
    try {
      const doc = await db.collection("invites").doc(token).get();
      if (!doc.exists) {
        return res.status(404).json({ error: "Invalid or expired invitation token" });
      }

      const invite = doc.data();
      res.json(invite);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch invitation details" });
    }
  });

  // Accept Invitation & Add User to Project
  app.post("/api/invite-accept", async (req, res) => {
    const { token, userId, userEmail, userDisplayName } = req.body;
    if (!token || !userId || !userEmail) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    try {
      const inviteDocRef = db.collection("invites").doc(token);
      const inviteDoc = await inviteDocRef.get();
      
      if (!inviteDoc.exists) {
        return res.status(404).json({ error: "Invitation not found" });
      }

      const invite = inviteDoc.data();
      if (!invite || invite.status !== 'pending') {
        return res.status(400).json({ error: `Invitation cannot be accepted. Current status is '${invite?.status || 'unknown'}'` });
      }

      // 1. Create project member record
      const memberId = `${userId}_${invite.projectId}`;
      await db.collection("projectMembers").doc(memberId).set({
        userId,
        email: userEmail,
        displayName: userDisplayName || userEmail.split('@')[0] || 'User',
        projectId: invite.projectId,
        ownerId: invite.ownerId || null,
        projectName: invite.projectName,
        role: invite.role,
        joinedAt: FieldValue.serverTimestamp()
      });

      // 2. Update invite status to accepted
      await inviteDocRef.update({
        status: "accepted",
        acceptedAt: FieldValue.serverTimestamp(),
        acceptedBy: userId
      });

      // 3. Log join project activity
      await db.collection("projectActivities").add({
        projectId: invite.projectId,
        userId: userId,
        userEmail: userEmail,
        userName: userDisplayName || userEmail.split('@')[0] || 'User',
        actionType: "join_project",
        description: `${userDisplayName || userEmail.split('@')[0]} joined project "${invite.projectName}"`,
        createdAt: FieldValue.serverTimestamp()
      });

      // 4. Send welcome to workspace / project onboarding email via Resend
      const appUrl = process.env.VITE_APP_URL || `https://${req.get('host')}`;
      try {
        await emailService.sendWelcome(userEmail, {
          name: userDisplayName || userEmail.split('@')[0] || 'User',
          dashboardLink: `${appUrl}/app`
        });
      } catch (welcomeErr) {
        console.error("⚠️ Failed to send welcome onboarding email:", welcomeErr);
      }

      res.json({ success: true, message: "Successfully joined the project" });
    } catch (error: any) {
      console.error("🔥 ACCEPT INVITATION ERROR:", error);
      res.status(500).json({ error: "Failed to accept invitation", details: error.message });
    }
  });

  // Decline/Reject Invitation
  app.post("/api/invite-decline", async (req, res) => {
    const { token, userId } = req.body;
    if (!token) {
      return res.status(400).json({ error: "Missing token" });
    }

    try {
      const inviteDocRef = db.collection("invites").doc(token);
      const inviteDoc = await inviteDocRef.get();
      
      if (!inviteDoc.exists) {
        return res.status(404).json({ error: "Invitation not found" });
      }

      const invite = inviteDoc.data();
      if (!invite || invite.status !== 'pending') {
        return res.status(400).json({ error: "Only pending invitations can be declined" });
      }

      await inviteDocRef.update({
        status: "rejected",
        rejectedAt: FieldValue.serverTimestamp(),
        rejectedBy: userId || null
      });

      // Log decline invitation activity
      await db.collection("projectActivities").add({
        projectId: invite.projectId,
        userId: userId || 'unknown',
        userEmail: invite.email,
        userName: invite.email.split('@')[0],
        actionType: "decline_invite",
        description: `${invite.email.split('@')[0]} declined invitation to join "${invite.projectName}"`,
        createdAt: FieldValue.serverTimestamp()
      });

      res.json({ success: true, message: "Invitation declined successfully" });
    } catch (error: any) {
      console.error("🔥 DECLINE INVITATION ERROR:", error);
      res.status(500).json({ error: "Failed to decline invitation", details: error.message });
    }
  });

  // Expire Invitation
  app.post("/api/invite-expire", async (req, res) => {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ error: "Missing token" });
    }

    try {
      const inviteDocRef = db.collection("invites").doc(token);
      const inviteDoc = await inviteDocRef.get();
      
      if (!inviteDoc.exists) {
        return res.status(404).json({ error: "Invitation not found" });
      }

      const invite = inviteDoc.data();
      if (!invite || invite.status !== 'pending') {
        return res.status(400).json({ error: "Only pending invitations can be expired" });
      }

      await inviteDocRef.update({
        status: "expired",
        expiredAt: FieldValue.serverTimestamp()
      });

      res.json({ success: true, message: "Invitation expired successfully" });
    } catch (error: any) {
      console.error("🔥 EXPIRE INVITATION ERROR:", error);
      res.status(500).json({ error: "Failed to expire invitation", details: error.message });
    }
  });

  // Razorpay: Create Order
  app.post("/api/create-order", async (req, res) => {
    const { planId, userId, billingCycle, type, minutes, amount: customAmount } = req.body;
    
    // Check if Razorpay is configured
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      console.error("❌ RAZORPAY CONFIG ERROR: Keys are missing in environment variables.");
      return res.status(500).json({ 
        error: "Razorpay is not configured on the server. Please add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to environment variables." 
      });
    }

    let amount = 0;
    let razorpayPlanId = "";
    const currency = "INR";

    if (type === 'topup') {
      amount = customAmount;
      razorpayPlanId = "topup";
    } else {
      // Plan Mapping for Subscriptions
      const planMappings: Record<string, Record<string, { price: number, planId: string | undefined }>> = {
        pro: {
          monthly: { price: 99900, planId: process.env.RAZORPAY_PRO_MONTHLY_PLAN_ID },
          yearly: { price: 79900 * 12, planId: process.env.RAZORPAY_PRO_YEARLY_PLAN_ID },
        },
        team: {
          monthly: { price: 249900, planId: process.env.RAZORPAY_TEAM_MONTHLY_PLAN_ID },
          yearly: { price: 199900 * 12, planId: process.env.RAZORPAY_TEAM_YEARLY_PLAN_ID },
        },
      };

      const planData = planMappings[planId as string]?.[billingCycle as string];
      if (!planData) {
        return res.status(400).json({ error: "Invalid plan or billing cycle" });
      }

      amount = planData.price;
      razorpayPlanId = planData.planId || `plan_${planId}_${billingCycle}`;
    }

    try {
      const options = {
        amount,
        currency,
        receipt: `receipt_${Date.now()}`,
        notes: {
          userId,
          planId: planId || "topup",
          razorpayPlanId,
          billingCycle: billingCycle || "one-time",
          type: type || "subscription",
          minutes: minutes || 0
        }
      };

      const order = await razorpay.orders.create(options);
      res.json({
        id: order.id,
        amount: order.amount,
        currency: order.currency,
        key: process.env.RAZORPAY_KEY_ID
      });
    } catch (error: any) {
      console.error("🔥 RAZORPAY ORDER ERROR:", error);
      
      let clientMessage = "Failed to create Razorpay order";
      const errorObj = error.error || error;
      
      if (errorObj.description === "Authentication failed" || error.description === "Authentication failed") {
        clientMessage = "Razorpay Authentication Failed: The API Key ID or Secret is invalid. Please check your credentials in Settings.";
      } else if (errorObj.description) {
        clientMessage = `Razorpay Error: ${errorObj.description}`;
      } else if (error.message) {
        clientMessage = `Razorpay Error: ${error.message}`;
      }
      
      res.status(500).json({ 
        error: clientMessage, 
        details: errorObj.description || error.message || error
      });
    }
  });

  // Razorpay: Verify Payment
  app.post("/api/verify-payment", async (req, res) => {
    const { 
      razorpay_order_id, 
      razorpay_payment_id, 
      razorpay_signature,
      userId,
      planId,
      billingCycle,
      type,
      minutes
    } = req.body;

    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac("sha256", (process.env.RAZORPAY_KEY_SECRET || "").trim())
      .update(body.toString())
      .digest("hex");

    if (expectedSignature === razorpay_signature) {
      try {
        if (type === 'topup') {
          await db.collection("users").doc(userId).update({
            extraMinutes: FieldValue.increment(minutes || 0),
            lastPaymentDate: FieldValue.serverTimestamp()
          });
        } else {
          const now = new Date();
          const subscriptionStartDate = now.toISOString();
          const nextRefreshDate = new Date(subscriptionStartDate);
          if (billingCycle === 'yearly') {
            nextRefreshDate.setFullYear(nextRefreshDate.getFullYear() + 1);
          } else {
            nextRefreshDate.setMonth(nextRefreshDate.getMonth() + 1);
          }

          const expiryDate = new Date(now);
          if (billingCycle === 'yearly') {
            expiryDate.setFullYear(expiryDate.getFullYear() + 1);
          } else {
            expiryDate.setMonth(expiryDate.getMonth() + 1);
          }

          await db.collection("users").doc(userId).update({
            plan: planId || "pro",
            billingCycle: billingCycle || "monthly",
            subscriptionStartDate: subscriptionStartDate,
            nextRefreshDate: nextRefreshDate.toISOString(),
            // For backwards compatibility:
            billingStartDate: subscriptionStartDate,
            planExpiresAt: expiryDate.toISOString(),
            lastPaymentDate: FieldValue.serverTimestamp()
          });
        }

        res.json({ success: true });
      } catch (error: any) {
        console.error("🔥 PAYMENT SUCCESS UPDATE ERROR:", error);
        res.status(500).json({ error: "Payment verified but user profile update failed", details: error.message });
      }
    } else {
      res.status(400).json({ error: "Invalid payment signature" });
    }
  });

  // API Routes
  
  app.post("/api/convert-opus", async (req, res) => {
    const { base64Audio, fileName } = req.body;
    if (!base64Audio) {
      return res.status(400).json({ error: "Missing base64Audio" });
    }

    const tempDir = os.tmpdir();
    const inputId = Math.random().toString(36).substring(7);
    const inputPath = path.join(tempDir, `input_${inputId}.opus`);
    const outputPath = path.join(tempDir, `output_${inputId}.wav`);

    try {
      console.log(`[Server] Received OPUS conversion request for: ${fileName || 'unnamed'}`);
      
      // Write base64 to temp file
      const buffer = Buffer.from(base64Audio, 'base64');
      fs.writeFileSync(inputPath, buffer);
      console.log(`[Server] Wrote temp input file: ${inputPath} (${buffer.length} bytes)`);

      // Convert
      await convertOpusToWav(inputPath, outputPath);
      console.log(`[Server] Conversion complete: ${outputPath}`);

      // Read converted file
      const outputBuffer = fs.readFileSync(outputPath);
      const outputBase64 = outputBuffer.toString('base64');
      console.log(`[Server] Read converted file: ${outputBase64.length} base64 chars`);

      res.json({ 
        base64Audio: outputBase64, 
        mimeType: 'audio/wav',
        fileName: (fileName || 'audio').replace(/\.[^/.]+$/, "") + ".wav"
      });

    } catch (error: any) {
      console.error("[Server] Conversion error:", error);
      res.status(500).json({ error: "Failed to convert audio", details: error.message });
    } finally {
      // Cleanup
      try {
        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        console.log("[Server] Cleaned up temp files");
      } catch (cleanupError) {
        console.error("[Server] Cleanup error:", cleanupError);
      }
    }
  });

  // AI Tracking & Execution Endpoints
  app.post("/api/ai/transcribe-audio", async (req, res) => {
    const { base64Data, mimeType, targetLanguage, userId, email, plan } = req.body;
    const start = Date.now();
    const model = 'gemini-3.5-flash';
    const featureName = "Intelligence Transcription";

    if (!base64Data) return res.status(400).json({ error: "Missing sound data" });

    const languageInstruction = targetLanguage === 'english' 
      ? "MANDATORY: Translate all spoken content into English. The final transcript and summary MUST be in English, regardless of the input language."
      : "Transcribe in 'Hinglish' (a mix of Hindi and English written in Roman script) if the speakers are using Hindi or a mix of Hindi and English. If they are using other languages, transcribe exactly as spoken. Do not translate to pure English if the original is Hindi/Hinglish.";

    try {
      const response = await aiGen.models.generateContent({
        model,
        contents: [
          {
            parts: [
              {
                inlineData: {
                  data: base64Data,
                  mimeType,
                },
              },
              {
                text: `Provide a highly accurate, word-for-word, literal (verbatim) transcription of the entire audio.
                
                TRANSCRIPTION REQUIREMENTS:
                1. This MUST be a true, word-for-word verbatim transcription. Do NOT summarize, condense, paraphrase, or truncate any spoken words in the transcript segments.
                2. Fully preserve all speaker changes, correct punctuation, and natural paragraph structures.
                3. Keep disfluencies and spoken text intact to ensure a high-fidelity verbatim record.
                4. Map the transcript to precise start and end timestamps (in seconds).
                5. ${languageInstruction}

                TRANSCRIPTION QUALITY SCORE:
                Calculate a 'Transcription Quality Score' (0-100) based on:
                - Audio clarity (30%)
                - Speaker clarity (40%)
                - Verbatim fidelity (30%)
     
                EXECUTIVE SUMMARY RULES (Kept strictly separate):
                - Provide a professional, concise executive summary of the discussion under the 'summary' property.
                - This summary remains completely separate from the transcript and should not shorten or summarize the transcript text itself.
                
                Format the output strictly as a JSON object containing:
                - 'transcript' (array of {speaker, text, startTime, endTime})
                - 'qualityScore' (number)
                - 'summary' (object with mainTopic, keyPoints[], decisions[], actionItems[])`,
              },
            ],
          },
        ],
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              transcript: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    speaker: { type: Type.STRING },
                    text: { type: Type.STRING },
                    startTime: { type: Type.NUMBER },
                    endTime: { type: Type.NUMBER },
                  },
                  required: ["speaker", "text", "startTime", "endTime"],
                },
              },
              qualityScore: { 
                type: Type.NUMBER,
              },
              summary: {
                type: Type.OBJECT,
                properties: {
                  mainTopic: { type: Type.STRING },
                  keyPoints: { type: Type.ARRAY, items: { type: Type.STRING } },
                  decisions: { type: Type.ARRAY, items: { type: Type.STRING } },
                  actionItems: { type: Type.ARRAY, items: { type: Type.STRING } },
                },
                required: ["mainTopic", "keyPoints", "decisions", "actionItems"],
              }
            },
            required: ["transcript", "qualityScore", "summary"],
          },
        },
      });

      const inputTokens = response.usageMetadata?.promptTokenCount || 0;
      const outputTokens = response.usageMetadata?.candidatesTokenCount || 0;
      const duration = Date.now() - start;

      await trackAIUsage({
        userId: userId || "anonymous",
        email: email || "anonymous@echotechai.in",
        plan: plan || "guest",
        featureName,
        modelUsed: model,
        inputTokens,
        outputTokens,
        requestDuration: duration,
        status: "success",
      });

      const jsonStr = response.text || "{\"transcript\": [], \"qualityScore\": 0, \"summary\": {\"mainTopic\": \"\", \"keyPoints\": [], \"decisions\": [], \"actionItems\": []}}";
      res.json(JSON.parse(jsonStr));

    } catch (error: any) {
      console.error(`[AI Endpoint Error] ${featureName}:`, error);
      const duration = Date.now() - start;
      await trackAIUsage({
        userId: userId || "anonymous",
        email: email || "anonymous@echotechai.in",
        plan: plan || "guest",
        featureName,
        modelUsed: model,
        inputTokens: 0,
        outputTokens: 0,
        requestDuration: duration,
        status: "failure",
      });
      res.status(500).json({ error: error.message || "Execution failed" });
    }
  });

  app.post("/api/ai/summarize-transcript", async (req, res) => {
    const { transcript, tier, userId, email, plan } = req.body;
    const start = Date.now();
    const model = 'gemini-3-flash-preview';
    const featureName = "Executive Summary";

    if (!transcript) return res.status(400).json({ error: "Missing transcript data" });

    const isAdvanced = tier !== 'guest';
    const transcriptText = Array.isArray(transcript) 
      ? transcript.map((s: any) => `${s.speaker}: ${s.text}`).join('\n')
      : String(transcript);

    try {
      const response = await aiGen.models.generateContent({
        model,
        contents: [
          {
            parts: [
              {
                text: `Based on the following transcript, generate a structured, professional summary. 
                
                PLAN LEVEL: ${isAdvanced ? 'ADVANCED (Full Insights)' : 'BASIC (Limited Insights)'}
    
                RULES:
                - Keep it concise (Total length should not exceed ${isAdvanced ? '15-20' : '8-10'} lines).
                - Do not hallucinate. 
                - Use a professional corporate tone.
                ${!isAdvanced ? '- LIMITATION: Provide only a high-level summary. Focus on the most critical points only.' : ''}
                
                TRANSCRIPT:
                ${transcriptText}`,
              },
            ],
          },
        ],
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              mainTopic: { 
                type: Type.STRING
              },
              keyPoints: { 
                type: Type.ARRAY, 
                items: { type: Type.STRING }
              },
              decisions: { 
                type: Type.ARRAY, 
                items: { type: Type.STRING }
              },
              actionItems: { 
                type: Type.ARRAY, 
                items: { type: Type.STRING }
              },
            },
            required: ["mainTopic", "keyPoints", "decisions", "actionItems"],
          },
        },
      });

      const inputTokens = response.usageMetadata?.promptTokenCount || 0;
      const outputTokens = response.usageMetadata?.candidatesTokenCount || 0;
      const duration = Date.now() - start;

      await trackAIUsage({
        userId: userId || "anonymous",
        email: email || "anonymous@echotechai.in",
        plan: plan || "guest",
        featureName,
        modelUsed: model,
        inputTokens,
        outputTokens,
        requestDuration: duration,
        status: "success",
      });

      res.json(JSON.parse(response.text || "{}"));
    } catch (error: any) {
      console.error(`[AI Endpoint Error] ${featureName}:`, error);
      const duration = Date.now() - start;
      await trackAIUsage({
        userId: userId || "anonymous",
        email: email || "anonymous@echotechai.in",
        plan: plan || "guest",
        featureName,
        modelUsed: model,
        inputTokens: 0,
        outputTokens: 0,
        requestDuration: duration,
        status: "failure",
      });
      res.status(500).json({ error: error.message || "Execution failed" });
    }
  });

  app.post("/api/ai/synthesize-speech", async (req, res) => {
    const { text, gender, userId, email, plan } = req.body;
    const start = Date.now();
    const model = "gemini-2.5-flash-preview-tts";
    const featureName = "Speech Synthesis";

    if (!text) return res.status(400).json({ error: "Missing text to synthesize" });

    const voiceName = gender === 'male' ? 'Fenrir' : 'Puck';
    const genderDescriptor = gender === 'male' 
      ? 'deep, authoritative, and distinctly masculine' 
      : 'clear, melodic, and distinctly feminine';

    try {
      const response = await aiGen.models.generateContent({
        model,
        contents: [{ 
          parts: [{ 
            text: `Narrate the following text in a ${genderDescriptor} tone with natural professional prosody. Ensure the pitch and timbre are unmistakably ${gender}. Text: ${text}` 
          }] 
        }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData?.data;
      if (!base64Audio) throw new Error("Audio generation failed on model side");

      const inputTokens = response.usageMetadata?.promptTokenCount || 0;
      const outputTokens = response.usageMetadata?.candidatesTokenCount || 0;
      const duration = Date.now() - start;

      await trackAIUsage({
        userId: userId || "anonymous",
        email: email || "anonymous@echotechai.in",
        plan: plan || "guest",
        featureName,
        modelUsed: model,
        inputTokens,
        outputTokens,
        requestDuration: duration,
        status: "success",
      });

      res.json({ base64Audio });
    } catch (error: any) {
      console.error(`[AI Endpoint Error] ${featureName}:`, error);
      const duration = Date.now() - start;
      await trackAIUsage({
        userId: userId || "anonymous",
        email: email || "anonymous@echotechai.in",
        plan: plan || "guest",
        featureName,
        modelUsed: model,
        inputTokens: 0,
        outputTokens: 0,
        requestDuration: duration,
        status: "failure",
      });
      res.status(500).json({ error: error.message || "Speech synthesis failed" });
    }
  });

  app.post("/api/ai/analyze-strategically", async (req, res) => {
    const { input, inputType, tier, userId, email, plan } = req.body;
    const start = Date.now();
    const model = 'gemini-3-flash-preview';
    const featureName = "Strategic Thinking Partner";

    if (!input) return res.status(400).json({ error: "Missing input content" });
    const isAdvanced = tier !== 'guest';

    const prompt = `
      You are the EchoNote Strategic Intelligence engine. Your goal is to transform the provided ${inputType} into deep, strategic insights that reveal the "thinking" behind the conversation.
      
      PLAN LEVEL: ${isAdvanced ? 'ADVANCED (Full Insights)' : 'BASIC (Limited Insights)'}
  
      INPUT (${inputType.toUpperCase()}):
      ${input}
  
      TASK:
      Analyze the input and provide a structured JSON response with the following sections:
      1. Core Intent: What is the primary, underlying goal or purpose of this discussion?
      2. Context: What is the broader situation or background that gives this conversation meaning?
      3. Assumptions: What are the underlying assumptions being made by the participants?
      4. Logical Gaps: Where is the reasoning incomplete or where are there contradictions?
      5. Blind Spots: What are the participants missing or failing to consider?
      6. Strategic Questions: What high-level, critical questions should be asked now?
      7. Recommendations: What specific, strategic advice would you give based on this?
      8. Alternative Perspectives: What other ways could this situation be interpreted or approached? ${isAdvanced ? '(Multiple viewpoints)' : '(Single alternative)'}
      9. Ignored Questions: What important questions were left unasked or unanswered during the conversation?
      10. Unresolved Topics: ${isAdvanced ? 'Identify topics discussed but no decision made, open-ended discussions, or unanswered questions.' : 'Empty array (Advanced Feature)'}
         ${isAdvanced ? `
         - Do NOT include topics that already have decisions.
         - Avoid trivial or minor points.
         - Focus on meaningful gaps.
         - For each, provide: id, topic (title), context (short explanation), reasonUnresolved (why it remains open), and suggestedAction (next step).
         ` : ''}
      11. Decision Framework: A brief assessment of the framework or logic being used to make decisions.
      12. Next Steps: Concrete, actionable steps that move the strategy forward.
  
      RULES:
      - Be critical, analytical, and insightful.
      - Do not just summarize; find the hidden patterns and strategic implications.
      - Use a professional, high-level executive tone.
      - Return ONLY valid JSON.
      ${!isAdvanced ? '- LIMITATION: Provide only basic insights. Keep responses concise.' : ''}
    `;

    try {
      const response = await aiGen.models.generateContent({
        model,
        contents: [{ parts: [{ text: prompt }] }],
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              coreIntent: { type: Type.STRING },
              context: { type: Type.STRING },
              assumptions: { type: Type.ARRAY, items: { type: Type.STRING } },
              logicalGaps: { type: Type.ARRAY, items: { type: Type.STRING } },
              blindSpots: { type: Type.ARRAY, items: { type: Type.STRING } },
              strategicQuestions: { type: Type.ARRAY, items: { type: Type.STRING } },
              recommendations: { type: Type.ARRAY, items: { type: Type.STRING } },
              alternativePerspectives: { type: Type.ARRAY, items: { type: Type.STRING } },
              ignoredQuestions: { type: Type.ARRAY, items: { type: Type.STRING } },
              unresolvedTopics: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    topic: { type: Type.STRING },
                    context: { type: Type.STRING },
                    reasonUnresolved: { type: Type.STRING },
                    suggestedAction: { type: Type.STRING },
                  },
                  required: ["id", "topic", "context", "reasonUnresolved", "suggestedAction"],
                },
              },
              decisionFramework: { type: Type.STRING },
              nextSteps: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: [
              "coreIntent", "context", "assumptions", "logicalGaps", "blindSpots", 
              "strategicQuestions", "recommendations", "alternativePerspectives", 
              "ignoredQuestions", "unresolvedTopics", "decisionFramework", "nextSteps"
            ],
          },
        },
      });

      const inputTokens = response.usageMetadata?.promptTokenCount || 0;
      const outputTokens = response.usageMetadata?.candidatesTokenCount || 0;
      const duration = Date.now() - start;

      await trackAIUsage({
        userId: userId || "anonymous",
        email: email || "anonymous@echotechai.in",
        plan: plan || "guest",
        featureName,
        modelUsed: model,
        inputTokens,
        outputTokens,
        requestDuration: duration,
        status: "success",
      });

      res.json(JSON.parse(response.text || "{}"));
    } catch (error: any) {
      console.error(`[AI Endpoint Error] ${featureName}:`, error);
      const duration = Date.now() - start;
      await trackAIUsage({
        userId: userId || "anonymous",
        email: email || "anonymous@echotechai.in",
        plan: plan || "guest",
        featureName,
        modelUsed: model,
        inputTokens: 0,
        outputTokens: 0,
        requestDuration: duration,
        status: "failure",
      });
      res.status(500).json({ error: error.message || "Execution failed" });
    }
  });

  app.post("/api/ai/decision-intelligence", async (req, res) => {
    console.log("DECISION INTELLIGENCE START");
    const { input, inputType, tier, userId, email, plan } = req.body;
    const start = Date.now();
    const model = 'gemini-3-flash-preview';
    const featureName = "Decision Intelligence";

    if (!input) return res.status(400).json({ error: "Missing input content" });
    const isAdvanced = tier !== 'guest';

    const prompt = `
      You are the EchoNote Decision Intelligence engine. Your goal is to transform the provided ${inputType} into structured, actionable insights that help users move from conversation to clarity.
      
      PLAN LEVEL: ${isAdvanced ? 'ADVANCED (Full Insights)' : 'BASIC (Limited Insights)'}
  
      INPUT (${inputType.toUpperCase()}):
      ${input}
  
      TASK:
      Analyze the input and provide a structured JSON response with the following sections:
      1. Key Decisions: What was actually decided? ${isAdvanced ? '(Detailed analysis)' : '(Brief list)'}
      2. Assumptions: What are the underlying assumptions being made? ${isAdvanced ? '(Deep dive)' : '(Basic list)'}
      3. Risks & Gaps: What could go wrong or what information is missing?
      4. Alternative Perspectives: What other ways could this be looked at? ${isAdvanced ? '(Multiple viewpoints)' : '(Single alternative)'}
      5. Ignored Questions: What important questions were left unasked or unanswered?
      6. Unresolved Topics: ${isAdvanced ? 'Identify topics discussed but no decision made, open-ended discussions, or unanswered questions.' : 'Empty array (Advanced Feature)'}
         ${isAdvanced ? `
         - Do NOT include topics that already have decisions.
         - Avoid trivial or minor points.
         - Focus on meaningful gaps.
         - For each, provide: id, topic (title), context (short explanation), reasonUnresolved (why it remains open), and suggestedAction (next step).
         ` : ''}
      7. Decision Clarity: A brief assessment of how clear and solid the current direction is.
      8. Next Actions: Specific, concrete steps to take now.
  
      RULES:
      - Be critical and analytical.
      - Do not just summarize; find the "thinking" behind the words.
      - Use a professional, high-level executive tone.
      - Return ONLY valid JSON.
      ${!isAdvanced ? '- LIMITATION: Provide only basic insights. Keep responses concise.' : ''}
    `;

    try {
      console.log("GEMINI REQUEST");
      const response = await aiGen.models.generateContent({
        model,
        contents: [{ parts: [{ text: prompt }] }],
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              keyDecisions: { type: Type.ARRAY, items: { type: Type.STRING } },
              assumptions: { type: Type.ARRAY, items: { type: Type.STRING } },
              risksAndGaps: { type: Type.ARRAY, items: { type: Type.STRING } },
              alternativePerspectives: { type: Type.ARRAY, items: { type: Type.STRING } },
              ignoredQuestions: { type: Type.ARRAY, items: { type: Type.STRING } },
              unresolvedTopics: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    topic: { type: Type.STRING },
                    context: { type: Type.STRING },
                    reasonUnresolved: { type: Type.STRING },
                    suggestedAction: { type: Type.STRING },
                  },
                  required: ["id", "topic", "context", "reasonUnresolved", "suggestedAction"],
                },
              },
              decisionClarity: { type: Type.STRING },
              nextActions: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ["keyDecisions", "assumptions", "risksAndGaps", "alternativePerspectives", "ignoredQuestions", "unresolvedTopics", "decisionClarity", "nextActions"],
          },
        },
      });

      const inputTokens = response.usageMetadata?.promptTokenCount || 0;
      const outputTokens = response.usageMetadata?.candidatesTokenCount || 0;
      const duration = Date.now() - start;

      console.log("TRACKAIUSAGE CALLED");
      await trackAIUsage({
        userId: userId || "anonymous",
        email: email || "anonymous@echotechai.in",
        plan: plan || "guest",
        featureName,
        modelUsed: model,
        inputTokens,
        outputTokens,
        requestDuration: duration,
        status: "success",
      });
      console.log("FIRESTORE WRITE SUCCESS");

      console.log("RESPONSE RETURNED");
      res.json(JSON.parse(response.text || "{}"));
    } catch (error: any) {
      console.error(`[AI Endpoint Error] ${featureName}:`, error);
      const duration = Date.now() - start;
      await trackAIUsage({
        userId: userId || "anonymous",
        email: email || "anonymous@echotechai.in",
        plan: plan || "guest",
        featureName,
        modelUsed: model,
        inputTokens: 0,
        outputTokens: 0,
        requestDuration: duration,
        status: "failure",
      });
      res.status(500).json({ error: error.message || "Execution failed" });
    }
  });

  app.post("/api/ai/unified-meeting-intelligence", async (req, res) => {
    const { transcript, tier, userId, email, plan } = req.body;
    const start = Date.now();
    const model = 'gemini-3-flash-preview';
    const featureName = "Meeting Intelligence";

    if (!transcript) return res.status(400).json({ error: "Missing transcript content" });
    const isAdvanced = tier !== 'guest';

    const prompt = `
      You are the EchoNote Decision Intelligence workspace engine. 
      Your task is to transform a raw meeting transcript into a unified, interconnected intelligence output.
      
      PLAN LEVEL: ${isAdvanced ? 'ADVANCED (Full Insights)' : 'BASIC (Limited Insights)'}
  
      INPUT (TRANSCRIPT):
      ${transcript}
  
      OUTPUT (STRICT UNIFIED JSON SCHEMA):
      1. title: A concise, professional title.
      2. summary: ${isAdvanced ? '5-7' : '2-3'} critical bullet points.
      3. topics: Categorized discussion points.
      4. keyInsights: ${isAdvanced ? 'High-level strategic takeaways' : 'Basic observations'}.
      5. decisions: Array of UnifiedDecision objects.
         - id: Unique ID (e.g., "dec-1").
         - title: Short title.
         - description: Detailed explanation.
         - context: Why it was made.
         - peopleInvolved: List of speakers.
         - confidenceLevel: High/Medium/Low.
         - relatedTaskIds: Array of IDs from the 'tasks' section.
      6. tasks: Array of UnifiedTask objects.
         - id: Unique ID (e.g., "task-1").
         - description: Actionable description.
         - assignee: Person responsible (or "Unassigned").
         - deadline: Optional deadline.
         - priority: High/Medium/Low.
         - relatedDecisionId: ID of the decision that triggered this task (if any).
      7. unresolved_topics: Array of objects.
         - id: Unique ID (e.g., "unres-1").
         - topic: Topic title.
         - context: Short explanation.
         - reasonUnresolved: Why it remains open (e.g., no decision made, open-ended discussion, unanswered question).
         - suggestedAction: A specific recommendation for the next step.
      8. execution_tracker: ExecutionTracker object.
         - totalTasks: Total number of tasks.
         - completedTasks: Number of completed tasks (Do NOT assume completion unless specified).
         - pendingTasks: Number of pending tasks.
         - overdueTasks: Number of overdue tasks (based on current date if deadline passed).
         - completionRate: Percentage of completed tasks.
         - delayRate: Percentage of overdue tasks.
         - tasks: Array of objects.
           - id: Unique ID.
           - description: Task description.
           - assignee: Assigned person.
           - status: Status (Completed / Pending / Overdue).
         - keyInsights: Array of concise, meaningful insights (e.g., "Low execution rate", "High delays").
      9. meetingIntelligence: MeetingIntelligence object.
         - productivityScore (0-100)
         - productivityExplanation
         - clarityScore (0-100)
         - clarityExplanation
         - actionabilityScore (0-100)
         - actionabilityExplanation
         - effectivenessSummary
         - keyStrengths (array)
         - keyWeaknesses (array)
      10. strategicAnalysis: StrategicAnalysis object.
         - coreIntent
         - context
         - assumptions (array)
         - logicalGaps (array)
         - blindSpots (array)
         - strategicQuestions (array)
         - recommendations (array)
         - alternativePerspectives (array)
         - ignoredQuestions (array)
         - unresolvedTopics (array of objects with id, topic, context, reasonUnresolved, suggestedAction)
         - decisionFramework
         - nextSteps (array)
      11. followUp: FollowUp object.
         - email (draft)
         - nextMeetingAgenda (array)
         - keyPendingItems (array)
      12. calendar_reminders: SmartReminderSystem object.
         - reminders: Array of objects.
           - id: Unique ID.
           - title: Reminder title.
           - description: Detailed description.
           - suggestedDateTime: ISO 8601 string.
           - priority: "High" | "Medium" | "Low".
           - group: "Immediate" | "Upcoming" | "Long-term".
           - calendarEventFormat: Object.
             - title: Event title.
             - description: Event description.
             - location: Optional location.
             - startTime: ISO 8601 string.
             - endTime: ISO 8601 string.
         - summary: A brief summary of the reminder strategy.
  
      CRITICAL RULES:
      - Decisions ↔ Related Tasks: Link them using IDs.
      - Tasks ↔ People: Ensure assignees match speaker names where possible.
      - Unresolved Topics ↔ Suggested Actions: Provide clear paths forward.
      - NO DUPLICATE ENTRIES: Do not repeat information across sections.
      - CONSISTENT IDs: Use the same IDs for cross-referencing.
      - CLEAN HIERARCHY: The output must be a single, valid JSON object.
      - Unresolved Topics Detector: Identify topics discussed but no decision made, open-ended discussions, and questions that were not answered. Do NOT include topics that already have decisions. Avoid trivial or minor points. Focus on meaningful gaps.
      - Execution Tracker: Generate metrics based on extracted tasks. Do NOT assume completion unless specified. Keep insights concise and meaningful.
      - Smart Reminder System: Generate reminders for tasks and decisions requiring follow-up. Do NOT create reminders for completed tasks. Prioritize critical tasks and unresolved topics. Group reminders into: Immediate (within 24 hrs), Upcoming (within 3–7 days), Long-term. Use the current date/time as a reference: ${new Date().toISOString()}.
      ${!isAdvanced ? '- LIMITATION: Provide only basic extraction of decisions and tasks. Keep summaries very short.' : ''}
    `;

    try {
      const response = await aiGen.models.generateContent({
        model,
        contents: [{ parts: [{ text: prompt }] }],
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              summary: { type: Type.ARRAY, items: { type: Type.STRING } },
              topics: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    category: { type: Type.STRING },
                    items: { type: Type.ARRAY, items: { type: Type.STRING } },
                  },
                  required: ["category", "items"],
                },
              },
              keyInsights: { type: Type.ARRAY, items: { type: Type.STRING } },
              decisions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    title: { type: Type.STRING },
                    description: { type: Type.STRING },
                    context: { type: Type.STRING },
                    peopleInvolved: { type: Type.ARRAY, items: { type: Type.STRING } },
                    confidenceLevel: { type: Type.STRING, enum: ["High", "Medium", "Low"] },
                    relatedTaskIds: { type: Type.ARRAY, items: { type: Type.STRING } },
                  },
                  required: ["id", "title", "description", "context", "peopleInvolved", "confidenceLevel", "relatedTaskIds"],
                },
              },
              tasks: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    description: { type: Type.STRING },
                    assignee: { type: Type.STRING },
                    deadline: { type: Type.STRING },
                    priority: { type: Type.STRING, enum: ["High", "Medium", "Low"] },
                    relatedDecisionId: { type: Type.STRING },
                  },
                  required: ["id", "description", "assignee", "priority"],
                },
              },
              unresolved_topics: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    topic: { type: Type.STRING },
                    context: { type: Type.STRING },
                    reasonUnresolved: { type: Type.STRING },
                    suggestedAction: { type: Type.STRING },
                  },
                  required: ["id", "topic", "context", "reasonUnresolved", "suggestedAction"],
                },
              },
              execution_tracker: {
                type: Type.OBJECT,
                properties: {
                  totalTasks: { type: Type.NUMBER },
                  completedTasks: { type: Type.NUMBER },
                  pendingTasks: { type: Type.NUMBER },
                  overdueTasks: { type: Type.NUMBER },
                  completionRate: { type: Type.NUMBER },
                  delayRate: { type: Type.NUMBER },
                  tasks: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        id: { type: Type.STRING },
                        description: { type: Type.STRING },
                        assignee: { type: Type.STRING },
                        status: { type: Type.STRING, enum: ["Completed", "Pending", "Overdue"] },
                      },
                      required: ["id", "description", "assignee", "status"],
                    },
                  },
                  keyInsights: { type: Type.ARRAY, items: { type: Type.STRING } },
                },
                required: ["totalTasks", "completedTasks", "pendingTasks", "overdueTasks", "completionRate", "delayRate", "tasks", "keyInsights"],
              },
              meetingIntelligence: {
                type: Type.OBJECT,
                properties: {
                  productivityScore: { type: Type.NUMBER },
                  productivityExplanation: { type: Type.STRING },
                  clarityScore: { type: Type.NUMBER },
                  clarityExplanation: { type: Type.STRING },
                  actionabilityScore: { type: Type.NUMBER },
                  actionabilityExplanation: { type: Type.STRING },
                  effectivenessSummary: { type: Type.STRING },
                  keyStrengths: { type: Type.ARRAY, items: { type: Type.STRING } },
                  keyWeaknesses: { type: Type.ARRAY, items: { type: Type.STRING } },
                },
                required: ["productivityScore", "productivityExplanation", "clarityScore", "clarityExplanation", "actionabilityScore", "actionabilityExplanation", "effectivenessSummary", "keyStrengths", "keyWeaknesses"],
              },
              strategicAnalysis: {
                type: Type.OBJECT,
                properties: {
                  coreIntent: { type: Type.STRING },
                  context: { type: Type.STRING },
                  assumptions: { type: Type.ARRAY, items: { type: Type.STRING } },
                  logicalGaps: { type: Type.ARRAY, items: { type: Type.STRING } },
                  blindSpots: { type: Type.ARRAY, items: { type: Type.STRING } },
                  strategicQuestions: { type: Type.ARRAY, items: { type: Type.STRING } },
                  recommendations: { type: Type.ARRAY, items: { type: Type.STRING } },
                  alternativePerspectives: { type: Type.ARRAY, items: { type: Type.STRING } },
                  ignoredQuestions: { type: Type.ARRAY, items: { type: Type.STRING } },
                  unresolvedTopics: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        id: { type: Type.STRING },
                        topic: { type: Type.STRING },
                        context: { type: Type.STRING },
                        reasonUnresolved: { type: Type.STRING },
                        suggestedAction: { type: Type.STRING },
                      },
                      required: ["id", "topic", "context", "reasonUnresolved", "suggestedAction"],
                    },
                  },
                  decisionFramework: { type: Type.STRING },
                  nextSteps: { type: Type.ARRAY, items: { type: Type.STRING } },
                },
                required: ["coreIntent", "context", "assumptions", "logicalGaps", "blindSpots", "strategicQuestions", "recommendations", "alternativePerspectives", "ignoredQuestions", "unresolvedTopics", "decisionFramework", "nextSteps"],
              },
              followUp: {
                type: Type.OBJECT,
                properties: {
                  email: { type: Type.STRING },
                  nextMeetingAgenda: { type: Type.ARRAY, items: { type: Type.STRING } },
                  keyPendingItems: { type: Type.ARRAY, items: { type: Type.STRING } },
                },
                required: ["email", "nextMeetingAgenda", "keyPendingItems"],
              },
              calendar_reminders: {
                type: Type.OBJECT,
                properties: {
                  reminders: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        id: { type: Type.STRING },
                        title: { type: Type.STRING },
                        description: { type: Type.STRING },
                        suggestedDateTime: { type: Type.STRING },
                        priority: { type: Type.STRING, enum: ["High", "Medium", "Low"] },
                        group: { type: Type.STRING, enum: ["Immediate", "Upcoming", "Long-term"] },
                        calendarEventFormat: {
                          type: Type.OBJECT,
                          properties: {
                            title: { type: Type.STRING },
                            description: { type: Type.STRING },
                            location: { type: Type.STRING },
                            startTime: { type: Type.STRING },
                            endTime: { type: Type.STRING },
                          },
                          required: ["title", "description", "startTime", "endTime"],
                        },
                      },
                      required: ["id", "title", "description", "suggestedDateTime", "priority", "group", "calendarEventFormat"],
                    },
                  },
                  summary: { type: Type.STRING },
                },
                required: ["reminders", "summary"],
              },
            },
            required: ["title", "summary", "topics", "keyInsights", "decisions", "tasks", "unresolved_topics", "execution_tracker", "meetingIntelligence", "strategicAnalysis", "followUp", "calendar_reminders"],
          },
        },
      });

      const inputTokens = response.usageMetadata?.promptTokenCount || 0;
      const outputTokens = response.usageMetadata?.candidatesTokenCount || 0;
      const duration = Date.now() - start;

      await trackAIUsage({
        userId: userId || "anonymous",
        email: email || "anonymous@echotechai.in",
        plan: plan || "guest",
        featureName,
        modelUsed: model,
        inputTokens,
        outputTokens,
        requestDuration: duration,
        status: "success",
      });

      const rawData = JSON.parse(response.text || "{}");
      res.json({
        ...rawData,
        unresolvedTopics: rawData.unresolved_topics,
        executionTracker: rawData.execution_tracker,
        calendarReminders: rawData.calendar_reminders
      });
    } catch (error: any) {
      console.error(`[AI Endpoint Error] ${featureName}:`, error);
      const duration = Date.now() - start;
      await trackAIUsage({
        userId: userId || "anonymous",
        email: email || "anonymous@echotechai.in",
        plan: plan || "guest",
        featureName,
        modelUsed: model,
        inputTokens: 0,
        outputTokens: 0,
        requestDuration: duration,
        status: "failure",
      });
      res.status(500).json({ error: error.message || "Execution failed" });
    }
  });

  app.post("/api/ai/process-audio-transcription", async (req, res) => {
    const { audioBase64, mimeType, userId, email, plan } = req.body;
    const start = Date.now();
    const model = "gemini-2.5-flash-native-audio-preview-12-2025";
    const featureName = "Intelligence Transcription";

    if (!audioBase64) return res.status(400).json({ error: "Missing audio base64 content" });

    const prompt = `
      Analyze this audio. Provide a speaker-wise transcript. 
      Identify speakers as 'Speaker A', 'Speaker B', etc. 
      Also provide a high-level executive summary and a list of specific action items.
      Return the data in the following JSON format:
      {
        "summary": "string",
        "actionItems": ["string"],
        "segments": [
          { "speaker": "string", "text": "string", "startTime": number, "endTime": number }
        ]
      }
    `;

    try {
      const response = await aiGen.models.generateContent({
        model,
        contents: [
          {
            inlineData: {
              data: audioBase64,
              mimeType
            }
          },
          { text: prompt }
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: { type: Type.STRING },
              actionItems: { type: Type.ARRAY, items: { type: Type.STRING } },
              segments: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    speaker: { type: Type.STRING },
                    text: { type: Type.STRING },
                    startTime: { type: Type.NUMBER },
                    endTime: { type: Type.NUMBER }
                  },
                  required: ["speaker", "text", "startTime", "endTime"]
                }
              }
            },
            required: ["summary", "actionItems", "segments"]
          }
        }
      });

      const inputTokens = response.usageMetadata?.promptTokenCount || 0;
      const outputTokens = response.usageMetadata?.candidatesTokenCount || 0;
      const duration = Date.now() - start;

      await trackAIUsage({
        userId: userId || "anonymous",
        email: email || "anonymous@echotechai.in",
        plan: plan || "guest",
        featureName,
        modelUsed: model,
        inputTokens,
        outputTokens,
        requestDuration: duration,
        status: "success",
      });

      res.json(JSON.parse(response.text || "{}"));
    } catch (error: any) {
      console.error(`[AI Endpoint Error] ${featureName}:`, error);
      const duration = Date.now() - start;
      await trackAIUsage({
        userId: userId || "anonymous",
        email: email || "anonymous@echotechai.in",
        plan: plan || "guest",
        featureName,
        modelUsed: model,
        inputTokens: 0,
        outputTokens: 0,
        requestDuration: duration,
        status: "failure",
      });
      res.status(500).json({ error: error.message || "Execution failed" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    // Correct catch-all for SPA in Express
    app.get("*all", (req, res) => {
      // If the request was for a file (has an extension) but reached here, 
      // it means the file is missing in dist. We should probably NOT send index.html 
      // for missing assets as it leads to confusing 200 OK HTML responses.
      if (req.path.includes('.')) {
        return res.status(404).json({ error: "Asset not found" });
      }
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});

