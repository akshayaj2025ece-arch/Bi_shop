"use client";

import { useAuth } from "@/hooks/use-auth";

interface AuthProviderProps {
  children: React.ReactNode;
}

/**
 * Wraps the app and initializes the Supabase auth session in the background.
 * Does not block initial page rendering, ensuring instant FCP/LCP for all routes.
 */
export function AuthProvider({ children }: AuthProviderProps) {
  useAuth();
  return <>{children}</>;
}
