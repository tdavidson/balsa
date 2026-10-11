import { describe, expect, it } from "vitest";
import { buildReviewQueue, evidenceReadyToAssume, type QueueEvidence } from "./review-queue";

const assessment = (score: number, amount: number | null, minor = false, reasons: string[] = []) => ({ score, amount, minor, reasons });
const doc = (overrides: Partial<QueueEvidence> = {}): QueueEvidence => ({
  id: "doc-a",
  sourceName: "Synthetic statement.pdf",
  status: "pending",
  identityStatus: "approved",
  identityAssessment: { score: 0.95, reasons: ["Source type recognized with high confidence"] },
  extraction: { facts: [
    { label: "Ending balance", value: "14,250.75", factId: "f1", factStatus: "pending", assessment: assessment(0.97, 14250.75) },
    { label: "Deposit", value: "2,000.00", factId: "f2", factStatus: "pending", assessment: assessment(0.62, 2000) },
    { label: "Wire", value: "9,000.00", factId: "f3", factStatus: "approved", assessment: assessment(0.4, 9000, false, ["The source does not establish an accounting role"]) },
    { label: "Service fee", value: "4.00", factId: "f4", factStatus: "pending", assessment: assessment(0.7, 4, true) },
    { label: "Interest", value: "1.10", factId: "f5", factStatus: "treatment_approved", assessment: { ...assessment(0.99, 1.1, true), assumed: { threshold: 0.9, score: 0.99, at: "2026-10-01T00:00:00.000Z" } } },
    { label: "Opening balance", value: "12,500.00", factId: "f6", factStatus: "treatment_approved", assessment: assessment(0.99, 12500) },
  ] },
  ...overrides,
});

describe("review queue", () => {
  it("ranks decisions by amount, groups immaterial facts, lists assumptions, and hides what a person settled", () => {
    const queue = buildReviewQueue([doc()], 0.9);
    expect(queue.decisions.map((item) => [item.fact.label, item.reason])).toEqual([["Wire", "The source does not establish an accounting role"], ["Deposit", "62% confident, below your 90%"]]);
    expect(queue.minor.map((group) => group.items.map((item) => item.fact.label))).toEqual([["Service fee"]]);
    expect(queue.assumed.map((item) => item.fact.label)).toEqual(["Interest"]);
    // The confident ending balance waits for the automatic pass rather than asking.
    expect(queue.decisions.some((item) => item.fact.label === "Ending balance")).toBe(false);
  });

  it("asks about every material fact when the owner has not set a level", () => {
    expect(buildReviewQueue([doc()], null).decisions.map((item) => item.fact.label)).toEqual(["Ending balance", "Wire", "Deposit"]);
  });

  it("asks again about a fact a person reopened, even above the threshold", () => {
    const reopened = doc();
    reopened.extraction!.facts[0]!.assessment = { ...assessment(0.97, 14250.75), reopened: true };
    const queue = buildReviewQueue([reopened], 0.9);
    expect(queue.decisions[0]).toMatchObject({ reason: "You asked to review this" });
    expect(evidenceReadyToAssume([reopened], 0.9)).toEqual([]);
  });

  it("shows an unconfirmed document once instead of its facts, and skips rejected or processing sources", () => {
    const queue = buildReviewQueue([doc({ identityStatus: "pending", identityAssessment: { score: 0.5, reasons: ["Source type recognized with low confidence", "No reporting period was established"] } }), doc({ id: "b", identityStatus: "rejected" }), doc({ id: "c", ingestionStatus: "extracting" })], 0.9);
    expect(queue.documents).toHaveLength(1);
    expect(queue.documents[0]).toMatchObject({ pendingFacts: 4, reason: "No reporting period was established" });
    expect(queue.decisions).toEqual([]);
  });

  it("finds documents the automatic pass can act on only when a level is set", () => {
    expect(evidenceReadyToAssume([doc()], null)).toEqual([]);
    expect(evidenceReadyToAssume([doc()], 0.9).map((item) => item.id)).toEqual(["doc-a"]);
    expect(evidenceReadyToAssume([doc({ identityStatus: "pending", identityAssessment: { score: 0.8, reasons: [] } })], 0.9)).toEqual([]);
  });
});
