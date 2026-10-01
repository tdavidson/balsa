"use client";

import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { categories } from "@balsa/finance-engine";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { describeScenarioChange, parseScenarioChange, type ScenarioChange, type ScenarioDetail } from "@/lib/scenario-changes";
import { useModelDryRun } from "@/components/item-formula-field";

/** A confirmed base-forecast item a change can re-price or end. */
export type ScenarioItemOption = { id: string; label: string; direction: "receipt" | "spend"; amount: number | null };

type Cadence = "once" | "monthly" | "quarterly" | "annual";
type Draft = { kind: ScenarioChange["kind"]; label: string; direction: "receipt" | "spend"; amount: string; cadence: Cadence; effectiveFrom: string; effectiveTo: string; category: string; itemId: string; endMonth: string; variable: string; coords: Record<string, string>; value: string; formula: string };
type ModelVariable = { name: string; kind: "money" | "number"; dims: string[]; formula: string | null; inputs: { coords: Record<string, string>; from: string; value: string }[] };
type ModelResponse = { dimensions: { name: string; items: string[] }[]; variables: ModelVariable[] };

const field = "h-8 rounded-md border border-rule bg-background px-2 text-[13px] text-ink";
const cadences: Cadence[] = ["monthly", "quarterly", "annual", "once"];
const emptyDraft = (asOfMonth: string | null): Draft => ({ kind: "add_driver", label: "", direction: "spend", amount: "", cadence: "monthly", effectiveFrom: "", effectiveTo: "", category: "other", itemId: "", endMonth: asOfMonth ?? "", variable: "", coords: {}, value: "", formula: "" });

function draftToCandidate(draft: Draft): unknown {
  const amount = Number(draft.amount);
  if (draft.kind === "add_driver") return { kind: "add_driver", label: draft.label, direction: draft.direction, amount, cadence: draft.cadence, effectiveFrom: draft.effectiveFrom, ...(draft.effectiveTo ? { effectiveTo: draft.effectiveTo } : {}), category: draft.category };
  if (draft.kind === "change_amount") return { kind: "change_amount", itemId: draft.itemId, amount, effectiveFrom: draft.effectiveFrom };
  if (draft.kind === "end_item") return { kind: "end_item", itemId: draft.itemId, effectiveTo: draft.endMonth };
  if (draft.kind === "set_input") return { kind: "set_input", variable: draft.variable, coords: draft.coords, from: draft.effectiveFrom, value: draft.value };
  return { kind: "set_formula", variable: draft.variable, formula: draft.formula };
}

/**
 * Create or edit a scenario: a name, a note, and an ordered list of hypothetical changes.
 * The parent mounts it fresh for each opening, so its state starts from `scenario` (null for a new one).
 * `asOfMonth` is the base forecast's as-of month; ending an item there removes it from the forecast.
 */
