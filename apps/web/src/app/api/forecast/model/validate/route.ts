import { NextResponse } from "next/server";
import { auth, requireCompanyAccess } from "@/lib/auth";
import { invalidBody } from "@/lib/forecast-model-http";
import { modelDraftSchema } from "@/lib/forecast-model-schema";
import { validateModelDraft } from "@/lib/forecast-model-store";

/** The dry run: errors, warnings, and the first three forecast months for each drafted variable. Writes nothing. */
export async function POST(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const parsed = modelDraftSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error.flatten());
  const draft = parsed.data;
  return NextResponse.json(await validateModelDraft(context.company.id, {
    ...(draft.dimensions ? { dimensions: draft.dimensions.map(({ replaces, ...dimension }) => ({ ...dimension, ...(replaces ? { replaces } : {}) })) } : {}),
    ...(draft.variables ? { variables: draft.variables.map(({ replaces, ...variable }) => ({ ...variable, ...(replaces ? { replaces } : {}) })) } : {}),
    ...(draft.itemFormula !== undefined ? { itemFormula: draft.itemFormula } : {}),
  }));
}
