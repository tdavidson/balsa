/**
 * Deterministic finance engine.
 *
 * Company State (schedule items, actual cash events, allocation rules) goes in;
 * monthly cash, P&L, outstanding items, intercompany balances, and a full
 * calculation trace come out. Nothing here depends on the database, Next.js,
 * or a model provider.
 */

export type Month = string; // YYYY-MM
export type Direction = "receipt" | "spend";
export type Cadence = "once" | "monthly" | "quarterly" | "annual";
export type Basis = "contractual" | "assumed";
export type Treatment = "cash" | "accrual" | "prepaid";
export type Activity = "operating" | "transfer" | "investment" | "financing";

export const categories = ["management_fee", "other_revenue", "salary", "contractor", "professional_services", "software", "insurance", "other"] as const;
export type Category = (typeof categories)[number];
export const revenueCategories: readonly Category[] = ["management_fee", "other_revenue"];
export const expenseCategories: readonly Category[] = ["salary", "contractor", "professional_services", "software", "insurance", "other"];
export function isCategory(value: unknown): value is Category { return typeof value === "string" && (categories as readonly string[]).includes(value); }

export type Provenance = { evidenceId?: string; sourceName?: string; decisionId?: string; policyId?: string; assumptionId?: string };

export type ScheduleItem = {
  id: string;
  label: string;
  counterparty?: string;
  counterpartyEntityId?: string;
  direction: Direction;
  amount: number;
  category: Category;
  cadence: Cadence;
  effectiveFrom: Month;
  effectiveTo?: Month;
  accountingTreatment: Treatment;
  recognitionStart?: Month;
  recognitionEnd?: Month;
  basis: Basis;
  scenarioId?: string;
  provenance: Provenance;
};

export type ActualEvent = {
  id: string;
  month: Month;
  date?: string;
  description: string;
  amount: number;
  direction: Direction;
  activity: Activity;
  category?: Category;
  counterpartyEntityId?: string;
  settlesItemId?: string;
  accountingTreatment?: Treatment;
  recognitionStart?: Month;
  recognitionEnd?: Month;
  provenance: Provenance;
};

export type AllocationRule = {
  id: string;
  eventId?: string;
  itemId?: string;
  counterpartyEntityId?: string;
  bearerEntityId: string;
  bearerName?: string;
  percentage?: number;
  amount?: number;
};

export type StatementBalance = { month: Month; opening?: number; ending?: number };

export type EngineInput = {
  openingCash?: { month: Month; amount: number };
  /** Months before this one are history: cash moves only on actuals. */
  asOfMonth: Month;
  horizon: { start: Month; end: Month };
  items: ScheduleItem[];
  actuals: ActualEvent[];
  allocations?: AllocationRule[];
  closedMonths?: Month[];
  scenarioId?: string;
  statementBalances?: StatementBalance[];
};

export type ExpectedEvent = {
  key: string;
  itemId: string;
  label: string;
  month: Month;
  amount: number;
  direction: Direction;
  category: Category;
  basis: Basis;
  treatment: Treatment;
  recognitionStart?: Month;
  recognitionEnd?: Month;
  counterparty?: string;
  counterpartyEntityId?: string;
  provenance: Provenance;
  settledBy: string[];
};

export type TraceLine = {
  id: string;
  kind: "actual" | "expected" | "recognized" | "allocation";
  month: Month;
  amount: number;
  direction: Direction;
  category?: Category;
  activity?: Activity;
  description: string;
  basis?: Basis;
  itemId?: string;
  eventId?: string;
  settledBy?: string[];
  settles?: string;
  bearerEntityId?: string;
  bearerName?: string;
  counterpartyEntityId?: string;
  /** True when the line moves cash in its month. */
  cash: boolean;
  /** True when the line is recognized in the month's P&L. */
  recognized: boolean;
  provenance: Provenance;
};

export type OutstandingItem = { itemId: string; label: string; month: Month; amount: number; direction: Direction; category: Category; basis: Basis; counterparty?: string; provenance: Provenance };

