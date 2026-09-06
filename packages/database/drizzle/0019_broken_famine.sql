ALTER TABLE "cash_events" ADD COLUMN "policy_id" uuid;--> statement-breakpoint
ALTER TABLE "economic_items" ADD COLUMN "policy_id" uuid;--> statement-breakpoint
ALTER TABLE "cash_events" ADD CONSTRAINT "cash_events_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "economic_items" ADD CONSTRAINT "economic_items_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE set null ON UPDATE no action;