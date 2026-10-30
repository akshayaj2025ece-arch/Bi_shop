/**
 * Server-side Authentication & Login Service for BISHOP.
 * Handles rate-limiting policies (lockout after 2 failed attempts, max 15 attempts),
 * in-memory and persistent attempt tracking, and Supabase password authentication.
 */

if (typeof window !== "undefined") {
  throw new Error("Security Error: server-only module '@/server/auth/login-service' cannot be executed in browser context.");
}

import { createClient } from "@supabase/supabase-js";

// In-memory server-side fallback tracker (persists per server instance)
export interface AttemptRecord {
  consecutive_failed: number;
  total_failed: number;
  locked_until: string | null;
  updated_at: string;
}

const memoryAttemptStore = new Map<string, AttemptRecord>();

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface LoginSuccessResult {
  type: "success";
  session: any;
  user: any;
}

export interface LoginConfigErrorResult {
  type: "config_error";
  error: string;
}

export interface LoginMaxAttemptsResult {
  type: "max_attempts";
  error: string;
  consecutive_failed?: number;
  total_failed: number;
}

export interface LoginLockedResult {
  type: "locked";
  error: string;
  remainingSeconds: number;
  consecutive_failed: number;
  total_failed: number;
}

export interface LoginFailedResult {
  type: "failed";
  error: string;
  isUnconfirmed?: boolean;
  consecutive_failed: number;
  total_failed: number;
}

export type LoginResult =
  | LoginSuccessResult
  | LoginConfigErrorResult
  | LoginMaxAttemptsResult
  | LoginLockedResult
  | LoginFailedResult;

/**
 * Executes full user login workflow:
 * 1. Checks server environment configuration.
 * 2. Fetches attempt records from memory or login_attempts table.
 * 3. Enforces 15 max attempts policy and 30s temporary lockout policy.
 * 4. Verifies credentials via Supabase Auth signInWithPassword.
 * 5. On success: clears consecutive failures, updates cache and DB.
 * 6. On failure: increments failure counters, sets lockout if >= 2, updates cache and DB, normalizes auth message.
 */
