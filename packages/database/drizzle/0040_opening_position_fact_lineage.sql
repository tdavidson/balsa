ALTER TABLE "opening_positions" ADD COLUMN "fact_id" uuid;--> statement-breakpoint
ALTER TABLE "opening_positions" ADD CONSTRAINT "opening_positions_fact_id_fact_records_id_fk" FOREIGN KEY ("fact_id") REFERENCES "public"."fact_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "opening_positions_fact_index" ON "opening_positions" USING btree ("fact_id");
