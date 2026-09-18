import { addMonths, type ForecastDriver } from "@nevermodel/finance-engine";
import type { DecisionEffect } from "@/lib/decision-effects";
import { amountToMinor } from "@/lib/forecast-drivers";

/**
 * What applying a decision would do to the base forecast's drivers, in memory.
 * Mirrors `applyDecisionEffect` in decision-effects.ts; the DB-backed parity
 * test in forecast-preview.test.ts fails if the two ever disagree.
 */
export function projectDecisionEffectOnDrivers(drivers: ForecastDriver[], effect: DecisionEffect, decisionId: string): ForecastDriver[] {
  if (effect.kind === "add_item") {
    if (effect.scenario) return drivers;
    const { item } = effect;
    return [...drivers, { id: `decision:${decisionId}`, label: item.label, itemType: item.direction === "spend" ? "obligation" : "agreement", direction: item.direction, category: item.category, amountMinor: amountToMinor(String(item.amount)), cadence: item.cadence, effectiveFrom: item.effectiveFrom, ...(item.effectiveTo ? { effectiveTo: item.effectiveTo } : {}), decisionId }];
  }
  if (effect.kind === "end_item") return drivers.map((driver) => (driver.id === effect.itemId ? { ...driver, effectiveTo: effect.effectiveTo, decisionId } : driver));
  if (effect.kind === "change_amount") {
    const original = drivers.find((driver) => driver.id === effect.itemId);
    if (!original) return drivers;
    const { effectiveTo: _previousEnd, ...copy } = original;
    void _previousEnd;
    return [...drivers.map((driver) => (driver.id === original.id ? { ...driver, effectiveTo: addMonths(effect.effectiveFrom, -1) } : driver)), { ...copy, id: `decision:${decisionId}`, amountMinor: amountToMinor(String(effect.amount)), effectiveFrom: effect.effectiveFrom, decisionId }];
  }
  return drivers.map((driver) => (driver.counterpartyEntityId === effect.entityId ? { ...driver, category: effect.category } : driver));
}
