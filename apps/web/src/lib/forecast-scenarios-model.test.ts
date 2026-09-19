import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

config({ path: fileURLToPath(new URL("../../../../.env.local", import.meta.url)) });
config({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)) });
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!process.env.DATABASE_URL)("forecast scenarios with model changes", async () => {
  if (!process.env.DATABASE_URL) return;
  const { closeDatabase, companies, decisions, getDatabase } = await import("@finance/database");
  const { seedModelCompany } = await import("./forecast-model-fixture");
  const { loadScenarioForecast, loadScenarioForecastWith } = await import("./forecast-scenarios");
  const { createScenario, createScenarioWith, promoteScenario, ScenarioInvalid } = await import("./scenarios");
  const { parseStoredEffect } = await import("./decision-effects");
  const { createTestDatabase } = await import("./test-database");
  const db = getDatabase();
  let seeded!: Awaited<ReturnType<typeof seedModelCompany>>;

  beforeAll(async () => { seeded = await seedModelCompany("Model scenarios"); });
  afterAll(async () => { if (seeded?.companyId) await db.delete(companies).where(eq(companies.id, seeded.companyId)); await closeDatabase(); });

  it("changes formula-driven payroll and rejects invalid model changes before writing", async () => {
    const scenario = await createScenario(seeded.companyId, { name: "Hire two engineers", changes: [{ kind: "set_input", variable: "headcount", coords: { team: "Eng" }, from: seeded.firstMonth, value: "5" }] }, null);
    const view = await loadScenarioForecast(seeded.companyId, scenario.id);
    expect(view.runway.runwayMonths).not.toBe(20);
    await expect(createScenario(seeded.companyId, { name: "Bad coordinate", changes: [{ kind: "set_input", variable: "headcount", coords: { team: "Unknown" }, from: seeded.firstMonth, value: "5" }] }, null)).rejects.toBeInstanceOf(ScenarioInvalid);
  });

  it("coalesces variables and deterministically reorders transient-invalid changes", async () => {
    const scenario = await createScenario(seeded.companyId, { name: "Transient dependency", changes: [
      { kind: "set_formula", variable: "salary", formula: "headcount * 1000" },
      { kind: "set_input", variable: "headcount", coords: { team: "Eng" }, from: seeded.firstMonth, value: "4" },
      { kind: "set_input", variable: "headcount", coords: { team: "Sales" }, from: seeded.firstMonth, value: "3" },
    ] }, null);
    const promoted = await promoteScenario(seeded.companyId, scenario.id, null);
    const rows = await db.select({ id: decisions.id, effect: decisions.effect }).from(decisions).where(eq(decisions.companyId, seeded.companyId));
    const effects = promoted.decisionIds.map((id) => parseStoredEffect(rows.find((row) => row.id === id)?.effect));
    expect(effects.map((effect) => effect?.kind)).toEqual(["set_variable", "set_variable"]);
    expect(effects.map((effect) => effect?.kind === "set_variable" ? effect.variable.name : null)).toEqual(["salary", "headcount"]);
    expect(effects.filter((effect) => effect?.kind === "set_variable" && effect.variable.name === "headcount")).toHaveLength(1);
  });

  it("validates and saves with a one-connection pool", { timeout: 3_000 }, async () => {
    const single = createTestDatabase(process.env.DATABASE_URL!, { max: 1 });
    const bounded = <T>(work: Promise<T>) => Promise.race([work, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("single-connection scenario timed out")), 2_000))]);
    try {
      const scenario = await bounded(single.transaction((tx) => createScenarioWith(tx, seeded.companyId, { name: "One connection model scenario", changes: [{ kind: "set_input", variable: "headcount", coords: { team: "Eng" }, from: seeded.firstMonth, value: "5" }] }, null)));
      expect(scenario.changes).toHaveLength(1);
      expect((await loadScenarioForecastWith(single, seeded.companyId, scenario.id)).runway.runwayMonths).not.toBe(20);
    } finally { await single.end(); }
  });
});
