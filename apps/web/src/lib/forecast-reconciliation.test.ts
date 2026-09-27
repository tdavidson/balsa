import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { buildForecastRun } from "@nevermodel/finance-engine";

config({ path: fileURLToPath(new URL("../../../../.env.local", import.meta.url)), quiet: true });
config({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)), quiet: true });
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!process.env.DATABASE_URL)("reviewed forecast settlement and coverage", async () => {
  if (!process.env.DATABASE_URL) return;
  const { auditLog, chartAccounts, closeDatabase, companies, economicItems, forecastEntryTemplates, forecastOccurrences, forecastRecurrencePolicies, forecastSettlementAllocations, getDatabase, policies, sourceRows, sources, users, evidence, factRecords } = await import("@finance/database");
  const { executeForecastReconciliation: execute, loadForecastReconciliation: review } = await import("./forecast-reconciliation");
  const { loadForecastInputs } = await import("./forecast-inputs");
  const { postApprovedJournal } = await import("./journal-posting");
  const db = getDatabase(); const ids: string[] = []; const userIds: string[] = []; const now = new Date("2026-09-25T12:00:00Z");
  async function seed() {
    const [company] = await db.insert(companies).values({ name: `Synthetic settlement ${randomUUID()}` }).returning();
    const id = company!.id; ids.push(id);
    const accounts = await db.insert(chartAccounts).values([
      { companyId: id, code: "1000", name: "Cash", accountType: "asset", normalBalance: "debit", statementLine: "Cash" },
      { companyId: id, code: "3000", name: "Capital", accountType: "equity", normalBalance: "credit" },
      { companyId: id, code: "4000", name: "Revenue", accountType: "revenue", normalBalance: "credit" },
      { companyId: id, code: "6000", name: "Costs", accountType: "expense", normalBalance: "debit" },
    ]).returning();
    const account = (code: string) => accounts.find((item) => item.code === code)!.id;
    const [policy] = await db.insert(policies).values({ companyId: id, name: "Synthetic postings", rule: "Approved synthetic fixture only" }).returning();
    await db.insert(forecastEntryTemplates).values([
      { companyId: id, name: "Receipts", itemType: "agreement", direction: "receipt", debitAccountId: account("1000"), creditAccountId: account("4000") },
      { companyId: id, name: "Costs", itemType: "obligation", direction: "spend", debitAccountId: account("6000"), creditAccountId: account("1000") },
    ]);
    await db.insert(economicItems).values([
      { companyId: id, type: "agreement", direction: "receipt", label: "Expected customer cash", amount: "100000", cadence: "monthly", effectiveFrom: "2026-09", status: "confirmed" },
      { companyId: id, type: "obligation", direction: "spend", label: "Expected operating costs", amount: "150000", cadence: "monthly", effectiveFrom: "2026-09", status: "confirmed" },
    ]);
    async function post(amount: string, date: string, offset = "4000", reversedId?: string, factId?: string) {
      const reverse = Boolean(reversedId);
      return postApprovedJournal(id, { ...(factId ? { factId } : {}), policyId: policy!.id, idempotencyKey: randomUUID(), label: "Synthetic cash", source: "synthetic_fixture", memo: "Synthetic customer receipt", postingDate: date, period: date.slice(0, 7), deferRefresh: true, ...(reversedId ? { reversalOfEntryId: reversedId } : {}), lines: [
        { accountId: account("1000"), currency: "USD", debitMinor: reverse ? "0" : amount, creditMinor: reverse ? amount : "0" },
        { accountId: account(offset), currency: "USD", debitMinor: reverse ? amount : "0", creditMinor: reverse ? "0" : amount },
      ] });
    }
    await post("50000000", "2026-08-31", "3000");
    return { id, account, post };
  }
  async function capture(id: string, autoMatch = false) {
    const data = await review(id, now); const candidate = data.candidates.find((item) => item.definition.label === "Expected customer cash")!;
    const command = { action: "capture", autoMatch, candidateKey: candidate.definition.key, candidateHash: candidate.hash, independentObligation: true, reason: "Reviewed original customer obligation", requestKey: randomUUID() };
    const saved = await execute(id, command, null, now);
    return { id: (saved as Record<string, unknown>).id as string, command };
  }
  async function sourceFact(id: string) {
    const [user] = await db.insert(users).values({ authProvider: "fixture", authProviderUserId: randomUUID(), email: `${randomUUID()}@example.invalid` }).returning(); userIds.push(user!.id);
    const [document] = await db.insert(evidence).values({ companyId: id, createdByUserId: user!.id, sourceName: "Synthetic agreement", rawText: "Synthetic fixture", status: "approved", identityStatus: "approved" }).returning();
    const [fact] = await db.insert(factRecords).values({ companyId: id, evidenceId: document!.id, label: "Synthetic cash obligation", value: "100000", confidence: "1", status: "approved" }).returning();
    await db.update(economicItems).set({ cadence: "once", factId: fact!.id, evidenceId: document!.id }).where(and(eq(economicItems.companyId, id), eq(economicItems.direction, "receipt")));
    return fact!.id;
  }
  async function job(id: string, jobNow = now) {
    const { runForecastJob } = await import("./forecast-job");
    const [company] = await db.select().from(companies).where(eq(companies.id, id));
    return runForecastJob(id, company!.financialStateRevision, { now: jobNow });
  }
  const allocate = (occurrenceId: string, actualEntryId: string, amountMinor: string, expectedVersion = 1, final = false) => ({ action: "allocate", occurrenceId, actualEntryId, amountMinor, expectedVersion, final, reason: "Reviewed synthetic installment against customer obligation", requestKey: randomUUID() });
  async function cash(id: string, month: string) { return buildForecastRun(await loadForecastInputs(id, { now })).months.find((item) => item.month === month)!.endingCashMinor; }
  afterAll(async () => { if (ids.length) await db.delete(companies).where(inArray(companies.id, ids)); if (userIds.length) await db.delete(users).where(inArray(users.id, userIds)); await closeDatabase(); });

  async function approveRecurring(id: string, at = now, expectedVersion = 0) {
    const current = await review(id, at); const option = current.recurrence.options.find((item) => item.label === "Expected customer cash")!;
    const command = { action: "approve_recurrence", driverId: option.driverId, definitionHash: option.hash, expectedVersion, endMonth: "2027-03", independentObligation: true, reason: "Approved fixed customer schedule through March", requestKey: randomUUID() };
    const saved = await execute(id, command, null, at); return { saved, command };
  }

  it("captures recurring occurrences once, catches up missed months, and preserves a revised installment", async () => {
    const fixture = await seed(); const captured = await capture(fixture.id); const approved = await approveRecurring(fixture.id);
    expect((await review(fixture.id, now)).settlement.occurrences).toHaveLength(1);
    expect(await execute(fixture.id, approved.command, null, now)).toMatchObject({ reused: true });
    const actual = await fixture.post("6000000", "2026-09-15");
    await execute(fixture.id, allocate(captured.id, actual.entryId, "6000000"), null, now);
    await execute(fixture.id, { action: "revise_occurrence", occurrenceId: captured.id, expectedVersion: 2, expectedDate: "2026-11-15", amountMinor: "10000000", status: "active", final: false, reason: "Remaining September installment delayed", requestKey: randomUUID() }, null, now);
    const november = new Date("2026-11-02T12:00:00Z"); await job(fixture.id, november); await job(fixture.id, november);
    const current = await review(fixture.id, november);
    expect(current.settlement.occurrences).toHaveLength(3);
    expect(current.settlement.occurrences.find((item) => item.id === captured.id)?.expectedDate).toBe("2026-11-15");
    expect(current.results.find((item) => item.id === captured.id)?.remainingMinor).toBe("4000000");
    expect(current.recurrence.states[0]?.pendingCount).toBe(0);
    expect(await db.select().from(auditLog).where(and(eq(auditLog.companyId, fixture.id), eq(auditLog.action, "forecast.recurring_captured")))).toHaveLength(2);
    expect(await db.select().from(forecastRecurrencePolicies).where(eq(forecastRecurrencePolicies.companyId, fixture.id))).toHaveLength(1);
  });

  it("blocks changed schedules until renewed approval and keeps earlier occurrences unchanged", async () => {
    const fixture = await seed(); const approved = await approveRecurring(fixture.id);
    await db.update(economicItems).set({ amount: "120000" }).where(and(eq(economicItems.companyId, fixture.id), eq(economicItems.direction, "receipt")));
    const october = new Date("2026-10-02T12:00:00Z"); await job(fixture.id, october);
    const stale = await review(fixture.id, october); expect(stale.recurrence.states[0]?.state).toBe("stale"); expect(stale.settlement.occurrences).toHaveLength(1);
    await expect(execute(fixture.id, { ...approved.command, expectedVersion: 1, requestKey: randomUUID() }, null, october)).rejects.toMatchObject({ status: 409 });
    await approveRecurring(fixture.id, october, 1);
    const renewed = await review(fixture.id, october);
    expect(renewed.settlement.occurrences.find((item) => item.originalMonth === "2026-09")?.amountMinor).toBe("10000000");
    expect(renewed.settlement.occurrences.find((item) => item.originalMonth === "2026-10")?.amountMinor).toBe("12000000");
    expect(renewed.recurrence.states[0]?.policy.version).toBe(2);
  });

  it("invalidates recurring approval when its supporting fact changes and respects the approved end month", async () => {
    const fixture = await seed(); const factId = await sourceFact(fixture.id);
    await db.update(economicItems).set({ cadence: "monthly" }).where(and(eq(economicItems.companyId, fixture.id), eq(economicItems.direction, "receipt")));
    await approveRecurring(fixture.id);
    await db.update(factRecords).set({ value: "120000" }).where(eq(factRecords.id, factId));
    const october = new Date("2026-10-02T12:00:00Z"); await job(fixture.id, october);
    expect((await review(fixture.id, october)).recurrence.states[0]?.state).toBe("stale");
    expect((await review(fixture.id, october)).settlement.occurrences).toHaveLength(1);
    const bounded = await seed(); await approveRecurring(bounded.id);
    const april = new Date("2027-04-02T12:00:00Z"); await job(bounded.id, april);
    const expired = await review(bounded.id, april);
    expect(expired.recurrence.states[0]?.state).toBe("expired");
    expect(expired.settlement.occurrences).toHaveLength(7);
    expect(expired.settlement.occurrences.some((item) => item.originalMonth === "2027-04")).toBe(false);
    await db.update(economicItems).set({ amount: "130000" }).where(and(eq(economicItems.companyId, bounded.id), eq(economicItems.direction, "receipt")));
    expect((await review(bounded.id, april)).recurrence.states[0]?.state).toBe("expired");
  });

  it("pauses automatic capture without cancelling obligations and rejects foreign policy edits", async () => {
    const fixture = await seed(); await approveRecurring(fixture.id); const other = await seed();
    const policy = (await review(fixture.id, now)).recurrence.states[0]!.policy;
    const command = { action: "pause_recurrence", policyId: policy.id, expectedVersion: 1, reason: "Pause capture pending schedule review", requestKey: randomUUID() };
    await expect(execute(other.id, command, null, now)).rejects.toMatchObject({ status: 404 });
    await execute(fixture.id, command, null, now);
    const october = new Date("2026-10-02T12:00:00Z"); await job(fixture.id, october);
    const current = await review(fixture.id, october); expect(current.settlement.occurrences).toHaveLength(1); expect(current.settlement.occurrences[0]?.status).toBe("active"); expect(current.recurrence.states[0]?.state).toBe("paused");
    await expect(approveRecurring(fixture.id, october, 1)).rejects.toMatchObject({ status: 409 });
    await approveRecurring(fixture.id, october, 2);
    expect((await review(fixture.id, october)).settlement.occurrences).toHaveLength(2);
  });

  it("automatically settles only an explicitly approved exact fact rule, with partial receipts and idempotent retries", async () => {
    const fixture = await seed(); const fact = await sourceFact(fixture.id); await capture(fixture.id, true);
    await fixture.post("1000000", "2026-09-10"); // Same memo and accounts cannot establish identity.
    await job(fixture.id); expect((await review(fixture.id, now)).settlement.allocations).toHaveLength(0);
    const first = await fixture.post("6000000", "2026-09-15", "4000", undefined, fact);
    await job(fixture.id);
    expect((await review(fixture.id, now)).results[0]).toMatchObject({ allocatedMinor: "6000000", remainingMinor: "4000000" });
    await job(fixture.id); expect((await review(fixture.id, now)).settlement.allocations).toHaveLength(1);
    await fixture.post("4000000", "2026-09-20", "4000", undefined, fact); await job(fixture.id);
    expect((await review(fixture.id, now)).results[0]?.state).toBe("settled");
    expect(await db.select().from(auditLog).where(and(eq(auditLog.companyId, fixture.id), eq(auditLog.action, "forecast.auto_allocated")))).toHaveLength(2);
    await fixture.post("6000000", "2026-09-22", "4000", first.entryId); await job(fixture.id);
    expect((await review(fixture.id, now)).results[0]?.remainingMinor).toBe("6000000");
  });

  it("does not automatically restore a match the reviewer revoked", async () => {
    const fixture = await seed(); const fact = await sourceFact(fixture.id); const occurrence = await capture(fixture.id, true);
    await fixture.post("6000000", "2026-09-15", "4000", undefined, fact); await job(fixture.id);
    const current = await review(fixture.id, now);
    await execute(fixture.id, { action: "revoke_allocation", occurrenceId: occurrence.id, expectedVersion: current.settlement.occurrences[0]!.version, allocationId: current.settlement.allocations[0]!.id, reason: "Reviewer rejected this match", requestKey: randomUUID() }, null, now);
    await job(fixture.id);
    const after = await review(fixture.id, now);
    expect(after.results[0]?.allocatedMinor).toBe("0"); expect(after.settlement.allocations).toHaveLength(1); expect(after.settlement.allocations[0]?.revoked).toBe(true);
  });

  it("leaves unapproved automatic policies, excess cash, and revoked source facts for review", async () => {
    const fixture = await seed(); const fact = await sourceFact(fixture.id); await capture(fixture.id);
    await fixture.post("6000000", "2026-09-15", "4000", undefined, fact); await job(fixture.id);
    expect((await review(fixture.id, now)).settlement.allocations).toHaveLength(0);
    const excess = await seed(); const excessFact = await sourceFact(excess.id); await capture(excess.id, true);
    await excess.post("11000000", "2026-09-15", "4000", undefined, excessFact); await job(excess.id);
    expect((await review(excess.id, now)).settlement.allocations).toHaveLength(0);
    const revoked = await seed(); const revokedFact = await sourceFact(revoked.id); await capture(revoked.id, true);
    await revoked.post("6000000", "2026-09-15", "4000", undefined, revokedFact);
    await db.update(factRecords).set({ status: "rejected" }).where(eq(factRecords.id, revokedFact)); await job(revoked.id);
    expect((await review(revoked.id, now)).settlement.allocations).toHaveLength(0);
  });

  it("refuses automatic allocation when two approved expectations name the same source fact", async () => {
    const fixture = await seed(); const fact = await sourceFact(fixture.id); await capture(fixture.id, true);
    await db.insert(economicItems).values({ companyId: fixture.id, type: "agreement", direction: "receipt", label: "Second obligation", amount: "100000", cadence: "once", effectiveFrom: "2026-09", status: "confirmed", factId: fact });
    const candidate = (await review(fixture.id, now)).candidates.find((item) => item.definition.label === "Second obligation")!;
    await execute(fixture.id, { action: "capture", autoMatch: true, candidateKey: candidate.definition.key, candidateHash: candidate.hash, independentObligation: true, reason: "Synthetic ambiguous fixture", requestKey: randomUUID() }, null, now);
    await fixture.post("6000000", "2026-09-15", "4000", undefined, fact); await job(fixture.id);
    expect((await review(fixture.id, now)).settlement.allocations).toHaveLength(0);
  });

  it("executes the specification's $60k partial receipt and $40k timing revision without changing October's driver", async () => {
    const fixture = await seed(); const occurrence = await capture(fixture.id);
    const actual = await fixture.post("6000000", "2026-09-15");
    const command = allocate(occurrence.id, actual.entryId, "6000000");
    await execute(fixture.id, command, null, now);
    expect(await cash(fixture.id, "2026-09")).toBe("45000000");
    expect(await cash(fixture.id, "2026-10")).toBe("40000000");
    expect(await execute(fixture.id, command, null, now)).toMatchObject({ reused: true });
    await execute(fixture.id, { action: "revise_occurrence", occurrenceId: occurrence.id, expectedVersion: 2, expectedDate: "2026-11-15", amountMinor: "10000000", status: "active", final: false, reason: "Customer revised the remaining installment date", requestKey: randomUUID() }, null, now);
    expect(await cash(fixture.id, "2026-09")).toBe("41000000");
    expect(await cash(fixture.id, "2026-10")).toBe("36000000");
    expect((await review(fixture.id, now)).results[0]).toMatchObject({ allocatedMinor: "6000000", remainingMinor: "4000000" });
    expect(await db.select().from(forecastSettlementAllocations).where(eq(forecastSettlementAllocations.companyId, fixture.id))).toHaveLength(1);
  });

  it("reopens final settlement after a reversal and preserves the allocation history", async () => {
    const fixture = await seed(); const occurrence = await capture(fixture.id); const actual = await fixture.post("6000000", "2026-09-15");
    await execute(fixture.id, allocate(occurrence.id, actual.entryId, "6000000", 1, true), null, now);
    expect((await review(fixture.id, now)).results[0]).toMatchObject({ remainingMinor: "0", varianceMinor: "-4000000" });
    await fixture.post("6000000", "2026-09-20", "4000", actual.entryId);
    const reopened = await review(fixture.id, now);
    expect(reopened.results[0]).toMatchObject({ allocatedMinor: "0", remainingMinor: "10000000", state: "unmatched" });
    expect(reopened.settlement.allocations).toHaveLength(1);
    expect(await cash(fixture.id, "2026-09")).toBe("45000000");
  });

  it("rejects over-allocation, stale versions, changed candidate approval, and cross-company actuals", async () => {
    const a = await seed(); const b = await seed(); const occurrence = await capture(a.id);
    const actual = await a.post("6000000", "2026-09-15"); const foreign = await b.post("6000000", "2026-09-15");
    await expect(execute(a.id, allocate(occurrence.id, foreign.entryId, "1"), null, now)).rejects.toMatchObject({ status: 404 });
    await expect(execute(b.id, allocate(occurrence.id, actual.entryId, "1"), null, now)).rejects.toMatchObject({ status: 404 });
    await expect(execute(a.id, allocate(occurrence.id, actual.entryId, "6000001"), null, now)).rejects.toMatchObject({ status: 400 });
    await execute(a.id, allocate(occurrence.id, actual.entryId, "6000000"), null, now);
    await expect(execute(a.id, allocate(occurrence.id, actual.entryId, "1"), null, now)).rejects.toMatchObject({ status: 409 });
    await expect(execute(a.id, allocate(occurrence.id, actual.entryId, "1", 2), null, now)).rejects.toMatchObject({ status: 400 });
    const candidate = (await review(b.id, now)).candidates[0]!;
    await expect(execute(b.id, { action: "capture", candidateKey: candidate.definition.key, candidateHash: "0".repeat(64), independentObligation: true, reason: "Stale", requestKey: randomUUID() }, null, now)).rejects.toMatchObject({ status: 409 });
  });

  it("excludes future actuals from both the cash balance and settlement candidates", async () => {
    const fixture = await seed(); const future = await fixture.post("6000000", "2026-09-30");
    expect(await cash(fixture.id, "2026-09")).toBe("45000000");
    expect((await review(fixture.id, now)).settlement.actuals.some((item) => item.id === future.entryId)).toBe(false);
  });

  it("keeps unresolved occurrences visible after calendar rollover and after cancellation", async () => {
    const fixture = await seed(); const occurrence = await capture(fixture.id);
    const later = await review(fixture.id, new Date("2026-10-02T12:00:00Z"));
    expect(later.results[0]).toMatchObject({ remainingMinor: "10000000", overdue: true });
    expect(later.exceptions.some((item) => item.reason.includes("Reschedule"))).toBe(true);
    await execute(fixture.id, { action: "revise_occurrence", occurrenceId: occurrence.id, expectedVersion: 1, expectedDate: "2026-10-15", amountMinor: "10000000", status: "cancelled", final: false, reason: "Customer cancelled the cash obligation", requestKey: randomUUID() }, null, now);
    expect((await review(fixture.id, now)).results[0]?.state).toBe("cancelled");
    expect(await db.select().from(forecastOccurrences).where(eq(forecastOccurrences.companyId, fixture.id))).toHaveLength(1);
  });

  it("distinguishes missing and partial coverage from a complete zero-activity interval, then detects new activity", async () => {
    const fixture = await seed(); let current = await review(fixture.id, now);
    const accountId = fixture.account("1000");
    expect(current.coverage.accounts[0]?.state).toBe("missing");
    const body = { action: "coverage", accountId, startDate: "2026-08-01", throughDate: "2026-09-25", status: "partial", reason: "Still waiting for the last export", previewHash: current.coveragePreviewHash, requestKey: randomUUID() };
    await execute(fixture.id, body, null, now); current = await review(fixture.id, now);
    expect(current.coverage.accounts[0]?.state).toBe("partial");
    await execute(fixture.id, { ...body, status: "complete", reason: "Reviewed opening balance and confirmed no September activity", previewHash: current.coveragePreviewHash, requestKey: randomUUID() }, null, now);
    expect((await review(fixture.id, now)).coverage.accounts[0]?.state).toBe("complete");
    await fixture.post("10000", "2026-09-20"); current = await review(fixture.id, now);
    expect(current.coverage.accounts[0]?.state).toBe("stale");
    await execute(fixture.id, { ...body, status: "revoked", previewHash: current.coveragePreviewHash, requestKey: randomUUID(), reason: "The prior assertion no longer holds" }, null, now);
    expect((await review(fixture.id, now)).coverage.accounts[0]?.state).toBe("missing");
  });

  it("commits an audit and a forecast revision once per approved command", async () => {
    const fixture = await seed(); const captured = await capture(fixture.id);
    expect(await execute(fixture.id, captured.command, null, now)).toMatchObject({ reused: true });
    expect(await db.select().from(auditLog).where(and(eq(auditLog.companyId, fixture.id), eq(auditLog.action, "forecast.capture")))).toHaveLength(1);
    await expect(execute(fixture.id, { ...captured.command, reason: "Different intent" }, null, now)).rejects.toMatchObject({ status: 409 });
  });

  it("invalidates coverage when new staged source rows arrive before posting", async () => {
    const fixture = await seed(); const current = await review(fixture.id, now);
    await execute(fixture.id, { action: "coverage", accountId: fixture.account("1000"), startDate: "2026-08-01", throughDate: "2026-09-25", status: "complete", reason: "Reviewed account activity", previewHash: current.coveragePreviewHash, requestKey: randomUUID() }, null, now);
    const complete = await review(fixture.id, now); expect(complete.coverage.accounts[0]?.state).toBe("complete");
    const [source] = await db.insert(sources).values({ companyId: fixture.id, type: "upload", filename: "synthetic-pending.csv" }).returning();
    await db.insert(sourceRows).values({ companyId: fixture.id, sourceId: source!.id, sourceKey: "synthetic-pending", sourceType: "csv", period: "2026-09", accountName: "Cash", rawJson: '{"description":"Synthetic unreviewed receipt","amount":"100.00"}' });
    expect((await review(fixture.id, now)).coverage.accounts[0]?.state).toBe("stale");
    await expect(execute(fixture.id, { action: "coverage", accountId: fixture.account("1000"), startDate: "2026-08-01", throughDate: "2026-09-25", status: "complete", reason: "Stale assertion", previewHash: complete.coveragePreviewHash, requestKey: randomUUID() }, null, now)).rejects.toMatchObject({ status: 409 });
  });

  it("revokes a match without deleting it and permits reassignment of the released amount", async () => {
    const fixture = await seed(); const occurrence = await capture(fixture.id); const actual = await fixture.post("6000000", "2026-09-15");
    await execute(fixture.id, allocate(occurrence.id, actual.entryId, "6000000"), null, now);
    const first = await review(fixture.id, now); const allocation = first.settlement.allocations[0]!;
    await execute(fixture.id, { action: "revoke_allocation", occurrenceId: occurrence.id, expectedVersion: 2, allocationId: allocation.id, reason: "Correct a reviewed match", requestKey: randomUUID() }, null, now);
    const reopened = await review(fixture.id, now);
    expect(reopened.results[0]?.remainingMinor).toBe("10000000"); expect(reopened.settlement.allocations[0]?.revoked).toBe(true);
    await execute(fixture.id, allocate(occurrence.id, actual.entryId, "6000000", 3), null, now);
    expect((await review(fixture.id, now)).results[0]?.remainingMinor).toBe("4000000");
  });
  it("approves a bounded historical estimate once and stops capture after its source history is reversed", async () => {
    const fixture = await seed();
    const june = await fixture.post("100000", "2026-06-15");
    await fixture.post("100000", "2026-07-15"); await fixture.post("100000", "2026-08-15");
    const initial = await review(fixture.id, now); const pattern = initial.candidates.find((item) => item.definition.origin === "history")!;
    expect(pattern).toBeDefined();
    const command = { action: "approve_history", candidateKey: pattern.definition.key, candidateHash: pattern.hash, endMonth: "2026-12", independentObligation: true, reason: "Separate synthetic recurring service; checked against other drivers", requestKey: randomUUID() };
    await execute(fixture.id, command, null, now);
    expect(await execute(fixture.id, command, null, now)).toMatchObject({ reused: true });
    const approved = await review(fixture.id, now); const historical = approved.settlement.occurrences.find((item) => item.origin === "history")!;
    expect(historical).toMatchObject({ expectedDate: "2026-09-15", amountMinor: "100000" });
    expect(approved.candidates.filter((item) => item.definition.origin === "history")).toHaveLength(0);
    expect(approved.recurrence.states).toHaveLength(1);
    expect(approved.recurrence.states[0]?.policy.definition.history?.sourceLineIds).toHaveLength(6);
    const october = new Date("2026-10-02T12:00:00Z"); await job(fixture.id, october); await job(fixture.id, october);
    expect((await review(fixture.id, october)).settlement.occurrences.filter((item) => item.origin === "history")).toHaveLength(2);
    await fixture.post("100000", "2026-10-03", "4000", june.entryId);
    const november = new Date("2026-11-02T12:00:00Z"); await job(fixture.id, november);
    const stale = await review(fixture.id, november);
    expect(stale.recurrence.states[0]?.state).toBe("stale");
    expect(stale.settlement.occurrences.filter((item) => item.origin === "history")).toHaveLength(2);
  });

  it("starts a recurring history schedule after the already-preserved month without replacing its occurrence", async () => {
    const fixture = await seed(); for (const month of ["06", "07", "08"]) await fixture.post("100000", `2026-${month}-15`);
    const initial = await review(fixture.id, now); const pattern = initial.candidates.find((item) => item.definition.origin === "history")!;
    await execute(fixture.id, { action: "capture", candidateKey: pattern.definition.key, candidateHash: pattern.hash, independentObligation: true, reason: "Preserve current obligation", requestKey: randomUUID() }, null, now);
    const preserved = await review(fixture.id, now); const candidate = preserved.candidates.find((item) => item.capturedOccurrenceId)!;
    expect(candidate).toBeDefined();
    await execute(fixture.id, { action: "approve_history", candidateKey: candidate.definition.key, candidateHash: candidate.hash, endMonth: "2026-12", independentObligation: true, reason: "Approve future estimates", requestKey: randomUUID() }, null, now);
    const approved = await review(fixture.id, now); expect(approved.settlement.occurrences).toEqual(preserved.settlement.occurrences);
    expect(approved.recurrence.states.find((item) => item.policy.definition.history)?.policy.startMonth).toBe("2026-10");
  });

  it("reopens a matched expectation when corrected through the journal-reversal request path", async () => {
    const { journalEntries, journalLines } = await import("@finance/database");
    const { journalReversalRequest } = await import("./journal-reversal-request");
    const fixture = await seed(); const preserved = await capture(fixture.id); const actual = await fixture.post("10000000", "2026-09-15");
    await execute(fixture.id, allocate(preserved.id, actual.entryId, "10000000"), null, now);
    expect((await review(fixture.id, now)).results.find((item) => item.id === preserved.id)?.state).toBe("settled");
    const [entry] = await db.select().from(journalEntries).where(eq(journalEntries.id, actual.entryId));
    const lines = await db.select().from(journalLines).where(eq(journalLines.entryId, actual.entryId));
    const request = journalReversalRequest(entry!, lines, { postingDate: "2026-09-20", period: "2026-09", memo: "Synthetic reversed receipt" });
    expect(request).toMatchObject({ basis: "actual", reversalOfEntryId: actual.entryId });
    await postApprovedJournal(fixture.id, { ...request, deferRefresh: true });
    expect((await review(fixture.id, now)).results.find((item) => item.id === preserved.id)).toMatchObject({ remainingMinor: "10000000", state: "unmatched" });
  });

  it("replaces a stale schedule prospectively and keeps captured obligations and the old approval", async () => {
    const fixture = await seed(); const initial = await review(fixture.id, now); const option = initial.recurrence.options[0]!;
    await execute(fixture.id, { action: "approve_recurrence", driverId: option.driverId, definitionHash: option.hash, expectedVersion: 0, endMonth: "2026-12", independentObligation: true, reason: "Reviewed original schedule", requestKey: randomUUID() }, null, now);
    const original = await review(fixture.id, now);
    await db.update(economicItems).set({ amount: "120000" }).where(eq(economicItems.id, option.driverId));
    const stale = await review(fixture.id, now); const candidate = stale.recovery.find((item) => item.driverId === option.driverId)!; expect(candidate).toBeDefined(); expect(candidate.startMonth).toBe("2026-10");
    const command = { driverId: option.driverId, replacementHash: candidate.hash, amountMinor: "11000000", expectedDay: 15, endMonth: "2026-12", acknowledgePreservedOccurrences: true, reason: "Reviewed new monthly assumption", requestKey: randomUUID() };
    await execute(fixture.id, { ...command, action: "preview_recurrence_replacement" }, null, now);
    expect((await review(fixture.id, now)).recurrence.states).toHaveLength(original.recurrence.states.length);
    await execute(fixture.id, { ...command, action: "replace_recurrence" }, null, now);
    const after = await review(fixture.id, now); expect(after.settlement.occurrences).toEqual(original.settlement.occurrences); expect(after.recurrence.states.find((item) => item.policy.driverId === option.driverId)?.state).toBe("paused");
    expect(after.recurrence.states.some((item) => item.policy.driverId !== option.driverId && item.policy.definition.driver.expectedDay === 15)).toBe(true);
  });

});
