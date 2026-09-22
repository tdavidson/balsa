"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { cn } from "@/lib/utils";

type Status = "missing" | "pending" | "approved" | "duplicate";
type Coverage = {
  period: string;
  accounts: {
    accountId: string;
    code: string;
    name: string;
    bankAccountIdentifier: string | null;
    bankStatement: { status: Status; evidenceIds: string[] };
    activity: { status: Status; sourceRowCount: number };
  }[];
  generalLedger: { status: Status; evidenceIds: string[] };
  blockers: string[];
};

const label = (status: Status) => status.replace(/_/g, " ");
const statusClass = (status: Status) => cn(
  "rounded-full px-2 py-0.5 text-xs font-medium capitalize",
  status === "approved" && "bg-secondary text-secondary-foreground",
  status === "pending" && "bg-muted text-muted-foreground",
  (status === "missing" || status === "duplicate") && "bg-destructive/10 text-destructive",
);

/** Shows whether a period has the approved source roles needed before journal reporting can be authoritative. */
export function JournalCoveragePanel({ period }: { period: string }) {
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/ledger/coverage?period=${period}`);
      setCoverage(response.ok ? await response.json() as Coverage : null);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  if (loading && !coverage) return <p className="text-sm text-muted-foreground">Loading source coverage…</p>;
  if (!coverage) return <p className="text-sm text-muted-foreground">Source coverage is unavailable for this period.</p>;

  return <div className="flex flex-col gap-5">
    <div className="flex items-start justify-between gap-4">
      <div>
        <h3 className="text-sm font-medium">Source coverage</h3>
        <p className="mt-1 text-xs text-muted-foreground">Exact account mappings and approved source roles required to validate {coverage.period}.</p>
      </div>
      <Button disabled={loading} onClick={() => void load()} size="sm" type="button" variant="outline">{loading ? "Refreshing…" : "Refresh"}</Button>
    </div>

    <section className="flex flex-col gap-2 border-b border-border pb-4">
      <div className="flex items-center justify-between gap-3 text-sm"><span>General ledger or QuickBooks detail</span><span className={statusClass(coverage.generalLedger.status)}>{label(coverage.generalLedger.status)}</span></div>
      <p className="text-xs text-muted-foreground">{coverage.generalLedger.evidenceIds.length} approved document{coverage.generalLedger.evidenceIds.length === 1 ? "" : "s"} matched.</p>
    </section>

    {coverage.accounts.length ? <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-muted-foreground"><tr><th className="pb-2 pr-4">Cash account</th><th className="pb-2 pr-4">Statement mapping</th><th className="pb-2 pr-4">Bank statement</th><th className="pb-2 text-right">Activity</th></tr></thead><tbody>{coverage.accounts.map((account) => <tr className="border-t border-border" key={account.accountId}><td className="py-3 pr-4"><span className="font-medium">{account.code} · {account.name}</span></td><td className="py-3 pr-4 text-muted-foreground">{account.bankAccountIdentifier ?? "Not mapped"}</td><td className="py-3 pr-4"><span className={statusClass(account.bankStatement.status)}>{label(account.bankStatement.status)}</span></td><td className="py-3 text-right"><span className={statusClass(account.activity.status)}>{label(account.activity.status)}</span><span className="ml-2 text-xs text-muted-foreground">{account.activity.sourceRowCount} rows</span></td></tr>)}</tbody></table></div> : <Empty><EmptyHeader><EmptyTitle>No cash accounts to cover</EmptyTitle><EmptyDescription>Add a cash asset and assign its statement line before using per-account bank coverage.</EmptyDescription></EmptyHeader></Empty>}

    {coverage.blockers.length > 0 && <section className="flex flex-col gap-2 rounded-md border border-destructive/30 p-4"><h4 className="text-sm font-medium text-destructive">Resolve before promotion</h4><ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-destructive">{coverage.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul></section>}
  </div>;
}
