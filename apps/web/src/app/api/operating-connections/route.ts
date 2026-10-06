import { takeRateLimit } from "@/lib/request-rate-limit";
import { NextResponse } from "next/server";
import { auth, requireCompanyAccess } from "@/lib/auth";
import {
  executeOperatingConnection,
  loadOperatingConnections,
} from "@/lib/operating-connections";
import { goalDecisionErrorResponse } from "@/lib/goal-decisions-http";
export async function GET() {
  await auth.protect();
  const context = await requireCompanyAccess();
  try {
    return NextResponse.json(
      await loadOperatingConnections(context.company.id),
    );
  } catch (error) {
    return goalDecisionErrorResponse(error);
  }
}
export async function POST(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  if (request.headers.get("x-company-id") !== context.company.id)
    return NextResponse.json(
      { error: "Company selection changed. Reload before continuing." },
      { status: 409 },
    );
  const text = await request.text();
  if (text.length > 100_000)
    return NextResponse.json(
      { error: "Operating-model request is too large." },
      { status: 413 },
    );
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  if (
    (body as { action?: string } | null)?.action === "suggest_sources" &&
    !takeRateLimit(
      `operating-sources:${context.company.id}:${context.user.id}`,
      10,
      60_000,
    ).allowed
  )
    return NextResponse.json(
      { error: "Too many source suggestion requests. Retry in a minute." },
      { status: 429 },
    );
  try {
    return NextResponse.json(
      await executeOperatingConnection(
        context.company.id,
        body,
        context.user.id,
      ),
    );
  } catch (error) {
    return goalDecisionErrorResponse(error);
  }
}
