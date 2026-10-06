import type { PostedJournalLine, TrialBalanceLine } from "./ledger";
import { buildAccountPresentationBalances, buildJournalStatements, type JournalStatementSelection } from "./statements";

/**
 * The Standard Financial Model statement layout: a fixed line set that chart
 * accounts map onto, with optional user-defined categories under each line.
 * The layout regroups the same per-account amounts the ledger statements use;
 * it never changes a journal, a balance or a total.
 */
export const standardLayoutVersion = "standard-layout-2026-10-06.1";

export type StandardStatementSection = "revenue" | "expense" | "asset" | "liability" | "equity";
export type StandardIncomeGroup = "revenue" | "cogs" | "sga" | "below_ebitda" | "taxes";
export type StandardLineDefinition = { id: string; label: string; section: StandardStatementSection; group?: StandardIncomeGroup; timing?: "current" | "noncurrent"; fallback?: boolean };

export const standardLines = [
  { id: "revenue", label: "Revenues", section: "revenue", group: "revenue" },
  { id: "cogs", label: "COGS", section: "expense", group: "cogs" },
  { id: "sga_rd", label: "Research & development", section: "expense", group: "sga" },
  { id: "sga_sales", label: "Sales & marketing", section: "expense", group: "sga" },
  { id: "sga_ga", label: "General & administrative", section: "expense", group: "sga" },
  { id: "sga_misc", label: "Other SG&A", section: "expense", group: "sga", fallback: true },
  { id: "depreciation", label: "Depreciation", section: "expense", group: "below_ebitda" },
  { id: "amortization", label: "Amortization", section: "expense", group: "below_ebitda" },
  { id: "interest_income", label: "Interest income", section: "revenue", group: "below_ebitda" },
  { id: "interest_expense", label: "Interest expense", section: "expense", group: "below_ebitda" },
  { id: "other_income", label: "Other income", section: "revenue", group: "below_ebitda", fallback: true },
  { id: "other_expense", label: "Other expense", section: "expense", group: "below_ebitda" },
  { id: "taxes", label: "Taxes", section: "expense", group: "taxes" },
  { id: "cash", label: "Cash", section: "asset", timing: "current" },
  { id: "accounts_receivable", label: "Accounts receivable", section: "asset", timing: "current" },
  { id: "inventory", label: "Inventory", section: "asset", timing: "current" },
  { id: "prepaid_expense", label: "Prepaid expense", section: "asset", timing: "current" },
  { id: "other_current_assets", label: "Other current assets", section: "asset", timing: "current", fallback: true },
  { id: "ppe", label: "PP&E", section: "asset", timing: "noncurrent" },
  { id: "accumulated_depreciation", label: "Accumulated depreciation", section: "asset", timing: "noncurrent" },
  { id: "other_assets", label: "Other assets", section: "asset", timing: "noncurrent", fallback: true },
  { id: "accumulated_amortization", label: "Accumulated amortization", section: "asset", timing: "noncurrent" },
  { id: "accounts_payable", label: "Accounts payable", section: "liability", timing: "current" },
  { id: "inventory_ap", label: "Inventory AP", section: "liability", timing: "current" },
  { id: "deferred_revenue", label: "Deferred revenue", section: "liability", timing: "current" },
  { id: "accrued_liabilities", label: "Accrued liabilities", section: "liability", timing: "current" },
  { id: "corporate_tax_payable", label: "Corporate tax payable", section: "liability", timing: "current" },
  { id: "vat_payable", label: "VAT payable", section: "liability", timing: "current" },
  { id: "working_capital_loan", label: "Working capital loan facility", section: "liability", timing: "current" },
  { id: "other_current_liabilities", label: "Other current liabilities", section: "liability", timing: "current", fallback: true },
  { id: "convertible_notes_safes", label: "Convertible notes and SAFEs", section: "liability", timing: "noncurrent" },
  { id: "debt_financing", label: "Debt financing", section: "liability", timing: "noncurrent" },
  { id: "accrued_interest", label: "Accrued interest", section: "liability", timing: "noncurrent" },
  { id: "other_noncurrent_liabilities", label: "Other non-current liabilities", section: "liability", timing: "noncurrent", fallback: true },
  { id: "owners_equity", label: "Owners equity", section: "equity" },
  { id: "equity_investment", label: "Equity investment", section: "equity" },
  { id: "safe_investment", label: "SAFE investment", section: "equity" },
  { id: "retained_earnings", label: "Retained earnings", section: "equity" },
  { id: "other_equity", label: "Other equity", section: "equity", fallback: true },
] as const satisfies readonly StandardLineDefinition[];

