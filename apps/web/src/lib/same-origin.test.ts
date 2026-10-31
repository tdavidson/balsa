import { describe, expect, it } from "vitest";
import { isCrossOriginMutation } from "./same-origin";

const configured = "http://localhost:3000";

describe("isCrossOriginMutation", () => {
  it("accepts the configured origin", () => {
    expect(isCrossOriginMutation({ origin: configured, host: "localhost:3000", fetchSite: "same-origin", configuredOrigin: configured })).toBe(false);
  });

  it("accepts a loopback address or port other than the configured one when Origin matches Host", () => {
    expect(isCrossOriginMutation({ origin: "http://127.0.0.1:3000", host: "127.0.0.1:3000", fetchSite: "same-origin", configuredOrigin: configured })).toBe(false);
    expect(isCrossOriginMutation({ origin: "http://localhost:3101", host: "localhost:3101", fetchSite: "same-origin", configuredOrigin: configured })).toBe(false);
    expect(isCrossOriginMutation({ origin: "http://[::1]:3000", host: "[::1]:3000", fetchSite: "same-origin", configuredOrigin: configured })).toBe(false);
  });

  it("rejects a non-loopback host that differs from the configured origin, including DNS rebinding", () => {
    expect(isCrossOriginMutation({ origin: "http://192.0.2.10:3000", host: "192.0.2.10:3000", fetchSite: "same-origin", configuredOrigin: configured })).toBe(true);
    expect(isCrossOriginMutation({ origin: "http://rebind.example:3000", host: "rebind.example:3000", fetchSite: "same-origin", configuredOrigin: configured })).toBe(true);
  });

  it("rejects another site posting to a loopback server", () => {
    expect(isCrossOriginMutation({ origin: "https://attacker.example", host: "localhost:3000", fetchSite: "cross-site", configuredOrigin: configured })).toBe(true);
    expect(isCrossOriginMutation({ origin: "https://attacker.example", host: "localhost:3000", fetchSite: null, configuredOrigin: configured })).toBe(true);
  });

  it("falls back to the Host header when no origin is configured", () => {
    expect(isCrossOriginMutation({ origin: "https://app.example", host: "app.example", fetchSite: "same-origin" })).toBe(false);
    expect(isCrossOriginMutation({ origin: "https://other.example", host: "app.example", fetchSite: null })).toBe(true);
  });

  it("rejects a malformed Origin and allows requests without one", () => {
    expect(isCrossOriginMutation({ origin: "not a url", host: "localhost:3000", fetchSite: null, configuredOrigin: configured })).toBe(true);
    expect(isCrossOriginMutation({ origin: null, host: "localhost:3000", fetchSite: null, configuredOrigin: configured })).toBe(false);
  });
});
