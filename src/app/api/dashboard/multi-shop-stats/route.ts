import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/server/supabase/server-client";
import { createAdminClient } from "@/server/supabase/admin-client";

export const dynamic = "force-dynamic";

/**
 * GET /api/dashboard/multi-shop-stats
 * Secure server-side multi-shop analytics API for BISHOP.
 *
 * Security & Ownership Architecture:
 * 1. Authenticates current user session via createServerClient().
 * 2. Checks profile role to strictly reject employees and unauthorized users.
 * 3. Resolves all shops owned by the authenticated shopkeeper (owner_id = user.id).
 * 4. Strictly validates any requested shopId against the user's owned shops.
 * 5. Uses verified target shop IDs to scope all database operations.
 */
export async function GET(req: NextRequest) {
  try {
    // 1. Authenticate user session
    const serverSupabase = await createServerClient();
    const {
      data: { user: currentUser },
      error: authError,
    } = await serverSupabase.auth.getUser();

    if (authError || !currentUser) {
      return NextResponse.json(
        { error: "Unauthorized: Please log in to view analytics." },
        { status: 401 }
      );
    }

    // 2. Verify role: strictly restricted to shopkeepers (reject employees)
    const { data: profile, error: profileError } = await serverSupabase
      .from("profiles")
      .select("id, role, shop_id")
      .eq("id", currentUser.id)
      .maybeSingle();

    if (profileError || !profile || profile.role === "employee") {
      return NextResponse.json(
        { error: "Forbidden: Multi-shop analytics is restricted to shopkeeper accounts." },
        { status: 403 }
      );
    }

    // 3. Fetch owned shops directly using owner_id = currentUser.id
    const { data: ownedShops, error: shopsError } = await serverSupabase
      .from("shops")
      .select("id, name, slug, currency, created_at")
      .eq("owner_id", currentUser.id)
      .order("created_at", { ascending: true });

    // Safe order amount helper strictly preferring grand_total, reconstructing financial total if needed
    function resolveOrderAmount(order: { grand_total?: number | null; subtotal?: number | null; gst_amount?: number | null }): number {
      if (order.grand_total !== null && order.grand_total !== undefined && !isNaN(Number(order.grand_total))) {
        return Number(order.grand_total);
      }
      if (order.subtotal !== null && order.subtotal !== undefined && !isNaN(Number(order.subtotal))) {
        const sub = Number(order.subtotal);
        const gst = order.gst_amount !== null && order.gst_amount !== undefined && !isNaN(Number(order.gst_amount))
          ? Number(order.gst_amount)
          : 0;
        return sub + gst;
      }
      return 0;
    }

    if (shopsError) {
      console.error("[API/dashboard/multi-shop-stats] Owned shops query error:", shopsError.message);
      return NextResponse.json(
        { error: "Failed to retrieve registered shops." },
        { status: 500 }
      );
    }

    if (!ownedShops || ownedShops.length === 0) {
      return NextResponse.json({
        success: true,
        scope: "all",
        selectedShopId: null,
        shopCount: 0,
        totalSales: 0,
        totalOrders: 0,
        avgOrderValue: 0,
        salesByShop: [],
        ordersByShop: [],
        salesTrend: [],
        topItems: [],
        lowStockItems: [],
        dateRange: {
          startDate: null,
          endDate: null,
        },
      });
    }

    const ownedShopIds = ownedShops.map((s) => s.id);
    const searchParams = req.nextUrl.searchParams;
    const requestedShopId = searchParams.get("shopId") || "all";
    const startDateParam = searchParams.get("startDate");
    const endDateParam = searchParams.get("endDate");
    const startUtcParam = searchParams.get("startUtc");
    const endExclusiveUtcParam = searchParams.get("endExclusiveUtc");

    // 4. Validate scope and shopId
    let targetShopIds: string[] = [];
    let scope: "all" | "individual" = "all";
    let selectedShopId: string | null = null;

    if (requestedShopId && requestedShopId !== "all") {
      const matched = ownedShops.find((s) => s.id === requestedShopId);
      if (!matched) {
        return NextResponse.json(
          { error: "Forbidden: Requested shop is not registered to your account." },
          { status: 403 }
        );
      }
      targetShopIds = [matched.id];
      scope = "individual";
      selectedShopId = matched.id;
    } else {
      targetShopIds = ownedShopIds;
      scope = "all";
    }

    // 5. Date validation & half-open boundary calculation
    let startUtc: string;
    let endExclusiveUtc: string;

    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    const validStartDate = startDateParam && datePattern.test(startDateParam) ? startDateParam : null;
    const validEndDate = endDateParam && datePattern.test(endDateParam) ? endDateParam : null;

    if (validStartDate && validEndDate && validStartDate > validEndDate) {
      return NextResponse.json(
        { error: "Invalid date range: Start date cannot be after end date." },
        { status: 400 }
      );
    }

    if (startUtcParam && endExclusiveUtcParam) {
      const sDate = new Date(startUtcParam);
      const eDate = new Date(endExclusiveUtcParam);
      if (isNaN(sDate.getTime()) || isNaN(eDate.getTime()) || sDate >= eDate) {
        return NextResponse.json(
          { error: "Invalid UTC date range parameters." },
          { status: 400 }
        );
      }
      startUtc = sDate.toISOString();
      endExclusiveUtc = eDate.toISOString();
    } else if (validStartDate && validEndDate) {
      const [sy, sm, sd] = validStartDate.split("-").map(Number);
      const [ey, em, ed] = validEndDate.split("-").map(Number);

      const sLocal = new Date(sy, sm - 1, sd, 0, 0, 0, 0);
      const eNextLocal = new Date(ey, em - 1, ed + 1, 0, 0, 0, 0);

      startUtc = sLocal.toISOString();
      endExclusiveUtc = eNextLocal.toISOString();
    } else {
      // Default: current calendar month in UTC fallback
      const now = new Date();
      const sDefault = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      const eDefault = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
      startUtc = sDefault.toISOString();
      endExclusiveUtc = eDefault.toISOString();
    }

    // 6. Database client: use adminClient if available to query verified multi-shop IDs
    const adminClient = createAdminClient();
    const db = adminClient || serverSupabase;

    // 7. Query orders across targetShopIds
    const ordersRes = await db
      .from("orders")
      .select("id, shop_id, order_number, grand_total, subtotal, gst_amount, status, payment_status, created_at")
      .in("shop_id", targetShopIds)
      .gte("created_at", startUtc)
      .lt("created_at", endExclusiveUtc)
      .neq("status", "cancelled")
      .order("created_at", { ascending: true });

    if (ordersRes.error) {
      console.error("[API/dashboard/multi-shop-stats] Orders query error:", ordersRes.error.message);
      return NextResponse.json(
        { error: "Failed to retrieve order analytics." },
        { status: 500 }
      );
    }

    const fetchedOrders = ordersRes.data || [];

    // Filter confirmed/paid orders (excluding cancelled)
    const confirmedOrders = fetchedOrders.filter(
      (o) => (o.status === "confirmed" || o.status === "paid" || o.payment_status === "paid") && o.status !== "cancelled"
    );

    // 8. Compute Total Sales, Orders, and Breakdown by Shop
    let totalSales = 0;
    const salesByShopMap: Record<string, number> = {};
    const ordersByShopMap: Record<string, number> = {};

    targetShopIds.forEach((id) => {
      salesByShopMap[id] = 0;
      ordersByShopMap[id] = 0;
    });

    for (const order of confirmedOrders) {
      const amount = resolveOrderAmount(order);
      totalSales += amount;
      if (salesByShopMap[order.shop_id] !== undefined) {
        salesByShopMap[order.shop_id] += amount;
        ordersByShopMap[order.shop_id] += 1;
      }
    }

    const totalOrders = confirmedOrders.length;
    const avgOrderValue = totalOrders > 0 ? Number((totalSales / totalOrders).toFixed(2)) : 0;

    const salesByShop = ownedShops
      .filter((s) => targetShopIds.includes(s.id))
      .map((s) => {
        const amount = Number((salesByShopMap[s.id] || 0).toFixed(2));
        const orderCount = ordersByShopMap[s.id] || 0;
        const percentage = totalSales > 0 ? Number(((amount / totalSales) * 100).toFixed(1)) : 0;
        return {
          shopId: s.id,
          shopName: s.name,
          totalSales: amount,
          totalOrders: orderCount,
          percentage,
        };
      })
      .sort((a, b) => b.totalSales - a.totalSales);

    const ordersByShop = salesByShop.map((s) => ({
      shopId: s.shopId,
      shopName: s.shopName,
      totalOrders: s.totalOrders,
      percentage: totalOrders > 0 ? Number(((s.totalOrders / totalOrders) * 100).toFixed(1)) : 0,
    }));

    // 9. Sales Trend
    const dailyMap = new Map<string, { revenue: number; orders: number }>();
    for (const order of confirmedOrders) {
      const dateKey = (order.created_at || "").slice(0, 10);
      const existing = dailyMap.get(dateKey) || { revenue: 0, orders: 0 };
      existing.revenue += resolveOrderAmount(order);
      existing.orders += 1;
      dailyMap.set(dateKey, existing);
    }

    const salesTrend = Array.from(dailyMap.entries())
      .map(([date, d]) => ({
        date,
        revenue: Number(d.revenue.toFixed(2)),
        orders: d.orders,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // 10. Best-Selling Items (scoped to confirmed order IDs)
    const confirmedOrderIds = confirmedOrders.map((o) => o.id);
    let topItems: { name: string; quantity: number; revenue: number }[] = [];

    if (confirmedOrderIds.length > 0) {
      const { data: itemRows, error: itemsError } = await db
        .from("order_items")
        .select("product_name, quantity, line_total")
        .in("order_id", confirmedOrderIds.slice(0, 1000))
        .limit(2500);

      if (itemsError) {
        console.error("[API/dashboard/multi-shop-stats] Order items query error:", itemsError.message);
        return NextResponse.json(
          { error: "Failed to retrieve order items analytics." },
          { status: 500 }
        );
      }

      if (itemRows && itemRows.length > 0) {
        const itemAgg = new Map<string, { quantity: number; revenue: number }>();
        for (const it of itemRows) {
          const name = it.product_name?.trim() || "Item";
          const qty = Number(it.quantity) || 0;
          const rev = Number(it.line_total) || 0;
          const ex = itemAgg.get(name) || { quantity: 0, revenue: 0 };
          ex.quantity += qty;
          ex.revenue += rev;
          itemAgg.set(name, ex);
        }

        topItems = Array.from(itemAgg.entries())
          .map(([name, data]) => ({
            name,
            quantity: data.quantity,
            revenue: Number(data.revenue.toFixed(2)),
          }))
          .sort((a, b) => b.quantity - a.quantity)
          .slice(0, 8);
      }
    }

    // 11. Low-Stock Items (Point-in-time inventory snapshot)
    const shopNameMap = new Map(ownedShops.map((s) => [s.id, s.name]));
    const { data: invRows, error: invError } = await db
      .from("inventory")
      .select("id, shop_id, name, quantity, min_quantity, unit")
      .in("shop_id", targetShopIds)
      .order("name", { ascending: true });

    if (invError) {
      console.error("[API/dashboard/multi-shop-stats] Inventory query error:", invError.message);
      return NextResponse.json(
        { error: "Failed to retrieve inventory items." },
        { status: 500 }
      );
    }

    const lowStockItems = (invRows || [])
      .filter((i) => {
        const q = Number(i.quantity) || 0;
        const minQ = Number(i.min_quantity) || 0;
        return q <= minQ || q === 0;
      })
      .map((i) => ({
        id: i.id,
        shopId: i.shop_id,
        shopName: shopNameMap.get(i.shop_id) || "Shop",
        name: i.name,
        quantity: Number(i.quantity) || 0,
        minQuantity: Number(i.min_quantity) || 0,
        unit: i.unit || "unit",
      }))
      .slice(0, 15);

    return NextResponse.json({
      success: true,
      scope,
      selectedShopId,
      shopCount: targetShopIds.length,
      totalSales: Number(totalSales.toFixed(2)),
      totalOrders,
      avgOrderValue,
      salesByShop,
      ordersByShop,
      salesTrend,
      topItems,
      lowStockItems,
      dateRange: {
        startDate: validStartDate || startUtc.slice(0, 10),
        endDate: validEndDate || endExclusiveUtc.slice(0, 10),
      },
    });
  } catch (err: any) {
    console.error("[API/dashboard/multi-shop-stats] Unexpected server error:", err);
    return NextResponse.json(
      { error: "Internal server error while processing analytics." },
      { status: 500 }
    );
  }
}
