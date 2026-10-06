import "server-only";
import { assertOperatingPlanScenarioCurrent, assertNoAppliedOperatingRevision } from "./operating-plan-state";
import { createHash } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  economicItems,
  evidence,
  factRecords,
  forecastOccurrences,
  goalDecisionReviews,
  operatingConnections,
  operatingExperiments,
  operatingRevisions,
  scenarios,
} from "@finance/database";
import {
  addMonths,
  stableJson,
  type OperatingModel,
} from "@balsa/finance-engine";
import { GoalReviewError } from "./goal-reviews";
import {
  operatingBindings,
  type OperatingBinding,
} from "./operating-connections-contract";
import type { DbExecutor } from "./db-executor";
import type { OperatingPreview } from "./operating-models";
import type { GoalDecisionSnapshot } from "./goal-decisions-contract";

export const operatingHash = (value: unknown) =>
  createHash("sha256")
    .update(stableJson(JSON.parse(JSON.stringify(value))))
    .digest("hex");
export type OperatingSnapshot = {
  revision?: import("./operating-plan-contract").OperatingPlanLineage;
  model: OperatingModel;
  path: OperatingPreview["paths"][number];
  live?: {
    connectionId: string;
    basedOnAppliedId: string | null;
    sourceToken: string;
    sources: ResolvedSource[];
    forecastStart: string;
    replacedItemsToken: string;
    bindings?: OperatingBinding[];
  };
};
export type ResolvedSource = OperatingBinding & {
  value: string;
  label: string;
  evidenceId: string;
  sourceName: string;
  sourceLocation: string | null;
  updatedAt: string;
  evidenceUpdatedAt: string;
};
// Deliberately no free-text amount inference or implied unit conversion at this boundary.
export const isOperatingNumber = (value: string) =>
  /^-?\d{1,12}(?:\.\d{1,6})?$/.test(value.trim());
