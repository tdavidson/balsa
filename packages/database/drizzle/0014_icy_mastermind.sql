ALTER TABLE "cash_events" ADD COLUMN "source_id" uuid;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "source_id" uuid;--> statement-breakpoint
ALTER TABLE "cash_events" ADD CONSTRAINT "cash_events_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;