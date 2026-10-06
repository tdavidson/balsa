import { cashFlag } from "./cash-flag";
import { buildTrialBalance, type EntryBasis, type PostedJournalLine, type TrialBalanceLine } from "./ledger";

export type StatementAccountLine = {
  key: string;
  label: string;
  /** Set when every account in the group carries a resolved cash flag: true if any of them is cash. */
  isCash?: boolean;
  amountMinor: string;
  accountIds: string[];
  lineIds: string[];
  provenance: TrialBalanceLine["provenance"];
};

export type CurrencyJournalStatements = {
  currency: string;
  incomeStatement: { revenue: StatementAccountLine[]; expenses: StatementAccountLine[]; netIncomeMinor: string };
  balanceSheet: { assets: StatementAccountLine[]; liabilities: StatementAccountLine[]; equity: StatementAccountLine[]; /** Explicit chart classifications; uncategorized accounts remain in the full section lists. */ currentAssets?: StatementAccountLine[]; noncurrentAssets?: StatementAccountLine[]; currentLiabilities?: StatementAccountLine[]; noncurrentLiabilities?: StatementAccountLine[]; retainedEarningsMinor: string; /** Current cumulative P&L not yet moved by a period-close entry. */ unclosedEarningsMinor?: string; totalAssetsMinor: string; totalLiabilitiesAndEquityMinor: string; differenceMinor: string; balanced: boolean };
  workingCapital?: { category: string; openingMinor: string; closingMinor: string; changeMinor: string; accountIds: string[]; lineIds: string[] }[];
  unclassified: StatementAccountLine[];
  cashFlow?: {
    operatingMinor: string; investingMinor: string; financingMinor: string; netChangeMinor: string; cashMovementMinor: string; cashReceiptsMinor: string; cashSpendingMinor: string; ties: boolean;
    entries: { entryId: string; category: "operating" | "investing" | "financing" | "unclassified"; classification: "account" | "inferred" | "unclassified"; cashLineIds: string[]; counterpartLineIds: string[] }[];
    unclassifiedEntryIds: string[]; inferredEntryIds: string[];
  };
};

export type JournalStatements = { period: string; byCurrency: CurrencyJournalStatements[] };

/**
 * A report view is deliberately a selection of entries, never a second
 * calculation engine. `projected` uses posted actuals through the as-of
 * period and base forecast entries afterwards. `scenario` adds only the
 * named scenario's entries to that same baseline.
 */
export type JournalStatementSelection = {
  basis?: EntryBasis | "all";
  scenarioId?: string;
  view?: "actual" | "projected" | "scenario";
  asOfPeriod?: string;
};

export function selectJournalLinesForReporting(lines: PostedJournalLine[], period: string, selection: JournalStatementSelection = {}) {
  const basis = selection.basis;
  if (basis) return lines.filter((line) => line.period <= period && (basis === "all" || (line.basis ?? "actual") === basis) && (!selection.scenarioId || line.scenarioId === selection.scenarioId));

  const view = selection.view ?? "actual";
  if (view === "actual") return lines.filter((line) => line.period <= period && ["actual", "adjustment", "elimination"].includes(line.basis ?? "actual"));

  const asOfPeriod = selection.asOfPeriod ?? period;
  return lines.filter((line) => {
    if (line.period > period) return false;
    const entryBasis = line.basis ?? "actual";
    if (["actual", "adjustment", "elimination"].includes(entryBasis)) return line.period <= asOfPeriod;
    if (entryBasis === "forecast") return line.period > asOfPeriod;
    // A plan pin (basis "plan") is a frozen snapshot for later variance
    // comparison; only a live scenario projection belongs in the scenario view.
    return entryBasis === "scenario" && view === "scenario" && Boolean(selection.scenarioId) && line.scenarioId === selection.scenarioId && line.period > asOfPeriod;
  });
}

const amount = (line: TrialBalanceLine) => BigInt(line.netMinor);
/** Statement sign: assets and expenses debit-positive; liabilities, equity and revenue credit-positive. */
export const presentationAmount = (line: TrialBalanceLine) => {
  const section = line.accountType === "contra" ? line.statementSection : line.accountType;
  if (section === "asset" || section === "expense") return amount(line);
  if (section === "liability" || section === "equity" || section === "revenue") return -amount(line);
  // An unmapped contra remains inspectable but cannot be assigned a statement sign.
  return line.normalBalance === "debit" ? amount(line) : -amount(line);
};

function aggregate(lines: TrialBalanceLine[]): StatementAccountLine[] {
  const grouped = new Map<string, { label: string; amount: bigint; accountIds: string[]; lineIds: string[]; provenance: TrialBalanceLine["provenance"]; cashFlags: (boolean | undefined)[] }>();
  for (const line of lines) {
    const key = line.statementLine ?? line.accountCode;
    const group = grouped.get(key) ?? { label: line.statementLine ?? line.accountName, amount: 0n, accountIds: [], lineIds: [], provenance: [], cashFlags: [] };
    group.cashFlags.push(line.isCash);
    group.amount += presentationAmount(line);
    group.accountIds.push(line.accountId);
    group.lineIds.push(...line.lineIds);
    group.provenance.push(...line.provenance);
    grouped.set(key, group);
  }
  return [...grouped.entries()].map(([key, group]) => ({ key, label: group.label, ...(group.cashFlags.every((flag) => flag !== undefined) ? { isCash: group.cashFlags.some(Boolean) } : {}), amountMinor: group.amount.toString(), accountIds: group.accountIds, lineIds: group.lineIds, provenance: group.provenance })).sort((left, right) => left.label.localeCompare(right.label));
}

