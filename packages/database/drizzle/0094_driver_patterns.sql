-- Standard-model driver patterns: a structured pattern on an economic item,
-- operating metrics forecast on the same patterns, per-driver seasonality
-- profiles, and the company's default escalation.
ALTER TABLE economic_items ADD COLUMN pattern jsonb;
--> statement-breakpoint
ALTER TABLE companies ADD COLUMN default_escalation jsonb;
--> statement-breakpoint
CREATE TABLE forecast_metrics (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 name text NOT NULL, label text NOT NULL, unit text, effective_from text NOT NULL, effective_to text, pattern jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX forecast_metrics_company_name ON forecast_metrics(company_id, name);
--> statement-breakpoint
CREATE TABLE seasonality_profiles (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 name text NOT NULL, deviations jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX seasonality_profiles_company_name ON seasonality_profiles(company_id, lower(name));
--> statement-breakpoint
ALTER TABLE forecast_metrics ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE forecast_metrics FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY forecast_metrics_company_scope ON forecast_metrics USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
--> statement-breakpoint
ALTER TABLE seasonality_profiles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE seasonality_profiles FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY seasonality_profiles_company_scope ON seasonality_profiles USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
