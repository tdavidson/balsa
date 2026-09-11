# Single-player onboarding and evidence revamp

## Objective

Make the first upload produce a trustworthy starting point for the company. The
system should learn from documents in stages, preserve the source of every
number, validate the results across sources, and ask the CFO only for grouped,
material decisions. This work is valuable for one operator and is intentionally
separate from future multi-user or hosted work.

## Direction

The intake pipeline is:

```text
upload → identify → parse → extract evidence → validate → cross-check
→ group questions → approve accounting treatment → post financial state
```

Identification, evidence, and accounting treatment are separate approvals. No
unvalidated interpretation should affect the ledger, statements, or forecast.

### Product principle: a financial brain, then company learning

Hemrock should already understand the durable mechanics of finance: the
difference between cash and accrual accounting, revenue recognition versus
billing and collection, balance-sheet roll-forwards, internal transfers,
investment and financing activity, materiality, and evidence-based
reconciliation. The CFO should not need to teach those concepts or discover a
prompt for each one.

Onboarding then teaches the specific business: its entities and account
ownership, contracts and fee terms, chart-of-accounts mapping, allocation and
recognition policies, recurring counterparties, cash timing, forecast drivers,
and materiality thresholds. The system must retain that learning with source,
scope, effective date, confidence, and approval status—and reapply it when new
evidence arrives. A generic model is an interpreter inside this process, not
the accounting system of record.

### Guided onboarding protocol

Before asking the CFO to resolve transaction-level ambiguities, establish the
minimum company profile: reporting entities and account ownership; base
currency, fiscal calendar, and reporting basis; revenue streams and contract
timing; billing, collection, and pass-through behavior; material vendors,
financing, investments, and intercompany flows; chart-of-accounts mapping;
materiality; and forecast drivers. This profile is a set of evidence-backed,
editable company files—not a replacement for the built-in accounting brain.

The platform-managed core is read-only. Company-specific facts are proposed
from sources, confirmed or corrected by the CFO, stored with provenance, and
promoted to policies only with their scope, effective date, confidence, and
approval history. New evidence reruns the relevant checks and shows which
company knowledge it changed.

### Processing experience

Every upload, reprocess, and automatic reconciliation should appear as a
visible run rather than a silent request. The run has two coordinated views:

- An activity timeline: classify files, extract facts, validate balances,
  match transactions, group questions, and prepare the review.
- A live results panel: documents loaded, facts extracted, periods covered,
  matches found, exceptions, CFO questions, and forecast impact.

Each activity reports queued, running, complete, or blocked, with counts and
links back to the evidence that supports the result. Completion should hand the
CFO a concise review summary with actions such as review questions, reprocess a
changed source, or run the review again. This is an observability and trust
feature for the single-player workflow, not a multi-user collaboration layer.

## Eight workstreams

### 1. Identify each uploaded document

Classify bank statements, brokerage statements, QuickBooks exports, P&Ls,
balance sheets, general ledgers, contracts, and unknown files. Detect entity,
account, period, currency, and whether the document contains transactions,
balances, summaries, or agreements.

### 2. Use source-specific parsers

Parse CSV/XLSX/OFX/QBO transactions deterministically. Parse PDFs page by
page, preserve tables and page references, and use OCR when text extraction is
weak. Use structured account/value extraction for P&Ls and balance sheets.
Use the model for interpretation and ambiguity, not basic transcription.

### 3. Preserve provenance for every value

Every fact and transaction carries its source document, page/sheet, row or
location, original text, parsed value, source type, accounting role, and
validation status.

### 4. Validate before approval

Check opening balance + classified activity = ending balance. Detect missing or
conflicting balances, duplicate transactions, period gaps, account/currency
mismatches, and summaries accidentally entering the transaction ledger.

### 5. Separate approval layers

The CFO can approve the document identity, extracted facts, and accounting
treatment independently. Only approved accounting treatment may create ledger
events, recognized revenue, expenses, or forecast inputs.

### 6. Cross-check before asking questions

Compare statements with transaction exports, QuickBooks balances, prior-month
roll-forwards, transfer counterparts, P&L revenue, and entity ownership before
creating questions. Consolidate duplicative or closely related questions into
one material CFO decision.

### 7. Show an initial review report

