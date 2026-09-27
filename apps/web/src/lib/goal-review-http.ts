import "server-only";
import { NextResponse } from "next/server";
import { GoalReviewError } from "./goal-reviews";

export function goalReviewErrorResponse(error: unknown) {
  if (error instanceof GoalReviewError) return NextResponse.json({ error: error.message }, { status: error.status });
  const cause = error && typeof error === "object" && "cause" in error ? error.cause : error;
  const code = cause && typeof cause === "object" && "code" in cause ? cause.code : null;
  if (code === "42P01" || code === "42703") return NextResponse.json({ error: "Goal review storage is not current. Run pnpm db:migrate and retry." }, { status: 503 });
  if (code === "40001" || code === "23505") return NextResponse.json({ error: "The review changed concurrently. Refresh and try again." }, { status: 409 });
  return NextResponse.json({ error: "Unable to load or save this financial review. Try again after checking application health." }, { status: 500 });
}
