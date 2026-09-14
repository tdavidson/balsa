-- Several people on one installation: a second role, an audit log, and
-- acting-user attribution on the rows that lacked it.
--
-- The migrator runs every pending migration inside ONE transaction, and
-- Postgres refuses to use an enum value in the transaction that added it
-- ("unsafe use of new value"). So the literal 'member' appears exactly once
-- below, in the ALTER TYPE itself: no column default, no backfill, and no
-- check constraint may name it here.
ALTER TYPE "company_role" ADD VALUE IF NOT EXISTS 'member';
--> statement-breakpoint
CREATE TABLE "audit_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  -- Null for worker actions, and for a user deleted after the fact.
  "actor_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "via" text DEFAULT 'ui' NOT NULL,
  "action" text NOT NULL,
  "entity_type" text,
  "entity_id" uuid,
  "summary" text NOT NULL,
  "before" jsonb,
  "after" jsonb,
  "request_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "audit_log_company_index" ON "audit_log" ("company_id", "created_at");
--> statement-breakpoint
-- Attribution on the rows that record a person's decision. Nullable: existing
-- rows, agent writes and worker writes have no acting user.
ALTER TABLE "decisions" ADD COLUMN "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "review_items" ADD COLUMN "resolved_by_user_id" uuid REFERENCES "users"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "economic_items" ADD COLUMN "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "reporting_periods" ADD COLUMN "closed_by_user_id" uuid REFERENCES "users"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD COLUMN "updated_by_user_id" uuid REFERENCES "users"("id") ON DELETE set null;
--> statement-breakpoint
-- Row level security in the 0070 pattern: permissive while the transaction-local
-- scope is unset, exact once withCompanyTransaction sets it.
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "audit_log_company_scope" ON "audit_log";
--> statement-breakpoint
CREATE POLICY "audit_log_company_scope" ON "audit_log" USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
