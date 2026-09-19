import { z } from "zod";

/** Shape only: naming rules, references, and limits are checked by validateModel so they come back as positioned errors. */
export const modelNameSchema = z.string().trim().min(1).max(64);
export const modelMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export const modelFormulaSchema = z.string().trim().min(1).max(2000);
export const variableKindSchema = z.enum(["money", "number"]);
export const variableInputSchema = z.object({ coords: z.record(z.string(), z.string()), from: modelMonthSchema, value: z.string().trim().regex(/^-?\d+(\.\d{1,6})?$/, "Use a decimal with at most 6 places") });

export const dimensionDraftSchema = z.object({ name: modelNameSchema, items: z.array(modelNameSchema).max(500) });
export const dimensionPatchSchema = z.object({ name: modelNameSchema.optional(), items: z.array(modelNameSchema).max(500).optional() });

export const variableDraftSchema = z.object({
  name: modelNameSchema,
  kind: variableKindSchema,
  dims: z.array(modelNameSchema).max(12).default([]),
  formula: modelFormulaSchema.nullable().default(null),
  inputs: z.array(variableInputSchema).max(10_000).default([]),
});
export const variablePatchSchema = z.object({
  name: modelNameSchema.optional(),
  kind: variableKindSchema.optional(),
  dims: z.array(modelNameSchema).max(12).optional(),
  formula: modelFormulaSchema.nullable().optional(),
  inputs: z.array(variableInputSchema).max(10_000).optional(),
});

/** A dry-run draft: entries replace the saved one named `replaces` (or their own name); `itemFormula` is checked as a driver formula. */
export const modelDraftSchema = z.object({
  dimensions: z.array(dimensionDraftSchema.extend({ replaces: modelNameSchema.optional() })).max(12).optional(),
  variables: z.array(variableDraftSchema.extend({ replaces: modelNameSchema.optional() })).max(200).optional(),
  itemFormula: z.string().trim().max(4000).optional(),
});
