CREATE TABLE operating_predictions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 experiment_id uuid NOT NULL, review_id uuid NOT NULL, snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id), UNIQUE(company_id,review_id),
 FOREIGN KEY(company_id,experiment_id) REFERENCES operating_experiments(company_id,id) ON DELETE CASCADE,
 FOREIGN KEY(company_id,review_id) REFERENCES goal_decision_reviews(company_id,id) ON DELETE CASCADE
);
CREATE INDEX operating_predictions_experiment ON operating_predictions(company_id,experiment_id);
CREATE TABLE operating_observations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 prediction_id uuid NOT NULL, node_id text NOT NULL, month text NOT NULL CHECK(month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
 supersedes_id uuid, definition jsonb NOT NULL, request_key uuid NOT NULL, request_hash text NOT NULL,
 actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id), UNIQUE(company_id,request_key), UNIQUE(company_id,supersedes_id),
 FOREIGN KEY(company_id,prediction_id) REFERENCES operating_predictions(company_id,id) ON DELETE CASCADE,
 FOREIGN KEY(company_id,supersedes_id) REFERENCES operating_observations(company_id,id)
);
CREATE INDEX operating_observations_metric ON operating_observations(company_id,prediction_id,node_id,month);
CREATE UNIQUE INDEX operating_observations_first ON operating_observations(company_id,prediction_id,node_id,month) WHERE supersedes_id IS NULL;
CREATE TABLE operating_outcome_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 prediction_id uuid NOT NULL, snapshot jsonb NOT NULL, request_key uuid NOT NULL, request_hash text NOT NULL,
 actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,request_key),
 FOREIGN KEY(company_id,prediction_id) REFERENCES operating_predictions(company_id,id) ON DELETE CASCADE
);
CREATE INDEX operating_outcome_reviews_prediction ON operating_outcome_reviews(company_id,prediction_id);
CREATE TRIGGER operating_predictions_immutable BEFORE UPDATE ON operating_predictions FOR EACH ROW EXECUTE FUNCTION preserve_financial_review_content();
CREATE TRIGGER operating_observations_immutable BEFORE UPDATE ON operating_observations FOR EACH ROW EXECUTE FUNCTION preserve_financial_review_content();
CREATE TRIGGER operating_outcome_reviews_immutable BEFORE UPDATE ON operating_outcome_reviews FOR EACH ROW EXECUTE FUNCTION preserve_financial_review_content();
ALTER TABLE operating_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE operating_predictions FORCE ROW LEVEL SECURITY;
CREATE POLICY operating_predictions_scope ON operating_predictions USING(app_current_company_id() IS NULL OR company_id=app_current_company_id()) WITH CHECK(app_current_company_id() IS NULL OR company_id=app_current_company_id());
ALTER TABLE operating_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE operating_observations FORCE ROW LEVEL SECURITY;
CREATE POLICY operating_observations_scope ON operating_observations USING(app_current_company_id() IS NULL OR company_id=app_current_company_id()) WITH CHECK(app_current_company_id() IS NULL OR company_id=app_current_company_id());
ALTER TABLE operating_outcome_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE operating_outcome_reviews FORCE ROW LEVEL SECURITY;
CREATE POLICY operating_outcome_reviews_scope ON operating_outcome_reviews USING(app_current_company_id() IS NULL OR company_id=app_current_company_id()) WITH CHECK(app_current_company_id() IS NULL OR company_id=app_current_company_id());
