CREATE TABLE forecast_recurrence_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  status text NOT NULL CHECK (status IN ('active', 'paused')),
  start_month text NOT NULL CHECK (start_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  end_month text NOT NULL CHECK (end_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' AND end_month >= start_month),
  definition jsonb NOT NULL, definition_hash text NOT NULL,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX forecast_recurrence_driver ON forecast_recurrence_policies(company_id, driver_id);
--> statement-breakpoint
ALTER TABLE forecast_recurrence_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE forecast_recurrence_policies FORCE ROW LEVEL SECURITY;
CREATE POLICY forecast_recurrence_company_scope ON forecast_recurrence_policies USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
