"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Section = "revenue" | "expense" | "asset" | "liability" | "equity";
type Line = { id: string; label: string; section: Section; timing?: "current" | "noncurrent"; fallback: boolean };
type Category = { id: string; line: string; name: string; sortOrder: number };
type Resolved = { line: string | null; categoryId: string | null; status: "confirmed" | "suggested" | "fallback" | "unclassified"; reason: string };
type Account = { id: string; code: string; name: string; accountType: string; section: Section | null; active: boolean; inUse: boolean; reportLine: string | null; reportCategoryId: string | null; resolved: Resolved; suggestion: { line: string | null; status: string; reason: string } };
export type MappingSummary = { confirmed: number; suggested: number; fallback: number; unclassified: number; total: number; complete: boolean };
export type MappingPayload = { companyId: string; lines: Line[]; categories: Category[]; accounts: Account[]; summary: MappingSummary };
type Change = { accountId: string; line: string | null; categoryId?: string | null };

const sectionLabel: Record<Section, string> = { revenue: "Revenue", expense: "Expenses", asset: "Assets", liability: "Liabilities", equity: "Equity" };
const statusLabel: Record<Resolved["status"], string> = { confirmed: "Confirmed", suggested: "Suggested", fallback: "Needs a line", unclassified: "Needs a section" };
const field = "h-8 rounded-md border border-border bg-transparent px-2 text-[13px]";

/**
 * Map each chart account to a Standard statement line and, optionally, a
 * category under it. Presentation only: journals, balances and the ledger
 * statements never change, so any account can be remapped at any time.
 */
