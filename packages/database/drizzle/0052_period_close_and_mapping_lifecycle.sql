ALTER TABLE "source_row_mappings" ADD COLUMN "effective_from" text;--> statement-breakpoint
ALTER TABLE "source_row_mappings" ADD COLUMN "effective_to" text;--> statement-breakpoint
ALTER TABLE "source_row_mappings" ADD COLUMN "supersedes_id" uuid;--> statement-breakpoint
ALTER TABLE "source_row_mappings" ADD COLUMN "approved_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "source_row_mappings" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "source_row_mappings" ADD CONSTRAINT "source_row_mappings_supersedes_id_source_row_mappings_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."source_row_mappings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_row_mappings" ADD CONSTRAINT "source_row_mappings_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "source_row_mappings_scope_index" ON "source_row_mappings" USING btree ("company_id", "mapping_type", "effective_from", "effective_to");--> statement-breakpoint
CREATE TABLE "journal_period_closures" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "period" text NOT NULL,
  "promotion_id" uuid NOT NULL,
  "closed_by_user_id" uuid NOT NULL,
  "note" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "journal_period_closures" ADD CONSTRAINT "journal_period_closures_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_period_closures" ADD CONSTRAINT "journal_period_closures_promotion_id_journal_period_promotions_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "public"."journal_period_promotions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_period_closures" ADD CONSTRAINT "journal_period_closures_closed_by_user_id_users_id_fk" FOREIGN KEY ("closed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "journal_period_closures_company_period_unique" ON "journal_period_closures" USING btree ("company_id", "period");
