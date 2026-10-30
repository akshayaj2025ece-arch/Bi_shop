import { NextRequest, NextResponse } from "next/server";
import { verifyEmployee } from "@/server/employees";
import { checkRateLimit, getClientIp, RATE_LIMIT_PRESETS } from "@/server/common/rate-limiter";

export async function POST(req: NextRequest) {
  try {
    const clientIp = getClientIp(req);
    const ipLimit = checkRateLimit(`emp_verify_${clientIp}`, RATE_LIMIT_PRESETS.employeeVerify);
    if (!ipLimit.allowed) {
      return NextResponse.json(
        { error: "Too many employee verification attempts. Please wait a moment." },
        {
          status: 429,
          headers: {
            "Retry-After": String(ipLimit.resetSeconds),
            "X-RateLimit-Limit": String(ipLimit.limit),
            "X-RateLimit-Remaining": "0",
          },
        }
      );
    }

    const body = await req.json();
    const { name, shop_name, phone } = body;

    if (!name || !shop_name || !phone) {
      return NextResponse.json(
        { error: "Name, Shop Name, and Mobile Number are required." },
        { status: 400 }
      );
    }

    const result = await verifyEmployee({ name, shop_name, phone });

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status }
      );
    }

    // Return employee data WITHOUT the raw token in the response body.
    // The token is delivered exclusively via the HttpOnly cookie (below) to prevent XSS access.
    const { token: _token, ...employeeWithoutToken } = result.employee;
    const response = NextResponse.json({
      success: true,
      employee: employeeWithoutToken,
    });

    response.cookies.set("bishop_emp_session", result.employee.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60, // 7 days
      path: "/",
    });

    return response;
  } catch (err: any) {
    console.error("API /api/employee/verify error:", err);
    return NextResponse.json(
      { error: err?.message || "Internal server error." },
      { status: 500 }
    );
  }
}
