import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  decisionEffectApplications,
  evidence,
  factRecords,
  getDatabase,
  goalDecisionReviews,
  operatingExperiments,
  operatingObservations,
  operatingOutcomeReviews,
  operatingPredictions,
  recordAudit,
  setCompanyScopeSql,
} from "@finance/database";
import {
  compareOperatingObservation,
  explainOperatingVariance,
  explainOperatingCashTiming,
  observeOperatingCash,
  operatingOutcomeVersion,
  type OperatingCashBinding,
} from "@balsa/finance-engine";
import { replayOperatingFinancialEffects } from "./operating-variance";
import { GoalReviewError } from "./goal-reviews";
import {
  isOperatingNumber,
  operatingHash as hash,
  type OperatingSnapshot,
} from "./operating-connection-state";
import type { GoalDecisionSnapshot } from "./goal-decisions-contract";
import { loadForecastInputs } from "./forecast-inputs";
import type { DbExecutor } from "./db-executor";
import {
  operatingOutcomeCommand,
  type OperatingObservationDefinition,
  type OperatingPredictionSnapshot,
} from "./operating-outcomes-contract";

/** Called inside approval's transaction; no new engine run can rewrite the original prediction. */
export async function preserveOperatingPredictionWith(
  db: DbExecutor,
  companyId: string,
  reviewId: string,
  now: Date,
) {
  const [prior] = await db
    .select()
    .from(operatingPredictions)
    .where(
      and(
        eq(operatingPredictions.companyId, companyId),
        eq(operatingPredictions.reviewId, reviewId),
      ),
    );
  if (prior) return prior.id;
  const [review] = await db
    .select()
    .from(goalDecisionReviews)
    .where(
      and(
        eq(goalDecisionReviews.companyId, companyId),
        eq(goalDecisionReviews.id, reviewId),
        eq(goalDecisionReviews.kind, "applied"),
      ),
    );
  if (!review)
    throw new GoalReviewError("Applied decision review not found.", 404);
  const [experiment] = await db
    .select()
    .from(operatingExperiments)
    .where(
      and(
        eq(operatingExperiments.companyId, companyId),
        eq(operatingExperiments.scenarioId, review.scenarioId),
      ),
    );
  if (!experiment) return null;
  const applied = review.snapshot as GoalDecisionSnapshot;
  const original = experiment.snapshot as OperatingSnapshot;
  // A separately edited scenario is not evidence that this operating model was approved.
  if (
    applied.type !== "applied" ||
    !applied.appliedOutlook ||
    hash(applied.preview.scenario.changes) !== hash(original.path.changes) ||
    applied.decisionIds.length !== original.path.changes.length
  )
    return null;
  const applications = applied.decisionIds.length
    ? await db
        .select()
        .from(decisionEffectApplications)
        .where(
          and(
            eq(decisionEffectApplications.companyId, companyId),
            inArray(decisionEffectApplications.decisionId, applied.decisionIds),
          ),
        )
    : [];
  const changes = original.path.changes;
  const cashBindings: OperatingCashBinding[] = [
    ...(original.revision?.retainedBindings ?? []),
  ];
  const cash = original.path.operating.cash.filter(
    (c) =>
      !cashBindings.some((b) => b.nodeId === c.nodeId && b.month === c.month),
  );
  for (const [index, change] of changes.entries()) {
    if (change.kind !== "add_driver") continue;
    // Connected revisions may omit expired cash rows. Preserve the exact selected row.
    const rowIndex = cash.findIndex(
      (r) =>
        r.month === change.effectiveFrom &&
        r.label === change.label &&
        r.direction === change.direction &&
        Number(r.amountMinor) / 100 === change.amount,
    );
    const application = applications.find(
      (a) =>
        a.decisionId === applied.decisionIds[index] &&
        a.effectKind === "add_item",
    );
    if (rowIndex < 0 || typeof application?.result.itemId !== "string")
      return null;
    const row = cash.splice(rowIndex, 1)[0]!;
    cashBindings.push({
      nodeId: row.nodeId,
      month: row.month,
      amountMinor: row.amountMinor,
      driverId: application.result.itemId,
    });
  }
  const snapshot: OperatingPredictionSnapshot = {
    schemaVersion: 1,
    forecastStart: applied.appliedOutlook.output.horizon.start,
    name: experiment.name,
    approvedAt: review.createdAt.toISOString(),
    preservedAt: now.toISOString(),
    model: original.model,
    operating: original.path.operating,
    cashBindings,
    ...(original.revision ? {retainedCashBindings:original.revision.retainedBindings} : {}),
  };
  const [saved] = await db
    .insert(operatingPredictions)
    .values({ companyId, experimentId: experiment.id, reviewId, snapshot })
    .returning();
  await recordAudit(db, {
    companyId,
    actorUserId: review.actorUserId,
    via: "ui",
    action: "operating_prediction.preserved",
    entityType: "operating_prediction",
    entityId: saved!.id,
    summary: "Pinned the original operating run to its reviewed application.",
    after: {
      reviewId,
      experimentId: experiment.id,
      formulaVersion: snapshot.operating.formulaVersion,
    },
  });
  return saved!.id;
}

