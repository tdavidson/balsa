import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { companies, getDatabase, recordAudit, sources } from "@finance/database";
import { auth, requireCompanyAccess } from "@/lib/auth";
import { deleteSourceBlob, storeSourceBlob } from "@/lib/blob-store";
import { clearActiveCompanyCookie } from "@/lib/auth/company-selection";

const faviconMimeTypes = new Set(["image/x-icon", "image/vnd.microsoft.icon", "image/png"]);
const maxFaviconBytes = 512 * 1024;

function isValidFavicon(bytes: Buffer, mime: string) {
  if (mime === "image/png") return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mime === "image/x-icon" || mime === "image/vnd.microsoft.icon") return bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0, 0, 1, 0]));
  return false;
}

export async function PATCH(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  if (context.company.role !== "owner") return NextResponse.json({ error: "Only the company owner can change company settings" }, { status: 403 });
  const contentType = request.headers.get("content-type") ?? "";
  const form = contentType.includes("multipart/form-data") ? await request.formData() : null;
  const body = form
    ? { name: String(form.get("name") ?? ""), baseCurrency: String(form.get("baseCurrency") ?? "") }
    : (await request.json()) as { name?: unknown; baseCurrency?: unknown };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const baseCurrency = typeof body.baseCurrency === "string" ? body.baseCurrency.trim().toUpperCase() : "";
  if (!name || name.length > 160) return NextResponse.json({ error: "Company name is required and must be 160 characters or fewer" }, { status: 400 });
  if (!/^[A-Z]{3}$/.test(baseCurrency)) return NextResponse.json({ error: "Base currency must be a three-letter code" }, { status: 400 });
  const db = getDatabase();
  const [current] = await db.select({ name: companies.name, baseCurrency: companies.baseCurrency, faviconStorageReference: companies.faviconStorageReference }).from(companies).where(eq(companies.id, context.company.id)).limit(1);
  let favicon: { storageReference: string; mime: string; hash: string } | undefined;
  const upload = form?.get("favicon");
  if (upload instanceof File && upload.size > 0) {
    if (upload.size > maxFaviconBytes || !faviconMimeTypes.has(upload.type)) return NextResponse.json({ error: "Favicons must be ICO or PNG files no larger than 512 KB." }, { status: 400 });
    const bytes = Buffer.from(await upload.arrayBuffer());
    if (!isValidFavicon(bytes, upload.type)) return NextResponse.json({ error: "The favicon file is not valid." }, { status: 400 });
    const hash = createHash("sha256").update(bytes).digest("hex");
    favicon = { storageReference: await storeSourceBlob(context.company.id, `favicon-${hash}`, bytes), mime: upload.type, hash };
  }
  const [company] = await db.update(companies).set({
    name,
    baseCurrency,
    ...(favicon ? { faviconStorageReference: favicon.storageReference, faviconMime: favicon.mime, faviconHash: favicon.hash } : {}),
    updatedAt: new Date(),
  }).where(eq(companies.id, context.company.id)).returning({ id: companies.id, name: companies.name, baseCurrency: companies.baseCurrency });
  if (company) await recordAudit(db, { companyId: context.company.id, actorUserId: context.user.id, via: "ui", action: "company.settings_changed", entityType: "company", entityId: context.company.id, summary: `Changed company settings for ${company.name}`, before: { name: current?.name ?? null, baseCurrency: current?.baseCurrency ?? null }, after: { name: company.name, baseCurrency: company.baseCurrency, ...(favicon ? { faviconHash: favicon.hash } : {}) } });
  if (favicon && current?.faviconStorageReference && current.faviconStorageReference !== favicon.storageReference) {
    await deleteSourceBlob(current.faviconStorageReference).catch(() => undefined);
  }
  return company ? NextResponse.json({ company }) : NextResponse.json({ error: "Company not found" }, { status: 404 });
}

export async function DELETE(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  if (context.company.role !== "owner") return NextResponse.json({ error: "Only the company owner can delete this company" }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as { confirmation?: unknown };
  if (body.confirmation !== context.company.name) {
    return NextResponse.json({ error: `Type exactly “${context.company.name}” to delete this company.` }, { status: 400 });
  }

  const db = getDatabase();
  const [company, sourceRows] = await Promise.all([
    db.select({ faviconStorageReference: companies.faviconStorageReference }).from(companies).where(eq(companies.id, context.company.id)).limit(1),
    db.select({ storageReference: sources.storageReference }).from(sources).where(eq(sources.companyId, context.company.id)),
  ]);
  if (!company[0]) return NextResponse.json({ error: "Company not found" }, { status: 404 });

  // Database rows cascade from the company. Remove the separately stored file
  // objects first so a successful deletion cannot leave private source files
  // behind on disk. References are deduplicated defensively.
  const storageReferences = new Set(sourceRows.map((row) => row.storageReference).filter((value): value is string => Boolean(value)));
  if (company[0].faviconStorageReference) storageReferences.add(company[0].faviconStorageReference);
  for (const storageReference of storageReferences) await deleteSourceBlob(storageReference);

  const deleted = await db.delete(companies).where(eq(companies.id, context.company.id)).returning({ id: companies.id });
  if (deleted.length === 0) return NextResponse.json({ error: "Company not found" }, { status: 404 });

  // The next request will select another authorized company, or provision a
  // clean company when this was the user's final company.
  await clearActiveCompanyCookie();
  return NextResponse.json({ deleted: true });
}
