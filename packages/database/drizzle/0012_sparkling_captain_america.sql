CREATE TABLE "fact_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"evidence_id" uuid NOT NULL,
	"label" text NOT NULL,
	"value" text NOT NULL,
	"confidence" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fact_records" ADD CONSTRAINT "fact_records_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_records" ADD CONSTRAINT "fact_records_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fact_records_company_index" ON "fact_records" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "fact_records_evidence_index" ON "fact_records" USING btree ("evidence_id");