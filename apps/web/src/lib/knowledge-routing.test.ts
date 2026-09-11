import { describe, expect, it } from "vitest";
import { knowledgeDestinationForFact } from "./knowledge-routing";

describe("knowledgeDestinationForFact", () => {
  it("routes durable company findings without storing transaction detail", () => {
    expect(knowledgeDestinationForFact({ label: "Account holder", value: "Laconia Advisory Services LLC" })).toBe("company");
    expect(knowledgeDestinationForFact({ label: "Management agreement", value: "$10,000 monthly", accountingRole: "agreement" })).toBe("forecast");
    expect(knowledgeDestinationForFact({ label: "Account ending", value: "255" })).toBe("accounting");
    expect(knowledgeDestinationForFact({ label: "Transaction 2026-09-03", value: "+$3,100 customer receipt", accountingRole: "transaction" })).toBeNull();
  });

  it("prioritizes policy and allocation rules", () => {
    expect(knowledgeDestinationForFact({ label: "Allocation policy", value: "Split shared costs equally" })).toBe("allocations");
    expect(knowledgeDestinationForFact({ label: "Accounting treatment", value: "Treat deposits as transfers" })).toBe("policies");
  });
});
