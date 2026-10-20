import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { OperatingModel } from "@balsa/finance-engine";
import type { OperatingPreview } from "./operating-models";
import type { OperatingUpdatePreview } from "./operating-connections";
import type { GoalDecisionPreview } from "./goal-decisions-contract";
const providerMock = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock("./models", () => ({
  getModelProvider: () => ({
    name: "openai",
    model: "synthetic",
    generateStructured: providerMock.generate,
    getLastUsage: () => null,
  }),
}));
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
const model: OperatingModel = {
  name: "Synthetic connected operating model",
  description: "Monthly synthetic receipts",
  startMonth: "2026-10",
  months: 3,
  nodes: [
    {
      id: "receipt",
      label: "Incremental receipts",
      unit: "USD",
      op: "input",
      args: [],
      values: [{ month: "2026-10", value: "20000" }],
      initial: null,
      rationale: "Synthetic assumption",
      evidenceIds: [],
    },
  ],
  outputs: [
    {
      nodeId: "receipt",
      label: "Incremental receipts",
      direction: "receipt",
      category: "other",
    },
  ],
  cases: [],
  limitations: ["Synthetic only"],
};
describe.skipIf(!process.env.DATABASE_URL)(
  "connected operating model revisions",
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
      operatingConnections,
      operatingRevisions,
      economicItems,
      operatingExperiments,
    } = await import("@finance/database");
    const { executeOperatingCommand: operate, loadOperatingExperiment } =
      await import("./operating-models");
    const { executeOperatingConnection: execute, loadOperatingConnections } =
      await import("./operating-connections");
    const { executeGoalReviewCommand: goals, loadGoalReview } = await import(
      "./goal-reviews"
    );
    const { executeGoalDecision: decide } = await import("./goal-decisions");
    const { promoteScenario, updateScenario } = await import("./scenarios");
    const { loadForecastReconciliation, executeForecastReconciliation } =
      await import("./forecast-reconciliation");
    const { postApprovedJournal } = await import("./journal-posting");
    const db = getDatabase();
    const ids: string[] = [];
    let actor = "";
    afterAll(async () => {
      if (ids.length)
        await db.delete(companies).where(inArray(companies.id, ids));
      if (actor) await db.delete(users).where(eq(users.id, actor));
      await closeDatabase();
    });
    async function seed() {
      if (!actor) {
        const [row] = await db
          .insert(users)
          .values({
            authProvider: "test",
            authProviderUserId: randomUUID(),
            email: "connected-operating@example.test",
          })
          .returning();
        actor = row!.id;
      }
      const [company] = await db
        .insert(companies)
        .values({ name: `Synthetic connected ${randomUUID()}` })
        .returning();
      const companyId = company!.id;
      ids.push(companyId);
      const [cash, revenue, capital] = await db
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
          {
            companyId,
            code: "3000",
            name: "Capital",
            accountType: "equity",
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
          name: "Synthetic",
          rule: "Synthetic approved capital",
          active: "Y",
        })
        .returning();
      await postApprovedJournal(companyId, {
        policyId: policy!.id,
        idempotencyKey: randomUUID(),
        label: "Synthetic opening",
        source: "synthetic_test",
        postingDate: "2026-09-30",
        period: "2026-09",
        memo: "Fixture",
        deferRefresh: true,
        lines: [
          {
            accountId: cash!.id,
            currency: "USD",
            debitMinor: "8000000",
            creditMinor: "0",
          },
          {
            accountId: capital!.id,
            currency: "USD",
            debitMinor: "0",
            creditMinor: "8000000",
          },
        ],
      });
      const [document] = await db
        .insert(evidence)
        .values({
          companyId,
          createdByUserId: actor,
          sourceName: "Synthetic approved plan",
          rawText: "Synthetic receipt plan",
          status: "approved",
          identityStatus: "approved",
        })
        .returning();
      const [fact] = await db
        .insert(factRecords)
        .values({
          companyId,
          evidenceId: document!.id,
          label: "Monthly amount",
          value: "20000",
          currency: "USD",
          confidence: "high",
          status: "approved",
        })
        .returning();
      const originalPreview = (await operate(
        companyId,
        { action: "preview", model },
        actor,
        now,
      )) as { preview: OperatingPreview };
      const original = (await operate(
        companyId,
        {
          action: "save",
          model,
          caseId: "base",
          previewToken: originalPreview.preview.previewToken,
          requestKey: randomUUID(),
          acknowledgeAssumptions: true,
        },
        actor,
        now,
      )) as { saved: { id: string; scenarioId: string } };
      const goal = (await goals(
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
          reason: "Synthetic decision goal",
        },
        actor,
        now,
      )) as { goal: { id: string } };
      const outlook = await loadGoalReview(companyId, now);
      const plan = (await goals(
        companyId,
        {
          action: "save_snapshot",
          kind: "plan",
          goalVersionId: goal.goal.id,
          name: "Synthetic plan",
          previewToken: outlook.previewToken,
          requestKey: randomUUID(),
          acknowledgeLimitations: true,
        },
        actor,
        now,
      )) as { saved: { id: string } };
      return {
        companyId,
        factId: fact!.id,
        documentId: document!.id,
        original: original.saved,
        planId: plan.saved.id,
      };
    }
    async function approve(
      f: Awaited<ReturnType<typeof seed>>,
      scenarioId: string,
      date = now,
    ) {
      const selection = { scenarioId, planId: f.planId, conditionReviews: [] };
      const preview = (await decide(
        f.companyId,
        { ...selection, action: "preview" },
        actor,
        date,
      )) as GoalDecisionPreview;
      expect(preview.blockers).toEqual([]);
      await decide(
        f.companyId,
        {
          ...selection,
          action: "approve",
          previewToken: preview.previewToken,
          name: "Synthetic applied model",
          reason: "Reviewed synthetic source update",
          requestKey: randomUUID(),
          acknowledgeLimitations: true,
        },
        actor,
        date,
      );
      return preview;
    }
    async function connect(
      f: Awaited<ReturnType<typeof seed>>,
      from = "2026-10",
    ) {
      const command = {
        action: "connect",
        experimentId: f.original.id,
        bindings: [{ nodeId: "receipt", factId: f.factId, from, unit: "USD" }],
        acknowledgeUnits: true,
      };
      const result = (await execute(f.companyId, command, actor, now)) as {
        connectionId: string;
      };
      return result.connectionId;
    }
    const previewUpdate = async (
      companyId: string,
      connectionId: string,
      date = now,
    ) =>
      (
        (await execute(
          companyId,
          { action: "preview_update", connectionId },
          actor,
          date,
        )) as { preview: OperatingUpdatePreview }
      ).preview;
    async function saveUpdate(
      companyId: string,
      preview: OperatingUpdatePreview,
      date = now,
    ) {
      const command = {
        action: "save_update",
        bindings: preview.live.bindings,
        connectionId: preview.connectionId,
        previewToken: preview.previewToken,
        requestKey: randomUUID(),
        acknowledgeAssumptions: true,
      };
      const result = (await execute(companyId, command, actor, date)) as {
        saved: { id: string; scenarioId: string };
      };
      return result.saved;
    }
    it("reuses connection and saved-update commands without duplicating state", async () => {
      const f = await seed();
      await approve(f, f.original.scenarioId);
      const connection = {
        action: "connect", experimentId: f.original.id,
        bindings: [{ nodeId: "receipt", factId: f.factId, from: "2026-10", unit: "USD" }],
        acknowledgeUnits: true,
      };
      const connected = await execute(f.companyId, connection, actor, now) as { connectionId: string };
      expect(await execute(f.companyId, connection, actor, now)).toEqual(connected);
      await db.update(factRecords).set({ value: "30000" }).where(eq(factRecords.id, f.factId));
      const preview = await previewUpdate(f.companyId, connected.connectionId);
      const command = {
        action: "save_update", connectionId: connected.connectionId,
        bindings: preview.live.bindings, previewToken: preview.previewToken,
        requestKey: randomUUID(), acknowledgeAssumptions: true,
      };
      const saved = await execute(f.companyId, command, actor, now);
      expect(await execute(f.companyId, command, actor, now)).toEqual(saved);
      expect((await loadOperatingConnections(f.companyId)).connected).toHaveLength(1);
    });
    it("replaces approved contributions, rejects stale approvals and preserves immutable history", async () => {
      const f = await seed();
      await approve(f, f.original.scenarioId);
      const preserved = await loadOperatingExperiment(
        f.companyId,
        f.original.id,
      );
      const connectionId = await connect(f);
      await db
        .update(factRecords)
        .set({ value: "30000", updatedAt: new Date() })
        .where(eq(factRecords.id, f.factId));
      const preview = await previewUpdate(f.companyId, connectionId);
      expect(preview.replaces).toBe(3);
      expect(
        preview.monthlyChanges.slice(0, 3).map((m) => m.deltaMinor),
      ).toEqual(["1000000", "2000000", "3000000"]);
      const saved = await saveUpdate(f.companyId, preview);
      expect(
        (await loadGoalReview(f.companyId, now)).forecastMonths.find(
          (m) => m.month === "2026-12",
        )?.endingCashMinor,
      ).toBe("14000000");
      await expect(
        promoteScenario(f.companyId, saved.scenarioId, actor),
      ).rejects.toThrow("Decisions & outcomes");
      await db
        .update(factRecords)
        .set({ value: "35000", updatedAt: new Date() })
        .where(eq(factRecords.id, f.factId));
      await expect(approve(f, saved.scenarioId)).rejects.toThrow(
        "Connected evidence changed",
      );
      const latest = await saveUpdate(
        f.companyId,
        await previewUpdate(f.companyId, connectionId),
      );
      await approve(f, latest.scenarioId);
      expect(
        (await loadGoalReview(f.companyId, now)).forecastMonths.find(
          (m) => m.month === "2026-12",
        )?.endingCashMinor,
      ).toBe("18500000");
      expect(await loadOperatingExperiment(f.companyId, f.original.id)).toEqual(
        preserved,
      );
      expect(
        (await loadOperatingConnections(f.companyId)).connected[0]?.status,
      ).toBe("current");
      const next = await previewUpdate(f.companyId, connectionId);
      expect(next.monthlyChanges.every((m) => m.deltaMinor === "0")).toBe(true);
      await expect(
        db
          .update(operatingConnections)
          .set({ bindings: [] })
          .where(eq(operatingConnections.id, connectionId)),
      ).rejects.toThrow();
      await expect(
        db
          .update(operatingExperiments)
          .set({ snapshot: {} })
          .where(eq(operatingExperiments.id, latest.id)),
      ).rejects.toThrow();
    });
    it("blocks unapproved, missing and cross-company sources, stale previews, and edited scenarios", async () => {
      const f = await seed();
      const other = await seed();
      await expect(
        execute(
          other.companyId,
          {
            action: "connect",
            experimentId: f.original.id,
            bindings: [
              {
                nodeId: "receipt",
                factId: f.factId,
                from: "2026-10",
                unit: "USD",
              },
            ],
            acknowledgeUnits: true,
          },
          actor,
          now,
        ),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        execute(
          f.companyId,
          {
            action: "connect",
            experimentId: f.original.id,
            bindings: [
              {
                nodeId: "receipt",
                factId: other.factId,
                from: "2026-10",
                unit: "USD",
              },
            ],
            acknowledgeUnits: true,
          },
          actor,
          now,
        ),
      ).rejects.toMatchObject({ status: 409 });
      const connectionId = await connect(f);
      await expect(
        db.insert(operatingRevisions).values({
          companyId: other.companyId,
          connectionId,
          experimentId: other.original.id,
        }),
      ).rejects.toThrow();
      await expect(
        previewUpdate(other.companyId, connectionId),
      ).rejects.toMatchObject({ status: 404 });
      const preview = await previewUpdate(f.companyId, connectionId);
      await db
        .update(factRecords)
        .set({ value: "40000", updatedAt: new Date() })
        .where(eq(factRecords.id, f.factId));
      await expect(saveUpdate(f.companyId, preview)).rejects.toMatchObject({
        status: 409,
      });
      const saved = await saveUpdate(
        f.companyId,
        await previewUpdate(f.companyId, connectionId),
      );
      await updateScenario(
        f.companyId,
        saved.scenarioId,
        { changes: [] },
        actor,
      );
      await expect(approve(f, saved.scenarioId)).rejects.toThrow(
        "edited separately",
      );
      await db
        .update(factRecords)
        .set({ status: "pending" })
        .where(eq(factRecords.id, f.factId));
      expect(
        (await loadOperatingConnections(f.companyId)).connected[0]?.status,
      ).toBe("blocked");
      await expect(previewUpdate(f.companyId, connectionId)).rejects.toThrow(
        "no longer approved",
      );
      await db.delete(factRecords).where(eq(factRecords.id, f.factId));
      await expect(previewUpdate(f.companyId, connectionId)).rejects.toThrow(
        "unavailable",
      );
    });
    it("replaces only future months after rollover and refuses outside edits to owned items", async () => {
      const f = await seed();
      await approve(f, f.original.scenarioId);
      const connectionId = await connect(f, "2026-11");
      await db
        .update(factRecords)
        .set({ value: "30000", updatedAt: new Date() })
        .where(eq(factRecords.id, f.factId));
      const november = new Date("2026-11-05T12:00:00Z");
      const preview = await previewUpdate(f.companyId, connectionId, november);
      expect(preview.replaces).toBe(2);
      expect(
        preview.path.changes
          .filter((c) => c.kind === "add_driver")
          .map((c) => c.effectiveFrom),
      ).toEqual(["2026-11", "2026-12"]);
      const before = (
        await loadGoalReview(f.companyId, november)
      ).forecastMonths.filter((m) => m.basis === "actual");
      const update = await saveUpdate(f.companyId, preview, november);
      await approve(f, update.scenarioId, november);
      expect(
        (await loadGoalReview(f.companyId, november)).forecastMonths.filter(
          (m) => m.basis === "actual",
        ),
      ).toEqual(before);
      const items = await db
        .select()
        .from(economicItems)
        .where(
          and(
            eq(economicItems.companyId, f.companyId),
            eq(economicItems.effectiveFrom, "2026-12"),
          ),
        );
      const current = items.find((i) => !i.effectiveTo)!;
      await db
        .update(economicItems)
        .set({ amount: "1" })
        .where(eq(economicItems.id, current.id));
      await expect(
        previewUpdate(f.companyId, connectionId, november),
      ).rejects.toThrow("changed outside");
    });
    it("blocks an owned item or settlement captured after saving, including a fresh decision preview", async () => {
      const f = await seed();
      await approve(f, f.original.scenarioId);
      const connectionId = await connect(f);
      await db
        .update(factRecords)
        .set({ value: "30000", updatedAt: new Date() })
        .where(eq(factRecords.id, f.factId));
      const preview = await previewUpdate(f.companyId, connectionId);
      const saved = await saveUpdate(f.companyId, preview);
      // Reconciliation offers current-month candidates only; replacement effects
      // also include future months and have no guaranteed database order.
      const currentItems = await db
        .select({ id: economicItems.id })
        .from(economicItems)
        .where(
          and(
            eq(economicItems.companyId, f.companyId),
            eq(economicItems.effectiveFrom, now.toISOString().slice(0, 7)),
            inArray(
              economicItems.id,
              preview.path.changes.flatMap((c) =>
                c.kind === "end_item" ? [c.itemId] : [],
              ),
            ),
          ),
        );
      expect(currentItems).toHaveLength(1);
      const itemId = currentItems[0]!.id;
      await db
        .update(economicItems)
        .set({ amount: "19000" })
        .where(eq(economicItems.id, itemId));
      await expect(approve(f, saved.scenarioId)).rejects.toThrow(
        "changed after",
      );
      await db
        .update(economicItems)
        .set({ amount: "20000" })
        .where(eq(economicItems.id, itemId));
      const reconciliation = await loadForecastReconciliation(f.companyId, now);
      const candidate = reconciliation.candidates.find(
        (c) => c.definition.driverId === itemId,
      )!;
      expect(candidate).toBeDefined();
      await executeForecastReconciliation(
        f.companyId,
        {
          action: "capture",
          candidateKey: candidate.definition.key,
          candidateHash: candidate.hash,
          independentObligation: true,
          reason: "Synthetic reviewed collection",
          requestKey: randomUUID(),
        },
        actor,
        now,
      );
      await expect(previewUpdate(f.companyId, connectionId)).rejects.toThrow(
        "reviewed collection",
      );
    });
    it("reviews AI source mappings and versions accepted replacements without changing original connections", async () => {
      const f = await seed();
      await approve(f, f.original.scenarioId);
      const connectionId = await connect(f);
      const [newFact] = await db
        .insert(factRecords)
        .values({
          companyId: f.companyId,
          evidenceId: f.documentId,
          label: "Updated monthly receipts",
          value: "30000",
          currency: "USD",
          confidence: "high",
          status: "pending",
        })
        .returning();
      const suggestion = {
        nodeId: "receipt",
        factId: newFact!.id,
        from: "2026-10",
        reason: "Updated numeric receipt assumption",
        uncertainty: "Verify monthly timing and units",
      };
      providerMock.generate.mockResolvedValueOnce({
        suggestions: [suggestion],
      });
      const proposed = (await execute(
        f.companyId,
        { action: "suggest_sources", connectionId, experimentId: null },
        actor,
        now,
      )) as { suggestions: { canConnect: boolean }[] };
      expect(proposed.suggestions[0]?.canConnect).toBe(false);
      const bindings = [
        {
          nodeId: "receipt",
          factId: newFact!.id,
          from: "2026-10",
          unit: "USD",
          reason: "Reviewed new source meaning and timing",
        },
      ];
      await expect(
        execute(
          f.companyId,
          { action: "preview_update", connectionId, bindings },
          actor,
          now,
        ),
      ).rejects.toThrow("no longer approved");
      await db
        .update(factRecords)
        .set({ status: "approved" })
        .where(eq(factRecords.id, newFact!.id));
      const preview = (
        (await execute(
          f.companyId,
          { action: "preview_update", connectionId, bindings },
          actor,
          now,
        )) as { preview: OperatingUpdatePreview }
      ).preview;
      expect(preview.assumptions[0]).toMatchObject({
        factId: newFact!.id,
        value: "30000",
        before: "20000",
      });
      const saved = await saveUpdate(f.companyId, preview);
      // The replacement follows its new source, not the old source's subsequent status.
      await db
        .update(factRecords)
        .set({ status: "rejected" })
        .where(eq(factRecords.id, f.factId));
      await approve(f, saved.scenarioId);
      const workspace = await loadOperatingConnections(f.companyId);
      expect(workspace.connected[0]?.bindings).toEqual(bindings);
      expect(workspace.connected[0]?.status).toBe("current");
      const [connection] = await db
        .select()
        .from(operatingConnections)
        .where(eq(operatingConnections.id, connectionId));
      expect(connection!.bindings).toMatchObject([{ factId: f.factId }]);
      expect(
        (await loadOperatingExperiment(f.companyId, saved.id)).snapshot,
      ).toMatchObject({ live: { bindings } });
      expect(
        (await loadGoalReview(f.companyId, now)).forecastMonths.find(
          (m) => m.month === "2026-12",
        )?.endingCashMinor,
      ).toBe("17000000");
    });
    it("rejects invented source mappings and cross-company targets, and bounds provider failures", async () => {
      const f = await seed();
      const other = await seed();
      providerMock.generate.mockResolvedValueOnce({
        suggestions: [
          {
            nodeId: "receipt",
            factId: other.factId,
            from: "2026-10",
            reason: "Invalid",
            uncertainty: "Unknown",
          },
        ],
      });
      await expect(
        execute(
          f.companyId,
          {
            action: "suggest_sources",
            experimentId: f.original.id,
            connectionId: null,
          },
          actor,
          now,
        ),
      ).rejects.toThrow("could not be generated or validated");
      const before = providerMock.generate.mock.calls.length;
      await expect(
        execute(
          other.companyId,
          {
            action: "suggest_sources",
            experimentId: f.original.id,
            connectionId: null,
          },
          actor,
          now,
        ),
      ).rejects.toMatchObject({ status: 404 });
      expect(providerMock.generate.mock.calls.length).toBe(before);
      providerMock.generate.mockRejectedValueOnce(
        new Error("secret provider payload"),
      );
      await expect(
        execute(
          f.companyId,
          {
            action: "suggest_sources",
            experimentId: f.original.id,
            connectionId: null,
          },
          actor,
          now,
        ),
      ).rejects.toThrow(
        "Source suggestions could not be generated or validated.",
      );
    });
    it("rejection restores the applied mappings even when the rejected source later becomes invalid", async () => {
      const f = await seed();
      await approve(f, f.original.scenarioId);
      const connectionId = await connect(f);
      const before = await loadGoalReview(f.companyId, now);
      const [replacement] = await db
        .insert(factRecords)
        .values({
          companyId: f.companyId,
          evidenceId: f.documentId,
          label: "Alternative numeric source",
          value: "30000",
          currency: "USD",
          confidence: "high",
          status: "approved",
        })
        .returning();
      const bindings = [
        {
          nodeId: "receipt",
          factId: replacement!.id,
          from: "2026-10",
          unit: "USD",
        },
      ];
      const preview = (
        (await execute(
          f.companyId,
          { action: "preview_update", connectionId, bindings },
          actor,
          now,
        )) as { preview: OperatingUpdatePreview }
      ).preview;
      const saved = await saveUpdate(f.companyId, preview);
      await execute(
        f.companyId,
        {
          action: "reject_update",
          connectionId,
          experimentId: saved.id,
          reason: "Keep original source",
        },
        actor,
        now,
      );
      await db
        .update(factRecords)
        .set({ status: "rejected" })
        .where(eq(factRecords.id, replacement!.id));
      expect(await loadGoalReview(f.companyId, now)).toEqual(before);
      const workspace = await loadOperatingConnections(f.companyId);
      expect(workspace.connected[0]?.status).toBe("rejected");
      expect(workspace.connected[0]?.bindings[0]?.factId).toBe(f.factId);
      expect(
        (await previewUpdate(f.companyId, connectionId)).assumptions[0]?.value,
      ).toBe("20000");
    });
  },
);
