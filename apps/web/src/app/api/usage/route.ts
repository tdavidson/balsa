import { auth } from "@clerk/nextjs/server";
import { and, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDatabase, llmMessages, llmRuns } from "@finance/database";
import { requireCompanyAccess } from "@/lib/auth";

const pageSize = 20;

export async function GET(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const url = new URL(request.url);
  const tab = url.searchParams.get("tab") === "calls" ? "calls" : "conversations";
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
  const query = url.searchParams.get("q")?.trim();
  const offset = (page - 1) * pageSize;
  const db = getDatabase();

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
