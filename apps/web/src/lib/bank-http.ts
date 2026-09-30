import { NextResponse } from "next/server";
import { AuthenticationRequiredError, CompanyRoleRequiredError, CompanyAccessDeniedError } from "@finance/auth";
import { BankError } from "./teller";
export function bankErrorResponse(error: unknown) {
  if (error instanceof BankError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof AuthenticationRequiredError) return NextResponse.json({ error: "Sign in to manage bank connections." }, { status: 401 });
  if (error instanceof CompanyRoleRequiredError || error instanceof CompanyAccessDeniedError) return NextResponse.json({ error: "Company owner access is required." }, { status: 403 });
  const cause = error && typeof error === "object" && "cause" in error ? error.cause : error;
  const code = cause && typeof cause === "object" && "code" in cause ? cause.code : null;
  if (code === "42P01" || code === "42703") return NextResponse.json({ error: "Bank storage is not current. Run pnpm db:migrate." }, { status: 503 });
  if (code === "23505") return NextResponse.json({ error: "This enrollment or account is already connected. Use its existing company connection." }, { status: 409 });
  return NextResponse.json({ error: "Unable to complete the bank request. Check configuration and try again." }, { status: 500 });
}
export async function bankJson(request: Request) {
  const reader = request.body?.getReader(); if (!reader) throw new BankError("Missing request body.");
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > 16_384) { await reader.cancel(); throw new BankError("Bank request is too large.", 413); } chunks.push(next.value); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; } catch { throw new BankError("Invalid bank request."); }
}
