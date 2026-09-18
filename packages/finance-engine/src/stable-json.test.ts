import { describe, expect, it } from "vitest";
import { stableJson } from "./stable-json";

describe("stableJson", () => {
  it("is independent of key order and drops undefined", () => {
    expect(stableJson({ b: 1, a: { d: undefined, c: [2, "x"] } })).toBe(stableJson({ a: { c: [2, "x"] }, b: 1 }));
    expect(stableJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
});
