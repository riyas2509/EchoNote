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
      console.warn("⚠️ WARNING: RESEND_API_KEY environment variable is not defined.");
    }
    resendInstance = new Resend(key || "");
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
 * Canonical production sender address using the verified echotechai.in domain.
 */
export const CANONICAL_SENDER_EMAIL = 'EchoNote <invitations@echotechai.in>';

/**
 * Canonical reply address.
 */
export const CANONICAL_REPLY_TO_EMAIL = 'riya@echotechai.in';

/**
 * Checks whether an email or display sender contains a forbidden resend.dev address.
 */
export function isResendDevSender(sender?: string | null): boolean {
  if (!sender) return false;
  const lower = sender.toLowerCase();
  return lower.includes('resend.dev');
}

/**
 * Safe, authoritative sender resolution for EchoNote transactional emails.
 *
 * Production Invariants:
 * 1. If NODE_ENV === "production", the sender MUST strictly be "EchoNote <invitations@echotechai.in>".
 *    Neither RESEND_FROM_EMAIL nor any external override is permitted to alter or downgrade this.
 * 2. In production, any attempt to supply a testing domain address is rejected.
 *
 * Non-Production Invariants:
 * 1. If RESEND_FROM_EMAIL is configured and does NOT contain any testing domain (*.resend.dev), use it.
 * 2. If RESEND_FROM_EMAIL is absent, empty, whitespace, or contains any testing domain (*.resend.dev),
 *    it safely resolves to the canonical verified sender "EchoNote <invitations@echotechai.in>".
 * 3. Testing domains are NEVER silently used as a default or fallback under any circumstance.
 */
export function resolveSenderEmail(): string {
  // In production, deterministically enforce the canonical verified domain sender
  if (process.env.NODE_ENV === 'production') {
    const rawEnv = process.env.RESEND_FROM_EMAIL?.trim();
    if (rawEnv && isResendDevSender(rawEnv)) {
      console.warn(`⚠️ [EMAIL SERVICE] Forbidden testing domain detected in RESEND_FROM_EMAIL (${rawEnv}). Strictly enforcing canonical sender: ${CANONICAL_SENDER_EMAIL}`);
    }
    return CANONICAL_SENDER_EMAIL;
  }

  const envVal = process.env.RESEND_FROM_EMAIL?.trim();
  if (envVal) {
    if (isResendDevSender(envVal)) {
      console.warn(`⚠️ [EMAIL SERVICE] RESEND_FROM_EMAIL contains forbidden testing domain (${envVal}). Strictly falling back to canonical verified sender: ${CANONICAL_SENDER_EMAIL}`);
      return CANONICAL_SENDER_EMAIL;
    }
    return envVal;
  }

  // Non-production fallback is also the canonical verified sender
  return CANONICAL_SENDER_EMAIL;
}

export type EmailErrorCode =
  | 'MISSING_API_KEY'
  | 'RESEND_API_ERROR'
  | 'SANDBOX_RESTRICTION'
  | 'MISSING_MESSAGE_ID'
  | 'VALIDATION_ERROR'
  | 'UNEXPECTED_EXCEPTION';

export interface EmailErrorDetail {
  code: EmailErrorCode;
  message: string;
  statusCode?: number;
  providerErrorName?: string;
  recipientMasked?: string;
}

export interface EmailSendResult {
  success: boolean;
  id?: string;
  error?: string;
  errorCode?: EmailErrorCode;
  statusCode?: number;
  isSandboxOrValidation?: boolean;
  errorDetail?: EmailErrorDetail;
}

/**
 * Mask sensitive email address for sanitized server-side diagnostics.
 */
export function maskEmailForLogs(email: string): string {
  if (!email || typeof email !== 'string' || !email.includes('@')) return '***';
  const parts = email.trim().split('@');
  const user = parts[0];
  const domain = parts.slice(1).join('@');
  const maskedUser = user.length <= 2 ? user[0] + '*' : user[0] + '***' + user[user.length - 1];
  return `${maskedUser}@${domain}`;
}

