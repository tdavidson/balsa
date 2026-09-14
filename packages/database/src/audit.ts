import type { AuditEntry, AuditVia } from "@finance/auth";
import { desc, eq } from "drizzle-orm";
import type { Queryable } from "./company-scope";
import { auditLog, users } from "./schema";

/** One stored entry, resolved against the actor as they are named today. */
export type AuditRecord = {
  id: string;
  companyId: string;
  actorUserId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  via: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  summary: string;
  before: unknown;
  after: unknown;
  requestId: string | null;
  createdAt: string;
};

export const defaultAuditLimit = 100;

/**
 * Record one change. The executor is the caller's: a mutation that already runs
 * in a transaction passes that transaction, so the change and its record commit
 * or roll back together.
 */
export async function recordAudit(executor: Queryable, entry: AuditEntry): Promise<void> {
  await executor.insert(auditLog).values({
    companyId: entry.companyId,
    actorUserId: entry.actorUserId,
    via: entry.via satisfies AuditVia,
    action: entry.action,
    entityType: entry.entityType ?? null,
    entityId: entry.entityId ?? null,
    summary: entry.summary,
    before: entry.before ?? null,
    after: entry.after ?? null,
    requestId: entry.requestId ?? null,
  });
}

/**
 * The company's most recent entries, newest first. The actor is joined rather
 * than copied into the row, so a renamed user reads correctly in history; the
 * join is outer because worker entries and deleted users have no actor.
 */
export async function listAuditEntries(
  database: Queryable,
  companyId: string,
  limit: number = defaultAuditLimit,
): Promise<AuditRecord[]> {
  const rows = await database
    .select({
      id: auditLog.id,
      companyId: auditLog.companyId,
      actorUserId: auditLog.actorUserId,
      actorName: users.name,
      actorEmail: users.email,
      via: auditLog.via,
      action: auditLog.action,
      entityType: auditLog.entityType,
      entityId: auditLog.entityId,
      summary: auditLog.summary,
      before: auditLog.before,
      after: auditLog.after,
      requestId: auditLog.requestId,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorUserId))
    .where(eq(auditLog.companyId, companyId))
    // The id tie-breaker is not chronological, only deterministic: entries
    // written in one transaction share `now()` and must not reorder per page.
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(limit);

  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}
