CREATE TABLE "cash_goal_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "goal_id" uuid NOT NULL,
  "version" integer NOT NULL CHECK (version > 0),
  "status" text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  "definition" jsonb NOT NULL,
  "reason" text NOT NULL,
  "actor_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "cash_goal_versions_identity" ON "cash_goal_versions" ("company_id", "goal_id", "version");
CREATE UNIQUE INDEX "cash_goal_versions_company_id" ON "cash_goal_versions" ("company_id", "id");
--> statement-breakpoint
CREATE TABLE "financial_review_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "goal_version_id" uuid NOT NULL,
  "plan_id" uuid,
  "kind" text NOT NULL CHECK (kind IN ('plan', 'review')),
  "name" text NOT NULL,
  "request_key" uuid NOT NULL,
  "request_hash" text NOT NULL,
  "snapshot" jsonb NOT NULL,
  "actor_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "financial_review_snapshots_company_id" UNIQUE (company_id, id),
  CONSTRAINT "financial_review_snapshots_goal_fk" FOREIGN KEY (company_id, goal_version_id) REFERENCES cash_goal_versions(company_id, id),
  CONSTRAINT "financial_review_snapshots_plan_fk" FOREIGN KEY (company_id, plan_id) REFERENCES financial_review_snapshots(company_id, id),
  CONSTRAINT "financial_review_snapshots_kind_plan" CHECK ((kind = 'plan' AND plan_id IS NULL) OR (kind = 'review' AND plan_id IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "financial_review_snapshots_request" ON "financial_review_snapshots" (company_id, request_key);
CREATE INDEX "financial_review_snapshots_goal" ON "financial_review_snapshots" (company_id, goal_version_id, created_at);
CREATE INDEX "financial_review_snapshots_plan" ON "financial_review_snapshots" (company_id, plan_id);
--> statement-breakpoint
-- Preserve snapshot content while allowing actor deletion to null the actor FK.
CREATE FUNCTION preserve_financial_review_content() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'actor_user_id') IS DISTINCT FROM (to_jsonb(OLD) - 'actor_user_id') THEN
    RAISE EXCEPTION 'Financial review records are immutable; create a new version';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER cash_goal_versions_immutable BEFORE UPDATE ON cash_goal_versions FOR EACH ROW EXECUTE FUNCTION preserve_financial_review_content();
CREATE TRIGGER financial_review_snapshots_immutable BEFORE UPDATE ON financial_review_snapshots FOR EACH ROW EXECUTE FUNCTION preserve_financial_review_content();
--> statement-breakpoint
ALTER TABLE cash_goal_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_goal_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY cash_goal_versions_company_scope ON cash_goal_versions USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
ALTER TABLE financial_review_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_review_snapshots FORCE ROW LEVEL SECURITY;
CREATE POLICY financial_review_snapshots_company_scope ON financial_review_snapshots USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
