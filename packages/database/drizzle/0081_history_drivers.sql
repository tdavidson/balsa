ALTER TABLE economic_items ADD COLUMN forecast_template_id uuid REFERENCES forecast_entry_templates(id);
ALTER TABLE economic_items ADD COLUMN forecast_origin jsonb;
CREATE UNIQUE INDEX forecast_templates_company_id ON forecast_entry_templates(company_id, id);
ALTER TABLE economic_items ADD CONSTRAINT economic_items_forecast_template_scope FOREIGN KEY (company_id, forecast_template_id) REFERENCES forecast_entry_templates(company_id, id);
CREATE UNIQUE INDEX economic_items_history_pattern ON economic_items(company_id, (forecast_origin->>'patternKey')) WHERE forecast_origin IS NOT NULL AND scenario_id IS NULL;