/**
 * Authoritative helper to execute sending via Resend with explicit error verification.
 * Standardizes API status inspection: checks response.error vs response.data.id.
 */
async function sendEmail(options: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string | string[];
}): Promise<EmailSendResult> {
  const maskedTo = maskEmailForLogs(options.to);
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn(`⚠️ [EMAIL SERVICE] Cannot dispatch email to ${maskedTo}: RESEND_API_KEY environment variable is not configured.`);
    return {
      success: false,
      error: 'Email service credentials not configured on server.',
      errorCode: 'MISSING_API_KEY',
      statusCode: 500,
      errorDetail: {
        code: 'MISSING_API_KEY',
        message: 'Email service credentials (RESEND_API_KEY) not configured on server.',
        statusCode: 500,
        recipientMasked: maskedTo
      }
    };
  }

  try {
    const resend = getResendClient();
    const fromAddress = resolveSenderEmail();

    // Defense-in-depth: Proactively reject any resend.dev address before sending
    if (isResendDevSender(fromAddress)) {
      console.error(`🚨 [EMAIL SERVICE] Blocked attempt to send email using forbidden testing domain sender: ${fromAddress}`);
      return {
        success: false,
        error: `Forbidden sender: '${fromAddress}' is a testing domain and cannot be used to dispatch production emails.`,
        errorCode: 'VALIDATION_ERROR',
        statusCode: 403,
        errorDetail: {
          code: 'VALIDATION_ERROR',
          message: `Forbidden sender: '${fromAddress}' contains a testing domain (resend.dev) that is rejected in production. Use '${CANONICAL_SENDER_EMAIL}'.`,
          statusCode: 403,
          recipientMasked: maskedTo
        }
      };
    }

    const payload: {
      from: string;
      to: string;
      subject: string;
      html: string;
      text?: string;
      replyTo?: string | string[];
    } = {
      from: fromAddress,
      to: options.to,
      subject: options.subject,
      html: options.html
    };
    if (options.text) {
      payload.text = options.text;
    }
    const effectiveReplyTo = options.replyTo ?? CANONICAL_REPLY_TO_EMAIL;
    if (effectiveReplyTo) {
      payload.replyTo = effectiveReplyTo;
    }

    const response = await resend.emails.send(payload);

    // Explicitly check Resend's returned error object (data.id vs error)
    if (response.error) {
      const errorObj = response.error;
      const isValidationError = errorObj.name === 'validation_error' || errorObj.statusCode === 422;
      const isSandboxLimitation = (isValidationError || errorObj.statusCode === 403) &&
        String(errorObj.message || '').toLowerCase().includes('testing email');

      let errorCode: EmailErrorCode = 'RESEND_API_ERROR';
      if (isSandboxLimitation) {
        errorCode = 'SANDBOX_RESTRICTION';
      } else if (isValidationError) {
        errorCode = 'VALIDATION_ERROR';
      }

      console.error("🚨 [EMAIL SERVICE] Resend rejected email delivery:", {
        recipient: maskedTo,
        sender: fromAddress,
        errorName: errorObj.name,
        errorMessage: errorObj.message,
        statusCode: errorObj.statusCode,
        errorCode
      });

      const formattedError = isSandboxLimitation
        ? 'Email delivery restricted: provider sandbox allows delivery only to verified account owner.'
        : (errorObj.message ? `Provider rejected dispatch: ${errorObj.message}` : 'Email provider rejected dispatch.');

      return {
        success: false,
        error: formattedError,
        errorCode,
        statusCode: errorObj.statusCode || (isValidationError ? 422 : 400),
        isSandboxOrValidation: isValidationError || isSandboxLimitation,
        errorDetail: {
          code: errorCode,
          message: errorObj.message || formattedError,
          statusCode: errorObj.statusCode,
          providerErrorName: errorObj.name,
          recipientMasked: maskedTo
        }
      };
    }

    // Explicitly verify response.data and response.data.id
    if (!response.data?.id) {
      console.error("🚨 [EMAIL SERVICE] Resend returned response without message ID (missing data.id):", {
        recipient: maskedTo,
        responseData: response.data
      });
      return {
        success: false,
        error: 'Email provider accepted dispatch without returning a message identifier.',
        errorCode: 'MISSING_MESSAGE_ID',
        statusCode: 502,
        errorDetail: {
          code: 'MISSING_MESSAGE_ID',
          message: 'Email provider accepted dispatch without returning a message identifier.',
          statusCode: 502,
          recipientMasked: maskedTo
        }
      };
    }

    console.info("✅ [EMAIL SERVICE] Email dispatched successfully:", {
      id: response.data.id,
      recipient: maskedTo
    });

    return {
      success: true,
      id: response.data.id,
      statusCode: 200
    };
  } catch (error: any) {
    console.error("🚨 [EMAIL SERVICE] Unexpected send email exception:", {
      recipient: maskedTo,
      errorMessage: error?.message || String(error)
    });
    return {
      success: false,
      error: 'Email delivery encountered an unexpected network or provider exception.',
      errorCode: 'UNEXPECTED_EXCEPTION',
      statusCode: 500,
      errorDetail: {
        code: 'UNEXPECTED_EXCEPTION',
        message: error?.message || String(error),
        statusCode: 500,
        recipientMasked: maskedTo
      }
    };
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
    html?: string;
    text?: string;
    replyTo?: string | string[];
  }): Promise<EmailSendResult> {
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

    const html = options.html || wrapInBaseTemplate({ title, preheaderText, bodyContentHtml });
    const text = options.text || `Team Collaboration Invite - EchoNote\n\n${options.inviterName} has invited you to collaborate on "${options.projectName}" on EchoNote.\nRole: ${options.role}\n\nAccept invitation:\n${options.inviteLink}\n\n© ${new Date().getFullYear()} EchoNote Technologies.`;

    return sendEmail({
      to,
      subject: `EchoNote: ${options.inviterName} invited you to collaborate`,
      html,
      text,
      replyTo: options.replyTo
    });
  },

  /**
   * 3. Send Organization Invitation Email
   */
  async sendOrganizationInvitation(to: string, options: { 
    inviterName: string; 
    orgName: string; 
    role: string; 
    inviteLink: string; 
    expiresAt?: string;
    html?: string;
    text?: string;
    replyTo?: string | string[];
  }): Promise<EmailSendResult> {
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
          ${options.expiresAt ? `
          <tr>
            <td style="font-size: 14px; color: #64748b; font-weight: 600; padding-top: 5px;">Expires on:</td>
            <td style="font-size: 14px; color: #dc2626; font-weight: 600; padding-top: 5px;">${options.expiresAt}</td>
          </tr>` : ''}
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

    const html = options.html || wrapInBaseTemplate({ title, preheaderText, bodyContentHtml });
    const text = options.text || `Organization Invitation - EchoNote\n\nYou have been invited to join ${options.orgName} on EchoNote.\n\nInvited by: ${options.inviterName}\nRecipient: ${to}\nAssigned Role: ${options.role}${options.expiresAt ? `\nExpires on: ${options.expiresAt}` : ''}\n\nTo accept this invitation, please visit the following link:\n${options.inviteLink}\n\nIf you did not expect this invitation, you can safely ignore this email.\n© ${new Date().getFullYear()} EchoNote Technologies. All rights reserved.`;

    return sendEmail({
      to,
      subject: `EchoNote: Invitation to join ${options.orgName}`,
      html,
      text,
      replyTo: options.replyTo
    });
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
  },

  /**
   * 7. Send Task Assignment Notification
   */
  async sendTaskAssignmentNotification(to: string, options: {
    recipientName?: string;
    taskTitle: string;
    projectName?: string;
    dueDate?: string | null;
    priority?: string | null;
    appUrl?: string;
  }) {
    const title = `Task Assigned: ${options.taskTitle}`;
    const preheaderText = `You have been assigned to task "${options.taskTitle}"${options.projectName ? ` in project ${options.projectName}` : ''}.`;
    const appUrl = options.appUrl || COMPANY_WEBSITE;
    const greeting = options.recipientName ? `Hi ${options.recipientName},` : `Hello,`;

    const bodyContentHtml = `
      <h1 style="margin: 0 0 15px 0; font-size: 22px; font-weight: 800; color: ${PRIMARY_COLOR}; letter-spacing: -0.5px;">New Task Assignment</h1>
      <p style="margin: 0 0 15px 0; font-size: 15px; line-height: 1.6; color: ${TEXT_COLOR};">
        ${greeting}
      </p>
      <p style="margin: 0 0 20px 0; font-size: 15px; line-height: 1.6; color: ${TEXT_COLOR};">
        You have been assigned to the following task in EchoNote:
      </p>

      <div style="background-color: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0; padding: 20px; margin: 20px 0;">
        <table cellpadding="0" cellspacing="0" border="0" style="width: 100%;">
          <tr>
            <td style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: #94a3b8; padding-bottom: 6px;">Task Title</td>
          </tr>
          <tr>
            <td style="font-size: 16px; font-weight: 700; color: ${PRIMARY_COLOR}; padding-bottom: 15px;">${options.taskTitle}</td>
          </tr>
          ${options.projectName ? `
          <tr>
            <td style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: #94a3b8; padding-bottom: 6px;">Project</td>
          </tr>
          <tr>
            <td style="font-size: 14px; font-weight: 600; color: ${TEXT_COLOR}; padding-bottom: 15px;">${options.projectName}</td>
          </tr>
          ` : ''}
          ${options.dueDate ? `
          <tr>
            <td style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: #94a3b8; padding-bottom: 6px;">Due Date</td>
          </tr>
          <tr>
            <td style="font-size: 14px; font-weight: 600; color: ${TEXT_COLOR}; padding-bottom: 15px;">${options.dueDate}</td>
          </tr>
          ` : ''}
          ${options.priority ? `
          <tr>
            <td style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: #94a3b8; padding-bottom: 6px;">Priority</td>
          </tr>
          <tr>
            <td style="font-size: 14px; font-weight: 600; text-transform: capitalize; color: ${options.priority === 'urgent' ? '#dc2626' : (options.priority === 'high' ? '#ea580c' : TEXT_COLOR)};">${options.priority}</td>
          </tr>
          ` : ''}
        </table>
      </div>

      ${renderButton("View Task Details", appUrl)}

      <p style="margin: 20px 0 0 0; font-size: 13px; color: #64748b; line-height: 1.5;">
        You received this notification because this task was assigned to your account.
      </p>
    `;

    const html = wrapInBaseTemplate({ title, preheaderText, bodyContentHtml });
    return sendEmail({ to, subject: `[EchoNote] Task Assigned: ${options.taskTitle}`, html });
  },

  /**
   * 8. Send Upcoming Deadline Notification
   */
  async sendUpcomingDeadlineNotification(to: string, options: {
    recipientName?: string;
    taskTitle: string;
    projectName?: string;
    dueDate: string;
    priority?: string | null;
    appUrl?: string;
  }) {
    const title = `Upcoming Deadline: ${options.taskTitle}`;
    const preheaderText = `Task "${options.taskTitle}" is due on ${options.dueDate}. Please review and update progress.`;
    const appUrl = options.appUrl || COMPANY_WEBSITE;
    const greeting = options.recipientName ? `Hi ${options.recipientName},` : `Hello,`;

    const bodyContentHtml = `
      <h1 style="margin: 0 0 15px 0; font-size: 22px; font-weight: 800; color: ${PRIMARY_COLOR}; letter-spacing: -0.5px;">Upcoming Task Deadline</h1>
      <p style="margin: 0 0 15px 0; font-size: 15px; line-height: 1.6; color: ${TEXT_COLOR};">
        ${greeting}
      </p>
      <p style="margin: 0 0 20px 0; font-size: 15px; line-height: 1.6; color: ${TEXT_COLOR};">
        This is a courtesy reminder that the following task has an approaching deadline:
      </p>

      <div style="background-color: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0; padding: 20px; margin: 20px 0; border-left: 4px solid ${ACCENT_COLOR};">
        <table cellpadding="0" cellspacing="0" border="0" style="width: 100%;">
          <tr>
            <td style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: #94a3b8; padding-bottom: 6px;">Task Title</td>
          </tr>
          <tr>
            <td style="font-size: 16px; font-weight: 700; color: ${PRIMARY_COLOR}; padding-bottom: 15px;">${options.taskTitle}</td>
          </tr>
          <tr>
            <td style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: #94a3b8; padding-bottom: 6px;">Due Date</td>
          </tr>
          <tr>
            <td style="font-size: 15px; font-weight: 700; color: #2563eb; padding-bottom: 15px;">${options.dueDate}</td>
          </tr>
          ${options.projectName ? `
          <tr>
            <td style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: #94a3b8; padding-bottom: 6px;">Project</td>
          </tr>
          <tr>
            <td style="font-size: 14px; font-weight: 600; color: ${TEXT_COLOR};">${options.projectName}</td>
          </tr>
          ` : ''}
        </table>
      </div>

      ${renderButton("Review Task", appUrl)}

      <p style="margin: 20px 0 0 0; font-size: 13px; color: #64748b; line-height: 1.5;">
        Please make sure your task deliverables are up to date in EchoNote.
      </p>
    `;

    const html = wrapInBaseTemplate({ title, preheaderText, bodyContentHtml });
    return sendEmail({ to, subject: `[EchoNote Reminder] Upcoming Deadline: ${options.taskTitle}`, html });
  },

  /**
   * 9. Send Overdue Task Notification
   */
  async sendOverdueTaskNotification(to: string, options: {
    recipientName?: string;
    taskTitle: string;
    projectName?: string;
    dueDate: string;
    priority?: string | null;
    appUrl?: string;
  }) {
    const title = `Overdue Task Alert: ${options.taskTitle}`;
    const preheaderText = `Task "${options.taskTitle}" was due on ${options.dueDate} and requires immediate attention.`;
    const appUrl = options.appUrl || COMPANY_WEBSITE;
    const greeting = options.recipientName ? `Hi ${options.recipientName},` : `Hello,`;

    const bodyContentHtml = `
      <h1 style="margin: 0 0 15px 0; font-size: 22px; font-weight: 800; color: #b91c1c; letter-spacing: -0.5px;">Task Overdue Alert</h1>
      <p style="margin: 0 0 15px 0; font-size: 15px; line-height: 1.6; color: ${TEXT_COLOR};">
        ${greeting}
      </p>
      <p style="margin: 0 0 20px 0; font-size: 15px; line-height: 1.6; color: ${TEXT_COLOR};">
        The deadline for the following active task has passed:
      </p>

      <div style="background-color: #fef2f2; border-radius: 8px; border: 1px solid #fecaca; padding: 20px; margin: 20px 0; border-left: 4px solid #ef4444;">
        <table cellpadding="0" cellspacing="0" border="0" style="width: 100%;">
          <tr>
            <td style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: #991b1b; padding-bottom: 6px;">Task Title</td>
          </tr>
          <tr>
            <td style="font-size: 16px; font-weight: 700; color: #991b1b; padding-bottom: 15px;">${options.taskTitle}</td>
          </tr>
          <tr>
            <td style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: #991b1b; padding-bottom: 6px;">Original Due Date</td>
          </tr>
          <tr>
            <td style="font-size: 15px; font-weight: 700; color: #b91c1c; padding-bottom: 15px;">${options.dueDate}</td>
          </tr>
          ${options.projectName ? `
          <tr>
            <td style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: #991b1b; padding-bottom: 6px;">Project</td>
          </tr>
          <tr>
            <td style="font-size: 14px; font-weight: 600; color: #4b5563;">${options.projectName}</td>
          </tr>
          ` : ''}
        </table>
      </div>

      ${renderButton("Update Task Status", appUrl)}

      <p style="margin: 20px 0 0 0; font-size: 13px; color: #64748b; line-height: 1.5;">
        If this task has been completed or the deadline extended, please update the status in your project workspace.
      </p>
    `;

    const html = wrapInBaseTemplate({ title, preheaderText, bodyContentHtml });
    return sendEmail({ to, subject: `[EchoNote Urgent] Overdue Task: ${options.taskTitle}`, html });
  },

  /**
   * 10. Send Task Exception / Blocker Notification
   */
  async sendTaskExceptionNotification(to: string, options: {
    recipientName?: string;
    taskTitle: string;
    projectName?: string;
    exceptionTitle: string;
    severity?: string | null;
    details?: string | null;
    appUrl?: string;
  }) {
    const title = `Task Blocked: ${options.taskTitle}`;
    const preheaderText = `An issue or blocker was flagged on task "${options.taskTitle}". Action is required.`;
    const appUrl = options.appUrl || COMPANY_WEBSITE;
    const greeting = options.recipientName ? `Hi ${options.recipientName},` : `Hello,`;

    const bodyContentHtml = `
      <h1 style="margin: 0 0 15px 0; font-size: 22px; font-weight: 800; color: #c2410c; letter-spacing: -0.5px;">Task Blocker / Exception Reported</h1>
      <p style="margin: 0 0 15px 0; font-size: 15px; line-height: 1.6; color: ${TEXT_COLOR};">
        ${greeting}
      </p>
      <p style="margin: 0 0 20px 0; font-size: 15px; line-height: 1.6; color: ${TEXT_COLOR};">
        A task exception has been recorded that may impact delivery:
      </p>

      <div style="background-color: #fff7ed; border-radius: 8px; border: 1px solid #ffedd5; padding: 20px; margin: 20px 0; border-left: 4px solid #f97316;">
        <table cellpadding="0" cellspacing="0" border="0" style="width: 100%;">
          <tr>
            <td style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: #9a3412; padding-bottom: 6px;">Task</td>
          </tr>
          <tr>
            <td style="font-size: 16px; font-weight: 700; color: ${PRIMARY_COLOR}; padding-bottom: 15px;">${options.taskTitle}</td>
          </tr>
          <tr>
            <td style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: #9a3412; padding-bottom: 6px;">Exception / Blocker</td>
          </tr>
          <tr>
            <td style="font-size: 15px; font-weight: 700; color: #c2410c; padding-bottom: 15px;">${options.exceptionTitle}</td>
          </tr>
          ${options.severity ? `
          <tr>
            <td style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: #9a3412; padding-bottom: 6px;">Severity</td>
          </tr>
          <tr>
            <td style="font-size: 14px; font-weight: 700; text-transform: uppercase; color: ${options.severity === 'critical' ? '#dc2626' : '#ea580c'}; padding-bottom: 15px;">${options.severity}</td>
          </tr>
          ` : ''}
          ${options.details ? `
          <tr>
            <td style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: #9a3412; padding-bottom: 6px;">Details</td>
          </tr>
          <tr>
            <td style="font-size: 14px; font-weight: 400; color: ${TEXT_COLOR}; line-height: 1.5;">${options.details}</td>
          </tr>
          ` : ''}
        </table>
      </div>

      ${renderButton("Resolve Blocker", appUrl)}

      <p style="margin: 20px 0 0 0; font-size: 13px; color: #64748b; line-height: 1.5;">
        Please review the blocker and coordinate resolution with your team.
      </p>
    `;

    const html = wrapInBaseTemplate({ title, preheaderText, bodyContentHtml });
    return sendEmail({ to, subject: `[EchoNote Action Required] Blocker: ${options.taskTitle}`, html });
  }
};

// Export sendEmail for internal service usage and test mocking
export { sendEmail };

