/**
 * Server-side Task Management Service for BISHOP.
 * Handles task querying, task assignment/creation, title regex parsing,
 * status transitions, inventory stock increment on task completion,
 * database verification, and notification dispatch.
 */

if (typeof window !== "undefined") {
  throw new Error("Security Error: server-only module '@/server/tasks/task-service' cannot be executed in browser context.");
}

import { createClient } from "@supabase/supabase-js";

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!supabaseUrl || !serviceKey) {
    throw new Error("Missing Supabase environment variables.");
  }

  return createClient(supabaseUrl, serviceKey);
}

// In-memory task cache for server context
const serverTaskStore = new Map<string, any>();

export function parseTaskItemsFromTitleOrDesc(title = "", description = ""): Array<{ name: string; quantity: number }> {
  const combined = `${title} ${description}`.trim();
  const itemsMap = new Map<string, number>();

  // Match pattern like "Puff (50)", "Puff (50 pcs)", "Samosa (20)", "Tea (10)"
  const regexParen = /([a-zA-Z0-9\s_-]+?)\s*\(\s*(\d+)\s*(?:pcs|pieces|l|g|kg)?\s*\)/gi;
  let match;
  while ((match = regexParen.exec(combined)) !== null) {
    let name = match[1].replace(/^(?:Stock Update|Update|Task|Refill)\s*[—\-:]?\s*/i, "").trim();
    name = name.replace(/^[\,\—\-:]+/, "").trim();
    const qty = parseInt(match[2], 10);
    if (name.length > 0 && qty > 0) {
      itemsMap.set(name, (itemsMap.get(name) || 0) + qty);
    }
  }

  if (itemsMap.size > 0) {
    return Array.from(itemsMap.entries()).map(([name, quantity]) => ({ name, quantity }));
  }

  // Match pattern like "Puff: 50" or "Puff x 50"
  const regexColon = /([a-zA-Z0-9\s_-]+?)\s*[:=x×]\s*(\d+)/gi;
  while ((match = regexColon.exec(combined)) !== null) {
    let name = match[1].replace(/^(?:Stock Update|Update|Task|Refill)\s*[—\-:]?\s*/i, "").trim();
    name = name.replace(/^[\,\—\-:]+/, "").trim();
    const qty = parseInt(match[2], 10);
    if (name.length > 0 && qty > 0) {
      itemsMap.set(name, (itemsMap.get(name) || 0) + qty);
    }
  }

  if (itemsMap.size > 0) {
    return Array.from(itemsMap.entries()).map(([name, quantity]) => ({ name, quantity }));
  }

  // Match pattern like "Add 50 Puff" or "50 Puff"
  const regexAdd = /(?:add|restock|update|fill|make|prepare|stock)?\s*(\d+)\s+([a-zA-Z0-9\s_-]+)/gi;
  while ((match = regexAdd.exec(combined)) !== null) {
    const qty = parseInt(match[1], 10);
    let name = match[2].replace(/\b(pcs|pieces|items|units|kg|l|g|boxes|packs)\b/gi, "").trim();
    if (qty > 0 && name.length > 0) {
      itemsMap.set(name, (itemsMap.get(name) || 0) + qty);
    }
  }

  return Array.from(itemsMap.entries()).map(([name, quantity]) => ({ name, quantity }));
}

export interface GetTasksSuccessResult {
  success: true;
  tasks: any[];
}

export interface GetTasksFailureResult {
  success: false;
  error: string;
  status: number;
}

export type GetTasksResult = GetTasksSuccessResult | GetTasksFailureResult;

/**
 * Fetches tasks for a shop with relations, falling back to simple query on join failure.
 */
