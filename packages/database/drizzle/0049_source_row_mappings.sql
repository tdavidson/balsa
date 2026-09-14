CREATE TABLE "source_row_mappings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "source_row_id" uuid REFERENCES "source_rows"("id") ON DELETE cascade,
  "fact_id" uuid REFERENCES "fact_records"("id") ON DELETE set null,
  "chart_account_id" uuid REFERENCES "chart_accounts"("id") ON DELETE restrict,
  "offset_account_id" uuid REFERENCES "chart_accounts"("id") ON DELETE restrict,
  "mapping_type" text NOT NULL,
  "template_json" text NOT NULL,
  "version" text DEFAULT '1' NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "decision_id" uuid REFERENCES "decisions"("id") ON DELETE set null,
  "policy_id" uuid REFERENCES "policies"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "source_row_mappings_company_index" ON "source_row_mappings" ("company_id", "status");
CREATE INDEX "source_row_mappings_row_index" ON "source_row_mappings" ("source_row_id", "version");
