import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { evidence, getDatabase, ingestionRuns } from "@finance/database";
import { hasScheduledJobAuthorization } from "@/lib/cron-auth";
import { refreshRolledForecasts } from "@/lib/forecast-rollover";

export const maxDuration = 60;

/**
 * Cron-only reconciliation drain. It never accepts a company id from the
 * caller: work is selected from durable pending ingestion runs and executed
 * through the same protected reconciliation endpoint as the interactive UI.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!hasScheduledJobAuthorization(request.headers.get("authorization"), secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getDatabase();
  // Drain extraction first. Successful extraction queues reconciliation, which
  // can then be claimed in this same invocation. The company comes from the
  // durable job row, and the evidence must belong to that same company so a
  // worker request can never be issued for another company's record.
  const extractionQueue = await db.select({ evidenceId: evidence.id, companyId: ingestionRuns.companyId, sourceId: ingestionRuns.sourceId }).from(ingestionRuns).innerJoin(evidence, and(eq(evidence.sourceId, ingestionRuns.sourceId), eq(evidence.companyId, ingestionRuns.companyId))).where(and(eq(ingestionRuns.stage, "extraction"), eq(ingestionRuns.status, "waiting"))).limit(10);
  const extractionCandidates = [...new Map(extractionQueue.map((job) => [job.sourceId, job])).values()];
  const extractionJobs = (await Promise.all(extractionCandidates.map(async (job) => {
    const claimed = await db.update(ingestionRuns).set({ status: "running", startedAt: new Date(), error: null, updatedAt: new Date() }).where(and(eq(ingestionRuns.companyId, job.companyId), eq(ingestionRuns.sourceId, job.sourceId), eq(ingestionRuns.stage, "extraction"), eq(ingestionRuns.status, "waiting"))).returning({ id: ingestionRuns.id });
    return claimed.length ? job : null;
  }))).filter((job): job is NonNullable<typeof job> => Boolean(job));
  const extractionResults = await Promise.all(extractionJobs.map(async (job) => {
    const url = new URL(`/api/evidence/${job.evidenceId}/reprocess?companyId=${encodeURIComponent(job.companyId)}`, request.url);
    const response = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" }, body: "{}", cache: "no-store" });
    if (!response.ok) await db.update(ingestionRuns).set({ status: "waiting", error: `Worker returned ${response.status}`, updatedAt: new Date() }).where(and(eq(ingestionRuns.companyId, job.companyId), eq(ingestionRuns.sourceId, job.sourceId), eq(ingestionRuns.stage, "extraction"), eq(ingestionRuns.status, "running")));
    return { evidenceId: job.evidenceId, status: response.status, ok: response.ok };
  }));

  const queued = await db.select({ companyId: ingestionRuns.companyId }).from(ingestionRuns).where(and(eq(ingestionRuns.stage, "reconciliation"), eq(ingestionRuns.status, "waiting"))).limit(100);
  const companyCandidates = [...new Set(queued.map((run) => run.companyId))].slice(0, 10);
  const claimedCompanies = (await Promise.all(companyCandidates.map(async (companyId) => {
    const claimed = await db.update(ingestionRuns).set({ status: "running", startedAt: new Date(), error: null, updatedAt: new Date() }).where(and(eq(ingestionRuns.companyId, companyId), eq(ingestionRuns.stage, "reconciliation"), eq(ingestionRuns.status, "waiting"))).returning({ id: ingestionRuns.id });
    return claimed.length ? companyId : null;
  }))).filter((companyId): companyId is string => Boolean(companyId));
  const results = await Promise.all(claimedCompanies.map(async (companyId) => {
    const url = new URL(`/api/reconciliation?companyId=${encodeURIComponent(companyId)}`, request.url);
    const response = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${secret}` }, cache: "no-store" });
    if (!response.ok) await db.update(ingestionRuns).set({ status: "waiting", error: `Worker returned ${response.status}`, updatedAt: new Date() }).where(and(eq(ingestionRuns.companyId, companyId), eq(ingestionRuns.stage, "reconciliation"), eq(ingestionRuns.status, "running")));
    return { companyId, status: response.status, ok: response.ok };
  }));
  // Companies whose forecast has fallen behind the calendar (no new mutation
  // triggered a refresh) get one here, attributed to the month rolling forward.
  // Per-company failures come back in `rolledForecasts.failed`; a failure of the
  // scan itself is reported too, so the reconciliation results above still return 200.
  const rolledForecasts = await refreshRolledForecasts().catch((error: unknown) => ({ refreshed: [], retried: [], failed: [], deferred: 0, error: error instanceof Error ? error.message.slice(0, 2_000) : "Forecast rollover failed" }));
  return NextResponse.json({ queuedCompanies: claimedCompanies.length, results, queuedExtractions: extractionJobs.length, extractionResults, rolledForecasts });
}
