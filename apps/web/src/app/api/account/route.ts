import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDatabase, users } from "@finance/database";
import { auth, authMode, requireCompanyAccess } from "@/lib/auth";
import { deleteSourceBlob, readSourceBlob, storeSourceBlob } from "@/lib/blob-store";

const profileSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
});

const avatarMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxAvatarBytes = 2 * 1024 * 1024;

function isValidImage(bytes: Buffer, mime: string) {
  if (mime === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === "image/png") return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
}

export async function PATCH(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const contentType = request.headers.get("content-type") ?? "";
  const multipart = contentType.includes("multipart/form-data");
  const form = multipart ? await request.formData() : null;
  const payload = multipart
    ? { name: String(form?.get("name") ?? ""), email: String(form?.get("email") ?? "") }
    : await request.json();
  const parsed = profileSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ error: "Enter a name and a valid email address." }, { status: 400 });

  const db = getDatabase();
  const [current] = await db.select({
    avatarStorageReference: users.avatarStorageReference,
  }).from(users).where(eq(users.id, context.user.id)).limit(1);
  if (!current) return NextResponse.json({ error: "User not found." }, { status: 404 });

  let avatar: { storageReference: string; mime: string; hash: string } | undefined;
  const upload = form?.get("avatar");
  if (upload instanceof File && upload.size > 0) {
    if (upload.size > maxAvatarBytes || !avatarMimeTypes.has(upload.type)) {
      return NextResponse.json({ error: "Profile photos must be a PNG, JPEG, or WebP image no larger than 2 MB." }, { status: 400 });
    }
    const bytes = Buffer.from(await upload.arrayBuffer());
    if (!isValidImage(bytes, upload.type)) return NextResponse.json({ error: "The profile photo is not a valid image." }, { status: 400 });
    const hash = createHash("sha256").update(bytes).digest("hex");
    avatar = { storageReference: await storeSourceBlob(context.company.id, `avatar-${hash}`, bytes), mime: upload.type, hash };
  }

  const [user] = await db.update(users).set({
    name: parsed.data.name,
    // External credentials remain owned by Better Auth. A local installation
    // has no separate provider identity, so its persisted owner email is editable.
    ...(authMode === "disabled" ? { email: parsed.data.email } : {}),
    ...(avatar ? { avatarStorageReference: avatar.storageReference, avatarMime: avatar.mime, avatarHash: avatar.hash } : {}),
    updatedAt: new Date(),
  }).where(eq(users.id, context.user.id)).returning({ name: users.name, email: users.email });

  if (avatar && current.avatarStorageReference && current.avatarStorageReference !== avatar.storageReference) {
    await deleteSourceBlob(current.avatarStorageReference).catch(() => undefined);
  }
  return NextResponse.json({ user });
}

/** The current user's photo is private to their authenticated session. */
export async function GET() {
  await auth.protect();
  const context = await requireCompanyAccess();
  const [user] = await getDatabase().select({
    storageReference: users.avatarStorageReference,
    mime: users.avatarMime,
    hash: users.avatarHash,
  }).from(users).where(eq(users.id, context.user.id)).limit(1);
  if (!user?.storageReference || !user.mime || !user.hash) return new NextResponse(null, { status: 404 });
  try {
    const bytes = await readSourceBlob(user.storageReference);
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (hash !== user.hash || !avatarMimeTypes.has(user.mime) || !isValidImage(bytes, user.mime)) return new NextResponse(null, { status: 404 });
    return new NextResponse(bytes, { headers: { "Content-Type": user.mime, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
