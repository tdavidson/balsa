"use client";

import Link from "next/link";
import { useSyncExternalStore, useRef, useState, type FormEvent } from "react";
import { addMonths, compatibleCashMovement, type CashOccurrence } from "@balsa/finance-engine";
import type { ForecastReconciliationData } from "@/lib/forecast-reconciliation-contract";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const decimal = (minor: string) => { const value = BigInt(minor); const abs = value < 0n ? -value : value; return `${value < 0n ? "-" : ""}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`; };
const minor = (value: FormDataEntryValue | null) => { const text = String(value ?? "").trim(); if (!/^\d{1,28}(\.\d{1,2})?$/.test(text)) throw new Error("Enter a positive amount with up to two decimals."); const [whole, fraction = ""] = text.split("."); return (BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0"))).toString(); };
type Send = (body: Record<string, unknown>) => Promise<Record<string, unknown>>;
function Choice({ id, label, value, onChange, options, disabled }: { id: string; label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[]; disabled: boolean }) {
  return <Field><FieldLabel htmlFor={id}>{label}</FieldLabel><Select value={value} onValueChange={onChange} disabled={disabled}><SelectTrigger id={id}><SelectValue placeholder="Choose an item" /></SelectTrigger><SelectContent><SelectGroup>{options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>;
}

function OccurrenceReview({ occurrence, data, busy, send }: { occurrence: CashOccurrence; data: ForecastReconciliationData; busy: boolean; send: Send }) {
  const [actualId, setActualId] = useState(""); const [error, setError] = useState("");
  const result = data.results.find((item) => item.id === occurrence.id)!;
  const suggestions = data.matchSuggestions.filter((item) => item.occurrenceId === occurrence.id).slice(0, 8);
  const actuals = data.settlement.actuals.filter((actual) => compatibleCashMovement(occurrence, actual));
  const allocations = data.settlement.allocations.filter((item) => item.occurrenceId === occurrence.id);
  async function submit(event: FormEvent<HTMLFormElement>, action: "allocate" | "revise_occurrence") {
    event.preventDefault(); setError(""); const fields = new FormData(event.currentTarget);
    try {
      const common = { action, occurrenceId: occurrence.id, expectedVersion: occurrence.version, reason: String(fields.get("reason")) };
      await send(action === "allocate" ? { ...common, actualEntryId: actualId, amountMinor: minor(fields.get("amount")), final: fields.get("final") === "on" } : { ...common, expectedDate: fields.get("expectedDate"), amountMinor: minor(fields.get("amount")), status: fields.get("cancel") === "on" ? "cancelled" : "active", final: fields.get("final") === "on", autoMatch: fields.get("autoMatch") === "on" });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to review expectation."); }
  }
  return <Card id={`occurrence-${occurrence.id}`}><CardHeader><CardTitle>{occurrence.label}</CardTitle><CardDescription>{occurrence.currency} {decimal(occurrence.amountMinor)} expected on {occurrence.expectedDate} · {result.state}{result.overdue ? " · overdue" : ""} · v{occurrence.version}</CardDescription></CardHeader><CardContent className="flex flex-col gap-5">{!!suggestions.length && <details><summary className="cursor-pointer">Suggested actuals for manual review ({suggestions.length})</summary><ul className="mt-2 flex list-disc flex-col gap-3 pl-5 text-sm">{suggestions.map((suggestion) => { const actual = data.settlement.actuals.find((item) => item.id === suggestion.actualEntryId)!; return <li key={actual.id}><p>{actual.postingDate} · {actual.memo} · {data.currency} {decimal(suggestion.availableMinor)} available</p><p>{suggestion.reasons.join("; ")}. {suggestion.competingOccurrenceIds.length ? `${suggestion.competingOccurrenceIds.length} other expectations could also fit; identity is ambiguous.` : "Identity still needs explicit review."}</p><Button size="sm" variant="outline" disabled={busy} onClick={() => setActualId(actual.id)}>Select for review</Button></li>; })}</ul></details>}
    <p>Allocated: {decimal(result.allocatedMinor)} · Remaining: {decimal(result.remainingMinor)} · Final amount variance: {decimal(result.varianceMinor)}</p>
    {result.invalidAllocationIds.length > 0 && <Alert><AlertTitle>An actual changed or was reversed</AlertTitle><AlertDescription>The affected amount is outstanding again. Revoke the invalid allocation below before finalizing a replacement match.</AlertDescription></Alert>}
    {error && <Alert variant="destructive"><AlertTitle>Review needs attention</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
    <form onSubmit={(event) => submit(event, "allocate")}><FieldGroup>
      <Choice id="actual-entry" label="Posted actual to allocate" value={actualId} onChange={setActualId} disabled={busy} options={actuals.map((actual) => ({ value: actual.id, label: `${actual.postingDate} · ${actual.memo.slice(0, 80)} · ${decimal(actual.amountMinor)}` }))} />
      <FieldDescription>Choose the actual for this obligation. Currency, entity, and accounting treatment must match. Shared amounts or accounts alone do not establish identity.</FieldDescription>
      <Field><FieldLabel htmlFor="allocate-amount">Amount to allocate ({occurrence.currency})</FieldLabel><Input id="allocate-amount" name="amount" inputMode="decimal" required disabled={busy} /></Field>
      <Field orientation="horizontal"><input id="allocate-final" name="final" type="checkbox" disabled={busy} /><FieldLabel htmlFor="allocate-final">This is final settlement; record any remaining shortfall as a variance.</FieldLabel></Field>
      <Field><FieldLabel htmlFor="allocate-reason">Why this actual belongs to this expectation</FieldLabel><Input id="allocate-reason" name="reason" maxLength={2000} required disabled={busy} /></Field>
      <Button disabled={busy || !actualId || occurrence.status !== "active"}>Allocate actual</Button>
    </FieldGroup></form>
    <details><summary className="cursor-pointer">Revise timing, amount, or lifecycle</summary><form className="mt-4" onSubmit={(event) => submit(event, "revise_occurrence")}><FieldGroup>
      <Field><FieldLabel htmlFor="expected-date">Expected date</FieldLabel><Input id="expected-date" name="expectedDate" type="date" defaultValue={occurrence.expectedDate} required disabled={busy} /></Field>
      <Field><FieldLabel htmlFor="expected-amount">Expected total ({occurrence.currency})</FieldLabel><Input id="expected-amount" name="amount" defaultValue={decimal(occurrence.amountMinor)} required disabled={busy} /></Field>
      <Field orientation="horizontal"><input id="expected-cancel" type="checkbox" name="cancel" defaultChecked={occurrence.status === "cancelled"} disabled={busy} /><FieldLabel htmlFor="expected-cancel">Cancel the remaining expectation</FieldLabel></Field>
      <Field orientation="horizontal"><input id="expected-final" type="checkbox" name="final" defaultChecked={occurrence.final} disabled={busy} /><FieldLabel htmlFor="expected-final">Final settlement (uncheck to reopen)</FieldLabel></Field>
      {occurrence.autoMatchFactId && <Field orientation="horizontal"><input id="expected-auto" name="autoMatch" type="checkbox" defaultChecked disabled={busy} /><FieldLabel htmlFor="expected-auto">Keep the approved automatic matching rule for this source fact</FieldLabel></Field>}
      <Field><FieldLabel htmlFor="expected-reason">Reason for this revision</FieldLabel><Input id="expected-reason" name="reason" required maxLength={2000} disabled={busy} /></Field><Button variant="outline" disabled={busy}>Save expectation revision</Button>
    </FieldGroup></form></details>
    <details><summary className="cursor-pointer">Allocation history and source references</summary><div className="mt-3 flex flex-col gap-3 break-all text-sm"><p>Occurrence identity: {occurrence.key}</p>{occurrence.recurrencePolicyId && <p>Recurring capture approval: {occurrence.recurrencePolicyId} · v{occurrence.recurrencePolicyVersion}</p>}<p>Historical source lines: {occurrence.sourceLineIds.join(", ") || "Approved driver projection"}</p>{allocations.map((allocation) => <div key={allocation.id} className="flex flex-wrap items-center gap-2"><span>{decimal(allocation.amountMinor)} · actual {allocation.actualEntryId}{allocation.revoked ? " · revoked" : result.invalidAllocationIds.includes(allocation.id) ? " · invalidated" : ""}</span>{!allocation.revoked && <Button variant="outline" size="sm" disabled={busy} onClick={() => send({ action: "revoke_allocation", allocationId: allocation.id, occurrenceId: occurrence.id, expectedVersion: occurrence.version, reason: "Reviewer explicitly removed this actual-to-expectation allocation" }).catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to revoke allocation."))}>Revoke allocation</Button>}</div>)}</div></details>
  </CardContent></Card>;
}

function RecurrenceReview({ data, busy, send }: { data: ForecastReconciliationData; busy: boolean; send: Send }) {
  const [driverId, setDriverId] = useState("");
  const option = data.recurrence.options.find((item) => item.driverId === driverId);
  const current = data.recurrence.states.find((item) => item.policy.driverId === driverId);
  const month = data.throughDate.slice(0, 7);
  async function approve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!option) return; const fields = new FormData(event.currentTarget);
    await send({ action: "approve_recurrence", driverId, definitionHash: option.hash, expectedVersion: current?.policy.version ?? 0, endMonth: fields.get("endMonth"), independentObligation: fields.get("independent") === "on", reason: fields.get("reason") }).catch(() => undefined);
  }
  return <Card><CardHeader><CardTitle>Capture recurring expectations automatically</CardTitle><CardDescription>Approve a fixed schedule once, then preserve each due occurrence as the forecast updates. Actual allocations still require their own review. Changing the driver requires renewed approval.</CardDescription></CardHeader><CardContent className="flex flex-col gap-5">
    {data.recurrence.states.map(({ policy, state, reason, pendingCount }) => <div key={`${policy.id}:${policy.version}`} className="flex flex-col gap-2">
      <p><strong>{policy.definition.driver.label}</strong> · {state} · {policy.startMonth} to {policy.endMonth} · v{policy.version}{pendingCount ? ` · ${pendingCount} awaiting capture` : ""}</p>
      {reason && <p className="text-sm">{reason}</p>}
      {policy.status === "active" && <form onSubmit={async (event) => { event.preventDefault(); const fields = new FormData(event.currentTarget); await send({ action: "pause_recurrence", policyId: policy.id, expectedVersion: policy.version, reason: fields.get("reason") }).catch(() => undefined); }}><FieldGroup><Field><FieldLabel htmlFor={`pause-${policy.id}`}>Reason to pause automatic capture</FieldLabel><Input id={`pause-${policy.id}`} name="reason" maxLength={2000} required disabled={busy} /></Field><Button variant="outline" disabled={busy}>Pause capture</Button></FieldGroup></form>}
    </div>)}
    <FieldDescription>Pausing capture preserves existing obligations and the underlying forecast driver. It does not cancel expected cash. Missed months within an approved window are captured when the forecast next updates.</FieldDescription>
    <form key={`${driverId}:${current?.policy.version ?? 0}`} id="approve-recurrence" onSubmit={approve}><FieldGroup>
      <Choice id="recurring-driver" label="Recurring schedule" value={driverId} onChange={setDriverId} disabled={busy} options={data.recurrence.options.map((item) => ({ value: item.driverId, label: `${item.label} · ${item.cadence} · ${decimal(item.amountMinor)} ${item.currency}` }))} />
      {!data.recurrence.options.length && <p>No supported fixed recurring cash schedules are available.</p>}
      {option && <details><summary className="cursor-pointer">Schedule and source being approved</summary><div className="mt-2 flex flex-col gap-2 break-all text-sm"><p>Schedule: {option.definition.driver.effectiveFrom} to {option.definition.driver.effectiveTo ?? "no driver end date"}. Automatic capture begins {month} and ends at the month you approve below.</p><p>Accounts: {option.definition.accounts.map((account) => `${account.accountCode} ${account.accountName}`).join("; ")}</p><p>Evidence: {option.definition.driver.evidenceId ?? "Approved company assumption"} · Fact: {option.definition.driver.factId ?? "None"}</p></div></details>}
      <Field><FieldLabel htmlFor="recurrence-end">Capture through month</FieldLabel><Input id="recurrence-end" type="month" name="endMonth" min={month} max={addMonths(month, 23)} defaultValue={addMonths(month, 11)} required disabled={busy} /><FieldDescription>Up to 24 months per approval. An earlier driver end date still applies.</FieldDescription></Field>
      <Field orientation="horizontal"><input id="recurrence-independent" name="independent" type="checkbox" required disabled={busy} /><FieldLabel htmlFor="recurrence-independent">I reviewed this schedule and confirmed it does not duplicate another obligation.</FieldLabel></Field>
      <Field><FieldLabel htmlFor="recurrence-reason">Approval or renewal reason</FieldLabel><Input id="recurrence-reason" name="reason" maxLength={2000} required disabled={busy} /></Field>
    </FieldGroup></form>
  </CardContent><CardFooter><Button form="approve-recurrence" disabled={busy || !option}>{current ? "Renew capture approval" : "Approve recurring capture"}</Button></CardFooter></Card>;
}

function HistoryApproval({ data, busy, send }: { data: ForecastReconciliationData; busy: boolean; send: Send }) {
  const [selected, setSelected] = useState(""); const candidate = data.candidates.find((item) => item.definition.key === selected && item.definition.origin === "history");
  return <Card><CardHeader><CardTitle>Turn reviewed history into a recurring estimate</CardTitle><CardDescription>Three consecutive months with one similar cash event per month can suggest a fixed monthly estimate. Approval preserves the source history and bounds the schedule; it never automatically matches actual payments by amount or memo.</CardDescription></CardHeader><CardContent><form id="approve-history" onSubmit={async (event) => { event.preventDefault(); if (!candidate) return; const fields = new FormData(event.currentTarget); await send({ action: "approve_history", candidateKey: candidate.definition.key, candidateHash: candidate.hash, endMonth: fields.get("endMonth"), independentObligation: fields.get("independent") === "on", reason: fields.get("reason") }).catch(() => undefined); }}><FieldGroup>
    <Choice id="history-pattern" label="Historical pattern" value={selected} onChange={setSelected} disabled={busy} options={data.candidates.filter((item) => item.definition.origin === "history").map((item) => ({ value: item.definition.key, label: `${item.definition.label} · ${data.currency} ${decimal(item.definition.amountMinor)}` }))} />
    {candidate && <p className="text-sm">Median estimate: {data.currency} {decimal(candidate.definition.amountMinor)}. Expected day: {candidate.definition.expectedDate.slice(8)}. Based on {candidate.definition.sourceLineIds.length} source journal lines. {candidate.capturedOccurrenceId ? "The preserved occurrence remains unchanged; this recurring schedule starts next month." : "This schedule starts this month."} Existing approved schedules and captured obligations must be checked for overlap.</p>}
    <Field><FieldLabel htmlFor="history-end">Estimate through month</FieldLabel><Input id="history-end" name="endMonth" type="month" min={data.throughDate.slice(0, 7)} max={addMonths(data.throughDate.slice(0, 7), 23)} defaultValue={addMonths(data.throughDate.slice(0, 7), 5)} required disabled={busy} /></Field>
    <Field orientation="horizontal"><input id="history-independent" type="checkbox" name="independent" required disabled={busy} /><FieldLabel htmlFor="history-independent">I checked the source history and confirmed this does not duplicate another approved obligation or schedule.</FieldLabel></Field>
    <Field><FieldLabel htmlFor="history-reason">Reason for approving this estimate</FieldLabel><Input id="history-reason" name="reason" required maxLength={2000} disabled={busy} /></Field>
  </FieldGroup></form></CardContent><CardFooter><Button form="approve-history" disabled={busy || !candidate}>Approve bounded recurring estimate</Button></CardFooter></Card>;
}

function RecoverSchedule({ candidate, data, busy, send }: { candidate: ForecastReconciliationData["recovery"][number]; data: ForecastReconciliationData; busy: boolean; send: Send }) {
  const [amount, setAmount] = useState(decimal(candidate.currentAmountMinor)); const [day, setDay] = useState("1"); const [end, setEnd] = useState(addMonths(candidate.startMonth, 5)); const [reason, setReason] = useState(""); const [ack, setAck] = useState(false);
  const [preview, setPreview] = useState<{ after: { month: string; endingCashMinor: string }[]; before: { month: string; endingCashMinor: string }[] } | null>(null);
  const change = (setter: (value: string) => void, value: string) => { setter(value); setPreview(null); };
  async function submit(action: string) { const result = await send({ action, driverId: candidate.driverId, replacementHash: candidate.hash, amountMinor: minor(amount), expectedDay: Number(day), endMonth: end, reason, acknowledgePreservedOccurrences: ack }); if (action === "preview_recurrence_replacement") setPreview(result as typeof preview); }
  return <Card><CardHeader><CardTitle>Recover {candidate.label}</CardTitle><CardDescription>{candidate.reason} Approve a new monthly assumption from {candidate.startMonth}; {candidate.preservedOccurrenceIds.length} captured obligations remain unchanged.</CardDescription></CardHeader><CardContent><FieldGroup><p>Previously approved amount: {data.currency} {decimal(candidate.oldAmountMinor)}. Current driver amount: {data.currency} {decimal(candidate.currentAmountMinor)}.</p><details><summary className="cursor-pointer">Inspect the earlier source history</summary><p>{candidate.oldSourceLineIds.length} original source lines; {candidate.currentSourceLines.length} remain in posted history. Reversed or changed history is not automatically reapproved.</p><ul className="list-disc pl-5 text-sm">{candidate.currentSourceLines.map((line) => <li key={line.id}>{line.postingDate} · {line.memo} · {line.accountName} · debit {decimal(line.debitMinor)}, credit {decimal(line.creditMinor)}</li>)}</ul></details><Field><FieldLabel>New monthly amount</FieldLabel><Input value={amount} disabled={busy} onChange={(event) => change(setAmount, event.target.value)} /></Field><Field><FieldLabel>Expected payment day</FieldLabel><Input type="number" min={1} max={31} value={day} disabled={busy} onChange={(event) => change(setDay, event.target.value)} /></Field><Field><FieldLabel>Approve through month</FieldLabel><Input type="month" min={candidate.startMonth} max={addMonths(data.throughDate.slice(0, 7), 23)} value={end} disabled={busy} onChange={(event) => change(setEnd, event.target.value)} /></Field><Field><FieldLabel>Reason and basis for the new assumption</FieldLabel><Input value={reason} maxLength={2000} disabled={busy} onChange={(event) => change(setReason, event.target.value)} /></Field><Field orientation="horizontal"><input type="checkbox" id={`recovery-${candidate.driverId}`} checked={ack} disabled={busy} onChange={(event) => { setAck(event.target.checked); setPreview(null); }} /><FieldLabel htmlFor={`recovery-${candidate.driverId}`}>I reviewed overlap and the preserved obligations. This replacement is my explicit assumption.</FieldLabel></Field><Button variant="outline" disabled={busy || !ack || !reason.trim()} onClick={() => submit("preview_recurrence_replacement").catch(() => undefined)}>Preview replacement</Button>{preview && <><details open><summary className="cursor-pointer">Month-end cash after replacement</summary><ul className="list-disc pl-5 text-sm">{preview.after.filter((month) => month.month >= candidate.startMonth).map((month) => <li key={month.month}>{month.month}: {data.currency} {decimal(preview.before.find((row) => row.month === month.month)?.endingCashMinor ?? "0")} → {decimal(month.endingCashMinor)}</li>)}</ul></details><Button disabled={busy || !ack} onClick={() => submit("replace_recurrence").catch(() => undefined)}>Replace future schedule</Button></>}</FieldGroup></CardContent></Card>;
}

const subscribeHash = (listener: () => void) => { window.addEventListener("hashchange", listener); return () => window.removeEventListener("hashchange", listener); };
export function ForecastReconciliation({ companyId, companyName, initialData, initialError }: { companyId: string; companyName: string; initialData: ForecastReconciliationData | null; initialError: string }) {
  const [data, setData] = useState(initialData); const [busy, setBusy] = useState(false); const [error, setError] = useState(initialError); const [notice, setNotice] = useState("");
  const [candidateKey, setCandidateKey] = useState(""); const [occurrenceId, setOccurrenceId] = useState("");
  const linkedOccurrence = useSyncExternalStore(subscribeHash, () => window.location.hash.replace("#occurrence-", ""), () => "");
  const [accountId, setAccountId] = useState(""); const [evidenceId, setEvidenceId] = useState("manual"); const [coverageStatus, setCoverageStatus] = useState("complete");
  const retry = useRef<{ fingerprint: string; requestKey: string } | null>(null);
  const occurrence = data?.settlement.occurrences.find((item) => item.id === (occurrenceId || linkedOccurrence)) ?? data?.settlement.occurrences[0];
  async function refresh() {
    const response = await fetch("/api/forecast-reconciliation", { cache: "no-store" }); const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "Unable to refresh.");
    if (payload.companyId !== companyId) throw new Error("Company selection changed. Reload this page.");
    setData(payload);
  }
  const send: Send = async (body) => {
    setBusy(true); setError(""); setNotice("");
    try {
      const fingerprint = JSON.stringify(body);
      if (retry.current?.fingerprint !== fingerprint) retry.current = { fingerprint, requestKey: crypto.randomUUID() };
      const response = await fetch("/api/forecast-reconciliation", { method: "POST", headers: { "Content-Type": "application/json", "x-company-id": companyId }, body: JSON.stringify({ ...body, requestKey: retry.current.requestKey }) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? "Unable to save review.");
      retry.current = null;
      if (body.action === "preview_recurrence_replacement") return payload;
      if (body.action === "capture") { setOccurrenceId(payload.id); setCandidateKey(""); }
      setNotice(payload.calculationStatus === "failed" ? "Review saved. Forecast recalculation is queued for retry." : "Review saved and the outlook updated."); await refresh(); return payload;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save."); throw cause; }
    finally { setBusy(false); }
  };
  async function capture(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const fields = new FormData(event.currentTarget); const candidate = data?.candidates.find((item) => item.definition.key === candidateKey);
    if (!candidate) return;
    await send({ action: "capture", candidateKey, candidateHash: candidate.hash, independentObligation: fields.get("independent") === "on", autoMatch: fields.get("autoMatch") === "on", reason: fields.get("reason") }).catch(() => undefined);
  }
  async function coverage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const fields = new FormData(event.currentTarget);
    await send({ action: "coverage", accountId, startDate: fields.get("startDate"), throughDate: fields.get("throughDate"), status: coverageStatus, ...(evidenceId === "manual" ? {} : { evidenceId }), reason: fields.get("reason"), previewHash: data?.coveragePreviewHash }).catch(() => undefined);
  }
  return <main className="mx-auto flex max-w-5xl flex-col gap-6 px-5 py-8">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><Link href="/goals" className="text-sm underline">Back to goals & reviews</Link><h1 className="mt-3 text-3xl font-semibold">Expectations & coverage</h1><p className="mt-2 text-muted-foreground">{companyName} · Reconcile what happened with what remains expected.</p></div><Button variant="outline" disabled={busy} onClick={async () => { setBusy(true); try { await refresh(); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to refresh."); } finally { setBusy(false); } }}>Refresh</Button></header>
    {error && <Alert variant="destructive"><AlertTitle>Review needs attention</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}{notice && <p role="status">{notice}</p>}
    {data && <>
      <p className="text-sm text-muted-foreground">Actuals through {data.throughDate} (UTC). Expected dates stay unchanged until you revise them. An overdue balance from a prior month requires a new date before it enters the current cash forecast.</p>
      {!!data.exceptions.length && <Alert><AlertTitle>Unresolved forecast exceptions</AlertTitle><AlertDescription><ul className="list-disc pl-5">{data.exceptions.map((item, index) => <li key={index}>{item.reason}</li>)}</ul></AlertDescription></Alert>}
      <RecurrenceReview data={data} busy={busy} send={send} />
      {data.recovery.map((candidate) => <RecoverSchedule key={candidate.hash} candidate={candidate} data={data} busy={busy} send={send} />)}
      <HistoryApproval data={data} busy={busy} send={send} />
      <Card><CardHeader><CardTitle>Review a current-month expectation</CardTitle><CardDescription>Approved driver schedules already affect the forecast. Capturing one preserves its occurrence for settlement and rollover. Historical suggestions affect the outlook only after approval.</CardDescription></CardHeader><CardContent><form id="capture-expectation" onSubmit={capture}><FieldGroup>
        <Choice id="candidate" label="Expectation to preserve" value={candidateKey} onChange={setCandidateKey} disabled={busy} options={data.candidates.filter((item) => !item.capturedOccurrenceId).map(({ definition }) => ({ value: definition.key, label: `${definition.origin === "history" ? "Suggestion" : "Driver"}: ${definition.label.slice(0, 80)} · ${decimal(definition.amountMinor)} ${definition.currency}` }))} />
        {!data.candidates.length && <p>No uncaptured supported cash occurrences in the current month.</p>}
        <Field orientation="horizontal"><input id="independent" name="independent" type="checkbox" required disabled={busy} /><FieldLabel htmlFor="independent">I checked the source and confirmed this is not a duplicate of another forecast obligation.</FieldLabel></Field>
        {data.candidates.find((candidate) => candidate.definition.key === candidateKey)?.eligibleAutoMatchFactId && <Field orientation="horizontal"><input id="capture-auto" name="autoMatch" type="checkbox" disabled={busy} /><FieldLabel htmlFor="capture-auto">Automatically allocate actual journals that explicitly reference this one-off source fact and the same accounting treatment</FieldLabel></Field>}
        <Field><FieldLabel htmlFor="capture-reason">Approval reason</FieldLabel><Input id="capture-reason" name="reason" maxLength={2000} required disabled={busy} /></Field>
      </FieldGroup></form></CardContent><CardFooter><Button form="capture-expectation" disabled={busy || !candidateKey}>Approve and preserve occurrence</Button></CardFooter></Card>
      {!!data.settlement.occurrences.length && <Choice id="occurrence" label="Preserved expectation" value={occurrence?.id ?? ""} onChange={setOccurrenceId} disabled={busy} options={data.settlement.occurrences.map((item) => ({ value: item.id, label: `${item.label} · ${item.expectedDate}` }))} />}
      {occurrence && <OccurrenceReview key={`${occurrence.id}:${occurrence.version}`} occurrence={occurrence} data={data} busy={busy} send={send} />}
      <Card id="coverage"><CardHeader><CardTitle>Cash source coverage</CardTitle><CardDescription>Coverage records whether activity is complete for an account and date range. It is separate from accounting reconciliation. Zero activity may be complete when explicitly supported.</CardDescription></CardHeader><CardContent className="flex flex-col gap-5">
        <ul className="flex flex-col gap-2">{data.coverage.accounts.map((account) => <li key={account.id}><strong>{account.name}</strong>: {account.state}{account.coveredThrough ? ` · covered through ${account.coveredThrough}` : ""}<details><summary className="cursor-pointer text-sm">Reviewed intervals</summary><ul className="list-disc pl-5 text-sm">{account.assertions.map((assertion) => <li key={assertion.id}>{assertion.startDate} to {assertion.throughDate}: {assertion.state} · {assertion.reason}</li>)}</ul></details></li>)}</ul>
        <form id="cash-coverage" onSubmit={coverage}><FieldGroup>
          <Choice id="coverage-account" label="Cash account" value={accountId} onChange={setAccountId} disabled={busy} options={data.coverage.accounts.map((account) => ({ value: account.id, label: account.name }))} />
          <Field><FieldLabel htmlFor="coverage-start">From date</FieldLabel><Input id="coverage-start" name="startDate" type="date" defaultValue={data.coverage.startDate} required disabled={busy} /></Field>
          <Field><FieldLabel htmlFor="coverage-through">Through date</FieldLabel><Input id="coverage-through" name="throughDate" type="date" defaultValue={data.coverage.throughDate} max={data.throughDate} required disabled={busy} /></Field>
          <Choice id="coverage-state" label="Coverage status" value={coverageStatus} onChange={setCoverageStatus} disabled={busy} options={[{ value: "complete", label: "Complete for this interval" }, { value: "partial", label: "Partial" }, { value: "revoked", label: "Revoke this exact interval" }]} />
          <Choice id="coverage-evidence" label="Supporting evidence" value={evidenceId} onChange={setEvidenceId} disabled={busy} options={[{ value: "manual", label: "My explicit review assertion" }, ...data.coverage.evidence.map((item) => ({ value: item.id, label: item.name }))]} />
          <Field><FieldLabel htmlFor="coverage-reason">How completeness was established, or what is missing</FieldLabel><Input id="coverage-reason" name="reason" required maxLength={2000} disabled={busy} /><FieldDescription>New or corrected imported or posted activity within the interval makes a prior assertion stale. A file alone does not establish completeness.</FieldDescription></Field>
        </FieldGroup></form>
      </CardContent><CardFooter><Button form="cash-coverage" disabled={busy || !accountId}>Record coverage review</Button></CardFooter></Card>
    </>}
  </main>;
}