export type StandardLineId = (typeof standardLines)[number]["id"];
const lineById = new Map<string, StandardLineDefinition>(standardLines.map((line) => [line.id, line]));
export const isStandardLineId = (value: string): value is StandardLineId => lineById.has(value);
export const standardLineDefinition = (id: StandardLineId) => lineById.get(id)!;

/** The chart fields a mapping reads. `reportLine` is the user's confirmed choice; absent means unconfirmed. */
export type StandardMappingAccount = Pick<TrialBalanceLine, "accountId" | "accountCode" | "accountName" | "accountType" | "normalBalance" | "statementSection" | "statementLine" | "balanceTiming" | "cashFlowCategory" | "workingCapitalCategory"> & { hasBankIdentifier?: boolean; reportLine?: StandardLineId | null; reportCategoryId?: string | null };
export type ReportCategory = { id: string; line: StandardLineId; name: string; sortOrder: number };
export type StandardMappingStatus = "confirmed" | "suggested" | "fallback" | "unclassified";
export type ResolvedStandardMapping = { accountId: string; line: StandardLineId | null; categoryId: string | null; status: StandardMappingStatus; reason: string };

/** Statement section an account presents in; a contra account takes the section it offsets. */
export const accountStatementSection = (account: Pick<StandardMappingAccount, "accountType" | "statementSection">): StandardStatementSection | null => {
  const section = account.accountType === "contra" ? account.statementSection : account.accountType;
  return section === "revenue" || section === "expense" || section === "asset" || section === "liability" || section === "equity" ? section : null;
};

/** A line may only hold accounts from its own statement section. */
export const lineAcceptsAccount = (line: StandardLineId, account: Pick<StandardMappingAccount, "accountType" | "statementSection">) => standardLineDefinition(line).section === accountStatementSection(account);

