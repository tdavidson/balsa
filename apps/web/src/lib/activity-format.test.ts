import { describe, expect, it } from "vitest";
import { actorLabel, formatRelativeTime, humanizeAuditAction } from "./activity-format";

describe("humanizeAuditAction", () => {
  it("reads a dotted action as a sentence led by its entity", () => {
    expect(humanizeAuditAction("evidence.approved")).toBe("Evidence approved");
    expect(humanizeAuditAction("company.settings_changed")).toBe("Company settings changed");
    expect(humanizeAuditAction("member.role_changed")).toBe("Member role changed");
  });
  it("keeps initialisms in their own case wherever they appear", () => {
    expect(humanizeAuditAction("fx.remeasured")).toBe("FX remeasured");
    expect(humanizeAuditAction("journal.fx_posted")).toBe("Journal FX posted");
  });
  it("lowercases an identifier that arrives shouting, so one log reads consistently", () => {
    expect(humanizeAuditAction("PERIOD.CLOSED")).toBe("Period closed");
  });
  it("returns an unusable identifier unchanged rather than an empty label", () => {
    expect(humanizeAuditAction("")).toBe("");
    expect(humanizeAuditAction("...")).toBe("...");
  });
});

describe("formatRelativeTime", () => {
  const now = new Date("2026-09-14T12:00:00Z");
  it("collapses the last minute into one phrase", () => {
    expect(formatRelativeTime("2026-09-14T12:00:00Z", now)).toBe("just now");
    expect(formatRelativeTime("2026-09-14T11:59:30Z", now)).toBe("just now");
  });
  it("scales the unit with the distance", () => {
    expect(formatRelativeTime("2026-09-14T11:55:00Z", now)).toBe("5 minutes ago");
    expect(formatRelativeTime("2026-09-14T09:00:00Z", now)).toBe("3 hours ago");
    expect(formatRelativeTime("2026-09-11T12:00:00Z", now)).toBe("3 days ago");
    // `numeric: "auto"` is what turns the exact-one cases into words.
    expect(formatRelativeTime("2025-09-14T12:00:00Z", now)).toBe("last year");
  });
  it("treats clock skew as the present instead of reporting the future", () => {
    expect(formatRelativeTime("2026-09-14T12:00:05Z", now)).toBe("just now");
  });
  it("passes an unparsable timestamp through", () => {
    expect(formatRelativeTime("not a date", now)).toBe("not a date");
  });
});

describe("actorLabel", () => {
  it("prefers the name, falls back to the address, and names no actor at all", () => {
    expect(actorLabel({ name: "Ada Lovelace", email: "ada@example.com" })).toBe("Ada Lovelace");
    expect(actorLabel({ name: "   ", email: "ada@example.com" })).toBe("ada@example.com");
    expect(actorLabel(null)).toBe("System");
  });
});
