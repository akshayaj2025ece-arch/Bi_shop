"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useEmployeeStore } from "@/stores/employee-store";
import { useLanguageStore } from "@/stores/language-store";
import { DASHBOARD_TRANSLATIONS } from "@/lib/translations";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { LoadingSpinner } from "@/components/ui/loading";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bell,
  UtensilsCrossed,
  ClipboardList,
  CheckCircle2,
  Clock,
  Play,
  LogOut,
  RefreshCw,
  Search,
  Sparkles,
  Shield,
  Store,
  User,
  Plus,
  Minus,
  Save,
  Package,
} from "lucide-react";
import { toast } from "sonner";
import Image from "next/image";
import Link from "next/link";
import type { AppNotification, EmployeeTask, TaskStatus } from "@/lib/types";
import {
  fetchRecipientNotifications,
  fetchEmployeeTasksApi,
  markNotificationAsRead,
  updateTaskStatusAndNotify,
} from "@/lib/task-service";

interface StockItem {
  id: string;
  inventory_id?: string | null;
  menu_item_id?: string | null;
  name: string;
  category_name?: string;
  price?: number;
  quantity: number;
  unit?: string;
  is_available: boolean;
}

export default function EmployeeDashboardPage() {
  const router = useRouter();
  const { employee, logoutEmployee } = useEmployeeStore();
  const { lang, toggleLang } = useLanguageStore();
  const isTa = lang === "ta";
  const landT = DASHBOARD_TRANSLATIONS[lang || "en"].landingPage;

  // Active Tab: "stock" | "tasks"
  const [activeTab, setActiveTab] = useState<"stock" | "tasks">("stock");

  // Stock Items State
  const [items, setItems] = useState<StockItem[]>([]);
  const [editingStock, setEditingStock] = useState<Record<string, number>>({});
  const [isSavingStock, setIsSavingStock] = useState<Record<string, boolean>>({});
  const [isLoadingStock, setIsLoadingStock] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  // Tasks State
  const [tasks, setTasks] = useState<EmployeeTask[]>([]);
  const [isLoadingTasks, setIsLoadingTasks] = useState(true);

  // Notifications State
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [showNotifDropdown, setShowNotifDropdown] = useState(false);
  const [selectedNotifModal, setSelectedNotifModal] = useState<AppNotification | null>(null);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

  // Verification Check: If no employee session, redirect to employee entry
  useEffect(() => {
    if (!employee) {
      router.replace("/employee/login");
    }
  }, [employee, router]);

  const stockItemsRef = useRef<StockItem[]>([]);
  const hasLoadedStockInitialRef = useRef(false);

  // 1. Fetch Menu Stock Items from SAME shop inventory + menu_items tables (NON-FINANCIAL DATA ONLY)
  const fetchStockItems = useCallback(async (isSilent = false) => {
    if (!employee?.shop_id) return;
    
    if (!isSilent && !hasLoadedStockInitialRef.current && stockItemsRef.current.length === 0) {
      setIsLoadingStock(true);
    }

    try {
      const res = await fetch(`/api/employee/stock?shop_id=${encodeURIComponent(employee.shop_id)}`);
      const resData = await res.json();

      if (res.ok && resData.success && Array.isArray(resData.items)) {
        const mappedItems: StockItem[] = resData.items.map((it: any) => ({
          id: it.id,
          inventory_id: it.inventory_id,
          menu_item_id: it.menu_item_id,
          name: it.name,
          price: it.price,
          quantity: Number(it.quantity) || 0,
          unit: it.unit || "pcs",
          is_available: Boolean(it.is_available),
        }));

        const currentSig = JSON.stringify(
          stockItemsRef.current.map((i) => ({ id: i.id, name: i.name, price: i.price, quantity: i.quantity, is_available: i.is_available, unit: i.unit }))
        );
        const newSig = JSON.stringify(
          mappedItems.map((i) => ({ id: i.id, name: i.name, price: i.price, quantity: i.quantity, is_available: i.is_available, unit: i.unit }))
        );

        if (currentSig !== newSig || !hasLoadedStockInitialRef.current) {
          stockItemsRef.current = mappedItems;
          setItems(mappedItems);

          // Update editing state map for unedited items
          setEditingStock((prev) => {
            const next = { ...prev };
            mappedItems.forEach((it) => {
              if (next[it.id] === undefined) {
                next[it.id] = it.quantity;
              }
            });
            return next;
          });
        }
      }
    } catch (err) {
      console.warn("Error fetching menu items for stock update:", err);
    } finally {
      hasLoadedStockInitialRef.current = true;
      setIsLoadingStock(false);
    }
  }, [employee?.shop_id]);

  const empTasksRef = useRef<EmployeeTask[]>([]);
  const hasLoadedInitialTasksRef = useRef(false);

  // 2. Fetch Employee Assigned Tasks via Backend API + cache (isSilent = true for background sync)
  const fetchEmployeeTasks = useCallback(async (isSilent = false) => {
    if (!employee?.shop_id || !employee?.employee_id) return;
    
    // Show loading spinner ONLY on initial load
    if (!isSilent && !hasLoadedInitialTasksRef.current && empTasksRef.current.length === 0) {
      setIsLoadingTasks(true);
    }

    try {
      const taskList = await fetchEmployeeTasksApi(employee.shop_id, employee.employee_id);
      
      const currentSig = JSON.stringify(
        empTasksRef.current.map((t) => ({ id: t.id, status: t.status, updated_at: t.updated_at, title: t.title }))
      );
      const newSig = JSON.stringify(
        taskList.map((t) => ({ id: t.id, status: t.status, updated_at: t.updated_at, title: t.title }))
      );

      if (currentSig !== newSig || !hasLoadedInitialTasksRef.current) {
        empTasksRef.current = taskList;
        setTasks(taskList);
      }
    } catch (err) {
      console.warn("Error fetching employee tasks:", err);
    } finally {
      hasLoadedInitialTasksRef.current = true;
      setIsLoadingTasks(false);
    }
  }, [employee?.shop_id, employee?.employee_id]);

  // 3. Fetch Notifications for Employee
  const loadNotifications = useCallback(async () => {
    if (!employee?.profile_id) return;
    try {
      const notifs = await fetchRecipientNotifications(employee.profile_id, employee.shop_id);
      setNotifications(notifs);
    } catch (err) {
      console.warn("Error loading notifications:", err);
    }
  }, [employee?.profile_id, employee?.shop_id]);

  useEffect(() => {
    fetchStockItems(false);
    fetchEmployeeTasks(false);
    loadNotifications();
  }, [fetchStockItems, fetchEmployeeTasks, loadNotifications]);

  // Realtime Notification, Task, & Stock Listener with Silent Polling Fallback (ZERO blinking)
  useEffect(() => {
    if (!employee?.profile_id || !employee?.employee_id || !employee?.shop_id) return;

    const supabase = createClient();
    const notifChannel = supabase
      .channel(`emp-notifs-${employee.profile_id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `recipient_profile_id=eq.${employee.profile_id}`,
        },
        () => {
          loadNotifications();
          fetchEmployeeTasks(true);
        }
      )
      .subscribe();

    const taskChannel = supabase
      .channel(`emp-tasks-${employee.employee_id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "employee_tasks",
          filter: `employee_id=eq.${employee.employee_id}`,
        },
        () => {
          fetchEmployeeTasks(true);
        }
      )
      .subscribe();

    const stockChannel = supabase
      .channel(`emp-stock-${employee.shop_id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "menu_items",
          filter: `shop_id=eq.${employee.shop_id}`,
        },
        () => {
          fetchStockItems(true);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "inventory",
          filter: `shop_id=eq.${employee.shop_id}`,
        },
        () => {
          fetchStockItems(true);
        }
      )
      .subscribe();

    // 5-second Silent Polling Fallback
    const pollInterval = setInterval(() => {
      fetchStockItems(true);
      fetchEmployeeTasks(true);
      loadNotifications();
    }, 5000);

    return () => {
      notifChannel.unsubscribe();
      taskChannel.unsubscribe();
      stockChannel.unsubscribe();
      clearInterval(pollInterval);
    };
  }, [employee?.profile_id, employee?.employee_id, employee?.shop_id, fetchStockItems, fetchEmployeeTasks, loadNotifications]);

  // Stock Quantity Update Handler (Prevents negative stock)
  async function handleUpdateStock(itemId: string) {
    if (!employee?.shop_id) return;
    const targetItem = items.find((i) => i.id === itemId);
    if (!targetItem) return;

    const newQty = Math.max(0, editingStock[itemId] !== undefined ? editingStock[itemId] : targetItem.quantity);
    setIsSavingStock((prev) => ({ ...prev, [itemId]: true }));

    try {
      const res = await fetch("/api/employee/stock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          item_id: itemId,
          inventory_id: targetItem.inventory_id,
          menu_item_id: targetItem.menu_item_id,
          name: targetItem.name,
          shop_id: employee.shop_id,
          quantity: newQty,
          is_available: newQty > 0,
        }),
      });

      const resData = await res.json();
      if (!res.ok || !resData.success) {
        throw new Error(resData.error || "Failed to update stock");
      }

      setItems((prev) =>
        prev.map((it) =>
          it.id === itemId ? { ...it, quantity: newQty, is_available: newQty > 0 } : it
        )
      );

      toast.success(`Stock updated for "${targetItem.name}" to ${newQty} ${targetItem.unit || 'pcs'}`);
    } catch (err: any) {
      console.error("Stock update error:", err);
      toast.error(err?.message || "Failed to update stock quantity.");
    } finally {
      setIsSavingStock((prev) => ({ ...prev, [itemId]: false }));
    }
  }

  // Task Status Update Handler (Pending -> In Progress -> Completed)
  async function handleUpdateTaskStatus(taskId: string, newStatus: TaskStatus) {
    if (!employee?.shop_id) return;
    setIsUpdatingStatus(true);
    try {
      const targetTask = tasks.find((t) => t.id === taskId);
      const res = await updateTaskStatusAndNotify(taskId, newStatus, employee.shop_id, employee.profile_id, targetTask);

      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, status: newStatus } : t))
      );

      // Refresh stock items silently from database
      fetchStockItems(true);

      // Update selected modal state if open
      if (selectedNotifModal && selectedNotifModal.task_id === taskId) {
        const displayStatus =
          newStatus === "in_progress" || newStatus === "accepted"
            ? "In Progress"
            : newStatus === "completed"
            ? "Completed"
            : "Pending";

        setSelectedNotifModal({
          ...selectedNotifModal,
          metadata: {
            ...selectedNotifModal.metadata,
            status: displayStatus,
          },
        });
      }

      loadNotifications();

      toast.success(
        res?.message || (newStatus === "completed"
          ? "Task completed! Great job 🎉"
          : "Task accepted! Status updated to In Progress.")
      );
    } catch (err: any) {
      console.error("handleUpdateTaskStatus error:", err);
      toast.error(err?.message || "Failed to update task status.");
    } finally {
      setIsUpdatingStatus(false);
    }
  }

  const unreadNotifCount = notifications.filter((n) => !n.is_read).length;
  const newPendingTaskCount = tasks.filter(
    (tk) => tk.status === "pending" || tk.status === "assigned"
  ).length;

  const filteredStockItems = items.filter((it) =>
    it.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (!employee) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-white">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-slate-50 text-slate-900 pb-16">
      {/* ─── Employee Header ─── */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-xl border-b border-slate-200 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 sm:h-20 flex items-center justify-between gap-4">
          {/* Left: Brand Logo + Employee Name + Shop Name */}
          <div className="flex items-center gap-3">
            <Link href="/employee" className="flex items-center gap-2">
              <Image
                src="/bishop-icon.svg"
                alt="BISHOP"
                width={36}
                height={36}
                className="h-8 sm:h-9 w-auto object-contain"
                priority
              />
            </Link>

            <div className="border-l border-slate-200 pl-3 min-w-0">
              <h2 className="text-base sm:text-lg font-black text-slate-900 truncate">
                {employee.full_name}
              </h2>
              <div className="flex items-center gap-1.5 text-xs text-mint-700 font-bold truncate">
                <Store className="h-3.5 w-3.5 shrink-0 text-mint-600" />
                <span>{employee.shop_name}</span>
                <span className="text-slate-300">•</span>
                <span className="text-slate-500 uppercase text-[10px] font-extrabold tracking-wider">
                  {employee.role}
                </span>
              </div>
            </div>
          </div>

          {/* Right: Language, Notifications Bell 🔔, Logout */}
          <div className="flex items-center gap-2 sm:gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={toggleLang}
              className="border-mint-200 text-mint-800 text-xs px-2.5"
            >
              {isTa ? "English" : "தமிழ்"}
            </Button>

            {/* 🔔 Notification Icon with Badge */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setShowNotifDropdown((prev) => !prev);
                  if (unreadNotifCount > 0 && employee.profile_id) {
                    notifications.forEach((n) => markNotificationAsRead(n.id, employee.profile_id));
                  }
                }}
                className="relative p-2.5 rounded-2xl bg-white border-2 border-slate-200 text-slate-700 shadow-sm hover:text-purple-600 hover:border-purple-300 transition-all touch-manipulation"
                aria-label="Notifications"
              >
                <Bell className="h-5 w-5 text-slate-700" strokeWidth={2.5} />
                {unreadNotifCount > 0 && (
                  <Badge className="absolute -top-1 -right-1 px-1.5 py-0.5 text-[10px] bg-purple-600 text-white border-2 border-white shadow-sm">
                    {unreadNotifCount}
                  </Badge>
                )}
              </button>

              {/* Notification Popover Dropdown */}
              <AnimatePresence>
                {showNotifDropdown && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: -5 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: -5 }}
                    className="absolute right-0 mt-2 w-80 sm:w-96 bg-white rounded-3xl border border-slate-200 shadow-2xl p-3.5 z-50 space-y-2 overflow-hidden"
                  >
                    <div className="px-2 py-1 border-b border-slate-100 flex items-center justify-between">
                      <p className="text-sm font-black text-slate-900 flex items-center gap-1.5">
                        <Bell className="h-4 w-4 text-purple-600" />
                        {isTa ? "அறிவிப்புகள்" : "Employee Notifications"}
                      </p>
                      <Badge variant="mint" size="sm">{notifications.length}</Badge>
                    </div>

                    <div className="max-h-80 overflow-y-auto space-y-2 pt-1 pr-0.5">
                      {notifications.length === 0 ? (
                        <div className="p-6 text-center text-xs text-slate-400 font-semibold">
                          {isTa ? "புதிய அறிவிப்புகள் எதுவும் இல்லை" : "No task notifications yet."}
                        </div>
                      ) : (
                        notifications.map((notif) => {
                          const meta = notif.metadata || {};
                          return (
                            <div
                              key={notif.id}
                              className="p-3 bg-purple-50/70 rounded-2xl border border-purple-200/80 space-y-2"
                            >
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-black text-purple-800 flex items-center gap-1">
                                  <ClipboardList className="h-3.5 w-3.5 text-purple-600" />
                                  {notif.title}
                                </span>
                                <span className="text-[10px] text-slate-400 font-bold">
                                  {new Date(notif.created_at).toLocaleTimeString([], {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}
                                </span>
                              </div>

                              <p className="text-xs font-extrabold text-slate-900 truncate">
                                {meta.task_title || notif.message}
                              </p>

                              <p className="text-[11px] text-slate-600 font-medium line-clamp-2">
                                {meta.task_details || notif.message}
                              </p>

                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedNotifModal(notif);
                                  setShowNotifDropdown(false);
                                }}
                                className="w-full text-center px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-extrabold text-xs shadow-xs transition"
                              >
                                {isTa ? "பணியைக் காண்க" : "View Assigned Task"}
                              </button>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Logout / Exit */}
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                try {
                  await fetch("/api/employee/logout", { method: "POST" });
                } catch (e) {
                  // Continue logout even if API call fails
                }
                logoutEmployee();
                toast.success("Logged out of employee portal");
                router.push("/select-role");
              }}
              leftIcon={<LogOut className="h-4 w-4 text-red-500" />}
              className="border-slate-200 text-slate-700 hover:bg-red-50 hover:text-red-700 text-xs"
            >
              {isTa ? "வெளியேறு" : "Logout"}
            </Button>
          </div>
        </div>
      </header>

      {/* ─── Main Section ─── */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 pt-6 space-y-6">
        {/* Navigation Tabs (Available Stock vs My Tasks) */}
        <div className="flex items-center justify-between gap-4 border-b border-slate-200 pb-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab("stock")}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs sm:text-sm font-extrabold transition-all duration-200 ${
                activeTab === "stock"
                  ? "bg-mint-500 text-white shadow-md shadow-mint-500/20 scale-[1.02]"
                  : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-100"
              }`}
            >
              <Package className="h-4 w-4" />
              <span>{isTa ? "இருப்புப் பொருட்கள்" : "Available Stock / Items"}</span>
              <Badge variant="default" size="sm" className="ml-1 bg-white/20 text-white border-none">
                {items.length}
              </Badge>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("tasks")}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs sm:text-sm font-extrabold transition-all duration-200 ${
                activeTab === "tasks"
                  ? "bg-purple-600 text-white shadow-md shadow-purple-500/20 scale-[1.02]"
                  : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-100"
              }`}
            >
              <ClipboardList className="h-4 w-4" />
              <span>
                {isTa
                  ? `ஒதுக்கப்பட்ட பணி${newPendingTaskCount > 0 ? ` (${newPendingTaskCount})` : ""}`
                  : `Assigned Task${newPendingTaskCount > 0 ? ` (${newPendingTaskCount})` : ""}`}
              </span>
              {newPendingTaskCount > 0 && (
                <Badge variant="default" size="sm" className="ml-1 bg-purple-500 text-white border-none font-extrabold shadow-xs">
                  {newPendingTaskCount}
                </Badge>
              )}
            </button>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              fetchStockItems();
              fetchEmployeeTasks();
              loadNotifications();
              toast.success("Refreshed!");
            }}
            leftIcon={<RefreshCw className="h-3.5 w-3.5 text-slate-500" />}
            className="border-slate-200 text-xs"
          >
            {isTa ? "புதுப்பி" : "Refresh"}
          </Button>
        </div>

        {/* ─── TAB 1: AVAILABLE STOCK / ITEMS ─── */}
        {activeTab === "stock" && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-black text-slate-900">
                  {isTa ? "கடை இருப்பு மேலாண்மை" : "Manage Available Item Stock"}
                </h2>
                <p className="text-xs text-slate-500 font-medium">
                  {isTa
                    ? "பொருட்களின் இருப்பு எண்ணிக்கையைப் புதுப்பிக்கவும். வாடிக்கையாளர்களுக்கும் கடைக்காரருக்கும் நேரடியாகத் தெரியும்."
                    : "Update stock quantities for menu items. Changes reflect instantly for Customers & Shopkeeper."}
                </p>
              </div>

              <Input
                placeholder={isTa ? "பொருளைத் தேடுங்கள்..." : "Search items..."}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                leftIcon={<Search className="h-4 w-4 text-slate-400" />}
                className="w-full sm:w-64 bg-white"
              />
            </div>

            {isLoadingStock ? (
              <div className="flex items-center justify-center py-16">
                <LoadingSpinner size="lg" />
              </div>
            ) : filteredStockItems.length === 0 ? (
              <Card padding="md" className="text-center py-12">
                <Package className="h-10 w-10 text-slate-300 mx-auto mb-2" />
                <p className="text-sm font-bold text-slate-600">
                  {isTa ? "பொருட்கள் எதுவும் கிடைக்கவில்லை." : "No menu stock items found."}
                </p>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredStockItems.map((item) => {
                  const currentEditVal =
                    editingStock[item.id] !== undefined ? editingStock[item.id] : item.quantity;
                  const isSaving = Boolean(isSavingStock[item.id]);

                  return (
                    <Card
                      key={item.id}
                      padding="md"
                      className="border-slate-200/90 hover:border-mint-300 transition-all space-y-3 relative overflow-hidden"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h3 className="font-extrabold text-slate-900 text-base">{item.name}</h3>
                          {item.price !== undefined && item.price !== null && (
                            <p className="text-xs font-extrabold text-slate-500 mt-0.5">
                              ₹{item.price}/{item.unit || 'pcs'}
                            </p>
                          )}
                        </div>

                        <Badge
                          variant={item.is_available && item.quantity > 0 ? "success" : "danger"}
                          size="sm"
                        >
                          {item.is_available && item.quantity > 0
                            ? isTa
                              ? `${item.quantity} ${item.unit || 'pcs'} இருப்பில் உள்ளது`
                              : `${item.quantity} ${item.unit || 'pcs'} Available`
                            : isTa
                            ? "கையிருப்பில் இல்லை"
                            : "Unavailable"}
                        </Badge>
                      </div>

                      {/* Stock Quantity Modifier (Prevents Negative Stock) */}
                      <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200 space-y-2">
                        <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500 block">
                          {isTa ? "இருப்பு அளவு" : "Current Available Stock"}
                        </span>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setEditingStock((prev) => ({
                                ...prev,
                                [item.id]: Math.max(0, (prev[item.id] ?? item.quantity) - 1),
                              }))
                            }
                            className="h-9 w-9 rounded-xl bg-white border border-slate-300 flex items-center justify-center text-slate-700 hover:bg-slate-100 font-bold active:scale-95 transition"
                            title="Decrease Stock"
                          >
                            <Minus className="h-4 w-4" />
                          </button>

                          <input
                            type="number"
                            min="0"
                            value={currentEditVal}
                            onChange={(e) => {
                              const val = Math.max(0, parseInt(e.target.value) || 0);
                              setEditingStock((prev) => ({
                                ...prev,
                                [item.id]: val,
                              }));
                            }}
                            className="flex-1 h-9 bg-white border border-slate-300 rounded-xl text-center font-black text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-mint-500/20"
                          />

                          <button
                            type="button"
                            onClick={() =>
                              setEditingStock((prev) => ({
                                ...prev,
                                [item.id]: (prev[item.id] ?? item.quantity) + 1,
                              }))
                            }
                            className="h-9 w-9 rounded-xl bg-white border border-slate-300 flex items-center justify-center text-slate-700 hover:bg-slate-100 font-bold active:scale-95 transition"
                            title="Increase Stock"
                          >
                            <Plus className="h-4 w-4" />
                          </button>
                        </div>
                      </div>

                      {/* Update Stock Button */}
                      <Button
                        size="sm"
                        isLoading={isSaving}
                        onClick={() => handleUpdateStock(item.id)}
                        leftIcon={<Save className="h-3.5 w-3.5" />}
                        className="w-full bg-mint-500 hover:bg-mint-600 text-white font-extrabold shadow-sm"
                      >
                        {isTa ? "இருப்பை சேமி" : "Save Stock Quantity"}
                      </Button>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ─── TAB 2: MY ASSIGNED TASKS ─── */}
        {activeTab === "tasks" && (
          <div className="space-y-4">
            <div>
              <h2 className="text-xl font-black text-slate-900">
                {isTa ? "ஒதுக்கப்பட்ட பணிகள்" : "My Assigned Tasks"}
              </h2>
              <p className="text-xs text-slate-500 font-medium">
                {isTa
                  ? "கடைக்காரரால் உங்களுக்கு ஒதுக்கப்பட்ட பணிகள். நிலையைப் புதுப்பிக்கவும் (Pending → In Progress → Completed)."
                  : "Tasks assigned to you by the shopkeeper. Update status flow: Pending → In Progress → Completed."}
              </p>
            </div>

            {isLoadingTasks ? (
              <div className="flex items-center justify-center py-16">
                <LoadingSpinner size="lg" />
              </div>
            ) : tasks.length === 0 ? (
              <Card padding="md" className="text-center py-12">
                <ClipboardList className="h-10 w-10 text-purple-300 mx-auto mb-2" />
                <p className="text-sm font-bold text-slate-600">
                  {isTa ? "உங்களுக்கு இதுவரை பணிகள் எதுவுமில்லை." : "No tasks assigned to you yet."}
                </p>
              </Card>
            ) : (
              <div className="grid gap-3">
                {tasks.map((tk) => (
                  <Card key={tk.id} padding="md" className="border-slate-200 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <h3 className="font-extrabold text-slate-900 text-base">{tk.title}</h3>
                          <Badge
                            variant={
                              tk.priority === "high"
                                ? "danger"
                                : tk.priority === "medium"
                                ? "warning"
                                : "default"
                            }
                            size="sm"
                          >
                            {tk.priority} priority
                          </Badge>
                        </div>
                        {tk.description && (
                          <p className="text-xs text-slate-600 leading-relaxed font-medium">
                            {tk.description}
                          </p>
                        )}
                        {/* Multi-item Task Breakdown */}
                        {((tk.items && tk.items.length > 0) || (tk.task_items && tk.task_items.length > 0)) && (
                          <div className="mt-2 bg-slate-50 p-2.5 rounded-xl border border-slate-200/90 space-y-1.5">
                            <span className="text-[11px] font-extrabold uppercase text-slate-500 tracking-wider block">
                              Items to Update:
                            </span>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                              {(tk.items || tk.task_items || []).map((item, idx) => (
                                <div key={idx} className="flex items-center justify-between p-2 bg-white rounded-lg border border-slate-200 text-xs">
                                  <span className="font-extrabold text-slate-900">{item.name}</span>
                                  <span className="font-black text-purple-700 bg-purple-50 px-2 py-0.5 rounded-md border border-purple-100">
                                    Quantity: {item.quantity} {item.unit || "pcs"}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Status Badge */}
                      <div>
                        {(tk.status === "assigned" || tk.status === "pending") && (
                          <Badge variant="warning" className="flex items-center gap-1 font-bold">
                            <Clock className="h-3 w-3" />
                            Pending
                          </Badge>
                        )}
                        {(tk.status === "in_progress" || tk.status === "accepted") && (
                          <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-800 border border-blue-200 flex items-center gap-1">
                            <Play className="h-3 w-3 fill-blue-600" />
                            In Progress
                          </span>
                        )}
                        {tk.status === "completed" && (
                          <Badge variant="success" className="flex items-center gap-1 font-bold">
                            <CheckCircle2 className="h-3 w-3" />
                            Completed
                          </Badge>
                        )}
                      </div>
                    </div>

                    {/* Meta & Interactive Action Buttons */}
                    <div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-100 flex-wrap text-xs text-slate-500">
                      <div className="flex items-center gap-4 flex-wrap">
                        <span className="flex items-center gap-1 font-medium">
                          <Store className="h-3.5 w-3.5 text-slate-400" />
                          Shop: <strong className="text-slate-800">{employee.shop_name}</strong>
                        </span>
                        {tk.due_date && (
                          <span className="flex items-center gap-1">
                            <Clock className="h-3.5 w-3.5 text-slate-400" />
                            Due: <strong className="text-slate-800">{tk.due_date}</strong>
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        {(tk.status === "assigned" || tk.status === "pending") && (
                          <Button
                            size="sm"
                            className="bg-blue-600 hover:bg-blue-700 text-white font-extrabold shadow-sm"
                            leftIcon={<Play className="h-3.5 w-3.5 fill-white" />}
                            onClick={() => handleUpdateTaskStatus(tk.id, "in_progress")}
                          >
                            Accept & Start Task
                          </Button>
                        )}

                        {(tk.status === "in_progress" || tk.status === "accepted") && (
                          <Button
                            size="sm"
                            className="bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold shadow-sm"
                            leftIcon={<CheckCircle2 className="h-3.5 w-3.5" />}
                            onClick={() => handleUpdateTaskStatus(tk.id, "completed")}
                          >
                            Mark as Completed
                          </Button>
                        )}
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* MODAL: View Full Notification Task Details */}
      <Modal
        isOpen={Boolean(selectedNotifModal)}
        onClose={() => setSelectedNotifModal(null)}
        title={isTa ? "பணி விவரங்கள்" : "Task Assignment Details"}
        size="md"
      >
        {selectedNotifModal && (
          <div className="space-y-4 font-sans text-sm text-slate-800">
            <div className="bg-gradient-to-br from-purple-50/90 via-white to-purple-50/30 p-5 rounded-2xl border border-purple-200 space-y-3">
              <div className="flex justify-between items-center pb-2 border-b border-purple-100">
                <span className="text-xs text-purple-700 font-extrabold uppercase tracking-wider flex items-center gap-1">
                  <ClipboardList className="h-4 w-4" />
                  Task Title
                </span>
                <strong className="text-slate-900 text-base font-black">
                  {selectedNotifModal.metadata?.task_title || selectedNotifModal.title}
                </strong>
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex justify-between items-center pb-1.5 border-b border-slate-100">
                  <span className="text-slate-500 font-semibold uppercase">Shop Name</span>
                  <span className="font-bold text-slate-900">
                    {selectedNotifModal.metadata?.shop_name || employee.shop_name}
                  </span>
                </div>

                <div className="flex justify-between items-center pb-1.5 border-b border-slate-100">
                  <span className="text-slate-500 font-semibold uppercase">Assigned By</span>
                  <span className="font-bold text-slate-800">
                    {selectedNotifModal.metadata?.assigned_by_name || "Shopkeeper"}
                  </span>
                </div>

                <div className="flex justify-between items-center pb-1.5 border-b border-slate-100">
                  <span className="text-slate-500 font-semibold uppercase">Date / Time</span>
                  <span className="font-bold text-slate-700">
                    {new Date(
                      selectedNotifModal.metadata?.date_time || selectedNotifModal.created_at
                    ).toLocaleString("en-IN")}
                  </span>
                </div>

                <div className="flex justify-between items-center pt-1">
                  <span className="text-slate-500 font-semibold uppercase">Task Status</span>
                  <span className="font-extrabold text-xs px-3 py-1 rounded-xl bg-purple-100 text-purple-900 border border-purple-200">
                    {selectedNotifModal.metadata?.status || "Pending"}
                  </span>
                </div>
              </div>

              <div className="pt-2 border-t border-purple-100">
                <span className="text-[11px] text-slate-400 font-bold uppercase tracking-wider block mb-1">
                  Complete Task Description
                </span>
                <p className="text-xs text-slate-700 bg-white p-3 rounded-xl border border-slate-200 leading-relaxed font-medium">
                  {selectedNotifModal.metadata?.task_details || selectedNotifModal.message}
                </p>
              </div>

              {/* Multi-item Breakdown inside Modal */}
              {(() => {
                const modalTaskItems = selectedNotifModal.metadata?.task_items || (selectedNotifModal.metadata as any)?.items || [];
                if (modalTaskItems.length > 0) {
                  return (
                    <div className="pt-2 border-t border-purple-100 space-y-1.5">
                      <span className="text-[11px] font-extrabold text-purple-700 uppercase tracking-wider block">
                        Task Items List ({modalTaskItems.length}):
                      </span>
                      <div className="space-y-1.5 max-h-40 overflow-y-auto">
                        {modalTaskItems.map((item: any, idx: number) => (
                          <div key={idx} className="flex items-center justify-between p-2 bg-white rounded-xl border border-purple-200 text-xs">
                            <span className="font-extrabold text-slate-900">{item.name}</span>
                            <span className="font-black text-purple-800 bg-purple-100 px-2.5 py-0.5 rounded-lg">
                              Quantity: {item.quantity} {item.unit || "pcs"}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                }
                return null;
              })()}
            </div>

            {/* Interactive Task Status Flow Action Buttons inside Modal */}
            {selectedNotifModal.metadata?.task_id && (
              <div className="space-y-2 pt-1">
                {(!selectedNotifModal.metadata?.status ||
                  selectedNotifModal.metadata.status === "Pending" ||
                  selectedNotifModal.metadata.status === "Assigned") && (
                  <Button
                    size="lg"
                    isLoading={isUpdatingStatus}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white font-extrabold shadow-md shadow-blue-500/20"
                    leftIcon={<Play className="h-4 w-4 fill-white" />}
                    onClick={() => handleUpdateTaskStatus(selectedNotifModal.metadata!.task_id!, "in_progress")}
                  >
                    Accept & Start Task
                  </Button>
                )}

                {selectedNotifModal.metadata?.status === "Accepted / In Progress" && (
                  <Button
                    size="lg"
                    isLoading={isUpdatingStatus}
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold shadow-md shadow-emerald-500/20"
                    leftIcon={<CheckCircle2 className="h-4 w-4" />}
                    onClick={() => handleUpdateTaskStatus(selectedNotifModal.metadata!.task_id!, "completed")}
                  >
                    Mark as Completed
                  </Button>
                )}

                {selectedNotifModal.metadata?.status === "Completed" && (
                  <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-center text-xs font-black text-emerald-800 flex items-center justify-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    <span>Task Completed 🎉</span>
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <Button variant="outline" size="sm" onClick={() => setSelectedNotifModal(null)}>
                Close
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
