# LLM-Native Finance System — V0 Build Specification

## 1. Objective

Build an LLM-native financial operating system that can maintain the historical, current, and forecast financial state of a company without requiring the CFO to maintain a traditional Excel financial model.

The system should:

1. Accept financial information in whatever form the CFO already has.
2. Use an LLM to interpret economic meaning and context.
3. Ask the CFO precise questions when interpretation requires judgment.
4. Remember those answers as decisions or reusable policies.
5. Maintain structured, executable Company State.
6. Maintain human-readable Markdown knowledge about the company.
7. Use deterministic code for financial calculations.
8. Produce auditable historical financials and forecasts.
9. Explain where every material number came from.

The fundamental operating loop is:

```text
Evidence
   ↓
Observations
   ↓
LLM interpretation
   ↓
Existing company knowledge + policies
   ↓
Can treatment be resolved?
   ├── Yes → Company State
   │
   └── No → CFO Question
                 ↓
          Decision / Policy
                 ↓
            Company State
                 ↓
       Deterministic Engine
                 ↓
     Financial State / Forecast
```

The V0 should prove this architecture using one real management company.

---

# 2. Product Philosophy

## 2.1 LLMs handle meaning; code handles math

The LLM handles:

- interpretation;
- context;
- classification;
- matching;
- ambiguity;
- document understanding;
- economic reasoning;
- policy application;
- CFO questions;
- explanations.

Deterministic code handles:

- arithmetic;
- schedules;
- balances;
- recognition;
- cash roll-forwards;
- allocations after treatment is determined;
- reconciliation;
- accounting derivation;
- financial statements;
- scenarios.

The LLM must not be the calculator or database.

---

## 2.2 Prefer Markdown for human financial knowledge

Prefer structured records for executable financial state.

Use the LLM to translate between them.

Examples of human financial knowledge:

- how the company operates;
- CFO policies;
- accounting preferences;
- allocation philosophy;
- forecasting methodology;
- unusual arrangements;
- scenario descriptions;
- contextual notes.

These are often better represented as text than as dozens of database fields.

Examples of executable state:

- $75,000 obligation due October 1;
- $12,500 invoice;
- $6,250 allocation;
- $482,314 cash balance;
- employee salary effective January 1;
- payment received September 3.

These require structured records.

---

## 2.3 Do not recreate Excel in a browser

There should be no primary grid/model-building interface.

Users should not maintain formulas.

Users should tell the system what they know and what they want.

The system maintains the model.

---

## 2.4 Do not recreate QuickBooks either

Accounting is a necessary output, but journal entries should not be the canonical economic model.

Store economic reality first.

Derive accounting treatment from resolved economic state.

---

## 2.5 Ambiguity becomes a CFO question

Financial wrinkles are expected.

Do not attempt to encode every possible wrinkle in rigid software rules.

When interpretation cannot be resolved from evidence, context, and prior policies, ask the CFO.

For example:

> Smith LLP invoiced $12,500 for work performed in August. Should this be borne by the management company, Fund II, or allocated between them?

The answer becomes durable Company State.

---

# 3. Company Zero

The initial real-world implementation is a venture fund management company.

It has:

- several venture funds paying management fees;
- quarterly management-fee receipts;
- one employee;
- several contractors;
- professional-service vendors;
- software expenses;
- insurance and other recurring costs;
- bank and credit-card activity;
- expenses sometimes allocated to funds;
- historical QuickBooks data.

This gives V0 enough complexity to test:

- recurring revenue;
- accrual vs cash timing;
- obligations;
- payroll;
- contractors;
- invoices;
- prepaids;
- allocations;
- intercompany balances;
- bank reconciliation;
- forecasts;
- CFO judgment.

---

# 4. Three Layers of State

The architecture should explicitly separate three kinds of information.

## Layer 1 — Evidence

What external sources told us.

Examples:

```text
Bank transaction
Invoice PDF
QuickBooks transaction
Contract
CFO message
Payroll CSV
```

Represented primarily through:

- Source
- Observation

---

## Layer 2 — Economic State

What the system believes actually exists or happened.

Represented through:

- Entity
- Relationship
- Agreement
- Fact
- Event
- Obligation
- Decision
- Policy
- Assumption
- Scenario

