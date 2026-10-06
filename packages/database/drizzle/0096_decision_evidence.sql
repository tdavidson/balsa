-- The evidence a decision came from, such as a returned workbook whose edits Balsa proposed.
ALTER TABLE decisions ADD COLUMN evidence_id uuid REFERENCES evidence(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX decisions_evidence_index ON decisions(evidence_id) WHERE evidence_id IS NOT NULL;
