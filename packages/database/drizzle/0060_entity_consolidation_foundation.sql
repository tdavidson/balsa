ALTER TABLE "entities" ADD COLUMN "functional_currency" char(3);
ALTER TABLE "entities" ADD COLUMN "consolidation_method" text;
ALTER TABLE "entities" ADD COLUMN "ownership_percent" text;
ALTER TABLE "entities" ADD COLUMN "effective_from" text;
ALTER TABLE "entities" ADD COLUMN "effective_to" text;

CREATE TABLE "intercompany_account_mappings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "from_entity_id" uuid NOT NULL REFERENCES "entities"("id") ON DELETE cascade,
  "to_entity_id" uuid NOT NULL REFERENCES "entities"("id") ON DELETE cascade,
  "receivable_account_id" uuid NOT NULL REFERENCES "chart_accounts"("id") ON DELETE restrict,
  "payable_account_id" uuid NOT NULL REFERENCES "chart_accounts"("id") ON DELETE restrict,
  "effective_from" text NOT NULL,
  "effective_to" text,
  "active" char(1) DEFAULT 'Y' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "intercompany_mapping_scope_unique" ON "intercompany_account_mappings" USING btree ("company_id","from_entity_id","to_entity_id","effective_from");
CREATE INDEX "intercompany_mapping_company_index" ON "intercompany_account_mappings" USING btree ("company_id","active");
