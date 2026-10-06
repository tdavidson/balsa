CREATE TABLE operating_plan_revisions (
 company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 experiment_id uuid NOT NULL, prediction_id uuid NOT NULL, trigger_review_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(company_id,experiment_id),
 FOREIGN KEY(company_id,experiment_id) REFERENCES operating_experiments(company_id,id) ON DELETE CASCADE,
 FOREIGN KEY(company_id,prediction_id) REFERENCES operating_predictions(company_id,id) ON DELETE CASCADE,
 FOREIGN KEY(company_id,trigger_review_id) REFERENCES operating_trigger_evaluations(company_id,id) ON DELETE CASCADE
);
CREATE INDEX operating_plan_revisions_prediction ON operating_plan_revisions(company_id,prediction_id);
CREATE INDEX operating_plan_revisions_trigger ON operating_plan_revisions(company_id,trigger_review_id);
CREATE TRIGGER operating_plan_revisions_immutable BEFORE UPDATE ON operating_plan_revisions FOR EACH ROW EXECUTE FUNCTION preserve_financial_review_content();
ALTER TABLE operating_plan_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE operating_plan_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY operating_plan_revisions_scope ON operating_plan_revisions USING(app_current_company_id() IS NULL OR company_id=app_current_company_id()) WITH CHECK(app_current_company_id() IS NULL OR company_id=app_current_company_id());
