import { sql } from "drizzle-orm";
import type { Database } from "./index";

export type CompanyTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Queryable = Database | CompanyTransaction;

/**
 * Transaction-local company scope. `set_config(..., true)` ties the setting to
 * the surrounding transaction, so the scope cannot leak onto the next borrower
 * of a pooled connection even if the transaction rolls back.
 */
export function setCompanyScopeSql(companyId: string) {
  return sql`select set_config('app.company_id', ${companyId}, true)`;
}

export const currentCompanyScopeSql = sql`select app_current_company_id() as company_id`;

/**
 * Defense in depth: every statement inside `fn` runs under the row level
 * security policies installed by migration 0070, so Postgres refuses to serve
 * or accept another company's rows even if a query forgets its company filter.
 * Enforcement requires a non-superuser database role; superusers bypass RLS.
 */
export async function withCompanyTransaction<T>(
  database: Database,
  companyId: string,
  fn: (transaction: CompanyTransaction) => Promise<T>,
): Promise<T> {
  return database.transaction(async (transaction) => {
    await transaction.execute(setCompanyScopeSql(companyId));
    return fn(transaction);
  });
}

/** The company scope Postgres is currently enforcing; null when unscoped (tests and diagnostics). */
export async function readCompanyScope(database: Queryable): Promise<string | null> {
  const rows = (await database.execute(currentCompanyScopeSql)) as unknown as Array<{ company_id: string | null }>;
  return rows[0]?.company_id ?? null;
}
