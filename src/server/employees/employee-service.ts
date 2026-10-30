/**
 * Server-side Employee Management Service for BISHOP.
 * Handles employee creation, Auth user provisioning via Admin Auth API,
 * shopkeeper ownership validation, profile upsert, and employee record insertion.
 */

if (typeof window !== "undefined") {
  throw new Error("Security Error: server-only module '@/server/employees/employee-service' cannot be executed in browser context.");
}

import { createClient as createServerClient } from "@/server/supabase/server-client";
import { createAdminClient } from "@/server/supabase/admin-client";

export interface CreateEmployeeParams {
  email: string;
  full_name: string;
  phone?: string | null;
  role?: string | null;
  salary?: string | number | null;
  shop_id: string;
}

export interface CreateEmployeeSuccessResult {
  success: true;
  message: string;
  profile_id: string;
}

export interface CreateEmployeeFailureResult {
  success: false;
  error: string;
  status: number;
}

export type CreateEmployeeResult = CreateEmployeeSuccessResult | CreateEmployeeFailureResult;

/**
 * Creates an employee for a shop:
 * 1. Validates server configuration (admin client).
 * 2. Verifies that the authenticated user owns the target shop.
 * 3. Checks if a profile or employee record already exists for the email and shop.
 * 4. Creates an Auth account via Supabase Admin Auth API if no profile exists.
 * 5. Upserts the user's profile with role 'employee'.
 * 6. Inserts the employee record into the `employees` table.
 */
export async function createEmployee(params: CreateEmployeeParams): Promise<CreateEmployeeResult> {
  const { email, full_name, phone, role, salary, shop_id } = params;

  const cleanEmail = email.trim().toLowerCase();
  const cleanName = full_name.trim();
  const cleanPhone = phone ? phone.trim() : null;

  // 1. Initialize Supabase Admin Client using Service Role Key (SERVER ONLY)
  const adminClient = createAdminClient();
  if (!adminClient) {
    return {
      success: false,
      error:
        "Server Configuration Error: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required to create employees securely.",
      status: 500,
    };
  }

  // 2. Get authenticated server client representing the active Shopkeeper
  const serverSupabase = await createServerClient();
  const {
    data: { user: currentUser },
  } = await serverSupabase.auth.getUser();

  // Strictly require authentication and verify shop ownership
  if (!currentUser) {
    return {
      success: false,
      error: "Unauthorized: Please log in to add employees.",
      status: 401,
    };
  }

  const { data: shopRecord } = await adminClient
    .from("shops")
    .select("id, owner_id")
    .eq("id", shop_id)
    .maybeSingle();

  if (!shopRecord || shopRecord.owner_id !== currentUser.id) {
    return {
      success: false,
      error: "Unauthorized: You can only add employees to your own shop.",
      status: 403,
    };
  }

  // 3. Check if profile already exists for this email
  let targetProfileId: string | null = null;
  const { data: existingProfiles } = await adminClient
    .from("profiles")
    .select("id, email, shop_id, role")
    .eq("email", cleanEmail);

  if (existingProfiles && existingProfiles.length > 0) {
    const existingProf = existingProfiles[0];
    if (existingProf.role === "shopkeeper") {
      return {
        success: false,
        error: `Cannot register "${cleanEmail}" as an employee: this email belongs to a registered shopkeeper account.`,
        status: 400,
      };
    }
    if (existingProf.shop_id && existingProf.shop_id !== shop_id) {
      return {
        success: false,
        error: `Cannot register "${cleanEmail}" as an employee: this account is already registered with another shop.`,
        status: 400,
      };
    }
    targetProfileId = existingProf.id;
  }

  // Check if employee record already exists for this shop
  if (targetProfileId) {
    const { data: existingEmp } = await adminClient
      .from("employees")
      .select("id")
      .eq("shop_id", shop_id)
      .eq("profile_id", targetProfileId)
      .maybeSingle();

    if (existingEmp) {
      return {
        success: false,
        error: `Employee "${cleanName}" (${cleanEmail}) is already added to your shop.`,
        status: 400,
      };
    }
  }

  // 4. Create Auth User using Admin Auth API (bypasses email confirmation & email rate limits)
  if (!targetProfileId) {
    const tempPassword = `Bishop_${Date.now().toString(36)}!`;

    const { data: adminUser, error: adminErr } = await adminClient.auth.admin.createUser({
      email: cleanEmail,
      password: tempPassword,
      email_confirm: true, // Pre-confirms account so no verification email is sent
      user_metadata: { full_name: cleanName, phone: cleanPhone },
    });

    if (adminUser?.user?.id) {
      targetProfileId = adminUser.user.id;
    } else if (adminErr) {
      // If user already exists in auth.users, try finding profile again
      const { data: foundProf } = await adminClient
        .from("profiles")
        .select("id")
        .eq("email", cleanEmail)
        .maybeSingle();

      if (foundProf?.id) {
        targetProfileId = foundProf.id;
      } else {
        return {
          success: false,
          error: adminErr.message || "Failed to create employee Auth account.",
          status: 400,
        };
      }
    }
  }

  if (!targetProfileId) {
    return {
      success: false,
      error: "Could not obtain a valid Auth User ID for employee.",
      status: 400,
    };
  }

  // 5. Upsert Profile using adminClient
  const profilePayload: any = {
    id: targetProfileId,
    email: cleanEmail,
    full_name: cleanName,
    role: "employee",
    shop_id: shop_id,
  };

  let { error: profileError } = await adminClient.from("profiles").upsert({
    ...profilePayload,
    phone: cleanPhone,
  });

  if (
    profileError &&
    (profileError.code === "PGRST204" || profileError.message?.includes("phone"))
  ) {
    const { error: profileErrorNoPhone } = await adminClient
      .from("profiles")
      .upsert(profilePayload);
    if (profileErrorNoPhone) {
      return {
        success: false,
        error: `Profile creation failed: ${profileErrorNoPhone.message}`,
        status: 400,
      };
    }
  } else if (profileError) {
    return {
      success: false,
      error: `Profile creation failed: ${profileError.message}`,
      status: 400,
    };
  }

  // 6. Insert into employees table
  const { error: empError } = await adminClient.from("employees").insert({
    shop_id: shop_id,
    profile_id: targetProfileId,
    role: role || "staff",
    salary: salary ? parseFloat(String(salary)) : null,
    is_active: true,
  });

  if (empError) {
    return {
      success: false,
      error: `Employee record creation failed: ${empError.message}`,
      status: 400,
    };
  }

  return {
    success: true,
    message: `Employee "${cleanName}" added successfully!`,
    profile_id: targetProfileId,
  };
}
