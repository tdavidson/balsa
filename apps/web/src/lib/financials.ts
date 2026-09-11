import "server-only";
import { and, eq, ne } from "drizzle-orm";
import { allocations, cashEvents, economicItems, entities, evidence, getDatabase, openingPositions, reportingPeriods } from "@finance/database";
import { addMonths, isCategory, isLedger, isValidMonth, parseCadence, runEngine, type ActualEvent, type AllocationRule, type EngineInput, type EngineOutput, type OpeningPosition, type ScheduleItem, type StatementBalance, type Treatment } from "@nevermodel/finance-engine";
import { loadEntityStructure, type EntityStructure } from "@/lib/entity-structure";
import { financialEventKey, isSummaryDescription, isSweepCounterpartActivity, parseFinancialAmount } from "@/lib/financial-events";
import { legacyCategory } from "@/lib/categories";

export { legacyCategory };

export type FinancialOptions = {
  /** Months before this one are history. Defaults to the current calendar month. */
  asOfMonth?: string;
  scenarioId?: string;
  /** One legal entity's view, or the consolidated group. Defaults to consolidated. */
  entity?: string | "consolidated";
  /** Hypothetical items layered on top of persisted state, for simulations. */
  extraItems?: ScheduleItem[];
  /** Persisted item ids to drop, or to end at a month, for simulations. */
  itemOverrides?: { itemId: string; effectiveTo?: string; amount?: number; amountFrom?: string; remove?: boolean }[];
};

export type DuplicateEvent = { key: string; description: string; month: string; sourceNames: string[]; eventIds: string[] };

export type FinancialContext = {
  input: EngineInput;
  output: EngineOutput;
  structure: EntityStructure;
  view: { entityId?: string; consolidated: boolean };
  duplicates: DuplicateEvent[];
  entityNames: Map<string, string>;
  /** Confirmed economic item rows, by id, for routes that need the original record. */
  itemRows: Map<string, ItemRow>;
  actualSources: Map<string, { sourceName: string | null; evidenceId: string | null; evidenceStatus: string | null }>;
};

type ItemRow = typeof economicItems.$inferSelect & { sourceName: string | null; reportingMonth: string | null };

export function currentMonth() { return new Date().toISOString().slice(0, 7); }

const treatments = new Set(["cash", "accrual", "prepaid"]);
const asTreatment = (value: string | null | undefined): Treatment => (value && treatments.has(value) ? (value as Treatment) : "cash");

function monthOf(value: Date | string | null | undefined) {
  if (!value) return undefined;
  const text = value instanceof Date ? value.toISOString() : value;
  const month = text.slice(0, 7);
  return isValidMonth(month) ? month : undefined;
}

function balanceKind(label: string) {
  if (/(?:beginning|opening|starting|total\s+(?:beginning|opening))/i.test(label) && /(?:cash|total value|balance)/i.test(label)) return "opening" as const;
  if (/(?:ending|closing|total\s+ending)/i.test(label) && /(?:cash|total value|balance)/i.test(label)) return "ending" as const;
  return undefined;
}

