import { asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDatabase, seasonalityProfiles } from "@finance/database";
import { auth, requireCompanyAccess } from "@/lib/auth";
import { seasonalitySchema } from "@/lib/driver-pattern-schema";
import { patternErrorResponse } from "@/lib/driver-patterns-http";
import { saveSeasonalityWith } from "@/lib/driver-patterns-store";
import { commitModelWrite } from "@/lib/forecast-model-http";

export async function GET() {
  await auth.protect();
  const context = await requireCompanyAccess();
  return NextResponse.json({ profiles: await getDatabase().select().from(seasonalityProfiles).where(eq(seasonalityProfiles.companyId, context.company.id)).orderBy(asc(seasonalityProfiles.name)) });
}

/** Add a seasonality profile: twelve monthly deviations that sum to zero. */
export async function POST(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const parsed = seasonalitySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid profile" }, { status: 400 });
  try {
    const committed = await commitModelWrite(context.company.id, { kind: "model_changed", subjectType: "seasonality_profile", actorUserId: context.user.id, via: "ui" }, async (tx) => { const row = await saveSeasonalityWith(tx, { companyId: context.company.id, actorUserId: context.user.id, via: "ui" }, parsed.data); return { value: row, subjectId: row.id }; });
    return NextResponse.json({ profile: committed.value, calculationRun: committed.calculationRun }, { status: 201 });
  } catch (error) { return patternErrorResponse(error); }
}
