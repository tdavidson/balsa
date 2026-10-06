import "server-only";
import { and, desc, eq, sql, inArray } from "drizzle-orm";
import {
  getDatabase,
  operatingPredictions,
  operatingTriggerEvaluations,
  operatingExperiments,
  operatingPlanRevisions,
  goalDecisionReviews,
  scenarios,
  recordAudit,
  setCompanyScopeSql,
} from "@finance/database";
import {
  addMonths,
  evaluateOperatingModel,
  planOperatingReplacement,
  reviseOperatingInputs,
  type OperatingPlanInput,
} from "@balsa/finance-engine";
import {
  operatingPlanCommand,
  type OperatingPlanLineage,
} from "./operating-plan-contract";
import { operatingPlanStateWith } from "./operating-plan-state";
import { operatingHash as hash } from "./operating-connection-state";
import { captureOutlook, GoalReviewError, previewToken } from "./goal-reviews";
import { runSimulation, type ScenarioChange } from "./scenario-changes";
import { createScenarioWith } from "./scenarios";
import { lockScenarioName } from "./scenario-name-lock";
import type { OperatingPredictionSnapshot } from "./operating-outcomes-contract";
import type { TriggerSnapshot } from "./operating-triggers-contract";
import type { DbExecutor } from "./db-executor";
async function previewWith(
  db: DbExecutor,
  companyId: string,
  reviewId: string,
  inputs: OperatingPlanInput[],
  now: Date,
) {
  const state = await operatingPlanStateWith(db, companyId, reviewId, now);
  const original = state.state.prediction.snapshot;
  const base = await captureOutlook(db, companyId, now);
  const forecastStart = base.output.horizon.start;
  if (
    addMonths(original.model.startMonth, original.model.months - 1) >
    base.output.horizon.end
  )
    throw new GoalReviewError(
      "The model horizon exceeds the current forecast.",
      422,
    );
  let revised, replacement;
  try {
    if (
      hash(
        evaluateOperatingModel(original.model, original.operating.caseId),
      ) !== hash(original.operating)
    )
      throw new Error(
        "The original calculation cannot be reproduced by this formula version.",
      );
    revised = reviseOperatingInputs(
      original.model,
      original.operating.caseId,
      inputs,
      forecastStart,
    );
    replacement = planOperatingReplacement(
      original.operating,
      revised.operating,
      original.cashBindings,
      state.occurrences.flatMap((o) => (o.driverId ? [o.driverId] : [])),
      forecastStart,
    );
  } catch (error) {
    throw new GoalReviewError(
      error instanceof Error
        ? error.message.slice(0, 500)
        : "The proposed input changes could not be calculated.",
      422,
    );
  }
  const changes: ScenarioChange[] = [
    ...replacement.ended.map((b) => ({
      kind: "end_item" as const,
      itemId: b.driverId,
      effectiveTo: addMonths(forecastStart, -1),
    })),
    ...replacement.additions.map((c) => ({
      kind: "add_driver" as const,
      label: c.label,
      direction: c.direction,
      amount: Number(c.amountMinor) / 100,
      cadence: "once" as const,
      effectiveFrom: c.month,
      category: c.category,
    })),
  ];
  if (changes.length > 100)
    throw new GoalReviewError(
      "This revision exceeds 100 financial changes. Use a smaller horizon.",
      422,
    );
  const { run } = runSimulation(base.input, changes);
  const lineage: OperatingPlanLineage = {
    predictionId: state.state.prediction.id,
    reviewId,
    contextToken: state.token,
    itemsToken: state.itemsToken,
    settlementToken: state.settlementToken,
    documentsToken: state.documentsToken,
    forecastStart,
    retainedBindings: replacement.retained,
  };
  const commitments = state.occurrences.map((o) => ({
    id: o.id,
    driverId: o.driverId,
    label: o.label,
    originalMonth: o.originalMonth,
    expectedDate: o.expectedDate,
    amountMinor: o.amountMinor,
    version: o.version,
    status: o.status,
    ...base.output.settlements?.find((s) => s.id === o.id),
  }));
  const path = {
    caseId: "base",
    name: "Reviewed revision",
    operating: revised.operating,
    changes,
    forecast: run,
    goals: [],
  };
  const token = hash({
    lineage,
    inputs,
    base: previewToken(base),
    model: revised.model,
  });
  return {
    companyId,
    reviewId,
    predictionId: lineage.predictionId,
    currency: base.input.currency,
    previewToken: token,
    model: revised.model,
    inputs,
    base,
    path,
    lineage,
    replacement,
    commitments,
    trigger: state.review.snapshot,
    monthlyChanges: run.months.map((m) => {
      const before = base.output.months.find((b) => b.month === m.month)!;
      return {
        month: m.month,
        basis: m.basis,
        beforeMinor: before.endingCashMinor,
        afterMinor: m.endingCashMinor,
        deltaMinor: (
          BigInt(m.endingCashMinor) - BigInt(before.endingCashMinor)
        ).toString(),
      };
    }),
    limitations: [
      ...base.limitations,
      ...revised.model.limitations,
      "Only reviewed future input assumptions change. Existing captured obligations, paid amounts, allocations, and historical actuals remain under their original identities. Changed assumptions are proposals, not approved source facts.",
    ],
  };
}
export type OperatingPlanPreview = Awaited<ReturnType<typeof previewWith>>;
export async function loadOperatingPlanWorkspace(
  companyId: string,
  reviewId: string,
  now = new Date(),
) {
  return getDatabase().transaction(
    async (tx) => {
      await tx.execute(setCompanyScopeSql(companyId));
      const [review] = await tx
        .select()
        .from(operatingTriggerEvaluations)
        .where(
          and(
            eq(operatingTriggerEvaluations.companyId, companyId),
            eq(operatingTriggerEvaluations.id, reviewId),
          ),
        );
      if (!review || review.reviewId !== review.id)
        throw new GoalReviewError("Trigger review not found.", 404);
      const trigger = review.snapshot as TriggerSnapshot;
      const [prediction] = await tx
        .select()
        .from(operatingPredictions)
        .where(
          and(
            eq(operatingPredictions.companyId, companyId),
            eq(operatingPredictions.id, trigger.predictionId),
          ),
        );
      if (!prediction)
        throw new GoalReviewError("Operating prediction not found.", 404);
      const snapshot = prediction.snapshot as OperatingPredictionSnapshot;
      let blockedReason: string | null = null;
      try {
        await operatingPlanStateWith(tx, companyId, reviewId, now);
      } catch (error) {
        if (error instanceof GoalReviewError && error.status === 409)
          blockedReason = error.message;
        else throw error;
      }

      const rows = await tx
        .select({
          id: operatingExperiments.id,
          name: operatingExperiments.name,
          scenarioId: operatingExperiments.scenarioId,
          snapshot: operatingExperiments.snapshot,
          active: scenarios.active,
        })
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
            eq(operatingPlanRevisions.triggerReviewId, reviewId),
          ),
        )
        .orderBy(desc(operatingPlanRevisions.createdAt))
        .limit(20);
      const approvals = rows.length
        ? await tx
            .select({ scenarioId: goalDecisionReviews.scenarioId })
            .from(goalDecisionReviews)
            .where(
              and(
                eq(goalDecisionReviews.companyId, companyId),
                eq(goalDecisionReviews.kind, "applied"),
                inArray(
                  goalDecisionReviews.scenarioId,
                  rows.map((r) => r.scenarioId),
                ),
              ),
            )
        : [];
      return {
        companyId,
        reviewId,
        predictionId: prediction.id,
        model: snapshot.model,
        operating: snapshot.operating,
        forecastStart: now.toISOString().slice(0, 7),
        blockedReason,
        proposals: rows.map((r) => ({
          ...r,
          status: approvals.some((a) => a.scenarioId === r.scenarioId)
            ? ("approved" as const)
            : r.active === "Y"
              ? ("awaiting_approval" as const)
              : ("closed" as const),
          snapshot: r.snapshot as {
            proposal: OperatingPlanPreview;
            reason: string;
          },
        })),
      };
    },
    { isolationLevel: "repeatable read" },
  );
}
export type OperatingPlanWorkspace = Awaited<
  ReturnType<typeof loadOperatingPlanWorkspace>
