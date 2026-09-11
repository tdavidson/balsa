import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { isValidMonth } from "@nevermodel/finance-engine";
import { requireCompanyAccess } from "@/lib/auth";
import { computeFinancials, pnlMonthView } from "@/lib/financials";

/**
 * The three statements per month for one view: a legal entity, or the
 * consolidated group. Balances derive from the same lines as the income
 * statement, so the statements tie by construction.
 */
export async function GET(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const url = new URL(request.url);
  const entity = url.searchParams.get("entity") ?? undefined;
  const scenarioId = url.searchParams.get("scenario") ?? undefined;
  const start = url.searchParams.get("start") ?? undefined;
  const end = url.searchParams.get("end") ?? undefined;
  const financials = await computeFinancials(context.company.id, { ...(entity ? { entity } : {}), ...(scenarioId ? { scenarioId } : {}) });
  const months = financials.output.months.filter((month) => (!start || !isValidMonth(start) || month.month >= start) && (!end || !isValidMonth(end) || month.month <= end));
  return NextResponse.json({
    view: financials.view,
    entities: financials.structure.legalEntities,
    accounts: financials.structure.accounts.map((account) => ({ id: account.id, name: account.name, ownerEntityId: account.ownerEntityId })),
    asOfMonth: financials.input.asOfMonth,
    months: months.map((month) => ({
      month: month.month,
      status: month.status,
      incomeStatement: pnlMonthView(month),
      balanceSheet: month.balanceSheet,
      cashFlow: month.cashFlow,
      intercompany: month.intercompany,
      outstanding: { receivables: month.outstanding.receivables.length, payables: month.outstanding.payables.length },
    })),
  });
}
