CREATE TABLE bank_connections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 enrollment_id text NOT NULL, environment text NOT NULL CHECK (environment IN ('sandbox','development','production')), application_id text NOT NULL,
 institution text NOT NULL, encrypted_token text, status text NOT NULL DEFAULT 'active', created_by_user_id uuid NOT NULL REFERENCES users(id),
 last_synced_at timestamptz, next_sync_at timestamptz NOT NULL DEFAULT now(), error text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX bank_connections_enrollment ON bank_connections(environment, application_id, enrollment_id);
CREATE UNIQUE INDEX bank_connections_company_id ON bank_connections(company_id, id);
CREATE INDEX bank_connections_due ON bank_connections(next_sync_at) WHERE encrypted_token IS NOT NULL;
CREATE UNIQUE INDEX chart_accounts_company_id ON chart_accounts(company_id, id);
CREATE TABLE bank_accounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 connection_id uuid NOT NULL REFERENCES bank_connections(id) ON DELETE CASCADE, provider_account_id text NOT NULL,
 name text NOT NULL, last_four text, currency text NOT NULL, account_type text NOT NULL, status text NOT NULL DEFAULT 'open',
 chart_account_id uuid REFERENCES chart_accounts(id), snapshots jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id, connection_id) REFERENCES bank_connections(company_id, id) ON DELETE CASCADE,
 FOREIGN KEY(company_id, chart_account_id) REFERENCES chart_accounts(company_id, id)
);
CREATE UNIQUE INDEX bank_accounts_provider ON bank_accounts(connection_id, provider_account_id);
CREATE TABLE bank_connect_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, nonce text NOT NULL, expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE bank_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_connections FORCE ROW LEVEL SECURITY;
CREATE POLICY bank_connections_company_scope ON bank_connections USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY bank_accounts_company_scope ON bank_accounts USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
ALTER TABLE bank_connect_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_connect_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY bank_connect_sessions_company_scope ON bank_connect_sessions USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
