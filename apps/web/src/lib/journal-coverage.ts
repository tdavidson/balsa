import "server-only";
import { and, eq } from "drizzle-orm";
import { chartAccounts, evidence, getDatabase, sourceRows, sources } from "@finance/database";

export type CoverageStatus = "missing" | "pending" | "approved" | "duplicate";
export type JournalCoverage = { period: string; accounts: { accountId: string; code: string; name: string; bankAccountIdentifier: string | null; bankStatement: { status: CoverageStatus; evidenceIds: string[] }; activity: { status: CoverageStatus; sourceRowCount: number } }[]; generalLedger: { status: CoverageStatus; evidenceIds: string[] }; blockers: string[] };

const role = (metadata: string | null, name: string) => `${metadata ?? ""} ${name}`.toLowerCase();
const status = (approved: string[], pending: string[]): CoverageStatus => approved.length > 1 ? "duplicate" : approved.length ? "approved" : pending.length ? "pending" : "missing";

/** Exact evidence-role coverage; it never infers an account from a filename or amount. */
export async function loadJournalCoverage(companyId: string, period: string): Promise<JournalCoverage> {
  const db = getDatabase();
  const [accounts, evidenceRows, activityRows] = await Promise.all([
    db.select({ id: chartAccounts.id, code: chartAccounts.code, name: chartAccounts.name, statementLine: chartAccounts.statementLine, bankAccountIdentifier: chartAccounts.bankAccountIdentifier }).from(chartAccounts).where(and(eq(chartAccounts.companyId, companyId), eq(chartAccounts.active, "Y"))),
    db.select({ id: evidence.id, status: evidence.status, accountIdentifier: evidence.accountIdentifier, sourceName: evidence.sourceName, sourceMetadata: sources.metadata }).from(evidence).leftJoin(sources, eq(evidence.sourceId, sources.id)).where(and(eq(evidence.companyId, companyId), eq(evidence.reportingMonth, period))),
    db.select({ accountName: sourceRows.accountName, status: sourceRows.status }).from(sourceRows).where(and(eq(sourceRows.companyId, companyId), eq(sourceRows.period, period))),
  ]);
  const cashAccounts = accounts.filter((account) => /cash/i.test(`${account.statementLine ?? ""} ${account.name}`));
  const coverage = cashAccounts.map((account) => {
    const statements = evidenceRows.filter((row) => row.accountIdentifier === account.bankAccountIdentifier && /bank_statement|brokerage_statement/.test(role(row.sourceMetadata, row.sourceName)));
    const matchingActivity = activityRows.filter((row) => row.accountName === account.bankAccountIdentifier || row.accountName === account.name);
    const approvedStatements = statements.filter((row) => row.status === "approved").map((row) => row.id); const pendingStatements = statements.filter((row) => row.status === "pending").map((row) => row.id);
    const approvedActivity = matchingActivity.filter((row) => row.status === "approved").length; const pendingActivity = matchingActivity.filter((row) => row.status !== "approved").length;
    const activityStatus: CoverageStatus = approvedActivity > 0 ? "approved" : pendingActivity > 0 ? "pending" : "missing";
    return { accountId: account.id, code: account.code, name: account.name, bankAccountIdentifier: account.bankAccountIdentifier, bankStatement: { status: status(approvedStatements, pendingStatements), evidenceIds: approvedStatements }, activity: { status: activityStatus, sourceRowCount: matchingActivity.length } };
  });
  const gl = evidenceRows.filter((row) => /general_ledger|quickbooks_transactions/.test(role(row.sourceMetadata, row.sourceName))); const approvedGl = gl.filter((row) => row.status === "approved").map((row) => row.id); const pendingGl = gl.filter((row) => row.status === "pending").map((row) => row.id);
  const blockers = coverage.flatMap((account) => [ ...(account.bankAccountIdentifier ? [] : [`${account.code} has no bank statement identifier mapping.`]), ...(account.bankStatement.status === "approved" ? [] : [`${account.code} lacks one approved bank statement for ${period}.`]), ...(account.activity.status === "approved" ? [] : [`${account.code} lacks approved transaction activity for ${period}.`]) ]).concat(status(approvedGl, pendingGl) === "approved" ? [] : [`No approved general-ledger or QuickBooks transaction detail covers ${period}.`]);
  return { period, accounts: coverage, generalLedger: { status: status(approvedGl, pendingGl), evidenceIds: approvedGl }, blockers };
}
