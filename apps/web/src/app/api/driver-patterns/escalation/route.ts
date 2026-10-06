import { NextResponse } from "next/server";
import { z } from "zod";
import { auth, requireCompanyAccess } from "@/lib/auth";
import { escalationSchema } from "@/lib/driver-pattern-schema";
import { patternErrorResponse } from "@/lib/driver-patterns-http";
import { setDefaultEscalationWith } from "@/lib/driver-patterns-store";
import { commitModelWrite } from "@/lib/forecast-model-http";
import type { EscalationRule } from "@balsa/finance-engine";

const body = z.object({ escalation: escalationSchema.nullable() });

/** The company's default escalation, on whatever cycle the user sets; drivers opt into it. */
export async function PUT(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const parsed = body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid escalation" }, { status: 400 });
  try {
    const committed = await commitModelWrite(context.company.id, { kind: "settings_changed", subjectType: "company", actorUserId: context.user.id, via: "ui" }, async (tx) => { await setDefaultEscalationWith(tx, { companyId: context.company.id, actorUserId: context.user.id, via: "ui" }, parsed.data.escalation as EscalationRule | null); return { value: parsed.data.escalation, subjectId: context.company.id }; });
    return NextResponse.json({ escalation: committed.value, calculationRun: committed.calculationRun });
  } catch (error) { return patternErrorResponse(error); }
}