This is the canonical structured Company State.

---

## Layer 3 — Financial State

What follows mathematically from economic state.

Examples:

- revenue schedules;
- expense schedules;
- cash schedules;
- receivables;
- payables;
- prepaid balances;
- intercompany balances;
- P&L;
- cash forecast.

This layer is deterministic.

---

# 5. Markdown Knowledge Layer

Markdown is a first-class part of the architecture.

The system should maintain a small collection of human-readable documents describing the company.

Conceptually:

```text
/company.md
/policies.md
/allocations.md
/accounting.md
/forecast.md
/open-questions.md
```

These may be virtual files stored in Postgres rather than physical files on disk.

---

# 6. Markdown Document Types

## company.md

High-level understanding of the company.

Example:

```md
# Acme Management LLC

Acme Management LLC manages three venture funds.

## Revenue

Management fees are the primary source of revenue.

- Fund I pays $75,000 quarterly.
- Fund II pays $60,000 quarterly.
- Fund III pays $50,000 quarterly.

## Team

The company has one employee and two recurring contractors.
```

---

## policies.md

Standing CFO judgment.

Example:

```md
# Financial Policies

## Professional Services

Legal work relating directly to a fund should generally be allocated to that fund.

Management-company compliance work should remain with the management company.

## Recognition

Professional-services expenses should generally be recognized during the period in which the work was performed.
```

---

## allocations.md

Recurring allocation knowledge.

```md
# Allocations

## Carta

- Fund II: 60%
- Fund III: 30%
- Management Company: 10%

Apply this allocation going forward unless an invoice clearly relates to a specific entity.
```

---

## accounting.md

Company-specific accounting context that helps interpretation.

Do not attempt to reproduce an accounting manual.

---

## forecast.md

Forecasting philosophy and assumptions.

Example:

```md
# Forecast

Management fees should be forecast from contractual agreements whenever possible.

Known employee and contractor commitments should be included automatically.

## Current assumptions

- No additional employees planned.
- Finance contractor increases to $10,000/month in January.
```

---

# 7. Markdown Can Be Generated

The CFO should not need to manually create these files.

The system can generate them through conversation.

For example:

> Tell me about the company, or upload anything useful.

The CFO could upload:

- QuickBooks exports;
- contracts;
- management-fee agreements;
- invoices;
- bank transactions.

The LLM can then propose initial Markdown documents.

The CFO can review or edit them.

---

# 8. Markdown Templates

The open-source project should eventually include starter templates.

For V0, implement only the management-company template.

Conceptually:

```text
/templates
    /management-company
        company.md
        policies.md
        allocations.md
        accounting.md
        forecast.md
```

Future templates might include:

```text
/saas
/services
/holding-company
/fund-manager
```

These are not financial-model templates.

They are **context templates** that help the LLM understand the company.

---

# 9. Markdown vs Structured State

Use three categories.

### Narrative-only

Markdown may be authoritative enough.

Example:

> Legal work relating to fund formation should generally be borne by the applicable fund.

### Structured-only

Database state is authoritative.

Example:

```text
Bank transaction:
$12,482.37
2026-08-31
```

### Structured + Markdown

The structured record drives calculations while Markdown makes the arrangement understandable.

Example:

```text
Fund I management fee:
$75,000 quarterly
```

V0 should NOT attempt perfect bidirectional document synchronization.

Instead:

> Markdown expresses context and intent. Structured state executes it. The LLM reconciles between them.

---

# 10. Core Structured Data Model

Implement the following canonical objects.

### Source

Original evidence.

```ts
Source {
  id
  company_id
  type
  filename?
  mime_type?
  storage_reference?
  hash?
  metadata
  created_at
}
```

---

### Observation

Structured information extracted from evidence.

```ts
Observation {
  id
  company_id
  source_id
  type
  observed_at?
  effective_date?
  amount?
  currency?
  counterparty_text?
  attributes
  extraction_confidence?
  status
}
```

---

### Entity

Persistent economic actor or object.

```ts
Entity {
  id
  company_id
  type
  name
  status
  attributes
}
```

Examples:

- Management Company
- Fund I
- Employee
- Contractor
- Smith LLP
- Bank Account

---

### Relationship

