ALTER TABLE "cash_events" ADD COLUMN "category" text DEFAULT 'operating' NOT NULL;--> statement-breakpoint
ALTER TABLE "cash_events" ADD COLUMN "accounting_treatment" text DEFAULT 'cash' NOT NULL;--> statement-breakpoint
ALTER TABLE "economic_items" ADD COLUMN "accounting_treatment" text DEFAULT 'cash' NOT NULL;--> statement-breakpoint
ALTER TABLE "economic_items" ADD COLUMN "recognition_start" text;--> statement-breakpoint
ALTER TABLE "economic_items" ADD COLUMN "recognition_end" text;