import { describe, expect, it } from "vitest";
import { assessDocumentIdentity, assessFact, compareDecisions, dispositionFor, documentMaxAmount, parseConfidenceThreshold, valueAppearsInSource } from "./review-assessment";

const source = "Synthetic Bank\nBeginning balance $12,500.00\nEnding balance 14,250.75\nService fee 4.00\nAccount holder Example Co";

describe("review assessment", () => {
  it("keeps model confidence when every deterministic check passes", () => {
    const result = assessFact({ label: "Ending balance", value: "$14,250.75", accountingRole: "ending_balance", confidence: 0.97 }, { rawText: source, documentMaxAmount: 14250.75 });
    expect(result.score).toBe(0.97);
    expect(result.amount).toBe(14250.75);
    expect(result.minor).toBe(false);
  });

  it("caps confidence when the amount is not in the source, whatever the model reported", () => {
    const result = assessFact({ label: "Ending balance", value: "$15,000.00", accountingRole: "ending_balance", confidence: 0.99 }, { rawText: source, documentMaxAmount: 15000 });
    expect(result.score).toBe(0.6);
    expect(result.reasons).toContain("The amount was not found in the source text");
  });

  it("never lets an unknown accounting role or an unreadable amount pass as confident", () => {
    expect(assessFact({ label: "Beginning balance", value: "12,500.00", accountingRole: "unknown", confidence: 1 }, { rawText: source, documentMaxAmount: 12500 }).score).toBe(0.4);
    expect(assessFact({ label: "Beginning balance", value: "twelve thousand", accountingRole: "opening_balance", confidence: 1 }, { rawText: "", documentMaxAmount: 12500 }).score).toBe(0.5);
  });

  it("finds amounts written with or without grouping and text values by content", () => {
    expect(valueAppearsInSource(source, "12500.00", 12500)).toBe(true);
    expect(valueAppearsInSource(source, "(4.00)", -4)).toBe(true);
    expect(valueAppearsInSource(source, "Example Co", null)).toBe(true);
    expect(valueAppearsInSource(source, "Other Co", null)).toBe(false);
  });

  it("skips the source check when no source text was stored", () => {
    expect(assessFact({ label: "Fee", value: "4.00", accountingRole: "expense", confidence: "0.9" }, { rawText: "", documentMaxAmount: 100 }).score).toBe(0.9);
  });

  it("groups uncertain immaterial amounts as less important and assumes at the owner's threshold", () => {
    const facts = [{ value: "$12,500.00" }, { value: "4.00" }, { value: "Example Co" }];
    const max = documentMaxAmount(facts);
    expect(max).toBe(12500);
    const fee = assessFact({ label: "Service fee", value: "4.00", accountingRole: "expense", confidence: 0.7 }, { rawText: source, documentMaxAmount: max });
    expect(fee.minor).toBe(true);
    expect(dispositionFor(fee, null)).toBe("minor");
    expect(dispositionFor(fee, 0.9)).toBe("minor");
    expect(dispositionFor({ score: 0.9, minor: false }, 0.9)).toBe("assumed");
    expect(dispositionFor({ score: 0.89, minor: false }, 0.9)).toBe("decide");
    expect(dispositionFor({ score: 1, minor: false }, null)).toBe("decide");
  });

  it("requires a person for unrecognized sources, reference models, and sources without a period", () => {
    expect(assessDocumentIdentity({ classificationConfidence: "high", kind: "bank_statement", reportingMonth: "2026-09" }).score).toBe(0.95);
    expect(assessDocumentIdentity({ classificationConfidence: "high", kind: "unknown", reportingMonth: "2026-09" }).score).toBe(0.4);
    expect(assessDocumentIdentity({ classificationConfidence: "high", kind: "financial_model", sourceRole: "reference_model", reportingMonth: "2026-09" }).score).toBe(0.4);
    expect(assessDocumentIdentity({ classificationConfidence: "high", kind: "bank_statement", reportingMonth: null }).score).toBe(0.5);
  });

  it("parses only thresholds in range and orders decisions by amount, then uncertainty", () => {
    expect(parseConfidenceThreshold("0.9")).toBe(0.9);
    expect(parseConfidenceThreshold("0.2")).toBeNull();
    expect(parseConfidenceThreshold(null)).toBeNull();
    const ordered = [{ score: 0.3, reasons: [], amount: 10, minor: false }, { score: 0.5, reasons: [], amount: 900, minor: false }, { score: 0.2, reasons: [], amount: 900, minor: false }].sort(compareDecisions);
    expect(ordered.map((item) => [item.amount, item.score])).toEqual([[900, 0.2], [900, 0.5], [10, 0.3]]);
  });
});
