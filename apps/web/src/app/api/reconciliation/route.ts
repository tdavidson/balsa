import { auth } from "@/lib/auth";
import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { cashEvents, companies, evidence, getDatabase, ingestionRuns, reconciliationEntries, reviewItems, sources as sourceTable } from "@finance/database";
import { requireCompanyAccess } from "@/lib/auth";
import { isDetailedFinancialEvent, isSweepCounterpartActivity, parseFinancialAmount } from "@/lib/financial-events";
import { validateStatementRollforward } from "@nevermodel/ingestion";
import { matchTransactionsAcrossSources } from "@/lib/transaction-matching";
import { buildReconciliationReview } from "@/lib/reconciliation-review";
import { buildReconciliationLedger } from "@/lib/reconciliation-ledger";
import { compareStatementAndBookBalances } from "@/lib/account-balance-matching";
import { hasScheduledJobAuthorization } from "@/lib/cron-auth";

type Balance = { amount: number; label: string; sourceName: string };

function monthFromSource(source: { reportingMonth: string | null; statementPeriodStart: string | null; statementPeriodEnd: string | null; sourceName: string }) {
  return source.reportingMonth ?? source.statementPeriodStart?.slice(0, 7) ?? source.statementPeriodEnd?.slice(0, 7) ?? source.sourceName.match(/dt-(20\d{2}-\d{2})(?:-\d{2})/i)?.[1];
}

function balanceKind(label: string) {
  if (/(?:beginning|opening|starting|total\s+(?:beginning|opening))/i.test(label) && /(?:cash|total value|balance)/i.test(label)) return "opening" as const;
  if (/(?:ending|closing|total\s+ending)/i.test(label) && /(?:cash|total value|balance)/i.test(label)) return "ending" as const;
  return undefined;
}

function previousMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year!, monthNumber! - 2, 1));
  return date.toISOString().slice(0, 7);
}

function sourceKind(metadata: string | null) {
  try {
    const parsed = JSON.parse(metadata ?? "{}") as { classification?: { kind?: string } };
    return parsed.classification?.kind;
  } catch { return undefined; }
}