```ts
Relationship {
  id
  company_id
  from_entity_id
  type
  to_entity_id
  valid_from?
  valid_to?
}
```

---

### Agreement

Persistent economic arrangement.

```ts
Agreement {
  id
  company_id
  type
  name
  status
  effective_date
  end_date?
  terms
  source_ids[]
}
```

Examples:

- management agreement;
- employment;
- contractor retainer;
- insurance policy;
- subscription.

---

### Fact

```ts
Fact {
  id
  company_id
  subject_entity_id?
  key
  value
  valid_from?
  valid_to?
  source_ids[]
  decision_id?
  confidence?
}
```

---

### Event

Immutable economic occurrence.

```ts
Event {
  id
  company_id
  type
  occurred_at
  effective_at?
  entity_ids[]
  attributes
  source_ids[]
  decision_id?
}
```

---

### Obligation

```ts
Obligation {
  id
  company_id

  payer_entity_id
  payee_entity_id

  agreement_id?
  source_event_id?

  amount
  currency

  due_date?
  service_period_start?
  service_period_end?

  status
  settled_amount
}
```

---

### Decision

Specific CFO judgment.

```ts
Decision {
  id
  company_id

  subject_type
  subject_id

  question
  answer
  structured_effect

  created_at
  created_by
}
```

---

### Policy

Reusable CFO judgment.

```ts
Policy {
  id
  company_id

  name
  description

  condition
  treatment

  effective_from?
  effective_to?

  created_from_decision_id?
}
```

---

### Assumption

```ts
Assumption {
  id
  company_id
  scenario_id

  subject_entity_id?
  key
  value

  valid_from?
  valid_to?

  rationale?
}
```

---

### Scenario

```ts
Scenario {
  id
  company_id
  name
  parent_scenario_id?
  created_at
}
```

---

### ReviewItem

```ts
ReviewItem {
  id
  company_id

  subject_type
  subject_id

  question
  context
  proposed_treatment?
  confidence?

  status
  decision_id?
}
```

---

### KnowledgeDocument

Stores Markdown.

```ts
KnowledgeDocument {
  id
  company_id

  slug
  title
  document_type

  content_markdown

  template_id?
  generated_by?
  updated_at
}
```

---

# 11. Provenance

Every important piece of state must retain provenance.

The system should distinguish:

```text
CFO supplied
Document extracted
Bank observed
QuickBooks imported
LLM inferred
CFO confirmed
System calculated
```

LLM inference must never silently become CFO-confirmed fact.

---

# 12. Derived Financial Engine

Company State produces deterministic schedules.

```text
Company State
     ↓
Schedules
     ↓
Accounting effects
     ↓
Financial State
```

Initial schedules:

- management-fee revenue;
- management-fee cash;
- employee compensation;
- contractor expense;
- professional services;
- prepaid expenses;
- accounts payable;
- intercompany;
- cash.

---

# 13. Allocation Model

Explicitly distinguish:

```text
Cash payer
```

from:

```text
Economic bearer
```

Example:

Management Company pays:

```text
Smith LLP       $10,000
```

Economic allocation:

```text
Management Co    $2,000
Fund I           $4,000
Fund II          $4,000
```

Result:

```text
Management-company expense   $2,000
Due from Fund I              $4,000
Due from Fund II             $4,000
Cash                         -$10,000
```

Allocation treatment may originate from:

- Decision;
- Policy;
- Agreement;
- explicit CFO instruction;
- Markdown context interpreted by the agent.

---

# 14. Ingestion

The single input surface should accept:

### Text

```text
Fund I pays $75k quarterly.
```

### Commands

```text
Allocate Carta 60% Fund II, 30% Fund III and 10% management company going forward.
```

### Questions

```text
How much cash will we have in December?
```

### Files

- PDF invoices;
- contracts;
- bank CSVs;
- QuickBooks exports;
- spreadsheets;
- text;
- Markdown.

The user should not need to select an ingestion workflow first.

---

# 15. Idempotency and Matching

Re-uploading the same source must not create duplicate economics.

Multiple observations can point to one event.

Example:

```text
Invoice PDF
      ↓
Smith LLP $12,500

QuickBooks
      ↓
Bill #1842

Bank
      ↓
-$12,500 SMITH LLP
```

