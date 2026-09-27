CREATE TABLE forecast_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  occurrence_key text NOT NULL, version integer NOT NULL DEFAULT 1 CHECK (version > 0), definition jsonb NOT NULL,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id)
);
CREATE UNIQUE INDEX forecast_occurrences_key ON forecast_occurrences(company_id, occurrence_key);
--> statement-breakpoint
CREATE TABLE forecast_settlement_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  occurrence_id uuid NOT NULL, actual_entry_id uuid NOT NULL REFERENCES journal_entries(id),
  amount_minor text NOT NULL CHECK (amount_minor ~ '^[1-9][0-9]{0,29}$'), revoked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, occurrence_id) REFERENCES forecast_occurrences(company_id, id)
);
CREATE INDEX forecast_settlement_occurrence ON forecast_settlement_allocations(company_id, occurrence_id);
CREATE INDEX forecast_settlement_actual ON forecast_settlement_allocations(company_id, actual_entry_id);
--> statement-breakpoint
CREATE TABLE cash_coverage_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES chart_accounts(id) ON DELETE CASCADE,
  start_date date NOT NULL, through_date date NOT NULL CHECK (through_date >= start_date),
  status text NOT NULL CHECK (status IN ('complete', 'partial', 'revoked')), reason text NOT NULL,
  evidence_id uuid REFERENCES evidence(id) ON DELETE SET NULL, evidence_hash text, ledger_hash text NOT NULL,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cash_coverage_account ON cash_coverage_records(company_id, account_id, created_at);
--> statement-breakpoint
CREATE TABLE forecast_review_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  request_key uuid NOT NULL, request_hash text NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX forecast_review_commands_request ON forecast_review_commands(company_id, request_key);
--> statement-breakpoint
ALTER TABLE forecast_occurrences ENABLE ROW LEVEL SECURITY;
ALTER TABLE forecast_occurrences FORCE ROW LEVEL SECURITY;
CREATE POLICY forecast_occurrences_company_scope ON forecast_occurrences USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
ALTER TABLE forecast_settlement_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE forecast_settlement_allocations FORCE ROW LEVEL SECURITY;
CREATE POLICY forecast_settlement_allocations_company_scope ON forecast_settlement_allocations USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
ALTER TABLE cash_coverage_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_coverage_records FORCE ROW LEVEL SECURITY;
CREATE POLICY cash_coverage_records_company_scope ON cash_coverage_records USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
ALTER TABLE forecast_review_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE forecast_review_commands FORCE ROW LEVEL SECURITY;
CREATE POLICY forecast_review_commands_company_scope ON forecast_review_commands USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