export function ReportMappingPanel({ onChanged }: { onChanged?: (summary: MappingSummary) => void }) {
  const [data, setData] = useState<MappingPayload | null>(null);
  const [filter, setFilter] = useState<"review" | "all">("review");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newCategory, setNewCategory] = useState({ line: "revenue", name: "" });

  const apply = useCallback((payload: MappingPayload) => { setData(payload); onChanged?.(payload.summary); }, [onChanged]);
  const load = useCallback(async () => { const response = await fetch("/api/report-mapping"); if (response.ok) apply(await response.json()); }, [apply]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  const save = async (changes: Change[]) => {
    setSaving(true); setError(null);
    try {
      const response = await fetch("/api/report-mapping", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ changes }) });
      const result = await response.json();
      if (!response.ok) { setError(result.error ?? "Unable to save the mapping."); return; }
      apply(result);
    } finally { setSaving(false); }
  };
  const categoryRequest = async (url: string, init: RequestInit) => {
    setError(null);
    const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
    if (!response.ok) { setError((await response.json().catch(() => ({}))).error ?? "Unable to change the category."); return false; }
    await load(); return true;
  };

  const linesBySection = useMemo(() => { const grouped = new Map<Section, Line[]>(); for (const line of data?.lines ?? []) grouped.set(line.section, [...(grouped.get(line.section) ?? []), line]); return grouped; }, [data]);
  const lineLabel = (id: string | null) => data?.lines.find((line) => line.id === id)?.label ?? "—";
  const inUse = (data?.accounts ?? []).filter((account) => account.inUse);
  const shown = filter === "review" ? inUse.filter((account) => account.resolved.status !== "confirmed") : data?.accounts ?? [];
  const acceptable = inUse.filter((account) => account.resolved.status === "suggested" && account.resolved.line);

  if (!data) return <p className="text-[13px] text-muted-foreground">Loading statement mapping…</p>;
  const { summary } = data;
  return <div className="flex flex-col gap-7">
    <div>
      <h3 className="text-sm font-medium">Statement mapping</h3>
      <p className="mt-1 text-xs text-muted-foreground">Place each account on a line of the Standard layout, and optionally in a category under it. This changes how statements are grouped, never the books. Suggestions come from each account&apos;s type, working capital category and name.</p>
      <p className={cn("mt-3 text-[13px]", summary.complete ? "text-muted-foreground" : "text-foreground")}>
        {summary.complete ? `All ${summary.total} accounts in use are confirmed.` : `${summary.confirmed} of ${summary.total} accounts in use confirmed · ${summary.suggested} suggested · ${summary.fallback + summary.unclassified} need a choice.`}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border border-border text-[12px]" role="tablist" aria-label="Accounts shown">
          {(["review", "all"] as const).map((value) => <button aria-selected={filter === value} className={cn("px-3 py-1.5", filter === value ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")} key={value} onClick={() => setFilter(value)} role="tab" type="button">{value === "review" ? "Needs review" : "All accounts"}</button>)}
        </div>
        {acceptable.length > 0 && <Button disabled={saving} onClick={() => save(acceptable.map((account) => ({ accountId: account.id, line: account.resolved.line, categoryId: account.resolved.categoryId })))} size="sm" type="button" variant="outline">{saving ? "Saving…" : `Accept ${acceptable.length} suggestion${acceptable.length === 1 ? "" : "s"}`}</Button>}
      </div>
      {error && <p className="mt-3 text-[13px] text-destructive">{error}</p>}
    </div>

    {shown.length === 0 ? <p className="text-[13px] text-muted-foreground">{filter === "review" ? "Nothing to review. Every account in use has a confirmed line." : "No chart accounts yet."}</p> : <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead className="text-left text-muted-foreground"><tr><th className="pb-2 pr-3">Account</th><th className="pb-2 pr-3">Line</th><th className="pb-2 pr-3">Category</th><th className="pb-2">Status</th></tr></thead>
        <tbody>{shown.map((account) => {
          const options = account.section ? linesBySection.get(account.section) ?? [] : [];
          const categories = data.categories.filter((category) => category.line === account.resolved.line);
          return <tr className="border-t border-border align-top" key={account.id}>
            <td className="py-2 pr-3"><span className="tabular-nums">{account.code}</span> · {account.name}{!account.active && <span className="ml-2 text-xs text-muted-foreground">inactive</span>}<span className="block text-xs text-muted-foreground">{account.section ? sectionLabel[account.section] : "No statement section"}</span></td>
            <td className="py-2 pr-3">{account.section ? <select aria-label={`Line for ${account.code}`} className={field} disabled={saving} onChange={(event) => save([{ accountId: account.id, line: event.target.value }])} value={account.resolved.line ?? ""}>{options.map((line) => <option key={line.id} value={line.id}>{line.label}</option>)}</select> : <span className="text-muted-foreground">Set the section it offsets in the chart of accounts</span>}</td>
            <td className="py-2 pr-3">{categories.length > 0 ? <select aria-label={`Category for ${account.code}`} className={field} disabled={saving} onChange={(event) => save([{ accountId: account.id, line: account.resolved.line, categoryId: event.target.value || null }])} value={account.resolved.categoryId ?? ""}><option value="">Uncategorized</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select> : <span className="text-muted-foreground">—</span>}</td>
            <td className="py-2"><span className={cn(account.resolved.status === "confirmed" ? "text-muted-foreground" : "text-foreground")}>{statusLabel[account.resolved.status]}</span>{account.resolved.status !== "confirmed" && <span className="block max-w-56 text-xs text-muted-foreground">{account.resolved.reason}</span>}{account.resolved.status === "suggested" && account.resolved.line && <button className="mt-1 block text-xs underline underline-offset-2" disabled={saving} onClick={() => save([{ accountId: account.id, line: account.resolved.line, categoryId: account.resolved.categoryId }])} type="button">Confirm {lineLabel(account.resolved.line)}</button>}{account.resolved.status === "confirmed" && account.suggestion.line && account.suggestion.line !== account.resolved.line && <button className="mt-1 block text-xs text-muted-foreground underline underline-offset-2" disabled={saving} onClick={() => save([{ accountId: account.id, line: null }])} type="button">Clear, back to {lineLabel(account.suggestion.line)}</button>}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>}

    <section className="border-t border-border pt-5">
      <h4 className="text-[11px] uppercase tracking-[.12em] text-muted-foreground">Categories</h4>
      <p className="mt-1 text-xs text-muted-foreground">Split a line into named categories, such as Subscriptions and Services under Revenues. Accounts on the line that you leave uncategorized are shown as Uncategorized.</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select aria-label="Line for the new category" className={field} onChange={(event) => setNewCategory((current) => ({ ...current, line: event.target.value }))} value={newCategory.line}>{data.lines.map((line) => <option key={line.id} value={line.id}>{line.label}</option>)}</select>
        <Input aria-label="Category name" className="h-8 w-48 text-[13px]" maxLength={80} onChange={(event) => setNewCategory((current) => ({ ...current, name: event.target.value }))} placeholder="Category name" value={newCategory.name} />
        <Button disabled={!newCategory.name.trim()} onClick={async () => { if (await categoryRequest("/api/report-categories", { method: "POST", body: JSON.stringify({ line: newCategory.line, name: newCategory.name.trim() }) })) setNewCategory((current) => ({ ...current, name: "" })); }} size="sm" type="button" variant="outline">Add category</Button>
      </div>
      {data.categories.length > 0 && <div className="mt-4 flex flex-col gap-4">{data.lines.filter((line) => data.categories.some((category) => category.line === line.id)).map((line) => {
        const own = data.categories.filter((category) => category.line === line.id);
        return <div key={line.id}><p className="text-[13px] font-medium">{line.label}</p><ul className="mt-1 flex flex-col gap-1">{own.map((category, index) => <CategoryRow category={category} key={category.id} canMoveUp={index > 0} canMoveDown={index < own.length - 1}
          onRename={(name) => categoryRequest(`/api/report-categories/${category.id}`, { method: "PATCH", body: JSON.stringify({ name }) })}
          onMove={async (direction) => { const swap = own[index + direction]!; await categoryRequest(`/api/report-categories/${category.id}`, { method: "PATCH", body: JSON.stringify({ sortOrder: swap.sortOrder }) }); await categoryRequest(`/api/report-categories/${swap.id}`, { method: "PATCH", body: JSON.stringify({ sortOrder: category.sortOrder }) }); }}
          onDelete={() => categoryRequest(`/api/report-categories/${category.id}`, { method: "DELETE" })} />)}</ul></div>;
      })}</div>}
    </section>
  </div>;
}

function CategoryRow({ category, canMoveUp, canMoveDown, onRename, onMove, onDelete }: { category: Category; canMoveUp: boolean; canMoveDown: boolean; onRename: (name: string) => Promise<boolean>; onMove: (direction: -1 | 1) => Promise<void>; onDelete: () => Promise<boolean> }) {
  const [editing, setEditing] = useState(false); const [name, setName] = useState(category.name);
  return <li className="flex items-center gap-2 text-[13px]">
    {editing ? <><Input aria-label="Category name" className="h-7 w-48 text-[13px]" maxLength={80} onChange={(event) => setName(event.target.value)} value={name} /><button className="text-xs underline underline-offset-2" disabled={!name.trim()} onClick={async () => { if (await onRename(name.trim())) setEditing(false); }} type="button">Save</button><button className="text-xs text-muted-foreground" onClick={() => { setName(category.name); setEditing(false); }} type="button">Cancel</button></>
      : <><span className="min-w-32">{category.name}</span><button className="text-xs text-muted-foreground underline underline-offset-2" onClick={() => setEditing(true)} type="button">Rename</button>{canMoveUp && <button aria-label={`Move ${category.name} up`} className="text-xs text-muted-foreground" onClick={() => void onMove(-1)} type="button">↑</button>}{canMoveDown && <button aria-label={`Move ${category.name} down`} className="text-xs text-muted-foreground" onClick={() => void onMove(1)} type="button">↓</button>}<button className="text-xs text-muted-foreground underline underline-offset-2" onClick={() => void onDelete()} type="button">Remove</button></>}
  </li>;
}
