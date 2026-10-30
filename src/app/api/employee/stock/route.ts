import { NextRequest, NextResponse } from "next/server";
import { getShopStock, updateShopStock } from "@/server/inventory";
import { verifyShopAccess } from "@/server/auth";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const shop_id = searchParams.get("shop_id");

    if (!shop_id) {
      return NextResponse.json(
        { error: "Shop ID is required." },
        { status: 400 }
      );
    }

    // Enforce tenant authorization: caller must be shopkeeper or verified employee for this shop
    const access = await verifyShopAccess(req, shop_id);
    if (!access.authorized) {
      return NextResponse.json(
        { error: access.error || "Unauthorized access to shop inventory." },
        { status: access.status || 401 }
      );
    }

    const result = await getShopStock(shop_id);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status }
      );
    }

    return NextResponse.json({
      success: true,
      items: result.items,
    });
  } catch (err: any) {
    console.error("API GET /api/employee/stock error:", err);
    return NextResponse.json(
      { error: err?.message || "Internal server error." },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { item_id, inventory_id, menu_item_id, name, quantity, is_available, shop_id } = body;

    if ((!item_id && !inventory_id && !menu_item_id && !name) || !shop_id) {
      return NextResponse.json(
        { error: "Item ID/Name and Shop ID are required." },
        { status: 400 }
      );
    }

    // Enforce tenant authorization for stock modifications
    const access = await verifyShopAccess(req, shop_id);
    if (!access.authorized) {
      return NextResponse.json(
        { error: access.error || "Unauthorized access to modify shop inventory." },
        { status: access.status || 401 }
      );
    }

    const result = await updateShopStock({
      item_id,
      inventory_id,
      menu_item_id,
      name,
      quantity,
      is_available,
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
      updated: result.updated,
    });
  } catch (err: any) {
    console.error("API POST /api/employee/stock error:", err);
    return NextResponse.json(
      { error: err?.message || "Internal server error." },
      { status: 500 }
    );
  }
}