type Rule = { line: StandardLineId; pattern: RegExp; reason: string };
const rules: Record<StandardStatementSection, Rule[]> = {
  asset: [
    { line: "accumulated_depreciation", pattern: /accumulated depreciation/, reason: "named accumulated depreciation" },
    { line: "accumulated_amortization", pattern: /accumulated amorti[sz]ation/, reason: "named accumulated amortization" },
    { line: "cash", pattern: /\bcash\b|\bbank\b|checking|savings|money market/, reason: "named as cash or a bank account" },
    { line: "accounts_receivable", pattern: /receivable/, reason: "named as a receivable" },
    { line: "inventory", pattern: /inventor/, reason: "named as inventory" },
    { line: "prepaid_expense", pattern: /prepaid|prepayment/, reason: "named as a prepaid" },
    { line: "ppe", pattern: /equipment|property|furniture|computer|vehicle|leasehold|machinery|fixed asset|pp&e/, reason: "named as fixed assets" },
    { line: "other_assets", pattern: /intangible|goodwill|deposit|capitali[sz]ed software/, reason: "named as an other long-term asset" },
  ],
  liability: [
    { line: "vat_payable", pattern: /\bvat\b|sales tax|\bgst\b|\bhst\b/, reason: "named as VAT or sales tax" },
    { line: "corporate_tax_payable", pattern: /income tax|corporate tax|tax payable|taxes payable/, reason: "named as tax payable" },
    { line: "accrued_interest", pattern: /accrued interest|interest payable/, reason: "named as accrued interest" },
    { line: "deferred_revenue", pattern: /deferred revenue|unearned|customer deposit/, reason: "named as deferred revenue" },
    { line: "convertible_notes_safes", pattern: /\bsafe\b|convertible/, reason: "named as a SAFE or convertible note" },
    { line: "working_capital_loan", pattern: /line of credit|working capital|revolv/, reason: "named as a working capital facility" },
    { line: "inventory_ap", pattern: /inventor.*payable/, reason: "named as inventory payable" },
    { line: "accounts_payable", pattern: /payable|credit card/, reason: "named as a payable" },
    { line: "accrued_liabilities", pattern: /accrued|accrual|payroll liabilit/, reason: "named as an accrual" },
    { line: "debt_financing", pattern: /loan|debt|note|credit facility|borrowing/, reason: "named as debt" },
  ],
  equity: [
    { line: "retained_earnings", pattern: /retained earnings/, reason: "named retained earnings" },
    { line: "safe_investment", pattern: /\bsafe\b/, reason: "named as a SAFE" },
    { line: "equity_investment", pattern: /preferred|series [a-z]|paid[- ]in|apic|common stock|share capital|stock|investment/, reason: "named as invested capital" },
    { line: "owners_equity", pattern: /owner|member|partner|capital|draw|distribution|contribution/, reason: "named as owners equity" },
  ],
  revenue: [
    { line: "interest_income", pattern: /interest/, reason: "named as interest" },
    { line: "other_income", pattern: /other income|gain|dividend|miscellaneous income|grant/, reason: "named as other income" },
    { line: "revenue", pattern: /./, reason: "a revenue account" },
  ],
  expense: [
    { line: "depreciation", pattern: /depreciation/, reason: "named depreciation" },
    { line: "amortization", pattern: /amorti[sz]ation/, reason: "named amortization" },
    { line: "interest_expense", pattern: /interest/, reason: "named as interest" },
    { line: "taxes", pattern: /income tax|corporate tax|franchise tax/, reason: "named as income tax" },
    { line: "cogs", pattern: /cost of (goods|sales|revenue)|\bcogs\b|materials|freight|fulfil|merchant fee|payment processing/, reason: "named as a cost of sales" },
    { line: "other_expense", pattern: /loss on|other expense|foreign exchange|fx loss|bad debt/, reason: "named as other expense" },
    { line: "sga_sales", pattern: /marketing|advertis|\bsales\b|commission|promotion|sponsor|events/, reason: "named as sales or marketing" },
    { line: "sga_rd", pattern: /research|development|engineering|r&d/, reason: "named as research and development" },
    { line: "sga_ga", pattern: /rent|lease|legal|accounting|audit|insurance|office|admin|bank (fee|charge)|professional|utilit|software|subscription|payroll|salar|wage|benefit|travel|meal|telephone|internet|dues|licen[cs]e/, reason: "named as general and administrative" },
  ],
};
const workingCapitalLines: Partial<Record<NonNullable<StandardMappingAccount["workingCapitalCategory"]>, StandardLineId>> = { receivables: "accounts_receivable", inventory: "inventory", prepaids: "prepaid_expense", payables: "accounts_payable", deferred_revenue: "deferred_revenue" };
const fallbackLine = (section: StandardStatementSection, timing?: string): StandardLineId => section === "asset" ? (timing === "noncurrent" ? "other_assets" : "other_current_assets") : section === "liability" ? (timing === "noncurrent" ? "other_noncurrent_liabilities" : "other_current_liabilities") : section === "equity" ? "other_equity" : section === "revenue" ? "other_income" : "sga_misc";

