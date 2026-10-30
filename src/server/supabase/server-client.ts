/**
 * Server-side Supabase Client Factory for BISHOP.
 * Utilizes Next.js cookies() and @supabase/ssr for secure server-side session handling.
 */

if (typeof window !== "undefined") {
  throw new Error("Security Error: server-only module '@/server/supabase/server-client' cannot be executed in browser context.");
}

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();

  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "";
  const rawKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || "";

  const supabaseUrl =
    rawUrl.startsWith("http://") || rawUrl.startsWith("https://")
      ? rawUrl
      : "https://placeholder.supabase.co";
  const supabaseKey = rawKey || "placeholder-key";

  return createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // The `setAll` method was called from a Server Component.
          // This can be ignored if you have middleware refreshing sessions.
        }
      },
    },
  });
}
