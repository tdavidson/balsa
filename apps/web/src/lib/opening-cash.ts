import "server-only";
import { and, eq, or } from "drizzle-orm";
import { chartAccounts, evidence, sources } from "@finance/database";
import { addMonths, reconcileOpeningCash, type PostedJournalLine } from "@balsa/finance-engine";
import { chartAccountToForecastAccount } from "./forecast-drivers";
import type { DbExecutor } from "./db-executor";

export async function loadOpeningCash(db: DbExecutor, companyId: string, period: string, currency: string, expectedCashMinor: string, lines: PostedJournalLine[]) {
  const next = addMonths(period, 1); const start = `${next}-01`; const end = new Date(Date.parse(`${start}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  const [accounts, documents] = await Promise.all([
    db.select().from(chartAccounts).where(eq(chartAccounts.companyId, companyId)),
    db.select({ document: evidence, sourceType: sources.type, metadata: sources.metadata }).from(evidence).leftJoin(sources, and(eq(sources.id, evidence.sourceId), eq(sources.companyId, companyId))).where(and(eq(evidence.companyId, companyId), or(eq(evidence.statementPeriodEnd, end), eq(evidence.statementPeriodStart, start), eq(evidence.reportingMonth, period), eq(evidence.reportingMonth, next)))),
  ]);
  const statements = documents.filter(({ metadata }) => { try { return !JSON.parse(metadata ?? "{}").financialReviewSupersededBy; } catch { return true; } }).map(({ document, sourceType, metadata }) => {
    let kind = sourceType ?? "unknown";
    try { const parsed = JSON.parse(metadata ?? "{}"); if (typeof parsed.classification?.kind === "string") kind = parsed.classification.kind; } catch { /* An unknown classification remains unsupported. */ }
    return { id: document.id, sourceId: document.sourceId, name: document.sourceName, hash: document.sourceHash, kind, status: document.status, identityStatus: document.identityStatus, accountIdentifier: document.accountIdentifier, entityId: document.accountEntityId, currency: document.currency, startDate: document.statementPeriodStart, endDate: document.statementPeriodEnd, openingBalance: document.openingBalance, endingBalance: document.endingBalance };
  }).sort((a, b) => a.id.localeCompare(b.id));
  return reconcileOpeningCash({ period, currency, expectedCashMinor, lines, statements, accounts: accounts.map((account) => ({ ...chartAccountToForecastAccount(account), bankAccountIdentifier: account.bankAccountIdentifier, entityId: account.entityId, active: account.active === "Y" })).sort((a, b) => a.accountId.localeCompare(b.accountId)) });
}