/** Deterministic default for an account with no confirmed mapping. Never a model call. */
export function suggestStandardLine(account: StandardMappingAccount): { line: StandardLineId | null; status: "suggested" | "fallback" | "unclassified"; reason: string } {
  const section = accountStatementSection(account);
  if (!section) return { line: null, status: "unclassified", reason: "A contra account needs the statement section it offsets before it can be placed." };
  const workingCapital = account.workingCapitalCategory ? workingCapitalLines[account.workingCapitalCategory] : undefined;
  if (workingCapital && standardLineDefinition(workingCapital).section === section) return { line: workingCapital, status: "suggested", reason: `Working capital category ${account.workingCapitalCategory!.replace(/_/g, " ")}` };
  if (section === "asset" && account.hasBankIdentifier) return { line: "cash", status: "suggested", reason: "Linked to a bank account" };
  const text = `${account.statementLine ?? ""} ${account.accountName}`.toLowerCase();
  const rule = rules[section].find((candidate) => candidate.pattern.test(text));
  if (rule) return { line: rule.line, status: "suggested", reason: `${rule.reason[0]!.toUpperCase()}${rule.reason.slice(1)}` };
  const line = fallbackLine(section, account.balanceTiming);
  return { line, status: "fallback", reason: `No rule matched; placed on ${standardLineDefinition(line).label}` };
}

/** The user's confirmed choice wins; otherwise the deterministic suggestion. A category is kept only under its own line. */
export function resolveStandardMapping(accounts: StandardMappingAccount[], categories: ReportCategory[]): Map<string, ResolvedStandardMapping> {
  const categoryLine = new Map(categories.map((category) => [category.id, category.line]));
  const resolved = new Map<string, ResolvedStandardMapping>();
  for (const account of accounts) {
    const confirmed = account.reportLine && lineAcceptsAccount(account.reportLine, account) ? account.reportLine : null;
    const result = confirmed ? { line: confirmed, status: "confirmed" as const, reason: "Set by a user" } : suggestStandardLine(account);
    const categoryId = account.reportCategoryId && result.line && categoryLine.get(account.reportCategoryId) === result.line ? account.reportCategoryId : null;
    resolved.set(account.accountId, { accountId: account.accountId, line: result.line, categoryId, status: result.status, reason: result.reason });
  }
  return resolved;
}

/** A mapping is complete when every account in use carries a confirmed line. */
export const standardMappingComplete = (mapping: Iterable<ResolvedStandardMapping>) => [...mapping].every((item) => item.status === "confirmed");

export type StandardRowKind = "line" | "category" | "uncategorized" | "subtotal" | "total";
/** `accounts` is each contributing account's amount, for drill-down; it sums to `amountMinor` on line, category and uncategorized rows. */
export type StandardRowAccount = { accountId: string; amountMinor: string };
export type StandardRow = { key: string; label: string; kind: StandardRowKind; depth: 0 | 1; amountMinor: string; accounts: StandardRowAccount[]; line?: StandardLineId; categoryId?: string };
export type StandardCheck = { key: string; label: string; ok: boolean; differenceMinor: string };
export type StandardCurrencyStatements = {
  currency: string;
  incomeStatement: StandardRow[];
  balanceSheet: StandardRow[];
  cashFlow: StandardRow[];
  checks: StandardCheck[];
  /** Accounts with an amount in this period that the layout could not place (an unclassified contra). */
  unplacedAccountIds: string[];
};
export type StandardStatements = { period: string; layoutVersion: string; byCurrency: StandardCurrencyStatements[] };
/** `currency` guarantees that currency is present, with every row at zero, even when the period has no lines in it. */
export type StandardLayoutInput = { accounts: StandardMappingAccount[]; categories: ReportCategory[]; entityId?: string; selection?: JournalStatementSelection; currency?: string };

type Amounts = Map<string, { amount: bigint; accounts: Map<string, bigint> }>;
const add = (amounts: Amounts, key: string, amount: bigint, accountId: string) => { const current = amounts.get(key) ?? { amount: 0n, accounts: new Map<string, bigint>() }; current.amount += amount; current.accounts.set(accountId, (current.accounts.get(accountId) ?? 0n) + amount); amounts.set(key, current); };
const accountList = (accounts: Map<string, bigint>): StandardRowAccount[] => [...accounts.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([accountId, amount]) => ({ accountId, amountMinor: amount.toString() }));
const sum = (rows: StandardRow[]) => rows.reduce((total, row) => total + BigInt(row.amountMinor), 0n);
const total = (key: string, label: string, amount: bigint, kind: "subtotal" | "total" = "subtotal"): StandardRow => ({ key, label, kind, depth: 0, amountMinor: amount.toString(), accounts: [] });

