"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuthStore } from "@/stores/auth-store";

export interface DashboardStats {
  todayOrders: number;
  todayRevenue: number;
  weekOrders: number;
  weekRevenue: number;
  monthOrders: number;
  monthRevenue: number;
  totalOrders: number;
  totalRevenue: number;
  inventoryCount: number;
  lowStockCount: number;
  employeeCount: number;
  menuItemCount: number;
  recentOrders: RecentOrder[];
  dailyRevenue: DailyDataPoint[];
  ordersByStatus: StatusCount[];
  topItems: TopItem[];
}

export interface RecentOrder {
  id: string;
  order_number: string;
  customer_name: string | null;
  total: number;
  status: string;
  created_at: string;
}

export interface DailyDataPoint {
  date: string;
  revenue: number;
  orders: number;
}

export interface StatusCount {
  status: string;
  count: number;
}

export interface TopItem {
  name: string;
  quantity: number;
  revenue: number;
}

function getStartOfDay(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function getStartOfWeek(): string {
  const d = new Date();
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function getStartOfMonth(): string {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function getDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

// Global SWR in-memory cache for instant zero-latency navigation between dashboard pages
const globalStatsCache = new Map<string, { stats: DashboardStats; timestamp: number }>();
const CACHE_FRESH_WINDOW_MS = 25_000; // 25s fresh window

/**
 * Fetches dashboard statistics from Supabase with instant SWR caching.
 * Renders previous stats immediately (0ms) and updates in background.
 */
export function useDashboardStats() {
  const { shop } = useAuthStore();
  const shopId = shop?.id;

  const cachedEntry = shopId ? globalStatsCache.get(shopId) : undefined;
  const [stats, setStats] = useState<DashboardStats | null>(cachedEntry?.stats || null);
  const [isLoading, setIsLoading] = useState(!cachedEntry);
  const isFetchingRef = useRef(false);

  const fetchStats = useCallback(async (force = false) => {
    if (!shopId) {
      setIsLoading(false);
      return;
    }

    const currentCached = globalStatsCache.get(shopId);
    const now = Date.now();

    // Use fresh cache if available and not forced
    if (!force && currentCached && now - currentCached.timestamp < CACHE_FRESH_WINDOW_MS) {
      setStats(currentCached.stats);
      setIsLoading(false);
      return;
    }

    if (isFetchingRef.current) return;
    isFetchingRef.current = true;

    // Only set loading to true if we don't have any cached stats to display
    if (!currentCached) {
      setIsLoading(true);
    }

    try {
      const supabase = createClient();
      const today = getStartOfDay();
      const weekStart = getStartOfWeek();
      const monthStart = getStartOfMonth();
      const thirtyDaysAgo = getDaysAgo(30);

      // Run optimized parallel queries
      const [
        totalOrdersRes,
        inventoryRes,
        employeeRes,
        menuItemRes,
        recentOrdersRes,
        last30DaysOrdersRes,
        ordersByStatusRes,
        shopOrderIdsRes,
      ] = await Promise.all([
        supabase
          .from("orders")
          .select("id", { count: "exact", head: true })
          .eq("shop_id", shopId)
          .neq("status", "cancelled"),

        // Combined inventory query: provides both total count and low stock items
        supabase
          .from("inventory")
          .select("quantity, min_quantity")
          .eq("shop_id", shopId),

        supabase
          .from("employees")
          .select("id", { count: "exact", head: true })
          .eq("shop_id", shopId)
          .eq("is_active", true),

        supabase
          .from("menu_items")
          .select("id", { count: "exact", head: true })
          .eq("shop_id", shopId),

        supabase
          .from("orders")
          .select("id, order_number, customer_name, grand_total, subtotal, status, created_at")
          .eq("shop_id", shopId)
          .order("created_at", { ascending: false })
          .limit(10),

        supabase
          .from("orders")
          .select("id, grand_total, subtotal, status, payment_status, created_at")
          .eq("shop_id", shopId)
          .gte("created_at", thirtyDaysAgo)
          .neq("status", "cancelled")
          .order("created_at", { ascending: true }),

        supabase
          .from("orders")
          .select("status")
          .eq("shop_id", shopId),

        supabase
          .from("orders")
          .select("id")
          .eq("shop_id", shopId)
          .limit(500),
      ]);

      const thirtyDaysRecords = last30DaysOrdersRes.data || [];
      const shopOrderIds = (shopOrderIdsRes.data || []).map((o: any) => o.id);

      // Fetch top items scoped strictly to shop's order IDs
      let topItemsData: any[] = [];
      if (shopOrderIds.length > 0) {
        const { data: items } = await supabase
          .from("order_items")
          .select("product_name, quantity, line_total")
          .in("order_id", shopOrderIds)
          .limit(300);
        topItemsData = items || [];
      }

      const todayTime = new Date(today).getTime();
      const weekTime = new Date(weekStart).getTime();
      const monthTime = new Date(monthStart).getTime();

      let todayOrders = 0, todayRevenue = 0;
      let weekOrders = 0, weekRevenue = 0;
      let monthOrders = 0, monthRevenue = 0;
      let totalRevenue = 0;

      for (const order of thirtyDaysRecords) {
        const isConfirmed = order.status === "confirmed" || order.status === "paid" || order.payment_status === "paid";
        if (!isConfirmed) continue;

        const orderTime = new Date(order.created_at).getTime();
        const t = Number(order.grand_total ?? order.subtotal ?? 0);

        totalRevenue += t; 

        if (orderTime >= todayTime) {
          todayOrders++;
          todayRevenue += t;
        }
        if (orderTime >= weekTime) {
          weekOrders++;
          weekRevenue += t;
        }
        if (orderTime >= monthTime) {
          monthOrders++;
          monthRevenue += t;
        }
      }

      const totalOrders = totalOrdersRes.count || thirtyDaysRecords.length;

      // Build daily revenue chart data for last 30 days
      const dailyMap = new Map<string, { revenue: number; orders: number }>();
      for (let i = 29; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        dailyMap.set(key, { revenue: 0, orders: 0 });
      }
      last30DaysOrdersRes.data?.forEach((order: any) => {
        const key = new Date(order.created_at).toISOString().slice(0, 10);
        const entry = dailyMap.get(key);
        if (entry) {
          entry.revenue += Number(order.grand_total ?? order.subtotal ?? 0);
          entry.orders += 1;
        }
      });
      const dailyRevenue: DailyDataPoint[] = Array.from(
        dailyMap.entries()
      ).map(([date, data]) => ({
        date,
        revenue: data.revenue,
        orders: data.orders,
      }));

      // Orders by status
      const statusMap = new Map<string, number>();
      ordersByStatusRes.data?.forEach((o: any) => {
        statusMap.set(o.status, (statusMap.get(o.status) || 0) + 1);
      });
      const ordersByStatus: StatusCount[] = Array.from(
        statusMap.entries()
      ).map(([status, count]) => ({ status, count }));

      // Top items aggregation
      const itemMap = new Map<string, { quantity: number; revenue: number }>();
      topItemsData.forEach((item: any) => {
        const itemName = item.product_name || item.name || "Item";
        const itemRevenue = Number(item.line_total ?? item.total ?? 0);
        const existing = itemMap.get(itemName) || { quantity: 0, revenue: 0 };
        existing.quantity += Number(item.quantity) || 0;
        existing.revenue += itemRevenue;
        itemMap.set(itemName, existing);
      });
      const topItems: TopItem[] = Array.from(itemMap.entries())
        .map(([name, data]) => ({ name, ...data }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 8);

      const inventoryItems = inventoryRes.data || [];
      const lowStockCount = inventoryItems.filter(
        (item: any) =>
          item.quantity !== null &&
          (item.quantity <= item.min_quantity || item.quantity === 0)
      ).length;

      const newStats: DashboardStats = {
        todayOrders,
        todayRevenue,
        weekOrders,
        weekRevenue,
        monthOrders,
        monthRevenue,
        totalOrders,
        totalRevenue,
        inventoryCount: inventoryItems.length,
        lowStockCount,
        employeeCount: employeeRes.count || 0,
        menuItemCount: menuItemRes.count || 0,
        recentOrders: (recentOrdersRes.data as RecentOrder[]) || [],
        dailyRevenue,
        ordersByStatus,
        topItems,
      };

      globalStatsCache.set(shopId, { stats: newStats, timestamp: Date.now() });
      setStats(newStats);
    } catch (error) {
      console.error("Error fetching dashboard stats:", error);
    } finally {
      setIsLoading(false);
      isFetchingRef.current = false;
    }
  }, [shopId]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  return { stats, isLoading, refetch: () => fetchStats(true) };
}