export type MonthResult = {
  month: Month;
  status: "closed" | "history" | "open";
  openingCash?: number;
  endingCash?: number;
  /** Projected totals: actuals plus unsettled expectations in open months, actuals only in history. */
  receipts: number;
  spending: number;
  net: number;
  expectedReceipts: number;
  expectedSpending: number;
  actualReceipts: number;
  actualSpending: number;
  actualNet: number;
  /** Actual net less expected net. Meaningful once a month has actuals. */
  variance: number;
  contractualReceipts: number;
  contractualSpending: number;
  assumedReceipts: number;
  assumedSpending: number;
  pnl: {
    revenue: number;
    expenses: number;
    operatingIncome: number;
    revenueByCategory: Record<Category, number>;
    byCategory: Record<Category, number>;
    allocatedOut: number;
    uncategorized: number;
  };
  outstanding: { receivables: OutstandingItem[]; payables: OutstandingItem[] };
  intercompany: { entityId: string; name?: string; balance: number }[];
  statement?: { opening?: number; ending?: number; difference?: number };
  lines: TraceLine[];
};

export type EngineOutput = {
  months: MonthResult[];
  expected: ExpectedEvent[];
  matches: { expectedKey: string; actualId: string; reason: "link" | "counterparty" | "amount" }[];
};

// ---------------------------------------------------------------------------
// Month arithmetic

export function addMonths(month: Month, count: number): Month {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year!, monthNumber! - 1 + count, 1));
  return date.toISOString().slice(0, 7);
}

export function monthDiff(from: Month, to: Month): number {
  const [fromYear, fromMonth] = from.split("-").map(Number);
  const [toYear, toMonth] = to.split("-").map(Number);
  return (toYear! - fromYear!) * 12 + (toMonth! - fromMonth!);
}

export function monthRange(start: Month, end: Month): Month[] {
  const result: Month[] = [];
  if (start > end) return result;
  for (let cursor = start; cursor <= end; cursor = addMonths(cursor, 1)) result.push(cursor);
  return result;
}

export function isValidMonth(value: unknown): value is Month { return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value); }

const cadenceStep: Record<Cadence, number> = { once: 0, monthly: 1, quarterly: 3, annual: 12 };

/** Normalize free-text cadence into the engine's cadence. */
export function parseCadence(value: string | null | undefined): Cadence {
  const text = (value ?? "").toLowerCase();
  if (/quarter/.test(text)) return "quarterly";
  if (/annual|year/.test(text)) return "annual";
  if (/month|recurring/.test(text)) return "monthly";
  return "once";
}

const round = (value: number) => Math.round(value * 100) / 100;

// ---------------------------------------------------------------------------
// Expansion

/** Expand one schedule item into expected events within the horizon, on the item's own calendar. */
export function expandScheduleItem(item: ScheduleItem, horizon: { start: Month; end: Month }): ExpectedEvent[] {
  if (!Number.isFinite(item.amount) || item.amount <= 0 || !isValidMonth(item.effectiveFrom)) return [];
  const last = item.effectiveTo && item.effectiveTo < horizon.end ? item.effectiveTo : horizon.end;
  const step = cadenceStep[item.cadence];
  const months: Month[] = [];
  if (step === 0) {
    if (item.effectiveFrom >= horizon.start && item.effectiveFrom <= horizon.end) months.push(item.effectiveFrom);
  } else {
    for (let cursor = item.effectiveFrom; cursor <= last; cursor = addMonths(cursor, step)) if (cursor >= horizon.start) months.push(cursor);
  }
  return months.map((month) => ({
    key: `${item.id}:${month}`,
    itemId: item.id,
    label: item.label,
    month,
    amount: item.amount,
    direction: item.direction,
    category: item.category,
    basis: item.basis,
    treatment: item.accountingTreatment,
    ...(item.recognitionStart ? { recognitionStart: item.recognitionStart } : {}),
    ...(item.recognitionEnd ? { recognitionEnd: item.recognitionEnd } : {}),
    ...(item.counterparty ? { counterparty: item.counterparty } : {}),
    ...(item.counterpartyEntityId ? { counterpartyEntityId: item.counterpartyEntityId } : {}),
    provenance: item.provenance,
    settledBy: [],
  }));
}

