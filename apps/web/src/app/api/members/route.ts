import { NextResponse } from "next/server";
import {
  AuthenticationRequiredError,
  CompanyAccessDeniedError,
  CompanyRoleRequiredError,
  InvalidMemberInputError,
  LastOwnerError,
  isCompanyRole,
  normalizeMemberEmail,
  type CompanyRole,
} from "@finance/auth";
import { recordAudit } from "@finance/database";
import { auth, memberRepository, requireCompanyAccess, requireOwner } from "@/lib/auth";

/**
 * Membership changes are their own transactions inside the repository, and each
 * one takes the audit write as a callback it runs before committing. The change
 * and the entry that explains it therefore land together or not at all: history
 * never shows a membership nobody changed, or a change nobody made.
 */
function errorResponse(error: unknown) {
  if (error instanceof CompanyRoleRequiredError) return NextResponse.json({ error: "Only a company owner can manage members" }, { status: 403 });
  if (error instanceof CompanyAccessDeniedError) return NextResponse.json({ error: "You do not have access to that company" }, { status: 403 });
  if (error instanceof LastOwnerError) return NextResponse.json({ error: error.message }, { status: 409 });
  if (error instanceof InvalidMemberInputError) return NextResponse.json({ error: error.message }, { status: 400 });
  if (error instanceof AuthenticationRequiredError) return NextResponse.json({ error: "Authentication is required" }, { status: 401 });
  throw error;
}

function readBody(request: Request) {
  return request.json().catch(() => ({})) as Promise<{ email?: unknown; role?: unknown; userId?: unknown; pendingId?: unknown }>;
}

/** The role is a closed set, so an unknown value is the caller's mistake, not a default. */
function requireRole(value: unknown, { optional = false } = {}): CompanyRole {
  if (optional && value === undefined) return "member";
  if (!isCompanyRole(value)) throw new InvalidMemberInputError("A member role must be either owner or member");
  return value;
}

function requireId(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new InvalidMemberInputError(`A ${field} is required`);
  return value;
}

/** Any member may see who else is in the company; only owners may change it. */
export async function GET() {
  await auth.protect();
  try {
    const context = await requireCompanyAccess();
    const { members, pending } = await memberRepository.listMembers(context.company.id);
    // The current user is returned so the client can mark "you" and refuse to
    // offer actions that would lock the signed-in owner out of the company.
    return NextResponse.json({ members, pending, currentUserId: context.user.id });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  await auth.protect();
  try {
    const context = await requireOwner();
    const body = await readBody(request);
    const email = normalizeMemberEmail(body.email);
    const role = requireRole(body.role, { optional: true });
    const result = await memberRepository.addMember(context.company.id, { email, role }, context.user.id, (transaction, added) =>
      recordAudit(transaction, {
        companyId: context.company.id,
        actorUserId: context.user.id,
        via: "ui",
        action: "member.added",
        entityType: "member",
        // A pending address has no user yet; its row id would not survive the
        // upgrade to a membership, so the entry stays unattached until it does.
        entityId: added.status === "active" ? added.member.userId : undefined,
        summary: `Added ${email} as ${role}`,
        after: { email, role, status: added.status },
      }),
    );
    return NextResponse.json({ result }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  await auth.protect();
  try {
    const context = await requireOwner();
    const body = await readBody(request);
    const userId = requireId(body.userId, "user id");
    const role = requireRole(body.role);
    // Read the previous role first: after the update it is gone, and the log
    // is only useful if it says what the role changed from.
    const { members } = await memberRepository.listMembers(context.company.id);
    const previous = members.find((candidate) => candidate.userId === userId);
    if (!previous) return NextResponse.json({ error: "That user is not a member of this company" }, { status: 404 });
    const member = await memberRepository.updateMemberRole(context.company.id, userId, role, (transaction, changed) =>
      recordAudit(transaction, {
        companyId: context.company.id,
        actorUserId: context.user.id,
        via: "ui",
        action: "member.role_changed",
        entityType: "member",
        entityId: changed.userId,
        summary: `Changed ${changed.email} from ${previous.role} to ${changed.role}`,
        before: { role: previous.role },
        after: { role: changed.role },
      }),
    );
    return NextResponse.json({ member });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request) {
  await auth.protect();
  try {
    const context = await requireOwner();
    const body = await readBody(request);
    if (body.pendingId !== undefined) {
      const pendingId = requireId(body.pendingId, "pending member id");
      const { pending } = await memberRepository.listMembers(context.company.id);
      const removed = pending.find((candidate) => candidate.id === pendingId);
      if (!removed) return NextResponse.json({ error: "That invitation is not on this company" }, { status: 404 });
      await memberRepository.removePendingMember(context.company.id, pendingId, (transaction) =>
        recordAudit(transaction, {
          companyId: context.company.id,
          actorUserId: context.user.id,
          via: "ui",
          action: "member.removed",
          entityType: "member",
          summary: `Removed the pending member ${removed.email}`,
          before: { email: removed.email, role: removed.role, status: "pending" },
        }),
      );
      return new NextResponse(null, { status: 204 });
    }
    const userId = requireId(body.userId, "user id");
    const { members } = await memberRepository.listMembers(context.company.id);
    const removed = members.find((candidate) => candidate.userId === userId);
    if (!removed) return NextResponse.json({ error: "That user is not a member of this company" }, { status: 404 });
    await memberRepository.removeMember(context.company.id, userId, (transaction) =>
      recordAudit(transaction, {
        companyId: context.company.id,
        actorUserId: context.user.id,
        via: "ui",
        action: "member.removed",
        entityType: "member",
        entityId: removed.userId,
        summary: `Removed ${removed.email}`,
        before: { email: removed.email, role: removed.role, status: "active" },
      }),
    );
    return new NextResponse(null, { status: 204 });
  } catch (error) { return errorResponse(error); }
}
