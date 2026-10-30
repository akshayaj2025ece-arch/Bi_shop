"use client";

import { useState } from "react";
import { Sidebar } from "@/components/dashboard/sidebar";
import { TopBar } from "@/components/dashboard/top-bar";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";

interface DashboardShellProps {
  children: React.ReactNode;
}

/**
 * The main dashboard shell that wraps all dashboard pages.
 * Provides the sidebar, top bar, and responsive content area.
 * For multi-shop owners, the sidebar is hidden when in "All Shops" mode to maximize workspace width,
 * but displays the dedicated shop sidebar whenever an individual shop is selected.
 */
export function DashboardShell({ children }: DashboardShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const { user, shops, isAllShops, isLoading } = useAuthStore();

  const isShopkeeper =
    user?.role === "shopkeeper" || (user?.role !== "employee" && (shops?.length || 0) > 0);
  const isMultiShop = isShopkeeper && (shops?.length || 0) > 1;
  const showSidebar = !isLoading && !!user && (!isMultiShop || !isAllShops);

  return (
    <div className="flex min-h-dvh bg-slate-50">
      {showSidebar && (
        <Sidebar
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          isCollapsed={isCollapsed}
          onToggleCollapse={() => setIsCollapsed(!isCollapsed)}
        />
      )}

      <div
        className={cn(
          "flex-1 flex flex-col min-w-0 transition-all duration-300"
        )}
      >
        <TopBar onMenuClick={() => setSidebarOpen(true)} />
        <main className="flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
