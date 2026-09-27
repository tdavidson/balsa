import "server-only";
import { NextResponse } from "next/server";
import { ScenarioConflict, ScenarioInvalid, ScenarioNotFound } from "./scenarios";
import { ScenarioChangeInvalid } from "./scenario-changes";
import { goalReviewErrorResponse } from "./goal-review-http";

export function goalDecisionErrorResponse(error: unknown) {
  if (error instanceof ScenarioNotFound) return NextResponse.json({ error: "Active scenario not found for this company." }, { status: 404 });
  if (error instanceof ScenarioConflict) return NextResponse.json({ error: "Scenario changed concurrently. Refresh and retry." }, { status: 409 });
  if (error instanceof ScenarioInvalid || error instanceof ScenarioChangeInvalid) return NextResponse.json({ error: "The scenario contains changes that cannot be applied. Review its items and model inputs." }, { status: 422 });
  return goalReviewErrorResponse(error);
}
