import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

const serif = (size: number) => ({ fontVariationSettings: `"opsz" ${size}` });

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-4 border-t border-rule pt-8">
      <h2 className="display text-[26px] leading-[1.2]" style={serif(26)}>{title}</h2>
      <div className="prose-serif grid max-w-[62ch] gap-4 text-[17px] leading-[1.55] text-ink" style={serif(17)}>{children}</div>
    </section>
  );
}

function Command({ children }: { children: React.ReactNode }) {
  return <code className="rounded-md bg-rule px-1.5 py-0.5 font-sans text-[14px] text-ink">{children}</code>;
}

export default async function AboutPage() {
  await auth.protect({ unauthenticatedUrl: "/login" });
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-14 items-center justify-end px-7">
        <Link href="/" className="inline-flex items-center gap-1.5 rounded-md text-[13px] text-ink-2 outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
          <ArrowLeft className="size-3.5" aria-hidden="true" /> Back to nevermodel
        </Link>
      </header>

      <main className="mx-auto grid w-full max-w-[776px] flex-1 content-start gap-10 px-7 pt-6 pb-24">
        <div className="grid gap-4">
          <h1 className="display text-[40px] leading-[1.1]" style={serif(40)}>How nevermodel works</h1>
          <p className="prose-serif max-w-[60ch] text-[19px] leading-[1.5] text-ink-2" style={serif(19)}>
            A financial system you talk to, that never does the math by talking. Evidence comes in, gets read into facts, and the facts feed a calculator that does not guess.
          </p>
        </div>

        <Section title="The idea">
          <p>
            Most finance tools ask you to fit your company into their structure first: a chart of accounts, a template, a setup wizard. nevermodel starts from the other end. You hand it what you already have, in whatever shape it comes: a bank statement, an invoice, a fund agreement, a sentence typed into the composer. It works out what that evidence means for your company and asks you only when it cannot tell.
          </p>
          <p>
            The interface is a conversation because a conversation is the cheapest interface to reach from anywhere: a phone, a text message, a chat assistant, another app. Everything the system knows can be expressed as text, and everything it produces can be read as text.
          </p>
          <p>
            But the numbers never come from the conversation. A language model reads and interprets. A deterministic engine calculates. Authorization lives in application code that the model cannot touch. That separation is what makes the result auditable.
          </p>
        </Section>

        <Section title="Three layers">
          <p>
            <strong className="font-medium">Evidence.</strong> The raw material: files and statements you attach, notes you type. Every piece is stored with its source, a hash, and a link to the facts drawn from it, so any number can be traced back to where it came from.
          </p>
          <p>
            <strong className="font-medium">Interpreted state.</strong> What the evidence means: an agreement to receive a fee quarterly, an obligation to pay a contractor monthly, an opening cash balance. Each fact carries a confidence, and each open question waits for you. Nothing counts until you approve it.
          </p>
          <p>
            <strong className="font-medium">Calculation.</strong> Approved facts become cash events, and cash events roll forward into a monthly forecast, actuals, variance, and a P&amp;L. This layer is plain arithmetic with a trace on every value. The model can query it and explain it, but cannot change it.
          </p>
          <p>
            On screen, the layers read as ink and pencil. Actuals and anything you have approved are set in ink. Forecasts and unconfirmed facts are pencil. The one thing waiting on you carries a highlighter mark.
          </p>
        </Section>

        <Section title="Getting started">
          <p>Start with the smallest true thing and let the picture build from there.</p>
          <ol className="grid list-decimal gap-3 pl-6">
            <li>Tell it where cash stands. Type <Command>opening cash 2026-09 $25,000</Command>, using your own month and balance.</li>
            <li>Attach one piece of evidence: a bank statement, an invoice, a customer or fund agreement, or a note like <Command>Fund II pays us $60k quarterly starting in October</Command>. Files are read independently, even when they cover different months.</li>
            <li>Review what it extracted under Waiting on you. Approve facts that are right, edit the ones that are close, reject the rest. Approved facts become forecast events.</li>
            <li>Attach a transaction file (CSV, XLSX, QBO, or OFX). Rows are dated and normalised into actuals, and re-uploads of the same file are ignored.</li>
            <li>Pick a month to compare forecast with actuals. Close it with <Command>close month 2026-09</Command>. Closed months reject later changes; reopen with <Command>open month 2026-09</Command> if something needs correcting.</li>
            <li>Ask questions in plain language: <Command>How much cash will we have in December?</Command> The answer is drawn only from your approved state, and any suggested decision shows up under Waiting on you for you to apply or reject.</li>
          </ol>
        </Section>

        <Section title="Building the language for your company">
          <p>
            Every company has its own vocabulary and its own judgment calls. nevermodel keeps both as first-class records, so the next document is read the way you would read it.
          </p>
          <p>
            <strong className="font-medium">Decisions</strong> answer one question once. When the system asks how to treat something, reply with <Command>decision: How should contractor invoices be treated? =&gt; Cash basis</Command>. The answer is remembered and applied to similar evidence later.
          </p>
          <p>
            <strong className="font-medium">Policies</strong> are standing rules. <Command>policy: Contractor timing =&gt; Recognise on payment date</Command> tells it how to read a whole class of evidence, and the policy is cited whenever it is used.
          </p>
          <p>
            <strong className="font-medium">Names</strong> matter. Use the same name for a fund, customer, or vendor each time you mention it, and it will resolve future references to the same entity.
          </p>
          <p>
            <strong className="font-medium">An example model</strong> teaches style. Hand it a spreadsheet you already use and it learns the structure and formatting: the line items, the ordering, the units and sign conventions. Future outputs follow that shape. The example changes how results are presented, never how they are calculated.
          </p>
          <p>
            Work in small steps and correct it early. A handful of decisions and policies in the first month do more for accuracy than any amount of setup.
          </p>
        </Section>

        <Section title="About Taylor">
          <p>
            nevermodel is built by Taylor Davidson. Taylor helps founders and investors create and use financial models through Hemrock, formerly Foresight, whose template models have been used by more than fifty thousand people worldwide since 1998. He serves as fractional Chief Financial Officer for Synthetic Example Company Capital Group, an early-stage venture firm, running fund administration, capital planning, investor reporting, and management-company finance.
          </p>
          <p>
            That work is where nevermodel comes from: years of watching the same evidence get re-keyed into models by hand, and the conviction that a company’s financial operations should be learned from what it already produces rather than configured up front. He teaches financial modeling, venture fund forecasting, and cap tables and exit waterfalls, and lives in Pittsburgh.
          </p>
          <p className="text-ink-2">
            More at <a className="text-ink underline underline-offset-[3px]" href="https://www.hemrock.com" target="_blank" rel="noreferrer">hemrock.com</a> and <a className="text-ink underline underline-offset-[3px]" href="https://taylordavidson.com" target="_blank" rel="noreferrer">taylordavidson.com</a>.
          </p>
        </Section>
      </main>
    </div>
  );
}
