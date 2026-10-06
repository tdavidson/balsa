import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { OperatingModel } from "@balsa/finance-engine";
import type { OperatingPreview } from "./operating-models";
const mocks = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock("./models", () => ({ getModelProvider: () => ({ name: "openai", model: "synthetic", generateStructured: mocks.generate, getLastUsage: () => null }) }));
config({ path: fileURLToPath(new URL("../../../../.env.local", import.meta.url)), quiet: true });
config({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)), quiet: true });
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const model: OperatingModel = { name: "Synthetic operating experiment", description: "A generic monthly cash input with an alternative", startMonth: "2026-10", months: 3, nodes: [{ id: "receipt", label: "Incremental receipts", unit: "USD", op: "input", args: [], values: [{ month: "2026-10", value: "20000" }, { month: "2026-11", value: "0" }], initial: null, rationale: "Synthetic illustrative assumption", evidenceIds: [] }], outputs: [{ nodeId: "receipt", label: "Incremental receipts", direction: "receipt", category: "other" }], cases: [{ id: "smaller", name: "Smaller receipt", rationale: "Explicit stress case", overrides: [{ nodeId: "receipt", values: [{ month: "2026-10", value: "10000" }, { month: "2026-11", value: "0" }] }] }], limitations: ["Illustrative fixture only"] };
describe.skipIf(!process.env.DATABASE_URL)("operating models through the shared accounting engine", async () => {
  if (!process.env.DATABASE_URL) return;
  const { companies, users, chartAccounts, economicItems, forecastEntryTemplates, operatingExperiments, scenarios, getDatabase, closeDatabase } = await import("@finance/database");
  const { executeOperatingCommand: execute, loadOperatingExperiment, loadOperatingWorkspace } = await import("./operating-models");
  const { loadScenarioForecast } = await import("./forecast-scenarios");
  const db = getDatabase(); const ids: string[] = []; let actor = "";
  const now = new Date("2026-10-05T12:00:00Z");
  async function seed() {
    if (!actor) { const [user] = await db.insert(users).values({ authProvider: "test", authProviderUserId: randomUUID(), email: "operating-model-test@example.test" }).returning(); actor = user!.id; }
    const [company] = await db.insert(companies).values({ name: `Synthetic operating ${randomUUID()}` }).returning(); const companyId = company!.id; ids.push(companyId);
    const [cash, revenue] = await db.insert(chartAccounts).values([{ companyId, code: "1000", name: "Cash", accountType: "asset", normalBalance: "debit", statementLine: "Cash" }, { companyId, code: "4000", name: "Revenue", accountType: "revenue", normalBalance: "credit" }]).returning();
    await db.insert(forecastEntryTemplates).values({ companyId, name: "Receipts", itemType: "agreement", direction: "receipt", debitAccountId: cash!.id, creditAccountId: revenue!.id });
    return companyId;
  }
  afterAll(async () => { if (ids.length) await db.delete(companies).where(inArray(companies.id, ids)); if (actor) await db.delete(users).where(eq(users.id, actor)); await closeDatabase(); });
  const preview = async (companyId: string, value = model) => (await execute(companyId, { action: "preview", model: value }, actor, now) as { preview: OperatingPreview }).preview;
  it("preserves a reproducible experiment, saves idempotently, and leaves the base untouched", async () => {
    const companyId = await seed(); const before = await preview(companyId);
    expect(before.paths[0]?.forecast.months.find((m) => m.month === "2026-10")?.endingCashMinor).toBe("2000000");
    expect(before.paths[1]?.forecast.months.find((m) => m.month === "2026-10")?.endingCashMinor).toBe("1000000");
    const command = { action: "save", model, caseId: "base", previewToken: before.previewToken, requestKey: randomUUID(), acknowledgeAssumptions: true };
    const saved = await execute(companyId, command, actor, now) as { saved: { id: string; scenarioId: string } };
    expect(await execute(companyId, command, actor, now)).toMatchObject(saved);
    expect((await loadOperatingWorkspace(companyId, now)).saved).toHaveLength(1);
    const original = await loadOperatingExperiment(companyId, saved.saved.id);
    expect(original.snapshot).toMatchObject({ model, path: { operating: { formulaVersion: "operating-model-2026-10-05.1" } } });
    const scenario = await loadScenarioForecast(companyId, saved.saved.scenarioId, now);
    expect(scenario.months).toEqual(before.paths[0]!.forecast.months.filter((m) => m.basis === "forecast").map((m) => expect.objectContaining({ month: m.month, openingCashMinor: m.openingCashMinor, endingCashMinor: m.endingCashMinor, receiptsMinor: m.receiptsMinor, spendingMinor: m.spendingMinor })));
    expect((await preview(companyId)).baseMonths).toEqual(before.baseMonths);
    expect(await db.select().from(economicItems).where(eq(economicItems.companyId, companyId))).toHaveLength(0);
    await expect(db.update(operatingExperiments).set({ name: "Rewrite history" }).where(eq(operatingExperiments.id, saved.saved.id))).rejects.toThrow();
    const other = await seed();
    await expect(loadOperatingExperiment(other, saved.saved.id)).rejects.toMatchObject({ status: 404 });
    await expect(db.insert(operatingExperiments).values({ companyId: other, scenarioId: saved.saved.scenarioId, name: "Cross-company", requestKey: randomUUID(), requestHash: "x", snapshot: {} })).rejects.toThrow();
    expect(await loadOperatingExperiment(companyId, saved.saved.id)).toEqual(original);
  });
  it("rejects stale assumptions, foreign sources, wrong cash units and historical mutation", async () => {
    const companyId = await seed(); const first = await preview(companyId);
    const changed = { ...model, name: "Changed model" };
    await expect(execute(companyId, { action: "save", model: changed, caseId: "base", previewToken: first.previewToken, requestKey: randomUUID(), acknowledgeAssumptions: true }, actor, now)).rejects.toMatchObject({ status: 409 });
    await expect(preview(companyId, { ...model, nodes: model.nodes.map((n) => ({ ...n, evidenceIds: [randomUUID()] })) })).rejects.toMatchObject({ status: 404 });
    await expect(preview(companyId, { ...model, nodes: model.nodes.map((n) => ({ ...n, unit: "EUR" })) })).rejects.toMatchObject({ status: 422 });
    await expect(preview(companyId, { ...model, startMonth: "2026-09" })).rejects.toMatchObject({ status: 422 });
    expect(await db.select().from(scenarios).where(eq(scenarios.companyId, companyId))).toHaveLength(0);
  });
  it("validates AI drafts without approving them, and bounds provider errors", async () => {
    const companyId = await seed(); mocks.generate.mockResolvedValueOnce(model);
    expect(await execute(companyId, { action: "draft", prompt: "Build a synthetic model", previous: null }, actor, now)).toMatchObject({ model });
    expect(await db.select().from(scenarios).where(eq(scenarios.companyId, companyId))).toHaveLength(0);
    mocks.generate.mockRejectedValueOnce(new Error("secret provider response"));
    await expect(execute(companyId, { action: "draft", prompt: "Revise it", previous: model }, actor, now)).rejects.toThrow("could not be generated or validated");
  });
  it("preserves decision ranges and deterministic analysis with the saved scenario", async () => {
    const companyId=await seed();
    const framed:OperatingModel={...model,decision:{question:"Which receipt plan funds delivery?",deadline:null,constraints:["Maintain quality"],caseId:"base",compareCaseId:"smaller",metric:"ending_cash",cashFloorMinor:"0",ranges:[{nodeId:"receipt",from:"2026-10",low:"10000",high:"30000"}]}};
    const view=await preview(companyId,framed);
    expect(view.decisionAnalysis?.choices[0]?.name).toContain("Do nothing");
    const saved=await execute(companyId,{action:"save",model:framed,caseId:"base",previewToken:view.previewToken,requestKey:randomUUID(),acknowledgeAssumptions:true},actor,now) as {saved:{id:string}};
    expect((await loadOperatingExperiment(companyId,saved.saved.id)).snapshot).toMatchObject({decisionAnalysis:{formulaVersion:"operating-decision-2026-10-05.1",spec:framed.decision}});
    await expect(execute(companyId,{action:"save",model:{...framed,decision:{...framed.decision!,cashFloorMinor:"99999"}},caseId:"base",previewToken:view.previewToken,requestKey:randomUUID(),acknowledgeAssumptions:true},actor,now)).rejects.toMatchObject({status:409});
  });

});
