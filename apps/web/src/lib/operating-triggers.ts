import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  getDatabase,
  operatingPredictions,
  operatingTriggerRules as rules,
  operatingTriggerEvaluations as evaluations,
  operatingTriggerEvents as events,
  recordAudit,
  setCompanyScopeSql,
} from "@finance/database";
import {
  evaluateOperatingTrigger,
  type OperatingTriggerRule,
} from "@balsa/finance-engine";
import { GoalReviewError } from "./goal-reviews";
import { operatingHash as hash } from "./operating-connection-state";
import { operatingObservationStateWith } from "./operating-outcomes";
import {
  operatingTriggerCommand,
  type TriggerSnapshot,
  type TriggerReviewStatus,
} from "./operating-triggers-contract";
import type { OperatingPredictionSnapshot } from "./operating-outcomes-contract";
import type { DbExecutor } from "./db-executor";

async function predictionWith(
  db: DbExecutor,
  companyId: string,
  predictionId: string,
) {
  const [row] = await db
    .select()
    .from(operatingPredictions)
    .where(
      and(
        eq(operatingPredictions.companyId, companyId),
        eq(operatingPredictions.id, predictionId),
      ),
    );
  if (!row) throw new GoalReviewError("Operating prediction not found.", 404);
  return row.snapshot as OperatingPredictionSnapshot;
}
async function rulesWith(
  db: DbExecutor,
  companyId: string,
  predictionId: string,
) {
  const rows = await db
    .select()
    .from(rules)
    .where(
      and(eq(rules.companyId, companyId), eq(rules.predictionId, predictionId)),
    )
    .orderBy(desc(rules.createdAt), desc(rules.id))
    .limit(101);
  if (rows.length > 100)
    throw new GoalReviewError(
      "This prediction exceeds the rule version limit.",
      422,
    );
  return rows;
}
async function latestWith(db: DbExecutor, companyId: string, ruleId: string) {
  const [row] = await db
    .select()
    .from(evaluations)
    .where(
      and(eq(evaluations.companyId, companyId), eq(evaluations.ruleId, ruleId)),
    )
    .orderBy(desc(evaluations.sequence))
    .limit(1);
  return row;
}
async function reviewWith(
  db: DbExecutor,
  companyId: string,
  reviewId: string,
  today: string,
) {
  const [review] = await db
    .select()
    .from(evaluations)
    .where(
      and(eq(evaluations.companyId, companyId), eq(evaluations.id, reviewId)),
    );
  if (!review || review.reviewId !== review.id)
    throw new GoalReviewError("Trigger review not found.", 404);
  const history = await db
    .select()
    .from(events)
    .where(and(eq(events.companyId, companyId), eq(events.reviewId, reviewId)))
    .orderBy(events.createdAt, events.id)
    .limit(1001);
  if (history.length > 1000)
    throw new GoalReviewError("This review exceeds its event limit.", 422);
  const ordered: typeof history = [];
  let event = history.find((e) => e.supersedesId === null);
  while (event && ordered.length < history.length) {
    ordered.push(event);
    const id = event.id;
    event = history.find((e) => e.supersedesId === id);
  }
  const current = ordered.at(-1);
  if (!current || ordered.length !== history.length)
    throw new GoalReviewError("Trigger review history is unavailable.", 422);
  // Preserve the snooze receipt. Its effective display state expires only when the queue is refreshed.
  const effectiveStatus: TriggerReviewStatus =
    current.status === "snoozed" && current.snoozeUntil! <= today
      ? "open"
      : (current.status as TriggerReviewStatus);
  return {
    id: reviewId,
    snapshot: review.snapshot as TriggerSnapshot,
    current,
    effectiveStatus,
    history: ordered,
  };
}
async function appendEvent(
  db: DbExecutor,
  companyId: string,
  actorUserId: string | null,
  values: {
    reviewId: string;
    evaluationId: string;
    supersedesId: string | null;
    status: TriggerReviewStatus;
    snoozeUntil?: string | null;
    reason: string;
    requestKey: string;
    requestHash: string;
  },
  now: Date,
) {
  const [row] = await db
    .insert(events)
    .values({ companyId, actorUserId, ...values, createdAt: now })
    .returning();
  await recordAudit(db, {
    companyId,
    actorUserId,
    via: "ui",
    action: `operating_trigger.${values.status}`,
    entityType: "operating_trigger_review",
    entityId: values.reviewId,
    summary: values.reason,
    after: { eventId: row!.id, evaluationId: values.evaluationId },
  });
  return row!;
}
async function supersede(
  db: DbExecutor,
  companyId: string,
  actorUserId: string | null,
  reviewId: string | null,
  evaluationId: string,
  reason: string,
  now: Date,
) {
  if (!reviewId) return;
  const review = await reviewWith(
    db,
    companyId,
    reviewId,
    now.toISOString().slice(0, 10),
  );
  if (["resolved", "superseded"].includes(review.current.status)) return;
  await appendEvent(
    db,
    companyId,
    actorUserId,
    {
      reviewId,
      evaluationId,
      supersedesId: review.current.id,
      status: "superseded",
      reason,
      requestKey: randomUUID(),
      requestHash: hash({ evaluationId, reason }),
    },
    now,
  );
}
export async function loadOperatingTriggers(
  companyId: string,
  predictionId: string,
  now = new Date(),
) {
  return getDatabase().transaction(
    async (tx) => {
      await tx.execute(setCompanyScopeSql(companyId));
      await predictionWith(tx, companyId, predictionId);
      const versions = await rulesWith(tx, companyId, predictionId);
      const replaced = new Set(versions.map((r) => r.supersedesId));
      const rows = [];
      for (const row of versions) {
        const recent = await tx
          .select()
          .from(evaluations)
          .where(
            and(
              eq(evaluations.companyId, companyId),
              eq(evaluations.ruleId, row.id),
            ),
          )
          .orderBy(desc(evaluations.sequence))
          .limit(20);
        const latest = recent[0];
        rows.push({
          id: row.id,
          name: row.name,
          rule: row.definition as OperatingTriggerRule,
          reason: row.reason,
          supersedesId: row.supersedesId,
          active: !replaced.has(row.id),
          createdAt: row.createdAt.toISOString(),
          latest: latest
            ? { id: latest.id, snapshot: latest.snapshot as TriggerSnapshot }
            : null,
          review: latest?.reviewId
            ? await reviewWith(
                tx,
                companyId,
                latest.reviewId,
                now.toISOString().slice(0, 10),
              )
            : null,
          evaluations: recent.map((e) => ({
            id: e.id,
            reviewId: e.reviewId,
            snapshot: e.snapshot as TriggerSnapshot,
          })),
        });
      }
      return { companyId, predictionId, asOf: now.toISOString(), rules: rows };
    },
    { isolationLevel: "repeatable read" },
  );
}
export async function loadOperatingTriggerReview(
  companyId: string,
  predictionId: string,
  reviewId: string,
  now = new Date(),
) {
  return getDatabase().transaction(
    async (tx) => {
      await tx.execute(setCompanyScopeSql(companyId));
      await predictionWith(tx, companyId, predictionId);
      const review = await reviewWith(
        tx,
        companyId,
        reviewId,
        now.toISOString().slice(0, 10),
      );
      if (review.snapshot.predictionId !== predictionId)
        throw new GoalReviewError("Trigger review not found.", 404);
      return { companyId, predictionId, review };
    },
    { isolationLevel: "repeatable read" },
  );
}
export type OperatingTriggerWorkspace = Awaited<
  ReturnType<typeof loadOperatingTriggers>
