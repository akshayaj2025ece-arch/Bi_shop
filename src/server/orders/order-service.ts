/**
 * Server-side Authoritative Order Processing Service for BISHOP.
 * Handles server-side price calculation, inventory reservation, idempotency,
 * token generation, products mapping, and transactional rollback on failure.
 */

if (typeof window !== "undefined") {
  throw new Error("Security Error: server-only module '@/server/orders/order-service' cannot be executed in browser context.");
}

import { createClient } from "@supabase/supabase-js";
import { checkAndRecordIdempotencyAsync, completeIdempotencyKeyAsync } from "@/server/common/idempotency";
import { emitDomainEvent } from "@/server/common/events";

export interface SubmitOrderCartItem {
  menu_item_id: string;
  name: string;
  price?: number;
  quantity: number;
  notes?: string;
  [key: string]: any;
}

export interface SubmitOrderParams {
  shopId: string;
  customerName?: string;
  customerPhone?: string;
  orderNotes?: string;
  cart: SubmitOrderCartItem[];
  subtotal?: number;
  tax?: number;
  total?: number;
  paymentMethod?: string;
  paymentStatus?: string;
  advanceAmount?: number;
  remainingAmount?: number;
  isPreOrder?: boolean;
  idempotencyKey?: string;
}

export interface SubmitOrderSuccessResult {
  success: true;
  orderId: string;
  orderNumber: string;
  tokenNumber: string;
  subtotal: number;
  tax: number;
  total: number;
}

export interface SubmitOrderFailureResult {
  success: false;
  error: string;
  code?: string;
  details?: string;
  hint?: string;
  status: number;
}

export type SubmitOrderResult = SubmitOrderSuccessResult | SubmitOrderFailureResult;

/**
 * Authoritative Order Submission Pipeline:
 * 1. Checks idempotency key to prevent duplicate orders and double deductions.
 * 2. Fetches active shop configuration and canonical tax rate from database.
 * 3. Authoritatively recalculates subtotal, tax, and grand_total using DB prices.
 * 4. Verifies menu item availability and ensures items belong strictly to target shop.
 * 5. Safely maps products FK table without destroying existing inventory records.
 * 6. Inserts master order and line items with automatic orphan rollback on failure.
 * 7. Atomically decrements inventory stock.
 * 8. Emits ORDER_CREATED domain event.
 */
