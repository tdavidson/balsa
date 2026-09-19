import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDatabase } from "@finance/database";
import { ModelWriteError } from "@/lib/forecast-model-store";
import { enqueueCalculationRefreshWith, processEnqueuedCalculationRefresh } from "@/lib/refresh-calculation-run";
import type { DbTransaction } from "@/lib/db-executor";
import type { RevisionCause } from "@/lib/revision-cause";

export const uuidParam = z.string().uuid();
export const invalidBody = (details: unknown) => NextResponse.json({ error: "Invalid model request", details }, { status: 400 });

/** A refused model write as its HTTP status, with the positioned errors for 422. Anything else is rethrown. */
export function modelErrorResponse(error: unknown) {
  if (error instanceof ModelWriteError) return NextResponse.json({ error: error.message, errors: error.issues }, { status: error.status });
  throw error;
}

/** Commit the model mutation, revision cause, and outbox enqueue together; run the job only after commit. */
type ProcessResult = { financialStateRevision: string; status: "completed" | "failed" | "not_queued"; forecastJobId: string | null; forecastStatus: string; error?: string };

export async function commitModelWrite<T>(companyId: string, cause: Omit<RevisionCause, "subjectId">, mutate: (tx: DbTransaction) => Promise<{ value: T; subjectId: string | null }>, deps: { database?: Pick<ReturnType<typeof getDatabase>, "transaction">; enqueue?: typeof enqueueCalculationRefreshWith; process?: (receipt: Awaited<ReturnType<typeof enqueueCalculationRefreshWith>>) => Promise<ProcessResult> } = {}) {
  const committed = await (deps.database ?? getDatabase()).transaction(async (tx) => {
    const mutation = await mutate(tx);
    const receipt = await (deps.enqueue ?? enqueueCalculationRefreshWith)(tx, companyId, { cause: { ...cause, subjectId: mutation.subjectId }, rebuildJournalGraphs: false });
    return { value: mutation.value, receipt };
  });
  return { value: committed.value, calculationRun: await (deps.process ?? processEnqueuedCalculationRefresh)(committed.receipt) };
}
