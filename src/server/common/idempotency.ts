/**
 * Server-side Durable Idempotency Utility for BISHOP.
 * Protects critical non-idempotent operations (order submission, payments, inventory updates)
 * from duplicate execution caused by client retries or network replays.
 * Persists to Supabase `idempotency_keys` table with seamless in-memory fallback.
 */

if (typeof window !== "undefined") {
  throw new Error("Security Error: server-only module '@/server/common/idempotency' cannot be executed in browser context.");
}

import { createClient, SupabaseClient } from "@supabase/supabase-js";

interface IdempotencyRecord<T = any> {
  key: string;
  scope: string;
  status: "pending" | "completed";
  response?: T;
  created_at: number;
  expires_at: number;
}

// In-memory fallback store
const idempotencyStore = new Map<string, IdempotencyRecord>();

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function getSupabaseAdmin(): SupabaseClient | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceKey) return null;
  return createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function makeCompositeKey(scope: string, key: string): string {
  return `${scope}:${key.trim()}`;
}

/**
 * Asynchronously checks if an operation with this idempotency key has already completed.
 * Queries Supabase `idempotency_keys` table first, falling back to in-memory store.
 * If completed, returns the cached response.
 * If not found, reserves the key in 'pending' state.
 */
export async function checkAndRecordIdempotencyAsync<T>(
  scope: string,
  key: string,
  ttlMs: number = DEFAULT_TTL_MS
): Promise<{ cached: boolean; response?: T }> {
  const cleanKey = key.trim();
  const compositeKey = makeCompositeKey(scope, cleanKey);
  const now = Date.now();
  const expiresAtIso = new Date(now + ttlMs).toISOString();

  const adminClient = getSupabaseAdmin();
  if (adminClient) {
    try {
      // 1. Query database for existing key in this scope
      const { data, error } = await adminClient
        .from("idempotency_keys")
        .select("status, response, expires_at")
        .eq("scope", scope)
        .eq("key", cleanKey)
        .maybeSingle();

      if (!error && data) {
        const expiresAt = new Date(data.expires_at).getTime();
        if (now <= expiresAt) {
          if (data.status === "completed" && data.response) {
            // Populate in-memory cache as well
            idempotencyStore.set(compositeKey, {
              key: cleanKey,
              scope,
              status: "completed",
              response: data.response as T,
              created_at: now,
              expires_at: expiresAt,
            });
            return {
              cached: true,
              response: data.response as T,
            };
          }
        } else {
          // Expired row: delete or overwrite
          await adminClient
            .from("idempotency_keys")
            .delete()
            .eq("scope", scope)
            .eq("key", cleanKey);
        }
      }

      // 2. Reserve in pending state in DB
      await adminClient.from("idempotency_keys").upsert(
        {
          scope,
          key: cleanKey,
          status: "pending",
          response: null,
          expires_at: expiresAtIso,
          created_at: new Date(now).toISOString(),
        },
        { onConflict: "scope,key" }
      );
    } catch (dbErr: any) {
      console.warn("[IDEMPOTENCY] DB check failed, using memory store:", dbErr?.message);
    }
  }

  // Fallback to in-memory check
  return checkAndRecordIdempotency<T>(scope, cleanKey, ttlMs);
}

/**
 * Synchronous version for backward compatibility.
 */
export function checkAndRecordIdempotency<T>(
  scope: string,
  key: string,
  ttlMs: number = DEFAULT_TTL_MS
): { cached: boolean; response?: T } {
  const compositeKey = makeCompositeKey(scope, key);
  const now = Date.now();
  const existing = idempotencyStore.get(compositeKey);

  if (existing) {
    if (now > existing.expires_at) {
      idempotencyStore.delete(compositeKey);
    } else if (existing.status === "completed" && existing.response !== undefined) {
      return {
        cached: true,
        response: existing.response as T,
      };
    }
  }

  idempotencyStore.set(compositeKey, {
    key: key.trim(),
    scope,
    status: "pending",
    created_at: now,
    expires_at: now + ttlMs,
  });

  return { cached: false };
}

/**
 * Asynchronously stores the completed result in Supabase idempotency_keys table and memory.
 */
export async function completeIdempotencyKeyAsync<T>(
  scope: string,
  key: string,
  response: T,
  ttlMs: number = DEFAULT_TTL_MS
): Promise<void> {
  const cleanKey = key.trim();
  const compositeKey = makeCompositeKey(scope, cleanKey);
  const now = Date.now();
  const expiresAtIso = new Date(now + ttlMs).toISOString();

  // Save in memory
  idempotencyStore.set(compositeKey, {
    key: cleanKey,
    scope,
    status: "completed",
    response,
    created_at: now,
    expires_at: now + ttlMs,
  });

  // Persist to Supabase
  const adminClient = getSupabaseAdmin();
  if (adminClient) {
    try {
      await adminClient.from("idempotency_keys").upsert(
        {
          scope,
          key: cleanKey,
          status: "completed",
          response,
          expires_at: expiresAtIso,
          created_at: new Date(now).toISOString(),
        },
        { onConflict: "scope,key" }
      );
    } catch (dbErr: any) {
      console.warn("[IDEMPOTENCY] DB complete failed:", dbErr?.message);
    }
  }
}

/**
 * Synchronous completeIdempotencyKey for backward compatibility.
 */
export function completeIdempotencyKey<T>(
  scope: string,
  key: string,
  response: T,
  ttlMs: number = DEFAULT_TTL_MS
): void {
  const cleanKey = key.trim();
  const compositeKey = makeCompositeKey(scope, cleanKey);
  const now = Date.now();

  idempotencyStore.set(compositeKey, {
    key: cleanKey,
    scope,
    status: "completed",
    response,
    created_at: now,
    expires_at: now + ttlMs,
  });

  const adminClient = getSupabaseAdmin();
  if (adminClient) {
    Promise.resolve(
      adminClient.from("idempotency_keys").upsert(
        {
          scope,
          key: cleanKey,
          status: "completed",
          response,
          expires_at: new Date(now + ttlMs).toISOString(),
          created_at: new Date(now).toISOString(),
        },
        { onConflict: "scope,key" }
      )
    ).catch(() => {});
  }
}

/**
 * Asynchronously evicts expired idempotency keys from both database and memory.
 */
export async function pruneExpiredIdempotencyKeysAsync(): Promise<number> {
  const prunedMemory = pruneExpiredIdempotencyKeys();
  let prunedDb = 0;

  const adminClient = getSupabaseAdmin();
  if (adminClient) {
    try {
      const { data, error } = await adminClient
        .from("idempotency_keys")
        .delete()
        .lt("expires_at", new Date().toISOString())
        .select("id");

      if (!error && data) {
        prunedDb = data.length;
      }
    } catch (e: any) {
      console.warn("[IDEMPOTENCY] DB pruning error:", e?.message);
    }
  }

  return prunedMemory + prunedDb;
}

/**
 * Evicts expired idempotency keys from memory to avoid resource growth.
 */
export function pruneExpiredIdempotencyKeys(): number {
  const now = Date.now();
  let pruned = 0;
  for (const [k, record] of idempotencyStore.entries()) {
    if (now > record.expires_at) {
      idempotencyStore.delete(k);
      pruned++;
    }
  }
  return pruned;
}
