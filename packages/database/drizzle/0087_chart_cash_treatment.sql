-- Whether an account counts as cash. Null applies the default: a bank-linked
-- asset, or an asset whose name or statement line says "cash". A user may set
-- 'cash' or 'not_cash' to override the default.
ALTER TABLE chart_accounts ADD COLUMN cash_treatment text;
--> statement-breakpoint
ALTER TABLE chart_accounts ADD CONSTRAINT chart_accounts_cash_treatment_check CHECK (cash_treatment IS NULL OR cash_treatment IN ('cash', 'not_cash'));
