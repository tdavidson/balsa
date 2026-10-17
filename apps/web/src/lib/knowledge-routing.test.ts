import { describe, expect, it } from "vitest";
import { knowledgeDestinationForFact } from "./knowledge-routing";

describe("knowledgeDestinationForFact", () => {
  it("routes durable company findings without storing transaction detail", () => {
    expect(knowledgeDestinationForFact({ label: "Account holder", value: "Synthetic Example Company LLC" })).toBe("company");
    expect(knowledgeDestinationForFact({ label: "Management agreement", value: "$1,200 monthly", accountingRole: "agreement" })).toBe("forecast");
    expect(knowledgeDestinationForFact({ label: "Account ending", value: "1234" })).toBe("accounting");
    expect(knowledgeDestinationForFact({ label: "Transaction 2025-01-15", value: "+$250 customer receipt", accountingRole: "transaction" })).toBeNull();
  });

  it("prioritizes policy and allocation rules", () => {
    expect(knowledgeDestinationForFact({ label: "Allocation policy", value: "Split shared costs equally" })).toBe("allocations");
    expect(knowledgeDestinationForFact({ label: "Accounting treatment", value: "Treat deposits as transfers" })).toBe("policies");
  });
});
