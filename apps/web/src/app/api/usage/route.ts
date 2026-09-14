import { auth } from "@/lib/auth";
import { and, asc, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDatabase, llmMessages, llmRuns } from "@finance/database";
import { requireCompanyAccess } from "@/lib/auth";

const pageSize = 20;

export async function GET(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const url = new URL(request.url);
  const tab = url.searchParams.get("tab") === "calls" ? "calls" : url.searchParams.get("tab") === "summary" ? "summary" : "conversations";
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
  const query = url.searchParams.get("q")?.trim();
  const offset = (page - 1) * pageSize;
  const db = getDatabase();

  if (tab === "summary") {
    const runs = await db.select({ provider: llmRuns.provider, model: llmRuns.model, inputTokens: llmRuns.inputTokens, outputTokens: llmRuns.outputTokens, totalTokens: llmRuns.totalTokens, cost: llmRuns.cost, latencyMs: llmRuns.latencyMs, createdAt: llmRuns.createdAt }).from(llmRuns).where(eq(llmRuns.companyId, context.company.id)).orderBy(asc(llmRuns.createdAt));
    const messages = await db.select({ id: llmMessages.id }).from(llmMessages).where(and(eq(llmMessages.companyId, context.company.id), eq(llmMessages.role, "user")));
    const rollup = url.searchParams.get("rollup") === "daily" || url.searchParams.get("rollup") === "weekly" || url.searchParams.get("rollup") === "annual" ? url.searchParams.get("rollup") : "monthly";
    const keyForDate = (date: Date) => { if (rollup === "daily") return date.toISOString().slice(0, 10); if (rollup === "annual") return date.toISOString().slice(0, 4); if (rollup === "weekly") { const start = new Date(date); const day = start.getUTCDay(); start.setUTCDate(start.getUTCDate() - (day === 0 ? 6 : day - 1)); return `Week of ${start.toISOString().slice(0, 10)}`; } return date.toISOString().slice(0, 7); };
    const totals = runs.reduce((sum, run) => ({ inputTokens: sum.inputTokens + Number(run.inputTokens ?? 0), outputTokens: sum.outputTokens + Number(run.outputTokens ?? 0), totalTokens: sum.totalTokens + Number(run.totalTokens ?? 0), cost: sum.cost + Number(run.cost ?? 0), unpricedRuns: sum.unpricedRuns + (run.cost === null ? 1 : 0) }), { inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0, unpricedRuns: 0 });
    const byModel = new Map<string, { provider: string; model: string; runs: number; inputTokens: number; outputTokens: number; totalTokens: number; cost: number; latency: number }>();
    const byDate = new Map<string, { runs: number; totalTokens: number; cost: number }>();
    for (const run of runs) { const modelKey = `${run.provider}:${run.model}`; const model = byModel.get(modelKey) ?? { provider: run.provider, model: run.model, runs: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0, latency: 0 }; model.runs += 1; model.inputTokens += Number(run.inputTokens ?? 0); model.outputTokens += Number(run.outputTokens ?? 0); model.totalTokens += Number(run.totalTokens ?? 0); model.cost += Number(run.cost ?? 0); model.latency += Number(run.latencyMs ?? 0); byModel.set(modelKey, model); const dateKey = keyForDate(run.createdAt); const date = byDate.get(dateKey) ?? { runs: 0, totalTokens: 0, cost: 0 }; date.runs += 1; date.totalTokens += Number(run.totalTokens ?? 0); date.cost += Number(run.cost ?? 0); byDate.set(dateKey, date); }
    return NextResponse.json({ tab, rollup, summary: { ...totals, chatTurns: messages.length, modelRuns: runs.length, modelRows: [...byModel.values()].sort((a, b) => b.runs - a.runs), dateRows: [...byDate.entries()].map(([period, values]) => ({ period, ...values })).reverse() } });
  }

  if (tab === "calls") {
    const search = query ? or(ilike(llmRuns.operation, `%${query}%`), ilike(llmRuns.model, `%${query}%`), ilike(llmRuns.status, `%${query}%`)) : undefined;
    const where = and(eq(llmRuns.companyId, context.company.id), search);
    const [items, total] = await Promise.all([
      db.select({ id: llmRuns.id, provider: llmRuns.provider, model: llmRuns.model, operation: llmRuns.operation, inputTokens: llmRuns.inputTokens, outputTokens: llmRuns.outputTokens, totalTokens: llmRuns.totalTokens, cost: llmRuns.cost, latencyMs: llmRuns.latencyMs, status: llmRuns.status, error: llmRuns.error, createdAt: llmRuns.createdAt }).from(llmRuns).where(where).orderBy(desc(llmRuns.createdAt)).limit(pageSize).offset(offset),
      db.select({ count: count() }).from(llmRuns).where(where),
    ]);
    return NextResponse.json({ tab, page, pageSize, total: Number(total[0]?.count ?? 0), items });
  }

  const search = query ? or(ilike(llmMessages.content, `%${query}%`), ilike(llmRuns.model, `%${query}%`)) : undefined;
  const where = and(eq(llmMessages.companyId, context.company.id), eq(llmMessages.role, "user"), search);
  const [rows, total] = await Promise.all([
    db.select({ id: llmMessages.id, runId: llmMessages.runId, metadata: llmMessages.metadata, question: llmMessages.content, model: llmMessages.model, createdAt: llmMessages.createdAt, answer: sql<string>`coalesce((select assistant_message.content from llm_messages as assistant_message where assistant_message.run_id = ${llmMessages.runId} and assistant_message.role = 'assistant' order by assistant_message.created_at asc limit 1), '')`, cost: llmRuns.cost, totalTokens: llmRuns.totalTokens }).from(llmMessages).leftJoin(llmRuns, eq(llmMessages.runId, llmRuns.id)).where(where).orderBy(desc(llmMessages.createdAt)).limit(pageSize).offset(offset),
    db.select({ count: count() }).from(llmMessages).leftJoin(llmRuns, eq(llmMessages.runId, llmRuns.id)).where(where),
  ]);
  const runIds = [...new Set(rows.flatMap((row) => {
    try { const parsed = row.metadata ? JSON.parse(row.metadata) as { runIds?: unknown[] } : {}; const ids = Array.isArray(parsed.runIds) ? parsed.runIds.filter((id): id is string => typeof id === "string") : []; return ids.length ? ids : row.runId ? [row.runId] : []; } catch { return row.runId ? [row.runId] : []; }
  }))];
  const relatedRuns = runIds.length ? await db.select({ id: llmRuns.id, cost: llmRuns.cost, totalTokens: llmRuns.totalTokens }).from(llmRuns).where(and(eq(llmRuns.companyId, context.company.id), inArray(llmRuns.id, runIds))) : [];
  const runsById = new Map(relatedRuns.map((run) => [run.id, run]));
  return NextResponse.json({ tab, page, pageSize, total: Number(total[0]?.count ?? 0), items: rows.map((row) => {
    const ids = (() => { try { const parsed = row.metadata ? JSON.parse(row.metadata) as { runIds?: unknown[] } : {}; return Array.isArray(parsed.runIds) ? parsed.runIds.filter((id): id is string => typeof id === "string") : row.runId ? [row.runId] : []; } catch { return row.runId ? [row.runId] : []; } })();
    const chain = ids.map((id) => runsById.get(id)).filter(Boolean);
    return { ...row, cost: chain.some((run) => run?.cost !== null && run?.cost !== undefined) ? chain.reduce((sum, run) => sum + Number(run?.cost ?? 0), 0).toString() : row.cost, totalTokens: chain.length ? chain.reduce((sum, run) => sum + Number(run?.totalTokens ?? 0), 0).toString() : row.totalTokens, metadata: undefined, runId: undefined, createdAt: row.createdAt.toISOString() };
  }) });
}
