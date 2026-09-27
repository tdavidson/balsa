CREATE UNIQUE INDEX sources_company_id ON sources(company_id, id);
CREATE TABLE financial_import_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 source_id uuid NOT NULL REFERENCES sources(id), previous_source_id uuid REFERENCES sources(id),
 kind text NOT NULL CHECK (kind IN ('evaluation', 'applied')), name text NOT NULL, reason text NOT NULL,
 request_key uuid NOT NULL, request_hash text NOT NULL, snapshot jsonb NOT NULL,
 actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id, source_id) REFERENCES sources(company_id, id),
 FOREIGN KEY(company_id, previous_source_id) REFERENCES sources(company_id, id),
 CHECK (source_id IS DISTINCT FROM previous_source_id)
);
CREATE UNIQUE INDEX financial_import_reviews_request ON financial_import_reviews(company_id, request_key);
CREATE INDEX financial_import_reviews_source ON financial_import_reviews(company_id, source_id, created_at);
CREATE TRIGGER financial_import_reviews_immutable BEFORE UPDATE ON financial_import_reviews FOR EACH ROW EXECUTE FUNCTION preserve_financial_review_content();
ALTER TABLE financial_import_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_import_reviews FORCE ROW LEVEL SECURITY;
CREATE POLICY financial_import_reviews_company_scope ON financial_import_reviews USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
