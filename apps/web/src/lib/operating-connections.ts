import "server-only";
import {assertNoAppliedOperatingRevision} from "./operating-plan-state";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  decisionEffectApplications,
  economicItems,
  evidence,
  factRecords,
  getDatabase,
  operatingConnections,
  operatingExperiments,
  operatingRevisions,
  recordAudit,
  scenarios,
  setCompanyScopeSql,
} from "@finance/database";
import { addMonths, evaluateCashGoal } from "@balsa/finance-engine";
import {
  captureOutlook,
  GoalReviewError,
  goalsWith,
  previewToken,
} from "./goal-reviews";
import { operatingChanges } from "./operating-models";
import { suggestOperatingSources } from "./operating-source-suggestions";
import type { OperatingBinding } from "./operating-connections-contract";
import {
  operatingConnectionCommand,
  operatingBindings,
} from "./operating-connections-contract";
import {
  assertOperatingItemsUnsettled,
  isOperatingNumber,
  operatingFamilyWith,
  operatingHash as hash,
  operatingItemsToken,
  resolveOperatingSources,
  selectedOperatingModel,
  type OperatingSnapshot,
} from "./operating-connection-state";
import { runSimulation, type ScenarioChange } from "./scenario-changes";
import { createScenarioWith } from "./scenarios";
import { lockScenarioName } from "./scenario-name-lock";
import type { DbExecutor } from "./db-executor";

