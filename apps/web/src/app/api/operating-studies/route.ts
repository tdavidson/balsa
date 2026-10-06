import { NextResponse } from "next/server";
import { takeRateLimit } from "@/lib/request-rate-limit";
import { z } from "zod";
import { auth, requireCompanyAccess } from "@/lib/auth";
import {
  executeOperatingStudy,
  loadOperatingStudies,
  loadOperatingStudy,
} from "@/lib/operating-studies";
import { goalDecisionErrorResponse } from "@/lib/goal-decisions-http";
export async function GET(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const params = new URL(request.url).searchParams;
  const id = params.get("id"),
    kind = params.get("kind") ?? "conditional";
  if (
    (id && !z.uuid().safeParse(id).success) ||
    !["conditional", "calibration", "simulation"].includes(kind)
  )
    return NextResponse.json(
      { error: "Invalid study selection." },
      { status: 400 },
    );
  try {
    return NextResponse.json(
      id
        ? await loadOperatingStudy(context.company.id, id)
        : await loadOperatingStudies(context.company.id, kind),
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
  if (text.length > 250_000)
    return NextResponse.json(
      { error: "Study request is too large." },
      { status: 413 },
    );
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  if (
    !takeRateLimit(
      `operating-studies:${context.company.id}:${context.user.id}`,
      12,
      60_000,
    ).allowed
  )
    return NextResponse.json(
      { error: "Too many study requests. Retry in a minute." },
      { status: 429 },
    );
  try {
    return NextResponse.json(
      await executeOperatingStudy(context.company.id, body, context.user.id),
    );
  } catch (error) {
    return goalDecisionErrorResponse(error);
  }
}
