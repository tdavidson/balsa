import { NextResponse } from "next/server";
import { auth, requireCompanyAccess } from "@/lib/auth";
import { seasonalitySchema } from "@/lib/driver-pattern-schema";
import { patternErrorResponse } from "@/lib/driver-patterns-http";
import { deleteSeasonalityWith, saveSeasonalityWith } from "@/lib/driver-patterns-store";
import { commitModelWrite } from "@/lib/forecast-model-http";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const parsed = seasonalitySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid profile" }, { status: 400 });
  const id = (await params).id;
  try {
    const committed = await commitModelWrite(context.company.id, { kind: "model_changed", subjectType: "seasonality_profile", actorUserId: context.user.id, via: "ui" }, async (tx) => ({ value: await saveSeasonalityWith(tx, { companyId: context.company.id, actorUserId: context.user.id, via: "ui" }, parsed.data, id), subjectId: id }));
    return NextResponse.json({ profile: committed.value, calculationRun: committed.calculationRun });
  } catch (error) { return patternErrorResponse(error); }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const id = (await params).id;
  try {
    const committed = await commitModelWrite(context.company.id, { kind: "model_changed", subjectType: "seasonality_profile", actorUserId: context.user.id, via: "ui" }, async (tx) => { await deleteSeasonalityWith(tx, { companyId: context.company.id, actorUserId: context.user.id, via: "ui" }, id); return { value: null, subjectId: id }; });
    return NextResponse.json({ deleted: true, calculationRun: committed.calculationRun });
  } catch (error) { return patternErrorResponse(error); }
}
