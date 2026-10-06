import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { OperatingModel } from "@balsa/finance-engine";
import type { OperatingPreview } from "./operating-models";
import type { GoalDecisionPreview } from "./goal-decisions-contract";
config({
  path: fileURLToPath(new URL("../../../../.env.local", import.meta.url)),
  quiet: true,
});
config({
  path: fileURLToPath(new URL("../../../../.env", import.meta.url)),
  quiet: true,
});
if (process.env.TEST_DATABASE_URL)
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const now = new Date("2026-10-05T12:00:00Z");
const later = new Date("2026-11-30T12:00:00Z");
const model: OperatingModel = {
  name: "Synthetic delivery and collections",
  description: "One operating contract, two observation types",
  startMonth: "2026-10",
  months: 3,
  nodes: [
    {
      id: "receipts",
      label: "Project receipts",
      unit: "USD",
      op: "input",
      args: [],
      values: [
        { month: "2026-10", value: "20000" },
        { month: "2026-11", value: "0" },
      ],
      initial: null,
      rationale: "Synthetic",
      evidenceIds: [],
    },
    {
      id: "capacity",
      label: "Available delivery capacity",
      unit: "hours",
      op: "input",
      args: [],
      values: [{ month: "2026-10", value: "100" }],
      initial: null,
      rationale: "Synthetic",
      evidenceIds: [],
    },
    {
      id: "delivered",
      label: "Completed work",
      unit: "hours",
      op: "input",
      args: [],
      values: [{ month: "2026-10", value: "90" }],
      initial: null,
      rationale: "Synthetic",
      evidenceIds: [],
    },
  ],
  outputs: [
    {
      nodeId: "receipts",
      label: "Project receipts",
      direction: "receipt",
      category: "other",
    },
  ],
  cases: [],
  limitations: ["Synthetic only"],
};
describe.skipIf(!process.env.DATABASE_URL)(
  "operating predictions and observations",
  async () => {
    if (!process.env.DATABASE_URL) return;
    const {
      getDatabase,
      closeDatabase,
      companies,
      users,
      chartAccounts,
      policies,
      forecastEntryTemplates,
      evidence,
      factRecords,
      operatingPredictions,
      operatingObservations,
      operatingOutcomeReviews,
      scenarios,
    } = await import("@finance/database");
    const { executeOperatingCommand: operate } = await import(
      "./operating-models"
    );
    const { executeGoalReviewCommand: goals, loadGoalReview } = await import(
      "./goal-reviews"
    );
    const { executeGoalDecision: decide } = await import("./goal-decisions");
    const {
      executeOperatingOutcome: execute,
      loadOperatingOutcome: load,
      loadOperatingOutcomeWorkspace: workspace,
      loadOperatingOutcomeReview: review,
    } = await import("./operating-outcomes");
    const { postApprovedJournal: post } = await import("./journal-posting");
    const {
      loadForecastReconciliation,
      executeForecastReconciliation: reconcile,
    } = await import("./forecast-reconciliation");
    const db = getDatabase();
    const ids: string[] = [];
    let actor = "";
    afterAll(async () => {
      if (ids.length)
        await db.delete(companies).where(inArray(companies.id, ids));
      if (actor) await db.delete(users).where(eq(users.id, actor));
      await closeDatabase();
    });
    async function seed(modelDefinition: OperatingModel = model) {
      if (!actor) {
        const [u] = await db
          .insert(users)
          .values({
            authProvider: "test",
            authProviderUserId: randomUUID(),
            email: "synthetic-outcomes@example.test",
          })
          .returning();
        actor = u!.id;
      }
      const [co] = await db
        .insert(companies)
        .values({ name: `Synthetic outcomes ${randomUUID()}` })
        .returning();
      const companyId = co!.id;
      ids.push(companyId);
      const [cash, revenue] = await db
        .insert(chartAccounts)
        .values([
          {
            companyId,
            code: "1000",
            name: "Cash",
            accountType: "asset",
            normalBalance: "debit",
            statementLine: "Cash",
          },
          {
            companyId,
            code: "4000",
            name: "Revenue",
            accountType: "revenue",
            normalBalance: "credit",
          },
        ])
        .returning();
      await db.insert(forecastEntryTemplates).values({
        companyId,
        name: "Receipts",
        itemType: "agreement",
        direction: "receipt",
        debitAccountId: cash!.id,
        creditAccountId: revenue!.id,
      });
      const [policy] = await db
        .insert(policies)
        .values({
          companyId,
          name: "Synthetic cash support",
          rule: "Synthetic journal fixture",
          active: "Y",
        })
        .returning();
      const [doc] = await db
        .insert(evidence)
        .values({
          companyId,
          createdByUserId: actor,
          sourceName: "Synthetic team report",
          rawText: "Synthetic hours",
          status: "approved",
          identityStatus: "approved",
        })
        .returning();
      const [fact] = await db
        .insert(factRecords)
        .values({
          companyId,
          evidenceId: doc!.id,
          label: "Available hours in October",
          value: "80",
          confidence: "high",
          status: "approved",
          sourceLocation: "October team total",
        })
        .returning();
      const preview = (
        (await operate(
          companyId,
          { action: "preview", model: modelDefinition },
          actor,
          now,
        )) as { preview: OperatingPreview }
      ).preview;
      const saved = (await operate(
        companyId,
        {
          action: "save",
          model: modelDefinition,
          caseId: "base",
          previewToken: preview.previewToken,
          requestKey: randomUUID(),
          acknowledgeAssumptions: true,
        },
        actor,
        now,
      )) as { saved: { id: string; scenarioId: string } };
      const goal = await goals(
        companyId,
        {
          action: "create_goal",
          definition: {
            name: "December cash",
            metric: "ending_cash_at_month",
            currency: "USD",
            startMonth: "2026-10",
            endMonth: "2026-12",
            targetMinor: "0",
          },
          reason: "Synthetic",
        },
        actor,
        now,
      );
      if (!("goal" in goal)) throw Error("Missing goal");
      const base = await loadGoalReview(companyId, now);
      const plan = await goals(
        companyId,
        {
          action: "save_snapshot",
          kind: "plan",
          goalVersionId: goal.goal.id,
          name: "Synthetic baseline",
          previewToken: base.previewToken,
          requestKey: randomUUID(),
          acknowledgeLimitations: true,
        },
        actor,
        now,
      );
      if (!("saved" in plan)) throw Error("Missing plan");
      return {
        companyId,
        cash: cash!.id,
        revenue: revenue!.id,
        policyId: policy!.id,
        factId: fact!.id,
        evidenceId: doc!.id,
        experimentId: saved.saved.id,
        scenarioId: saved.saved.scenarioId,
        planId: plan.saved.id,
      };
    }
    async function approve(f: Awaited<ReturnType<typeof seed>>) {
      const selection = { scenarioId: f.scenarioId, planId: f.planId };
      const preview = (await decide(
        f.companyId,
        { ...selection, action: "preview" },
        actor,
        now,
      )) as GoalDecisionPreview;
      expect(preview.blockers).toEqual([]);
      const result = await decide(
        f.companyId,
        {
          ...selection,
          action: "approve",
          previewToken: preview.previewToken,
          name: "Synthetic approved model",
          reason: "Synthetic decision",
          requestKey: randomUUID(),
          acknowledgeLimitations: true,
        },
        actor,
        now,
      );
      const w = await workspace(f.companyId);
      expect(w.predictions).toHaveLength(1);
      return { id: w.predictions[0]!.id, result };
    }
    async function observation(
      companyId: string,
      id: string,
      extra: object = {},
    ) {
      const v = await load(companyId, id, later);
      return {
        action: "observe",
        predictionId: id,
        nodeId: "capacity",
        month: "2026-10",
        factId: v.facts[0]!.factId,
        unit: "hours",
        scope: "Whole delivery team, available hours",
        coverage: "complete",
        reason: "Reviewed October report and available capacity",
        expectedObservationId: null,
        acknowledgeMapping: true,
        sourceToken: v.facts[0]!.sourceToken,
        requestKey: randomUUID(),
        ...extra,
      };
    }
    it("pins at approval, records exact operational outcomes, and preserves corrections and saved reviews", async () => {
      const f = await seed();
      expect((await workspace(f.companyId)).predictions).toHaveLength(0);
      const { id } = await approve(f);
      const initial = await load(f.companyId, id, later);
      expect(
        initial.rows.find((r) => r.nodeId === "capacity")?.months[0],
      ).toMatchObject({
        predicted: "100",
        observed: null,
        coverage: "missing",
      });
      const command = await observation(f.companyId, id);
      const saved = await execute(f.companyId, command, actor, later);
      expect(await execute(f.companyId, command, actor, later)).toEqual(saved);
      const v = await load(f.companyId, id, later);
      expect(
        v.rows.find((r) => r.nodeId === "capacity")?.months[0],
      ).toMatchObject({
        predicted: "100",
        observed: "80",
        difference: "-20",
        coverage: "complete",
      });
      const preserved = await execute(
        f.companyId,
        {
          action: "save_review",
          predictionId: id,
          previewToken: v.previewToken,
          reason: "Complete October outcome",
          requestKey: randomUUID(),
        },
        actor,
        later,
      );
      const originalReview = await review(f.companyId, preserved.id);
      await db
        .update(factRecords)
        .set({ value: "85", updatedAt: new Date("2026-11-30T12:01:00Z") })
        .where(eq(factRecords.id, f.factId));
      const stale = await load(f.companyId, id, later);
      expect(
        stale.rows.find((r) => r.nodeId === "capacity")?.months[0],
      ).toMatchObject({ observed: null, coverage: "unavailable" });
      await expect(
        execute(
          f.companyId,
          {
            ...command,
            requestKey: randomUUID(),
            expectedObservationId: saved.id,
          },
          actor,
          later,
        ),
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        execute(
          f.companyId,
          {
            action: "save_review",
            predictionId: id,
            previewToken: v.previewToken,
            reason: "Stale review",
            requestKey: randomUUID(),
          },
          actor,
          later,
        ),
      ).rejects.toMatchObject({ status: 409 });
      const corrected = await observation(f.companyId, id, {
        expectedObservationId: saved.id,
      });
      await execute(f.companyId, corrected, actor, later);
      expect((await load(f.companyId, id, later)).history).toHaveLength(2);
      expect(await review(f.companyId, preserved.id)).toEqual(originalReview);
      expect((await load(f.companyId, id, later)).prediction).toEqual(
        initial.prediction,
      );
      await expect(
        execute(
          f.companyId,
          { ...corrected, requestKey: randomUUID() },
          actor,
          later,
        ),
      ).rejects.toMatchObject({ status: 409 });
      await db
        .update(evidence)
        .set({ status: "rejected" })
        .where(eq(evidence.id, f.evidenceId));
      expect(
        (await load(f.companyId, id, later)).rows.find(
          (r) => r.nodeId === "capacity",
        )?.months[0]?.coverage,
      ).toBe("unavailable");
      for (const table of [
        operatingPredictions,
        operatingObservations,
        operatingOutcomeReviews,
      ])
        await expect(
          db
            .update(table)
            .set({ createdAt: new Date() })
            .where(eq(table.companyId, f.companyId)),
        ).rejects.toThrow();
    });
    it("withdraws a mistaken mapping without losing history and permits an explicit replacement", async () => {
      const f = await seed();
      const { id } = await approve(f);
      const first = await execute(
        f.companyId,
        await observation(f.companyId, id),
        actor,
        later,
      );
      const command = {
        action: "withdraw",
        predictionId: id,
        observationId: first.id,
        reason: "Source measured completed work rather than available capacity",
        requestKey: randomUUID(),
      };
      const removed = await execute(f.companyId, command, actor, later);
      expect(await execute(f.companyId, command, actor, later)).toEqual(
        removed,
      );
      const current = await load(f.companyId, id, later);
      expect(
        current.rows.find((r) => r.nodeId === "capacity")?.months[0],
      ).toMatchObject({
        observed: null,
        coverage: "unavailable",
        definition: { withdrawn: true },
      });
      expect(current.history).toHaveLength(2);
      await expect(
        execute(
          f.companyId,
          { ...command, requestKey: randomUUID() },
          actor,
          later,
        ),
      ).rejects.toMatchObject({ status: 409 });
      await execute(
        f.companyId,
        await observation(f.companyId, id, {
          expectedObservationId: removed.id,
        }),
        actor,
        later,
      );
      expect(
        (await load(f.companyId, id, later)).rows.find(
          (r) => r.nodeId === "capacity",
        )?.months[0],
      ).toMatchObject({ observed: "80", coverage: "complete" });
    });

    it("preserves an exact variance and financial replay without posting or changing approved state", async () => {
      const linked: OperatingModel = {
        ...model,
        nodes: [
          ...model.nodes.map((n) =>
            n.id === "receipts"
              ? {
                  ...n,
                  op: "multiply" as const,
                  args: ["capacity", "price"],
                  values: [],
                }
              : n,
          ),
          {
            id: "price",
            label: "Receipt per available hour",
            unit: "USD/hour",
            op: "input",
            args: [],
            values: [
              { month: "2026-10", value: "200" },
              { month: "2026-11", value: "0" },
            ],
            initial: null,
            rationale: "Synthetic relationship requiring review",
            evidenceIds: [],
          },
        ],
      };
      const f = await seed(linked);
      const { id } = await approve(f);
      const [before] = await db
        .select({ revision: companies.financialStateRevision })
        .from(companies)
        .where(eq(companies.id, f.companyId));
      await execute(
        f.companyId,
        await observation(f.companyId, id),
        actor,
        later,
      );
      const view = await load(f.companyId, id, later);
      expect(view.explanation.variance.status).toBe("available");
      const effects = view.explanation.financialEffects;
      expect(effects.status).toBe("available");
      if (effects.status !== "available") throw Error(effects.reason);
      expect(
        effects.months
          .filter((m) => ["2026-10", "2026-11", "2026-12"].includes(m.month))
          .map((m) => m.endingDifferenceMinor),
      ).toEqual(["-400000", "-400000", "-400000"]);
      const saved = await execute(
        f.companyId,
        {
          action: "save_review",
          predictionId: id,
          previewToken: view.previewToken,
          reason:
            "Observed capacity changes the modeled receipt, not approved cash",
          requestKey: randomUUID(),
        },
        actor,
        later,
      );
      expect(
        (await review(f.companyId, saved.id)).snapshot.explanation,
      ).toEqual(view.explanation);
      const [after] = await db
        .select({ revision: companies.financialStateRevision })
        .from(companies)
        .where(eq(companies.id, f.companyId));
      expect(after).toEqual(before);
    });

    it("tracks 12000 in October and 8000 in November without changing the approved prediction", async () => {
      const f = await seed();
      const { id } = await approve(f);
      const initial = await load(f.companyId, id, later);
      const reconciliation = await loadForecastReconciliation(f.companyId, now);
      const candidate = reconciliation.candidates.find(
        (c) =>
          c.definition.driverId ===
          initial.prediction.cashBindings[0]!.driverId,
      )!;
      expect(candidate).toBeDefined();
      const captured = (await reconcile(
        f.companyId,
        {
          action: "capture",
          candidateKey: candidate.definition.key,
          candidateHash: candidate.hash,
          independentObligation: true,
          reason: "Synthetic receipt",
          requestKey: randomUUID(),
        },
        actor,
        now,
      )) as unknown as { id: string };
      async function receipt(date: string, amount: string) {
        return post(f.companyId, {
          policyId: f.policyId,
          idempotencyKey: randomUUID(),
          label: "Synthetic installment",
          source: "synthetic_test",
          postingDate: date,
          period: date.slice(0, 7),
          memo: "Synthetic",
          deferRefresh: true,
          lines: [
            {
              accountId: f.cash,
              currency: "USD",
              debitMinor: amount,
              creditMinor: "0",
            },
            {
              accountId: f.revenue,
              currency: "USD",
              debitMinor: "0",
              creditMinor: amount,
            },
          ],
        });
      }
      const first = await receipt("2026-10-20", "1200000");
      await reconcile(
        f.companyId,
        {
          action: "allocate",
          occurrenceId: captured.id,
          actualEntryId: first.entryId,
          amountMinor: "1200000",
          expectedVersion: 1,
          final: false,
          reason: "First installment",
          requestKey: randomUUID(),
        },
        actor,
        new Date("2026-10-21T12:00:00Z"),
      );
      const partial = await load(
        f.companyId,
        id,
        new Date("2026-10-21T12:00:00Z"),
      );
      expect(partial.cash[0]).toMatchObject({
        observedMinor: "1200000",
        status: "partial",
        differenceMinor: "-800000",
      });
      const second = await receipt("2026-11-10", "800000");
      await reconcile(
        f.companyId,
        {
          action: "allocate",
          occurrenceId: captured.id,
          actualEntryId: second.entryId,
          amountMinor: "800000",
          expectedVersion: 2,
          final: true,
          reason: "Final installment",
          requestKey: randomUUID(),
        },
        actor,
        later,
      );
      const settled = await load(f.companyId, id, later);
      expect(settled.cash[0]).toMatchObject({
        observedMinor: "2000000",
        status: "settled",
        differenceMinor: "0",
      });
      expect(settled.cash[0]!.payments.map((p) => p.date)).toEqual([
        "2026-10-20",
        "2026-11-10",
      ]);
      await post(f.companyId, {
        policyId: f.policyId,
        idempotencyKey: randomUUID(),
        label: "Synthetic reversal",
        source: "journal_reversal",
        reversalOfEntryId: first.entryId,
        postingDate: "2026-11-15",
        period: "2026-11",
        memo: "Synthetic reversal",
        deferRefresh: true,
        lines: [
          {
            accountId: f.cash,
            currency: "USD",
            debitMinor: "0",
            creditMinor: "1200000",
          },
          {
            accountId: f.revenue,
            currency: "USD",
            debitMinor: "1200000",
            creditMinor: "0",
          },
        ],
      });
      const reversed = await load(f.companyId, id, later);
      expect(reversed.cash[0]).toMatchObject({
        observedMinor: "800000",
        status: "needs_review",
      });
      expect(reversed.prediction).toEqual(initial.prediction);
    });
    it("rejects foreign access, incorrect units, cash mappings, future observations and incomplete months marked complete", async () => {
      const a = await seed();
      const b = await seed();
      const { id } = await approve(a);
      await expect(load(b.companyId, id, later)).rejects.toMatchObject({
        status: 404,
      });
      const base = await observation(a.companyId, id);
      for (const change of [
        { unit: "jobs" },
        { nodeId: "receipts", unit: "USD" },
        { month: "2026-12" },
        { month: "2026-11", coverage: "complete" },
        { factId: b.factId },
      ])
        await expect(
          execute(
            a.companyId,
            { ...base, ...change, requestKey: randomUUID() },
            actor,
            later,
          ),
        ).rejects.toMatchObject({ status: 422 });
      await expect(
        execute(b.companyId, base, actor, later),
      ).rejects.toMatchObject({ status: 404 });
      const [p] = await db
        .select()
        .from(operatingPredictions)
        .where(eq(operatingPredictions.id, id));
      await expect(
        db.insert(operatingObservations).values({
          companyId: b.companyId,
          predictionId: id,
          nodeId: "capacity",
          month: "2026-10",
          definition: {},
          requestKey: randomUUID(),
          requestHash: "foreign",
        }),
      ).rejects.toThrow();
      await expect(
        db.insert(operatingPredictions).values({
          companyId: b.companyId,
          experimentId: a.experimentId,
          reviewId: p!.reviewId,
          snapshot: {},
        }),
      ).rejects.toThrow();
      const rls = await db.execute(
        sql`select relname,relrowsecurity,relforcerowsecurity from pg_class where relname in ('operating_predictions','operating_observations','operating_outcome_reviews')`,
      );
      expect(rls).toHaveLength(3);
      for (const row of rls)
        expect(row).toMatchObject({
          relrowsecurity: true,
          relforcerowsecurity: true,
        });
    });
    it("does not present an edited scenario as the original approved operating model", async () => {
      const f = await seed();
      await db
        .update(scenarios)
        .set({
          changes: [
            {
              kind: "add_driver",
              label: "Separately edited",
              direction: "receipt",
              amount: 25000,
              cadence: "once",
              effectiveFrom: "2026-10",
              category: "other",
            },
          ],
        })
        .where(eq(scenarios.id, f.scenarioId));
      const selection = { scenarioId: f.scenarioId, planId: f.planId };
      const preview = (await decide(
        f.companyId,
        { ...selection, action: "preview" },
        actor,
        now,
      )) as GoalDecisionPreview;
      await decide(
        f.companyId,
        {
          ...selection,
          action: "approve",
          previewToken: preview.previewToken,
          name: "Edited case",
          reason: "Reviewed independent change",
          requestKey: randomUUID(),
          acknowledgeLimitations: true,
        },
        actor,
        now,
      );
      const w = await workspace(f.companyId);
      expect(w.predictions).toHaveLength(0);
      expect(w.legacyReviews).toHaveLength(1);
      await expect(
        execute(
          f.companyId,
          { action: "preserve", reviewId: w.legacyReviews[0]!.id },
          actor,
          later,
        ),
      ).rejects.toMatchObject({ status: 422 });
    });
    it("opens one durable review for two periods, supports reviewed lifecycle and supersedes corrected evidence without changing the forecast", async () => {
      const { executeOperatingTrigger: trigger, loadOperatingTriggers: queue } =
        await import("./operating-triggers");
      const {
        operatingTriggerRules: rules,
        operatingTriggerEvaluations: evaluations,
        operatingTriggerEvents: events,
      } = await import("@finance/database");
      const f = await seed();
      const { id } = await approve(f);
      const at = new Date("2026-12-05T12:00:00Z");
      const before = await loadGoalReview(f.companyId, at);
      const create = {
        action: "create",
        predictionId: id,
        name: "Capacity below plan",
        replacesId: null,
        reason: "Review sustained shortfall",
        acknowledgeRule: true,
        requestKey: randomUUID(),
        rule: {
          kind: "threshold",
          nodeId: "capacity",
          unit: "hours",
          scope: "Whole delivery team, available hours",
          measure: "difference",
          direction: "below",
          threshold: "-10",
          tolerance: "5",
          consecutiveMonths: 2,
          reportingLagMonths: 0,
        },
      };
      const rule = await trigger(f.companyId, create, actor, at);
      expect(await trigger(f.companyId, create, actor, at)).toEqual(rule);
      const evaluate = () =>
        trigger(
          f.companyId,
          {
            action: "evaluate",
            predictionId: id,
            ruleId: rule.id,
            requestKey: randomUUID(),
          },
          actor,
          at,
        );
      await execute(f.companyId, await observation(f.companyId, id), actor, at);
      await evaluate();
      expect(
        (await queue(f.companyId, id, at)).rules[0]!.latest!.snapshot.result
          .status,
      ).toBe("insufficient_data");
      expect((await queue(f.companyId, id, at)).rules[0]!.review).toBeNull();
      await execute(
        f.companyId,
        await observation(f.companyId, id, { month: "2026-11" }),
        actor,
        at,
      );
      const command = {
        action: "evaluate",
        predictionId: id,
        ruleId: rule.id,
        requestKey: randomUUID(),
      };
      const opened = await trigger(f.companyId, command, actor, at);
      expect(await trigger(f.companyId, command, actor, at)).toEqual(opened);
      await evaluate();
      let current = (await queue(f.companyId, id, at)).rules[0]!;
      expect(current.review).toMatchObject({
        id: opened.id,
        effectiveStatus: "open",
      });
      expect(current.review!.history).toHaveLength(1);
      expect(current.review!.snapshot.evidence).toHaveLength(2);
      const transition = {
        action: "transition",
        predictionId: id,
        reviewId: opened.id,
        expectedEventId: current.review!.current.id,
        status: "acknowledged",
        snoozeUntil: null,
        reason: "Investigating staffing",
        requestKey: randomUUID(),
      };
      const acknowledged = await trigger(f.companyId, transition, actor, at);
      expect(await trigger(f.companyId, transition, actor, at)).toEqual(
        acknowledged,
      );
      await expect(
        trigger(
          f.companyId,
          { ...transition, requestKey: randomUUID() },
          actor,
          at,
        ),
      ).rejects.toMatchObject({ status: 409 });
      current = (await queue(f.companyId, id, at)).rules[0]!;
      await trigger(
        f.companyId,
        {
          ...transition,
          expectedEventId: current.review!.current.id,
          status: "snoozed",
          snoozeUntil: "2026-12-08",
          requestKey: randomUUID(),
        },
        actor,
        at,
      );
      expect(
        (await queue(f.companyId, id, at)).rules[0]!.review!.effectiveStatus,
      ).toBe("snoozed");
      expect(
        (await queue(f.companyId, id, new Date("2026-12-08T00:00:00Z")))
          .rules[0]!.review,
      ).toMatchObject({
        effectiveStatus: "open",
        current: { status: "snoozed" },
      });
      // Changed approval invalidates both preserved mappings; the original receipt remains exact.
      await db
        .update(factRecords)
        .set({ status: "rejected" })
        .where(eq(factRecords.id, f.factId));
      await evaluate();
      current = (await queue(f.companyId, id, at)).rules[0]!;
      expect(current.latest!.snapshot.result.status).toBe("insufficient_data");
      expect(current.review!.effectiveStatus).toBe("superseded");
      expect(current.review!.snapshot.result.status).toBe("triggered");
      expect(current.review!.snapshot.evidence[0]!.definition.value).toBe("80");
      const view = await load(f.companyId, id, at);
      await execute(
        f.companyId,
        {
          action: "withdraw",
          predictionId: id,
          observationId: view.rows.find((r) => r.nodeId === "capacity")!
            .months[1]!.observationId,
          reason: "Withdraw November pending correction",
          requestKey: randomUUID(),
        },
        actor,
        at,
      );
      await evaluate();
      expect(
        (await queue(f.companyId, id, at)).rules[0]!.review!.history.filter(
          (e) => e.status === "superseded",
        ),
      ).toHaveLength(1);
      const date = await trigger(
        f.companyId,
        {
          ...create,
          name: "Review commitment",
          replacesId: rule.id,
          rule: { kind: "review_date", dueDate: "2026-12-01" },
          requestKey: randomUUID(),
        },
        actor,
        at,
      );
      await expect(evaluate()).rejects.toMatchObject({ status: 409 });
      await trigger(
        f.companyId,
        { ...command, ruleId: date.id, requestKey: randomUUID() },
        actor,
        at,
      );
      const active = (await queue(f.companyId, id, at)).rules.find(
        (r) => r.active,
      )!;
      await trigger(
        f.companyId,
        {
          ...transition,
          reviewId: active.review!.id,
          expectedEventId: active.review!.current.id,
          status: "resolved",
          reason: "Reviewed and keeping existing plan",
          requestKey: randomUUID(),
        },
        actor,
        at,
      );
      await trigger(
        f.companyId,
        { ...command, ruleId: date.id, requestKey: randomUUID() },
        actor,
        at,
      );
      expect(
        (await queue(f.companyId, id, at)).rules.find((r) => r.active)!.review!
          .effectiveStatus,
      ).toBe("resolved");
      expect(await loadGoalReview(f.companyId, at)).toEqual(before);
      const all = await db
        .select()
        .from(events)
        .where(eq(events.companyId, f.companyId));
      expect(all.filter((e) => e.status === "open")).toHaveLength(2);
      await expect(
        db.update(rules).set({ name: "tamper" }).where(eq(rules.id, rule.id)),
      ).rejects.toThrow();
      await expect(
        db
          .update(evaluations)
          .set({ snapshot: {} })
          .where(eq(evaluations.id, opened.id)),
      ).rejects.toThrow();
      await expect(
        db
          .update(events)
          .set({ reason: "tamper" })
          .where(eq(events.id, all[0]!.id)),
      ).rejects.toThrow();
    });
    it("scopes trigger storage and requests, validates rules and survives simultaneous retries", async () => {
      const { executeOperatingTrigger: trigger, loadOperatingTriggers: queue } =
        await import("./operating-triggers");
      const {
        operatingTriggerRules: rules,
        operatingTriggerEvaluations: evaluations,
        operatingTriggerEvents: events,
      } = await import("@finance/database");
      const a = await seed(),
        b = await seed();
      const { id } = await approve(a);
      const at = new Date("2026-12-05T12:00:00Z");
      const create = {
        action: "create",
        predictionId: id,
        name: "Synthetic scheduled review",
        replacesId: null,
        reason: "Synthetic",
        acknowledgeRule: true,
        requestKey: randomUUID(),
        rule: { kind: "review_date", dueDate: "2026-12-01" },
      };
      await expect(queue(b.companyId, id, at)).rejects.toMatchObject({
        status: 404,
      });
      await expect(
        trigger(b.companyId, create, actor, at),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        trigger(a.companyId, { ...create, acknowledgeRule: false }, actor, at),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        trigger(
          a.companyId,
          { ...create, rule: { kind: "review_date", dueDate: "2026-02-30" } },
          actor,
          at,
        ),
      ).rejects.toMatchObject({ status: 400 });
      const rule = await trigger(a.companyId, create, actor, at);
      const command = {
        action: "evaluate",
        predictionId: id,
        ruleId: rule.id,
        requestKey: randomUUID(),
      };
      await Promise.allSettled([
        trigger(a.companyId, command, actor, at),
        trigger(a.companyId, command, actor, at),
      ]);
      await trigger(a.companyId, command, actor, at);
      const w = await queue(a.companyId, id, at);
      expect(w.rules[0]!.evaluations).toHaveLength(1);
      expect(w.rules[0]!.review!.history).toHaveLength(1);
      await expect(
        trigger(a.companyId, { ...create, name: "Changed" }, actor, at),
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        db.insert(rules).values({
          companyId: b.companyId,
          predictionId: id,
          name: "Foreign",
          definition: {},
          reason: "Synthetic",
          requestKey: randomUUID(),
          requestHash: "x",
        }),
      ).rejects.toThrow();
      await expect(
        db.insert(evaluations).values({
          companyId: b.companyId,
          ruleId: rule.id,
          sequence: 1,
          fingerprint: "x",
          snapshot: {},
          requestKey: randomUUID(),
          requestHash: "x",
        }),
      ).rejects.toThrow();
      await expect(
        db.insert(events).values({
          companyId: b.companyId,
          reviewId: w.rules[0]!.review!.id,
          evaluationId: w.rules[0]!.latest!.id,
          status: "open",
          reason: "Synthetic",
          requestKey: randomUUID(),
          requestHash: "x",
        }),
      ).rejects.toThrow();
      const rls = await db.execute(
        sql`select relname,relrowsecurity,relforcerowsecurity from pg_class where relname in ('operating_trigger_rules','operating_trigger_evaluations','operating_trigger_events')`,
      );
      expect(rls).toHaveLength(3);
      for (const row of rls)
        expect(row).toMatchObject({
          relrowsecurity: true,
          relforcerowsecurity: true,
        });
    });
    it("links a trigger to a reviewed revision, retains paid commitments and replaces only uncommitted future cash", async () => {
      const { executeOperatingTrigger: trigger } = await import(
        "./operating-triggers"
      );
      const { executeOperatingPlan: plan, loadOperatingPlanWorkspace: plans } =
        await import("./operating-plan-revisions");
      const { promoteScenario } = await import("./scenarios");
      const {
        operatingPlanRevisions,
        forecastOccurrences,
        forecastSettlementAllocations,
      } = await import("@finance/database");
      const recurring = {
        ...model,
        nodes: model.nodes.map((n) =>
          n.id === "receipts"
            ? { ...n, values: [{ month: "2026-10", value: "20000" }] }
            : n,
        ),
      };
      const f = await seed(recurring);
      const { id } = await approve(f);
      const original = await load(f.companyId, id, now);
      const candidate = (
        await loadForecastReconciliation(f.companyId, now)
      ).candidates.find(
        (c) =>
          c.definition.driverId ===
          original.prediction.cashBindings[0]!.driverId,
      )!;
      const captured = (await reconcile(
        f.companyId,
        {
          action: "capture",
          candidateKey: candidate.definition.key,
          candidateHash: candidate.hash,
          independentObligation: true,
          reason: "Preserved commitment",
          requestKey: randomUUID(),
        },
        actor,
        now,
      )) as unknown as { id: string };
      const receipt = await post(f.companyId, {
        policyId: f.policyId,
        idempotencyKey: randomUUID(),
        label: "Synthetic installment",
        source: "synthetic_test",
        postingDate: "2026-10-05",
        period: "2026-10",
        memo: "Synthetic",
        deferRefresh: true,
        lines: [
          {
            accountId: f.cash,
            currency: "USD",
            debitMinor: "1200000",
            creditMinor: "0",
          },
          {
            accountId: f.revenue,
            currency: "USD",
            debitMinor: "0",
            creditMinor: "1200000",
          },
        ],
      });
      await reconcile(
        f.companyId,
        {
          action: "allocate",
          occurrenceId: captured.id,
          actualEntryId: receipt.entryId,
          amountMinor: "1200000",
          expectedVersion: 1,
          final: false,
          reason: "Reviewed installment",
          requestKey: randomUUID(),
        },
        actor,
        now,
      );
      const rules = await trigger(
        f.companyId,
        {
          action: "create",
          predictionId: id,
          name: "Review renewal",
          rule: { kind: "review_date", dueDate: "2026-10-05" },
          replacesId: null,
          reason: "Review next period",
          requestKey: randomUUID(),
          acknowledgeRule: true,
        },
        actor,
        now,
      );
      const review = await trigger(
        f.companyId,
        {
          action: "evaluate",
          predictionId: id,
          ruleId: rules.id,
          requestKey: randomUUID(),
        },
        actor,
        now,
      );
      const inputs = [
        {
          nodeId: "receipts",
          month: "2026-11",
          value: "25000",
          reason: "Explicit future renewal assumption",
        },
      ];
      const before = await loadGoalReview(f.companyId, now);
      const unchangedOccurrences = await db
        .select()
        .from(forecastOccurrences)
        .where(eq(forecastOccurrences.companyId, f.companyId));
      const unchangedAllocations = await db
        .select()
        .from(forecastSettlementAllocations)
        .where(eq(forecastSettlementAllocations.companyId, f.companyId));
      const result = await plan(
        f.companyId,
        { action: "preview", reviewId: review.id, inputs },
        actor,
        now,
      );
      if (!("preview" in result)) throw Error("No proposal preview");
      const preview = result.preview;
      expect(preview.replacement.retained).toEqual([
        original.prediction.cashBindings[0],
      ]);
      expect(preview.commitments[0]).toMatchObject({
        allocatedMinor: "1200000",
        remainingMinor: "800000",
        state: "partial",
      });
      expect(
        preview.monthlyChanges
          .filter((m) => ["2026-10", "2026-11", "2026-12"].includes(m.month))
          .map((m) => m.deltaMinor),
      ).toEqual(["0", "500000", "1000000"]);
      await expect(
        plan(
          f.companyId,
          {
            action: "preview",
            reviewId: review.id,
            inputs: [{ ...inputs[0]!, month: "2026-10" }],
          },
          actor,
          now,
        ),
      ).rejects.toMatchObject({ status: 422 });
      const command = {
        action: "save",
        reviewId: review.id,
        inputs,
        name: "Synthetic November revision",
        reason: "Reviewed retention",
        previewToken: preview.previewToken,
        requestKey: randomUUID(),
        acknowledgeCommitments: true,
      };
      const saved = await plan(f.companyId, command, actor, now);
      if (!("saved" in saved)) throw Error("No proposal");
      expect(await plan(f.companyId, command, actor, now)).toEqual(saved);
      expect(await loadGoalReview(f.companyId, now)).toEqual(before);
      await expect(
        promoteScenario(f.companyId, saved.saved.scenarioId, actor),
      ).rejects.toMatchObject({ status: 409 });
      const rejected = await plan(
        f.companyId,
        {
          ...command,
          name: "Synthetic rejected alternative",
          requestKey: randomUUID(),
        },
        actor,
        now,
      );
      if (!("saved" in rejected)) throw Error("No rejection proposal");
      await plan(
        f.companyId,
        {
          action: "reject",
          experimentId: rejected.saved.id,
          reason: "Keep original proposal",
        },
        actor,
        now,
      );
      expect(await loadGoalReview(f.companyId, now)).toEqual(before);
      const selection = {
        scenarioId: saved.saved.scenarioId,
        planId: f.planId,
      };
      const decision = (await decide(
        f.companyId,
        { action: "preview", ...selection },
        actor,
        now,
      )) as GoalDecisionPreview;
      expect(decision.blockers).toEqual([]);
      await decide(
        f.companyId,
        {
          action: "approve",
          ...selection,
          previewToken: decision.previewToken,
          name: "Approved November revision",
          reason: "Reviewed proposed future cash",
          requestKey: randomUUID(),
          acknowledgeLimitations: true,
        },
        actor,
        now,
      );
      expect(
        await db
          .select()
          .from(forecastOccurrences)
          .where(eq(forecastOccurrences.companyId, f.companyId)),
      ).toEqual(unchangedOccurrences);
      expect(
        await db
          .select()
          .from(forecastSettlementAllocations)
          .where(eq(forecastSettlementAllocations.companyId, f.companyId)),
      ).toEqual(unchangedAllocations);
      expect((await load(f.companyId, id, now)).prediction).toEqual(
        original.prediction,
      );
      const predictions = await workspace(f.companyId);
      expect(predictions.predictions).toHaveLength(2);
      const next = await load(
        f.companyId,
        predictions.predictions.find((p) => p.id !== id)!.id,
        now,
      );
      expect(next.prediction.cashBindings).toHaveLength(3);
      expect(next.prediction.cashBindings[0]).toEqual(
        original.prediction.cashBindings[0],
      );
      expect(next.explanation.financialEffects.status).toBe("available");
      if(next.explanation.financialEffects.status==="available")expect(next.explanation.financialEffects.months.every(m=>m.endingDifferenceMinor==="0")).toBe(true);
      expect(next.cash[0]).toMatchObject({
        observedMinor: "1200000",
        status: "partial",
      });
      expect(
        (await plans(f.companyId, review.id, now)).blockedReason,
      ).toContain("already approved");
      await expect(
        plan(
          f.companyId,
          { action: "preview", reviewId: review.id, inputs },
          actor,
          now,
        ),
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        plan(
          f.companyId,
          {
            action: "reject",
            experimentId: saved.saved.id,
            reason: "Too late",
          },
          actor,
          now,
        ),
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        db
          .update(operatingPlanRevisions)
          .set({ triggerReviewId: randomUUID() })
          .where(eq(operatingPlanRevisions.experimentId, saved.saved.id)),
      ).rejects.toThrow();
      const other = await seed();
      await expect(
        plans(other.companyId, review.id, now),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        db
          .insert(operatingPlanRevisions)
          .values({
            companyId: other.companyId,
            experimentId: saved.saved.id,
            predictionId: id,
            triggerReviewId: review.id,
          }),
      ).rejects.toThrow();
      expect(
        await db.execute(
          sql`select relrowsecurity,relforcerowsecurity from pg_class where relname='operating_plan_revisions'`,
        ),
      ).toEqual([
        expect.objectContaining({
          relrowsecurity: true,
          relforcerowsecurity: true,
        }),
      ]);
    });
    it("blocks changed trigger evidence, separately edited scenarios, and stale review actions before approval", async () => {
      const { executeOperatingTrigger: trigger, loadOperatingTriggers: queue } =
        await import("./operating-triggers");
      const { executeOperatingPlan: plan } = await import(
        "./operating-plan-revisions"
      );
      const f = await seed();
      const { id } = await approve(f);
      const rule = await trigger(
        f.companyId,
        {
          action: "create",
          predictionId: id,
          name: "Review capacity",
          rule: {
            kind: "threshold",
            nodeId: "capacity",
            unit: "hours",
            scope: "Whole delivery team, available hours",
            measure: "observed",
            direction: "below",
            threshold: "90",
            tolerance: "0",
            consecutiveMonths: 1,
            reportingLagMonths: 0,
          },
          replacesId: null,
          reason: "Sourced condition",
          requestKey: randomUUID(),
          acknowledgeRule: true,
        },
        actor,
        later,
      );
      await execute(
        f.companyId,
        await observation(f.companyId, id),
        actor,
        later,
      );
      const review = await trigger(
        f.companyId,
        {
          action: "evaluate",
          predictionId: id,
          ruleId: rule.id,
          requestKey: randomUUID(),
        },
        actor,
        later,
      );
      const inputs = [
        {
          nodeId: "receipts",
          month: "2026-12",
          value: "5000",
          reason: "Illustrative new receipt",
        },
      ];
      const p = await plan(
        f.companyId,
        { action: "preview", reviewId: review.id, inputs },
        actor,
        later,
      );
      if (!("preview" in p)) throw Error("No preview");
      const saved = await plan(
        f.companyId,
        {
          action: "save",
          reviewId: review.id,
          inputs,
          name: "Synthetic sourced revision",
          reason: "Reviewed",
          previewToken: p.preview.previewToken,
          acknowledgeCommitments: true,
          requestKey: randomUUID(),
        },
        actor,
        later,
      );
      if (!("saved" in saved)) throw Error("No proposal");
      const selection = {
        scenarioId: saved.saved.scenarioId,
        planId: f.planId,
      };
      await db
        .update(factRecords)
        .set({ status: "rejected" })
        .where(eq(factRecords.id, f.factId));
      await expect(
        decide(f.companyId, { action: "preview", ...selection }, actor, later),
      ).rejects.toMatchObject({ status: 409 });
      await db
        .update(factRecords)
        .set({ status: "approved" })
        .where(eq(factRecords.id, f.factId));
      await db
        .update(scenarios)
        .set({ changes: [] })
        .where(eq(scenarios.id, saved.saved.scenarioId));
      await expect(
        decide(f.companyId, { action: "preview", ...selection }, actor, later),
      ).rejects.toMatchObject({ status: 409 });
      await db
        .update(scenarios)
        .set({ changes: p.preview.path.changes })
        .where(eq(scenarios.id, saved.saved.scenarioId));
      const current = (await queue(f.companyId, id, later)).rules[0]!.review!;
      await trigger(
        f.companyId,
        {
          action: "transition",
          predictionId: id,
          reviewId: review.id,
          expectedEventId: current.current.id,
          status: "resolved",
          snoozeUntil: null,
          reason: "Keep current plan",
          requestKey: randomUUID(),
        },
        actor,
        later,
      );
      await expect(
        decide(f.companyId, { action: "preview", ...selection }, actor, later),
      ).rejects.toMatchObject({ status: 409 });
    });
    it("requires a new proposal if an owned obligation is captured after saving",async()=>{
      const {executeOperatingTrigger:trigger}=await import("./operating-triggers");
      const {executeOperatingPlan:plan}=await import("./operating-plan-revisions");
      const f=await seed();const {id}=await approve(f);
      const rule=await trigger(f.companyId,{action:"create",predictionId:id,name:"Review now",rule:{kind:"review_date",dueDate:"2026-10-05"},replacesId:null,reason:"Synthetic review",requestKey:randomUUID(),acknowledgeRule:true},actor,now);
      const review=await trigger(f.companyId,{action:"evaluate",predictionId:id,ruleId:rule.id,requestKey:randomUUID()},actor,now);
      const inputs=[{nodeId:"receipts",month:"2026-10",value:"25000",reason:"Proposed receipt change"}];
      const result=await plan(f.companyId,{action:"preview",reviewId:review.id,inputs},actor,now);if(!("preview" in result))throw Error("No preview");
      const saved=await plan(f.companyId,{action:"save",reviewId:review.id,inputs,name:"Revision before commitment",reason:"Synthetic",previewToken:result.preview.previewToken,requestKey:randomUUID(),acknowledgeCommitments:true},actor,now);if(!("saved" in saved))throw Error("No proposal");
      const c=(await loadForecastReconciliation(f.companyId,now)).candidates[0]!;
      await reconcile(f.companyId,{action:"capture",candidateKey:c.definition.key,candidateHash:c.hash,independentObligation:true,reason:"Captured after draft",requestKey:randomUUID()},actor,now);
      await expect(decide(f.companyId,{action:"preview",scenarioId:saved.saved.scenarioId,planId:f.planId},actor,now)).rejects.toMatchObject({status:409});
    });

    it("preserves conditional and sampled studies without applying cash, with immutable company-scoped history",async()=>{
      const {executeOperatingStudy:study,loadOperatingStudy:readStudy}=await import("./operating-studies");
      const {operatingStudies}=await import("@finance/database");
      const f=await seed(),other=await seed();
      const definition={kind:"conditional",source:{kind:"draft",model,caseId:"base"},mode:"simulated",plan:{startMonth:"2026-10",branches:[{id:"capacity",name:"Increase capacity",rationale:"Synthetic capacity response",rule:{kind:"review_date",dueDate:"2026-10-01"},leadMonths:0,minimumMonths:2,inputs:[{nodeId:"capacity",value:"120"}],switchCost:null,limits:[{nodeId:"capacity",maximum:"130"}]}]}};
      const before=await loadGoalReview(f.companyId,now);
      const result=await study(f.companyId,{action:"preview",definition},actor,now);if(!("preview" in result))throw Error("No preview");
      expect(result.preview.result.kind).toBe("conditional");
      const command={action:"save",definition,name:"Synthetic conditional study",previewToken:result.preview.previewToken,requestKey:randomUUID(),acknowledgeAssumptions:true};
      const saved=await study(f.companyId,command,actor,new Date(now.getTime()+1000));if(!("id" in saved))throw Error("Not saved");
      expect(await study(f.companyId,command,actor,now)).toEqual(saved);
      await expect(readStudy(other.companyId,saved.id)).rejects.toMatchObject({status:404});
      await expect(db.update(operatingStudies).set({name:"Changed"}).where(eq(operatingStudies.id,saved.id))).rejects.toThrow();
      expect((await loadGoalReview(f.companyId,now)).forecastMonths).toEqual(before.forecastMonths);
      const simulated={kind:"simulation",source:definition.source,settings:{seed:42,count:16,parameters:[{nodeId:"receipts",from:"2026-10",low:"10000",high:"20000",group:"",inverse:false,rationale:"Synthetic assumed receipt spread"}],entities:[{id:"client",name:"Synthetic client",cohort:"Existing",nodeIds:["receipts"]}]},cashFloorMinor:"0",alternatives:[],valuation:{nodeId:"receipts",annualDiscount:"0.1",terminalMultiple:"0",priceMinor:"3000000",basis:"Synthetic incremental cash flows only"}};
      const simulation=await study(f.companyId,{action:"preview",definition:simulated},actor,now);if(!("preview" in simulation)||simulation.preview.result.kind!=="simulation")throw Error("No simulation");
      expect(simulation.preview.result.worlds[0]!.summary).toMatchObject({attempted:16,valid:16,failed:0});
      for(const path of simulation.preview.result.worlds[0]!.paths){if(path.status!=="available"||path.financial.status!=="available")throw Error("Unsupported path");expect(path.financial.run.projectedLines.reduce((n,l)=>n+BigInt(l.debitMinor)-BigInt(l.creditMinor),0n)).toBe(0n);}
      const sampled=await study(f.companyId,{action:"save",definition:simulated,name:"Synthetic sampled study",previewToken:simulation.preview.previewToken,requestKey:randomUUID(),acknowledgeAssumptions:true},actor,now);if(!("id" in sampled))throw Error("Not saved");
      expect((await readStudy(f.companyId,sampled.id)).snapshot.result).toEqual(simulation.preview.result);
      await expect(study(f.companyId,{...command,requestKey:randomUUID(),definition:{...definition,plan:{...definition.plan,startMonth:"2026-11"}}},actor,now)).rejects.toMatchObject({status:409});
      expect((await loadGoalReview(f.companyId,now)).forecastMonths).toEqual(before.forecastMonths);
    });
    it("scores only explicitly matched observations and preserves reports when evidence is withdrawn",async()=>{
      const {executeOperatingStudy:study,loadOperatingStudy:readStudy}=await import("./operating-studies");
      const f=await seed(),{id}=await approve(f);
      await execute(f.companyId,await observation(f.companyId,id),actor,later);
      const definition={kind:"calibration",source:{kind:"prediction",predictionId:id},binding:{horizonMonths:1,metricId:"delivery_capacity",nodeId:"capacity",unit:"hours",scope:"Whole delivery team, available hours",aggregation:"monthly_total",reason:"Reviewed same team and available-hour definition",additionalVersions:[],acknowledgeComparable:true}};
      const result=await study(f.companyId,{action:"preview",definition},actor,later);if(!("preview" in result)||result.preview.result.kind!=="calibration")throw Error("No report");
      expect(result.preview.result.report.calibration.status).toBe("insufficient");
      expect(result.preview.result.report.excluded.some(e=>e.reason.includes("during or after"))).toBe(true);
      const saved=await study(f.companyId,{action:"save",definition,name:"Sparse reliability report",previewToken:result.preview.previewToken,requestKey:randomUUID(),acknowledgeAssumptions:true},actor,later);if(!("id" in saved))throw Error("No saved report");
      await db.update(factRecords).set({status:"rejected"}).where(eq(factRecords.id,f.factId));
      const fresh=await study(f.companyId,{action:"preview",definition},actor,later);if(!("preview" in fresh))throw Error("No fresh report");
      expect(fresh.preview.previewToken).not.toBe(result.preview.previewToken);
      expect((await readStudy(f.companyId,saved.id)).snapshot.result).toEqual(result.preview.result);
    });
  },
);
