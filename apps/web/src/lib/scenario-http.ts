import "server-only";
import { NextResponse } from "next/server";
import { ScenarioConflict, ScenarioInvalid, ScenarioNotFound } from "@/lib/scenarios";
import { GoalReviewError } from "./goal-reviews";

export function scenarioErrorResponse(error: unknown) {
  if (error instanceof GoalReviewError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof ScenarioNotFound) return NextResponse.json({ error: error.message }, { status: 404 });
  if (error instanceof ScenarioConflict) return NextResponse.json({ error: error.message }, { status: 409 });
  if (error instanceof ScenarioInvalid) return NextResponse.json({ error: error.message }, { status: 400 });
  const cause = error && typeof error === "object" && "cause" in error ? error.cause : error;
  const code = cause && typeof cause === "object" && "code" in cause ? cause.code : null;
  if (code === "42P01" || code === "42703") return NextResponse.json({ error: "Scenario review storage is not current. Run pnpm db:migrate and retry." }, { status: 503 });
  throw error;
}
