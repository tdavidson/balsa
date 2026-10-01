import "server-only";
import { and, eq, gte, inArray, like, lte } from "drizzle-orm";
import { buildProjectedEntries } from "@balsa/finance-engine";
import { getDatabase, journalBatches, journalEntries, journalLines, scenarios } from "@finance/database";
import { loadForecastDrivers, loadForecastModel, resolveDriversForWindow } from "@/lib/forecast-inputs";
import { postApprovedJournal, type JournalPostingRequest } from "@/lib/journal-posting";
import { refreshCurrentCalculationRun } from "@/lib/refresh-calculation-run";

/**
 * Freeze the current projection as plan-basis journals for later
 * variance-to-plan work. The live forecast never reads these entries.
 */
export async function pinForecastAsPlan(companyId: string, input: { start: string; end: string; scenarioId?: string; actorUserId: string | null; baseCurrency: string }) {
  const db = getDatabase();
  if (input.scenarioId && !(await db.select({ id: scenarios.id }).from(scenarios).where(and(eq(scenarios.id, input.scenarioId), eq(scenarios.companyId, companyId))).limit(1))[0]) throw new Error("Scenario not found");
  const { drivers: loaded, templates } = await loadForecastDrivers(companyId, input.scenarioId ? { scenarioId: input.scenarioId } : {});
  const formulas = resolveDriversForWindow(loaded, await loadForecastModel(companyId), { start: input.start, end: input.end });
  const projection = buildProjectedEntries(formulas.drivers, templates, { start: input.start, end: input.end }, input.scenarioId);
  const templateById = new Map(templates.map((template) => [template.id, template]));
  const results = [];
  let reversed = 0;
  // Reconcile the requested scope as a complete desired set. This catches identities that
  // disappear entirely (for example, a formula month becoming zero), not only identities
  // for which a replacement entry exists.
  const existingRows = await db.select({ entryId: journalEntries.id, batchKey: journalBatches.idempotencyKey, scenarioId: journalEntries.scenarioId, basis: journalEntries.basis, postingDate: journalEntries.postingDate, period: journalEntries.period, memo: journalEntries.memo, sourceLocation: journalLines.sourceLocation }).from(journalEntries).innerJoin(journalBatches, eq(journalEntries.batchId, journalBatches.id)).innerJoin(journalLines, eq(journalLines.entryId, journalEntries.id)).where(and(eq(journalEntries.companyId, companyId), gte(journalEntries.period, input.start), lte(journalEntries.period, input.end), inArray(journalEntries.basis, ["forecast", "plan", "scenario"]), inArray(journalBatches.source, ["forecast_projection", "forecast_plan_pin"]), like(journalLines.sourceLocation, "forecast-driver:%")));
  const existingById = new Map(existingRows.filter((row) => input.scenarioId ? row.scenarioId === input.scenarioId : !row.scenarioId).map((row) => [row.entryId, row]));
  const priorIds = [...existingById.keys()];
  const reversedIds = new Set(priorIds.length ? (await db.select({ id: journalEntries.reversalOfEntryId }).from(journalEntries).where(and(eq(journalEntries.companyId, companyId), inArray(journalEntries.reversalOfEntryId, priorIds)))).flatMap((row) => row.id ? [row.id] : []) : []);
  const identity = (sourceLocation: string, period: string) => `${sourceLocation}|${period}`;
  const desiredByIdentity = new Map(projection.entries.map((entry) => [identity(`forecast-driver:${entry.sourceDriverId}`, entry.period), entry]));
  const matchesVersion = (batchKey: string, desiredKey: string) => batchKey === desiredKey || batchKey.startsWith(`${desiredKey}:generation:`);
  const active = [...existingById.values()].filter((row) => !reversedIds.has(row.entryId));
  const obsolete = active.filter((row) => {
    const desired = desiredByIdentity.get(identity(row.sourceLocation!, row.period));
    return !desired || !matchesVersion(row.batchKey, desired.idempotencyKey);
  });
  const postingKeys = new Map(projection.entries.map((entry) => {
    const rows = [...existingById.values()].filter((row) => identity(row.sourceLocation!, row.period) === identity(`forecast-driver:${entry.sourceDriverId}`, entry.period) && matchesVersion(row.batchKey, entry.idempotencyKey));
    const current = rows.find((row) => !reversedIds.has(row.entryId));
    return [entry.idempotencyKey, current?.batchKey ?? (rows.length ? `${entry.idempotencyKey}:generation:${rows.length}` : entry.idempotencyKey)];
  }));
  if (obsolete.length) {
    const obsoleteIds = obsolete.map((row) => row.entryId);
    const priorLines = await db.select({ entryId: journalLines.entryId, accountId: journalLines.accountId, entityId: journalLines.entityId, currency: journalLines.currency, debitMinor: journalLines.debitMinor, creditMinor: journalLines.creditMinor, decisionId: journalLines.decisionId, policyId: journalLines.policyId, sourceLocation: journalLines.sourceLocation }).from(journalLines).where(and(eq(journalLines.companyId, companyId), inArray(journalLines.entryId, obsoleteIds)));
    for (const prior of obsolete) {
      const lines = priorLines.filter((line) => line.entryId === prior.entryId);
      if (!lines.length) continue;
      const sourceLocation = lines[0]!.sourceLocation ?? "forecast-driver:unknown";
      const reversal = await postApprovedJournal(companyId, { idempotencyKey: `projection-reversal:${prior.entryId}`, label: `Reverse obsolete ${prior.memo}`, source: "forecast_projection_reversal", postingDate: prior.postingDate, period: prior.period, memo: `Reverse obsolete ${prior.memo}`, basis: prior.basis as NonNullable<JournalPostingRequest["basis"]>, deferRefresh: true, ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}), ...(prior.scenarioId ? { scenarioId: prior.scenarioId } : {}), reversalOfEntryId: prior.entryId, ...(lines[0]!.decisionId ? { decisionId: lines[0]!.decisionId } : {}), ...(lines[0]!.policyId ? { policyId: lines[0]!.policyId } : {}), lines: lines.map((line, index) => ({ accountId: line.accountId, ...(line.entityId ? { entityId: line.entityId } : {}), currency: line.currency, debitMinor: line.creditMinor, creditMinor: line.debitMinor, externalKey: `projection-reversal:${prior.entryId}:${index}`, sourceLocation: line.sourceLocation ?? sourceLocation, ...(line.decisionId ? { decisionId: line.decisionId } : {}), ...(line.policyId ? { policyId: line.policyId } : {}) })) });
      if (!reversal.idempotent) reversed += 1;
    }
  }
  for (const entry of projection.entries) {
    const template = templateById.get(entry.templateId)!;
    const postingKey = postingKeys.get(entry.idempotencyKey)!;
    results.push(await postApprovedJournal(companyId, { idempotencyKey: postingKey, label: entry.memo, source: "forecast_plan_pin", postingDate: entry.postingDate, period: entry.period, memo: entry.memo, basis: "plan", deferRefresh: true, ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}), ...(entry.scenarioId ? { scenarioId: entry.scenarioId } : {}), ...(template.decisionId ? { decisionId: template.decisionId } : {}), ...(template.policyId ? { policyId: template.policyId } : {}), lines: entry.lines.map((line, index) => ({ ...line, currency: input.baseCurrency, externalKey: `${postingKey}:${index}`, sourceLocation: `forecast-driver:${entry.sourceDriverId}`, ...(template.decisionId ? { decisionId: template.decisionId } : {}), ...(template.policyId ? { policyId: template.policyId } : {}) })) }));
  }
  const changed = results.some((result) => !result.idempotent) || reversed > 0;
  const calculationRun = changed ? await refreshCurrentCalculationRun(companyId, { cause: { kind: "plan_pinned", subjectType: "forecast_plan", subjectId: `${input.start}..${input.end}`, actorUserId: input.actorUserId, via: input.actorUserId ? "ui" : "worker" } }) : null;
  return { posted: results.length, idempotent: results.filter((result) => result.idempotent).length, reversed, exceptions: [...formulas.exceptions, ...projection.exceptions], calculationRun };
}
