ALTER TABLE "economic_items" ADD COLUMN IF NOT EXISTS "fact_id" uuid REFERENCES "fact_records"("id") ON DELETE SET NULL;
ALTER TABLE "cash_events" ADD COLUMN IF NOT EXISTS "fact_id" uuid REFERENCES "fact_records"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "economic_items_fact_index" ON "economic_items" USING btree ("fact_id");
CREATE INDEX IF NOT EXISTS "cash_events_fact_index" ON "cash_events" USING btree ("fact_id");
