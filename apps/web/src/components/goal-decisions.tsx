"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel, FieldSet, FieldLegend } from "@/components/ui/field";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { loadGoalDecisionWorkspace } from "@/lib/goal-decisions";
import type { DecisionSelection, GoalDecisionOutcome, GoalDecisionPreview, GoalDecisionSnapshot } from "@/lib/goal-decisions-contract";
import { describeScenarioChange } from "@/lib/scenario-changes";

type Workspace = Awaited<ReturnType<typeof loadGoalDecisionWorkspace>>;
function money(value: string | null, currency: string) {
  if (value === null) return "Unavailable";
  const n = BigInt(value); const a = n < 0n ? -n : n;
  return `${currency} ${n < 0n ? "-" : ""}${(a / 100n).toLocaleString("en-US")}.${String(a % 100n).padStart(2, "0")}`;
}
function download(value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = "financial-decision-review.json"; link.click(); URL.revokeObjectURL(url);
}
function Preview({ value }: { value: GoalDecisionPreview }) {
  return <div className="flex flex-col gap-5">
    <h3 className="text-xl font-semibold">{value.scenario.name}</h3>
    <ul className="list-disc pl-5 text-sm">{value.scenario.changes.map((change, index) => <li key={index}>{describeScenarioChange(change)}</li>)}</ul>
    <div className="grid gap-4 md:grid-cols-2">{value.evaluations.map(({ goalVersionId, before, after, deltaMinor }) => <Card key={goalVersionId}><CardHeader><CardTitle>{after.goal.name}</CardTitle><CardDescription>{after.goal.startMonth} through {after.goal.endMonth} · target {money(after.goal.targetMinor, after.goal.currency)}</CardDescription></CardHeader><CardContent className="flex flex-col gap-2"><p>{money(before.valueMinor, after.goal.currency)} → <strong>{money(after.valueMinor, after.goal.currency)}</strong></p><p>Change {money(deltaMinor, after.goal.currency)} · headroom {money(after.headroomMinor, after.goal.currency)}</p><p>{after.outcome.replaceAll("_", " ")} · {after.assurance}</p><p className="text-sm">First month below target: {after.firstBreachMonth ?? "none in the evaluated interval"}</p></CardContent></Card>)}</div>
    {value.attribution && <details><summary className="cursor-pointer font-medium">What each change contributes</summary><p className="my-3 text-sm">{value.attribution.method}</p>{value.goals.map((goal) => { const total = value.attribution!.totals.find((item) => item.goalVersionId === goal.id); return <section key={goal.id} className="my-4"><h3 className="font-semibold">{goal.definition.name}</h3><ol className="list-decimal pl-5">{value.attribution!.steps.map((step) => <li key={step.id}>{step.label}: {money(step.values.find((item) => item.goalVersionId === goal.id)?.deltaMinor ?? null, value.scenarioRun.currency)}{step.reasons.length > 0 && <p>{step.reasons.join(" ")}</p>}</li>)}</ol><p>Residual: {money(total?.residualMinor ?? null, value.scenarioRun.currency)} · {total?.complete ? "All changes attributed" : "Attribution incomplete"}</p></section>; })}<p className="text-sm">{value.attribution.formulaVersion}</p></details>}
    <details open><summary className="cursor-pointer font-medium">Monthly consequences across the forecast</summary><div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Month-end cash before and after the scenario</caption><thead><tr><th className="p-2">Month</th><th className="p-2">Current outlook</th><th className="p-2">Scenario</th><th className="p-2">Change</th></tr></thead><tbody>{value.monthlyChanges.map((month) => { return <tr key={month.month} className="border-t"><td className="p-2">{month.month}</td><td className="p-2 tabular-nums">{money(month.beforeMinor, value.scenarioRun.currency)}</td><td className="p-2 tabular-nums">{money(month.afterMinor, value.scenarioRun.currency)}</td><td className="p-2 tabular-nums">{money(month.deltaMinor, value.scenarioRun.currency)}</td></tr>; })}</tbody></table></div></details>
    {!!value.conditions.length && <ul className="list-disc pl-5">{value.conditions.map((condition) => <li key={`${condition.goalVersionId}:${condition.conditionId}`}>{condition.label}: <strong>{condition.status}</strong>{condition.reason ? ` — ${condition.reason}` : ""}</li>)}</ul>}
    {!!value.blockers.length && <Alert variant="destructive"><AlertTitle>Approval needs attention</AlertTitle><AlertDescription><ul className="list-disc pl-5">{value.blockers.map((reason) => <li key={reason}>{reason}</li>)}</ul></AlertDescription></Alert>}
    <details><summary className="cursor-pointer">Evidence and calculation limitations</summary><ul className="mt-2 list-disc pl-5 text-sm">{[...new Set([...value.base.limitations, ...value.scenarioRun.exceptions.map((item) => item.reason)])].map((reason) => <li key={reason}>{reason}</li>)}</ul><p className="mt-2 text-sm">The downloaded review retains inputs, journal lineage, formulas and outputs. Approval records a management decision; it does not certify incomplete evidence.</p></details>
  </div>;
}
function Outcome({ value }: { value: GoalDecisionOutcome }) {
  const bridge = value.bridge;
  return <div className="flex flex-col gap-3"><h3 className="text-xl font-semibold">Outcome review: {value.goal.definition.name}</h3><p>{value.notice}</p><p>Applied outlook {money(bridge.beforeMinor, bridge.currency)} → current outlook {money(bridge.afterMinor, bridge.currency)}</p><p>Change {money(bridge.deltaMinor, bridge.currency)} · headroom {money(bridge.headroomAfterMinor, bridge.currency)} · {bridge.status}</p><ul className="list-disc pl-5">{bridge.steps.map((step) => <li key={step.category}>{step.label}: {money(step.deltaMinor, bridge.currency)}<details><summary className="cursor-pointer text-sm">Supporting changes</summary><p className="text-sm">{step.changes.join("; ")}</p><p className="break-all text-xs">{step.references.join(", ")}</p></details></li>)}</ul><p>Unexplained residual: {money(bridge.residualMinor, bridge.currency)}</p><ul className="list-disc pl-5 text-sm">{[...new Set([...bridge.reasons, ...value.outlook.limitations])].map((reason) => <li key={reason}>{reason}</li>)}</ul></div>;
}