export async function loginUser(credentials: LoginCredentials): Promise<LoginResult> {
  const { email, password } = credentials;
  const cleanEmail = email.trim().toLowerCase();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!supabaseUrl || !anonKey) {
    return {
      type: "config_error",
      error: "Server authentication configuration missing.",
    };
  }

  // Admin client for persistent storage operations
  const adminClient = serviceKey
    ? createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    : null;

  // Standard client for password verification
  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1. Fetch current attempt record for this email
  let currentAttempt: AttemptRecord = {
    consecutive_failed: 0,
    total_failed: 0,
    locked_until: null,
    updated_at: new Date().toISOString(),
  };

  // Check memory store
  if (memoryAttemptStore.has(cleanEmail)) {
    currentAttempt = { ...memoryAttemptStore.get(cleanEmail)! };
  }

  // Check Supabase DB table if available
  if (adminClient) {
    try {
      const { data: dbData } = await adminClient
        .from("login_attempts")
        .select("consecutive_failed, total_failed, locked_until, updated_at")
        .eq("email", cleanEmail)
        .maybeSingle();

      if (dbData) {
        currentAttempt = {
          consecutive_failed: dbData.consecutive_failed ?? 0,
          total_failed: dbData.total_failed ?? 0,
          locked_until: dbData.locked_until || null,
          updated_at: dbData.updated_at || new Date().toISOString(),
        };
        memoryAttemptStore.set(cleanEmail, currentAttempt);
      }
    } catch (dbErr) {
      console.warn("login_attempts table fetch warning:", dbErr);
    }
  }

  const now = Date.now();

  // 2. Check Maximum Attempts Policy (15 total failed attempts)
  if (currentAttempt.total_failed >= 15) {
    return {
      type: "max_attempts",
      error: "Maximum login attempts reached. Please contact the owner.",
      total_failed: currentAttempt.total_failed,
    };
  }

  // 3. Check Temporary 30-Second Lockout Policy (2 consecutive failed attempts)
  if (
    currentAttempt.consecutive_failed >= 2 &&
    currentAttempt.locked_until
  ) {
    const lockTime = new Date(currentAttempt.locked_until).getTime();
    const remainingSeconds = Math.ceil((lockTime - now) / 1000);

    if (remainingSeconds > 0) {
      return {
        type: "locked",
        error: `Too many failed attempts. Please wait ${remainingSeconds} seconds.`,
        remainingSeconds,
        consecutive_failed: currentAttempt.consecutive_failed,
        total_failed: currentAttempt.total_failed,
      };
    }
  }

  // 4. Perform Supabase Auth password verification
  const { data: authData, error: authError } =
    await authClient.auth.signInWithPassword({
      email: cleanEmail,
      password,
    });

  // 5. SUCCESSFUL LOGIN
  if (!authError && authData?.session) {
    currentAttempt.consecutive_failed = 0;
    currentAttempt.locked_until = null;
    currentAttempt.updated_at = new Date().toISOString();

    memoryAttemptStore.set(cleanEmail, currentAttempt);

    if (adminClient) {
      // Auto-provision profile if missing (e.g. newly confirmed users whose profile was not created on signup)
      try {
        const { data: existingProfile } = await adminClient
          .from("profiles")
          .select("id")
          .eq("id", authData.user.id)
          .maybeSingle();

        if (!existingProfile) {
          const userMeta = authData.user.user_metadata || {};
          const role = userMeta.role === "employee" ? "employee" : "shopkeeper";
          await adminClient.from("profiles").upsert({
            id: authData.user.id,
            email: cleanEmail,
            full_name: userMeta.full_name || "Shopkeeper",
            role: role,
          });
        }
      } catch (profErr) {
        console.warn("Auto-provision profile warning on login:", profErr);
      }

      try {
        await adminClient.from("login_attempts").upsert({
          email: cleanEmail,
          consecutive_failed: 0,
          total_failed: currentAttempt.total_failed,
          locked_until: null,
          updated_at: currentAttempt.updated_at,
        });
      } catch (dbErr) {
        console.warn("login_attempts upsert warning on success:", dbErr);
      }
    }

    return {
      type: "success",
      session: authData.session,
      user: authData.user,
    };
  }

  // 6. Check for unconfirmed email (do not increment failed password attempts or lock out user)
  let isUnconfirmed =
    authError?.code === "email_not_confirmed" ||
    Boolean(authError?.message?.toLowerCase().includes("email not confirmed"));

  if (!isUnconfirmed && adminClient && (authError?.code === "invalid_credentials" || authError?.message?.includes("Invalid login credentials"))) {
    try {
      const { data: usersData } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 100 });
      const matchingUser = usersData?.users?.find(
        (u) => u.email?.toLowerCase() === cleanEmail
      );
      if (matchingUser && !matchingUser.email_confirmed_at) {
        isUnconfirmed = true;
      }
    } catch (lookupErr) {
      console.warn("User confirmation check lookup warning:", lookupErr);
    }
  }

  if (isUnconfirmed) {
    return {
      type: "failed",
      error: "Email not confirmed. Please check your inbox or spam folder to confirm your account before logging in.",
      isUnconfirmed: true,
      consecutive_failed: currentAttempt.consecutive_failed,
      total_failed: currentAttempt.total_failed,
    };
  }

  // 7. FAILED LOGIN (WRONG PASSWORD OR OTHER AUTH FAILURE)
  const newConsecutive = currentAttempt.consecutive_failed + 1;
  const newTotal = currentAttempt.total_failed + 1;
  let newLockedUntil: string | null = null;

  if (newConsecutive >= 2) {
    newLockedUntil = new Date(Date.now() + 30000).toISOString();
  }

  const updatedRecord: AttemptRecord = {
    consecutive_failed: newConsecutive,
    total_failed: newTotal,
    locked_until: newLockedUntil,
    updated_at: new Date().toISOString(),
  };

  memoryAttemptStore.set(cleanEmail, updatedRecord);

  if (adminClient) {
    try {
      await adminClient.from("login_attempts").upsert({
        email: cleanEmail,
        consecutive_failed: newConsecutive,
        total_failed: newTotal,
        locked_until: newLockedUntil,
        updated_at: updatedRecord.updated_at,
      });
    } catch (dbErr) {
      console.warn("login_attempts upsert warning on failure:", dbErr);
    }
  }

  // Return appropriate security error response
  if (newTotal >= 15) {
    return {
      type: "max_attempts",
      error: "Maximum login attempts reached. Please contact the owner.",
      consecutive_failed: newConsecutive,
      total_failed: newTotal,
    };
  }

  if (newConsecutive >= 2) {
    return {
      type: "locked",
      error: "Too many failed attempts. Please wait 30 seconds.",
      remainingSeconds: 30,
      consecutive_failed: newConsecutive,
      total_failed: newTotal,
    };
  }

  // Distinguish genuine credential mismatch from unrelated Supabase / database / rate-limit errors
  const isCredentialMismatch =
    authError?.code === "invalid_credentials" ||
    Boolean(authError?.message?.includes("Invalid login credentials"));

  const authMsg = isCredentialMismatch
    ? "Invalid email or password."
    : authError?.message || "Authentication service error. Please try again.";

  return {
    type: "failed",
    error: authMsg,
    consecutive_failed: newConsecutive,
    total_failed: newTotal,
  };
}
