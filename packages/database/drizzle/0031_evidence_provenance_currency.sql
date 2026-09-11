ALTER TABLE "evidence" ADD COLUMN "currency" char(3);
ALTER TABLE "fact_records" ADD COLUMN "source_location" text;
ALTER TABLE "fact_records" ADD COLUMN "currency" char(3);
ALTER TABLE "cash_events" ADD COLUMN "source_location" text;
ALTER TABLE "cash_events" ADD COLUMN "currency" char(3);

CREATE INDEX "evidence_currency_index" ON "evidence" USING btree ("company_id", "currency");
CREATE INDEX "cash_events_currency_index" ON "cash_events" USING btree ("company_id", "currency");
