import { auth } from "@/lib/auth";
import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { buildProjectedEntries } from "@nevermodel/finance-engine";
import { economicItems, forecastEntryTemplates, getDatabase, journalBatches, journalEntries, journalLines } from "@finance/database";
import { requireCompanyAccess } from "@/lib/auth";
import { postApprovedJournal } from "@/lib/journal-posting";

const body = z.object({ start: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), end: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), scenarioId: z.string().uuid().optional() });
const toMinor = (value: string | null) => { if (!value || !/^\d+(?:\.\d{1,2})?$/.test(value)) return ""; const [whole, fraction = ""] = value.split("."); return `${whole}${fraction.padEnd(2, "0")}`.replace(/^0+(?=\d)/, ""); };

/** Explicitly persist only deterministic, fully approved projected entries. */
export async function POST(request: Request) {
  await auth.protect(); const context = await requireCompanyAccess(); const parsed = body.safeParse(await request.json());
  if (!parsed.success || parsed.data.start > parsed.data.end) return NextResponse.json({ error: "start and end must be an ordered YYYY-MM range" }, { status: 400 });
  const { start, end, scenarioId } = parsed.data; const db = getDatabase();
  const [items, templates] = await Promise.all([
    db.select().from(economicItems).where(and(eq(economicItems.companyId, context.company.id), eq(economicItems.status, "confirmed"))),
    db.select().from(forecastEntryTemplates).where(and(eq(forecastEntryTemplates.companyId, context.company.id), eq(forecastEntryTemplates.active, "Y"))),
  ]);
  const drivers = items.filter((item) => scenarioId ? item.scenarioId === scenarioId : !item.scenarioId).map((item) => ({ id: item.id, label: item.label, itemType: item.type as "agreement" | "obligation", direction: item.direction, ...(item.category ? { category: item.category } : {}), amountMinor: toMinor(item.amount), cadence: item.cadence as "once" | "monthly" | "quarterly" | "annual", effectiveFrom: item.effectiveFrom ?? "", ...(item.effectiveTo ? { effectiveTo: item.effectiveTo } : {}) }));
  const templateRows = templates.map((template) => ({ id: template.id, itemType: template.itemType as "agreement" | "obligation", direction: template.direction, ...(template.category ? { category: template.category } : {}), debitAccountId: template.debitAccountId, creditAccountId: template.creditAccountId, ...(template.decisionId ? { decisionId: template.decisionId } : {}), ...(template.policyId ? { policyId: template.policyId } : {}) }));
  const projection = buildProjectedEntries(drivers, templateRows, { start, end }, scenarioId);
  const templateById = new Map(templateRows.map((template) => [template.id, template]));
  const results = [];
  let reversed = 0;
  for (const entry of projection.entries) {
    const template = templateById.get(entry.templateId)!;
    // A projection has one logical driver/month identity. A changed amount or
    // template creates a new immutable version; the earlier version is
    // explicitly reversed rather than edited or allowed to remain in reports.
    const existing = await db.select({ entryId: journalEntries.id, batchKey: journalBatches.idempotencyKey, scenarioId: journalEntries.scenarioId }).from(journalEntries).innerJoin(journalBatches, eq(journalEntries.batchId, journalBatches.id)).innerJoin(journalLines, eq(journalLines.entryId, journalEntries.id)).where(and(eq(journalEntries.companyId, context.company.id), eq(journalEntries.period, entry.period), eq(journalEntries.basis, entry.basis), eq(journalBatches.source, "forecast_projection"), eq(journalLines.sourceLocation, `forecast-driver:${entry.sourceDriverId}`)));
    const priorEntryIds = [...new Set(existing.filter((row) => row.batchKey !== entry.idempotencyKey && (entry.scenarioId ? row.scenarioId === entry.scenarioId : !row.scenarioId)).map((row) => row.entryId))];
    if (priorEntryIds.length) {
      const priorLines = await db.select({ id: journalLines.id, entryId: journalLines.entryId, accountId: journalLines.accountId, entityId: journalLines.entityId, currency: journalLines.currency, debitMinor: journalLines.debitMinor, creditMinor: journalLines.creditMinor, sourceId: journalLines.sourceId, sourceRowId: journalLines.sourceRowId, evidenceId: journalLines.evidenceId, factId: journalLines.factId, decisionId: journalLines.decisionId, policyId: journalLines.policyId, approvalEventId: journalLines.approvalEventId, sourceLocation: journalLines.sourceLocation, memo: journalLines.memo }).from(journalLines).where(and(eq(journalLines.companyId, context.company.id), inArray(journalLines.entryId, priorEntryIds)));
      for (const priorEntryId of priorEntryIds) {
        const lines = priorLines.filter((line) => line.entryId === priorEntryId);
        if (!lines.length) continue;
        const reversal = await postApprovedJournal(context.company.id, { idempotencyKey: `projection-reversal:${priorEntryId}`, label: `Reverse obsolete ${entry.memo}`, source: "forecast_projection_reversal", postingDate: entry.postingDate, period: entry.period, memo: `Reverse obsolete ${entry.memo}`, basis: entry.basis, ...(entry.scenarioId ? { scenarioId: entry.scenarioId } : {}), reversalOfEntryId: priorEntryId, ...(template.decisionId ? { decisionId: template.decisionId } : {}), ...(template.policyId ? { policyId: template.policyId } : {}), lines: lines.map((line, index) => ({ accountId: line.accountId, ...(line.entityId ? { entityId: line.entityId } : {}), currency: line.currency, debitMinor: line.creditMinor, creditMinor: line.debitMinor, externalKey: `projection-reversal:${priorEntryId}:${index}`, sourceLocation: line.sourceLocation ?? `forecast-driver:${entry.sourceDriverId}`, ...(template.decisionId ? { decisionId: template.decisionId } : {}), ...(template.policyId ? { policyId: template.policyId } : {}) })) });
        if (!reversal.idempotent) reversed += 1;
      }
    }
    results.push(await postApprovedJournal(context.company.id, { idempotencyKey: entry.idempotencyKey, label: entry.memo, source: "forecast_projection", postingDate: entry.postingDate, period: entry.period, memo: entry.memo, basis: entry.basis, ...(entry.scenarioId ? { scenarioId: entry.scenarioId } : {}), ...(template.decisionId ? { decisionId: template.decisionId } : {}), ...(template.policyId ? { policyId: template.policyId } : {}), lines: entry.lines.map((line, index) => ({ ...line, currency: context.company.baseCurrency, externalKey: `${entry.idempotencyKey}:${index}`, sourceLocation: `forecast-driver:${entry.sourceDriverId}`, ...(template.decisionId ? { decisionId: template.decisionId } : {}), ...(template.policyId ? { policyId: template.policyId } : {}) })) }));
  }
  return NextResponse.json({ posted: results.length, idempotent: results.filter((result) => result.idempotent).length, reversed, exceptions: projection.exceptions, entries: results });
}
