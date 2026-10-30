"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuthStore } from "@/stores/auth-store";
import type { Profile, Shop, UserRole } from "@/lib/types";

const ACTIVE_SHOP_STORAGE_KEY_LEGACY = "bishop_active_shop_id";

function getActiveShopStorageKey(userId?: string | null): string {
  return userId ? `bishop_active_shop_id_${userId}` : ACTIVE_SHOP_STORAGE_KEY_LEGACY;
}

/**
 * Hook that initializes and manages the auth session in the background.
 * Uses SWR hydration from local storage so UI renders in 0ms without full-page spinners.
 */
export function useAuth() {
  const { user, shop, shops, isLoading, setUser, setShop, setShops, setIsAllShops, setLoading, reset } =
    useAuthStore();

  const activeUserIdRef = useRef<string | null>(null);
  const currentRequestIdRef = useRef(0);

  useEffect(() => {
    const supabase = createClient();

    // Fetch user profile and shop data in background without tearing down existing UI
    async function loadUserData(authenticatedUser: any) {
      if (!authenticatedUser?.id) {
        setLoading(false);
        return;
      }

      // If user ID changed, reset state for clean account boundary
      if (activeUserIdRef.current && activeUserIdRef.current !== authenticatedUser.id) {
        reset();
      }

      // If already fully loaded for this user, do a lightweight background revalidation without setting loading
      const isInitialUserLoad = activeUserIdRef.current !== authenticatedUser.id;
      if (isInitialUserLoad) {
        activeUserIdRef.current = authenticatedUser.id;
      }

      const requestId = ++currentRequestIdRef.current;

      try {
        // Fetch profile and owned shops in parallel using verified user ID
        const [profileRes, ownedShopsRes] = await Promise.all([
          supabase.from("profiles").select("*").eq("id", authenticatedUser.id).maybeSingle(),
          supabase
            .from("shops")
            .select("*")
            .eq("owner_id", authenticatedUser.id)
            .order("created_at", { ascending: true }),
        ]);

        if (requestId !== currentRequestIdRef.current || activeUserIdRef.current !== authenticatedUser.id) {
          return;
        }

        const profile = profileRes.data as Profile | null;
        const ownedShops = (ownedShopsRes.data as Shop[]) || [];
        const isEmployee = profile?.role === "employee";

        const effectiveRole: UserRole = isEmployee
          ? "employee"
          : ownedShops.length > 0
          ? "shopkeeper"
          : (profile?.role as UserRole) || "customer";

        if (profile) {
          setUser({
            ...profile,
            role: effectiveRole,
          });
        }

        if (isEmployee) {
          setIsAllShops(false);
          if (profile?.shop_id) {
            const { data: employeeShopData } = await supabase
              .from("shops")
              .select("*")
              .eq("id", profile.shop_id)
              .maybeSingle();

            if (requestId !== currentRequestIdRef.current || activeUserIdRef.current !== authenticatedUser.id) return;

            if (employeeShopData) {
              const employeeShop = employeeShopData as Shop;
              setShops([employeeShop]);
              setShop(employeeShop);
              if (typeof window !== "undefined") {
                try {
                  const storageKey = getActiveShopStorageKey(authenticatedUser.id);
                  localStorage.setItem(storageKey, employeeShop.id);
                  localStorage.setItem(ACTIVE_SHOP_STORAGE_KEY_LEGACY, employeeShop.id);
                } catch {
                  // ignore
                }
              }
            } else {
              setShops([]);
              setShop(null);
            }
          } else {
            setShops([]);
            setShop(null);
          }
        } else if (ownedShops.length > 0) {
          setShops(ownedShops);

          const userStorageKey = getActiveShopStorageKey(authenticatedUser.id);
          let savedShopId: string | null = null;
          if (typeof window !== "undefined") {
            try {
              savedShopId = localStorage.getItem(userStorageKey);
              if (!savedShopId) {
                savedShopId = localStorage.getItem(ACTIVE_SHOP_STORAGE_KEY_LEGACY);
              }
            } catch {
              savedShopId = null;
            }
          }

          let activeShop: Shop | null = null;

          if (ownedShops.length > 1) {
            if (!savedShopId || savedShopId === "all") {
              setIsAllShops(true);
              activeShop = ownedShops[0];
              if (typeof window !== "undefined") {
                try {
                  localStorage.setItem(userStorageKey, "all");
                  localStorage.setItem(ACTIVE_SHOP_STORAGE_KEY_LEGACY, "all");
                } catch {
                  // ignore
                }
              }
            } else {
              const matched = ownedShops.find((s) => s.id === savedShopId);
              if (matched) {
                activeShop = matched;
                setIsAllShops(false);
                if (typeof window !== "undefined") {
                  try {
                    localStorage.setItem(userStorageKey, matched.id);
                  } catch {
                    // ignore
                  }
                }
              } else {
                setIsAllShops(true);
                activeShop = ownedShops[0];
                if (typeof window !== "undefined") {
                  try {
                    localStorage.setItem(userStorageKey, "all");
                    localStorage.setItem(ACTIVE_SHOP_STORAGE_KEY_LEGACY, "all");
                  } catch {
                    // ignore
                  }
                }
              }
            }
          } else {
            setIsAllShops(false);
            activeShop = ownedShops[0];
            if (typeof window !== "undefined") {
              try {
                localStorage.setItem(userStorageKey, activeShop.id);
                localStorage.setItem(ACTIVE_SHOP_STORAGE_KEY_LEGACY, activeShop.id);
              } catch {
                // ignore
              }
            }
          }

          setShop(activeShop);

          if (
            ownedShops.length === 1 &&
            profile &&
            activeShop.owner_id === profile.id &&
            profile.shop_id !== activeShop.id
          ) {
            supabase
              .from("profiles")
              .update({ shop_id: activeShop.id })
              .eq("id", profile.id)
              .then();
          } else if (!profile) {
            const fallbackProfile: Profile = {
              id: authenticatedUser.id,
              email: authenticatedUser.email || "",
              full_name: authenticatedUser.user_metadata?.full_name || "Owner",
              role: "shopkeeper",
              shop_id: activeShop.id,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
            await supabase.from("profiles").upsert(fallbackProfile);
            if (requestId === currentRequestIdRef.current && activeUserIdRef.current === authenticatedUser.id) {
              setUser(fallbackProfile);
            }
          }
        } else {
          setIsAllShops(false);
          setShops([]);
          setShop(null);
        }
      } catch (error) {
        console.error("Error loading user data:", error);
        if (requestId === currentRequestIdRef.current) {
          activeUserIdRef.current = null;
        }
      } finally {
        if (requestId === currentRequestIdRef.current) {
          setLoading(false);
        }
      }
    }

    // Single unified initial session check — avoids duplicate getUser() waterfall
    supabase.auth.getUser().then(({ data }: any) => {
      if (data?.user) {
        loadUserData(data.user);
      } else {
        setLoading(false);
      }
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event: any, session: any) => {
      if (session?.user) {
        loadUserData(session.user);
      } else {
        activeUserIdRef.current = null;
        currentRequestIdRef.current++;
        reset();
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [setUser, setShop, setShops, setIsAllShops, setLoading, reset]);

  return { user, shop, shops, isLoading };
}
