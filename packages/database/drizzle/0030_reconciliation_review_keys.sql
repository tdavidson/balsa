ALTER TABLE "review_items" ADD COLUMN "review_key" text;
CREATE INDEX "review_items_key_index" ON "review_items" USING btree ("company_id", "review_key");
