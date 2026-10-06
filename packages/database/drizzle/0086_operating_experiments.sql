CREATE UNIQUE INDEX scenarios_company_id ON scenarios(company_id, id);
CREATE TABLE operating_experiments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  scenario_id uuid NOT NULL,
  name text NOT NULL,
  request_key uuid NOT NULL,
  request_hash text NOT NULL,
  snapshot jsonb NOT NULL,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, request_key),
  FOREIGN KEY(company_id, scenario_id) REFERENCES scenarios(company_id, id)
);
CREATE INDEX operating_experiments_company ON operating_experiments(company_id, created_at);
CREATE TRIGGER operating_experiments_immutable BEFORE UPDATE ON operating_experiments FOR EACH ROW EXECUTE FUNCTION preserve_financial_review_content();
ALTER TABLE operating_experiments ENABLE ROW LEVEL SECURITY;
ALTER TABLE operating_experiments FORCE ROW LEVEL SECURITY;
CREATE POLICY operating_experiments_scope ON operating_experiments
  USING(app_current_company_id() IS NULL OR company_id = app_current_company_id())
  WITH CHECK(app_current_company_id() IS NULL OR company_id = app_current_company_id());
