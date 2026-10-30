import { create } from "zustand";
import type { AuthState } from "@/lib/types";

const AUTH_CACHE_KEY = "bishop_auth_cache_v1";

function getInitialCachedState() {
  if (typeof window !== "undefined") {
    try {
      const raw = localStorage.getItem(AUTH_CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.user?.id) {
          return {
            user: parsed.user,
            shop: parsed.shop || null,
            shops: Array.isArray(parsed.shops) ? parsed.shops : [],
            isAllShops: Boolean(parsed.isAllShops),
            isLoading: false,
          };
        }
      }
    } catch {
      // ignore JSON parse or storage errors
    }
  }
  return {
    user: null,
    shop: null,
    shops: [],
    isAllShops: false,
    isLoading: false,
  };
}

function persistCache(state: {
  user: any;
  shop: any;
  shops: any[];
  isAllShops: boolean;
}) {
  if (typeof window === "undefined") return;
  try {
    if (state.user?.id) {
      localStorage.setItem(
        AUTH_CACHE_KEY,
        JSON.stringify({
          user: state.user,
          shop: state.shop,
          shops: state.shops,
          isAllShops: state.isAllShops,
        })
      );
    } else {
      localStorage.removeItem(AUTH_CACHE_KEY);
    }
  } catch {
    // ignore storage quota errors
  }
}

const initial = getInitialCachedState();

/**
 * Global auth store using Zustand.
 * Manages the current user profile, shop, and loading state with instant SWR hydration.
 */
export const useAuthStore = create<AuthState>((set) => ({
  user: initial.user,
  shop: initial.shop,
  shops: initial.shops,
  isAllShops: initial.isAllShops,
  isLoading: initial.isLoading,
  setUser: (user) => {
    set((state) => {
      const next = { ...state, user };
      persistCache(next);
      return { user };
    });
  },
  setShop: (shop) => {
    set((state) => {
      const next = { ...state, shop };
      persistCache(next);
      return { shop };
    });
  },
  setShops: (shops) => {
    set((state) => {
      const next = { ...state, shops };
      persistCache(next);
      return { shops };
    });
  },
  setIsAllShops: (isAllShops) => {
    set((state) => {
      const next = { ...state, isAllShops };
      persistCache(next);
      return { isAllShops };
    });
  },
  setLoading: (isLoading) => set({ isLoading }),
  reset: () => {
    if (typeof window !== "undefined") {
      try {
        localStorage.removeItem(AUTH_CACHE_KEY);
        localStorage.removeItem("bishop_active_shop_id");
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const key = localStorage.key(i);
          if (
            key &&
            (key.startsWith("bishop_active_shop_id") ||
              key.startsWith("bishop_task_") ||
              key.startsWith("bishop_notif_") ||
              key.startsWith("bishop_auth_"))
          ) {
            localStorage.removeItem(key);
          }
        }
      } catch {
        // ignore storage errors
      }
    }
    set({ user: null, shop: null, shops: [], isAllShops: false, isLoading: false });
  },
}));
