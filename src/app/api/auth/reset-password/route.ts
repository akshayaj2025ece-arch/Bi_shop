import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  validatePasswordPolicy,
  validateResetTokenAsync,
  consumeResetTokenAsync,
} from "@/server/auth";
import { checkRateLimit, getClientIp } from "@/server/common/rate-limiter";

export async function POST(req: NextRequest) {
  try {
    // 0. Rate limiting: max 5 password reset attempts per 15 minutes per IP
    const clientIp = getClientIp(req);
    const rateLimit = checkRateLimit(`reset_pwd_${clientIp}`, 5, 15 * 60 * 1000);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          error: "Too many password reset attempts. Please wait before trying again.",
          retryAfterSeconds: Math.ceil(rateLimit.resetInMs / 1000),
        },
        {
          status: 429,
          headers: {
            "Retry-After": Math.ceil(rateLimit.resetInMs / 1000).toString(),
          },
        }
      );
    }
    const body = await req.json();
    const {
      email,
      reset_authorization_token,
      access_token,
      newPassword,
      confirmPassword,
    } = body;

    if (!email || typeof email !== "string" || !email.includes("@")) {
      return NextResponse.json(
        { error: "Email address is required." },
        { status: 400 }
      );
    }

    const cleanEmail = email.trim().toLowerCase();

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

    // 1. SECURITY REQUIREMENT: Enforce server-side authorization check
    // User MUST NOT be able to set a new password without completing OTP verification first!
    let isTokenAuthorized = false;

    if (reset_authorization_token) {
      isTokenAuthorized = await validateResetTokenAsync(cleanEmail, reset_authorization_token);
    }

    if (!isTokenAuthorized && access_token && supabaseUrl && anonKey) {
      try {
        const userClient = createClient(supabaseUrl, anonKey, {
          auth: { autoRefreshToken: false, persistSession: false },
          global: { headers: { Authorization: `Bearer ${access_token}` } },
        });
        const { data: { user } } = await userClient.auth.getUser();
        if (user && user.email?.toLowerCase() === cleanEmail) {
          isTokenAuthorized = true;
        }
      } catch (tokenErr) {
        console.warn("access_token verification note:", tokenErr);
      }
    }

    if (!isTokenAuthorized) {
      return NextResponse.json(
        {
          error:
            "Unauthorized: You must verify your email with the 6-digit verification code before creating a new password.",
        },
        { status: 403 }
      );
    }

    if (!newPassword || !confirmPassword) {
      return NextResponse.json(
        { error: "New password and confirm password are required." },
        { status: 400 }
      );
    }

    if (newPassword !== confirmPassword) {
      return NextResponse.json(
        { error: "New password and confirm password do not match." },
        { status: 400 }
      );
    }

    // 2. Validate password policy requirements
    const policyResult = validatePasswordPolicy(newPassword);
    if (!policyResult.isValid) {
      return NextResponse.json(
        {
          error: policyResult.errors[0] || "Password does not meet security requirements.",
          errors: policyResult.errors,
        },
        { status: 400 }
      );
    }

    if (!supabaseUrl) {
      return NextResponse.json(
        { error: "Server authentication configuration missing." },
        { status: 500 }
      );
    }

    let passwordUpdateSuccess = false;

    // 3a. Update password via Supabase Auth Admin API
    if (serviceKey) {
      try {
        const adminClient = createClient(supabaseUrl, serviceKey, {
          auth: { autoRefreshToken: false, persistSession: false },
        });

        let targetUserId: string | null = null;
        const { data: prof } = await adminClient
          .from("profiles")
          .select("id")
          .eq("email", cleanEmail)
          .maybeSingle();

        if (prof?.id) {
          targetUserId = prof.id;
        } else {
          const { data: usersData } = await adminClient.auth.admin.listUsers({
            page: 1,
            perPage: 1000,
          });
          const targetUser = usersData?.users?.find(
            (u) => u.email?.toLowerCase() === cleanEmail
          );
          if (targetUser) targetUserId = targetUser.id;
        }

        if (targetUserId) {
          const { error: adminUpdateErr } =
            await adminClient.auth.admin.updateUserById(targetUserId, {
              password: newPassword,
            });

          if (!adminUpdateErr) {
            passwordUpdateSuccess = true;
          } else {
            console.error("Admin updateUserById error:", adminUpdateErr);
          }
        }
      } catch (adminErr) {
        console.warn("Admin update password note:", adminErr);
      }
    }

    // 3b. Fallback: Update password using verified recovery session access_token
    if (!passwordUpdateSuccess && access_token && anonKey) {
      try {
        const userClient = createClient(supabaseUrl, anonKey, {
          auth: { autoRefreshToken: false, persistSession: false },
          global: { headers: { Authorization: `Bearer ${access_token}` } },
        });

        const { error: updateErr } = await userClient.auth.updateUser({
          password: newPassword,
        });

        if (!updateErr) {
          passwordUpdateSuccess = true;
        }
      } catch (userErr) {
        console.warn("User update password note:", userErr);
      }
    }

    if (!passwordUpdateSuccess) {
      return NextResponse.json(
        { error: "Failed to update password. Please request a new verification code and try again." },
        { status: 400 }
      );
    }

    // 4. Invalidate used reset_authorization_token to prevent reuse
    if (reset_authorization_token) {
      await consumeResetTokenAsync(cleanEmail, reset_authorization_token);
    }

    // 5. Reset failed login attempts in login_attempts table upon successful password reset
    if (serviceKey) {
      try {
        const adminClient = createClient(supabaseUrl, serviceKey, {
          auth: { autoRefreshToken: false, persistSession: false },
        });

        await adminClient.from("login_attempts").upsert({
          email: cleanEmail,
          consecutive_failed: 0,
          total_failed: 0,
          locked_until: null,
          updated_at: new Date().toISOString(),
        });
      } catch (dbErr) {
        console.warn("Reset login_attempts table note:", dbErr);
      }
    }

    return NextResponse.json({
      success: true,
      message: "Password Updated Successfully",
    });
  } catch (err: any) {
    console.error("API /api/auth/reset-password error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to reset password." },
      { status: 500 }
    );
  }
}