/** Statement balances per month from approved evidence: the stored columns first, then the legacy extracted facts. */
function statementBalancesFrom(rows: { status: string; reportingMonth: string | null; statementPeriodEnd: string | null; openingBalance: string | null; endingBalance: string | null; extractedJson: string | null; accountEntityId: string | null }[], hasAccounts: boolean, inView: (accountId: string | null) => boolean): StatementBalance[] {
  const byMonth = new Map<string, { opening: number[]; ending: number[] }>();
  for (const row of rows) {
    if (row.status !== "approved") continue;
    if (hasAccounts && !row.accountEntityId) continue;
    if (!inView(row.accountEntityId)) continue;
    const month = row.reportingMonth ?? monthOf(row.statementPeriodEnd);
    if (!month) continue;
    const entry = byMonth.get(month) ?? { opening: [], ending: [] };
    const opening = row.openingBalance ? Number(row.openingBalance) : undefined;
    const ending = row.endingBalance ? Number(row.endingBalance) : undefined;
    if (opening !== undefined && Number.isFinite(opening)) entry.opening.push(Math.abs(opening));
    if (ending !== undefined && Number.isFinite(ending)) entry.ending.push(Math.abs(ending));
    if ((opening === undefined || ending === undefined) && row.extractedJson) {
      try {
        const facts = (JSON.parse(row.extractedJson) as { facts?: { label: string; value: string }[] }).facts ?? [];
        const cashFacts = facts.filter((fact) => !/year-to-date|this year|ytd|account\s+\d/i.test(fact.label));
        const pick = (kind: "opening" | "ending") => cashFacts.filter((fact) => balanceKind(fact.label) === kind).sort((a, b) => Number(/cash/i.test(b.label)) - Number(/cash/i.test(a.label)))[0];
        const openingFact = opening === undefined ? parseFinancialAmount(pick("opening")?.value ?? "") : undefined;
        const endingFact = ending === undefined ? parseFinancialAmount(pick("ending")?.value ?? "") : undefined;
        if (openingFact !== undefined) entry.opening.push(Math.abs(openingFact));
        if (endingFact !== undefined) entry.ending.push(Math.abs(endingFact));
      } catch { /* ignore malformed historical extraction */ }
    }
    byMonth.set(month, entry);
  }
  return [...byMonth.entries()].map(([month, entry]) => ({ month, ...(entry.opening.length ? { opening: entry.opening.reduce((sum, value) => sum + value, 0) } : {}), ...(entry.ending.length ? { ending: entry.ending.reduce((sum, value) => sum + value, 0) } : {}) }));
}

