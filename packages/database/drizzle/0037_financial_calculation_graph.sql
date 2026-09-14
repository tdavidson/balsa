CREATE TABLE "calculation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"engine_version" text NOT NULL,
	"input_hash" text NOT NULL,
	"as_of_month" text NOT NULL,
	"horizon_start" text NOT NULL,
	"horizon_end" text NOT NULL,
	"entity_id" uuid,
	"scenario_id" uuid,
	"input_json" text NOT NULL,
	"output_json" text NOT NULL,
	"verification_status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calculation_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"calculation_run_id" uuid NOT NULL,
	"node_key" text NOT NULL,
	"kind" text NOT NULL,
	"month" text NOT NULL,
	"label" text NOT NULL,
	"formula" text NOT NULL,
	"formula_version" text NOT NULL,
	"value_json" text NOT NULL,
	"input_node_ids" text NOT NULL,
	"line_ids" text NOT NULL,
	"provenance" text NOT NULL,
	"verification_status" text NOT NULL,
	"verification_reasons" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "calculation_runs" ADD CONSTRAINT "calculation_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "calculation_runs" ADD CONSTRAINT "calculation_runs_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "calculation_runs" ADD CONSTRAINT "calculation_runs_scenario_id_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."scenarios"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "calculation_nodes" ADD CONSTRAINT "calculation_nodes_calculation_run_id_calculation_runs_id_fk" FOREIGN KEY ("calculation_run_id") REFERENCES "public"."calculation_runs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "calculation_runs_company_index" ON "calculation_runs" USING btree ("company_id","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "calculation_runs_input_unique" ON "calculation_runs" USING btree ("company_id","engine_version","input_hash");
--> statement-breakpoint
CREATE INDEX "calculation_nodes_run_index" ON "calculation_nodes" USING btree ("calculation_run_id","month");
--> statement-breakpoint
CREATE UNIQUE INDEX "calculation_nodes_unique" ON "calculation_nodes" USING btree ("calculation_run_id","node_key");
