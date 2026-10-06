CREATE TABLE operating_trigger_rules (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 prediction_id uuid NOT NULL, supersedes_id uuid, name text NOT NULL, definition jsonb NOT NULL, reason text NOT NULL,
 request_key uuid NOT NULL, request_hash text NOT NULL, actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id), UNIQUE(company_id,request_key), UNIQUE(company_id,supersedes_id),
 FOREIGN KEY(company_id,prediction_id) REFERENCES operating_predictions(company_id,id) ON DELETE CASCADE,
 FOREIGN KEY(company_id,supersedes_id) REFERENCES operating_trigger_rules(company_id,id)
);
CREATE INDEX operating_trigger_rules_prediction ON operating_trigger_rules(company_id,prediction_id);
CREATE TABLE operating_trigger_evaluations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 rule_id uuid NOT NULL, sequence integer NOT NULL CHECK(sequence>0), fingerprint text NOT NULL, snapshot jsonb NOT NULL, review_id uuid,
 request_key uuid NOT NULL, request_hash text NOT NULL, actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id), UNIQUE(company_id,request_key), UNIQUE(company_id,rule_id,sequence),
 FOREIGN KEY(company_id,rule_id) REFERENCES operating_trigger_rules(company_id,id) ON DELETE CASCADE,
 FOREIGN KEY(company_id,review_id) REFERENCES operating_trigger_evaluations(company_id,id)
);
CREATE INDEX operating_trigger_evaluations_review ON operating_trigger_evaluations(company_id,review_id);
CREATE TABLE operating_trigger_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 review_id uuid NOT NULL, evaluation_id uuid NOT NULL, supersedes_id uuid,
 status text NOT NULL CHECK(status IN ('open','acknowledged','snoozed','resolved','superseded')), snooze_until text, reason text NOT NULL,
 request_key uuid NOT NULL, request_hash text NOT NULL, actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id), UNIQUE(company_id,request_key), UNIQUE(company_id,supersedes_id),
 FOREIGN KEY(company_id,review_id) REFERENCES operating_trigger_evaluations(company_id,id) ON DELETE CASCADE,
 FOREIGN KEY(company_id,evaluation_id) REFERENCES operating_trigger_evaluations(company_id,id) ON DELETE CASCADE,
 FOREIGN KEY(company_id,supersedes_id) REFERENCES operating_trigger_events(company_id,id),
 CHECK((status='snoozed') = (snooze_until IS NOT NULL))
);
CREATE UNIQUE INDEX operating_trigger_events_first ON operating_trigger_events(company_id,review_id) WHERE supersedes_id IS NULL;
CREATE INDEX operating_trigger_events_review ON operating_trigger_events(company_id,review_id);
CREATE INDEX operating_trigger_events_evaluation ON operating_trigger_events(company_id,evaluation_id);
CREATE TRIGGER operating_trigger_rules_immutable BEFORE UPDATE ON operating_trigger_rules FOR EACH ROW EXECUTE FUNCTION preserve_financial_review_content();
CREATE TRIGGER operating_trigger_evaluations_immutable BEFORE UPDATE ON operating_trigger_evaluations FOR EACH ROW EXECUTE FUNCTION preserve_financial_review_content();
CREATE TRIGGER operating_trigger_events_immutable BEFORE UPDATE ON operating_trigger_events FOR EACH ROW EXECUTE FUNCTION preserve_financial_review_content();
ALTER TABLE operating_trigger_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE operating_trigger_rules FORCE ROW LEVEL SECURITY;
CREATE POLICY operating_trigger_rules_scope ON operating_trigger_rules USING(app_current_company_id() IS NULL OR company_id=app_current_company_id()) WITH CHECK(app_current_company_id() IS NULL OR company_id=app_current_company_id());
ALTER TABLE operating_trigger_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE operating_trigger_evaluations FORCE ROW LEVEL SECURITY;
CREATE POLICY operating_trigger_evaluations_scope ON operating_trigger_evaluations USING(app_current_company_id() IS NULL OR company_id=app_current_company_id()) WITH CHECK(app_current_company_id() IS NULL OR company_id=app_current_company_id());
ALTER TABLE operating_trigger_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE operating_trigger_events FORCE ROW LEVEL SECURITY;
CREATE POLICY operating_trigger_events_scope ON operating_trigger_events USING(app_current_company_id() IS NULL OR company_id=app_current_company_id()) WITH CHECK(app_current_company_id() IS NULL OR company_id=app_current_company_id());