>;
export async function executeOperatingTrigger(
  companyId: string,
  raw: unknown,
  actorUserId: string | null,
  now = new Date(),
) {
  const parsed = operatingTriggerCommand.safeParse(raw);
  if (!parsed.success)
    throw new GoalReviewError(
      "Invalid review rule request. Check the condition, dates and confirmation.",
    );
  const command = parsed.data;
  return getDatabase().transaction(
    async (tx) => {
      await tx.execute(setCompanyScopeSql(companyId));
      await tx.execute(
        sql`select pg_advisory_xact_lock(7414,hashtext(${companyId}))`,
      );
      const table =
        command.action === "create"
          ? rules
          : command.action === "evaluate"
            ? evaluations
            : events;
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
            "Request key already used for a different trigger action.",
            409,
          );
        return { companyId, id: prior.id };
      }
      const prediction = await predictionWith(
        tx,
        companyId,
        command.predictionId,
      );
      const versions = await rulesWith(tx, companyId, command.predictionId);
      const replaced = new Set(versions.map((r) => r.supersedesId));
      let id: string;
      if (command.action === "create") {
        if (
          versions.length >= 100 ||
          (!command.replacesId &&
            versions.filter((r) => !replaced.has(r.id)).length >= 20)
        )
          throw new GoalReviewError(
            "Use at most 20 current rules and 100 rule versions per prediction.",
            422,
          );
        const rule = command.rule;
        if (rule.kind === "threshold") {
          const node = prediction.model.nodes.find((n) => n.id === rule.nodeId);
          if (
            !node ||
            node.unit !== rule.unit ||
            prediction.model.outputs.some((o) => o.nodeId === rule.nodeId)
          )
            throw new GoalReviewError(
              "Choose a non-cash metric and its preserved unit. Cash remains in reconciliation.",
              422,
            );
        }
        if (
          command.replacesId &&
          (!versions.some((r) => r.id === command.replacesId) ||
            replaced.has(command.replacesId))
        )
          throw new GoalReviewError(
            "The rule changed. Refresh before replacing it.",
            409,
          );
        const [saved] = await tx
          .insert(rules)
          .values({
            companyId,
            predictionId: command.predictionId,
            name: command.name,
            definition: rule,
            supersedesId: command.replacesId,
            reason: command.reason,
            requestKey: command.requestKey,
            requestHash: hash(command),
            actorUserId,
            createdAt: now,
          })
          .returning();
        id = saved!.id;
        if (command.replacesId) {
          const latest = await latestWith(tx, companyId, command.replacesId);
          if (latest)
            await supersede(
              tx,
              companyId,
              actorUserId,
              latest.reviewId,
              latest.id,
              `Rule replaced by version ${id}. ${command.reason}`,
              now,
            );
        }
      } else if (command.action === "evaluate") {
        const ruleRow = versions.find((r) => r.id === command.ruleId);
        if (!ruleRow) throw new GoalReviewError("Review rule not found.", 404);
        if (replaced.has(ruleRow.id))
          throw new GoalReviewError(
            "This rule was replaced. Evaluate its current version.",
            409,
          );
        const rule = ruleRow.definition as OperatingTriggerRule;
        const state =
          rule.kind === "threshold"
            ? await operatingObservationStateWith(
                tx,
                companyId,
                command.predictionId,
              )
            : null;
        const metric = state?.rows.find(
          (r) => rule.kind === "threshold" && r.nodeId === rule.nodeId,
        );
        const result = evaluateOperatingTrigger(
          rule,
          metric?.months.map((m) => ({
            month: m.month,
            observationId: m.observationId,
            predicted: m.predicted,
            observed: m.observed,
            coverage: m.coverage,
            unit: metric.unit,
            scope: m.definition?.scope ?? null,
          })) ?? [],
          now.toISOString().slice(0, 10),
        );
        const snapshot: TriggerSnapshot = {
          rule,
          name: ruleRow.name,
          ruleId: ruleRow.id,
          predictionId: command.predictionId,
          evaluatedAt: now.toISOString(),
          result,
          evidence:
            metric?.months.flatMap((m) =>
              m.observationId && m.definition && result.window.includes(m.month)
                ? [
                    {
                      observationId: m.observationId,
                      month: m.month,
                      definition: m.definition,
                    },
                  ]
                : [],
            ) ?? [],
        };
        const fingerprint = hash({ rule, result, evidence: snapshot.evidence });
        const latest = await latestWith(tx, companyId, ruleRow.id);
        id = randomUUID();
        const startsReview =
          result.status === "triggered" &&
          (!latest ||
            (latest.snapshot as TriggerSnapshot).result.status !== "triggered");
        const reviewId = startsReview ? id : (latest?.reviewId ?? null);
        await tx.insert(evaluations).values({
          id,
          companyId,
          ruleId: ruleRow.id,
          sequence: (latest?.sequence ?? 0) + 1,
          fingerprint,
          snapshot,
          reviewId,
          requestKey: command.requestKey,
          requestHash: hash(command),
          actorUserId,
          createdAt: now,
        });
        if (startsReview)
          await appendEvent(
            tx,
            companyId,
            actorUserId,
            {
              reviewId: id,
              evaluationId: id,
              supersedesId: null,
              status: "open",
              reason: result.reason,
              requestKey: randomUUID(),
              requestHash: fingerprint,
            },
            now,
          );
        else if (result.status !== "triggered")
          await supersede(
            tx,
            companyId,
            actorUserId,
            reviewId,
            id,
            `${result.reason} Earlier trigger evidence no longer supports an active review.`,
            now,
          );
      } else {
        const review = await reviewWith(
          tx,
          companyId,
          command.reviewId,
          now.toISOString().slice(0, 10),
        );
        if (review.snapshot.predictionId !== command.predictionId)
          throw new GoalReviewError("Trigger review not found.", 404);
        if (
          review.current.id !== command.expectedEventId ||
          ["resolved", "superseded"].includes(review.current.status)
        )
          throw new GoalReviewError(
            "This review changed or is closed. Refresh before continuing.",
            409,
          );
        if (
          command.status === "snoozed"
            ? !command.snoozeUntil ||
              command.snoozeUntil <= now.toISOString().slice(0, 10) ||
              Date.parse(command.snoozeUntil) -
                Date.parse(now.toISOString().slice(0, 10)) >
                90 * 86400000
            : command.snoozeUntil !== null
        )
          throw new GoalReviewError(
            "Choose a future snooze date within 90 days, only for a snooze action.",
            422,
          );
        const latest = await latestWith(tx, companyId, review.snapshot.ruleId);
        if (
          !latest ||
          latest.reviewId !== review.id ||
          replaced.has(review.snapshot.ruleId)
        )
          throw new GoalReviewError(
            "This trigger review is no longer current.",
            409,
          );
        const saved = await appendEvent(
          tx,
          companyId,
          actorUserId,
          {
            reviewId: review.id,
            evaluationId: latest.id,
            supersedesId: review.current.id,
            status: command.status,
            snoozeUntil: command.snoozeUntil,
            reason: command.reason,
            requestKey: command.requestKey,
            requestHash: hash(command),
          },
          now,
        );
        return { companyId, id: saved.id };
      }
      await recordAudit(tx, {
        companyId,
        actorUserId,
        via: "ui",
        action: `operating_trigger.${command.action}`,
        entityType: "operating_trigger",
        entityId: id,
        summary:
          command.action === "create"
            ? command.reason
            : "Evaluated the reviewed rule against current evidence; no forecast changed.",
        after: { predictionId: command.predictionId },
      });
      return { companyId, id };
    },
    { isolationLevel: "repeatable read" },
  );
}

