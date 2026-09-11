ALTER TABLE "evidence" ADD COLUMN "identity_status" "evidence_status" DEFAULT 'pending' NOT NULL;
ALTER TABLE "evidence" ADD COLUMN "published_at" timestamp with time zone;

-- Preserve prior document review decisions, but only retain overall approval
-- when every extracted fact also has approved accounting treatment.
UPDATE "evidence" SET "identity_status" = "status";
UPDATE "evidence" AS e
SET "status" = 'pending', "published_at" = NULL
WHERE e."status" = 'approved'
  AND (
    NOT EXISTS (SELECT 1 FROM "fact_records" f WHERE f."evidence_id" = e."id")
    OR EXISTS (
      SELECT 1 FROM "fact_records" f
      WHERE f."evidence_id" = e."id" AND f."status" <> 'treatment_approved'
    )
  );
UPDATE "evidence" SET "published_at" = COALESCE("updated_at", "created_at") WHERE "status" = 'approved';
