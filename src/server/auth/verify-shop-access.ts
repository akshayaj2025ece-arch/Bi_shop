/**
 * Server-side Multi-Tenant Shop Access Verification for BISHOP.
 * Verifies whether the incoming request is authorized to view or mutate
 * the specified shop's resources (via Supabase auth or signed employee session).
 */

if (typeof window !== "undefined") {
  throw new Error("Security Error: server-only module '@/server/auth/verify-shop-access' cannot be executed in browser context.");
}

import { NextRequest } from "next/server";
import { createClient as createServerClient } from "@/server/supabase/server-client";
import { verifyEmployeeSessionToken } from "./session-token";

export interface ShopAccessResult {
  authorized: boolean;
  role?: string;
  userId?: string;
  employeeId?: string;
  error?: string;
  status?: number;
}

/**
 * Validates that the request has permission to access the target shop.
 * Checks both authenticated shopkeeper accounts (via Supabase auth)
 * and verified employees (via signed HttpOnly bishop_emp_session token).
 */
export async function verifyShopAccess(
  req: NextRequest,
  targetShopId: string
): Promise<ShopAccessResult> {
  if (!targetShopId || typeof targetShopId !== "string") {
    return {
      authorized: false,
      error: "Target shop ID is required.",
      status: 400,
    };
  }

  // 1. Check Supabase authenticated user session (Shopkeeper or logged-in Employee)
  try {
    const serverSupabase = await createServerClient();
    const {
      data: { user },
    } = await serverSupabase.auth.getUser();

    if (user) {
      // Check if user is the shop owner
      const { data: ownedShop } = await serverSupabase
        .from("shops")
        .select("id")
        .eq("id", targetShopId)
        .eq("owner_id", user.id)
        .maybeSingle();

      if (ownedShop) {
        return {
          authorized: true,
          role: "owner",
          userId: user.id,
        };
      }

      // Check if user has an employee record in this shop
      const { data: empRecord } = await serverSupabase
        .from("employees")
        .select("id, role")
        .eq("shop_id", targetShopId)
        .eq("profile_id", user.id)
        .maybeSingle();

      if (empRecord) {
        return {
          authorized: true,
          role: empRecord.role || "employee",
          userId: user.id,
          employeeId: empRecord.id,
        };
      }
    }
  } catch (err) {
    // Continue to employee token check if Supabase session fails or is not present
  }

  // 2. Check signed Employee session token (cookie or Authorization header)
  const cookieToken = req.cookies.get("bishop_emp_session")?.value;
  const authHeader = req.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : null;
  const sessionToken = cookieToken || bearerToken;

  if (sessionToken) {
    const verified = verifyEmployeeSessionToken(sessionToken);
    if (verified.valid && verified.payload) {
      if (verified.payload.shop_id === targetShopId) {
        return {
          authorized: true,
          role: verified.payload.role || "staff",
          employeeId: verified.payload.employee_id,
        };
      } else {
        return {
          authorized: false,
          error: "Forbidden: You are not authorized to access resources for another shop.",
          status: 403,
        };
      }
    }
  }

  return {
    authorized: false,
    error: "Unauthorized: Active shopkeeper or employee session required.",
    status: 401,
  };
}