// ---------------------------------------------------------------------------
// Matching

const amountsMatch = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.01, Math.abs(b) * 0.005);

/**
 * Link actuals to the expected events they settle. A persisted link wins;
 * otherwise an actual settles an expected event in the same month with the
 * same direction and either the same counterparty entity or a matching
 * amount. A second pass lets an actual settle an expectation from the two
 * preceding months when the amount matches. Each expected event is settled
 * at most once.
 */
export function matchActualsToExpected(expected: ExpectedEvent[], actuals: ActualEvent[]): EngineOutput["matches"] {
  const matches: EngineOutput["matches"] = [];
  const settled = new Set<string>();
  const matchedActuals = new Set<string>();
  const take = (event: ExpectedEvent, actual: ActualEvent, reason: "link" | "counterparty" | "amount") => {
    settled.add(event.key); matchedActuals.add(actual.id); event.settledBy.push(actual.id); matches.push({ expectedKey: event.key, actualId: actual.id, reason });
  };
  const operating = actuals.filter((actual) => actual.activity === "operating");
  for (const actual of operating) {
    if (!actual.settlesItemId) continue;
    const candidates = expected.filter((event) => event.itemId === actual.settlesItemId && !settled.has(event.key) && event.direction === actual.direction);
    const chosen = candidates.find((event) => event.month === actual.month) ?? candidates.find((event) => event.month <= actual.month) ?? candidates[0];
    if (chosen) take(chosen, actual, "link");
  }
  for (const actual of operating) {
    if (matchedActuals.has(actual.id)) continue;
    const sameMonth = expected.filter((event) => !settled.has(event.key) && event.month === actual.month && event.direction === actual.direction);
    const byCounterparty = actual.counterpartyEntityId ? sameMonth.find((event) => event.counterpartyEntityId === actual.counterpartyEntityId) : undefined;
    if (byCounterparty) { take(byCounterparty, actual, "counterparty"); continue; }
    const byAmount = sameMonth.find((event) => amountsMatch(actual.amount, event.amount) && (!event.counterpartyEntityId || !actual.counterpartyEntityId || event.counterpartyEntityId === actual.counterpartyEntityId));
    if (byAmount) take(byAmount, actual, "amount");
  }
  for (const actual of operating) {
    if (matchedActuals.has(actual.id)) continue;
    const earlier = expected.filter((event) => !settled.has(event.key) && event.direction === actual.direction && event.month < actual.month && monthDiff(event.month, actual.month) <= 2 && amountsMatch(actual.amount, event.amount) && (!event.counterpartyEntityId || !actual.counterpartyEntityId || event.counterpartyEntityId === actual.counterpartyEntityId)).sort((a, b) => a.month.localeCompare(b.month));
    if (earlier[0]) take(earlier[0], actual, actual.counterpartyEntityId && earlier[0].counterpartyEntityId === actual.counterpartyEntityId ? "counterparty" : "amount");
  }
  return matches;
}

// ---------------------------------------------------------------------------
// Recognition

function recognitionMonths(month: Month, treatment: Treatment, start?: Month, end?: Month): Month[] {
  if (treatment !== "cash" && start && end && isValidMonth(start) && isValidMonth(end) && start <= end) return monthRange(start, end);
  return [month];
}

function emptyByCategory(): Record<Category, number> {
  return Object.fromEntries(categories.map((category) => [category, 0])) as Record<Category, number>;
}

// ---------------------------------------------------------------------------
// Engine

