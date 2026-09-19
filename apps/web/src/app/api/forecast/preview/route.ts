import { NextResponse } from "next/server";
import { z } from "zod";
import { categories } from "@nevermodel/finance-engine";
import { auth, requireCompanyAccess } from "@/lib/auth";
import { PreviewConflict, previewForecastChange, type ForecastPreviewChange } from "@/lib/forecast-preview";

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const body = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("confirm_item"), itemId: z.string().uuid(), edits: z.object({ amount: z.number().positive().optional(), amountFormula: z.string().trim().min(1).max(2000).nullable().optional(), cadence: z.enum(["once", "monthly", "quarterly", "annual"]).optional(), effectiveFrom: month.optional(), effectiveTo: month.nullable().optional(), category: z.enum(categories).optional() }).optional() }),
  z.object({ kind: z.literal("confirm_items"), itemIds: z.array(z.string().uuid()).min(1).max(200) }),
  z.object({ kind: z.literal("apply_decision"), decisionId: z.string().uuid() }),
]);

/** zod's inferred optionals allow `undefined` explicitly; exactOptionalPropertyTypes does not, so rebuild with conditional spreads. */
function toChange(data: z.infer<typeof body>): ForecastPreviewChange {
  if (data.kind === "apply_decision") return { kind: "apply_decision", decisionId: data.decisionId };
  if (data.kind === "confirm_items") return { kind: "confirm_items", itemIds: data.itemIds };
  const edits = data.edits;
  return {
    kind: "confirm_item",
    itemId: data.itemId,
    ...(edits
      ? {
          edits: {
            ...(edits.amount !== undefined ? { amount: edits.amount } : {}),
            ...(edits.amountFormula !== undefined ? { amountFormula: edits.amountFormula } : {}),
            ...(edits.cadence !== undefined ? { cadence: edits.cadence } : {}),
            ...(edits.effectiveFrom !== undefined ? { effectiveFrom: edits.effectiveFrom } : {}),
            ...(edits.effectiveTo !== undefined ? { effectiveTo: edits.effectiveTo } : {}),
            ...(edits.category !== undefined ? { category: edits.category } : {}),
          },
        }
      : {}),
  };
}

/** What a pending approval would do to cash and runway. Read-only. */
export async function POST(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const parsed = body.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid preview request" }, { status: 400 });
  try {
    return NextResponse.json(await previewForecastChange(context.company.id, toChange(parsed.data)));
  } catch (error) {
    if (error instanceof PreviewConflict) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
}
