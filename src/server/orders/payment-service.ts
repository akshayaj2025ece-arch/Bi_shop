/**
 * Server-side Razorpay Payment Verification Service for BISHOP.
 * Verifies Razorpay HMAC-SHA256 signatures and payment integrity.
 * Transitions order payment_status from 'pending' to 'paid' strictly on verified confirmation.
 */

if (typeof window !== "undefined") {
  throw new Error("Security Error: server-only module '@/server/orders/payment-service' cannot be executed in browser context.");
}

import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { emitDomainEvent } from "@/server/common/events";

export interface VerifyRazorpayPaymentParams {
  orderId: string;
  shopId: string;
  razorpay_payment_id: string;
  razorpay_order_id?: string;
  razorpay_signature?: string;
}

export interface VerifyPaymentSuccessResult {
  success: true;
  message: string;
  orderId: string;
  paymentStatus: "paid";
  paymentId: string;
}

export interface VerifyPaymentFailureResult {
  success: false;
  error: string;
  status: number;
}

export type VerifyPaymentResult = VerifyPaymentSuccessResult | VerifyPaymentFailureResult;

function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceKey) return null;
  return createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Validates Razorpay HMAC-SHA256 signature using constant-time comparison.
 */
export function verifyRazorpaySignature(
  razorpayOrderId: string,
  razorpayPaymentId: string,
  razorpaySignature: string,
  secret: string
): boolean {
  if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature || !secret) {
    return false;
  }

  const payload = `${razorpayOrderId}|${razorpayPaymentId}`;
  const expectedSignature = crypto
    .createHmac("sha256", secret.trim())
    .update(payload)
    .digest("hex");

  const bufA = Buffer.from(expectedSignature, "utf8");
  const bufB = Buffer.from(razorpaySignature.trim(), "utf8");

  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }

  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Verifies Razorpay payment parameters and authoritatively updates order status to 'paid'.
 */
export async function verifyAndSettleRazorpayPayment(
  params: VerifyRazorpayPaymentParams
): Promise<VerifyPaymentResult> {
  const { orderId, shopId, razorpay_payment_id, razorpay_order_id, razorpay_signature } = params;

  if (!orderId || !shopId || !razorpay_payment_id) {
    return {
      success: false,
      error: "Missing required payment parameters: orderId, shopId, and razorpay_payment_id are required.",
      status: 400,
    };
  }

  // Format validation for razorpay_payment_id
  const cleanPaymentId = razorpay_payment_id.trim();
  if (!cleanPaymentId.startsWith("pay_") || cleanPaymentId.length < 8) {
    return {
      success: false,
      error: "Invalid Razorpay payment ID format. Must begin with 'pay_'.",
      status: 400,
    };
  }

  const razorpaySecret = process.env.RAZORPAY_KEY_SECRET?.trim();

  // Signature verification if order_id & signature provided
  if (razorpay_order_id && razorpay_signature) {
    if (!razorpaySecret || razorpaySecret.length < 8) {
      return {
        success: false,
        error: "Server configuration error: RAZORPAY_KEY_SECRET is not configured to verify payment signatures.",
        status: 500,
      };
    }

    const isValidSig = verifyRazorpaySignature(
      razorpay_order_id,
      cleanPaymentId,
      razorpay_signature,
      razorpaySecret
    );

    if (!isValidSig) {
      return {
        success: false,
        error: "Cryptographic signature verification failed. Tampered payment payload rejected.",
        status: 400,
      };
    }
  }

  const adminClient = getSupabaseAdmin();
  if (!adminClient) {
    return {
      success: false,
      error: "Database configuration error: Missing Supabase service role key.",
      status: 500,
    };
  }

  // Fetch the target order to confirm it belongs strictly to this shop
  const { data: existingOrder, error: orderErr } = await adminClient
    .from("orders")
    .select("id, shop_id, status, payment_status, notes")
    .eq("id", orderId)
    .maybeSingle();

  if (orderErr || !existingOrder) {
    return {
      success: false,
      error: `Order "${orderId}" not found for payment settlement.`,
      status: 404,
    };
  }

  if (existingOrder.shop_id !== shopId) {
    return {
      success: false,
      error: "Forbidden: Order does not belong to the specified shop.",
      status: 403,
    };
  }

  if (existingOrder.status === "cancelled") {
    return {
      success: false,
      error: "Cannot settle payment for a cancelled order.",
      status: 400,
    };
  }

  if (existingOrder.payment_status === "paid") {
    return {
      success: true,
      message: "Order is already verified and marked as paid.",
      orderId,
      paymentStatus: "paid",
      paymentId: cleanPaymentId,
    };
  }

  // Authoritatively update payment_status to 'paid' via service_role client
  const updatedNotes = existingOrder.notes
    ? `${existingOrder.notes} | Razorpay: ${cleanPaymentId}`
    : `Razorpay: ${cleanPaymentId}`;

  const { error: updateErr } = await adminClient
    .from("orders")
    .update({
      payment_status: "paid",
      payment_method: "razorpay",
      notes: updatedNotes,
      updated_at: new Date().toISOString(),
    })
    .eq("id", orderId);

  if (updateErr) {
    return {
      success: false,
      error: `Failed to update order payment status: ${updateErr.message}`,
      status: 500,
    };
  }

  emitDomainEvent("ORDER_PAID", {
    orderId,
    shopId,
    paymentMethod: "razorpay",
    paymentId: cleanPaymentId,
  });

  return {
    success: true,
    message: "Payment verified successfully! Order marked as paid.",
    orderId,
    paymentStatus: "paid",
    paymentId: cleanPaymentId,
  };
}
