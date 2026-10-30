import { NextRequest, NextResponse } from "next/server";
import { loginUser } from "@/server/auth";
import { checkRateLimit, getClientIp, RATE_LIMIT_PRESETS } from "@/server/common/rate-limiter";

export async function POST(req: NextRequest) {
  try {
    // IP-level rate limiting to stop brute-force bots and credential-stuffing attacks
    const clientIp = getClientIp(req);
    const ipLimit = checkRateLimit(`login_${clientIp}`, RATE_LIMIT_PRESETS.auth);
    if (!ipLimit.allowed) {
      return NextResponse.json(
        { error: "Too many login attempts from this network. Please wait a minute." },
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
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required." },
        { status: 400 }
      );
    }

    const result = await loginUser({ email, password });

    if (result.type === "config_error") {
      return NextResponse.json(
        { error: result.error },
        { status: 500 }
      );
    }

    if (result.type === "max_attempts") {
      return NextResponse.json(
        {
          status: "max_attempts",
          error: result.error,
          ...(result.consecutive_failed !== undefined ? { consecutive_failed: result.consecutive_failed } : {}),
          total_failed: result.total_failed,
        },
        { status: 429 }
      );
    }

    if (result.type === "locked") {
      return NextResponse.json(
        {
          status: "locked",
          error: result.error,
          remainingSeconds: result.remainingSeconds,
          consecutive_failed: result.consecutive_failed,
          total_failed: result.total_failed,
        },
        { status: 429 }
      );
    }

    if (result.type === "failed") {
      return NextResponse.json(
        {
          status: "failed",
          error: result.error,
          code: result.isUnconfirmed ? "email_not_confirmed" : undefined,
          consecutive_failed: result.consecutive_failed,
          total_failed: result.total_failed,
        },
        { status: result.isUnconfirmed ? 403 : 401 }
      );
    }

    return NextResponse.json({
      success: true,
      session: result.session,
      user: result.user,
    });
  } catch (err: any) {
    console.error("API /api/auth/login error:", err);
    return NextResponse.json(
      { error: err?.message || "Authentication error." },
      { status: 500 }
    );
  }
}
