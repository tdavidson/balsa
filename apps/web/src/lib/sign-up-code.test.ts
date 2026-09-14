import { describe, expect, it } from "vitest";
import { matchesSignUpCode } from "./sign-up-code";

describe("matchesSignUpCode", () => {
  it("accepts the configured code, ignoring surrounding whitespace in the configuration", () => {
    expect(matchesSignUpCode("letmein-1234", "letmein-1234")).toBe(true);
    expect(matchesSignUpCode("letmein-1234", "  letmein-1234  ")).toBe(true);
  });
  it("rejects a wrong code, including a prefix of the right one", () => {
    expect(matchesSignUpCode("letmein-1235", "letmein-1234")).toBe(false);
    expect(matchesSignUpCode("letmein", "letmein-1234")).toBe(false);
  });
  it("rejects a missing or empty presented value", () => {
    expect(matchesSignUpCode(null, "letmein-1234")).toBe(false);
    expect(matchesSignUpCode("", "letmein-1234")).toBe(false);
  });
  it("never matches when no code is configured, so an empty header cannot pass", () => {
    expect(matchesSignUpCode("", undefined)).toBe(false);
    expect(matchesSignUpCode("anything", undefined)).toBe(false);
    expect(matchesSignUpCode("", "   ")).toBe(false);
  });
});
