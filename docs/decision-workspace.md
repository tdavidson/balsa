# Decision workspace

Open **Decision workspace** at `/operating-models`. It connects the existing
operating-model engine, scenario approvals, and outcome records. AI can propose
relationships; deterministic code calculates every financial result. Drafting,
calculating, and saving a scenario do not approve a forecast change.

## Five views

| View | Purpose |
| --- | --- |
| Overview | Describe a decision, start a hiring model, or reopen a preserved experiment. |
| Assumptions | Edit dated inputs, their basis, the horizon, and decision criteria. |
| Compare | Calculate alternatives, compare cash against the current forecast, and select a case for review. |
| Details | Inspect monthly cash roll-forwards, relationships, sources, formula versions, exceptions, connections, and studies. |
| Outcome | Follow approval and review predictions associated with the saved experiment. |

The cash chart shows the selected case and current forecast with monthly values.
Select a point to inspect that month's calculation. After editing assumptions,
choose **Calculate and compare cases** again: old previews are invalidated rather
than displayed as current. Forecast exceptions prevent saving and explain what
needs attention. Acknowledging assumptions is required before scenario handoff.

## Start with hiring

Enter a start month, headcount, annual salary per hire, benefits percentage,
one-time recruiting cost per hire, and minimum cash balance. Compensation inputs
start blank. The starter builds ordinary editable operating-model relationships:
monthly salary plus benefits, and recruiting cost when headcount increases.
It compares hiring at the chosen date, delaying three months when the horizon
allows, and not hiring.

This is an incremental, full-month cost model, capped at twelve months and the
remaining forecast horizon. It assumes no productivity or revenue benefit,
raises, attrition, or partial-month payroll. Review its explicit limitations and
possible overlap with costs already in the forecast. The starter supplies no
company evidence; inputs remain analyst assumptions unless sourced.

For other decisions, describe the mechanics and use AI drafting and revision.
Pricing can model incremental revenue from changed prices and customer counts.
New customer receipts can use explicit payment timing. To delay a receipt
**already in the forecast**, use **Expectations & coverage** at `/reconciliation`:
reschedule the existing obligation instead of adding another receipt.

## Save progress, preserve a case, approve

**Save progress** stores the question, editable model, selected case, and optional
experiment link in a company-scoped draft. Reopen it from the draft selector.
The selector shows up to fifty recently updated drafts. Drafts use revision
checks: an older browser tab cannot overwrite a newer revision. Reopen the latest
version or save your edits as a new draft after a conflict. Saving is explicit;
the workspace warns before closing or reloading the browser with unsaved edits.
Save progress before navigating to another page.

**Save this case as a scenario for review** creates an immutable experiment and
an unapproved scenario through the existing financial engine. Its calculation,
inputs, sources, and formula versions are preserved independently of later draft
edits. Saving a draft alone does not create an experiment or scenario.

Follow **Review this scenario for approval** to Decisions & outcomes. Approval
requires a goal and preserved plan; the workspace links to Goals when needed.
Existing approval checks compare financial effects before changing the forecast.
The approval page retains a return link to this experiment's Outcome view.
A bookmark such as `/operating-models?experiment=<id>&view=outcome` reopens the
preserved definition and its outcome context within the current company.

Outcome records remain scoped to that experiment, including after newer
experiments are created. Approval creates predictions through the existing
outcome system. Approval alone does not establish what actually happened:
coverage, actual evidence, observation, and review still determine verification.

## Implementation and validation

The three implementation passes connect persisted records, organize the five
views, and exercise the workflow across hiring, incremental pricing, and a new
customer receipt with delayed payment. Regression coverage checks deterministic
hiring costs, draft revision conflicts and company isolation, API validation,
and each example's calculation, preservation, approval, and scoped prediction.
Existing reconciliation coverage validates rescheduling existing receipts.

Migration `0097_operating_drafts.sql` adds company-scoped drafts with row-level
security, indexes, and revision constraints. Apply it with `pnpm db:migrate`.
Missing migrations remain explicit service errors. Draft changes are audited;
no second financial calculation engine or automatic approval is introduced.