async function handleReconciliation(request: Request, persist: boolean) {
  const db = getDatabase();
  const requestedCompanyId = new URL(request.url).searchParams.get("companyId");
  const workerSecret = process.env.CRON_SECRET;
  const isWorkerRequest = Boolean(requestedCompanyId && hasScheduledJobAuthorization(request.headers.get("authorization"), workerSecret));
  let context: Awaited<ReturnType<typeof requireCompanyAccess>> | { company: typeof companies.$inferSelect };
  if (isWorkerRequest) {
    const [company] = await db.select().from(companies).where(eq(companies.id, requestedCompanyId!));
    if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });
    context = { company };
  } else {
    await auth.protect();
    context = await requireCompanyAccess();
  }
  const [evidenceRows, events] = await Promise.all([
    db.select({ id: evidence.id, sourceId: evidence.sourceId, sourceName: evidence.sourceName, sourceMetadata: sourceTable.metadata, reportingMonth: evidence.reportingMonth, statementPeriodStart: evidence.statementPeriodStart, statementPeriodEnd: evidence.statementPeriodEnd, openingBalance: evidence.openingBalance, endingBalance: evidence.endingBalance, currency: evidence.currency, accountIdentifier: evidence.accountIdentifier, accountEntityId: evidence.accountEntityId, extractedJson: evidence.extractedJson, status: evidence.status }).from(evidence).leftJoin(sourceTable, eq(evidence.sourceId, sourceTable.id)).where(eq(evidence.companyId, context.company.id)),
    db.select({ id: cashEvents.id, month: cashEvents.month, transactionDate: cashEvents.transactionDate, sourceLocation: cashEvents.sourceLocation, amount: cashEvents.amount, currency: cashEvents.currency, direction: cashEvents.direction, category: cashEvents.category, description: cashEvents.description, isActual: cashEvents.isActual, accountingTreatment: cashEvents.accountingTreatment, evidenceId: cashEvents.evidenceId, evidenceStatus: evidence.status, sourceName: evidence.sourceName, sourceMetadata: sourceTable.metadata }).from(cashEvents).leftJoin(evidence, eq(cashEvents.evidenceId, evidence.id)).leftJoin(sourceTable, eq(cashEvents.sourceId, sourceTable.id)).where(eq(cashEvents.companyId, context.company.id)),
  ]);
  const explicitRun = new URL(request.url).searchParams.get("run") === "again";
  const allSourceIds = [...new Set(evidenceRows.flatMap((source) => source.sourceId ? [source.sourceId] : []))];
  if (persist && explicitRun && allSourceIds.length) {
    await db.insert(ingestionRuns).values(allSourceIds.map((sourceId) => ({ companyId: context.company.id, sourceId, stage: "reconciliation", status: "running", metadata: JSON.stringify({ trigger: "manual", startedFrom: "documents" }) })));
  }
  const ledgerEntries = buildReconciliationLedger(events.map((event) => ({ id: event.id, month: event.month, date: event.transactionDate, amount: event.amount, currency: event.currency, direction: event.direction, description: event.description, sourceName: event.sourceName, sourceKind: sourceKind(event.sourceMetadata), evidenceStatus: event.evidenceStatus, isActual: event.isActual, accountingTreatment: event.accountingTreatment })), context.company.baseCurrency);

  const approvedSources = evidenceRows.filter((source) => source.status === "approved");
  const accountBalanceComparisons = compareStatementAndBookBalances(approvedSources.map((source) => {
    let facts: { label: string; value: string; accountingRole?: string }[] = [];
    try { facts = source.extractedJson ? (JSON.parse(source.extractedJson) as { facts?: typeof facts }).facts ?? [] : []; } catch { /* malformed legacy extraction remains visible elsewhere */ }
    const month = monthFromSource(source);
    const kind = sourceKind(source.sourceMetadata);
    return { ...(month ? { month } : {}), ...(kind ? { kind } : {}), sourceName: source.sourceName, accountIdentifier: source.accountIdentifier, accountEntityId: source.accountEntityId, endingBalance: source.endingBalance, currency: source.currency, facts };
  }));
  const accountAssignments = new Map<string, { entities: Set<string>; sources: { month: string | undefined; sourceName: string }[] }>();
  for (const source of approvedSources) {
    const identifier = source.accountIdentifier?.replace(/[^0-9A-Za-z]/g, "").toLowerCase();
    if (!identifier || !source.accountEntityId) continue;
    const assignment = accountAssignments.get(identifier) ?? { entities: new Set<string>(), sources: [] };
    assignment.entities.add(source.accountEntityId);
    assignment.sources.push({ month: monthFromSource(source), sourceName: source.sourceName });
    accountAssignments.set(identifier, assignment);
  }
  const balances = new Map<string, { opening: Balance[]; ending: Balance[] }>();
  const reportedRevenue = new Map<string, { amount: number; sources: string[] }>();
  for (const source of approvedSources) {
    const month = monthFromSource(source);
    if (!month) continue;
    const row = balances.get(month) ?? { opening: [], ending: [] };
    const kind = sourceKind(source.sourceMetadata);
    const isBooksSource = ["balance_sheet", "general_ledger", "quickbooks_transactions"].includes(kind ?? "");
    const metadataOpening = parseFinancialAmount(source.openingBalance ?? "");
    const metadataEnding = parseFinancialAmount(source.endingBalance ?? "");
    if (!isBooksSource && metadataOpening !== undefined) row.opening.push({ amount: Math.abs(metadataOpening), label: "Opening balance (statement metadata)", sourceName: source.sourceName });
    if (!isBooksSource && metadataEnding !== undefined) row.ending.push({ amount: Math.abs(metadataEnding), label: "Ending balance (statement metadata)", sourceName: source.sourceName });
    if (!source.extractedJson) {
      if (row.opening.length || row.ending.length) balances.set(month, row);
      continue;
    }
    try {
      const extraction = JSON.parse(source.extractedJson) as { facts?: { label: string; value: string; accountingRole?: string }[] };
      for (const fact of extraction.facts ?? []) {
        if (/this year|year-to-date|ytd/i.test(fact.label)) continue;
        const kind = balanceKind(fact.label);
        const amount = parseFinancialAmount(fact.value);
        if (!kind || amount === undefined || isBooksSource) continue;
        row[kind].push({ amount: Math.abs(amount), label: fact.label, sourceName: source.sourceName });
      }
      const revenueFacts = (extraction.facts ?? []).filter((fact) => fact.accountingRole === "revenue" && !/this year|year-to-date|ytd/i.test(fact.label));
      const revenue = revenueFacts.reduce((sum, fact) => sum + Math.abs(parseFinancialAmount(fact.value) ?? 0), 0);
      if (revenue > 0) {
        const current = reportedRevenue.get(month) ?? { amount: 0, sources: [] };
        reportedRevenue.set(month, { amount: current.amount + revenue, sources: [...new Set([...current.sources, source.sourceName])] });
      }
      balances.set(month, row);
    } catch { /* keep the source visible through its transactions */ }
  }

  const usableEvents = events.filter((event) => event.isActual === "Y" && event.accountingTreatment !== "pending" && (event.evidenceStatus === "approved" || !event.evidenceId));
  // Staged transaction files are deliberately excluded from the roll-forward,
  // but remain visible here so the CFO can see that coverage exists and why it
  // has not posted to the financial statements yet.
  const stagedEvents = events.filter((event) => event.evidenceId && (event.isActual !== "Y" || event.accountingTreatment === "pending" || event.evidenceStatus !== "approved") && isDetailedFinancialEvent(event.description));
  const monthsWithCashFlowView = new Set(usableEvents.filter((event) => /^(?:Cash Flow Activity\b|\d{4}-\d{2}-\d{2}.*(?:Automated Payment|Wired Funds|Bank Product Withdrawal))/i.test(event.description)).map((event) => event.month));
  const canonicalEvents = usableEvents.filter((event) => !(monthsWithCashFlowView.has(event.month) && isSweepCounterpartActivity(event.description)));
  const monthNames = new Set<string>([...balances.keys(), ...reportedRevenue.keys(), ...canonicalEvents.map((event) => event.month), ...stagedEvents.map((event) => event.month)]);
  const monthList = [...monthNames].sort();
  let carriedEnding: number | undefined;
  const months = monthList.map((month, index) => {
    const monthEvents = canonicalEvents.filter((event) => event.month === month && isDetailedFinancialEvent(event.description));
    // Preserve every canonical source row. Similar rows are represented as
    // explicit match groups below; they are never silently discarded.
    const rows = monthEvents;
    const receipts = rows.filter((event) => event.direction === "receipt").reduce((sum, event) => sum + Number(event.amount), 0);
    const spending = rows.filter((event) => event.direction === "spend").reduce((sum, event) => sum + Number(event.amount), 0);
    const balanceRow = balances.get(month) ?? { opening: [], ending: [] };
    const selectBalance = (entries: Balance[]) => {
      const cashEntries = entries.filter((entry) => /cash|cash\s+balance/i.test(entry.label));
      const candidates = cashEntries.length ? cashEntries : entries;
      const unique = [...new Map(candidates.map((entry) => [entry.amount, entry])).values()];
      return { amount: unique.length === 1 ? unique[0]!.amount : undefined, conflict: unique.length > 1 };
    };
    const selectedOpening = selectBalance(balanceRow.opening);
    const selectedEnding = selectBalance(balanceRow.ending);
    const opening = selectedOpening.amount ?? carriedEnding;
    const ending = selectedEnding.amount;
    const balanceConflict = selectedOpening.conflict && selectedEnding.conflict ? "both" as const : selectedOpening.conflict ? "opening" as const : selectedEnding.conflict ? "ending" as const : undefined;
    const priorMonth = monthList[index - 1];
    const coverageGapFrom = priorMonth && previousMonth(month) !== priorMonth ? priorMonth : undefined;
    const validation = validateStatementRollforward({ ...(opening === undefined ? {} : { opening }), ...(ending === undefined ? {} : { ending }), receipts, spending });
    const { expectedEnding, difference } = validation;
    carriedEnding = ending ?? expectedEnding;
    const matchedGroups = matchTransactionsAcrossSources(rows.map((event) => ({ id: event.id, date: event.transactionDate, amount: event.amount, direction: event.direction, description: event.description, sourceName: event.sourceName, ...(sourceKind(event.sourceMetadata) ? { sourceKind: sourceKind(event.sourceMetadata) } : {}) })));
    const duplicateGroups = matchedGroups.filter((group) => group.kind === "duplicate");
    const duplicateEvents = duplicateGroups.length;
    const transferGroups = matchedGroups.filter((group) => group.kind === "transfer");
    const bookMatchGroups = matchedGroups.filter((group) => group.kind === "book_match");
    const bankAndBooksPresent = new Set(rows.map((event) => sourceKind(event.sourceMetadata))).has("bank_statement") && rows.some((event) => ["quickbooks_transactions", "general_ledger"].includes(sourceKind(event.sourceMetadata) ?? ""));
    const matchedEventIds = new Set(matchedGroups.flatMap((group) => group.transactionIds));
    const unmatchedBookEvents = bankAndBooksPresent ? rows.filter((event) => ["bank_statement", "quickbooks_transactions", "general_ledger"].includes(sourceKind(event.sourceMetadata) ?? "") && !matchedEventIds.has(event.id)) : [];
    const unclassifiedCount = rows.filter((event) => event.category === "unclassified").length;
    const reported = reportedRevenue.get(month);
    const cashRevenue = rows.filter((event) => event.direction === "receipt" && event.category === "revenue").reduce((sum, event) => sum + Number(event.amount), 0);
    const revenueComparison = reported ? { reported: reported.amount, cashReceived: cashRevenue, sources: reported.sources } : undefined;
    const conflictingAssignment = [...accountAssignments.entries()].find(([, assignment]) => assignment.entities.size > 1 && assignment.sources.some((source) => source.month === month));
    const accountConflict = conflictingAssignment ? { identifier: `••••${conflictingAssignment[0].slice(-4)}`, sources: [...new Set(conflictingAssignment[1].sources.filter((source) => source.month === month).map((source) => source.sourceName))] } : undefined;
    const foreignCurrencyEvents = events.filter((event) => event.month === month && event.isActual === "Y" && event.evidenceStatus === "approved" && event.currency && event.currency !== context.company.baseCurrency);
    const currencyMismatch = foreignCurrencyEvents.length ? { baseCurrency: context.company.baseCurrency, currencies: [...new Set(foreignCurrencyEvents.map((event) => event.currency!))], sources: [...new Set(foreignCurrencyEvents.map((event) => event.sourceName).filter(Boolean))] as string[], count: foreignCurrencyEvents.length } : undefined;
    const bookBalanceComparison = accountBalanceComparisons.find((comparison) => comparison.month === month);
    const reviewQuestions = buildReconciliationReview({ month, ...(opening === undefined ? {} : { opening }), ...(ending === undefined ? {} : { ending }), ...(expectedEnding === undefined ? {} : { expectedEnding }), ...(difference === undefined ? {} : { difference }), transactionCount: rows.length, duplicateGroups, unclassifiedCount, ...(balanceConflict ? { balanceConflict } : {}), ...(coverageGapFrom ? { coverageGapFrom } : {}), ...(revenueComparison ? { revenueComparison } : {}), ...(accountConflict ? { accountConflict } : {}), ...(currencyMismatch ? { currencyMismatch } : {}), ...(bookBalanceComparison ? { bookBalanceComparison } : {}), ...(unmatchedBookEvents.length ? { unmatchedBookCount: unmatchedBookEvents.length, unmatchedBookSources: [...new Set(unmatchedBookEvents.map((event) => event.sourceName).filter(Boolean))] as string[] } : {}) });
    const pendingSources = evidenceRows.filter((source) => source.status !== "approved" && monthFromSource(source) === month).map((source) => source.sourceName);
    const stagedTransactions = stagedEvents.filter((event) => event.month === month);
    const stagedSourceNames = [...new Set(stagedTransactions.map((event) => event.sourceName).filter(Boolean))] as string[];
    const sourceNames = [...new Set(rows.map((event) => event.sourceName).filter(Boolean))] as string[];
    const exceptions: string[] = [];
    if (validation.status === "incomplete") exceptions.push("A unique opening and ending balance was not found in approved evidence.");
    if (balanceConflict) exceptions.push(`Approved evidence reports conflicting ${balanceConflict === "both" ? "opening and ending balances" : `${balanceConflict} balances`}.`);
    if (validation.status === "mismatch") exceptions.push(`Balance roll-forward differs by $${Math.abs(difference ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`);
    if (coverageGapFrom) exceptions.push(`Evidence coverage skips one or more months after ${coverageGapFrom}.`);
    if (duplicateEvents) exceptions.push(`${duplicateEvents} transaction${duplicateEvents === 1 ? " is" : "s are"} present in more than one source and require matching review.`);
    if (pendingSources.length) exceptions.push(`${pendingSources.length} source${pendingSources.length === 1 ? " is" : "s are"} still pending approval.`);
    if (stagedTransactions.length) exceptions.push(`${stagedTransactions.length} parsed transaction${stagedTransactions.length === 1 ? " is" : "s are"} staged pending accounting-treatment approval.`);
    if (reviewQuestions.some((question) => question.kind === "recognition")) exceptions.push("Income-statement revenue and approved cash receipts differ materially; recognition treatment needs review.");
    if (accountConflict) exceptions.push("Approved evidence maps the same account identifier to multiple company accounts.");
    if (currencyMismatch) exceptions.push(`${currencyMismatch.count} approved transaction${currencyMismatch.count === 1 ? " is" : "s are"} excluded pending ${currencyMismatch.currencies.join("/")} to ${currencyMismatch.baseCurrency} conversion treatment.`);
    if (unmatchedBookEvents.length) exceptions.push(`${unmatchedBookEvents.length} bank or books transaction${unmatchedBookEvents.length === 1 ? " is" : "s are"} lacks a cross-source counterpart.`);
    if (bookBalanceComparison && Math.abs(bookBalanceComparison.difference) > 0.01) exceptions.push(`Bank statement ending cash and book cash differ by $${Math.abs(bookBalanceComparison.difference).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`);
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
      validation,
      balanceConflict,
      coverageGapFrom,
      revenueComparison,
      currencyMismatch,
      bookBalanceComparison,
      transactionCount: rows.length,
      duplicateCount: duplicateEvents,
      duplicateGroups,
      transferGroups,
      bookMatchGroups,
      unmatchedBookCount: unmatchedBookEvents.length,
      reviewQuestions,
      sourceNames,
      pendingSources,
      stagedTransactionCount: stagedTransactions.length,
      stagedSourceNames,
      stagedTransactions: stagedTransactions.map((event) => ({ id: event.id, date: event.transactionDate, description: event.description, amount: Number(event.amount), direction: event.direction, category: event.category, sourceName: event.sourceName ?? "Unknown source", sourceLocation: event.sourceLocation })),
      balances: { opening: balanceRow.opening, ending: balanceRow.ending },
      exceptions,
      transactions: rows.map((event) => ({ id: event.id, date: event.transactionDate, description: event.description, amount: Number(event.amount), direction: event.direction, category: event.category, sourceName: event.sourceName ?? "Unknown source", sourceLocation: event.sourceLocation })),
    };
  });
  const statusByMonth = new Map(months.map((month) => [month.month, month.status]));
  const desiredReviews = months.flatMap((month) => month.reviewQuestions.map((review) => ({ reviewKey: `reconciliation:${month.month}:${review.kind}`, question: review.question, evidenceId: null })));
  if (persist) {
  const existingReviews = await db.select({ id: reviewItems.id, reviewKey: reviewItems.reviewKey, question: reviewItems.question, status: reviewItems.status }).from(reviewItems).where(eq(reviewItems.companyId, context.company.id));
  const existingByKey = new Map(existingReviews.filter((review) => review.reviewKey?.startsWith("reconciliation:")).map((review) => [review.reviewKey!, review]));
  const desiredKeys = new Set(desiredReviews.map((review) => review.reviewKey));
  for (const review of desiredReviews) {
    const existing = existingByKey.get(review.reviewKey);
    if (!existing) {
      await db.insert(reviewItems).values({ companyId: context.company.id, reviewKey: review.reviewKey, question: review.question, status: "open" });
    } else if (existing.question !== review.question && existing.status !== "open") {
      await db.update(reviewItems).set({ question: review.question, answer: null, status: "open", updatedAt: new Date() }).where(and(eq(reviewItems.id, existing.id), eq(reviewItems.companyId, context.company.id)));
    } else if (existing.question !== review.question) {
      await db.update(reviewItems).set({ question: review.question, updatedAt: new Date() }).where(and(eq(reviewItems.id, existing.id), eq(reviewItems.companyId, context.company.id)));
    }
  }
  await Promise.all(existingReviews.filter((review) => review.reviewKey?.startsWith("reconciliation:") && review.status === "open" && !desiredKeys.has(review.reviewKey!)).map((review) => db.update(reviewItems).set({ status: "resolved", answer: "Automatically cleared when the reconciliation exception was resolved.", updatedAt: new Date() }).where(and(eq(reviewItems.id, review.id), eq(reviewItems.companyId, context.company.id)))));
  if (allSourceIds.length) {
    const pendingRuns = await db.select({ id: ingestionRuns.id, sourceId: ingestionRuns.sourceId, status: ingestionRuns.status }).from(ingestionRuns).where(and(eq(ingestionRuns.companyId, context.company.id), inArray(ingestionRuns.sourceId, allSourceIds), eq(ingestionRuns.stage, "reconciliation")));
    const summary = JSON.stringify({ months: months.length, reconciled: months.filter((month) => month.status === "reconciled").length, exceptions: months.reduce((total, month) => total + month.exceptions.length, 0) });
    const completedRuns = pendingRuns.filter((run) => run.status === "waiting" || run.status === "running");
    if (completedRuns.length) {
      const now = new Date();
      const matched = ledgerEntries.filter((entry) => ["duplicate", "transfer", "book_match"].includes(entry.kind)).length;
      const unmatched = ledgerEntries.filter((entry) => entry.kind === "unmatched").length;
      const questions = desiredReviews.length;
      // These are durable progress events, not accounting entries. They let a
      // CFO see what each source actually went through after it was uploaded.
      await db.insert(ingestionRuns).values(completedRuns.flatMap((run) => [
        { companyId: context.company.id, sourceId: run.sourceId, stage: "validation", status: "succeeded", completedAt: now, metadata: JSON.stringify({ months: months.length, reconciled: months.filter((month) => month.status === "reconciled").length, exceptions: months.reduce((total, month) => total + month.exceptions.length, 0) }) },
        { companyId: context.company.id, sourceId: run.sourceId, stage: "matching", status: "succeeded", completedAt: now, metadata: JSON.stringify({ matched, unmatched, currencyPending: ledgerEntries.filter((entry) => entry.kind === "currency_pending").length }) },
        { companyId: context.company.id, sourceId: run.sourceId, stage: "grouped_review", status: "succeeded", completedAt: now, metadata: JSON.stringify({ questions }) },
      ]));
      await Promise.all(completedRuns.map((run) => db.update(ingestionRuns).set({ status: "succeeded", completedAt: now, metadata: summary, updatedAt: now }).where(and(eq(ingestionRuns.id, run.id), eq(ingestionRuns.companyId, context.company.id)))));
    }
  }
  const sourceIds = evidenceRows.flatMap((source) => source.sourceId ? [{ id: source.sourceId, month: monthFromSource(source), evidenceStatus: source.status }] : []);
  await Promise.all(sourceIds.map(({ id, month, evidenceStatus }) => {
    const status = evidenceStatus === "approved" && month && statusByMonth.get(month) === "reconciled" ? "reconciled" : "review";
    return db.update(sourceTable).set({ ingestionStatus: status, ingestionError: null, processedAt: new Date() }).where(and(eq(sourceTable.id, id), eq(sourceTable.companyId, context.company.id)));
  }));
  await db.delete(reconciliationEntries).where(eq(reconciliationEntries.companyId, context.company.id));
  if (ledgerEntries.length) await db.insert(reconciliationEntries).values(ledgerEntries.map((entry) => ({ companyId: context.company.id, eventId: entry.eventId, ...(entry.counterpartEventId ? { counterpartEventId: entry.counterpartEventId } : {}), month: entry.month, kind: entry.kind, matchKey: entry.matchKey, evidence: JSON.stringify(entry.evidence) })));
  }
  return NextResponse.json({ months, ledger: { total: ledgerEntries.length, byKind: Object.fromEntries(["staged", "currency_pending", "duplicate", "transfer", "book_match", "excluded", "unmatched"].map((kind) => [kind, ledgerEntries.filter((entry) => entry.kind === kind).length])) } });
}

export async function GET(request: Request) {
  return handleReconciliation(request, false);
}

export async function POST(request: Request) {
  return handleReconciliation(request, true);
}
