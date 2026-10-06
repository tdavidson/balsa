"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Ref = { kind: "driver"; driverId: string } | { kind: "metric"; name: string } | { kind: "report_line"; line: string };
type Escalation = { rate: string; everyMonths: number; anchor: "driver_start" | { calendarMonth: number } };
type Pattern = { initialValue: string; repeatsEveryMonths: number; change?: { basis: "pct_change" | "abs_change" | "log_change"; everyMonths: number; by: string } | { basis: "pct_of" | "per_unit"; ref: Ref }; maxMonths?: number; maxValue?: string; seasonalityProfileId?: string; escalation?: "company" | Escalation };
type Driver = { id: string; label: string; direction: "receipt" | "spend"; amount: string | null; cadence: string | null; effectiveFrom: string | null; effectiveTo: string | null; amountFormula: string | null; pattern: Pattern | null; summary: string | null; lineLabel: string | null; next: { month: string; amountMinor: string | null }[]; exception: string | null };
type Metric = { id: string; name: string; label: string; unit: string | null; effectiveFrom: string; effectiveTo: string | null; pattern: Pattern; values: Record<string, string> | null; exception: string | null; lastActual: { month: string; value: string; sourceName: string | null } | null; actualCount: number };
type Actual = { month: string; value: string; sourceName?: string | null; factLabel?: string | null; decisionId?: string | null; removed?: boolean; added?: boolean };
type Profile = { id: string; name: string; deviations: string[] };
type Overview = { asOfMonth: string; months: string[]; stale: boolean; drivers: Driver[]; metrics: Metric[]; seasonality: Profile[]; escalation: Escalation | null; lines: { id: string; label: string; section: string }[] };
type Suggestion = { key: string; target: { kind: "driver" | "account" | "metric"; label: string; lineLabel?: string | null }; history: { month: string; value: number }[]; suggestion: { basis: string; rationale: string; confidence: "high" | "medium" | "low" } | null; summary: string | null; effect: unknown; note: string | null };
type Basis = "fixed" | "pct_change" | "abs_change" | "log_change" | "pct_of" | "per_unit";

