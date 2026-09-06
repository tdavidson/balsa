import { relations } from "drizzle-orm";
import {
  char,
  date,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const companyRole = pgEnum("company_role", ["owner"]);
export const evidenceStatus = pgEnum("evidence_status", ["pending", "approved", "rejected"]);
export const economicItemType = pgEnum("economic_item_type", ["agreement", "obligation"]);
export const economicDirection = pgEnum("economic_direction", ["receipt", "spend"]);
export const economicItemStatus = pgEnum("economic_item_status", ["draft", "confirmed", "rejected"]);
export const cashEventDirection = pgEnum("cash_event_direction", ["receipt", "spend"]);
export const reportingPeriodStatus = pgEnum("reporting_period_status", ["open", "closed"]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
};

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    authProvider: text("auth_provider").notNull(),
    authProviderUserId: text("auth_provider_user_id").notNull(),
    email: text("email").notNull(),
    name: text("name"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("users_auth_identity_unique").on(
      table.authProvider,
      table.authProviderUserId,
    ),
    index("users_email_index").on(table.email),
  ],
);

export const companies = pgTable("companies", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  baseCurrency: char("base_currency", { length: 3 }).default("USD").notNull(),
  fiscalYearEnd: text("fiscal_year_end"),
  ...timestamps,
});

/** One auditable record for each LLM request, including failed requests. */
export const llmRuns = pgTable("llm_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  operation: text("operation").notNull(),
  inputTokens: text("input_tokens"),
  outputTokens: text("output_tokens"),
  totalTokens: text("total_tokens"),
  cost: text("cost"),
  latencyMs: text("latency_ms"),
  status: text("status").notNull(),
  requestJson: text("request_json"),
  responseText: text("response_text"),
  error: text("error"),
  metadata: text("metadata").default("{}").notNull(),
  ...timestamps,
}, (table) => [index("llm_runs_company_index").on(table.companyId, table.createdAt), index("llm_runs_model_index").on(table.model, table.createdAt)]);

/** Training-oriented conversation records, linked to the LLM run that produced them. */
export const llmMessages = pgTable("llm_messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  runId: uuid("run_id").references(() => llmRuns.id, { onDelete: "set null" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  model: text("model"),
  sequence: text("sequence"),
  metadata: text("metadata").default("{}").notNull(),
  ...timestamps,
}, (table) => [index("llm_messages_company_index").on(table.companyId, table.createdAt), index("llm_messages_run_index").on(table.runId)]);

export const sources = pgTable("sources", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  filename: text("filename"),
  mimeType: text("mime_type"),
  storageReference: text("storage_reference"),
  hash: text("hash"),
  metadata: text("metadata").default("{}").notNull(),
  ...timestamps,
}, (table) => [index("sources_company_index").on(table.companyId, table.createdAt), index("sources_hash_index").on(table.companyId, table.hash)]);

export const observations = pgTable("observations", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  sourceId: uuid("source_id").notNull().references(() => sources.id, { onDelete: "cascade" }),
  eventId: uuid("event_id").references(() => cashEvents.id, { onDelete: "set null" }),
  type: text("type").notNull(), observedAt: timestamp("observed_at", { withTimezone: true }), effectiveDate: timestamp("effective_date", { withTimezone: true }),
  amount: text("amount"), currency: char("currency", { length: 3 }), counterpartyText: text("counterparty_text"), attributes: text("attributes").default("{}").notNull(), confidence: text("confidence").notNull(), ...timestamps,
}, (table) => [index("observations_company_index").on(table.companyId), index("observations_source_index").on(table.sourceId), index("observations_event_index").on(table.eventId)]);

export const entities = pgTable("entities", {
  id: uuid("id").defaultRandom().primaryKey(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }), type: text("type").notNull(), name: text("name").notNull(), attributes: text("attributes").default("{}").notNull(), ...timestamps,
}, (table) => [index("entities_company_index").on(table.companyId)]);

export const relationships = pgTable("relationships", {
  id: uuid("id").defaultRandom().primaryKey(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }), fromEntityId: uuid("from_entity_id").notNull().references(() => entities.id, { onDelete: "cascade" }), toEntityId: uuid("to_entity_id").notNull().references(() => entities.id, { onDelete: "cascade" }), type: text("type").notNull(), attributes: text("attributes").default("{}").notNull(), ...timestamps,
}, (table) => [index("relationships_company_index").on(table.companyId)]);

export const assumptions = pgTable("assumptions", {
  id: uuid("id").defaultRandom().primaryKey(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }), name: text("name").notNull(), value: text("value").notNull(), unit: text("unit"), sourceId: uuid("source_id").references(() => sources.id, { onDelete: "set null" }), active: char("active", { length: 1 }).default("Y").notNull(), ...timestamps,
}, (table) => [index("assumptions_company_index").on(table.companyId, table.active)]);

export const scenarios = pgTable("scenarios", {
  id: uuid("id").defaultRandom().primaryKey(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }), name: text("name").notNull(), assumptionIds: text("assumption_ids").default("[]").notNull(), active: char("active", { length: 1 }).default("Y").notNull(), ...timestamps,
}, (table) => [index("scenarios_company_index").on(table.companyId, table.active)]);

export const knowledgeDocuments = pgTable(
  "knowledge_documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex("knowledge_documents_company_slug_unique").on(table.companyId, table.slug), index("knowledge_documents_company_index").on(table.companyId)],
);

export const decisions = pgTable(
  "decisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    answer: text("answer").notNull(),
    appliesTo: text("applies_to"),
    status: text("status").default("applied").notNull(),
    ...timestamps,
  },
  (table) => [index("decisions_company_index").on(table.companyId, table.createdAt)],
);

