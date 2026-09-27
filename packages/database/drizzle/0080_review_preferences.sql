ALTER TABLE cash_goal_versions DROP CONSTRAINT cash_goal_versions_status_check;
ALTER TABLE cash_goal_versions ADD CONSTRAINT cash_goal_versions_status_check CHECK (status IN ('draft', 'active', 'archived'));
--> statement-breakpoint
CREATE TABLE financial_review_preferences (
  company_id uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  primary_goal_version_id uuid,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, primary_goal_version_id) REFERENCES cash_goal_versions(company_id, id)
);
ALTER TABLE financial_review_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_review_preferences FORCE ROW LEVEL SECURITY;
CREATE POLICY financial_review_preferences_company_scope ON financial_review_preferences USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