export async function getEmployeeTasks(shopId: string, employeeId?: string | null): Promise<GetTasksResult> {
  const adminClient = getAdminClient();
  let query = adminClient
    .from("employee_tasks")
    .select(`
      *,
      employee:employees(
        id,
        role,
        profile:profiles(*)
      ),
      assigned_by_profile:profiles!employee_tasks_assigned_by_fkey(*)
    `)
    .eq("shop_id", shopId)
    .order("created_at", { ascending: false });

  if (employeeId) {
    query = query.eq("employee_id", employeeId);
  }

  const { data: dbTasks, error } = await query;

  if (error) {
    // Fallback query if join fails
    let fallbackQuery = adminClient
      .from("employee_tasks")
      .select("*")
      .eq("shop_id", shopId)
      .order("created_at", { ascending: false });

    if (employeeId) {
      fallbackQuery = fallbackQuery.eq("employee_id", employeeId);
    }

    const { data: fallbackTasks, error: fbErr } = await fallbackQuery;

    if (fbErr) {
      return {
        success: false,
        error: `Failed to fetch tasks: ${fbErr.message}`,
        status: 400,
      };
    }

    return { success: true, tasks: fallbackTasks || [] };
  }

  return { success: true, tasks: dbTasks || [] };
}

export interface UpdateTaskStatusParams {
  task_id: string;
  status: string;
  shop_id?: string | null;
  employee_id?: string | null;
  title?: string | null;
  description?: string | null;
  task_items?: any[] | null;
  items?: any[] | null;
  task?: any;
  task_title?: string | null;
  task_details?: string | null;
}

export interface UpdateTaskStatusSuccessResult {
  success: true;
  message: string;
  task: any;
  stockIncremented?: boolean;
  alreadyCompleted?: boolean;
}

export interface UpdateTaskStatusFailureResult {
  success: false;
  error: string;
  status: number;
  supabaseError?: any;
}

export type UpdateTaskStatusResult = UpdateTaskStatusSuccessResult | UpdateTaskStatusFailureResult;

/**
 * Updates task status with idempotency checks, inventory stock increment on completion,
 * and notification updates.
 */
