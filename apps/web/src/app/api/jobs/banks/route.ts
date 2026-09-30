import { NextResponse } from "next/server";
import { hasScheduledJobAuthorization } from "@/lib/cron-auth";
import { dueBankConnections, syncBankConnection } from "@/lib/bank-connections";
import { bankErrorResponse } from "@/lib/bank-http";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: Request) {
  if (!hasScheduledJobAuthorization(request.headers.get("authorization"), process.env.CRON_SECRET)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!process.env.TELLER_APPLICATION_ID) return NextResponse.json({ enabled: false, synced: 0 });
  try { const due = await dueBankConnections(); for (const job of due) await syncBankConnection(job.companyId, job.id, null); return NextResponse.json({ enabled: true, synced: due.length }); }
  catch (error) { return bankErrorResponse(error); }
}
