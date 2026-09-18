import { z } from "zod";
import {
  buildForecastRun, categories, diffForecastRuns,
  type Category, type ForecastConsequence, type ForecastDriver, type ForecastMonth, type ForecastRun, type ForecastRunInput, type ForecastRunway,
} from "@nevermodel/finance-engine";
import type { ConsequenceSource } from "@/lib/consequence-copy";
import type { DecisionEffect } from "@/lib/decision-effects";
import { projectDecisionEffectOnDrivers } from "@/lib/decision-driver-effects";

/**
 * A scenario is a named, ordered list of hypothetical changes to the base
 * forecast's drivers. The three kinds mirror the decision effects, so each
 * change maps to exactly one `DecisionEffect`. That mapping is how a scenario
 * is applied (through `projectDecisionEffectOnDrivers`) and how it is promoted
 * into proposed decisions, so the two can never disagree. Amounts are dollars,
 * like decision effects. "Remove an item" is `end_item` at the forecast as-of.
 */
export type ScenarioChange =
  | { kind: "add_driver"; label: string; direction: "receipt" | "spend"; amount: number; cadence: "once" | "monthly" | "quarterly" | "annual"; effectiveFrom: string; effectiveTo?: string; category?: Category }
  | { kind: "change_amount"; itemId: string; amount: number; effectiveFrom: string }
  | { kind: "end_item"; itemId: string; effectiveTo: string };

export type ScenarioSummary = { id: string; name: string; description: string | null; changeCount: number; itemCount: number };
export type ScenarioDetail = { id: string; name: string; description: string | null; changes: ScenarioChange[]; itemCount: number };
/** What `GET /api/scenarios/[id]/forecast` returns: the scenario's forecast-basis months and runway, and its consequence versus the base. */
export type ScenarioForecastView = { scenario: ScenarioDetail; months: ForecastMonth[]; runway: ForecastRunway; consequence: ForecastConsequence | null; exceptions: ForecastRun["exceptions"]; sources: ConsequenceSource[] };

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
/** Positive dollars with at most two decimals, so `amountToMinor` never turns the amount into a driver exception. */
const dollars = z.number().positive().refine((value) => /^\d+(?:\.\d{1,2})?$/.test(String(value)), "At most two decimal places");
const cadence = z.enum(["once", "monthly", "quarterly", "annual"]);

export const scenarioChangeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("add_driver"), label: z.string().trim().min(1).max(200), direction: z.enum(["receipt", "spend"]), amount: dollars, cadence, effectiveFrom: month, effectiveTo: month.optional(), category: z.enum(categories).optional() }),
  z.object({ kind: z.literal("change_amount"), itemId: z.string().uuid(), amount: dollars, effectiveFrom: month }),
  z.object({ kind: z.literal("end_item"), itemId: z.string().uuid(), effectiveTo: month }),
]);

/** One change, validated and rebuilt without `undefined` optionals; null when invalid. */
export function parseScenarioChange(value: unknown): ScenarioChange | null {
  const parsed = scenarioChangeSchema.safeParse(value);
  if (!parsed.success) return null;
  const change = parsed.data;
  if (change.kind === "add_driver") {
    if (change.effectiveTo && change.effectiveTo < change.effectiveFrom) return null;
    return { kind: "add_driver", label: change.label, direction: change.direction, amount: change.amount, cadence: change.cadence, effectiveFrom: change.effectiveFrom, ...(change.effectiveTo ? { effectiveTo: change.effectiveTo } : {}), ...(change.category ? { category: change.category } : {}) };
  }
  if (change.kind === "change_amount") return { kind: "change_amount", itemId: change.itemId, amount: change.amount, effectiveFrom: change.effectiveFrom };
  return { kind: "end_item", itemId: change.itemId, effectiveTo: change.effectiveTo };
}

/** A whole change list from a request: every entry must be valid, or the list is rejected (null). At most 100 changes. */
export function parseScenarioChanges(value: unknown): ScenarioChange[] | null {
  if (!Array.isArray(value) || value.length > 100) return null;
  const changes = value.map(parseScenarioChange);
  return changes.every((change): change is ScenarioChange => change !== null) ? changes : null;
}

/** A stored list, read leniently: rows written before a schema change keep their valid entries. */
export function parseStoredChanges(value: unknown): ScenarioChange[] {
  if (!Array.isArray(value)) return [];
  return value.map(parseScenarioChange).filter((change): change is ScenarioChange => change !== null);
}

/** The agent's flat shape: every key present, unused ones null. Nulls are dropped before the strict parse. */
export function scenarioChangeFromFlat(value: unknown): ScenarioChange | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return parseScenarioChange(Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== null)));
}

