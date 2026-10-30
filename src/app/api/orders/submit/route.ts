import { NextRequest, NextResponse } from "next/server";
import { submitTakeawayOrder } from "@/server/orders";
import { checkRateLimit, getClientIp, RATE_LIMIT_PRESETS } from "@/server/common/rate-limiter";

export async function POST(request: NextRequest) {
  try {
    // 1. Enforce rate limiting per client IP to prevent denial of service and automated flooding
    const clientIp = getClientIp(request);
    const rateLimit = checkRateLimit(`order_${clientIp}`, RATE_LIMIT_PRESETS.orders);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Too many order requests. Please wait a moment before trying again." },
        {
          status: 429,
          headers: {
            "Retry-After": String(rateLimit.resetSeconds),
            "X-RateLimit-Limit": String(rateLimit.limit),
            "X-RateLimit-Remaining": "0",
          },
        }
      );
    }

    const body = await request.json();
    const {
      shopId,
      customerName,
      customerPhone,
      orderNotes,
      cart,
      subtotal,
      tax,
      total,
      paymentMethod,
      paymentStatus,
      advanceAmount,
      remainingAmount,
      isPreOrder,
      idempotencyKey,
    } = body;

    if (!shopId || !cart || !Array.isArray(cart) || !cart.length) {
      return NextResponse.json(
        { error: "Invalid order request payload: shopId and at least one cart item are required." },
        { status: 400 }
      );
    }

    // Header-based idempotency key support
    const headerIdempotencyKey = request.headers.get("idempotency-key") || idempotencyKey;

    const result = await submitTakeawayOrder({
      shopId,
      customerName,
      customerPhone,
      orderNotes,
      cart,
      subtotal,
      tax,
      total,
      paymentMethod,
      paymentStatus,
      advanceAmount,
      remainingAmount,
      isPreOrder,
      idempotencyKey: headerIdempotencyKey,
    });

    if (!result.success) {
      return NextResponse.json(
        {
          error: result.error,
          code: result.code,
          details: result.details,
          hint: result.hint,
        },
        { status: result.status || 500 }
      );
    }

    return NextResponse.json({
      success: true,
      orderId: result.orderId,
      orderNumber: result.orderNumber,
      tokenNumber: result.tokenNumber,
      subtotal: result.subtotal,
      tax: result.tax,
      total: result.total,
    });
  } catch (error: any) {
    console.error("[API/orders/submit] Unhandled Exception:", error?.message, error);
    return NextResponse.json(
      {
        error: error?.message || "Failed to process order",
      },
      { status: 500 }
    );
  }
}
