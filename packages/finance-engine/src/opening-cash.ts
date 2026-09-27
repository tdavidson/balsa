import { buildTrialBalance, type PostedJournalLine } from "./ledger";
import { isCashBalanceRow, resolveCashGroups } from "./forecast-actuals";
import { addMonths, isValidMonth } from "./periods";
import type { ForecastAccount } from "./forecast-run";

export const openingCashFormulaVersion = "opening-cash-2026-09-25.1";
export type OpeningCashAccount = ForecastAccount & { bankAccountIdentifier: string | null; entityId: string | null; active: boolean };
export type OpeningCashStatement = { id: string; sourceId: string | null; name: string; hash: string | null; kind: string; status: string; identityStatus: string; accountIdentifier: string | null; entityId: string | null; currency: string | null; startDate: string | null; endDate: string | null; openingBalance: string | null; endingBalance: string | null };
export type OpeningCashInput = { period: string; currency: string; expectedCashMinor: string; accounts: OpeningCashAccount[]; statements: OpeningCashStatement[]; lines: PostedJournalLine[] };
export type OpeningCashReview = ReturnType<typeof reconcileOpeningCash>;
const minor = (value: string | null): string | null => {
  if (value === null) return null;
  const text = value.trim().replace(/^\((.+)\)$/, "-$1");
  if (!/^-?\$?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(text)) return null;
  const normalized = text.replace(/[$,]/g, ""); const [whole = "0", fraction = ""] = normalized.replace(/^-/, "").split(".");
  return ((normalized.startsWith("-") ? -1n : 1n) * (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0")))).toString();
};

/** Compare the forecast's opening cash to exact-boundary, approved bank evidence.
 * Trial balances and cash classification use the same ledger primitives as the forecast.
 * A tie is an arithmetic/source control, not a declaration that all books are closed.
 */
export function reconcileOpeningCash(input: OpeningCashInput) {
  if (!isValidMonth(input.period) || !/^-?\d+$/.test(input.expectedCashMinor)) throw new Error("Invalid opening-cash scope.");
  const startDate = `${addMonths(input.period, 1)}-01`;
  const boundary = new Date(Date.parse(`${startDate}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  const lines = input.lines.filter((line) => ["actual", "adjustment", "elimination"].includes(line.basis ?? "actual") && line.period <= input.period && (!line.postingDate || line.postingDate <= boundary));
  const trial = buildTrialBalance(lines, input.period);
  const groups = resolveCashGroups(trial.lines);
  const cashRows = trial.lines.filter((row) => isCashBalanceRow(row, groups));
  const chartGroups = resolveCashGroups(input.accounts);
  const accounts = input.accounts.filter((account) => (account.active && isCashBalanceRow(account, chartGroups)) || cashRows.some((row) => row.accountId === account.accountId));
  const boundaryStatements = input.statements.filter((statement) => ["bank_statement", "brokerage_statement"].includes(statement.kind) && (statement.endDate === boundary || statement.startDate === startDate));
  const results = accounts.map((account) => {
    const rows = cashRows.filter((row) => row.accountId === account.accountId);
    const ownLines = lines.filter((line) => line.accountId === account.accountId);
    const ledgerMinor = rows.filter((row) => row.currency === input.currency).reduce((sum, row) => sum + BigInt(row.netMinor), 0n).toString();
    const candidates = boundaryStatements.filter((statement) => account.bankAccountIdentifier && statement.accountIdentifier === account.bankAccountIdentifier);
    const approved = candidates.filter((statement) => statement.status === "approved" && statement.identityStatus === "approved");
    const balances = approved.map((statement) => ({ evidenceId: statement.id, sourceId: statement.sourceId, name: statement.name, hash: statement.hash, basis: statement.endDate === boundary ? "ending" : "opening", valueMinor: minor(statement.endDate === boundary ? statement.endingBalance : statement.openingBalance) }));
    const uniqueValues = new Set(balances.map((balance) => balance.valueMinor));
    const statementMinor = uniqueValues.size === 1 && balances.length ? balances[0]!.valueMinor : null;
    const reasons: string[] = [];
    if (!account.bankAccountIdentifier) reasons.push("Map this cash account to an exact bank account identifier.");
    if (account.bankAccountIdentifier && input.accounts.filter((item) => item.bankAccountIdentifier === account.bankAccountIdentifier).length !== 1) reasons.push("The bank account mapping is ambiguous.");
    if (!approved.length) reasons.push("No approved, identity-reviewed statement establishes cash at this exact boundary.");
    if (candidates.some((statement) => statement.status === "pending" || statement.status === "approved" && statement.identityStatus !== "approved")) reasons.push("Boundary evidence is still awaiting review.");
    if (approved.some((statement) => statement.currency !== input.currency) || rows.some((row) => row.currency !== input.currency)) reasons.push("Foreign or unspecified currency requires a separate reconciliation.");
    if (approved.some((statement) => statement.entityId !== account.entityId) || rows.some((row) => (row.entityId ?? null) !== account.entityId)) reasons.push("Statement, account and journal entity scope do not agree.");
    if (balances.some((balance) => balance.valueMinor === null)) reasons.push("An approved statement balance is not a supported exact monetary amount.");
    if (uniqueValues.size > 1) reasons.push("Approved statements disagree about the boundary balance.");
    const differenceMinor = statementMinor !== null ? (BigInt(ledgerMinor) - BigInt(statementMinor)).toString() : null;
    if (differenceMinor !== null && differenceMinor !== "0") reasons.push("Posted cash does not equal the approved statement balance.");
    return { accountId: account.accountId, name: account.accountName, code: account.accountCode, bankAccountIdentifier: account.bankAccountIdentifier, ledgerMinor, statementMinor, differenceMinor, state: reasons.length ? "needs_review" as const : "reconciled" as const, reasons, balances, journalLineIds: ownLines.map((line) => line.id).sort() };
  }).sort((a, b) => a.code.localeCompare(b.code));
  const ledgerCashMinor = cashRows.filter((row) => row.currency === input.currency).reduce((sum, row) => sum + BigInt(row.netMinor), 0n).toString();
  const reasons = results.flatMap((result) => result.reasons.map((reason) => `${result.name}: ${reason}`));
  if (!results.length) reasons.push("No cash accounts are available for reconciliation.");
  if (!trial.balanced) reasons.push("The supporting trial balance does not balance.");
  if (ledgerCashMinor !== input.expectedCashMinor) reasons.push("Account-level cash does not reproduce the forecast's opening cash.");
  if (boundaryStatements.some((statement) => statement.status !== "rejected" && (!statement.accountIdentifier || !accounts.some((account) => account.bankAccountIdentifier === statement.accountIdentifier)))) reasons.push("A boundary statement is not mapped to a cash account.");
  if (lines.some((line) => !/^\d+$/.test(line.debitMinor) || !/^\d+$/.test(line.creditMinor))) reasons.push("A supporting journal amount is invalid.");
  if (input.lines.some((line) => ["actual", "adjustment", "elimination"].includes(line.basis ?? "actual") && line.period <= input.period && line.postingDate && line.postingDate > boundary)) reasons.push("A journal's posting date lies after its accounting-period boundary.");
  return { formulaVersion: openingCashFormulaVersion, formula: "sum(posted cash debits - credits through boundary) = approved boundary statement balances = forecast opening cash", period: input.period, boundary, startDate, currency: input.currency, expectedCashMinor: input.expectedCashMinor, ledgerCashMinor, status: reasons.length ? "needs_review" as const : "reconciled" as const, accounts: results, reasons, inputs: input };
}
