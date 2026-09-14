CREATE TABLE "testing_discrepancies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "period" text NOT NULL,
  "statement_section" text NOT NULL,
  "figure_label" text NOT NULL,
  "expected_value" text NOT NULL,
  "observed_value" text NOT NULL,
  "source_evidence" text NOT NULL,
  "graph_node_key" text,
  "suspected_layer" text NOT NULL,
  "fixture_status" text DEFAULT 'not_added' NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "testing_discrepancies_company_period_index" ON "testing_discrepancies" USING btree ("company_id","period","created_at");
CREATE INDEX "testing_discrepancies_status_index" ON "testing_discrepancies" USING btree ("company_id","status");
