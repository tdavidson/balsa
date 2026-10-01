import type { EntryBasis } from "@balsa/finance-engine";

const passthrough = ["actual", "scenario", "adjustment", "elimination", "translation"] as const;

/** Posted forecast journals predate the derived forecast: they are pinned plans, never the live forecast. */
export function entryBasisFromStored(value: string): EntryBasis | undefined {
  if (value === "forecast" || value === "plan") return "plan";
  return passthrough.find((basis) => basis === value);
}
