CREATE TABLE "journal_line_lineage" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "journal_line_id" uuid NOT NULL,
  "upstream_journal_line_id" uuid NOT NULL,
  "relationship" text DEFAULT 'period_close' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "journal_line_lineage" ADD CONSTRAINT "journal_line_lineage_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_line_lineage" ADD CONSTRAINT "journal_line_lineage_journal_line_id_journal_lines_id_fk" FOREIGN KEY ("journal_line_id") REFERENCES "public"."journal_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_line_lineage" ADD CONSTRAINT "journal_line_lineage_upstream_journal_line_id_journal_lines_id_fk" FOREIGN KEY ("upstream_journal_line_id") REFERENCES "public"."journal_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "journal_line_lineage_unique" ON "journal_line_lineage" USING btree ("journal_line_id", "upstream_journal_line_id");--> statement-breakpoint
CREATE INDEX "journal_line_lineage_upstream_index" ON "journal_line_lineage" USING btree ("company_id", "upstream_journal_line_id");--> statement-breakpoint
CREATE TABLE "journal_period_close_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "period" text NOT NULL,
  "promotion_id" uuid NOT NULL,
  "journal_entry_id" uuid NOT NULL,
  "posted_by_user_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "journal_period_close_entries" ADD CONSTRAINT "journal_period_close_entries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_period_close_entries" ADD CONSTRAINT "journal_period_close_entries_promotion_id_journal_period_promotions_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "public"."journal_period_promotions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_period_close_entries" ADD CONSTRAINT "journal_period_close_entries_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_period_close_entries" ADD CONSTRAINT "journal_period_close_entries_posted_by_user_id_users_id_fk" FOREIGN KEY ("posted_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "journal_period_close_entries_company_period_unique" ON "journal_period_close_entries" USING btree ("company_id", "period");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_period_close_entries_entry_unique" ON "journal_period_close_entries" USING btree ("journal_entry_id");
