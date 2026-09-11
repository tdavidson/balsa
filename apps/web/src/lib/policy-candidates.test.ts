import { describe, expect, it } from "vitest";
import { findPolicyCandidates } from "./policy-candidates";

describe("findPolicyCandidates", () => {
  it("only proposes repeated applied judgments", () => {
    const candidates = findPolicyCandidates([
      { id: "1", question: "How should deposits be treated?", answer: "Treat automatic deposits as internal transfers.", status: "applied" },
      { id: "2", question: "How should the sweep be treated?", answer: "Treat automatic deposits as internal transfers.", status: "applied" },
      { id: "3", question: "What about this receipt?", answer: "Treat automatic deposits as internal transfers.", status: "proposed" },
    ]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.decisionIds).toEqual(["1", "2"]);
  });

  it("does not promote a one-off judgment", () => {
    expect(findPolicyCandidates([{ id: "1", question: "Question", answer: "Use the statement date.", status: "applied" }])).toEqual([]);
  });
});
