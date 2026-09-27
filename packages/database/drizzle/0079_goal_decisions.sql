CREATE TABLE goal_decision_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  goal_version_id uuid NOT NULL, plan_id uuid NOT NULL, scenario_id uuid NOT NULL, parent_id uuid,
  kind text NOT NULL CHECK (kind IN ('evaluation', 'applied', 'outcome')), name text NOT NULL,
  request_key uuid NOT NULL, request_hash text NOT NULL, preview_token text NOT NULL, snapshot jsonb NOT NULL,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, id),
  FOREIGN KEY(company_id, goal_version_id) REFERENCES cash_goal_versions(company_id, id),
  FOREIGN KEY(company_id, plan_id) REFERENCES financial_review_snapshots(company_id, id),
  FOREIGN KEY(company_id, parent_id) REFERENCES goal_decision_reviews(company_id, id),
  CHECK ((kind = 'outcome' AND parent_id IS NOT NULL) OR (kind <> 'outcome' AND parent_id IS NULL))
);
CREATE UNIQUE INDEX goal_decision_reviews_request ON goal_decision_reviews(company_id, request_key);
CREATE INDEX goal_decision_reviews_history ON goal_decision_reviews(company_id, created_at);
--> statement-breakpoint
CREATE TRIGGER goal_decision_reviews_immutable BEFORE UPDATE ON goal_decision_reviews FOR EACH ROW EXECUTE FUNCTION preserve_financial_review_content();
ALTER TABLE goal_decision_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE goal_decision_reviews FORCE ROW LEVEL SECURITY;
CREATE POLICY goal_decision_reviews_company_scope ON goal_decision_reviews USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