should resolve to one economic chain.

Matching can use LLM reasoning.

Final links must be persisted deterministically.

---

# 16. Model Provider Architecture

Support both:

- OpenAI
- OpenRouter

Do not embed provider-specific logic throughout the application.

Implement an internal abstraction such as:

```ts
interface ModelProvider {
  generateText(...)
  generateStructured(...)
  executeAgent(...)
}
```

Initial adapters:

```text
OpenAIProvider
OpenRouterProvider
```

Configuration:

```env
MODEL_PROVIDER=openai
MODEL_NAME=...

OPENAI_API_KEY=...
OPENROUTER_API_KEY=...
```

Company State, financial logic, tool schemas, and validation must remain provider-independent.

Adding another model provider later should require an adapter rather than rewriting the application.

---

# 17. Agent Tools

The agent must interact with financial state through controlled application tools.

Do not give the model arbitrary database writes.

Initial tools should include:

```text
search_company_state
read_knowledge_document
update_knowledge_document

create_entity
create_agreement
create_fact
create_event
create_obligation

create_review_item
create_decision
create_policy

create_assumption
create_scenario

match_observations
settle_obligation

get_financials
get_cash_forecast
get_obligations

trace_value
```

All tool inputs should be validated.

---

# 18. One-Page UX

V0 has one primary application page.

No conventional application navigation is required.

Conceptually:

```text
┌─────────────────────────────────────────────┐
│ ACME MANAGEMENT                            │
│                                             │
│ Ask, tell me something, or drop files here │
│ [_______________________________________]   │
│                                             │
├─────────────────────────────────────────────┤
│ NEEDS YOUR INPUT                         2  │
│                                             │
│ Smith LLP — $12,500                        │
│ Who should bear this expense?              │
│ [Mgmt Co] [Fund I] [Fund II] [Split]       │
│                                             │
├─────────────────────────────────────────────┤
│ Cash                           $482,314      │
│ Next 90d expected receipts     $225,000      │
│ Next 90d expected spending     $143,500      │
│                                             │
│ Sep   Oct   Nov   Dec   Jan   Feb ...       │
│ financial summary / forecast                │
│                                             │
├─────────────────────────────────────────────┤
│ RECENT ACTIVITY                             │
│ ✓ Fund I fee matched                        │
│ ✓ Payroll processed                         │
│ ? Legal invoice requires review             │
└─────────────────────────────────────────────┘
```

The product should initially feel more like an intelligent financial workspace than finance software.

---

# 19. UX Principle

Anything that feels like configuring finance software should first be considered as a natural-language interaction.

Instead of editing allocation settings:

> Allocate Carta 60% Fund II, 30% Fund III, 10% management company going forward.

Instead of editing forecast cells:

> Assume we hire a finance contractor in January at $6k/month.

Instead of configuring recurring revenue:

> Fund III pays us $50k quarterly through the end of 2028.

The agent translates intent into structured Company State.

---

# 20. Database

Use standard PostgreSQL.

Application code should depend on:

```env
DATABASE_URL=
```

not on a specific database vendor.

Recommended ORM:

```text
Drizzle
```

The application should work with:

- Neon;
- Supabase Postgres;
- Railway;
- Render;
- AWS RDS;
- local Postgres;
- Docker Postgres;
- other standard PostgreSQL services.

Using Supabase or Neon during development is fine.

Neither should become an architectural dependency.

---

# 21. File Storage

Abstract file storage.

Conceptually:

```text
BlobStore
   ├── LocalBlobStore
   └── S3BlobStore
```

Local/self-hosted deployment can use disk.

Hosted/serverless deployment can use S3-compatible object storage.

Markdown knowledge documents should generally live in Postgres rather than relying on a writable application filesystem.

---

# 22. Deployment Architecture

The same application should support multiple deployment modes.

## Hosted app

```text
Browser
   ↓
Vercel
   ↓
Hosted PostgreSQL
   ↓
Object Storage

Vercel
   ↓
OpenAI / OpenRouter
```

---

## Easy self-host

```text
Browser
   ↓
Docker / VPS
   ↓
Hosted PostgreSQL
```

---

## Fully self-hosted

