-- The confidence an owner requires before Balsa proceeds without asking.
-- Null keeps every extracted fact in review.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS review_confidence_threshold text;
ALTER TABLE companies DROP CONSTRAINT IF EXISTS companies_review_confidence_threshold_range;
ALTER TABLE companies ADD CONSTRAINT companies_review_confidence_threshold_range CHECK (review_confidence_threshold IS NULL OR (review_confidence_threshold ~ '^(0(\.[0-9]+)?|1(\.0+)?)$' AND review_confidence_threshold::numeric >= 0.5));
