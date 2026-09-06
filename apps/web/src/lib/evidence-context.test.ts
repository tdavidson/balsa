import { describe, expect, it } from "vitest";
import { relevantEvidenceContext } from "./evidence-context";

describe("relevantEvidenceContext", () => {
  const documents = [
    { id: "fees", sourceName: "July bank statement.csv", rawText: "Date,Amount,Note\n2026-07-14,60000,Klingenstein Fund II management fee\n2026-07-20,-30000,Klingenstein partner payout", extractedJson: JSON.stringify({ summary: "July statement", facts: [{ label: "2026-07-14 Klingenstein", value: "$60,000" }, { label: "Unrelated", value: "$2" }], questions: [] }) },
    { id: "payroll", sourceName: "Payroll.csv", rawText: "2026-07-15,-12000,Payroll" },
  ];

  it("returns statement lines containing the identifying note, exact date, and amount", () => {
    const [context] = relevantEvidenceContext(documents, "Which Klingenstein wires were received?", "fees");
    expect(context?.excerpt).toContain("2026-07-14,60000,Klingenstein Fund II management fee");
    expect(context?.excerpt).toContain("2026-07-20,-30000,Klingenstein partner payout");
    expect(context?.sourceName).toBe("July bank statement.csv");
    expect(context?.extracted).toEqual({ summary: "July statement", facts: [{ label: "2026-07-14 Klingenstein", value: "$60,000" }], questions: [] });
  });

  it("keeps focused evidence available even when the follow-up uses pronouns", () => {
    const [context] = relevantEvidenceContext(documents, "can't you figure that out?", "fees");
    expect(context?.excerpt).toContain("Klingenstein");
  });
});
