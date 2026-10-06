import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
config({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)), quiet: true });
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
describe.skipIf(!process.env.DATABASE_URL)("persistent decision drafts", async () => {
  const { getDatabase, closeDatabase, companies, users } = await import("@finance/database");
  const { saveOperatingDraft, loadOperatingDraft, loadOperatingDrafts } = await import("./operating-drafts");
  const db = getDatabase(); const ids: string[] = []; const actors: string[] = [];
  async function seed() {
    const [co] = await db.insert(companies).values({ name: `Synthetic decision ${randomUUID()}` }).returning(); ids.push(co!.id);
    const [user] = await db.insert(users).values({ authProvider: "test", authProviderUserId: randomUUID(), email: `${randomUUID()}@example.invalid` }).returning(); actors.push(user!.id);
    return { companyId: co!.id, actor: user!.id };
  }
  afterAll(async () => { if (ids.length) await db.delete(companies).where(inArray(companies.id, ids)); if (actors.length) await db.delete(users).where(inArray(users.id, actors)); await closeDatabase(); });
  const command = () => ({ id: randomUUID(), revision: 0, definition: { prompt: "Can we hire two people?", model: null, selectedCase: "base" }, experimentId: null });
  it("persists unfinished work, rejects stale writes and never exposes another company's draft", async () => {
    const a = await seed(); const b = await seed(); const input = command();
    const saved = await saveOperatingDraft(a.companyId, a.actor, input);
    expect(saved.draft.revision).toBe(1);
    expect((await loadOperatingDraft(a.companyId, input.id)).draft.definition.prompt).toBe(input.definition.prompt);
    expect((await loadOperatingDrafts(b.companyId)).drafts).toEqual([]);
    await expect(loadOperatingDraft(b.companyId, input.id)).rejects.toMatchObject({ status: 404 });
    await expect(saveOperatingDraft(b.companyId, b.actor, { ...input, revision: 1 })).rejects.toMatchObject({ status: 409 });
    const attempts = await Promise.allSettled([1, 2].map(n => saveOperatingDraft(a.companyId, a.actor, { ...input, revision: 1, definition: { ...input.definition, prompt: `Revision ${n}` } })));
    expect(attempts.filter(item => item.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter(item => item.status === "rejected")).toHaveLength(1);
    expect((await loadOperatingDraft(a.companyId, input.id)).draft.revision).toBe(2);
  });
  it("rejects invalid drafts and unavailable experiment links", async () => {
    const a = await seed(); const input = command();
    await expect(saveOperatingDraft(a.companyId, a.actor, { ...input, experimentId: randomUUID() })).rejects.toMatchObject({ status: 404 });
    await expect(saveOperatingDraft(a.companyId, a.actor, { ...input, definition: { ...input.definition, prompt: "" } })).rejects.toMatchObject({ status: 422 });
    await expect(saveOperatingDraft(a.companyId, a.actor, { ...input, revision: -1 })).rejects.toMatchObject({ status: 400 });
  });
});
