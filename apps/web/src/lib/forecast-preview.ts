import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { calculationRuns, companies, decisions, economicItems, evidence, getDatabase } from "@finance/database";
import { buildForecastRun, diffForecastRuns, forecastFormulaVersion, type ForecastRunInput } from "@nevermodel/finance-engine";
import type { ConsequenceSource } from "@/lib/consequence-copy";
import { parseStoredEffect } from "@/lib/decision-effects";
import { projectDecisionEffectOnDrivers } from "@/lib/decision-driver-effects";
import { amountToMinor, economicItemToDriver } from "@/lib/forecast-drivers";
import { compareIds, forecastAsOfMonth, loadForecastAccounts, loadForecastDrivers, loadForecastInputs } from "@/lib/forecast-inputs";

export type ForecastPreviewChange =
  | { kind: "confirm_item"; itemId: string; edits?: { amount?: number; cadence?: "once" | "monthly" | "quarterly" | "annual"; effectiveFrom?: string; effectiveTo?: string | null; category?: string } }
  | { kind: "apply_decision"; decisionId: string };

export class PreviewConflict extends Error {}

/** Parse the stored input, treating a parse failure or a non-object result as not reusable. */
function parseStoredInput(inputJson: string): (Partial<ForecastRunInput> & Record<string, unknown>) | null {
  try {
    const parsed: unknown = JSON.parse(inputJson);
    return parsed && typeof parsed === "object" ? (parsed as Partial<ForecastRunInput> & Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * The base forecast input for a preview. When the latest run at the current
 * formula version is at the company's head revision and its as-of month, its
 * stored actuals summary and settings are reused, so the ledger is not
 * reloaded. Drivers, templates, and active chart accounts are always reloaded:
 * they can change without a revision bump (a new account or template), and a
 * stale account list would exclude a driver whose template uses a new account.
 * Otherwise the whole input is loaded fresh.
 */
async function loadPreviewBaseInput(companyId: string, now: Date): Promise<ForecastRunInput> {
  const db = getDatabase();
  const [[latestRun], [company]] = await Promise.all([
    db.select({ id: calculationRuns.id, revision: calculationRuns.financialStateRevision, inputJson: calculationRuns.inputJson })
      .from(calculationRuns)
      .where(and(eq(calculationRuns.companyId, companyId), eq(calculationRuns.engineVersion, forecastFormulaVersion)))
      .orderBy(desc(sql`${calculationRuns.financialStateRevision}::bigint`), desc(calculationRuns.createdAt))
      .limit(1),
    db.select({ revision: companies.financialStateRevision }).from(companies).where(eq(companies.id, companyId)).limit(1),
  ]);
  if (latestRun && company && latestRun.revision === company.revision) {
    const parsed = parseStoredInput(latestRun.inputJson);
    const asOfMonth = await forecastAsOfMonth(companyId, now, db);
    if (parsed && "actuals" in parsed && parsed.asOfMonth === asOfMonth) {
      const [{ drivers, templates }, accounts] = await Promise.all([loadForecastDrivers(companyId, {}, db), loadForecastAccounts(companyId, db)]);
      return { ...(parsed as ForecastRunInput), drivers: drivers.sort((left, right) => compareIds(left.id, right.id)), templates: templates.sort((left, right) => compareIds(left.id, right.id)), accounts };
    }
  }
  return loadForecastInputs(companyId, { now, db });
}

/**
 * Compute the forecast with and without the change from the same base input
 * (see loadPreviewBaseInput), so the difference is the change alone. The
 * stored run's output is never used. Nothing is written.
 */
export async function previewForecastChange(companyId: string, change: ForecastPreviewChange, now = new Date()) {
  const inputs = await loadPreviewBaseInput(companyId, now);
  const db = getDatabase();
  let drivers = inputs.drivers;
  let sources: ConsequenceSource[] = [];
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
  return { consequence: diffForecastRuns(asIs, withChange), exceptionsAfter: withChange.exceptions.length, sources };
}
