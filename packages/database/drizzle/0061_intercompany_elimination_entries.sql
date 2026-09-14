CREATE TABLE "intercompany_elimination_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "period" text NOT NULL,
  "mapping_id" uuid NOT NULL REFERENCES "intercompany_account_mappings"("id") ON DELETE restrict,
  "journal_entry_id" uuid NOT NULL REFERENCES "journal_entries"("id") ON DELETE restrict,
  "approved_by_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE restrict,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "intercompany_elimination_entry_unique" ON "intercompany_elimination_entries" USING btree ("company_id","period","mapping_id");
CREATE UNIQUE INDEX "intercompany_elimination_journal_unique" ON "intercompany_elimination_entries" USING btree ("journal_entry_id");
