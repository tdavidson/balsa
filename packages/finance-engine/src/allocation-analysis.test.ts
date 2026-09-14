import { describe, expect, it } from "vitest";
import { analyzeApprovedAllocations } from "./allocation-analysis";

describe("analyzeApprovedAllocations", () => {
  it("uses exact integer math and reconciles approved bearer shares to a spend", () => {
    const result = analyzeApprovedAllocations({ sources: [{ id: "spend", period: "2026-09", amountMinor: "10001", direction: "spend", sourceId: "statement", sourceLocation: "row:12" }], allocations: [{ id: "fund-a", status: "approved", eventId: "spend", bearerEntityId: "fund-a", percentage: "25%" }, { id: "fund-b", status: "approved", eventId: "spend", bearerEntityId: "fund-b", amount: "75.01" }] });
    expect(result.lines).toEqual(expect.arrayContaining([expect.objectContaining({ allocationId: "fund-a", amountMinor: "2500", status: "ready" }), expect.objectContaining({ allocationId: "fund-b", amountMinor: "7501", sourceLocation: "row:12" })]));
    expect(result.controls).toEqual([expect.objectContaining({ allocatedMinor: "10001", unallocatedMinor: "0", status: "reconciled" })]);
  });

  it("names invalid or over-allocated instructions as controls exceptions", () => {
    const result = analyzeApprovedAllocations({ sources: [{ id: "spend", period: "2026-09", amountMinor: "10000", direction: "spend" }], allocations: [{ id: "bad", status: "approved", eventId: "spend", bearerEntityId: "fund-a", percentage: "120" }, { id: "over", status: "approved", eventId: "spend", bearerEntityId: "fund-b", amount: "150.00" }] });
    expect(result.controls[0]).toMatchObject({ status: "exception", allocatedMinor: "15000" });
  });
});
