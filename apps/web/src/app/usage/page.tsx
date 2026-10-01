import { auth, authMode } from "@/lib/auth";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { ArrowLeft, ExternalLink } from "lucide-react";
import Link from "next/link";
import { getDatabase, llmMessages, llmRuns } from "@finance/database";
import { listCompanies, requireCompanyAccess } from "@/lib/auth";
import { AccountMenu } from "@/components/account-menu";
import { UsageHistory } from "@/components/usage-history";

export const dynamic = "force-dynamic";

const serif = (size: number) => ({ fontVariationSettings: `"opsz" ${size}` });
const dateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

function number(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function tokens(value: string | number | null | undefined) {
  const amount = number(value);
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(amount >= 10_000_000 ? 1 : 2)}M`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(amount >= 100_000 ? 0 : 1)}K`;
  return amount.toLocaleString();
}

function money(value: string | number | null | undefined) {
  const amount = number(value);
  if (amount === 0) return "$0.00";
  if (amount < 0.01) return `$${amount.toFixed(4)}`;
  return `$${amount.toFixed(2)}`;
}

function duration(value: string | number | null | undefined) {
  const milliseconds = number(value);
  if (milliseconds < 1_000) return `${Math.round(milliseconds)} ms`;
  return `${(milliseconds / 1_000).toFixed(1)} s`;
}

