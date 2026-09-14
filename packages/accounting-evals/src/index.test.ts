import { describe, expect, it } from "vitest";
import { accountingEvals, runAccountingEvals, summarizeAccountingEvals } from "./index";

describe("accounting evaluation corpus", () => {
  it("runs every gold fixture without a regression", () => {
    expect(runAccountingEvals()).toEqual(accountingEvals.map((fixture) => expect.objectContaining({ id: fixture.id, passed: true, errors: [] })));
  });

  it("reports stage-level quality metrics", () => {
    const summary = summarizeAccountingEvals(runAccountingEvals());
    expect(summary).toMatchObject({ fixtures: accountingEvals.length, passed: accountingEvals.length, failed: 0 });
    expect(summary.byStage.extraction).toMatchObject({ fixtures: 1, passRate: 1 });
    expect(summary.byStage.fx).toMatchObject({ fixtures: 1, passRate: 1 });
  });
});
