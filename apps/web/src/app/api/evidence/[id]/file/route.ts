import { auth } from "@/lib/auth";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { evidence, getDatabase, sources } from "@finance/database";
import { requireCompanyAccess } from "@/lib/auth";
import { readSourceBlob } from "@/lib/blob-store";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const { id } = await params;
  const [source] = await getDatabase().select({ storageReference: sources.storageReference, filename: sources.filename, mimeType: sources.mimeType, sourceHash: sources.hash }).from(evidence).innerJoin(sources, eq(evidence.sourceId, sources.id)).where(and(eq(evidence.id, id), eq(evidence.companyId, context.company.id)));
  if (!source?.storageReference) return NextResponse.json({ error: "Original file is not available for this source" }, { status: 404 });
  try {
    const bytes = await readSourceBlob(source.storageReference);
    const actualHash = createHash("sha256").update(bytes).digest("hex");
    if (source.sourceHash && actualHash !== source.sourceHash) return NextResponse.json({ error: "Stored source failed integrity verification" }, { status: 409 });
    return new NextResponse(bytes, { headers: { "Content-Type": source.mimeType || "application/octet-stream", "Content-Length": String(bytes.byteLength), "Content-Disposition": `attachment; filename="${(source.filename || "source").replace(/["\\\r\n]/g, "_")}"` } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to read original file" }, { status: 404 });
  }
}