/**
 * Rows for one line: the line itself, then one row per category and an
 * "Uncategorized" row whenever the line has categories. Rows depend only on
 * the line set and the category list, so every period has the same rows.
 */
function lineRows(lineId: StandardLineId, categories: ReportCategory[], byLine: Amounts, byCategory: Amounts): StandardRow[] {
  const definition = standardLineDefinition(lineId);
  const own = categories.filter((category) => category.line === lineId).sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name));
  const lineAmount = byLine.get(lineId) ?? { amount: 0n, accounts: new Map<string, bigint>() };
  const rows: StandardRow[] = [{ key: `line:${lineId}`, label: definition.label, kind: "line", depth: 0, amountMinor: lineAmount.amount.toString(), accounts: accountList(lineAmount.accounts), line: lineId }];
  if (!own.length) return rows;
  let categorized = 0n; const categorizedAccounts = new Set<string>();
  for (const category of own) {
    const amount = byCategory.get(category.id) ?? { amount: 0n, accounts: new Map<string, bigint>() };
    categorized += amount.amount; amount.accounts.forEach((_, id) => categorizedAccounts.add(id));
    rows.push({ key: `category:${category.id}`, label: category.name, kind: "category", depth: 1, amountMinor: amount.amount.toString(), accounts: accountList(amount.accounts), line: lineId, categoryId: category.id });
  }
  rows.push({ key: `uncategorized:${lineId}`, label: "Uncategorized", kind: "uncategorized", depth: 1, amountMinor: (lineAmount.amount - categorized).toString(), accounts: accountList(new Map([...lineAmount.accounts].filter(([id]) => !categorizedAccounts.has(id)))), line: lineId });
  return rows;
}

const linesIn = (predicate: (line: StandardLineDefinition) => boolean) => standardLines.filter(predicate).map((line) => line.id);
const lineAmount = (rows: StandardRow[], id: StandardLineId) => BigInt(rows.find((row) => row.key === `line:${id}`)?.amountMinor ?? "0");
const topLines = (rows: StandardRow[]) => rows.filter((row) => row.kind === "line");

/**
 * Regroup one period's statements into the Standard layout. Amounts come from
 * `buildAccountPresentationBalances`; totals are checked against
 * `buildJournalStatements` for the same lines, period and selection.
 */
