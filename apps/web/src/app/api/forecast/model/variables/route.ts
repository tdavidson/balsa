import { NextResponse } from "next/server";
import { auth, requireCompanyAccess } from "@/lib/auth";
import { commitModelWrite, invalidBody, modelErrorResponse } from "@/lib/forecast-model-http";
import { variableDraftSchema } from "@/lib/forecast-model-schema";
import { createVariableWith } from "@/lib/forecast-model-store";

/** Add a variable: dated inputs or a formula. The whole resulting model is validated first. */
export async function POST(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const parsed = variableDraftSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error.flatten());
  try {
    const { value: variable, calculationRun } = await commitModelWrite(context.company.id, { kind: "model_changed", subjectType: "forecast_variable", actorUserId: context.user.id, via: "ui" }, async (tx) => {
      const row = await createVariableWith(tx, context.company.id, parsed.data);
      return { value: row, subjectId: row.id };
    });
    return NextResponse.json({ variable, calculationRun }, { status: 201 });
  } catch (error) {
    return modelErrorResponse(error);
  }
}
