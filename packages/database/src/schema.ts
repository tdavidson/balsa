import { relations, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  char,
  date,
  foreignKey,
  integer,
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/** Append-only management goals. Revisions preserve the goal's stable identity. */
export const cashGoalVersions = pgTable("cash_goal_versions", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  goalId: uuid("goal_id").notNull(),
  version: integer("version").notNull(),
  status: text("status").notNull().default("active"),
  definition: jsonb("definition").notNull(),
  reason: text("reason").notNull(),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("cash_goal_versions_identity").on(table.companyId, table.goalId, table.version),
  uniqueIndex("cash_goal_versions_company_id").on(table.companyId, table.id),
]);

/** Company-wide review landing preference; goal versions remain immutable. */
export const financialReviewPreferences = pgTable("financial_review_preferences", {
  companyId: uuid("company_id").primaryKey().references(() => companies.id, { onDelete: "cascade" }),
  primaryGoalVersionId: uuid("primary_goal_version_id"),
  version: integer("version").notNull().default(1),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [foreignKey({ columns: [table.companyId, table.primaryGoalVersionId], foreignColumns: [cashGoalVersions.companyId, cashGoalVersions.id] })]);

/** Full immutable plan/review payloads, independent of mutable plan journal pins. */
export const financialReviewSnapshots = pgTable("financial_review_snapshots", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  goalVersionId: uuid("goal_version_id").notNull(),
  planId: uuid("plan_id"),
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  requestKey: uuid("request_key").notNull(),
  requestHash: text("request_hash").notNull(),
  snapshot: jsonb("snapshot").notNull(),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("financial_review_snapshots_company_id").on(table.companyId, table.id),
  uniqueIndex("financial_review_snapshots_request").on(table.companyId, table.requestKey),
  index("financial_review_snapshots_goal").on(table.companyId, table.goalVersionId, table.createdAt),
  index("financial_review_snapshots_plan").on(table.companyId, table.planId),
  foreignKey({ columns: [table.companyId, table.goalVersionId], foreignColumns: [cashGoalVersions.companyId, cashGoalVersions.id] }),
  foreignKey({ columns: [table.companyId, table.planId], foreignColumns: [table.companyId, table.id] }),
]);

/** Reviewed journal occurrences; revisions are retained in the audit log and saved reviews. */
export const forecastOccurrences = pgTable("forecast_occurrences", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  occurrenceKey: text("occurrence_key").notNull(),
  version: integer("version").notNull().default(1),
  definition: jsonb("definition").notNull(),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex("forecast_occurrences_key").on(table.companyId, table.occurrenceKey), uniqueIndex("forecast_occurrences_company_id").on(table.companyId, table.id)]);

export const forecastSettlementAllocations = pgTable("forecast_settlement_allocations", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  occurrenceId: uuid("occurrence_id").notNull(),
  actualEntryId: uuid("actual_entry_id").notNull(),
  amountMinor: text("amount_minor").notNull(),
  revoked: boolean("revoked").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("forecast_settlement_occurrence").on(table.companyId, table.occurrenceId),
  index("forecast_settlement_actual").on(table.companyId, table.actualEntryId),
  foreignKey({ columns: [table.companyId, table.occurrenceId], foreignColumns: [forecastOccurrences.companyId, forecastOccurrences.id] }),
  // Journal entries are ownership-checked and locked by the mutation service.
  foreignKey({ columns: [table.actualEntryId], foreignColumns: [journalEntries.id] }),
]);

export const cashCoverageRecords = pgTable("cash_coverage_records", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  accountId: uuid("account_id").notNull().references(() => chartAccounts.id, { onDelete: "cascade" }),
  startDate: date("start_date").notNull(), throughDate: date("through_date").notNull(),
  status: text("status").notNull(), reason: text("reason").notNull(),
  evidenceId: uuid("evidence_id").references(() => evidence.id, { onDelete: "set null" }),
  evidenceHash: text("evidence_hash"), ledgerHash: text("ledger_hash").notNull(),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("cash_coverage_account").on(table.companyId, table.accountId, table.createdAt)]);

/** An approved, bounded capture policy over an existing economic driver. */
export const forecastRecurrencePolicies = pgTable("forecast_recurrence_policies", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  driverId: uuid("driver_id").notNull(),
  version: integer("version").notNull().default(1),
  status: text("status").notNull(),
  startMonth: text("start_month").notNull(), endMonth: text("end_month").notNull(),
  definition: jsonb("definition").notNull(), definitionHash: text("definition_hash").notNull(),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex("forecast_recurrence_driver").on(table.companyId, table.driverId)]);

export const forecastReviewCommands = pgTable("forecast_review_commands", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  requestKey: uuid("request_key").notNull(), requestHash: text("request_hash").notNull(),
  result: jsonb("result").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex("forecast_review_commands_request").on(table.companyId, table.requestKey)]);

/** Immutable, goal-aware scenario evaluations, approvals and outcome reviews. */
export const goalDecisionReviews = pgTable("goal_decision_reviews", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  goalVersionId: uuid("goal_version_id").notNull(), planId: uuid("plan_id").notNull(),
  scenarioId: uuid("scenario_id").notNull(), parentId: uuid("parent_id"),
  kind: text("kind").notNull(), name: text("name").notNull(),
  requestKey: uuid("request_key").notNull(), requestHash: text("request_hash").notNull(),
  previewToken: text("preview_token").notNull(), snapshot: jsonb("snapshot").notNull(),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("goal_decision_reviews_company_id").on(table.companyId, table.id),
  uniqueIndex("goal_decision_reviews_request").on(table.companyId, table.requestKey),
  index("goal_decision_reviews_history").on(table.companyId, table.createdAt),
  foreignKey({ columns: [table.companyId, table.goalVersionId], foreignColumns: [cashGoalVersions.companyId, cashGoalVersions.id] }),
  foreignKey({ columns: [table.companyId, table.planId], foreignColumns: [financialReviewSnapshots.companyId, financialReviewSnapshots.id] }),
  foreignKey({ columns: [table.companyId, table.parentId], foreignColumns: [table.companyId, table.id] }),
]);

/** Preserved import comparisons and their atomic posting approval receipts. */
export const financialImportReviews = pgTable("financial_import_reviews", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  sourceId: uuid("source_id").notNull().references(() => sources.id),
  previousSourceId: uuid("previous_source_id").references(() => sources.id),
  kind: text("kind").notNull(), name: text("name").notNull(), reason: text("reason").notNull(),
  requestKey: uuid("request_key").notNull(), requestHash: text("request_hash").notNull(),
  snapshot: jsonb("snapshot").notNull(),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex("financial_import_reviews_request").on(table.companyId, table.requestKey), index("financial_import_reviews_source").on(table.companyId, table.sourceId, table.createdAt),
  foreignKey({ columns: [table.companyId, table.sourceId], foreignColumns: [sources.companyId, sources.id] }),
  foreignKey({ columns: [table.companyId, table.previousSourceId], foreignColumns: [sources.companyId, sources.id] }),
]);

export const companyRole = pgEnum("company_role", ["owner", "member"]);
export const evidenceStatus = pgEnum("evidence_status", ["pending", "approved", "rejected"]);
export const economicItemType = pgEnum("economic_item_type", ["agreement", "obligation"]);
export const economicDirection = pgEnum("economic_direction", ["receipt", "spend"]);
export const economicItemStatus = pgEnum("economic_item_status", ["draft", "confirmed", "rejected"]);
export const cashEventDirection = pgEnum("cash_event_direction", ["receipt", "spend"]);
export const reportingPeriodStatus = pgEnum("reporting_period_status", ["open", "closed"]);
export const accountNormalBalance = pgEnum("account_normal_balance", ["debit", "credit"]);
export const journalBatchStatus = pgEnum("journal_batch_status", ["draft", "posted", "reversed"]);
export const journalEntryStatus = pgEnum("journal_entry_status", ["draft", "posted", "reversed"]);
export const postingProposalStatus = pgEnum("posting_proposal_status", ["draft", "approved", "rejected", "posted"]);

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
    avatarStorageReference: text("avatar_storage_reference"),
    avatarMime: text("avatar_mime"),
    avatarHash: text("avatar_hash"),
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

/**
 * Better Auth owns credential and session data. These tables intentionally
 * remain separate from `users`, which is Balsa's application identity and
 * company-membership anchor.
 */
export const betterAuthUsers = pgTable("user", {
  id: text("id").primaryKey(), name: text("name").notNull(), email: text("email").notNull(), emailVerified: boolean("email_verified").default(false).notNull(), image: text("image"), ...timestamps,
}, (table) => [uniqueIndex("better_auth_user_email_unique").on(table.email)]);

export const betterAuthSessions = pgTable("session", {
  id: text("id").primaryKey(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), token: text("token").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(), ipAddress: text("ip_address"), userAgent: text("user_agent"), userId: text("user_id").notNull().references(() => betterAuthUsers.id, { onDelete: "cascade" }),
}, (table) => [uniqueIndex("better_auth_session_token_unique").on(table.token), index("better_auth_session_user_index").on(table.userId)]);

export const betterAuthAccounts = pgTable("account", {
  id: text("id").primaryKey(), accountId: text("account_id").notNull(), providerId: text("provider_id").notNull(), userId: text("user_id").notNull().references(() => betterAuthUsers.id, { onDelete: "cascade" }), accessToken: text("access_token"), refreshToken: text("refresh_token"), idToken: text("id_token"), accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }), refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }), scope: text("scope"), password: text("password"), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("better_auth_account_user_index").on(table.userId), index("better_auth_account_provider_index").on(table.providerId, table.accountId)]);

