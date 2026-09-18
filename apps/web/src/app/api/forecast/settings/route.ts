import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { companies, getDatabase } from "@finance/database";
import { auth, requireCompanyAccess } from "@/lib/auth";
import { amountToMinor } from "@/lib/forecast-drivers";
import { refreshCurrentCalculationRun } from "@/lib/refresh-calculation-run";

export async function GET() {
  await auth.protect();
  const context = await requireCompanyAccess();
  const [company] = await getDatabase().select({ minimumCashMinor: companies.minimumCashMinor }).from(companies).where(eq(companies.id, context.company.id)).limit(1);
  return NextResponse.json({ minimumCash: Number(company?.minimumCashMinor ?? "0") / 100 });
}

/** The cash floor that defines the forecast's cash-out month. Changing it is a revision with its own consequence. */
export async function PATCH(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  if (context.company.role !== "owner") return NextResponse.json({ error: "Only the company owner can change forecast settings" }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { minimumCash?: unknown };
  const minor = typeof body.minimumCash === "number" && body.minimumCash >= 0 ? amountToMinor(body.minimumCash.toFixed(2)) : "";
  if (!minor) return NextResponse.json({ error: "Minimum cash must be zero or a positive amount" }, { status: 400 });
  const [current] = await getDatabase().select({ minimumCashMinor: companies.minimumCashMinor }).from(companies).where(eq(companies.id, context.company.id)).limit(1);
  // An unchanged floor is not a revision: no consequence, no refresh.
  if (current?.minimumCashMinor === minor) return NextResponse.json({ minimumCash: Number(minor) / 100, calculationRun: null });
  await getDatabase().update(companies).set({ minimumCashMinor: minor, updatedAt: new Date() }).where(eq(companies.id, context.company.id));
  const calculationRun = await refreshCurrentCalculationRun(context.company.id, { cause: { kind: "settings_changed", subjectType: "company", subjectId: context.company.id, actorUserId: context.user.id, via: "ui" } });
  return NextResponse.json({ minimumCash: Number(minor) / 100, calculationRun });
}
