ALTER TABLE "source_rows" ADD COLUMN "row_type" text DEFAULT 'unclassified' NOT NULL;
ALTER TABLE "source_rows" ADD COLUMN "account_name" text;
ALTER TABLE "source_rows" ADD COLUMN "debit_minor" text;
ALTER TABLE "source_rows" ADD COLUMN "credit_minor" text;
CREATE INDEX "source_rows_company_type_index" ON "source_rows" ("company_id", "row_type");
