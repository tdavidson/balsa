import { NextResponse } from "next/server";
import { AuthenticationRequiredError, CompanyAccessDeniedError, InvalidCompanyInputError, type CompanySummary } from "@finance/auth";
import { auth, createCompany, listCompanies, requireCompanyAccess, requireUser } from "@/lib/auth";
import { setActiveCompanyCookie } from "@/lib/auth/company-selection";
import { takeRateLimit } from "@/lib/request-rate-limit";

/** Only the fields the account menu needs leave the server; the revision and every other company column stay internal. */
const toSummary = ({ id, name, baseCurrency, role }: CompanySummary): CompanySummary => ({ id, name, baseCurrency, role });

function errorResponse(error: unknown) {
  if (error instanceof CompanyAccessDeniedError) return NextResponse.json({ error: "You do not have access to that company" }, { status: 403 });
  if (error instanceof InvalidCompanyInputError) return NextResponse.json({ error: error.message }, { status: 400 });
  if (error instanceof AuthenticationRequiredError) return NextResponse.json({ error: "Authentication is required" }, { status: 401 });
  throw error;
}

export async function GET() {
  await auth.protect();
  try {
    const context = await requireCompanyAccess();
    const companies = await listCompanies();
    return NextResponse.json({ companies: companies.map(toSummary), activeCompanyId: context.company.id });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  await auth.protect();
  try {
    const user = await requireUser();
    const quota = takeRateLimit(`companies:${user.id}`, 20, 60 * 60 * 1_000);
    if (!quota.allowed) return NextResponse.json({ error: "Company creation limit reached. Try again later." }, { status: 429, headers: { "Retry-After": String(quota.retryAfterSeconds) } });
    const body = (await request.json().catch(() => ({}))) as { name?: unknown; baseCurrency?: unknown };
    const company = await createCompany(body);
    await setActiveCompanyCookie(company.id);
    return NextResponse.json({ company: toSummary(company) }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
