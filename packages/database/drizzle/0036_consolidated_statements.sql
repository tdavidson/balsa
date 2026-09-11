CREATE TABLE "opening_positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"entity_id" uuid,
	"account_entity_id" uuid,
	"month" text NOT NULL,
	"ledger" text NOT NULL,
	"amount" text NOT NULL,
	"source_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "owner_entity_id" uuid;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "consolidated" char(1) DEFAULT 'N' NOT NULL;--> statement-breakpoint
ALTER TABLE "economic_items" ADD COLUMN "entity_id" uuid;--> statement-breakpoint
ALTER TABLE "cash_events" ADD COLUMN "account_entity_id" uuid;--> statement-breakpoint
ALTER TABLE "cash_events" ADD COLUMN "entity_id" uuid;--> statement-breakpoint
ALTER TABLE "opening_positions" ADD CONSTRAINT "opening_positions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_positions" ADD CONSTRAINT "opening_positions_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_positions" ADD CONSTRAINT "opening_positions_account_entity_id_entities_id_fk" FOREIGN KEY ("account_entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_positions" ADD CONSTRAINT "opening_positions_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_owner_entity_id_entities_id_fk" FOREIGN KEY ("owner_entity_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "economic_items" ADD CONSTRAINT "economic_items_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_events" ADD CONSTRAINT "cash_events_account_entity_id_entities_id_fk" FOREIGN KEY ("account_entity_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_events" ADD CONSTRAINT "cash_events_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "opening_positions_company_index" ON "opening_positions" USING btree ("company_id","month");--> statement-breakpoint
CREATE UNIQUE INDEX "opening_positions_unique" ON "opening_positions" USING btree ("company_id","entity_id","account_entity_id","month","ledger");--> statement-breakpoint
CREATE INDEX "entities_owner_index" ON "entities" USING btree ("owner_entity_id");
