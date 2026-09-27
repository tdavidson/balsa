"use client";

import Link from "next/link";
import { OpeningCashPanel } from "./opening-cash-review";
import { useRef, useState, type FormEvent } from "react";
import type { CashGoal, CashGoalEvaluation } from "@nevermodel/finance-engine";
import type { GoalComparison, GoalReviewData, GoalVersion, SavedGoalSnapshot, SnapshotSummary } from "@/lib/goal-review-contract";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

function decimal(minor: string) {
  const amount = BigInt(minor); const absolute = amount < 0n ? -amount : amount;
  return `${amount < 0n ? "-" : ""}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
}
function money(minor: string | null | undefined, currency: string) {
  if (minor == null) return "Unavailable";
  const amount = BigInt(minor); const magnitude = amount < 0n ? -amount : amount;
  return `${currency} ${amount < 0n ? "-" : ""}${(magnitude / 100n).toLocaleString("en-US")}.${String(magnitude % 100n).padStart(2, "0")}`;
}
const targetMinor = (value: string) => {
  if (!/^\d{1,28}(\.\d{1,2})?$/.test(value)) throw new Error("Enter a non-negative amount with up to two decimal places.");
  const [whole, fraction = ""] = value.split(".");
  return (BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0"))).toString();
};

function GoalForm({ goal, currency, firstMonth, busy, onSave, onCancel }: { goal?: GoalVersion | undefined; currency: string; firstMonth: string; busy: boolean; onSave: (definition: CashGoal, reason: string, status: GoalVersion["status"]) => Promise<void>; onCancel: () => void }) {
  const [metric, setMetric] = useState<CashGoal["metric"]>(goal?.definition.metric ?? "ending_cash_at_month");
  const [status, setStatus] = useState<GoalVersion["status"]>(goal?.status ?? "draft");
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); const fields = new FormData(event.currentTarget);
    try {
      const endMonth = String(fields.get("endMonth"));
      await onSave({ name: String(fields.get("name")), metric, currency, startMonth: metric === "ending_cash_at_month" ? endMonth : String(fields.get("startMonth")), endMonth, targetMinor: targetMinor(String(fields.get("target"))), manualConditions: String(fields.get("conditions")).split("\n").map((label) => label.trim()).filter(Boolean).map((label) => ({ id: goal?.definition.manualConditions?.find((item) => item.label === label)?.id ?? crypto.randomUUID(), label })) }, String(fields.get("reason")), status);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save goal."); }
  }
  return <Card><CardHeader><CardTitle>{goal ? `Revise ${goal.definition.name}` : "Set a cash goal"}</CardTitle><CardDescription>State the outcome you want. The target does not become a forecast assumption.</CardDescription></CardHeader>
    <CardContent><form id="goal-form" onSubmit={submit}><FieldGroup>
      <Field><FieldLabel htmlFor="goal-name">Goal name</FieldLabel><Input id="goal-name" name="name" required maxLength={120} defaultValue={goal?.definition.name} placeholder="Cash for our next stage" disabled={busy} /></Field>
      <Field><FieldLabel htmlFor="goal-metric">Measure</FieldLabel><Select value={metric} onValueChange={(value) => setMetric(value as CashGoal["metric"])} disabled={busy}><SelectTrigger id="goal-metric"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="ending_cash_at_month">Cash at a month-end</SelectItem><SelectItem value="minimum_month_end_cash">Cash floor across month-ends</SelectItem></SelectGroup></SelectContent></Select></Field>
      {metric === "minimum_month_end_cash" && <Field><FieldLabel htmlFor="goal-start">From month</FieldLabel><Input id="goal-start" name="startMonth" type="month" required defaultValue={goal?.definition.startMonth ?? firstMonth} disabled={busy} /></Field>}
      <Field><FieldLabel htmlFor="goal-end">{metric === "ending_cash_at_month" ? "Target month" : "Through month"}</FieldLabel><Input id="goal-end" name="endMonth" type="month" required defaultValue={goal?.definition.endMonth ?? firstMonth} disabled={busy} /></Field>
      <Field data-invalid={Boolean(error)}><FieldLabel htmlFor="goal-target">At least ({currency})</FieldLabel><Input id="goal-target" name="target" inputMode="decimal" required defaultValue={goal ? decimal(goal.definition.targetMinor) : ""} placeholder="400000.00" aria-invalid={Boolean(error)} disabled={busy} /><FieldDescription>Month-end balances only; this does not establish daily liquidity.</FieldDescription></Field>
      <Field><FieldLabel htmlFor="goal-conditions">Manual conditions (one per line)</FieldLabel><Textarea id="goal-conditions" name="conditions" className="min-h-24" maxLength={4000} defaultValue={goal?.definition.manualConditions?.map((item) => item.label).join("\n") ?? ""} placeholder="Preserve the product team" disabled={busy} /><FieldDescription>Up to 20 conditions. Each needs an explicit review before a scenario can be approved.</FieldDescription></Field>
      <Field><FieldLabel htmlFor="goal-reason">{goal ? "Reason for revision" : "Why this goal matters"}</FieldLabel><Input id="goal-reason" name="reason" required maxLength={2000} disabled={busy} /></Field>
      {<Field><FieldLabel htmlFor="goal-status">Status</FieldLabel><Select value={status} onValueChange={(value) => setStatus(value as GoalVersion["status"])} disabled={busy}><SelectTrigger id="goal-status"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="draft">Draft</SelectItem><SelectItem value="active">Active</SelectItem>{goal && <SelectItem value="archived">Archived</SelectItem>}</SelectGroup></SelectContent></Select><FieldDescription>Archiving preserves every goal version, plan, and review.</FieldDescription></Field>}
      {error && <Alert variant="destructive"><AlertTitle>Goal needs attention</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
    </FieldGroup></form></CardContent><CardFooter className="gap-2"><Button form="goal-form" disabled={busy}>{busy ? "Saving…" : goal ? "Save new version" : "Create goal"}</Button><Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button></CardFooter>
  </Card>;
}

function Evaluation({ value }: { value: CashGoalEvaluation }) {
  return <div className="flex flex-col gap-3">
    <p className="text-2xl font-semibold tabular-nums">{money(value.valueMinor, value.goal.currency)}</p>
    {!!value.goal.manualConditions?.length && <p className="text-sm">Manual conditions require a separate decision review: {value.goal.manualConditions.map((item) => item.label).join("; ")}.</p>}
    <p>{value.outcome === "unavailable" ? "Cannot evaluate this goal" : value.outcome === "meets_target" ? "Meets the target in this calculation" : "Below the target in this calculation"} · {value.assurance}</p>
    <p className="text-sm text-muted-foreground">Headroom against target: {money(value.headroomMinor, value.goal.currency)}. Basis: {value.basis}.{value.firstBreachMonth ? ` First month below target: ${value.firstBreachMonth}.` : ""}</p>
    <details><summary className="cursor-pointer text-sm">Inspect calculation and limitations</summary><div className="mt-3 flex flex-col gap-2 text-sm"><p>{value.formula} · {value.formulaVersion}</p><ul className="list-disc pl-5">{value.inputs.map((input) => <li key={input.month}>{input.month}: {money(input.endingCashMinor, value.goal.currency)} ({input.basis})</li>)}</ul><ul className="list-disc pl-5">{value.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></div></details>
  </div>;
}

function ChangeExplanation({ comparison }: { comparison: GoalComparison }) {
  const value = comparison.bridge;
  return <section className="flex flex-col gap-4" aria-label={`Change against ${comparison.baselineName}`}>
    <h3 className="text-lg font-semibold">Change against {comparison.baselineName}</h3>
    <p>{comparison.baselineKind === "plan" ? "Approved plan" : "Previous review"}: {money(value.beforeMinor, value.currency)} → outlook: {money(value.afterMinor, value.currency)}</p>
    <p>Change: <strong>{money(value.deltaMinor, value.currency)}</strong> · Headroom: {money(value.headroomBeforeMinor, value.currency)} → {money(value.headroomAfterMinor, value.currency)}</p>
    <p className="text-sm">{value.status === "complete" ? "The contributions reconcile to the total change." : value.status === "partial" ? "This explanation is incomplete; review the residual and limitations." : "These outlooks cannot be compared."} This does not establish that the underlying financial data is complete.</p>
    <ol className="flex list-decimal flex-col gap-4 pl-5">{value.steps.map((step) => <li key={step.category}><div className="flex flex-wrap justify-between gap-2"><strong>{step.label}</strong><span className="tabular-nums">{money(step.deltaMinor, value.currency)}</span></div><p className="mt-1 text-sm text-muted-foreground">Goal value after this step: {money(step.afterMinor, value.currency)}</p>
      {step.minimumMonthBefore !== step.minimumMonthAfter && <p className="text-sm">Lowest-cash month: {step.minimumMonthBefore ?? "unavailable"} → {step.minimumMonthAfter ?? "unavailable"}</p>}
      {step.firstBreachBefore !== step.firstBreachAfter && <p className="text-sm">First month below target: {step.firstBreachBefore ?? "none"} → {step.firstBreachAfter ?? "none"}</p>}
      <details className="mt-2"><summary className="cursor-pointer text-sm">What changed and supporting references</summary><div className="mt-2 flex flex-col gap-2 break-words text-sm"><ul className="list-disc pl-5">{step.changes.map((change, index) => <li key={index}>{change}</li>)}</ul><p className="break-all">References: {step.references.slice(0, 30).join(", ") || "Forecast dates or settings"}{step.references.length > 30 ? `; ${step.references.length - 30} more in the downloaded explanation` : ""}</p>{!!step.limitations.length && <p>Intermediate calculation limitations: {step.limitations.join(" ")}</p>}<p>{money(step.beforeMinor, value.currency)} + {money(step.deltaMinor, value.currency)} = {money(step.afterMinor, value.currency)}</p></div></details>
    </li>)}</ol>
    <p>Explained change: {money(value.explainedMinor, value.currency)} · Unexplained residual: <strong>{money(value.residualMinor, value.currency)}</strong></p>
    {!!value.reasons.length && <Alert><AlertTitle>Comparison limitations</AlertTitle><AlertDescription><ul className="list-disc pl-5">{value.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></AlertDescription></Alert>}
    <details><summary className="cursor-pointer text-sm">Attribution method</summary><p className="mt-2 text-sm">{value.method} Formula: {value.formulaVersion}.</p></details>
  </section>;
}

function CompareOutlook({ data, goalVersionId, defaultId, busy, download }: { data: GoalReviewData; goalVersionId: string; defaultId: string; busy: boolean; download: (value: unknown, name: string) => void }) {
  const [baselineId, setBaselineId] = useState(defaultId);
  const [comparison, setComparison] = useState<GoalComparison | null>(null);
  const [loading, setLoading] = useState(false); const [error, setError] = useState("");
  const baselines = data.snapshots.filter((item) => item.goalVersionId === goalVersionId);
  async function explain() {
    setLoading(true); setError(""); setComparison(null);
    try {
      const response = await fetch(`/api/goal-review/bridge?baseline=${baselineId}&preview=${data.previewToken}`, { cache: "no-store" }); const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to explain this change.");
      if (payload.companyId !== data.companyId || payload.previewToken !== data.previewToken) throw new Error("The outlook or company changed. Refresh before comparing.");
      setComparison(payload);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to explain this change."); }
    finally { setLoading(false); }
  }
  return <Card><CardHeader><CardTitle>What changed toward the goal?</CardTitle><CardDescription>Compare the current outlook with a saved plan or review for the same goal version. Saved reviews retain explanations against their plan and the previous review of that plan.</CardDescription></CardHeader><CardContent className="flex flex-col gap-5">
    <Field><FieldLabel htmlFor="change-baseline">Comparison baseline</FieldLabel><Select value={baselineId} disabled={busy || loading} onValueChange={(id) => { setBaselineId(id); setComparison(null); setError(""); }}><SelectTrigger id="change-baseline"><SelectValue placeholder="Choose a plan or review" /></SelectTrigger><SelectContent><SelectGroup>{baselines.map((item) => <SelectItem key={item.id} value={item.id}>{item.name} · {item.kind}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
    {error && <Alert variant="destructive"><AlertTitle>Comparison needs attention</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
    {comparison && <ChangeExplanation comparison={comparison} />}
  </CardContent><CardFooter className="flex-wrap gap-2"><Button variant="outline" disabled={busy || loading || !baselineId} onClick={explain}>{loading ? "Calculating…" : "Explain change"}</Button>{comparison && <Button variant="outline" disabled={busy || loading} onClick={() => download(comparison, "nevermodel-goal-change.json")}>Download explanation</Button>}</CardFooter></Card>;
}

type Detail = SnapshotSummary & { snapshot: SavedGoalSnapshot };
export function GoalReview({ company, initialData, initialError }: { company: { id: string; name: string; currency: string }; initialData: GoalReviewData | null; initialError?: string | undefined }) {
  const [data, setData] = useState(initialData);
  const [selectedId, setSelectedId] = useState(initialData?.primaryGoalId ?? initialData?.goals.find((goal) => goal.status === "active")?.goalId ?? "");
  const [editing, setEditing] = useState<"new" | "revise" | null>(initialData?.goals.length ? null : "new");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError ?? "");
  const [notice, setNotice] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [planId, setPlanId] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [snapshotName, setSnapshotName] = useState("");
  const retry = useRef<{ fingerprint: string; key: string } | null>(null);
  const goal = data?.goals.find((item) => item.goalId === selectedId);
  const evaluation = goal && data?.evaluations[goal.id];
  const plans = data?.snapshots.filter((item) => item.kind === "plan" && item.goalVersionId === goal?.id) ?? [];
  const selectedPlan = plans.find((item) => item.id === planId) ?? plans[0];

  async function refresh() {
    const response = await fetch("/api/goal-review", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "Unable to refresh the outlook.");
    if (payload.companyId !== company.id) throw new Error("Company selection changed. Reload this page.");
    setData(payload); setAcknowledged(false);
  }
  async function command(body: unknown) {
    const response = await fetch("/api/goal-review", { method: "POST", headers: { "Content-Type": "application/json", "x-company-id": company.id }, body: JSON.stringify(body) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "Unable to save.");
    return payload;
  }
  async function action(work: () => Promise<void>) {
    setBusy(true); setError(""); setNotice("");
    try { await work(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to complete this action."); }
    finally { setBusy(false); }
  }
  async function saveGoal(definition: CashGoal, reason: string, status: GoalVersion["status"]) {
    setBusy(true);
    try {
      const payload = await command(editing === "revise" && goal ? { action: "revise_goal", goalId: goal.goalId, expectedVersion: goal.version, status, definition, reason } : { action: "create_goal", definition, status: status === "archived" ? "draft" : status, reason });
      setSelectedId(payload.goal.goalId); setEditing(null); setDetail(null); setPlanId("");
      setNotice("Goal saved. Existing plans and reviews retain their original goal version."); await refresh();
    } finally { setBusy(false); }
  }
  async function saveSnapshot(kind: "plan" | "review") {
    if (!goal || !data) return;
    const content = { action: "save_snapshot", kind, goalVersionId: goal.id, ...(kind === "review" ? { planId: selectedPlan?.id } : {}), name: snapshotName, previewToken: data.previewToken, acknowledgeLimitations: acknowledged };
    const fingerprint = JSON.stringify(content);
    if (retry.current?.fingerprint !== fingerprint) retry.current = { fingerprint, key: crypto.randomUUID() };
    const payload = await command({ ...content, requestKey: retry.current.key });
    retry.current = null; setSnapshotName("");
    if (kind === "plan") setPlanId(payload.saved.id);
    setNotice(`${kind === "plan" ? "Plan" : "Review"} saved with its original inputs and results.`); await refresh();
  }
  async function inspect(id: string) {
    const response = await fetch(`/api/goal-review/snapshots/${id}`, { cache: "no-store" }); const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "Unable to load this snapshot.");
    if (payload.snapshot.outlook.companyId !== company.id) throw new Error("Company selection changed. Reload this page.");
    setDetail(payload);
  }
  function download(value: unknown, name: string) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function downloadCurrent() {
    if (!data) return;
    const response = await fetch(`/api/goal-review/outlook?preview=${data.previewToken}`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "Unable to inspect this outlook.");
    if (payload.companyId !== company.id) throw new Error("Company selection changed. Reload this page.");
    download(payload, "nevermodel-current-outlook.json");
  }

  return <main className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-8">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex flex-wrap gap-4"><Link href="/" className="text-sm text-muted-foreground underline">Back to workspace</Link><Link href="/progress" className="text-sm underline">Financial progress</Link><Link href="/goal-decisions" className="text-sm underline">Review decisions</Link><Link href="/reconciliation" className="text-sm underline">Review expectations & coverage</Link></div><h1 className="mt-3 text-3xl font-semibold">Goals & reviews</h1><p className="mt-2 text-muted-foreground">{company.name} · Understand the path, preserve the plan.</p></div><Button variant="outline" disabled={busy} onClick={() => action(refresh)}>{busy ? "Working…" : "Refresh outlook"}</Button></header>
    {error && <Alert variant="destructive"><AlertTitle>Review needs attention</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
    {notice && <p role="status">{notice}</p>}
    {data && <>
      <p className="text-sm text-muted-foreground">Calculated {data.outlook.capturedAt.replace("T", " ").slice(0, 19)} UTC · Historical anchor {data.outlook.asOfMonth} · Forecast {data.outlook.horizon.start} to {data.outlook.horizon.end}. Refresh to include subsequent changes.</p>
      <Alert><AlertTitle>Provisional financial outlook</AlertTitle><AlertDescription>Review source coverage, unresolved expectations, and calculation exceptions. Saved plans preserve these limitations alongside the numbers.</AlertDescription></Alert>
      {data.outlook.openingCash && <OpeningCashPanel value={data.outlook.openingCash} />}
      <details><summary className="cursor-pointer">Review current assumptions and monthly cash</summary><div className="mt-4 flex flex-col gap-4">
        <ul className="list-disc pl-5 text-sm">{data.assumptions.map((driver) => <li key={driver.id}>{driver.label}: {driver.amountFormula ?? money(driver.amountMinor, company.currency)} · {driver.cadence} · {driver.effectiveFrom}{driver.effectiveTo ? ` through ${driver.effectiveTo}` : ""}</li>)}</ul>
        {!data.assumptions.length && <p>No approved forecast drivers. Add agreements or obligations in the workspace before treating this as an operating plan.</p>}
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="mb-2 text-left text-muted-foreground">Cash roll-forward from the shared financial engine ({company.currency})</caption><thead><tr>{["Month", "Basis", "Opening cash", "Receipts", "Spending", "Ending cash"].map((label) => <th key={label} className="p-2">{label}</th>)}</tr></thead><tbody>{data.forecastMonths.map((month) => <tr key={month.month}><th className="p-2">{month.month}</th><td className="p-2">{month.basis === "forecast" ? "Outlook" : "Actual"}</td>{[month.openingCashMinor, month.receiptsMinor, month.spendingMinor, month.endingCashMinor].map((amount, index) => <td className="whitespace-nowrap p-2 tabular-nums" key={index}>{money(amount, company.currency)}</td>)}</tr>)}</tbody></table></div>
        <p className="text-sm text-muted-foreground">The open month combines actuals and estimates. The download includes their separate journal lines, formulas, and source references.</p>
        <Button variant="outline" disabled={busy} onClick={() => action(downloadCurrent)}>Download current inputs & calculation</Button>
      </div></details>
      <div className="flex flex-wrap items-end gap-3"><Field className="max-w-md"><FieldLabel htmlFor="review-goal">Goal</FieldLabel><Select value={selectedId} disabled={busy} onValueChange={(value) => { setSelectedId(value); setEditing(null); setDetail(null); setPlanId(""); setAcknowledged(false); }}><SelectTrigger id="review-goal"><SelectValue placeholder="Choose a goal" /></SelectTrigger><SelectContent><SelectGroup>{data.goals.map((item) => <SelectItem key={item.goalId} value={item.goalId}>{item.definition.name} · v{item.version}{item.status !== "active" ? ` · ${item.status}` : ""}</SelectItem>)}</SelectGroup></SelectContent></Select></Field><Button variant="outline" disabled={busy} onClick={() => setEditing("new")}>New goal</Button>{goal?.status === "active" && <Button variant="outline" disabled={busy || data.primaryGoalId === goal.goalId} onClick={() => action(async () => { await command({ action: "set_primary_goal", goalId: goal.goalId, expectedVersion: data.preferenceVersion }); await refresh(); })}>{data.primaryGoalId === goal.goalId ? "Primary review goal" : "Make primary goal"}</Button>}{goal && <Button variant="ghost" disabled={busy} onClick={() => setEditing("revise")}>Revise goal</Button>}</div>
      {editing && <GoalForm key={editing === "revise" ? goal?.id : "new"} goal={editing === "revise" ? goal : undefined} currency={company.currency} firstMonth={data.outlook.horizon.start} busy={busy} onSave={saveGoal} onCancel={() => setEditing(null)} />}
      {goal && evaluation && <>
        <div className="grid gap-4 md:grid-cols-2"><Card><CardHeader><CardTitle>{goal.definition.name}</CardTitle><CardDescription>{goal.definition.metric === "ending_cash_at_month" ? `At ${goal.definition.endMonth} month-end` : `Each month-end from ${goal.definition.startMonth} through ${goal.definition.endMonth}`} · target {money(goal.definition.targetMinor, company.currency)}</CardDescription></CardHeader><CardContent><Evaluation value={evaluation} /></CardContent><CardFooter><p className="text-sm text-muted-foreground">Goal v{goal.version}: {goal.reason}</p></CardFooter></Card>
          <Card><CardHeader><CardTitle>Approved baseline</CardTitle><CardDescription>Saving another plan creates a separate version. It preserves earlier plans.</CardDescription></CardHeader><CardContent className="flex flex-col gap-4">{selectedPlan ? <><Field><FieldLabel htmlFor="review-plan">Compare with plan</FieldLabel><Select value={selectedPlan.id} disabled={busy} onValueChange={setPlanId}><SelectTrigger id="review-plan"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{plans.map((plan) => <SelectItem key={plan.id} value={plan.id}>{plan.name}</SelectItem>)}</SelectGroup></SelectContent></Select></Field><p className="text-2xl font-semibold">{money(selectedPlan.evaluation.valueMinor, company.currency)}</p><p>Latest outlook minus plan: {money(data.changes[selectedPlan.id], company.currency)}</p><Button variant="outline" disabled={busy} onClick={() => action(() => inspect(selectedPlan.id))}>Inspect saved plan</Button></> : <p>No approved plan for this goal version. Save the reviewed outlook as your first baseline.</p>}</CardContent></Card></div>
        {!!data.snapshots.filter((item) => item.goalVersionId === goal.id).length && <CompareOutlook key={`${data.previewToken}:${goal.id}:${selectedPlan?.id}`} data={data} goalVersionId={goal.id} defaultId={selectedPlan?.id ?? ""} busy={busy} download={download} />}
        {goal.status === "active" && <Card><CardHeader><CardTitle>Preserve this outlook</CardTitle><CardDescription>A plan approves a baseline. A review records the latest outlook against the selected plan.</CardDescription></CardHeader><CardContent><FieldGroup><Field><FieldLabel htmlFor="snapshot-name">Plan or review name</FieldLabel><Input id="snapshot-name" value={snapshotName} onChange={(event) => setSnapshotName(event.target.value)} maxLength={120} placeholder="September operating plan" disabled={busy} /></Field><Field orientation="horizontal"><input id="review-ack" type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} disabled={busy} /><FieldLabel htmlFor="review-ack">I reviewed the assumptions and accept the recorded coverage and settlement limitations.</FieldLabel></Field></FieldGroup></CardContent><CardFooter className="flex-wrap gap-2"><Button disabled={busy || !acknowledged || !snapshotName.trim() || evaluation.outcome === "unavailable"} onClick={() => action(() => saveSnapshot("plan"))}>Approve as new plan</Button><Button variant="outline" disabled={busy || !acknowledged || !snapshotName.trim() || !selectedPlan || evaluation.outcome === "unavailable"} onClick={() => action(() => saveSnapshot("review"))}>Save review against plan</Button></CardFooter></Card>}
      </>}
      <Card><CardHeader><CardTitle>Saved history</CardTitle><CardDescription>The latest 50 saved plans and reviews across all goal versions. Differences use the same goal version; unavailable comparisons remain explicit.</CardDescription></CardHeader><CardContent><ul className="flex flex-col gap-3">{data.snapshots.map((saved) => <li key={saved.id} className="flex flex-wrap items-center justify-between gap-2"><div><p>{saved.name} · {saved.kind}</p><p className="text-sm text-muted-foreground">{saved.createdAt.slice(0, 10)} · {money(saved.evaluation.valueMinor, saved.evaluation.goal.currency)} · change to current outlook: {money(data.changes[saved.id], saved.evaluation.goal.currency)}</p></div><Button variant="outline" size="sm" disabled={busy} onClick={() => action(() => inspect(saved.id))}>Inspect {saved.name}</Button></li>)}</ul>{!data.snapshots.length && <p>Your first saved plan will appear here.</p>}</CardContent></Card>
    </>}
    {detail && <Card><CardHeader><CardTitle>{detail.name} · saved {detail.kind}</CardTitle><CardDescription>Captured {detail.snapshot.outlook.capturedAt} · Goal v{detail.snapshot.goal.version} · {detail.snapshot.outlook.output.formulaVersion}</CardDescription></CardHeader><CardContent className="flex flex-col gap-4"><Evaluation value={detail.snapshot.evaluation} />{detail.snapshot.comparisons && <><ChangeExplanation comparison={detail.snapshot.comparisons.plan} />{detail.snapshot.comparisons.previousReview && <ChangeExplanation comparison={detail.snapshot.comparisons.previousReview} />}</>}<details><summary className="cursor-pointer">Assumptions and financial inputs</summary><div className="mt-3 flex flex-col gap-2 text-sm"><p>Calculation {detail.snapshot.calculationRunId} · Revision {detail.snapshot.outlook.financialStateRevision}</p><ul className="list-disc pl-5">{detail.snapshot.outlook.input.drivers.map((driver) => <li key={driver.id}>{driver.label}: {driver.amountFormula ?? money(driver.amountMinor, detail.snapshot.outlook.input.currency)} · {driver.cadence} · from {driver.effectiveFrom} · source {driver.evidenceId ?? "approved company assumption"}</li>)}</ul><p>{detail.snapshot.outlook.actualJournalLines.length} actual journal lines retained. The download includes journal amounts, source references, account mappings, formulas, coverage, and projected lines.</p></div></details></CardContent><CardFooter className="flex-wrap gap-2"><Button variant="outline" onClick={() => { const url = URL.createObjectURL(new Blob([JSON.stringify(detail, null, 2)], { type: "application/json" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `nevermodel-${detail.kind}-${detail.id}.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }}>Download snapshot</Button><Button variant="ghost" onClick={() => setDetail(null)}>Close inspection</Button></CardFooter></Card>}
  </main>;
}
