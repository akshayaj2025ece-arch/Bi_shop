import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/employee/logout
 * Clears the HttpOnly bishop_emp_session cookie to properly log out employees.
 * The client-side Zustand store should also be cleared by the calling component.
 */
export async function POST(req: NextRequest) {
  try {
    const response = NextResponse.json({
      success: true,
      message: "Employee session ended.",
    });

    // Clear the HttpOnly session cookie by setting it to empty with immediate expiry
    response.cookies.set("bishop_emp_session", "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 0,
      path: "/",
    });

    return response;
  } catch (err: any) {
    console.error("API /api/employee/logout error:", err);
    return NextResponse.json(
      { error: err?.message || "Internal server error." },
      { status: 500 }
    );
  }
}
