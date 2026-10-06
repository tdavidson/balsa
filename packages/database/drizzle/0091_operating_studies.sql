CREATE TABLE operating_studies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('conditional','calibration','simulation')),name text NOT NULL,prediction_id uuid,
 snapshot jsonb NOT NULL,request_key uuid NOT NULL,request_hash text NOT NULL,actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),UNIQUE(company_id,request_key),FOREIGN KEY(company_id,prediction_id) REFERENCES operating_predictions(company_id,id) ON DELETE CASCADE
);
CREATE INDEX operating_studies_prediction ON operating_studies(company_id,prediction_id);
CREATE INDEX operating_studies_kind ON operating_studies(company_id,kind,created_at);
CREATE TRIGGER operating_studies_immutable BEFORE UPDATE ON operating_studies FOR EACH ROW EXECUTE FUNCTION preserve_financial_review_content();
ALTER TABLE operating_studies ENABLE ROW LEVEL SECURITY;
ALTER TABLE operating_studies FORCE ROW LEVEL SECURITY;
CREATE POLICY operating_studies_scope ON operating_studies USING(app_current_company_id() IS NULL OR company_id=app_current_company_id()) WITH CHECK(app_current_company_id() IS NULL OR company_id=app_current_company_id());
