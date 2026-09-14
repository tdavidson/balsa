DROP INDEX "calculation_runs_input_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "calculation_runs_input_unique" ON "calculation_runs" USING btree ("company_id", "financial_state_revision", "engine_version", "input_hash");
