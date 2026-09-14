/**
 * Presentation helpers for the activity log. They are pure and live outside the
 * dialog so the label rules can be tested without rendering React.
 */

/**
 * Nouns whose sentence case is not their identifier's case. Everything else is
 * left to the mechanical rule below, so a new action added by a mutation route
 * reads correctly without being registered anywhere.
 */
const actionWordLabels: Record<string, string> = {
  fx: "FX",
  llm: "LLM",
  api: "API",
  csv: "CSV",
};

/**
 * Humanize a dotted action identifier: `evidence.approved` reads as
 * "Evidence approved", `member.role_changed` as "Member role changed". The
 * entity segment leads because the log is scanned down the left edge.
 */
export function humanizeAuditAction(action: string): string {
  const words = action
    .split(/[.\s_-]+/)
    .filter(Boolean)
    .map((word) => actionWordLabels[word.toLocaleLowerCase()] ?? word.toLocaleLowerCase());
  if (!words.length) return action;
  const [first, ...rest] = words as [string, ...string[]];
  // Only the first word is capitalized, and only when it is not an initialism
  // that already carries its own case.
  const lead = first === first.toLocaleUpperCase() ? first : first.charAt(0).toLocaleUpperCase() + first.slice(1);
  return [lead, ...rest].join(" ");
}

const relativeUnits: [limit: number, seconds: number, unit: Intl.RelativeTimeFormatUnit][] = [
  [60, 1, "second"],
  [3_600, 60, "minute"],
  [86_400, 3_600, "hour"],
  [604_800, 86_400, "day"],
  [2_592_000, 604_800, "week"],
  [31_536_000, 2_592_000, "month"],
  [Number.POSITIVE_INFINITY, 31_536_000, "year"],
];

const relativeFormatter = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });

/**
 * A coarse "3 hours ago" for a timestamp. `now` is a parameter so the caller
 * controls the clock: rendering and tests must not disagree about what time it
 * is. An unparsable timestamp is returned unchanged rather than shown as an
 * invalid date.
 */
export function formatRelativeTime(timestamp: string, now: Date = new Date()): string {
  const value = Date.parse(timestamp);
  if (!Number.isFinite(value)) return timestamp;
  // Clock skew between the server and the browser can put a fresh entry a
  // second or two in the future; "just now" is truer than "in 2 seconds".
  const elapsed = Math.max(0, (now.getTime() - value) / 1_000);
  if (elapsed < 45) return "just now";
  for (const [limit, seconds, unit] of relativeUnits) {
    if (elapsed < limit) return relativeFormatter.format(-Math.round(elapsed / seconds), unit);
  }
  return timestamp;
}

/** The actor as a person: their name when they have one, otherwise the address that identifies them. */
export function actorLabel(actor: { name: string | null; email: string } | null): string {
  return actor?.name?.trim() || actor?.email || "System";
}
