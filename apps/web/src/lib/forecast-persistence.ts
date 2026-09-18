import "server-only";
import { createHash } from "node:crypto";
import { and, asc, desc, eq, like, sql } from "drizzle-orm";
import { calculationNodes, calculationRuns, financialStateRevisions, forecastConsequences, getDatabase } from "@finance/database";
import { diffForecastRuns, stableJson, type ForecastRun, type ForecastRunInput } from "@nevermodel/finance-engine";
import type { DbExecutor, DbTransaction } from "@/lib/db-executor";

const forecastEngines = "forecast-run-%";

/**
 * Persist a derived forecast exactly like a journal graph: one run per (revision, engine, input), with inspectable nodes.
 * The run and its nodes commit together, so a reused run always has its nodes:
 * inside the caller's transaction when `tx` is given, otherwise in its own.
 */
export async function persistForecastRun(input: { companyId: string; financialStateRevision: string; run: ForecastRun; input: ForecastRunInput }, tx?: DbTransaction) {
  const inputJson = stableJson(input.input);
  const inputHash = createHash("sha256").update(inputJson).digest("hex");
  const write = async (tx: DbTransaction) => {
    const inserted = await tx.insert(calculationRuns).values({
      companyId: input.companyId, engineVersion: input.run.formulaVersion, inputHash, financialStateRevision: input.financialStateRevision,
      asOfMonth: input.run.asOfMonth, horizonStart: input.run.horizon.start, horizonEnd: input.run.horizon.end,
      inputJson, outputJson: stableJson(input.run), verificationStatus: input.run.verificationStatus,
    }).onConflictDoNothing().returning({ id: calculationRuns.id });
    const run = inserted[0] ?? (await tx.select({ id: calculationRuns.id }).from(calculationRuns).where(and(eq(calculationRuns.companyId, input.companyId), eq(calculationRuns.financialStateRevision, input.financialStateRevision), eq(calculationRuns.engineVersion, input.run.formulaVersion), eq(calculationRuns.inputHash, inputHash))).limit(1))[0];
    if (!run) throw new Error("Unable to create or locate forecast calculation run");
    if (inserted[0] && input.run.nodes.length) await tx.insert(calculationNodes).values(input.run.nodes.map((node) => ({
      calculationRunId: run.id, nodeKey: node.id, kind: node.kind, month: node.month, label: node.label, formula: node.formula, formulaVersion: node.formulaVersion,
      valueJson: stableJson(node.value), inputNodeIds: stableJson(node.inputNodeIds), lineIds: stableJson([]), provenance: stableJson({ driverIds: node.driverIds }),
      verificationStatus: input.run.verificationStatus, verificationReasons: stableJson(input.run.exceptions.map((exception) => exception.reason)),
    })));
    return { id: run.id, reused: !inserted[0] };
  };
  return tx ? write(tx) : getDatabase().transaction(write);
}

/** The most recent forecast run strictly before a revision, across forecast formula versions. */
export async function loadPreviousForecastRun(companyId: string, beforeRevision: string, db: DbExecutor = getDatabase()) {
  const [row] = await db.select({ id: calculationRuns.id, revision: calculationRuns.financialStateRevision, outputJson: calculationRuns.outputJson }).from(calculationRuns)
    .where(and(eq(calculationRuns.companyId, companyId), like(calculationRuns.engineVersion, forecastEngines), sql`${calculationRuns.financialStateRevision}::bigint < ${beforeRevision}::bigint`))
    .orderBy(desc(sql`${calculationRuns.financialStateRevision}::bigint`), desc(calculationRuns.createdAt)).limit(1);
  return row ? { id: row.id, revision: row.revision, run: JSON.parse(row.outputJson) as ForecastRun } : null;
}

/**
 * Store the forward consequence of every revision since the previous forecast
 * run. Revisions whose own jobs were superseded are included in `causes`.
 * The first run has nothing to compare against and records nothing.
 */
export async function recordForecastConsequence(input: { companyId: string; financialStateRevision: string; nextRunId: string; run: ForecastRun }, db: DbExecutor = getDatabase()) {
  const previous = await loadPreviousForecastRun(input.companyId, input.financialStateRevision, db);
  if (!previous) return null;
  const delta = diffForecastRuns(previous.run, input.run);
  if (!delta) return null;
  const causes = await db.select().from(financialStateRevisions).where(and(
    eq(financialStateRevisions.companyId, input.companyId),
    sql`${financialStateRevisions.revision}::bigint > ${previous.revision}::bigint`,
    sql`${financialStateRevisions.revision}::bigint <= ${input.financialStateRevision}::bigint`,
  )).orderBy(asc(sql`${financialStateRevisions.revision}::bigint`));
  const [row] = await db.insert(forecastConsequences).values({
    companyId: input.companyId, revision: input.financialStateRevision, previousRunId: previous.id, nextRunId: input.nextRunId, delta,
    causes: causes.map((cause) => ({ revision: cause.revision, kind: cause.kind, subjectType: cause.subjectType, subjectId: cause.subjectId, actorUserId: cause.actorUserId, via: cause.via, createdAt: cause.createdAt.toISOString(), ...(cause.subjectIds ? { subjectIds: cause.subjectIds as string[] } : {}) })),
  }).onConflictDoNothing().returning({ id: forecastConsequences.id });
  return row ?? null;
}
