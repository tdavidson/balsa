import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { evidence, getDatabase, sources as sourceTable } from "@finance/database";
import { requireCompanyAccess } from "@/lib/auth";
import { computeFinancials } from "@/lib/financials";

function monthFromSource(source: { reportingMonth: string | null; statementPeriodEnd: string | null }) {
  return source.reportingMonth ?? source.statementPeriodEnd?.slice(0, 7) ?? undefined;
}

/**
 * Bank reconciliation per month: statement opening plus classified cash
 * movements against the statement ending balance, with the exceptions that
 * keep a month from being reliable.
 */
export async function GET() {
  await auth.protect();
  const context = await requireCompanyAccess();
  const db = getDatabase();
  const [financials, evidenceRows] = await Promise.all([
    computeFinancials(context.company.id),
    db.select({ id: evidence.id, sourceId: evidence.sourceId, sourceName: evidence.sourceName, reportingMonth: evidence.reportingMonth, statementPeriodEnd: evidence.statementPeriodEnd, status: evidence.status }).from(evidence).where(eq(evidence.companyId, context.company.id)),
  ]);
  const { output, input, duplicates, actualSources } = financials;
  const statementMonths = new Set((input.statementBalances ?? []).map((balance) => balance.month));
  const activityMonths = new Set(input.actuals.map((actual) => actual.month));
  const months = output.months.filter((month) => statementMonths.has(month.month) || activityMonths.has(month.month)).map((month) => {
    const actualLines = month.lines.filter((line) => line.kind === "actual");
    const opening = month.statement?.opening;
    const ending = month.statement?.ending;
    const receipts = month.actualReceipts;
    const spending = month.actualSpending;
    const expectedEnding = opening === undefined ? undefined : opening + receipts - spending;
    const difference = ending === undefined || expectedEnding === undefined ? undefined : ending - expectedEnding;
    const monthDuplicates = duplicates.filter((entry) => entry.month === month.month);
    const pendingSources = evidenceRows.filter((source) => source.status !== "approved" && monthFromSource(source) === month.month).map((source) => source.sourceName);
    const sourceNames = [...new Set(actualLines.map((line) => line.provenance.sourceName ?? (line.eventId ? actualSources.get(line.eventId)?.sourceName : undefined)).filter((name): name is string => Boolean(name)))];
    const uncategorized = actualLines.filter((line) => line.activity === "operating" && !line.category).length;
    const exceptions: string[] = [];
    if (opening === undefined || ending === undefined) exceptions.push("A statement opening and ending balance was not found in approved evidence.");
    if (difference !== undefined && Math.abs(difference) > 0.01) exceptions.push(`Balance roll-forward differs by $${Math.abs(difference).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`);
    if (monthDuplicates.length) exceptions.push(`${monthDuplicates.length} transaction${monthDuplicates.length === 1 ? " is" : "s are"} present in more than one source and were counted once.`);
    if (pendingSources.length) exceptions.push(`${pendingSources.length} source${pendingSources.length === 1 ? " is" : "s are"} still pending approval.`);
    if (uncategorized) exceptions.push(`${uncategorized} cash event${uncategorized === 1 ? " is" : "s are"} not categorized for the income statement.`);
    if (month.outstanding.payables.length && month.status !== "open") exceptions.push(`${month.outstanding.payables.length} expected payment${month.outstanding.payables.length === 1 ? " has" : "s have"} no matching transaction.`);
    return {
      month: month.month,
      status: exceptions.length ? "exception" : "reconciled",
      opening,
      ending,
      receipts,
      spending,
      net: receipts - spending,
      expectedEnding,
      difference,
      engineEndingCash: month.endingCash,
      transactionCount: actualLines.length,
      duplicateCount: monthDuplicates.length,
      duplicates: monthDuplicates,
      sourceNames,
      pendingSources,
      exceptions,
      transactions: actualLines.map((line) => ({ id: line.eventId ?? line.id, date: input.actuals.find((actual) => actual.id === line.eventId)?.date ?? null, description: line.description, amount: line.amount, direction: line.direction, activity: line.activity ?? "operating", category: line.category ?? null, settles: line.settles ?? null, sourceName: line.provenance.sourceName ?? (line.eventId ? actualSources.get(line.eventId)?.sourceName : undefined) ?? "Unknown source" })),
    };
  });
  const statusByMonth = new Map(months.map((month) => [month.month, month.status]));
  await Promise.all(evidenceRows.flatMap((source) => {
    if (!source.sourceId) return [];
    const month = monthFromSource(source);
    const status = source.status === "approved" && month && statusByMonth.get(month) === "reconciled" ? "reconciled" : "review";
    return [db.update(sourceTable).set({ ingestionStatus: status, ingestionError: null, processedAt: new Date() }).where(eq(sourceTable.id, source.sourceId))];
  }));
  return NextResponse.json({ months });
}
