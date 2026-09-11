import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { summarizeMonths } from "@nevermodel/finance-engine";
import { requireCompanyAccess } from "@/lib/auth";
import { computeFinancials } from "@/lib/financials";
import { decisionEffectSchema, simulationOptions } from "@/lib/decision-effects";

const inputSchema = z.object({ effects: z.array(decisionEffectSchema).min(1).max(20), scenarioId: z.string().uuid().optional() });

/** Run the engine with hypothetical effects and return base and simulated months side by side. Nothing is persisted. */
export async function POST(request: Request) {
  await auth.protect();
  const body = inputSchema.safeParse(await request.json());
  if (!body.success) return NextResponse.json({ error: "Invalid simulation", details: body.error.flatten() }, { status: 400 });
  const context = await requireCompanyAccess();
  const scenario = body.data.scenarioId ? { scenarioId: body.data.scenarioId } : {};
  const [base, simulated] = await Promise.all([
    computeFinancials(context.company.id, scenario),
    computeFinancials(context.company.id, { ...scenario, ...simulationOptions(body.data.effects) }),
  ]);
  const asOf = base.input.asOfMonth;
  const baseMonths = summarizeMonths(base.output, asOf);
  const simulatedMonths = summarizeMonths(simulated.output, asOf);
  return NextResponse.json({
    asOfMonth: asOf,
    months: baseMonths.map((month, index) => ({ month: month.month, base: month, simulated: simulatedMonths[index], deltaEndingCash: (simulatedMonths[index]?.endingCash ?? 0) - (month.endingCash ?? 0), deltaOperatingIncome: (simulatedMonths[index]?.operatingIncome ?? 0) - month.operatingIncome })),
  });
}
