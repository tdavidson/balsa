ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "minimum_cash_minor" text DEFAULT '0' NOT NULL;
--> statement-breakpoint
CREATE TABLE "financial_state_revisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "revision" text NOT NULL,
  "kind" text NOT NULL,
  "subject_type" text NOT NULL,
  "subject_id" text,
  "actor_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "via" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "financial_state_revisions_company_revision_unique" ON "financial_state_revisions" ("company_id", "revision");
--> statement-breakpoint
CREATE TABLE "forecast_consequences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "revision" text NOT NULL,
  "previous_run_id" uuid REFERENCES "calculation_runs"("id") ON DELETE set null,
  "next_run_id" uuid NOT NULL REFERENCES "calculation_runs"("id") ON DELETE cascade,
  "causes" jsonb NOT NULL,
  "delta" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "forecast_consequences_company_revision_unique" ON "forecast_consequences" ("company_id", "revision");
--> statement-breakpoint
CREATE INDEX "forecast_consequences_company_index" ON "forecast_consequences" ("company_id", "created_at");
--> statement-breakpoint
ALTER TABLE "financial_state_revisions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "financial_state_revisions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "financial_state_revisions_company_scope" ON "financial_state_revisions" USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
--> statement-breakpoint
ALTER TABLE "forecast_consequences" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "forecast_consequences" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "forecast_consequences_company_scope" ON "forecast_consequences" USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
