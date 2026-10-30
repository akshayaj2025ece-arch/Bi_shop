"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useAuthStore } from "@/stores/auth-store";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading";
import { RevenueChart } from "@/components/charts/charts";
import { formatCurrency, cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  TrendingUp,
  ShoppingBag,
  Store,
  Calendar,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Building2,
  DollarSign,
  Package,
  Layers,
  Check,
} from "lucide-react";
import type { Shop } from "@/lib/types";

interface MultiShopStatsResponse {
  success: boolean;
  scope: "all" | "individual";
  selectedShopId: string | null;
  shopCount: number;
  totalSales: number;
  totalOrders: number;
  avgOrderValue: number;
  salesByShop: {
    shopId: string;
    shopName: string;
    totalSales: number;
    totalOrders: number;
    percentage: number;
  }[];
  ordersByShop: {
    shopId: string;
    shopName: string;
    totalOrders: number;
    percentage: number;
  }[];
  salesTrend: {
    date: string;
    revenue: number;
    orders: number;
  }[];
  topItems: {
    name: string;
    quantity: number;
    revenue: number;
  }[];
  lowStockItems: {
    id: string;
    shopId: string;
    shopName: string;
    name: string;
    quantity: number;
    minQuantity: number;
    unit: string;
  }[];
  dateRange: {
    startDate: string;
    endDate: string;
  };
  error?: string;
}

