import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import {
  economicItems,
  evidence,
  goalDecisionReviews,
  operatingExperiments,
  operatingPlanRevisions,
  operatingPredictions,
  operatingRevisions,
  scenarios,
} from "@finance/database";
import { parseDecimal } from "@balsa/finance-engine";
import {
  operatingHash as hash,
  operatingFamilyWith,
  operatingItemsToken,
  type OperatingSnapshot,
} from "./operating-connection-state";
import { operatingTriggerContextWith } from "./operating-triggers";
import { loadForecastInputs } from "./forecast-inputs";
import { GoalReviewError } from "./goal-reviews";
import type { DbExecutor } from "./db-executor";
import type { OperatingPredictionSnapshot } from "./operating-outcomes-contract";
import type { OperatingPlanLineage } from "./operating-plan-contract";

export async function assertNoAppliedOperatingRevision(
  db: DbExecutor,
  companyId: string,
  experimentId: string,
) {
  const [applied] = await db
    .select({ id: goalDecisionReviews.id })
    .from(operatingPredictions)
    .innerJoin(
      operatingPlanRevisions,
      and(
        eq(operatingPlanRevisions.companyId, companyId),
        eq(operatingPlanRevisions.predictionId, operatingPredictions.id),
      ),
    )
    .innerJoin(
      operatingExperiments,
      and(
        eq(operatingExperiments.companyId, companyId),
        eq(operatingExperiments.id, operatingPlanRevisions.experimentId),
      ),
    )
    .innerJoin(
      goalDecisionReviews,
      and(
        eq(goalDecisionReviews.companyId, companyId),
        eq(goalDecisionReviews.scenarioId, operatingExperiments.scenarioId),
        eq(goalDecisionReviews.kind, "applied"),
      ),
    )
    .where(
      and(
        eq(operatingPredictions.companyId, companyId),
        eq(operatingPredictions.experimentId, experimentId),
      ),
    )
    .limit(1);
  if (applied)
    throw new GoalReviewError(
      "A revision of this operating plan was already approved. Open the latest approved prediction.",
      409,
    );
}
export async function operatingPlanStateWith(
  db: DbExecutor,
  companyId: string,
  reviewId: string,
  now: Date,
  lock = false,
) {
  const context = await operatingTriggerContextWith(
    db,
    companyId,
    reviewId,
    now,
    lock,
  );
  return {
    ...context,
    ...(await operatingPredictionStateWith(
      db,
      companyId,
      context.state.prediction,
      now,
      lock,
    )),
  };
}
export async function operatingPredictionStateWith(
  db: DbExecutor,
  companyId: string,
  prediction: {
    id: string;
    experimentId: string;
    snapshot: OperatingPredictionSnapshot;
  },
  now: Date,
  lock = false,
) {
  await assertNoAppliedOperatingRevision(
    db,
    companyId,
    prediction.experimentId,
  );
  const [connection] = await db
    .select()
    .from(operatingRevisions)
    .where(
      and(
        eq(operatingRevisions.companyId, companyId),
        eq(operatingRevisions.experimentId, prediction.experimentId),
      ),
    );
  if (connection) {
    const family = await operatingFamilyWith(
      db,
      companyId,
      connection.connectionId,
    );
    if (family.applied?.experiment.id !== prediction.experimentId)
      throw new GoalReviewError(
        "A connected version replaced this prediction. Open the latest approved version.",
        409,
      );
  }
  const snapshot = prediction.snapshot as OperatingPredictionSnapshot;
  const ids = snapshot.cashBindings.map((b) => b.driverId);
  const query = db
    .select()
    .from(economicItems)
    .where(
      and(
        eq(economicItems.companyId, companyId),
        inArray(economicItems.id, ids),
      ),
    );
  const items = ids.length ? await (lock ? query.for("share") : query) : [];
  for (const binding of snapshot.cashBindings) {
    const item = items.find((i) => i.id === binding.driverId);
    const output = snapshot.model.outputs.find(
      (o) => o.nodeId === binding.nodeId,
    );
    if (
      !item ||
      !output ||
      item.status !== "confirmed" ||
      item.scenarioId ||
      item.amountFormula ||
      parseDecimal(item.amount ?? "") !==
        BigInt(binding.amountMinor) * 10000n ||
      item.effectiveFrom !== binding.month ||
      item.effectiveTo !== null ||
      item.cadence !== "once" ||
      item.direction !== output.direction ||
      item.category !== output.category ||
      item.accountingTreatment !== "cash" ||
      item.forecastTemplateId ||
      item.forecastOrigin ||
      item.expectedDay ||
      item.recognitionStart ||
      item.recognitionEnd
    )
      throw new GoalReviewError(
        "An owned operating item changed outside this plan. Reconcile it before revising the plan.",
        409,
      );
  }
  const input = await loadForecastInputs(companyId, { db, now });
  const settlement = input.settlement!;
  const occurrences = settlement.occurrences
    .filter((o) => o.driverId && ids.includes(o.driverId))
    .sort((a, b) => a.id.localeCompare(b.id));
  const allocations = settlement.allocations
    .filter((a) => occurrences.some((o) => o.id === a.occurrenceId))
    .sort((a, b) => a.id.localeCompare(b.id));
  const actuals = settlement.actuals
    .filter((a) => allocations.some((x) => x.actualEntryId === a.id))
    .sort((a, b) => a.id.localeCompare(b.id));
  const documentIds = [
    ...new Set(snapshot.model.nodes.flatMap((n) => n.evidenceIds)),
  ];
  const documentsQuery = db
    .select({
      id: evidence.id,
      status: evidence.status,
      sourceHash: evidence.sourceHash,
      updatedAt: evidence.updatedAt,
    })
    .from(evidence)
    .where(
      and(eq(evidence.companyId, companyId), inArray(evidence.id, documentIds)),
    )
    .orderBy(evidence.id);
  const documents = documentIds.length
    ? await (lock ? documentsQuery.for("share") : documentsQuery)
    : [];
  if (
    documents.length !== documentIds.length ||
    documents.some((d) => d.status !== "approved")
  )
    throw new GoalReviewError(
      "All referenced model sources must remain approved before revising this plan.",
      409,
    );
  return {
    input,
    occurrences,
    documents,
    itemsToken: await operatingItemsToken(db, companyId, ids, lock),
    settlementToken: hash({ occurrences, allocations, actuals }),
    documentsToken: hash(documents),
  };
}
export async function assertOperatingPlanScenarioCurrent(
  db: DbExecutor,
  companyId: string,
  scenarioId: string,
  options: {
    reviewed?: boolean;
    lock?: boolean;
    forecastStart?: string;
    now?: Date;
  },
) {
  const [row] = await db
    .select({ experiment: operatingExperiments, changes: scenarios.changes })
    .from(operatingPlanRevisions)
    .innerJoin(
      operatingExperiments,
      and(
        eq(operatingExperiments.companyId, companyId),
        eq(operatingExperiments.id, operatingPlanRevisions.experimentId),
      ),
    )
    .innerJoin(
      scenarios,
      and(
        eq(scenarios.companyId, companyId),
        eq(scenarios.id, operatingExperiments.scenarioId),
      ),
    )
    .where(
      and(
        eq(operatingPlanRevisions.companyId, companyId),
        eq(operatingExperiments.scenarioId, scenarioId),
      ),
    )
    .limit(1);
  if (!row) return;
  if (!options.reviewed)
    throw new GoalReviewError(
      "Approve plan revisions through Decisions & outcomes to preserve the applied prediction.",
      409,
    );
  const saved = row.experiment.snapshot as OperatingSnapshot & {
    revision: OperatingPlanLineage;
  };
  if (!saved.revision)
    throw new GoalReviewError("Plan revision lineage is unavailable.", 409);
  const state = await operatingPlanStateWith(
    db,
    companyId,
    saved.revision.reviewId,
    options.now ?? new Date(),
    options.lock,
  );
  const lineage = saved.revision;
  if (
    state.state.prediction.id !== lineage.predictionId ||
    state.token !== lineage.contextToken ||
    state.itemsToken !== lineage.itemsToken ||
    state.settlementToken !== lineage.settlementToken ||
    state.documentsToken !== lineage.documentsToken ||
    (options.forecastStart &&
      options.forecastStart !== lineage.forecastStart) ||
    hash(row.changes) !== hash(saved.path.changes)
  )
    throw new GoalReviewError(
      "The review, sources, commitments or plan changed. Preview and save a new revision before approval.",
      409,
    );
  const [extra] = await db
    .select({ id: economicItems.id })
    .from(economicItems)
    .where(
      and(
        eq(economicItems.companyId, companyId),
        eq(economicItems.scenarioId, scenarioId),
        eq(economicItems.status, "confirmed"),
      ),
    )
    .limit(1);
  if (extra)
    throw new GoalReviewError(
      "This revision contains separately added items. Remove them and re-preview.",
      409,
    );
}
