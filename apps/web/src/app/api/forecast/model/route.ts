import { and, asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { forecastDimensions, forecastVariables, getDatabase } from "@finance/database";
import { auth, requireCompanyAccess } from "@/lib/auth";

/** The company's active forecast model: dimensions and variables, by name. */
export async function GET() {
  await auth.protect();
  const context = await requireCompanyAccess();
  const db = getDatabase();
  const [dimensions, variables] = await Promise.all([
    db.select({ id: forecastDimensions.id, name: forecastDimensions.name, items: forecastDimensions.items }).from(forecastDimensions).where(and(eq(forecastDimensions.companyId, context.company.id), eq(forecastDimensions.active, "Y"))).orderBy(asc(forecastDimensions.name)),
    db.select({ id: forecastVariables.id, name: forecastVariables.name, kind: forecastVariables.kind, dims: forecastVariables.dims, formula: forecastVariables.formula, inputs: forecastVariables.inputs, decisionId: forecastVariables.decisionId }).from(forecastVariables).where(and(eq(forecastVariables.companyId, context.company.id), eq(forecastVariables.active, "Y"))).orderBy(asc(forecastVariables.name)),
  ]);
  return NextResponse.json({ dimensions, variables });
}
