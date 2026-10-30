/**
 * Server-only Email Service for BISHOP Authentication.
 * Handles dispatching BISHOP-branded OTP verification emails via Nodemailer SMTP.
 */

if (typeof window !== "undefined") {
  throw new Error("Security Error: server-only module '@/server/auth/email-service' cannot be executed in browser context.");
}

import nodemailer from "nodemailer";
import { withTimeout } from "@/server/common/resilience";
import { getOrCreateCircuitBreaker } from "@/server/common/circuit-breaker";

const smtpCircuitBreaker = getOrCreateCircuitBreaker("smtp_mailer", {
  failureThreshold: 3,
  resetTimeoutMs: 60000,
});

export interface SendOtpEmailParams {
  to: string;
  otpCode: string;
}

/**
 * Dispatches a BISHOP-branded 6-digit OTP verification email.
 * - Sender Display Name: "BISHOP"
 * - Subject: "BISHOP Password Verification Code"
 * - Contains NO clickable reset links
 */
export async function sendBishopOtpEmail({
  to,
  otpCode,
}: SendOtpEmailParams): Promise<{ success: boolean; error?: string }> {
  const cleanEmail = to.trim().toLowerCase();

  const smtpHost = process.env.SMTP_HOST?.trim();
  const smtpPort = parseInt(process.env.SMTP_PORT?.trim() || "587");
  const smtpUser = process.env.SMTP_USER?.trim();
  const smtpPass = process.env.SMTP_PASS?.trim();
  const smtpFrom = process.env.SMTP_FROM?.trim() || `"BISHOP" <no-reply@bishop.app>`;

  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>BISHOP Verification Code</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px;">
  <div style="max-width: 480px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; padding: 32px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);">

    <!-- Logo Header -->
    <div style="text-align: center; margin-bottom: 24px;">
      <div style="display: inline-block; background-color: #ecfdf5; border-radius: 9999px; padding: 8px 16px; color: #047857; font-weight: 800; font-size: 14px; letter-spacing: 0.05em;">
        BISHOP AUTHENTICATION
      </div>
      <h1 style="color: #0f172a; font-size: 22px; font-weight: 800; margin-top: 16px; margin-bottom: 8px;">
        Password Verification Code
      </h1>
      <p style="color: #64748b; font-size: 14px; margin: 0;">
        Use the 6-digit verification code below to reset your BISHOP account password.
      </p>
    </div>

    <!-- OTP Code Box -->
    <div style="background-color: #ecfdf5; border: 2px solid #a7f3d0; border-radius: 16px; padding: 24px; text-align: center; margin: 24px 0;">
      <span style="font-family: 'Courier New', Courier, monospace; font-size: 36px; font-weight: 900; letter-spacing: 8px; color: #065f46; display: block;">
        ${otpCode}
      </span>
      <p style="color: #047857; font-size: 12px; font-weight: 600; margin-top: 8px; margin-bottom: 0;">
        This code expires in 10 minutes
      </p>
    </div>

    <!-- Security Information -->
    <div style="border-t: 1px solid #f1f5f9; padding-top: 16px; margin-top: 24px; text-align: center;">
      <p style="color: #94a3b8; font-size: 12px; line-height: 1.5; margin: 0;">
        Do not share this code with anyone. BISHOP staff will never ask for your verification code.
        If you did not request this password reset, please ignore this email.
      </p>
    </div>

  </div>
</body>
</html>
  `.trim();

  const textBody = `BISHOP Password Verification Code\n\nYour 6-digit verification code is: ${otpCode}\n\nThis code expires in 10 minutes.\nIf you did not request this password reset, please ignore this email.`;

  // 1. If SMTP environment variables are configured in .env.local, send via Nodemailer SMTP transport
  if (smtpHost && smtpUser && smtpPass) {
    try {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: {
          user: smtpUser,
          pass: smtpPass,
        },
      });

      await smtpCircuitBreaker.execute(async () => {
        await withTimeout(
          transporter.sendMail({
            from: smtpFrom.includes("BISHOP") ? smtpFrom : `"BISHOP" <${smtpUser}>`,
            to: cleanEmail,
            subject: "BISHOP Password Verification Code",
            text: textBody,
            html: htmlBody,
          }),
          6000,
          "SMTP sendMail"
        );
      });

      console.log(`[BISHOP Mailer] Sent BISHOP-branded OTP code email to ${cleanEmail} via SMTP.`);
      return { success: true };
    } catch (smtpErr: any) {
      console.error("[BISHOP Mailer] SMTP execution error (circuit breaker protected):", smtpErr?.message || smtpErr);
      return { success: false, error: smtpErr?.message || "Failed to send email via SMTP." };
    }
  }

  // 2. Fallback: Log email details when SMTP is not configured in .env.local
  console.log(`\n======================================================`);
  console.log(`[BISHOP EMAIL DISPATCHER - SENDER: BISHOP]`);
  console.log(`To: ${cleanEmail}`);
  console.log(`Subject: BISHOP Password Verification Code`);
  console.log(`Code: ${otpCode} (Expires in 10 mins)`);
  console.log(`Note: To send real emails from "BISHOP", configure SMTP_HOST, SMTP_USER, SMTP_PASS in .env.local or set up Custom SMTP in Supabase Dashboard.`);
  console.log(`======================================================\n`);

  return { success: true };
}