export function buildStandardStatements(lines: PostedJournalLine[], period: string, input: StandardLayoutInput): StandardStatements {
  const mapping = resolveStandardMapping(input.accounts, input.categories);
  const ledger = buildJournalStatements(lines, period, input.entityId, input.selection);
  const balances = buildAccountPresentationBalances(lines, period, input.entityId, input.selection);
  const currencies = [...new Set([...balances.balance, ...balances.period].map((item) => item.line.currency).concat(input.currency ? [input.currency] : []))].sort();
  const byCurrency = currencies.map((currency): StandardCurrencyStatements => {
    const byLine: Amounts = new Map(); const byCategory: Amounts = new Map(); const unplaced = new Set<string>();
    const place = (item: { line: TrialBalanceLine; amountMinor: bigint }, sections: StandardStatementSection[]) => {
      const section = accountStatementSection(item.line);
      if (!section || !sections.includes(section)) { if (!section && item.amountMinor !== 0n) unplaced.add(item.line.accountId); return; }
      const resolved = mapping.get(item.line.accountId) ?? (() => { const suggestion = suggestStandardLine(item.line); return { line: suggestion.line, categoryId: null }; })();
      if (!resolved.line) { if (item.amountMinor !== 0n) unplaced.add(item.line.accountId); return; }
      add(byLine, resolved.line, item.amountMinor, item.line.accountId);
      if (resolved.categoryId) add(byCategory, resolved.categoryId, item.amountMinor, item.line.accountId);
    };
    balances.period.filter((item) => item.line.currency === currency).forEach((item) => place(item, ["revenue", "expense"]));
    balances.balance.filter((item) => item.line.currency === currency).forEach((item) => place(item, ["asset", "liability", "equity"]));
    const rowsFor = (ids: StandardLineId[]) => ids.flatMap((id) => lineRows(id, input.categories, byLine, byCategory));

    const revenueRows = rowsFor(linesIn((line) => line.group === "revenue"));
    const cogsRows = rowsFor(linesIn((line) => line.group === "cogs"));
    const sgaRows = rowsFor(linesIn((line) => line.group === "sga"));
    const belowRows = rowsFor(linesIn((line) => line.group === "below_ebitda"));
    const taxRows = rowsFor(linesIn((line) => line.group === "taxes"));
    const revenue = sum(topLines(revenueRows)); const cogs = sum(topLines(cogsRows)); const sga = sum(topLines(sgaRows));
    const grossMargin = revenue - cogs; const ebitda = grossMargin - sga;
    const below = topLines(belowRows).reduce((amount, row) => amount + (standardLineDefinition(row.line!).section === "revenue" ? 1n : -1n) * BigInt(row.amountMinor), 0n);
    const ebt = ebitda + below; const taxes = sum(topLines(taxRows)); const netIncome = ebt - taxes;
    const incomeStatement: StandardRow[] = [...revenueRows, ...cogsRows, total("gross_margin", "Gross margin", grossMargin), ...sgaRows, total("sga", "Total SG&A", sga), total("ebitda", "Operating income (EBITDA)", ebitda), ...belowRows, total("ebt", "Earnings before taxes", ebt), ...taxRows, total("net_income", "Net income (loss)", netIncome, "total")];

    const ledgerCurrency = ledger.byCurrency.find((item) => item.currency === currency);
    const unclosedEarnings = BigInt(ledgerCurrency?.balanceSheet.unclosedEarningsMinor ?? "0");
    const currentAssetRows = rowsFor(linesIn((line) => line.section === "asset" && line.timing === "current"));
    const fixedAssetRows = rowsFor(linesIn((line) => line.section === "asset" && line.timing === "noncurrent"));
    const currentLiabilityRows = rowsFor(linesIn((line) => line.section === "liability" && line.timing === "current"));
    const noncurrentLiabilityRows = rowsFor(linesIn((line) => line.section === "liability" && line.timing === "noncurrent"));
    const equityRows = rowsFor(linesIn((line) => line.section === "equity"));
    const totalAssets = sum(topLines(currentAssetRows)) + sum(topLines(fixedAssetRows));
    const totalLiabilities = sum(topLines(currentLiabilityRows)) + sum(topLines(noncurrentLiabilityRows));
    const totalEquity = sum(topLines(equityRows)) + unclosedEarnings;
    const balanceSheet: StandardRow[] = [
      ...currentAssetRows, total("current_assets", "Total current assets", sum(topLines(currentAssetRows))),
      ...fixedAssetRows, total("total_assets", "Total assets", totalAssets, "total"),
      ...currentLiabilityRows, total("current_liabilities", "Total current liabilities", sum(topLines(currentLiabilityRows))),
      ...noncurrentLiabilityRows, total("noncurrent_liabilities", "Total non-current liabilities", sum(topLines(noncurrentLiabilityRows))),
      ...equityRows, total("current_earnings", "Net income not yet closed", unclosedEarnings, "subtotal"), total("total_equity", "Total stockholders equity", totalEquity),
      total("total_liabilities_equity", "Total liabilities and equity", totalLiabilities + totalEquity, "total"),
      total("balance_check", "Check", totalAssets - totalLiabilities - totalEquity),
    ];

    const flow = ledgerCurrency?.cashFlow;
    const cashFlow: StandardRow[] = [
      total("cf_operating", "Net cash flow from operations", BigInt(flow?.operatingMinor ?? "0")),
      total("cf_investing", "Net cash flow from investing", BigInt(flow?.investingMinor ?? "0")),
      total("cf_financing", "Net cash flow from financing", BigInt(flow?.financingMinor ?? "0")),
      total("cf_net", "Net cash flow", BigInt(flow?.netChangeMinor ?? "0"), "total"),
      total("cf_cash_end", "Cash end of period", lineAmount(balanceSheet, "cash")),
    ];

    const ledgerNetIncome = BigInt(ledgerCurrency?.incomeStatement.netIncomeMinor ?? "0");
    const ledgerAssets = BigInt(ledgerCurrency?.balanceSheet.totalAssetsMinor ?? "0");
    const ledgerLiabilitiesEquity = BigInt(ledgerCurrency?.balanceSheet.totalLiabilitiesAndEquityMinor ?? "0");
    const checks: StandardCheck[] = [
      { key: "net_income_ties", label: "Net income equals the ledger statements", ok: netIncome === ledgerNetIncome, differenceMinor: (netIncome - ledgerNetIncome).toString() },
      { key: "assets_tie", label: "Total assets equal the ledger statements", ok: totalAssets === ledgerAssets, differenceMinor: (totalAssets - ledgerAssets).toString() },
      { key: "liabilities_equity_tie", label: "Total liabilities and equity equal the ledger statements", ok: totalLiabilities + totalEquity === ledgerLiabilitiesEquity, differenceMinor: (totalLiabilities + totalEquity - ledgerLiabilitiesEquity).toString() },
      { key: "balance_sheet_balances", label: "Balance sheet balances", ok: totalAssets === totalLiabilities + totalEquity, differenceMinor: (totalAssets - totalLiabilities - totalEquity).toString() },
      { key: "all_accounts_placed", label: "Every account with an amount is placed on a line", ok: unplaced.size === 0, differenceMinor: "0" },
    ];
    return { currency, incomeStatement, balanceSheet, cashFlow, checks, unplacedAccountIds: [...unplaced].sort() };
  });
  return { period, layoutVersion: standardLayoutVersion, byCurrency };
}