export function runEngine(input: EngineInput): EngineOutput {
  const horizon = input.horizon;
  const months = monthRange(horizon.start, horizon.end);
  const closed = new Set(input.closedMonths ?? []);
  const items = input.items.filter((item) => !item.scenarioId || item.scenarioId === input.scenarioId);
  const expected = items.flatMap((item) => expandScheduleItem(item, horizon));
  const actuals = input.actuals.filter((actual) => actual.month >= horizon.start && actual.month <= horizon.end && Number.isFinite(actual.amount) && actual.amount > 0);
  const matches = matchActualsToExpected(expected, actuals);
  const settledItemByActual = new Map<string, ExpectedEvent>();
  const expectedByKey = new Map(expected.map((event) => [event.key, event]));
  for (const match of matches) { const event = expectedByKey.get(match.expectedKey); if (event) settledItemByActual.set(match.actualId, event); }
  const isHistory = (month: Month) => month < input.asOfMonth || closed.has(month);

  // Recognized P&L lines, keyed by the month they are recognized in.
  const recognizedByMonth = new Map<Month, TraceLine[]>();
  const pushRecognized = (month: Month, line: TraceLine) => recognizedByMonth.set(month, [...(recognizedByMonth.get(month) ?? []), line]);
  const spread = (base: Omit<TraceLine, "id" | "month" | "amount" | "cash" | "recognized">, idPrefix: string, sourceMonth: Month, amount: number, treatment: Treatment, start?: Month, end?: Month) => {
    const recognizeIn = recognitionMonths(sourceMonth, treatment, start, end);
    const share = amount / recognizeIn.length;
    for (const month of recognizeIn) {
      if (month < horizon.start || month > horizon.end) continue;
      pushRecognized(month, { ...base, id: `recognized:${idPrefix}:${month}`, kind: "recognized", month, amount: round(share), cash: false, recognized: true });
    }
  };

  // Actual events recognize in P&L unless they settle an accrual/prepaid expectation, which recognizes on its own schedule.
  for (const actual of actuals) {
    if (actual.activity !== "operating") continue;
    const settles = settledItemByActual.get(actual.id);
    if (settles && settles.treatment !== "cash") continue;
    const treatment = actual.accountingTreatment ?? "cash";
    const base = { kind: "recognized" as const, direction: actual.direction, ...(actual.category ? { category: actual.category } : {}), activity: actual.activity, description: actual.description, eventId: actual.id, ...(actual.counterpartyEntityId ? { counterpartyEntityId: actual.counterpartyEntityId } : {}), ...(settles ? { settles: settles.key, itemId: settles.itemId, basis: settles.basis, category: settles.category } : {}), provenance: actual.provenance };
    spread(base, `actual:${actual.id}`, actual.month, actual.amount, treatment, actual.recognitionStart, actual.recognitionEnd);
  }
  // Expected events: accrual/prepaid always recognize on schedule; cash-basis expectations recognize only while unsettled in an open month.
  for (const event of expected) {
    const base = { kind: "recognized" as const, direction: event.direction, category: event.category, description: event.label, basis: event.basis, itemId: event.itemId, ...(event.counterpartyEntityId ? { counterpartyEntityId: event.counterpartyEntityId } : {}), settledBy: event.settledBy, provenance: event.provenance };
    if (event.treatment !== "cash") spread(base, `expected:${event.key}`, event.month, event.amount, event.treatment, event.recognitionStart, event.recognitionEnd);
    else if (!event.settledBy.length && !isHistory(event.month)) spread(base, `expected:${event.key}`, event.month, event.amount, "cash");
  }

  const allocationRules = input.allocations ?? [];
  const ruleFor = (line: TraceLine) => allocationRules.filter((rule) => (rule.eventId && rule.eventId === line.eventId) || (rule.itemId && rule.itemId === line.itemId) || (rule.counterpartyEntityId && rule.counterpartyEntityId === line.counterpartyEntityId));
  const statementByMonth = new Map((input.statementBalances ?? []).map((balance) => [balance.month, balance]));

  let cash: number | undefined;
  const intercompany = new Map<string, { entityId: string; name?: string; balance: number }>();
  const outstandingReceivables: OutstandingItem[] = [];
  const outstandingPayables: OutstandingItem[] = [];

  const results: MonthResult[] = months.map((month) => {
    const history = isHistory(month);
    if (input.openingCash && input.openingCash.month === month) cash = input.openingCash.amount;
    const openingCash = cash;
    const lines: TraceLine[] = [];
    const monthActuals = actuals.filter((actual) => actual.month === month);
    const monthExpected = expected.filter((event) => event.month === month);

    let actualReceipts = 0; let actualSpending = 0;
    for (const actual of monthActuals) {
      const settles = settledItemByActual.get(actual.id);
      const movesCash = actual.activity !== "transfer";
      if (movesCash) { if (actual.direction === "receipt") actualReceipts += actual.amount; else actualSpending += actual.amount; }
      lines.push({ id: `actual:${actual.id}`, kind: "actual", month, amount: actual.amount, direction: actual.direction, ...(actual.category ? { category: actual.category } : {}), activity: actual.activity, description: actual.description, eventId: actual.id, ...(actual.counterpartyEntityId ? { counterpartyEntityId: actual.counterpartyEntityId } : {}), ...(settles ? { settles: settles.key, itemId: settles.itemId, basis: settles.basis } : {}), cash: movesCash, recognized: false, provenance: actual.provenance });
    }

    let expectedReceipts = 0; let expectedSpending = 0; let unsettledReceipts = 0; let unsettledSpending = 0;
    let contractualReceipts = 0; let contractualSpending = 0; let assumedReceipts = 0; let assumedSpending = 0;
    for (const event of monthExpected) {
      const unsettled = event.settledBy.length === 0;
      if (event.direction === "receipt") { expectedReceipts += event.amount; if (event.basis === "assumed") assumedReceipts += event.amount; else contractualReceipts += event.amount; }
      else { expectedSpending += event.amount; if (event.basis === "assumed") assumedSpending += event.amount; else contractualSpending += event.amount; }
      const projects = unsettled && !history;
      if (projects) { if (event.direction === "receipt") unsettledReceipts += event.amount; else unsettledSpending += event.amount; }
      if (unsettled && history) {
        const outstanding: OutstandingItem = { itemId: event.itemId, label: event.label, month, amount: event.amount, direction: event.direction, category: event.category, basis: event.basis, ...(event.counterparty ? { counterparty: event.counterparty } : {}), provenance: event.provenance };
        (event.direction === "receipt" ? outstandingReceivables : outstandingPayables).push(outstanding);
      }
      lines.push({ id: `expected:${event.key}`, kind: "expected", month, amount: event.amount, direction: event.direction, category: event.category, description: event.label, basis: event.basis, itemId: event.itemId, ...(event.counterpartyEntityId ? { counterpartyEntityId: event.counterpartyEntityId } : {}), settledBy: event.settledBy, cash: projects, recognized: false, provenance: event.provenance });
    }

    const receipts = round(actualReceipts + unsettledReceipts);
    const spending = round(actualSpending + unsettledSpending);
    if (cash !== undefined) cash = round(cash + receipts - spending);

    // P&L
    const revenueByCategory = emptyByCategory();
    const byCategory = emptyByCategory();
    let uncategorized = 0; let allocatedOut = 0;
    for (const line of recognizedByMonth.get(month) ?? []) {
      lines.push(line);
      const category = line.category ?? "other";
      if (!line.category) uncategorized += line.amount;
      if (line.direction === "receipt") revenueByCategory[category] += line.amount;
      else {
        byCategory[category] += line.amount;
        for (const rule of ruleFor(line)) {
          const share = round(rule.percentage !== undefined ? line.amount * rule.percentage / 100 : Math.min(line.amount, rule.amount ?? 0));
          if (share <= 0) continue;
          byCategory[category] -= share; allocatedOut += share;
          const balance = intercompany.get(rule.bearerEntityId) ?? { entityId: rule.bearerEntityId, ...(rule.bearerName ? { name: rule.bearerName } : {}), balance: 0 };
          balance.balance = round(balance.balance + share);
          intercompany.set(rule.bearerEntityId, balance);
          lines.push({ id: `allocation:${rule.id}:${line.id}`, kind: "allocation", month, amount: share, direction: "receipt", category, description: `${line.description} allocated to ${rule.bearerName ?? rule.bearerEntityId}`, bearerEntityId: rule.bearerEntityId, ...(rule.bearerName ? { bearerName: rule.bearerName } : {}), ...(line.itemId ? { itemId: line.itemId } : {}), ...(line.eventId ? { eventId: line.eventId } : {}), cash: false, recognized: true, provenance: line.provenance });
        }
      }
    }
    for (const key of categories) { revenueByCategory[key] = round(revenueByCategory[key]); byCategory[key] = round(byCategory[key]); }
    const revenue = round(Object.values(revenueByCategory).reduce((sum, value) => sum + value, 0));
    const expenses = round(Object.values(byCategory).reduce((sum, value) => sum + value, 0));

    const statement = statementByMonth.get(month);
    const actualNet = round(actualReceipts - actualSpending);
    return {
      month,
      status: closed.has(month) ? "closed" : history ? "history" : "open",
      ...(openingCash !== undefined ? { openingCash } : {}),
      ...(cash !== undefined ? { endingCash: cash } : {}),
      receipts, spending, net: round(receipts - spending),
      expectedReceipts: round(expectedReceipts), expectedSpending: round(expectedSpending),
      actualReceipts: round(actualReceipts), actualSpending: round(actualSpending), actualNet,
      variance: round(actualNet - (expectedReceipts - expectedSpending)),
      contractualReceipts: round(contractualReceipts), contractualSpending: round(contractualSpending), assumedReceipts: round(assumedReceipts), assumedSpending: round(assumedSpending),
      pnl: { revenue, expenses, operatingIncome: round(revenue - expenses), revenueByCategory, byCategory, allocatedOut: round(allocatedOut), uncategorized: round(uncategorized) },
      outstanding: { receivables: [...outstandingReceivables], payables: [...outstandingPayables] },
      intercompany: [...intercompany.values()].map((entry) => ({ ...entry })),
      ...(statement ? { statement: { ...(statement.opening !== undefined ? { opening: statement.opening } : {}), ...(statement.ending !== undefined ? { ending: statement.ending } : {}), ...(statement.ending !== undefined && cash !== undefined ? { difference: round(statement.ending - cash) } : {}) } } : {}),
      lines,
    };
  });

  return { months: results, expected, matches };
}

