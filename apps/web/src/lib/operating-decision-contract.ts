import { z } from "zod";
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const decimal = z.string().regex(/^-?\d{1,12}(?:\.\d{1,6})?$/);
export const operatingDecisionSchema = z
  .object({
    question: z.string().trim().min(1).max(2000),
    deadline: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    constraints: z.array(z.string().trim().max(500)).max(10),
    caseId: z.string().min(1).max(64),
    compareCaseId: z.string().min(1).max(64),
    metric: z.enum(["ending_cash", "minimum_cash"]),
    cashFloorMinor: z.string().regex(/^-?\d{1,15}$/),
    ranges: z
      .array(
        z
          .object({
            nodeId: z.string().min(1).max(64),
            from: month,
            low: decimal,
            high: decimal,
          })
          .strict(),
      )
      .max(4),
  })
  .strict();
export type OperatingDecision = z.infer<typeof operatingDecisionSchema>;