/** Which statement a row belongs to decides how it rolls up: flows sum, balances take the last period. */
export type StandardPeriodColumn = { period: string; basis: "actual" | "forecast" | "scenario"; statement: StandardCurrencyStatements };
export type StandardAnnualColumn = { fiscalYear: number; periods: string[]; complete: boolean; statement: Pick<StandardCurrencyStatements, "incomeStatement" | "balanceSheet" | "cashFlow"> };

/** The fiscal year a month falls in, named by the calendar year in which it ends. */
export function fiscalYearOf(period: string, fiscalYearEndMonth: number) {
  const [year, month] = period.split("-").map(Number) as [number, number];
  return month > fiscalYearEndMonth ? year + 1 : year;
}

/** Annual columns in the Standard Summary style. A year missing months is marked incomplete rather than padded. */
export function rollupStandardByFiscalYear(columns: StandardPeriodColumn[], fiscalYearEndMonth: number): StandardAnnualColumn[] {
  const years = new Map<number, StandardPeriodColumn[]>();
  for (const column of [...columns].sort((left, right) => left.period.localeCompare(right.period))) years.set(fiscalYearOf(column.period, fiscalYearEndMonth), [...(years.get(fiscalYearOf(column.period, fiscalYearEndMonth)) ?? []), column]);
  const summed = (rows: StandardRow[][]) => rows[0]!.map((row, index) => {
    const accounts = new Map<string, bigint>();
    for (const period of rows) for (const item of period[index]?.accounts ?? []) accounts.set(item.accountId, (accounts.get(item.accountId) ?? 0n) + BigInt(item.amountMinor));
    return { ...row, amountMinor: rows.reduce((amount, period) => amount + BigInt(period[index]?.amountMinor ?? "0"), 0n).toString(), accounts: accountList(accounts) };
  });
  return [...years.entries()].map(([fiscalYear, periods]) => {
    const last = periods.at(-1)!.statement;
    const balanceSheet = last.balanceSheet;
    const cashFlow = summed(periods.map((period) => period.statement.cashFlow)).map((row) => row.key === "cf_cash_end" ? last.cashFlow.find((item) => item.key === row.key)! : row);
    return { fiscalYear, periods: periods.map((period) => period.period), complete: periods.length === 12, statement: { incomeStatement: summed(periods.map((period) => period.statement.incomeStatement)), balanceSheet, cashFlow } };
  });
}