type FilterMode = "this_month" | "month_year" | "custom";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function MultiShopDashboard() {
  const { user, shop, shops, isAllShops, setShop, setIsAllShops } = useAuthStore();

  const now = useMemo(() => new Date(), []);
  const currentYear = now.getFullYear();
  const currentMonthIndex = now.getMonth();

  // Filter Staging State (Local)
  const [filterMode, setFilterMode] = useState<FilterMode>("this_month");
  const [selectedMonth, setSelectedMonth] = useState<number>(currentMonthIndex);
  const [selectedYear, setSelectedYear] = useState<number>(currentYear);

  // Custom date staging state
  const defaultStartDate = `${currentYear}-${String(currentMonthIndex + 1).padStart(2, "0")}-01`;
  const [customStartDate, setCustomStartDate] = useState<string>(defaultStartDate);
  const [customEndDate, setCustomEndDate] = useState<string>(
    new Date().toISOString().slice(0, 10)
  );

  // Active Query Parameters (Committed on "Apply")
  const [activeDateParams, setActiveDateParams] = useState<{
    startDate: string;
    endDate: string;
    startUtc: string;
    endExclusiveUtc: string;
    displayLabel: string;
  }>(() => {
    // Initial: "This Month"
    const sLocal = new Date(currentYear, currentMonthIndex, 1, 0, 0, 0, 0);
    const eNextLocal = new Date(currentYear, currentMonthIndex + 1, 1, 0, 0, 0, 0);
    const lastDay = new Date(currentYear, currentMonthIndex + 1, 0).getDate();

    return {
      startDate: `${currentYear}-${String(currentMonthIndex + 1).padStart(2, "0")}-01`,
      endDate: `${currentYear}-${String(currentMonthIndex + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
      startUtc: sLocal.toISOString(),
      endExclusiveUtc: eNextLocal.toISOString(),
      displayLabel: `This Month (${MONTHS[currentMonthIndex]} ${currentYear})`,
    };
  });

  // Data fetching state
  const [data, setData] = useState<MultiShopStatsResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isApplying, setIsApplying] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Calculate year options: 3 years back to current year
  const yearOptions = useMemo(() => {
    const years: number[] = [];
    for (let y = currentYear; y >= currentYear - 3; y--) {
      years.push(y);
    }
    return years;
  }, [currentYear]);

  // Fetch stats from secure server-side route
  const fetchStats = useCallback(
    async (overrideParams?: typeof activeDateParams) => {
      setIsLoading(true);
      setError(null);

      const paramsToUse = overrideParams || activeDateParams;

      try {
        const query = new URLSearchParams();
        query.set("startDate", paramsToUse.startDate);
        query.set("endDate", paramsToUse.endDate);
        query.set("startUtc", paramsToUse.startUtc);
        query.set("endExclusiveUtc", paramsToUse.endExclusiveUtc);

        if (isAllShops || !shop) {
          query.set("shopId", "all");
        } else {
          query.set("shopId", shop.id);
        }

        const res = await fetch(`/api/dashboard/multi-shop-stats?${query.toString()}`, {
          method: "GET",
          headers: { "Cache-Control": "no-cache" },
        });

        const json = await res.json();

        if (!res.ok || !json.success) {
          throw new Error(json.error || "Failed to load multi-shop analytics.");
        }

        setData(json);
      } catch (err: any) {
        console.error("MultiShopDashboard fetch error:", err);
        setError(err.message || "Unable to load dashboard data. Please try again.");
      } finally {
        setIsLoading(false);
        setIsApplying(false);
      }
    },
    [activeDateParams, isAllShops, shop]
  );

  // Fetch when active scope or date parameters change
  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  // Handle "Apply" button click
  function handleApplyFilters() {
    let newStartDate: string;
    let newEndDate: string;
    let newStartUtc: string;
    let newEndExclusiveUtc: string;
    let displayLabel: string;

    if (filterMode === "this_month") {
      const sLocal = new Date(currentYear, currentMonthIndex, 1, 0, 0, 0, 0);
      const eNextLocal = new Date(currentYear, currentMonthIndex + 1, 1, 0, 0, 0, 0);
      const lastDay = new Date(currentYear, currentMonthIndex + 1, 0).getDate();

      newStartDate = `${currentYear}-${String(currentMonthIndex + 1).padStart(2, "0")}-01`;
      newEndDate = `${currentYear}-${String(currentMonthIndex + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
      newStartUtc = sLocal.toISOString();
      newEndExclusiveUtc = eNextLocal.toISOString();
      displayLabel = `This Month (${MONTHS[currentMonthIndex]} ${currentYear})`;
    } else if (filterMode === "month_year") {
      const sLocal = new Date(selectedYear, selectedMonth, 1, 0, 0, 0, 0);
      const eNextLocal = new Date(selectedYear, selectedMonth + 1, 1, 0, 0, 0, 0);
      const lastDay = new Date(selectedYear, selectedMonth + 1, 0).getDate();

      newStartDate = `${selectedYear}-${String(selectedMonth + 1).padStart(2, "0")}-01`;
      newEndDate = `${selectedYear}-${String(selectedMonth + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
      newStartUtc = sLocal.toISOString();
      newEndExclusiveUtc = eNextLocal.toISOString();
      displayLabel = `${MONTHS[selectedMonth]} ${selectedYear}`;
    } else {
      // Custom date range
      if (!customStartDate || !customEndDate) {
        toast.error("Please select both a start date and an end date.");
        return;
      }
      if (customStartDate > customEndDate) {
        toast.error("Start date cannot be after end date.");
        return;
      }

      const [sy, sm, sd] = customStartDate.split("-").map(Number);
      const [ey, em, ed] = customEndDate.split("-").map(Number);

      const sLocal = new Date(sy, sm - 1, sd, 0, 0, 0, 0);
      const eNextLocal = new Date(ey, em - 1, ed + 1, 0, 0, 0, 0);

      newStartDate = customStartDate;
      newEndDate = customEndDate;
      newStartUtc = sLocal.toISOString();
      newEndExclusiveUtc = eNextLocal.toISOString();
      displayLabel = `${customStartDate} to ${customEndDate}`;
    }

    const nextParams = {
      startDate: newStartDate,
      endDate: newEndDate,
      startUtc: newStartUtc,
      endExclusiveUtc: newEndExclusiveUtc,
      displayLabel,
    };

    setIsApplying(true);
    setActiveDateParams(nextParams);
    fetchStats(nextParams);
  }

  // Switch to individual shop directly from Sales by Shop table
  function handleSelectShopFromTable(targetShopId: string) {
    const targetShop = shops.find((s) => s.id === targetShopId);
    if (!targetShop) return;

    setShop(targetShop);
    setIsAllShops(false);
    if (typeof window !== "undefined") {
      try {
        const userStorageKey = user?.id ? `bishop_active_shop_id_${user.id}` : "bishop_active_shop_id";
        localStorage.setItem(userStorageKey, targetShop.id);
        localStorage.setItem("bishop_active_shop_id", targetShop.id);
      } catch {
        // ignore
      }
    }
    toast.success(`Switched view to ${targetShop.name}`);
  }

  // Trend Chart Data
  const chartLabels = useMemo(() => {
    if (!data?.salesTrend || data.salesTrend.length === 0) return [];
    return data.salesTrend.map((t) => {
      const [year, month, day] = t.date.split("-").map(Number);
      const dt = new Date(year, month - 1, day);
      return dt.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
    });
  }, [data?.salesTrend]);

  const chartRevenues = useMemo(() => {
    if (!data?.salesTrend) return [];
    return data.salesTrend.map((t) => t.revenue);
  }, [data?.salesTrend]);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* ── 1. Page Header with Scope Badge & Action Buttons ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-3xl sm:text-4xl font-black text-slate-900 tracking-tight">
              {isAllShops ? "Multi-Shop Overview" : `${shop?.name || "Shop"} Overview`}
            </h1>
            <Badge
              variant={isAllShops ? "mint" : "default"}
              className="text-xs font-bold uppercase tracking-wider py-1 px-2.5"
            >
              {isAllShops ? `All Shops (${shops.length})` : "Single Shop"}
            </Badge>
          </div>
          <p className="text-sm sm:text-base text-slate-500 font-medium mt-1">
            {isAllShops
              ? `Combined analytics across all ${shops.length} registered locations`
              : `Viewing individual branch performance for ${shop?.name || "this shop"}`}
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => fetchStats()}
          disabled={isLoading}
          leftIcon={<RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />}
          className="self-start sm:self-auto border-slate-200 text-slate-700 hover:bg-slate-50"
        >
          Refresh Data
        </Button>
      </div>

      {/* ── 2. Date Filter Bar ── */}
      <Card padding="md" className="border border-slate-200/80 shadow-xs bg-white rounded-2xl">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400 mr-1 flex items-center gap-1.5">
              <Calendar className="h-4 w-4 text-mint-600" /> Date Period:
            </span>

            {/* Filter Mode Selector */}
            <div className="inline-flex rounded-xl bg-slate-100 p-1 border border-slate-200/60">
              <button
                type="button"
                onClick={() => setFilterMode("this_month")}
                className={cn(
                  "px-3 py-1.5 text-xs font-bold rounded-lg transition-all",
                  filterMode === "this_month"
                    ? "bg-white text-mint-700 shadow-xs font-extrabold"
                    : "text-slate-600 hover:text-slate-900"
                )}
              >
                This Month
              </button>
              <button
                type="button"
                onClick={() => setFilterMode("month_year")}
                className={cn(
                  "px-3 py-1.5 text-xs font-bold rounded-lg transition-all",
                  filterMode === "month_year"
                    ? "bg-white text-mint-700 shadow-xs font-extrabold"
                    : "text-slate-600 hover:text-slate-900"
                )}
              >
                Month & Year
              </button>
              <button
                type="button"
                onClick={() => setFilterMode("custom")}
                className={cn(
                  "px-3 py-1.5 text-xs font-bold rounded-lg transition-all",
                  filterMode === "custom"
                    ? "bg-white text-mint-700 shadow-xs font-extrabold"
                    : "text-slate-600 hover:text-slate-900"
                )}
              >
                Custom Range
              </button>
            </div>
          </div>

          {/* Interactive Date Inputs Based on Mode */}
          <div className="flex flex-wrap items-center gap-2.5">
            {filterMode === "month_year" && (
              <>
                <select
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(Number(e.target.value))}
                  className="px-3 py-1.5 text-xs sm:text-sm font-semibold rounded-xl border border-slate-200 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-mint-500/20"
                >
                  {MONTHS.map((m, idx) => (
                    <option key={m} value={idx}>
                      {m}
                    </option>
                  ))}
                </select>

                <select
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(Number(e.target.value))}
                  className="px-3 py-1.5 text-xs sm:text-sm font-semibold rounded-xl border border-slate-200 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-mint-500/20"
                >
                  {yearOptions.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </>
            )}

            {filterMode === "custom" && (
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                  className="px-2.5 py-1.5 text-xs sm:text-sm font-medium rounded-xl border border-slate-200 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-mint-500/20"
                />
                <span className="text-slate-400 font-bold text-xs">to</span>
                <input
                  type="date"
                  value={customEndDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  className="px-2.5 py-1.5 text-xs sm:text-sm font-medium rounded-xl border border-slate-200 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-mint-500/20"
                />
              </div>
            )}

            <Button
              size="sm"
              onClick={handleApplyFilters}
              disabled={isLoading || isApplying}
              className="bg-mint-600 hover:bg-mint-700 text-white font-bold text-xs px-4 rounded-xl shadow-xs"
            >
              {isApplying ? "Applying..." : "Apply Filter"}
            </Button>
          </div>
        </div>

        {/* Current Active Filter Indicator */}
        <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
          <span>
            Active Range: <strong className="text-slate-800">{activeDateParams.displayLabel}</strong>
          </span>
          <span>
            Scope: <strong className="text-slate-800">{isAllShops ? "All Shops" : (shop?.name || "Single Shop")}</strong>
          </span>
        </div>
      </Card>

      {/* ── Error Banner ── */}
      {error && (
        <Card className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-2xl flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-red-500 shrink-0" />
            <span className="text-sm font-medium">{error}</span>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => fetchStats()}
            className="border-red-300 text-red-700 hover:bg-red-100 text-xs shrink-0"
          >
            Retry
          </Button>
        </Card>
      )}

      {/* ── 3. Four Core Metric Cards ── */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="p-6 h-32 animate-pulse bg-slate-100/70 border-slate-200/60" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card padding="md" className="bg-white border-slate-200/80 rounded-2xl shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Total Sales
              </span>
              <div className="h-9 w-9 rounded-xl bg-mint-50 text-mint-600 flex items-center justify-center">
                <DollarSign className="h-5 w-5" />
              </div>
            </div>
            <p className="text-2xl sm:text-3xl font-black text-slate-900 mt-2">
              {formatCurrency(data?.totalSales || 0)}
            </p>
            <p className="text-xs text-slate-400 font-medium mt-1">
              Confirmed sales in period
            </p>
          </Card>

          <Card padding="md" className="bg-white border-slate-200/80 rounded-2xl shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Total Orders
              </span>
              <div className="h-9 w-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                <ShoppingBag className="h-5 w-5" />
              </div>
            </div>
            <p className="text-2xl sm:text-3xl font-black text-slate-900 mt-2">
              {(data?.totalOrders || 0).toLocaleString()}
            </p>
            <p className="text-xs text-slate-400 font-medium mt-1">
              Confirmed & fulfilled orders
            </p>
          </Card>

          <Card padding="md" className="bg-white border-slate-200/80 rounded-2xl shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Average Order Value
              </span>
              <div className="h-9 w-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
                <TrendingUp className="h-5 w-5" />
              </div>
            </div>
            <p className="text-2xl sm:text-3xl font-black text-slate-900 mt-2">
              {formatCurrency(data?.avgOrderValue || 0)}
            </p>
            <p className="text-xs text-slate-400 font-medium mt-1">
              Revenue per confirmed order
            </p>
          </Card>

          <Card padding="md" className="bg-white border-slate-200/80 rounded-2xl shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Number of Shops
              </span>
              <div className="h-9 w-9 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
                <Store className="h-5 w-5" />
              </div>
            </div>
            <p className="text-2xl sm:text-3xl font-black text-slate-900 mt-2">
              {data?.shopCount || 0}
            </p>
            <p className="text-xs text-slate-400 font-medium mt-1">
              {isAllShops ? "All active locations" : "Filtered to 1 shop"}
            </p>
          </Card>
        </div>
      )}

      {/* ── 4. Multi-Shop Distribution Section (Rendered in All Shops Mode) ── */}
      {isAllShops && (data?.salesByShop?.length || 0) > 1 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Sales by Shop Card */}
          <Card padding="lg" className="bg-white border-slate-200/80 rounded-2xl shadow-xs">
            <CardHeader className="px-0 pt-0 pb-4">
              <CardTitle className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <Store className="h-5 w-5 text-mint-600" />
                Sales by Shop
              </CardTitle>
            </CardHeader>
            <div className="space-y-4">
              {data?.salesByShop.map((item) => (
                <div key={item.shopId} className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <button
                      type="button"
                      onClick={() => handleSelectShopFromTable(item.shopId)}
                      className="font-bold text-slate-800 hover:text-mint-600 text-left transition-colors"
                      title="Switch dashboard to this shop"
                    >
                      {item.shopName}
                    </button>
                    <span className="font-extrabold text-slate-900">
                      {formatCurrency(item.totalSales)} ({item.percentage}%)
                    </span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                    <div
                      className="bg-mint-500 h-2.5 rounded-full transition-all duration-500"
                      style={{ width: `${Math.min(100, Math.max(2, item.percentage))}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Orders by Shop Card */}
          <Card padding="lg" className="bg-white border-slate-200/80 rounded-2xl shadow-xs">
            <CardHeader className="px-0 pt-0 pb-4">
              <CardTitle className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <ShoppingBag className="h-5 w-5 text-blue-600" />
                Orders by Shop
              </CardTitle>
            </CardHeader>
            <div className="space-y-4">
              {data?.ordersByShop.map((item) => (
                <div key={item.shopId} className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <button
                      type="button"
                      onClick={() => handleSelectShopFromTable(item.shopId)}
                      className="font-bold text-slate-800 hover:text-blue-600 text-left transition-colors"
                      title="Switch dashboard to this shop"
                    >
                      {item.shopName}
                    </button>
                    <span className="font-extrabold text-slate-900">
                      {item.totalOrders.toLocaleString()} orders ({item.percentage}%)
                    </span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                    <div
                      className="bg-blue-500 h-2.5 rounded-full transition-all duration-500"
                      style={{ width: `${Math.min(100, Math.max(2, item.percentage))}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* ── 5. Sales Trend and Best-Selling Items ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Sales Trend Chart (2 columns on large screen) */}
        <div className="lg:col-span-2">
          {chartLabels.length > 0 && chartRevenues.some((r) => r > 0) ? (
            <RevenueChart
              title="Monthly Sales Trend"
              labels={chartLabels}
              data={chartRevenues}
            />
          ) : (
            <Card padding="lg" className="h-full flex flex-col items-center justify-center p-12 text-center bg-white border-slate-200/80 rounded-2xl shadow-xs">
              <Calendar className="h-10 w-10 text-slate-300 mb-3" />
              <h3 className="text-base font-bold text-slate-700">No Sales in Selected Period</h3>
              <p className="text-xs text-slate-400 mt-1 max-w-sm">
                There are no recorded sales for this date range. Try applying a different month or date range.
              </p>
            </Card>
          )}
        </div>

        {/* Best-Selling Items (1 column) */}
        <Card padding="lg" className="bg-white border-slate-200/80 rounded-2xl shadow-xs flex flex-col">
          <CardHeader className="px-0 pt-0 pb-4">
            <CardTitle className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-mint-600" />
              Best-Selling Items
            </CardTitle>
          </CardHeader>

          {(data?.topItems?.length || 0) === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-slate-400">
              <ShoppingBag className="h-8 w-8 text-slate-300 mb-2" />
              <p className="text-xs font-medium">No item sales recorded in this period</p>
            </div>
          ) : (
            <div className="space-y-3 flex-1 overflow-y-auto">
              {data?.topItems.map((item, idx) => (
                <div
                  key={item.name}
                  className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-100"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="h-6 w-6 rounded-lg bg-mint-100 text-mint-800 text-xs font-black flex items-center justify-center shrink-0">
                      {idx + 1}
                    </span>
                    <span className="text-sm font-bold text-slate-800 truncate">
                      {item.name}
                    </span>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="text-xs font-black text-slate-900 block">
                      {item.quantity} sold
                    </span>
                    <span className="text-[11px] font-medium text-slate-400 block">
                      {formatCurrency(item.revenue)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* ── 6. Operational Alert: Low-Stock Items ── */}
      <Card padding="lg" className="bg-white border-slate-200/80 rounded-2xl shadow-xs">
        <CardHeader className="px-0 pt-0 pb-4 flex flex-row items-center justify-between">
          <CardTitle className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Package className="h-5 w-5 text-amber-500" />
            Low-Stock Items
          </CardTitle>
          <span className="text-xs text-slate-400 font-medium">
            Current inventory snapshot
          </span>
        </CardHeader>

        {(data?.lowStockItems?.length || 0) === 0 ? (
          <div className="p-8 text-center bg-slate-50 rounded-xl border border-slate-100">
            <CheckCircle2 className="h-8 w-8 text-mint-500 mx-auto mb-2" />
            <h4 className="text-sm font-bold text-slate-800">Healthy Inventory</h4>
            <p className="text-xs text-slate-400 mt-1">
              All inventory levels are above minimum threshold across your registered locations.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  <th className="pb-3 font-bold">Item Name</th>
                  {isAllShops && <th className="pb-3 font-bold">Shop Location</th>}
                  <th className="pb-3 font-bold">Available Stock</th>
                  <th className="pb-3 font-bold">Min Required</th>
                  <th className="pb-3 font-bold text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data?.lowStockItems.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 font-bold text-slate-800">{item.name}</td>
                    {isAllShops && (
                      <td className="py-3 text-xs font-semibold text-slate-600">
                        {item.shopName}
                      </td>
                    )}
                    <td className="py-3 font-black text-slate-900">
                      {item.quantity} {item.unit}
                    </td>
                    <td className="py-3 text-xs text-slate-500">
                      {item.minQuantity} {item.unit}
                    </td>
                    <td className="py-3 text-right">
                      {item.quantity === 0 ? (
                        <Badge variant="danger" size="sm" className="font-bold">
                          Out of Stock
                        </Badge>
                      ) : (
                        <Badge variant="warning" size="sm" className="font-bold">
                          Low Stock
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
