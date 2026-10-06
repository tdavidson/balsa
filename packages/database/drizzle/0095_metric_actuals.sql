-- Recorded values of an operating metric by month, with where each came from:
-- typed by a user, or an approved fact in evidence, possibly applied through a decision.
CREATE TABLE forecast_metric_actuals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 metric_id uuid NOT NULL REFERENCES forecast_metrics(id) ON DELETE CASCADE, month text NOT NULL, value text NOT NULL,
 evidence_id uuid REFERENCES evidence(id) ON DELETE SET NULL, fact_id uuid REFERENCES fact_records(id) ON DELETE SET NULL, decision_id uuid REFERENCES decisions(id) ON DELETE SET NULL,
 created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX forecast_metric_actuals_metric_month ON forecast_metric_actuals(metric_id, month);
--> statement-breakpoint
CREATE INDEX forecast_metric_actuals_company ON forecast_metric_actuals(company_id);
--> statement-breakpoint
ALTER TABLE forecast_metric_actuals ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE forecast_metric_actuals FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY forecast_metric_actuals_company_scope ON forecast_metric_actuals USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