export async function submitTakeawayOrder(params: SubmitOrderParams): Promise<SubmitOrderResult> {
  const {
    shopId,
    customerName,
    customerPhone,
    orderNotes,
    cart,
    paymentMethod = "pay_at_counter",
    // SECURITY: paymentStatus is ALWAYS server-controlled.
    // Clients must NOT be able to mark an order as 'paid' at creation time.
    // Payment confirmation is handled exclusively by verified payment callbacks.
    advanceAmount = 0,
    remainingAmount = 0,
    isPreOrder = false,
    idempotencyKey,
  } = params;
  const paymentStatus = "pending";

  if (!shopId || !cart || !Array.isArray(cart) || cart.length === 0) {
    return {
      success: false,
      error: "Invalid order payload: shopId and at least one cart item are required.",
      status: 400,
    };
  }

  // Generate collision-resistant idempotency key using full timestamp + cart fingerprint
  const effectiveIdempotencyKey =
    idempotencyKey ||
    (customerPhone && cart.length
      ? `ord_${shopId}_${customerPhone.replace(/\D/g, "")}_${Date.now()}_${cart.map(i => `${i.menu_item_id}:${i.quantity}`).sort().join(",")}`
      : undefined);

  if (effectiveIdempotencyKey) {
    const existingResult = await checkAndRecordIdempotencyAsync<SubmitOrderSuccessResult>(
      `order_${shopId}`,
      effectiveIdempotencyKey
    );
    if (existingResult.cached && existingResult.response) {
      console.log(`[IDEMPOTENCY] Replaying cached order response for key: ${effectiveIdempotencyKey}`);
      return existingResult.response;
    }
  }

  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || "";

  if (!rawUrl) {
    return {
      success: false,
      error: "Server configuration error: Database URL missing.",
      status: 500,
    };
  }

  // Use service role if available for privileged triggers/RLS bypass, otherwise anon key
  const supabase = createClient(rawUrl, serviceKey || anonKey);

  let createdOrderId: string | null = null;

  try {
    // 2. Fetch Shop Details & Verify Active Status
    const { data: shop, error: shopErr } = await supabase
      .from("shops")
      .select("id, name, is_active, tax_rate")
      .eq("id", shopId)
      .maybeSingle();

    if (shopErr || !shop) {
      return {
        success: false,
        error: "Shop not found or currently unavailable.",
        status: 404,
      };
    }

    if (shop.is_active === false) {
      return {
        success: false,
        error: `Shop "${shop.name}" is currently closed or inactive.`,
        status: 400,
      };
    }

    // 3. Fetch canonical menu items from database to verify prices and availability
    const menuItemIds = cart.map((i) => i.menu_item_id).filter(Boolean);
    if (menuItemIds.length !== cart.length) {
      return {
        success: false,
        error: "All cart items must have a valid menu_item_id.",
        status: 400,
      };
    }

    const { data: dbMenuItems, error: menuErr } = await supabase
      .from("menu_items")
      .select("id, name, price, is_available, shop_id")
      .in("id", menuItemIds)
      .eq("shop_id", shopId);

    if (menuErr || !dbMenuItems) {
      return {
        success: false,
        error: `Failed to retrieve menu items: ${menuErr?.message || "Unknown error"}`,
        status: 500,
      };
    }

    const dbMenuMap = new Map<string, any>();
    dbMenuItems.forEach((mi) => dbMenuMap.set(mi.id, mi));

    // 4. Server-Side Price & Quantity Validation
    let calculatedSubtotal = 0;
    const validatedItems: Array<{
      menu_item_id: string;
      name: string;
      unit_price: number;
      quantity: number;
      line_total: number;
      notes: string | null;
    }> = [];

    for (const item of cart) {
      const quantity = Math.floor(Number(item.quantity));
      if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 100) {
        return {
          success: false,
          error: `Invalid quantity (${item.quantity}) for item "${item.name}". Must be between 1 and 100.`,
          status: 400,
        };
      }

      const dbItem = dbMenuMap.get(item.menu_item_id);
      if (!dbItem) {
        return {
          success: false,
          error: `Item "${item.name}" does not belong to this shop or was removed.`,
          status: 400,
        };
      }

      if (dbItem.is_available === false) {
        return {
          success: false,
          error: `Item "${dbItem.name}" is currently marked out of stock.`,
          status: 400,
        };
      }

      // Authoritative unit price from trusted DB record
      const unitPrice = Number(dbItem.price) || 0;
      const lineTotal = Math.round(unitPrice * quantity * 100) / 100;
      calculatedSubtotal += lineTotal;

      validatedItems.push({
        menu_item_id: item.menu_item_id,
        name: dbItem.name,
        unit_price: unitPrice,
        quantity,
        line_total: lineTotal,
        notes: item.notes?.trim() || null,
      });
    }

    calculatedSubtotal = Math.round(calculatedSubtotal * 100) / 100;
    const taxRate = Number(shop.tax_rate) || 0;
    const calculatedTax = Math.round(calculatedSubtotal * (taxRate / 100) * 100) / 100;
    const calculatedTotal = Math.round((calculatedSubtotal + calculatedTax) * 100) / 100;

    // 4b. Pre-validate inventory stock availability before order insertion
    const { data: shopInventory } = await supabase
      .from("inventory")
      .select("id, name, quantity")
      .eq("shop_id", shopId);

    if (shopInventory && shopInventory.length > 0) {
      const invMap = new Map<string, { id: string; quantity: number }>();
      shopInventory.forEach((inv: any) => {
        if (inv.name) {
          invMap.set(inv.name.trim().toLowerCase(), {
            id: inv.id,
            quantity: Number(inv.quantity) || 0,
          });
        }
      });

      for (const item of validatedItems) {
        const invRecord = invMap.get(item.name.toLowerCase());
        if (invRecord && invRecord.quantity < item.quantity) {
          return {
            success: false,
            error: `Insufficient stock for "${item.name}". Available: ${invRecord.quantity}, requested: ${item.quantity}.`,
            status: 400,
          };
        }
      }
    }

    // 5. Generate identifiers
    const orderNumber = `BISHOP-${Math.floor(Date.now() / 1000).toString().slice(-4)}-${Math.floor(Math.random() * 900 + 100)}`;
    const numericToken = Math.floor(10000 + Math.random() * 90000);
    const finalTokenNumber = `BSH-${numericToken}`;
    const generatedOrderId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `ord_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    // 6. Ensure products table has mapping for order_items foreign key (without overwriting stock)
    if (serviceKey) {
      for (const item of validatedItems) {
        const { data: prods } = await supabase
          .from("products")
          .select("id")
          .eq("id", item.menu_item_id);

        if (!prods || prods.length === 0) {
          await supabase.from("products").insert({
            id: item.menu_item_id,
            shop_id: shopId,
            name: item.name,
            price: item.unit_price,
            stock_quantity: 0,
            is_available: true,
          });
        }
      }
    }

    // 7. Insert into orders table with verified totals
    const orderPayload = {
      id: generatedOrderId,
      shop_id: shopId,
      order_number: orderNumber,
      token_number: numericToken,
      customer_name: customerName?.trim() || "Guest",
      customer_phone: customerPhone?.trim() || null,
      table_number: "Takeaway",
      status: "preparing",
      subtotal: calculatedSubtotal,
      tax: calculatedTax,
      total: calculatedTotal,
      gst_amount: calculatedTax,
      grand_total: calculatedTotal,
      advance_amount: Number(advanceAmount) || 0,
      remaining_amount: Number(remainingAmount) || 0,
      is_pre_order: Boolean(isPreOrder),
      payment_method: paymentMethod,
      payment_status: paymentStatus,
      notes: orderNotes?.trim() || "Takeaway Cash Order",
    };

    const { error: ordErr } = await supabase.from("orders").insert(orderPayload);
    if (ordErr) {
      console.error("[API/orders/submit] Orders insert error:", ordErr);
      return {
        success: false,
        error: ordErr.message,
        code: ordErr.code,
        details: ordErr.details,
        hint: ordErr.hint,
        status: 500,
      };
    }

    createdOrderId = generatedOrderId;

    // 8. Insert into order_items table
    const itemInserts = validatedItems.map((item) => ({
      order_id: generatedOrderId,
      product_id: item.menu_item_id,
      product_name: item.name,
      unit_price: item.unit_price,
      quantity: item.quantity,
      line_total: item.line_total,
      notes: item.notes,
    }));

    const { error: itemsErr } = await supabase.from("order_items").insert(itemInserts);
    if (itemsErr) {
      console.error("[API/orders/submit] Order items insert error:", itemsErr);
      if (createdOrderId) {
        await supabase.from("orders").delete().eq("id", createdOrderId);
      }
      return {
        success: false,
        error: itemsErr.message,
        code: itemsErr.code,
        details: itemsErr.details,
        hint: itemsErr.hint,
        status: 500,
      };
    }

    // 9. Atomic inventory deduction with strict failure handling and saga compensation
    const successfullyDecremented: Array<{
      invId?: string;
      menuItemId: string;
      name: string;
      quantity: number;
    }> = [];
    let deductionFailed = false;
    let failureError = "";

    for (const item of validatedItems) {
      try {
        const { data: rpcRes, error: rpcErr } = await supabase.rpc(
          "decrement_inventory_stock",
          {
            p_shop_id: shopId,
            p_menu_item_id: item.menu_item_id,
            p_item_name: item.name,
            p_quantity: item.quantity,
          }
        );

        if (!rpcErr && rpcRes) {
          if (rpcRes.success === false) {
            deductionFailed = true;
            failureError = rpcRes.error || rpcRes.reason || `Insufficient stock for "${item.name}".`;
            break;
          }
          successfullyDecremented.push({
            invId: rpcRes.inventory_id,
            menuItemId: item.menu_item_id,
            name: item.name,
            quantity: item.quantity,
          });
        } else {
          // Fallback if RPC is not installed or returned error
          const { data: invRow } = await supabase
            .from("inventory")
            .select("id, quantity")
            .eq("shop_id", shopId)
            .ilike("name", item.name.trim())
            .maybeSingle();

          if (invRow) {
            const currentQty = Number(invRow.quantity) || 0;
            if (currentQty < item.quantity) {
              deductionFailed = true;
              failureError = `Insufficient stock for "${item.name}". Available: ${currentQty}, requested: ${item.quantity}.`;
              break;
            }

            const newQty = currentQty - item.quantity;
            const { error: invUpErr } = await supabase
              .from("inventory")
              .update({ quantity: newQty, updated_at: new Date().toISOString() })
              .eq("id", invRow.id);

            if (invUpErr) {
              deductionFailed = true;
              failureError = `Failed to update inventory for "${item.name}": ${invUpErr.message}`;
              break;
            }

            if (newQty === 0 && item.menu_item_id) {
              await supabase
                .from("menu_items")
                .update({ is_available: false, updated_at: new Date().toISOString() })
                .eq("id", item.menu_item_id);
            }

            successfullyDecremented.push({
              invId: invRow.id,
              menuItemId: item.menu_item_id,
              name: item.name,
              quantity: item.quantity,
            });
          }
        }
      } catch (invErr: any) {
        deductionFailed = true;
        failureError = invErr?.message || `Failed to deduct stock for "${item.name}".`;
        break;
      }
    }

    // Rollback order and compensate inventory if any deduction failed
    if (deductionFailed) {
      console.error(
        `[API/orders/submit] INVENTORY DEDUCTION FAILED for order ${generatedOrderId}: ${failureError}. Rolling back order.`
      );

      // 1. Compensate previously decremented items
      for (const comp of successfullyDecremented) {
        try {
          const { error: incErr } = await supabase.rpc("increment_inventory_stock", {
            p_shop_id: shopId,
            p_menu_item_id: comp.menuItemId,
            p_item_name: comp.name,
            p_quantity: comp.quantity,
          });

          if (incErr && comp.invId) {
            const { data: cur } = await supabase
              .from("inventory")
              .select("quantity")
              .eq("id", comp.invId)
              .maybeSingle();
            if (cur) {
              await supabase
                .from("inventory")
                .update({
                  quantity: (Number(cur.quantity) || 0) + comp.quantity,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", comp.invId);
              await supabase
                .from("menu_items")
                .update({ is_available: true, updated_at: new Date().toISOString() })
                .eq("id", comp.menuItemId);
            }
          }
        } catch (rollErr) {
          console.error(`[API/orders/submit] Failed to compensate stock for "${comp.name}":`, rollErr);
        }
      }

      // 2. Delete the created order and items from DB
      if (createdOrderId) {
        await supabase.from("order_items").delete().eq("order_id", createdOrderId);
        await supabase.from("orders").delete().eq("id", createdOrderId);
      }

      return {
        success: false,
        error: `Order placement cancelled due to inventory failure: ${failureError}`,
        status: 400,
      };
    }

    const successResult: SubmitOrderSuccessResult = {
      success: true,
      orderId: generatedOrderId,
      orderNumber: finalTokenNumber,
      tokenNumber: finalTokenNumber,
      subtotal: calculatedSubtotal,
      tax: calculatedTax,
      total: calculatedTotal,
    };

    // Cache in durable database idempotency store
    if (effectiveIdempotencyKey) {
      await completeIdempotencyKeyAsync(`order_${shopId}`, effectiveIdempotencyKey, successResult);
    }

    // Emit domain event
    emitDomainEvent("ORDER_CREATED", {
      orderId: generatedOrderId,
      shopId,
      orderNumber: finalTokenNumber,
      total: calculatedTotal,
      itemsCount: validatedItems.length,
      customerName: orderPayload.customer_name,
    });

    return successResult;
  } catch (error: any) {
    console.error("[API/orders/submit] Unhandled Exception:", error);

    // Rollback orphan order if created
    if (createdOrderId) {
      try {
        await supabase.from("order_items").delete().eq("order_id", createdOrderId);
        await supabase.from("orders").delete().eq("id", createdOrderId);
      } catch (cleanupErr) {
        console.error("[API/orders/submit] Cleanup error:", cleanupErr);
      }
    }

    return {
      success: false,
      error: error?.message || "Failed to process order",
      code: error?.code,
      details: error?.details,
      hint: error?.hint,
      status: 500,
    };
  }
}