/** Lines behind one figure: a month and optionally a category or a label fragment. */
export function traceValue(output: EngineOutput, query: { month: Month; category?: Category; label?: string; direction?: Direction }): TraceLine[] {
  const month = output.months.find((entry) => entry.month === query.month);
  if (!month) return [];
  const needle = query.label?.toLowerCase();
  return month.lines.filter((line) => (!query.category || line.category === query.category) && (!query.direction || line.direction === query.direction) && (!needle || line.description.toLowerCase().includes(needle)));
}

/** Compact totals for a range of months, for summaries and prompts. */
export function summarizeMonths(output: EngineOutput, start?: Month, end?: Month) {
  return output.months.filter((month) => (!start || month.month >= start) && (!end || month.month <= end)).map((month) => ({
    month: month.month, status: month.status, openingCash: month.openingCash, endingCash: month.endingCash,
    receipts: month.receipts, spending: month.spending, net: month.net,
    actualReceipts: month.actualReceipts, actualSpending: month.actualSpending,
    contractualReceipts: month.contractualReceipts, assumedReceipts: month.assumedReceipts, contractualSpending: month.contractualSpending, assumedSpending: month.assumedSpending,
    revenue: month.pnl.revenue, expenses: month.pnl.expenses, operatingIncome: month.pnl.operatingIncome,
    outstandingReceivables: round(month.outstanding.receivables.reduce((sum, item) => sum + item.amount, 0)), outstandingPayables: round(month.outstanding.payables.reduce((sum, item) => sum + item.amount, 0)),
    intercompany: month.intercompany,
    ...(month.statement ? { statement: month.statement } : {}),
  }));
}
