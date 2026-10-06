import { NextResponse } from "next/server";
import { z } from "zod";
import { auth, requireCompanyAccess } from "@/lib/auth";
import { driverPatternSchema } from "@/lib/driver-pattern-schema";
import { patternErrorResponse } from "@/lib/driver-patterns-http";
import { setItemPatternWith } from "@/lib/driver-patterns-store";
import { commitModelWrite } from "@/lib/forecast-model-http";
import type { DriverPattern } from "@balsa/finance-engine";

const body = z.object({ pattern: driverPatternSchema.nullable() });

/** Set or clear a driver's Standard-model pattern. A revision: the forecast recalculates. */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const parsed = body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid pattern" }, { status: 400 });
  const id = (await params).id;
  try {
    const committed = await commitModelWrite(context.company.id, { kind: "item_edited", subjectType: "economic_item", actorUserId: context.user.id, via: "ui" }, async (tx) => ({ value: await setItemPatternWith(tx, { companyId: context.company.id, actorUserId: context.user.id, via: "ui" }, id, parsed.data.pattern as DriverPattern | null), subjectId: id }));
    return NextResponse.json({ item: committed.value, calculationRun: committed.calculationRun });
  } catch (error) { return patternErrorResponse(error); }
}
