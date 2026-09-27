CREATE UNIQUE INDEX economic_items_company_id ON economic_items(company_id, id);
CREATE TABLE recognition_journal_links (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 driver_id uuid NOT NULL REFERENCES economic_items(id), entry_id uuid NOT NULL REFERENCES journal_entries(id),
 source_hash text NOT NULL, reason text NOT NULL, version integer NOT NULL DEFAULT 1 CHECK(version > 0),
 revoked boolean NOT NULL DEFAULT false, actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id, driver_id) REFERENCES economic_items(company_id, id)
);
CREATE UNIQUE INDEX recognition_links_entry ON recognition_journal_links(company_id, entry_id) WHERE NOT revoked;
CREATE INDEX recognition_links_driver ON recognition_journal_links(company_id, driver_id);
ALTER TABLE recognition_journal_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE recognition_journal_links FORCE ROW LEVEL SECURITY;
CREATE POLICY recognition_links_company_scope ON recognition_journal_links USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
