/** Source-row and forecast-driver labels. They are inputs to approved journal mappings, never a reporting ledger. */
export const categories = ["management_fee", "other_revenue", "salary", "contractor", "professional_services", "software", "insurance", "other"] as const;
export type Category = (typeof categories)[number];

export function isCategory(value: unknown): value is Category {
  return typeof value === "string" && (categories as readonly string[]).includes(value);
}
