import {
  LastOwnerError,
  normalizeMemberEmail,
  type AddMemberResult,
  type CompanyMember,
  type CompanyRole,
  type MemberRepository,
  type PendingMember,
} from "@finance/auth";
import { and, asc, eq, sql } from "drizzle-orm";
import type { Queryable } from "./company-scope";
import { getDatabase, type Database } from "./index";
import { companyMembers, pendingMembers, users } from "./schema";

type MemberRow = { userId: string; email: string; name: string | null; role: CompanyRole; createdAt: Date };
type PendingRow = { id: string; email: string; role: CompanyRole; createdAt: Date };

function toMember(row: MemberRow): CompanyMember {
  return { userId: row.userId, email: row.email, name: row.name, role: row.role, createdAt: row.createdAt.toISOString() };
}

function toPending(row: PendingRow): PendingMember {
  return { id: row.id, email: row.email, role: row.role, createdAt: row.createdAt.toISOString() };
}

function memberQuery(executor: Queryable, companyId: string, userId?: string) {
  const conditions = [eq(companyMembers.companyId, companyId)];
  if (userId) conditions.push(eq(companyMembers.userId, userId));
  return executor
    .select({
      userId: companyMembers.userId,
      email: users.email,
      name: users.name,
      role: companyMembers.role,
      createdAt: companyMembers.createdAt,
    })
    .from(companyMembers)
    .innerJoin(users, eq(users.id, companyMembers.userId))
    .where(and(...conditions));
}

export function createDatabaseMemberRepository(database?: Database): MemberRepository {
  const resolveDatabase = () => database ?? getDatabase();

  async function listMembers(companyId: string) {
    const database = resolveDatabase();
    const [members, pending] = await Promise.all([
      // The membership order is the same one that picks a user's default
      // company, with the address as a stable tie-breaker inside a timestamp.
      memberQuery(database, companyId).orderBy(asc(companyMembers.createdAt), asc(users.email)),
      database
        .select({ id: pendingMembers.id, email: pendingMembers.email, role: pendingMembers.role, createdAt: pendingMembers.createdAt })
        .from(pendingMembers)
        .where(eq(pendingMembers.companyId, companyId))
        .orderBy(asc(pendingMembers.createdAt), asc(pendingMembers.email)),
    ]);
    return { members: members.map(toMember), pending: pending.map(toPending) };
  }

  /**
   * Lock the company's owner memberships for the rest of the transaction.
   * Two concurrent demotions would otherwise each read two owners and each
   * commit, leaving the company without one; the second now waits and re-reads
   * the reduced set.
   */
  async function lockOwners(transaction: Queryable, companyId: string) {
    return transaction
      .select({ userId: companyMembers.userId })
      .from(companyMembers)
      .where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.role, "owner")))
      .for("update");
  }

  async function addMember(
    companyId: string,
    input: { email: string; role: CompanyRole },
    actorUserId: string | null,
  ): Promise<AddMemberResult> {
    // Normalizing again is idempotent and keeps the stored form correct even
    // when a caller passes a raw address.
    const email = normalizeMemberEmail(input.email);

    return resolveDatabase().transaction(async (transaction) => {
      const [existing] = await transaction
        .select({ id: users.id, email: users.email, name: users.name })
        .from(users)
        .where(sql`lower(${users.email}) = ${email}`)
        .orderBy(asc(users.createdAt))
        .limit(1);

      if (existing) {
        // Adding someone who is already a member is a no-op that reports the
        // membership they have, rather than silently changing their role.
        const [inserted] = await transaction
          .insert(companyMembers)
          .values({ companyId, userId: existing.id, role: input.role })
          .onConflictDoNothing()
          .returning();
        const membership =
          inserted ??
          (
            await transaction
              .select()
              .from(companyMembers)
              .where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.userId, existing.id)))
              .limit(1)
          )[0];
        if (!membership) throw new Error("Unable to add the member");

        // Any pending row for the same address is now redundant.
        await transaction
          .delete(pendingMembers)
          .where(and(eq(pendingMembers.companyId, companyId), eq(pendingMembers.email, email)));

        return {
          status: "active",
          member: toMember({ userId: existing.id, email: existing.email, name: existing.name, role: membership.role, createdAt: membership.createdAt }),
        };
      }

      // Re-adding a waiting address updates the role it will be attached with.
      const [pending] = await transaction
        .insert(pendingMembers)
        .values({ companyId, email, role: input.role, addedByUserId: actorUserId })
        .onConflictDoUpdate({
          target: [pendingMembers.companyId, pendingMembers.email],
          set: { role: input.role, addedByUserId: actorUserId },
        })
        .returning();
      if (!pending) throw new Error("Unable to record the pending member");

      return { status: "pending", pending: toPending(pending) };
    });
  }

  async function updateMemberRole(companyId: string, userId: string, role: CompanyRole): Promise<CompanyMember> {
    return resolveDatabase().transaction(async (transaction) => {
      const owners = await lockOwners(transaction, companyId);
      if (role !== "owner" && owners.length <= 1 && owners.some((owner) => owner.userId === userId)) {
        throw new LastOwnerError();
      }

      const [updated] = await transaction
        .update(companyMembers)
        .set({ role })
        .where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.userId, userId)))
        .returning();
      if (!updated) throw new Error("Unable to change the role: the user is not a member of this company");

      const [member] = await memberQuery(transaction, companyId, userId);
      if (!member) throw new Error("Unable to read the updated member");
      return toMember(member);
    });
  }

  async function removeMember(companyId: string, userId: string): Promise<void> {
    await resolveDatabase().transaction(async (transaction) => {
      const owners = await lockOwners(transaction, companyId);
      if (owners.length <= 1 && owners.some((owner) => owner.userId === userId)) throw new LastOwnerError();

      await transaction
        .delete(companyMembers)
        .where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.userId, userId)));
    });
  }

  async function removePendingMember(companyId: string, pendingId: string): Promise<void> {
    // Scoped by company: a pending id from another company must not be removable.
    await resolveDatabase()
      .delete(pendingMembers)
      .where(and(eq(pendingMembers.companyId, companyId), eq(pendingMembers.id, pendingId)));
  }

  return { listMembers, addMember, updateMemberRole, removeMember, removePendingMember };
}