export const betterAuthVerifications = pgTable("verification", {
  id: text("id").primaryKey(), identifier: text("identifier").notNull(), value: text("value").notNull(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("better_auth_verification_identifier_index").on(table.identifier)]);

export const companies = pgTable("companies", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  baseCurrency: char("base_currency", { length: 3 }).default("USD").notNull(),
  faviconStorageReference: text("favicon_storage_reference"),
  faviconMime: text("favicon_mime"),
  faviconHash: text("favicon_hash"),
  /** Fiscal year end month as two digits, "01" through "12"; null means December. */
  fiscalYearEnd: text("fiscal_year_end"),
  /** The model timeline the user sets: first and last month shown and forecast, as YYYY-MM. */
  modelFirstPeriod: text("model_first_period"), modelLastPeriod: text("model_last_period"),
  /** Default escalation drivers opt into (finance-engine EscalationRule); null when unset. */
  defaultEscalation: jsonb("default_escalation").$type<unknown>(),
  /** Monotonic revision of included financial state; calculation runs name the revision they reproduce. */
  financialStateRevision: text("financial_state_revision").default("0").notNull(),
  /** CFO-set cash floor for the forecast's cash-out month, in base-currency minor units. */
  minimumCashMinor: text("minimum_cash_minor").default("0").notNull(),
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
    byteSize: text("byte_size"),
  ingestionStatus: text("ingestion_status").default("stored").notNull(),
  ingestionError: text("ingestion_error"),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  hash: text("hash"),
  metadata: text("metadata").default("{}").notNull(),
  ...timestamps,
}, (table) => [uniqueIndex("sources_company_id").on(table.companyId, table.id), index("sources_company_index").on(table.companyId, table.createdAt), index("sources_hash_index").on(table.companyId, table.hash)]);

export const ingestionRuns = pgTable(
  "ingestion_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id").notNull().references(() => sources.id, { onDelete: "cascade" }),
    stage: text("stage").notNull(),
    status: text("status").notNull(),
    error: text("error"),
    metadata: text("metadata").default("{}").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index("ingestion_runs_company_index").on(table.companyId, table.createdAt), index("ingestion_runs_source_index").on(table.sourceId, table.createdAt)],
);

export const observations = pgTable("observations", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  sourceId: uuid("source_id").notNull().references(() => sources.id, { onDelete: "cascade" }),
  eventId: uuid("event_id").references(() => cashEvents.id, { onDelete: "set null" }),
  type: text("type").notNull(), observedAt: timestamp("observed_at", { withTimezone: true }), effectiveDate: timestamp("effective_date", { withTimezone: true }),
  amount: text("amount"), currency: char("currency", { length: 3 }), counterpartyText: text("counterparty_text"), attributes: text("attributes").default("{}").notNull(), confidence: text("confidence").notNull(), ...timestamps,
}, (table) => [index("observations_company_index").on(table.companyId), index("observations_source_index").on(table.sourceId), index("observations_event_index").on(table.eventId)]);

export const entities = pgTable("entities", {
  id: uuid("id").defaultRandom().primaryKey(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }), type: text("type").notNull(), name: text("name").notNull(), attributes: text("attributes").default("{}").notNull(),
  /** For accounts: the legal entity that owns the account. */
  ownerEntityId: uuid("owner_entity_id").references((): AnyPgColumn => entities.id, { onDelete: "set null" }),
  /** Legal-entity reporting metadata; account rows leave these fields empty. */
  consolidated: char("consolidated", { length: 1 }).default("N").notNull(), functionalCurrency: char("functional_currency", { length: 3 }), consolidationMethod: text("consolidation_method"), ownershipPercent: text("ownership_percent"), effectiveFrom: text("effective_from"), effectiveTo: text("effective_to"),
  ...timestamps,
}, (table) => [index("entities_company_index").on(table.companyId), index("entities_owner_index").on(table.ownerEntityId)]);

/** Absolute ledger balances at the start of a month, per legal entity (and per account for cash). */
export const openingPositions = pgTable("opening_positions", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  entityId: uuid("entity_id").references(() => entities.id, { onDelete: "cascade" }),
  accountEntityId: uuid("account_entity_id").references(() => entities.id, { onDelete: "cascade" }),
  month: text("month").notNull(),
  ledger: text("ledger").notNull(),
  amount: text("amount").notNull(),
  sourceId: uuid("source_id").references(() => sources.id, { onDelete: "set null" }),
  factId: uuid("fact_id").references(() => factRecords.id, { onDelete: "set null" }),
  ...timestamps,
}, (table) => [index("opening_positions_company_index").on(table.companyId, table.month), uniqueIndex("opening_positions_unique").on(table.companyId, table.entityId, table.accountEntityId, table.month, table.ledger)]);

/** Immutable snapshot of one deterministic financial-engine execution. */
export const calculationRuns = pgTable("calculation_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  engineVersion: text("engine_version").notNull(),
  inputHash: text("input_hash").notNull(),
  financialStateRevision: text("financial_state_revision").default("0").notNull(),
  asOfMonth: text("as_of_month").notNull(),
  horizonStart: text("horizon_start").notNull(),
  horizonEnd: text("horizon_end").notNull(),
  entityId: uuid("entity_id").references(() => entities.id, { onDelete: "set null" }),
  scenarioId: uuid("scenario_id").references(() => scenarios.id, { onDelete: "set null" }),
  inputJson: text("input_json").notNull(),
  outputJson: text("output_json").notNull(),
  verificationStatus: text("verification_status").notNull(),
  ...timestamps,
}, (table) => [index("calculation_runs_company_index").on(table.companyId, table.createdAt), index("calculation_runs_revision_index").on(table.companyId, table.financialStateRevision), uniqueIndex("calculation_runs_input_unique").on(table.companyId, table.financialStateRevision, table.engineVersion, table.inputHash)]);

/** Durable, idempotent request to calculate a company revision with one engine version. */
export const calculationOutbox = pgTable("calculation_outbox", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  financialStateRevision: text("financial_state_revision").notNull(),
  engineVersion: text("engine_version").notNull(),
  /** "base" for the schedule/cash graph, YYYY-MM for a journal graph. */
  period: text("period").default("base").notNull(),
  status: text("status").default("queued").notNull(),
  calculationRunId: uuid("calculation_run_id").references(() => calculationRuns.id, { onDelete: "set null" }),
  error: text("error"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [index("calculation_outbox_company_index").on(table.companyId, table.createdAt), uniqueIndex("calculation_outbox_revision_unique").on(table.companyId, table.financialStateRevision, table.engineVersion, table.period)]);

/** Why the financial-state revision advanced: exactly one row per revision. */
export const financialStateRevisions = pgTable("financial_state_revisions", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  revision: text("revision").notNull(),
  kind: text("kind").notNull(),
  subjectType: text("subject_type").notNull(),
  subjectId: text("subject_id"),
  subjectIds: jsonb("subject_ids"),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  via: text("via").notNull(),
  ...timestamps,
}, (table) => [uniqueIndex("financial_state_revisions_company_revision_unique").on(table.companyId, table.revision)]);

/** The forward effect of committed changes: the difference between consecutive forecast runs. */
export const forecastConsequences = pgTable("forecast_consequences", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  revision: text("revision").notNull(),
  previousRunId: uuid("previous_run_id").references(() => calculationRuns.id, { onDelete: "set null" }),
  nextRunId: uuid("next_run_id").notNull().references(() => calculationRuns.id, { onDelete: "cascade" }),
  causes: jsonb("causes").notNull(),
  delta: jsonb("delta").notNull(),
  ...timestamps,
}, (table) => [uniqueIndex("forecast_consequences_company_revision_unique").on(table.companyId, table.revision), index("forecast_consequences_company_index").on(table.companyId, table.createdAt)]);

/** Compact, source-linked log of a real-company test discrepancy. */
export const testingDiscrepancies = pgTable("testing_discrepancies", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  period: text("period").notNull(), statementSection: text("statement_section").notNull(), figureLabel: text("figure_label").notNull(),
  expectedValue: text("expected_value").notNull(), observedValue: text("observed_value").notNull(), sourceEvidence: text("source_evidence").notNull(), graphNodeKey: text("graph_node_key"),
  suspectedLayer: text("suspected_layer").notNull(), fixtureStatus: text("fixture_status").default("not_added").notNull(), status: text("status").default("open").notNull(), notes: text("notes"),
  ...timestamps,
}, (table) => [index("testing_discrepancies_company_period_index").on(table.companyId, table.period, table.createdAt), index("testing_discrepancies_status_index").on(table.companyId, table.status)]);

/** Stored graph nodes make every reported figure inspectable after the source state changes. */
export const calculationNodes = pgTable("calculation_nodes", {
  id: uuid("id").defaultRandom().primaryKey(),
  calculationRunId: uuid("calculation_run_id").notNull().references(() => calculationRuns.id, { onDelete: "cascade" }),
  nodeKey: text("node_key").notNull(),
  kind: text("kind").notNull(),
  month: text("month").notNull(),
  label: text("label").notNull(),
  formula: text("formula").notNull(),
  formulaVersion: text("formula_version").notNull(),
  valueJson: text("value_json").notNull(),
  inputNodeIds: text("input_node_ids").notNull(),
  lineIds: text("line_ids").notNull(),
  provenance: text("provenance").notNull(),
  verificationStatus: text("verification_status").notNull(),
  verificationReasons: text("verification_reasons").notNull(),
  ...timestamps,
}, (table) => [index("calculation_nodes_run_index").on(table.calculationRunId, table.month), uniqueIndex("calculation_nodes_unique").on(table.calculationRunId, table.nodeKey)]);

