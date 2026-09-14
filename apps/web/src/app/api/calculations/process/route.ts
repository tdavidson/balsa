import { NextResponse } from "next/server";
import { processQueuedCalculationJobs } from "@/lib/calculation-outbox";
import { hasScheduledJobAuthorization } from "@/lib/cron-auth";

/** Cron-only recovery path for calculation jobs that did not finish inline. */
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!hasScheduledJobAuthorization(request.headers.get("authorization"), secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { limit?: unknown };
  if (body.limit !== undefined && (typeof body.limit !== "number" || !Number.isInteger(body.limit) || body.limit < 1 || body.limit > 100)) return NextResponse.json({ error: "limit must be an integer from 1 to 100" }, { status: 400 });
  const limit = body.limit ?? 10;
  const results = await processQueuedCalculationJobs(limit);
  return NextResponse.json({ processed: results.length, results });
}
