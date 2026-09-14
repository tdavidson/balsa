import { auth } from "@/lib/auth";
import { requireCompanyAccess } from "@/lib/auth";
import { approvalEvents, chartAccounts, evidence, getDatabase, sources } from "@finance/database";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

const body = z.object({ proposalId: z.string().regex(/^account-\d+$/) });
type AccountProposal = { accountType?: string; statementSection?: string; suggestedAccountName?: string };
type Metadata = { sourceRole?: string; classification?: { kind?: string }; workbookProposal?: { chartAccountMappings?: AccountProposal[] }; workbookProposalReview?: Record<string, "approved" | "rejected">; workbookProposalApplication?: Record<string, string>; [key: string]: unknown };

/** Creates an inactive chart-account draft from a specifically approved semantic suggestion. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid proposal application" }, { status: 400 });
  const { id } = await params; const db = getDatabase();
  const [document] = await db.select({ sourceId: evidence.sourceId, metadata: sources.metadata }).from(evidence).innerJoin(sources, eq(evidence.sourceId, sources.id)).where(and(eq(evidence.id, id), eq(evidence.companyId, context.company.id))).limit(1);
  if (!document?.sourceId) return NextResponse.json({ error: "Document source not found" }, { status: 404 });
  let metadata: Metadata; try { metadata = JSON.parse(document.metadata ?? "{}") as Metadata; } catch { metadata = {}; }
  if (metadata.sourceRole !== "reference_model" && metadata.classification?.kind !== "financial_model") return NextResponse.json({ error: "Proposal application is available only for financial models" }, { status: 409 });
  if (metadata.workbookProposalReview?.[parsed.data.proposalId] !== "approved") return NextResponse.json({ error: "Approve this account suggestion before creating a draft" }, { status: 409 });
  const index = Number(parsed.data.proposalId.slice("account-".length)) - 1;
  const proposal = metadata.workbookProposal?.chartAccountMappings?.[index];
  const accountType = proposal?.accountType as "asset" | "liability" | "equity" | "revenue" | "expense" | "contra" | undefined;
  if (!proposal || !accountType || !["asset", "liability", "equity", "revenue", "expense", "contra"].includes(accountType)) return NextResponse.json({ error: "This suggestion does not establish a valid account type" }, { status: 409 });
  const existingId = metadata.workbookProposalApplication?.[parsed.data.proposalId];
  if (existingId) return NextResponse.json({ accountId: existingId, alreadyApplied: true });
  const code = `DRAFT-${id.replace(/-/g, "").slice(0, 6).toUpperCase()}-${index + 1}`;
  const statementSection = (["asset", "liability", "equity", "revenue", "expense"] as const).find((section) => section === proposal.statementSection) ?? (accountType === "contra" ? undefined : accountType);
  const normalBalance: "debit" | "credit" = accountType === "asset" || accountType === "expense" ? "debit" : "credit";
  const [account] = await db.insert(chartAccounts).values({ companyId: context.company.id, code, name: (proposal.suggestedAccountName || "Draft account").trim().slice(0, 160), accountType, normalBalance, ...(statementSection ? { statementSection } : {}), active: "N" }).returning({ id: chartAccounts.id, code: chartAccounts.code, name: chartAccounts.name });
  const workbookProposalApplication = { ...(metadata.workbookProposalApplication ?? {}), [parsed.data.proposalId]: account!.id };
  await db.update(sources).set({ metadata: JSON.stringify({ ...metadata, workbookProposalApplication }), updatedAt: new Date() }).where(and(eq(sources.id, document.sourceId), eq(sources.companyId, context.company.id)));
  await db.insert(approvalEvents).values({ companyId: context.company.id, evidenceId: id, userId: context.user.id, layer: "workbook_proposal_application", action: "draft_account_created", nextValue: account!.id, metadata: JSON.stringify({ proposalId: parsed.data.proposalId, code }) });
  return NextResponse.json({ accountId: account!.id, account, alreadyApplied: false }, { status: 201 });
}
