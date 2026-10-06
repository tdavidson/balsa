import "server-only";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { bankAccounts, chartAccounts, getDatabase } from "@finance/database";
import { resolveAccountIsCash } from "@balsa/finance-engine";
import type { DbExecutor } from "@/lib/db-executor";

/** True when the chart account has a bank identifier or a connected bank account is linked to it. */
export const bankLinkedSql = sql<boolean>`(${chartAccounts.bankAccountIdentifier} is not null or exists (select 1 from ${bankAccounts} where ${bankAccounts.companyId} = ${chartAccounts.companyId} and ${bankAccounts.chartAccountId} = ${chartAccounts.id}))`;

/** Chart accounts that a connected bank account points at. */
export async function loadBankLinkedAccountIds(companyId: string, db: DbExecutor = getDatabase()) {
  const rows = await db.select({ id: bankAccounts.chartAccountId }).from(bankAccounts).where(and(eq(bankAccounts.companyId, companyId), isNotNull(bankAccounts.chartAccountId)));
  return new Set(rows.map((row) => row.id!));
}

type CashRow = { id: string; accountType: string; statementSection: string | null; statementLine: string | null; name: string; cashTreatment: string | null; bankAccountIdentifier: string | null };
/** The chart's cash rule (finance-engine `resolveAccountIsCash`) for one stored chart row. */
export const chartRowIsCash = (row: CashRow, linkedIds: Set<string>) => resolveAccountIsCash({ ...row, bankLinked: Boolean(row.bankAccountIdentifier) || linkedIds.has(row.id) });
export const chartRowIsBankLinked = (row: Pick<CashRow, "id" | "bankAccountIdentifier">, linkedIds: Set<string>) => Boolean(row.bankAccountIdentifier) || linkedIds.has(row.id);
