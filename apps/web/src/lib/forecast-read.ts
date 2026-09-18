import "server-only";
import { and, desc, eq, inArray, like, sql } from "drizzle-orm";
import { calculationRuns, companies, decisions, economicItems, evidence, forecastConsequences, getDatabase } from "@finance/database";
import type { ForecastConsequence, ForecastRun } from "@nevermodel/finance-engine";

const parsedRuns = new Map<string, ForecastRun>();

/** The latest persisted forecast run. `stale` means a newer revision's forecast has not completed yet. */
export async function loadLatestForecast(companyId: string) {
  const db = getDatabase();
  const [[row], [company]] = await Promise.all([
    db.select({ id: calculationRuns.id, revision: calculationRuns.financialStateRevision }).from(calculationRuns).where(and(eq(calculationRuns.companyId, companyId), like(calculationRuns.engineVersion, "forecast-run-%"))).orderBy(desc(sql`${calculationRuns.financialStateRevision}::bigint`), desc(calculationRuns.createdAt)).limit(1),
    db.select({ revision: companies.financialStateRevision }).from(companies).where(eq(companies.id, companyId)).limit(1),
  ]);
  if (!row) return null;
  let run = parsedRuns.get(row.id);
  if (!run) {
    const [full] = await db.select({ outputJson: calculationRuns.outputJson }).from(calculationRuns).where(eq(calculationRuns.id, row.id)).limit(1);
    if (!full) return null;
    run = JSON.parse(full.outputJson) as ForecastRun;
    parsedRuns.set(row.id, run);
    if (parsedRuns.size > 20) parsedRuns.delete(parsedRuns.keys().next().value!);
  }
  return { runId: row.id, revision: row.revision, run, stale: company?.revision !== row.revision };
}

export type ConsequenceCause = { revision: string; kind: string; subjectType: string; subjectId: string | null; actorUserId: string | null; via: string; createdAt: string; subjectLabel: string | null };

/** Recent consequences with a human label for each cause's subject. */
export async function loadRecentConsequences(companyId: string, limit = 10) {
  const db = getDatabase();
  const rows = await db.select().from(forecastConsequences).where(eq(forecastConsequences.companyId, companyId)).orderBy(desc(forecastConsequences.createdAt)).limit(Math.max(1, Math.min(limit, 50)));
  const causes = rows.flatMap((row) => row.causes as Omit<ConsequenceCause, "subjectLabel">[]);
  const ids = (type: string) => [...new Set(causes.filter((cause) => cause.subjectType === type && cause.subjectId).map((cause) => cause.subjectId!))];
  const [items, documents, answers] = await Promise.all([
    ids("economic_item").length ? db.select({ id: economicItems.id, label: economicItems.label }).from(economicItems).where(and(eq(economicItems.companyId, companyId), inArray(economicItems.id, ids("economic_item")))) : [],
    ids("evidence").length ? db.select({ id: evidence.id, label: evidence.sourceName }).from(evidence).where(and(eq(evidence.companyId, companyId), inArray(evidence.id, ids("evidence")))) : [],
    ids("decision").length ? db.select({ id: decisions.id, label: decisions.question }).from(decisions).where(and(eq(decisions.companyId, companyId), inArray(decisions.id, ids("decision")))) : [],
  ]);
  const labels = new Map([...items, ...documents, ...answers].map((row) => [row.id, row.label]));
  return rows.map((row) => ({
    id: row.id, revision: row.revision, createdAt: row.createdAt.toISOString(), delta: row.delta as ForecastConsequence,
    causes: (row.causes as Omit<ConsequenceCause, "subjectLabel">[]).map((cause) => ({ ...cause, subjectLabel: cause.subjectId ? labels.get(cause.subjectId) ?? null : null })),
  }));
}
