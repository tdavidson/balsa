import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { buildForecastRun, buildProjectedEntries } from "@nevermodel/finance-engine";
import { requireCompanyAccess } from "@/lib/auth";
import { loadForecastDrivers, loadForecastInputs, loadForecastModel, resolveDriversForWindow } from "@/lib/forecast-inputs";

const validMonth = (value: string | null) => Boolean(value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value));

/** Preview projected balanced entries. This endpoint never writes journals. */
export async function GET(request: Request) {
  await auth.protect(); const context = await requireCompanyAccess(); const url = new URL(request.url);
  const start = url.searchParams.get("start"); const end = url.searchParams.get("end"); const scenarioId = url.searchParams.get("scenarioId") ?? undefined;
  if (!validMonth(start) || !validMonth(end) || start! > end!) return NextResponse.json({ error: "start and end must be YYYY-MM, with start no later than end" }, { status: 400 });
  const { drivers: loaded, templates } = await loadForecastDrivers(context.company.id, scenarioId ? { scenarioId } : {});
  const formulas = resolveDriversForWindow(loaded, await loadForecastModel(context.company.id), { start: start!, end: end! });
  const projection = buildProjectedEntries(formulas.drivers, templates, { start: start!, end: end! }, scenarioId);
  let inferredEntries: Record<string, unknown>[] = [];
  if (!scenarioId) {
    const run = buildForecastRun(await loadForecastInputs(context.company.id));
    const grouped = new Map<string, typeof run.projectedLines>();
    for (const line of run.projectedLines.filter((line) => line.entrySource === "forecasted_close" && line.period >= start! && line.period <= end!)) grouped.set(line.entryId ?? line.id, [...(grouped.get(line.entryId ?? line.id) ?? []), line]);
    inferredEntries = [...grouped.entries()].map(([id, lines]) => ({ idempotencyKey: id, projectionKey: id, period: lines[0]!.period, postingDate: lines[0]!.postingDate, memo: lines[0]!.memo ?? "Forecasted close", basis: "forecast", source: "history", lines: lines.map((line) => ({ accountId: line.accountId, debitMinor: line.debitMinor, creditMinor: line.creditMinor })) }));
  }
  return NextResponse.json({ horizon: { start, end }, scenarioId: scenarioId ?? null, entries: [...projection.entries, ...inferredEntries], exceptions: [...formulas.exceptions, ...projection.exceptions] });
}
