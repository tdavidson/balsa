import { NextResponse } from "next/server";
import { auth, requireCompanyAccess } from "@/lib/auth";
import { commitModelWrite, invalidBody, modelErrorResponse, uuidParam } from "@/lib/forecast-model-http";
import { dimensionPatchSchema } from "@/lib/forecast-model-schema";
import { deactivateDimensionWith, updateDimensionWith } from "@/lib/forecast-model-store";

const notFound = () => NextResponse.json({ error: "Dimension not found" }, { status: 404 });

/** Rename a dimension or change its items; variables and formulas that no longer fit make it a 422. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const { id } = await params;
  if (!uuidParam.safeParse(id).success) return notFound();
  const parsed = dimensionPatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error.flatten());
  const { name, items } = parsed.data;
  try {
    const { value: dimension, calculationRun } = await commitModelWrite(context.company.id, { kind: "model_changed", subjectType: "forecast_dimension", actorUserId: context.user.id, via: "ui" }, async (tx) => {
      const row = await updateDimensionWith(tx, context.company.id, id, { ...(name !== undefined ? { name } : {}), ...(items !== undefined ? { items } : {}) });
      return { value: row, subjectId: row.id };
    });
    return NextResponse.json({ dimension, calculationRun });
  } catch (error) {
    return modelErrorResponse(error);
  }
}

/** Deactivate a dimension no variable uses. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const { id } = await params;
  if (!uuidParam.safeParse(id).success) return notFound();
  try {
    const { value: dimension, calculationRun } = await commitModelWrite(context.company.id, { kind: "model_changed", subjectType: "forecast_dimension", actorUserId: context.user.id, via: "ui" }, async (tx) => {
      const row = await deactivateDimensionWith(tx, context.company.id, id);
      return { value: row, subjectId: row.id };
    });
    return NextResponse.json({ dimension, deactivated: true, calculationRun });
  } catch (error) {
    return modelErrorResponse(error);
  }
}
