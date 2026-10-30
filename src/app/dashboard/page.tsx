"use client";

import { motion } from "framer-motion";
import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/dashboard/stat-card";
import { RevenueChart, OrdersChart } from "@/components/charts/charts";
import { LoadingSpinner } from "@/components/ui/loading";
import { useAuthStore } from "@/stores/auth-store";
import { useDashboardStats } from "@/hooks/use-dashboard-stats";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { toast } from "sonner";
import { useLanguageStore } from "@/stores/language-store";
import { DASHBOARD_TRANSLATIONS } from "@/lib/translations";
import { cn } from "@/lib/utils";
import {
  TrendingUp,
  ShoppingBag,
  Package,
  Package2,
  Users,
  QrCode,
  Copy,
  Plus,
  UtensilsCrossed,
  AlertTriangle,
  RefreshCw,
  AlertCircle,
  Clock,
  Store,
} from "lucide-react";
import Link from "next/link";
import { MultiShopDashboard } from "@/components/dashboard/multi-shop-dashboard";

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.4 },
  }),
};

const statusVariant: Record<string, "default" | "success" | "warning" | "danger" | "info" | "mint"> = {
  pending: "warning",
  confirmed: "info",
  preparing: "info",
  ready: "mint",
  delivered: "success",
  cancelled: "danger",
};

