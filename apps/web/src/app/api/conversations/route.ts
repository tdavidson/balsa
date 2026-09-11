import { auth } from "@clerk/nextjs/server";
import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDatabase, llmMessages } from "@finance/database";
import { requireCompanyAccess } from "@/lib/auth";

export type ConversationTurn = {
  id: string;
  question: string;
  answer: string;
  attachments?: string[];
  reviewContext?: { type: "question" | "decision"; text: string };
  model: string | null;
  createdAt: string;
};

/** Past questions and answers for this company, newest first, as question/answer pairs. */
export async function GET() {
  await auth.protect();
  const context = await requireCompanyAccess();
  const db = getDatabase();
  const rows = await db
    .select({ id: llmMessages.id, runId: llmMessages.runId, role: llmMessages.role, content: llmMessages.content, model: llmMessages.model, metadata: llmMessages.metadata, createdAt: llmMessages.createdAt })
    .from(llmMessages)
    .where(and(eq(llmMessages.companyId, context.company.id)))
    .orderBy(desc(llmMessages.createdAt))
    .limit(400);

  const turns: ConversationTurn[] = [];
  const answers = new Map<string, string>();
  for (const row of rows) {
    if (row.role === "assistant" && row.runId) answers.set(row.runId, row.content);
  }
  for (const row of rows) {
    if (row.role !== "user") continue;
    const raw = row.runId ? answers.get(row.runId) : undefined;
    const attachments = readAttachments(row.metadata);
    turns.push({ id: row.id, question: row.content, answer: readableAnswer(raw), ...(attachments ? { attachments } : {}), model: row.model, createdAt: row.createdAt.toISOString() });
  }
  return NextResponse.json({ turns });
}

function readAttachments(metadata: string | null) {
  if (!metadata) return undefined;
  try {
    const parsed = JSON.parse(metadata) as { attachments?: unknown };
    return Array.isArray(parsed.attachments) ? parsed.attachments.filter((name): name is string => typeof name === "string") : undefined;
  } catch {
    return undefined;
  }
}

function readableAnswer(raw: string | undefined) {
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw) as { answer?: string; forecastExplanation?: string; questions?: string[] };
    return [parsed.answer, parsed.forecastExplanation, ...(parsed.questions ?? [])].filter(Boolean).join(" ").trim();
  } catch {
    return raw;
  }
}
