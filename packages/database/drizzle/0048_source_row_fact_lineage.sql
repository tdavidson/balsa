ALTER TABLE "source_rows" ADD COLUMN "fact_id" uuid REFERENCES "fact_records"("id") ON DELETE set null;
CREATE INDEX "source_rows_fact_index" ON "source_rows" ("fact_id");
