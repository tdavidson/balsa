import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";
const publish = vi.hoisted(() => ({ fail: false }));
vi.mock("./evidence-publish", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./evidence-publish")>();
  return { ...actual, publishEvidenceIfComplete: async (...args: Parameters<typeof actual.publishEvidenceIfComplete>) => { if (publish.fail) throw new Error("model unavailable"); return actual.publishEvidenceIfComplete(...args); } };
});
config({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)), quiet: true });
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!process.env.DATABASE_URL)("evidence acceptance under the owner's confidence threshold", async () => {
  const { approvalEvents, auditLog, closeDatabase, companies, evidence, factRecords, getDatabase, sources, users } = await import("@finance/database");
  const { acceptEvidenceFacts, AcceptanceError } = await import("./evidence-acceptance");
  const { assumptionFromApprovals } = await import("./review-assessment");
  const db = getDatabase(); const companyIds: string[] = []; const userIds: string[] = [];
  afterAll(async () => { if (companyIds.length) await db.delete(companies).where(inArray(companies.id, companyIds)); if (userIds.length) await db.delete(users).where(inArray(users.id, userIds)); await closeDatabase(); });

  async function seed(threshold: string | null, classification: "high" | "low" = "high") {
    const [company] = await db.insert(companies).values({ name: `Synthetic review ${randomUUID()}`, reviewConfidenceThreshold: threshold }).returning(); companyIds.push(company!.id);
    const [user] = await db.insert(users).values({ authProvider: "fixture", authProviderUserId: randomUUID(), email: `${randomUUID()}@example.invalid` }).returning(); userIds.push(user!.id);
    const [source] = await db.insert(sources).values({ companyId: company!.id, type: "bank_statement", filename: "Synthetic statement.pdf", metadata: JSON.stringify({ classification: { kind: "bank_statement", confidence: classification } }) }).returning();
    const rawText = "Synthetic Bank\nEnding balance 14,250.75\nDeposit 2,000.00\nService fee 4.00";
    const facts = [
      { label: "Ending balance", value: "14,250.75", accountingRole: "ending_balance", confidence: "0.97" },
      { label: "Deposit", value: "2,000.00", accountingRole: "transaction", confidence: "0.62" },
      { label: "Service fee", value: "4.00", accountingRole: "expense", confidence: "0.7" },
      { label: "Unexplained credit", value: "900.00", accountingRole: "unknown", confidence: "0.99" },
    ];
    const [doc] = await db.insert(evidence).values({ companyId: company!.id, createdByUserId: user!.id, sourceId: source!.id, sourceName: "Synthetic statement", rawText, reportingMonth: "2026-09", extractedJson: JSON.stringify({ summary: "Synthetic", facts: facts.map((fact) => ({ ...fact, confidence: Number(fact.confidence) })), questions: [] }), status: "pending", identityStatus: "pending" }).returning();
    await db.insert(factRecords).values(facts.map((fact) => ({ companyId: company!.id, evidenceId: doc!.id, ...fact })));
    const context = { company: { id: company!.id, name: company!.name, role: "owner" }, user: { id: user!.id } } as unknown as Parameters<typeof acceptEvidenceFacts>[0];
    return { context, evidenceId: doc!.id, companyId: company!.id };
  }
  const statusOf = async (companyId: string) => Object.fromEntries((await db.select({ label: factRecords.label, status: factRecords.status }).from(factRecords).where(eq(factRecords.companyId, companyId))).map((row) => [row.label, row.status]));

  it("assumes the document and confident facts, leaves decisions and less important facts, and records why", async () => {
    const { context, evidenceId, companyId } = await seed("0.9");
    const result = await acceptEvidenceFacts(context, evidenceId, "assumed");
    expect(result).toMatchObject({ accepted: 1, identity: "assumed", publication: "not_ready", threshold: 0.9 });
    expect(await statusOf(companyId)).toEqual({ "Ending balance": "treatment_approved", Deposit: "pending", "Service fee": "pending", "Unexplained credit": "pending" });
    const events = await db.select().from(approvalEvents).where(eq(approvalEvents.companyId, companyId));
    expect(events.map((event) => event.layer).sort()).toEqual(["document", "fact", "treatment"]);
    const [fact] = await db.select({ id: factRecords.id }).from(factRecords).where(and(eq(factRecords.companyId, companyId), eq(factRecords.label, "Ending balance")));
    expect(assumptionFromApprovals(events, fact!.id)).toMatchObject({ threshold: 0.9, score: 0.97 });
    expect(assumptionFromApprovals(events, null)).toMatchObject({ threshold: 0.9, score: 0.95 });
    expect((await db.select({ action: auditLog.action }).from(auditLog).where(eq(auditLog.companyId, companyId))).map((row) => row.action)).toEqual(["evidence.assumed", "evidence.assumed"]);
    // A repeated pass changes nothing and records nothing.
    expect(await acceptEvidenceFacts(context, evidenceId, "assumed")).toMatchObject({ accepted: 0, identity: "already_confirmed" });
    expect(await db.select().from(approvalEvents).where(eq(approvalEvents.companyId, companyId))).toHaveLength(3);
  });

  it("never assumes again a fact a person sent back to review", async () => {
    const { context, evidenceId, companyId } = await seed("0.9");
    await acceptEvidenceFacts(context, evidenceId, "assumed");
    const [fact] = await db.select({ id: factRecords.id }).from(factRecords).where(and(eq(factRecords.companyId, companyId), eq(factRecords.label, "Ending balance")));
    // What the evidence PATCH records when a person chooses "Ask me instead".
    await db.update(factRecords).set({ status: "pending" }).where(eq(factRecords.id, fact!.id));
    await db.insert(approvalEvents).values({ companyId, evidenceId, factId: fact!.id, userId: context.user.id, layer: "fact", action: "pending" });
    expect(await acceptEvidenceFacts(context, evidenceId, "assumed")).toMatchObject({ accepted: 0 });
    expect((await statusOf(companyId))["Ending balance"]).toBe("pending");
  });

  it("accepts less important facts only on request and never one without an accounting role", async () => {
    const { context, evidenceId, companyId } = await seed("0.9");
    await expect(acceptEvidenceFacts({ ...context, company: { ...context.company } }, evidenceId, "minor")).rejects.toThrow(AcceptanceError);
    await acceptEvidenceFacts(context, evidenceId, "assumed");
    expect(await acceptEvidenceFacts(context, evidenceId, "minor")).toMatchObject({ accepted: 1 });
    expect(await statusOf(companyId)).toMatchObject({ "Service fee": "treatment_approved", Deposit: "pending", "Unexplained credit": "pending" });
    const events = await db.select().from(approvalEvents).where(eq(approvalEvents.companyId, companyId));
    const [fee] = await db.select({ id: factRecords.id }).from(factRecords).where(and(eq(factRecords.companyId, companyId), eq(factRecords.label, "Service fee")));
    // A person's batch acceptance is a decision, not an assumption.
    expect(assumptionFromApprovals(events, fee!.id)).toBeNull();
  });

  it("asks about a document whose identity falls below the threshold, and refuses without a threshold", async () => {
    const low = await seed("0.9", "low");
    expect(await acceptEvidenceFacts(low.context, low.evidenceId, "assumed")).toMatchObject({ accepted: 0, identity: "needs_review" });
    expect(Object.values(await statusOf(low.companyId)).every((status) => status === "pending")).toBe(true);
    const unset = await seed(null);
    await expect(acceptEvidenceFacts(unset.context, unset.evidenceId, "assumed")).rejects.toMatchObject({ status: 409 });
  });

  it("reports committed acceptances when publication fails afterwards", async () => {
    const { context, evidenceId, companyId } = await seed("0.9");
    publish.fail = true;
    try {
      expect(await acceptEvidenceFacts(context, evidenceId, "assumed")).toMatchObject({ accepted: 1, identity: "assumed", publication: "failed" });
    } finally { publish.fail = false; }
    expect((await statusOf(companyId))["Ending balance"]).toBe("treatment_approved");
  });

  it("cannot reach another company's evidence", async () => {
    const own = await seed("0.8");
    const other = await seed("0.8");
    await expect(acceptEvidenceFacts(own.context, other.evidenceId, "assumed")).rejects.toMatchObject({ status: 404 });
    expect(Object.values(await statusOf(other.companyId)).every((status) => status === "pending")).toBe(true);
  });
});