export async function operatingItemsToken(
  db: DbExecutor,
  companyId: string,
  ids: string[],
  lock = false,
) {
  if (!ids.length) return operatingHash([]);
  const query = db
    .select()
    .from(economicItems)
    .where(
      and(
        eq(economicItems.companyId, companyId),
        inArray(economicItems.id, ids),
      ),
    )
    .orderBy(economicItems.id);
  return operatingHash(await (lock ? query.for("share") : query));
}
export async function assertOperatingItemsUnsettled(
  db: DbExecutor,
  companyId: string,
  ids: string[],
) {
  if (!ids.length) return;
  const captured = await db
    .select({ id: forecastOccurrences.id })
    .from(forecastOccurrences)
    .where(
      and(
        eq(forecastOccurrences.companyId, companyId),
        inArray(
          sql<string>`${forecastOccurrences.definition}->>'driverId'`,
          ids,
        ),
      ),
    )
    .limit(1);
  if (captured.length)
    throw new GoalReviewError(
      "A future operating item has a reviewed collection or payment occurrence. Revise it through reconciliation before creating a new operating model; automatic replacement would risk counting it twice.",
      409,
    );
}
export async function resolveOperatingSources(
  db: DbExecutor,
  companyId: string,
  model: OperatingModel,
  rawBindings: unknown,
  lock = false,
) {
  const parsed = operatingBindings.safeParse(rawBindings);
  if (!parsed.success)
    throw new GoalReviewError("Invalid source connections.", 422);
  const bindings = parsed.data;
  if (
    new Set(bindings.map((b) => `${b.nodeId}:${b.from}`)).size !==
    bindings.length
  )
    throw new GoalReviewError(
      "Each input and effective month can have only one source.",
      422,
    );
  const ids = [...new Set(bindings.map((b) => b.factId))];
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
      and(eq(factRecords.companyId, companyId), inArray(factRecords.id, ids)),
    );
  const rows = await (lock ? query.for("share") : query);
  const sources: ResolvedSource[] = bindings.map((binding) => {
    const node = model.nodes.find((n) => n.id === binding.nodeId);
    if (!node || node.op !== "input" || node.unit !== binding.unit)
      throw new GoalReviewError(
        "Connections must target an input with the explicitly reviewed unit.",
        422,
      );
    if (
      binding.from < model.startMonth ||
      binding.from > addMonths(model.startMonth, model.months - 1)
    )
      throw new GoalReviewError(
        "A connection starts outside the operating horizon.",
        422,
      );
    const row = rows.find((r) => r.fact.id === binding.factId);
    if (!row)
      throw new GoalReviewError(
        "A connected source is unavailable in this company. Review the connection.",
        409,
      );
    if (row.fact.status !== "approved" || row.document.status !== "approved")
      throw new GoalReviewError(
        "A connected fact or document is no longer approved. Resolve its source review first.",
        409,
      );
    if (!isOperatingNumber(row.fact.value))
      throw new GoalReviewError(
        "Connected facts must contain a plain decimal number, without currency symbols or prose.",
        422,
      );
    if (row.fact.currency && row.fact.currency !== binding.unit)
      throw new GoalReviewError(
        "A connected fact's currency does not match the input unit.",
        422,
      );
    return {
      ...binding,
      value: row.fact.value.trim(),
      label: row.fact.label,
      evidenceId: row.fact.evidenceId,
      sourceName: row.document.sourceName,
      sourceLocation: row.fact.sourceLocation,
      updatedAt: row.fact.updatedAt.toISOString(),
      evidenceUpdatedAt: row.document.updatedAt.toISOString(),
    };
  });
  return { sources, sourceToken: operatingHash(sources) };
}
export async function operatingFamilyWith(
  db: DbExecutor,
  companyId: string,
  connectionId: string,
) {
  const [connection] = await db
    .select()
    .from(operatingConnections)
    .where(
      and(
        eq(operatingConnections.companyId, companyId),
        eq(operatingConnections.id, connectionId),
      ),
    );
  if (!connection) throw new GoalReviewError("Connected model not found.", 404);
  const rows = await db
    .select({
      experiment: operatingExperiments,
      active: scenarios.active,
      scenarioChanges: scenarios.changes,
    })
    .from(operatingRevisions)
    .innerJoin(
      operatingExperiments,
      and(
        eq(operatingExperiments.companyId, companyId),
        eq(operatingExperiments.id, operatingRevisions.experimentId),
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
        eq(operatingRevisions.companyId, companyId),
        eq(operatingRevisions.connectionId, connectionId),
      ),
    )
    .orderBy(desc(operatingRevisions.createdAt), desc(operatingExperiments.id));
  const root = rows.find((r) => r.experiment.id === connection.experimentId);
  if (!root)
    throw new GoalReviewError(
      "The connected model's original experiment is unavailable.",
      409,
    );
  const reviews = await db
    .select()
    .from(goalDecisionReviews)
    .where(
      and(
        eq(goalDecisionReviews.companyId, companyId),
        eq(goalDecisionReviews.kind, "applied"),
        inArray(
          goalDecisionReviews.scenarioId,
          rows.map((r) => r.experiment.scenarioId),
        ),
      ),
    )
    .orderBy(desc(goalDecisionReviews.createdAt), desc(goalDecisionReviews.id));
  const appliedReview = reviews[0];
  const applied = appliedReview
    ? rows.find((r) => r.experiment.scenarioId === appliedReview.scenarioId)!
    : null;
  return {
    connection,
    root,
    rows,
    latest: rows[0]!,
    applied,
    appliedReview: appliedReview
      ? {
          ...appliedReview,
          snapshot: appliedReview.snapshot as GoalDecisionSnapshot,
        }
      : null,
  };
}
export function selectedOperatingModel(
  snapshot: OperatingSnapshot,
): OperatingModel {
  const chosen = snapshot.model.cases.find(
    (c) => c.id === snapshot.path.caseId,
  );
  return {
    ...snapshot.model,
    cases: [],
    nodes: snapshot.model.nodes.map((node) => ({
      ...node,
      values:
        chosen?.overrides.find((o) => o.nodeId === node.id)?.values ??
        node.values,
    })),
  };
}
/** Shared by every approval path. Direct promotion cannot bypass connected-model review. */
export async function assertOperatingScenarioCurrent(
  db: DbExecutor,
  companyId: string,
  scenarioId: string,
  options: { reviewed?: boolean; lock?: boolean; forecastStart?: string; now?: Date } = {},
) {
  await assertOperatingPlanScenarioCurrent(db,companyId,scenarioId,options);
  const [entry] = await db
    .select({
      connectionId: operatingRevisions.connectionId,
      experiment: operatingExperiments,
    })
    .from(operatingRevisions)
    .innerJoin(
      operatingExperiments,
      and(
        eq(operatingExperiments.companyId, companyId),
        eq(operatingExperiments.id, operatingRevisions.experimentId),
      ),
    )
    .where(
      and(
        eq(operatingRevisions.companyId, companyId),
        eq(operatingExperiments.scenarioId, scenarioId),
      ),
    );
  if (!entry) return;
  if (!options.reviewed)
    throw new GoalReviewError(
      "Approve connected operating models through Decisions & outcomes so their applied version is preserved.",
      409,
    );
  const family = await operatingFamilyWith(db, companyId, entry.connectionId);
  const snapshot = entry.experiment.snapshot as OperatingSnapshot;
  if(family.applied) await assertNoAppliedOperatingRevision(db,companyId,family.applied.experiment.id);
  if (!snapshot.live || family.latest.experiment.id !== entry.experiment.id)
    throw new GoalReviewError(
      "This operating scenario has been superseded. Preview the connected model's latest update.",
      409,
    );
  if (
    (family.applied?.experiment.id ?? null) !== snapshot.live.basedOnAppliedId
  )
    throw new GoalReviewError(
      "Another operating version was applied. Recalculate the update before approval.",
      409,
    );
  const resolved = await resolveOperatingSources(
    db,
    companyId,
    snapshot.model,
    snapshot.live.bindings ?? family.connection.bindings,
    options.lock,
  );
  if (resolved.sourceToken !== snapshot.live.sourceToken)
    throw new GoalReviewError(
      "Connected evidence changed. Preview and save a fresh operating update before approval.",
      409,
    );
  if (
    options.forecastStart &&
    options.forecastStart !== snapshot.live.forecastStart
  )
    throw new GoalReviewError(
      "The forecast period changed. Recalculate the connected model before approval.",
      409,
    );
  if (
    operatingHash(family.latest.scenarioChanges) !==
    operatingHash(snapshot.path.changes)
  )
    throw new GoalReviewError(
      "The connected scenario was edited separately. Recalculate it from Operating models.",
      409,
    );
  const ownedIds = snapshot.path.changes.flatMap((c) =>
    c.kind === "end_item" ? [c.itemId] : [],
  );
  await assertOperatingItemsUnsettled(db, companyId, ownedIds);
  if (
    (await operatingItemsToken(db, companyId, ownedIds, options.lock)) !==
    snapshot.live.replacedItemsToken
  )
    throw new GoalReviewError(
      "An operating item changed after this update was saved. Recalculate before approval.",
      409,
    );
  const extraItems = await db
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
  if (extraItems.length)
    throw new GoalReviewError(
      "Items were added outside the connected model. Remove them before reviewing this update.",
      409,
    );
}
