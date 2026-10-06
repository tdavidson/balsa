CREATE UNIQUE INDEX operating_experiments_company_id ON operating_experiments(company_id, id);
CREATE TABLE operating_connections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 experiment_id uuid NOT NULL, bindings jsonb NOT NULL, actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(company_id,id), UNIQUE(company_id,experiment_id),
 FOREIGN KEY(company_id,experiment_id) REFERENCES operating_experiments(company_id,id) ON DELETE CASCADE
);
CREATE TABLE operating_revisions (
 company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE, connection_id uuid NOT NULL, experiment_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(company_id,experiment_id),
 FOREIGN KEY(company_id,connection_id) REFERENCES operating_connections(company_id,id) ON DELETE CASCADE,
 FOREIGN KEY(company_id,experiment_id) REFERENCES operating_experiments(company_id,id) ON DELETE CASCADE
);
CREATE TRIGGER operating_connections_immutable BEFORE UPDATE ON operating_connections FOR EACH ROW EXECUTE FUNCTION preserve_financial_review_content();
CREATE TRIGGER operating_revisions_immutable BEFORE UPDATE ON operating_revisions FOR EACH ROW EXECUTE FUNCTION preserve_financial_review_content();
ALTER TABLE operating_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE operating_connections FORCE ROW LEVEL SECURITY;
CREATE POLICY operating_connections_scope ON operating_connections USING(app_current_company_id() IS NULL OR company_id=app_current_company_id()) WITH CHECK(app_current_company_id() IS NULL OR company_id=app_current_company_id());
ALTER TABLE operating_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE operating_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY operating_revisions_scope ON operating_revisions USING(app_current_company_id() IS NULL OR company_id=app_current_company_id()) WITH CHECK(app_current_company_id() IS NULL OR company_id=app_current_company_id());
