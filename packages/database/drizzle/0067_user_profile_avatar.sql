ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "avatar_storage_reference" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "avatar_mime" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "avatar_hash" text;
