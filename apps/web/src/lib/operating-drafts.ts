import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { getDatabase, operatingDrafts, operatingExperiments, recordAudit, setCompanyScopeSql } from "@finance/database";
import { GoalReviewError } from "./goal-reviews";
import { operatingDraftDefinition, saveOperatingDraftSchema } from "./operating-drafts-contract";
export async function loadOperatingDrafts(companyId: string) {
  const rows = await getDatabase().select({ id: operatingDrafts.id, name: operatingDrafts.name, revision: operatingDrafts.revision, updatedAt: operatingDrafts.updatedAt }).from(operatingDrafts).where(eq(operatingDrafts.companyId, companyId)).orderBy(desc(operatingDrafts.updatedAt)).limit(50);
  return { companyId, drafts: rows.map(row => ({ ...row, updatedAt: row.updatedAt.toISOString() })) };
}
export async function loadOperatingDraft(companyId: string, id: string) {
  const [row] = await getDatabase().select().from(operatingDrafts).where(and(eq(operatingDrafts.companyId, companyId), eq(operatingDrafts.id, id)));
  if (!row) throw new GoalReviewError("Decision draft not found.", 404);
  return { companyId, draft: { ...row, definition: operatingDraftDefinition.parse(row.definition), updatedAt: row.updatedAt.toISOString() } };
}
export async function saveOperatingDraft(companyId: string, actorUserId: string, raw: unknown) {
  const parsed = saveOperatingDraftSchema.safeParse(raw);
  if (!parsed.success) throw new GoalReviewError("Check the decision draft and try again.", 400);
  const input = parsed.data;
  if (!input.definition.model && !input.definition.prompt.trim()) throw new GoalReviewError("Enter a decision question before saving.", 422);
  return getDatabase().transaction(async tx => {
    await tx.execute(setCompanyScopeSql(companyId));
    if (input.experimentId) {
      const [experiment] = await tx.select({ id: operatingExperiments.id }).from(operatingExperiments).where(and(eq(operatingExperiments.companyId, companyId), eq(operatingExperiments.id, input.experimentId)));
      if (!experiment) throw new GoalReviewError("Saved experiment not found in this company.", 404);
    }
    const name = (input.definition.model?.decision?.question ?? input.definition.model?.name ?? input.definition.prompt).slice(0, 120);
    const values = { name, definition: input.definition, experimentId: input.experimentId, actorUserId, updatedAt: new Date(), revision: input.revision + 1 };
    const [saved] = input.revision === 0
      ? await tx.insert(operatingDrafts).values({ id: input.id, companyId, ...values }).onConflictDoNothing().returning()
      : await tx.update(operatingDrafts).set(values).where(and(eq(operatingDrafts.companyId, companyId), eq(operatingDrafts.id, input.id), eq(operatingDrafts.revision, input.revision))).returning();
    if (!saved) throw new GoalReviewError("This draft changed in another session. Reopen the saved draft before editing, or save your work as a new draft.", 409);
    await recordAudit(tx, { companyId, actorUserId, via: "ui", action: "operating_draft.saved", entityType: "operating_draft", entityId: saved.id, summary: "Saved a decision draft without changing the forecast.", after: { revision: saved.revision, experimentId: saved.experimentId, definition: input.definition } });
    return { companyId, draft: { ...saved, definition: input.definition, updatedAt: saved.updatedAt.toISOString() } };
  });
}
