import { describe, expect, it } from "vitest";
import { compareEvidenceFacts } from "./evidence-diff";

describe("compareEvidenceFacts", () => {
  it("identifies added, removed, and changed facts", () => {
    expect(compareEvidenceFacts(
      [{ label: "Ending balance", value: "$100" }, { label: "Old fact", value: "yes" }],
      [{ label: "Ending balance", value: "$125" }, { label: "New fact", value: "yes" }],
    )).toEqual({
      added: [{ label: "New fact", value: "yes" }],
      removed: [{ label: "Old fact", value: "yes" }],
      changed: [{ label: "Ending balance", before: "$100", after: "$125" }],
    });
  });
});
