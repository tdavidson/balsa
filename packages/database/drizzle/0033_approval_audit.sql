CREATE TABLE "approval_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "evidence_id" uuid NOT NULL REFERENCES "evidence"("id") ON DELETE CASCADE,
  "fact_id" uuid REFERENCES "fact_records"("id") ON DELETE SET NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "layer" text NOT NULL,
  "action" text NOT NULL,
  "previous_value" text,
  "next_value" text,
  "metadata" text DEFAULT '{}' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "approval_events_evidence_index" ON "approval_events" USING btree ("company_id", "evidence_id", "created_at");
CREATE INDEX "approval_events_fact_index" ON "approval_events" USING btree ("fact_id");
