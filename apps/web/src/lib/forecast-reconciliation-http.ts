import "server-only";
import { NextResponse } from "next/server";
import { ReconciliationError } from "./forecast-reconciliation";

export function reconciliationErrorResponse(error: unknown) {
  if (error instanceof ReconciliationError) return NextResponse.json({ error: error.message }, { status: error.status });
  const cause = error && typeof error === "object" && "cause" in error ? error.cause : error;
  const code = cause && typeof cause === "object" && "code" in cause ? cause.code : null;
  if (code === "42P01" || code === "42703") return NextResponse.json({ error: "Forecast review storage needs migration. Run pnpm db:migrate and retry." }, { status: 503 });
  if (code === "40001" || code === "23505") return NextResponse.json({ error: "The review changed concurrently. Refresh before retrying." }, { status: 409 });
  return NextResponse.json({ error: "Unable to complete this forecast review. Check application health and retry." }, { status: 500 });
}
