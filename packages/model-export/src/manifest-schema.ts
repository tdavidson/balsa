import { z } from "zod";

export const manifestFormat = "balsa-export-manifest-1";
export const exportFormatVersion = "standard-export-2026-10-06.1";
export class InvalidWorkbookExport extends Error {
  constructor() { super("This Balsa workbook has invalid or unsupported export data. Download a fresh export and try again."); this.name = "InvalidWorkbookExport"; }
}
const name = z.string().min(1).max(256);
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const row = z.number().int().min(1).max(1_048_576);
const finite = z.number().finite();
const cycle = z.number().int().min(0).max(1200);
const escalation = z.object({ rate: finite, everyMonths: cycle.min(1), anchorMonth: z.number().int().min(1).max(12).nullable() });
const pattern = z.object({
  initialValue: finite, startsIn: month, endsIn: month.nullable(), repeatsEvery: cycle,
  basis: z.enum(["", "% change", "# change", "log change", "% of", "# per"]),
  changesEvery: cycle.nullable(), changingBy: finite.nullable(),
  using: z.discriminatedUnion("kind", [z.object({ kind: z.literal("driver"), id: name }), z.object({ kind: z.literal("metric"), name }), z.object({ kind: z.literal("line"), line: name })]).nullable(),
  maxMonths: cycle.nullable(), maxValue: finite.nullable(), seasonality: name.nullable(), escalation: z.union([escalation, z.literal("company")]).nullable(),
});
const driver = z.object({ key: name, id: name, scenarioId: name.nullable(), label: name, row });
export const manifestSchema = z.object({
  format: z.literal(manifestFormat), exportFormat: z.literal(exportFormatVersion), companyId: name.nullable(),
  exportedAt: z.iso.datetime(), asOfPeriod: month,
  drivers: z.array(z.discriminatedUnion("kind", [driver.extend({ kind: z.literal("pattern"), pattern }), driver.extend({ kind: z.literal("formula"), formula: z.object({ text: z.string().min(1).max(2000), startsIn: month, endsIn: month.nullable(), repeatsEvery: cycle }) })])).max(10_000),
  metrics: z.array(z.object({ name, label: name, row, pattern })).max(10_000),
  model: z.object({ months: z.array(month).min(1).max(241), rows: z.array(z.object({ variable: name, key: z.string().max(2048), coords: z.record(name, name).refine((value) => Object.keys(value).length <= 12), row, kind: z.enum(["input", "formula"]), values: z.array(finite.nullable()).min(1).max(241) })).max(10_000) }).nullable(),
  seasonality: z.object({ firstRow: row, profiles: z.array(z.object({ name, deviations: z.array(finite).length(12) })).max(1000) }).nullable(),
  escalation: escalation.nullable(),
}).superRefine((value, ctx) => {
  const bad = () => ctx.addIssue({ code: "custom", message: "Invalid or duplicate export coordinates" });
  const unique = (values: (string | number)[]) => new Set(values).size === values.length;
  if (!unique([...value.drivers.map((item) => item.row), ...value.metrics.map((item) => item.row)]) || !unique(value.drivers.map((item) => item.key)) || !unique(value.metrics.map((item) => item.name))) bad();
  if (value.seasonality && value.seasonality.firstRow + value.seasonality.profiles.length > 1_048_577) bad();
  if (value.model) {
    const { months, rows } = value.model;
    if (!unique(rows.map((item) => item.row)) || !unique(rows.map((item) => JSON.stringify([item.variable, Object.entries(item.coords).sort(([a], [b]) => a.localeCompare(b))])))) bad();
    if (months.some((item, index) => index > 0 && item <= months[index - 1]!)) bad();
    if (rows.some((item) => item.values.length !== months.length)) bad();
  }
});
