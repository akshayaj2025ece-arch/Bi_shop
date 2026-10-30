import { create } from "zustand";
import type { AuthState } from "@/lib/types";

/**
 * Global auth store using Zustand.
 * Manages the current user profile, shop, and loading state.
 */
export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  shop: null,
  shops: [],
  isAllShops: false,
  isLoading: true,
  setUser: (user) => set({ user }),
  setShop: (shop) => set({ shop }),
  setShops: (shops) => set({ shops }),
  setIsAllShops: (isAllShops) => set({ isAllShops }),
  setLoading: (isLoading) => set({ isLoading }),
  reset: () => {
    if (typeof window !== "undefined") {
      try {
        localStorage.removeItem("bishop_active_shop_id");
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const key = localStorage.key(i);
          if (
            key &&
            (key.startsWith("bishop_active_shop_id") ||
              key.startsWith("bishop_task_") ||
              key.startsWith("bishop_notif_"))
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
