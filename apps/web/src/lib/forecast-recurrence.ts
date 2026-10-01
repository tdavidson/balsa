import "server-only";
import { createHash } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { evidence, factRecords, forecastOccurrences, forecastRecurrencePolicies, recordAudit } from "@finance/database";
import { recurrenceDefinition, recurringOccurrences, recurrenceRuleVersion, stableJson, type RecurrenceContext, type RecurrenceDefinition, type RecurrencePolicy, type RecurrenceState } from "@balsa/finance-engine";
import { loadHistoryOrigins } from "./forecast-history";
import type { DbExecutor, DbTransaction } from "./db-executor";

const hash = (definition: RecurrenceDefinition) => createHash("sha256").update(stableJson(definition)).digest("hex");
export async function loadRecurrenceReview(db: DbExecutor, companyId: string, input: RecurrenceContext, throughDate: string, capturedKeys: Set<string>) {
  const [rows, sources, facts, history] = await Promise.all([
    db.select().from(forecastRecurrencePolicies).where(eq(forecastRecurrencePolicies.companyId, companyId)).orderBy(asc(forecastRecurrencePolicies.id)),
    db.select({ id: evidence.id, hash: evidence.sourceHash, updatedAt: evidence.updatedAt }).from(evidence).where(and(eq(evidence.companyId, companyId), eq(evidence.status, "approved"))),
    db.select({ id: factRecords.id, evidenceId: factRecords.evidenceId, value: factRecords.value, updatedAt: factRecords.updatedAt }).from(factRecords).where(and(eq(factRecords.companyId, companyId), eq(factRecords.status, "approved"))),
    loadHistoryOrigins(db, companyId, throughDate),
  ]);
  const sourceIds = new Set(sources.map((source) => source.id));
  const factIds = new Set(facts.filter((fact) => sourceIds.has(fact.evidenceId)).map((fact) => fact.id));
  const options = input.drivers.filter((driver) => (!driver.evidenceId || sourceIds.has(driver.evidenceId)) && (!driver.factId || factIds.has(driver.factId))).flatMap((driver) => {
    const definition = recurrenceDefinition(input, driver.id);
    const historical = history.find((item) => item.driverId === driver.id);
    if (historical && !historical.valid) return [];
    if (definition && historical) definition.history = historical.origin;
    if (definition && (driver.evidenceId || driver.factId)) {
      const fact = facts.find((item) => item.id === driver.factId);
      const references = sources.filter((source) => source.id === driver.evidenceId || source.id === fact?.evidenceId).map((source) => ({ id: source.id, hash: source.hash, updatedAt: source.updatedAt.toISOString() })).sort((a, b) => a.id.localeCompare(b.id));
      definition.sourceFingerprint = createHash("sha256").update(stableJson({ references, fact: fact ? { id: fact.id, value: fact.value, updatedAt: fact.updatedAt.toISOString() } : null })).digest("hex");
    }
    return definition ? [{ driverId: driver.id, label: driver.label, cadence: driver.cadence, amountMinor: driver.amountMinor, currency: input.currency, definition, hash: hash(definition) }] : [];
  });
  const currentMonth = throughDate.slice(0, 7);
  const states: RecurrenceState[] = rows.map((row) => {
    const policy = { id: row.id, driverId: row.driverId, version: row.version, startMonth: row.startMonth, endMonth: row.endMonth, definitionHash: row.definitionHash, status: row.status as RecurrencePolicy["status"], definition: row.definition as RecurrenceDefinition };
    const current = options.find((option) => option.driverId === policy.driverId);
    if (policy.status === "paused") return { policy, state: "paused", reason: null, pendingCount: 0 };
    const end = currentMonth < policy.endMonth ? currentMonth : policy.endMonth;
    const pendingCount = recurringOccurrences(policy.definition, policy.startMonth, end).filter((occurrence) => !capturedKeys.has(occurrence.key)).length;
    if (currentMonth > policy.endMonth && !pendingCount) return { policy, state: "expired", reason: null, pendingCount: 0 };
    if (!current || current.hash !== policy.definitionHash) return { policy, state: "stale", reason: `${policy.definition.driver.label}: recurring capture needs renewed approval because its schedule, treatment, source approval, or currency changed. Existing occurrences are preserved.`, pendingCount: 0 };
    return { policy, state: currentMonth > policy.endMonth ? "expired" : "active", reason: null, pendingCount };
  });
  return { options, states };
}

/** Shares the review lock with captures, settlement edits and policy approvals. */
export async function captureApprovedRecurrences(tx: DbTransaction, companyId: string, input: RecurrenceContext, throughDate: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(7406, hashtext(${companyId}))`);
  const existing = await tx.select({ key: forecastOccurrences.occurrenceKey }).from(forecastOccurrences).where(eq(forecastOccurrences.companyId, companyId));
  const captured = new Set(existing.map((row) => row.key));
  const { states } = await loadRecurrenceReview(tx, companyId, input, throughDate, captured);
  let changed = false;
  for (const { policy, state, pendingCount } of states) {
    if (state === "paused" || state === "stale" || !pendingCount) continue;
    const endMonth = throughDate.slice(0, 7) < policy.endMonth ? throughDate.slice(0, 7) : policy.endMonth;
    for (const occurrence of recurringOccurrences(policy.definition, policy.startMonth, endMonth)) {
      if (captured.has(occurrence.key)) continue;
      const definition = { ...occurrence, recurrencePolicyId: policy.id, recurrencePolicyVersion: policy.version, recurrenceRuleVersion };
      const [saved] = await tx.insert(forecastOccurrences).values({ companyId, occurrenceKey: definition.key, definition, actorUserId: null }).onConflictDoNothing().returning({ id: forecastOccurrences.id });
      if (!saved) continue;
      await recordAudit(tx, { companyId, actorUserId: null, via: "worker", action: "forecast.recurring_captured", entityType: "forecast_occurrence", entityId: saved.id, summary: "Preserved a scheduled occurrence under its approved recurrence policy", after: definition });
      captured.add(occurrence.key); changed = true;
    }
  }
  return changed;
}