/** CFO promotion of one eligible journal calculation; period close remains separate. */
export const journalPeriodPromotions = pgTable("journal_period_promotions", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  period: text("period").notNull(),
  calculationRunId: uuid("calculation_run_id").notNull().references(() => calculationRuns.id, { onDelete: "restrict" }),
  promotedByUserId: uuid("promoted_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  note: text("note"),
  ...timestamps,
}, (table) => [uniqueIndex("journal_period_promotions_company_period_unique").on(table.companyId, table.period), index("journal_period_promotions_company_index").on(table.companyId, table.createdAt)]);

/** Immutable close record: closing follows a promoted journal period. */
export const journalPeriodClosures = pgTable("journal_period_closures", {
  id: uuid("id").defaultRandom().primaryKey(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }), period: text("period").notNull(), promotionId: uuid("promotion_id").notNull().references(() => journalPeriodPromotions.id, { onDelete: "restrict" }), closedByUserId: uuid("closed_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }), note: text("note"), ...timestamps,
}, (table) => [uniqueIndex("journal_period_closures_company_period_unique").on(table.companyId, table.period)]);

export const relationships = pgTable("relationships", {
  id: uuid("id").defaultRandom().primaryKey(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }), fromEntityId: uuid("from_entity_id").notNull().references(() => entities.id, { onDelete: "cascade" }), toEntityId: uuid("to_entity_id").notNull().references(() => entities.id, { onDelete: "cascade" }), type: text("type").notNull(), attributes: text("attributes").default("{}").notNull(), ...timestamps,
}, (table) => [index("relationships_company_index").on(table.companyId)]);

export const assumptions = pgTable("assumptions", {
  id: uuid("id").defaultRandom().primaryKey(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }), name: text("name").notNull(), value: text("value").notNull(), unit: text("unit"), sourceId: uuid("source_id").references(() => sources.id, { onDelete: "set null" }), active: char("active", { length: 1 }).default("Y").notNull(),
  scenarioId: uuid("scenario_id").references(() => scenarios.id, { onDelete: "set null" }), decisionId: uuid("decision_id").references(() => decisions.id, { onDelete: "set null" }), effectiveFrom: text("effective_from"), effectiveTo: text("effective_to"), ...timestamps,
}, (table) => [index("assumptions_company_index").on(table.companyId, table.active)]);

export const scenarios = pgTable("scenarios", {
  id: uuid("id").defaultRandom().primaryKey(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }), name: text("name").notNull(),
  /** What the scenario explores, in the CFO's words. */
  description: text("description"),
  assumptionIds: text("assumption_ids").default("[]").notNull(),
  /** Hypothetical driver changes (ScenarioChange[], apps/web/src/lib/scenario-changes.ts), applied in order over the base forecast. Read with parseStoredChanges. */
  changes: jsonb("changes").$type<unknown>().default([]).notNull(),
  active: char("active", { length: 1 }).default("Y").notNull(), ...timestamps,
}, (table) => [index("scenarios_company_index").on(table.companyId, table.active), uniqueIndex("scenarios_company_id").on(table.companyId, table.id)]);

export const knowledgeDocuments = pgTable(
  "knowledge_documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    /** The person behind the last edit; null for agent or migration writes. */
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
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
    /** Structured effect applied when the decision is accepted (JSON: add_item, end_item, change_amount, set_category). */
    effect: text("effect"),
    status: text("status").default("applied").notNull(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    /** The evidence the decision came from, such as a returned workbook whose edits were proposed. */
    evidenceId: uuid("evidence_id").references((): AnyPgColumn => evidence.id, { onDelete: "set null" }),
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
    sourceId: uuid("source_id").references(() => sources.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    rule: text("rule").notNull(),
    scope: text("scope").default("company").notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).defaultNow().notNull(),
    confidence: text("confidence").default("1.0").notNull(),
    active: char("active", { length: 1 }).default("Y").notNull(),
    ...timestamps,
  },
  (table) => [index("policies_company_index").on(table.companyId, table.active), index("policies_source_index").on(table.sourceId)],
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

/**
 * Who changed what. Written in the same transaction as the change it describes,
 * so the record and the change commit or roll back together.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    /** Null for worker actions, and for a user deleted after the fact. */
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    via: text("via").default("ui").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: uuid("entity_id"),
    summary: text("summary").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    requestId: text("request_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("audit_log_company_index").on(table.companyId, table.createdAt)],
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
    currency: char("currency", { length: 3 }),
    sourceMime: text("source_mime"),
    sourceSize: text("source_size"),
    sourceHash: text("source_hash"),
    accountHolder: text("account_holder"),
    accountIdentifier: text("account_identifier"),
    statementPeriodStart: date("statement_period_start"),
    statementPeriodEnd: date("statement_period_end"),
    openingBalance: text("opening_balance"),
    endingBalance: text("ending_balance"),
    accountEntityId: uuid("account_entity_id").references(() => entities.id, { onDelete: "set null" }),
    rawText: text("raw_text").notNull(),
    extractedJson: text("extracted_json"),
    /** Approval of the source's identity, ownership, account, and period. */
    identityStatus: evidenceStatus("identity_status").default("pending").notNull(),
    /** Overall publication state. Approved means every approval layer is complete. */
    status: evidenceStatus("status").default("pending").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index("evidence_company_index").on(table.companyId, table.createdAt), index("evidence_account_entity_index").on(table.accountEntityId)],
);

export const reviewItems = pgTable(
  "review_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    evidenceId: uuid("evidence_id").references(() => evidence.id, { onDelete: "cascade" }),
    reviewKey: text("review_key"),
    question: text("question").notNull(),
    answer: text("answer"),
    status: text("status").default("open").notNull(),
    resolvedByUserId: uuid("resolved_by_user_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (table) => [index("review_items_company_index").on(table.companyId, table.status), index("review_items_evidence_index").on(table.evidenceId), index("review_items_key_index").on(table.companyId, table.reviewKey)],
);

export const factRecords = pgTable(
  "fact_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    evidenceId: uuid("evidence_id").notNull().references(() => evidence.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    value: text("value").notNull(),
    accountingRole: text("accounting_role"),
    sourceLocation: text("source_location"),
    currency: char("currency", { length: 3 }),
    confidence: text("confidence").notNull(),
    status: text("status").default("pending").notNull(),
    ...timestamps,
  },
  (table) => [index("fact_records_company_index").on(table.companyId, table.status), index("fact_records_evidence_index").on(table.evidenceId)],
);

/** Immutable audit trail for the three evidence approval layers. */
export const approvalEvents = pgTable(
  "approval_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    evidenceId: uuid("evidence_id").notNull().references(() => evidence.id, { onDelete: "cascade" }),
    factId: uuid("fact_id").references(() => factRecords.id, { onDelete: "set null" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    layer: text("layer").notNull(),
    action: text("action").notNull(),
    previousValue: text("previous_value"),
    nextValue: text("next_value"),
    metadata: text("metadata").default("{}").notNull(),
    ...timestamps,
  },
  (table) => [index("approval_events_evidence_index").on(table.companyId, table.evidenceId, table.createdAt), index("approval_events_fact_index").on(table.factId)],
);

/** Immutable normalized row from a source file or integration, before accounting interpretation. */
export const sourceRows = pgTable("source_rows", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  sourceId: uuid("source_id").notNull().references(() => sources.id, { onDelete: "cascade" }),
  evidenceId: uuid("evidence_id").references(() => evidence.id, { onDelete: "set null" }), factId: uuid("fact_id").references(() => factRecords.id, { onDelete: "set null" }),
  sourceKey: text("source_key").notNull(), sourceType: text("source_type").notNull(), rowType: text("row_type").default("unclassified").notNull(), period: text("period"), transactionDate: date("transaction_date"), description: text("description"), amount: text("amount"), currency: char("currency", { length: 3 }), direction: cashEventDirection("direction"), accountName: text("account_name"), debitMinor: text("debit_minor"), creditMinor: text("credit_minor"), sourceLocation: text("source_location"), rawJson: text("raw_json").notNull(), status: text("status").default("staged").notNull(), ...timestamps,
}, (table) => [uniqueIndex("source_rows_source_key_unique").on(table.sourceId, table.sourceKey), index("source_rows_company_period_index").on(table.companyId, table.period), index("source_rows_company_type_index").on(table.companyId, table.rowType), index("source_rows_evidence_index").on(table.evidenceId)]);

/** Company-specific accounts used by deterministic posting and statement layouts. */
export const chartAccounts = pgTable("chart_accounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  code: text("code").notNull(), name: text("name").notNull(),
  accountType: text("account_type").notNull(), normalBalance: accountNormalBalance("normal_balance").notNull(),
  /** asset, liability, equity, revenue, expense, or an explicit section for a contra account. */
  statementSection: text("statement_section"), statementLine: text("statement_line"), /** Explicit current/non-current classification for balance-sheet presentation. */ balanceTiming: text("balance_timing"), /** Exact bank/brokerage account identifier for statement cash reconciliation. */ bankAccountIdentifier: text("bank_account_identifier"), cashFlowCategory: text("cash_flow_category"), workingCapitalCategory: text("working_capital_category"), /** Only an explicitly configured monetary account may be remeasured at closing FX rates. */ fxMonetary: char("fx_monetary", { length: 1 }).default("N").notNull(),
  entityId: uuid("entity_id").references(() => entities.id, { onDelete: "set null" }),
  activeFrom: text("active_from"), activeTo: text("active_to"), active: char("active", { length: 1 }).default("Y").notNull(),
  /** User-confirmed Standard statement line (presentation only); null means the deterministic suggestion applies. */
  reportLine: text("report_line"), reportCategoryId: uuid("report_category_id"),
  /** User override of the cash default: "cash" or "not_cash"; null means bank-linked or named-cash assets count as cash. */
  cashTreatment: text("cash_treatment"),
  ...timestamps,
}, (table) => [uniqueIndex("chart_accounts_company_id").on(table.companyId, table.id), uniqueIndex("chart_accounts_company_code_unique").on(table.companyId, table.code), uniqueIndex("chart_accounts_company_bank_identifier_unique").on(table.companyId, table.bankAccountIdentifier), index("chart_accounts_company_type_index").on(table.companyId, table.accountType)]);

