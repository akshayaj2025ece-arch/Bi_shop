/**
 * Server-only Supabase Admin Client for BISHOP.
 * Utilizes the privileged SUPABASE_SERVICE_ROLE_KEY to bypass Row Level Security (RLS)
 * for administrative tasks like user management, password updates, and secure employee provisioning.
 */

if (typeof window !== "undefined") {
  throw new Error("Security Error: server-only module '@/server/supabase/admin-client' cannot be executed in browser context.");
}

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Creates or retrieves a privileged Supabase Admin Client using the server-only service role key.
 * Returns null if SUPABASE_SERVICE_ROLE_KEY is not configured.
 */
export function createAdminClient(): SupabaseClient | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (
    !supabaseUrl ||
    !serviceKey ||
    (!supabaseUrl.startsWith("http://") && !supabaseUrl.startsWith("https://"))
  ) {
    return null;
  }

  return createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Convenience helper that throws if service role credentials are not configured.
 */
export function getRequiredAdminClient(): SupabaseClient {
  const client = createAdminClient();
  if (!client) {
    throw new Error(
      "Server Configuration Error: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required for privileged operations."
    );
  }
  return client;
}
