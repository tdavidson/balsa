CREATE TYPE "public"."economic_direction" AS ENUM('receipt', 'spend');--> statement-breakpoint
CREATE TYPE "public"."economic_item_status" AS ENUM('draft', 'confirmed', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."economic_item_type" AS ENUM('agreement', 'obligation');--> statement-breakpoint
CREATE TABLE "economic_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"evidence_id" uuid,
	"type" "economic_item_type" NOT NULL,
	"direction" "economic_direction" NOT NULL,
	"label" text NOT NULL,
	"counterparty" text,
	"amount" text,
	"cadence" text,
	"status" "economic_item_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "economic_items" ADD CONSTRAINT "economic_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "economic_items" ADD CONSTRAINT "economic_items_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "economic_items_company_index" ON "economic_items" USING btree ("company_id","status");