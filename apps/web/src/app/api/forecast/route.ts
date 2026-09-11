import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { and, eq, isNull, or } from "drizzle-orm";
import { getDatabase, cashEvents, economicItems, evidence, reportingPeriods, sources } from "@finance/database";
import { buildMonthlyCash } from "@nevermodel/finance-engine";
import { requireCompanyAccess } from "@/lib/auth";
import { classifyCashActivity, inferFinancialDirection, isDetailedFinancialEvent, isSweepCounterpartActivity, parseFinancialAmount } from "@/lib/financial-events";
import { canonicalFinancialEvents } from "@/lib/canonical-financial-events";

function addMonths(month: string, count: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year!, monthNumber! - 1 + count, 1));
  return date.toISOString().slice(0, 7);
}

function sourceKind(metadata: string | null) {
  try { return (JSON.parse(metadata ?? "{}") as { classification?: { kind?: string } }).classification?.kind; } catch { return undefined; }
}

export async function GET() {
  await auth.protect();
  const context = await requireCompanyAccess();
  const sourceRows = await getDatabase().select({ sourceName: evidence.sourceName, extractedJson: evidence.extractedJson, reportingMonth: evidence.reportingMonth, status: evidence.status, statementPeriodEnd: evidence.statementPeriodEnd, openingBalance: evidence.openingBalance, endingBalance: evidence.endingBalance, accountEntityId: evidence.accountEntityId, accountIdentifier: evidence.accountIdentifier }).from(evidence).where(eq(evidence.companyId, context.company.id));
  const persisted = await getDatabase().select({ id: cashEvents.id, month: cashEvents.month, transactionDate: cashEvents.transactionDate, amount: cashEvents.amount, direction: cashEvents.direction, category: cashEvents.category, isActual: cashEvents.isActual, description: cashEvents.description, evidenceId: cashEvents.evidenceId, sourceName: evidence.sourceName, sourceMetadata: sources.metadata, evidenceStatus: evidence.status }).from(cashEvents).leftJoin(evidence, eq(cashEvents.evidenceId, evidence.id)).leftJoin(sources, eq(cashEvents.sourceId, sources.id)).where(and(eq(cashEvents.companyId, context.company.id), or(isNull(cashEvents.currency), eq(cashEvents.currency, context.company.baseCurrency))));
  const confirmedItems = await getDatabase().select({ id: economicItems.id, amount: economicItems.amount, direction: economicItems.direction, cadence: economicItems.cadence, sourceName: evidence.sourceName }).from(economicItems).leftJoin(evidence, eq(economicItems.evidenceId, evidence.id)).where(and(eq(economicItems.companyId, context.company.id), eq(economicItems.status, "confirmed")));
  const periods = await getDatabase().select({ month: reportingPeriods.month, openingCash: reportingPeriods.openingCash, status: reportingPeriods.status }).from(reportingPeriods).where(eq(reportingPeriods.companyId, context.company.id));
  const currentMonth = new Date().toISOString().slice(0, 7);
  const recurringEvents = confirmedItems.flatMap((item) => {
    const amount = Number(item.amount);
    if (!Number.isFinite(amount) || amount <= 0 || !item.cadence) return [];
    const cadence = /quarter/i.test(item.cadence) ? 3 : /annual|year/i.test(item.cadence) ? 12 : /month/i.test(item.cadence) ? 1 : 0;
    if (!cadence) return [];
    return Array.from({ length: 12 }, (_, index) => index).filter((index) => index % cadence === 0).map((index) => ({ month: addMonths(currentMonth, index), amount, kind: item.direction, actual: false, trace: { description: "Recurring confirmed item", evidenceId: item.id, sourceName: item.sourceName } }));
  });
  const monthsWithCashFlowView = new Set(persisted.filter((event) => /^(?:Cash Flow Activity\b|\d{4}-\d{2}-\d{2}.*(?:Automated Payment|Wired Funds|Bank Product Withdrawal))/i.test(event.description)).map((event) => event.month));
  const eligibleEvents = persisted.filter((event) => (event.evidenceStatus === "approved" || !event.evidenceId) && event.isActual === "Y" && !(monthsWithCashFlowView.has(event.month) && isSweepCounterpartActivity(event.description)) && isDetailedFinancialEvent(event.description) && event.category !== "transfer" && event.category !== "investment" && classifyCashActivity(event.description, event.direction) !== "transfer" && classifyCashActivity(event.description, event.direction) !== "investment");
  const persistedEvents = canonicalFinancialEvents(eligibleEvents.map((event) => ({ ...event, date: event.transactionDate, sourceKind: sourceKind(event.sourceMetadata) ?? null })), "cash").map((event) => {
    const actual = event.isActual === "Y";
    const kind = inferFinancialDirection(event.direction, event.description);
    return { month: event.month, amount: Number(event.amount), kind, actual, trace: { description: `${event.transactionDate ? `${event.transactionDate} · ` : ""}${event.description}`, evidenceId: event.evidenceId, sourceName: event.sourceName ?? null, amount: Number(event.amount), kind, actual } };
  });
  const events = [...persistedEvents, ...recurringEvents];
  const eventMonths = events.map((event) => event.month);
  const horizon = Array.from({ length: 12 }, (_, index) => addMonths(currentMonth, index));
  // Keep a complete calendar series so YTD and other period views include
  // zero-activity months. Forecasting is independent of close status.
  const calendarStart = `${currentMonth.slice(0, 4)}-01`;
  const calendarMonths = Array.from({ length: 20 }, (_, index) => addMonths(calendarStart, index));
  const months = [...new Set([...eventMonths, ...horizon, ...calendarMonths])].sort();
  const openingCash = Number(periods.find((period) => period.month === currentMonth)?.openingCash ?? periods[0]?.openingCash ?? 0);
  const monthSet = new Set(eventMonths);
  const paddedEvents = [...events, ...months.filter((month) => !monthSet.has(month)).map((month) => ({ month, amount: 0, kind: "receipt" as const, actual: false, trace: { description: "No source events", evidenceId: null } }))];
  const calculated = buildMonthlyCash(openingCash, paddedEvents);
  const statementOpeningCash = new Map<string, number>();
  const statementEndingCash = new Map<string, number>();
  for (const source of sourceRows) {
    if (source.status !== "approved" || !source.extractedJson) continue;
    try {
      const extraction = JSON.parse(source.extractedJson) as { facts?: { label: string; value: string }[] };
      const sourceMonth = source.reportingMonth ?? source.statementPeriodEnd?.slice(0, 7) ?? source.sourceName.match(/dt-(20\d{2}-\d{2})-\d{2}/i)?.[1];
      const facts = (extraction.facts ?? []).filter((fact) => !/year-to-date|this year|this year|account\s+\d/i.test(fact.label));
      const pick = (pattern: RegExp) => facts.filter((fact) => pattern.test(fact.label)).sort((a, b) => Number(/cash|cash\s+balance/i.test(b.label)) - Number(/cash|cash\s+balance/i.test(a.label)))[0];
      const opening = source.openingBalance ? Number(source.openingBalance) : parseFinancialAmount(pick(/(?:beginning|opening|starting|total\s+(?:beginning|opening)).*(?:cash|total value|balance)/i)?.value ?? "");
      const ending = source.endingBalance ? Number(source.endingBalance) : parseFinancialAmount(pick(/(?:ending|closing|total\s+ending).*(?:cash|total value|balance)/i)?.value ?? "");
      if (sourceMonth && opening !== undefined && Number.isFinite(opening)) statementOpeningCash.set(sourceMonth, (statementOpeningCash.get(sourceMonth) ?? 0) + Math.abs(opening));
      if (sourceMonth && ending !== undefined && Number.isFinite(ending)) statementEndingCash.set(sourceMonth, (statementEndingCash.get(sourceMonth) ?? 0) + Math.abs(ending));
    } catch { /* ignore malformed historical extraction */ }
  }
  const traceByMonth = new Map<string, { description: string; evidenceId: string | null; sourceName?: string | null | undefined }[]>();
  for (const event of paddedEvents) traceByMonth.set(event.month, [...(traceByMonth.get(event.month) ?? []), event.trace]);
  return NextResponse.json({ openingCash, months: calculated.map((month) => ({ ...month, openingCash: statementOpeningCash.get(month.month) ?? (month.month === currentMonth ? openingCash : undefined), endingCash: statementEndingCash.get(month.month) ?? month.endingCash, status: periods.find((period) => period.month === month.month)?.status ?? "open", trace: traceByMonth.get(month.month) ?? [] })) });
}
