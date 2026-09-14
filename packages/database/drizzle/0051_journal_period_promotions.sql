CREATE TABLE "journal_period_promotions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "period" text NOT NULL,
  "calculation_run_id" uuid NOT NULL,
  "promoted_by_user_id" uuid NOT NULL,
  "note" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "journal_period_promotions" ADD CONSTRAINT "journal_period_promotions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_period_promotions" ADD CONSTRAINT "journal_period_promotions_calculation_run_id_calculation_runs_id_fk" FOREIGN KEY ("calculation_run_id") REFERENCES "public"."calculation_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_period_promotions" ADD CONSTRAINT "journal_period_promotions_promoted_by_user_id_users_id_fk" FOREIGN KEY ("promoted_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "journal_period_promotions_company_period_unique" ON "journal_period_promotions" USING btree ("company_id", "period");--> statement-breakpoint
CREATE INDEX "journal_period_promotions_company_index" ON "journal_period_promotions" USING btree ("company_id", "created_at");