Surface loaded documents, discovered accounts, period coverage, balances,
transaction counts, duplicates, unmatched items, cross-source matches,
exceptions, proposed rules, and grouped questions before financial state is
changed.

### 8. Learn company-specific rules safely

Apply universal accounting rules first. Add company-specific rules only from
approved evidence and CFO decisions. Keep the rule's source, scope, effective
date, and confidence visible, and rerun validation whenever new information is
added.

## Build sequence

1. [x] Add source classification and a canonical intake result.
2. [x] Add deterministic spreadsheet/OFX transaction ingestion with provenance.
3. [x] Add page-aware PDF extraction and extraction quality checks. Facts and
   transaction rows now retain a source location and explicitly detected
   currency; known non-base-currency activity is excluded pending conversion.
   Weak PDFs use an optional page-aware `ocrmypdf` fallback when configured and
   otherwise surface an explicit blocked OCR status.
4. [x] Add typed facts and balance/transaction validation.
5. [x] Add cross-source matching and grouped review generation. Exact duplicate
   and transfer counterpart matching, balance conflicts/coverage gaps, material
   P&L-versus-cash comparisons, and conflicting account mappings are now
   grouped. A derived reconciliation ledger now records every event as matched,
   unmatched, staged, excluded, or currency-pending. Bank-to-QuickBooks/GL
   matching uses amount, direction, timing, memo similarity, and shared bank,
   check, invoice, ACH, wire, or confirmation references. Account-level checks
   now compare summed bank-statement ending cash with QuickBooks balance-sheet
   or GL cash balances and group only material differences for CFO review.
6. [x] Split document, fact, and accounting-treatment approval in the UI.
   Structured transaction imports are staged and cannot affect financial state
   until all three approvals are complete. The UI supports individual or
   controlled batch approval of facts and proposed treatments after document
   identity is confirmed. Every approval/rejection records the CFO, timestamp,
   layer, prior value, and new value; individual treatments can be corrected
   before approval.
7. [x] Add the initial review report to Documents and the reconciliation view.
8. [x] Add universal rules plus company-specific learned rules and automatic
   re-review on every new or changed source. The platform core is separate from
   editable company knowledge; onboarding answers are stored with their review
   provenance; and explicit match-and-classify policies reclassify both
   historical and newly ingested cash events before refresh. Policy authoring
   previews the exact affected transactions before activation, records scope,
   effective date, confidence, and decision provenance, and queues a new
   reconciliation run for affected evidence.
9. [x] Turn ingestion and reconciliation into visible runs with staged activity,
    live results, exception handoff, and rerun/reprocess actions. The Documents
   review report now includes a recorded “Run review again” action, a fixed
   per-document timeline (identify, extract, validate, cross-check, review),
   and live facts, questions, period, and account results. Uploads enqueue
   durable extraction runs; a protected Vercel cron route drains both extraction
   and reconciliation through the same idempotent handlers. Successful upload,
   reprocessing, final approval, and policy changes enqueue reconciliation
   automatically. A dedicated long-lived worker remains an optional scale-up,
   not unfinished single-player core work.

### Integrity pass

The initial implementation exposed a few state-boundary shortcuts during
real-company testing. The follow-up integrity pass now makes document identity
separate from publication, invalidates derived state before an edited source can
be reconsidered, routes posting by source type, prevents undated facts from
silently entering the current month, keeps reconciliation reads side-effect
free, atomically claims worker runs, and applies policy scope/effective dates
at classification time. Financial projections retain repeated same-source
activity while selecting a visible canonical event only for explicit
cross-source matches.

All single-player core build steps in this pass are complete. Remaining work is
product hardening, real-company acceptance testing, and optional scale-up—not a
missing stage in the onboarding pipeline.

## Acceptance criteria

- A new company can upload statements and transaction detail and see what was
  found before anything changes the forecast.
- Every number in reconciliation can be traced back to a document location.
- Statement balances and detailed activity are checked automatically.
- Transfers, summaries, and investment movements cannot become revenue by
  default.
- The CFO sees grouped, non-duplicative questions with the evidence that caused
  each question.
- Adding or correcting a source automatically reruns affected validation and
  review without requiring a manual reset.

## First slice

The first implementation slice adds source classification at intake and stores
it in the existing source metadata. It does not change accounting state. This
gives the later parsers and review UI a stable source type to branch on while
remaining safe for the current single-player workflow.
