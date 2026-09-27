CREATE UNIQUE INDEX journal_entries_company_id ON journal_entries(company_id, id);
ALTER TABLE recognition_journal_links ADD CONSTRAINT recognition_links_entry_scope FOREIGN KEY(company_id, entry_id) REFERENCES journal_entries(company_id, id);
ALTER TABLE economic_items ADD COLUMN expected_day integer CHECK(expected_day BETWEEN 1 AND 31);
CREATE TABLE financial_work_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('cycle','accuracy','sensitivity')), name text NOT NULL,
 scope jsonb NOT NULL, snapshot jsonb NOT NULL, snapshot_hash text NOT NULL,
 preparer_user_id uuid NOT NULL REFERENCES users(id), reviewer_user_id uuid REFERENCES users(id),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','signed','reopened')),
 version integer NOT NULL DEFAULT 1 CHECK(version > 0), request_key uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id, id), UNIQUE(company_id, request_key)
);
CREATE TABLE financial_review_tasks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 review_id uuid NOT NULL, subject_key text NOT NULL, title text NOT NULL, assignee_user_id uuid REFERENCES users(id),
 due_date date, status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved','waived')), resolution text,
 version integer NOT NULL DEFAULT 1 CHECK(version > 0), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id, review_id) REFERENCES financial_work_reviews(company_id, id) ON DELETE CASCADE,
 UNIQUE(company_id, review_id, subject_key)
);
CREATE TABLE financial_review_signoffs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 review_id uuid NOT NULL, reviewer_user_id uuid NOT NULL REFERENCES users(id), snapshot_hash text NOT NULL,
 reason text NOT NULL, self_review boolean NOT NULL, snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id, review_id) REFERENCES financial_work_reviews(company_id, id) ON DELETE CASCADE
);
CREATE TRIGGER financial_review_signoffs_immutable BEFORE UPDATE ON financial_review_signoffs FOR EACH ROW EXECUTE FUNCTION preserve_financial_review_content();
CREATE INDEX financial_work_reviews_company ON financial_work_reviews(company_id, created_at);
CREATE INDEX financial_review_tasks_assignee ON financial_review_tasks(company_id, assignee_user_id, status, due_date);
CREATE INDEX financial_review_signoffs_review ON financial_review_signoffs(company_id, review_id);
ALTER TABLE financial_work_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_work_reviews FORCE ROW LEVEL SECURITY;
ALTER TABLE financial_review_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_review_tasks FORCE ROW LEVEL SECURITY;
ALTER TABLE financial_review_signoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_review_signoffs FORCE ROW LEVEL SECURITY;
CREATE POLICY financial_work_reviews_scope ON financial_work_reviews USING(app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK(app_current_company_id() IS NULL OR company_id = app_current_company_id());
CREATE POLICY financial_review_tasks_scope ON financial_review_tasks USING(app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK(app_current_company_id() IS NULL OR company_id = app_current_company_id());
CREATE POLICY financial_review_signoffs_scope ON financial_review_signoffs USING(app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK(app_current_company_id() IS NULL OR company_id = app_current_company_id());