/** An operating metric (customers, headcount): a forecast series drivers reference that never posts. */
export const forecastMetrics = pgTable("forecast_metrics", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(), label: text("label").notNull(), unit: text("unit"),
  effectiveFrom: text("effective_from").notNull(), effectiveTo: text("effective_to"), pattern: jsonb("pattern").$type<unknown>().notNull(),
  ...timestamps,
}, (table) => [uniqueIndex("forecast_metrics_company_name").on(table.companyId, table.name)]);

/** A recorded value of an operating metric for one month, with its source: a user, or an evidence fact, possibly through a decision. */
export const forecastMetricActuals = pgTable("forecast_metric_actuals", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  metricId: uuid("metric_id").notNull().references(() => forecastMetrics.id, { onDelete: "cascade" }),
  month: text("month").notNull(), value: text("value").notNull(),
  evidenceId: uuid("evidence_id").references((): AnyPgColumn => evidence.id, { onDelete: "set null" }),
  factId: uuid("fact_id").references((): AnyPgColumn => factRecords.id, { onDelete: "set null" }),
  decisionId: uuid("decision_id").references((): AnyPgColumn => decisions.id, { onDelete: "set null" }),
  createdByUserId: uuid("created_by_user_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
  ...timestamps,
}, (table) => [uniqueIndex("forecast_metric_actuals_metric_month").on(table.metricId, table.month), index("forecast_metric_actuals_company").on(table.companyId)]);

/** Twelve calendar-month deviations a driver can apply; they sum to zero. */
export const seasonalityProfiles = pgTable("seasonality_profiles", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(), deviations: jsonb("deviations").$type<string[]>().notNull(),
  ...timestamps,
}, (table) => [uniqueIndex("seasonality_profiles_company_name").on(table.companyId, sql`lower(${table.name})`)]);

/** A user-defined category under one Standard statement line, such as Subscriptions under Revenues. */
export const reportCategories = pgTable("report_categories", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  line: text("line").notNull(), name: text("name").notNull(), sortOrder: integer("sort_order").default(0).notNull(),
  ...timestamps,
}, (table) => [uniqueIndex("report_categories_company_line_name").on(table.companyId, table.line, sql`lower(${table.name})`), uniqueIndex("report_categories_company_id").on(table.companyId, table.id)]);

/** Approved reciprocal account pair for one intercompany relationship. */
export const intercompanyAccountMappings = pgTable("intercompany_account_mappings", {
  id: uuid("id").defaultRandom().primaryKey(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  fromEntityId: uuid("from_entity_id").notNull().references(() => entities.id, { onDelete: "cascade" }), toEntityId: uuid("to_entity_id").notNull().references(() => entities.id, { onDelete: "cascade" }),
  receivableAccountId: uuid("receivable_account_id").notNull().references(() => chartAccounts.id, { onDelete: "restrict" }), payableAccountId: uuid("payable_account_id").notNull().references(() => chartAccounts.id, { onDelete: "restrict" }),
  effectiveFrom: text("effective_from").notNull(), effectiveTo: text("effective_to"), active: char("active", { length: 1 }).default("Y").notNull(), ...timestamps,
}, (table) => [uniqueIndex("intercompany_mapping_scope_unique").on(table.companyId, table.fromEntityId, table.toEntityId, table.effectiveFrom), index("intercompany_mapping_company_index").on(table.companyId, table.active)]);

/** Immutable container for one import, opening conversion, adjustment, or reversal. */
export const journalBatches = pgTable("journal_batches", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  label: text("label").notNull(), source: text("source").notNull(), status: journalBatchStatus("status").default("draft").notNull(), idempotencyKey: text("idempotency_key").notNull(),
  sourceId: uuid("source_id").references(() => sources.id, { onDelete: "set null" }), decisionId: uuid("decision_id").references(() => decisions.id, { onDelete: "set null" }), approvalEventId: uuid("approval_event_id").references(() => approvalEvents.id, { onDelete: "set null" }),
  postedAt: timestamp("posted_at", { withTimezone: true }), ...timestamps,
}, (table) => [uniqueIndex("journal_batches_company_idempotency_unique").on(table.companyId, table.idempotencyKey), index("journal_batches_company_status_index").on(table.companyId, table.status)]);

/** One dated balanced entry inside a journal batch. */
export const journalEntries = pgTable("journal_entries", {
  id: uuid("id").defaultRandom().primaryKey(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }), batchId: uuid("batch_id").notNull().references(() => journalBatches.id, { onDelete: "cascade" }),
  entityId: uuid("entity_id").references(() => entities.id, { onDelete: "set null" }), postingDate: date("posting_date").notNull(), period: text("period").notNull(), memo: text("memo").notNull(), status: journalEntryStatus("status").default("draft").notNull(), basis: text("basis").default("actual").notNull(), scenarioId: uuid("scenario_id").references(() => scenarios.id, { onDelete: "set null" }),
  reversalOfEntryId: uuid("reversal_of_entry_id").references((): AnyPgColumn => journalEntries.id, { onDelete: "set null" }), postedAt: timestamp("posted_at", { withTimezone: true }), ...timestamps,
}, (table) => [uniqueIndex("journal_entries_company_id").on(table.companyId, table.id), index("journal_entries_company_period_index").on(table.companyId, table.period, table.status), index("journal_entries_basis_index").on(table.companyId, table.basis, table.period), index("journal_entries_batch_index").on(table.batchId)]);

/** Debit and credit are integer minor units as text; a pure validator enforces balance before posting. */
export const journalLines = pgTable("journal_lines", {
  id: uuid("id").defaultRandom().primaryKey(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }), entryId: uuid("entry_id").notNull().references(() => journalEntries.id, { onDelete: "cascade" }), accountId: uuid("account_id").notNull().references(() => chartAccounts.id, { onDelete: "restrict" }),
  entityId: uuid("entity_id").references(() => entities.id, { onDelete: "set null" }),
  /** Functional-currency amounts used by the journal trial balance. */
  currency: char("currency", { length: 3 }).notNull(), debitMinor: text("debit_minor").default("0").notNull(), creditMinor: text("credit_minor").default("0").notNull(),
  /** Original transaction currency is retained whenever functional measurement differs. */
  transactionCurrency: char("transaction_currency", { length: 3 }), transactionDebitMinor: text("transaction_debit_minor"), transactionCreditMinor: text("transaction_credit_minor"), fxRateId: uuid("fx_rate_id").references(() => fxRates.id, { onDelete: "restrict" }),
  sourceId: uuid("source_id").references(() => sources.id, { onDelete: "set null" }), sourceRowId: uuid("source_row_id").references(() => sourceRows.id, { onDelete: "set null" }), evidenceId: uuid("evidence_id").references(() => evidence.id, { onDelete: "set null" }), factId: uuid("fact_id").references(() => factRecords.id, { onDelete: "set null" }), decisionId: uuid("decision_id").references(() => decisions.id, { onDelete: "set null" }), policyId: uuid("policy_id").references(() => policies.id, { onDelete: "set null" }), approvalEventId: uuid("approval_event_id").references(() => approvalEvents.id, { onDelete: "set null" }),
  sourceLocation: text("source_location"), externalKey: text("external_key"), memo: text("memo"), ...timestamps,
}, (table) => [index("journal_lines_entry_index").on(table.entryId), index("journal_lines_account_currency_index").on(table.companyId, table.accountId, table.currency), index("journal_lines_fx_rate_index").on(table.fxRateId), uniqueIndex("journal_lines_company_external_key_unique").on(table.companyId, table.externalKey)]);

/** Immutable record of a CFO-approved consolidated-only elimination posting. */
export const intercompanyEliminationEntries = pgTable("intercompany_elimination_entries", {
  id: uuid("id").defaultRandom().primaryKey(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }), period: text("period").notNull(),
  mappingId: uuid("mapping_id").notNull().references(() => intercompanyAccountMappings.id, { onDelete: "restrict" }), journalEntryId: uuid("journal_entry_id").notNull().references(() => journalEntries.id, { onDelete: "restrict" }), approvedByUserId: uuid("approved_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }), ...timestamps,
}, (table) => [uniqueIndex("intercompany_elimination_entry_unique").on(table.companyId, table.period, table.mappingId), uniqueIndex("intercompany_elimination_journal_unique").on(table.journalEntryId)]);

/** A CFO-approved, sourced set of FX observations. Only approved sets may drive reported conversion. */
export const fxRateSets = pgTable("fx_rate_sets", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(), status: text("status").default("draft").notNull(), provider: text("provider"),
  sourceId: uuid("source_id").references(() => sources.id, { onDelete: "set null" }),
  approvalEventId: uuid("approval_event_id").references(() => approvalEvents.id, { onDelete: "set null" }),
  effectiveFrom: date("effective_from"), effectiveTo: date("effective_to"), notes: text("notes"),
  ...timestamps,
}, (table) => [index("fx_rate_sets_company_status_index").on(table.companyId, table.status), index("fx_rate_sets_source_index").on(table.sourceId)]);

