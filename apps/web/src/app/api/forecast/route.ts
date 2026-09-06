import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { getDatabase, cashEvents, economicItems, evidence, reportingPeriods } from "@finance/database";
import { buildMonthlyCash } from "@nevermodel/finance-engine";
import { requireCompanyAccess } from "@/lib/auth";

function monthFromFact(value: string, fallback: string) {
  const yearMonth = value.match(/\b(20\d{2}-\d{2})\b/)?.[1];
  if (yearMonth) return yearMonth;
  const date = value.match(/\b(\d{1,2}\/\d{1,2}\/20\d{2})\b/)?.[1];
  if (!date) return fallback;
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString().slice(0, 7);
}

function addMonths(month: string, count: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year!, monthNumber! - 1 + count, 1));
  return date.toISOString().slice(0, 7);
}

export async function GET() {
  await auth.protect();
  const context = await requireCompanyAccess();
  const rows = await getDatabase().select({ id: evidence.id, sourceName: evidence.sourceName, extractedJson: evidence.extractedJson, status: evidence.status, reportingMonth: evidence.reportingMonth }).from(evidence).where(eq(evidence.companyId, context.company.id)).orderBy(desc(evidence.createdAt));
  const persisted = await getDatabase().select({ month: cashEvents.month, amount: cashEvents.amount, direction: cashEvents.direction, isActual: cashEvents.isActual, description: cashEvents.description, evidenceId: cashEvents.evidenceId, sourceName: evidence.sourceName }).from(cashEvents).leftJoin(evidence, eq(cashEvents.evidenceId, evidence.id)).where(eq(cashEvents.companyId, context.company.id));
  const confirmedItems = await getDatabase().select({ id: economicItems.id, amount: economicItems.amount, direction: economicItems.direction, cadence: economicItems.cadence, sourceName: evidence.sourceName }).from(economicItems).leftJoin(evidence, eq(economicItems.evidenceId, evidence.id)).where(and(eq(economicItems.companyId, context.company.id), eq(economicItems.status, "confirmed")));
  const periods = await getDatabase().select({ month: reportingPeriods.month, openingCash: reportingPeriods.openingCash, status: reportingPeriods.status }).from(reportingPeriods).where(eq(reportingPeriods.companyId, context.company.id));
  const currentMonth = new Date().toISOString().slice(0, 7);
  const recurringEvents = confirmedItems.flatMap((item) => {
    const amount = Number(item.amount);
    if (!Number.isFinite(amount) || amount <= 0 || !item.cadence) return [];
    const cadence = /quarter/i.test(item.cadence) ? 3 : /annual|year/i.test(item.cadence) ? 12 : /month/i.test(item.cadence) ? 1 : 0;
    if (!cadence) return [];
    return Array.from({ length: 12 }, (_, index) => index + 1).filter((index) => index % cadence === 0).map((index) => ({ month: addMonths(currentMonth, index), amount, kind: item.direction, actual: false, trace: { description: "Recurring confirmed item", evidenceId: item.id, sourceName: item.sourceName } }));
  });
  const events = [...persisted.map((event) => ({ month: event.month, amount: Number(event.amount), kind: event.direction, actual: event.isActual === "Y", trace: { description: event.description, evidenceId: event.evidenceId, sourceName: event.sourceName } })), ...recurringEvents, ...rows.filter((row) => row.status === "approved").flatMap((row) => {
    if (!row.extractedJson) return [];
    const extraction = JSON.parse(row.extractedJson) as { facts?: { label: string; value: string }[] };
    return (extraction.facts ?? []).flatMap((fact) => {
      const match = fact.value.match(/(?:\$|USD\s*)([\d,]+(?:\.\d+)?)/i);
      if (!match) return [];
      const amount = Number(match[1]!.replace(/,/g, ""));
      return [{ month: monthFromFact(fact.value, row.reportingMonth ?? new Date().toISOString().slice(0, 7)), amount, kind: /pay|spend|cost|expense/i.test(fact.value) ? "spend" as const : "receipt" as const, trace: { description: `${fact.label}: ${fact.value}`, evidenceId: row.id, sourceName: row.sourceName } }];
    });
  })];
  const eventMonths = events.map((event) => event.month);
  const horizon = Array.from({ length: 12 }, (_, index) => addMonths(currentMonth, index));
  const months = [...new Set([...eventMonths, ...horizon])].sort();
  const openingCash = Number(periods.find((period) => period.month === currentMonth)?.openingCash ?? periods[0]?.openingCash ?? 0);
  const monthSet = new Set(eventMonths);
  const paddedEvents = [...events, ...months.filter((month) => !monthSet.has(month)).map((month) => ({ month, amount: 0, kind: "receipt" as const, actual: false, trace: { description: "No source events", evidenceId: null } }))];
  const calculated = buildMonthlyCash(openingCash, paddedEvents);
  const traceByMonth = new Map<string, { description: string; evidenceId: string | null; sourceName?: string | null }[]>();
  for (const event of paddedEvents) traceByMonth.set(event.month, [...(traceByMonth.get(event.month) ?? []), event.trace]);
  return NextResponse.json({ openingCash, months: calculated.map((month) => ({ ...month, status: periods.find((period) => period.month === month.month)?.status ?? "open", trace: traceByMonth.get(month.month) ?? [] })) });
}