export function ScenarioEditorDialog({ open, onOpenChange, scenario, items, asOfMonth, onSaved, onDeleted }: {
  open: boolean; onOpenChange: (open: boolean) => void; scenario: ScenarioDetail | null; items: ScenarioItemOption[]; asOfMonth: string | null;
  onSaved: (scenarioId: string) => void; onDeleted: (scenarioId: string) => void;
}) {
  const [name, setName] = useState(() => scenario?.name ?? "");
  const [description, setDescription] = useState(() => scenario?.description ?? "");
  const [changes, setChanges] = useState<ScenarioChange[]>(() => scenario?.changes ?? []);
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(asOfMonth));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [model, setModel] = useState<ModelResponse>({ dimensions: [], variables: [] });
  useEffect(() => { if (open) void fetch("/api/forecast/model").then((response) => response.ok ? response.json() as Promise<ModelResponse> : Promise.reject()).then(setModel).catch(() => setModel({ dimensions: [], variables: [] })); }, [open]);
  const itemLabels = new Map(items.map((item) => [item.id, item.label]));
  const selectedVariable = model.variables.find((variable) => variable.name === draft.variable);
  const dryRunVariable = selectedVariable && (draft.kind === "set_formula" || draft.kind === "set_input") ? {
    ...selectedVariable,
    formula: draft.kind === "set_formula" ? draft.formula : null,
    inputs: draft.kind === "set_formula" ? [] : [...selectedVariable.inputs.filter((input) => input.from !== draft.effectiveFrom || JSON.stringify(input.coords) !== JSON.stringify(draft.coords)), { coords: draft.coords, from: draft.effectiveFrom, value: draft.value }],
  } : null;
  const dryRun = useModelDryRun(dryRunVariable ? { variables: [{ ...dryRunVariable, replaces: selectedVariable!.name }] } : null);
  const update = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));

  function addChange() {
    const change = parseScenarioChange(draftToCandidate(draft));
    if (!change) {
      setError(draft.kind === "add_driver" ? "Enter a label, a positive amount with at most two decimals, a start month, and an end month no earlier than the start." : "Choose an item and a month, and a positive amount when re-pricing.");
      return;
    }
    setChanges((current) => [...current, change]);
    setDraft(emptyDraft(asOfMonth));
    setError(null);
  }

  async function save() {
    if (!name.trim()) { setError("Name the scenario."); return; }
    setSaving(true);
    setError(null);
    try {
      const body = JSON.stringify({ name: name.trim(), description: description.trim() || null, changes });
      const response = scenario
        ? await fetch(`/api/scenarios/${scenario.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body })
        : await fetch("/api/scenarios", { method: "POST", headers: { "content-type": "application/json" }, body });
      const result = (await response.json().catch(() => null)) as { scenario?: { id: string }; error?: string } | null;
      if (!response.ok || !result?.scenario) throw new Error(result?.error ?? "Unable to save the scenario");
      onSaved(result.scenario.id);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save the scenario");
      setSaving(false);
    }
  }

  async function remove() {
    if (!scenario) return;
    if (!window.confirm(`Delete the scenario "${scenario.name}"? This cannot be undone.`)) return;
    setSaving(true);
    setError(null);
    let deleted = false;
    try {
      const response = await fetch(`/api/scenarios/${scenario.id}`, { method: "DELETE" });
      const result = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(result?.error ?? "Unable to delete the scenario");
      deleted = true;
      onDeleted(scenario.id);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete the scenario");
    } finally {
      if (!deleted) setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] rounded-xl border-rule sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle className="display text-[22px] font-medium" style={{ fontVariationSettings: '"opsz" 22' }}>{scenario ? "Edit scenario" : "New scenario"}</DialogTitle>
          <DialogDescription>A scenario changes the forecast only on this dashboard view. Promote it to turn its changes into proposals you apply one by one.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <label className="grid gap-1.5 text-[13px] text-ink-2">Name<Input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} autoFocus /></label>
          <label className="grid gap-1.5 text-[13px] text-ink-2">Note<Input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} placeholder="What this scenario explores" /></label>
          <div className="grid gap-1">
            <div className="text-[12px] uppercase tracking-[0.12em] text-ink-2">Changes</div>
            {changes.length === 0 && <p className="text-[13px] text-pencil">No changes yet.</p>}
            {changes.map((change, index) => (
              <div key={`${change.kind}-${index}`} className="flex items-center justify-between gap-3 border-b border-rule py-1.5 text-[13px]">
                <span className="min-w-0">{describeScenarioChange(change, change.kind === "change_amount" || change.kind === "end_item" ? itemLabels.get(change.itemId) : undefined)}</span>
                <button type="button" aria-label={`Remove change ${index + 1}`} title="Remove" className="text-ink-2 hover:text-ink" onClick={() => setChanges((current) => current.filter((_, position) => position !== index))}><Trash2 className="size-3.5" /></button>
              </div>
            ))}
            {scenario && scenario.itemCount > 0 && <p className="text-[12px] text-pencil">{scenario.itemCount} scenario item{scenario.itemCount === 1 ? "" : "s"} from applied decisions also apply.</p>}
          </div>
          <div className="grid gap-2 rounded-lg border border-rule p-3">
            <select aria-label="Change type" className={field} value={draft.kind} onChange={(event) => update({ kind: event.target.value as ScenarioChange["kind"] })}>
              <option value="add_driver">Add a receipt or expense</option>
              <option value="change_amount">Change an item&apos;s amount</option>
              <option value="end_item">End or remove an item</option>
              <option value="set_input">Set a model input</option>
              <option value="set_formula">Set a model formula</option>
            </select>
            {draft.kind === "add_driver" ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <Input aria-label="Label" placeholder="Label" value={draft.label} onChange={(event) => update({ label: event.target.value })} />
                <select aria-label="Direction" className={field} value={draft.direction} onChange={(event) => update({ direction: event.target.value === "receipt" ? "receipt" : "spend" })}>
                  <option value="spend">Expense</option>
                  <option value="receipt">Receipt</option>
                </select>
                <Input aria-label="Amount" placeholder="Amount" inputMode="decimal" value={draft.amount} onChange={(event) => update({ amount: event.target.value })} />
                <select aria-label="Cadence" className={field} value={draft.cadence} onChange={(event) => update({ cadence: event.target.value as Cadence })}>
                  {cadences.map((cadence) => <option key={cadence} value={cadence}>{cadence}</option>)}
                </select>
                <label className="grid gap-1 text-[12px] text-ink-2">From<Input type="month" value={draft.effectiveFrom} onChange={(event) => update({ effectiveFrom: event.target.value })} /></label>
                <label className="grid gap-1 text-[12px] text-ink-2">To (optional)<Input type="month" value={draft.effectiveTo} onChange={(event) => update({ effectiveTo: event.target.value })} /></label>
                <select aria-label="Category" className={field} value={draft.category} onChange={(event) => update({ category: event.target.value })}>
                  {categories.map((category) => <option key={category} value={category}>{category.replace(/_/g, " ")}</option>)}
                </select>
              </div>
            ) : draft.kind === "change_amount" || draft.kind === "end_item" ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <select aria-label="Item" className={field} value={draft.itemId} onChange={(event) => update({ itemId: event.target.value })}>
                  <option value="">Choose a confirmed item</option>
                  {items.map((item) => <option key={item.id} value={item.id}>{item.label}{item.amount !== null ? ` · ${item.direction === "spend" ? "−" : "+"}$${item.amount.toLocaleString("en-US")}` : ""}</option>)}
                </select>
                {draft.kind === "change_amount" ? (
                  <>
                    <Input aria-label="New amount" placeholder="New amount" inputMode="decimal" value={draft.amount} onChange={(event) => update({ amount: event.target.value })} />
                    <label className="grid gap-1 text-[12px] text-ink-2">From<Input type="month" value={draft.effectiveFrom} onChange={(event) => update({ effectiveFrom: event.target.value })} /></label>
                  </>
                ) : (
                  <label className="grid gap-1 text-[12px] text-ink-2">Last month{asOfMonth ? ` (${asOfMonth} removes it)` : ""}<Input type="month" value={draft.endMonth} onChange={(event) => update({ endMonth: event.target.value })} /></label>
                )}
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                <select aria-label="Variable" className={field} value={draft.variable} onChange={(event) => update({ variable: event.target.value, coords: {} })}>
                  <option value="">Choose a model variable</option>
                  {model.variables.map((variable) => <option key={variable.name} value={variable.name}>{variable.name}</option>)}
                </select>
                {draft.kind === "set_formula" ? (
                  <label className="grid gap-1 text-[12px] text-ink-2 sm:col-span-2">Formula<textarea className={`${field} min-h-20 py-2 font-mono`} value={draft.formula} onChange={(event) => update({ formula: event.target.value })} /></label>
                ) : (
                  <>
                    {selectedVariable?.dims.map((dimensionName) => {
                      const dimension = model.dimensions.find((candidate) => candidate.name === dimensionName);
                      return <label key={dimensionName} className="grid gap-1 text-[12px] text-ink-2">{dimensionName}<select className={field} value={draft.coords[dimensionName] ?? ""} onChange={(event) => update({ coords: { ...draft.coords, [dimensionName]: event.target.value } })}><option value="">Choose {dimensionName}</option>{dimension?.items.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>;
                    })}
                    <label className="grid gap-1 text-[12px] text-ink-2">From<Input type="month" value={draft.effectiveFrom} onChange={(event) => update({ effectiveFrom: event.target.value })} /></label>
                    <label className="grid gap-1 text-[12px] text-ink-2">Value<Input inputMode="decimal" value={draft.value} onChange={(event) => update({ value: event.target.value })} /></label>
                  </>
                )}
                {(dryRun.loading || dryRun.error || dryRun.result?.errors.length) && <div className="sm:col-span-2 text-[12px] text-red-ink" role="status">{dryRun.loading ? "Checking model…" : dryRun.error ?? dryRun.result?.errors.map((issue) => issue.message).join(" · ")}</div>}
              </div>
            )}
            <div><Button type="button" variant="outline" size="sm" onClick={addChange}>Add change</Button></div>
          </div>
          {error && <p className="text-[13px] text-red-ink" role="alert">{error}</p>}
        </div>
        <DialogFooter>
          {scenario && <Button type="button" variant="ghost" className="mr-auto text-red-ink" onClick={remove} disabled={saving}>Delete scenario</Button>}
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" className="rounded-full" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save scenario"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
