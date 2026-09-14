import { auth } from "@/lib/auth";
import { asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDatabase, llmMessages, llmRuns } from "@finance/database";
import { requireCompanyAccess } from "@/lib/auth";

/** Export the company's de-identified conversation/training records and usage metadata. */
export async function GET() {
  await auth.protect();
  const context = await requireCompanyAccess();
  const db = getDatabase();
  const [messages, runs] = await Promise.all([
    db.select({ id: llmMessages.id, runId: llmMessages.runId, role: llmMessages.role, content: llmMessages.content, model: llmMessages.model, sequence: llmMessages.sequence, createdAt: llmMessages.createdAt }).from(llmMessages).where(eq(llmMessages.companyId, context.company.id)).orderBy(asc(llmMessages.createdAt)),
    db.select({ id: llmRuns.id, provider: llmRuns.provider, model: llmRuns.model, operation: llmRuns.operation, inputTokens: llmRuns.inputTokens, outputTokens: llmRuns.outputTokens, totalTokens: llmRuns.totalTokens, cost: llmRuns.cost, latencyMs: llmRuns.latencyMs, status: llmRuns.status, createdAt: llmRuns.createdAt }).from(llmRuns).where(eq(llmRuns.companyId, context.company.id)).orderBy(asc(llmRuns.createdAt)),
  ]);
  return NextResponse.json({ messages, runs });
}
