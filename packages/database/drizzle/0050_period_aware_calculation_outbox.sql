ALTER TABLE "calculation_outbox" ADD COLUMN "period" text DEFAULT 'base' NOT NULL;--> statement-breakpoint
DROP INDEX "calculation_outbox_revision_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "calculation_outbox_revision_unique" ON "calculation_outbox" USING btree ("company_id", "financial_state_revision", "engine_version", "period");
