import { NextResponse } from "next/server";
import { getDatabase, recordAudit } from "@finance/database";
import { auth, requireCompanyAccess } from "@/lib/auth";
import { buildStandardModelExport } from "@/lib/standard-export";

/**
 * Download the company's outlook as a Standard Financial Model-shaped
 * workbook. Read-only; the download itself is recorded in the activity log.
 */
export async function GET() {
  await auth.protect();
  const context = await requireCompanyAccess();
  const { bytes, filename, summary } = await buildStandardModelExport(context.company.id);
  await recordAudit(getDatabase(), { companyId: context.company.id, actorUserId: context.user.id, via: "ui", action: "export.standard_model", entityType: "company", entityId: context.company.id, summary: `Exported the Standard model workbook (${summary.months} months, ${summary.scenarios} scenario${summary.scenarios === 1 ? "" : "s"}${summary.plan ? ", with plan" : ""})`, after: summary });
  return new NextResponse(new Blob([bytes as BlobPart]), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`, "Cache-Control": "no-store" } });
}
