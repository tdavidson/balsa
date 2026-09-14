import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/auth";
import { loadTrialBalance } from "@/lib/journal-ledger";

export async function GET(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const url = new URL(request.url);
  const period = url.searchParams.get("period");
  const entity = url.searchParams.get("entity") ?? undefined;
  if (!period || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return NextResponse.json({ error: "period must be YYYY-MM" }, { status: 400 });
  return NextResponse.json(await loadTrialBalance(context.company.id, period, entity));
}
