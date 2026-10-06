import { NextResponse } from "next/server";
import { z } from "zod";
import { decisions, getDatabase, recordAudit } from "@finance/database";
import { auth, requireCompanyAccess } from "@/lib/auth";
import { loadDriverSuggestions } from "@/lib/driver-suggestions";

const monthsParam = (value: string | null) => { const months = Number(value ?? 6); return Number.isInteger(months) && months >= 2 && months <= 24 ? months : 6; };

/** What the actuals suggest for each driver, uncovered account and metric. Read-only. */
export async function GET(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  return NextResponse.json(await loadDriverSuggestions(context.company.id, { months: monthsParam(new URL(request.url).searchParams.get("months")) }));
}

const body = z.object({ key: z.string().min(1).max(200), months: z.number().int().min(2).max(24).optional() });

/**
 * Turn one suggestion into a proposed decision. The effect is recomputed here
 * from the books, never taken from the request, and applies only when a person
 * applies the decision.
 */
export async function POST(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const parsed = body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Name the suggestion to propose." }, { status: 400 });
  const { suggestions } = await loadDriverSuggestions(context.company.id, { months: parsed.data.months ?? 6 });
  const found = suggestions.find((candidate) => candidate.key === parsed.data.key);
  if (!found) return NextResponse.json({ error: "That suggestion is no longer available; the actuals may have changed." }, { status: 404 });
  if (!found.effect || !found.suggestion) return NextResponse.json({ error: found.note ?? "There is nothing to propose for this line." }, { status: 400 });
  const question = found.target.kind === "account" ? `Add a driver for ${found.target.label} from its actuals?` : `Forecast ${found.target.label} from its actuals?`;
  const answer = `${found.summary}. ${found.suggestion.rationale}`;
  const db = getDatabase();
  const [decision] = await db.insert(decisions).values({ companyId: context.company.id, question, answer, status: "proposed", createdByUserId: context.user.id, effect: JSON.stringify(found.effect) }).returning();
  await recordAudit(db, { companyId: context.company.id, actorUserId: context.user.id, via: "ui", action: "decision.proposed", entityType: "decision", entityId: decision!.id, summary: question, after: { answer, effect: found.effect } });
  return NextResponse.json({ decision }, { status: 201 });
}