export type AccountPresentationBalance = { line: TrialBalanceLine; amountMinor: bigint };

/**
 * Per-account statement amounts using exactly the selection and sign rules of
 * `buildJournalStatements`: `period` holds income-statement movement for the
 * period (period-close entries excluded), `balance` holds balances through it.
 * Alternative layouts regroup these rather than recalculating anything.
 */
export function buildAccountPresentationBalances(lines: PostedJournalLine[], period: string, entityId?: string, selection: JournalStatementSelection = {}) {
  const included = selectJournalLinesForReporting(lines, period, selection).filter((line) => !entityId || line.entityId === entityId);
  const toAmounts = (trial: ReturnType<typeof buildTrialBalance>) => trial.lines.map((line) => ({ line, amountMinor: presentationAmount(line) }));
  return {
    balance: toAmounts(buildTrialBalance(included, period, entityId)),
    period: toAmounts(buildTrialBalance(included.filter((line) => line.period === period && line.entrySource !== "period_close"), period, entityId)),
  };
}

/**
 * Produce conventional statements from posted journal lines. Balance-sheet
 * accounts roll through the selected period; revenue and expenses are limited
 * to that period. Unclosed earnings are retained explicitly in equity so the
 * accounting equation remains auditable before a close entry is posted.
 */
export function buildJournalStatements(lines: PostedJournalLine[], period: string, entityId?: string, selection: JournalStatementSelection = {}): JournalStatements {
  const included = selectJournalLinesForReporting(lines, period, selection).filter((line) => !entityId || line.entityId === entityId);
  const balanceTrial = buildTrialBalance(included, period, entityId);
  const openingTrial = buildTrialBalance(included.filter((line) => line.period < period), period, entityId);
  // A close zeroes P&L account balances, but it is a balance-sheet movement;
  // period performance remains the underlying operating entries.
  const periodTrial = buildTrialBalance(included.filter((line) => line.period === period && line.entrySource !== "period_close"), period, entityId);
  const currencies = new Set([...balanceTrial.lines.map((line) => line.currency), ...periodTrial.lines.map((line) => line.currency)]);
  const byCurrency = [...currencies].sort().map((currency) => {
    const balanceLines = balanceTrial.lines.filter((line) => line.currency === currency);
    const openingLines = openingTrial.lines.filter((line) => line.currency === currency);
    const periodLines = periodTrial.lines.filter((line) => line.currency === currency);
    const section = (line: TrialBalanceLine) => line.accountType === "contra" ? line.statementSection : line.accountType;
    const assets = aggregate(balanceLines.filter((line) => section(line) === "asset"));
    const liabilities = aggregate(balanceLines.filter((line) => section(line) === "liability"));
    const currentAssets = aggregate(balanceLines.filter((line) => section(line) === "asset" && line.balanceTiming === "current"));
    const noncurrentAssets = aggregate(balanceLines.filter((line) => section(line) === "asset" && line.balanceTiming === "noncurrent"));
    const currentLiabilities = aggregate(balanceLines.filter((line) => section(line) === "liability" && line.balanceTiming === "current"));
    const noncurrentLiabilities = aggregate(balanceLines.filter((line) => section(line) === "liability" && line.balanceTiming === "noncurrent"));
    const isRetainedEarnings = (line: TrialBalanceLine) => /retained[ _-]?earnings/i.test(`${line.statementLine ?? ""} ${line.accountName}`);
    const equity = aggregate(balanceLines.filter((line) => section(line) === "equity" && !isRetainedEarnings(line)));
    const retainedEarningsAccounts = aggregate(balanceLines.filter((line) => section(line) === "equity" && isRetainedEarnings(line)));
    const revenue = aggregate(periodLines.filter((line) => section(line) === "revenue"));
    const expenses = aggregate(periodLines.filter((line) => section(line) === "expense"));
    const netIncome = revenue.reduce((sum, line) => sum + BigInt(line.amountMinor), 0n) - expenses.reduce((sum, line) => sum + BigInt(line.amountMinor), 0n);
    const unclosedEarnings = aggregate(balanceLines.filter((line) => section(line) === "revenue")).reduce((sum, line) => sum + BigInt(line.amountMinor), 0n) - aggregate(balanceLines.filter((line) => section(line) === "expense")).reduce((sum, line) => sum + BigInt(line.amountMinor), 0n);
    const retainedEarnings = retainedEarningsAccounts.reduce((sum, line) => sum + BigInt(line.amountMinor), 0n);
    const totalAssets = assets.reduce((sum, line) => sum + BigInt(line.amountMinor), 0n);
    const totalLiabilitiesAndEquity = liabilities.reduce((sum, line) => sum + BigInt(line.amountMinor), 0n) + equity.reduce((sum, line) => sum + BigInt(line.amountMinor), 0n) + retainedEarnings + unclosedEarnings;
    const difference = totalAssets - totalLiabilitiesAndEquity;
    const workingCapital = [...new Set(balanceLines.map((line) => line.workingCapitalCategory).filter(Boolean))].map((category) => {
      const closing = balanceLines.filter((line) => line.workingCapitalCategory === category);
      const opening = openingLines.filter((line) => line.workingCapitalCategory === category);
      const closingMinor = closing.reduce((sum, line) => sum + presentationAmount(line), 0n);
      const openingMinor = opening.reduce((sum, line) => sum + presentationAmount(line), 0n);
      return { category: category!, openingMinor: openingMinor.toString(), closingMinor: closingMinor.toString(), changeMinor: (closingMinor - openingMinor).toString(), accountIds: closing.map((line) => line.accountId), lineIds: closing.flatMap((line) => line.lineIds) };
    });
    const entries = new Map<string, PostedJournalLine[]>();
    for (const line of included.filter((line) => line.period === period && line.currency === currency)) entries.set(line.entryId ?? line.id, [...(entries.get(line.entryId ?? line.id) ?? []), line]);
    let operating = 0n; let investing = 0n; let financing = 0n; let cashMovement = 0n; let cashReceipts = 0n; let cashSpending = 0n;
    const entriesForCashFlow: NonNullable<CurrencyJournalStatements["cashFlow"]>["entries"] = [];
    for (const [entryId, entryLines] of entries) {
      const cash = entryLines.filter((line) => cashFlag(line, () => /cash/.test(`${line.statementLine ?? ""} ${line.accountName}`.toLowerCase())));
      if (!cash.length) continue;
      const movement = cash.reduce((sum, line) => sum + BigInt(line.debitMinor) - BigInt(line.creditMinor), 0n);
      cashMovement += movement;
      if (movement >= 0n) cashReceipts += movement; else cashSpending += -movement;
      const counterparts = entryLines.filter((line) => !cash.includes(line));
      const cashLineIds = cash.map((line) => line.id);
      const counterpartLineIds = counterparts.map((line) => line.id);
      if (!counterparts.length) {
        entriesForCashFlow.push({ entryId, category: "unclassified", classification: "unclassified", cashLineIds, counterpartLineIds });
        continue;
      }
      const declared = new Set(counterparts.map((line) => line.cashFlowCategory).filter((category): category is "operating" | "investing" | "financing" => Boolean(category && category !== "none")));
      if (declared.size === 1) {
        const [category] = declared;
        if (category === "operating") operating += movement;
        if (category === "investing") investing += movement;
        if (category === "financing") financing += movement;
        entriesForCashFlow.push({ entryId, category: category!, classification: "account", cashLineIds, counterpartLineIds });
        continue;
      }
      if (declared.size > 1) {
        entriesForCashFlow.push({ entryId, category: "unclassified", classification: "unclassified", cashLineIds, counterpartLineIds });
        continue;
      }
      const types = new Set(counterparts.map((line) => line.accountType === "contra" ? line.statementSection : line.accountType));
      const category = types.has("equity") ? "financing" : counterparts.some((line) => /investment|equipment|property/.test(`${line.statementLine ?? ""} ${line.accountName}`.toLowerCase())) ? "investing" : "operating";
      if (category === "operating") operating += movement;
      if (category === "investing") investing += movement;
      if (category === "financing") financing += movement;
      entriesForCashFlow.push({ entryId, category, classification: "inferred", cashLineIds, counterpartLineIds });
    }
    const unclassifiedEntryIds = entriesForCashFlow.filter((entry) => entry.classification === "unclassified").map((entry) => entry.entryId);
    const inferredEntryIds = entriesForCashFlow.filter((entry) => entry.classification === "inferred").map((entry) => entry.entryId);
    const netChange = operating + investing + financing;
    return { currency, incomeStatement: { revenue, expenses, netIncomeMinor: netIncome.toString() }, balanceSheet: { assets, liabilities, equity, currentAssets, noncurrentAssets, currentLiabilities, noncurrentLiabilities, retainedEarningsMinor: retainedEarnings.toString(), unclosedEarningsMinor: unclosedEarnings.toString(), totalAssetsMinor: totalAssets.toString(), totalLiabilitiesAndEquityMinor: totalLiabilitiesAndEquity.toString(), differenceMinor: difference.toString(), balanced: difference === 0n }, workingCapital, unclassified: aggregate(balanceLines.filter((line) => line.accountType === "contra" && !line.statementSection)), cashFlow: { operatingMinor: operating.toString(), investingMinor: investing.toString(), financingMinor: financing.toString(), netChangeMinor: netChange.toString(), cashMovementMinor: cashMovement.toString(), cashReceiptsMinor: cashReceipts.toString(), cashSpendingMinor: cashSpending.toString(), ties: netChange === cashMovement, entries: entriesForCashFlow, unclassifiedEntryIds, inferredEntryIds } };
  });
  return { period, byCurrency };
}
