CREATE TABLE IF NOT EXISTS "forecast_dimensions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "name" text NOT NULL,
  "items" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "active" char(1) DEFAULT 'Y' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "forecast_dimensions_company_index" ON "forecast_dimensions" ("company_id", "active");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "forecast_dimensions_active_name_unique" ON "forecast_dimensions" ("company_id", "name") WHERE active = 'Y';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "forecast_variables" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "name" text NOT NULL,
  "kind" text NOT NULL,
  "dims" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "formula" text,
  "inputs" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "decision_id" uuid REFERENCES "decisions"("id") ON DELETE set null,
  "active" char(1) DEFAULT 'Y' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "forecast_variables_kind_check" CHECK ("kind" IN ('money', 'number')),
  CONSTRAINT "forecast_variables_formula_or_inputs_check" CHECK ("formula" IS NULL OR "inputs" = '[]'::jsonb)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "forecast_variables_company_index" ON "forecast_variables" ("company_id", "active");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "forecast_variables_active_name_unique" ON "forecast_variables" ("company_id", "name") WHERE active = 'Y';
--> statement-breakpoint
ALTER TABLE "economic_items" ADD COLUMN IF NOT EXISTS "amount_formula" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "decision_effect_applications" (
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "decision_id" uuid NOT NULL REFERENCES "decisions"("id") ON DELETE cascade,
  "effect_kind" text NOT NULL,
  "result" jsonb NOT NULL,
  "applied_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "decision_effect_applications_pk" PRIMARY KEY ("company_id", "decision_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "decision_effect_applications_company_index" ON "decision_effect_applications" ("company_id", "applied_at");
--> statement-breakpoint
ALTER TABLE "decision_effect_applications" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "decision_effect_applications" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "decision_effect_applications_company_scope" ON "decision_effect_applications" USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
--> statement-breakpoint
ALTER TABLE "forecast_dimensions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "forecast_dimensions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "forecast_dimensions_company_scope" ON "forecast_dimensions" USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
--> statement-breakpoint
ALTER TABLE "forecast_variables" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "forecast_variables" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "forecast_variables_company_scope" ON "forecast_variables" USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
