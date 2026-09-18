import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { buildProjectedEntries } from "@nevermodel/finance-engine";
import { getDatabase, journalBatches, journalEntries, journalLines, scenarios } from "@finance/database";
import { loadForecastDrivers } from "@/lib/forecast-inputs";
import { postApprovedJournal } from "@/lib/journal-posting";
import { refreshCurrentCalculationRun } from "@/lib/refresh-calculation-run";

/**
 * Freeze the current projection as plan-basis journals for later
 * variance-to-plan work. The live forecast never reads these entries.
 */
export async function pinForecastAsPlan(companyId: string, input: { start: string; end: string; scenarioId?: string; actorUserId: string | null; baseCurrency: string }) {
  const db = getDatabase();
  if (input.scenarioId && !(await db.select({ id: scenarios.id }).from(scenarios).where(and(eq(scenarios.id, input.scenarioId), eq(scenarios.companyId, companyId))).limit(1))[0]) throw new Error("Scenario not found");
  const { drivers, templates } = await loadForecastDrivers(companyId, input.scenarioId ? { scenarioId: input.scenarioId } : {});
  const projection = buildProjectedEntries(drivers, templates, { start: input.start, end: input.end }, input.scenarioId);
  const templateById = new Map(templates.map((template) => [template.id, template]));
  const results = [];
  let reversed = 0;
  for (const entry of projection.entries) {
    const template = templateById.get(entry.templateId)!;
    // A projection has one logical driver/month identity. A changed amount or
    // template creates a new immutable version; the earlier version is
    // explicitly reversed rather than edited or allowed to remain in reports.
    const existing = await db.select({ entryId: journalEntries.id, batchKey: journalBatches.idempotencyKey, scenarioId: journalEntries.scenarioId }).from(journalEntries).innerJoin(journalBatches, eq(journalEntries.batchId, journalBatches.id)).innerJoin(journalLines, eq(journalLines.entryId, journalEntries.id)).where(and(eq(journalEntries.companyId, companyId), eq(journalEntries.period, entry.period), inArray(journalEntries.basis, ["forecast", "plan"]), inArray(journalBatches.source, ["forecast_projection", "forecast_plan_pin"]), eq(journalLines.sourceLocation, `forecast-driver:${entry.sourceDriverId}`)));
    const priorEntryIds = [...new Set(existing.filter((row) => row.batchKey !== entry.idempotencyKey && (entry.scenarioId ? row.scenarioId === entry.scenarioId : !row.scenarioId)).map((row) => row.entryId))];
    if (priorEntryIds.length) {
      const priorLines = await db.select({ id: journalLines.id, entryId: journalLines.entryId, accountId: journalLines.accountId, entityId: journalLines.entityId, currency: journalLines.currency, debitMinor: journalLines.debitMinor, creditMinor: journalLines.creditMinor, sourceId: journalLines.sourceId, sourceRowId: journalLines.sourceRowId, evidenceId: journalLines.evidenceId, factId: journalLines.factId, decisionId: journalLines.decisionId, policyId: journalLines.policyId, approvalEventId: journalLines.approvalEventId, sourceLocation: journalLines.sourceLocation, memo: journalLines.memo }).from(journalLines).where(and(eq(journalLines.companyId, companyId), inArray(journalLines.entryId, priorEntryIds)));
      for (const priorEntryId of priorEntryIds) {
        const lines = priorLines.filter((line) => line.entryId === priorEntryId);
        if (!lines.length) continue;
        const reversal = await postApprovedJournal(companyId, { idempotencyKey: `projection-reversal:${priorEntryId}`, label: `Reverse obsolete ${entry.memo}`, source: "forecast_projection_reversal", postingDate: entry.postingDate, period: entry.period, memo: `Reverse obsolete ${entry.memo}`, basis: "plan", deferRefresh: true, ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}), ...(entry.scenarioId ? { scenarioId: entry.scenarioId } : {}), reversalOfEntryId: priorEntryId, ...(template.decisionId ? { decisionId: template.decisionId } : {}), ...(template.policyId ? { policyId: template.policyId } : {}), lines: lines.map((line, index) => ({ accountId: line.accountId, ...(line.entityId ? { entityId: line.entityId } : {}), currency: line.currency, debitMinor: line.creditMinor, creditMinor: line.debitMinor, externalKey: `projection-reversal:${priorEntryId}:${index}`, sourceLocation: line.sourceLocation ?? `forecast-driver:${entry.sourceDriverId}`, ...(template.decisionId ? { decisionId: template.decisionId } : {}), ...(template.policyId ? { policyId: template.policyId } : {}) })) });
        if (!reversal.idempotent) reversed += 1;
      }
    }
    results.push(await postApprovedJournal(companyId, { idempotencyKey: entry.idempotencyKey, label: entry.memo, source: "forecast_plan_pin", postingDate: entry.postingDate, period: entry.period, memo: entry.memo, basis: "plan", deferRefresh: true, ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}), ...(entry.scenarioId ? { scenarioId: entry.scenarioId } : {}), ...(template.decisionId ? { decisionId: template.decisionId } : {}), ...(template.policyId ? { policyId: template.policyId } : {}), lines: entry.lines.map((line, index) => ({ ...line, currency: input.baseCurrency, externalKey: `${entry.idempotencyKey}:${index}`, sourceLocation: `forecast-driver:${entry.sourceDriverId}`, ...(template.decisionId ? { decisionId: template.decisionId } : {}), ...(template.policyId ? { policyId: template.policyId } : {}) })) }));
  }
  const changed = results.some((result) => !result.idempotent) || reversed > 0;
  const calculationRun = changed ? await refreshCurrentCalculationRun(companyId, { cause: { kind: "plan_pinned", subjectType: "forecast_plan", subjectId: `${input.start}..${input.end}`, actorUserId: input.actorUserId, via: input.actorUserId ? "ui" : "worker" } }) : null;
  return { posted: results.length, idempotent: results.filter((result) => result.idempotent).length, reversed, exceptions: projection.exceptions, calculationRun };
}
