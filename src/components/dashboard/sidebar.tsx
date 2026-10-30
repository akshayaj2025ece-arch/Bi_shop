"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { useAuthStore } from "@/stores/auth-store";
import type { Shop } from "@/lib/types";
import {
  LayoutDashboard,
  ShoppingBag,
  UtensilsCrossed,
  Package,
  Users,
  ClipboardList,
  BarChart3,
  Settings,
  X,
  ChevronLeft,
  ChevronDown,
  Check,
  Plus,
  Store,
  Building2,
} from "lucide-react";
import { useLanguageStore } from "@/stores/language-store";
import { DASHBOARD_TRANSLATIONS } from "@/lib/translations";

const navItems = [
  { label: "Dashboard", key: "dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Orders", key: "orders", href: "/dashboard/orders", icon: ShoppingBag },
  { label: "Menu", key: "menu", href: "/dashboard/menu", icon: UtensilsCrossed },
  { label: "Inventory", key: "inventory", href: "/dashboard/inventory", icon: Package },
  { label: "Employees", key: "employees", href: "/dashboard/employees", icon: Users },
  { label: "Tasks", key: "tasks", href: "/dashboard/tasks", icon: ClipboardList },
  { label: "Analytics", key: "analytics", href: "/dashboard/analytics", icon: BarChart3 },
  { label: "Settings", key: "settings", href: "/dashboard/settings", icon: Settings },
];

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

