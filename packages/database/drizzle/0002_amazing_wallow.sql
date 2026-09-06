ALTER TABLE "evidence" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "evidence" ALTER COLUMN "status" SET DEFAULT 'pending'::text;--> statement-breakpoint
DROP TYPE "public"."evidence_status";--> statement-breakpoint
CREATE TYPE "public"."evidence_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
ALTER TABLE "evidence" ALTER COLUMN "status" SET DEFAULT 'pending'::"public"."evidence_status";--> statement-breakpoint
ALTER TABLE "evidence" ALTER COLUMN "status" SET DATA TYPE "public"."evidence_status" USING "status"::"public"."evidence_status";