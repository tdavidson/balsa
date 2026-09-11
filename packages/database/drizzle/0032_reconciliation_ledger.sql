CREATE TABLE "reconciliation_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "event_id" uuid NOT NULL REFERENCES "cash_events"("id") ON DELETE CASCADE,
  "counterpart_event_id" uuid REFERENCES "cash_events"("id") ON DELETE CASCADE,
  "month" text NOT NULL,
  "kind" text NOT NULL,
  "match_key" text NOT NULL,
  "evidence" text DEFAULT '{}' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "reconciliation_entries_company_month_index" ON "reconciliation_entries" USING btree ("company_id", "month");
CREATE UNIQUE INDEX "reconciliation_entries_event_match_unique" ON "reconciliation_entries" USING btree ("company_id", "event_id", "match_key");