export function Sidebar({
  isOpen,
  onClose,
  isCollapsed,
  onToggleCollapse,
}: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, shop, shops, isAllShops, setShop, setIsAllShops } = useAuthStore();
  const { lang } = useLanguageStore();
  const t = DASHBOARD_TRANSLATIONS[lang || "en"];

  const isShopkeeper = user?.role === "shopkeeper" || (user?.role !== "employee" && (shops?.length || 0) > 0);
  const isMultiShop = isShopkeeper && (shops?.length || 0) > 1;

  const [showShopDropdown, setShowShopDropdown] = useState(false);
  const shopDropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        shopDropdownRef.current &&
        !shopDropdownRef.current.contains(e.target as Node)
      ) {
        setShowShopDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Hide sidebar when in "All Shops" mode.
  // When an individual shop is selected (!isAllShops), always display the sidebar.
  if (isMultiShop && isAllShops) {
    return null;
  }

  function handleSelectShop(selectedShop: Shop) {
    const validShop = shops.find((s) => s.id === selectedShop.id);
    if (!validShop) return;

    setShop(validShop);
    setIsAllShops(false);
    if (typeof window !== "undefined") {
      try {
        const userStorageKey = user?.id ? `bishop_active_shop_id_${user.id}` : "bishop_active_shop_id";
        localStorage.setItem(userStorageKey, validShop.id);
        localStorage.setItem("bishop_active_shop_id", validShop.id);
      } catch {}
    }
    setShowShopDropdown(false);
  }

  function handleSelectAllShops() {
    setIsAllShops(true);
    if (typeof window !== "undefined") {
      try {
        const userStorageKey = user?.id ? `bishop_active_shop_id_${user.id}` : "bishop_active_shop_id";
        localStorage.setItem(userStorageKey, "all");
        localStorage.setItem("bishop_active_shop_id", "all");
      } catch {}
    }
    setShowShopDropdown(false);
    router.push("/dashboard");
  }

  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Logo & Shop Header */}
      <div
        ref={shopDropdownRef}
        className={cn(
          "relative flex items-center h-16 px-4 border-b border-slate-100",
          isCollapsed ? "justify-center" : "gap-2.5"
        )}
      >
        <Link href="/dashboard" className="shrink-0 flex items-center" title="BISHOP Dashboard">
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
                className="h-9 w-auto object-contain shrink-0"
                priority
              />
            </motion.div>
          </div>
        </Link>

        {!isCollapsed && (
          isShopkeeper && (shops?.length || 0) >= 1 ? (
            <button
              type="button"
              onClick={() => setShowShopDropdown((prev) => !prev)}
              className="flex-1 min-w-0 flex items-center justify-between text-left group p-1 -m-1 rounded-xl hover:bg-slate-50 transition-colors"
              title="Click to switch shop or add shop"
              aria-label="Switch shop"
            >
              <div className="flex-1 min-w-0 flex flex-col justify-center">
                <p
                  className="text-lg font-black tracking-tight text-emerald-500 truncate leading-tight group-hover:text-emerald-400 transition-colors"
                  style={{ fontFamily: "'Arial Black', sans-serif" }}
                >
                  {isAllShops ? "All Shops" : (shop?.name || "BISHOP")}
                </p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(34,197,164,0.8)] animate-pulse" />
                  <p className="text-[11px] font-extrabold text-emerald-600 truncate uppercase tracking-widest leading-none">
                    {user?.role === "employee" ? "EMPLOYEE" : t.common.shopkeeper}
                  </p>
                </div>
              </div>
              <ChevronDown
                className={cn(
                  "h-4 w-4 text-slate-400 shrink-0 transition-transform duration-200 group-hover:text-emerald-500",
                  showShopDropdown && "rotate-180"
                )}
              />
            </button>
          ) : (
            <Link href="/dashboard" className="flex-1 min-w-0 flex flex-col justify-center group">
              <p
                className="text-lg font-black tracking-tight text-emerald-500 truncate leading-tight group-hover:text-emerald-400 transition-colors"
                style={{ fontFamily: "'Arial Black', sans-serif" }}
              >
                {shop?.name || "BISHOP"}
              </p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(34,197,164,0.8)] animate-pulse" />
                <p className="text-[11px] font-extrabold text-emerald-600 truncate uppercase tracking-widest leading-none">
                  {user?.role === "employee" ? "EMPLOYEE" : t.common.shopkeeper}
                </p>
              </div>
            </Link>
          )
        )}

        {/* Mobile close */}
        <button
          onClick={onClose}
          className="lg:hidden p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors ml-auto"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Multi-Shop Dropdown Menu */}
        {showShopDropdown && !isCollapsed && isShopkeeper && (shops?.length || 0) >= 1 && (
          <div className="absolute left-2 right-2 top-16 bg-white rounded-2xl border border-slate-200 shadow-2xl p-2 z-50 animate-in fade-in-50 zoom-in-95 duration-150">
            <div className="px-3 py-1.5 border-b border-slate-100 mb-1">
              <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                Switch Shop
              </p>
            </div>
            <div className="max-h-56 overflow-y-auto space-y-1 pr-0.5">
              {/* All Shops Option (multi-shop only) */}
              {shops.length > 1 && (
                <button
                  type="button"
                  onClick={handleSelectAllShops}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-xs font-semibold transition-colors ${
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
                    className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-xs font-semibold transition-colors ${
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
              onClick={() => {
                setShowShopDropdown(false);
                onClose();
              }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold text-mint-700 hover:bg-mint-50/80 transition-colors"
            >
              <Plus className="h-4 w-4 text-mint-600 shrink-0" />
              <span>+ Add Shop</span>
            </Link>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href !== "/dashboard" && pathname.startsWith(item.href));
          
          const label = t.nav[item.key as keyof typeof t.nav] || item.label;

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onClose}
              className={cn(
                "group flex items-center gap-3.5 px-3 py-3 rounded-2xl text-[16px] font-bold tracking-wide transition-all duration-300",
                isCollapsed && "justify-center px-2",
                isActive
                  ? "bg-gradient-to-r from-mint-500 to-mint-400 text-white shadow-lg shadow-mint-500/40 scale-[1.02]"
                  : "text-slate-700 hover:text-mint-700 hover:bg-mint-50/80 hover:scale-[1.02]"
              )}
              title={isCollapsed ? label : undefined}
            >
              <item.icon
                className={cn(
                  "h-[22px] w-[22px] shrink-0 transition-transform duration-300",
                  isActive ? "text-white scale-110 drop-shadow-md" : "text-slate-500 group-hover:text-mint-600 group-hover:scale-105"
                )}
                strokeWidth={2.5}
              />
              {!isCollapsed && <span>{label}</span>}
              {isActive && !isCollapsed && (
                <motion.div
                  layoutId="sidebar-indicator"
                  className="ml-auto h-2 w-2 rounded-full bg-white shadow-sm"
                  transition={{ type: "spring", stiffness: 300, damping: 25 }}
                />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Collapse Toggle (Desktop only) */}
      <div className="hidden lg:block border-t border-slate-100 p-3">
        <button
          onClick={onToggleCollapse}
          className="flex items-center justify-center w-full gap-2 px-3 py-2 rounded-xl text-xs text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-colors"
        >
          <ChevronLeft
            className={cn(
              "h-4 w-4 transition-transform duration-300",
              isCollapsed && "rotate-180"
            )}
          />
          {!isCollapsed && <span>{t.common.collapse}</span>}
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <aside
        className={cn(
          "hidden lg:flex flex-col bg-white border-r border-slate-100 h-dvh sticky top-0 transition-all duration-300",
          isCollapsed ? "w-[72px]" : "w-[250px]"
        )}
      >
        {sidebarContent}
      </aside>

      {/* Mobile Sidebar Overlay */}
      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 lg:hidden"
              onClick={onClose}
            />
            <motion.aside
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="fixed left-0 top-0 bottom-0 w-[250px] bg-white border-r border-slate-100 z-50 lg:hidden"
            >
              {sidebarContent}
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
