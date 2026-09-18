import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { decisions, economicItems, evidence, getDatabase } from "@finance/database";
import { buildForecastRun, diffForecastRuns } from "@nevermodel/finance-engine";
import type { ConsequenceSource } from "@/lib/consequence-copy";
import { parseStoredEffect } from "@/lib/decision-effects";
import { projectDecisionEffectOnDrivers } from "@/lib/decision-driver-effects";
import { loadForecastBase } from "@/lib/forecast-base";
import { amountToMinor, economicItemToDriver } from "@/lib/forecast-drivers";

export type ForecastPreviewChange =
  | { kind: "confirm_item"; itemId: string; edits?: { amount?: number; cadence?: "once" | "monthly" | "quarterly" | "annual"; effectiveFrom?: string; effectiveTo?: string | null; category?: string } }
  | { kind: "confirm_items"; itemIds: string[] }
  | { kind: "apply_decision"; decisionId: string };

export class PreviewConflict extends Error {}

/**
 * Compute the forecast with and without the change from the same base input
 * (see loadForecastBase in forecast-base.ts), so the difference is the change alone. The
 * stored run's output is never used. Nothing is written.
 */
export async function previewForecastChange(companyId: string, change: ForecastPreviewChange, now = new Date()) {
  const inputs = await loadForecastBase(companyId, now);
  const db = getDatabase();
  let drivers = inputs.drivers;
  let sources: ConsequenceSource[] = [];
  let note: string | undefined;
  if (change.kind === "confirm_item") {
    const [item] = await db.select().from(economicItems).where(and(eq(economicItems.id, change.itemId), eq(economicItems.companyId, companyId))).limit(1);
    if (!item) throw new PreviewConflict("Item not found");
    if (item.status !== "draft") throw new PreviewConflict("Only a draft item can be previewed");
    if (item.scenarioId) return { consequence: null, exceptionsAfter: 0, note: "Scenario items do not change the base forecast.", sources };
    if (item.evidenceId) {
      const [source] = await db.select({ sourceName: evidence.sourceName }).from(evidence).where(and(eq(evidence.id, item.evidenceId), eq(evidence.companyId, companyId))).limit(1);
      if (source) sources = [{ evidenceId: item.evidenceId, sourceName: source.sourceName }];
    }
    const edits = change.edits ?? {};
    const driver = economicItemToDriver({ ...item, ...(edits.cadence ? { cadence: edits.cadence } : {}), ...(edits.effectiveFrom ? { effectiveFrom: edits.effectiveFrom } : {}), ...(edits.effectiveTo !== undefined ? { effectiveTo: edits.effectiveTo } : {}), ...(edits.category ? { category: edits.category } : {}) });
    drivers = [...drivers, edits.amount !== undefined ? { ...driver, amountMinor: amountToMinor(String(edits.amount)) } : driver];
  } else if (change.kind === "confirm_items") {
    const items = await db.select().from(economicItems).where(and(eq(economicItems.companyId, companyId), inArray(economicItems.id, change.itemIds)));
    if (items.length !== change.itemIds.length) throw new PreviewConflict("Items not found");
    if (items.some((item) => item.status !== "draft")) throw new PreviewConflict("Only a draft item can be previewed");
    const nonScenario = items.filter((item) => !item.scenarioId);
    const scenarioCount = items.length - nonScenario.length;
    if (!nonScenario.length) return { consequence: null, exceptionsAfter: 0, note: "Scenario items do not change the base forecast.", sources };
    const evidenceIds = [...new Set(nonScenario.map((item) => item.evidenceId).filter((id): id is string => id !== null))];
    if (evidenceIds.length) {
      const rows = await db.select({ id: evidence.id, sourceName: evidence.sourceName }).from(evidence).where(and(eq(evidence.companyId, companyId), inArray(evidence.id, evidenceIds)));
      const byId = new Map(rows.map((row) => [row.id, row.sourceName]));
      sources = evidenceIds.filter((id) => byId.has(id)).map((id) => ({ evidenceId: id, sourceName: byId.get(id) ?? null }));
    }
    drivers = [...drivers, ...nonScenario.map((item) => economicItemToDriver(item))];
    if (scenarioCount > 0) note = `${scenarioCount} scenario item${scenarioCount === 1 ? "" : "s"} skipped`;
  } else {
    const [decision] = await db.select({ status: decisions.status, effect: decisions.effect }).from(decisions).where(and(eq(decisions.id, change.decisionId), eq(decisions.companyId, companyId))).limit(1);
    if (!decision) throw new PreviewConflict("Decision not found");
    if (decision.status !== "proposed") throw new PreviewConflict("Only a proposed decision can be previewed");
    const effect = parseStoredEffect(decision.effect);
    if (!effect) return { consequence: null, exceptionsAfter: 0, note: "This decision has no forecast effect.", sources };
    drivers = projectDecisionEffectOnDrivers(drivers, effect, change.decisionId);
  }
  const asIs = buildForecastRun(inputs);
  const withChange = buildForecastRun({ ...inputs, drivers });
  return { consequence: diffForecastRuns(asIs, withChange), exceptionsAfter: withChange.exceptions.length, sources, ...(note !== undefined ? { note } : {}) };
}
