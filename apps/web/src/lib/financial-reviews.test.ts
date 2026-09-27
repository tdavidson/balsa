import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { FinancialReviewPreview } from "./financial-reviews";
config({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)), quiet: true });
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
describe.skipIf(!process.env.DATABASE_URL)("financial review ownership", async () => {
  const { companies, users, companyMembers, economicItems, financialReviewSignoffs, financialReviewTasks, financialWorkReviews, getDatabase, closeDatabase } = await import("@finance/database");
  const { executeFinancialReview: execute, loadFinancialWorkReview: load } = await import("./financial-reviews");
  const db = getDatabase(); const ids: string[] = []; const userIds: string[] = []; const now = new Date("2026-09-26T12:00:00Z");
  async function seed() {
    const [company] = await db.insert(companies).values({ name: `Synthetic review ${randomUUID()}` }).returning(); ids.push(company!.id);
    const people = await db.insert(users).values([0, 1, 2].map(() => ({ authProvider: "fixture", authProviderUserId: randomUUID(), email: `${randomUUID()}@example.invalid` }))).returning(); userIds.push(...people.map((user) => user.id));
    await db.insert(companyMembers).values(people.map((person, i) => ({ companyId: company!.id, userId: person.id, role: i ? "member" as const : "owner" as const })));
    return { companyId: company!.id, preparer: people[0]!.id, reviewer: people[1]!.id, other: people[2]!.id };
  }
  async function create(f: Awaited<ReturnType<typeof seed>>, reviewer = f.reviewer) {
    const view = await execute(f.companyId, f.preparer, { action: "preview", scope: { kind: "cycle" } }, now) as FinancialReviewPreview;
    const command = { action: "create", scope: { kind: "cycle" }, previewToken: view.previewToken, name: "Synthetic review", reviewerUserId: reviewer, reason: "Synthetic test", requestKey: randomUUID() };
    const saved = await execute(f.companyId, f.preparer, command, now) as { id: string };
    expect(await execute(f.companyId, f.preparer, command, now)).toMatchObject({ id: saved.id, reused: true });
    return saved.id;
  }
  async function mutate(f: Awaited<ReturnType<typeof seed>>, id: string, command: object, user = f.preparer) { const saved = await load(f.companyId, user, id, now); return execute(f.companyId, user, { reviewId: id, expectedVersion: saved.review.version, reason: "Reviewed synthetic exception", ...command }, now); }
  async function waive(f: Awaited<ReturnType<typeof seed>>, id: string) {
    const saved = await load(f.companyId, f.preparer, id, now);
    for (const task of saved.tasks) await mutate(f, id, { action: "task", taskId: task.id, taskVersion: task.version, assigneeUserId: f.reviewer, dueDate: "2026-09-30", status: "waived" });
  }
  afterAll(async () => { if (ids.length) await db.delete(companies).where(inArray(companies.id, ids)); if (userIds.length) await db.delete(users).where(inArray(users.id, userIds)); await closeDatabase(); });
  it("enforces assigned reviewer, exception disposition, and immutable sign-off with refresh history", async () => {
    const f = await seed(); const id = await create(f); const initial = await load(f.companyId, f.preparer, id, now); expect(initial.tasks.length).toBeGreaterThan(0); expect(initial.stale).toBe(false);
    await mutate(f, id, { action: "submit" });
    await expect(mutate(f, id, { action: "sign" }, f.other)).rejects.toMatchObject({ status: 403 });
    await expect(mutate(f, id, { action: "sign" }, f.reviewer)).rejects.toMatchObject({ status: 422 });
    const task = initial.tasks[0]!;
    await expect(mutate(f, id, { action: "task", taskId: task.id, taskVersion: task.version, assigneeUserId: f.other, dueDate: null, status: "waived" }, f.other)).rejects.toMatchObject({ status: 403 });
    await waive(f, id); await mutate(f, id, { action: "submit" }); await mutate(f, id, { action: "sign" }, f.reviewer);
    const signed = await load(f.companyId, f.preparer, id, now); expect(signed.review.status).toBe("signed"); expect(signed.signoffs).toHaveLength(1); expect(signed.signoffs[0]?.selfReview).toBe(false);
    await expect(db.update(financialReviewSignoffs).set({ reason: "Tamper" }).where(eq(financialReviewSignoffs.id, signed.signoffs[0]!.id))).rejects.toThrow();
    await mutate(f, id, { action: "refresh" }); const reopened = await load(f.companyId, f.preparer, id, now); expect(reopened.review.status).toBe("reopened"); expect(reopened.signoffs).toEqual(signed.signoffs); expect(reopened.tasks.every((item) => item.status === "open")).toBe(true);
  });
  it("rejects foreign membership, stale scope and falsely resolved exceptions; requires self-review acknowledgement", async () => {
    const f = await seed(); const foreign = await seed();
    const view = await execute(f.companyId, f.preparer, { action: "preview", scope: { kind: "cycle" } }, now) as FinancialReviewPreview;
    await expect(execute(f.companyId, f.preparer, { action: "create", scope: { kind: "cycle" }, previewToken: view.previewToken, name: "Foreign", reviewerUserId: foreign.reviewer, reason: "test", requestKey: randomUUID() }, now)).rejects.toMatchObject({ status: 422 });
    const id = await create(f, f.preparer); await expect(load(f.companyId, foreign.reviewer, id, now)).rejects.toMatchObject({ status: 403 }); await expect(load(foreign.companyId, foreign.preparer, id, now)).rejects.toMatchObject({ status: 404 });
    await expect(db.insert(financialReviewTasks).values({ companyId: foreign.companyId, reviewId: id, title: "Foreign", subjectKey: "test" })).rejects.toThrow();
    await waive(f, id); const saved = await load(f.companyId, f.preparer, id, now); const task = saved.tasks[0]!;
    await mutate(f, id, { action: "task", taskId: task.id, taskVersion: task.version, assigneeUserId: null, dueDate: null, status: "resolved" }); await mutate(f, id, { action: "submit" });
    await expect(mutate(f, id, { action: "sign", acknowledgeSelfReview: true })).rejects.toMatchObject({ status: 422 });
    await waive(f, id); await mutate(f, id, { action: "submit" }); await expect(mutate(f, id, { action: "sign" })).rejects.toMatchObject({ status: 422 });
    await db.insert(economicItems).values({ companyId: f.companyId, label: "New unsupported assumption", type: "obligation", direction: "spend", cadence: "monthly", effectiveFrom: "2026-09", amount: "100", status: "confirmed" });
    expect((await load(f.companyId, f.preparer, id, now)).stale).toBe(true); await expect(mutate(f, id, { action: "sign", acknowledgeSelfReview: true })).rejects.toMatchObject({ status: 409 });
    await mutate(f, id, { action: "refresh" }); await waive(f, id); await mutate(f, id, { action: "submit" }); await mutate(f, id, { action: "sign", acknowledgeSelfReview: true });
    expect((await load(f.companyId, f.preparer, id, now)).signoffs[0]?.selfReview).toBe(true);
    expect(await db.select().from(financialWorkReviews).where(eq(financialWorkReviews.companyId, foreign.companyId))).toHaveLength(0);
  });
});