```text
Browser
   ↓
Docker
   ↓
Local PostgreSQL
   ↓
Local file storage
```

The application code should be the same.

---

# 23. Vercel Deployment

V0 should be directly deployable from GitHub to Vercel.

Required environment variables should remain minimal:

```env
DATABASE_URL=

MODEL_PROVIDER=
MODEL_NAME=

OPENAI_API_KEY=
OPENROUTER_API_KEY=

APP_SECRET=
```

Optional hosted file storage:

```env
FILE_STORAGE=s3
S3_ENDPOINT=
S3_BUCKET=
S3_ACCESS_KEY=
S3_SECRET_KEY=
```

Secrets must remain server-side.

Do not rely on Vercel's application filesystem for persistent state.

---

# 24. Open-Source / Self-Hosting Requirement

Design the repository so publishing it later does not require rewriting the application.

A self-hosted installation should eventually be approximately:

```bash
git clone ...
cp .env.example .env
docker compose up
```

The open-source repository should contain:

- application;
- Company State;
- Markdown templates;
- finance engine;
- agent;
- OpenAI adapter;
- OpenRouter adapter;
- ingestion;
- database migrations;
- Docker configuration;
- local storage support.

Do not require proprietary infrastructure for core functionality.

---

# 25. Repository Structure

Prefer a simple monorepo.

```text
/apps
    /web

/packages
    /company-state
    /finance-engine
    /agent
    /model-providers
    /ingestion
    /database

/templates
    /management-company
        company.md
        policies.md
        allocations.md
        accounting.md
        forecast.md
```

Avoid premature package complexity, but preserve these conceptual boundaries.

---

# 26. Recommended Stack

V0 recommendation:

```text
Next.js
TypeScript
React

PostgreSQL
Drizzle
Zod

OpenAI SDK
OpenRouter adapter

Markdown

Local / S3-compatible storage abstraction

Docker
Vercel-compatible deployment
```

The deterministic finance engine should have no dependency on:

- React;
- Next.js;
- OpenAI;
- OpenRouter.

---

# 27. Initial Financial Capabilities

V0 needs only enough financial logic for Company Zero.

### Management fees

Support:

- quarterly amounts;
- effective dates;
- service periods;
- expected cash;
- revenue recognition;
- actual receipt matching.

### Employee

Support:

- salary;
- effective dates;
- monthly expense;
- simple benefit/payroll assumptions;
- actual payroll observations.

### Contractors

Support:

- recurring retainers;
- invoices;
- expected cash timing.

### Professional services

Support:

- invoice amount;
- service period;
- due date;
- expense recognition;
- payment;
- allocations.

### Prepaids

Support:

- payment;
- coverage period;
- monthly recognition.

### Cash

Support:

```text
Opening Cash
+ Receipts
- Payments
= Ending Cash
```

---

# 28. Financial Output

Initial monthly view:

```text
Management Fee Revenue
Other Revenue

Employee Compensation
Contractors
Professional Services
Software
Insurance
Other Operating Expenses

Total Operating Expenses
Operating Income

Cash
```

Also calculate:

- expected receipts;
- expected payments;
- unpaid obligations;
- intercompany receivables/payables;
- contractual vs assumed forecast amounts.

---

# 29. Traceability

Every displayed financial value should be explainable.

Example:

```text
October Professional Services
$18,500
      ↓
Smith LLP       $12,500
Contractor X     $6,000
      ↓
Smith LLP Invoice 1842
      ↓
Services performed in August
      ↓
CFO Decision
      ↓
50% Management Company
50% Fund II
      ↓
Original PDF
```

The user should be able to ask:

> Why is this $18,500?

and receive this lineage.

---

# 30. Company Zero Acceptance Test

Take one completed real month.

Provide:

- bank CSV;
- invoices;
- employee information;
- contractor information;
- management-fee arrangements;
- allocation policies;
- optional QuickBooks export;
- any useful Markdown notes.

The system must:

1. Store original evidence.
2. Extract observations.
3. Deduplicate overlapping evidence.
4. Identify counterparties.
5. Match obligations.
6. Apply existing policies.
7. Ask the CFO only where necessary.
8. Persist answers as Decisions or Policies.
9. Reconstruct monthly financial results.
10. Reconcile cash.
11. Produce a 12-month forecast.
12. Generate/update useful Markdown company knowledge.
13. Explain every material financial value.
14. Support natural-language scenario changes.

