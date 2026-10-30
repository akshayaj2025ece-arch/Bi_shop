/**
 * BISHOP Server-Side Supabase Domain Module
 * Exports server-side client factories, privileged admin client helpers,
 * and middleware session utilities.
 */

if (typeof window !== "undefined") {
  throw new Error("Security Error: server-only module '@/server/supabase' cannot be executed in browser context.");
}

export * from "./server-client";
export * from "./admin-client";
export * from "./middleware-client";
