-- Rename only the original disabled-auth bootstrap values. Deliberately leave
-- every user-specified name and company name unchanged.
UPDATE "users"
SET "name" = 'User', "updated_at" = now()
WHERE "auth_provider" = 'disabled'
  AND "auth_provider_user_id" = 'local-owner'
  AND "name" = 'Local owner';

UPDATE "companies"
SET "name" = 'User''s Company', "updated_at" = now()
WHERE "name" IN ('Local owner''s Company', 'My Management Company')
  AND "id" IN (
    SELECT "company_members"."company_id"
    FROM "company_members"
    INNER JOIN "users" ON "users"."id" = "company_members"."user_id"
    WHERE "users"."auth_provider" = 'disabled'
      AND "users"."auth_provider_user_id" = 'local-owner'
  );
