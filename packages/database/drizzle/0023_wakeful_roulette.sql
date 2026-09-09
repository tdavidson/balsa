ALTER TABLE "evidence" ADD COLUMN "account_holder" text;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "account_identifier" text;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "statement_period_start" date;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "statement_period_end" date;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "opening_balance" text;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "ending_balance" text;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "account_entity_id" uuid;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_account_entity_id_entities_id_fk" FOREIGN KEY ("account_entity_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;