CREATE TABLE "forecast_entry_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "name" text NOT NULL,
  "item_type" text NOT NULL,
  "direction" "cash_event_direction" NOT NULL,
  "category" text,
  "debit_account_id" uuid NOT NULL,
  "credit_account_id" uuid NOT NULL,
  "decision_id" uuid,
  "policy_id" uuid,
  "active" char(1) DEFAULT 'Y' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "forecast_entry_templates" ADD CONSTRAINT "forecast_entry_templates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_entry_templates" ADD CONSTRAINT "forecast_entry_templates_debit_account_id_chart_accounts_id_fk" FOREIGN KEY ("debit_account_id") REFERENCES "public"."chart_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_entry_templates" ADD CONSTRAINT "forecast_entry_templates_credit_account_id_chart_accounts_id_fk" FOREIGN KEY ("credit_account_id") REFERENCES "public"."chart_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "forecast_entry_templates_company_index" ON "forecast_entry_templates" USING btree ("company_id", "active");
