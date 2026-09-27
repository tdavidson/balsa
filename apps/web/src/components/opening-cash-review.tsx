import type { OpeningCashReview } from "@nevermodel/finance-engine";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function exactMoney(value: string | null | undefined, currency: string) {
  if (value == null) return "Unavailable";
  const n = BigInt(value); const a = n < 0n ? -n : n;
  return `${currency} ${n < 0n ? "-" : ""}${(a / 100n).toLocaleString("en-US")}.${String(a % 100n).padStart(2, "0")}`;
}
export function OpeningCashPanel({ value }: { value: OpeningCashReview }) {
  return <Card><CardHeader><CardTitle>Starting cash: {exactMoney(value.ledgerCashMinor, value.currency)}</CardTitle><CardDescription>At {value.boundary} · {value.status === "reconciled" ? "Ties to approved statement balances" : "Reconciliation needs attention"}. This verifies the starting balance; activity coverage is reviewed separately.</CardDescription></CardHeader><CardContent className="flex flex-col gap-4">
    {value.accounts.map((account) => <details key={account.accountId}><summary className="cursor-pointer">{account.code} · {account.name}: {exactMoney(account.ledgerMinor, value.currency)} · {account.state.replaceAll("_", " ")}</summary><div className="mt-3 flex flex-col gap-2 text-sm"><p>Statement {exactMoney(account.statementMinor, value.currency)} · difference {exactMoney(account.differenceMinor, value.currency)}</p><p>Bank mapping: {account.bankAccountIdentifier ?? "Missing"}</p><ul className="list-disc pl-5">{account.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul><ul className="list-disc pl-5">{account.balances.map((balance) => <li key={balance.evidenceId}><a className="underline" href={`/api/evidence/${balance.evidenceId}/file`} target="_blank" rel="noreferrer">{balance.name}</a> · {balance.basis} balance {exactMoney(balance.valueMinor, value.currency)}</li>)}</ul><p>{account.journalLineIds.length} supporting posted cash lines. Inspect the month’s cash calculation to trace their sources.</p></div></details>)}
    {!!value.reasons.length && <ul className="list-disc pl-5 text-sm">{value.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>}
    <details><summary className="cursor-pointer text-sm">Calculation method</summary><p className="mt-2 text-sm">{value.formula} · {value.formulaVersion}</p></details>
  </CardContent></Card>;
}