export async function loadFinancialInput(companyId: string, options: FinancialOptions = {}): Promise<Omit<FinancialContext, "output">> {
  const db = getDatabase();
  const asOfMonth = options.asOfMonth && isValidMonth(options.asOfMonth) ? options.asOfMonth : currentMonth();
  const [itemRowsRaw, eventRows, allocationRows, entityRows, periodRows, evidenceRows, positionRows, structure] = await Promise.all([
    db.select({ item: economicItems, sourceName: evidence.sourceName, reportingMonth: evidence.reportingMonth, evidenceAccountId: evidence.accountEntityId }).from(economicItems).leftJoin(evidence, eq(economicItems.evidenceId, evidence.id)).where(and(eq(economicItems.companyId, companyId), eq(economicItems.status, "confirmed"))),
    db.select({ event: cashEvents, sourceName: evidence.sourceName, evidenceStatus: evidence.status, evidenceAccountId: evidence.accountEntityId }).from(cashEvents).leftJoin(evidence, eq(cashEvents.evidenceId, evidence.id)).where(eq(cashEvents.companyId, companyId)),
    db.select().from(allocations).where(and(eq(allocations.companyId, companyId), eq(allocations.status, "approved"))),
    db.select({ id: entities.id, name: entities.name, type: entities.type }).from(entities).where(eq(entities.companyId, companyId)),
    db.select({ month: reportingPeriods.month, openingCash: reportingPeriods.openingCash, status: reportingPeriods.status }).from(reportingPeriods).where(eq(reportingPeriods.companyId, companyId)),
    db.select({ status: evidence.status, reportingMonth: evidence.reportingMonth, statementPeriodEnd: evidence.statementPeriodEnd, openingBalance: evidence.openingBalance, endingBalance: evidence.endingBalance, extractedJson: evidence.extractedJson, accountEntityId: evidence.accountEntityId }).from(evidence).where(and(eq(evidence.companyId, companyId), ne(evidence.status, "rejected"))),
    db.select().from(openingPositions).where(eq(openingPositions.companyId, companyId)),
    loadEntityStructure(companyId),
  ]);
  const entityNames = new Map(entityRows.map((entity) => [entity.id, entity.name]));
  const hasAccounts = entityRows.some((entity) => entity.type === "account");
  const overrides = new Map((options.itemOverrides ?? []).map((override) => [override.itemId, override]));
  // The view: one legal entity, or everything consolidated. Rows that carry no entity belong to the default entity.
  const viewEntity = options.entity && options.entity !== "consolidated" ? options.entity : undefined;
  const view = { ...(viewEntity ? { entityId: viewEntity } : {}), consolidated: !viewEntity };
  const entityOf = (explicit: string | null | undefined, accountId: string | null | undefined) => explicit ?? structure.entityOfAccount(accountId);
  const inView = (entityId: string | undefined) => !viewEntity || entityId === viewEntity;
  const accountInView = (accountId: string | null) => inView(structure.entityOfAccount(accountId));

  const itemRows = new Map<string, ItemRow>();
  const items: ScheduleItem[] = [];
  for (const { item, sourceName, reportingMonth, evidenceAccountId } of itemRowsRaw) {
    itemRows.set(item.id, { ...item, sourceName, reportingMonth });
    const entityId = entityOf(item.entityId, evidenceAccountId);
    if (!inView(entityId)) continue;
    const override = overrides.get(item.id);
    if (override?.remove) continue;
    const splitFrom = override?.amount !== undefined && override.amountFrom && isValidMonth(override.amountFrom) ? override.amountFrom : undefined;
    const amount = override?.amount !== undefined && !splitFrom ? override.amount : Number(item.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const effectiveFrom = [item.effectiveFrom, item.recognitionStart, reportingMonth, monthOf(item.createdAt)].find((candidate) => candidate && isValidMonth(candidate));
    if (!effectiveFrom) continue;
    const effectiveTo = splitFrom ? addMonths(splitFrom, -1) : override?.effectiveTo ?? item.effectiveTo ?? undefined;
    const base: Omit<ScheduleItem, "id"> = {
      label: item.label,
      ...(item.counterparty ? { counterparty: item.counterparty } : {}),
      ...(item.counterpartyEntityId ? { counterpartyEntityId: item.counterpartyEntityId } : {}),
      direction: item.direction,
      amount,
      category: isCategory(item.category) ? item.category : legacyCategory(`${item.label} ${item.counterparty ?? ""}`, item.direction) ?? (item.direction === "receipt" ? "other_revenue" : "other"),
      cadence: parseCadence(item.cadence),
      effectiveFrom,
      ...(effectiveTo && isValidMonth(effectiveTo) ? { effectiveTo } : {}),
      accountingTreatment: asTreatment(item.accountingTreatment),
      ...(item.recognitionStart ? { recognitionStart: item.recognitionStart } : {}),
      ...(item.recognitionEnd ? { recognitionEnd: item.recognitionEnd } : {}),
      basis: item.basis === "assumed" ? "assumed" : "contractual",
      ...(item.scenarioId ? { scenarioId: item.scenarioId } : {}),
      ...(entityId ? { entityId } : {}),
      provenance: { ...(item.evidenceId ? { evidenceId: item.evidenceId } : {}), ...(sourceName ? { sourceName } : {}), ...(item.decisionId ? { decisionId: item.decisionId } : {}), ...(item.policyId ? { policyId: item.policyId } : {}), ...(item.assumptionId ? { assumptionId: item.assumptionId } : {}) },
    };
    if (splitFrom && effectiveTo && effectiveTo < effectiveFrom) { /* the change starts before the item does: apply the new amount throughout */ items.push({ ...base, id: item.id, amount: override!.amount!, ...(item.effectiveTo ? { effectiveTo: item.effectiveTo } : {}) }); continue; }
    items.push({ ...base, id: item.id });
    if (splitFrom) items.push({ ...base, id: `${item.id}:from:${splitFrom}`, amount: override!.amount!, effectiveFrom: splitFrom, ...(item.effectiveTo ? { effectiveTo: item.effectiveTo } : {}), basis: "assumed" });
  }
  for (const extra of options.extraItems ?? []) items.push(extra);

  // Actual cash events. Rows from rejected or still-pending evidence stay out;
  // rows created from balance or summary facts by the earlier approval path are
  // not transactions; one statement format lists sweep activity twice.
  const usable = eventRows.filter(({ event, evidenceStatus }) => (event.isActual === "Y" || evidenceStatus === "approved") && evidenceStatus !== "rejected" && evidenceStatus !== "pending" && !isSummaryDescription(event.description));
  const monthsWithCashFlowView = new Set(usable.filter(({ event }) => /^(?:Cash Flow Activity\b|\d{4}-\d{2}-\d{2}.*(?:Automated Payment|Wired Funds|Bank Product Withdrawal))/i.test(event.description)).map(({ event }) => event.month));
  const canonical = usable.filter(({ event }) => !(monthsWithCashFlowView.has(event.month) && isSweepCounterpartActivity(event.description)));
  const seen = new Map<string, DuplicateEvent>();
  const actualSources = new Map<string, { sourceName: string | null; evidenceId: string | null; evidenceStatus: string | null }>();
  const actuals: ActualEvent[] = [];
  // Imports carry an external key; prefer them as the canonical copy of a transaction.
  const ordered = [...canonical].sort((a, b) => Number(Boolean(b.event.externalKey)) - Number(Boolean(a.event.externalKey)));
  for (const { event, sourceName, evidenceStatus, evidenceAccountId } of ordered) {
    if (event.isActual !== "Y") continue;
    const accountId = event.accountEntityId ?? evidenceAccountId ?? undefined;
    const entityId = entityOf(event.entityId, accountId);
    if (!inView(entityId)) continue;
    const key = financialEventKey(event);
    const duplicate = seen.get(key);
    if (duplicate) { duplicate.eventIds.push(event.id); if (sourceName && !duplicate.sourceNames.includes(sourceName)) duplicate.sourceNames.push(sourceName); continue; }
    seen.set(key, { key, description: event.description, month: event.month, sourceNames: sourceName ? [sourceName] : [], eventIds: [event.id] });
    const amount = Number(event.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    actualSources.set(event.id, { sourceName, evidenceId: event.evidenceId, evidenceStatus });
    const activity = event.category === "transfer" || event.category === "investment" || event.category === "financing" ? event.category : "operating";
    const category = isCategory(event.financialCategory) ? event.financialCategory : legacyCategory(event.description, event.direction);
    actuals.push({
      id: event.id,
      month: event.month,
      ...(event.transactionDate ? { date: event.transactionDate } : {}),
      description: event.description,
      amount,
      direction: event.direction,
      activity,
      ...(category ? { category } : {}),
      ...(event.counterpartyEntityId ? { counterpartyEntityId: event.counterpartyEntityId } : {}),
      ...(event.settlesItemId ? { settlesItemId: event.settlesItemId } : {}),
      accountingTreatment: asTreatment(event.accountingTreatment),
      ...(event.recognitionStart ? { recognitionStart: event.recognitionStart } : {}),
      ...(event.recognitionEnd ? { recognitionEnd: event.recognitionEnd } : {}),
      ...(entityId ? { entityId } : {}),
      ...(accountId ? { accountId } : {}),
      provenance: { ...(event.evidenceId ? { evidenceId: event.evidenceId } : {}), ...(sourceName ? { sourceName } : {}), ...(event.policyId ? { policyId: event.policyId } : {}) },
    });
  }
  // Manually entered forecast events (isActual = N) are one-off assumed items.
  for (const { event, sourceName, evidenceAccountId } of canonical) {
    if (event.isActual === "Y") continue;
    const amount = Number(event.amount);
    if (!Number.isFinite(amount) || amount <= 0 || !isValidMonth(event.month)) continue;
    const manualEntity = entityOf(event.entityId, event.accountEntityId ?? evidenceAccountId);
    if (!inView(manualEntity)) continue;
    items.push({ id: `event:${event.id}`, ...(manualEntity ? { entityId: manualEntity } : {}), label: event.description, direction: event.direction, amount, category: isCategory(event.financialCategory) ? event.financialCategory : legacyCategory(event.description, event.direction) ?? (event.direction === "receipt" ? "other_revenue" : "other"), cadence: "once", effectiveFrom: event.month, accountingTreatment: asTreatment(event.accountingTreatment), ...(event.recognitionStart ? { recognitionStart: event.recognitionStart } : {}), ...(event.recognitionEnd ? { recognitionEnd: event.recognitionEnd } : {}), basis: "assumed", provenance: { ...(event.evidenceId ? { evidenceId: event.evidenceId } : {}), ...(sourceName ? { sourceName } : {}) } });
  }

  const allocationRules: AllocationRule[] = allocationRows.flatMap((row) => {
    if (!row.bearerEntityId) return [];
    const percentage = row.percentage ? Number(row.percentage) : undefined;
    const amount = row.amount ? Number(row.amount) : undefined;
    if ((percentage === undefined || !Number.isFinite(percentage)) && (amount === undefined || !Number.isFinite(amount))) return [];
    return [{ id: row.id, ...(row.eventId ? { eventId: row.eventId } : {}), ...(row.itemId ? { itemId: row.itemId } : {}), ...(row.counterpartyEntityId ? { counterpartyEntityId: row.counterpartyEntityId } : {}), bearerEntityId: row.bearerEntityId, ...(entityNames.has(row.bearerEntityId) ? { bearerName: entityNames.get(row.bearerEntityId)! } : {}), ...(percentage !== undefined && Number.isFinite(percentage) ? { percentage } : { amount: amount! }) }];
  });

  const statementBalances = statementBalancesFrom(evidenceRows, hasAccounts, accountInView).sort((a, b) => a.month.localeCompare(b.month));
  // Opening positions: rows for the entity in view (unstamped rows belong to the default entity); cash rows carry their account.
  const positions: OpeningPosition[] = positionRows.flatMap((row) => {
    if (!isLedger(row.ledger) || !isValidMonth(row.month)) return [];
    const amount = Number(row.amount);
    if (!Number.isFinite(amount)) return [];
    const entityId = row.entityId ?? (row.accountEntityId ? structure.entityOfAccount(row.accountEntityId) : structure.defaultEntityId);
    if (!inView(entityId)) return [];
    return [{ month: row.month, ledger: row.ledger, amount, ...(entityId ? { entityId } : {}), ...(row.accountEntityId ? { accountId: row.accountEntityId } : {}) }];
  });
  // The legacy opening cash figure belongs to the default entity. A statement opening balance serves when nothing else is set.
  const openingPeriod = periodRows.filter((period) => Number(period.openingCash) !== 0 && isValidMonth(period.month)).sort((a, b) => a.month.localeCompare(b.month))[0];
  const openingStatement = statementBalances.find((balance) => balance.opening !== undefined);
  const hasCashPositions = positions.some((position) => position.ledger === "cash");
  const openingCash = hasCashPositions ? undefined : openingPeriod && inView(structure.defaultEntityId) ? { month: openingPeriod.month, amount: Number(openingPeriod.openingCash) } : openingStatement ? { month: openingStatement.month, amount: openingStatement.opening! } : undefined;

  const dataMonths = [...actuals.map((actual) => actual.month), ...items.map((item) => item.effectiveFrom), ...(openingCash ? [openingCash.month] : []), ...positions.map((position) => position.month), ...statementBalances.map((balance) => balance.month)].filter(isValidMonth);
  const earliest = dataMonths.length ? dataMonths.reduce((min, month) => (month < min ? month : min)) : asOfMonth;
  const floor = addMonths(asOfMonth, -36);
  const start = [earliest, `${asOfMonth.slice(0, 4)}-01`].reduce((min, month) => (month < min ? month : min));
  const horizon = { start: start < floor ? floor : start, end: addMonths(asOfMonth, 11) };

  const input: EngineInput = {
    ...(openingCash ? { openingCash } : {}),
    asOfMonth,
    horizon,
    items,
    actuals,
    allocations: allocationRules,
    closedMonths: periodRows.filter((period) => period.status === "closed").map((period) => period.month),
    ...(options.scenarioId ? { scenarioId: options.scenarioId } : {}),
    statementBalances,
    entities: structure.legalEntities.map((entity) => ({ id: entity.id, name: entity.name, consolidated: entity.consolidated })),
    accounts: structure.accounts.map((account) => ({ id: account.id, name: account.name, ...(account.ownerEntityId ? { entityId: account.ownerEntityId } : {}) })),
    openingPositions: positions,
    consolidate: view.consolidated,
  };
  return { input, duplicates: [...seen.values()].filter((entry) => entry.eventIds.length > 1), entityNames, itemRows, actualSources, structure, view };
}

export async function computeFinancials(companyId: string, options: FinancialOptions = {}): Promise<FinancialContext> {
  const loaded = await loadFinancialInput(companyId, options);
  return { ...loaded, output: runEngine(loaded.input) };
}

/** Shape one engine month for the forecast endpoint and the agent. */
export function forecastMonthView(month: EngineOutput["months"][number], context: Pick<FinancialContext, "actualSources">) {
  return {
    month: month.month,
    status: month.status,
    ...(month.openingCash !== undefined ? { openingCash: month.openingCash } : {}),
    endingCash: month.endingCash ?? 0,
    hasCashBalance: month.endingCash !== undefined,
    receipts: month.receipts,
    spending: month.spending,
    net: month.net,
    expectedReceipts: month.expectedReceipts,
    expectedSpending: month.expectedSpending,
    actualReceipts: month.actualReceipts,
    actualSpending: month.actualSpending,
    actualNet: month.actualNet,
    variance: month.variance,
    contractualReceipts: month.contractualReceipts,
    contractualSpending: month.contractualSpending,
    assumedReceipts: month.assumedReceipts,
    assumedSpending: month.assumedSpending,
    outstanding: month.outstanding,
    intercompany: month.intercompany,
    ...(month.statement ? { statement: month.statement } : {}),
    balanceSheet: month.balanceSheet,
    cashFlow: month.cashFlow,
    trace: month.lines.filter((line) => line.cash).map((line) => ({ description: line.description, evidenceId: line.provenance.evidenceId ?? null, sourceName: line.provenance.sourceName ?? (line.eventId ? context.actualSources.get(line.eventId)?.sourceName ?? null : null), amount: line.amount, kind: line.direction, actual: line.kind === "actual", basis: line.basis ?? null, itemId: line.itemId ?? null, eventId: line.eventId ?? null, settledBy: line.settledBy ?? [], settles: line.settles ?? null })),
  };
}

export function pnlMonthView(month: EngineOutput["months"][number]) {
  return {
    month: month.month,
    status: month.status,
    revenue: month.pnl.revenue,
    expenses: month.pnl.expenses,
    operatingIncome: month.pnl.operatingIncome,
    byCategory: month.pnl.byCategory,
    revenueByCategory: month.pnl.revenueByCategory,
    allocatedOut: month.pnl.allocatedOut,
    uncategorized: month.pnl.uncategorized,
    trace: month.lines.filter((line) => line.recognized).map((line) => ({ description: line.description, amount: line.amount, direction: line.direction, category: line.category ?? "other", kind: line.kind, basis: line.basis ?? null, evidenceId: line.provenance.evidenceId ?? null, itemId: line.itemId ?? null, eventId: line.eventId ?? null, bearerName: line.bearerName ?? null })),
  };
}