export function GoalDecisions({ company, initialData, initialError }: { company: { id: string; name: string; currency: string }; initialData: Workspace | null; initialError: string }) {
  const [data, setData] = useState(initialData); const [error, setError] = useState(initialError); const [busy, setBusy] = useState(false); const [notice, setNotice] = useState("");
  const [scenarioId, setScenarioId] = useState(""); const [planId, setPlanId] = useState("");
  const [conditionReviews, setConditions] = useState<DecisionSelection["conditionReviews"]>([]);
  const [preview, setPreview] = useState<GoalDecisionPreview | null>(null); const [outcome, setOutcome] = useState<GoalDecisionOutcome | null>(null);
  const [inspected, setInspected] = useState<{ name: string; snapshot: GoalDecisionSnapshot } | null>(null);
  const [name, setName] = useState(""); const [reason, setReason] = useState(""); const [ack, setAck] = useState(false);
  const retry = useRef<{ payload: string; key: string } | null>(null);
  async function read<T>(url: string): Promise<T> { const response = await fetch(url, { cache: "no-store" }); const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Unable to load review."); if (result.companyId !== company.id) throw new Error("Company selection changed. Reload this page."); return result; }
  async function post<T>(body: unknown): Promise<T> { const response = await fetch("/api/goal-decisions", { method: "POST", headers: { "content-type": "application/json", "x-company-id": company.id }, body: JSON.stringify(body) }); const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Unable to save review."); return result; }
  async function act(work: () => Promise<void>) { setBusy(true); setError(""); setNotice(""); try { await work(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to complete review."); } finally { setBusy(false); } }
  function invalidate() { setPreview(null); setOutcome(null); setAck(false); }
  async function refresh() { setData(await read<Workspace>("/api/goal-decisions")); setConditions([]); invalidate(); }
  async function save(action: "save_evaluation" | "approve" | "save_outcome") {
    const body = { action, ...(action === "save_outcome" ? { reviewId: outcome!.parentId } : { scenarioId, planId, conditionReviews }), previewToken: action === "save_outcome" ? outcome!.previewToken : preview!.previewToken, name, reason, acknowledgeLimitations: ack };
    const payload = JSON.stringify(body); if (retry.current?.payload !== payload) retry.current = { payload, key: crypto.randomUUID() };
    const saved = await post<{ saved: { id: string }; reused: boolean }>({ ...body, requestKey: retry.current.key });
    // Keep the receipt visible even if the following workspace refresh fails.
    setNotice(action === "approve" ? "Decision applied. The scenario is archived and the original plan is preserved." : "Review preserved.");
    invalidate(); if (action === "approve") { setScenarioId(""); setConditions([]); } setInspected(await read(`/api/goal-decisions?id=${saved.saved.id}`)); setData(await read("/api/goal-decisions"));
  }
  const conditions = data?.goals.flatMap((goal) => (goal.definition.manualConditions ?? []).map((condition) => ({ ...condition, goalVersionId: goal.id, goalName: goal.definition.name }))) ?? [];
  const canSave = !busy && ack && !!name.trim() && !!reason.trim();
  return <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 md:px-8">
    <header><nav className="flex gap-4 text-sm underline"><Link href="/goals">Goals & reviews</Link><Link href="/">Workspace & scenario editor</Link><Link href="/reconciliation">Expectations & coverage</Link></nav><h1 className="mt-4 text-3xl font-semibold">Decisions & outcomes</h1><p className="mt-2 text-muted-foreground">{company.name} · Test the change against your goals, then preserve what you approved.</p></header>
    {error && <Alert variant="destructive"><AlertTitle>Review needs attention</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}{notice && <p role="status">{notice}</p>}
    <Button variant="outline" className="self-start" disabled={busy} onClick={() => act(refresh)}>Refresh choices</Button>
    {data && <><Card><CardHeader><CardTitle>Evaluate a saved scenario</CardTitle><CardDescription>Save a scenario in the workspace and approve a plan in Goals first. Approval checks every active cash goal and applies supported changes together.</CardDescription></CardHeader><CardContent className="flex flex-col gap-4">
      <FieldGroup>
        <Field data-disabled={busy}><FieldLabel htmlFor="decision-plan">Plan</FieldLabel><Select value={planId} disabled={busy} onValueChange={(value) => { setPlanId(value); setConditions([]); invalidate(); }}><SelectTrigger id="decision-plan"><SelectValue placeholder="Choose a current goal’s plan" /></SelectTrigger><SelectContent><SelectGroup>{data.plans.filter((plan) => data.goals.some((goal) => goal.id === plan.goalVersionId)).map((plan) => <SelectItem value={plan.id} key={plan.id}>{plan.name}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
        <Field data-disabled={busy}><FieldLabel htmlFor="decision-scenario">Scenario</FieldLabel><Select value={scenarioId} disabled={busy} onValueChange={(value) => { setScenarioId(value); setConditions([]); invalidate(); }}><SelectTrigger id="decision-scenario"><SelectValue placeholder="Choose a saved scenario" /></SelectTrigger><SelectContent><SelectGroup>{data.scenarios.map((scenario) => <SelectItem value={scenario.id} key={scenario.id}>{scenario.name}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
        {conditions.map((condition) => {
          const current = conditionReviews.find((item) => item.goalVersionId === condition.goalVersionId && item.conditionId === condition.id) ?? { goalVersionId: condition.goalVersionId, conditionId: condition.id, status: "pending" as const, reason: "" };
          const id = `condition-${condition.goalVersionId}-${condition.id}`;
          const update = (patch: Partial<typeof current>) => { setConditions([...conditionReviews.filter((item) => item.goalVersionId !== current.goalVersionId || item.conditionId !== current.conditionId), { ...current, ...patch }]); invalidate(); };
          return <FieldSet key={id}><FieldLegend>{condition.goalName}: {condition.label}</FieldLegend><FieldGroup>
            <Field data-disabled={busy}><FieldLabel id={`${id}-label`}>Manual review</FieldLabel><ToggleGroup type="single" variant="outline" disabled={busy} value={current.status} aria-labelledby={`${id}-label`} onValueChange={(value) => { if (value) update({ status: value as typeof current.status }); }}><ToggleGroupItem value="pending">Pending</ToggleGroupItem><ToggleGroupItem value="met">Met</ToggleGroupItem><ToggleGroupItem value="failed">Failed</ToggleGroupItem></ToggleGroup></Field>
            <Field data-disabled={busy}><FieldLabel htmlFor={`${id}-reason`}>Basis for this assessment</FieldLabel><Input id={`${id}-reason`} value={current.reason} maxLength={1000} disabled={busy} onChange={(event) => update({ reason: event.target.value })} /></Field>
          </FieldGroup></FieldSet>;
        })}
      </FieldGroup>
      <Button disabled={busy || !scenarioId || !planId} onClick={() => act(async () => { setOutcome(null); setInspected(null); setAck(false); setPreview(await post({ action: "preview", scenarioId, planId, conditionReviews })); })}>{busy ? "Working…" : "Preview decision"}</Button>
    </CardContent></Card>
    {preview && <section aria-label="Scenario preview"><Preview value={preview} /></section>}{outcome && <section aria-label="Outcome preview"><Outcome value={outcome} /></section>}
    {(preview || outcome) && <Card><CardHeader><CardTitle>{outcome ? "Preserve the outcome review" : "Record the decision"}</CardTitle></CardHeader><CardContent className="flex flex-col gap-4"><FieldGroup><Field data-disabled={busy}><FieldLabel htmlFor="decision-name">Review name</FieldLabel><Input id="decision-name" value={name} maxLength={120} disabled={busy} onChange={(event) => setName(event.target.value)} /></Field><Field data-disabled={busy}><FieldLabel htmlFor="decision-reason">Reason and judgement</FieldLabel><Textarea id="decision-reason" value={reason} maxLength={2000} disabled={busy} onChange={(event) => setReason(event.target.value)} /></Field><Field orientation="horizontal" data-disabled={busy}><Checkbox id="decision-ack" checked={ack} disabled={busy} onCheckedChange={(checked) => setAck(checked === true)} /><FieldLabel htmlFor="decision-ack">I reviewed the evidence limitations, manual conditions, and consequences across the forecast.</FieldLabel></Field></FieldGroup><div className="flex flex-wrap gap-3"><Button variant="outline" disabled={!canSave} onClick={() => act(() => save(outcome ? "save_outcome" : "save_evaluation"))}>Save {outcome ? "outcome" : "evaluation"}</Button>{preview && <Button disabled={!canSave || !!preview.blockers.length} onClick={() => act(() => save("approve"))}>Approve & apply together</Button>}<Button variant="ghost" onClick={() => download(preview ?? outcome)}>Download review inputs</Button></div></CardContent></Card>}
    <Card><CardHeader><CardTitle>Preserved decisions and reviews</CardTitle><CardDescription>Latest 50 reviews. Saved evidence stays unchanged as the model evolves.</CardDescription></CardHeader><CardContent><ul className="flex flex-col gap-4">{data.reviews.map((review) => <li key={review.id} className="flex flex-wrap items-center justify-between gap-3 border-b pb-3"><div><p className="font-medium">{review.name}</p><p className="text-sm text-muted-foreground">{review.kind} · {review.createdAt.slice(0, 10)}</p></div><div className="flex gap-2"><Button variant="outline" disabled={busy} onClick={() => act(async () => { setInspected(await read(`/api/goal-decisions?id=${review.id}`)); })}>Inspect</Button>{review.kind === "applied" && <Button variant="outline" disabled={busy} onClick={() => act(async () => { invalidate(); setInspected(null); setOutcome(await post({ action: "preview_outcome", reviewId: review.id })); })}>Review outcome</Button>}</div></li>)}</ul>{!data.reviews.length && <Empty><EmptyHeader><EmptyTitle>No decision reviews yet</EmptyTitle><EmptyDescription>Choose a plan and scenario to preserve the first evaluation.</EmptyDescription></EmptyHeader></Empty>}</CardContent></Card>
    {inspected && <Card><CardHeader><CardTitle>{inspected.name}</CardTitle><CardDescription>Preserved {inspected.snapshot.type} · {inspected.snapshot.reason}</CardDescription></CardHeader><CardContent className="flex flex-col gap-4">{inspected.snapshot.type === "outcome" ? <Outcome value={inspected.snapshot.outcome} /> : <><Preview value={inspected.snapshot.preview} /><p className="break-all text-sm">Applied decisions: {inspected.snapshot.decisionIds.join(", ") || "None — evaluation only"}</p></>}<Button variant="outline" onClick={() => download(inspected)}>Download preserved review</Button></CardContent></Card>}
    </>}
  </main>;
}
