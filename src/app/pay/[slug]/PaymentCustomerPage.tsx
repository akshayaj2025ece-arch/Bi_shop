"use client";

import { useEffect, useState, useMemo } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import {
  Copy,
  CheckCircle2,
  AlertCircle,
  ArrowLeft,
  CreditCard,
  Banknote,
  Smartphone,
  ShieldCheck,
  Building2,
  QrCode,
  Languages,
  Clock,
  Camera,
  Loader2,
} from "lucide-react";
import type { Shop } from "@/lib/types";
import { formatCurrency, getShopPaymentQr, getShopUpiId, getShopBankDetails, getItemEmoji } from "@/lib/utils";
import { useLanguageStore } from "@/stores/language-store";
import { DASHBOARD_TRANSLATIONS } from "@/lib/translations";
import { captureBillScreenshot } from "@/lib/screenshot";

interface PaymentCustomerPageProps {
  shop: Shop;
  initialAmount: number;
  initialTable: string;
}

interface DraftCartItem {
  menu_item_id: string;
  name: string;
  price: number;
  quantity: number;
  notes?: string;
}

declare global {
  interface Window {
    Razorpay?: any;
  }
}

export default function PaymentCustomerPage({
  shop,
  initialAmount,
  initialTable,
}: PaymentCustomerPageProps) {
  const { lang, toggleLang } = useLanguageStore();
  const t = DASHBOARD_TRANSLATIONS[lang || "en"].customerPaymentPage;
  const menuT = DASHBOARD_TRANSLATIONS[lang || "en"].customerMenuPage;
  const tc = DASHBOARD_TRANSLATIONS[lang || "en"].common;

  const [amount, setAmount] = useState<number>(initialAmount > 0 ? initialAmount : 0);
  const [tableNumber, setTableNumber] = useState<string>(initialTable || "");
  const [customerName, setCustomerName] = useState<string>("");
  const [customerPhone, setCustomerPhone] = useState<string>("");
  const [cartItems, setCartItems] = useState<DraftCartItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<"upi" | "cash" | "razorpay">("upi");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCapturingScreenshot, setIsCapturingScreenshot] = useState(false);
  const [paymentSuccess, setPaymentSuccess] = useState<{
    orderNumber: string;
    amount: number;
    subtotal: number;
    tax: number;
    method: string;
    paymentStatus: "paid" | "pending" | "partially_paid";
    customerName: string;
    customerPhone: string;
    cartItems: DraftCartItem[];
    createdAt: string;
    isPreOrder?: boolean;
    advanceAmount?: number;
    remainingAmount?: number;
  } | null>(null);

  // Check if Razorpay is configured in environment
  const razorpayKey = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
  const isRazorpayAvailable = Boolean(
    razorpayKey &&
      razorpayKey !== "your_razorpay_key_id_here" &&
      razorpayKey.length > 5
  );

  // Get Shop Payment Details from shop object
  const shopName = shop.name || "Shop";
  const uploadedPaymentQr = getShopPaymentQr(shop);
  const upiId = getShopUpiId(shop);
  const bankDetails = getShopBankDetails(shop);

  // Load draft cart from localStorage if available
  useEffect(() => {
    if (typeof window === "undefined") return;
    const draftKey = `bishop_checkout_${shop.id}`;
    const rawData = window.localStorage.getItem(draftKey);
    if (rawData) {
      try {
        const parsed = JSON.parse(rawData);
        if (parsed.total && (!initialAmount || initialAmount === 0)) {
          setAmount(parsed.total);
        }
        if (parsed.tableNumber && !initialTable) {
          setTableNumber(parsed.tableNumber);
        }
        if (parsed.customerName) setCustomerName(parsed.customerName);
        if (parsed.customerPhone) setCustomerPhone(parsed.customerPhone);
        if (Array.isArray(parsed.cart)) {
          setCartItems(
            parsed.cart.map((item: any) => ({
              menu_item_id: item.menu_item_id || item.id,
              name: item.name,
              price: item.price,
              quantity: item.quantity,
              notes: item.notes || "",
            }))
          );
        }
      } catch (err) {
        console.error("Error parsing checkout draft:", err);
      }
    }
  }, [shop.id, initialAmount, initialTable]);

  function copyUpiId() {
    if (!upiId) return;
    navigator.clipboard.writeText(upiId);
    toast.success("UPI ID copied to clipboard!");
  }

  function copyBankDetails() {
    if (!bankDetails) return;
    navigator.clipboard.writeText(bankDetails);
    toast.success("Bank details copied to clipboard!");
  }

  // Load Razorpay script dynamically if needed
  useEffect(() => {
    if (!isRazorpayAvailable) return;
    if (typeof window !== "undefined" && !window.Razorpay) {
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.async = true;
      document.body.appendChild(script);
    }
  }, [isRazorpayAvailable]);

  async function handleRazorpayPayment() {
    if (!isRazorpayAvailable || !razorpayKey) {
      toast.error("Razorpay is not configured.");
      return;
    }

    if (amount <= 0) {
      toast.error("Please enter a valid amount.");
      return;
    }

    if (!customerName.trim()) {
      toast.error(menuT.nameRequiredError || "Please enter your Name before proceeding.");
      return;
    }

    setIsSubmitting(true);

    const options = {
      key: razorpayKey,
      amount: Math.round(amount * 100), // in paise
      currency: "INR",
      name: shopName,
      description: `Takeaway Order Payment`,
      handler: async function (response: any) {
        toast.info("Payment authorized! Verifying on server...");
        await recordOrder("pending", "razorpay", {
          razorpay_payment_id: response.razorpay_payment_id,
          razorpay_order_id: response.razorpay_order_id,
          razorpay_signature: response.razorpay_signature,
        });
      },
      prefill: {
        name: customerName,
        contact: customerPhone,
      },
      theme: {
        color: "#10b981",
      },
    };

    try {
      const rzp = new window.Razorpay(options);
      rzp.open();
    } catch (err: any) {
      console.error("Razorpay error:", err);
      toast.error("Failed to initialize Razorpay checkout.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function recordOrder(
    status: "paid" | "pending",
    method: string,
    paymentDetails?: {
      razorpay_payment_id: string;
      razorpay_order_id?: string;
      razorpay_signature?: string;
    }
  ) {
    if (!customerName.trim()) {
      toast.error(menuT.nameRequiredError || "Please enter your Name before proceeding.");
      return;
    }

    setIsSubmitting(true);
    const supabase = createClient();
    const orderNum = `BISHOP-${Math.floor(Date.now() / 1000).toString().slice(-4)}-${Math.floor(
      Math.random() * 900 + 100
    )}`;
    const tokenNumber = `BSH-${Math.floor(Math.random() * 9000 + 1000)}`;

    const taxRate = shop.tax_rate || 0;
    const computedSubtotal = cartItems.length > 0
      ? cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0)
      : amount;
    const computedTax = cartItems.length > 0
      ? Number(((computedSubtotal * taxRate) / 100).toFixed(2))
      : 0;
    const computedTotal = cartItems.length > 0
      ? Number((computedSubtotal + computedTax).toFixed(2))
      : amount;

    const isPreOrder = method === "cash" || method === "pre_order";
    const advanceAmount = isPreOrder ? Number((computedTotal * 0.5).toFixed(2)) : computedTotal;
    const remainingAmount = isPreOrder ? Number((computedTotal - advanceAmount).toFixed(2)) : 0;
    let finalPaymentStatus: "paid" | "pending" | "partially_paid" = isPreOrder ? "partially_paid" : "pending";
    const finalPaymentMethod = isPreOrder ? "pre_order" : method;

    try {
      // Pre-validate stock for items
      if (cartItems.length > 0) {
        const { data: invRecords } = await supabase
          .from("inventory")
          .select("*")
          .eq("shop_id", shop.id);

        const invMap = new Map<string, { id: string; quantity: number }>();
        (invRecords || []).forEach((inv: any) => {
          if (inv.name) {
            invMap.set(inv.name.trim().toLowerCase(), { id: inv.id, quantity: inv.quantity ?? 0 });
          }
        });

        for (const item of cartItems) {
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
      }

      let finalOrderNumber = tokenNumber;
      let targetOrderId: string | null = null;

      if (cartItems.length > 0) {
        // Submit via server-authoritative API route which enforces DB pricing and secure stock deduction
        const apiRes = await fetch("/api/orders/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            shopId: shop.id,
            customerName: customerName.trim(),
            customerPhone: customerPhone.trim() || null,
            orderNotes: isPreOrder
              ? `Pre-Order 50% Advance (Paid ${formatCurrency(advanceAmount)}, Remaining ${formatCurrency(remainingAmount)})`
              : `Takeaway Payment via ${method.toUpperCase()}`,
            cart: cartItems.map((item) => ({
              menu_item_id: item.menu_item_id,
              name: item.name,
              price: item.price,
              quantity: item.quantity,
              notes: item.notes || null,
            })),
            subtotal: computedSubtotal,
            tax: computedTax,
            total: computedTotal,
            paymentMethod: finalPaymentMethod,
            paymentStatus: "pending",
            advanceAmount,
            remainingAmount,
            isPreOrder,
          }),
        });

        const apiData = await apiRes.json();
        if (!apiRes.ok || !apiData.success) {
          throw new Error(apiData.error || "Failed to record verified order.");
        }

        targetOrderId = apiData.orderId || null;
        if (apiData.tokenNumber) {
          finalOrderNumber = apiData.tokenNumber;
        }
      } else {
        // Direct payment record without menu items - strictly inserted in 'pending' status
        const { data: createdOrder, error: directErr } = await supabase
          .from("orders")
          .insert({
            shop_id: shop.id,
            order_number: orderNum,
            token_number: tokenNumber,
            customer_name: customerName.trim(),
            customer_phone: customerPhone.trim() || null,
            table_number: "Takeaway",
            status: "pending",
            subtotal: computedSubtotal,
            tax: computedTax,
            total: computedTotal,
            grand_total: computedTotal,
            advance_amount: advanceAmount,
            remaining_amount: remainingAmount,
            is_pre_order: isPreOrder,
            payment_method: finalPaymentMethod,
            payment_status: "pending",
            notes: isPreOrder
              ? `Pre-Order 50% Advance (Paid ${formatCurrency(advanceAmount)}, Remaining ${formatCurrency(remainingAmount)})`
              : `Takeaway Payment via ${method.toUpperCase()}`,
          })
          .select("id, token_number")
          .single();

        if (directErr) throw directErr;
        targetOrderId = createdOrder?.id || null;
        if (createdOrder?.token_number) finalOrderNumber = createdOrder.token_number;
      }

      // If online payment via Razorpay, invoke server-side verification to settle payment
      if (method === "razorpay" && paymentDetails?.razorpay_payment_id && targetOrderId) {
        try {
          const verifyRes = await fetch("/api/orders/verify-payment", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              orderId: targetOrderId,
              shopId: shop.id,
              razorpay_payment_id: paymentDetails.razorpay_payment_id,
              razorpay_order_id: paymentDetails.razorpay_order_id,
              razorpay_signature: paymentDetails.razorpay_signature,
            }),
          });
          const verifyData = await verifyRes.json();
          if (verifyRes.ok && verifyData.success) {
            finalPaymentStatus = "paid";
            toast.success("Payment verified and confirmed!");
          } else {
            console.warn("[PAYMENT-VERIFY] Verification pending:", verifyData.error);
            toast.warning(verifyData.error || "Payment verification pending confirmation.");
          }
        } catch (vErr) {
          console.warn("[PAYMENT-VERIFY] Verification API error:", vErr);
          toast.warning("Payment verification in progress. Marked as pending confirmation.");
        }
      }

      // Clear draft cart
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(`bishop_checkout_${shop.id}`);
      }

      setPaymentSuccess({
        orderNumber: finalOrderNumber,
        amount: computedTotal,
        subtotal: computedSubtotal,
        tax: computedTax,
        method: finalPaymentMethod,
        paymentStatus: finalPaymentStatus as any,
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim(),
        cartItems,
        createdAt: new Date().toLocaleString(),
        isPreOrder,
        advanceAmount,
        remainingAmount,
      });

      if (isPreOrder) {
        toast.success(`Pre-Order Confirmed! 50% advance (${formatCurrency(advanceAmount)}) recorded.`);
      } else if (status === "pending") {
        toast.success("Cash order placed! Pay at counter.");
      } else {
        toast.success("Payment recorded successfully!");
      }
    } catch (err: any) {
      console.error("Payment submission error:", err);
      toast.error(err?.message || "Error submitting payment. Please alert shop staff.");
    } finally {
      setIsSubmitting(false);
    }
  }

  // Digital Bill / Thermal Receipt View
  if (paymentSuccess) {
    const taxRate = shop.tax_rate || 0;
    const halfTaxRate = (taxRate / 2).toFixed(1);
    const halfTaxAmount = (paymentSuccess.tax / 2).toFixed(2);
    const isPending = paymentSuccess.paymentStatus === "pending" || paymentSuccess.method === "cash";

    async function handleTakeScreenshot() {
      console.log("[Screenshot] 1. Take Screenshot button clicked");
      if (isCapturingScreenshot) {
        console.log("[Screenshot] Capture already in progress, ignoring duplicate click");
        return;
      }
      setIsCapturingScreenshot(true);
      try {
        await captureBillScreenshot(
          "thermal-receipt",
          `BISHOP_Bill_${paymentSuccess?.orderNumber || "Receipt"}.png`
        );
        toast.success("Screenshot saved successfully!");
      } catch (err: any) {
        console.error("[Screenshot] Screenshot error message:", err?.message || String(err));
        console.error("[Screenshot] Screenshot error stack:", err?.stack || "No stack trace");
        toast.error("Failed to capture screenshot: " + (err?.message || "Unknown error"));
      } finally {
        setIsCapturingScreenshot(false);
      }
    }

    return (
      <div className="min-h-dvh bg-slate-100 flex items-center justify-center p-4 py-8">
        <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden print:border-none print:shadow-none print:w-full print:max-w-none">
          
          {/* Top Banner */}
          {paymentSuccess.isPreOrder ? (
            <div className="bg-emerald-600 text-white p-4 text-center print:hidden flex items-center justify-center gap-2">
              <CheckCircle2 className="h-6 w-6" />
              <span className="font-extrabold text-base uppercase tracking-wider">
                Pre-Order Confirmed — 50% Advance Paid
              </span>
            </div>
          ) : isPending ? (
            <div className="bg-amber-500 text-white p-4 text-center print:hidden flex items-center justify-center gap-2">
              <Clock className="h-6 w-6" />
              <span className="font-extrabold text-base uppercase tracking-wider">Cash Order Confirmed - Pay at Counter</span>
            </div>
          ) : (
            <div className="bg-emerald-600 text-white p-4 text-center print:hidden flex items-center justify-center gap-2">
              <CheckCircle2 className="h-6 w-6" />
              <span className="font-extrabold text-base uppercase tracking-wider">{t.paymentSuccess}</span>
            </div>
          )}

          {/* Thermal Receipt Content Container */}
          <div id="thermal-receipt" className="p-6 font-mono text-xs text-slate-800 space-y-4 bg-white select-text">
            
            {/* Header: Shop Name & Info */}
            <div className="text-center space-y-1">
              <h1 className="text-xl font-black uppercase tracking-tight text-slate-900">{shopName}</h1>
              {shop.address && <p className="text-[11px] text-slate-600 leading-tight">{shop.address}</p>}
              {shop.phone && <p className="text-[11px] text-slate-600">Ph: {shop.phone}</p>}
              {shop.gst_number && (
                <p className="text-[11px] font-bold text-slate-700 pt-0.5">{t.gstin}: {shop.gst_number}</p>
              )}
            </div>

            {/* Divider */}
            <div className="border-b-2 border-dashed border-slate-300 my-2" />

            {/* Bill Meta Details */}
            <div className="space-y-1 text-[11px]">
              <div className="flex justify-between">
                <span className="text-slate-500">{t.billNumber}:</span>
                <span className="font-bold text-slate-900">{paymentSuccess.orderNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">{t.date}:</span>
                <span>{paymentSuccess.createdAt}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">{t.customerName}:</span>
                <span className="font-bold text-slate-900">{paymentSuccess.customerName}</span>
              </div>
              {paymentSuccess.customerPhone && (
                <div className="flex justify-between">
                  <span className="text-slate-500">{t.phone}:</span>
                  <span>{paymentSuccess.customerPhone}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-slate-500">{t.table}:</span>
                <span className="font-bold text-slate-800 uppercase">
                  {paymentSuccess.isPreOrder ? "Pre-Order (50% Advance)" : "Takeaway / Parcel"}
                </span>
              </div>
            </div>

            {/* Divider */}
            <div className="border-b-2 border-dashed border-slate-300 my-2" />

            {/* Itemized Table */}
            {paymentSuccess.cartItems.length > 0 ? (
              <div className="space-y-2">
                <div className="grid grid-cols-12 font-bold text-[10px] uppercase text-slate-600 border-b border-slate-200 pb-1">
                  <span className="col-span-1">#</span>
                  <span className="col-span-5">{t.item}</span>
                  <span className="col-span-2 text-center">{t.qty}</span>
                  <span className="col-span-2 text-right">{t.price}</span>
                  <span className="col-span-2 text-right">{t.totalAmount ? "Total" : "Total"}</span>
                </div>

                {paymentSuccess.cartItems.map((item, idx) => (
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
                    <span className="col-span-2 text-right text-slate-600">{item.price}</span>
                    <span className="col-span-2 text-right font-bold text-slate-900">
                      {(item.price * item.quantity).toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex justify-between text-xs font-semibold py-1">
                <span>Takeaway Payment</span>
                <span>{formatCurrency(paymentSuccess.amount)}</span>
              </div>
            )}

            {/* Divider */}
            <div className="border-b-2 border-dashed border-slate-300 my-2" />

            {/* Calculations Breakdown */}
            <div className="space-y-1 text-xs">
              <div className="flex justify-between text-slate-600">
                <span>{t.subtotal}</span>
                <span>{formatCurrency(paymentSuccess.subtotal)}</span>
              </div>

              {taxRate > 0 && (
                <>
                  <div className="flex justify-between text-slate-500 text-[11px]">
                    <span>{t.cgst} ({halfTaxRate}%)</span>
                    <span>₹{halfTaxAmount}</span>
                  </div>
                  <div className="flex justify-between text-slate-500 text-[11px]">
                    <span>{t.sgst} ({halfTaxRate}%)</span>
                    <span>₹{halfTaxAmount}</span>
                  </div>
                </>
              )}

              {/* Grand Total Divider */}
              <div className="border-b-2 border-slate-900 my-2" />

              <div className="flex justify-between font-black text-sm text-slate-900">
                <span>{t.totalAmount}</span>
                <span>{formatCurrency(paymentSuccess.amount)}</span>
              </div>

              {paymentSuccess.isPreOrder && paymentSuccess.advanceAmount !== undefined && (
                <div className="pt-2 space-y-1 border-t border-slate-200 mt-2">
                  <div className="flex justify-between font-bold text-emerald-700 text-xs">
                    <span>{t.advancePaid || "Advance Paid (50%)"}</span>
                    <span>{formatCurrency(paymentSuccess.advanceAmount)}</span>
                  </div>
                  <div className="flex justify-between font-bold text-slate-800 text-xs">
                    <span>{t.remainingBalance || "Remaining at Collection"}</span>
                    <span>{formatCurrency(paymentSuccess.remainingAmount || 0)}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Divider */}
            <div className="border-b-2 border-dashed border-slate-300 my-2" />

            {/* Payment Confirmation & Status */}
            <div className="space-y-1.5 text-center">
              <p className="text-[11px] text-slate-600">
                Payment Mode: <strong className="uppercase text-slate-900">{paymentSuccess.method}</strong>
              </p>
              {paymentSuccess.isPreOrder ? (
                <div className="inline-block px-3 py-1 bg-emerald-50 border border-emerald-300 rounded-lg text-emerald-900 font-extrabold text-[11px] uppercase tracking-wider">
                  PRE-ORDER: 50% ADVANCE PAID (PAY {formatCurrency(paymentSuccess.remainingAmount || 0)} ON COLLECTION)
                </div>
              ) : paymentSuccess.paymentStatus === "pending" || paymentSuccess.method === "cash" ? (
                <div className="inline-block px-3 py-1 bg-amber-50 border border-amber-300 rounded-lg text-amber-900 font-extrabold text-[11px] uppercase tracking-wider">
                  {t.paymentStatusPending || "PAYMENT STATUS: PENDING (Pay at Counter)"}
                </div>
              ) : (
                <div className="inline-block px-3 py-1 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-800 font-extrabold text-[11px] uppercase tracking-wider">
                  {t.paymentStatusSuccessful}
                </div>
              )}
            </div>

            {/* Divider */}
            <div className="border-b-2 border-dashed border-slate-300 my-2" />

            {/* Footer Message */}
            <div className="text-center text-[10px] text-slate-500 space-y-1 pt-1">
              <p className="font-semibold text-slate-700">{t.thankYouMessage}</p>
              <div className="flex items-center justify-center gap-1.5">
                <Image
                  src="/bishop-icon.svg"
                  alt="BISHOP"
                  width={14}
                  height={14}
                  className="h-3.5 w-3.5 object-contain"
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
              {isCapturingScreenshot ? "Capturing..." : (t.takeScreenshot || "Take Screenshot")}
            </Button>

            <a href={`/menu/${shop.id}`} className="block">
              <Button size="md" variant="outline" className="w-full border-slate-300 text-slate-700">
                {t.backToMenu}
              </Button>
            </a>
          </div>

        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-slate-50 py-6 sm:py-10">
      <div className="max-w-xl mx-auto px-4 sm:px-6 space-y-6">
        {/* Top Header Navigation */}
        <div className="flex items-center justify-between">
          <a
            href={`/menu/${shop.id}`}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-slate-900 transition"
          >
            <ArrowLeft className="h-4 w-4" />
            {t.backToMenu}
          </a>
          <div className="flex items-center gap-2">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={toggleLang}
              className="border-mint-200 text-mint-700 hover:bg-mint-50 hover:text-mint-800"
              leftIcon={<Languages className="h-4 w-4" />}
            >
              {lang === "en" ? "தமிழ்" : "English"}
            </Button>
            <Badge variant="mint" className="text-xs uppercase tracking-wider font-bold inline-flex items-center gap-1.5">
              <Image
                src="/bishop-icon.svg"
                alt="BISHOP"
                width={14}
                height={14}
                className="h-3.5 w-3.5 object-contain"
              />
              <span>BISHOP Pay</span>
            </Badge>
          </div>
        </div>

        {/* Shop Info Card */}
        <Card padding="md" className="rounded-3xl border-slate-200 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 rounded-2xl bg-mint-50 border border-mint-100 flex items-center justify-center text-mint-600 font-black text-xl shrink-0">
              {shopName.charAt(0).toUpperCase()}
            </div>
            <div>
              <h1 className="text-xl font-extrabold text-slate-900">{shopName}</h1>
              <p className="text-xs text-slate-500 mt-0.5">{shop.address || "Contactless Digital Payment"}</p>
            </div>
          </div>
        </Card>

        {/* Payment Main Container */}
        <Card padding="lg" className="rounded-3xl border-slate-200 shadow-md space-y-6">
          {/* Amount Display / Edit */}
          <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200 text-center space-y-2">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-widest block">
              Payment Amount
            </label>
            <div className="flex items-center justify-center gap-1">
              <span className="text-2xl font-black text-slate-800">₹</span>
              <input
                type="number"
                value={amount || ""}
                onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
                placeholder="0"
                min="1"
                className="text-3xl font-black text-slate-900 w-36 text-center bg-transparent focus:outline-none focus:border-b-2 focus:border-mint-500"
              />
            </div>
            <div className="pt-2 border-t border-slate-200/60 max-w-xs mx-auto space-y-2">
              <Badge variant="mint" className="uppercase tracking-wider text-[10px]">
                Order Type: Takeaway
              </Badge>

              <div className="text-left pt-1">
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                  Customer Name *
                </label>
                <input
                  type="text"
                  placeholder="Enter your name"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  className="w-full text-xs px-3 py-2 rounded-xl bg-white border border-slate-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-mint-500"
                  required
                />
              </div>
            </div>
          </div>

          {/* Payment Method Selector */}
          <div className="space-y-3">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">
              Select Payment Option
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setPaymentMethod("upi")}
                className={`p-4 rounded-2xl border flex items-center sm:flex-col justify-center gap-3 transition touch-manipulation ${
                  paymentMethod === "upi"
                    ? "border-mint-500 bg-mint-50/50 text-mint-700 shadow-sm font-bold"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                }`}
              >
                <Smartphone className="h-6 w-6 text-mint-600 shrink-0" />
                <span className="text-xs font-bold uppercase tracking-wider">UPI / Shop QR</span>
              </button>

              <button
                type="button"
                onClick={() => setPaymentMethod("cash")}
                className={`p-4 rounded-2xl border flex items-center sm:flex-col justify-center gap-3 transition touch-manipulation ${
                  paymentMethod === "cash"
                    ? "border-mint-500 bg-mint-50/50 text-mint-700 shadow-sm font-bold"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                }`}
              >
                <Banknote className="h-6 w-6 text-emerald-600 shrink-0" />
                <span className="text-xs font-bold uppercase tracking-wider">Pre-Order</span>
              </button>

              {isRazorpayAvailable && (
                <button
                  type="button"
                  onClick={() => setPaymentMethod("razorpay")}
                  className={`p-4 rounded-2xl border flex items-center sm:flex-col justify-center gap-3 sm:col-span-2 transition touch-manipulation ${
                    paymentMethod === "razorpay"
                      ? "border-blue-500 bg-blue-50/50 text-blue-700 shadow-sm font-bold"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                  }`}
                >
                  <CreditCard className="h-6 w-6 text-blue-600 shrink-0" />
                  <span className="text-xs font-bold uppercase tracking-wider">
                    Online / Card / Razorpay
                  </span>
                </button>
              )}
            </div>
          </div>

          {/* Shop Uploaded Payment QR Content */}
          {paymentMethod === "upi" && (
            <div className="space-y-5 pt-2 border-t border-slate-100">
              {uploadedPaymentQr ? (
                <div className="flex flex-col items-center justify-center text-center space-y-4">
                  <div>
                    <h3 className="text-lg font-extrabold text-slate-900">Scan to Pay</h3>
                    <p className="text-xs text-slate-500 mt-0.5 max-w-xs mx-auto">
                      Scan this QR code using GPay, PhonePe, Paytm, BHIM, or any UPI app.
                    </p>
                  </div>

                  {/* Uploaded Shop Payment QR Image */}
                  <div className="p-4 bg-white rounded-3xl border-2 border-mint-200 shadow-xl shadow-mint-500/10 inline-block w-full max-w-[260px]">
                    <img
                      src={uploadedPaymentQr}
                      alt={`Payment QR Code for ${shopName}`}
                      className="w-full h-auto aspect-square rounded-2xl object-contain mx-auto border border-slate-100 bg-white p-1"
                    />
                  </div>

                  {/* Shop UPI ID + Copy Option */}
                  {upiId && (
                    <div className="w-full max-w-sm bg-slate-50 p-3 rounded-2xl border border-slate-200 flex items-center justify-between gap-2">
                      <div className="truncate text-left pl-2">
                        <span className="text-[10px] uppercase font-bold text-slate-400 block">
                          Shop UPI ID
                        </span>
                        <code className="text-xs font-bold text-mint-700 truncate block">
                          {upiId}
                        </code>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={copyUpiId}
                        leftIcon={<Copy className="h-3.5 w-3.5" />}
                      >
                        Copy UPI ID
                      </Button>
                    </div>
                  )}

                  {/* Bank Details Display */}
                  {bankDetails && (
                    <div className="w-full max-w-sm bg-slate-50 p-3 rounded-2xl border border-slate-200 text-left space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] uppercase font-bold text-slate-400 flex items-center gap-1">
                          <Building2 className="h-3 w-3 text-slate-500" />
                          Bank Account Details
                        </span>
                        <button
                          type="button"
                          onClick={copyBankDetails}
                          className="text-[11px] font-bold text-mint-600 hover:underline flex items-center gap-1"
                        >
                          <Copy className="h-3 w-3" />
                          Copy
                        </button>
                      </div>
                      <pre className="text-xs text-slate-700 font-mono whitespace-pre-wrap leading-relaxed">
                        {bankDetails}
                      </pre>
                    </div>
                  )}
                </div>
              ) : (
                /* Clear Alert when no payment QR configured (Requirement 8) */
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center space-y-3">
                  <AlertCircle className="h-10 w-10 text-amber-500 mx-auto" />
                  <div>
                    <h3 className="text-base font-extrabold text-amber-900">
                      Payment QR not configured by this shop.
                    </h3>
                    <p className="text-xs text-amber-700 mt-1">
                      {shopName} has not uploaded their payment QR image yet. Please pay cash at the counter or contact shop staff.
                    </p>
                  </div>

                  {upiId && (
                    <div className="bg-white p-3 rounded-xl border border-amber-200 text-left flex items-center justify-between gap-2 mt-2">
                      <div className="truncate">
                        <span className="text-[10px] uppercase font-bold text-slate-400 block">UPI ID</span>
                        <code className="text-xs font-bold text-slate-900">{upiId}</code>
                      </div>
                      <Button size="sm" variant="outline" onClick={copyUpiId} leftIcon={<Copy className="h-3.5 w-3.5" />}>
                        Copy
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* Confirm UPI Payment Button */}
              <div className="pt-4 border-t border-slate-100 space-y-3">
                <Button
                  onClick={() => recordOrder("paid", "upi")}
                  disabled={isSubmitting || amount <= 0}
                  className="w-full bg-gradient-to-r from-mint-600 to-emerald-600 hover:from-mint-700 hover:to-emerald-700 text-white font-extrabold py-3 shadow-lg shadow-mint-500/20"
                  size="lg"
                  leftIcon={<CheckCircle2 className="h-5 w-5" />}
                >
                  I Have Paid {amount > 0 ? formatCurrency(amount) : ""} via QR / UPI
                </Button>
              </div>
            </div>
          )}

          {/* Pre-Order 50% Advance Payment Content */}
          {paymentMethod === "cash" && (
            <div className="space-y-4 pt-2 border-t border-slate-100 text-center">
              {(() => {
                const advanceAmount = Number((amount * 0.5).toFixed(2));
                const remainingAmount = Number((amount - advanceAmount).toFixed(2));

                return (
                  <>
                    <div className="p-4 bg-emerald-50/80 rounded-2xl border border-emerald-200 text-emerald-950 space-y-3 text-left">
                      <div className="flex items-center gap-2">
                        <Banknote className="h-6 w-6 text-emerald-600 shrink-0" />
                        <h3 className="text-sm font-extrabold uppercase tracking-wide text-emerald-900">
                          Pre-Order (50% Advance Required)
                        </h3>
                      </div>
                      
                      <p className="text-xs font-bold text-emerald-800 bg-emerald-100/90 p-2.5 rounded-xl border border-emerald-200">
                        {t.advanceNotice || "50% advance payment required to place the pre-order."}
                      </p>

                      <div className="grid grid-cols-2 gap-2 pt-1">
                        <div className="bg-white p-3 rounded-xl border border-emerald-300 shadow-xs space-y-0.5">
                          <span className="text-[10px] uppercase font-bold text-slate-400 block">Pay Now (50%)</span>
                          <span className="text-base font-black text-emerald-700">{formatCurrency(advanceAmount)}</span>
                        </div>

                        <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-xs space-y-0.5">
                          <span className="text-[10px] uppercase font-bold text-slate-400 block">On Collection</span>
                          <span className="text-base font-black text-slate-800">{formatCurrency(remainingAmount)}</span>
                        </div>
                      </div>

                      <p className="text-[11px] font-medium text-slate-600 italic pt-0.5">
                        Pay {formatCurrency(remainingAmount)} when collecting the order at {shopName}.
                      </p>
                    </div>

                    <Button
                      onClick={() => recordOrder("pending", "cash")}
                      disabled={isSubmitting || amount <= 0}
                      className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold py-3 shadow-md active:scale-[0.99] touch-manipulation"
                      size="lg"
                      leftIcon={<CheckCircle2 className="h-5 w-5" />}
                    >
                      {isSubmitting ? "Placing Pre-Order..." : `Confirm Pre-Order (Pay ${formatCurrency(advanceAmount)} Advance Now)`}
                    </Button>
                  </>
                );
              })()}
            </div>
          )}

          {/* Razorpay Online Content */}
          {paymentMethod === "razorpay" && isRazorpayAvailable && (
            <div className="space-y-4 pt-2 border-t border-slate-100 text-center">
              <div className="p-4 bg-blue-50 rounded-2xl border border-blue-100 text-blue-900 space-y-2">
                <ShieldCheck className="h-8 w-8 text-blue-600 mx-auto" />
                <p className="text-sm font-bold">Secure Online Checkout</p>
                <p className="text-xs text-blue-700">
                  Pay via Credit/Debit Cards, NetBanking, or Digital Wallets powered by Razorpay.
                </p>
              </div>

              <Button
                onClick={handleRazorpayPayment}
                disabled={isSubmitting || amount <= 0}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-extrabold py-3 shadow-md"
                size="lg"
                leftIcon={<CreditCard className="h-5 w-5" />}
              >
                Pay {formatCurrency(amount)} with Razorpay
              </Button>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
