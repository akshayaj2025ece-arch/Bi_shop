// ============================================
// BISHOP — TypeScript Type Definitions
// ============================================

import type { UserRole, OrderStatus, PaymentMethod } from "./constants";
export type { UserRole, OrderStatus, PaymentMethod };

/**
 * User profile stored in the `profiles` table.
 */
export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  phone?: string;
  avatar_url?: string;
  shop_id?: string;
  created_at: string;
  updated_at: string;
}

/**
 * Shop / business entity.
 */
export interface Shop {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  description?: string;
  logo_url?: string;
  address?: string;
  location?: string;
  latitude?: number;
  longitude?: number;
  phone?: string;
  email?: string;
  gst_number?: string;
  currency: string;
  tax_rate: number;
  is_active: boolean;
  upi_id?: string;
  payment_qr_url?: string;
  bank_details?: string;
  created_at: string;
  updated_at: string;
}

/**
 * Menu category.
 */
export interface Category {
  id: string;
  shop_id: string;
  name: string;
  description?: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

/**
 * Menu item / product.
 */
export interface MenuItem {
  id: string;
  shop_id: string;
  category_id: string;
  name: string;
  description?: string;
  price: number;
  quantity?: number;
  image_url?: string;
  is_available: boolean;
  is_veg: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

/**
 * Inventory item tracked in stock.
 */
export interface InventoryItem {
  id: string;
  shop_id: string;
  name: string;
  unit: string;
  quantity: number;
  min_quantity: number;
  cost_per_unit: number;
  supplier?: string;
  last_restocked?: string;
  created_at: string;
  updated_at: string;
}

/**
 * Customer order.
 */
export interface Order {
  id: string;
  shop_id: string;
  order_number: string;
  token_number?: string;
  customer_name?: string;
  customer_phone?: string;
  table_number?: string;
  status: OrderStatus;
  items: OrderItem[];
  subtotal: number;
  tax?: number;
  gst_amount?: number;
  total?: number;
  grand_total?: number;
  advance_amount?: number;
  remaining_amount?: number;
  is_pre_order?: boolean;
  payment_method?: PaymentMethod;
  payment_status: "pending" | "paid" | "refunded";
  notes?: string;
  created_at: string;
  updated_at: string;
}

/**
 * Individual item within an order.
 */
export interface OrderItem {
  id: string;
  order_id: string;
  menu_item_id?: string;
  product_id?: string;
  name?: string;
  product_name?: string;
  price?: number;
  unit_price?: number;
  quantity: number;
  total?: number;
  line_total?: number;
  notes?: string;
}

/**
 * Employee record.
 */
export interface Employee {
  id: string;
  shop_id: string;
  profile_id: string;
  role: string;
  salary?: number;
  joined_at: string;
  is_active: boolean;
  profile?: Profile;
}

export type TaskStatus = "assigned" | "accepted" | "in_progress" | "completed" | "pending";

/**
 * Detailed item entry for stock update tasks.
 */
export interface TaskItemDetail {
  inventory_id?: string;
  menu_item_id?: string;
  name: string;
  quantity: number;
  unit?: string;
  price?: number;
}

/**
 * Task assigned to an employee.
 */
export interface EmployeeTask {
  id: string;
  shop_id: string;
  employee_id: string;
  title: string;
  description?: string;
  due_date?: string;
  priority: "low" | "medium" | "high";
  status: TaskStatus;
  assigned_by?: string;
  items?: TaskItemDetail[];
  task_items?: TaskItemDetail[];
  created_at: string;
  updated_at?: string;
  employee?: Employee & { profile?: Profile };
  assigned_by_profile?: Profile;
}

/**
 * In-app notification for employee / shopkeeper.
 */
export interface AppNotification {
  id: string;
  shop_id: string;
  recipient_profile_id: string;
  employee_id?: string;
  task_id?: string;
  title: string;
  message: string;
  type: "task_assigned" | "task_updated" | "order_created";
  metadata?: {
    employee_name?: string;
    employee_mobile?: string;
    task_id?: string;
    task_title?: string;
    task_details?: string;
    task_items?: TaskItemDetail[];
    assigned_by_name?: string;
    shop_name?: string;
    date_time?: string;
    status?: TaskStatus | string;
    due_date?: string;
    priority?: string;
    order_number?: string;
    customer_name?: string;
    total?: number;
  };
  is_read: boolean;
  created_at: string;
  updated_at?: string;
}

/**
 * Auth state managed by zustand.
 */
export interface AuthState {
  user: Profile | null;
  shop: Shop | null;
  shops: Shop[];
  isAllShops: boolean;
  isLoading: boolean;
  setUser: (user: Profile | null) => void;
  setShop: (shop: Shop | null) => void;
  setShops: (shops: Shop[]) => void;
  setIsAllShops: (isAllShops: boolean) => void;
  setLoading: (loading: boolean) => void;
  reset: () => void;
}
