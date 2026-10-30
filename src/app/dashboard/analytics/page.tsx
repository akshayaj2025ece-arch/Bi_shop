"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuthStore } from "@/stores/auth-store";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/dashboard/stat-card";
import { LoadingSpinner } from "@/components/ui/loading";
import {
  RevenueChart,
  OrdersChart,
  StatusChart,
  TopItemsChart,
} from "@/components/charts/charts";
import { formatCurrency } from "@/lib/utils";
import { DASHBOARD_TRANSLATIONS } from "@/lib/translations";
import { useLanguageStore } from "@/stores/language-store";
import { motion } from "framer-motion";
import {
  TrendingUp,
  TrendingDown,
  ShoppingBag,
  Percent,
  ArrowUpRight,
  DollarSign,
  Clock,
  Calendar,
} from "lucide-react";

type TimePeriod = "7d" | "30d" | "90d" | "all";

interface DailyComparisonData {
  isAfter10PM: boolean;
  todayDateStr: string;
  prevDateStr: string;
  todayRevenue: number;
  todayOrders: number;
  todayAOV: number;
  prevRevenue: number;
  prevOrders: number;
  prevAOV: number;
  revenueDiff: number;
  revenueDiffPct: number;
  ordersDiff: number;
  aovDiff: number;
}

interface AnalyticsData {
  totalRevenue: number;
  totalOrders: number;
  avgOrderValue: number;
  totalCost: number;
  grossProfit: number;
  profitMargin: number;
  dailyData: { date: string; revenue: number; orders: number }[];
  statusData: { status: string; count: number }[];
  topItems: { name: string; quantity: number; revenue: number }[];
  paymentBreakdown: { method: string; count: number; total: number }[];
  peakHours: { hour: number; orders: number }[];
  dailyComparison: DailyComparisonData;
}

function getDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function getLocalDateString(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const PERIOD_LABELS: Record<string, Record<TimePeriod, string>> = {
  en: {
    "7d": "Last 7 Days",
    "30d": "Last 30 Days",
    "90d": "Last 90 Days",
    all: "All Time",
  },
  ta: {
    "7d": "கடந்த 7 நாட்கள்",
    "30d": "கடந்த 30 நாட்கள்",
    "90d": "கடந்த 90 நாட்கள்",
    all: "எல்லா நேரமும்",
  },
};

export default function AnalyticsPage() {
  const { shop } = useAuthStore();
  const { lang } = useLanguageStore();
  const t = DASHBOARD_TRANSLATIONS[lang || "en"].analyticsPage;
  const currentPeriodLabels = PERIOD_LABELS[lang || "en"] || PERIOD_LABELS.en;
  const [period, setPeriod] = useState<TimePeriod>("30d");
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchAnalytics = useCallback(async () => {
    if (!shop) return;

    try {
      const supabase = createClient();

      // Determine date range
      const daysMap: Record<TimePeriod, number | null> = {
        "7d": 7,
        "30d": 30,
        "90d": 90,
        all: null,
      };
      const days = daysMap[period];
      const startDate = days ? getDaysAgo(days) : null;

      // Build query for orders (authoritative single source of truth)
      let ordersQuery = supabase
        .from("orders")
        .select("id, grand_total, subtotal, status, payment_status, payment_method, created_at")
        .eq("shop_id", shop.id);

      if (startDate) {
        ordersQuery = ordersQuery.gte("created_at", startDate);
      }

      // Query all orders for status breakdown chart
      let allOrdersQuery = supabase
        .from("orders")
        .select("status, created_at")
        .eq("shop_id", shop.id);

      if (startDate) {
        allOrdersQuery = allOrdersQuery.gte("created_at", startDate);
      }

      // Inventory costs
      const inventoryQuery = supabase
        .from("inventory")
        .select("quantity, cost_per_unit")
        .eq("shop_id", shop.id);

      const [ordersRes, allOrdersRes, inventoryRes] = await Promise.all([
        ordersQuery.order("created_at", { ascending: true }),
        allOrdersQuery,
        inventoryQuery,
      ]);

      const allFetchedOrders = ordersRes.data || [];
      const allOrders = allOrdersRes.data || [];
      const inventoryItems = inventoryRes.data || [];

      // ── CONFIRMED ORDERS FILTER (Single Source of Truth) ──
      // Revenue & AOV count ONLY confirmed/paid orders. Exclude pending & cancelled.
      const confirmedOrders = allFetchedOrders.filter(
        (o: any) => o.status === "confirmed" || o.payment_status === "paid"
      );

      // Fetch order items strictly scoped to this shop's confirmed order IDs
      const confirmedOrderIds = confirmedOrders.map((o: any) => o.id);
      let orderItems: any[] = [];
      if (confirmedOrderIds.length > 0) {
        const { data: itemData } = await supabase
          .from("order_items")
          .select("product_name, quantity, line_total")
          .in("order_id", confirmedOrderIds)
          .limit(1000);
        orderItems = itemData || [];
      }

      // ── Compute Primary Metrics ──
      const totalRevenue = confirmedOrders.reduce(
        (s: number, o: any) => s + Number(o.grand_total ?? o.subtotal ?? 0),
        0
      );
      const totalOrders = confirmedOrders.length;
      const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

      // Total inventory cost (approximation of COGS)
      const totalCost = inventoryItems.reduce(
        (s: number, i: any) => s + (i.quantity || 0) * (i.cost_per_unit || 0),
        0
      );
      const grossProfit = totalRevenue - totalCost;
      const profitMargin =
        totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

      // ── Daily Data for Revenue/Orders Charts (Confirmed Only) ──
      const numDays = days || 365;
      const dailyMap = new Map<string, { revenue: number; orders: number }>();
      for (let i = Math.min(numDays, 365) - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const key = getLocalDateString(d);
        dailyMap.set(key, { revenue: 0, orders: 0 });
      }
      confirmedOrders.forEach((order: any) => {
        const key = getLocalDateString(new Date(order.created_at));
        const entry = dailyMap.get(key);
        if (entry) {
          entry.revenue += order.total ?? order.grand_total ?? 0;
          entry.orders += 1;
        }
      });
      const dailyData = Array.from(dailyMap.entries()).map(([date, d]) => ({
        date,
        revenue: d.revenue,
        orders: d.orders,
      }));

      // ── Status Breakdown Chart ──
      const statusMap = new Map<string, number>();
      allOrders.forEach((o: any) => {
        statusMap.set(o.status || "pending", (statusMap.get(o.status || "pending") || 0) + 1);
      });
      const statusData = Array.from(statusMap.entries()).map(
        ([status, count]) => ({ status, count })
      );

      // ── Top Selling Items ──
      const itemMap = new Map<string, { quantity: number; revenue: number }>();
      orderItems.forEach((item: any) => {
        const itemName = item.product_name || item.name || "Item";
        const itemRevenue = Number(item.line_total ?? item.total ?? 0);
        const ex = itemMap.get(itemName) || { quantity: 0, revenue: 0 };
        ex.quantity += Number(item.quantity) || 0;
        ex.revenue += itemRevenue;
        itemMap.set(itemName, ex);
      });
      const topItems = Array.from(itemMap.entries())
        .map(([name, d]) => ({ name, ...d }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 8);

      // ── Payment Breakdown ──
      const paymentMap = new Map<string, { count: number; total: number }>();
      confirmedOrders.forEach((o: any) => {
        const method = o.payment_method || "pay_at_counter";
        const ex = paymentMap.get(method) || { count: 0, total: 0 };
        ex.count += 1;
        ex.total += Number(o.grand_total ?? o.subtotal ?? 0);
        paymentMap.set(method, ex);
      });
      const paymentBreakdown = Array.from(paymentMap.entries())
        .map(([method, d]) => ({ method, ...d }))
        .sort((a, b) => b.total - a.total);

      // ── Peak Hours ──
      const hourMap = new Map<number, number>();
      for (let h = 0; h < 24; h++) hourMap.set(h, 0);
      confirmedOrders.forEach((o: any) => {
        const h = new Date(o.created_at).getHours();
        hourMap.set(h, (hourMap.get(h) || 0) + 1);
      });
      const peakHours = Array.from(hourMap.entries())
        .map(([hour, count]) => ({ hour, orders: count }))
        .sort((a, b) => a.hour - b.hour);

      // ── 10:00 PM DAILY SALES COMPARISON MODULE ──
      const now = new Date();
      const isAfter10PM = now.getHours() >= 22; // 10:00 PM or later
      const todayDateStr = getLocalDateString(now);

      const prevDateObj = new Date(now);
      prevDateObj.setDate(prevDateObj.getDate() - 1);
      const prevDateStr = getLocalDateString(prevDateObj);

      const todayConfirmed = confirmedOrders.filter(
        (o: any) => getLocalDateString(new Date(o.created_at)) === todayDateStr
      );
      const todayRevenue = todayConfirmed.reduce(
        (s: number, o: any) => s + (o.total ?? o.grand_total ?? 0),
        0
      );
      const todayOrders = todayConfirmed.length;
      const todayAOV = todayOrders > 0 ? todayRevenue / todayOrders : 0;

      const prevConfirmed = confirmedOrders.filter(
        (o: any) => getLocalDateString(new Date(o.created_at)) === prevDateStr
      );
      const prevRevenue = prevConfirmed.reduce(
        (s: number, o: any) => s + (o.total ?? o.grand_total ?? 0),
        0
      );
      const prevOrders = prevConfirmed.length;
      const prevAOV = prevOrders > 0 ? prevRevenue / prevOrders : 0;

      const revenueDiff = todayRevenue - prevRevenue;
      const revenueDiffPct =
        prevRevenue > 0
          ? (revenueDiff / prevRevenue) * 100
          : todayRevenue > 0
          ? 100
          : 0;
      const ordersDiff = todayOrders - prevOrders;
      const aovDiff = todayAOV - prevAOV;

      const dailyComparison: DailyComparisonData = {
        isAfter10PM,
        todayDateStr,
        prevDateStr,
        todayRevenue,
        todayOrders,
        todayAOV,
        prevRevenue,
        prevOrders,
        prevAOV,
        revenueDiff,
        revenueDiffPct,
        ordersDiff,
        aovDiff,
      };

      setData({
        totalRevenue,
        totalOrders,
        avgOrderValue,
        totalCost,
        grossProfit,
        profitMargin,
        dailyData,
        statusData,
        topItems,
        paymentBreakdown,
        peakHours,
        dailyComparison,
      });
    } catch (error) {
      console.error("Analytics fetch error:", error);
    } finally {
      setIsLoading(false);
    }
  }, [shop, period]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  // Realtime subscription & 1-minute periodic polling revalidation
  useEffect(() => {
    if (!shop) return;
    const supabase = createClient();

    const channel = supabase
      .channel(`realtime_analytics_${shop.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "orders",
          filter: `shop_id=eq.${shop.id}`,
        },
        () => {
          fetchAnalytics();
        }
      )
      .subscribe();

    const pollInterval = setInterval(() => {
      fetchAnalytics();
    }, 60000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(pollInterval);
    };
  }, [shop, fetchAnalytics]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  const chartLabels =
    data?.dailyData.map((d) => {
      const dt = new Date(d.date);
      return period === "7d"
        ? dt.toLocaleDateString("en-IN", { weekday: "short" })
        : dt.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
    }) || [];

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-4"
      >
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900">{t.title}</h1>
            <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" title="Realtime Analytics Active" />
          </div>
          <p className="text-sm text-slate-500 mt-1">
            {t.desc} — Real-time Supabase synchronization active.
          </p>
        </div>

        {/* Period Selector */}
        <div className="flex gap-1 bg-slate-100 p-1 rounded-xl">
          {(Object.keys(currentPeriodLabels) as TimePeriod[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${
                period === p
                  ? "bg-white text-slate-900 shadow-sm font-semibold"
                  : "text-slate-500 hover:text-slate-900"
              }`}
            >
              {currentPeriodLabels[p]}
            </button>
          ))}
        </div>
      </motion.div>

      {/* 10:00 PM DAILY SALES COMPARISON MODULE */}
      {data?.dailyComparison?.isAfter10PM ? (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
        >
          <Card padding="md" className="border-2 border-emerald-300 bg-emerald-50/20 shadow-md">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <div className="flex items-center gap-2">
                <Calendar className="h-5 w-5 text-emerald-600" />
                <CardTitle className="text-base font-black text-slate-900 tracking-tight">
                  DAILY SALES COMPARISON
                </CardTitle>
              </div>
              <Badge variant="mint" size="md" className="font-extrabold bg-emerald-100 text-emerald-800">
                <Clock className="h-3.5 w-3.5 mr-1" />
                After 10:00 PM Daily Comparison
              </Badge>
            </CardHeader>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-1">
              {/* Today */}
              <div className="p-4 rounded-xl bg-white border border-emerald-200/80 shadow-xs space-y-2">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-emerald-700">Today</span>
                  <span className="text-[11px] font-semibold text-slate-400">{data.dailyComparison.todayDateStr}</span>
                </div>
                <div className="grid grid-cols-3 gap-2 pt-1 text-center">
                  <div>
                    <p className="text-[11px] text-slate-500 font-medium">Revenue</p>
                    <p className="text-sm font-extrabold text-slate-900 tabular-nums">
                      {formatCurrency(data.dailyComparison.todayRevenue)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-slate-500 font-medium">Orders</p>
                    <p className="text-sm font-extrabold text-slate-900 tabular-nums">
                      {data.dailyComparison.todayOrders}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-slate-500 font-medium">Average Order</p>
                    <p className="text-sm font-extrabold text-slate-900 tabular-nums">
                      {formatCurrency(data.dailyComparison.todayAOV)}
                    </p>
                  </div>
                </div>
              </div>

              {/* Previous Day */}
              <div className="p-4 rounded-xl bg-white border border-slate-200/80 shadow-xs space-y-2">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-600">Previous Day</span>
                  <span className="text-[11px] font-semibold text-slate-400">{data.dailyComparison.prevDateStr}</span>
                </div>
                <div className="grid grid-cols-3 gap-2 pt-1 text-center">
                  <div>
                    <p className="text-[11px] text-slate-500 font-medium">Revenue</p>
                    <p className="text-sm font-extrabold text-slate-900 tabular-nums">
                      {formatCurrency(data.dailyComparison.prevRevenue)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-slate-500 font-medium">Orders</p>
                    <p className="text-sm font-extrabold text-slate-900 tabular-nums">
                      {data.dailyComparison.prevOrders}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-slate-500 font-medium">Average Order</p>
                    <p className="text-sm font-extrabold text-slate-900 tabular-nums">
                      {formatCurrency(data.dailyComparison.prevAOV)}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Net Difference Performance Banner */}
            <div className="mt-4 pt-3 border-t border-emerald-200/60 flex flex-wrap items-center justify-between gap-3 text-xs font-bold">
              <span className="text-slate-600">Daily Performance vs Previous Day:</span>
              <div className="flex flex-wrap items-center gap-3">
                <span className={`flex items-center gap-1 px-2.5 py-1 rounded-lg ${data.dailyComparison.revenueDiff >= 0 ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"}`}>
                  {data.dailyComparison.revenueDiff >= 0 ? <TrendingUp className="h-3.5 w-3.5 text-emerald-600" /> : <TrendingDown className="h-3.5 w-3.5 text-rose-600" />}
                  Revenue: {data.dailyComparison.revenueDiff >= 0 ? "+" : ""}{formatCurrency(data.dailyComparison.revenueDiff)} ({data.dailyComparison.revenueDiffPct >= 0 ? "+" : ""}{data.dailyComparison.revenueDiffPct.toFixed(2)}%)
                </span>

                <span className={`flex items-center gap-1 px-2.5 py-1 rounded-lg ${data.dailyComparison.ordersDiff >= 0 ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"}`}>
                  Orders: {data.dailyComparison.ordersDiff >= 0 ? "+" : ""}{data.dailyComparison.ordersDiff}
                </span>

                <span className={`flex items-center gap-1 px-2.5 py-1 rounded-lg ${data.dailyComparison.aovDiff >= 0 ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"}`}>
                  Average Order: {data.dailyComparison.aovDiff >= 0 ? "+" : ""}{formatCurrency(data.dailyComparison.aovDiff)}
                </span>
              </div>
            </div>
          </Card>
        </motion.div>
      ) : (
        <div className="flex items-center justify-between p-3 rounded-xl bg-slate-100/80 border border-slate-200/60 text-xs text-slate-600 font-medium">
          <span className="flex items-center gap-1.5">
            <Clock className="h-4 w-4 text-emerald-600 animate-pulse" />
            Live real-time analytics active. Confirmed sales update automatically.
          </span>
          <span className="text-slate-500 italic">Daily Sales Comparison unlocks automatically after 10:00 PM</span>
        </div>
      )}

      {/* Key Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <StatCard
            label="Total Revenue"
            value={formatCurrency(data?.totalRevenue || 0)}
            icon={TrendingUp}
            iconColor="bg-mint-50 text-mint-600"
            changeLabel={currentPeriodLabels[period]}
          />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
        >
          <StatCard
            label="Total Orders"
            value={data?.totalOrders || 0}
            icon={ShoppingBag}
            iconColor="bg-blue-50 text-blue-600"
            changeLabel={currentPeriodLabels[period]}
          />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <StatCard
            label="Avg Order Value"
            value={formatCurrency(data?.avgOrderValue || 0)}
            icon={DollarSign}
            iconColor="bg-amber-50 text-amber-600"
            changeLabel="Per confirmed order"
          />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
        >
          <StatCard
            label="Profit Margin"
            value={`${(data?.profitMargin || 0).toFixed(1)}%`}
            icon={Percent}
            iconColor={
              (data?.profitMargin || 0) >= 0
                ? "bg-emerald-50 text-emerald-600"
                : "bg-red-50 text-red-600"
            }
            changeLabel={currentPeriodLabels[period]}
          />
        </motion.div>
      </div>

      {/* Revenue + Orders Charts */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="grid grid-cols-1 lg:grid-cols-2 gap-4"
      >
        <RevenueChart
          labels={chartLabels}
          data={data?.dailyData.map((d) => d.revenue) || []}
          title={`Revenue — ${currentPeriodLabels[period]}`}
        />
        <OrdersChart
          labels={chartLabels}
          data={data?.dailyData.map((d) => d.orders) || []}
          title={`Orders — ${currentPeriodLabels[period]}`}
        />
      </motion.div>

      {/* Status + Top Items */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35 }}
        className="grid grid-cols-1 lg:grid-cols-2 gap-4"
      >
        <StatusChart
          labels={data?.statusData.map((s) => s.status) || []}
          data={data?.statusData.map((s) => s.count) || []}
          title="Order Status Breakdown"
        />
        <TopItemsChart
          items={data?.topItems || []}
          title="Top Selling Items"
        />
      </motion.div>

      {/* Profit Summary */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
      >
        <Card padding="md" className="w-full">
          <CardHeader>
            <CardTitle className="text-base">Profit Summary</CardTitle>
          </CardHeader>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-500">Total Confirmed Revenue</span>
              <span className="text-sm font-semibold text-slate-900 tabular-nums">
                {formatCurrency(data?.totalRevenue || 0)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-500">
                Inventory Cost (COGS)
              </span>
              <span className="text-sm font-semibold text-red-600 tabular-nums">
                −{formatCurrency(data?.totalCost || 0)}
              </span>
            </div>
            <div className="border-t border-slate-100 pt-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700">
                  Profit Margin
                </span>
                <span
                  className={`text-lg font-bold tabular-nums ${
                    (data?.profitMargin || 0) >= 0
                      ? "text-emerald-600"
                      : "text-red-600"
                  }`}
                >
                  {(data?.profitMargin || 0).toFixed(1)}%
                </span>
              </div>
              <div className="flex items-center gap-1.5 mt-1 justify-end">
                <ArrowUpRight
                  className={`h-3.5 w-3.5 ${
                    (data?.profitMargin || 0) >= 0
                      ? "text-emerald-500"
                      : "text-red-500"
                  }`}
                />
                <span
                  className={`text-xs font-medium ${
                    (data?.profitMargin || 0) >= 0
                      ? "text-emerald-600"
                      : "text-red-600"
                  }`}
                >
                  {(data?.profitMargin || 0).toFixed(1)}% margin
                </span>
              </div>
            </div>
          </div>
        </Card>
      </motion.div>

      {/* Summary Table */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.45 }}
      >
        <Card padding="md">
          <CardHeader>
            <CardTitle className="text-base">Summary</CardTitle>
            <Badge variant="mint" size="md">
              {currentPeriodLabels[period]}
            </Badge>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left py-3 px-2 text-xs font-medium text-slate-400 uppercase tracking-wider">
                    Metric
                  </th>
                  <th className="text-right py-3 px-2 text-xs font-medium text-slate-400 uppercase tracking-wider">
                    Value
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {[
                  {
                    label: "Total Revenue",
                    value: formatCurrency(data?.totalRevenue || 0),
                  },
                  {
                    label: "Total Orders",
                    value: (data?.totalOrders || 0).toString(),
                  },
                  {
                    label: "Average Order Value",
                    value: formatCurrency(data?.avgOrderValue || 0),
                  },
                  {
                    label: "Inventory Cost",
                    value: formatCurrency(data?.totalCost || 0),
                  },
                  {
                    label: "Profit Margin",
                    value: `${(data?.profitMargin || 0).toFixed(1)}%`,
                  },
                  {
                    label: "Top Seller",
                    value: data?.topItems?.[0]?.name || "—",
                  },
                ].map((row) => (
                  <tr key={row.label} className="hover:bg-slate-50/50">
                    <td className="py-3 px-2 text-slate-600">{row.label}</td>
                    <td className="py-3 px-2 text-right font-medium text-slate-900 tabular-nums">
                      {row.value}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </motion.div>
    </div>
  );
}
