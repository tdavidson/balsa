ALTER TABLE "chart_accounts" ADD COLUMN "fx_monetary" char(1) DEFAULT 'N' NOT NULL;

CREATE TABLE "fx_remeasurement_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "period" text NOT NULL,
  "entity_id" uuid REFERENCES "entities"("id") ON DELETE restrict,
  "policy_id" uuid NOT NULL REFERENCES "fx_translation_policies"("id") ON DELETE restrict,
  "journal_entry_id" uuid NOT NULL REFERENCES "journal_entries"("id") ON DELETE restrict,
  "approved_by_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE restrict,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "fx_remeasurement_entries_scope_unique" ON "fx_remeasurement_entries" ("company_id", "period", "entity_id", "policy_id");
CREATE UNIQUE INDEX "fx_remeasurement_entries_journal_unique" ON "fx_remeasurement_entries" ("journal_entry_id");
CREATE INDEX "fx_remeasurement_entries_company_period_index" ON "fx_remeasurement_entries" ("company_id", "period");
