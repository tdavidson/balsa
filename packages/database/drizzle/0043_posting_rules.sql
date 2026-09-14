CREATE TABLE "posting_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "name" text NOT NULL,
  "source_type" text,
  "description_pattern" text NOT NULL,
  "direction" "cash_event_direction",
  "activity" text,
  "cash_account_id" uuid NOT NULL REFERENCES "chart_accounts"("id") ON DELETE restrict,
  "offset_account_id" uuid NOT NULL REFERENCES "chart_accounts"("id") ON DELETE restrict,
  "entity_id" uuid REFERENCES "entities"("id") ON DELETE set null,
  "policy_id" uuid REFERENCES "policies"("id") ON DELETE set null,
  "decision_id" uuid REFERENCES "decisions"("id") ON DELETE set null,
  "priority" text DEFAULT '100' NOT NULL,
  "active" char(1) DEFAULT 'Y' NOT NULL,
  "effective_from" text,
  "effective_to" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "posting_rules_company_active_index" ON "posting_rules" ("company_id", "active");
CREATE INDEX "posting_rules_pattern_index" ON "posting_rules" ("company_id", "description_pattern");
