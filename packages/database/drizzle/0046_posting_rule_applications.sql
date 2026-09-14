CREATE TABLE "posting_rule_applications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "source_row_id" uuid NOT NULL REFERENCES "source_rows"("id") ON DELETE cascade,
  "posting_rule_id" uuid NOT NULL REFERENCES "posting_rules"("id") ON DELETE restrict,
  "posting_proposal_id" uuid REFERENCES "posting_proposals"("id") ON DELETE set null,
  "rule_snapshot" text NOT NULL,
  "outcome" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "posting_rule_applications_row_rule_unique" ON "posting_rule_applications" ("source_row_id", "posting_rule_id");
CREATE INDEX "posting_rule_applications_company_index" ON "posting_rule_applications" ("company_id", "created_at");
