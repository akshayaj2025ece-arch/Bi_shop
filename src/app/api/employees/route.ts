import { NextRequest, NextResponse } from "next/server";
import { createEmployee } from "@/server/employees";
import { createClient as createServerClient } from "@/server/supabase/server-client";

export async function POST(req: NextRequest) {
  try {
    const serverSupabase = await createServerClient();
    const {
      data: { user: currentUser },
      error: authError,
    } = await serverSupabase.auth.getUser();

    if (authError || !currentUser) {
      return NextResponse.json(
        { error: "Unauthorized: Please log in to manage employees." },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { email, full_name, phone, role, salary, shop_id } = body;

    if (!email || !full_name || !shop_id) {
      return NextResponse.json(
        { error: "Email, Full Name, and Shop ID are required." },
        { status: 400 }
      );
    }

    // Verify caller is the legitimate owner of the target shop
    const { data: ownedShop, error: shopError } = await serverSupabase
      .from("shops")
      .select("id")
      .eq("id", shop_id)
      .eq("owner_id", currentUser.id)
      .maybeSingle();

    if (shopError || !ownedShop) {
      return NextResponse.json(
        { error: "Forbidden: You are not authorized to add employees to this shop." },
        { status: 403 }
      );
    }

    const result = await createEmployee({
      email,
      full_name,
      phone,
      role,
      salary,
      shop_id,
    });

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status }
      );
    }

    return NextResponse.json({
      success: true,
      message: result.message,
      profile_id: result.profile_id,
    });
  } catch (err: any) {
    console.error("API /api/employees error:", err);
    return NextResponse.json(
      { error: err?.message || "Internal server error." },
      { status: 500 }
    );
  }
}
