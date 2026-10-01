import type { Category } from "@balsa/finance-engine";

/** Conservative category guess for rows created before categories were persisted. */
export function legacyCategory(text: string, direction: "receipt" | "spend"): Category | undefined {
  const value = text.toLowerCase();
  if (direction === "receipt") return /management\s+fee|mgmt\s+fee/.test(value) ? "management_fee" : undefined;
  if (/payroll|salary|salaries|wages|gusto|adp\b|rippling|justworks/.test(value)) return "salary";
  if (/contractor|freelanc|retainer|upwork/.test(value)) return "contractor";
  if (/legal|law\b|llp\b|attorney|accounting|audit|tax\s+prep|bookkeep|consult/.test(value)) return "professional_services";
  if (/insurance|d&o|liability\s+policy/.test(value)) return "insurance";
  if (/software|subscription|saas|\.com\b|google\s+workspace|microsoft|slack|notion|carta|quickbooks|zoom|github/.test(value)) return "software";
  return undefined;
}

