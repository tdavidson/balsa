CREATE TABLE operating_drafts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 name text NOT NULL, revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
 definition jsonb NOT NULL, experiment_id uuid,
 actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (company_id, experiment_id) REFERENCES operating_experiments(company_id,id) ON DELETE CASCADE
);
CREATE INDEX operating_drafts_company_updated ON operating_drafts(company_id,updated_at);
CREATE INDEX operating_drafts_experiment ON operating_drafts(company_id,experiment_id);
ALTER TABLE operating_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE operating_drafts FORCE ROW LEVEL SECURITY;
CREATE POLICY operating_drafts_scope ON operating_drafts USING(app_current_company_id() IS NULL OR company_id=app_current_company_id()) WITH CHECK(app_current_company_id() IS NULL OR company_id=app_current_company_id());
