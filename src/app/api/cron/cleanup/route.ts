import { NextRequest, NextResponse } from "next/server";
import { pruneExpiredIdempotencyKeysAsync } from "@/server/common/idempotency";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/cleanup
 * Scheduled maintenance job for BISHOP.
 * Implements Topic 20 (Cron Jobs).
 *
 * Security:
 * - Authenticated via CRON_SECRET bearer token.
 * - Rejects unauthorized triggers with 401 Unauthorized.
 */
export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");
    const { searchParams } = new URL(req.url);
    const querySecret = searchParams.get("secret");

    const cronSecret = process.env.CRON_SECRET?.trim();

    // SECURITY: Always require CRON_SECRET. If not configured, deny all access.
    if (!cronSecret) {
      return NextResponse.json(
        { error: "Forbidden: CRON_SECRET is not configured on this server." },
        { status: 403 }
      );
    }

    const providedToken = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : querySecret?.trim();

    if (providedToken !== cronSecret) {
      return NextResponse.json(
        { error: "Unauthorized: Invalid or missing CRON_SECRET token." },
        { status: 401 }
      );
    }

    const prunedKeys = await pruneExpiredIdempotencyKeysAsync();

    console.log(`[CRON] /api/cron/cleanup executed successfully at ${new Date().toISOString()}. Pruned ${prunedKeys} expired idempotency keys.`);

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      tasks: {
        idempotencyPruned: prunedKeys,
      },
    });
  } catch (error: any) {
    console.error("[CRON] /api/cron/cleanup execution error:", error);
    return NextResponse.json(
      { error: error?.message || "Internal cron error." },
      { status: 500 }
    );
  }
}
