import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { generateOtpCodeAsync, sendBishopOtpEmail } from "@/server/auth";
import { checkRateLimit, getClientIp, RATE_LIMIT_PRESETS } from "@/server/common/rate-limiter";

// Rate limiting store for OTP requests (key: email, value: timestamp ms)
const otpRequestStore = new Map<string, number>();

export async function POST(req: NextRequest) {
  try {
    const clientIp = getClientIp(req);
    const ipLimit = checkRateLimit(`forgot_pw_${clientIp}`, RATE_LIMIT_PRESETS.otp);
    if (!ipLimit.allowed) {
      return NextResponse.json(
        { error: "Too many password reset requests. Please wait a minute." },
        {
          status: 429,
          headers: {
            "Retry-After": String(ipLimit.resetSeconds),
            "X-RateLimit-Limit": String(ipLimit.limit),
            "X-RateLimit-Remaining": "0",
          },
        }
      );
    }

    const body = await req.json();
    const { email } = body;

    if (!email || typeof email !== "string" || !email.includes("@")) {
      return NextResponse.json(
        { error: "A valid email address is required." },
        { status: 400 }
      );
    }

    const cleanEmail = email.trim().toLowerCase();

    // 1. Enforce rate limiting: 1 OTP request per 60 seconds per email
    const lastRequest = otpRequestStore.get(cleanEmail) || 0;
    const now = Date.now();
    const cooldownMs = 60 * 1000;

    if (now - lastRequest < cooldownMs) {
      const waitSeconds = Math.ceil((cooldownMs - (now - lastRequest)) / 1000);
      return NextResponse.json(
        {
          error: `Please wait ${waitSeconds} seconds before requesting another verification code.`,
          retryAfterSeconds: waitSeconds,
        },
        { status: 429 }
      );
    }

    otpRequestStore.set(cleanEmail, now);

    // 2. Dispatch password recovery OTP via Supabase Auth API
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

    if (supabaseUrl && anonKey) {
      try {
        const authClient = createClient(supabaseUrl, anonKey, {
          auth: { autoRefreshToken: false, persistSession: false },
        });
        const { error: resetErr } = await authClient.auth.resetPasswordForEmail(cleanEmail);
        if (resetErr) {
          console.warn("Supabase resetPasswordForEmail note:", resetErr.message);
        }
      } catch (supaErr) {
        console.warn("Supabase resetPasswordForEmail warning:", supaErr);
      }
    }

    // 3. Generate secure OTP for verified local fallback resilience
    const otpCode = await generateOtpCodeAsync(cleanEmail);

    // 4. Dispatch verification email if SMTP is configured
    try {
      await sendBishopOtpEmail({
        to: cleanEmail,
        otpCode,
      });
    } catch (mailErr) {
      console.warn("sendBishopOtpEmail warning:", mailErr);
    }

    // 5. Return generic success message to prevent email enumeration
    return NextResponse.json({
      success: true,
      message: "If an account with that email exists, a password verification code has been sent.",
    });
  } catch (err: any) {
    console.error("API /api/auth/forgot-password error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to process forgot password request." },
      { status: 500 }
    );
  }
}
