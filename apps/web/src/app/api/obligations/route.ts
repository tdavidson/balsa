import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/auth";
import { computeFinancials } from "@/lib/financials";

/**
 * Obligations and agreements with what has settled them. Settlement comes from
 * the engine's matching (a persisted link, or same-month counterparty or
 * amount), never from substring matching on descriptions.
 */
export async function GET() {
  await auth.protect();
  const context = await requireCompanyAccess();
  const financials = await computeFinancials(context.company.id);
  const { output, input, itemRows } = financials;
  const actualAmounts = new Map(input.actuals.map((actual) => [actual.id, actual]));
  const asOf = input.asOfMonth;
  const describe = (type: "obligation" | "agreement") => [...itemRows.values()].filter((row) => row.type === type).map((row) => {
    const occurrences = output.expected.filter((event) => event.itemId === row.id);
    const due = occurrences.filter((event) => event.month <= asOf);
    const settled = occurrences.flatMap((event) => event.settledBy.map((actualId) => ({ actualId, month: event.month, amount: actualAmounts.get(actualId)?.amount ?? 0, description: actualAmounts.get(actualId)?.description ?? "" })));
    const settledAmount = settled.reduce((sum, entry) => sum + entry.amount, 0);
    const dueAmount = due.reduce((sum, event) => sum + event.amount, 0);
    const unpaid = due.filter((event) => !event.settledBy.length);
    return {
      id: row.id,
      label: row.label,
      counterparty: row.counterparty,
      amount: Number(row.amount ?? 0),
      cadence: row.cadence,
      category: row.category,
      basis: row.basis,
      effectiveFrom: row.effectiveFrom,
      effectiveTo: row.effectiveTo,
      evidenceId: row.evidenceId,
      accountingTreatment: row.accountingTreatment,
      recognitionStart: row.recognitionStart,
      recognitionEnd: row.recognitionEnd,
      dueToDate: dueAmount,
      settledAmount,
      unpaidAmount: unpaid.reduce((sum, event) => sum + event.amount, 0),
      unpaidMonths: unpaid.map((event) => event.month),
      nextExpected: occurrences.find((event) => event.month > asOf)?.month ?? null,
      settlements: settled,
      status: due.length && unpaid.length === 0 ? "settled" : unpaid.length ? "open" : "scheduled",
    };
  });
  const latest = output.months.at(-1);
  return NextResponse.json({ obligations: describe("obligation"), agreements: describe("agreement"), outstanding: latest?.outstanding ?? { receivables: [], payables: [] }, intercompany: latest?.intercompany ?? [] });
}
