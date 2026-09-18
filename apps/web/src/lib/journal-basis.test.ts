import { describe, expect, it } from "vitest";
import { entryBasisFromStored } from "./journal-basis";

describe("entryBasisFromStored", () => {
  it("reads posted forecast journals as pinned plans", () => {
    expect(entryBasisFromStored("forecast")).toBe("plan");
    expect(entryBasisFromStored("plan")).toBe("plan");
    expect(entryBasisFromStored("actual")).toBe("actual");
    expect(entryBasisFromStored("scenario")).toBe("scenario");
    expect(entryBasisFromStored("nonsense")).toBeUndefined();
  });
});