>;
export async function executeOperatingPlan(
  companyId: string,
  raw: unknown,
  actorUserId: string | null,
  now = new Date(),
) {
  const parsed = operatingPlanCommand.safeParse(raw);
  if (!parsed.success)
    throw new GoalReviewError(
      "Invalid plan revision. Review the input dates, values, reasons and confirmation.",
    );
  const command = parsed.data;
  return getDatabase().transaction(
    async (tx) => {
      await tx.execute(setCompanyScopeSql(companyId));
      if (command.action !== "preview") {
        await tx.execute(
          sql`select pg_advisory_xact_lock(7407,hashtext(${companyId}))`,
        );
        await tx.execute(
          sql`select pg_advisory_xact_lock(7413,hashtext(${companyId}))`,
        );
        await tx.execute(
          sql`select pg_advisory_xact_lock(7414,hashtext(${companyId}))`,
        );
      }
      if (command.action === "reject") {
        const [row] = await tx
          .select({ scenarioId: operatingExperiments.scenarioId })
          .from(operatingPlanRevisions)
          .innerJoin(
            operatingExperiments,
            and(
              eq(operatingExperiments.companyId, companyId),
              eq(operatingExperiments.id, operatingPlanRevisions.experimentId),
            ),
          )
          .where(
            and(
              eq(operatingPlanRevisions.companyId, companyId),
              eq(operatingPlanRevisions.experimentId, command.experimentId),
            ),
          );
        if (!row) throw new GoalReviewError("Plan revision not found.", 404);
        const [applied] = await tx
          .select({ id: goalDecisionReviews.id })
          .from(goalDecisionReviews)
          .where(
            and(
              eq(goalDecisionReviews.companyId, companyId),
              eq(goalDecisionReviews.scenarioId, row.scenarioId),
              eq(goalDecisionReviews.kind, "applied"),
            ),
          )
          .limit(1);
        if (applied)
          throw new GoalReviewError(
            "An approved revision cannot be rejected retroactively.",
            409,
          );
        const changed = await tx
          .update(scenarios)
          .set({ active: "N", updatedAt: now })
          .where(
            and(
              eq(scenarios.companyId, companyId),
              eq(scenarios.id, row.scenarioId),
              eq(scenarios.active, "Y"),
            ),
          )
          .returning({ id: scenarios.id });
        if (changed.length)
          await recordAudit(tx, {
            companyId,
            actorUserId,
            via: "ui",
            action: "operating_plan.rejected",
            entityType: "operating_experiment",
            entityId: command.experimentId,
            summary: command.reason,
            after: { scenarioId: row.scenarioId },
          });
        return { companyId, id: command.experimentId };
      }
      if (command.action === "save") {
        const [prior] = await tx
          .select()
          .from(operatingExperiments)
          .where(
            and(
              eq(operatingExperiments.companyId, companyId),
              eq(operatingExperiments.requestKey, command.requestKey),
            ),
          );
        if (prior) {
          if (prior.requestHash !== hash(command))
            throw new GoalReviewError(
              "Request key already used for a different proposal.",
              409,
            );
          return {
            companyId,
            saved: {
              id: prior.id,
              scenarioId: prior.scenarioId,
              name: prior.name,
            },
          };
        }
      }
      const preview = await previewWith(
        tx,
        companyId,
        command.reviewId,
        command.inputs,
        now,
      );
      if (command.action === "preview") return { companyId, preview };
      if (preview.previewToken !== command.previewToken)
        throw new GoalReviewError(
          "The review, inputs, settlement or forecast changed. Preview again before saving.",
          409,
        );
      if (
        !preview.path.changes.length ||
        preview.path.forecast.exceptions.length
      )
        throw new GoalReviewError(
          "Choose a revision with future cash changes and resolve calculation exceptions before saving.",
          422,
        );
      if (Buffer.byteLength(JSON.stringify(preview)) > 8_000_000)
        throw new GoalReviewError(
          "This proposal exceeds its snapshot limit.",
          422,
        );
      await lockScenarioName(tx, companyId, command.name);
      const scenario = await createScenarioWith(
        tx,
        companyId,
        {
          name: command.name,
          description:
            "Review-linked operating revision. Replaces only owned uncommitted future cash; preserves captured obligations. Requires Decisions & outcomes approval.",
          changes: preview.path.changes,
        },
        actorUserId,
        now,
      );
      const [saved] = await tx
        .insert(operatingExperiments)
        .values({
          companyId,
          scenarioId: scenario.id,
          name: command.name,
          requestKey: command.requestKey,
          requestHash: hash(command),
          actorUserId,
          snapshot: {
            schemaVersion: 1,
            model: preview.model,
            path: preview.path,
            base: preview.base,
            revision: preview.lineage,
            proposal: preview,
            reason: command.reason,
          },
        })
        .returning();
      await tx.insert(operatingPlanRevisions).values({
        companyId,
        experimentId: saved!.id,
        predictionId: preview.predictionId,
        triggerReviewId: command.reviewId,
        createdAt: now,
      });
      await recordAudit(tx, {
        companyId,
        actorUserId,
        via: "ui",
        action: "operating_plan.proposed",
        entityType: "operating_experiment",
        entityId: saved!.id,
        summary: command.reason,
        after: {
          reviewId: command.reviewId,
          predictionId: preview.predictionId,
          scenarioId: scenario.id,
          formulaVersion: preview.replacement.formulaVersion,
        },
      });
      return {
        companyId,
        saved: { id: saved!.id, scenarioId: scenario.id, name: command.name },
      };
    },
    { isolationLevel: "repeatable read" },
  );
}
