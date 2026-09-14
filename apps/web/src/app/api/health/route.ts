import { getDatabase } from "@finance/database";
import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { hasScheduledJobAuthorization } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const secret = process.env.HEALTHCHECK_SECRET;
  const requestHeaders = await headers();
  // A public liveness endpoint is useful locally, but production database
  // availability is operational information and must require a secret.
  if (process.env.NODE_ENV === "production" && !secret) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (secret && !hasScheduledJobAuthorization(requestHeaders.get("authorization"), secret)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    await getDatabase().execute(sql`select 1`);
    return NextResponse.json({ status: "ok" });
  } catch {
    return NextResponse.json({ status: "unavailable" }, { status: 503 });
  }
}
