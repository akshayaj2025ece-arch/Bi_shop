/**
 * Server-only OTP and Reset Authorization Token Store for BISHOP.
 * Supports durable persistence via Supabase database table `auth_otps`
 * with automatic fallback to process-level in-memory storage.
 * All token and OTP comparisons use constant-time comparison (crypto.timingSafeEqual).
 */

if (typeof window !== "undefined") {
  throw new Error("Security Error: server-only module '@/server/auth/otp-store' cannot be executed in browser context.");
}

import crypto from "crypto";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

interface OtpEntry {
  email: string;
  otp: string;
  expires_at: number; // Timestamp ms
  attempts: number;
}

interface ResetTokenEntry {
  email: string;
  resetToken: string;
  expires_at: number; // Timestamp ms
}

// Global server-side fallback stores (persist across requests per server process)
const otpStore = new Map<string, OtpEntry>();
const resetTokenStore = new Map<string, ResetTokenEntry>();

function getSupabaseAdmin(): SupabaseClient | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceKey) return null;
  return createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Constant-time string comparison to prevent timing attacks on OTPs and tokens.
 */
export function timingSafeCompare(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) {
      // Dummy compare to avoid timing leak on length
      crypto.timingSafeEqual(bufA, bufA);
      return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

function hashValue(val: string): string {
  return crypto.createHash("sha256").update(val).digest("hex");
}

function generateSecureOtp(): string {
  const randomBuffer = crypto.randomBytes(3);
  const numericValue = (randomBuffer.readUIntBE(0, 3) % 900000) + 100000;
  return numericValue.toString();
}

/**
 * Asynchronously generates and durably stores a 6-digit numeric OTP code.
 * Persists to Supabase `auth_otps` table and syncs to in-memory store.
 */
export async function generateOtpCodeAsync(email: string): Promise<string> {
  const cleanEmail = email.trim().toLowerCase();
  const otpCode = generateSecureOtp();
  const expiresAtMs = Date.now() + 10 * 60 * 1000; // 10 minutes
  const expiresAtIso = new Date(expiresAtMs).toISOString();

  // 1. Update in-memory fallback
  otpStore.set(cleanEmail, {
    email: cleanEmail,
    otp: otpCode,
    expires_at: expiresAtMs,
    attempts: 0,
  });

  // 2. Persist to Supabase if admin client available
  const adminClient = getSupabaseAdmin();
  if (adminClient) {
    try {
      const { error } = await adminClient.from("auth_otps").upsert(
        {
          email: cleanEmail,
          otp_hash: hashValue(otpCode),
          attempts: 0,
          expires_at: expiresAtIso,
          created_at: new Date().toISOString(),
          reset_token_hash: null,
          reset_token_expires_at: null,
        },
        { onConflict: "email" }
      );
      if (error) {
        console.warn("[OTP-STORE] Database upsert failed (falling back to memory):", error.message);
      }
    } catch (e: any) {
      console.warn("[OTP-STORE] Supabase persistence error:", e?.message);
    }
  }

  return otpCode;
}

/**
 * Synchronous version of generateOtpCode for backward compatibility.
 */
export function generateOtpCode(email: string): string {
  const cleanEmail = email.trim().toLowerCase();
  const otpCode = generateSecureOtp();
  const expires_at = Date.now() + 10 * 60 * 1000;

  otpStore.set(cleanEmail, {
    email: cleanEmail,
    otp: otpCode,
    expires_at,
    attempts: 0,
  });

  // Background sync if admin client available
  const adminClient = getSupabaseAdmin();
  if (adminClient) {
    Promise.resolve(
      adminClient.from("auth_otps").upsert(
        {
          email: cleanEmail,
          otp_hash: hashValue(otpCode),
          attempts: 0,
          expires_at: new Date(expires_at).toISOString(),
        },
        { onConflict: "email" }
      )
    ).catch(() => {});
  }

  return otpCode;
}

/**
 * Asynchronously verifies an OTP code against Supabase auth_otps with constant-time comparison.
 * Falls back to in-memory store if DB lookup fails.
 */
export async function verifyOtpCodeAsync(
  email: string,
  inputCode: string
): Promise<{ valid: boolean; resetToken?: string; error?: string }> {
  const cleanEmail = email.trim().toLowerCase();
  const cleanCode = inputCode.trim();
  const inputHash = hashValue(cleanCode);

  const adminClient = getSupabaseAdmin();
  if (adminClient) {
    try {
      const { data, error } = await adminClient
        .from("auth_otps")
        .select("*")
        .eq("email", cleanEmail)
        .maybeSingle();

      if (!error && data) {
        const expiresAt = new Date(data.expires_at).getTime();
        if (Date.now() > expiresAt) {
          await adminClient.from("auth_otps").delete().eq("email", cleanEmail);
          return {
            valid: false,
            error: "Verification code has expired. Please request a new code.",
          };
        }

        if (data.attempts >= 5) {
          await adminClient.from("auth_otps").delete().eq("email", cleanEmail);
          return {
            valid: false,
            error: "Too many incorrect verification attempts. Please request a new code.",
          };
        }

        // Constant-time hash comparison
        const matches = timingSafeCompare(data.otp_hash, inputHash);
        if (!matches) {
          const newAttempts = (data.attempts || 0) + 1;
          await adminClient
            .from("auth_otps")
            .update({ attempts: newAttempts })
            .eq("email", cleanEmail);
          return {
            valid: false,
            error: "Incorrect verification code. Please check your email and try again.",
          };
        }

        // OTP is valid! Generate reset authorization token
        const resetToken = crypto.randomBytes(32).toString("hex");
        const resetTokenHash = hashValue(resetToken);
        const tokenExpiresIso = new Date(Date.now() + 10 * 60 * 1000).toISOString();

        await adminClient
          .from("auth_otps")
          .update({
            otp_hash: "consumed",
            reset_token_hash: resetTokenHash,
            reset_token_expires_at: tokenExpiresIso,
            attempts: 0,
          })
          .eq("email", cleanEmail);

        // Also update local store
        resetTokenStore.set(cleanEmail, {
          email: cleanEmail,
          resetToken,
          expires_at: Date.now() + 10 * 60 * 1000,
        });

        return { valid: true, resetToken };
      }
    } catch (dbErr: any) {
      console.warn("[OTP-STORE] DB verify failed, falling back to memory:", dbErr?.message);
    }
  }

  // Fallback to in-memory check
  return verifyOtpCode(cleanEmail, cleanCode);
}

/**
 * Synchronous verification of OTP against in-memory store using constant-time comparison.
 */
export function verifyOtpCode(
  email: string,
  inputCode: string
): { valid: boolean; resetToken?: string; error?: string } {
  const cleanEmail = email.trim().toLowerCase();
  const cleanCode = inputCode.trim();

  const entry = otpStore.get(cleanEmail);

  if (!entry) {
    return {
      valid: false,
      error: "No verification code requested for this email. Please request a new code.",
    };
  }

  if (Date.now() > entry.expires_at) {
    otpStore.delete(cleanEmail);
    return {
      valid: false,
      error: "Verification code has expired. Please request a new code.",
    };
  }

  if (entry.attempts >= 5) {
    otpStore.delete(cleanEmail);
    return {
      valid: false,
      error: "Too many incorrect verification attempts. Please request a new code.",
    };
  }

  // Fix #18: Constant-time comparison
  const matches = timingSafeCompare(entry.otp, cleanCode);
  if (!matches) {
    entry.attempts += 1;
    otpStore.set(cleanEmail, entry);
    return {
      valid: false,
      error: "Incorrect verification code. Please check your email and try again.",
    };
  }

  // OTP is valid!
  otpStore.delete(cleanEmail);

  const resetToken = crypto.randomBytes(32).toString("hex");
  const tokenExpiresAt = Date.now() + 10 * 60 * 1000;

  resetTokenStore.set(cleanEmail, {
    email: cleanEmail,
    resetToken,
    expires_at: tokenExpiresAt,
  });

  return {
    valid: true,
    resetToken,
  };
}

/**
 * Asynchronously validates reset token against Supabase auth_otps table with constant-time comparison.
 */
export async function validateResetTokenAsync(email: string, token: string): Promise<boolean> {
  const cleanEmail = email.trim().toLowerCase();
  const cleanToken = token.trim();
  const tokenHash = hashValue(cleanToken);

  const adminClient = getSupabaseAdmin();
  if (adminClient) {
    try {
      const { data, error } = await adminClient
        .from("auth_otps")
        .select("reset_token_hash, reset_token_expires_at")
        .eq("email", cleanEmail)
        .maybeSingle();

      if (!error && data?.reset_token_hash && data?.reset_token_expires_at) {
        const expiresAt = new Date(data.reset_token_expires_at).getTime();
        if (Date.now() <= expiresAt) {
          if (timingSafeCompare(data.reset_token_hash, tokenHash)) {
            return true;
          }
        }
      }
    } catch (e: any) {
      console.warn("[OTP-STORE] DB validateResetTokenAsync error, checking memory:", e?.message);
    }
  }

  return validateResetToken(cleanEmail, cleanToken);
}

/**
 * Synchronous validateResetToken using constant-time comparison.
 */
export function validateResetToken(email: string, token: string): boolean {
  const cleanEmail = email.trim().toLowerCase();
  const cleanToken = token.trim();
  const entry = resetTokenStore.get(cleanEmail);

  if (!entry) return false;
  if (!timingSafeCompare(entry.resetToken, cleanToken)) return false;
  if (Date.now() > entry.expires_at) {
    resetTokenStore.delete(cleanEmail);
    return false;
  }

  return true;
}

/**
 * Asynchronously consumes the reset token from both DB and memory.
 */
export async function consumeResetTokenAsync(email: string, token: string): Promise<void> {
  const cleanEmail = email.trim().toLowerCase();
  consumeResetToken(cleanEmail, token);

  const adminClient = getSupabaseAdmin();
  if (adminClient) {
    try {
      await adminClient.from("auth_otps").delete().eq("email", cleanEmail);
    } catch (e: any) {
      console.warn("[OTP-STORE] DB consumeResetToken error:", e?.message);
    }
  }
}

/**
 * Synchronous consumeResetToken.
 */
export function consumeResetToken(email: string, token: string): void {
  const cleanEmail = email.trim().toLowerCase();
  const entry = resetTokenStore.get(cleanEmail);

  if (entry && timingSafeCompare(entry.resetToken, token.trim())) {
    resetTokenStore.delete(cleanEmail);
  }
}

/**
 * Register an authorized reset token (syncs to both DB and memory).
 */
export function registerAuthorizedResetToken(
  email: string,
  token: string,
  ttlMs: number = 10 * 60 * 1000
): void {
  const cleanEmail = email.trim().toLowerCase();
  const expiresAt = Date.now() + ttlMs;

  resetTokenStore.set(cleanEmail, {
    email: cleanEmail,
    resetToken: token,
    expires_at: expiresAt,
  });

  const adminClient = getSupabaseAdmin();
  if (adminClient) {
    Promise.resolve(
      adminClient.from("auth_otps").upsert(
        {
          email: cleanEmail,
          otp_hash: "authorized",
          reset_token_hash: hashValue(token),
          reset_token_expires_at: new Date(expiresAt).toISOString(),
          expires_at: new Date(expiresAt).toISOString(),
          attempts: 0,
        },
        { onConflict: "email" }
      )
    ).catch(() => {});
  }
}
