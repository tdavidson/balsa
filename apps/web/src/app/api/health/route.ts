import { getDatabase } from "@finance/database";
import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";

export async function GET() {
  const secret = process.env.HEALTHCHECK_SECRET;
  const requestHeaders = await headers();
  if (secret && requestHeaders.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    await getDatabase().execute(sql`select 1`);
    return NextResponse.json({ status: "ok" });
  } catch {
    return NextResponse.json({ status: "unavailable" }, { status: 503 });
  }
}
