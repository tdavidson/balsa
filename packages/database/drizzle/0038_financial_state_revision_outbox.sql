ALTER TABLE "companies" ADD COLUMN "financial_state_revision" text DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "calculation_runs" ADD COLUMN "financial_state_revision" text DEFAULT '0' NOT NULL;--> statement-breakpoint
CREATE TABLE "calculation_outbox" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "financial_state_revision" text NOT NULL,
  "engine_version" text NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "calculation_run_id" uuid,
  "error" text,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "calculation_outbox" ADD CONSTRAINT "calculation_outbox_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calculation_outbox" ADD CONSTRAINT "calculation_outbox_calculation_run_id_calculation_runs_id_fk" FOREIGN KEY ("calculation_run_id") REFERENCES "public"."calculation_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calculation_runs_revision_index" ON "calculation_runs" USING btree ("company_id", "financial_state_revision");--> statement-breakpoint
CREATE INDEX "calculation_outbox_company_index" ON "calculation_outbox" USING btree ("company_id", "created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "calculation_outbox_revision_unique" ON "calculation_outbox" USING btree ("company_id", "financial_state_revision", "engine_version");