async function predictionWith(db: DbExecutor, companyId: string, id: string) {
  const [row] = await db
    .select()
    .from(operatingPredictions)
    .where(
      and(
        eq(operatingPredictions.companyId, companyId),
        eq(operatingPredictions.id, id),
      ),
    );
  if (!row) throw new GoalReviewError("Operating prediction not found.", 404);
  return { ...row, snapshot: row.snapshot as OperatingPredictionSnapshot };
}
async function factsWith(
  db: DbExecutor,
  companyId: string,
  ids?: string[],
  lock = false,
) {
  if (ids && !ids.length) return [];
  const query = db
    .select({ fact: factRecords, document: evidence })
    .from(factRecords)
    .innerJoin(
      evidence,
      and(
        eq(evidence.id, factRecords.evidenceId),
        eq(evidence.companyId, companyId),
      ),
    )
    .where(
      and(
        eq(factRecords.companyId, companyId),
        ...(ids
          ? [inArray(factRecords.id, ids)]
          : [
              eq(factRecords.status, "approved"),
              eq(evidence.status, "approved"),
            ]),
      ),
    )
    .orderBy(desc(factRecords.updatedAt))
    .limit(ids ? 2000 : 100);
  return await (lock ? query.for("share") : query);
}
function sourceOf(row: Awaited<ReturnType<typeof factsWith>>[number]) {
  return {
    factId: row.fact.id,
    evidenceId: row.document.id,
    label: row.fact.label,
    sourceName: row.document.sourceName,
    sourceLocation: row.fact.sourceLocation,
    currency: row.fact.currency,
    sourceHash: row.document.sourceHash,
    value: row.fact.value.trim(),
    factUpdatedAt: row.fact.updatedAt.toISOString(),
    evidenceUpdatedAt: row.document.updatedAt.toISOString(),
  };
}
export async function loadOperatingOutcomeWorkspace(companyId: string, experimentId?: string) {
  return getDatabase().transaction(
    async (tx) => {
      await tx.execute(setCompanyScopeSql(companyId));
      const rows = await tx
        .select()
        .from(operatingPredictions)
        .where(and(eq(operatingPredictions.companyId, companyId), experimentId ? eq(operatingPredictions.experimentId, experimentId) : undefined))
        .orderBy(desc(operatingPredictions.createdAt))
        .limit(50);
      const reviews = await tx
        .select({
          id: goalDecisionReviews.id,
          name: operatingExperiments.name,
          createdAt: goalDecisionReviews.createdAt,
        })
        .from(goalDecisionReviews)
        .innerJoin(
          operatingExperiments,
          and(
            eq(operatingExperiments.companyId, companyId),
            eq(operatingExperiments.scenarioId, goalDecisionReviews.scenarioId),
          ),
        )
        .where(
          and(
            eq(goalDecisionReviews.companyId, companyId),
            eq(goalDecisionReviews.kind, "applied"),
            experimentId ? eq(operatingExperiments.id, experimentId) : undefined,
          ),
        )
        .orderBy(desc(goalDecisionReviews.createdAt))
        .limit(50);
      return {
        companyId,
        predictions: rows.map((row) => ({
          id: row.id,
          reviewId: row.reviewId,
          experimentId: row.experimentId,
          name: (row.snapshot as OperatingPredictionSnapshot).name,
          approvedAt: (row.snapshot as OperatingPredictionSnapshot).approvedAt,
        })),
        legacyReviews: reviews
          .filter((r) => !rows.some((p) => p.reviewId === r.id))
          .map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
      };
    },
    { isolationLevel: "repeatable read" },
  );
}
export async function operatingObservationStateWith(
  db: DbExecutor,
  companyId: string,
  id: string,
  lock = false,
) {
  const prediction = await predictionWith(db, companyId, id);
  const history = await db
    .select()
    .from(operatingObservations)
    .where(
      and(
        eq(operatingObservations.companyId, companyId),
        eq(operatingObservations.predictionId, id),
      ),
    )
    .orderBy(
      desc(operatingObservations.createdAt),
      desc(operatingObservations.id),
    )
    .limit(2001);
  if (history.length > 2000)
    throw new GoalReviewError(
      "This prediction exceeds the observation review limit.",
      422,
    );
  const definitions = history.map(
    (r) => r.definition as OperatingObservationDefinition,
  );
  const sources = await factsWith(
    db,
    companyId,
    [...new Set(definitions.map((d) => d.source.factId))],
    lock,
  );
  const superseded = new Set(
    history.flatMap((r) => (r.supersedesId ? [r.supersedesId] : [])),
  );
  const current = history.filter((r) => !superseded.has(r.id));
  const { model, operating } = prediction.snapshot;
  const rows = model.nodes.map((node) => ({
    nodeId: node.id,
    label: node.label,
    unit: node.unit,
    formula:
      node.op === "input"
        ? "Dated input"
        : `${node.op}(${node.args.join(", ")})`,
    cash: model.outputs.some((o) => o.nodeId === node.id),
    months: operating.months
      .map((month, index) => {
        const observation = current.find(
          (r) => r.nodeId === node.id && r.month === month,
        );
        const definition = observation?.definition as
          | OperatingObservationDefinition
          | undefined;
        const source = definition
          ? sources.find((s) => s.fact.id === definition.source.factId)
          : undefined;
        const valid =
          !definition?.withdrawn &&
          source &&
          source.fact.status === "approved" &&
          source.document.status === "approved" &&
          hash(sourceOf(source)) === hash(definition!.source);
        return {
          month,
          observationId: observation?.id ?? null,
          definition: definition ?? null,
          ...compareOperatingObservation(
            operating.values[node.id]![index]!,
            definition?.value ?? null,
            !definition
              ? "missing"
              : !valid
                ? "unavailable"
                : definition.coverage,
          ),
        };
      })
      .filter((row) => row.month >= prediction.snapshot.forecastStart),
  }));
  return { prediction, history, rows };
}
async function outcomeWith(
  db: DbExecutor,
  companyId: string,
  id: string,
  now: Date,
) {
  const { prediction, history, rows } = await operatingObservationStateWith(
    db,
    companyId,
    id,
  );
  const { model, operating, cashBindings } = prediction.snapshot;
  const input = await loadForecastInputs(companyId, { db, now });
  const cash = observeOperatingCash(
    cashBindings,
    input.settlement!,
    input.currency,
  );
  const variance = explainOperatingVariance(
    model,
    operating,
    rows.flatMap((row) =>
      row.months.flatMap((month) =>
        month.observationId
          ? [
              {
                id: month.observationId,
                nodeId: row.nodeId,
                month: month.month,
                value: month.observed,
                coverage: month.coverage,
              },
            ]
          : [],
      ),
    ),
    prediction.snapshot.forecastStart,
    now.toISOString().slice(0, 10),
  );
  const [approval] = await db
    .select({ snapshot: goalDecisionReviews.snapshot })
    .from(goalDecisionReviews)
    .where(
      and(
        eq(goalDecisionReviews.companyId, companyId),
        eq(goalDecisionReviews.id, prediction.reviewId),
      ),
    );
  const financialEffects = replayOperatingFinancialEffects(
    variance,
    (approval?.snapshot as GoalDecisionSnapshot) ?? null,
    prediction.snapshot.forecastStart,
    prediction.snapshot.retainedCashBindings ?? [],
  );
  const timing = model.outputs.map((output) => ({
    nodeId: output.nodeId,
    label: output.label,
    direction: output.direction,
    months: explainOperatingCashTiming(
      cash,
      output.nodeId,
      operating.months.filter(
        (month) => month >= prediction.snapshot.forecastStart,
      ),
    ),
  }));
  const payload = {
    companyId,
    predictionId: id,
    explanation: { variance, financialEffects, timing },
    reviewId: prediction.reviewId,
    experimentId: prediction.experimentId,
    prediction: prediction.snapshot,
    formulaVersion: operatingOutcomeVersion,
    throughDate: now.toISOString().slice(0, 10),
    rows,
    cash,
    history: history.map((r) => ({
      id: r.id,
      nodeId: r.nodeId,
      month: r.month,
      supersedesId: r.supersedesId,
      definition: r.definition as OperatingObservationDefinition,
      recordedAt: r.createdAt.toISOString(),
    })),
    limitations: [
      "Observed cash includes only reviewed allocations to this model's applied drivers. Missing matches are not zero and do not establish complete bank coverage.",
      "Operating observations are explicitly reviewed source mappings. Units and scope are confirmed by the reviewer; no conversion or causal explanation is inferred.",
      "Each approved version is a separate prediction. Revisions do not rewrite earlier forecasts or actuals.",
    ],
  };
  return { ...payload, previewToken: hash(payload) };
}
export async function loadOperatingOutcome(
  companyId: string,
  id: string,
  now = new Date(),
) {
  return getDatabase().transaction(
    async (tx) => {
      await tx.execute(setCompanyScopeSql(companyId));
      const view = await outcomeWith(tx, companyId, id, now);
      const facts = (await factsWith(tx, companyId))
        .filter((r) => isOperatingNumber(r.fact.value))
        .map((r) => ({
          ...sourceOf(r),
          currency: r.fact.currency,
          sourceToken: hash(sourceOf(r)),
        }));
      const reviews = await tx
        .select({
          id: operatingOutcomeReviews.id,
          createdAt: operatingOutcomeReviews.createdAt,
        })
        .from(operatingOutcomeReviews)
        .where(
          and(
            eq(operatingOutcomeReviews.companyId, companyId),
            eq(operatingOutcomeReviews.predictionId, id),
          ),
        )
        .orderBy(desc(operatingOutcomeReviews.createdAt))
        .limit(30);
      return {
        ...view,
        facts,
        reviews: reviews.map((r) => ({
          ...r,
          createdAt: r.createdAt.toISOString(),
        })),
      };
    },
    { isolationLevel: "repeatable read" },
  );
}
export type OperatingOutcomeView = Awaited<
  ReturnType<typeof loadOperatingOutcome>
