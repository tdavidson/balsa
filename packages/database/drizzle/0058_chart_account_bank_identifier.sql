ALTER TABLE "chart_accounts" ADD COLUMN "bank_account_identifier" text;
--> statement-breakpoint
CREATE UNIQUE INDEX "chart_accounts_company_bank_identifier_unique" ON "chart_accounts" USING btree ("company_id", "bank_account_identifier");
