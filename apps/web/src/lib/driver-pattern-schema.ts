import { z } from "zod";
import { isModelIdentifier, validateEscalation, validatePattern, validateSeasonality, type DriverPattern, type EscalationRule, type SeasonalityProfile } from "@balsa/finance-engine";

const decimal = z.string().trim().regex(/^-?\d+(\.\d{1,6})?$/, "Use a number with up to six decimal places");
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export const escalationSchema = z.object({ rate: decimal, everyMonths: z.number().int().min(1).max(120), anchor: z.union([z.literal("driver_start"), z.object({ calendarMonth: z.number().int().min(1).max(12) })]) });
export const driverRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("driver"), driverId: z.string().uuid() }),
  z.object({ kind: z.literal("metric"), name: z.string().refine(isModelIdentifier, "Metric names use letters, digits and underscores") }),
  z.object({ kind: z.literal("report_line"), line: z.string().min(1).max(60) }),
]);
export const driverPatternSchema = z.object({
  initialValue: decimal,
  repeatsEveryMonths: z.number().int().min(0).max(120),
  change: z.union([
    z.object({ basis: z.enum(["pct_change", "abs_change", "log_change"]), everyMonths: z.number().int().min(1).max(120), by: decimal }),
    z.object({ basis: z.enum(["pct_of", "per_unit"]), ref: driverRefSchema }),
  ]).optional(),
  maxMonths: z.number().int().min(0).max(600).optional(),
  maxValue: decimal.optional(),
  seasonalityProfileId: z.string().uuid().optional(),
  escalation: z.union([z.literal("company"), escalationSchema]).optional(),
});
export const metricSchema = z.object({ name: z.string().trim().min(1).max(64).refine(isModelIdentifier, "Metric names start with a letter and use letters, digits and underscores"), label: z.string().trim().min(1).max(120), unit: z.string().trim().max(40).nullable().optional(), effectiveFrom: month, effectiveTo: month.nullable().optional(), pattern: driverPatternSchema });
export const seasonalitySchema = z.object({ name: z.string().trim().min(1).max(80), deviations: z.array(decimal).length(12) });

/** A stored pattern; undefined when absent. An unreadable one is marked so the driver becomes an exception, never a different pattern. */
export function parseStoredPattern(value: unknown): DriverPattern | undefined {
  if (value === null || value === undefined) return undefined;
  const parsed = driverPatternSchema.safeParse(value);
  return parsed.success ? (JSON.parse(JSON.stringify(parsed.data)) as DriverPattern) : { initialValue: "0", repeatsEveryMonths: 0, unreadable: true };
}
export const parseStoredEscalation = (value: unknown): EscalationRule | null => { const parsed = escalationSchema.safeParse(value); return parsed.success ? parsed.data as EscalationRule : null; };

export { validateEscalation, validatePattern, validateSeasonality };
export type { SeasonalityProfile };