/** Exact rational quotation and source lineage; decimals are never used for reported FX math. */
export const fxRates = pgTable("fx_rates", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  rateSetId: uuid("rate_set_id").notNull().references(() => fxRateSets.id, { onDelete: "cascade" }),
  fromCurrency: char("from_currency", { length: 3 }).notNull(), toCurrency: char("to_currency", { length: 3 }).notNull(), rateType: text("rate_type").notNull(), effectiveDate: date("effective_date").notNull(),
  numerator: text("numerator").notNull(), denominator: text("denominator").notNull(),
  sourceId: uuid("source_id").references(() => sources.id, { onDelete: "set null" }), evidenceId: uuid("evidence_id").references(() => evidence.id, { onDelete: "set null" }), factId: uuid("fact_id").references(() => factRecords.id, { onDelete: "set null" }), sourceLocation: text("source_location"),
  ...timestamps,
}, (table) => [uniqueIndex("fx_rates_rate_set_quote_unique").on(table.rateSetId, table.fromCurrency, table.toCurrency, table.rateType, table.effectiveDate), index("fx_rates_company_quote_date_index").on(table.companyId, table.fromCurrency, table.toCurrency, table.rateType, table.effectiveDate)]);

/** Approved presentation and remeasurement policy. A rate alone never chooses accounting treatment. */
export const fxTranslationPolicies = pgTable("fx_translation_policies", {
  id: uuid("id").defaultRandom().primaryKey(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(), status: text("status").default("draft").notNull(), presentationCurrency: char("presentation_currency", { length: 3 }).notNull(),
  incomeRateType: text("income_rate_type").notNull(), monetaryRateType: text("monetary_rate_type").notNull(), equityRateType: text("equity_rate_type").notNull(),
  ctaAccountId: uuid("cta_account_id").notNull().references(() => chartAccounts.id, { onDelete: "restrict" }), fxGainLossAccountId: uuid("fx_gain_loss_account_id").notNull().references(() => chartAccounts.id, { onDelete: "restrict" }),
  sourceId: uuid("source_id").references(() => sources.id, { onDelete: "set null" }), evidenceId: uuid("evidence_id").references(() => evidence.id, { onDelete: "set null" }), factId: uuid("fact_id").references(() => factRecords.id, { onDelete: "set null" }), approvalEventId: uuid("approval_event_id").references(() => approvalEvents.id, { onDelete: "set null" }), ...timestamps,
}, (table) => [index("fx_translation_policies_company_status_index").on(table.companyId, table.status), uniqueIndex("fx_translation_policies_active_currency_unique").on(table.companyId, table.presentationCurrency).where(sql`status = 'approved'`)]);

/** One immutable, CFO-approved functional-currency remeasurement entry per entity and period. */
export const fxRemeasurementEntries = pgTable("fx_remeasurement_entries", {
  id: uuid("id").defaultRandom().primaryKey(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }), period: text("period").notNull(),
  entityId: uuid("entity_id").references(() => entities.id, { onDelete: "restrict" }), policyId: uuid("policy_id").notNull().references(() => fxTranslationPolicies.id, { onDelete: "restrict" }), journalEntryId: uuid("journal_entry_id").notNull().references(() => journalEntries.id, { onDelete: "restrict" }), approvedByUserId: uuid("approved_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }), ...timestamps,
}, (table) => [uniqueIndex("fx_remeasurement_entries_scope_unique").on(table.companyId, table.period, table.entityId, table.policyId), uniqueIndex("fx_remeasurement_entries_journal_unique").on(table.journalEntryId), index("fx_remeasurement_entries_company_period_index").on(table.companyId, table.period)]);

/** Exact many-to-many lineage for generated journal lines, beginning with period-close entries. */
export const journalLineLineage = pgTable("journal_line_lineage", {
  id: uuid("id").defaultRandom().primaryKey(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  journalLineId: uuid("journal_line_id").notNull().references(() => journalLines.id, { onDelete: "cascade" }), upstreamJournalLineId: uuid("upstream_journal_line_id").notNull().references(() => journalLines.id, { onDelete: "restrict" }),
  relationship: text("relationship").default("period_close").notNull(), ...timestamps,
}, (table) => [uniqueIndex("journal_line_lineage_unique").on(table.journalLineId, table.upstreamJournalLineId), index("journal_line_lineage_upstream_index").on(table.companyId, table.upstreamJournalLineId)]);

/** One immutable retained-earnings close entry per promoted reporting period. */
export const journalPeriodCloseEntries = pgTable("journal_period_close_entries", {
  id: uuid("id").defaultRandom().primaryKey(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }), period: text("period").notNull(),
  promotionId: uuid("promotion_id").notNull().references(() => journalPeriodPromotions.id, { onDelete: "restrict" }), journalEntryId: uuid("journal_entry_id").notNull().references(() => journalEntries.id, { onDelete: "restrict" }), postedByUserId: uuid("posted_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }), ...timestamps,
}, (table) => [uniqueIndex("journal_period_close_entries_company_period_unique").on(table.companyId, table.period), uniqueIndex("journal_period_close_entries_entry_unique").on(table.journalEntryId)]);

/** A model or rule may propose a posting; only approved proposals may be posted. */
export const postingProposals = pgTable("posting_proposals", {
  id: uuid("id").defaultRandom().primaryKey(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  sourceId: uuid("source_id").references(() => sources.id, { onDelete: "set null" }), sourceRowId: uuid("source_row_id").references(() => sourceRows.id, { onDelete: "set null" }), evidenceId: uuid("evidence_id").references(() => evidence.id, { onDelete: "set null" }), factId: uuid("fact_id").references(() => factRecords.id, { onDelete: "set null" }), decisionId: uuid("decision_id").references(() => decisions.id, { onDelete: "set null" }), policyId: uuid("policy_id").references(() => policies.id, { onDelete: "set null" }), sourceLocation: text("source_location"),
  externalKey: text("external_key").notNull(), proposalJson: text("proposal_json").notNull(), rationale: text("rationale"), confidence: text("confidence"), status: postingProposalStatus("status").default("draft").notNull(), journalEntryId: uuid("journal_entry_id").references(() => journalEntries.id, { onDelete: "set null" }), approvedAt: timestamp("approved_at", { withTimezone: true }), ...timestamps,
}, (table) => [uniqueIndex("posting_proposals_company_external_key_unique").on(table.companyId, table.externalKey), index("posting_proposals_company_status_index").on(table.companyId, table.status)]);

/** Approved company-specific rule for turning a proven source row into a journal proposal. */
export const postingRules = pgTable("posting_rules", {
  id: uuid("id").defaultRandom().primaryKey(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(), sourceType: text("source_type"), descriptionPattern: text("description_pattern").notNull(), direction: cashEventDirection("direction"), activity: text("activity"),
  cashAccountId: uuid("cash_account_id").notNull().references(() => chartAccounts.id, { onDelete: "restrict" }), offsetAccountId: uuid("offset_account_id").notNull().references(() => chartAccounts.id, { onDelete: "restrict" }), entityId: uuid("entity_id").references(() => entities.id, { onDelete: "set null" }),
  policyId: uuid("policy_id").references(() => policies.id, { onDelete: "set null" }), decisionId: uuid("decision_id").references(() => decisions.id, { onDelete: "set null" }), priority: text("priority").default("100").notNull(), active: char("active", { length: 1 }).default("Y").notNull(), effectiveFrom: text("effective_from"), effectiveTo: text("effective_to"), ...timestamps,
}, (table) => [index("posting_rules_company_active_index").on(table.companyId, table.active), index("posting_rules_pattern_index").on(table.companyId, table.descriptionPattern)]);

/** Immutable record of the rule snapshot that generated an automated proposal. */
export const postingRuleApplications = pgTable("posting_rule_applications", {
  id: uuid("id").defaultRandom().primaryKey(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }), sourceRowId: uuid("source_row_id").notNull().references(() => sourceRows.id, { onDelete: "cascade" }), postingRuleId: uuid("posting_rule_id").notNull().references(() => postingRules.id, { onDelete: "restrict" }), postingProposalId: uuid("posting_proposal_id").references(() => postingProposals.id, { onDelete: "set null" }), ruleSnapshot: text("rule_snapshot").notNull(), outcome: text("outcome").notNull(), ...timestamps,
}, (table) => [uniqueIndex("posting_rule_applications_row_rule_unique").on(table.sourceRowId, table.postingRuleId), index("posting_rule_applications_company_index").on(table.companyId, table.createdAt)]);

/** Versioned, CFO-approved mapping from source evidence to an accounting template. */
export const sourceRowMappings = pgTable("source_row_mappings", {
  id: uuid("id").defaultRandom().primaryKey(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }), sourceRowId: uuid("source_row_id").references(() => sourceRows.id, { onDelete: "cascade" }), factId: uuid("fact_id").references(() => factRecords.id, { onDelete: "set null" }), chartAccountId: uuid("chart_account_id").references(() => chartAccounts.id, { onDelete: "restrict" }), offsetAccountId: uuid("offset_account_id").references(() => chartAccounts.id, { onDelete: "restrict" }), mappingType: text("mapping_type").notNull(), templateJson: text("template_json").notNull(), version: text("version").default("1").notNull(), status: text("status").default("draft").notNull(), decisionId: uuid("decision_id").references(() => decisions.id, { onDelete: "set null" }), policyId: uuid("policy_id").references(() => policies.id, { onDelete: "set null" }), effectiveFrom: text("effective_from"), effectiveTo: text("effective_to"), supersedesId: uuid("supersedes_id").references((): AnyPgColumn => sourceRowMappings.id, { onDelete: "set null" }), approvedByUserId: uuid("approved_by_user_id").references(() => users.id, { onDelete: "set null" }), approvedAt: timestamp("approved_at", { withTimezone: true }), ...timestamps,
}, (table) => [index("source_row_mappings_company_index").on(table.companyId, table.status), index("source_row_mappings_row_index").on(table.sourceRowId, table.version), index("source_row_mappings_scope_index").on(table.companyId, table.mappingType, table.effectiveFrom, table.effectiveTo)]);

/** Approved template that turns a confirmed forecast driver into balanced projected entries. */
export const forecastEntryTemplates = pgTable("forecast_entry_templates", {
  id: uuid("id").defaultRandom().primaryKey(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(), itemType: text("item_type").notNull(), direction: cashEventDirection("direction").notNull(), category: text("category"),
  debitAccountId: uuid("debit_account_id").notNull().references(() => chartAccounts.id, { onDelete: "restrict" }), creditAccountId: uuid("credit_account_id").notNull().references(() => chartAccounts.id, { onDelete: "restrict" }),
  decisionId: uuid("decision_id").references(() => decisions.id, { onDelete: "set null" }), policyId: uuid("policy_id").references(() => policies.id, { onDelete: "set null" }), active: char("active", { length: 1 }).default("Y").notNull(), ...timestamps,
}, (table) => [uniqueIndex("forecast_templates_company_id").on(table.companyId, table.id), index("forecast_entry_templates_company_index").on(table.companyId, table.active)]);

/** A named list of items that forecast model variables break down by (for example team: Eng, Sales). */
export const forecastDimensions = pgTable("forecast_dimensions", {
  id: uuid("id").defaultRandom().primaryKey(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(), items: jsonb("items").$type<string[]>().default([]).notNull(), active: char("active", { length: 1 }).default("Y").notNull(), ...timestamps,
}, (table) => [index("forecast_dimensions_company_index").on(table.companyId, table.active), uniqueIndex("forecast_dimensions_active_name_unique").on(table.companyId, table.name).where(sql`active = 'Y'`)]);

/** A forecast model variable: dated step inputs or a formula (never both), over zero or more dimensions. */
export const forecastVariables = pgTable("forecast_variables", {
  id: uuid("id").defaultRandom().primaryKey(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(), kind: text("kind").$type<"money" | "number">().notNull(), dims: jsonb("dims").$type<string[]>().default([]).notNull(),
  formula: text("formula"), inputs: jsonb("inputs").$type<{ coords: Record<string, string>; from: string; value: string }[]>().default([]).notNull(),
  decisionId: uuid("decision_id").references(() => decisions.id, { onDelete: "set null" }), active: char("active", { length: 1 }).default("Y").notNull(), ...timestamps,
}, (table) => [index("forecast_variables_company_index").on(table.companyId, table.active), uniqueIndex("forecast_variables_active_name_unique").on(table.companyId, table.name).where(sql`active = 'Y'`)]);

/** Durable marker proving a decision's structured effect was applied once. */
export const decisionEffectApplications = pgTable("decision_effect_applications", {
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  decisionId: uuid("decision_id").notNull().references(() => decisions.id, { onDelete: "cascade" }),
  effectKind: text("effect_kind").notNull(), result: jsonb("result").$type<Record<string, unknown>>().notNull(), appliedAt: timestamp("applied_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [primaryKey({ columns: [table.companyId, table.decisionId] }), index("decision_effect_applications_company_index").on(table.companyId, table.appliedAt)]);

export const economicItems = pgTable(
  "economic_items",
  {
    forecastTemplateId: uuid("forecast_template_id").references(() => forecastEntryTemplates.id),
    forecastOrigin: jsonb("forecast_origin"),
    expectedDay: integer("expected_day"),
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    evidenceId: uuid("evidence_id").references(() => evidence.id, { onDelete: "set null" }),
    /** The exact approved extracted fact that supports this scheduled item, when one exists. */
    factId: uuid("fact_id").references(() => factRecords.id, { onDelete: "set null" }),
    type: economicItemType("type").notNull(),
    direction: economicDirection("direction").notNull(),
    label: text("label").notNull(),
    counterparty: text("counterparty"),
    amount: text("amount"),
    /** A driver formula over the forecast model, in major units. When set, `amount` is the display fallback only. */
    amountFormula: text("amount_formula"),
    /** Standard-model driver pattern (finance-engine DriverPattern); exclusive with amountFormula. */
    pattern: jsonb("pattern").$type<unknown>(),
    cadence: text("cadence"),
    accountingTreatment: text("accounting_treatment").default("cash").notNull(),
    recognitionStart: text("recognition_start"),
    recognitionEnd: text("recognition_end"),
    /** First month the item produces an expected event (YYYY-MM). */
    effectiveFrom: text("effective_from"),
    /** Last month the item produces an expected event (YYYY-MM). */
    effectiveTo: text("effective_to"),
    /** Income statement line: management_fee, other_revenue, salary, contractor, professional_services, software, insurance, other. */
    category: text("category"),
    /** contractual (supported by evidence) or assumed (CFO or agent assumption). */
    basis: text("basis").default("contractual").notNull(),
    counterpartyEntityId: uuid("counterparty_entity_id").references(() => entities.id, { onDelete: "set null" }),
    scenarioId: uuid("scenario_id").references(() => scenarios.id, { onDelete: "set null" }),
    assumptionId: uuid("assumption_id").references(() => assumptions.id, { onDelete: "set null" }),
    decisionId: uuid("decision_id").references(() => decisions.id, { onDelete: "set null" }),
    confidence: text("confidence"),
    rationale: text("rationale"),
    /** The company's own legal entity that earns or owes this item. */
    entityId: uuid("entity_id").references(() => entities.id, { onDelete: "set null" }),
    status: economicItemStatus("status").default("draft").notNull(),
    policyId: uuid("policy_id").references(() => policies.id, { onDelete: "set null" }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (table) => [uniqueIndex("economic_items_company_id").on(table.companyId, table.id), index("economic_items_company_index").on(table.companyId, table.status), index("economic_items_scenario_index").on(table.scenarioId), foreignKey({ columns: [table.companyId, table.forecastTemplateId], foreignColumns: [forecastEntryTemplates.companyId, forecastEntryTemplates.id] }), uniqueIndex("economic_items_history_pattern").on(table.companyId, sql`(${table.forecastOrigin}->>'patternKey')`).where(sql`${table.forecastOrigin} IS NOT NULL AND ${table.scenarioId} IS NULL`)],
);

export const recognitionJournalLinks = pgTable("recognition_journal_links", {
  id: uuid("id").defaultRandom().primaryKey(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  driverId: uuid("driver_id").notNull().references(() => economicItems.id), entryId: uuid("entry_id").notNull().references(() => journalEntries.id),
  sourceHash: text("source_hash").notNull(), reason: text("reason").notNull(), version: integer("version").notNull().default(1), revoked: boolean("revoked").notNull().default(false),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }), ...timestamps,
}, (table) => [uniqueIndex("recognition_links_entry").on(table.companyId, table.entryId).where(sql`NOT ${table.revoked}`), index("recognition_links_driver").on(table.companyId, table.driverId), foreignKey({ columns: [table.companyId, table.driverId], foreignColumns: [economicItems.companyId, economicItems.id] }), foreignKey({ columns: [table.companyId, table.entryId], foreignColumns: [journalEntries.companyId, journalEntries.id] })]);

export const financialWorkReviews = pgTable("financial_work_reviews", {
 id: uuid("id").defaultRandom().primaryKey(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
 kind: text("kind").notNull(), name: text("name").notNull(), scope: jsonb("scope").notNull(), snapshot: jsonb("snapshot").notNull(), snapshotHash: text("snapshot_hash").notNull(),
 preparerUserId: uuid("preparer_user_id").notNull().references(() => users.id), reviewerUserId: uuid("reviewer_user_id").references(() => users.id), status: text("status").notNull().default("draft"), version: integer("version").notNull().default(1), requestKey: uuid("request_key").notNull(), ...timestamps,
}, (table) => [uniqueIndex("financial_work_reviews_company_id_id_key").on(table.companyId, table.id), uniqueIndex("financial_work_reviews_company_id_request_key_key").on(table.companyId, table.requestKey), index("financial_work_reviews_company").on(table.companyId, table.createdAt)]);
export const financialReviewTasks = pgTable("financial_review_tasks", {
 id: uuid("id").defaultRandom().primaryKey(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }), reviewId: uuid("review_id").notNull(), subjectKey: text("subject_key").notNull(), title: text("title").notNull(), assigneeUserId: uuid("assignee_user_id").references(() => users.id), dueDate: date("due_date"), status: text("status").notNull().default("open"), resolution: text("resolution"), version: integer("version").notNull().default(1), ...timestamps,
}, (table) => [foreignKey({ columns: [table.companyId, table.reviewId], foreignColumns: [financialWorkReviews.companyId, financialWorkReviews.id] }).onDelete("cascade"), uniqueIndex("financial_review_tasks_company_id_review_id_subject_key_key").on(table.companyId, table.reviewId, table.subjectKey), index("financial_review_tasks_assignee").on(table.companyId, table.assigneeUserId, table.status, table.dueDate)]);
export const financialReviewSignoffs = pgTable("financial_review_signoffs", {
 id: uuid("id").defaultRandom().primaryKey(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }), reviewId: uuid("review_id").notNull(), reviewerUserId: uuid("reviewer_user_id").notNull().references(() => users.id), snapshotHash: text("snapshot_hash").notNull(), reason: text("reason").notNull(), selfReview: boolean("self_review").notNull(), snapshot: jsonb("snapshot").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [foreignKey({ columns: [table.companyId, table.reviewId], foreignColumns: [financialWorkReviews.companyId, financialWorkReviews.id] }).onDelete("cascade"), index("financial_review_signoffs_review").on(table.companyId, table.reviewId)]);

export const cashEvents = pgTable(
  "cash_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id").references(() => sources.id, { onDelete: "set null" }),
    /** The immutable normalized row from which this interpreted cash event was derived. */
    sourceRowId: uuid("source_row_id").references(() => sourceRows.id, { onDelete: "set null" }),
    evidenceId: uuid("evidence_id").references(() => evidence.id, { onDelete: "set null" }),
    /** The exact approved extracted fact that supports this cash event, when one exists. */
    factId: uuid("fact_id").references(() => factRecords.id, { onDelete: "set null" }),
    month: text("month").notNull(),
    transactionDate: date("transaction_date"),
    sourceLocation: text("source_location"),
    externalKey: text("external_key"),
    description: text("description").notNull(),
    amount: text("amount").notNull(),
    currency: char("currency", { length: 3 }),
    direction: cashEventDirection("direction").notNull(),
    category: text("category").default("operating").notNull(),
    accountingTreatment: text("accounting_treatment").default("cash").notNull(),
    recognitionStart: text("recognition_start"),
    recognitionEnd: text("recognition_end"),
    policyId: uuid("policy_id").references(() => policies.id, { onDelete: "set null" }),
    /** Income statement line, set by interpretation or a CFO decision. `category` above is the cash activity class. */
    financialCategory: text("financial_category"),
    counterpartyEntityId: uuid("counterparty_entity_id").references(() => entities.id, { onDelete: "set null" }),
    /** The confirmed agreement or obligation this actual settles. */
    settlesItemId: uuid("settles_item_id").references(() => economicItems.id, { onDelete: "set null" }),
    /** The bank or brokerage account the movement happened in, and the legal entity that owns it. */
    accountEntityId: uuid("account_entity_id").references(() => entities.id, { onDelete: "set null" }),
    entityId: uuid("entity_id").references(() => entities.id, { onDelete: "set null" }),
    isActual: char("is_actual", { length: 1 }).default("N").notNull(),
    ...timestamps,
  },
  (table) => [index("cash_events_company_month_index").on(table.companyId, table.month), uniqueIndex("cash_events_company_external_key_unique").on(table.companyId, table.externalKey), index("cash_events_counterparty_index").on(table.counterpartyEntityId)],
);

/** Derived reconciliation state. It is rebuilt from source events and never posts accounting entries itself. */
export const reconciliationEntries = pgTable(
  "reconciliation_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    eventId: uuid("event_id").notNull().references(() => cashEvents.id, { onDelete: "cascade" }),
    counterpartEventId: uuid("counterpart_event_id").references(() => cashEvents.id, { onDelete: "cascade" }),
    month: text("month").notNull(),
    kind: text("kind").notNull(),
    matchKey: text("match_key").notNull(),
    evidence: text("evidence").default("{}").notNull(),
    ...timestamps,
  },
  (table) => [index("reconciliation_entries_company_month_index").on(table.companyId, table.month), uniqueIndex("reconciliation_entries_event_match_unique").on(table.companyId, table.eventId, table.matchKey)],
);

export const reportingPeriods = pgTable(
  "reporting_periods",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    month: text("month").notNull(),
    openingCash: text("opening_cash").default("0").notNull(),
    status: reportingPeriodStatus("status").default("open").notNull(),
    closedByUserId: uuid("closed_by_user_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (table) => [uniqueIndex("reporting_period_company_month_unique").on(table.companyId, table.month)],
);

export const allocations = pgTable("allocations", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  eventId: uuid("event_id").references(() => cashEvents.id, { onDelete: "set null" }),
  itemId: uuid("item_id").references(() => economicItems.id, { onDelete: "set null" }),
  /** A recurring rule: applies to every spend from this counterparty. */
  counterpartyEntityId: uuid("counterparty_entity_id").references(() => entities.id, { onDelete: "set null" }),
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
  approvalEvents: many(approvalEvents),
  sources: many(sources),
  observations: many(observations),
  entities: many(entities),
  relationships: many(relationships),
  assumptions: many(assumptions),
  scenarios: many(scenarios),
  allocations: many(allocations),
  openingPositions: many(openingPositions),
  calculationRuns: many(calculationRuns),
  calculationOutbox: many(calculationOutbox),
}));

export const calculationRunsRelations = relations(calculationRuns, ({ one, many }) => ({
  company: one(companies, { fields: [calculationRuns.companyId], references: [companies.id] }),
  nodes: many(calculationNodes),
}));

export const calculationOutboxRelations = relations(calculationOutbox, ({ one }) => ({
  company: one(companies, { fields: [calculationOutbox.companyId], references: [companies.id] }),
  calculationRun: one(calculationRuns, { fields: [calculationOutbox.calculationRunId], references: [calculationRuns.id] }),
}));

export const calculationNodesRelations = relations(calculationNodes, ({ one }) => ({
  run: one(calculationRuns, { fields: [calculationNodes.calculationRunId], references: [calculationRuns.id] }),
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

/** Installation-owned Teller credentials stay in env; only encrypted enrollment tokens are persisted. */
export const bankConnections = pgTable("bank_connections", {
  id: uuid("id").defaultRandom().primaryKey(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  enrollmentId: text("enrollment_id").notNull(), environment: text("environment").notNull(), applicationId: text("application_id").notNull(),
  institution: text("institution").notNull(), encryptedToken: text("encrypted_token"), status: text("status").default("active").notNull(),
  createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }), nextSyncAt: timestamp("next_sync_at", { withTimezone: true }).defaultNow().notNull(),
  error: text("error"), ...timestamps,
}, (t) => [uniqueIndex("bank_connections_enrollment").on(t.environment, t.applicationId, t.enrollmentId), uniqueIndex("bank_connections_company_id").on(t.companyId, t.id), index("bank_connections_due").on(t.nextSyncAt).where(sql`${t.encryptedToken} is not null`)]);
export const bankAccounts = pgTable("bank_accounts", {
  id: uuid("id").defaultRandom().primaryKey(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  connectionId: uuid("connection_id").notNull().references(() => bankConnections.id, { onDelete: "cascade" }), providerAccountId: text("provider_account_id").notNull(),
  name: text("name").notNull(), lastFour: text("last_four"), currency: text("currency").notNull(), accountType: text("account_type").notNull(),
  status: text("status").default("open").notNull(), chartAccountId: uuid("chart_account_id").references(() => chartAccounts.id),
  snapshots: jsonb("snapshots").$type<Record<string, { hash: string; sourceId: string }>>().default({}).notNull(), ...timestamps,
}, (t) => [uniqueIndex("bank_accounts_provider").on(t.connectionId, t.providerAccountId), foreignKey({ columns: [t.companyId, t.connectionId], foreignColumns: [bankConnections.companyId, bankConnections.id] }).onDelete("cascade"), foreignKey({ columns: [t.companyId, t.chartAccountId], foreignColumns: [chartAccounts.companyId, chartAccounts.id] })]);
export const bankConnectSessions = pgTable("bank_connect_sessions", {
  id: uuid("id").defaultRandom().primaryKey(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }), nonce: text("nonce").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), ...timestamps,
});

/** Immutable operating-model inputs and selected calculation, linked to a reviewable scenario. */
export const operatingExperiments = pgTable("operating_experiments", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  scenarioId: uuid("scenario_id").notNull(),
  name: text("name").notNull(),
  requestKey: uuid("request_key").notNull(),
  requestHash: text("request_hash").notNull(),
  snapshot: jsonb("snapshot").notNull(),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex("operating_experiments_company_id").on(table.companyId, table.id), uniqueIndex("operating_experiments_request").on(table.companyId, table.requestKey), index("operating_experiments_company").on(table.companyId, table.createdAt), foreignKey({ columns: [table.companyId, table.scenarioId], foreignColumns: [scenarios.companyId, scenarios.id] })]);

/** Explicit, immutable subscriptions to reviewed source facts. Revisions remain experiments. */
export const operatingConnections = pgTable("operating_connections", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  experimentId: uuid("experiment_id").notNull(),
  bindings: jsonb("bindings").notNull(),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("operating_connections_company_id").on(t.companyId, t.id), uniqueIndex("operating_connections_experiment").on(t.companyId, t.experimentId), foreignKey({ columns: [t.companyId, t.experimentId], foreignColumns: [operatingExperiments.companyId, operatingExperiments.id] }).onDelete("cascade")]);

export const operatingRevisions = pgTable("operating_revisions", {
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  connectionId: uuid("connection_id").notNull(),
  experimentId: uuid("experiment_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.companyId, t.experimentId] }), foreignKey({ columns: [t.companyId, t.connectionId], foreignColumns: [operatingConnections.companyId, operatingConnections.id] }).onDelete("cascade"), foreignKey({ columns: [t.companyId, t.experimentId], foreignColumns: [operatingExperiments.companyId, operatingExperiments.id] }).onDelete("cascade")]);

/** Prediction vintages are pinned to the immutable reviewed application. */
export const operatingPredictions = pgTable("operating_predictions", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  experimentId: uuid("experiment_id").notNull(), reviewId: uuid("review_id").notNull(),
  snapshot: jsonb("snapshot").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("operating_predictions_company_id").on(t.companyId,t.id), uniqueIndex("operating_predictions_review").on(t.companyId,t.reviewId), index("operating_predictions_experiment").on(t.companyId,t.experimentId), foreignKey({columns:[t.companyId,t.experimentId],foreignColumns:[operatingExperiments.companyId,operatingExperiments.id]}).onDelete("cascade"), foreignKey({columns:[t.companyId,t.reviewId],foreignColumns:[goalDecisionReviews.companyId,goalDecisionReviews.id]}).onDelete("cascade")]);

/** Corrections append a new version; source snapshots remain inspectable. */
export const operatingObservations = pgTable("operating_observations", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  predictionId: uuid("prediction_id").notNull(), nodeId: text("node_id").notNull(), month: text("month").notNull(),
  supersedesId: uuid("supersedes_id"), definition: jsonb("definition").notNull(),
  requestKey: uuid("request_key").notNull(), requestHash: text("request_hash").notNull(),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("operating_observations_company_id").on(t.companyId,t.id), uniqueIndex("operating_observations_request").on(t.companyId,t.requestKey), uniqueIndex("operating_observations_successor").on(t.companyId,t.supersedesId), uniqueIndex("operating_observations_first").on(t.companyId,t.predictionId,t.nodeId,t.month).where(sql`${t.supersedesId} IS NULL`), index("operating_observations_metric").on(t.companyId,t.predictionId,t.nodeId,t.month), foreignKey({columns:[t.companyId,t.predictionId],foreignColumns:[operatingPredictions.companyId,operatingPredictions.id]}).onDelete("cascade"), foreignKey({columns:[t.companyId,t.supersedesId],foreignColumns:[t.companyId,t.id]})]);

export const operatingOutcomeReviews = pgTable("operating_outcome_reviews", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  predictionId: uuid("prediction_id").notNull(), snapshot: jsonb("snapshot").notNull(),
  requestKey: uuid("request_key").notNull(), requestHash: text("request_hash").notNull(),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("operating_outcome_reviews_request").on(t.companyId,t.requestKey), index("operating_outcome_reviews_prediction").on(t.companyId,t.predictionId), foreignKey({columns:[t.companyId,t.predictionId],foreignColumns:[operatingPredictions.companyId,operatingPredictions.id]}).onDelete("cascade")]);

/** Versioned review rules and append-only evaluations; never financial instructions. */
export const operatingTriggerRules = pgTable("operating_trigger_rules", {
  id: uuid("id").defaultRandom().primaryKey(), companyId: uuid("company_id").notNull().references(() => companies.id, {onDelete:"cascade"}),
  predictionId: uuid("prediction_id").notNull(), supersedesId: uuid("supersedes_id"), name: text("name").notNull(), definition: jsonb("definition").notNull(), reason: text("reason").notNull(),
  requestKey: uuid("request_key").notNull(), requestHash: text("request_hash").notNull(), actorUserId: uuid("actor_user_id").references(() => users.id, {onDelete:"set null"}), createdAt: timestamp("created_at", {withTimezone:true}).defaultNow().notNull(),
}, t => [uniqueIndex("operating_trigger_rules_company_id").on(t.companyId,t.id), uniqueIndex("operating_trigger_rules_request").on(t.companyId,t.requestKey), uniqueIndex("operating_trigger_rules_successor").on(t.companyId,t.supersedesId), index("operating_trigger_rules_prediction").on(t.companyId,t.predictionId), foreignKey({columns:[t.companyId,t.predictionId],foreignColumns:[operatingPredictions.companyId,operatingPredictions.id]}).onDelete("cascade"), foreignKey({columns:[t.companyId,t.supersedesId],foreignColumns:[t.companyId,t.id]})]);
export const operatingTriggerEvaluations = pgTable("operating_trigger_evaluations", {
  id: uuid("id").defaultRandom().primaryKey(), companyId: uuid("company_id").notNull().references(() => companies.id, {onDelete:"cascade"}), ruleId: uuid("rule_id").notNull(), sequence: integer("sequence").notNull(), fingerprint: text("fingerprint").notNull(), snapshot: jsonb("snapshot").notNull(), reviewId: uuid("review_id"),
  requestKey: uuid("request_key").notNull(), requestHash: text("request_hash").notNull(), actorUserId: uuid("actor_user_id").references(() => users.id, {onDelete:"set null"}), createdAt: timestamp("created_at", {withTimezone:true}).defaultNow().notNull(),
}, t => [uniqueIndex("operating_trigger_evaluations_company_id").on(t.companyId,t.id), uniqueIndex("operating_trigger_evaluations_request").on(t.companyId,t.requestKey), uniqueIndex("operating_trigger_evaluations_sequence").on(t.companyId,t.ruleId,t.sequence), index("operating_trigger_evaluations_review").on(t.companyId,t.reviewId), foreignKey({columns:[t.companyId,t.ruleId],foreignColumns:[operatingTriggerRules.companyId,operatingTriggerRules.id]}).onDelete("cascade"), foreignKey({columns:[t.companyId,t.reviewId],foreignColumns:[t.companyId,t.id]})]);
export const operatingTriggerEvents = pgTable("operating_trigger_events", {
  id: uuid("id").defaultRandom().primaryKey(), companyId: uuid("company_id").notNull().references(() => companies.id, {onDelete:"cascade"}), reviewId: uuid("review_id").notNull(), evaluationId: uuid("evaluation_id").notNull(), supersedesId: uuid("supersedes_id"), status: text("status").notNull(), snoozeUntil: text("snooze_until"), reason: text("reason").notNull(),
  requestKey: uuid("request_key").notNull(), requestHash: text("request_hash").notNull(), actorUserId: uuid("actor_user_id").references(() => users.id, {onDelete:"set null"}), createdAt: timestamp("created_at", {withTimezone:true}).defaultNow().notNull(),
}, t => [uniqueIndex("operating_trigger_events_company_id").on(t.companyId,t.id), uniqueIndex("operating_trigger_events_request").on(t.companyId,t.requestKey), uniqueIndex("operating_trigger_events_successor").on(t.companyId,t.supersedesId), uniqueIndex("operating_trigger_events_first").on(t.companyId,t.reviewId).where(sql`${t.supersedesId} IS NULL`), index("operating_trigger_events_review").on(t.companyId,t.reviewId), index("operating_trigger_events_evaluation").on(t.companyId,t.evaluationId), foreignKey({columns:[t.companyId,t.reviewId],foreignColumns:[operatingTriggerEvaluations.companyId,operatingTriggerEvaluations.id]}).onDelete("cascade"), foreignKey({columns:[t.companyId,t.evaluationId],foreignColumns:[operatingTriggerEvaluations.companyId,operatingTriggerEvaluations.id]}).onDelete("cascade"), foreignKey({columns:[t.companyId,t.supersedesId],foreignColumns:[t.companyId,t.id]})]);

/** A review-linked proposal remains an ordinary, unapproved operating experiment. */
export const operatingPlanRevisions = pgTable("operating_plan_revisions", {
  companyId: uuid("company_id").notNull().references(() => companies.id, {onDelete:"cascade"}),
  experimentId: uuid("experiment_id").notNull(), predictionId: uuid("prediction_id").notNull(), triggerReviewId: uuid("trigger_review_id").notNull(),
  createdAt: timestamp("created_at", {withTimezone:true}).defaultNow().notNull(),
}, t=>[primaryKey({columns:[t.companyId,t.experimentId]}),index("operating_plan_revisions_prediction").on(t.companyId,t.predictionId),index("operating_plan_revisions_trigger").on(t.companyId,t.triggerReviewId),foreignKey({columns:[t.companyId,t.experimentId],foreignColumns:[operatingExperiments.companyId,operatingExperiments.id]}).onDelete("cascade"),foreignKey({columns:[t.companyId,t.predictionId],foreignColumns:[operatingPredictions.companyId,operatingPredictions.id]}).onDelete("cascade"),foreignKey({columns:[t.companyId,t.triggerReviewId],foreignColumns:[operatingTriggerEvaluations.companyId,operatingTriggerEvaluations.id]}).onDelete("cascade")]);

/** Read-only analytical studies preserve assumptions, cutoffs and reproducible results. */
export const operatingStudies = pgTable("operating_studies", {
 id:uuid("id").defaultRandom().primaryKey(),companyId:uuid("company_id").notNull().references(()=>companies.id,{onDelete:"cascade"}),
 kind:text("kind").notNull(),name:text("name").notNull(),predictionId:uuid("prediction_id"),snapshot:jsonb("snapshot").notNull(),requestKey:uuid("request_key").notNull(),requestHash:text("request_hash").notNull(),actorUserId:uuid("actor_user_id").references(()=>users.id,{onDelete:"set null"}),createdAt:timestamp("created_at",{withTimezone:true}).defaultNow().notNull(),
},t=>[uniqueIndex("operating_studies_company_id").on(t.companyId,t.id),uniqueIndex("operating_studies_request").on(t.companyId,t.requestKey),index("operating_studies_prediction").on(t.companyId,t.predictionId),index("operating_studies_kind").on(t.companyId,t.kind,t.createdAt),foreignKey({columns:[t.companyId,t.predictionId],foreignColumns:[operatingPredictions.companyId,operatingPredictions.id]}).onDelete("cascade")]);
