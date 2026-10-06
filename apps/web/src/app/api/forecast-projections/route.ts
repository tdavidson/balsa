import { getDatabase } from "@finance/database";
import { loadRecognitionProofs } from "@/lib/recognition-continuity";
import { loadPostedJournalLines } from "@/lib/journal-ledger";
import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { addMonths, buildProjectedEntries } from "@balsa/finance-engine";
import { requireCompanyAccess } from "@/lib/auth";
import { loadForecastAccounts, loadForecastDrivers, loadForecastModel, loadPatternContext, resolveDriversForWindow } from "@/lib/forecast-inputs";

const validMonth = (value: string | null) => Boolean(value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value));

/** Preview projected balanced entries. This endpoint never writes journals. */
export async function GET(request: Request) {
  await auth.protect(); const context = await requireCompanyAccess(); const url = new URL(request.url);
  const start = url.searchParams.get("start"); const end = url.searchParams.get("end"); const scenarioId = url.searchParams.get("scenarioId") ?? undefined;
  if (!validMonth(start) || !validMonth(end) || start! > end!) return NextResponse.json({ error: "start and end must be YYYY-MM, with start no later than end" }, { status: 400 });
  const { drivers: loaded, templates } = await loadForecastDrivers(context.company.id, scenarioId ? { scenarioId } : {});
  const accounts = await loadForecastAccounts(context.company.id); const patternContext = await loadPatternContext(context.company.id);
  const formulas = resolveDriversForWindow(loaded, await loadForecastModel(context.company.id), { start: start!, end: end! }, { templates, accounts, ...(patternContext ? { context: patternContext } : {}) });
  const proofs = await loadRecognitionProofs(getDatabase(), context.company.id, addMonths(start!, -1), context.company.baseCurrency, await loadPostedJournalLines(context.company.id, addMonths(start!, -1)));
  const projection = buildProjectedEntries(formulas.drivers, templates, { start: start!, end: end! }, scenarioId, accounts, proofs);
  return NextResponse.json({ horizon: { start, end }, scenarioId: scenarioId ?? null, entries: projection.entries, exceptions: [...formulas.exceptions, ...projection.exceptions] });
}
