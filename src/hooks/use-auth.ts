"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuthStore } from "@/stores/auth-store";
import type { Profile, Shop, UserRole } from "@/lib/types";

const ACTIVE_SHOP_STORAGE_KEY_LEGACY = "bishop_active_shop_id";

function getActiveShopStorageKey(userId?: string | null): string {
  return userId ? `bishop_active_shop_id_${userId}` : ACTIVE_SHOP_STORAGE_KEY_LEGACY;
}

/**
 * Hook that initializes and manages the auth session.
 * Listens for Supabase auth state changes and syncs the user profile + shop.
 */
export function useAuth() {
  const { user, shop, shops, isLoading, setUser, setShop, setShops, setIsAllShops, setLoading, reset } =
    useAuthStore();

  useEffect(() => {
    const supabase = createClient();

    let activeUserId: string | null = null;
    let currentRequestId = 0;

    // Fetch user profile and shop data
    async function loadUserData(userId: string) {
      if (activeUserId === userId) return;

      // When switching accounts or loading a new account:
      // Immediately reset previous state and set loading to prevent displaying stale data
      reset();
      setLoading(true);

      activeUserId = userId;
      const requestId = ++currentRequestId;

      try {
        // Obtain and verify authenticated user session directly
        const { data: authData, error: authError } = await supabase.auth.getUser();
        if (authError || !authData?.user || authData.user.id !== userId) {
          if (requestId === currentRequestId) {
            activeUserId = null;
            reset();
            setLoading(false);
          }
          return;
        }

        const authenticatedUser = authData.user;

        // Fetch profile and all potential owned shops strictly using verified user ID
        const [profileRes, ownedShopsRes] = await Promise.all([
          supabase.from("profiles").select("*").eq("id", authenticatedUser.id).maybeSingle(),
          supabase
            .from("shops")
            .select("*")
            .eq("owner_id", authenticatedUser.id)
            .order("created_at", { ascending: true }),
        ]);

        // Discard result if user changed or another request started in the meantime
        if (requestId !== currentRequestId || activeUserId !== authenticatedUser.id) {
          return;
        }

        const profile = profileRes.data as Profile | null;
        const ownedShops = (ownedShopsRes.data as Shop[]) || [];
        const isEmployee = profile?.role === "employee";

        // Determine effective verified role:
        // - Employees strictly retain "employee" role and are never granted shopkeeper access.
        // - Users with genuine registered owned shops in the database are verified "shopkeeper".
        // - Otherwise fallback to existing profile.role or "customer".
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
          // Employee: strictly restricted to their assigned shop (profile.shop_id).
          // Cannot own or access multi-shop analytics.
          setIsAllShops(false);
          if (profile?.shop_id) {
            const { data: employeeShopData } = await supabase
              .from("shops")
              .select("*")
              .eq("id", profile.shop_id)
              .maybeSingle();

            if (requestId !== currentRequestId || activeUserId !== authenticatedUser.id) return;

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
          // User is a shopkeeper who owns one or more registered shops
          setShops(ownedShops);

          // Reconcile active shop selection strictly scoped to authenticated user ID
          const userStorageKey = getActiveShopStorageKey(authenticatedUser.id);
          let savedShopId: string | null = null;
          if (typeof window !== "undefined") {
            try {
              savedShopId = localStorage.getItem(userStorageKey);
              if (!savedShopId) {
                // Fallback to legacy global key if user-specific key not yet set
                savedShopId = localStorage.getItem(ACTIVE_SHOP_STORAGE_KEY_LEGACY);
              }
            } catch {
              savedShopId = null;
            }
          }

          let activeShop: Shop | null = null;

          if (ownedShops.length > 1) {
            // Multi-shop account: default to All Shops if no valid individual shop is saved
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
            // Single-shop account: always individual shop
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

          // Preserve existing behavior for single-shop accounts:
          // auto-heal missing profile linkage if needed
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
            // If profile is entirely missing but they own a shop, auto-create it
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
            if (requestId === currentRequestId && activeUserId === authenticatedUser.id) {
              setUser(fallbackProfile);
            }
          }
        } else {
          // User with zero registered shops
          setIsAllShops(false);
          setShops([]);
          setShop(null);
        }
      } catch (error) {
        console.error("Error loading user data:", error);
        if (requestId === currentRequestId) {
          activeUserId = null;
        }
      } finally {
        if (requestId === currentRequestId) {
          setLoading(false);
        }
      }
    }

    // Check initial session
    supabase.auth.getUser().then(({ data }: any) => {
      if (data?.user) {
        loadUserData(data.user.id);
      } else {
        setLoading(false);
      }
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event: any, session: any) => {
      if (session?.user) {
        loadUserData(session.user.id);
      } else {
        activeUserId = null;
        currentRequestId++;
        reset();
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [setUser, setShop, setShops, setIsAllShops, setLoading, reset]);

  return { user, shop, shops, isLoading };
}
