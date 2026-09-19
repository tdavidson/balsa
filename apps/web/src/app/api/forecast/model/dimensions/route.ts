import { NextResponse } from "next/server";
import { auth, requireCompanyAccess } from "@/lib/auth";
import { commitModelWrite, invalidBody, modelErrorResponse } from "@/lib/forecast-model-http";
import { dimensionDraftSchema } from "@/lib/forecast-model-schema";
import { createDimensionWith } from "@/lib/forecast-model-store";

/** Add a dimension. The whole resulting model is validated first, and the write is a forecast revision. */
export async function POST(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const parsed = dimensionDraftSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error.flatten());
  try {
    const { value: dimension, calculationRun } = await commitModelWrite(context.company.id, { kind: "model_changed", subjectType: "forecast_dimension", actorUserId: context.user.id, via: "ui" }, async (tx) => {
      const row = await createDimensionWith(tx, context.company.id, parsed.data);
      return { value: row, subjectId: row.id };
    });
    return NextResponse.json({ dimension, calculationRun }, { status: 201 });
  } catch (error) {
    return modelErrorResponse(error);
  }
}
