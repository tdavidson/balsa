CREATE TABLE "source_rows" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "source_id" uuid NOT NULL REFERENCES "sources"("id") ON DELETE cascade,
  "evidence_id" uuid REFERENCES "evidence"("id") ON DELETE set null,
  "source_key" text NOT NULL,
  "source_type" text NOT NULL,
  "period" text,
  "transaction_date" date,
  "description" text,
  "amount" text,
  "currency" char(3),
  "direction" "cash_event_direction",
  "source_location" text,
  "raw_json" text NOT NULL,
  "status" text DEFAULT 'staged' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "source_rows_source_key_unique" ON "source_rows" ("source_id", "source_key");
CREATE INDEX "source_rows_company_period_index" ON "source_rows" ("company_id", "period");
CREATE INDEX "source_rows_evidence_index" ON "source_rows" ("evidence_id");

ALTER TABLE "cash_events" ADD COLUMN "source_row_id" uuid REFERENCES "source_rows"("id") ON DELETE set null;
ALTER TABLE "journal_lines" ADD COLUMN "source_row_id" uuid REFERENCES "source_rows"("id") ON DELETE set null;
ALTER TABLE "posting_proposals" ADD COLUMN "source_row_id" uuid REFERENCES "source_rows"("id") ON DELETE set null;
CREATE INDEX "cash_events_source_row_index" ON "cash_events" ("source_row_id");
CREATE INDEX "journal_lines_source_row_index" ON "journal_lines" ("source_row_id");
