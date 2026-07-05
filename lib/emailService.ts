import { Resend } from "resend";

// Reusable configurations
const COMPANY_NAME = "EchoNote";
const COMPANY_WEBSITE = "https://www.echotechai.in";
const SUPPORT_EMAIL = "support@echotechai.in";
const PRIMARY_COLOR = "#1A234E"; // Premium Navy Blue
const ACCENT_COLOR = "#3B82F6";  // Action Blue
const TEXT_COLOR = "#334155";    // Slate Gray

let resendInstance: Resend | null = null;

// Lazy initialization of Resend client to avoid crashing on startup if key is missing
function getResendClient(): Resend {
  if (!resendInstance) {
    const key = process.env.RESEND_API_KEY;
    if (!key) {
      console.warn("⚠️ WARNING: RESEND_API_KEY environment variable is not defined. Email service will run in mock mode.");
    }
    // Fallback key or empty key is handled gracefully in mock mode
    resendInstance = new Resend(key || "mock_key");
  }
  return resendInstance;
}

/**
 * Shared HTML email wrapper with consistent EchoNote premium corporate branding.
 */
function wrapInBaseTemplate(options: {
  title: string;
  preheaderText: string;
  bodyContentHtml: string;
}): string {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta name="color-scheme" content="light dark">
      <meta name="supported-color-schemes" content="light dark">
      <title>${options.title}</title>
      <!--[if mso]>
      <style type="text/css">
        table { border-collapse: collapse; }
        td, th, p, a, h1, h2, h3 { font-family: sans-serif !important; }
      </style>
      <![endif]-->
      <style type="text/css">
        @media only screen and (max-width: 620px) {
          .wrapper { padding: 10px !important; }
          .container { width: 100% !important; border-radius: 0 !important; }
          .button { display: block !important; width: 100% !important; text-align: center !important; padding-left: 0 !important; padding-right: 0 !important; }
        }
      </style>
    </head>
    <body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; color: ${TEXT_COLOR};">
      <!-- Preheader text for inbox previews -->
      <div style="display: none; max-height: 0px; overflow: hidden; font-size: 1px; color: #f8fafc; line-height: 1px;">
        ${options.preheaderText}
      </div>

      <div class="wrapper" style="background-color: #f8fafc; padding: 40px 20px; text-align: center;">
        <!-- Email Card Container -->
        <table class="container" cellpadding="0" cellspacing="0" border="0" style="width: 100%; max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; border-top: 5px solid ${PRIMARY_COLOR}; overflow: hidden; text-align: left; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
          
          <!-- Logo & Header Section -->
          <tr>
            <td style="padding: 35px 40px 20px 40px; text-align: center; border-bottom: 1px solid #f1f5f9;">
              <div style="font-size: 24px; font-weight: 800; color: ${PRIMARY_COLOR}; letter-spacing: -0.5px;">
                E C H O <span style="color: ${ACCENT_COLOR}; font-weight: 500;">N O T E</span>
              </div>
              <div style="font-size: 11px; text-transform: uppercase; font-weight: 700; letter-spacing: 2px; color: #94a3b8; margin-top: 4px;">
                Enterprise Audio Intelligence
              </div>
            </td>
          </tr>

          <!-- Main Content Section -->
          <tr>
            <td style="padding: 40px 40px 30px 40px;">
              ${options.bodyContentHtml}
            </td>
          </tr>

          <!-- Corporate Footer -->
          <tr>
            <td style="padding: 30px 40px; background-color: #f8fafc; border-top: 1px solid #f1f5f9; text-align: center;">
              <p style="margin: 0; font-size: 13px; font-weight: 600; color: #64748b;">
                Need help or have questions?
              </p>
              <p style="margin: 5px 0 20px 0; font-size: 13px; color: #94a3b8;">
                We are available 24/7. Reach out at <a href="mailto:${SUPPORT_EMAIL}" style="color: ${ACCENT_COLOR}; text-decoration: none; font-weight: 500;">${SUPPORT_EMAIL}</a>
              </p>
              <hr style="border: 0; border-top: 1px solid #e2e8f0; margin-bottom: 20px;">
              <p style="margin: 0; font-size: 11px; color: #94a3b8; line-height: 1.6;">
                © ${new Date().getFullYear()} ${COMPANY_NAME} Technologies. All rights reserved.<br>
                This is an automated operational transmission. Please do not reply directly to this address.
              </p>
              <p style="margin: 10px 0 0 0; font-size: 11px; color: #cbd5e1;">
                <a href="${COMPANY_WEBSITE}" style="color: #94a3b8; text-decoration: underline;">Website</a> &nbsp;•&nbsp; 
                <a href="${COMPANY_WEBSITE}/privacy" style="color: #94a3b8; text-decoration: underline;">Privacy Policy</a> &nbsp;•&nbsp; 
                <a href="${COMPANY_WEBSITE}/terms" style="color: #94a3b8; text-decoration: underline;">Terms of Service</a>
              </p>
            </td>
          </tr>
        </table>
      </div>
    </body>
    </html>
  `;
}

/**
 * Shared Button component generator.
 */
function renderButton(text: string, url: string): string {
  return `
    <table cellpadding="0" cellspacing="0" border="0" style="margin: 30px 0;">
      <tr>
        <td style="border-radius: 8px; background-color: ${PRIMARY_COLOR}; text-align: center;">
          <a class="button" href="${url}" target="_blank" style="display: inline-block; padding: 14px 28px; background-color: ${PRIMARY_COLOR}; color: #ffffff; text-decoration: none; border-radius: 8px; font-size: 15px; font-weight: 700; border: 1px solid ${PRIMARY_COLOR}; letter-spacing: -0.2px;">
            ${text}
          </a>
        </td>
      </tr>
    </table>
  `;
}

/**
 * Helper to execute sending via Resend or log as mock when API key is missing.
 */
async function sendEmail(options: {
  to: string;
  subject: string;
  html: string;
}): Promise<{ success: boolean; id?: string; error?: any }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(`[MOCK EMAIL SERVICE] To: ${options.to} | Subject: ${options.subject}`);
    console.log(`[MOCK EMAIL SERVICE] HTML: ${options.html.slice(0, 300)}...`);
    return { success: true, id: `mock_${Date.now()}` };
  }

  try {
    const resend = getResendClient();
    const response = await resend.emails.send({
      from: 'EchoNote <no-reply@resend.dev>', // Resend verified domain or default sandbox
      to: options.to,
      subject: options.subject,
      html: options.html
    });

    if (response.error) {
      console.error("❌ Resend API returned error:", response.error);
      return { success: false, error: response.error };
    }

    return { success: true, id: response.data?.id };
  } catch (error: any) {
    console.error("🔥 Email Service Error:", error);
    return { success: false, error: error.message || error };
  }
}

/**
 * Email Templates Module & Functions
 */
export const emailService = {
  /**
   * 1. Send Password Reset Email
   */
  async sendPasswordReset(to: string, options: { name: string; resetLink: string }) {
    const title = "Reset Your Password";
    const preheaderText = "Forgot your password? Follow these steps to reset your password and secure your EchoNote account.";
    
    const bodyContentHtml = `
      <h1 style="margin: 0 0 15px 0; font-size: 22px; font-weight: 800; color: ${PRIMARY_COLOR}; letter-spacing: -0.5px;">Password Reset Request</h1>
      <p style="margin: 0 0 15px 0; font-size: 15px; line-height: 1.6; color: ${TEXT_COLOR};">
        Hi ${options.name || 'there'},
      </p>
      <p style="margin: 0 0 20px 0; font-size: 15px; line-height: 1.6; color: ${TEXT_COLOR};">
        We received a request to reset the password associated with your EchoNote account. Security is our top priority, and we're here to help you get back on track safely.
      </p>
      <p style="margin: 0 0 20px 0; font-size: 15px; line-height: 1.6; color: ${TEXT_COLOR};">
        Click the secure link below to establish a new password for your account. This invitation link will expire in 1 hour.
      </p>
      
      ${renderButton("Reset Password", options.resetLink)}

      <p style="margin: 25px 0 0 0; font-size: 13px; line-height: 1.5; color: #64748b;">
        If you did not initiate this request, you can safely ignore this message. Your password will remain unchanged and your account secure.
      </p>
      <hr style="border: 0; border-top: 1px solid #f1f5f9; margin: 25px 0;">
      <p style="margin: 0; font-size: 12px; color: #94a3b8; line-height: 1.5; word-break: break-all;">
        If the button doesn't work, copy and paste this address into your browser:<br>
        <a href="${options.resetLink}" style="color: ${ACCENT_COLOR}; text-decoration: underline;">${options.resetLink}</a>
      </p>
    `;

    const html = wrapInBaseTemplate({ title, preheaderText, bodyContentHtml });
    return sendEmail({ to, subject: "EchoNote: Reset Your Password", html });
  },

  /**
   * 2. Send Team Invitation Email
   */
  async sendTeamInvitation(to: string, options: { 
    inviterName: string; 
    projectName: string; 
    role: string; 
    inviteLink: string; 
  }) {
    const title = "Collaborate on EchoNote Project";
    const preheaderText = `${options.inviterName} has invited you to collaborate on the project "${options.projectName}" on EchoNote.`;
    
    const bodyContentHtml = `
      <h1 style="margin: 0 0 15px 0; font-size: 22px; font-weight: 800; color: ${PRIMARY_COLOR}; letter-spacing: -0.5px;">Team Collaboration Invite</h1>
      <p style="margin: 0 0 15px 0; font-size: 15px; line-height: 1.6; color: ${TEXT_COLOR};">
        Hello,
      </p>
      <p style="margin: 0 0 20px 0; font-size: 15px; line-height: 1.6; color: ${TEXT_COLOR};">
        <strong>${options.inviterName}</strong> has invited you to join the workspace and collaborate on the team project <strong>"${options.projectName}"</strong> on EchoNote.
      </p>
      <div style="background-color: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0; padding: 15px 20px; margin: 25px 0;">
        <table cellpadding="0" cellspacing="0" border="0" style="width: 100%;">
          <tr>
            <td style="font-size: 14px; color: #64748b; font-weight: 600; padding-bottom: 5px; width: 120px;">Project:</td>
            <td style="font-size: 14px; color: ${PRIMARY_COLOR}; font-weight: 700; padding-bottom: 5px;">${options.projectName}</td>
          </tr>
          <tr>
            <td style="font-size: 14px; color: #64748b; font-weight: 600;">Your Role:</td>
            <td style="font-size: 14px; color: ${PRIMARY_COLOR}; font-weight: 700; text-transform: capitalize;">${options.role}</td>
          </tr>
        </table>
      </div>
      <p style="margin: 0 0 20px 0; font-size: 15px; line-height: 1.6; color: ${TEXT_COLOR};">
        As a team member, you will be able to review transcription recordings, collaborate on structured action items, review decision histories, and leverage Gemini AI to discover deeper conversational insights.
      </p>
      
      ${renderButton("Accept Team Invitation", options.inviteLink)}

      <hr style="border: 0; border-top: 1px solid #f1f5f9; margin: 25px 0;">
      <p style="margin: 0; font-size: 12px; color: #94a3b8; line-height: 1.5; word-break: break-all;">
        Or copy and paste this URL into your browser:<br>
        <a href="${options.inviteLink}" style="color: ${ACCENT_COLOR}; text-decoration: underline;">${options.inviteLink}</a>
      </p>
    `;

    const html = wrapInBaseTemplate({ title, preheaderText, bodyContentHtml });
    return sendEmail({ to, subject: `EchoNote: ${options.inviterName} invited you to collaborate`, html });
  },

  /**
   * 3. Send Organization Invitation Email
   */
  async sendOrganizationInvitation(to: string, options: { 
    inviterName: string; 
    orgName: string; 
    role: string; 
    inviteLink: string; 
  }) {
    const title = "Join Organization on EchoNote";
    const preheaderText = `${options.inviterName} has invited you to join their Organization "${options.orgName}" on EchoNote.`;
    
    const bodyContentHtml = `
      <h1 style="margin: 0 0 15px 0; font-size: 22px; font-weight: 800; color: ${PRIMARY_COLOR}; letter-spacing: -0.5px;">Corporate Invitation</h1>
      <p style="margin: 0 0 15px 0; font-size: 15px; line-height: 1.6; color: ${TEXT_COLOR};">
        Hello,
      </p>
      <p style="margin: 0 0 20px 0; font-size: 15px; line-height: 1.6; color: ${TEXT_COLOR};">
        <strong>${options.inviterName}</strong> has invited you to join their enterprise workspace <strong>"${options.orgName}"</strong> as part of the corporate team on EchoNote.
      </p>
      <div style="background-color: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0; padding: 15px 20px; margin: 25px 0;">
        <table cellpadding="0" cellspacing="0" border="0" style="width: 100%;">
          <tr>
            <td style="font-size: 14px; color: #64748b; font-weight: 600; padding-bottom: 5px; width: 120px;">Organization:</td>
            <td style="font-size: 14px; color: ${PRIMARY_COLOR}; font-weight: 700; padding-bottom: 5px;">${options.orgName}</td>
          </tr>
          <tr>
            <td style="font-size: 14px; color: #64748b; font-weight: 600;">Authorized Role:</td>
            <td style="font-size: 14px; color: ${PRIMARY_COLOR}; font-weight: 700; text-transform: capitalize;">${options.role}</td>
          </tr>
        </table>
      </div>
      <p style="margin: 0 0 20px 0; font-size: 15px; line-height: 1.6; color: ${TEXT_COLOR};">
        By joining this organization, you will share team repositories, pool centralized minute balances, collaborate securely on enterprise audio workflows, and maintain single-sign-on administrative guidelines.
      </p>
      
      ${renderButton("Accept Organization Invitation", options.inviteLink)}

      <hr style="border: 0; border-top: 1px solid #f1f5f9; margin: 25px 0;">
      <p style="margin: 0; font-size: 12px; color: #94a3b8; line-height: 1.5; word-break: break-all;">
        Or copy and paste this URL into your browser:<br>
        <a href="${options.inviteLink}" style="color: ${ACCENT_COLOR}; text-decoration: underline;">${options.inviteLink}</a>
      </p>
    `;

    const html = wrapInBaseTemplate({ title, preheaderText, bodyContentHtml });
    return sendEmail({ to, subject: `EchoNote: Invitation to join ${options.orgName}`, html });
  },

  /**
   * 4. Send Welcome Email
   */
  async sendWelcome(to: string, options: { name: string; dashboardLink: string }) {
    const title = "Welcome to EchoNote";
    const preheaderText = "We are thrilled to welcome you to EchoNote. Get started with enterprise audio intelligence today.";
    
    const bodyContentHtml = `
      <h1 style="margin: 0 0 15px 0; font-size: 22px; font-weight: 800; color: ${PRIMARY_COLOR}; letter-spacing: -0.5px;">Welcome to EchoNote!</h1>
      <p style="margin: 0 0 15px 0; font-size: 15px; line-height: 1.6; color: ${TEXT_COLOR};">
        Hi ${options.name || 'there'},
      </p>
      <p style="margin: 0 0 15px 0; font-size: 15px; line-height: 1.6; color: ${TEXT_COLOR};">
        Thank you for choosing EchoNote. We are committed to helping you and your team transform conversations into high-impact corporate intelligence, structured tasks, and concrete action plans.
      </p>
      <p style="margin: 0 0 20px 0; font-size: 15px; line-height: 1.6; color: ${TEXT_COLOR};">
        Here are three quick ways to leverage EchoNote today:
      </p>
      <ol style="margin: 0 0 25px 0; padding-left: 20px; font-size: 14px; line-height: 1.7; color: ${TEXT_COLOR};">
        <li style="margin-bottom: 8px;"><strong>Record or Upload Audio:</strong> Easily capture any corporate meeting, call, or dictation inside our high-fidelity secure workspace.</li>
        <li style="margin-bottom: 8px;"><strong>Harness Gemini Intelligence:</strong> Click to transcribe instantly, detect logical assumptions, map critical decision gaps, and structure your action items.</li>
        <li style="margin-bottom: 8px;"><strong>Collaborate with Teams:</strong> Invite partners to co-author, share real-time audio transcripts, and track team executions on dashboard lists.</li>
      </ol>
      
      ${renderButton("Launch EchoNote Dashboard", options.dashboardLink)}

      <p style="margin: 25px 0 0 0; font-size: 14px; line-height: 1.6; color: ${TEXT_COLOR};">
        Warm regards,<br>
        <strong>The EchoNote Executive Team</strong>
      </p>
    `;

    const html = wrapInBaseTemplate({ title, preheaderText, bodyContentHtml });
    return sendEmail({ to, subject: "Welcome to EchoNote: Let’s transform your meetings", html });
  },

  /**
   * 5. Send Subscription Confirmation Email
   */
  async sendSubscriptionConfirmation(to: string, options: { 
    name: string; 
    planName: string; 
    amount: string; 
    billingCycle: string; 
    nextBillingDate: string; 
  }) {
    const title = "Subscription Confirmed";
    const preheaderText = `Thank you for subscribing to EchoNote ${options.planName}. Your upgrade was successful and your premium features are ready.`;
    
    const bodyContentHtml = `
      <h1 style="margin: 0 0 15px 0; font-size: 22px; font-weight: 800; color: ${PRIMARY_COLOR}; letter-spacing: -0.5px;">Subscription Upgraded!</h1>
      <p style="margin: 0 0 15px 0; font-size: 15px; line-height: 1.6; color: ${TEXT_COLOR};">
        Hi ${options.name || 'there'},
      </p>
      <p style="margin: 0 0 20px 0; font-size: 15px; line-height: 1.6; color: ${TEXT_COLOR};">
        Your subscription to <strong>EchoNote ${options.planName}</strong> has been successfully processed! You now have unlocked premium access to advanced corporate workflows and unlimited Gemini-powered analyses.
      </p>
      
      <div style="background-color: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0; padding: 15px 20px; margin: 25px 0;">
        <h3 style="margin: 0 0 12px 0; font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #64748b;">Subscription Details</h3>
        <table cellpadding="0" cellspacing="0" border="0" style="width: 100%;">
          <tr>
            <td style="font-size: 14px; color: #64748b; padding-bottom: 6px; width: 140px;">Selected Tier:</td>
            <td style="font-size: 14px; color: ${PRIMARY_COLOR}; font-weight: 700; padding-bottom: 6px;">EchoNote ${options.planName}</td>
          </tr>
          <tr>
            <td style="font-size: 14px; color: #64748b; padding-bottom: 6px;">Billing Frequency:</td>
            <td style="font-size: 14px; color: ${PRIMARY_COLOR}; font-weight: 700; padding-bottom: 6px; text-transform: capitalize;">${options.billingCycle}</td>
          </tr>
          <tr>
            <td style="font-size: 14px; color: #64748b; padding-bottom: 6px;">Amount Charged:</td>
            <td style="font-size: 14px; color: ${PRIMARY_COLOR}; font-weight: 700; padding-bottom: 6px;">${options.amount}</td>
          </tr>
          <tr>
            <td style="font-size: 14px; color: #64748b;">Renewal Date:</td>
            <td style="font-size: 14px; color: ${PRIMARY_COLOR}; font-weight: 700;">${options.nextBillingDate}</td>
          </tr>
        </table>
      </div>

      <p style="margin: 0 0 20px 0; font-size: 15px; line-height: 1.6; color: ${TEXT_COLOR};">
        Your new features (extended recording capacity, collaborative workspaces, and high-priority strategic intelligence models) are fully active and available immediately.
      </p>
      
      ${renderButton("Access Premium Features", "https://www.echotechai.in")}

      <p style="margin: 20px 0 0 0; font-size: 13px; color: #64748b;">
        You can manage, change, or review your billing history anytime inside your corporate Profile Settings panel.
      </p>
    `;

    const html = wrapInBaseTemplate({ title, preheaderText, bodyContentHtml });
    return sendEmail({ to, subject: `EchoNote: ${options.planName} Subscription Confirmed`, html });
  },

  /**
   * 6. Send Payment Receipt Email
   */
  async sendPaymentReceipt(to: string, options: { 
    name: string; 
    receiptId: string; 
    amount: string; 
    date: string; 
    items: Array<{ name: string; price: string }>; 
  }) {
    const title = "EchoNote Payment Receipt";
    const preheaderText = `Official payment receipt for transaction ${options.receiptId}. Thank you for your payment.`;
    
    let itemsRowsHtml = "";
    options.items.forEach(item => {
      itemsRowsHtml += `
        <tr>
          <td style="padding: 10px 0; font-size: 14px; color: ${TEXT_COLOR}; border-bottom: 1px solid #f1f5f9;">${item.name}</td>
          <td style="padding: 10px 0; font-size: 14px; text-align: right; font-weight: 700; color: ${PRIMARY_COLOR}; border-bottom: 1px solid #f1f5f9;">${item.price}</td>
        </tr>
      `;
    });

    const bodyContentHtml = `
      <h1 style="margin: 0 0 15px 0; font-size: 22px; font-weight: 800; color: ${PRIMARY_COLOR}; letter-spacing: -0.5px;">Payment Receipt</h1>
      <p style="margin: 0 0 15px 0; font-size: 15px; line-height: 1.6; color: ${TEXT_COLOR};">
        Hi ${options.name || 'there'},
      </p>
      <p style="margin: 0 0 20px 0; font-size: 15px; line-height: 1.6; color: ${TEXT_COLOR};">
        Thank you for your transaction. This is your official payment receipt for purchase reference <strong>${options.receiptId}</strong>.
      </p>
      
      <div style="background-color: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0; padding: 20px; margin: 25px 0;">
        <table cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: #94a3b8; padding-bottom: 15px;">Transaction Reference</td>
            <td style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: #94a3b8; padding-bottom: 15px; text-align: right;">Transaction Date</td>
          </tr>
          <tr>
            <td style="font-size: 13px; color: ${PRIMARY_COLOR}; font-weight: 700; padding-bottom: 15px;">${options.receiptId}</td>
            <td style="font-size: 13px; color: ${PRIMARY_COLOR}; font-weight: 700; padding-bottom: 15px; text-align: right;">${options.date}</td>
          </tr>
          
          <tr>
            <td colspan="2" style="border-top: 1px solid #cbd5e1; padding-top: 15px;">
              <table cellpadding="0" cellspacing="0" border="0" style="width: 100%;">
                <thead>
                  <tr>
                    <th style="text-align: left; font-size: 11px; text-transform: uppercase; font-weight: 700; color: #94a3b8; padding-bottom: 8px;">Purchased Item</th>
                    <th style="text-align: right; font-size: 11px; text-transform: uppercase; font-weight: 700; color: #94a3b8; padding-bottom: 8px;">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  ${itemsRowsHtml}
                  <tr>
                    <td style="padding: 15px 0 0 0; font-size: 14px; font-weight: 800; color: ${PRIMARY_COLOR};">TOTAL PAID</td>
                    <td style="padding: 15px 0 0 0; font-size: 16px; font-weight: 800; text-align: right; color: ${PRIMARY_COLOR};">${options.amount}</td>
                  </tr>
                </tbody>
              </table>
            </td>
          </tr>
        </table>
      </div>

      <p style="margin: 0 0 20px 0; font-size: 14px; color: #64748b; line-height: 1.5; text-align: center;">
        Your payment was authorized and processed securely. This document serves as proof of payment.
      </p>
    `;

    const html = wrapInBaseTemplate({ title, preheaderText, bodyContentHtml });
    return sendEmail({ to, subject: `EchoNote Payment Receipt - ${options.receiptId}`, html });
  }
};
