import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { companies, getDatabase } from "@finance/database";
import { auth, requireCompanyAccess } from "@/lib/auth";
import { readSourceBlob } from "@/lib/blob-store";

const faviconMimeTypes = new Set(["image/x-icon", "image/vnd.microsoft.icon", "image/png"]);

/** Serve the active company's favicon without exposing its storage reference. */
export async function GET() {
  await auth.protect();
  const context = await requireCompanyAccess();
  const [company] = await getDatabase().select({
    storageReference: companies.faviconStorageReference,
    mime: companies.faviconMime,
    hash: companies.faviconHash,
  }).from(companies).where(eq(companies.id, context.company.id)).limit(1);
  if (!company?.storageReference || !company.mime || !company.hash || !faviconMimeTypes.has(company.mime)) return new Response(null, { status: 404 });
  try {
    const bytes = await readSourceBlob(company.storageReference);
    if (createHash("sha256").update(bytes).digest("hex") !== company.hash) return new Response(null, { status: 404 });
    return new Response(bytes, { headers: { "Content-Type": company.mime, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return new Response(null, { status: 404 });
  }
}
