"use client";

import { useState, useEffect, useCallback } from "react";
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

/**
 * Fetches all dashboard statistics from Supabase.
 * Returns real-time data for orders, revenue, inventory, employees, etc.
 */
export function useDashboardStats() {
  const { shop } = useAuthStore();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchStats = useCallback(async () => {
    if (!shop) {
      setIsLoading(false);
      return;
    }

    try {
      const supabase = createClient();
      const today = getStartOfDay();
      const weekStart = getStartOfWeek();
      const monthStart = getStartOfMonth();
      const thirtyDaysAgo = getDaysAgo(30);

      // Run initial queries
      const [
        totalOrdersRes,
        inventoryRes,
        lowStockRes,
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
          .eq("shop_id", shop.id)
          .neq("status", "cancelled"),

        supabase
          .from("inventory")
          .select("id", { count: "exact", head: true })
          .eq("shop_id", shop.id),

        supabase
          .from("inventory")
          .select("quantity, min_quantity")
          .eq("shop_id", shop.id),

        supabase
          .from("employees")
          .select("id", { count: "exact", head: true })
          .eq("shop_id", shop.id)
          .eq("is_active", true),

        supabase
          .from("menu_items")
          .select("id", { count: "exact", head: true })
          .eq("shop_id", shop.id),

        supabase
          .from("orders")
          .select("id, order_number, customer_name, grand_total, subtotal, status, created_at")
          .eq("shop_id", shop.id)
          .order("created_at", { ascending: false })
          .limit(10),

        supabase
          .from("orders")
          .select("id, grand_total, subtotal, status, payment_status, created_at")
          .eq("shop_id", shop.id)
          .gte("created_at", thirtyDaysAgo)
          .neq("status", "cancelled")
          .order("created_at", { ascending: true }),

        supabase
          .from("orders")
          .select("status")
          .eq("shop_id", shop.id),

        supabase
          .from("orders")
          .select("id")
          .eq("shop_id", shop.id)
          .limit(1000),
      ]);

      const thirtyDaysRecords = last30DaysOrdersRes.data || [];
      const shopOrderIds = (shopOrderIdsRes.data || []).map((o: any) => o.id);

      // Fetch top items scoped strictly to shop's order IDs (eliminating cross-tenant data leak)
      let topItemsData: any[] = [];
      if (shopOrderIds.length > 0) {
        const { data: items } = await supabase
          .from("order_items")
          .select("product_name, quantity, line_total")
          .in("order_id", shopOrderIds)
          .limit(500);
        topItemsData = items || [];
      }

      // Calculate time boundaries in JS using numeric timestamps
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

      // Total all-time
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

      // Top items aggregation (isolated to shop)
      const itemMap = new Map<
        string,
        { quantity: number; revenue: number }
      >();
      topItemsData.forEach((item: any) => {
        const itemName = item.product_name || item.name || "Item";
        const itemRevenue = Number(item.line_total ?? item.total ?? 0);
        const existing = itemMap.get(itemName) || {
          quantity: 0,
          revenue: 0,
        };
        existing.quantity += Number(item.quantity) || 0;
        existing.revenue += itemRevenue;
        itemMap.set(itemName, existing);
      });
      const topItems: TopItem[] = Array.from(itemMap.entries())
        .map(([name, data]) => ({ name, ...data }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 8);

      const lowStockCount =
        lowStockRes.data?.filter(
          (item: any) =>
            item.quantity !== null &&
            (item.quantity <= item.min_quantity || item.quantity === 0)
        ).length || 0;

      setStats({
        todayOrders,
        todayRevenue,
        weekOrders,
        weekRevenue,
        monthOrders,
        monthRevenue,
        totalOrders,
        totalRevenue,
        inventoryCount: inventoryRes.count || 0,
        lowStockCount,
        employeeCount: employeeRes.count || 0,
        menuItemCount: menuItemRes.count || 0,
        recentOrders: (recentOrdersRes.data as RecentOrder[]) || [],
        dailyRevenue,
        ordersByStatus,
        topItems,
      });
    } catch (error) {
      console.error("Error fetching dashboard stats:", error);
    } finally {
      setIsLoading(false);
    }
  }, [shop?.id]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  return { stats, isLoading, refetch: fetchStats };
}
