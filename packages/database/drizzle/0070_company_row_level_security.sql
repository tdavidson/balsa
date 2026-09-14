-- Defense in depth: the application always filters by the authorized company,
-- and Postgres refuses to serve or accept anything else. The scope is the
-- transaction-local `app.company_id` GUC set by withCompanyTransaction(); when
-- it is unset every policy is permissive, so migrations, the CLI and any code
-- path that has not adopted the scope keep working unchanged.
-- NOTE: a superuser (and the postgres role used locally) bypasses RLS entirely.
-- Enforcement only happens for a non-superuser application role.
CREATE OR REPLACE FUNCTION app_current_company_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.company_id', true), '')::uuid
$$;
--> statement-breakpoint
ALTER TABLE "llm_runs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "llm_runs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "llm_runs_company_scope" ON "llm_runs";
--> statement-breakpoint
CREATE POLICY "llm_runs_company_scope" ON "llm_runs" USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
--> statement-breakpoint
ALTER TABLE "llm_messages" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "llm_messages" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "llm_messages_company_scope" ON "llm_messages";
--> statement-breakpoint
CREATE POLICY "llm_messages_company_scope" ON "llm_messages" USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
--> statement-breakpoint
ALTER TABLE "sources" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "sources" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "sources_company_scope" ON "sources";
--> statement-breakpoint
CREATE POLICY "sources_company_scope" ON "sources" USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
--> statement-breakpoint
ALTER TABLE "ingestion_runs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ingestion_runs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "ingestion_runs_company_scope" ON "ingestion_runs";
--> statement-breakpoint
CREATE POLICY "ingestion_runs_company_scope" ON "ingestion_runs" USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
--> statement-breakpoint
ALTER TABLE "observations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "observations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "observations_company_scope" ON "observations";
--> statement-breakpoint
CREATE POLICY "observations_company_scope" ON "observations" USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
--> statement-breakpoint
ALTER TABLE "entities" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "entities" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "entities_company_scope" ON "entities";
--> statement-breakpoint
CREATE POLICY "entities_company_scope" ON "entities" USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
--> statement-breakpoint
ALTER TABLE "opening_positions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "opening_positions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "opening_positions_company_scope" ON "opening_positions";
--> statement-breakpoint
CREATE POLICY "opening_positions_company_scope" ON "opening_positions" USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
--> statement-breakpoint
ALTER TABLE "calculation_runs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "calculation_runs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "calculation_runs_company_scope" ON "calculation_runs";
--> statement-breakpoint
CREATE POLICY "calculation_runs_company_scope" ON "calculation_runs" USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
--> statement-breakpoint
ALTER TABLE "calculation_outbox" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "calculation_outbox" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "calculation_outbox_company_scope" ON "calculation_outbox";
--> statement-breakpoint
CREATE POLICY "calculation_outbox_company_scope" ON "calculation_outbox" USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
--> statement-breakpoint
ALTER TABLE "testing_discrepancies" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "testing_discrepancies" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "testing_discrepancies_company_scope" ON "testing_discrepancies";
--> statement-breakpoint
CREATE POLICY "testing_discrepancies_company_scope" ON "testing_discrepancies" USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
--> statement-breakpoint
ALTER TABLE "journal_period_promotions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "journal_period_promotions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "journal_period_promotions_company_scope" ON "journal_period_promotions";
--> statement-breakpoint
CREATE POLICY "journal_period_promotions_company_scope" ON "journal_period_promotions" USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
--> statement-breakpoint
ALTER TABLE "journal_period_closures" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "journal_period_closures" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "journal_period_closures_company_scope" ON "journal_period_closures";
--> statement-breakpoint
CREATE POLICY "journal_period_closures_company_scope" ON "journal_period_closures" USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
--> statement-breakpoint
ALTER TABLE "relationships" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "relationships" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "relationships_company_scope" ON "relationships";
--> statement-breakpoint
CREATE POLICY "relationships_company_scope" ON "relationships" USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
--> statement-breakpoint
ALTER TABLE "assumptions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "assumptions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "assumptions_company_scope" ON "assumptions";
--> statement-breakpoint
CREATE POLICY "assumptions_company_scope" ON "assumptions" USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
--> statement-breakpoint
ALTER TABLE "scenarios" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "scenarios" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "scenarios_company_scope" ON "scenarios";
--> statement-breakpoint
CREATE POLICY "scenarios_company_scope" ON "scenarios" USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
--> statement-breakpoint
ALTER TABLE "knowledge_documents" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "knowledge_documents" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "knowledge_documents_company_scope" ON "knowledge_documents";
--> statement-breakpoint
CREATE POLICY "knowledge_documents_company_scope" ON "knowledge_documents" USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
--> statement-breakpoint
ALTER TABLE "decisions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "decisions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "decisions_company_scope" ON "decisions";
--> statement-breakpoint
CREATE POLICY "decisions_company_scope" ON "decisions" USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
--> statement-breakpoint
ALTER TABLE "policies" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "policies" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "policies_company_scope" ON "policies";
--> statement-breakpoint
CREATE POLICY "policies_company_scope" ON "policies" USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
--> statement-breakpoint
ALTER TABLE "evidence" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "evidence" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "evidence_company_scope" ON "evidence";
--> statement-breakpoint
CREATE POLICY "evidence_company_scope" ON "evidence" USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
--> statement-breakpoint
ALTER TABLE "review_items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "review_items" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "review_items_company_scope" ON "review_items";
--> statement-breakpoint
CREATE POLICY "review_items_company_scope" ON "review_items" USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
--> statement-breakpoint
ALTER TABLE "fact_records" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "fact_records" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "fact_records_company_scope" ON "fact_records";
--> statement-breakpoint
CREATE POLICY "fact_records_company_scope" ON "fact_records" USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
--> statement-breakpoint
ALTER TABLE "approval_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "approval_events" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "approval_events_company_scope" ON "approval_events";
--> statement-breakpoint
CREATE POLICY "approval_events_company_scope" ON "approval_events" USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
--> statement-breakpoint
ALTER TABLE "source_rows" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "source_rows" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "source_rows_company_scope" ON "source_rows";
--> statement-breakpoint
CREATE POLICY "source_rows_company_scope" ON "source_rows" USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
--> statement-breakpoint
ALTER TABLE "chart_accounts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "chart_accounts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "chart_accounts_company_scope" ON "chart_accounts";
--> statement-breakpoint
CREATE POLICY "chart_accounts_company_scope" ON "chart_accounts" USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
--> statement-breakpoint
ALTER TABLE "intercompany_account_mappings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "intercompany_account_mappings" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "intercompany_account_mappings_company_scope" ON "intercompany_account_mappings";
--> statement-breakpoint
CREATE POLICY "intercompany_account_mappings_company_scope" ON "intercompany_account_mappings" USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
--> statement-breakpoint
ALTER TABLE "journal_batches" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "journal_batches" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "journal_batches_company_scope" ON "journal_batches";
--> statement-breakpoint
CREATE POLICY "journal_batches_company_scope" ON "journal_batches" USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
--> statement-breakpoint
ALTER TABLE "journal_entries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "journal_entries" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "journal_entries_company_scope" ON "journal_entries";
--> statement-breakpoint
CREATE POLICY "journal_entries_company_scope" ON "journal_entries" USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
--> statement-breakpoint
ALTER TABLE "journal_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "journal_lines" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "journal_lines_company_scope" ON "journal_lines";
--> statement-breakpoint
CREATE POLICY "journal_lines_company_scope" ON "journal_lines" USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
--> statement-breakpoint
ALTER TABLE "intercompany_elimination_entries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "intercompany_elimination_entries" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "intercompany_elimination_entries_company_scope" ON "intercompany_elimination_entries";
--> statement-breakpoint
CREATE POLICY "intercompany_elimination_entries_company_scope" ON "intercompany_elimination_entries" USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
--> statement-breakpoint
ALTER TABLE "fx_rate_sets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "fx_rate_sets" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "fx_rate_sets_company_scope" ON "fx_rate_sets";
--> statement-breakpoint
CREATE POLICY "fx_rate_sets_company_scope" ON "fx_rate_sets" USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
--> statement-breakpoint
ALTER TABLE "fx_rates" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "fx_rates" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "fx_rates_company_scope" ON "fx_rates";
--> statement-breakpoint
CREATE POLICY "fx_rates_company_scope" ON "fx_rates" USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
--> statement-breakpoint
ALTER TABLE "fx_translation_policies" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "fx_translation_policies" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "fx_translation_policies_company_scope" ON "fx_translation_policies";
--> statement-breakpoint
CREATE POLICY "fx_translation_policies_company_scope" ON "fx_translation_policies" USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
--> statement-breakpoint
ALTER TABLE "fx_remeasurement_entries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "fx_remeasurement_entries" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "fx_remeasurement_entries_company_scope" ON "fx_remeasurement_entries";
--> statement-breakpoint
CREATE POLICY "fx_remeasurement_entries_company_scope" ON "fx_remeasurement_entries" USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
--> statement-breakpoint
ALTER TABLE "journal_line_lineage" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "journal_line_lineage" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "journal_line_lineage_company_scope" ON "journal_line_lineage";
--> statement-breakpoint
CREATE POLICY "journal_line_lineage_company_scope" ON "journal_line_lineage" USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
--> statement-breakpoint
ALTER TABLE "journal_period_close_entries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "journal_period_close_entries" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "journal_period_close_entries_company_scope" ON "journal_period_close_entries";
--> statement-breakpoint
CREATE POLICY "journal_period_close_entries_company_scope" ON "journal_period_close_entries" USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
--> statement-breakpoint
ALTER TABLE "posting_proposals" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "posting_proposals" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "posting_proposals_company_scope" ON "posting_proposals";
--> statement-breakpoint
CREATE POLICY "posting_proposals_company_scope" ON "posting_proposals" USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
--> statement-breakpoint
ALTER TABLE "posting_rules" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "posting_rules" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "posting_rules_company_scope" ON "posting_rules";
--> statement-breakpoint
CREATE POLICY "posting_rules_company_scope" ON "posting_rules" USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
--> statement-breakpoint
ALTER TABLE "posting_rule_applications" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "posting_rule_applications" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "posting_rule_applications_company_scope" ON "posting_rule_applications";
--> statement-breakpoint
CREATE POLICY "posting_rule_applications_company_scope" ON "posting_rule_applications" USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
--> statement-breakpoint
ALTER TABLE "source_row_mappings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "source_row_mappings" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "source_row_mappings_company_scope" ON "source_row_mappings";
--> statement-breakpoint
CREATE POLICY "source_row_mappings_company_scope" ON "source_row_mappings" USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
--> statement-breakpoint
ALTER TABLE "forecast_entry_templates" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "forecast_entry_templates" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "forecast_entry_templates_company_scope" ON "forecast_entry_templates";
--> statement-breakpoint
CREATE POLICY "forecast_entry_templates_company_scope" ON "forecast_entry_templates" USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
--> statement-breakpoint
ALTER TABLE "economic_items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "economic_items" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "economic_items_company_scope" ON "economic_items";
--> statement-breakpoint
CREATE POLICY "economic_items_company_scope" ON "economic_items" USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
--> statement-breakpoint
ALTER TABLE "cash_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "cash_events" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "cash_events_company_scope" ON "cash_events";
--> statement-breakpoint
CREATE POLICY "cash_events_company_scope" ON "cash_events" USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
--> statement-breakpoint
ALTER TABLE "reconciliation_entries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "reconciliation_entries" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "reconciliation_entries_company_scope" ON "reconciliation_entries";
--> statement-breakpoint
CREATE POLICY "reconciliation_entries_company_scope" ON "reconciliation_entries" USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
--> statement-breakpoint
ALTER TABLE "reporting_periods" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "reporting_periods" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "reporting_periods_company_scope" ON "reporting_periods";
--> statement-breakpoint
CREATE POLICY "reporting_periods_company_scope" ON "reporting_periods" USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
--> statement-breakpoint
ALTER TABLE "allocations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "allocations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "allocations_company_scope" ON "allocations";
--> statement-breakpoint
CREATE POLICY "allocations_company_scope" ON "allocations" USING (app_current_company_id() IS NULL OR company_id = app_current_company_id()) WITH CHECK (app_current_company_id() IS NULL OR company_id = app_current_company_id());
--> statement-breakpoint
-- calculation_nodes carries no company_id; it is owned through calculation_runs.
ALTER TABLE "calculation_nodes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "calculation_nodes" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "calculation_nodes_company_scope" ON "calculation_nodes";
--> statement-breakpoint
CREATE POLICY "calculation_nodes_company_scope" ON "calculation_nodes" USING (app_current_company_id() IS NULL OR EXISTS (SELECT 1 FROM "calculation_runs" WHERE "calculation_runs"."id" = "calculation_nodes"."calculation_run_id" AND "calculation_runs"."company_id" = app_current_company_id())) WITH CHECK (app_current_company_id() IS NULL OR EXISTS (SELECT 1 FROM "calculation_runs" WHERE "calculation_runs"."id" = "calculation_nodes"."calculation_run_id" AND "calculation_runs"."company_id" = app_current_company_id()));