>;
export async function loadOperatingOutcomeReview(
  companyId: string,
  id: string,
) {
  const [row] = await getDatabase()
    .select()
    .from(operatingOutcomeReviews)
    .where(
      and(
        eq(operatingOutcomeReviews.companyId, companyId),
        eq(operatingOutcomeReviews.id, id),
      ),
    );
  if (!row) throw new GoalReviewError("Outcome review not found.", 404);
  return {
    companyId,
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    snapshot: row.snapshot as Awaited<ReturnType<typeof outcomeWith>> & {
      reason: string;
    },
  };
}
export async function executeOperatingOutcome(
  companyId: string,
  raw: unknown,
  actorUserId: string | null,
  now = new Date(),
) {
  const parsed = operatingOutcomeCommand.safeParse(raw);
  if (!parsed.success)
    throw new GoalReviewError(
      "Invalid outcome request. Review the metric, period, source and confirmation.",
    );
  const command = parsed.data;
  return getDatabase().transaction(
    async (tx) => {
      await tx.execute(setCompanyScopeSql(companyId));
      await tx.execute(
        sql`select pg_advisory_xact_lock(7413,hashtext(${companyId}))`,
      );
      if (command.action === "preserve") {
        const id = await preserveOperatingPredictionWith(
          tx,
          companyId,
          command.reviewId,
          now,
        );
        if (!id)
          throw new GoalReviewError(
            "This applied scenario does not exactly match its saved operating model. Its outcomes cannot be attributed to that model.",
            422,
          );
        return { companyId, id };
      }
      const table =
        command.action !== "save_review"
          ? operatingObservations
          : operatingOutcomeReviews;
      const [prior] = await tx
        .select({ id: table.id, requestHash: table.requestHash })
        .from(table)
        .where(
          and(
            eq(table.companyId, companyId),
            eq(table.requestKey, command.requestKey),
          ),
        );
      if (prior) {
        if (prior.requestHash !== hash(command))
          throw new GoalReviewError(
            "Request key already used for a different outcome update.",
            409,
          );
        return { companyId, id: prior.id };
      }
      const prediction = await predictionWith(
        tx,
        companyId,
        command.predictionId,
      );
      let id: string;
      if (command.action === "withdraw") {
        const [current] = await tx
          .select()
          .from(operatingObservations)
          .where(
            and(
              eq(operatingObservations.companyId, companyId),
              eq(operatingObservations.predictionId, command.predictionId),
              eq(operatingObservations.id, command.observationId),
            ),
          );
        if (!current) throw new GoalReviewError("Observation not found.", 404);
        const [successor] = await tx
          .select({ id: operatingObservations.id })
          .from(operatingObservations)
          .where(
            and(
              eq(operatingObservations.companyId, companyId),
              eq(operatingObservations.supersedesId, current.id),
            ),
          );
        const definition = current.definition as OperatingObservationDefinition;
        if (successor || definition.withdrawn)
          throw new GoalReviewError(
            "This observation changed or was already withdrawn. Refresh before continuing.",
            409,
          );
        const [saved] = await tx
          .insert(operatingObservations)
          .values({
            companyId,
            predictionId: command.predictionId,
            nodeId: current.nodeId,
            month: current.month,
            supersedesId: current.id,
            definition: {
              ...definition,
              withdrawn: true,
              reason: command.reason,
            },
            requestKey: command.requestKey,
            requestHash: hash(command),
            actorUserId,
            createdAt:now,
          })
          .returning();
        id = saved!.id;
      } else if (command.action === "observe") {
        const node = prediction.snapshot.model.nodes.find(
          (n) => n.id === command.nodeId,
        );
        if (
          !node ||
          node.unit !== command.unit ||
          !prediction.snapshot.operating.months.includes(command.month) ||
          command.month < prediction.snapshot.forecastStart
        )
          throw new GoalReviewError(
            "Choose a metric, unit and period from the preserved prediction.",
            422,
          );
        if (prediction.snapshot.model.outputs.some((o) => o.nodeId === node.id))
          throw new GoalReviewError(
            "Observe cash outputs through posted entries and reconciliation.",
            422,
          );
        if (
          command.month > now.toISOString().slice(0, 7) ||
          (command.coverage === "complete" &&
            command.month >= now.toISOString().slice(0, 7))
        )
          throw new GoalReviewError(
            "Future periods cannot be observed. The current month must remain partial.",
            422,
          );
        const existing = await tx
          .select()
          .from(operatingObservations)
          .where(
            and(
              eq(operatingObservations.companyId, companyId),
              eq(operatingObservations.predictionId, command.predictionId),
              eq(operatingObservations.nodeId, node.id),
              eq(operatingObservations.month, command.month),
            ),
          );
        const replaced = new Set(
          existing.flatMap((r) => (r.supersedesId ? [r.supersedesId] : [])),
        );
        const latest = existing.find((r) => !replaced.has(r.id));
        if ((latest?.id ?? null) !== command.expectedObservationId)
          throw new GoalReviewError(
            "This observation changed. Refresh before replacing it.",
            409,
          );
        const [source] = await factsWith(tx, companyId, [command.factId], true);
        if (
          !source ||
          source.fact.status !== "approved" ||
          source.document.status !== "approved"
        )
          throw new GoalReviewError(
            "The observation source must be an approved fact and document in this company.",
            422,
          );
        if (
          !isOperatingNumber(source.fact.value) ||
          (source.fact.currency && source.fact.currency !== command.unit)
        )
          throw new GoalReviewError(
            "The source must be a plain decimal with a compatible unit. No conversion is inferred.",
            422,
          );
        if (hash(sourceOf(source)) !== command.sourceToken)
          throw new GoalReviewError(
            "The source changed. Refresh and review its current value.",
            409,
          );
        const definition: OperatingObservationDefinition = {
          value: source.fact.value.trim(),
          unit: command.unit,
          scope: command.scope,
          coverage: command.coverage,
          reason: command.reason,
          source: sourceOf(source),
        };
        const [saved] = await tx
          .insert(operatingObservations)
          .values({
            companyId,
            predictionId: command.predictionId,
            nodeId: node.id,
            month: command.month,
            supersedesId: latest?.id ?? null,
            definition,
            requestKey: command.requestKey,
            requestHash: hash(command),
            actorUserId,
            createdAt:now,
          })
          .returning();
        id = saved!.id;
      } else {
        const view = await outcomeWith(
          tx,
          companyId,
          command.predictionId,
          now,
        );
        if (view.previewToken !== command.previewToken)
          throw new GoalReviewError(
            "Observations or settlement changed. Refresh before preserving this review.",
            409,
          );
        if (Buffer.byteLength(JSON.stringify(view)) > 8_000_000)
          throw new GoalReviewError(
            "This outcome review exceeds the snapshot limit.",
            422,
          );
        const [saved] = await tx
          .insert(operatingOutcomeReviews)
          .values({
            companyId,
            predictionId: command.predictionId,
            snapshot: { ...view, reason: command.reason },
            requestKey: command.requestKey,
            requestHash: hash(command),
            actorUserId,
            createdAt:now,
          })
          .returning();
        id = saved!.id;
      }
      await recordAudit(tx, {
        companyId,
        actorUserId,
        via: "ui",
        action: `operating_outcome.${command.action}`,
        entityType: "operating_outcome",
        entityId: id,
        summary: command.reason,
        after: { predictionId: command.predictionId },
      });
      return { companyId, id };
    },
    { isolationLevel: "repeatable read" },
  );
}
