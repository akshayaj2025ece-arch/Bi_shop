"use client";

import { useAuthStore } from "@/stores/auth-store";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import {
  Menu,
  Bell,
  LogOut,
  User,
  Store,
  Languages,
  ArrowRight,
  ClipboardList,
  CheckCircle2,
  Play,
  Clock,
  Shield,
  Building2,
  Calendar,
  UserCheck,
  Phone,
  ChevronDown,
  Check,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useLanguageStore } from "@/stores/language-store";
import { DASHBOARD_TRANSLATIONS } from "@/lib/translations";
import { formatCurrency } from "@/lib/utils";
import { motion } from "framer-motion";
import type { AppNotification, TaskStatus, Shop } from "@/lib/types";
import {
  fetchRecipientNotifications,
  markNotificationAsRead,
  updateTaskStatusAndNotify,
} from "@/lib/task-service";

interface TopBarProps {
  onMenuClick: () => void;
}

interface OrderNotificationItem {
  id: string;
  order_number: string;
  token_number: string;
  customer_name: string;
  total: number;
  created_at: string;
}

export function TopBar({ onMenuClick }: TopBarProps) {
  const { user, shop, shops, isAllShops, setShop, setIsAllShops } = useAuthStore();
  const router = useRouter();
  const { lang, toggleLang } = useLanguageStore();
  const t = DASHBOARD_TRANSLATIONS[lang || "en"];
  const topBarT = t.topBar;

  const isShopkeeper = user?.role === "shopkeeper" || (user?.role !== "employee" && (shops?.length || 0) > 0);
  const hasMultipleShops = isShopkeeper && (shops?.length || 0) > 1;

  const [showShopSelector, setShowShopSelector] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);

  // Notifications State
  const [orderNotifications, setOrderNotifications] = useState<OrderNotificationItem[]>([]);
  const [taskNotifications, setTaskNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  // Selected Modal States
  const [selectedOrder, setSelectedOrder] = useState<OrderNotificationItem | null>(null);
  const [selectedTaskNotif, setSelectedTaskNotif] = useState<AppNotification | null>(null);
  const [isUpdatingTaskStatus, setIsUpdatingTaskStatus] = useState(false);

  const shopSelectorRef = useRef<HTMLDivElement>(null);
  const notificationsRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // Selection handlers
  function handleSelectShop(selectedShop: Shop) {
    const validShop = shops.find((s) => s.id === selectedShop.id);
    if (!validShop) {
      toast.error("Invalid shop selected");
      return;
    }

    setShop(validShop);
    setIsAllShops(false);
    if (typeof window !== "undefined") {
      try {
        const userStorageKey = user?.id ? `bishop_active_shop_id_${user.id}` : "bishop_active_shop_id";
        localStorage.setItem(userStorageKey, validShop.id);
        localStorage.setItem("bishop_active_shop_id", validShop.id);
      } catch {
        // ignore storage errors
      }
    }
    setShowShopSelector(false);
  }

  function handleSelectAllShops() {
    setIsAllShops(true);
    if (typeof window !== "undefined") {
      try {
        const userStorageKey = user?.id ? `bishop_active_shop_id_${user.id}` : "bishop_active_shop_id";
        localStorage.setItem(userStorageKey, "all");
        localStorage.setItem("bishop_active_shop_id", "all");
      } catch {
        // ignore storage errors
      }
    }
    setShowShopSelector(false);
    router.push("/dashboard");
  }

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        shopSelectorRef.current &&
        !shopSelectorRef.current.contains(e.target as Node)
      ) {
        setShowShopSelector(false);
      }
      if (
        notificationsRef.current &&
        !notificationsRef.current.contains(e.target as Node)
      ) {
        setShowNotifications(false);
      }
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Fetch Task Notifications for active user profile
  const loadTaskNotifications = useCallback(async () => {
    if (!user?.id) return;
    try {
      const notifs = await fetchRecipientNotifications(user.id, shop?.id);
      setTaskNotifications(notifs);

      const unreadTasks = notifs.filter((n) => !n.is_read).length;
      setUnreadCount((prev) => unreadTasks + orderNotifications.length);
    } catch (err) {
      console.warn("Failed loading task notifications:", err);
    }
  }, [user?.id, shop?.id, orderNotifications.length]);

  useEffect(() => {
    loadTaskNotifications();
  }, [loadTaskNotifications]);

  // Realtime Subscriptions (Orders + Task Notifications)
  useEffect(() => {
    if (!shop && !user) return;

    const supabase = createClient();
    const channels: any[] = [];

    // 1. Order Notifications (For Shopkeepers)
    if (shop?.id) {
      const orderChannel = supabase
        .channel(`orders-notifications-${shop.id}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "orders",
            filter: `shop_id=eq.${shop.id}`,
          },
          (payload: any) => {
            const order = payload.new as any;
            const token = order.token_number || order.order_number || `BSH-${order.id.slice(0, 4)}`;
            const custName = order.customer_name || "Customer";
            const grandTotal = Number(order.grand_total || order.total || 0);

            setOrderNotifications((prev) => [
              {
                id: order.id,
                order_number: order.order_number || token,
                token_number: token,
                customer_name: custName,
                total: grandTotal,
                created_at: order.created_at || new Date().toISOString(),
              },
              ...prev.filter((i) => i.id !== order.id),
            ].slice(0, 10));

            setUnreadCount((count) => count + 1);
            toast.success(`🔔 New Order from ${custName} (${token})`);
          }
        )
        .subscribe();
      channels.push(orderChannel);
    }

    // 2. Task Notifications (For Employees / Recipients)
    if (user?.id) {
      const taskNotifChannel = supabase
        .channel(`task-notifications-${user.id}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "notifications",
            filter: `recipient_profile_id=eq.${user.id}`,
          },
          (payload: any) => {
            const newNotif = payload.new as AppNotification;
            setTaskNotifications((prev) => [
              newNotif,
              ...prev.filter((n) => n.id !== newNotif.id && n.task_id !== newNotif.task_id),
            ]);
            setUnreadCount((count) => count + 1);
            toast.success(`📋 ${newNotif.title}: ${newNotif.message}`);
          }
        )
        .subscribe();
      channels.push(taskNotifChannel);
    }

    return () => {
      channels.forEach((ch) => ch.unsubscribe());
    };
  }, [shop?.id, user?.id]);

  async function handleLogout() {
    // 1. Immediately purge in-memory state and localStorage to prevent cross-account leakage
    useAuthStore.getState().reset();
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

    try {
      const supabase = createClient();
      await supabase.auth.signOut();
      toast.success("Signed out successfully");
    } catch (err) {
      console.warn("Sign-out network error:", err);
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  // Handle Employee Task Status Update directly inside Notification Modal
  async function handleUpdateTaskStatusInModal(newStatus: TaskStatus) {
    if (!selectedTaskNotif?.metadata?.task_id || !shop?.id) return;
    setIsUpdatingTaskStatus(true);

    try {
      const taskId = selectedTaskNotif.metadata.task_id;
      await updateTaskStatusAndNotify(taskId, newStatus, shop.id, user?.id);

      const statusLabel =
        newStatus === "in_progress" || newStatus === "accepted"
          ? "Accepted / In Progress"
          : newStatus === "completed"
          ? "Completed"
          : "Assigned";

      // Update selected modal state
      setSelectedTaskNotif((prev) =>
        prev
          ? {
              ...prev,
              metadata: {
                ...prev.metadata,
                status: statusLabel,
              },
            }
          : null
      );

      // Refresh task notifications list
      loadTaskNotifications();

      toast.success(
        newStatus === "completed"
          ? "Task completed! Great job 🎉"
          : "Task status updated to Accepted / In Progress!"
      );
    } catch (err: any) {
      toast.error(err?.message || "Failed to update task status.");
    } finally {
      setIsUpdatingTaskStatus(false);
    }
  }

  async function handleOpenTaskModal(notif: AppNotification) {
    setSelectedTaskNotif(notif);
    setShowNotifications(false);
    if (user?.id && !notif.is_read) {
      await markNotificationAsRead(notif.id, user.id);
      loadTaskNotifications();
    }
  }

  const totalNotificationsCount = taskNotifications.length + orderNotifications.length;

  return (
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-xl border-b border-slate-200 shadow-sm transition-all">
      <div className="flex items-center justify-between h-16 sm:h-20 px-3 sm:px-8">
        {/* Left: Menu + Brand Logo & Shop Name */}
        <div className="flex items-center gap-2.5 sm:gap-4">
          {(!hasMultipleShops || !isAllShops) && (
            <button
              onClick={onMenuClick}
              className="lg:hidden p-2 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors touch-target flex items-center justify-center"
              aria-label="Toggle menu"
            >
              <Menu className="h-6 w-6 sm:h-7 sm:w-7" />
            </button>
          )}

          <Link href="/dashboard" className="flex items-center gap-2.5 group">
            <div style={{ perspective: 1000 }} className="shrink-0">
              <motion.div
                animate={{
                  rotateY: [0, 360],
                  filter: [
                    "brightness(1) drop-shadow(0 4px 6px rgba(16, 185, 129, 0.25))",
                    "brightness(0.92) drop-shadow(0 2px 4px rgba(16, 185, 129, 0.15))",
                    "brightness(1) drop-shadow(0 4px 6px rgba(16, 185, 129, 0.25))",
                    "brightness(0.92) drop-shadow(0 2px 4px rgba(16, 185, 129, 0.15))",
                    "brightness(1) drop-shadow(0 4px 6px rgba(16, 185, 129, 0.25))",
                  ],
                }}
                transition={{
                  duration: 12,
                  repeat: Infinity,
                  ease: "linear",
                }}
                style={{ transformStyle: "preserve-3d" }}
                className="motion-reduce:animate-none motion-reduce:transform-none shrink-0"
              >
                <Image
                  src="/bishop-icon.svg"
                  alt="BISHOP"
                  width={36}
                  height={36}
                  className="h-8 sm:h-9 w-auto object-contain"
                  priority
                />
              </motion.div>
            </div>
            <span
              className="text-lg sm:text-2xl font-black text-emerald-500 tracking-tight drop-shadow-xs truncate max-w-[200px] sm:max-w-xs group-hover:text-emerald-400 transition-colors"
              style={{ fontFamily: "'Arial Black', sans-serif" }}
            >
              {isAllShops ? "All Shops" : (shop?.name || "BISHOP")}
            </span>
          </Link>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-1.5 sm:gap-3">
          {/* Language Switcher */}
          <button
            onClick={toggleLang}
            className="flex items-center gap-1.5 px-2.5 sm:px-4 py-1.5 sm:py-2.5 rounded-2xl bg-white border-2 border-slate-100 text-mint-700 font-extrabold text-xs sm:text-sm shadow-sm hover:border-mint-300 hover:bg-mint-50/80 hover:shadow-md transition-all duration-300 touch-manipulation"
            aria-label="Toggle language"
            title="Switch Language / மொழியை மாற்றுக"
          >
            <Languages className="h-4 w-4 sm:h-5 sm:w-5 text-mint-600 shrink-0" />
            <span className="font-bold">{lang === "en" ? "தமிழ்" : "English"}</span>
          </button>

          {/* Shop Selector Dropdown (Shopkeepers with >=1 shop) */}
          {isShopkeeper && (shops?.length || 0) >= 1 && (
            <div className="relative" ref={shopSelectorRef}>
              <button
                type="button"
                onClick={() => {
                  setShowShopSelector((prev) => !prev);
                  setShowNotifications(false);
                  setShowUserMenu(false);
                }}
                className="flex items-center gap-1.5 px-2.5 sm:px-3.5 py-1.5 sm:py-2.5 rounded-2xl bg-white border-2 border-slate-100 text-slate-700 font-extrabold text-xs sm:text-sm shadow-sm hover:border-mint-300 hover:bg-mint-50/80 hover:shadow-md transition-all duration-300 touch-manipulation max-w-[130px] xs:max-w-[170px] sm:max-w-[220px]"
                aria-label="Select Shop"
                title={isAllShops ? "All Shops" : (shop?.name || "Select Shop")}
              >
                <Store className="h-4 w-4 sm:h-5 sm:w-5 text-mint-600 shrink-0" />
                <span className="truncate">
                  {isAllShops ? "All Shops" : (shop?.name || "Select Shop")}
                </span>
                <ChevronDown
                  className={`h-3.5 w-3.5 sm:h-4 sm:w-4 text-slate-400 shrink-0 transition-transform duration-200 ${
                    showShopSelector ? "rotate-180" : ""
                  }`}
                />
              </button>

              {showShopSelector && (
                <div className="absolute right-0 mt-2 w-56 sm:w-64 bg-white rounded-2xl sm:rounded-3xl border border-slate-200 shadow-2xl p-2 z-50 animate-in fade-in-50 zoom-in-95 duration-150">
                  <div className="px-3 py-1.5 border-b border-slate-100 mb-1">
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                      Switch Shop
                    </p>
                  </div>
                  <div className="max-h-64 overflow-y-auto space-y-1 pr-0.5">
                    {/* All Shops Option (multi-shop only) */}
                    {shops.length > 1 && (
                      <button
                        type="button"
                        onClick={handleSelectAllShops}
                        className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-colors ${
                          isAllShops
                            ? "bg-mint-50 text-mint-700 font-bold"
                            : "text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        <div className="flex items-center gap-2 truncate">
                          <Building2
                            className={`h-4 w-4 shrink-0 ${
                              isAllShops ? "text-mint-600" : "text-slate-400"
                            }`}
                          />
                          <span className="truncate">All Shops</span>
                        </div>
                        {isAllShops && <Check className="h-4 w-4 text-mint-600 shrink-0" />}
                      </button>
                    )}

                    {/* Individual Registered Shops */}
                    {shops.map((s) => {
                      const isSelected = !isAllShops && shop?.id === s.id;
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => handleSelectShop(s)}
                          className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-colors ${
                            isSelected
                              ? "bg-mint-50 text-mint-700 font-bold"
                              : "text-slate-700 hover:bg-slate-50"
                          }`}
                        >
                          <div className="flex items-center gap-2 truncate">
                            <Store
                              className={`h-4 w-4 shrink-0 ${
                                isSelected ? "text-mint-600" : "text-slate-400"
                              }`}
                            />
                            <span className="truncate">{s.name}</span>
                          </div>
                          {isSelected && <Check className="h-4 w-4 text-mint-600 shrink-0" />}
                        </button>
                      );
                    })}
                  </div>

                  {/* Add Shop Action */}
                  <div className="border-t border-slate-100 my-1.5" />
                  <Link
                    href="/shop/setup"
                    onClick={() => setShowShopSelector(false)}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs sm:text-sm font-bold text-mint-700 hover:bg-mint-50/80 transition-colors"
                  >
                    <Plus className="h-4 w-4 text-mint-600 shrink-0" />
                    <span>+ Add Shop</span>
                  </Link>
                </div>
              )}
            </div>
          )}

          {/* Notifications Dropdown */}
          <div className="relative" ref={notificationsRef}>
            <button
              onClick={() => {
                setShowNotifications((prev) => !prev);
                setShowShopSelector(false);
                if (unreadCount > 0) setUnreadCount(0);
              }}
              className="relative p-2 sm:p-3.5 rounded-2xl bg-white border-2 border-slate-100 text-slate-600 shadow-sm hover:text-mint-600 hover:border-mint-300 hover:bg-mint-50/80 hover:shadow-lg transition-all duration-300 touch-manipulation"
              aria-label="Notifications"
            >
              <Bell className="h-5 w-5 sm:h-[26px] sm:w-[26px] drop-shadow-md" strokeWidth={2.5} />
              {unreadCount > 0 && (
                <Badge className="absolute -top-1 -right-1 px-1.5 py-0.5 text-[10px] sm:text-xs shadow-[0_0_15px_rgba(34,197,94,0.8)] border-2 border-white">
                  {unreadCount}
                </Badge>
              )}
            </button>

            {showNotifications && (
              <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white rounded-3xl border border-slate-200 shadow-2xl p-3 z-50 space-y-2">
                <div className="px-3 py-1.5 border-b border-slate-100 flex items-center justify-between">
                  <p className="text-sm font-bold text-slate-900">
                    {topBarT.notifications}
                  </p>
                  <Badge variant="mint" size="sm">{totalNotificationsCount}</Badge>
                </div>

                <div className="max-h-80 overflow-y-auto space-y-2.5 pr-0.5">
                  {totalNotificationsCount === 0 ? (
                    <div className="p-6 text-center text-xs text-slate-400 font-medium">
                      {topBarT.noNotifications}
                    </div>
                  ) : (
                    <>
                      {/* BISHOP Task Notifications */}
                      {taskNotifications.map((notif) => {
                        const meta = notif.metadata || {};
                        const currentStatus = meta.status || "Assigned";
                        return (
                          <div
                            key={notif.id}
                            className={`p-3.5 rounded-2xl border transition-all ${
                              notif.is_read
                                ? "bg-slate-50 border-slate-100"
                                : "bg-purple-50/70 border-purple-200 shadow-sm"
                            }`}
                          >
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-xs font-black text-purple-700 flex items-center gap-1.5">
                                <ClipboardList className="h-4 w-4 text-purple-600" />
                                {notif.title}
                              </span>
                              <span className="text-[10px] text-slate-400 font-bold">
                                {new Date(notif.created_at).toLocaleTimeString([], {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </span>
                            </div>

                            <p className="text-sm font-extrabold text-slate-900 mb-1">
                              {meta.task_title || notif.message}
                            </p>

                            <div className="space-y-1 text-xs text-slate-600 mb-3">
                              {meta.employee_name && (
                                <p className="flex items-center gap-1 font-semibold text-slate-700">
                                  <UserCheck className="h-3.5 w-3.5 text-purple-500" />
                                  Employee: <strong className="text-slate-900">{meta.employee_name}</strong>
                                </p>
                              )}
                              {meta.assigned_by_name && (
                                <p className="flex items-center gap-1">
                                  <Shield className="h-3.5 w-3.5 text-slate-400" />
                                  Assigned by: <strong className="text-slate-800">{meta.assigned_by_name}</strong>
                                </p>
                              )}
                              {meta.shop_name && (
                                <p className="flex items-center gap-1">
                                  <Store className="h-3.5 w-3.5 text-slate-400" />
                                  Shop: <strong className="text-slate-800">{meta.shop_name}</strong>
                                </p>
                              )}
                              <div className="pt-1 flex items-center justify-between">
                                <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-md bg-purple-100 text-purple-800 border border-purple-200">
                                  Status: {currentStatus}
                                </span>
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={() => handleOpenTaskModal(notif)}
                              className="w-full text-center px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-extrabold text-xs shadow-sm transition touch-manipulation flex items-center justify-center gap-1.5"
                            >
                              <ClipboardList className="h-3.5 w-3.5" />
                              View Complete Task
                            </button>
                          </div>
                        );
                      })}

                      {/* Order Notifications */}
                      {orderNotifications.map((notification) => (
                        <div
                          key={notification.id}
                          className="p-3 bg-slate-50 rounded-2xl border border-slate-100 space-y-2"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-extrabold text-emerald-600 flex items-center gap-1">
                              🔔 New Order
                            </span>
                            <span className="text-[10px] text-slate-400 font-semibold">
                              {new Date(notification.created_at).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                          </div>
                          <p className="text-sm font-bold text-slate-900">{notification.customer_name}</p>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedOrder(notification);
                              setShowNotifications(false);
                            }}
                            className="w-full text-center px-3 py-1.5 rounded-xl bg-mint-600 hover:bg-mint-700 text-white font-bold text-xs shadow-sm transition touch-manipulation"
                          >
                            View Order Details
                          </button>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* User Profile Menu */}
          <div className="relative" ref={userMenuRef}>
            <button
              onClick={() => {
                setShowUserMenu(!showUserMenu);
                setShowShopSelector(false);
              }}
              className="group flex items-center gap-2 sm:gap-4 p-1 sm:p-2 pr-2.5 sm:pr-5 rounded-2xl sm:rounded-[20px] bg-white border-2 border-slate-50 hover:border-mint-200 shadow-sm hover:shadow-xl hover:shadow-mint-500/10 transition-all duration-300 touch-manipulation"
            >
              <div className="h-9 w-9 sm:h-12 sm:w-12 rounded-xl sm:rounded-[14px] bg-gradient-to-br from-teal-500 via-mint-500 to-emerald-400 flex items-center justify-center text-white text-sm sm:text-[20px] font-black shadow-lg shadow-mint-500/40 ring-2 sm:ring-4 ring-white shrink-0">
                {user?.full_name?.charAt(0)?.toUpperCase() || "U"}
              </div>
              <div className="hidden sm:flex flex-col text-left justify-center">
                <p className="text-[17px] sm:text-[19px] font-black text-slate-900 uppercase tracking-widest leading-none drop-shadow-sm group-hover:text-mint-700 transition-colors">
                  {user?.full_name || "User"}
                </p>
                <div className="flex items-center gap-2 mt-2">
                  <div className="h-2.5 w-2.5 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.9)] animate-pulse" />
                  <p className="text-[12px] font-black text-emerald-600 uppercase tracking-[0.2em] leading-none">
                    {isShopkeeper
                      ? t.common.shopkeeper
                      : user?.role === "employee"
                      ? "EMPLOYEE"
                      : (user?.role || t.common.shopkeeper)}
                  </p>
                </div>
              </div>
            </button>

            {/* User Dropdown */}
            {showUserMenu && (
              <div className="absolute right-0 mt-2 w-48 sm:w-52 bg-white rounded-xl border border-slate-100 shadow-lg py-1.5 z-50">
                <Link
                  href="/dashboard/settings"
                  onClick={() => setShowUserMenu(false)}
                  className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  <User className="h-4 w-4 text-slate-400" />
                  {topBarT.profileAndSettings}
                </Link>
                <div className="border-t border-slate-100 my-1" />
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors w-full"
                >
                  <LogOut className="h-4 w-4" />
                  {topBarT.signOut}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* MODAL 1: Complete Employee Task Notification View */}
      <Modal
        isOpen={Boolean(selectedTaskNotif)}
        onClose={() => setSelectedTaskNotif(null)}
        title="Employee Task Notification"
        size="md"
      >
        {selectedTaskNotif && (
          <div className="space-y-4 font-sans text-sm text-slate-800">
            <div className="bg-gradient-to-br from-purple-50/80 via-white to-purple-50/30 p-5 rounded-2xl border border-purple-200 space-y-3 shadow-xs">
              <div className="flex justify-between items-center pb-2.5 border-b border-purple-100">
                <span className="text-xs text-purple-700 font-extrabold uppercase tracking-wider flex items-center gap-1.5">
                  <ClipboardList className="h-4 w-4 text-purple-600" />
                  Task Title
                </span>
                <strong className="text-slate-900 text-base font-black">
                  {selectedTaskNotif.metadata?.task_title || selectedTaskNotif.title}
                </strong>
              </div>

              <div className="space-y-2 text-xs">
                {selectedTaskNotif.metadata?.employee_name && (
                  <div className="flex justify-between items-center pb-1.5 border-b border-slate-100">
                    <span className="text-slate-500 font-semibold uppercase">Employee Name</span>
                    <span className="font-bold text-slate-900 flex items-center gap-1">
                      <UserCheck className="h-3.5 w-3.5 text-purple-600" />
                      {selectedTaskNotif.metadata.employee_name}
                      {selectedTaskNotif.metadata.employee_mobile && (
                        <span className="text-slate-500 text-[11px]">
                          ({selectedTaskNotif.metadata.employee_mobile})
                        </span>
                      )}
                    </span>
                  </div>
                )}

                {selectedTaskNotif.metadata?.assigned_by_name && (
                  <div className="flex justify-between items-center pb-1.5 border-b border-slate-100">
                    <span className="text-slate-500 font-semibold uppercase">Assigned By</span>
                    <span className="font-bold text-slate-800 flex items-center gap-1">
                      <Shield className="h-3.5 w-3.5 text-slate-400" />
                      {selectedTaskNotif.metadata.assigned_by_name}
                    </span>
                  </div>
                )}

                {selectedTaskNotif.metadata?.shop_name && (
                  <div className="flex justify-between items-center pb-1.5 border-b border-slate-100">
                    <span className="text-slate-500 font-semibold uppercase">Shop Name</span>
                    <span className="font-bold text-slate-800 flex items-center gap-1">
                      <Store className="h-3.5 w-3.5 text-slate-400" />
                      {selectedTaskNotif.metadata.shop_name}
                    </span>
                  </div>
                )}

                <div className="flex justify-between items-center pb-1.5 border-b border-slate-100">
                  <span className="text-slate-500 font-semibold uppercase">Date / Time</span>
                  <span className="font-bold text-slate-700 flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5 text-slate-400" />
                    {new Date(
                      selectedTaskNotif.metadata?.date_time || selectedTaskNotif.created_at
                    ).toLocaleString("en-IN", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                      hour12: true,
                    })}
                  </span>
                </div>

                <div className="flex justify-between items-center pt-1">
                  <span className="text-slate-500 font-semibold uppercase">Task Status</span>
                  <span className="font-extrabold text-xs px-3 py-1 rounded-xl bg-purple-100 text-purple-900 border border-purple-200">
                    {selectedTaskNotif.metadata?.status || "Assigned"}
                  </span>
                </div>
              </div>

              {/* Complete Task Details Description */}
              <div className="pt-2 border-t border-purple-100">
                <span className="text-[11px] text-slate-400 font-bold uppercase tracking-wider block mb-1">
                  Complete Task Description
                </span>
                <p className="text-xs text-slate-700 bg-white p-3 rounded-xl border border-slate-200 leading-relaxed font-medium">
                  {selectedTaskNotif.metadata?.task_details || selectedTaskNotif.message}
                </p>
              </div>
            </div>

            {/* Status Flow Action Buttons: Assigned -> Accepted/In Progress -> Completed */}
            <div className="space-y-2 pt-1">
              {(!selectedTaskNotif.metadata?.status ||
                selectedTaskNotif.metadata.status === "Assigned" ||
                selectedTaskNotif.metadata.status === "pending") && (
                <Button
                  size="lg"
                  isLoading={isUpdatingTaskStatus}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-extrabold shadow-md shadow-blue-500/20"
                  leftIcon={<Play className="h-4 w-4 fill-white" />}
                  onClick={() => handleUpdateTaskStatusInModal("in_progress")}
                >
                  Accept & Start Task
                </Button>
              )}

              {selectedTaskNotif.metadata?.status === "Accepted / In Progress" && (
                <Button
                  size="lg"
                  isLoading={isUpdatingTaskStatus}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold shadow-md shadow-emerald-500/20"
                  leftIcon={<CheckCircle2 className="h-4 w-4" />}
                  onClick={() => handleUpdateTaskStatusInModal("completed")}
                >
                  Mark as Completed
                </Button>
              )}

              {selectedTaskNotif.metadata?.status === "Completed" && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-center text-xs font-black text-emerald-800 flex items-center justify-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <span>Task Completed 🎉</span>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <Button variant="outline" size="sm" onClick={() => setSelectedTaskNotif(null)}>
                Close
              </Button>
              <Link href="/dashboard/tasks">
                <Button
                  size="sm"
                  onClick={() => setSelectedTaskNotif(null)}
                  className="bg-slate-900 hover:bg-slate-800 text-white font-bold"
                >
                  Go to Tasks Page
                </Button>
              </Link>
            </div>
          </div>
        )}
      </Modal>

      {/* MODAL 2: View Order Details */}
      <Modal
        isOpen={Boolean(selectedOrder)}
        onClose={() => setSelectedOrder(null)}
        title="Order Details"
        size="md"
      >
        {selectedOrder && (
          <div className="space-y-4 font-sans text-sm text-slate-800">
            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-2.5">
              <div className="flex justify-between items-center pb-2 border-b border-slate-200/60">
                <span className="text-xs text-slate-500 font-semibold uppercase tracking-wider">Customer</span>
                <strong className="text-slate-900 text-base font-extrabold">{selectedOrder.customer_name}</strong>
              </div>
              <div className="flex justify-between items-center pb-2 border-b border-slate-200/60">
                <span className="text-xs text-slate-500 font-semibold uppercase tracking-wider">Order Placed</span>
                <span className="font-bold text-slate-700">
                  {new Date(selectedOrder.created_at).toLocaleString("en-IN", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                    hour12: true,
                  })}
                </span>
              </div>
              <div className="flex justify-between items-center pb-2 border-b border-slate-200/60">
                <span className="text-xs text-slate-500 font-semibold uppercase tracking-wider">Total Amount</span>
                <strong className="text-emerald-600 text-lg font-black tabular-nums">
                  {formatCurrency(selectedOrder.total)}
                </strong>
              </div>
              <div className="flex justify-between items-center pt-1">
                <span className="text-xs text-slate-500 font-semibold uppercase tracking-wider">Token ID</span>
                <span className="font-mono font-black text-mint-700 text-sm bg-mint-50 px-3 py-1 rounded-xl border border-mint-200">
                  {selectedOrder.token_number || selectedOrder.order_number}
                </span>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedOrder(null)}
              >
                Close
              </Button>
              <Link href="/dashboard/orders">
                <Button
                  size="sm"
                  onClick={() => setSelectedOrder(null)}
                  className="bg-slate-900 hover:bg-slate-800 text-white font-bold"
                >
                  Go to Orders Page
                </Button>
              </Link>
            </div>
          </div>
        )}
      </Modal>
    </header>
  );
}
