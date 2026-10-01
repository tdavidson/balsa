import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { cashCoverageRecords, chartAccounts, evidence, sourceRows } from "@finance/database";
import { stableJson, type PostedJournalLine } from "@balsa/finance-engine";
import type { DbExecutor } from "./db-executor";

export async function loadCoverageSourceState(db: DbExecutor, companyId: string) {
  const [rows, documents] = await Promise.all([
    db.select({ id: sourceRows.id, accountName: sourceRows.accountName, period: sourceRows.period, status: sourceRows.status, rawJson: sourceRows.rawJson, transactionDate: sourceRows.transactionDate, amount: sourceRows.amount, debitMinor: sourceRows.debitMinor, creditMinor: sourceRows.creditMinor, currency: sourceRows.currency, rowType: sourceRows.rowType }).from(sourceRows).where(eq(sourceRows.companyId, companyId)),
    db.select({ id: evidence.id, accountIdentifier: evidence.accountIdentifier, reportingMonth: evidence.reportingMonth, hash: evidence.sourceHash, status: evidence.status }).from(evidence).where(eq(evidence.companyId, companyId)),
  ]);
  return { rows: rows.map(({ rawJson, ...row }) => ({ ...row, hash: createHash("sha256").update(rawJson).digest("hex") })).sort((a, b) => a.id.localeCompare(b.id)), documents: documents.sort((a, b) => a.id.localeCompare(b.id)) };
}
export function cashCoverageHash(lines: PostedJournalLine[], accountId: string, startDate: string, throughDate: string, sourceState?: Awaited<ReturnType<typeof loadCoverageSourceState>>, accountNames: string[] = []) {
  const inputs = lines.filter((line) => line.accountId === accountId && ["actual", "adjustment", "elimination"].includes(line.basis ?? "actual") && (line.postingDate ?? `${line.period}-01`) >= startDate && (line.postingDate ?? `${line.period}-01`) <= throughDate).sort((a, b) => a.id.localeCompare(b.id));
  const inPeriod = (month: string | null) => !month || month >= startDate.slice(0, 7) && month <= throughDate.slice(0, 7);
  const sourceInputs = sourceState ? {
    rows: sourceState.rows.filter((row) => inPeriod(row.period) && (!row.accountName || accountNames.includes(row.accountName))),
    documents: sourceState.documents.filter((document) => inPeriod(document.reportingMonth) && (!document.accountIdentifier || accountNames.includes(document.accountIdentifier))),
  } : null;
  return createHash("sha256").update(stableJson({ inputs, sourceInputs })).digest("hex");
}
const nextDay = (day: string) => { const date = new Date(`${day}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + 1); return date.toISOString().slice(0, 10); };
export async function loadCashCoverage(db: DbExecutor, companyId: string, lines: PostedJournalLine[], startDate: string, throughDate: string) {
  const [accounts, records, documents, sourceState] = await Promise.all([
    db.select({ id: chartAccounts.id, name: chartAccounts.name, bankAccountIdentifier: chartAccounts.bankAccountIdentifier, statementLine: chartAccounts.statementLine, accountType: chartAccounts.accountType }).from(chartAccounts).where(and(eq(chartAccounts.companyId, companyId), eq(chartAccounts.active, "Y"))),
    db.select().from(cashCoverageRecords).where(eq(cashCoverageRecords.companyId, companyId)).orderBy(desc(cashCoverageRecords.createdAt), desc(cashCoverageRecords.id)),
    db.select({ id: evidence.id, name: evidence.sourceName, hash: evidence.sourceHash, status: evidence.status }).from(evidence).where(eq(evidence.companyId, companyId)),
    loadCoverageSourceState(db, companyId),
  ]);
  const latest = new Map<string, typeof records[number]>();
  for (const row of records) {
    const key = `${row.accountId}:${row.startDate}:${row.throughDate}`;
    if (!latest.has(key)) latest.set(key, row);
  }
  const reviewed = [...latest.values()].map((row) => {
    const support = documents.find((document) => document.id === row.evidenceId);
    const account = accounts.find((item) => item.id === row.accountId);
    const names = [account?.name, account?.bankAccountIdentifier].filter((value): value is string => Boolean(value));
    const changed = cashCoverageHash(lines, row.accountId, row.startDate, row.throughDate, sourceState, names) !== row.ledgerHash || Boolean(row.evidenceHash && (!support || support.status !== "approved" || (support.hash ?? "unhashed") !== row.evidenceHash));
    return { ...row, createdAt: row.createdAt.toISOString(), state: changed && row.status !== "revoked" ? "stale" : row.status };
  });
  const cashAccounts = accounts.filter((account) => account.accountType === "asset" && /cash/i.test(account.statementLine ?? account.name)).sort((a, b) => a.id.localeCompare(b.id));
  return {
    startDate, throughDate,
    accounts: cashAccounts.map((account) => {
      const assertions = reviewed.filter((record) => record.accountId === account.id);
      const complete = assertions.filter((record) => record.state === "complete").sort((a, b) => a.startDate.localeCompare(b.startDate));
      let cursor = startDate;
      for (const interval of complete) if (interval.startDate <= cursor && interval.throughDate >= cursor) cursor = nextDay(interval.throughDate);
      return { ...account, state: cursor > throughDate ? "complete" : assertions.some((item) => item.state === "stale") ? "stale" : assertions.some((item) => item.state === "partial" || item.state === "complete") ? "partial" : "missing", coveredThrough: cursor > startDate ? new Date(new Date(`${cursor}T00:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10) : null, assertions };
    }),
    evidence: documents.filter((document) => document.status === "approved"),
  };
}
