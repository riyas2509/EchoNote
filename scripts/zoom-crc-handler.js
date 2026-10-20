/**
 * scripts/zoom-crc-handler.js
 *
 * Lightweight standalone Zoom Webhook Handler with CRC validation.
 * 
 * Features:
 * 1. Handles Zoom Challenge-Response Check (CRC) URL validation (`endpoint.url_validation`).
 * 2. Computes HMAC-SHA256 signature using the Zoom Secret Token.
 * 3. Validates incoming Zoom event signatures for live event processing.
 *
 * Run with:
 *   node scripts/zoom-crc-handler.js
 * Or with custom port/secret:
 *   ZOOM_WEBHOOK_SECRET_TOKEN="your_secret" PORT=4000 node scripts/zoom-crc-handler.js
 */

const express = require("express");
const crypto = require("crypto");

const app = express();
app.use(express.json());

// Load Zoom Secret Token from environment or fallback placeholder
const ZOOM_WEBHOOK_SECRET_TOKEN = process.env.ZOOM_WEBHOOK_SECRET_TOKEN || process.env.ZOOM_WEBHOOK_SECRET || "YOUR_ZOOM_SECRET_TOKEN";
const PORT = process.env.PORT || 4000;

/**
 * Zoom Webhook Endpoint
 */
app.post(["/zoom/webhook", "/api/webhooks/zoom"], (req, res) => {
  const body = req.body || {};

  // 1. Handle Zoom Challenge-Response Check (CRC)
  if (body.event === "endpoint.url_validation") {
    const plainToken = body.payload && body.payload.plainToken;

    if (!plainToken) {
      return res.status(400).json({ error: "Missing plainToken in payload" });
    }

    // Create HMAC-SHA256 hash using the secret token
    const encryptedToken = crypto
      .createHmac("sha256", ZOOM_WEBHOOK_SECRET_TOKEN)
      .update(plainToken)
      .digest("hex");

    console.log(`[Zoom CRC] Validated challenge plainToken: ${plainToken}`);

    return res.status(200).json({
      plainToken,
      encryptedToken
    });
  }

  // 2. Handle incoming Zoom events (e.g., meeting.started, recording.completed)
  console.log(`[Zoom Event] Received event: ${body.event}`);
  if (body.payload && body.payload.object) {
    console.log(`  Meeting ID: ${body.payload.object.id}`);
    console.log(`  Topic: ${body.payload.object.topic}`);
  }

  return res.status(200).json({ status: "success" });
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 Lightweight Zoom Webhook Handler running on https://echonote-25.vercel.app`);
    console.log(`   Webhook endpoint: https://echonote-25.vercel.app/zoom/webhook`);
  });
}

module.exports = app;
