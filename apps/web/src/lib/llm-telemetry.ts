import { llmMessages, llmRuns, type Database } from "@finance/database";
import type { ModelProvider } from "@finance/model-providers";

/** LLM telemetry is for cost and operational debugging, never a second document store. */
function redactRequest(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return { redacted: true, characters: value.length };
  if (Array.isArray(value)) return { redacted: true, items: value.length };
  if (typeof value !== "object" || depth >= 3) return { redacted: true };
  return Object.fromEntries(Object.keys(value).map((key) => [key, redactRequest((value as Record<string, unknown>)[key], depth + 1)]));
}

export async function recordLlmRun({ db, provider, companyId, userId, operation, request, response, status = "succeeded", error }: {
  db: Database; provider: ModelProvider; companyId?: string; userId?: string; operation: string;
  request: unknown; response?: string; status?: string; error?: string;
}) {
  const usage = provider.getLastUsage();
  const [run] = await db.insert(llmRuns).values({
    companyId, userId, provider: provider.name, model: usage?.model ?? provider.model, operation,
    inputTokens: usage?.inputTokens?.toString(), outputTokens: usage?.outputTokens?.toString(), totalTokens: usage?.totalTokens?.toString(), cost: usage?.cost?.toString(), latencyMs: usage?.latencyMs?.toString(), status,
    requestJson: JSON.stringify(redactRequest(request)), responseText: response, error,
  }).returning({ id: llmRuns.id });
  return run?.id;
}

export async function recordConversation(db: Database, values: { companyId: string; userId: string; runId?: string | undefined; runIds?: string[]; threadId: string; question: string; response: string; model: string; attachments?: string[]; reviewContext?: { type: "question" | "decision"; text: string } }) {
  const metadata = JSON.stringify({ threadId: values.threadId, attachments: values.attachments, runIds: values.runIds ?? (values.runId ? [values.runId] : []), reviewContext: values.reviewContext });
  await db.insert(llmMessages).values([
    { companyId: values.companyId, userId: values.userId, runId: values.runId, role: "user", content: values.question, model: values.model, sequence: "0", metadata },
    { companyId: values.companyId, userId: values.userId, runId: values.runId, role: "assistant", content: values.response, model: values.model, sequence: "1" },
  ]);
}
