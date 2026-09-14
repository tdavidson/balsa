import { describe, expect, it } from "vitest";
import { validatePostingActivity } from "./posting-controls";

describe("validatePostingActivity", () => {
  it("blocks a transfer posted as revenue without policy", () => {
    expect(validatePostingActivity("transfer", ["asset", "revenue"], undefined)).toEqual([expect.stringMatching(/transfer cash activity/i)]);
  });
  it("allows operating posting and policy-backed exceptions", () => {
    expect(validatePostingActivity("operating", ["asset", "revenue"], undefined)).toEqual([]);
    expect(validatePostingActivity("financing", ["asset", "revenue"], "policy")).toEqual([]);
  });
});
