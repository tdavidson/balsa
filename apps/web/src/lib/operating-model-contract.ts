import { z } from "zod";
import { operatingDecisionSchema } from "./operating-decision-contract";
import { operatingOps } from "@balsa/finance-engine";
const step = z.object({ month: z.string().max(7), value: z.string().max(30) }).strict();
export const operatingModelSchema = z.object({
  decision: operatingDecisionSchema.optional(),
  name: z.string().min(1).max(120), description: z.string().min(1).max(2000), startMonth: z.string().max(7), months: z.number().int().min(1).max(24),
  nodes: z.array(z.object({ basis: z.enum(["user_assumption", "ai_suggestion"]).optional(), id: z.string().max(64), label: z.string().min(1).max(160), unit: z.string().min(1).max(60), op: z.enum(operatingOps), args: z.array(z.string().max(64)).max(3), values: z.array(step).max(25), initial: z.string().max(30).nullable(), rationale: z.string().min(1).max(2000), evidenceIds: z.array(z.uuid()).max(10) }).strict()).min(1).max(80),
  outputs: z.array(z.object({ nodeId: z.string().max(64), label: z.string().min(1).max(160), direction: z.enum(["receipt", "spend"]), category: z.enum(["other", "salary", "contractor"]) }).strict()).min(1).max(4),
  cases: z.array(z.object({ id: z.string().max(64), name: z.string().min(1).max(120), rationale: z.string().min(1).max(2000), overrides: z.array(z.object({ nodeId: z.string().max(64), values: z.array(step).min(1).max(25) }).strict()).max(40) }).strict()).max(5),
  limitations: z.array(z.string().min(1).max(1000)).max(20),
}).strict();
export const operatingCommand = z.discriminatedUnion("action", [
  z.object({ action: z.literal("draft"), prompt: z.string().trim().min(1).max(8000), previous: operatingModelSchema.nullable() }).strict(),
  z.object({ action: z.literal("preview"), model: operatingModelSchema }).strict(),
  z.object({ action: z.literal("save"), model: operatingModelSchema, caseId: z.string().max(64), previewToken: z.string().regex(/^[a-f0-9]{64}$/), requestKey: z.uuid(), acknowledgeAssumptions: z.literal(true) }).strict(),
]);

// Provider drafts keep all schema keys required; decision framing is supplied by the user.
export const operatingDraftSchema = operatingModelSchema.omit({ decision: true }).extend({ nodes: z.array(operatingModelSchema.shape.nodes.element.omit({ basis: true })).min(1).max(80) });
