ALTER TABLE "journal_lines" ADD COLUMN "transaction_currency" char(3);
ALTER TABLE "journal_lines" ADD COLUMN "transaction_debit_minor" text;
ALTER TABLE "journal_lines" ADD COLUMN "transaction_credit_minor" text;
ALTER TABLE "journal_lines" ADD COLUMN "fx_rate_id" uuid REFERENCES "fx_rates"("id") ON DELETE restrict;
CREATE INDEX "journal_lines_fx_rate_index" ON "journal_lines" USING btree ("fx_rate_id");
