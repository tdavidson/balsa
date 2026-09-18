import "server-only";
import { and, eq } from "drizzle-orm";
import { decisions, economicItems, getDatabase } from "@finance/database";
import { buildForecastRun, diffForecastRuns } from "@nevermodel/finance-engine";
import { parseStoredEffect } from "@/lib/decision-effects";
import { projectDecisionEffectOnDrivers } from "@/lib/decision-driver-effects";
import { amountToMinor, economicItemToDriver } from "@/lib/forecast-drivers";
import { loadForecastInputs } from "@/lib/forecast-inputs";

export type ForecastPreviewChange =
  | { kind: "confirm_item"; itemId: string; edits?: { amount?: number; cadence?: "once" | "monthly" | "quarterly" | "annual"; effectiveFrom?: string; effectiveTo?: string | null; category?: string } }
  | { kind: "apply_decision"; decisionId: string };

export class PreviewConflict extends Error {}

/** Compute both sides fresh, so a stale stored run cannot distort the preview. Nothing is written. */
export async function previewForecastChange(companyId: string, change: ForecastPreviewChange) {
  const inputs = await loadForecastInputs(companyId);
  const db = getDatabase();
  let drivers = inputs.drivers;
  if (change.kind === "confirm_item") {
    const [item] = await db.select().from(economicItems).where(and(eq(economicItems.id, change.itemId), eq(economicItems.companyId, companyId))).limit(1);
    if (!item) throw new PreviewConflict("Item not found");
    if (item.status !== "draft") throw new PreviewConflict("Only a draft item can be previewed");
    if (item.scenarioId) return { consequence: null, exceptionsAfter: 0, note: "Scenario items do not change the base forecast." };
    const edits = change.edits ?? {};
    const driver = economicItemToDriver({ ...item, ...(edits.cadence ? { cadence: edits.cadence } : {}), ...(edits.effectiveFrom ? { effectiveFrom: edits.effectiveFrom } : {}), ...(edits.effectiveTo !== undefined ? { effectiveTo: edits.effectiveTo } : {}), ...(edits.category ? { category: edits.category } : {}) });
    drivers = [...drivers, edits.amount !== undefined ? { ...driver, amountMinor: amountToMinor(String(edits.amount)) } : driver];
  } else {
    const [decision] = await db.select({ status: decisions.status, effect: decisions.effect }).from(decisions).where(and(eq(decisions.id, change.decisionId), eq(decisions.companyId, companyId))).limit(1);
    if (!decision) throw new PreviewConflict("Decision not found");
    if (decision.status !== "proposed") throw new PreviewConflict("Only a proposed decision can be previewed");
    const effect = parseStoredEffect(decision.effect);
    if (!effect) return { consequence: null, exceptionsAfter: 0, note: "This decision has no forecast effect." };
    drivers = projectDecisionEffectOnDrivers(drivers, effect, change.decisionId);
  }
  const asIs = buildForecastRun(inputs);
  const withChange = buildForecastRun({ ...inputs, drivers });
  return { consequence: diffForecastRuns(asIs, withChange), exceptionsAfter: withChange.exceptions.length };
}