function operationLabel(operation: string) {
  return operation.split("_").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

export default async function UsagePage() {
  await auth.protect({ unauthenticatedUrl: "/login" });
  const context = await requireCompanyAccess();
  const companies = await listCompanies();
  const db = getDatabase();
  const costSum = sql<string>`coalesce(sum(nullif(${llmRuns.cost}, '')::numeric), 0)`;
  const averageLatency = sql<string>`coalesce(avg(nullif(${llmRuns.latencyMs}, '')::numeric), 0)`;

  const [totalsRows, conversationRows, modelRows, recentRuns, recentMessages] = await Promise.all([
    db.select({
      runs: count(),
      inputTokens: sql<string>`coalesce(sum(nullif(${llmRuns.inputTokens}, '')::numeric), 0)`,
      outputTokens: sql<string>`coalesce(sum(nullif(${llmRuns.outputTokens}, '')::numeric), 0)`,
      totalTokens: sql<string>`coalesce(sum(nullif(${llmRuns.totalTokens}, '')::numeric), 0)`,
      cost: costSum,
      pricedRuns: sql<number>`count(${llmRuns.cost})`,
    }).from(llmRuns).where(eq(llmRuns.companyId, context.company.id)),
    db.select({ count: count() }).from(llmMessages).where(and(eq(llmMessages.companyId, context.company.id), eq(llmMessages.role, "user"))),
    db.select({
      provider: llmRuns.provider,
      model: llmRuns.model,
      runs: count(),
      inputTokens: sql<string>`coalesce(sum(nullif(${llmRuns.inputTokens}, '')::numeric), 0)`,
      outputTokens: sql<string>`coalesce(sum(nullif(${llmRuns.outputTokens}, '')::numeric), 0)`,
      totalTokens: sql<string>`coalesce(sum(nullif(${llmRuns.totalTokens}, '')::numeric), 0)`,
      cost: costSum,
      averageLatency,
    }).from(llmRuns).where(eq(llmRuns.companyId, context.company.id)).groupBy(llmRuns.provider, llmRuns.model).orderBy(desc(count())),
    db.select({ id: llmRuns.id, provider: llmRuns.provider, model: llmRuns.model, operation: llmRuns.operation, totalTokens: llmRuns.totalTokens, cost: llmRuns.cost, latencyMs: llmRuns.latencyMs, status: llmRuns.status, createdAt: llmRuns.createdAt }).from(llmRuns).where(eq(llmRuns.companyId, context.company.id)).orderBy(desc(llmRuns.createdAt)).limit(50),
    db.select({ id: llmMessages.id, runId: llmMessages.runId, role: llmMessages.role, content: llmMessages.content, createdAt: llmMessages.createdAt }).from(llmMessages).where(eq(llmMessages.companyId, context.company.id)).orderBy(desc(llmMessages.createdAt)).limit(2_000),
  ]);

  const totals = totalsRows[0] ?? { runs: 0, inputTokens: "0", outputTokens: "0", totalTokens: "0", cost: "0", pricedRuns: 0 };
  const answersByRun = new Map(recentMessages.filter((message) => message.role === "assistant" && message.runId).map((message) => [message.runId!, message.content]));
  const conversations = recentMessages
    .filter((message) => message.role === "user")
    .map((message) => ({ id: message.id, question: message.content, answer: readableAnswer(message.runId ? answersByRun.get(message.runId) ?? "" : ""), createdAt: message.createdAt.toISOString() }))
    .slice(0, 1_000);
  const unpricedRuns = totals.runs - number(totals.pricedRuns);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-14 items-center justify-end px-7">
        <AccountMenu company={{ id: context.company.id, name: context.company.name, baseCurrency: context.company.baseCurrency }} companies={companies.map(({ id, name, baseCurrency, role }) => ({ id, name, baseCurrency, role }))} role={context.company.role} staleSelection={context.selection.staleSelection} user={{ email: context.user.email, name: context.user.name, hasAvatar: context.user.hasAvatar }} loginEnabled={authMode === "better-auth"} />
      </header>

      <main className="mx-auto grid w-full max-w-[960px] flex-1 content-start gap-10 px-7 pt-6 pb-24">
        <div className="grid gap-3">
          <Link href="/" className="inline-flex w-fit items-center gap-1.5 rounded-md text-[13px] text-ink-2 outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
            <ArrowLeft className="size-3.5" aria-hidden="true" /> Back to Balsa
          </Link>
          <h1 className="display text-[40px] leading-[1.1]" style={serif(40)}>Usage</h1>
          <p className="max-w-[62ch] text-[16px] leading-[1.55] text-ink-2">Conversation and model activity for {context.company.name}. Costs are the amounts reported by the model provider.</p>
        </div>

        <section className="grid grid-cols-2 gap-x-6 gap-y-5 border-y border-rule py-5 sm:grid-cols-4">
          <Metric label="Chat turns" value={number(conversationRows[0]?.count).toLocaleString()} />
          <Metric label="Model runs" value={number(totals.runs).toLocaleString()} />
          <Metric label="Total tokens" value={tokens(totals.totalTokens)} note={`${tokens(totals.inputTokens)} in · ${tokens(totals.outputTokens)} out`} />
          <Metric label="Reported cost" value={money(totals.cost)} note={unpricedRuns ? `${unpricedRuns} run${unpricedRuns === 1 ? "" : "s"} without reported cost` : "All runs priced"} />
        </section>

        <section className="grid gap-3.5">
          <h2 className="display text-[24px] leading-[1.2]" style={serif(24)}>By model</h2>
          {modelRows.length ? (
            <div className="overflow-x-auto border-y border-rule">
              <table className="w-full min-w-[700px] border-collapse text-left text-[13px]">
                <thead className="text-ink-2">
                  <tr><th className="py-2.5 pr-4 font-normal">Model</th><th className="px-4 py-2.5 font-normal">Provider</th><th className="px-4 py-2.5 text-right font-normal">Runs</th><th className="px-4 py-2.5 text-right font-normal">Input</th><th className="px-4 py-2.5 text-right font-normal">Output</th><th className="px-4 py-2.5 text-right font-normal">Avg. time</th><th className="py-2.5 pl-4 text-right font-normal">Cost</th></tr>
                </thead>
                <tbody>
                  {modelRows.map((row) => (
                    <tr className="border-t border-rule" key={`${row.provider}-${row.model}`}>
                      <td className="py-3 pr-4 font-medium text-ink">{row.model}</td><td className="px-4 py-3 capitalize text-ink-2">{row.provider}</td><td className="px-4 py-3 text-right">{number(row.runs).toLocaleString()}</td><td className="px-4 py-3 text-right">{tokens(row.inputTokens)}</td><td className="px-4 py-3 text-right">{tokens(row.outputTokens)}</td><td className="px-4 py-3 text-right">{duration(row.averageLatency)}</td><td className="py-3 pl-4 text-right">{money(row.cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty>No model calls have been recorded yet.</Empty>}
        </section>

        <section className="grid gap-3.5">
          <div className="flex items-baseline justify-between gap-4"><h2 className="display text-[24px] leading-[1.2]" style={serif(24)}>Recent activity</h2><span className="text-[13px] text-ink-2">Last {recentRuns.length} runs</span></div>
          {recentRuns.length ? (
            <div className="border-t border-rule">
              {recentRuns.map((run) => (
                <div className="grid grid-cols-[1fr_auto] gap-4 border-b border-rule py-3" key={run.id}>
                  <div className="min-w-0"><div className="truncate">{operationLabel(run.operation)} · {run.model}</div><div className="mt-0.5 text-[12px] capitalize text-ink-2">{run.provider} · {run.status} · {dateFormatter.format(run.createdAt)}</div></div>
                  <div className="text-right text-[13px]"><div>{tokens(run.totalTokens)} tokens</div><div className="mt-0.5 text-[12px] text-ink-2">{duration(run.latencyMs)} · {run.cost === null ? "Cost unavailable" : money(run.cost)}</div></div>
                </div>
              ))}
            </div>
          ) : <Empty>No model activity has been recorded yet.</Empty>}
        </section>

        <section><UsageHistory conversations={conversations} /></section>

        <p className="text-[13px] text-ink-2">Need the underlying records? <a href="/api/llm-data" className="inline-flex items-center gap-1 text-ink underline underline-offset-[3px]">Open the raw JSON export <ExternalLink className="size-3" aria-hidden="true" /></a>.</p>
      </main>
    </div>
  );
}

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div><span className="block text-[13px] text-ink-2">{label}</span><strong className="figure mt-1 block text-[26px] leading-[1.15]">{value}</strong>{note && <span className="mt-1 block text-[12px] text-pencil">{note}</span>}</div>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="border-t border-rule pt-4 text-ink-2">{children}</p>;
}

function readableAnswer(raw: string) {
  try {
    const parsed = JSON.parse(raw) as { answer?: string; forecastExplanation?: string; questions?: string[] };
    return [parsed.answer, parsed.forecastExplanation, ...(parsed.questions ?? [])].filter(Boolean).join(" ").trim();
  } catch {
    return raw;
  }
}
