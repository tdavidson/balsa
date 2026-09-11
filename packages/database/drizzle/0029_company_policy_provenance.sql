ALTER TABLE "policies" ADD COLUMN "source_id" uuid;
ALTER TABLE "policies" ADD COLUMN "scope" text DEFAULT 'company' NOT NULL;
ALTER TABLE "policies" ADD COLUMN "effective_from" timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE "policies" ADD COLUMN "confidence" text DEFAULT '1.0' NOT NULL;
ALTER TABLE "policies" ADD CONSTRAINT "policies_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE set null ON UPDATE no action;
CREATE INDEX "policies_source_index" ON "policies" USING btree ("source_id");
