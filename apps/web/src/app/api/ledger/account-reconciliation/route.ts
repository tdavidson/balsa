import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/auth";
import { loadJournalReconciliation } from "@/lib/journal-reconciliation";

/** Exact, source-backed account-balance comparison for a reporting period. */
export async function GET(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const period = new URL(request.url).searchParams.get("period");
  if (!period || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return NextResponse.json({ error: "period must be YYYY-MM" }, { status: 400 });
  const reconciliation = await loadJournalReconciliation(context.company.id, period);
  const accounts = reconciliation.accountBalances;
  const summary = Object.fromEntries(["reconciled", "mismatch", "unmapped_statement", "unmapped_ledger", "invalid_statement_amount"].map((status) => [status, accounts.filter((account) => account.status === status).length]));
  return NextResponse.json({ period, summary, accounts, verificationStatus: accounts.every((account) => account.status === "reconciled") ? "verified" : "unverified" });
}