export default function DashboardPage() {
  const { user, shop, shops, isAllShops } = useAuthStore();
  const isMultiShopOwner =
    (user?.role === "shopkeeper" || (user?.role !== "employee" && (shops?.length || 0) > 0)) &&
    (shops?.length || 0) > 1;

  const { stats, isLoading, refetch } = useDashboardStats();
  const [menuUrl, setMenuUrl] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { lang } = useLanguageStore();
  const t = DASHBOARD_TRANSLATIONS[lang || "en"];

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refetch();
    setIsRefreshing(false);
  };

  useEffect(() => {
    if (!shop) return;
    if (typeof window === "undefined") return;
    setMenuUrl(`${window.location.origin}/menu/${shop.id}`);
  }, [shop]);

  // If the owner has multiple shops AND "All Shops" mode is active, render MultiShopDashboard.
  // When a specific individual shop is selected (!isAllShops), render that shop's dedicated dashboard UI.
  if (isMultiShopOwner && isAllShops) {
    return <MultiShopDashboard />;
  }

  if (!shop) {
    return (
      <div className="max-w-2xl mx-auto py-12">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <Card padding="lg" className="text-center py-16">
            <div className="h-20 w-20 rounded-2xl bg-mint-50 flex items-center justify-center mx-auto mb-6">
              <Store className="h-10 w-10 text-mint-500" />
            </div>
            <h2 className="text-3xl font-bold text-slate-900 mb-3">
              {t.widgets.setupTitle}
            </h2>
            <p className="text-lg text-slate-500 max-w-md mx-auto mb-8">
              {t.widgets.setupDesc}
            </p>
            <Link href="/shop/setup">
              <Button>
                {t.widgets.setupBtn}
              </Button>
            </Link>
          </Card>
        </motion.div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  const chartLabels =
    stats?.dailyRevenue.map((d) => {
      const dt = new Date(d.date);
      return dt.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
    }) || [];
  const revenueData = stats?.dailyRevenue.map((d) => d.revenue) || [];
  const ordersData = stats?.dailyRevenue.map((d) => d.orders) || [];

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-3"
      >
        <div>
          <h1 className="text-4xl lg:text-5xl font-black tracking-tight text-slate-900 drop-shadow-sm flex items-center gap-2">
            {new Date().getHours() < 12
              ? t.greetings.morning
              : new Date().getHours() < 17
                ? t.greetings.afternoon
                : t.greetings.evening}{" "}
            {user?.full_name ? `, ${user.full_name.split(" ")[0]}` : ""}{" "}
            <motion.span
              className="inline-block origin-bottom-right"
              animate={{ rotate: [0, 16, -10, 16, -10, 16, 0] }}
              transition={{
                duration: 1.5,
                repeat: Infinity,
                repeatDelay: 1,
                ease: "easeInOut",
              }}
            >
              👋
            </motion.span>
          </h1>
          <p className="text-lg lg:text-xl font-medium text-slate-600 mt-3 drop-shadow-sm">
            {t.greetings.whatsHappening}{" "}
            <span className="font-bold text-mint-700 bg-mint-50 px-2 py-0.5 rounded-lg border border-mint-200">
              {shop.name}
            </span>{" "}
            {t.greetings.today}
          </p>
        </div>
        <Button
          variant="outline"
          className="group relative overflow-hidden bg-white border-2 border-slate-100 text-slate-700 hover:text-mint-700 hover:border-mint-200 shadow-sm transition-all duration-300 font-bold tracking-wide"
          onClick={handleRefresh}
          disabled={isRefreshing}
        >
          <div className="absolute inset-0 bg-mint-50/0 group-hover:bg-mint-50/50 transition-colors" />
          <RefreshCw className={cn("h-4 w-4 relative z-10 transition-transform duration-500 mr-2", isRefreshing && "animate-spin text-mint-600")} strokeWidth={2.5} />
          <span className="relative z-10">{t.common.refresh}</span>
        </Button>
      </motion.div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: t.stats.todayOrders,
            value: stats?.todayOrders || 0,
            changeLabel: `${stats?.weekOrders || 0} ${t.stats.thisWeek}`,
            icon: ShoppingBag,
            iconColor: "bg-blue-50 text-blue-600",
            href: "/dashboard/orders",
          },
          {
            label: t.stats.todayRevenue,
            value: formatCurrency(stats?.todayRevenue || 0),
            changeLabel: `${formatCurrency(stats?.weekRevenue || 0)} ${t.stats.thisWeek}`,
            icon: TrendingUp,
            iconColor: "bg-mint-50 text-mint-600",
            href: "/dashboard/analytics",
          },
          {
            label: t.stats.inventoryItems,
            value: stats?.inventoryCount || 0,
            changeLabel:
              (stats?.lowStockCount || 0) > 0
                ? `${stats?.lowStockCount} ${t.stats.lowStock}`
                : t.stats.allStocked,
            icon: Package,
            iconColor: "bg-amber-50 text-amber-600",
            href: "/dashboard/inventory",
          },
          {
            label: t.stats.employeeCount,
            value: stats?.employeeCount || 0,
            changeLabel: `${stats?.menuItemCount || 0} ${t.stats.menuItems}`,
            icon: Users,
            iconColor: "bg-purple-50 text-purple-600",
            href: "/dashboard/employees",
          },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            custom={i}
            initial="hidden"
            animate="visible"
            variants={fadeUp}
          >
            <StatCard {...stat} />
          </motion.div>
        ))}
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35 }}
        className="grid grid-cols-1 lg:grid-cols-2 gap-4"
      >
        <RevenueChart
          labels={chartLabels}
          data={revenueData}
          title={t.widgets.revenueChart}
        />
        <OrdersChart
          labels={chartLabels}
          data={ordersData}
          title={t.widgets.ordersChart}
        />
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="lg:col-span-2"
        >
          <Card padding="md" className="h-full">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-slate-900 drop-shadow-sm flex items-center gap-2">
                <ShoppingBag className="h-5 w-5 text-mint-500" strokeWidth={2.5} />
                {t.widgets.recentOrders}
              </h2>
              <Link
                href="/dashboard/orders"
                className="text-sm font-bold text-mint-600 hover:text-mint-700 hover:underline underline-offset-4"
              >
                {t.common.viewAll}
              </Link>
            </div>

            {stats?.recentOrders && stats.recentOrders.length > 0 ? (
              <div className="space-y-2">
                {stats.recentOrders.slice(0, 6).map((order) => (
                  <div
                    key={order.id}
                    className="flex items-center justify-between p-3 bg-slate-50 rounded-xl"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-9 w-9 rounded-lg bg-white border border-slate-100 flex items-center justify-center shrink-0">
                        <ShoppingBag className="h-4 w-4 text-slate-400" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900 truncate">
                          #{order.order_number}
                          {order.customer_name &&
                            ` — ${order.customer_name}`}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="flex items-center gap-1 text-[11px] text-slate-400">
                            <Clock className="h-3 w-3" />
                            {formatDateTime(order.created_at)}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <Badge variant={statusVariant[order.status] || "default"}>
                        {order.status}
                      </Badge>
                      <p className="text-sm font-semibold text-slate-900 tabular-nums">
                        {formatCurrency(order.total)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-8 text-center bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
                <ShoppingBag className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                <p className="text-sm font-semibold text-slate-500">{t.widgets.noOrdersYet}</p>
                <p className="text-xs font-medium text-slate-400">
                  {t.widgets.ordersWillAppear}
                </p>
              </div>
            )}
          </Card>
        </motion.div>

        <Card padding="md">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-slate-900 drop-shadow-sm flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-amber-500" strokeWidth={2.5} />
              {t.widgets.lowStockAlert}
            </h2>
            <Badge variant="warning" className="text-xs">
              {stats?.lowStockCount || 0} {t.widgets.itemRunningLow}
            </Badge>
          </div>
          
          <div className="bg-amber-50/50 border border-amber-100 rounded-2xl p-4 flex flex-col items-center justify-center text-center min-h-[160px]">
            <Package2 className="h-8 w-8 text-amber-400 mb-3" />
            <p className="text-sm font-semibold text-amber-800 mb-1">
              {(stats?.lowStockCount || 0) > 0
                ? `${t.widgets.lowStockAlert}: ${stats?.lowStockCount}`
                : t.stats.allStocked}
            </p>
            <Link href="/dashboard/inventory">
              <Button size="sm" variant="outline" className="mt-4 border-amber-200 text-amber-700 hover:bg-amber-100 hover:border-amber-300 font-bold">
                {t.widgets.viewInventory}
              </Button>
            </Link>
          </div>
        </Card>

        <Card padding="md">
           <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-slate-900 drop-shadow-sm flex items-center gap-2">
              <QrCode className="h-5 w-5 text-mint-500" strokeWidth={2.5} />
              {t.widgets.qrMenu}
            </h2>
          </div>
          
          <div className="bg-gradient-to-br from-mint-50 to-white border border-mint-100 rounded-2xl p-5 mb-4 text-center">
            <div className="inline-flex p-2 bg-white rounded-2xl shadow-sm border border-slate-100 mb-3">
              {menuUrl ? (
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(menuUrl)}`}
                  alt={`Scannable QR Code for ${shop.name}`}
                  className="h-28 w-28 rounded-lg object-contain"
                />
              ) : (
                <QrCode className="h-16 w-16 text-slate-800" />
              )}
            </div>
            <p className="text-sm font-medium text-slate-600">
              {t.widgets.shareLink}
            </p>
          </div>

          <div className="space-y-3">
             <div className="text-sm">
                <span className="text-slate-500 font-medium block mb-1.5">{t.widgets.publicMenuUrl}</span>
                <div className="flex items-center gap-2 bg-slate-50 p-2 rounded-xl border border-slate-200">
                  <code className="text-xs text-mint-700 truncate flex-1 font-semibold pl-1">
                    {menuUrl || `bishop.app/menu/${shop.id}`}
                  </code>
                  <a href={`/menu/${shop.id}`} target="_blank" rel="noopener noreferrer">
                    <Button size="sm" variant="outline" className="shrink-0 h-7 text-xs font-bold px-3 border-mint-200 hover:bg-mint-50">
                      Open Menu
                    </Button>
                  </a>
                  <Button size="sm" variant="outline" className="shrink-0 h-7 text-xs font-bold px-3 border-mint-200 hover:bg-mint-50" onClick={() => { navigator.clipboard.writeText(menuUrl); toast.success("Copied"); }}>
                    {t.common.copyLink}
                  </Button>
                </div>
             </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
