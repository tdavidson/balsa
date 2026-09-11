import { describe, expect, it } from "vitest";
import { takeRateLimit } from "./request-rate-limit";

describe("takeRateLimit", () => {
  it("allows requests through the configured limit and blocks the next one", () => {
    const key = `test:${crypto.randomUUID()}`;
    expect(takeRateLimit(key, 2, 60_000).allowed).toBe(true);
    expect(takeRateLimit(key, 2, 60_000).allowed).toBe(true);
    const blocked = takeRateLimit(key, 2, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });
});
