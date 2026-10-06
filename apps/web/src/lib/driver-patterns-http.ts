import "server-only";
import { NextResponse } from "next/server";
import { PatternInvalid, PatternNotFound } from "@/lib/driver-patterns-store";
import { modelErrorResponse } from "@/lib/forecast-model-http";

export function patternErrorResponse(error: unknown) {
  if (error instanceof PatternInvalid) return NextResponse.json({ error: error.message }, { status: 400 });
  if (error instanceof PatternNotFound) return NextResponse.json({ error: error.message }, { status: 404 });
  return modelErrorResponse(error);
}
