ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "favicon_storage_reference" text;
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "favicon_mime" text;
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "favicon_hash" text;
