import { describe, expect, it } from "vitest";
import { validQuestionsForSource } from "./source-review-questions";

describe("source-specific review questions", () => {
  it("removes PDF remediation from non-PDF sources", () => {
    expect(validQuestionsForSource([
      "Please provide a searchable or OCR-processed PDF.",
      "Which account owns this workbook?",
    ], { isPdf: false })).toEqual(["Which account owns this workbook?"]);
  });

  it("retains PDF remediation for actual PDFs", () => {
    const question = "Please provide a searchable or OCR-processed PDF.";
    expect(validQuestionsForSource([question], { isPdf: true })).toEqual([question]);
  });
});
