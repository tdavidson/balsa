ALTER TABLE "scenarios" ADD COLUMN IF NOT EXISTS "description" text;
--> statement-breakpoint
ALTER TABLE "scenarios" ADD COLUMN IF NOT EXISTS "changes" jsonb DEFAULT '[]'::jsonb NOT NULL;
