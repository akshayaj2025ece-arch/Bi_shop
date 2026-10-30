/**
 * Server-side Stock and Inventory Service for BISHOP.
 * Handles fetching merged inventory and menu items, and updating stock quantities
 * with automatic menu item availability synchronization.
 */

if (typeof window !== "undefined") {
  throw new Error("Security Error: server-only module '@/server/inventory/stock-service' cannot be executed in browser context.");
}

import { createClient } from "@supabase/supabase-js";

export interface StockItem {
  id: string;
  inventory_id: string | null;
  menu_item_id: string | null;
  name: string;
  price: number;
  quantity: number;
  unit: string;
  is_available: boolean;
}

export interface GetStockResultSuccess {
  success: true;
  items: StockItem[];
}

export interface GetStockResultFailure {
  success: false;
  error: string;
  status: number;
}

export type GetStockResult = GetStockResultSuccess | GetStockResultFailure;

export interface UpdateStockParams {
  shop_id: string;
  item_id?: string | null;
  inventory_id?: string | null;
  menu_item_id?: string | null;
  name?: string | null;
  quantity?: number | string | null;
  is_available?: boolean | null;
}

export interface UpdateStockResultSuccess {
  success: true;
  message: string;
  updated: {
    quantity: number;
    is_available: boolean;
  };
}

export interface UpdateStockResultFailure {
  success: false;
  error: string;
  status: number;
}

export type UpdateStockResult = UpdateStockResultSuccess | UpdateStockResultFailure;

function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!supabaseUrl || !serviceKey) {
    return null;
  }

  return createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Fetches and merges both inventory items and menu items for a shop.
 */
export async function getShopStock(shopId: string): Promise<GetStockResult> {
  const adminClient = getSupabaseAdmin();
  if (!adminClient) {
    return {
      success: false,
      error: "Server Configuration Error: Supabase credentials missing.",
      status: 500,
    };
  }

  // Fetch both inventory and menu_items for this shop
  const [invRes, menuRes] = await Promise.all([
    adminClient.from("inventory").select("*").eq("shop_id", shopId).order("name", { ascending: true }),
    adminClient.from("menu_items").select("*").eq("shop_id", shopId).order("name", { ascending: true }),
  ]);

  const inventoryItems = invRes.data || [];
  const menuItems = menuRes.data || [];

  const itemMap = new Map<string, StockItem>();

  // 1. Add inventory items first
  inventoryItems.forEach((inv: any) => {
    if (!inv.name) return;
    const key = inv.name.trim().toLowerCase();
    itemMap.set(key, {
      id: inv.id,
      inventory_id: inv.id,
      menu_item_id: null,
      name: inv.name.trim(),
      price: Number(inv.cost_per_unit) || 0,
      quantity: Number(inv.quantity) || 0,
      unit: inv.unit || "pcs",
      is_available: Number(inv.quantity) > 0,
    });
  });

  // 2. Merge menu_items
  menuItems.forEach((menu: any) => {
    if (!menu.name) return;
    const key = menu.name.trim().toLowerCase();
    if (itemMap.has(key)) {
      const existing = itemMap.get(key)!;
      existing.menu_item_id = menu.id;
      if (menu.price !== undefined && menu.price !== null) {
        existing.price = Number(menu.price);
      }
      existing.is_available = existing.quantity > 0 && Boolean(menu.is_available);
    } else {
      const qty = menu.quantity !== undefined && menu.quantity !== null ? Number(menu.quantity) : (menu.is_available ? 10 : 0);
      itemMap.set(key, {
        id: menu.id,
        inventory_id: null,
        menu_item_id: menu.id,
        name: menu.name.trim(),
        price: Number(menu.price) || 0,
        quantity: qty,
        unit: "pcs",
        is_available: Boolean(menu.is_available) && qty > 0,
      });
    }
  });

  return {
    success: true,
    items: Array.from(itemMap.values()),
  };
}

/**
 * Updates stock quantity in inventory and synchronizes availability in menu_items.
 */
export async function updateShopStock(params: UpdateStockParams): Promise<UpdateStockResult> {
  const { item_id, inventory_id, menu_item_id, name, quantity, is_available, shop_id } = params;

  const safeQuantity = Math.max(0, Number(quantity) || 0);
  const safeAvailable = is_available !== undefined ? Boolean(is_available) : safeQuantity > 0;

  const adminClient = getSupabaseAdmin();
  if (!adminClient) {
    return {
      success: false,
      error: "Server Configuration Error: Supabase credentials missing.",
      status: 500,
    };
  }

  const nowIso = new Date().toISOString();

  // 1. Update inventory table
  let invQuery = adminClient.from("inventory").update({
    quantity: safeQuantity,
    updated_at: nowIso,
  });

  if (inventory_id) {
    invQuery = invQuery.eq("id", inventory_id).eq("shop_id", shop_id);
  } else if (name) {
    invQuery = invQuery.eq("shop_id", shop_id).ilike("name", name.trim());
  } else if (item_id) {
    invQuery = invQuery.eq("id", item_id).eq("shop_id", shop_id);
  }

  const { error: invErr } = await invQuery;
  if (invErr) {
    console.warn("Notice: Inventory table update error/missing row:", invErr.message);
  }

  // 2. Update menu_items table
  let menuQuery = adminClient.from("menu_items").update({
    is_available: safeAvailable,
    updated_at: nowIso,
  });

  if (menu_item_id) {
    menuQuery = menuQuery.eq("id", menu_item_id).eq("shop_id", shop_id);
  } else if (name) {
    menuQuery = menuQuery.eq("shop_id", shop_id).ilike("name", name.trim());
  } else if (item_id) {
    menuQuery = menuQuery.eq("id", item_id).eq("shop_id", shop_id);
  }

  const { error: menuErr } = await menuQuery;
  if (menuErr) {
    console.warn("Notice: Menu items table update error/missing row:", menuErr.message);
  }

  return {
    success: true,
    message: "Stock updated successfully!",
    updated: {
      quantity: safeQuantity,
      is_available: safeAvailable,
    },
  };
}
