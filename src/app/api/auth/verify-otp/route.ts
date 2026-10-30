import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyOtpCodeAsync, registerAuthorizedResetToken } from "@/server/auth";
import { checkRateLimit, getClientIp, RATE_LIMIT_PRESETS } from "@/server/common/rate-limiter";

export async function POST(req: NextRequest) {
  try {
    const clientIp = getClientIp(req);
    const ipLimit = checkRateLimit(`otp_${clientIp}`, RATE_LIMIT_PRESETS.otp);
    if (!ipLimit.allowed) {
      return NextResponse.json(
        { error: "Too many verification attempts. Please wait a minute." },
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
    const { email, code } = body;

    if (!email || !code) {
      return NextResponse.json(
        { error: "Email and verification code are required." },
        { status: 400 }
      );
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanCode = code.trim();

    if (cleanCode.length < 6) {
      return NextResponse.json(
        { error: "Verification code must be 6 digits." },
        { status: 400 }
      );
    }

    // 1. Primary: Verify with Supabase Auth recovery OTP API
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

    if (supabaseUrl && anonKey) {
      try {
        const supabase = createClient(supabaseUrl, anonKey, {
          auth: { autoRefreshToken: false, persistSession: false },
        });

        const { data: supaData, error: supaErr } = await supabase.auth.verifyOtp({
          email: cleanEmail,
          token: cleanCode,
          type: "recovery",
        });

        if (!supaErr && supaData?.session) {
          const recoveryToken = supaData.session.access_token;
          await registerAuthorizedResetToken(cleanEmail, recoveryToken);

          return NextResponse.json({
            success: true,
            message: "Code verified successfully! You can now set a new password.",
            reset_authorization_token: recoveryToken,
            access_token: supaData.session.access_token,
          });
        }
      } catch (supaErr) {
        console.warn("Supabase verifyOtp note:", supaErr);
      }
    }

    // 2. Fallback: Verify against server OTP store (resilience fallback)
    const localResult = await verifyOtpCodeAsync(cleanEmail, cleanCode);

    if (localResult.valid && localResult.resetToken) {
      return NextResponse.json({
        success: true,
        message: "Code verified successfully! You can now set a new password.",
        reset_authorization_token: localResult.resetToken,
      });
    }

    // 3. Return failure message if code is invalid or expired
    return NextResponse.json(
      { error: localResult.error || "Invalid or expired verification code. Please check the code or request a new one." },
      { status: 400 }
    );
  } catch (err: any) {
    console.error("API /api/auth/verify-otp error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to verify code." },
      { status: 500 }
    );
  }
}
