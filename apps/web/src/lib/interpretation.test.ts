import { describe, expect, it } from "vitest";
import { categorizeTransactions, matchEntityAlias, normalizeAlias } from "./interpretation";

const entities = [
  { id: "carta", name: "Carta", type: "vendor", attributes: JSON.stringify({ category: "software", aliases: ["CARTA INC 4432"] }) },
  { id: "smith", name: "Smith LLP", type: "vendor", attributes: JSON.stringify({ category: "professional_services", aliases: [] }) },
  { id: "acct", name: "Operating 1234", type: "account", attributes: "{}" },
];

describe("matchEntityAlias", () => {
  it("strips reference numbers and matches stored aliases or names", () => {
    expect(normalizeAlias("CARTA INC 4432 REF 99812")).toBe("carta inc ref");
    expect(matchEntityAlias("CARTA INC 4432 REF 99812", entities)?.id).toBe("carta");
    expect(matchEntityAlias("ACH SMITH LLP INV 1842", entities)?.id).toBe("smith");
    expect(matchEntityAlias("Operating 1234 transfer", entities)).toBeUndefined();
    expect(matchEntityAlias("ADP PAYROLL", entities)).toBeUndefined();
  });
});

describe("categorizeTransactions", () => {
  const activityOf = (description: string) => (/transfer/i.test(description) ? "transfer" : "operating");
  it("resolves known counterparties without a model and falls back without a provider", async () => {
    const result = await categorizeTransactions({
      transactions: [
        { index: 0, description: "CARTA INC 4432", amount: 200, direction: "spend" },
        { index: 1, description: "TRANSFER TO SAVINGS", amount: 5000, direction: "spend" },
        { index: 2, description: "ADP PAYROLL", amount: 9000, direction: "spend" },
        { index: 3, description: "MYSTERY VENDOR", amount: 10, direction: "spend" },
      ],
      entities, policies: [], decisions: [], activityOf,
    });
    expect(result).toEqual([
      { index: 0, activity: "operating", category: "software", counterparty: "Carta", confidence: 1, source: "alias" },
      { index: 1, activity: "transfer", category: null, counterparty: null, confidence: 0.9, source: "alias" },
      { index: 2, activity: "operating", category: "salary", counterparty: null, confidence: 0.3, source: "fallback" },
      { index: 3, activity: "operating", category: null, counterparty: null, confidence: 0.3, source: "fallback" },
    ]);
  });
  it("sends only unknown transactions to the model", async () => {
    const seen: unknown[] = [];
    const provider = { name: "openai" as const, model: "test", getLastUsage: () => null, generateText: async () => "", generateStructured: async <T,>(request: { messages: { content: string }[] }) => { seen.push(JSON.parse(request.messages[0]!.content)); return { transactions: [{ index: 2, activity: "operating", category: "salary", counterparty: "ADP", confidence: 0.95 }] } as T; } };
    const result = await categorizeTransactions({ provider, transactions: [{ index: 0, description: "CARTA INC", amount: 1, direction: "spend" }, { index: 2, description: "ADP PAYROLL", amount: 9000, direction: "spend" }], entities, policies: [], decisions: [], activityOf });
    expect(seen).toEqual([[{ index: 2, description: "ADP PAYROLL", amount: 9000, direction: "spend" }]]);
    expect(result[1]).toMatchObject({ index: 2, category: "salary", counterparty: "ADP", source: "model" });
  });
});
