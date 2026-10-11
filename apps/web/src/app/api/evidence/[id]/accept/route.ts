import { NextResponse } from "next/server";
import { z } from "zod";
import { auth, requireCompanyAccess } from "@/lib/auth";
import { AcceptanceError, acceptEvidenceFacts } from "@/lib/evidence-acceptance";

const bodySchema = z.object({ scope: z.enum(["assumed", "minor"]) });

/**
 * Accept a document's facts without a click per fact: either those that meet
 * the owner's confidence threshold, or, on a person's request, the immaterial
 * ones. Everything accepted stays recorded and reversible in review.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await auth.protect();
  const context = await requireCompanyAccess();
  if (request.headers.get("x-company-id") !== context.company.id) return NextResponse.json({ error: "Company selection changed. Reload before continuing." }, { status: 409 });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid evidence ID." }, { status: 400 });
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Choose which facts to accept." }, { status: 400 });
  try {
    return NextResponse.json(await acceptEvidenceFacts(context, id, body.data.scope));
  } catch (error) {
    if (error instanceof AcceptanceError) return NextResponse.json({ error: error.message }, { status: error.status });
    const code = (error as { cause?: { code?: string }; code?: string })?.cause?.code ?? (error as { code?: string })?.code;
    if (code === "42P01" || code === "42703") return NextResponse.json({ error: "Review storage is not current. Run pnpm db:migrate and retry." }, { status: 503 });
    return NextResponse.json({ error: "Unable to accept these facts. Please try again." }, { status: 500 });
  }
}
