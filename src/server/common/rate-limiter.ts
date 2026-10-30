/**
 * Server-only Rate Limiter for BISHOP.
 * Protects public authentication and transaction endpoints against brute-force attacks,
 * credential stuffing, and volumetric abuse.
 * 
 * Supports distributed persistence via Supabase `rate_limits` table across Vercel serverless isolates,
 * with local in-memory sliding window fallback.
 */

if (typeof window !== "undefined") {
  throw new Error("Security Error: server-only module '@/server/common/rate-limiter' cannot be executed in browser context.");
}

import { NextRequest } from "next/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

export interface RateLimitConfig {
  maxRequests: number;
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
  resetInMs: number;
}

// In-memory sliding window timestamps per key (fallback/local)
const rateLimitMap = new Map<string, number[]>();
const MAX_KEYS = 5000;

function getSupabaseAdmin(): SupabaseClient | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceKey) return null;
  return createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Extracts a reliable client IP address from request headers.
 * Priority: x-real-ip (Vercel) > cf-connecting-ip (Cloudflare) > x-forwarded-for (last entry) > fallback.
 */
export function getClientIp(req: NextRequest): string {
  // x-real-ip is set by Vercel's edge network and cannot be spoofed by the client
  const realIp = req.headers.get("x-real-ip");
  if (realIp) {
    return realIp.trim();
  }

  // cf-connecting-ip is set by Cloudflare and also cannot be spoofed
  const cfConnectingIp = req.headers.get("cf-connecting-ip");
  if (cfConnectingIp) {
    return cfConnectingIp.trim();
  }

  // x-forwarded-for: use the LAST entry (appended by trusted proxy), not the first (client-controlled)
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded.split(",").map((s) => s.trim()).filter(Boolean);
    return parts[parts.length - 1];
  }

  return "127.0.0.1";
}

function normalizeConfig(
  configOrLimit: RateLimitConfig | number,
  optionalWindowMs?: number
): RateLimitConfig {
  if (typeof configOrLimit === "number") {
    const windowSec = optionalWindowMs
      ? Math.max(1, Math.ceil(optionalWindowMs / 1000))
      : 60;
    return {
      maxRequests: configOrLimit,
      windowSeconds: windowSec,
    };
  }
  return configOrLimit;
}

/**
 * Distributed rate limiter querying Supabase `rate_limits` table across serverless isolates.
 * Falls back to in-memory sliding window if Supabase is unavailable.
 */
export async function checkRateLimitAsync(
  key: string,
  configOrLimit: RateLimitConfig | number,
  optionalWindowMs?: number
): Promise<RateLimitResult> {
  const config = normalizeConfig(configOrLimit, optionalWindowMs);
  const now = Date.now();
  const windowMs = config.windowSeconds * 1000;
  const resetAtIso = new Date(now + windowMs).toISOString();

  const adminClient = getSupabaseAdmin();
  if (adminClient) {
    try {
      const { data, error } = await adminClient
        .from("rate_limits")
        .select("count, reset_at")
        .eq("key", key)
        .maybeSingle();

      if (!error && data) {
        const resetAtMs = new Date(data.reset_at).getTime();
        if (now <= resetAtMs) {
          if (data.count >= config.maxRequests) {
            const resetInMs = Math.max(1000, resetAtMs - now);
            return {
              allowed: false,
              limit: config.maxRequests,
              remaining: 0,
              resetSeconds: Math.ceil(resetInMs / 1000),
              resetInMs,
            };
          }

          // Increment count
          const nextCount = data.count + 1;
          await adminClient
            .from("rate_limits")
            .update({ count: nextCount })
            .eq("key", key);

          const resetInMs = Math.max(1000, resetAtMs - now);
          return {
            allowed: true,
            limit: config.maxRequests,
            remaining: Math.max(0, config.maxRequests - nextCount),
            resetSeconds: Math.ceil(resetInMs / 1000),
            resetInMs,
          };
        }
      }

      // Reset or new key
      await adminClient.from("rate_limits").upsert(
        {
          key,
          count: 1,
          reset_at: resetAtIso,
        },
        { onConflict: "key" }
      );

      return {
        allowed: true,
        limit: config.maxRequests,
        remaining: config.maxRequests - 1,
        resetSeconds: config.windowSeconds,
        resetInMs: windowMs,
      };
    } catch (e: any) {
      console.warn("[RATE-LIMITER] DB check failed, using local sliding window:", e?.message);
    }
  }

  return checkRateLimit(key, config);
}

/**
 * Checks and increments the rate limit counter for a given key using an in-memory sliding window.
 */
export function checkRateLimit(
  key: string,
  configOrLimit: RateLimitConfig | number,
  optionalWindowMs?: number
): RateLimitResult {
  const config = normalizeConfig(configOrLimit, optionalWindowMs);
  const now = Date.now();
  const windowMs = config.windowSeconds * 1000;
  const threshold = now - windowMs;

  let timestamps = rateLimitMap.get(key) || [];
  // Evict timestamps outside the active sliding window
  timestamps = timestamps.filter((t) => t > threshold);

  if (timestamps.length >= config.maxRequests) {
    const oldest = timestamps[0];
    const resetMs = oldest + windowMs - now;
    const resetSeconds = Math.max(1, Math.ceil(resetMs / 1000));

    return {
      allowed: false,
      limit: config.maxRequests,
      remaining: 0,
      resetSeconds,
      resetInMs: resetMs,
    };
  }

  // Record this request
  timestamps.push(now);
  rateLimitMap.set(key, timestamps);

  // Periodic pruning if map exceeds max entries
  if (rateLimitMap.size > MAX_KEYS) {
    pruneRateLimitMap();
  }

  const remaining = config.maxRequests - timestamps.length;
  return {
    allowed: true,
    limit: config.maxRequests,
    remaining,
    resetSeconds: config.windowSeconds,
    resetInMs: windowMs,
  };
}

function pruneRateLimitMap(): void {
  const now = Date.now();
  for (const [k, ts] of rateLimitMap.entries()) {
    const valid = ts.filter((t) => now - t < 120000); // 2 mins retention
    if (valid.length === 0) {
      rateLimitMap.delete(k);
    } else {
      rateLimitMap.set(k, valid);
    }
  }
}

// Preset configurations for sensitive BISHOP endpoints
export const RATE_LIMIT_PRESETS = {
  auth: { maxRequests: 8, windowSeconds: 60 },         // 8 login attempts / min
  otp: { maxRequests: 5, windowSeconds: 60 },          // 5 OTP requests / min
  orders: { maxRequests: 20, windowSeconds: 60 },       // 20 orders / min per IP
  employeeVerify: { maxRequests: 10, windowSeconds: 60 }, // 10 employee verify / min
  resetPassword: { maxRequests: 5, windowSeconds: 900 }, // 5 reset attempts / 15 mins
  general: { maxRequests: 120, windowSeconds: 60 },    // 120 requests / min
};
