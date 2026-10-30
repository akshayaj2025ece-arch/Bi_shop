import { NextRequest, NextResponse } from "next/server";
import {
  getEmployeeTasks,
  updateTaskStatus,
  createEmployeeTask,
} from "@/server/tasks";
import { verifyShopAccess } from "@/server/auth";

// GET /api/employee/tasks?shop_id=...&employee_id=...
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const shop_id = searchParams.get("shop_id");
    const employee_id = searchParams.get("employee_id");

    if (!shop_id) {
      return NextResponse.json(
        { error: "shop_id parameter is required." },
        { status: 400 }
      );
    }

    // Verify caller has authorized access to this shop
    const access = await verifyShopAccess(req, shop_id);
    if (!access.authorized) {
      return NextResponse.json(
        { error: access.error || "Unauthorized access to shop tasks." },
        { status: access.status || 401 }
      );
    }

    const result = await getEmployeeTasks(shop_id, employee_id);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status }
      );
    }

    return NextResponse.json({ success: true, tasks: result.tasks });
  } catch (err: any) {
    console.error("GET /api/employee/tasks error:", err);
    return NextResponse.json(
      { error: err?.message || "Internal server error." },
      { status: 500 }
    );
  }
}

// POST /api/employee/tasks
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      action,
      task_id,
      status,
      shop_id,
      employee_id,
      employee_profile_id,
      title,
      description,
      priority,
      due_date,
      assigned_by_id,
      assigned_by_name,
      shop_name,
      employee_name,
      employee_mobile,
    } = body;

    const targetShopId = shop_id || body.task?.shop_id;
    if (!targetShopId) {
      return NextResponse.json(
        { error: "shop_id is required." },
        { status: 400 }
      );
    }

    // Verify caller has authorized access to this shop
    const access = await verifyShopAccess(req, targetShopId);
    if (!access.authorized) {
      return NextResponse.json(
        { error: access.error || "Unauthorized access to manage shop tasks." },
        { status: access.status || 401 }
      );
    }

    // ACTION 1: UPDATE TASK STATUS (e.g. pending -> in_progress -> completed)
    if (action === "update_status") {
      if (!task_id || !status) {
        return NextResponse.json(
          { error: "task_id and status are required for status update." },
          { status: 400 }
        );
      }

      const result = await updateTaskStatus({
        task_id,
        status,
        shop_id,
        employee_id,
        title,
        description,
        task_items: body.task_items,
        items: body.items,
        task: body.task,
        task_title: body.task_title,
        task_details: body.task_details,
      });

      if (!result.success) {
        return NextResponse.json(
          {
            error: result.error,
            ...(result.supabaseError ? { supabaseError: result.supabaseError } : {}),
          },
          { status: result.status }
        );
      }

      return NextResponse.json({
        success: true,
        ...(result.alreadyCompleted ? { alreadyCompleted: true } : {}),
        message: result.message,
        task: result.task,
        ...(result.stockIncremented !== undefined ? { stockIncremented: result.stockIncremented } : {}),
      });
    }

    // ACTION 2: CREATE NEW TASK
    if (action === "create" || !action) {
      if (!shop_id || !employee_id || !title) {
        return NextResponse.json(
          { error: "shop_id, employee_id, and title are required to create a task." },
          { status: 400 }
        );
      }

      const result = await createEmployeeTask({
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
        task_items: body.task_items,
        items: body.items,
      });

      if (!result.success) {
        return NextResponse.json(
          { error: result.error },
          { status: result.status }
        );
      }

      return NextResponse.json({
        success: true,
        ...(result.isDuplicate ? { isDuplicate: true } : {}),
        message: result.message,
        task: result.task,
      });
    }

    return NextResponse.json({ error: "Invalid action." }, { status: 400 });
  } catch (err: any) {
    console.error("POST /api/employee/tasks error:", err);
    return NextResponse.json(
      { error: err?.message || "Internal server error." },
      { status: 500 }
    );
  }
}
