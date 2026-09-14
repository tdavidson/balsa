import { auth } from "@/lib/auth";
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
    const metadata = readConversationMetadata(row.metadata);
    turns.push({ id: row.id, question: row.content, answer: readableAnswer(raw), ...(metadata.attachments ? { attachments: metadata.attachments } : {}), ...(metadata.reviewContext ? { reviewContext: metadata.reviewContext } : {}), model: row.model, createdAt: row.createdAt.toISOString() });
  }
  return NextResponse.json({ turns });
}

function readConversationMetadata(metadata: string | null): Pick<ConversationTurn, "attachments" | "reviewContext"> {
  if (!metadata) return {};
  try {
    const parsed = JSON.parse(metadata) as { attachments?: unknown; reviewContext?: unknown };
    const attachments = Array.isArray(parsed.attachments) ? parsed.attachments.filter((name): name is string => typeof name === "string") : undefined;
    const candidate = parsed.reviewContext as { type?: unknown; text?: unknown } | undefined;
    const reviewContext: ConversationTurn["reviewContext"] = candidate && (candidate.type === "question" || candidate.type === "decision") && typeof candidate.text === "string" ? { type: candidate.type, text: candidate.text } : undefined;
    return { ...(attachments ? { attachments } : {}), ...(reviewContext ? { reviewContext } : {}) };
  } catch {
    return {};
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
