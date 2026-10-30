/**
 * Server-side Employee Verification Service for BISHOP.
 * Handles fuzzy name matching, phone normalization, and shop matching for employee dashboard access.
 */

if (typeof window !== "undefined") {
  throw new Error("Security Error: server-only module '@/server/employees/employee-verify-service' cannot be executed in browser context.");
}

import { createClient } from "@supabase/supabase-js";
import { createEmployeeSessionToken } from "@/server/auth";

export interface VerifyEmployeeParams {
  name: string;
  shop_name: string;
  phone: string;
}

export interface VerifiedEmployeeData {
  employee_id: string;
  profile_id: string;
  full_name: string;
  phone: string;
  role: string;
  shop_id: string;
  shop_name: string;
  token: string;
}

export interface VerifyEmployeeSuccessResult {
  success: true;
  employee: VerifiedEmployeeData;
}

export interface VerifyEmployeeFailureResult {
  success: false;
  error: string;
  status: number;
}

export type VerifyEmployeeResult = VerifyEmployeeSuccessResult | VerifyEmployeeFailureResult;

/**
 * Verifies employee registration for a shop:
 * 1. Normalizes name, shop name, and phone digits.
 * 2. Fetches all employees joining profiles and shops.
 * 3. Filters employees matching phone/name and shop name/slug.
 * 4. Returns the best matching employee record.
 */
export async function verifyEmployee(params: VerifyEmployeeParams): Promise<VerifyEmployeeResult> {
  const { name, shop_name, phone } = params;

  const cleanName = name.trim();
  const cleanShopName = shop_name.trim();
  const cleanPhone = phone.trim().replace(/\s+/g, "");
  const digitsOnly = cleanPhone.replace(/\D/g, "");

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!supabaseUrl || !serviceKey) {
    return {
      success: false,
      error: "Server Configuration Error: SUPABASE_SERVICE_ROLE_KEY is required for employee verification.",
      status: 500,
    };
  }

  const adminClient = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1. Fetch employees for the matching shop only (not all employees globally)
  // First resolve the shop by name, slug, or ID
  const cleanShopNorm = cleanShopName.toLowerCase().replace(/\s+/g, " ");
  const { data: matchingShops } = await adminClient
    .from("shops")
    .select("id")
    .or(`name.ilike.%${cleanShopNorm}%,slug.ilike.%${cleanShopNorm}%,id.eq.${cleanShopName}`);

  const shopIds = matchingShops?.map((s: any) => s.id) || [];
  if (shopIds.length === 0) {
    return {
      success: false,
      error: `Shop "${cleanShopName}" not found.`,
      status: 400,
    };
  }

  const { data: allEmployees, error: empErr } = await adminClient
    .from("employees")
    .select(`
      id,
      shop_id,
      profile_id,
      role,
      is_active,
      shop:shops(*),
      profile:profiles(*)
    `)
    .in("shop_id", shopIds)
    .eq("is_active", true);

  if (empErr || !allEmployees || allEmployees.length === 0) {
    return {
      success: false,
      error: "Employee not registered for this shop.",
      status: 400,
    };
  }

  // 2. Filter employees requiring BOTH exact/clean phone AND name match with shop
  const matchingEmployees = allEmployees.filter((emp) => {
    const prof = emp.profile as any;
    const shp = emp.shop as any;
    if (!prof || !shp) return false;

    const profPhoneDigits = (prof.phone || "").replace(/\D/g, "");
    const normInputDigits = digitsOnly.slice(-10);
    const normProfDigits = profPhoneDigits.slice(-10);

    const phoneMatches =
      normInputDigits.length >= 8 &&
      normProfDigits.length >= 8 &&
      (normInputDigits === normProfDigits || digitsOnly === profPhoneDigits);

    // Name matching: require exact match or minimum 3-character prefix match (Fix #21)
    const cleanNameNorm = cleanName.toLowerCase().replace(/\s+/g, " ");
    const profNameNorm = (prof.full_name || "").toLowerCase().replace(/\s+/g, " ");
    const nameMatches =
      cleanNameNorm === profNameNorm ||
      (cleanNameNorm.length >= 3 && profNameNorm.startsWith(cleanNameNorm)) ||
      (profNameNorm.length >= 3 && cleanNameNorm.startsWith(profNameNorm));

    const shopNameNorm = (shp.name || "").toLowerCase().replace(/\s+/g, " ");
    const shopSlugNorm = (shp.slug || "").toLowerCase().replace(/\s+/g, " ");
    const shopMatches =
      cleanShopNorm === shopNameNorm ||
      cleanShopNorm === shopSlugNorm ||
      shp.id === cleanShopName;

    // Both identity credentials (phone AND name) MUST match the registered employee
    return phoneMatches && nameMatches && shopMatches;
  });

  if (matchingEmployees.length === 0) {
    return {
      success: false,
      error: `Employee "${cleanName}" not registered for shop "${cleanShopName}" with phone "${cleanPhone}".`,
      status: 400,
    };
  }

  // Pick best matching employee record (preferably one with active role)
  const matchedEmp = matchingEmployees[0];
  const prof = matchedEmp.profile as any;
  const shp = matchedEmp.shop as any;

  // Issue cryptographic, tamper-proof session token for employee operations
  const sessionToken = createEmployeeSessionToken({
    employee_id: matchedEmp.id,
    profile_id: matchedEmp.profile_id,
    shop_id: shp.id,
    role: matchedEmp.role || "staff",
  });

  return {
    success: true,
    employee: {
      employee_id: matchedEmp.id,
      profile_id: matchedEmp.profile_id,
      full_name: prof.full_name || cleanName,
      phone: prof.phone || cleanPhone,
      role: matchedEmp.role || "staff",
      shop_id: shp.id,
      shop_name: shp.name,
      token: sessionToken,
    },
  };
}
