import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/auth";
import { loadJournalReconciliation } from "@/lib/journal-reconciliation";

/**
 * Source-based journal control summary. The former event-engine comparison was
 * removed: legacy event totals are not accounting evidence and cannot certify
 * or discredit an entry-graph result.
 */
export async function GET(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const period = new URL(request.url).searchParams.get("period");
  if (!period || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return NextResponse.json({ error: "period must be YYYY-MM" }, { status: 400 });
  const reconciliation = await loadJournalReconciliation(context.company.id, period);
  return NextResponse.json({ period, trialBalance: reconciliation.trialBalance, statements: reconciliation.statements, sourceToLedger: reconciliation.report, accountBalances: reconciliation.accountBalances, authority: reconciliation.authority, status: reconciliation.authority.eligible ? "eligible_for_promotion" : reconciliation.report.verificationStatus });
}
