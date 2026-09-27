import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { cashEvents, evidence, financialImportReviews, getDatabase, journalEntries, postingProposals, postingRuleApplications, recordAudit, setCompanyScopeSql, sourceRows, sources } from "@finance/database";
import { buildCashGoalBridge, evaluateCashGoal, stableJson } from "@nevermodel/finance-engine";
import { captureOutlook, GoalReviewError, goalsWith, previewToken } from "./goal-reviews";
import { postApprovedJournalWith, type JournalPostingRequest } from "./journal-posting";
import { loadPostedJournalLines } from "./journal-ledger";
import { loadForecastInputs } from "./forecast-inputs";
import { captureApprovedRecurrences } from "./forecast-recurrence";
import { applyApprovedAutoSettlements } from "./forecast-auto-settlement";
import { enqueueCalculationRefreshWith, processEnqueuedCalculationRefresh } from "./refresh-calculation-run";
import type { DbTransaction } from "./db-executor";
import type { GoalOutlook } from "./goal-review-contract";
const hash = (value: unknown) => createHash("sha256").update(stableJson(JSON.parse(JSON.stringify(value)))).digest("hex");
const selection = z.object({ sourceId: z.uuid(), previousSourceId: z.uuid().nullable().default(null), mode: z.enum(["full_statement", "partial_update"]).default("full_statement"), rowMappings: z.array(z.object({ currentRowId: z.uuid(), previousRowId: z.uuid() }).strict()).max(100).default([]) }).strict();
const saveFields = { previewToken: z.string().regex(/^[a-f0-9]{64}$/), name: z.string().trim().min(1).max(120), reason: z.string().trim().min(1).max(2000), acknowledgeLimitations: z.literal(true), requestKey: z.uuid() };
const commandSchema = z.discriminatedUnion("action", [selection.extend({ action: z.literal("preview") }), selection.extend({ action: z.literal("save_evaluation"), ...saveFields }), selection.extend({ action: z.literal("approve"), ...saveFields })]);
type Selection = z.infer<typeof selection>;
type Row = { id: string; sourceKey: string; rowType: string; period: string | null; transactionDate: string | null; description: string | null; amount: string | null; currency: string | null; direction: string | null; accountName: string | null; debitMinor: string | null; creditMinor: string | null; status: string };
const rowContent = ({ id: _id, sourceKey: _key, status: _status, ...content }: Row) => { void _id; void _key; void _status; return content; };
export function compareImportRows(current: Row[], previous: Row[], mode: Selection["mode"] = "full_statement", mappings: Selection["rowMappings"] = []) {
  if (new Set(mappings.map((item) => item.currentRowId)).size !== mappings.length || new Set(mappings.map((item) => item.previousRowId)).size !== mappings.length) throw new GoalReviewError("Row identity mappings must be one-to-one.", 422);
  const mapped = mappings.map((mapping) => {
    const before = previous.find((row) => row.id === mapping.previousRowId); const after = current.find((row) => row.id === mapping.currentRowId);
    if (!before || !after) throw new GoalReviewError("Mapped rows must belong to the selected imports and company.", 422);
    return { key: `mapped:${after.id}`, kind: stableJson(rowContent(before)) === stableJson(rowContent(after)) ? "duplicate" : "corrected", before, after };
  });
  current = current.filter((row) => !mappings.some((item) => item.currentRowId === row.id));
  previous = previous.filter((row) => !mappings.some((item) => item.previousRowId === row.id));
  const keys = [...new Set([...current.map((row) => row.sourceKey), ...previous.map((row) => row.sourceKey)])].sort();
  return [...mapped, ...keys.map((key) => {
    const a = previous.filter((row) => row.sourceKey === key); const b = current.filter((row) => row.sourceKey === key);
    const kind = a.length > 1 || b.length > 1 ? "ambiguous" : !a.length ? "new" : !b.length ? mode === "partial_update" ? "retained" : "removed" : stableJson(rowContent(a[0]!)) === stableJson(rowContent(b[0]!)) ? "duplicate" : "corrected";
    return { key, kind, before: a[0] ?? null, after: b[0] ?? null };
  })];
}
export async function loadImportReviewWorkspace(companyId: string) {
  const [files, reviews] = await Promise.all([
    getDatabase().select({ id: sources.id, name: sources.filename, type: sources.type, createdAt: sources.createdAt }).from(sources).where(eq(sources.companyId, companyId)).orderBy(desc(sources.createdAt)).limit(100),
    getDatabase().select({ id: financialImportReviews.id, name: financialImportReviews.name, kind: financialImportReviews.kind, sourceId: financialImportReviews.sourceId, previousSourceId: financialImportReviews.previousSourceId, createdAt: financialImportReviews.createdAt }).from(financialImportReviews).where(eq(financialImportReviews.companyId, companyId)).orderBy(desc(financialImportReviews.createdAt)).limit(50),
  ]);
  return { companyId, sources: files.map((file) => ({ ...file, createdAt: file.createdAt.toISOString() })), reviews: reviews.map((review) => ({ ...review, createdAt: review.createdAt.toISOString() })) };
}
async function prepare(tx: DbTransaction, companyId: string, selected: Selection, now: Date) {
  if (selected.sourceId === selected.previousSourceId) throw new GoalReviewError("Choose two different imports.");
  const wanted = [selected.sourceId, selected.previousSourceId].filter((id): id is string => !!id);
  const files = await tx.select().from(sources).where(and(eq(sources.companyId, companyId), inArray(sources.id, wanted)));
  if (files.length !== wanted.length) throw new GoalReviewError("Import not found for this company.", 404);
  const docs = await tx.select({ id: evidence.id, sourceId: evidence.sourceId, status: evidence.status, identityStatus: evidence.identityStatus, accountIdentifier: evidence.accountIdentifier, currency: evidence.currency, entityId: evidence.accountEntityId, start: evidence.statementPeriodStart, end: evidence.statementPeriodEnd, hash: evidence.sourceHash }).from(evidence).where(and(eq(evidence.companyId, companyId), inArray(evidence.sourceId, wanted)));
  const rows = await tx.select({ id: sourceRows.id, sourceId: sourceRows.sourceId, sourceKey: sourceRows.sourceKey, rowType: sourceRows.rowType, period: sourceRows.period, transactionDate: sourceRows.transactionDate, description: sourceRows.description, amount: sourceRows.amount, currency: sourceRows.currency, direction: sourceRows.direction, accountName: sourceRows.accountName, debitMinor: sourceRows.debitMinor, creditMinor: sourceRows.creditMinor, status: sourceRows.status }).from(sourceRows).where(and(eq(sourceRows.companyId, companyId), inArray(sourceRows.sourceId, wanted))).orderBy(sourceRows.sourceKey);
  if (rows.length > 2000) throw new GoalReviewError("Review at most 2,000 normalized rows at a time.", 422);
  const normalized = (id: string) => rows.filter((row) => row.sourceId === id).map(({ sourceId: _source, ...row }) => { void _source; return row; });
  const currentRows = normalized(selected.sourceId); const previousRows = selected.previousSourceId ? normalized(selected.previousSourceId) : [];
  const diff = compareImportRows(currentRows, previousRows, selected.mode, selected.rowMappings);
  const proposals = await tx.select().from(postingProposals).where(and(eq(postingProposals.companyId, companyId), eq(postingProposals.sourceId, selected.sourceId))).orderBy(postingProposals.id);
  const superseded = files.filter((file) => { try { return !!JSON.parse(file.metadata ?? "{}").financialReviewSupersededBy; } catch { return false; } });
  const base = await captureOutlook(tx, companyId, now); const goals = (await goalsWith(tx, companyId)).filter((goal) => goal.status === "active");
  const blockers: string[] = []; const warnings: string[] = [];
  if (superseded.length) blockers.push("One selected import was already superseded. Compare with the current replacement instead.");
  const currentDocs = docs.filter((doc) => doc.sourceId === selected.sourceId);
  if (!currentDocs.length || currentDocs.some((doc) => doc.status !== "approved" || doc.identityStatus !== "approved")) blockers.push("Review the new import's document identity and evidence before approving financial postings.");
  if (!currentRows.length) blockers.push("This import has no normalized source rows for a complete financial comparison.");
  if (diff.some((item) => item.kind === "ambiguous")) blockers.push("Repeated source-row identities make this comparison ambiguous.");
  if (selected.previousSourceId) {
    const oldDocs = docs.filter((doc) => doc.sourceId === selected.previousSourceId);
    const identity = (doc: typeof docs[number]) => [doc.accountIdentifier, doc.currency, doc.entityId];
    const incoming = currentDocs[0]; const earlier = oldDocs[0];
    if (currentDocs.length !== 1 || oldDocs.length !== 1 || !incoming?.accountIdentifier || !incoming.start || !incoming.end || !earlier?.start || !earlier.end || stableJson(identity(incoming)) !== stableJson(identity(earlier))) blockers.push("A correction requires one approved statement per import with matching account, entity and currency and dated statement periods.");
    else if (selected.mode === "full_statement" && (incoming.start !== earlier.start || incoming.end !== earlier.end)) blockers.push("A full replacement requires an exact statement-period match. Choose partial update to review overlapping periods without removing absent rows.");
    else if (selected.mode === "partial_update") {
      if (incoming.start > earlier.end || earlier.start > incoming.end) blockers.push("Partial updates require overlapping statement periods.");
      for (const item of diff.filter((item) => item.before && item.after)) {
        if (!item.before!.transactionDate || !item.after!.transactionDate || item.before!.transactionDate < earlier.start || item.before!.transactionDate > earlier.end || item.after!.transactionDate < incoming.start || item.after!.transactionDate > incoming.end || item.before!.rowType === "balance" || item.after!.rowType === "balance") blockers.push("Partial identity matches require dated transaction rows within their own statement periods; balance evidence cannot be replaced piecemeal.");
      }
      if (diff.some((item) => item.kind === "corrected" && !selected.rowMappings.some((mapping) => mapping.currentRowId === item.after?.id))) blockers.push("Explicitly map each corrected row in a partial update, including changed rows whose export key stayed the same.");
    }
    if (diff.some((item) => item.before && ["corrected", "duplicate", "removed"].includes(item.kind) && ["superseded", "duplicate"].includes(item.before.status))) blockers.push("A selected earlier row was already superseded or marked duplicate. Map to its active replacement instead.");
    if (oldDocs.some((doc) => doc.status !== "approved" || doc.identityStatus !== "approved")) blockers.push("The earlier import must have approved identity and evidence.");
    warnings.push(selected.mode === "partial_update" ? "Only explicitly mapped corrections reverse prior postings. Absent rows retain their earlier postings. Unmapped incoming rows are new; review overlap carefully. Both statement documents remain evidence, and conflicting balances still require reconciliation." : "Approval replaces this entire statement scope. Removed or corrected rows reverse their earlier postings; equal normalized rows retain their original postings.");
  } else {
    const file = files.find((item) => item.id === selected.sourceId)!;
    if (file.hash) { const same = await tx.select({ id: sources.id }).from(sources).where(and(eq(sources.companyId, companyId), eq(sources.hash, file.hash))); if (same.some((item) => item.id !== selected.sourceId)) blockers.push("An identical file already exists. Select it as the earlier import to review duplication explicitly."); }
    warnings.push("Rows from unrelated files are not automatically identified as duplicates by amount, date or account shape. Review overlap before approving.");
  }
  const allLines = await loadPostedJournalLines(companyId, "9999-12", tx);
  const entries = await tx.select({ id: journalEntries.id, reversalOf: journalEntries.reversalOfEntryId, basis: journalEntries.basis }).from(journalEntries).where(and(eq(journalEntries.companyId, companyId), eq(journalEntries.status, "posted")));
  const reversed = new Set(entries.flatMap((entry) => entry.reversalOf ? [entry.reversalOf, entry.id] : []));
  const oldIds = diff.filter((item) => ["corrected", "removed"].includes(item.kind)).flatMap((item) => item.before ? [item.before.id] : []);
  const oldProposals = selected.previousSourceId ? await tx.select().from(postingProposals).where(and(eq(postingProposals.companyId, companyId), eq(postingProposals.sourceId, selected.previousSourceId), eq(postingProposals.status, "posted"))) : [];
  if (oldProposals.some((item) => !item.sourceRowId || !previousRows.some((row) => row.id === item.sourceRowId))) blockers.push("The earlier import has postings without a normalized row identity. Review those journals separately before replacing the statement.");
  for (const duplicate of diff.filter((item) => item.kind === "duplicate" && item.before && item.after)) {
    if (duplicate.after!.rowType === "balance" || duplicate.after!.status === "reference") continue;
    if (!oldProposals.some((item) => item.sourceRowId === duplicate.before!.id && item.journalEntryId && !reversed.has(item.journalEntryId))) blockers.push("An equal row has no active earlier posting to retain. Review its posting before treating it as a duplicate.");
    if (proposals.some((item) => item.sourceRowId === duplicate.after!.id && item.status === "posted")) blockers.push("An incoming duplicate row was already posted. Reverse the duplicate journal before approving this comparison.");
  }
  const reversalRequests: JournalPostingRequest[] = [];
  for (const id of [...new Set(oldProposals.filter((item) => item.sourceRowId && oldIds.includes(item.sourceRowId)).map((item) => item.journalEntryId).filter((id): id is string => !!id))]) {
    if (reversed.has(id)) continue;
    const original = allLines.filter((line) => line.entryId === id); const first = original[0];
    if (!first || entries.find((entry) => entry.id === id)?.basis !== "actual") { blockers.push("A replaced row has unsupported or unavailable journal history."); continue; }
    const stored = oldProposals.find((proposal) => proposal.journalEntryId === id)!;
    let basis: JournalPostingRequest; try { basis = JSON.parse(stored.proposalJson); } catch { blockers.push("A prior posting has unreadable provenance."); continue; }
    reversalRequests.push({ idempotencyKey: `import-replace:${selected.sourceId}:${id}`, label: "Reverse superseded import row", source: "journal_reversal", postingDate: first.postingDate ?? `${first.period}-01`, period: first.period, memo: "Reversal for reviewed statement replacement", basis: "actual", reversalOfEntryId: id, ...(basis.policyId ? { policyId: basis.policyId } : {}), ...(basis.evidenceId ? { evidenceId: basis.evidenceId } : {}), ...(basis.approvalEventId ? { approvalEventId: basis.approvalEventId } : {}), lines: original.map((line) => ({ accountId: line.accountId, currency: line.currency, debitMinor: line.creditMinor, creditMinor: line.debitMinor, ...(line.entityId ? { entityId: line.entityId } : {}), ...(line.provenance?.factId ? { factId: line.provenance.factId } : {}), ...(line.provenance?.sourceId ? { sourceId: line.provenance.sourceId } : {}) })) });
  }
  const requests: { proposalId: string; request: JournalPostingRequest }[] = [];
  for (const item of diff.filter((row) => row.after && row.kind !== "duplicate")) {
    if (item.after!.status !== "approved" && item.after!.status !== "reference") blockers.push(`${item.after!.description ?? item.key}: source row is not approved.`);
    const options = proposals.filter((proposal) => proposal.sourceRowId === item.after!.id && proposal.status !== "rejected");
    if (item.after!.rowType === "balance" || item.after!.status === "reference") { warnings.push(`${item.after!.description ?? item.key}: evidence-only row; no direct cash posting.`); continue; }
    if (options.length !== 1) { blockers.push(`${item.after!.description ?? item.key}: needs one reviewed posting proposal.`); continue; }
    const proposal = options[0]!;
    if (proposal.status === "posted") { warnings.push(`${item.after!.description ?? item.key}: already posted; retained unchanged.`); continue; }
    let request: JournalPostingRequest;
    try { request = JSON.parse(proposal.proposalJson); } catch { blockers.push("A posting proposal cannot be read safely."); continue; }
    if (!Array.isArray(request.lines) || request.lines.length > 100 || !request.lines.length || (request.basis ?? "actual") !== "actual" || request.reversalOfEntryId || request.sourceId !== selected.sourceId || request.sourceRowId !== item.after!.id) { blockers.push("A proposal has unsupported posting scope or source lineage."); continue; }
    if (request.lines.some((line) => line.fxRateId || line.transactionCurrency && line.transactionCurrency !== base.input.currency)) { blockers.push("Foreign-currency import effects require separate reviewed FX support."); continue; }
    requests.push({ proposalId: proposal.id, request });
  }
  if (requests.length + reversalRequests.length > 200) blockers.push("At most 200 journal effects can be approved together.");
  const fingerprint = hash({ selected, files, docs, rows, proposals, oldProposals, base: previewToken(base), goals });
  return { selected, sourceName: files.find((file) => file.id === selected.sourceId)!.filename ?? "Imported source", diff, base, goals, blockers: [...new Set(blockers)], warnings: [...new Set(warnings)], requests, reversalRequests, fingerprint };
}
async function postEffects(tx: DbTransaction, companyId: string, prepared: Awaited<ReturnType<typeof prepare>>, actorUserId: string | null, now: Date) {
  const entryIds: string[] = [];
  for (const request of [...prepared.reversalRequests, ...prepared.requests.map((item) => item.request)]) {
    const posted = await postApprovedJournalWith(tx, companyId, { ...request, ...(actorUserId ? { actorUserId } : {}), deferRefresh: true }); entryIds.push(posted.entryId);
  }
      const duplicateIds = prepared.diff.filter((row) => row.kind === "duplicate" && row.after).map((row) => row.after!.id);
      if (duplicateIds.length) { await tx.update(sourceRows).set({ status: "duplicate", updatedAt: now }).where(and(eq(sourceRows.companyId, companyId), inArray(sourceRows.id, duplicateIds))); await tx.update(cashEvents).set({ isActual: "N", updatedAt: now }).where(and(eq(cashEvents.companyId, companyId), inArray(cashEvents.sourceRowId, duplicateIds))); }
      if (duplicateIds.length) await tx.update(postingProposals).set({ status: "rejected", rationale: "Duplicate import row; the earlier reviewed posting is retained.", updatedAt: now }).where(and(eq(postingProposals.companyId, companyId), inArray(postingProposals.sourceRowId, duplicateIds), inArray(postingProposals.status, ["draft", "approved"])));
      if (prepared.selected.previousSourceId) {
        const [oldSource] = await tx.select({ metadata: sources.metadata }).from(sources).where(and(eq(sources.companyId, companyId), eq(sources.id, prepared.selected.previousSourceId)));
        let metadata: Record<string, unknown> = {}; try { const parsed = JSON.parse(oldSource?.metadata ?? "{}"); if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) metadata = parsed; } catch { throw new GoalReviewError("Earlier source metadata cannot be preserved safely.", 422); }
        if (prepared.selected.mode === "full_statement") await tx.update(sources).set({ metadata: JSON.stringify({ ...metadata, financialReviewSupersededBy: prepared.selected.sourceId }), updatedAt: now }).where(and(eq(sources.companyId, companyId), eq(sources.id, prepared.selected.previousSourceId)));
        const supersededIds = prepared.diff.filter((row) => ["corrected", "removed"].includes(row.kind) && row.before).map((row) => row.before!.id);
        if (supersededIds.length) { await tx.update(sourceRows).set({ status: "superseded", updatedAt: now }).where(and(eq(sourceRows.companyId, companyId), inArray(sourceRows.id, supersededIds))); await tx.update(cashEvents).set({ isActual: "N", updatedAt: now }).where(and(eq(cashEvents.companyId, companyId), inArray(cashEvents.sourceRowId, supersededIds))); }
      }
      const proposalIds = prepared.requests.map((item) => item.proposalId);
      if (proposalIds.length) await tx.update(postingRuleApplications).set({ outcome: "posted", updatedAt: now }).where(and(eq(postingRuleApplications.companyId, companyId), inArray(postingRuleApplications.postingProposalId, proposalIds)));
  let input = await loadForecastInputs(companyId, { db: tx, now });
  if (await captureApprovedRecurrences(tx, companyId, input, now.toISOString().slice(0, 10))) input = await loadForecastInputs(companyId, { db: tx, now });
  if (input.settlement) await applyApprovedAutoSettlements(tx, companyId, input.settlement, input.currency);
  return entryIds;
}
async function previewWith(tx: DbTransaction, companyId: string, selected: Selection, now: Date) {
  const prepared = await prepare(tx, companyId, selected, now); let after: GoalOutlook | null = null;
  if (!prepared.blockers.length) {
    const rollback = new Error("synthetic preview rollback");
    try { await tx.transaction(async (savepoint) => { await postEffects(savepoint, companyId, prepared, null, now); after = await captureOutlook(savepoint, companyId, now); throw rollback; }); }
    catch (error) { if (error !== rollback) prepared.blockers.push("At least one posting failed its accounting, approval, mapping or period controls. Resolve the proposal before approval; no preview postings were retained."); }
  }
  const outlook = after as GoalOutlook | null;
  const evaluations = prepared.goals.map((goal) => {
    const before = evaluateCashGoal(goal.definition, prepared.base.output, prepared.base.limitations);
    const next = outlook ? evaluateCashGoal(goal.definition, outlook.output, outlook.limitations) : null;
    return { goal, before, after: next, bridge: outlook && next ? buildCashGoalBridge({ companyId, goalVersionId: goal.id, input: prepared.base.input, output: prepared.base.output, actualJournalLines: prepared.base.actualJournalLines, evaluation: before }, { companyId, goalVersionId: goal.id, input: outlook.input, output: outlook.output, actualJournalLines: outlook.actualJournalLines, evaluation: next }) : null };
  });
  return { prepared, view: { companyId, previewToken: prepared.fingerprint, sourceId: selected.sourceId, previousSourceId: selected.previousSourceId, mode: selected.mode, rowMappings: selected.rowMappings, sourceName: prepared.sourceName, rows: prepared.diff, blockers: prepared.blockers, warnings: prepared.warnings, evaluations, before: prepared.base, after: outlook, postingCount: prepared.requests.length, reversalCount: prepared.reversalRequests.length } };
}
export type ImportPreview = Awaited<ReturnType<typeof previewWith>>["view"];
export async function loadImportReview(companyId: string, id: string) {
  if (!z.uuid().safeParse(id).success) throw new GoalReviewError("Invalid import review ID.");
  const [review] = await getDatabase().select().from(financialImportReviews).where(and(eq(financialImportReviews.companyId, companyId), eq(financialImportReviews.id, id)));
  if (!review) throw new GoalReviewError("Import review not found.", 404);
  return { companyId, id: review.id, name: review.name, kind: review.kind, reason: review.reason, snapshot: review.snapshot as { preview: ImportPreview; appliedOutlook?: GoalOutlook; entryIds: string[] } };
}
export async function executeImportReview(companyId: string, raw: unknown, actorUserId: string | null, now = new Date()) {
  const parsed = commandSchema.safeParse(raw); if (!parsed.success) throw new GoalReviewError("Invalid import review. Choose sources and provide the preview, reason and acknowledgement.");
  const command = parsed.data;
  const committed = await getDatabase().transaction(async (tx) => {
    await tx.execute(setCompanyScopeSql(companyId));
    await tx.execute(sql`select pg_advisory_xact_lock(7408, hashtext(${companyId}))`);
    await tx.execute(sql`select pg_advisory_xact_lock(7406, hashtext(${companyId}))`);
    const requestHash = hash(command);
    if (command.action !== "preview") {
      const [prior] = await tx.select().from(financialImportReviews).where(and(eq(financialImportReviews.companyId, companyId), eq(financialImportReviews.requestKey, command.requestKey)));
      if (prior) { if (prior.requestHash !== requestHash) throw new GoalReviewError("Request key already used for another import review.", 409); return { result: { savedId: prior.id, reused: true }, receipt: null }; }
    }
    const { prepared, view } = await previewWith(tx, companyId, { sourceId: command.sourceId, previousSourceId: command.previousSourceId, mode: command.mode, rowMappings: command.rowMappings }, now);
    if (command.action === "preview") return { result: view, receipt: null };
    if (command.previewToken !== view.previewToken) throw new GoalReviewError("The import, approvals or outlook changed. Refresh the impact preview.", 409);
    let receipt = null; const entryIds: string[] = []; let appliedOutlook: GoalOutlook | undefined;
    if (command.action === "approve") {
      if (view.blockers.length || !view.after) throw new GoalReviewError("Resolve all import blockers before approving financial effects.", 422);
      entryIds.push(...await postEffects(tx, companyId, prepared, actorUserId, now));
      receipt = await enqueueCalculationRefreshWith(tx, companyId, { cause: { kind: "evidence_published", subjectType: "source", subjectId: command.sourceId, subjectIds: entryIds, actorUserId, via: "ui" } });
      appliedOutlook = await captureOutlook(tx, companyId, now);
      const cash = (outlook: GoalOutlook) => outlook.output.months.map(({ driverIds: _ids, ...month }) => { void _ids; return month; });
      if (stableJson(cash(appliedOutlook)) !== stableJson(cash(view.after))) throw new GoalReviewError("Applied import cash differs from the preview. All postings were rolled back.", 409);
    }
    const snapshot = { preview: view, ...(appliedOutlook ? { appliedOutlook } : {}), entryIds };
    if (Buffer.byteLength(JSON.stringify(snapshot)) > 24_000_000) throw new GoalReviewError("This import review exceeds the saved snapshot limit.", 422);
    const [saved] = await tx.insert(financialImportReviews).values({ companyId, sourceId: command.sourceId, previousSourceId: command.previousSourceId, kind: command.action === "approve" ? "applied" : "evaluation", name: command.name, reason: command.reason, requestKey: command.requestKey, requestHash, snapshot: JSON.parse(JSON.stringify(snapshot)), actorUserId }).returning({ id: financialImportReviews.id });
    await recordAudit(tx, { companyId, actorUserId, via: "ui", action: command.action === "approve" ? "import.effects_approved" : "import.evaluation_saved", entityType: "financial_import_review", entityId: saved!.id, summary: command.reason, after: { sourceId: command.sourceId, previousSourceId: command.previousSourceId, entryIds }, requestId: command.requestKey });
    return { result: { savedId: saved!.id, reused: false }, receipt };
  }, { isolationLevel: "repeatable read" });
  if (committed.receipt) await processEnqueuedCalculationRefresh(committed.receipt, now);
  return committed.result;
}
