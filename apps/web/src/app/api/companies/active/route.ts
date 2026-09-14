import { NextResponse } from "next/server";
import { AuthenticationRequiredError, CompanyAccessDeniedError, isCompanyId } from "@finance/auth";
import { auth, requireCompanyAccess } from "@/lib/auth";
import { clearActiveCompanyCookie, setActiveCompanyCookie } from "@/lib/auth/company-selection";

function errorResponse(error: unknown) {
  if (error instanceof CompanyAccessDeniedError) return NextResponse.json({ error: "You do not have access to that company" }, { status: 403 });
  if (error instanceof AuthenticationRequiredError) return NextResponse.json({ error: "Authentication is required" }, { status: 401 });
  throw error;
}

export async function PUT(request: Request) {
  await auth.protect();
  const body = (await request.json().catch(() => ({}))) as { companyId?: unknown };
  if (!isCompanyId(body.companyId)) return NextResponse.json({ error: "A valid company id is required" }, { status: 400 });
  try {
    // The cookie is only written after membership in the requested company is
    // proven, so a caller can never store a company it may not open.
    const context = await requireCompanyAccess(body.companyId);
    await setActiveCompanyCookie(context.company.id);
    return NextResponse.json({ activeCompanyId: context.company.id });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE() {
  await auth.protect();
  await clearActiveCompanyCookie();
  return new NextResponse(null, { status: 204 });
}
