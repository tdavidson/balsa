import { llmMessages, llmRuns, type Database } from "@finance/database";
import type { ModelProvider } from "@finance/model-providers";

export async function recordLlmRun({ db, provider, companyId, userId, operation, request, response, status = "succeeded", error }: {
  db: Database; provider: ModelProvider; companyId?: string; userId?: string; operation: string;
  request: unknown; response?: string; status?: string; error?: string;
}) {
  const usage = provider.getLastUsage();
  const [run] = await db.insert(llmRuns).values({
    companyId, userId, provider: provider.name, model: usage?.model ?? provider.model, operation,
    inputTokens: usage?.inputTokens?.toString(), outputTokens: usage?.outputTokens?.toString(), totalTokens: usage?.totalTokens?.toString(), cost: usage?.cost?.toString(), latencyMs: usage?.latencyMs?.toString(), status,
    requestJson: JSON.stringify(request), responseText: response, error,
  }).returning({ id: llmRuns.id });
  return run?.id;
}

export async function recordConversation(db: Database, values: { companyId: string; userId: string; runId?: string | undefined; question: string; response: string; model: string; attachments?: string[] }) {
  const metadata = values.attachments?.length ? JSON.stringify({ attachments: values.attachments }) : undefined;
  await db.insert(llmMessages).values([
    { companyId: values.companyId, userId: values.userId, runId: values.runId, role: "user", content: values.question, model: values.model, sequence: "0", metadata },
    { companyId: values.companyId, userId: values.userId, runId: values.runId, role: "assistant", content: values.response, model: values.model, sequence: "1" },
  ]);
}
