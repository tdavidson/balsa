import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { cashEvents, evidence, getDatabase } from "@finance/database";
import { requireCompanyAccess } from "@/lib/auth";
import { financialEventKey, isDetailedFinancialEvent, isSweepCounterpartActivity, parseFinancialAmount } from "@/lib/financial-events";

type Balance = { amount: number; label: string; sourceName: string };

function monthFromSource(source: { reportingMonth: string | null; sourceName: string }) {
  return source.reportingMonth ?? source.sourceName.match(/dt-(20\d{2}-\d{2})(?:-\d{2})/i)?.[1];
}

function balanceKind(label: string) {
  if (/(?:beginning|opening|starting|total\s+(?:beginning|opening))/i.test(label) && /(?:cash|total value|balance)/i.test(label)) return "opening" as const;
  if (/(?:ending|closing|total\s+ending)/i.test(label) && /(?:cash|total value|balance)/i.test(label)) return "ending" as const;
  return undefined;
}

export async function GET() {
  await auth.protect();
  const context = await requireCompanyAccess();
  const db = getDatabase();
  const [sources, events] = await Promise.all([
    db.select({ id: evidence.id, sourceName: evidence.sourceName, reportingMonth: evidence.reportingMonth, extractedJson: evidence.extractedJson, status: evidence.status }).from(evidence).where(eq(evidence.companyId, context.company.id)),
    db.select({ id: cashEvents.id, month: cashEvents.month, transactionDate: cashEvents.transactionDate, amount: cashEvents.amount, direction: cashEvents.direction, category: cashEvents.category, description: cashEvents.description, evidenceId: cashEvents.evidenceId, evidenceStatus: evidence.status, sourceName: evidence.sourceName }).from(cashEvents).leftJoin(evidence, eq(cashEvents.evidenceId, evidence.id)).where(eq(cashEvents.companyId, context.company.id)),
  ]);

  const approvedSources = sources.filter((source) => source.status === "approved");
  const balances = new Map<string, { opening: Balance[]; ending: Balance[] }>();
  for (const source of approvedSources) {
    if (!source.extractedJson) continue;
    const month = monthFromSource(source);
    if (!month) continue;
    try {
      const extraction = JSON.parse(source.extractedJson) as { facts?: { label: string; value: string }[] };
      for (const fact of extraction.facts ?? []) {
        if (/this year|year-to-date|ytd/i.test(fact.label)) continue;
        const kind = balanceKind(fact.label);
        const amount = parseFinancialAmount(fact.value);
        if (!kind || amount === undefined) continue;
        const row = balances.get(month) ?? { opening: [], ending: [] };
        row[kind].push({ amount: Math.abs(amount), label: fact.label, sourceName: source.sourceName });
        balances.set(month, row);
      }
    } catch { /* keep the source visible through its transactions */ }
  }

  const seen = new Map<string, { count: number; sources: Set<string>; description: string }>();
  const usableEvents = events.filter((event) => event.evidenceStatus === "approved" || !event.evidenceId);
  const monthsWithCashFlowView = new Set(usableEvents.filter((event) => /^(?:Cash Flow Activity\b|\d{4}-\d{2}-\d{2}.*(?:Automated Payment|Wired Funds|Bank Product Withdrawal))/i.test(event.description)).map((event) => event.month));
  const canonicalEvents = usableEvents.filter((event) => !(monthsWithCashFlowView.has(event.month) && isSweepCounterpartActivity(event.description)));
  for (const event of canonicalEvents) {
    if (!isDetailedFinancialEvent(event.description)) continue;
    const key = financialEventKey(event);
    const existing = seen.get(key) ?? { count: 0, sources: new Set<string>(), description: event.description };
    existing.count += 1;
    if (event.sourceName) existing.sources.add(event.sourceName);
    seen.set(key, existing);
  }

  const monthNames = new Set<string>([...balances.keys(), ...canonicalEvents.map((event) => event.month)]);
  const months = [...monthNames].sort().map((month) => {
    const monthEvents = canonicalEvents.filter((event) => event.month === month && isDetailedFinancialEvent(event.description));
    const uniqueEvents = new Map<string, typeof monthEvents[number]>();
    for (const event of monthEvents) uniqueEvents.set(financialEventKey(event), event);
    const rows = [...uniqueEvents.values()];
    const receipts = rows.filter((event) => event.direction === "receipt").reduce((sum, event) => sum + Number(event.amount), 0);
    const spending = rows.filter((event) => event.direction === "spend").reduce((sum, event) => sum + Number(event.amount), 0);
    const balanceRow = balances.get(month) ?? { opening: [], ending: [] };
    const selectBalance = (entries: Balance[]) => {
      const cashEntries = entries.filter((entry) => /cash|cash\s+balance/i.test(entry.label));
      const candidates = cashEntries.length ? cashEntries : entries;
      const unique = [...new Map(candidates.map((entry) => [entry.amount, entry])).values()];
      return unique.length === 1 ? unique[0]!.amount : undefined;
    };
    const opening = selectBalance(balanceRow.opening);
    const ending = selectBalance(balanceRow.ending);
    const expectedEnding = opening === undefined ? undefined : opening + receipts - spending;
    const difference = ending === undefined || expectedEnding === undefined ? undefined : ending - expectedEnding;
    const duplicateEvents = [...seen.values()].filter((event) => event.count > 1 && [...event.sources].some((source) => monthEvents.some((candidate) => candidate.sourceName === source))).length;
    const pendingSources = sources.filter((source) => source.status !== "approved" && monthFromSource(source) === month).map((source) => source.sourceName);
    const sourceNames = [...new Set(rows.map((event) => event.sourceName).filter(Boolean))] as string[];
    const exceptions: string[] = [];
    if (opening === undefined || ending === undefined) exceptions.push("A unique opening and ending balance was not found in approved evidence.");
    if (difference !== undefined && Math.abs(difference) > 0.01) exceptions.push(`Balance roll-forward differs by $${Math.abs(difference).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`);
    if (duplicateEvents) exceptions.push(`${duplicateEvents} transaction${duplicateEvents === 1 ? " is" : "s are"} present in more than one source and require matching review.`);
    if (pendingSources.length) exceptions.push(`${pendingSources.length} source${pendingSources.length === 1 ? " is" : "s are"} still pending approval.`);
    if (rows.some((event) => event.category === "unclassified")) exceptions.push(`${rows.filter((event) => event.category === "unclassified").length} cash event${rows.filter((event) => event.category === "unclassified").length === 1 ? " is" : "s are"} not classified for accounting treatment.`);
    return {
      month,
      status: exceptions.length ? "exception" : "reconciled",
      opening,
      ending,
      receipts,
      spending,
      net: receipts - spending,
      expectedEnding,
      difference,
      transactionCount: rows.length,
      duplicateCount: duplicateEvents,
      sourceNames,
      pendingSources,
      balances: { opening: balanceRow.opening, ending: balanceRow.ending },
      exceptions,
      transactions: rows.map((event) => ({ id: event.id, date: event.transactionDate, description: event.description, amount: Number(event.amount), direction: event.direction, category: event.category, sourceName: event.sourceName ?? "Unknown source" })),
    };
  });
  return NextResponse.json({ months });
}
