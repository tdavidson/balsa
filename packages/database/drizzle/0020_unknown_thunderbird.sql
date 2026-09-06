ALTER TABLE "observations" ADD COLUMN "event_id" uuid;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_event_id_cash_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."cash_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "observations_event_index" ON "observations" USING btree ("event_id");