"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  ShoppingCart,
  CheckCircle2,
  WifiOff,
  Wifi,
  Languages,
  Utensils,
  User,
  Phone,
  Clock,
  Sparkles,
  ArrowRight,
  Plus,
  Camera,
  Loader2,
} from "lucide-react";
import type { Category, MenuItem, Shop } from "@/lib/types";
import { formatCurrency, getItemEmoji } from "@/lib/utils";
import { useLanguageStore } from "@/stores/language-store";
import { DASHBOARD_TRANSLATIONS } from "@/lib/translations";
import { captureBillScreenshot } from "@/lib/screenshot";

interface MenuCustomerPageProps {
  shop: Shop;
  categories: Category[];
  menuItems: MenuItem[];
}

interface CartItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  menu_item_id: string;
  notes?: string;
  is_veg: boolean;
}

interface PlacedOrderDetails {
  orderNumber: string;
  total: number;
  subtotal: number;
  tax: number;
  customerName: string;
  customerPhone: string;
  cartItems: CartItem[];
  createdAt: string;
}

const CART_STORAGE_KEY = "bishop_menu_cart";
const OFFLINE_ORDER_QUEUE_KEY = "bishop_offline_orders";

function buildMenuItem(item: MenuItem): CartItem {
  return {
    id: item.id,
    menu_item_id: item.id,
    name: item.name,
    price: item.price,
    quantity: 1,
    is_veg: Boolean(item.is_veg),
    notes: "",
  };
}

function createOrderNumber() {
  return `BISHOP-${Math.floor(Date.now() / 1000).toString().slice(-4)}-${Math.floor(Math.random() * 900 + 100)}`;
}

