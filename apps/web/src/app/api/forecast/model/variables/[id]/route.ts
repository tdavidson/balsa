import { NextResponse } from "next/server";
import { auth, requireCompanyAccess } from "@/lib/auth";
import { commitModelWrite, invalidBody, modelErrorResponse, uuidParam } from "@/lib/forecast-model-http";
import { variablePatchSchema } from "@/lib/forecast-model-schema";
import { deactivateVariableWith, updateVariableWith } from "@/lib/forecast-model-store";

const notFound = () => NextResponse.json({ error: "Variable not found" }, { status: 404 });

/** Edit a variable; switching to a formula must send `inputs: []` with it. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const { id } = await params;
  if (!uuidParam.safeParse(id).success) return notFound();
  const parsed = variablePatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error.flatten());
  const { name, kind, dims, formula, inputs } = parsed.data;
  try {
    const { value: variable, calculationRun } = await commitModelWrite(context.company.id, { kind: "model_changed", subjectType: "forecast_variable", actorUserId: context.user.id, via: "ui" }, async (tx) => {
      const row = await updateVariableWith(tx, context.company.id, id, { ...(name !== undefined ? { name } : {}), ...(kind !== undefined ? { kind } : {}), ...(dims !== undefined ? { dims } : {}), ...(formula !== undefined ? { formula } : {}), ...(inputs !== undefined ? { inputs } : {}) });
      return { value: row, subjectId: row.id };
    });
    return NextResponse.json({ variable, calculationRun });
  } catch (error) {
    return modelErrorResponse(error);
  }
}

/** Deactivate a variable nothing reads. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const { id } = await params;
  if (!uuidParam.safeParse(id).success) return notFound();
  try {
    const { value: variable, calculationRun } = await commitModelWrite(context.company.id, { kind: "model_changed", subjectType: "forecast_variable", actorUserId: context.user.id, via: "ui" }, async (tx) => {
      const row = await deactivateVariableWith(tx, context.company.id, id);
      return { value: row, subjectId: row.id };
    });
    return NextResponse.json({ variable, deactivated: true, calculationRun });
  } catch (error) {
    return modelErrorResponse(error);
  }
}
