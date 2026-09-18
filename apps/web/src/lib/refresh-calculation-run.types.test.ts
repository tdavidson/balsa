import { describe, expectTypeOf, it } from "vitest";
import type { refreshCurrentCalculationRun } from "./refresh-calculation-run";
import type { RevisionCause } from "./revision-cause";

type Options = Parameters<typeof refreshCurrentCalculationRun>[1];

describe("refreshCurrentCalculationRun", () => {
  it("requires a cause for every revision", () => {
    expectTypeOf<Options["cause"]>().toEqualTypeOf<RevisionCause>();
    // @ts-expect-error a revision without a cause must not compile
    const missing: Options = { journalPeriods: [] };
    void missing;
  });
});