async function replacementChanges(
  db: DbExecutor,
  companyId: string,
  family: Awaited<ReturnType<typeof operatingFamilyWith>>,
  forecastStart: string,
) {
  const review = family.appliedReview?.snapshot;
  if (!review || review.type !== "applied") return [];
  // Use the immutable reviewed effects and their durable application receipts, never label matching.
  const applications = await db
    .select()
    .from(decisionEffectApplications)
    .where(
      and(
        eq(decisionEffectApplications.companyId, companyId),
        inArray(decisionEffectApplications.decisionId, review.decisionIds),
      ),
    );
  const added = applications.filter((a) => a.effectKind === "add_item");
  const expected = review.preview.scenario.changes.filter(
    (c) => c.kind === "add_driver",
  );
  if (added.length !== expected.length)
    throw new GoalReviewError(
      "Applied operating effects are incomplete. Reconcile this model before updating.",
      409,
    );
  const items = added.length
    ? await db
        .select()
        .from(economicItems)
        .where(
          and(
            eq(economicItems.companyId, companyId),
            inArray(
              economicItems.id,
              added.map((a) => String(a.result.itemId)),
            ),
          ),
        )
    : [];
  const changes: ScenarioChange[] = [];
  for (const application of added) {
    const item = items.find((i) => i.id === application.result.itemId);
    const index = review.decisionIds.indexOf(application.decisionId);
    const effect = review.preview.scenario.changes[index];
    if (
      !item ||
      effect?.kind !== "add_driver" ||
      item.status !== "confirmed" ||
      item.scenarioId ||
      item.decisionId !== application.decisionId ||
      item.amountFormula ||
      Number(item.amount) !== effect.amount ||
      item.effectiveFrom !== effect.effectiveFrom ||
      item.effectiveTo !== (effect.effectiveTo ?? null) ||
      item.direction !== effect.direction ||
      item.cadence !== "once" ||
      item.accountingTreatment !== "cash" ||
      item.category !== (effect.category ?? "other") ||
      item.label !== effect.label ||
      item.forecastTemplateId ||
      item.forecastOrigin ||
      item.recognitionStart ||
      item.recognitionEnd ||
      item.expectedDay
    )
      throw new GoalReviewError(
        "An applied operating item was changed outside this model. Reconcile that change before replacing its cash schedule.",
        409,
      );
    if (item.effectiveFrom >= forecastStart)
      changes.push({
        kind: "end_item",
        itemId: item.id,
        effectiveTo: addMonths(forecastStart, -1),
      });
  }
  return changes;
}
async function previewUpdateWith(
  db: DbExecutor,
  companyId: string,
  connectionId: string,
  now: Date,
  proposedBindings?: OperatingBinding[],
) {
  const family = await operatingFamilyWith(db, companyId, connectionId);
  if(family.applied) await assertNoAppliedOperatingRevision(db,companyId,family.applied.experiment.id);
  const original = family.root.experiment.snapshot as OperatingSnapshot;
  const definition = selectedOperatingModel(original);
  const priorBindingSnapshot = (
    family.latest.active === "Y"
      ? family.latest.experiment.snapshot
      : family.applied?.experiment.snapshot
  ) as OperatingSnapshot | undefined;
  const bindings =
    proposedBindings ??
    priorBindingSnapshot?.live?.bindings ??
    family.connection.bindings;
  const resolved = await resolveOperatingSources(
    db,
    companyId,
    definition,
    bindings,
  );
  const model = {
    ...definition,
    nodes: definition.nodes.map((node) => {
      const sources = resolved.sources.filter((s) => s.nodeId === node.id);
      return {
        ...node,
        evidenceIds: [
          ...new Set([
            ...node.evidenceIds,
            ...sources.map((s) => s.evidenceId),
          ]),
        ],
        values: [
          ...node.values.filter(
            (v) => !sources.some((s) => s.from === v.month),
          ),
          ...sources.map((s) => ({ month: s.from, value: s.value })),
        ].sort((a, b) => a.month.localeCompare(b.month)),
      };
    }),
  };
  const base = await captureOutlook(db, companyId, now);
  if (addMonths(model.startMonth, model.months - 1) < base.output.horizon.start)
    throw new GoalReviewError(
      "This model's horizon has ended. Create a new model with reviewed starting conditions.",
      422,
    );
  if (addMonths(model.startMonth, model.months - 1) > base.output.horizon.end)
    throw new GoalReviewError(
      "The operating horizon extends beyond the current forecast.",
      422,
    );
  if (
    model.outputs.some(
      (o) =>
        model.nodes.find((n) => n.id === o.nodeId)?.unit !==
        base.input.currency,
    )
  )
    throw new GoalReviewError(
      "The operating cash currency differs from the company's forecast.",
      422,
    );
  let generated;
  try {
    generated = operatingChanges(model, "base");
  } catch {
    throw new GoalReviewError(
      "Updated inputs produce an invalid operating calculation. Review the source values and model structure.",
      422,
    );
  }
  const removals = await replacementChanges(
    db,
    companyId,
    family,
    base.output.horizon.start,
  );
  await assertOperatingItemsUnsettled(
    db,
    companyId,
    removals.flatMap((c) => (c.kind === "end_item" ? [c.itemId] : [])),
  );
  const changes = [
    ...removals,
    ...generated.changes.filter(
      (c) =>
        c.kind === "add_driver" && c.effectiveFrom >= base.output.horizon.start,
    ),
  ];
  if (changes.length > 100)
    throw new GoalReviewError(
      "This replacement exceeds 100 scenario changes. Use a smaller operating horizon.",
      422,
    );
  const { run } = runSimulation(base.input, changes);
  const goals = (await goalsWith(db, companyId)).filter(
    (g) => g.status === "active",
  );
  const limitations = [
    ...base.limitations,
    ...model.limitations,
    "Connections carry approved numeric values, not proof of causality or unit equivalence. Only future cash is replaced; historical operating values may be recomputed to carry state forward. Review overlaps and obligations beyond the horizon.",
  ];
  const path = {
    caseId: "base",
    name: "Connected update",
    operating: generated.operating,
    changes,
    forecast: run,
    goals: goals.map((g) => ({
      id: g.id,
      before: evaluateCashGoal(g.definition, base.output, limitations),
      after: evaluateCashGoal(g.definition, run, limitations),
    })),
  };
  const previous = (family.applied?.experiment.snapshot ??
    original) as OperatingSnapshot;
  const previousRun = previous.path.operating;
  const assumptions = resolved.sources.map((source) => ({
    ...source,
    before:
      previousRun.values[source.nodeId]?.[
        previousRun.months.indexOf(source.from)
      ] ?? null,
  }));
  const monthlyChanges = run.months
    .filter((m) => m.basis === "forecast")
    .map((m) => {
      const before = base.output.months.find((b) => b.month === m.month)!;
      return {
        month: m.month,
        beforeMinor: before.endingCashMinor,
        afterMinor: m.endingCashMinor,
        deltaMinor: String(
          BigInt(m.endingCashMinor) - BigInt(before.endingCashMinor),
        ),
      };
    });
  const replacedItemsToken = await operatingItemsToken(
    db,
    companyId,
    removals.flatMap((c) => (c.kind === "end_item" ? [c.itemId] : [])),
  );
  const live = {
    connectionId,
    basedOnAppliedId: family.applied?.experiment.id ?? null,
    bindings: resolved.sources.map(
      ({ nodeId, factId, from, unit, reason }) => ({
        nodeId,
        factId,
        from,
        unit,
        ...(reason ? { reason } : {}),
      }),
    ),
    ...resolved,
    forecastStart: base.output.horizon.start,
    replacedItemsToken,
  };
  const token = hash({
    model,
    live,
    latestId: family.latest.experiment.id,
    base: previewToken(base),
    goals,
    changes,
  });
  return {
    family,
    base,
    preview: {
      companyId,
      connectionId,
      name: original.model.name,
      currency: base.input.currency,
      model,
      path,
      live,
      assumptions,
      monthlyChanges,
      limitations,
      previewToken: token,
      replaces: removals.length,
    },
  };
}
export type OperatingUpdatePreview = Awaited<
  ReturnType<typeof previewUpdateWith>