/** The decision effect a change stands for. A missing category becomes "other", both here and in promotion. */
export function scenarioChangeToEffect(change: ScenarioChange): DecisionEffect {
  if (change.kind === "add_driver") {
    return { kind: "add_item", item: { label: change.label, direction: change.direction, amount: change.amount, cadence: change.cadence, effectiveFrom: change.effectiveFrom, ...(change.effectiveTo ? { effectiveTo: change.effectiveTo } : {}), category: change.category ?? "other", accountingTreatment: "cash" } };
  }
  if (change.kind === "change_amount") return { kind: "change_amount", itemId: change.itemId, amount: change.amount, effectiveFrom: change.effectiveFrom };
  return { kind: "end_item", itemId: change.itemId, effectiveTo: change.effectiveTo };
}

/**
 * The scenario change for a decision effect, or null when the effect is not a driver change (set_category, none).
 * An add_item's counterparty, non-cash treatment, recognition window, and scenario name are not carried.
 */
export function effectToScenarioChange(effect: DecisionEffect | undefined): ScenarioChange | null {
  if (!effect) return null;
  if (effect.kind === "add_item") {
    const { item } = effect;
    return { kind: "add_driver", label: item.label, direction: item.direction, amount: item.amount, cadence: item.cadence, effectiveFrom: item.effectiveFrom, ...(item.effectiveTo ? { effectiveTo: item.effectiveTo } : {}), category: item.category };
  }
  if (effect.kind === "change_amount") return { kind: "change_amount", itemId: effect.itemId, amount: effect.amount, effectiveFrom: effect.effectiveFrom };
  if (effect.kind === "end_item") return { kind: "end_item", itemId: effect.itemId, effectiveTo: effect.effectiveTo };
  return null;
}

/** One line per change. An add matches `describeEffect` for the equivalent add_item exactly. */
export function describeScenarioChange(change: ScenarioChange, itemLabel?: string): string {
  const money = (amount: number) => `$${amount.toLocaleString("en-US")}`;
  if (change.kind === "add_driver") return `${change.direction === "spend" ? "Adds an expense" : "Adds a receipt"}: ${change.label} ${money(change.amount)} ${change.cadence} from ${change.effectiveFrom}${change.effectiveTo ? ` to ${change.effectiveTo}` : ""}`;
  if (change.kind === "change_amount") return `Changes ${itemLabel ?? "an item"} to ${money(change.amount)} from ${change.effectiveFrom}`;
  return `Ends ${itemLabel ?? "an item"} after ${change.effectiveTo}`;
}

/** The driver id a change adds, stable for a scenario's saved change list. */
export const scenarioDriverId = (scenarioId: string, index: number) => `scenario:${scenarioId}:${index}`;

function withoutDecision(driver: ForecastDriver): ForecastDriver {
  const { decisionId: _decisionId, ...rest } = driver;
  void _decisionId;
  return rest;
}

/**
 * Apply changes in order, each through `projectDecisionEffectOnDrivers` with the
 * change's scenario driver id standing in for a decision id. Then relabel: an
 * added driver takes the id `scenario:<scenarioId>:<index>`, carries the
 * scenario, and has no decision. A driver the change only touched keeps the
 * decision lineage it had before. A change whose item is absent does nothing.
 */
export function applyScenarioChanges(drivers: ForecastDriver[], changes: ScenarioChange[], scenarioId: string): ForecastDriver[] {
  return changes.reduce<ForecastDriver[]>((current, change, index) => {
    const id = scenarioDriverId(scenarioId, index);
    const priorDecisionIds = new Map(current.map((driver) => [driver.id, driver.decisionId]));
    return projectDecisionEffectOnDrivers(current, scenarioChangeToEffect(change), id).map((driver) => {
      if (driver.id === `decision:${id}`) return { ...withoutDecision(driver), id, scenarioId };
      if (driver.decisionId !== id) return driver;
      const prior = priorDecisionIds.get(driver.id);
      return prior ? { ...withoutDecision(driver), decisionId: prior } : withoutDecision(driver);
    });
  }, drivers);
}

/**
 * The base run and the changed run built from one input, and their difference.
 * The changed drivers are the base drivers, then `scenarioDrivers` (a saved
 * scenario's confirmed items), then `changes`. Nothing is written.
 */
export function runSimulation(base: ForecastRunInput, changes: ScenarioChange[], options: { scenarioId?: string; scenarioDrivers?: ForecastDriver[] } = {}) {
  const drivers = applyScenarioChanges([...base.drivers, ...(options.scenarioDrivers ?? [])], changes, options.scenarioId ?? "adhoc");
  const baseRun = buildForecastRun(base);
  const run = buildForecastRun({ ...base, drivers });
  return { baseRun, run, consequence: diffForecastRuns(baseRun, run) };
}
