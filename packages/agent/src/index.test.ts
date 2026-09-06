import { describe, expect, it } from "vitest";
import { createProposeDecisionTool, createQueryForecastTool, createTraceValueTool } from "./index";

describe("controlled agent tools", () => {
  it("uses the server context company and ignores model company ids", async () => {
    const result = await createProposeDecisionTool().execute({ companyId: "authorized", state: { sources: [], observations: [], entities: [], relationships: [], agreements: [], facts: [], events: [], obligations: [], decisions: [], policies: [], assumptions: [], scenarios: [], allocations: [], reviewItems: [] } }, { companyId: "untrusted", question: "q", answer: "a" });
    expect(result).toMatchObject({ companyId: "authorized", status: "proposed" });
  });

  it("queries only the authorized deterministic forecast", async () => {
    const context = { companyId: "authorized", state: { sources: [], observations: [], entities: [], relationships: [], agreements: [], facts: [], events: [], obligations: [], decisions: [], policies: [], assumptions: [], scenarios: [], allocations: [], reviewItems: [] }, forecast: [{ month: "2026-09", receipts: 100, spending: 20, net: 80, endingCash: 180 }] };
    await expect(createQueryForecastTool().execute(context, { companyId: "untrusted", month: "2026-09" })).resolves.toMatchObject({ companyId: "authorized", months: [{ month: "2026-09" }] });
  });

  it("traces a value from the authorized forecast", async () => {
    const context = { companyId: "authorized", state: { sources: [], observations: [], entities: [], relationships: [], agreements: [], facts: [], events: [], obligations: [], decisions: [], policies: [], assumptions: [], scenarios: [], allocations: [], reviewItems: [] }, forecast: [{ month: "2026-09", receipts: 100, spending: 20, net: 80, endingCash: 180, trace: [{ description: "bank.csv" }] }] };
    await expect(createTraceValueTool().execute(context, { month: "2026-09" })).resolves.toMatchObject({ companyId: "authorized", month: "2026-09", value: { endingCash: 180 } });
  });
});