export const policies = pgTable(
  "policies",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    decisionId: uuid("decision_id").references(() => decisions.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    rule: text("rule").notNull(),
    active: char("active", { length: 1 }).default("Y").notNull(),
    ...timestamps,
  },
  (table) => [index("policies_company_index").on(table.companyId, table.active)],
);

export const companyMembers = pgTable(
  "company_members",
  {
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: companyRole("role").default("owner").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.companyId, table.userId] }),
    index("company_members_user_index").on(table.userId),
  ],
);

export const evidence = pgTable(
  "evidence",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id").references(() => sources.id, { onDelete: "set null" }),
    createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    sourceName: text("source_name").notNull(),
    reportingMonth: text("reporting_month"),
    sourceMime: text("source_mime"),
    sourceSize: text("source_size"),
    sourceHash: text("source_hash"),
    rawText: text("raw_text").notNull(),
    extractedJson: text("extracted_json"),
    status: evidenceStatus("status").default("pending").notNull(),
    ...timestamps,
  },
  (table) => [index("evidence_company_index").on(table.companyId, table.createdAt)],
);

export const reviewItems = pgTable(
  "review_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    evidenceId: uuid("evidence_id").references(() => evidence.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    answer: text("answer"),
    status: text("status").default("open").notNull(),
    ...timestamps,
  },
  (table) => [index("review_items_company_index").on(table.companyId, table.status), index("review_items_evidence_index").on(table.evidenceId)],
);

export const factRecords = pgTable(
  "fact_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    evidenceId: uuid("evidence_id").notNull().references(() => evidence.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    value: text("value").notNull(),
    confidence: text("confidence").notNull(),
    status: text("status").default("pending").notNull(),
    ...timestamps,
  },
  (table) => [index("fact_records_company_index").on(table.companyId, table.status), index("fact_records_evidence_index").on(table.evidenceId)],
);

export const economicItems = pgTable(
  "economic_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    evidenceId: uuid("evidence_id").references(() => evidence.id, { onDelete: "set null" }),
    type: economicItemType("type").notNull(),
    direction: economicDirection("direction").notNull(),
    label: text("label").notNull(),
    counterparty: text("counterparty"),
    amount: text("amount"),
    cadence: text("cadence"),
    accountingTreatment: text("accounting_treatment").default("cash").notNull(),
    recognitionStart: text("recognition_start"),
    recognitionEnd: text("recognition_end"),
    status: economicItemStatus("status").default("draft").notNull(),
    policyId: uuid("policy_id").references(() => policies.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (table) => [index("economic_items_company_index").on(table.companyId, table.status)],
);

export const cashEvents = pgTable(
  "cash_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id").references(() => sources.id, { onDelete: "set null" }),
    evidenceId: uuid("evidence_id").references(() => evidence.id, { onDelete: "set null" }),
    month: text("month").notNull(),
    transactionDate: date("transaction_date"),
    externalKey: text("external_key"),
    description: text("description").notNull(),
    amount: text("amount").notNull(),
    direction: cashEventDirection("direction").notNull(),
    category: text("category").default("operating").notNull(),
    accountingTreatment: text("accounting_treatment").default("cash").notNull(),
    recognitionStart: text("recognition_start"),
    recognitionEnd: text("recognition_end"),
    policyId: uuid("policy_id").references(() => policies.id, { onDelete: "set null" }),
    isActual: char("is_actual", { length: 1 }).default("N").notNull(),
    ...timestamps,
  },
  (table) => [index("cash_events_company_month_index").on(table.companyId, table.month), uniqueIndex("cash_events_company_external_key_unique").on(table.companyId, table.externalKey)],
);

export const reportingPeriods = pgTable(
  "reporting_periods",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    month: text("month").notNull(),
    openingCash: text("opening_cash").default("0").notNull(),
    status: reportingPeriodStatus("status").default("open").notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex("reporting_period_company_month_unique").on(table.companyId, table.month)],
);

export const allocations = pgTable("allocations", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  eventId: uuid("event_id").references(() => cashEvents.id, { onDelete: "set null" }),
  payerEntityId: uuid("payer_entity_id").references(() => entities.id, { onDelete: "set null" }),
  bearerEntityId: uuid("bearer_entity_id").references(() => entities.id, { onDelete: "set null" }),
  percentage: text("percentage"),
  amount: text("amount"),
  sourceId: uuid("source_id").references(() => sources.id, { onDelete: "set null" }),
  status: text("status").default("proposed").notNull(),
  ...timestamps,
}, (table) => [index("allocations_company_index").on(table.companyId, table.status), index("allocations_event_index").on(table.eventId)]);

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(companyMembers),
}));

export const companiesRelations = relations(companies, ({ many }) => ({
  memberships: many(companyMembers),
  evidence: many(evidence),
  economicItems: many(economicItems),
  cashEvents: many(cashEvents),
  reportingPeriods: many(reportingPeriods),
  knowledgeDocuments: many(knowledgeDocuments),
  decisions: many(decisions),
  policies: many(policies),
  reviewItems: many(reviewItems),
  factRecords: many(factRecords),
  sources: many(sources),
  observations: many(observations),
  entities: many(entities),
  relationships: many(relationships),
  assumptions: many(assumptions),
  scenarios: many(scenarios),
  allocations: many(allocations),
}));

export const companyMembersRelations = relations(
  companyMembers,
  ({ one }) => ({
    company: one(companies, {
      fields: [companyMembers.companyId],
      references: [companies.id],
    }),
    user: one(users, {
      fields: [companyMembers.userId],
      references: [users.id],
    }),
  }),
);
