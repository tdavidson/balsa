ALTER TABLE "decisions" ADD COLUMN "effect" text;--> statement-breakpoint
ALTER TABLE "assumptions" ADD COLUMN "scenario_id" uuid;--> statement-breakpoint
ALTER TABLE "assumptions" ADD COLUMN "decision_id" uuid;--> statement-breakpoint
ALTER TABLE "assumptions" ADD COLUMN "effective_from" text;--> statement-breakpoint
ALTER TABLE "assumptions" ADD COLUMN "effective_to" text;--> statement-breakpoint
ALTER TABLE "economic_items" ADD COLUMN "effective_from" text;--> statement-breakpoint
ALTER TABLE "economic_items" ADD COLUMN "effective_to" text;--> statement-breakpoint
ALTER TABLE "economic_items" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "economic_items" ADD COLUMN "basis" text DEFAULT 'contractual' NOT NULL;--> statement-breakpoint
ALTER TABLE "economic_items" ADD COLUMN "counterparty_entity_id" uuid;--> statement-breakpoint
ALTER TABLE "economic_items" ADD COLUMN "scenario_id" uuid;--> statement-breakpoint
ALTER TABLE "economic_items" ADD COLUMN "assumption_id" uuid;--> statement-breakpoint
ALTER TABLE "economic_items" ADD COLUMN "decision_id" uuid;--> statement-breakpoint
ALTER TABLE "economic_items" ADD COLUMN "confidence" text;--> statement-breakpoint
ALTER TABLE "economic_items" ADD COLUMN "rationale" text;--> statement-breakpoint
ALTER TABLE "cash_events" ADD COLUMN "financial_category" text;--> statement-breakpoint
ALTER TABLE "cash_events" ADD COLUMN "counterparty_entity_id" uuid;--> statement-breakpoint
ALTER TABLE "cash_events" ADD COLUMN "settles_item_id" uuid;--> statement-breakpoint
ALTER TABLE "allocations" ADD COLUMN "item_id" uuid;--> statement-breakpoint
ALTER TABLE "allocations" ADD COLUMN "counterparty_entity_id" uuid;--> statement-breakpoint
ALTER TABLE "assumptions" ADD CONSTRAINT "assumptions_scenario_id_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."scenarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assumptions" ADD CONSTRAINT "assumptions_decision_id_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."decisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "economic_items" ADD CONSTRAINT "economic_items_counterparty_entity_id_entities_id_fk" FOREIGN KEY ("counterparty_entity_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "economic_items" ADD CONSTRAINT "economic_items_scenario_id_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."scenarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "economic_items" ADD CONSTRAINT "economic_items_assumption_id_assumptions_id_fk" FOREIGN KEY ("assumption_id") REFERENCES "public"."assumptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "economic_items" ADD CONSTRAINT "economic_items_decision_id_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."decisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_events" ADD CONSTRAINT "cash_events_counterparty_entity_id_entities_id_fk" FOREIGN KEY ("counterparty_entity_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_events" ADD CONSTRAINT "cash_events_settles_item_id_economic_items_id_fk" FOREIGN KEY ("settles_item_id") REFERENCES "public"."economic_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_item_id_economic_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."economic_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_counterparty_entity_id_entities_id_fk" FOREIGN KEY ("counterparty_entity_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "economic_items_scenario_index" ON "economic_items" USING btree ("scenario_id");--> statement-breakpoint
CREATE INDEX "cash_events_counterparty_index" ON "cash_events" USING btree ("counterparty_entity_id");
