import type { ForecastConsequence } from "@nevermodel/finance-engine";

const monthName = (month: string) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
const signedMoney = (minor: string) => {
  const value = BigInt(minor); const dollars = Number((value < 0n ? -value : value) / 100n);
  const text = dollars >= 1000 ? `$${(dollars / 1000).toFixed(dollars >= 100_000 ? 0 : 1).replace(/\.0$/, "")}k` : `$${dollars}`;
  return `${value < 0n ? "−" : "+"}${text}`;
};
const runway = (months: number | null) => (months === null ? "beyond horizon" : `${months} mo`);

/** One line a CFO can read before approving: the horizon-end cash change, runway, and cash-out month. */
export function describeConsequence(consequence: ForecastConsequence | null, exceptionsAfter = 0): string {
  const parts: string[] = [];
  if (consequence) {
    if (consequence.horizonEndCash.deltaMinor !== "0") parts.push(`${monthName(consequence.horizonEndCash.month)} ending cash ${signedMoney(consequence.horizonEndCash.deltaMinor)}`);
    if (consequence.runwayMonths.before !== consequence.runwayMonths.after) parts.push(`runway ${runway(consequence.runwayMonths.before)} → ${runway(consequence.runwayMonths.after)}`);
    if (consequence.cashOutMonth.before !== consequence.cashOutMonth.after) parts.push(`cash-out ${consequence.cashOutMonth.before ? monthName(consequence.cashOutMonth.before) : "none"} → ${consequence.cashOutMonth.after ? monthName(consequence.cashOutMonth.after) : "none"}`);
  }
  const head = parts.length ? parts.join(" · ") : "No forecast effect";
  return exceptionsAfter > 0 ? `${head} · ${exceptionsAfter} driver${exceptionsAfter === 1 ? "" : "s"} excluded` : head;
}

const verbs: Record<string, [string, string]> = {
  evidence_published: ["Published", "evidence"], evidence_revoked: ["Revoked", "evidence"], evidence_reprocessed: ["Reprocessed", "evidence"],
  item_confirmed: ["Confirmed", "an item"], item_rejected: ["Rejected", "an item"], item_edited: ["Edited", "an item"], item_created: ["Added", "an item"],
  decision_applied: ["Applied", "a decision"], journal_posted: ["Posted", "a journal entry"], journal_reversed: ["Reversed", "a journal entry"],
  period_closed: ["Closed", "a period"], period_reopened: ["Reopened", "a period"], fx_changed: ["Changed", "FX rates"], entity_changed: ["Changed", "an entity"],
  allocation_changed: ["Changed", "an allocation"], mapping_approved: ["Approved", "a mapping"], plan_pinned: ["Pinned", "a plan"], settings_changed: ["Changed", "forecast settings"],
};

export function describeCause(cause: { kind: string; subjectLabel: string | null }): string {
  const [verb, noun] = verbs[cause.kind] ?? ["Changed", "the books"];
  return `${verb} ${cause.subjectLabel ?? noun}`;
}
