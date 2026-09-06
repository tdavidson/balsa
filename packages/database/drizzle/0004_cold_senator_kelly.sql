CREATE TYPE "public"."cash_event_direction" AS ENUM('receipt', 'spend');--> statement-breakpoint
CREATE TABLE "cash_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"evidence_id" uuid,
	"month" text NOT NULL,
	"description" text NOT NULL,
	"amount" text NOT NULL,
	"direction" "cash_event_direction" NOT NULL,
	"is_actual" char(1) DEFAULT 'N' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cash_events" ADD CONSTRAINT "cash_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_events" ADD CONSTRAINT "cash_events_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cash_events_company_month_index" ON "cash_events" USING btree ("company_id","month");