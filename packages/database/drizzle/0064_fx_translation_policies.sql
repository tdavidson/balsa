CREATE TABLE "fx_translation_policies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "name" text NOT NULL, "status" text DEFAULT 'draft' NOT NULL,
  "presentation_currency" char(3) NOT NULL,
  "income_rate_type" text NOT NULL, "monetary_rate_type" text NOT NULL, "equity_rate_type" text NOT NULL,
  "cta_account_id" uuid NOT NULL REFERENCES "chart_accounts"("id") ON DELETE restrict,
  "fx_gain_loss_account_id" uuid NOT NULL REFERENCES "chart_accounts"("id") ON DELETE restrict,
  "source_id" uuid REFERENCES "sources"("id") ON DELETE set null, "evidence_id" uuid REFERENCES "evidence"("id") ON DELETE set null,
  "fact_id" uuid REFERENCES "fact_records"("id") ON DELETE set null, "approval_event_id" uuid REFERENCES "approval_events"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "fx_translation_policies_company_status_index" ON "fx_translation_policies" ("company_id", "status");
CREATE UNIQUE INDEX "fx_translation_policies_active_currency_unique" ON "fx_translation_policies" ("company_id", "presentation_currency") WHERE status = 'approved';
