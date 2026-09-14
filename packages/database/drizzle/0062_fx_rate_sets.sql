CREATE TABLE "fx_rate_sets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "name" text NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "provider" text,
  "source_id" uuid REFERENCES "sources"("id") ON DELETE set null,
  "approval_event_id" uuid REFERENCES "approval_events"("id") ON DELETE set null,
  "effective_from" date,
  "effective_to" date,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "fx_rate_sets_company_status_index" ON "fx_rate_sets" USING btree ("company_id","status");
CREATE INDEX "fx_rate_sets_source_index" ON "fx_rate_sets" USING btree ("source_id");

CREATE TABLE "fx_rates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "rate_set_id" uuid NOT NULL REFERENCES "fx_rate_sets"("id") ON DELETE cascade,
  "from_currency" char(3) NOT NULL,
  "to_currency" char(3) NOT NULL,
  "rate_type" text NOT NULL,
  "effective_date" date NOT NULL,
  "numerator" text NOT NULL,
  "denominator" text NOT NULL,
  "source_id" uuid REFERENCES "sources"("id") ON DELETE set null,
  "evidence_id" uuid REFERENCES "evidence"("id") ON DELETE set null,
  "fact_id" uuid REFERENCES "fact_records"("id") ON DELETE set null,
  "source_location" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "fx_rates_rate_set_quote_unique" ON "fx_rates" USING btree ("rate_set_id","from_currency","to_currency","rate_type","effective_date");
CREATE INDEX "fx_rates_company_quote_date_index" ON "fx_rates" USING btree ("company_id","from_currency","to_currency","rate_type","effective_date");
