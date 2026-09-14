/**
 * Deterministic allocation analysis is deliberately separate from posting.
 * It proves that approved shares reconcile to an originating spend before an
 * approved allocation template can create a balanced due-from/due-to entry.
 */
export type AllocationSource = { id: string; period: string; amountMinor: string; direction: "receipt" | "spend"; sourceId?: string; sourceLocation?: string };
export type AllocationInstruction = { id: string; status: "proposed" | "approved" | "rejected" | string; eventId?: string | null; payerEntityId?: string | null; bearerEntityId?: string | null; percentage?: string | null; amount?: string | null; sourceId?: string | null };
export type AllocationAnalysisLine = { allocationId: string; eventId: string; period: string; payerEntityId: string | null; bearerEntityId: string; amountMinor: string; sourceId?: string; sourceLocation?: string; status: "ready" | "exception"; reasons: string[] };
export type AllocationAnalysis = { lines: AllocationAnalysisLine[]; controls: { eventId: string; period: string; sourceAmountMinor: string; allocatedMinor: string; unallocatedMinor: string; status: "reconciled" | "exception"; reasons: string[] }[] };

const decimalToMinor = (value: string) => {
  const normalized = value.trim().replace(/[$,\s]/g, "").replace(/^\((.+)\)$/, "-$1");
  const match = normalized.match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const result = BigInt(match[2]!) * 100n + BigInt((match[3] ?? "").padEnd(2, "0"));
  return match[1] === "-" ? -result : result;
};

/** Parse 25%, 25, and .25 as the same 25% allocation, with no float math. */
const percentageBasisPoints = (value: string) => {
  const normalized = value.trim().replace(/%$/, "");
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) return null;
  const percent = numeric <= 1 && !value.includes("%") ? numeric * 100 : numeric;
  return BigInt(Math.round(percent * 100));
};

/** Analyze approved allocations without letting them change reported books. */
export function analyzeApprovedAllocations(input: { allocations: AllocationInstruction[]; sources: AllocationSource[] }): AllocationAnalysis {
  const sources = new Map(input.sources.map((source) => [source.id, source]));
  const lines: AllocationAnalysisLine[] = [];
  for (const allocation of input.allocations) {
    if (allocation.status !== "approved") continue;
    const source = allocation.eventId ? sources.get(allocation.eventId) : undefined;
    const reasons: string[] = [];
    if (!allocation.eventId || !source) reasons.push("Approved allocation must identify an originating cash spend.");
    if (source?.direction !== "spend") reasons.push("Allocations may only split an originating spend.");
    if (!allocation.bearerEntityId) reasons.push("Approved allocation must identify the economic bearer.");
    const explicitAmount = allocation.amount ? decimalToMinor(allocation.amount) : null;
    const basisPoints = allocation.percentage ? percentageBasisPoints(allocation.percentage) : null;
    if (allocation.amount && explicitAmount === null) reasons.push("Allocation amount is not a valid currency amount.");
    if (allocation.percentage && basisPoints === null) reasons.push("Allocation percentage must be between 0% and 100%.");
    if (!allocation.amount && !allocation.percentage) reasons.push("Approved allocation needs an amount or percentage.");
    if (allocation.amount && allocation.percentage) reasons.push("Approved allocation must use either an amount or percentage, not both.");
    const amountMinor = explicitAmount ?? (source && basisPoints !== null ? (BigInt(source.amountMinor) * basisPoints) / 10_000n : 0n);
    if (amountMinor <= 0n) reasons.push("Allocation amount must be positive.");
    if (!source || !allocation.bearerEntityId) continue;
    lines.push({ allocationId: allocation.id, eventId: source.id, period: source.period, payerEntityId: allocation.payerEntityId ?? null, bearerEntityId: allocation.bearerEntityId, amountMinor: amountMinor.toString(), ...(allocation.sourceId ?? source.sourceId ? { sourceId: allocation.sourceId ?? source.sourceId! } : {}), ...(source.sourceLocation ? { sourceLocation: source.sourceLocation } : {}), status: reasons.length ? "exception" : "ready", reasons });
  }
  const controls = [...new Set(lines.map((line) => line.eventId))].map((eventId) => {
    const source = sources.get(eventId)!; const related = lines.filter((line) => line.eventId === eventId); const allocated = related.reduce((sum, line) => sum + BigInt(line.amountMinor), 0n); const sourceAmount = BigInt(source.amountMinor); const reasons = related.flatMap((line) => line.reasons);
    if (allocated > sourceAmount) reasons.push("Approved allocation shares exceed the originating spend.");
    return { eventId, period: source.period, sourceAmountMinor: sourceAmount.toString(), allocatedMinor: allocated.toString(), unallocatedMinor: (sourceAmount - allocated).toString(), status: reasons.length ? "exception" as const : "reconciled" as const, reasons: [...new Set(reasons)] };
  });
  return { lines, controls };
}
