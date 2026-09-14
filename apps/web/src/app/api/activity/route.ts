import { NextResponse } from "next/server";
import { AuthenticationRequiredError, CompanyAccessDeniedError } from "@finance/auth";
import { defaultAuditLimit, getDatabase, listAuditEntries, type AuditRecord } from "@finance/database";
import { auth, requireCompanyAccess } from "@/lib/auth";

/** The upper bound is the page size the dialog can render without paging, not a security limit. */
const maxActivityLimit = 500;

export type ActivityEntry = {
  id: string;
  action: string;
  via: string;
  summary: string;
  entityType: string | null;
  entityId: string | null;
  actor: { id: string; name: string | null; email: string } | null;
  createdAt: string;
};

/**
 * The actor is nested rather than flattened so "no actor" is one absent object
 * instead of three nulls the client has to agree about: worker entries and
 * entries whose user has been deleted both read as `actor: null`.
 */
function toEntry(record: AuditRecord): ActivityEntry {
  return {
    id: record.id,
    action: record.action,
    via: record.via,
    summary: record.summary,
    entityType: record.entityType,
    entityId: record.entityId,
    actor: record.actorUserId && record.actorEmail ? { id: record.actorUserId, name: record.actorName, email: record.actorEmail } : null,
    createdAt: record.createdAt,
  };
}

function errorResponse(error: unknown) {
  if (error instanceof CompanyAccessDeniedError) return NextResponse.json({ error: "You do not have access to that company" }, { status: 403 });
  if (error instanceof AuthenticationRequiredError) return NextResponse.json({ error: "Authentication is required" }, { status: 401 });
  throw error;
}

/** Every member sees the company's history; the log is a record, not a privilege. */
export async function GET(request: Request) {
  await auth.protect();
  try {
    const context = await requireCompanyAccess();
    const requested = Number(new URL(request.url).searchParams.get("limit"));
    // An unparsable or out-of-range limit falls back to the default rather than
    // failing: the caller asked for history, not for a validation lesson.
    const limit = Number.isInteger(requested) && requested > 0 ? Math.min(requested, maxActivityLimit) : defaultAuditLimit;
    const entries = await listAuditEntries(getDatabase(), context.company.id, limit);
    return NextResponse.json({ entries: entries.map(toEntry) });
  } catch (error) { return errorResponse(error); }
}