const field = "h-8 rounded-md border border-border bg-transparent px-2 text-[13px]";
const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (period: string) => `${monthNames[Number(period.slice(5, 7)) - 1]} ${period.slice(2, 4)}`;
const money = (minor: string | null) => minor === null ? "—" : minor === "0" ? "–" : `$${(Number(minor) / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
/** Percent typed by a person ("5") to the stored decimal ("0.05"), exactly. */
const fromPercent = (text: string) => { const value = Number(text); return Number.isFinite(value) ? String(Number((value / 100).toFixed(6))) : ""; };
const toPercent = (decimal: string | undefined) => decimal === undefined ? "" : String(Number((Number(decimal) * 100).toFixed(4)));
const errorText = async (response: Response) => (await response.json().catch(() => ({}))).error ?? "Something went wrong.";

/** Editable draft of a pattern, in the units a person types (percentages as percentages). */
type Draft = { basis: Basis; initial: string; repeats: string; changeEvery: string; changeBy: string; ref: string; maxMonths: string; maxValue: string; seasonality: string; escalation: "none" | "company" | "custom"; escRate: string; escEvery: string; escAnchor: string };
const blankDraft: Draft = { basis: "fixed", initial: "", repeats: "1", changeEvery: "12", changeBy: "", ref: "", maxMonths: "", maxValue: "", seasonality: "", escalation: "none", escRate: "3", escEvery: "12", escAnchor: "start" };
const refKey = (ref: Ref) => ref.kind === "driver" ? `driver:${ref.driverId}` : ref.kind === "metric" ? `metric:${ref.name}` : `line:${ref.line}`;
const keyRef = (key: string): Ref | null => { const [kind, ...rest] = key.split(":"); const value = rest.join(":"); return !value ? null : kind === "driver" ? { kind, driverId: value } : kind === "metric" ? { kind, name: value } : kind === "line" ? { kind: "report_line", line: value } : null; };

function toDraft(pattern: Pattern | null, fallbackAmount: string | null): Draft {
  if (!pattern) return { ...blankDraft, initial: fallbackAmount ?? "" };
  const change = pattern.change; const escalation = pattern.escalation;
  return {
    basis: change ? change.basis : "fixed",
    initial: change?.basis === "pct_of" ? toPercent(pattern.initialValue) : pattern.initialValue,
    repeats: String(pattern.repeatsEveryMonths),
    changeEvery: change && "everyMonths" in change ? String(change.everyMonths) : "12",
    changeBy: change && "by" in change ? (change.basis === "pct_change" ? toPercent(change.by) : change.by) : "",
    ref: change && "ref" in change ? refKey(change.ref) : "",
    maxMonths: pattern.maxMonths ? String(pattern.maxMonths) : "", maxValue: pattern.maxValue ?? "",
    seasonality: pattern.seasonalityProfileId ?? "",
    escalation: escalation === "company" ? "company" : escalation ? "custom" : "none",
    escRate: escalation && escalation !== "company" ? toPercent(escalation.rate) : "3", escEvery: escalation && escalation !== "company" ? String(escalation.everyMonths) : "12",
    escAnchor: escalation && escalation !== "company" && escalation.anchor !== "driver_start" ? String(escalation.anchor.calendarMonth) : "start",
  };
}

function fromDraft(draft: Draft): Pattern | string {
  const whole = (text: string) => Number.isInteger(Number(text)) && text.trim() !== "";
  if (!draft.initial.trim() || !Number.isFinite(Number(draft.initial))) return "Enter a starting value.";
  if (!whole(draft.repeats)) return "Repeats every N months must be a whole number.";
  const pattern: Pattern = { initialValue: draft.basis === "pct_of" ? fromPercent(draft.initial) : String(Number(draft.initial)), repeatsEveryMonths: Number(draft.repeats) };
  if (draft.basis === "pct_change" || draft.basis === "abs_change" || draft.basis === "log_change") {
    if (!whole(draft.changeEvery) || !draft.changeBy.trim() || !Number.isFinite(Number(draft.changeBy))) return "Enter how much it changes and how often.";
    pattern.change = { basis: draft.basis, everyMonths: Number(draft.changeEvery), by: draft.basis === "pct_change" ? fromPercent(draft.changeBy) : String(Number(draft.changeBy)) };
  }
  if (draft.basis === "pct_of" || draft.basis === "per_unit") { const ref = keyRef(draft.ref); if (!ref) return "Choose what it is based on."; pattern.change = { basis: draft.basis, ref }; }
  if (draft.maxMonths.trim()) { if (!whole(draft.maxMonths)) return "For a maximum of N months must be a whole number."; pattern.maxMonths = Number(draft.maxMonths); }
  if (draft.maxValue.trim()) pattern.maxValue = String(Number(draft.maxValue));
  if (draft.seasonality) pattern.seasonalityProfileId = draft.seasonality;
  if (draft.escalation === "company") pattern.escalation = "company";
  if (draft.escalation === "custom") { if (!whole(draft.escEvery)) return "The escalation cycle must be a whole number of months."; pattern.escalation = { rate: fromPercent(draft.escRate), everyMonths: Number(draft.escEvery), anchor: draft.escAnchor === "start" ? "driver_start" : { calendarMonth: Number(draft.escAnchor) } }; }
  return pattern;
}

/** The Standard model's driver inputs, as a form. Used for drivers and for operating metrics. */
function PatternForm({ draft, onChange, data, selfKey, money: isMoney }: { draft: Draft; onChange: (draft: Draft) => void; data: Overview; selfKey: string; money: boolean }) {
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => onChange({ ...draft, [key]: value });
  const stepped = draft.basis === "pct_change" || draft.basis === "abs_change" || draft.basis === "log_change";
  const linked = draft.basis === "pct_of" || draft.basis === "per_unit";
  const initialLabel = draft.basis === "pct_of" ? "Percent of it" : draft.basis === "per_unit" ? (isMoney ? "Amount per unit" : "Per unit") : isMoney ? "Starting amount" : "Starting value";
  return <div className="grid gap-3 text-[13px] sm:grid-cols-2">
    <label className="grid gap-1">Changing based on<select className={field} onChange={(event) => set("basis", event.target.value as Basis)} value={draft.basis}>
      <option value="fixed">Nothing: a fixed amount</option><option value="pct_of">% of another line or metric</option><option value="per_unit"># per unit of a metric or line</option>
      <option value="pct_change">% change</option><option value="abs_change"># change</option><option value="log_change">Logarithmic growth</option>
    </select></label>
    <label className="grid gap-1">{initialLabel}<Input className="h-8" inputMode="decimal" onChange={(event) => set("initial", event.target.value)} value={draft.initial} /></label>
    {linked && <label className="grid gap-1 sm:col-span-2">Using<select className={field} onChange={(event) => set("ref", event.target.value)} value={draft.ref}>
      <option value="">Choose a metric, line or driver</option>
      {data.metrics.length > 0 && <optgroup label="Operating metrics">{data.metrics.filter((metric) => `metric:${metric.name}` !== selfKey).map((metric) => <option key={metric.id} value={`metric:${metric.name}`}>{metric.label}</option>)}</optgroup>}
      <optgroup label="Statement lines (total)">{data.lines.map((line) => <option key={line.id} value={`line:${line.id}`}>{line.label}</option>)}</optgroup>
      <optgroup label="Drivers">{data.drivers.filter((driver) => `driver:${driver.id}` !== selfKey).map((driver) => <option key={driver.id} value={`driver:${driver.id}`}>{driver.label}</option>)}</optgroup>
    </select></label>}
    <label className="grid gap-1">Repeats every N months<Input className="h-8" inputMode="numeric" onChange={(event) => set("repeats", event.target.value)} value={draft.repeats} /><span className="text-[11px] text-muted-foreground">1 monthly, 3 quarterly, 12 yearly, 0 once</span></label>
    {stepped && <>
      <label className="grid gap-1">Changes every N months<Input className="h-8" inputMode="numeric" onChange={(event) => set("changeEvery", event.target.value)} value={draft.changeEvery} /></label>
      <label className="grid gap-1">{draft.basis === "pct_change" ? "Changing by %" : draft.basis === "abs_change" ? "Changing by" : "Exponent (0 to 1 flattens)"}<Input className="h-8" inputMode="decimal" onChange={(event) => set("changeBy", event.target.value)} value={draft.changeBy} /></label>
    </>}
    <label className="grid gap-1">For a maximum of N months<Input className="h-8" inputMode="numeric" onChange={(event) => set("maxMonths", event.target.value)} placeholder="No limit" value={draft.maxMonths} /></label>
    <label className="grid gap-1">To a maximum value of<Input className="h-8" inputMode="decimal" onChange={(event) => set("maxValue", event.target.value)} placeholder="No cap" value={draft.maxValue} /></label>
    <label className="grid gap-1">Seasonality<select className={field} onChange={(event) => set("seasonality", event.target.value)} value={draft.seasonality}><option value="">None</option>{data.seasonality.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>
    <label className="grid gap-1">Escalation<select className={field} onChange={(event) => set("escalation", event.target.value as Draft["escalation"])} value={draft.escalation}><option value="none">None</option><option disabled={!data.escalation} value="company">Company default{data.escalation ? "" : " (not set)"}</option><option value="custom">Its own terms</option></select></label>
    {draft.escalation === "custom" && <div className="grid grid-cols-3 gap-2 sm:col-span-2">
      <label className="grid gap-1">Rate %<Input className="h-8" inputMode="decimal" onChange={(event) => set("escRate", event.target.value)} value={draft.escRate} /></label>
      <label className="grid gap-1">Every N months<Input className="h-8" inputMode="numeric" onChange={(event) => set("escEvery", event.target.value)} value={draft.escEvery} /></label>
      <label className="grid gap-1">Counted from<select className={field} onChange={(event) => set("escAnchor", event.target.value)} value={draft.escAnchor}><option value="start">Its start</option>{monthNames.map((name, index) => <option key={name} value={String(index + 1)}>Each {name}</option>)}</select></label>
    </div>}
  </div>;
}

/**
 * Standard-model drivers in Balsa: each driver's pattern, the operating
 * metrics drivers can be linked to, seasonality profiles and the company
 * escalation. Balsa's engine calculates every amount; this panel only edits
 * the inputs and shows what the forecast resolved.
 */
export function DriverPatternsPanel({ onChanged }: { onChanged?: () => void }) {
  const [data, setData] = useState<Overview | null>(null);
  const [editing, setEditing] = useState<{ kind: "driver" | "metric" | "new-metric"; id: string } | null>(null);
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [metricMeta, setMetricMeta] = useState({ name: "", label: "", unit: "", effectiveFrom: "", effectiveTo: "" });
  const [profileDraft, setProfileDraft] = useState<{ id: string | null; name: string; values: string[] } | null>(null);
  const [escalationDraft, setEscalationDraft] = useState<{ rate: string; every: string; anchor: string } | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const [actuals, setActuals] = useState<Actual[] | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [proposed, setProposed] = useState<Record<string, { id: string; applied: boolean }>>({});
  const loadSuggestions = useCallback(async () => { const response = await fetch("/api/driver-patterns/suggestions"); if (response.ok) setSuggestions((await response.json()).suggestions); }, []);
  useEffect(() => { const timer = window.setTimeout(() => void loadSuggestions(), 0); return () => window.clearTimeout(timer); }, [loadSuggestions]);
  const propose = async (key: string) => { setBusy(true); setError(null); try { const response = await fetch("/api/driver-patterns/suggestions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }) }); if (!response.ok) { setError(await errorText(response)); return; } const { decision } = await response.json(); setProposed((current) => ({ ...current, [key]: { id: decision.id, applied: false } })); } finally { setBusy(false); } };
  const apply = async (key: string) => { const entry = proposed[key]; if (!entry) return; setBusy(true); setError(null); try { const response = await fetch("/api/decisions", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: entry.id, status: "applied" }) }); if (!response.ok) { setError(await errorText(response)); return; } setProposed((current) => ({ ...current, [key]: { ...entry, applied: true } })); await load(); await loadSuggestions(); onChanged?.(); } finally { setBusy(false); } };
  const loadActuals = async (metricId: string) => { setActuals(null); const response = await fetch(`/api/forecast-metrics/${metricId}/actuals`); if (response.ok) setActuals((await response.json()).actuals); };

  const load = useCallback(async () => { const response = await fetch("/api/driver-patterns"); if (response.ok) setData(await response.json()); }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  const send = async (url: string, method: string, body?: unknown) => {
    setBusy(true); setError(null);
    try { const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }); if (!response.ok) { setError(await errorText(response)); return false; } await load(); onChanged?.(); return true; }
    finally { setBusy(false); }
  };
  const close = () => { setEditing(null); setError(null); };
  const editingDriver = editing?.kind === "driver" ? data?.drivers.find((driver) => driver.id === editing.id) : undefined;
  const months = useMemo(() => data?.months.slice(0, 6) ?? [], [data]);

  if (!data) return <p className="text-[13px] text-muted-foreground">Loading drivers…</p>;
  const save = async () => {
    const pattern = fromDraft(draft); if (typeof pattern === "string") { setError(pattern); return; }
    if (editing?.kind === "driver") { if (await send(`/api/items/${editing.id}/pattern`, "PUT", { pattern })) close(); return; }
    const meta = { name: metricMeta.name.trim(), label: metricMeta.label.trim(), unit: metricMeta.unit.trim() || null, effectiveFrom: metricMeta.effectiveFrom, effectiveTo: metricMeta.effectiveTo || null, pattern };
    if (await send(editing?.kind === "metric" ? `/api/forecast-metrics/${editing.id}` : "/api/forecast-metrics", editing?.kind === "metric" ? "PATCH" : "POST", meta)) close();
  };
  const profileSum = profileDraft ? profileDraft.values.reduce((sum, value) => sum + (Number(value) || 0), 0) : 0;
  const editor = editing && <section className="rounded-md border border-border p-4">
    <div className="mb-3 flex items-center justify-between"><strong className="text-[13px]">{editingDriver ? editingDriver.label : editing.kind === "metric" ? "Edit metric" : "New operating metric"}</strong><button className="text-xs text-muted-foreground underline underline-offset-2" onClick={close} type="button">Cancel</button></div>
    {editing.kind !== "driver" && <div className="mb-3 grid gap-3 text-[13px] sm:grid-cols-3">
      <label className="grid gap-1">Label<Input className="h-8" onChange={(event) => setMetricMeta({ ...metricMeta, label: event.target.value })} placeholder="Customers" value={metricMeta.label} /></label>
      <label className="grid gap-1">Name used in references<Input className="h-8" disabled={editing.kind === "metric"} onChange={(event) => setMetricMeta({ ...metricMeta, name: event.target.value })} placeholder="customers" value={metricMeta.name} /></label>
      <label className="grid gap-1">Unit<Input className="h-8" onChange={(event) => setMetricMeta({ ...metricMeta, unit: event.target.value })} placeholder="customers" value={metricMeta.unit} /></label>
      <label className="grid gap-1">Starts<Input className="h-8" onChange={(event) => setMetricMeta({ ...metricMeta, effectiveFrom: event.target.value })} type="month" value={metricMeta.effectiveFrom} /></label>
      <label className="grid gap-1">Ends<Input className="h-8" onChange={(event) => setMetricMeta({ ...metricMeta, effectiveTo: event.target.value })} type="month" value={metricMeta.effectiveTo} /></label>
    </div>}
    {editing.kind === "metric" && <div className="mb-4 rounded-md bg-muted/30 p-3 text-[13px]">
      <div className="flex items-center justify-between"><strong>Actual values</strong><button className="text-xs underline underline-offset-2" onClick={() => setActuals([...(actuals ?? []), { month: "", value: "", added: true }])} type="button">Add a month</button></div>
      <p className="mt-1 text-xs text-muted-foreground">Recorded values by month. Months with an actual use it, and a growth pattern continues from the latest one. Values from evidence keep a link to their source.</p>
      {actuals === null ? <p className="mt-2 text-xs text-muted-foreground">Loading…</p> : actuals.length === 0 ? <p className="mt-2 text-xs text-muted-foreground">None recorded; the pattern starts from its starting value.</p> : <div className="mt-2 flex flex-col gap-1">{actuals.map((actual, index) => <div className={cn("flex flex-wrap items-center gap-2", actual.removed && "opacity-50 line-through")} key={`${actual.month}-${index}`}>
        <Input aria-label="Actual month" className="h-7 w-36" disabled={!actual.added} onChange={(event) => setActuals(actuals.map((item, position) => position === index ? { ...item, month: event.target.value } : item))} type="month" value={actual.month} />
        <Input aria-label="Actual value" className="h-7 w-28" inputMode="decimal" onChange={(event) => setActuals(actuals.map((item, position) => position === index ? { ...item, value: event.target.value } : item))} value={actual.value} />
        <span className="text-xs text-muted-foreground">{actual.factLabel ? `Fact: ${actual.factLabel}` : actual.sourceName ? `From ${actual.sourceName}` : actual.decisionId ? "From a decision" : actual.added ? "New" : "Entered by hand"}</span>
        {!actual.removed && <button className="text-xs text-muted-foreground underline underline-offset-2" onClick={() => setActuals(actual.added ? actuals.filter((_, position) => position !== index) : actuals.map((item, position) => position === index ? { ...item, removed: true } : item))} type="button">Remove</button>}
      </div>)}</div>}
      {actuals && actuals.length > 0 && <Button className="mt-2" disabled={busy} onClick={async () => { const values = actuals.filter((item) => item.month).map((item) => ({ month: item.month, value: item.removed ? null : item.value.trim() })); if (values.length && await send(`/api/forecast-metrics/${editing.id}/actuals`, "PUT", { values })) await loadActuals(editing.id); }} size="sm" type="button" variant="outline">Save actuals</Button>}
    </div>}
    {editingDriver?.amountFormula ? <p className="text-[13px] text-muted-foreground">This driver has a formula. Clear the formula in the Model tab before giving it a pattern.</p>
      : <PatternForm data={data} draft={draft} money={editing.kind === "driver"} onChange={setDraft} selfKey={editing.kind === "driver" ? `driver:${editing.id}` : `metric:${metricMeta.name}`} />}
    <div className="mt-4 flex flex-wrap gap-2">
      {!editingDriver?.amountFormula && <Button disabled={busy} onClick={() => void save()} size="sm" type="button">{busy ? "Saving…" : "Save"}</Button>}
      {editingDriver?.pattern && <Button disabled={busy} onClick={async () => { if (await send(`/api/items/${editing.id}/pattern`, "PUT", { pattern: null })) close(); }} size="sm" type="button" variant="outline">Remove pattern, keep {money(String(Math.round(Number(editingDriver.amount ?? 0) * 100)))} {editingDriver.cadence ?? ""}</Button>}
      {editing.kind === "metric" && <Button disabled={busy} onClick={async () => { if (await send(`/api/forecast-metrics/${editing.id}`, "DELETE")) close(); }} size="sm" type="button" variant="outline">Remove metric</Button>}
    </div>
  </section>;

  return <div className="flex flex-col gap-8">
    <div>
      <h3 className="text-sm font-medium">Drivers</h3>
      <p className="mt-1 text-xs text-muted-foreground">Give a driver the Standard model&apos;s pattern: a percentage of another line, an amount per unit of a metric, growth by a percentage or amount, logarithmic growth, a cap, seasonality and escalation. Balsa calculates every month; amounts below are what the current forecast resolved.{data.stale ? " The forecast is recalculating." : ""}</p>
      {error && <p className="mt-2 text-[13px] text-destructive">{error}</p>}
    </div>
    {editor}
    <div className="overflow-x-auto"><table className="w-full text-[13px]">
      <thead className="text-left text-muted-foreground"><tr><th className="pb-2 pr-3">Driver</th><th className="pb-2 pr-3">How it is calculated</th>{months.map((month) => <th className="pb-2 pr-2 text-right font-normal" key={month}>{monthLabel(month)}</th>)}<th className="pb-2" /></tr></thead>
      <tbody>{data.drivers.map((driver) => <tr className="border-t border-border align-top" key={driver.id}>
        <td className="py-2 pr-3">{driver.label}<span className="block text-xs text-muted-foreground">{driver.direction === "receipt" ? "Receipt" : "Spend"}{driver.lineLabel ? ` · ${driver.lineLabel}` : ""}</span></td>
        <td className="py-2 pr-3">{driver.summary ?? (driver.amountFormula ? `Formula: ${driver.amountFormula}` : `${money(String(Math.round(Number(driver.amount ?? 0) * 100)))} ${driver.cadence ?? "once"}`)}{driver.exception && <span className="mt-1 block text-[13px] text-destructive">{driver.exception}</span>}</td>
        {months.map((month) => <td className="py-2 pr-2 text-right tabular-nums" key={month}>{money(driver.next.find((item) => item.month === month)?.amountMinor ?? null)}</td>)}
        <td className="py-2 text-right"><button className="text-xs underline underline-offset-2" onClick={() => { setEditing({ kind: "driver", id: driver.id }); setDraft(toDraft(driver.pattern, driver.amount)); setError(null); }} type="button">{driver.pattern ? "Edit pattern" : "Add pattern"}</button></td>
      </tr>)}</tbody>
    </table>{data.drivers.length === 0 && <p className="text-[13px] text-muted-foreground">No confirmed drivers yet.</p>}</div>

    <section className="border-t border-border pt-5">
      <h4 className="text-[11px] uppercase tracking-[.12em] text-muted-foreground">From actuals</h4>
      <p className="mt-1 text-xs text-muted-foreground">What the last six months of actuals suggest for each driver, for income and expense accounts no driver forecasts yet, and for metrics with recorded values. Balsa calculates every figure and reason here. Propose turns a suggestion into a decision; nothing changes until it is applied.</p>
      {suggestions === null ? <p className="mt-2 text-[13px] text-muted-foreground">Reading the actuals…</p> : suggestions.length === 0 ? <p className="mt-2 text-[13px] text-muted-foreground">No actuals to learn from yet.</p> : <div className="mt-3 flex flex-col">{suggestions.map((item) => {
        const state = proposed[item.key];
        return <div className="grid gap-1 border-t border-border py-3 text-[13px] sm:grid-cols-[minmax(0,1fr)_auto]" key={item.key}>
          <div>
            <p><span className="font-medium">{item.target.label}</span><span className="text-xs text-muted-foreground"> · {item.target.kind === "account" ? "no driver yet" : item.target.kind}{item.target.lineLabel ? ` · ${item.target.lineLabel}` : ""}</span></p>
            {item.history.length > 0 && <p className="text-xs tabular-nums text-muted-foreground">{item.history.slice(-6).map((point) => `${monthLabel(point.month)} ${point.value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`).join(" · ")}</p>}
            {item.suggestion && <p className="mt-1">{item.summary} <span className="text-xs text-muted-foreground">({item.suggestion.confidence} confidence)</span></p>}
            {item.suggestion && <p className="text-xs text-muted-foreground">{item.suggestion.rationale}</p>}
            {item.note && <p className="text-xs text-muted-foreground">{item.note}</p>}
          </div>
          <div className="flex items-start gap-2 sm:justify-end">{item.effect ? state ? state.applied ? <span className="text-xs text-muted-foreground">Applied</span> : <Button disabled={busy} onClick={() => void apply(item.key)} size="sm" type="button">Apply</Button> : <Button disabled={busy} onClick={() => void propose(item.key)} size="sm" type="button" variant="outline">Propose</Button> : null}</div>
        </div>;
      })}</div>}
    </section>

    <section className="border-t border-border pt-5">
      <div className="flex items-center justify-between"><h4 className="text-[11px] uppercase tracking-[.12em] text-muted-foreground">Operating metrics</h4><button className="text-xs underline underline-offset-2" onClick={() => { setEditing({ kind: "new-metric", id: "" }); setMetricMeta({ name: "", label: "", unit: "", effectiveFrom: data.months[0] ?? "", effectiveTo: "" }); setDraft({ ...blankDraft, initial: "" }); setError(null); }} type="button">Add metric</button></div>
      <p className="mt-1 text-xs text-muted-foreground">Customers, headcount, orders: forecast series that drivers can be a percentage of or an amount per unit of. They never post to the books.</p>
      {data.metrics.length > 0 && <table className="mt-3 w-full text-[13px]"><tbody>{data.metrics.map((metric) => <tr className="border-t border-border align-top" key={metric.id}>
        <td className="py-2 pr-3">{metric.label}<span className="block text-xs text-muted-foreground">{metric.name}{metric.unit ? ` · ${metric.unit}` : ""}{metric.lastActual ? ` · last actual ${monthLabel(metric.lastActual.month)}: ${Number(metric.lastActual.value).toLocaleString("en-US")}${metric.lastActual.sourceName ? ` (${metric.lastActual.sourceName})` : ""}` : " · no actuals"}</span>{metric.exception && <span className="block text-[13px] text-destructive">{metric.exception}</span>}</td>
        {months.map((month) => <td className="py-2 pr-2 text-right tabular-nums" key={month}>{metric.values?.[month] !== undefined ? Number(metric.values[month]).toLocaleString("en-US", { maximumFractionDigits: 1 }) : "—"}</td>)}
        <td className="py-2 text-right"><button className="text-xs underline underline-offset-2" onClick={() => { setEditing({ kind: "metric", id: metric.id }); setMetricMeta({ name: metric.name, label: metric.label, unit: metric.unit ?? "", effectiveFrom: metric.effectiveFrom, effectiveTo: metric.effectiveTo ?? "" }); setDraft(toDraft(metric.pattern, null)); setError(null); void loadActuals(metric.id); }} type="button">Edit</button></td>
      </tr>)}</tbody></table>}
    </section>

    <section className="border-t border-border pt-5">
      <div className="flex items-center justify-between"><h4 className="text-[11px] uppercase tracking-[.12em] text-muted-foreground">Seasonality profiles</h4><button className="text-xs underline underline-offset-2" onClick={() => setProfileDraft({ id: null, name: "", values: Array(12).fill("0") })} type="button">Add profile</button></div>
      <p className="mt-1 text-xs text-muted-foreground">How much above or below an average month each calendar month runs, in percent. The twelve must sum to zero, so a year&apos;s total stays the same. Each driver picks its own profile.</p>
      {data.seasonality.map((profile) => <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]" key={profile.id}><span className="min-w-36 font-medium">{profile.name}</span><span className="text-xs text-muted-foreground">{profile.deviations.map((value, index) => `${monthNames[index]} ${Number(value) > 0 ? "+" : ""}${toPercent(value)}%`).join(" · ")}</span><button className="text-xs underline underline-offset-2" onClick={() => setProfileDraft({ id: profile.id, name: profile.name, values: profile.deviations.map(toPercent) })} type="button">Edit</button><button className="text-xs text-muted-foreground underline underline-offset-2" onClick={() => void send(`/api/seasonality-profiles/${profile.id}`, "DELETE")} type="button">Remove</button></div>)}
      {profileDraft && <div className="mt-3 rounded-md border border-border p-3 text-[13px]">
        <label className="grid max-w-xs gap-1">Name<Input className="h-8" onChange={(event) => setProfileDraft({ ...profileDraft, name: event.target.value })} value={profileDraft.name} /></label>
        <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-6">{profileDraft.values.map((value, index) => <label className="grid gap-1 text-xs" key={monthNames[index]}>{monthNames[index]} %<Input className="h-8" inputMode="decimal" onChange={(event) => setProfileDraft({ ...profileDraft, values: profileDraft.values.map((item, position) => position === index ? event.target.value : item) })} value={value} /></label>)}</div>
        <p className={cn("mt-2 text-xs", Math.abs(profileSum) < 1e-9 ? "text-muted-foreground" : "text-destructive")}>Sum {Number(profileSum.toFixed(4))}%{Math.abs(profileSum) < 1e-9 ? "" : " — must be 0"}</p>
        <div className="mt-2 flex gap-2"><Button disabled={busy} onClick={async () => { if (await send(profileDraft.id ? `/api/seasonality-profiles/${profileDraft.id}` : "/api/seasonality-profiles", profileDraft.id ? "PATCH" : "POST", { name: profileDraft.name.trim(), deviations: profileDraft.values.map((value) => fromPercent(value || "0")) })) setProfileDraft(null); }} size="sm" type="button">Save profile</Button><Button onClick={() => setProfileDraft(null)} size="sm" type="button" variant="outline">Cancel</Button></div>
      </div>}
    </section>

    <section className="border-t border-border pt-5 text-[13px]">
      <h4 className="text-[11px] uppercase tracking-[.12em] text-muted-foreground">Default escalation</h4>
      <p className="mt-1 text-xs text-muted-foreground">An inflation or price increase drivers can opt into, on whatever cycle you set. It compounds once per cycle.</p>
      {!escalationDraft ? <p className="mt-2">{data.escalation ? `${toPercent(data.escalation.rate)}% every ${data.escalation.everyMonths} months, ${data.escalation.anchor === "driver_start" ? "from each driver's start" : `each ${monthNames[data.escalation.anchor.calendarMonth - 1]}`}` : "None set."} <button className="text-xs underline underline-offset-2" onClick={() => setEscalationDraft(data.escalation ? { rate: toPercent(data.escalation.rate), every: String(data.escalation.everyMonths), anchor: data.escalation.anchor === "driver_start" ? "start" : String(data.escalation.anchor.calendarMonth) } : { rate: "3", every: "12", anchor: "1" })} type="button">{data.escalation ? "Change" : "Set"}</button>{data.escalation && <button className="ml-2 text-xs text-muted-foreground underline underline-offset-2" onClick={() => void send("/api/driver-patterns/escalation", "PUT", { escalation: null })} type="button">Remove</button>}</p>
        : <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="grid gap-1">Rate %<Input className="h-8 w-24" inputMode="decimal" onChange={(event) => setEscalationDraft({ ...escalationDraft, rate: event.target.value })} value={escalationDraft.rate} /></label>
          <label className="grid gap-1">Every N months<Input className="h-8 w-24" inputMode="numeric" onChange={(event) => setEscalationDraft({ ...escalationDraft, every: event.target.value })} value={escalationDraft.every} /></label>
          <label className="grid gap-1">Counted from<select className={field} onChange={(event) => setEscalationDraft({ ...escalationDraft, anchor: event.target.value })} value={escalationDraft.anchor}><option value="start">Each driver&apos;s start</option>{monthNames.map((name, index) => <option key={name} value={String(index + 1)}>Each {name}</option>)}</select></label>
          <Button disabled={busy} onClick={async () => { if (await send("/api/driver-patterns/escalation", "PUT", { escalation: { rate: fromPercent(escalationDraft.rate), everyMonths: Number(escalationDraft.every), anchor: escalationDraft.anchor === "start" ? "driver_start" : { calendarMonth: Number(escalationDraft.anchor) } } })) setEscalationDraft(null); }} size="sm" type="button">Save</Button>
          <Button onClick={() => setEscalationDraft(null)} size="sm" type="button" variant="outline">Cancel</Button>
        </div>}
    </section>
  </div>;
}
