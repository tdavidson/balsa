import "server-only";
import { NextResponse } from "next/server";
import { ScenarioConflict, ScenarioInvalid, ScenarioNotFound } from "@/lib/scenarios";

export function scenarioErrorResponse(error: unknown) {
  if (error instanceof ScenarioNotFound) return NextResponse.json({ error: error.message }, { status: 404 });
  if (error instanceof ScenarioConflict) return NextResponse.json({ error: error.message }, { status: 409 });
  if (error instanceof ScenarioInvalid) return NextResponse.json({ error: error.message }, { status: 400 });
  throw error;
}
