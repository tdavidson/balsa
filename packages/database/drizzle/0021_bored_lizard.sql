CREATE TABLE "llm_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"user_id" uuid,
	"run_id" uuid,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"model" text,
	"sequence" text,
	"metadata" text DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"user_id" uuid,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"operation" text NOT NULL,
	"input_tokens" text,
	"output_tokens" text,
	"total_tokens" text,
	"cost" text,
	"latency_ms" text,
	"status" text NOT NULL,
	"request_json" text,
	"response_text" text,
	"error" text,
	"metadata" text DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "llm_messages" ADD CONSTRAINT "llm_messages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_messages" ADD CONSTRAINT "llm_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_messages" ADD CONSTRAINT "llm_messages_run_id_llm_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."llm_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_runs" ADD CONSTRAINT "llm_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_runs" ADD CONSTRAINT "llm_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "llm_messages_company_index" ON "llm_messages" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "llm_messages_run_index" ON "llm_messages" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "llm_runs_company_index" ON "llm_runs" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "llm_runs_model_index" ON "llm_runs" USING btree ("model","created_at");