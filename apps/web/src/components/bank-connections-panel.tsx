"use client";
import { useCallback, useEffect, useState } from "react";
import Script from "next/script";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { bankWorkspace } from "@/lib/bank-connections";
type Workspace = Awaited<ReturnType<typeof bankWorkspace>>;
type Session = { sessionId: string; nonce: string; applicationId: string; environment: string };
declare global { interface Window { TellerConnect?: { setup: (options: { applicationId: string; environment: string; nonce: string; products: string[]; selectAccount: string; enrollmentId?: string; onSuccess: (enrollment: Record<string, unknown>) => void; onExit: () => void }) => { open: () => void } } } }
async function api(path: string, body?: unknown) {
  const response = await fetch(path, { ...(body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), cache: "no-store" });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || "Bank request failed."); return data;
}
export function BankConnectionsPanel({ companyId, companyName }: { companyId: string; companyName: string }) {
  const [data, setData] = useState<Workspace | null>(null); const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const [ready, setReady] = useState(false); const [notice, setNotice] = useState("");
  const refresh = useCallback(async () => { const result = await api("/api/banks") as Workspace; if (result.companyId !== companyId) throw new Error("Active company changed. Reload this page."); setData(result); }, [companyId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- loads from the API; state is set after the request resolves
  useEffect(() => { void refresh().catch((e: Error) => setError(e.message)); }, [refresh]);
  const act = async (body: unknown) => {
    setBusy(true); setError(""); setNotice("");
    try { const result = await api("/api/banks", body); if (typeof result.imports === "number") setNotice(`${result.imports} changed monthly imports ready for review. ${result.pending} pending transactions excluded.`); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Bank request failed."); } finally { setBusy(false); }
  };
  const connect = async (enrollmentId?: string) => {
    setBusy(true); setError("");
    try {
      const session = await api("/api/banks/session", {}) as Session;
      if (!window.TellerConnect) throw new Error("Teller Connect has not loaded. Retry in a moment.");
      window.TellerConnect.setup({ applicationId: session.applicationId, environment: session.environment, nonce: session.nonce, products: ["transactions"], selectAccount: "multiple", ...(enrollmentId ? { enrollmentId } : {}), onSuccess: (enrollment) => { void act({ action: "connect", enrollment: { ...enrollment, sessionId: session.sessionId } }); }, onExit: () => setBusy(false) }).open();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to open Teller Connect."); setBusy(false); }
  };
  return <main className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
    {data && !data.configurationError && <Script src="https://cdn.teller.io/connect/connect.js" onReady={() => setReady(true)} onError={() => setError("Unable to load Teller Connect. Check your connection and retry.")} />}
    <header className="flex flex-wrap items-start justify-between gap-4"><div><nav className="flex gap-4 text-sm underline"><Link href="/">Workspace</Link><Link href="/imports">Import review</Link></nav><h1 className="mt-4 text-3xl font-semibold">Bank connections</h1><p className="text-muted-foreground">{companyName} · Connect selected accounts and keep transaction evidence up to date.</p></div><Button disabled={busy || !ready || !!data?.configurationError} onClick={() => void connect()}>Connect bank</Button></header>
    {error && <Alert variant="destructive"><AlertTitle>Bank connection needs attention</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
    {notice && <p role="status">{notice}</p>}
    {data?.configurationError && <Alert><AlertTitle>Teller is not configured</AlertTitle><AlertDescription>{data.configurationError}</AlertDescription></Alert>}
    <p className="text-sm text-muted-foreground">{data?.environment === "sandbox" ? "Sandbox uses synthetic bank data. " : ""}Choose a ledger account before syncing. Imported transactions remain unapproved evidence until reviewed. Bank feeds can overlap uploaded statements and do not prove complete statement balances. Automatic syncing requires the scheduled job described in docs/teller.md.</p>
    {!data && !error && <p role="status">Loading connections…</p>}
    {data?.connections.length === 0 && <Empty><EmptyHeader><EmptyTitle>No banks connected yet</EmptyTitle><EmptyDescription>Connect a bank to select the accounts you want to sync.</EmptyDescription></EmptyHeader></Empty>}
    {data?.connections.map((connection) => <Card key={connection.id}>
      <CardHeader><CardTitle>{connection.institution}</CardTitle><CardDescription>{connection.environment} · {connection.status} · Last synced: {connection.lastSyncedAt ? new Date(connection.lastSyncedAt).toLocaleString() : "Never"}</CardDescription></CardHeader>
      <CardContent className="flex flex-col gap-4">
        {connection.error && <p role="alert">{connection.error}</p>}
        {data.accounts.filter((account) => account.connectionId === connection.id).map((account) => <div key={account.id} className="flex flex-col gap-2">
          <FieldGroup><Field><FieldLabel htmlFor={account.id}>{account.name} {account.lastFour ? `••${account.lastFour}` : ""} · {account.currency} · {account.status}</FieldLabel>
            <Select value={account.chartAccountId ?? "unmapped"} disabled={busy || connection.status === "disconnected"} onValueChange={(value) => void act({ action: "map", accountId: account.id, chartAccountId: value === "unmapped" ? null : value })}>
              <SelectTrigger id={account.id}><SelectValue placeholder="Select ledger account" /></SelectTrigger>
              <SelectContent><SelectGroup><SelectItem value="unmapped">Select ledger account (imports paused)</SelectItem>
              {data.ledgerAccounts.filter((ledger) => account.accountType === "credit" ? ledger.accountType === "liability" : ledger.accountType === "asset" && ledger.cashTreatment !== "not_cash").map((ledger) => <SelectItem key={ledger.id} value={ledger.id}>{ledger.code} · {ledger.name}</SelectItem>)}
              </SelectGroup></SelectContent>
            </Select>
          </Field></FieldGroup>
          <div className="flex flex-wrap gap-3 text-sm">{Object.entries(account.snapshots).sort(([a], [b]) => b.localeCompare(a)).map(([month, snapshot]) => <Link className="underline" key={month} href={`/imports?source=${snapshot.sourceId}`}>Review {month}</Link>)}</div>
        </div>)}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy || !!data.configurationError || connection.status === "disconnected"} onClick={() => void act({ action: "sync", id: connection.id })}>Sync now</Button>
        <Button variant="outline" disabled={busy || !ready || !!data.configurationError || connection.status === "disconnected"} onClick={() => void connect(connection.enrollmentId)}>Reconnect</Button>
        <Button variant="outline" disabled={busy || !!data.configurationError || connection.status === "disconnected"} onClick={() => { if (window.confirm("Disconnect this bank? This revokes Teller access and stops sync. Imported evidence is retained.")) void act({ action: "disconnect", id: connection.id }); }}>Disconnect</Button>
      </CardFooter>
    </Card>)}
  </main>;
}