/** A proposal must still be supported by the same open review and current evidence. */
export async function operatingTriggerContextWith(
  db: DbExecutor,
  companyId: string,
  reviewId: string,
  now: Date,
  lock = false,
) {
  const review = await reviewWith(
    db,
    companyId,
    reviewId,
    now.toISOString().slice(0, 10),
  );
  if (!["open", "acknowledged"].includes(review.effectiveStatus))
    throw new GoalReviewError(
      "Open or acknowledge this review before proposing a revision.",
      409,
    );
  const versions = await rulesWith(db, companyId, review.snapshot.predictionId);
  if (versions.some((r) => r.supersedesId === review.snapshot.ruleId))
    throw new GoalReviewError(
      "The trigger rule was replaced. Evaluate the current version.",
      409,
    );
  const latest = await latestWith(db, companyId, review.snapshot.ruleId);
  if (
    !latest ||
    latest.reviewId !== reviewId ||
    (latest.snapshot as TriggerSnapshot).result.status !== "triggered"
  )
    throw new GoalReviewError(
      "This review is no longer supported by its latest evaluation.",
      409,
    );
  const state = await operatingObservationStateWith(
    db,
    companyId,
    review.snapshot.predictionId,
    lock,
  );
  const rule = review.snapshot.rule;
  const metric = state.rows.find(
    (r) => rule.kind === "threshold" && r.nodeId === rule.nodeId,
  );
  const result = evaluateOperatingTrigger(
    rule,
    metric?.months.map((m) => ({
      month: m.month,
      observationId: m.observationId,
      predicted: m.predicted,
      observed: m.observed,
      coverage: m.coverage,
      unit: metric.unit,
      scope: m.definition?.scope ?? null,
    })) ?? [],
    now.toISOString().slice(0, 10),
  );
  const evidence =
    metric?.months.flatMap((m) =>
      m.observationId && m.definition && result.window.includes(m.month)
        ? [
            {
              observationId: m.observationId,
              month: m.month,
              definition: m.definition,
            },
          ]
        : [],
    ) ?? [];
  const fingerprint = hash({ rule, result, evidence });
  if (result.status !== "triggered" || fingerprint !== latest.fingerprint)
    throw new GoalReviewError(
      "Trigger evidence changed. Evaluate the rule again before proposing or approving a revision.",
      409,
    );
  return {
    review,
    state,
    token: hash({ reviewId, eventId: review.current.id, fingerprint }),
  };
}
