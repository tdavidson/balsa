import { auth, authMode } from "@/lib/auth";
import Link from "next/link";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { AccountMenu } from "@/components/account-menu";
import { requireCompanyAccess } from "@/lib/auth";

export const dynamic = "force-dynamic";

const serif = (size: number) => ({ fontVariationSettings: `"opsz" ${size}` });

const sections = [
  "The idea",
  "The operating loop",
  "Three layers of state",
  "Knowledge in plain language",
  "Provenance",
  "Getting started",
  "Building the language for your company",
  "What it should be able to tell you",
  "About Taylor",
];

const slug = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid scroll-mt-6 gap-4 pt-4" id={slug(title)}>
      <h2 className="display text-[26px] leading-[1.2]" style={serif(26)}>{title}</h2>
      <div className="grid max-w-[62ch] gap-4 text-[16px] leading-[1.6] text-ink">{children}</div>
    </section>
  );
}

function Command({ children }: { children: React.ReactNode }) {
  return <code className="rounded-md bg-rule px-1.5 py-0.5 font-sans text-[14px] text-ink">{children}</code>;
}

export default async function AboutPage() {
  await auth.protect({ unauthenticatedUrl: "/login" });
  const context = await requireCompanyAccess();
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-14 items-center justify-end px-7">
        <AccountMenu company={context.company.name} baseCurrency={context.company.baseCurrency} user={{ email: context.user.email, name: context.user.name, hasAvatar: context.user.hasAvatar }} loginEnabled={authMode === "better-auth"} />
      </header>

      <main className="mx-auto grid w-full max-w-[776px] flex-1 content-start gap-10 px-7 pt-6 pb-24">
        <div className="grid gap-4">
          <Link href="/" className="inline-flex w-fit items-center gap-1.5 rounded-md text-[13px] text-ink-2 outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
            <ArrowLeft className="size-3.5" aria-hidden="true" /> Back to Nevermodel
          </Link>
          <h1 className="display text-[40px] leading-[1.1]" style={serif(40)}>How Nevermodel works</h1>
          <p className="max-w-[60ch] text-[18px] leading-[1.5] text-ink-2">
            A financial system you talk to, that never does the math by talking. Evidence comes in, gets read into facts, and the facts feed a calculator that does not guess.
          </p>
        </div>

        <details className="group grid gap-3" open>
          <summary className="inline-flex w-fit list-none items-center gap-1.5 rounded-md text-[13px] text-ink-2 outline-none select-none hover:text-ink focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background [&::-webkit-details-marker]:hidden">
            <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" aria-hidden="true" />
            On this page
          </summary>
          <ol className="grid gap-1.5 pl-5 text-[14px]">
            {sections.map((title) => (
              <li key={title}>
                <a href={`#${slug(title)}`} className="rounded-sm text-ink-2 outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">{title}</a>
              </li>
            ))}
          </ol>
        </details>

        <Section title="The idea">
          <p>
            A CFO already holds everything a financial model needs: the evidence, the context, the policies, the assumptions, and the judgment. The only thing missing is the labour of keying it all into a spreadsheet and keeping that spreadsheet alive. Nevermodel takes the same inputs a CFO uses and maintains the model itself.
          </p>
          <p>
            Two rules make that possible. Language models handle meaning: interpretation, classification, matching, ambiguity, and explanation. Deterministic code handles math: schedules, balances, recognition, cash roll-forwards, allocations, and statements. The model is never the calculator and never the database.
          </p>
          <p>
            It is not Excel in a browser. There is no grid, and nobody maintains formulas. It is not QuickBooks either. Economic reality is stored first and accounting is derived from it. And when interpretation needs judgment, the system does not guess and does not hide the wrinkle in a settings page. It asks you one precise question, and your answer becomes durable state.
          </p>
        </Section>

        <Section title="The operating loop">
          <p>
            Evidence arrives. Observations are extracted from it. The model interprets them against what it already knows about the company: its knowledge documents, its policies, its prior decisions. If the treatment can be resolved, the result becomes Company State. If not, it becomes a question for you, and your answer becomes a decision or a policy, which then becomes Company State. The deterministic engine turns Company State into financial state: schedules, statements, and a forecast.
          </p>
          <p>
            The same loop runs whether the evidence is a bank CSV, an invoice PDF, a management-fee agreement, a QuickBooks export, or a sentence you type into the composer. You never pick a workflow first.
          </p>
        </Section>

        <Section title="Three layers of state">
          <p>
            <strong className="font-medium">Evidence</strong> is what external sources told us: bank transactions, invoices, contracts, payroll files, your own messages. Each is kept as a source with its hash and metadata, and the observations extracted from it stay linked back.
          </p>
          <p>
            <strong className="font-medium">Economic state</strong> is what the system believes actually exists or happened: entities such as the management company, each fund, an employee, a vendor; agreements such as a management agreement or a retainer; facts, events, and obligations; and the decisions, policies, assumptions, and scenarios that shape them. This is the canonical, structured Company State.
          </p>
          <p>
            <strong className="font-medium">Financial state</strong> is what follows mathematically: revenue and expense schedules, cash schedules, receivables, payables, prepaids, intercompany balances, the P&amp;L, and the cash forecast. This layer is deterministic and every value carries a trace.
          </p>
          <p>
            On screen the layers read as ink and pencil. Actuals and anything you have approved are set in ink. Forecasts and unconfirmed facts are pencil. The one thing waiting on you carries a highlighter mark.
          </p>
        </Section>

        <Section title="Knowledge in plain language">
          <p>
            Executable state lives in structured records: a $75,000 obligation due October 1, a $482,314 cash balance. Human financial knowledge lives in Markdown: how the company operates, standing policies, allocation philosophy, forecasting assumptions, the unusual arrangements. The system keeps a small set of these documents for each company, conceptually a company, policies, allocations, accounting, forecast, and open-questions file, and it can draft them from conversation and from what you upload.
          </p>
          <p>
            Markdown expresses context and intent. Structured state executes it. The model reconciles between the two, and neither pretends to be the other.
          </p>
          <p>
            Nevermodel also provides knowledge templates for common business models such as SaaS, professional services, e-commerce, and venture funds with management companies. A template is a proxy for industry experience: it supplies useful questions, terminology, and starting policies, but it never becomes a confirmed company fact. Apply one from the Knowledge page, review the Markdown, and edit it in the company&apos;s own language before relying on it.
          </p>
        </Section>

        <Section title="Provenance">
          <p>
            Every important piece of state records where it came from: supplied by the CFO, extracted from a document, observed at the bank, imported from QuickBooks, inferred by the model, confirmed by the CFO, or calculated by the system. An inference never silently becomes a confirmed fact. When you ask why a number is what it is, the answer walks the chain from the statement line to the schedule, to the obligation, to the decision that allocated it, to the original file.
          </p>
          <p>
            One distinction the system holds carefully: who paid is not the same as who bears the cost. The management company may pay a $10,000 legal bill while the funds economically bear most of it. The result is an expense for the company, amounts due from each fund, and a single cash movement, with the allocation traceable to the policy or decision that produced it.
          </p>
        </Section>

        <Section title="Getting started">
          <p>Start with the smallest true thing and let the picture build from there.</p>
          <ol className="grid list-decimal gap-3 pl-6">
            <li>Tell it where cash stands. Type <Command>opening cash 2026-09 $25,000</Command>, using your own month and balance.</li>
            <li>Tell it, or show it, the company. A sentence like <Command>Fund II pays us $60k quarterly starting in October</Command> works, and so does a management-fee agreement, a contract, an invoice, or a QuickBooks export. Files are read independently, even when they cover different months.</li>
            <li>Review what it extracted under Waiting on you. Approve facts that are right, edit the ones that are close, reject the rest. Approved facts become obligations, agreements, and forecast events.</li>
            <li>Attach a transaction file (CSV, XLSX, QBO, or OFX). Rows are dated and normalised into actuals. Re-uploading the same file is ignored, and observations of the same payment from a bank, an invoice, and QuickBooks resolve to one economic chain.</li>
            <li>Pick a month to compare forecast with actuals. Close it with <Command>close month 2026-09</Command>. Closed months reject later changes; reopen with <Command>open month 2026-09</Command> if something needs correcting.</li>
            <li>Ask questions in plain language: <Command>How much cash will we have in December?</Command> The answer is drawn only from your approved state, and any suggested decision shows up under Waiting on you for you to apply or reject.</li>
          </ol>
        </Section>

        <Section title="Building the language for your company">
          <p>
            Anything that feels like configuring finance software should be a sentence instead. Not an allocation settings screen but <Command>Allocate Carta 60% Fund II, 30% Fund III, 10% management company going forward</Command>. Not editing forecast cells but <Command>Assume we hire a finance contractor in January at $6k a month</Command>. Not configuring recurring revenue but <Command>Fund III pays us $50k quarterly through the end of 2028</Command>. The agent turns intent into Company State.
          </p>
          <p>
            <strong className="font-medium">Decisions</strong> answer one question once. When the system asks how to treat something, select the question under Waiting on you and answer it naturally in chat. The answer is remembered and applied to similar evidence later.
          </p>
          <p>
            <strong className="font-medium">Policies</strong> are standing judgment. <Command>policy: Contractor timing =&gt; Recognise on payment date</Command> tells it how to read a whole class of evidence, and the policy is cited whenever it is used. Decisions that keep recurring are candidates for policies.
          </p>
          <p>
            <strong className="font-medium">Names</strong> matter. Use the same name for a fund, customer, or vendor each time, and the system resolves future references to the same entity.
          </p>
          <p>
            <strong className="font-medium">Knowledge documents</strong> hold the rest: how the company operates, its accounting preferences, its forecast philosophy. Ask it to draft them from what you have uploaded, then correct them in your own words.
          </p>
          <p>
            <strong className="font-medium">An example model</strong> teaches style. Hand it a spreadsheet you already use and it learns the structure and formatting: the line items, the ordering, the units and sign conventions. Future outputs follow that shape. The example changes how results are presented, never how they are calculated.
          </p>
          <p>
            Work in small steps and correct it early. A handful of decisions and policies in the first month do more for accuracy than any amount of setup.
          </p>
        </Section>

        <Section title="What it should be able to tell you">
          <ul className="grid list-disc gap-1.5 pl-6 text-ink-2">
            <li>How much management-fee revenue did we earn this month, and how much cash did we receive?</li>
            <li>What receipts do we expect next quarter?</li>
            <li>What expenses did we incur, what did we actually pay, and what remains unpaid?</li>
            <li>Which expenses were allocated to funds, and how much do the funds owe us?</li>
            <li>Why is professional-services expense this amount?</li>
            <li>Which parts of next year’s forecast are contractual, and which are assumptions?</li>
            <li>What questions still need my input?</li>
            <li>What happens if Fund II stops paying management fees next year?</li>
          </ul>
          <p>
            The hypothesis behind all of it: a CFO should be able to give an intelligent system the same evidence, context, policies, assumptions, and judgment they use themselves, and have it continuously maintain an auditable financial model without building or maintaining that model in Excel.
          </p>
        </Section>

        <Section title="About Taylor">
          <p>
            Nevermodel is built by Taylor Davidson. Taylor helps founders and investors create and use financial models through Nevermodel, formerly Foresight, whose template models have been used by more than fifty thousand people worldwide since 1998. He serves as fractional Chief Financial Officer for Synthetic Example Company Capital Group, an early-stage venture firm, running fund administration, capital planning, investor reporting, and management-company finance.
          </p>
          <p>
            That work is where Nevermodel comes from: years of watching the same evidence get re-keyed into models by hand, and the conviction that a company’s financial operations should be learned from what it already produces rather than configured up front. He teaches financial modeling, venture fund forecasting, and cap tables and exit waterfalls, and lives in Pittsburgh.
          </p>
          <p className="text-ink-2">
            More at <a className="text-ink underline underline-offset-[3px]" href="https://taylordavidson.com" target="_blank" rel="noreferrer">taylordavidson.com</a>.
          </p>
        </Section>
      </main>
    </div>
  );
}
