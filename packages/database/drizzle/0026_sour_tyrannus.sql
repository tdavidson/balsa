ALTER TABLE "sources" ADD COLUMN "ingestion_status" text DEFAULT 'stored' NOT NULL;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "ingestion_error" text;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "processed_at" timestamp with time zone;