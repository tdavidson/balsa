-- Standard Financial Model layout: user-defined categories under each Standard
-- statement line, an optional confirmed mapping on each chart account, and the
-- company model timeline. Presentation only: no journal or balance changes.
CREATE TABLE report_categories (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 line text NOT NULL, name text NOT NULL, sort_order integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX report_categories_company_line_name ON report_categories(company_id, line, lower(name));
--> statement-breakpoint
CREATE UNIQUE INDEX report_categories_company_id ON report_categories(company_id, id);
--> statement-breakpoint
ALTER TABLE chart_accounts ADD COLUMN report_line text;
--> statement-breakpoint
ALTER TABLE chart_accounts ADD COLUMN report_category_id uuid;
--> statement-breakpoint
-- Composite key keeps an account and its category in the same company.
ALTER TABLE chart_accounts ADD CONSTRAINT chart_accounts_report_category_fk FOREIGN KEY (company_id, report_category_id) REFERENCES report_categories(company_id, id) ON DELETE SET NULL (report_category_id);
--> statement-breakpoint
ALTER TABLE companies ADD COLUMN model_first_period text;
--> statement-breakpoint
ALTER TABLE companies ADD COLUMN model_last_period text;
--> statement-breakpoint
ALTER TABLE report_categories ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE report_categories FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY report_categories_company_scope ON report_categories USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