>["preview"];

export async function loadOperatingConnections(companyId: string) {
  return getDatabase().transaction(
    async (tx) => {
      await tx.execute(setCompanyScopeSql(companyId));
      const connections = await tx
        .select()
        .from(operatingConnections)
        .where(eq(operatingConnections.companyId, companyId))
        .orderBy(desc(operatingConnections.createdAt))
        .limit(30);
      const candidates = await tx
        .select({
          id: factRecords.id,
          label: factRecords.label,
          value: factRecords.value,
          currency: factRecords.currency,
          evidenceId: evidence.id,
          sourceName: evidence.sourceName,
        })
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
            eq(factRecords.status, "approved"),
            eq(evidence.status, "approved"),
          ),
        )
        .orderBy(desc(factRecords.updatedAt))
        .limit(500);
      const connected = [];
      for (const connection of connections) {
        const family = await operatingFamilyWith(tx, companyId, connection.id);
        const latest = family.latest.experiment.snapshot as OperatingSnapshot;
        const effectiveSnapshot =
          family.latest.active === "Y"
            ? latest
            : (family.applied?.experiment.snapshot as
                | OperatingSnapshot
                | undefined);
        const effectiveBindings = operatingBindings.parse(
          effectiveSnapshot?.live?.bindings ?? connection.bindings,
        );
        let status = "needs_review";
        let message = "Calculate the first connected version.";
        try {
          const resolved = await resolveOperatingSources(
            tx,
            companyId,
            selectedOperatingModel(
              family.root.experiment.snapshot as OperatingSnapshot,
            ),
            effectiveBindings,
          );
          if (
            family.latest.active !== "Y" &&
            family.applied?.experiment.id !== family.latest.experiment.id
          ) {
            status = "rejected";
            message =
              "The proposed scenario was closed. The approved forecast and applied source mappings are unchanged. Calculate again to review current evidence.";
          } else if (latest.live?.sourceToken === resolved.sourceToken) {
            status =
              family.applied?.experiment.id === family.latest.experiment.id
                ? "current"
                : family.latest.active === "Y"
                  ? "awaiting_approval"
                  : "rejected";
            message =
              status === "current"
                ? "Approved inputs match the latest saved version."
                : status === "awaiting_approval"
                  ? "A saved update is awaiting decision review."
                  : "The proposed scenario was closed. The approved forecast is unchanged.";
          } else {
            status = "changed";
            message =
              "Connected evidence differs from the latest saved version.";
          }
        } catch (error) {
          if (!(error instanceof GoalReviewError)) throw error;
          status = "blocked";
          message = error.message;
        }
        connected.push({
          id: connection.id,
          name: family.root.experiment.name,
          bindings: effectiveBindings,
          status,
          message,
          latestExperimentId: family.latest.experiment.id,
          scenarioId: family.latest.experiment.scenarioId,
          appliedExperimentId: family.applied?.experiment.id ?? null,
          history: family.rows.map((r) => ({
            id: r.experiment.id,
            scenarioId: r.experiment.scenarioId,
            createdAt: r.experiment.createdAt.toISOString(),
            applied: r.experiment.id === family.applied?.experiment.id,
          })),
        });
      }
      return {
        companyId,
        facts: candidates.filter((f) => isOperatingNumber(f.value)),
        connected,
      };
    },
    { isolationLevel: "repeatable read" },
  );
}
export async function executeOperatingConnection(
  companyId: string,
  raw: unknown,
  actorUserId: string,
  now = new Date(),
) {
  const parsed = operatingConnectionCommand.safeParse(raw);
  if (!parsed.success)
    throw new GoalReviewError("Invalid operating connection request.");
  const command = parsed.data;
  if (command.action === "suggest_sources")
    return suggestOperatingSources(companyId, actorUserId, command);
  return getDatabase().transaction(
    async (tx) => {
      await tx.execute(setCompanyScopeSql(companyId));
      // Shared with decision approvals so a revision cannot race its applied predecessor.
      if (command.action !== "preview_update")
        await tx.execute(
          sql`select pg_advisory_xact_lock(7407, hashtext(${companyId}))`,
        );
      if (command.action === "connect") {
        const [experiment] = await tx
          .select()
          .from(operatingExperiments)
          .where(
            and(
              eq(operatingExperiments.companyId, companyId),
              eq(operatingExperiments.id, command.experimentId),
            ),
          );
        if (!experiment)
          throw new GoalReviewError("Operating experiment not found.", 404);
        const [existing] = await tx
          .select()
          .from(operatingRevisions)
          .where(
            and(
              eq(operatingRevisions.companyId, companyId),
              eq(operatingRevisions.experimentId, command.experimentId),
            ),
          );
        if (existing) {
          const family = await operatingFamilyWith(
            tx,
            companyId,
            existing.connectionId,
          );
          if (
            family.connection.experimentId !== command.experimentId ||
            hash(family.connection.bindings) !== hash(command.bindings)
          )
            throw new GoalReviewError(
              "This experiment already belongs to a connected model. Its connections are preserved; create a new experiment to change the structure.",
              409,
            );
          return { companyId, connectionId: existing.connectionId };
        }
        const snapshot = experiment.snapshot as OperatingSnapshot;
        await resolveOperatingSources(
          tx,
          companyId,
          selectedOperatingModel(snapshot),
          command.bindings,
          true,
        );
        // Legacy direct promotions lack a reviewed applied snapshot and cannot be safely replaced.
        const promotions = await tx.execute(
          sql`select 1 from audit_log where company_id=${companyId} and entity_id=${experiment.scenarioId} and action='scenario.promoted' limit 1`,
        );
        // Applied goal reviews provide the durable ownership mapping below; unreviewed promotions are rejected.
        const { goalDecisionReviews } = await import("@finance/database");
        const applied = await tx
          .select({ id: goalDecisionReviews.id })
          .from(goalDecisionReviews)
          .where(
            and(
              eq(goalDecisionReviews.companyId, companyId),
              eq(goalDecisionReviews.scenarioId, experiment.scenarioId),
              eq(goalDecisionReviews.kind, "applied"),
            ),
          );
        if (promotions.length && !applied.length)
          throw new GoalReviewError(
            "This scenario was promoted outside a preserved decision review. Reconcile its decisions before connecting it.",
            409,
          );
        const [connection] = await tx
          .insert(operatingConnections)
          .values({
            companyId,
            experimentId: experiment.id,
            bindings: command.bindings,
            actorUserId,
          })
          .returning();
        await tx.insert(operatingRevisions).values({
          companyId,
          connectionId: connection!.id,
          experimentId: experiment.id,
        });
        await recordAudit(tx, {
          companyId,
          actorUserId,
          via: "ui",
          action: "operating_model.connected",
          entityType: "operating_connection",
          entityId: connection!.id,
          summary:
            "Connected explicitly reviewed input units and effective dates to approved source facts.",
          after: { experimentId: experiment.id, bindings: command.bindings },
        });
        return { companyId, connectionId: connection!.id };
      }
      if (command.action === "save_update") {
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
              "Request key already used for another update.",
              409,
            );
          return {
            companyId,
            saved: { id: prior.id, scenarioId: prior.scenarioId },
          };
        }
      }
      if (command.action === "reject_update") {
        const family = await operatingFamilyWith(
          tx,
          companyId,
          command.connectionId,
        );
        if (
          family.latest.experiment.id !== command.experimentId ||
          family.applied?.experiment.id === command.experimentId
        )
          throw new GoalReviewError(
            "Only the latest unapplied proposal can be rejected. Refresh the model.",
            409,
          );
        if (family.latest.active === "Y") {
          await tx
            .update(scenarios)
            .set({ active: "N", updatedAt: now })
            .where(
              and(
                eq(scenarios.companyId, companyId),
                eq(scenarios.id, family.latest.experiment.scenarioId),
              ),
            );
          await recordAudit(tx, {
            companyId,
            actorUserId,
            via: "ui",
            action: "operating_model.update_rejected",
            entityType: "operating_experiment",
            entityId: command.experimentId,
            summary: command.reason,
          });
        }
        return { companyId, rejected: command.experimentId };
      }
      const { family, base, preview } = await previewUpdateWith(
        tx,
        companyId,
        command.connectionId,
        now,
        command.bindings,
      );
      if (command.action === "preview_update") return { companyId, preview };
      if (preview.previewToken !== command.previewToken)
        throw new GoalReviewError(
          "Sources, approved version or outlook changed. Calculate the update again.",
          409,
        );
      if (
        preview.path.forecast.exceptions.length ||
        !preview.path.changes.length
      )
        throw new GoalReviewError(
          "Resolve forecast exceptions or choose an update with forecast activity.",
          422,
        );
      const id = randomUUID();
      const name = `${preview.name.slice(0, 70)} · update ${id.slice(0, 8)}`;
      await lockScenarioName(tx, companyId, name);
      const scenario = await createScenarioWith(
        tx,
        companyId,
        {
          name,
          description:
            "Connected operating update. Replaces this model's reviewed future contribution; approve through Decisions & outcomes.",
          changes: preview.path.changes,
        },
        actorUserId,
        now,
      );
      const snapshot = {
        schemaVersion: 2,
        model: preview.model,
        path: preview.path,
        base,
        live: preview.live,
        assumptions: preview.assumptions,
        goals: preview.path.goals,
        limitations: preview.limitations,
      };
      if (Buffer.byteLength(JSON.stringify(snapshot)) > 24_000_000)
        throw new GoalReviewError(
          "This operating snapshot exceeds the storage limit.",
          422,
        );
      await tx.insert(operatingExperiments).values({
        id,
        companyId,
        scenarioId: scenario.id,
        name,
        requestKey: command.requestKey,
        requestHash: hash(command),
        actorUserId,
        snapshot,
      });
      await tx.insert(operatingRevisions).values({
        companyId,
        connectionId: command.connectionId,
        experimentId: id,
      });
      // Superseded pending scenarios must not remain approvable or clutter the choice list.
      const pendingIds = family.rows
        .filter((r) => r.active === "Y")
        .map((r) => r.experiment.scenarioId);
      if (pendingIds.length)
        await tx
          .update(scenarios)
          .set({ active: "N", updatedAt: now })
          .where(
            and(
              eq(scenarios.companyId, companyId),
              inArray(scenarios.id, pendingIds),
            ),
          );
      await recordAudit(tx, {
        companyId,
        actorUserId,
        via: "ui",
        action: "operating_model.update_proposed",
        entityType: "operating_experiment",
        entityId: id,
        summary:
          "Preserved a source-driven operating revision for approval; no base forecast changes applied.",
        after: {
          connectionId: command.connectionId,
          scenarioId: scenario.id,
          replacedExperimentId: preview.live.basedOnAppliedId,
          supersededScenarioIds: pendingIds,
          sourceToken: preview.live.sourceToken,
        },
      });
      return { companyId, saved: { id, scenarioId: scenario.id } };
    },
    { isolationLevel: "repeatable read" },
  );
}