---

# 31. Required Questions

Company Zero should answer:

> How much management-fee revenue did we earn this month?

> How much cash did we receive?

> What receipts do we expect next quarter?

> What expenses did we incur?

> What did we actually pay?

> What remains unpaid?

> Which expenses were allocated to funds?

> How much do the funds owe us?

> Why is professional-services expense $X?

> Which parts of next year's forecast are contractual?

> Which parts are assumptions?

> What questions still need my input?

> What happens if Fund II stops paying management fees next year?

---

# 32. Do Not Build Yet

Do not build:

- Plaid;
- live QuickBooks synchronization;
- payroll integrations;
- CRM integrations;
- complex authentication;
- RBAC;
- organizations;
- mobile apps;
- elaborate dashboards;
- spreadsheet modeling UI;
- generalized formula language;
- full GAAP accounting engine;
- generalized policy DSL;
- generalized plugin system;
- automated tax filings;
- invoice payment infrastructure.

Do not build functionality merely because conventional finance software has it.

---

# 33. Revised Build Sequence

## Phase 1 — Skeleton

Create:

- Next.js application;
- Postgres connection;
- Drizzle;
- migrations;
- provider abstraction;
- OpenAI adapter;
- OpenRouter adapter;
- single-page shell.

Make it deployable to Vercel immediately.

---

## Phase 2 — Company State

Implement core structured objects:

- Sources;
- Observations;
- Entities;
- Relationships;
- Agreements;
- Facts;
- Events;
- Obligations;
- Decisions;
- Policies;
- Assumptions;
- Scenarios;
- ReviewItems.

---

## Phase 3 — Markdown Knowledge

Implement:

- KnowledgeDocument;
- Markdown storage;
- management-company templates;
- read/update agent tools;
- generation from conversation.

Seed:

```text
company.md
policies.md
allocations.md
accounting.md
forecast.md
```

---

## Phase 4 — Finance Engine

Implement deterministic:

- management fees;
- salaries;
- contractors;
- professional services;
- allocations;
- prepaids;
- cash;
- basic P&L;
- 12-month forecast;
- calculation trace.

---

## Phase 5 — Agent

Implement controlled agent tools.

The agent should be able to:

```text
read evidence
read Company State
read Markdown knowledge

interpret

create proposed state
apply policies

ask CFO when necessary

update Company State

query deterministic engine

explain results
```

---

## Phase 6 — Single Input Surface

Implement one input supporting:

```text
chat
commands
questions
file upload
```

Do not create separate workflows unnecessarily.

---

## Phase 7 — Review

Put unresolved CFO questions directly on the same page.

Optimize for very fast resolution.

CFO answer:

```text
Question
   ↓
Decision
   ↓
optional Policy
   ↓
recalculate
```

---

## Phase 8 — Ingestion

Add:

1. invoice/document extraction;
2. bank CSV;
3. QuickBooks bootstrap;
4. deduplication;
5. matching.

---

## Phase 9 — Company Zero

Load a real month.

Stop expanding feature scope.

Use the system.

Fix what breaks.

---

# 34. V0 Success Criteria

V0 succeeds when:

1. The CFO can drop financial information into one interface.
2. The LLM correctly interprets most ordinary activity.
3. Ambiguous cases become useful CFO questions.
4. CFO answers persist and reduce future questions.
5. Human financial knowledge accumulates in readable Markdown.
6. Executable financial state remains structured.
7. Calculations are deterministic.
8. Cash reconciles.
9. A credible 12-month forecast is maintained.
10. Every material number is traceable.
11. No Excel financial model is required.
12. The application runs on Vercel with hosted Postgres.
13. The same application can run self-hosted.
14. OpenAI and OpenRouter are interchangeable model providers.
15. The architecture can be open sourced without removing proprietary dependencies from the core.

The product hypothesis is:

> **A CFO should be able to give an intelligent system the same evidence, context, policies, assumptions, and judgment they use themselves—and have the system continuously maintain an auditable financial model without requiring the CFO to build or maintain that model in Excel.**