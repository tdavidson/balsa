ALTER TABLE "journal_entries" ADD COLUMN "basis" text DEFAULT 'actual' NOT NULL;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD COLUMN "scenario_id" uuid;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_scenario_id_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."scenarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "journal_entries_basis_index" ON "journal_entries" USING btree ("company_id", "basis", "period");
