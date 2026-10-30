import { NextRequest, NextResponse } from "next/server";
import { verifyAndSettleRazorpayPayment } from "@/server/orders";
import { checkRateLimit, getClientIp, RATE_LIMIT_PRESETS } from "@/server/common/rate-limiter";

export async function POST(req: NextRequest) {
  try {
    const clientIp = getClientIp(req);
    const limit = checkRateLimit(`pay_verify_${clientIp}`, RATE_LIMIT_PRESETS.general);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "Too many payment verification attempts. Please wait a moment." },
        {
          status: 429,
          headers: {
            "Retry-After": String(limit.resetSeconds),
            "X-RateLimit-Limit": String(limit.limit),
            "X-RateLimit-Remaining": "0",
          },
        }
      );
    }

    const body = await req.json();
    const { orderId, shopId, razorpay_payment_id, razorpay_order_id, razorpay_signature } = body;

    const result = await verifyAndSettleRazorpayPayment({
      orderId,
      shopId,
      razorpay_payment_id,
      razorpay_order_id,
      razorpay_signature,
    });

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status }
      );
    }

    return NextResponse.json(result);
  } catch (err: any) {
    console.error("API /api/orders/verify-payment error:", err);
    return NextResponse.json(
      { error: err?.message || "Internal server error." },
      { status: 500 }
    );
  }
}