export default function MenuCustomerPage({ shop, categories, menuItems }: MenuCustomerPageProps) {
  const router = useRouter();
  const { lang, toggleLang } = useLanguageStore();
  const t = DASHBOARD_TRANSLATIONS[lang || "en"].customerMenuPage;

  const shopKey = shop?.id || shop?.slug || "default";

  const [localCategories, setLocalCategories] = useState<Category[]>(categories || []);
  const [localMenuItems, setLocalMenuItems] = useState<MenuItem[]>(menuItems || []);

  const [cart, setCart] = useState<CartItem[]>([]);
  const isHydratedRef = useRef(false);

  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [orderNotes, setOrderNotes] = useState("");

  const [isOnline, setIsOnline] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCapturingScreenshot, setIsCapturingScreenshot] = useState(false);
  const [placedOrder, setPlacedOrder] = useState<PlacedOrderDetails | null>(null);

  // Sync state if props change on navigation
  useEffect(() => {
    if (categories && categories.length > 0) {
      setLocalCategories(categories);
    }
    if (menuItems && menuItems.length > 0) {
      setLocalMenuItems(menuItems);
    }
  }, [categories, menuItems]);

  const fetchLatestData = useCallback(async () => {
    if (!shop?.id) return;
    try {
      const supabase = createClient();
      const [categoriesRes, itemsRes, inventoryRes] = await Promise.all([
        supabase
          .from("categories")
          .select("*")
          .eq("shop_id", shop.id)
          .eq("is_active", true)
          .order("sort_order", { ascending: true }),
        supabase
          .from("menu_items")
          .select("*")
          .eq("shop_id", shop.id)
          .order("sort_order", { ascending: true }),
        supabase
          .from("inventory")
          .select("*")
          .eq("shop_id", shop.id),
      ]);

      if (!categoriesRes.error && categoriesRes.data) {
        setLocalCategories(categoriesRes.data as Category[]);
      }

      if (!itemsRes.error && itemsRes.data) {
        const raw = itemsRes.data as MenuItem[];
        const invMap = new Map<string, number>();
        (inventoryRes.data || []).forEach((inv: any) => {
          if (inv.name) invMap.set(inv.name.trim().toLowerCase(), inv.quantity ?? 0);
        });

        const merged = raw.map((item) => {
          const key = item.name.trim().toLowerCase();
          const qty = invMap.has(key) ? invMap.get(key) : (item.quantity ?? 10);
          return {
            ...item,
            quantity: qty,
            is_available: (qty ?? 10) > 0 ? item.is_available : false,
          };
        });

        setLocalMenuItems(merged);
      }
    } catch (err) {
      console.error("Error syncing customer menu data:", err);
    }
  }, [shop?.id]);

  useEffect(() => {
    if (!shop?.id) return;
    const supabase = createClient();

    const channel = supabase
      .channel(`realtime-menu-customer-${shop.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "menu_items", filter: `shop_id=eq.${shop.id}` },
        () => {
          fetchLatestData();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "inventory", filter: `shop_id=eq.${shop.id}` },
        () => {
          fetchLatestData();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "categories", filter: `shop_id=eq.${shop.id}` },
        () => {
          fetchLatestData();
        }
      )
      .subscribe((status: string) => {
        if (status === "SUBSCRIBED") {
          fetchLatestData();
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [shop?.id, fetchLatestData]);

  // Group items by category and retain uncategorized items
  const groupedItems = useMemo(() => {
    const map = new Map<string, MenuItem[]>();
    localCategories.forEach((cat) => map.set(cat.id, []));
    const uncategorized: MenuItem[] = [];

    localMenuItems.forEach((item) => {
      const bucket = map.get(item.category_id);
      if (bucket) {
        bucket.push(item);
      } else {
        uncategorized.push(item);
      }
    });

    const groups = localCategories.map((category) => ({
      category,
      items: map.get(category.id) || [],
    }));

    if (uncategorized.length > 0) {
      groups.push({
        category: {
          id: "uncategorized",
          shop_id: shop?.id || "",
          name: t.categoryAll || "Special Selections",
          description: "Fresh items available today",
          sort_order: 9999,
          is_active: true,
          created_at: new Date().toISOString(),
        } as Category,
        items: uncategorized,
      });
    }

    return groups;
  }, [localCategories, localMenuItems, shop?.id, t.categoryAll]);

  const subtotal = useMemo(
    () => Number(cart.reduce((sum, item) => sum + item.price * item.quantity, 0).toFixed(2)),
    [cart]
  );

  const taxRate = shop?.tax_rate || 0;
  const tax = useMemo(() => Number((subtotal * (taxRate / 100)).toFixed(2)), [subtotal, taxRate]);
  const total = useMemo(() => Number((subtotal + tax).toFixed(2)), [subtotal, tax]);

  // Restore cart on mount safely
  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const storedCart = window.localStorage.getItem(`${CART_STORAGE_KEY}_${shopKey}`);
      if (storedCart) {
        setCart(JSON.parse(storedCart));
      }
    } catch {
      setCart([]);
    }
    isHydratedRef.current = true;

    const checkOnline = () => {
      setIsOnline(window.navigator.onLine);
    };

    checkOnline();
    window.addEventListener("online", checkOnline);
    window.addEventListener("offline", checkOnline);

    return () => {
      window.removeEventListener("online", checkOnline);
      window.removeEventListener("offline", checkOnline);
    };
  }, [shopKey]);

  // Save cart changes to localStorage after hydration
  useEffect(() => {
    if (typeof window === "undefined" || !isHydratedRef.current) return;
    try {
      window.localStorage.setItem(`${CART_STORAGE_KEY}_${shopKey}`, JSON.stringify(cart));
    } catch {
      // ignore storage quota errors
    }
  }, [cart, shopKey]);

  function addToCart(item: MenuItem) {
    const availQty = item.quantity ?? 10;
    if (availQty <= 0 || !item.is_available) {
      toast.error(`${item.name} is out of stock.`);
      return;
    }

    const existing = cart.find((entry) => entry.menu_item_id === item.id);
    if (existing && existing.quantity >= availQty) {
      toast.error(`Cannot add more. Only ${availQty} in stock.`);
      return;
    }

    setCart((prev) => {
      const ex = prev.find((entry) => entry.menu_item_id === item.id);
      if (ex) {
        if (ex.quantity >= availQty) return prev;
        return prev.map((entry) =>
          entry.menu_item_id === item.id
            ? { ...entry, quantity: entry.quantity + 1 }
            : entry
        );
      }

      return [...prev, { ...buildMenuItem(item) }];
    });
    toast.success(`${item.name} added to cart`);
  }

  function updateQuantity(itemId: string, value: number) {
    if (value < 1) {
      setCart((prev) => prev.filter((item) => item.menu_item_id !== itemId));
      return;
    }

    const menuItem = localMenuItems.find((m) => m.id === itemId);
    const availQty = menuItem?.quantity ?? 10;
    if (value > availQty) {
      toast.error(`Only ${availQty} available in stock.`);
      return;
    }

    setCart((prev) =>
      prev.map((item) =>
        item.menu_item_id === itemId ? { ...item, quantity: value } : item
      )
    );
  }

  function updateItemNote(itemId: string, noteText: string) {
    setCart((prev) =>
      prev.map((item) =>
        item.menu_item_id === itemId ? { ...item, notes: noteText } : item
      )
    );
  }

  function removeFromCart(itemId: string) {
    setCart((prev) => prev.filter((item) => item.menu_item_id !== itemId));
  }

  function handlePayNow() {
    if (!cart.length) {
      toast.error(t.emptyCart || "Add items to your cart first.");
      return;
    }

    if (!customerName.trim()) {
      toast.error(t.nameRequiredError || "Please enter your Name before proceeding.");
      const el = document.getElementById("customer-order-form");
      if (el) el.scrollIntoView({ behavior: "smooth" });
      return;
    }

    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(`bishop_checkout_${shop.id}`, JSON.stringify({
          cart,
          tableNumber: "Takeaway",
          customerName: customerName.trim(),
          customerPhone: customerPhone.trim(),
          orderNotes: orderNotes.trim(),
          subtotal,
          tax,
          total,
        }));
      } catch {
        // ignore storage error
      }

      router.push(`/pay/${shop.id}?amount=${total}&table=Takeaway`);
    }
  }

  async function submitOrder() {
    if (!cart.length) {
      toast.error(t.emptyCart || "Add items to your cart first.");
      return;
    }

    if (!customerName.trim()) {
      toast.error(t.nameRequiredError || "Please enter your Name before proceeding.");
      const el = document.getElementById("customer-order-form");
      if (el) el.scrollIntoView({ behavior: "smooth" });
      return;
    }

    setIsSubmitting(true);
    const orderNumber = createOrderNumber();
    const tokenNumber = `BSH-${Math.floor(Math.random() * 9000 + 1000)}`;
    const currentCart = [...cart];
    const supabase = createClient();

    try {
      // 1. Stock Pre-Validation: Ensure sufficient stock for all items
      const { data: invRecords, error: invErr } = await supabase
        .from("inventory")
        .select("*")
        .eq("shop_id", shop.id);

      if (invErr) {
        console.error("Inventory fetch pre-validation error:", invErr?.message);
      }

      const invMap = new Map<string, { id: string; quantity: number }>();
      (invRecords || []).forEach((inv: any) => {
        if (inv.name) {
          invMap.set(inv.name.trim().toLowerCase(), { id: inv.id, quantity: inv.quantity ?? 0 });
        }
      });

      for (const item of currentCart) {
        const key = item.name.trim().toLowerCase();
        if (invMap.has(key)) {
          const inv = invMap.get(key)!;
          if (inv.quantity < item.quantity) {
            toast.error(`Insufficient stock for "${item.name}". Available: ${inv.quantity}, Requested: ${item.quantity}`);
            setIsSubmitting(false);
            return;
          }
        }
      }

      const numericToken = Number(tokenNumber.replace(/\D/g, "")) || Math.floor(10000 + Math.random() * 90000);
      const generatedOrderId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `ord_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

      const orderPayload = {
        id: generatedOrderId,
        shop_id: shop.id,
        order_number: orderNumber,
        token_number: numericToken,
        customer_name: customerName.trim(),
        customer_phone: customerPhone.trim() || null,
        table_number: "Takeaway",
        status: "pending",
        subtotal,
        tax,
        gst_amount: tax,
        total,
        grand_total: total,
        payment_method: "cash",
        payment_status: "pending",
        notes: orderNotes.trim() || "Takeaway Cash Order",
      };

      const orderItems = currentCart.map((item) => ({
        menu_item_id: item.menu_item_id,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
        total: Number((item.price * item.quantity).toFixed(2)),
        notes: item.notes?.trim() || null,
      }));

      // Offline order handling
      if (!isOnline) {
        const existingQueue = window.localStorage.getItem(`${OFFLINE_ORDER_QUEUE_KEY}_${shopKey}`);
        const queued = existingQueue ? JSON.parse(existingQueue) : [];
        queued.push({ order: orderPayload, items: orderItems });
        window.localStorage.setItem(`${OFFLINE_ORDER_QUEUE_KEY}_${shopKey}`, JSON.stringify(queued));

        setPlacedOrder({
          orderNumber: tokenNumber,
          total,
          subtotal,
          tax,
          customerName: customerName.trim(),
          customerPhone: customerPhone.trim(),
          cartItems: currentCart,
          createdAt: new Date().toLocaleString(),
        });
        setCart([]);
        toast.success("Order saved offline! It will sync when you re-connect.");
        return;
      }

      let finalTokenNumber = `BSH-${numericToken}`;
      let orderProcessed = false;

      // Primary Attempt: Submit via Server API Route
      try {
        const apiRes = await fetch("/api/orders/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            shopId: shop.id,
            customerName: customerName.trim(),
            customerPhone: customerPhone.trim() || null,
            orderNotes: orderNotes.trim() || "Takeaway Cash Order",
            cart: currentCart,
            subtotal,
            tax,
            total,
          }),
        });

        const apiData = await apiRes.json();
        if (apiRes.ok && apiData.success) {
          orderProcessed = true;
          if (apiData.tokenNumber) {
            finalTokenNumber = apiData.tokenNumber;
          }
        } else if (apiRes.status >= 400 && apiRes.status < 500) {
          const errorMsg = apiData.error || "Order validation failed. Please check your items.";
          toast.error(errorMsg);
          setIsSubmitting(false);
          return;
        } else {
          console.warn("API /api/orders/submit returned server error, falling back to secure RPC:", apiData);
        }
      } catch (apiErr: any) {
        console.warn("API submit endpoint fetch error:", apiErr?.message);
      }

      // Fallback Attempt: Direct Supabase Client Insertion if API route unhandled
      if (!orderProcessed) {
        let createdOrderId: string | null = null;

        // Try RPC first if available
        const { data: rpcData, error: rpcError } = await supabase.rpc("submit_customer_order", {
          p_shop_id: shop.id,
          p_table_number: "Takeaway",
          p_customer_name: customerName.trim(),
          p_customer_phone: customerPhone.trim() || null,
          p_payment_method: "cash",
          p_notes: orderNotes.trim() || "Takeaway Cash Order",
          p_items: orderItems,
        });

        if (!rpcError && rpcData && (rpcData as any).order_id) {
          createdOrderId = (rpcData as any).order_id;
          if ((rpcData as any).token_number) finalTokenNumber = `BSH-${(rpcData as any).token_number}`;
          orderProcessed = true;
        } else {
          // Direct insertion fallback with schema-aligned payload
          const { error: orderErr } = await supabase
            .from("orders")
            .insert(orderPayload);

          if (orderErr) {
            console.error("Orders direct insert Error:", orderErr?.message);
            throw orderErr;
          }

          createdOrderId = generatedOrderId;

          try {
            // Insert order items
            const itemInserts = currentCart.map((item) => ({
              order_id: createdOrderId,
              product_id: item.menu_item_id,
              product_name: item.name,
              unit_price: item.price,
              quantity: item.quantity,
              line_total: Number((item.price * item.quantity).toFixed(2)),
              notes: item.notes?.trim() || null,
            }));

            const { error: itemsErr } = await supabase.from("order_items").insert(itemInserts);
            if (itemsErr) {
              console.error("Order items direct insert Error:", itemsErr?.message);
              throw itemsErr;
            }

            // Deduct stock after successful order creation
            for (const item of currentCart) {
              const key = item.name.trim().toLowerCase();
              if (invMap.has(key)) {
                const inv = invMap.get(key)!;
                const newQty = Math.max(0, inv.quantity - item.quantity);

                await supabase
                  .from("inventory")
                  .update({ quantity: newQty, updated_at: new Date().toISOString() })
                  .eq("id", inv.id);

                if (newQty === 0) {
                  await supabase
                    .from("menu_items")
                    .update({ is_available: false, updated_at: new Date().toISOString() })
                    .eq("id", item.menu_item_id);
                }
              }
            }

            orderProcessed = true;
          } catch (itemOrStockErr) {
            if (createdOrderId) {
              await supabase.from("order_items").delete().eq("order_id", createdOrderId);
              await supabase.from("orders").delete().eq("id", createdOrderId);
            }
            throw itemOrStockErr;
          }
        }
      }

      setPlacedOrder({
        orderNumber: finalTokenNumber,
        total,
        subtotal,
        tax,
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim(),
        cartItems: currentCart,
        createdAt: new Date().toLocaleString(),
      });

      setCart([]);
      if (typeof window !== "undefined") {
        try {
          window.localStorage.removeItem(`bishop_checkout_${shop.id}`);
        } catch {
          // ignore
        }
      }

      toast.success(`Cash order confirmed! Token ID: ${finalTokenNumber}`);
    } catch (error: any) {
      console.error("Submit order failed:", error?.message);
      toast.error(error?.message || "Unable to place order. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  // Placed Cash Order Digital Bill View
  if (placedOrder) {
    const halfTaxRate = ((taxRate || 0) / 2).toFixed(1);
    const halfTaxAmount = Number((((placedOrder.tax || 0) / 2)).toFixed(2));
    const payT = DASHBOARD_TRANSLATIONS[lang || "en"].customerPaymentPage;

    async function handleTakeScreenshot() {
      if (isCapturingScreenshot) return;
      setIsCapturingScreenshot(true);
      try {
        await captureBillScreenshot(
          "thermal-receipt",
          `BISHOP_Bill_${placedOrder?.orderNumber || "Receipt"}.png`
        );
        toast.success("Screenshot saved successfully!");
      } catch (err: any) {
        console.error("[Screenshot] Screenshot error:", err?.message || String(err));
        toast.error("Failed to capture screenshot: " + (err?.message || "Unknown error"));
      } finally {
        setIsCapturingScreenshot(false);
      }
    }

    return (
      <div className="min-h-dvh bg-slate-100 flex items-center justify-center p-4 py-8">
        <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden print:border-none print:shadow-none print:w-full print:max-w-none">
          
          {/* Top Confirmed Banner */}
          <div className="bg-emerald-600 text-white p-4 text-center print:hidden flex items-center justify-center gap-2">
            <CheckCircle2 className="h-6 w-6" />
            <span className="font-extrabold text-base uppercase tracking-wider">{t.orderPlacedTitle || "Order Confirmed!"}</span>
          </div>

          {/* Thermal Receipt Content Container */}
          <div id="thermal-receipt" className="p-6 font-mono text-xs text-slate-800 space-y-4 bg-white select-text">
            
            {/* Header: Shop Name & Info */}
            <div className="text-center space-y-1">
              <h1 className="text-xl font-black uppercase tracking-tight text-slate-900">{shop.name}</h1>
              {shop.address && <p className="text-[11px] text-slate-600 leading-tight">{shop.address}</p>}
              {shop.phone && <p className="text-[11px] text-slate-600">Ph: {shop.phone}</p>}
              {shop.gst_number && (
                <p className="text-[11px] font-bold text-slate-700 pt-0.5">{payT.gstin}: {shop.gst_number}</p>
              )}
            </div>

            {/* Divider */}
            <div className="border-b-2 border-dashed border-slate-300 my-2" />

            {/* Bill Meta Details */}
            <div className="space-y-1 text-[11px]">
              <div className="flex justify-between">
                <span className="text-slate-500">{payT.billNumber}:</span>
                <span className="font-bold text-slate-900">{placedOrder.orderNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">{payT.date}:</span>
                <span>{placedOrder.createdAt}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">{payT.customerName}:</span>
                <span className="font-bold text-slate-900">{placedOrder.customerName}</span>
              </div>
              {placedOrder.customerPhone && (
                <div className="flex justify-between">
                  <span className="text-slate-500">{payT.phone}:</span>
                  <span>{placedOrder.customerPhone}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-slate-500">{payT.table}:</span>
                <span className="font-bold text-slate-800 uppercase">Takeaway / Parcel</span>
              </div>
            </div>

            {/* Divider */}
            <div className="border-b-2 border-dashed border-slate-300 my-2" />

            {/* Itemized Table */}
            <div className="space-y-2">
              <div className="grid grid-cols-12 font-bold text-[10px] uppercase text-slate-600 border-b border-slate-200 pb-1">
                <span className="col-span-1">#</span>
                <span className="col-span-5">{payT.item}</span>
                <span className="col-span-2 text-center">{payT.qty}</span>
                <span className="col-span-2 text-right">{payT.price}</span>
                <span className="col-span-2 text-right">Total</span>
              </div>

              {(placedOrder.cartItems || []).map((item, idx) => (
                <div key={idx} className="grid grid-cols-12 text-[11px] items-start py-0.5">
                  <span className="col-span-1 text-slate-400">{idx + 1}</span>
                  <span className="col-span-5 font-semibold text-slate-900 break-words flex items-center gap-1">
                    {getItemEmoji(item.name) && (
                      <span className="text-xs leading-none shrink-0" aria-hidden="true">
                        {getItemEmoji(item.name)}
                      </span>
                    )}
                    <span>{item.name}</span>
                  </span>
                  <span className="col-span-2 text-center font-bold">{item.quantity}</span>
                  <span className="col-span-2 text-right text-slate-600">{formatCurrency(item.price)}</span>
                  <span className="col-span-2 text-right font-bold text-slate-900">
                    {formatCurrency(item.price * item.quantity)}
                  </span>
                </div>
              ))}
            </div>

            {/* Divider */}
            <div className="border-b-2 border-dashed border-slate-300 my-2" />

            {/* Calculations Breakdown */}
            <div className="space-y-1 text-xs">
              <div className="flex justify-between text-slate-600">
                <span>{payT.subtotal}</span>
                <span>{formatCurrency(placedOrder.subtotal || 0)}</span>
              </div>

              {taxRate > 0 && (
                <>
                  <div className="flex justify-between text-slate-500 text-[11px]">
                    <span>{payT.cgst} ({halfTaxRate}%)</span>
                    <span>{formatCurrency(halfTaxAmount)}</span>
                  </div>
                  <div className="flex justify-between text-slate-500 text-[11px]">
                    <span>{payT.sgst} ({halfTaxRate}%)</span>
                    <span>{formatCurrency(halfTaxAmount)}</span>
                  </div>
                </>
              )}

              {/* Grand Total Divider */}
              <div className="border-b-2 border-slate-900 my-2" />

              <div className="flex justify-between font-black text-sm text-slate-900">
                <span>{payT.totalAmount}</span>
                <span>{formatCurrency(placedOrder.total || 0)}</span>
              </div>
            </div>

            {/* Divider */}
            <div className="border-b-2 border-dashed border-slate-300 my-2" />

            {/* Payment Mode & Status: CONFIRMED */}
            <div className="space-y-1.5 text-center">
              <p className="text-[11px] text-slate-600">
                Payment Method: <strong className="uppercase text-slate-900">CASH (Pay at Counter)</strong>
              </p>
              <div className="inline-block px-3 py-1 bg-emerald-50 border border-emerald-300 rounded-lg text-emerald-900 font-extrabold text-[11px] uppercase tracking-wider">
                ORDER STATUS: CONFIRMED
              </div>
            </div>

            {/* Divider */}
            <div className="border-b-2 border-dashed border-slate-300 my-2" />

            {/* Footer Message */}
            <div className="text-center text-[10px] text-slate-500 space-y-1 pt-1">
              <p className="font-semibold text-slate-700">{payT.thankYouMessage}</p>
              <div className="flex items-center justify-center gap-1.5">
                <Image
                  src="/bishop-icon.svg"
                  alt="BISHOP"
                  width={14}
                  height={14}
                  className="h-3.5 w-3.5 object-contain"
                  unoptimized
                />
                <p className="text-[9px]">Powered by BISHOP POS</p>
              </div>
            </div>

          </div>

          {/* Action Buttons */}
          <div className="p-4 bg-slate-50 border-t border-slate-200 space-y-2.5 print:hidden">
            <Button
              size="lg"
              className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold"
              onClick={handleTakeScreenshot}
              disabled={isCapturingScreenshot}
              leftIcon={isCapturingScreenshot ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
            >
              {isCapturingScreenshot ? "Capturing..." : (payT.takeScreenshot || "Take Screenshot")}
            </Button>

            <Button
              size="md"
              variant="outline"
              className="w-full border-slate-300 text-slate-700"
              onClick={() => setPlacedOrder(null)}
            >
              {t.placeAnother}
            </Button>
          </div>

        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-slate-50 py-6 sm:py-10 pb-28 lg:pb-10">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        {/* Shop Header */}
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
          <div>
            <div className="flex items-center gap-2">
              <Image
                src="/bishop-icon.svg"
                alt="BISHOP"
                width={16}
                height={16}
                className="h-4 w-4 object-contain shrink-0"
              />
              <p className="text-xs uppercase tracking-widest font-bold text-mint-700">{shop.name}</p>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 mt-1">{t.menu}</h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-1">{t.subheading}</p>
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={toggleLang}
              className="border-slate-200 text-slate-700"
              leftIcon={<Languages className="h-4 w-4 text-mint-600" />}
            >
              {lang === "en" ? "தமிழ்" : "English"}
            </Button>
            <div className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
              {isOnline ? <Wifi className="h-3.5 w-3.5 text-emerald-600" /> : <WifiOff className="h-3.5 w-3.5 text-amber-600" />}
              {isOnline ? t.online : t.offline}
            </div>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.4fr_0.9fr]">
          {/* Menu Sections */}
          <div className="space-y-6">
            {groupedItems.map(({ category, items }) => (
              <div key={category.id} className="rounded-3xl bg-white p-6 shadow-sm border border-slate-200">
                <div className="mb-5 flex items-center justify-between gap-4 border-b border-slate-100 pb-3">
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">{category.name}</h2>
                    {category.description && (
                      <p className="text-xs text-slate-500 mt-0.5">{category.description}</p>
                    )}
                  </div>
                  <Badge variant="mint">{items.length} items</Badge>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  {items.length ? (
                    items.map((item) => {
                      const availQty = item.quantity ?? 10;
                      const isItemAvailable = availQty > 0 && item.is_available;

                      return (
                        <div
                          key={item.id}
                          className={`rounded-2xl border p-4 transition-colors flex flex-col justify-between ${
                            isItemAvailable
                              ? "border-slate-100 bg-slate-50 hover:border-mint-200"
                              : "border-red-100 bg-red-50/20 opacity-80"
                          }`}
                        >
                          <div>
                            <div className="flex items-start justify-between gap-2">
                              <h3 className="text-base font-semibold text-slate-900 flex items-center gap-1.5">
                                {getItemEmoji(item.name, category.name) && (
                                  <span className="text-base leading-none shrink-0" aria-hidden="true">
                                    {getItemEmoji(item.name, category.name)}
                                  </span>
                                )}
                                <span>{item.name}</span>
                              </h3>
                              <div className="flex items-center gap-1.5 flex-wrap justify-end">
                                <Badge variant={item.is_veg ? "success" : "danger"} size="sm">
                                  {item.is_veg ? t.veg : t.nonVeg}
                                </Badge>
                                <Badge variant={isItemAvailable ? "mint" : "danger"} size="sm">
                                  {isItemAvailable ? `Stock: ${availQty}` : (t.outOfStock || "Out of Stock")}
                                </Badge>
                              </div>
                            </div>
                            <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                              {item.description || "Fresh & delicious selection."}
                            </p>
                          </div>
                          <div className="mt-4 flex items-center justify-between pt-2 border-t border-slate-200/50">
                            <span className="text-base font-extrabold text-slate-900">
                              {formatCurrency(item.price)}
                            </span>
                            <Button
                              size="sm"
                              onClick={() => addToCart(item)}
                              disabled={!isItemAvailable}
                              variant={isItemAvailable ? "primary" : "secondary"}
                              leftIcon={<Plus className="h-3.5 w-3.5" />}
                            >
                              {isItemAvailable ? t.add : (t.outOfStock || "Out of Stock")}
                            </Button>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <p className="text-xs text-slate-400 py-4 col-span-2">No active items in this category.</p>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Cart & Customer Details Sidebar */}
          <aside className="space-y-6">
            <Card padding="md" className="rounded-3xl shadow-sm border-slate-200">
              <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">{t.cartTitle}</h2>
                  <p className="text-xs text-slate-400">{cart.reduce((s, i) => s + i.quantity, 0)} item(s)</p>
                </div>
                <div className="h-10 w-10 rounded-2xl bg-mint-50 flex items-center justify-center text-mint-600">
                  <ShoppingCart className="h-5 w-5" />
                </div>
              </div>

              {cart.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-2xl my-4">
                  {t.emptyCart}
                </div>
              ) : (
                <div className="space-y-3 my-4">
                  {cart.map((item) => (
                    <div key={item.menu_item_id} className="rounded-2xl border border-slate-100 bg-slate-50 p-3 text-sm space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-900 flex items-center gap-1.5">
                          {getItemEmoji(item.name) && (
                            <span className="text-sm leading-none shrink-0" aria-hidden="true">
                              {getItemEmoji(item.name)}
                            </span>
                          )}
                          <span>{item.name}</span>
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => updateQuantity(item.menu_item_id, item.quantity - 1)}
                            className="h-8 w-8 rounded-xl bg-white border border-slate-200 text-slate-700 font-bold hover:bg-slate-100 active:scale-95 flex items-center justify-center text-sm shadow-sm touch-manipulation"
                          >
                            -
                          </button>
                          <span className="w-6 text-center font-bold text-slate-900 text-sm">{item.quantity}</span>
                          <button
                            type="button"
                            onClick={() => updateQuantity(item.menu_item_id, item.quantity + 1)}
                            className="h-8 w-8 rounded-xl bg-white border border-slate-200 text-slate-700 font-bold hover:bg-slate-100 active:scale-95 flex items-center justify-center text-sm shadow-sm touch-manipulation"
                          >
                            +
                          </button>
                        </div>
                      </div>
                      <input
                        type="text"
                        placeholder={t.itemNote}
                        value={item.notes || ""}
                        onChange={(e) => updateItemNote(item.menu_item_id, e.target.value)}
                        className="w-full text-xs px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-slate-700 placeholder-slate-400 focus:outline-none focus:border-mint-500"
                      />
                      <div className="flex justify-between items-center text-xs text-slate-500 pt-1">
                        <span className="font-semibold text-slate-700">{formatCurrency(item.price * item.quantity)}</span>
                        <button
                          type="button"
                          onClick={() => removeFromCart(item.menu_item_id)}
                          className="text-red-500 font-medium hover:underline text-xs p-1"
                        >
                          {t.remove}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Customer Contact & Parcel Order Form */}
              <div id="customer-order-form" className="space-y-3 pt-3 border-t border-slate-100">
                <h3 className="text-xs uppercase tracking-wider font-bold text-slate-500">{t.customerDetails}</h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Input
                    label={t.customerNameLabel}
                    placeholder={t.customerNamePlaceholder}
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    required
                  />
                  <Input
                    label={t.customerPhoneLabel}
                    placeholder={t.customerPhonePlaceholder}
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                  />
                </div>

                <Textarea
                  label={t.orderNotesLabel}
                  placeholder={t.orderNotesPlaceholder}
                  value={orderNotes}
                  onChange={(e) => setOrderNotes(e.target.value)}
                  className="text-xs"
                />
              </div>

              {/* Calculation Summary */}
              <div className="mt-4 rounded-2xl bg-slate-50 p-3 space-y-1.5 text-xs text-slate-600">
                <div className="flex justify-between">
                  <span>{t.subtotal}</span>
                  <span>{formatCurrency(subtotal)}</span>
                </div>
                {taxRate > 0 && (
                  <div className="flex justify-between">
                    <span>{t.tax} ({taxRate}%)</span>
                    <span>{formatCurrency(tax)}</span>
                  </div>
                )}
                <div className="flex justify-between border-t border-slate-200 pt-2 font-extrabold text-sm text-slate-900">
                  <span>{t.total}</span>
                  <span>{formatCurrency(total)}</span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="mt-4 space-y-2">
                <Button
                  onClick={handlePayNow}
                  className="w-full bg-gradient-to-r from-mint-600 to-emerald-600 hover:from-mint-700 hover:to-emerald-700 text-white font-extrabold shadow-lg shadow-mint-500/20 py-3 touch-manipulation"
                  size="lg"
                  rightIcon={<ArrowRight className="h-4 w-4" />}
                >
                  PAY NOW {total > 0 ? `(${formatCurrency(total)})` : ""}
                </Button>

                <Button
                  onClick={submitOrder}
                  disabled={isSubmitting || cart.length === 0}
                  variant="outline"
                  className="w-full border-slate-300 text-slate-800 font-extrabold touch-manipulation hover:bg-slate-50"
                  size="md"
                >
                  {isSubmitting ? t.placingOrder : (t.confirmCashOrder || t.placeOrder || "CONFIRM CASH ORDER")}
                </Button>
              </div>
            </Card>
          </aside>
        </div>
      </div>

      {/* Sticky Mobile Bottom Bar */}
      <div className="fixed bottom-0 left-0 right-0 p-3 sm:p-4 pb-safe bg-white/95 backdrop-blur-md border-t border-slate-200 shadow-2xl lg:hidden z-50 flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
            Total ({cart.reduce((s, i) => s + i.quantity, 0)} items)
          </p>
          <p className="text-xl font-black text-slate-900">{formatCurrency(total)}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => {
              const el = document.getElementById("customer-order-form");
              if (el) el.scrollIntoView({ behavior: "smooth" });
            }}
            variant="outline"
            size="sm"
            className="text-xs border-slate-200 font-bold"
          >
            {t.viewCart}
          </Button>
          <Button
            onClick={handlePayNow}
            size="md"
            className="bg-gradient-to-r from-mint-600 to-emerald-600 text-white font-extrabold px-4 shadow-lg shadow-mint-500/20 touch-manipulation"
            rightIcon={<ArrowRight className="h-4 w-4" />}
          >
            PAY NOW
          </Button>
        </div>
      </div>
    </div>
  );
}
