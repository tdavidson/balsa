CREATE TYPE "account_normal_balance" AS ENUM ('debit', 'credit');
CREATE TYPE "journal_batch_status" AS ENUM ('draft', 'posted', 'reversed');
CREATE TYPE "journal_entry_status" AS ENUM ('draft', 'posted', 'reversed');
CREATE TYPE "posting_proposal_status" AS ENUM ('draft', 'approved', 'rejected', 'posted');

CREATE TABLE "chart_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "account_type" text NOT NULL,
  "normal_balance" "account_normal_balance" NOT NULL,
  "statement_line" text,
  "cash_flow_category" text,
  "entity_id" uuid REFERENCES "entities"("id") ON DELETE set null,
  "active_from" text,
  "active_to" text,
  "active" char(1) DEFAULT 'Y' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "chart_accounts_company_code_unique" ON "chart_accounts" ("company_id", "code");
CREATE INDEX "chart_accounts_company_type_index" ON "chart_accounts" ("company_id", "account_type");

CREATE TABLE "journal_batches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "label" text NOT NULL,
  "source" text NOT NULL,
  "status" "journal_batch_status" DEFAULT 'draft' NOT NULL,
  "idempotency_key" text NOT NULL,
  "source_id" uuid REFERENCES "sources"("id") ON DELETE set null,
  "decision_id" uuid REFERENCES "decisions"("id") ON DELETE set null,
  "approval_event_id" uuid REFERENCES "approval_events"("id") ON DELETE set null,
  "posted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "journal_batches_company_idempotency_unique" ON "journal_batches" ("company_id", "idempotency_key");
CREATE INDEX "journal_batches_company_status_index" ON "journal_batches" ("company_id", "status");

CREATE TABLE "journal_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "batch_id" uuid NOT NULL REFERENCES "journal_batches"("id") ON DELETE cascade,
  "entity_id" uuid REFERENCES "entities"("id") ON DELETE set null,
  "posting_date" date NOT NULL,
  "period" text NOT NULL,
  "memo" text NOT NULL,
  "status" "journal_entry_status" DEFAULT 'draft' NOT NULL,
  "reversal_of_entry_id" uuid REFERENCES "journal_entries"("id") ON DELETE set null,
  "posted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "journal_entries_company_period_index" ON "journal_entries" ("company_id", "period", "status");
CREATE INDEX "journal_entries_batch_index" ON "journal_entries" ("batch_id");

CREATE TABLE "journal_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "entry_id" uuid NOT NULL REFERENCES "journal_entries"("id") ON DELETE cascade,
  "account_id" uuid NOT NULL REFERENCES "chart_accounts"("id") ON DELETE restrict,
  "entity_id" uuid REFERENCES "entities"("id") ON DELETE set null,
  "currency" char(3) NOT NULL,
  "debit_minor" text DEFAULT '0' NOT NULL,
  "credit_minor" text DEFAULT '0' NOT NULL,
  "source_id" uuid REFERENCES "sources"("id") ON DELETE set null,
  "evidence_id" uuid REFERENCES "evidence"("id") ON DELETE set null,
  "fact_id" uuid REFERENCES "fact_records"("id") ON DELETE set null,
  "decision_id" uuid REFERENCES "decisions"("id") ON DELETE set null,
  "policy_id" uuid REFERENCES "policies"("id") ON DELETE set null,
  "approval_event_id" uuid REFERENCES "approval_events"("id") ON DELETE set null,
  "source_location" text,
  "external_key" text,
  "memo" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "journal_lines_entry_index" ON "journal_lines" ("entry_id");
CREATE INDEX "journal_lines_account_currency_index" ON "journal_lines" ("company_id", "account_id", "currency");
CREATE UNIQUE INDEX "journal_lines_company_external_key_unique" ON "journal_lines" ("company_id", "external_key");

CREATE TABLE "posting_proposals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "source_id" uuid REFERENCES "sources"("id") ON DELETE set null,
  "evidence_id" uuid REFERENCES "evidence"("id") ON DELETE set null,
  "fact_id" uuid REFERENCES "fact_records"("id") ON DELETE set null,
  "decision_id" uuid REFERENCES "decisions"("id") ON DELETE set null,
  "policy_id" uuid REFERENCES "policies"("id") ON DELETE set null,
  "source_location" text,
  "external_key" text NOT NULL,
  "proposal_json" text NOT NULL,
  "rationale" text,
  "confidence" text,
  "status" "posting_proposal_status" DEFAULT 'draft' NOT NULL,
  "journal_entry_id" uuid REFERENCES "journal_entries"("id") ON DELETE set null,
  "approved_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "posting_proposals_company_external_key_unique" ON "posting_proposals" ("company_id", "external_key");
CREATE INDEX "posting_proposals_company_status_index" ON "posting_proposals" ("company_id", "status");