export async function updateTaskStatus(params: UpdateTaskStatusParams): Promise<UpdateTaskStatusResult> {
  const { task_id, status, shop_id, employee_id, title, description } = params;

  const adminClient = getAdminClient();
  const nowStr = new Date().toISOString();

  // 1. Fetch current task from server cache or DB
  let existingTask: any = serverTaskStore.get(task_id);

  if (!existingTask) {
    try {
      const { data: dbTask } = await adminClient
        .from("employee_tasks")
        .select("*")
        .eq("id", task_id)
        .maybeSingle();

      if (dbTask) existingTask = dbTask;
    } catch {}
  }

  // Reject non-existent tasks
  if (!existingTask) {
    if (params.task && params.task.id === task_id && (params.task.shop_id === shop_id || !shop_id)) {
      existingTask = params.task;
      serverTaskStore.set(task_id, existingTask);
    } else {
      return {
        success: false,
        error: `Task "${task_id}" not found. Cannot update a non-existent task.`,
        status: 404,
      };
    }
  }

  const targetShopId = shop_id || existingTask.shop_id;

  // 2. IDEMPOTENCY CHECK: If task is ALREADY completed, return without adding stock again!
  if (existingTask.status === "completed") {
    console.log(`[IDEMPOTENCY PROTECTION] Task "${task_id}" is already completed. Skipping inventory increment.`);
    return {
      success: true,
      alreadyCompleted: true,
      message: "Task is already completed. Inventory remains unchanged.",
      task: existingTask,
    };
  }

  let stockIncremented = false;
  const completedItemSummaries: string[] = [];

  // 3. ORDER OF OPERATIONS: Perform Inventory Update BEFORE Marking Task Completed!
  if (status === "completed") {
    let taskItemsList: Array<{ name: string; quantity: number; inventory_id?: string; unit?: string }> = [];

    if (Array.isArray(existingTask.items) && existingTask.items.length > 0) {
      taskItemsList = existingTask.items;
    } else if (Array.isArray(existingTask.task_items) && existingTask.task_items.length > 0) {
      taskItemsList = existingTask.task_items;
    } else if (params.task_items && Array.isArray(params.task_items) && params.task_items.length > 0) {
      taskItemsList = params.task_items;
    } else if (params.items && Array.isArray(params.items) && params.items.length > 0) {
      taskItemsList = params.items;
    } else {
      taskItemsList = parseTaskItemsFromTitleOrDesc(existingTask.title, existingTask.description);
    }

    console.log(`[TASK COMPLETION START] Task ID: ${task_id}, Employee: ${existingTask.employee_id || employee_id}, Shop: ${targetShopId}`);
    console.log(`[TASK STATUS BEFORE COMPLETION]: "${existingTask.status}"`);
    console.log(`[TASK ITEMS TO PROCESS]:`, JSON.stringify(taskItemsList));

    if (taskItemsList.length === 0) {
      return {
        success: false,
        error: "No stock items found in task to update inventory.",
        status: 400,
      };
    }

    // Fetch existing inventory records for this shop directly from Supabase inventory table
    const { data: dbInventory, error: invFetchErr } = await adminClient
      .from("inventory")
      .select("*")
      .eq("shop_id", targetShopId);

    if (invFetchErr) {
      console.error("[INVENTORY FETCH ERROR]", invFetchErr);
      return {
        success: false,
        error: `Failed to fetch shop inventory: ${invFetchErr.message}`,
        supabaseError: {
          message: invFetchErr.message,
          code: invFetchErr.code,
          details: invFetchErr.details,
          hint: invFetchErr.hint,
        },
        status: 500,
      };
    }

    const inventoryList = dbInventory || [];

    // Prepare inventory update payloads
    const pendingUpdates: Array<{
      inventoryId: string;
      name: string;
      previousQty: number;
      taskQty: number;
      newQty: number;
      unit: string;
      isNew: boolean;
    }> = [];

    for (const tItem of taskItemsList) {
      const qtyToAdd = Math.max(0, Number(tItem.quantity) || 0);
      if (qtyToAdd <= 0 || !tItem.name) continue;

      const cleanItemName = tItem.name.trim();

      // Match existing inventory record by inventory_id or case-insensitive name
      let matchingInv = inventoryList.find(
        (inv: any) =>
          (tItem.inventory_id && inv.id === tItem.inventory_id) ||
          (inv.name && inv.name.trim().toLowerCase() === cleanItemName.toLowerCase())
      );

      if (!matchingInv && inventoryList.length > 0) {
        matchingInv = inventoryList.find(
          (inv: any) =>
            inv.name &&
            (inv.name.toLowerCase().includes(cleanItemName.toLowerCase()) ||
              cleanItemName.toLowerCase().includes(inv.name.toLowerCase()))
        );
      }

      if (matchingInv) {
        const existingQty = Number(matchingInv.quantity) || 0;
        const newQty = existingQty + qtyToAdd;
        pendingUpdates.push({
          inventoryId: matchingInv.id,
          name: matchingInv.name,
          previousQty: existingQty,
          taskQty: qtyToAdd,
          newQty: newQty,
          unit: matchingInv.unit || tItem.unit || "pcs",
          isNew: false,
        });
      } else {
        pendingUpdates.push({
          inventoryId: `new_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          name: cleanItemName,
          previousQty: 0,
          taskQty: qtyToAdd,
          newQty: qtyToAdd,
          unit: tItem.unit || "pcs",
          isNew: true,
        });
      }
    }

    if (pendingUpdates.length === 0) {
      return {
        success: false,
        error: "No valid item quantities to increment.",
        status: 400,
      };
    }

    // EXECUTE INVENTORY UPDATES FIRST AND VERIFY EACH ONE IN THE DATABASE
    for (const update of pendingUpdates) {
      console.log(`[INVENTORY UPDATE TRACE]
  - Task ID: ${task_id}
  - Employee ID: ${existingTask.employee_id || employee_id || 'N/A'}
  - Shop ID: ${targetShopId}
  - Inventory Item ID: ${update.inventoryId}
  - Item Name: "${update.name}"
  - Task Quantity: +${update.taskQty}
  - Existing Inventory Quantity: ${update.previousQty}
  - Calculated New Quantity: ${update.newQty}`);

      if (update.isNew) {
        const { data: insertedInv, error: insertErr } = await adminClient
          .from("inventory")
          .insert({
            shop_id: targetShopId,
            name: update.name,
            quantity: update.newQty,
            unit: update.unit,
            cost_per_unit: 0,
            min_quantity: 2,
            created_at: nowStr,
            updated_at: nowStr,
          })
          .select()
          .single();

        if (insertErr || !insertedInv) {
          console.error("[INVENTORY INSERT FAILED]", insertErr);
          return {
            success: false,
            error: `Failed to insert inventory record for "${update.name}": ${insertErr?.message}`,
            supabaseError: {
              message: insertErr?.message,
              code: insertErr?.code,
              details: insertErr?.details,
              hint: insertErr?.hint,
            },
            status: 400,
          };
        }

        completedItemSummaries.push(`${update.name}: 0 → ${update.newQty} ${update.unit}`);
      } else {
        // Update EXISTING inventory record
        const { error: updateErr } = await adminClient
          .from("inventory")
          .update({
            quantity: update.newQty,
            updated_at: nowStr,
          })
          .eq("id", update.inventoryId)
          .select()
          .single();

        if (updateErr) {
          console.error("[INVENTORY UPDATE FAILED]", updateErr);
          return {
            success: false,
            error: `Failed to update inventory quantity for "${update.name}": ${updateErr.message}`,
            supabaseError: {
              message: updateErr.message,
              code: updateErr.code,
              details: updateErr.details,
              hint: updateErr.hint,
            },
            status: 400,
          };
        }

        // VERIFY DATABASE RESULT IMMEDIATELY BY RE-QUERYING
        const { data: verifiedInv } = await adminClient
          .from("inventory")
          .select("quantity")
          .eq("id", update.inventoryId)
          .single();

        const verifiedQty = Number(verifiedInv?.quantity);
        console.log(`[VERIFY DATABASE RESULT] ${update.name} Verified Qty in DB = ${verifiedQty} (Expected: ${update.newQty})`);

        if (verifiedQty !== update.newQty) {
          console.error(`[DATABASE VERIFICATION FAILED] Expected ${update.newQty}, got ${verifiedQty}`);
          return {
            success: false,
            error: `Database verification failed for "${update.name}". Quantity in DB remains ${verifiedQty} instead of ${update.newQty}.`,
            status: 500,
          };
        }

        completedItemSummaries.push(`${update.name}: ${update.previousQty} → ${update.newQty} ${update.unit}`);

        // Also update menu_items availability
        await adminClient
          .from("menu_items")
          .update({
            is_available: update.newQty > 0,
            updated_at: nowStr,
          })
          .eq("shop_id", targetShopId)
          .ilike("name", update.name);
      }
    }

    stockIncremented = true;
  }

  // 4. ONLY AFTER ALL INVENTORY UPDATES SUCCEEDED AND ARE VERIFIED IN DATABASE, MARK TASK AS COMPLETED
  existingTask.status = status;
  existingTask.updated_at = nowStr;
  serverTaskStore.set(task_id, existingTask);

  try {
    await adminClient
      .from("employee_tasks")
      .update({
        status: status,
        updated_at: nowStr,
      })
      .eq("id", task_id);
  } catch {}

  const displayStatus =
    status === "in_progress" || status === "accepted"
      ? "In Progress"
      : status === "completed"
      ? "Completed"
      : "Pending";

  try {
    await adminClient
      .from("notifications")
      .update({
        metadata: {
          status: displayStatus,
        },
        updated_at: nowStr,
      })
      .eq("task_id", task_id);
  } catch {}

  return {
    success: true,
    message: stockIncremented
      ? `Task completed! Updated stock: ${completedItemSummaries.join(", ")} 🎉`
      : `Task status updated to ${displayStatus}`,
    task: existingTask,
    stockIncremented,
  };
}

export interface CreateTaskParams {
  shop_id: string;
  employee_id: string;
  title: string;
  description?: string | null;
  priority?: string | null;
  due_date?: string | null;
  assigned_by_id?: string | null;
  assigned_by_name?: string | null;
  shop_name?: string | null;
  employee_name?: string | null;
  employee_mobile?: string | null;
  employee_profile_id?: string | null;
  task_items?: any[] | null;
  items?: any[] | null;
}

export interface CreateTaskResultSuccess {
  success: true;
  message: string;
  task: any;
  isDuplicate?: boolean;
}

export interface CreateTaskResultFailure {
  success: false;
  error: string;
  status: number;
}

export type CreateTaskResult = CreateTaskResultSuccess | CreateTaskResultFailure;

/**
 * Creates a new task with 10s debounce idempotency check and notification generation.
 */
export async function createEmployeeTask(params: CreateTaskParams): Promise<CreateTaskResult> {
  const {
    shop_id,
    employee_id,
    title,
    description,
    priority,
    due_date,
    assigned_by_id,
    assigned_by_name,
    shop_name,
    employee_name,
    employee_mobile,
    employee_profile_id,
  } = params;

  const adminClient = getAdminClient();
  const nowStr = new Date().toISOString();

  // Idempotency check: Don't create duplicate task with same title for same employee within 10s
  const { data: existing } = await adminClient
    .from("employee_tasks")
    .select("*")
    .eq("shop_id", shop_id)
    .eq("employee_id", employee_id)
    .eq("title", title.trim())
    .order("created_at", { ascending: false })
    .limit(1);

  if (existing && existing.length > 0) {
    const timeDiff = new Date().getTime() - new Date(existing[0].created_at).getTime();
    if (timeDiff < 10000) {
      return {
        success: true,
        isDuplicate: true,
        task: existing[0],
        message: "Task already assigned recently.",
      };
    }
  }

  const taskItemsArray = params.task_items || params.items || null;

  // Insert new task
  const insertPayload: any = {
    shop_id,
    employee_id,
    title: title.trim(),
    description: description?.trim() || null,
    priority: priority || "medium",
    due_date: due_date || null,
    status: "pending",
    assigned_by: assigned_by_id || null,
    created_at: nowStr,
    updated_at: nowStr,
  };

  if (taskItemsArray && Array.isArray(taskItemsArray)) {
    insertPayload.items = taskItemsArray;
    insertPayload.task_items = taskItemsArray;
  }

  let createdTask: any = null;

  const resInsert = await adminClient
    .from("employee_tasks")
    .insert(insertPayload)
    .select()
    .single();

  if (resInsert.error) {
    // Fallback without items column if DB schema doesn't have items column yet
    delete insertPayload.items;
    delete insertPayload.task_items;
    const resFb = await adminClient
      .from("employee_tasks")
      .insert(insertPayload)
      .select()
      .single();

    createdTask = resFb.data;
  } else {
    createdTask = resInsert.data;
  }

  if (!createdTask) {
    createdTask = {
      id: `task_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      shop_id,
      employee_id,
      title: title.trim(),
      description: description?.trim() || "",
      priority: priority || "medium",
      due_date: due_date || "",
      status: "pending",
      assigned_by: assigned_by_id || null,
      created_at: nowStr,
      updated_at: nowStr,
      items: taskItemsArray || [],
      task_items: taskItemsArray || [],
    };
  } else {
    if (taskItemsArray) {
      createdTask.items = taskItemsArray;
      createdTask.task_items = taskItemsArray;
    }
  }

  serverTaskStore.set(createdTask.id, createdTask);

  // Create notification for employee
  if (employee_profile_id) {
    await adminClient.from("notifications").insert({
      shop_id,
      recipient_profile_id: employee_profile_id,
      employee_id,
      task_id: createdTask.id,
      title: "📋 New Task Assigned",
      message: `You have been assigned "${createdTask.title}" by ${assigned_by_name || "Shopkeeper"} at ${shop_name || "BISHOP Shop"}.`,
      type: "task_assigned",
      metadata: {
        employee_name: employee_name || "Employee",
        employee_mobile: employee_mobile || "",
        task_id: createdTask.id,
        task_title: createdTask.title,
        task_details: createdTask.description || "No additional details provided.",
        task_items: taskItemsArray,
        assigned_by_name: assigned_by_name || "Shopkeeper",
        shop_name: shop_name || "BISHOP Shop",
        date_time: nowStr,
        status: "Pending",
        due_date: createdTask.due_date || "No due date",
        priority: createdTask.priority,
      },
      is_read: false,
      created_at: nowStr,
      updated_at: nowStr,
    });
  }

  return {
    success: true,
    message: "Task created successfully!",
    task: createdTask,
  };
}
