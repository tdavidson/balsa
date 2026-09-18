# Consequence traceability and document preview: design

Date: 2026-09-18
Status: approved by delegation. The user chose autonomous execution, so
decisions are marked **Ruling**.
Builds on: `2026-09-18-forecast-consequences-design.md`.

## Gap

Consequences and previews name the item ("Confirmed Acme retainer") but not
the document behind it. None of them link to that document, even though
every stored driver ref carries an `evidenceId` and every cause records its
subject. Previews also run one item at a time. A CFO who uploads a contract
cannot see what that document does as a whole before approving it.

## Facts

These facts about the current code constrain the design:

- There is no evidence page or viewer. "Opening a source" means opening
  the Documents dialog with `selectedEvidenceId` set. The calculation trace
  dialog already does this.
- Draft economic items exist only after evidence is **published**, which
  happens once identity, facts, and treatment are all approved. Each draft
  item carries an `evidenceId`.
- `GET /api/items` has no filter and returns `evidenceId` with every item.
  The client `ProposedItem` type does not yet include `evidenceId`.
- `previewForecastChange` handles one `confirm_item` or one
  `apply_decision`.

## Design

### T1. Source-aware copy

- `ForecastDriverRef` already carries `evidenceId`. `loadRecentConsequences`
  resolves the evidence `sourceName` for every `evidenceId` found in
  `delta.drivers.added/removed/changed`, scoped to the company. It exposes
  them as `sources: { evidenceId, sourceName }[]` on each consequence row.
- The item preview response gains `sources`: the draft item's evidence, if
  it has one.
- `describeConsequence` stays unchanged. A new pure helper,
  `describeSources(sources)`, renders "from Acme MSA.pdf", or "from Acme
  MSA.pdf and 2 more".
- **Ruling:** the source appears as a separate linked element, not
  embedded in the sentence. A link can't live inside plain copy, and
  keeping them apart keeps the copy testable.

### T2. Links to the evidence

- The "What changed" rows and the preview lines render each source as a
  button that opens the Documents dialog with that evidence selected, the
  same pattern the trace dialog uses.
- `app-shell` passes an `onOpenEvidence(evidenceId)` callback down to
  `ForecastWhatChanged` and `ForecastConsequenceLine`.
- A cause whose subject is evidence (`evidence_published`) is also
  clickable.

### T3. Document preview

- `ForecastPreviewChange` gains
  `{ kind: "confirm_items"; itemIds: string[] }`, a batch preview. Every id
  must be a draft item of the company, or the request fails with
  `PreviewConflict`. Scenario items are skipped and counted in `note`. The
  change adds all the resulting drivers at once and diffs a single time.
- **Ruling:** the preview is a batch of item ids, not an evidence id. The
  UI groups draft items by evidence and sends that group's ids. The same
  kind then also covers "Confirm all N".
- In app-shell's "Interpreted items" section:
  - Add `evidenceId` to `ProposedItem`.
  - Group the draft items by evidence, with drafts that have no evidence
    as their own group.
  - When a group has more than one item, show a group header: the document
    name (linked, per T2), a group "Forecast: …" line from the
    `confirm_items` preview, and a "Confirm all from this document" action
    that PATCHes those ids.
  - The existing per-item lines stay.
- The "Confirm all N" header action gets a matching `confirm_items`
  preview line.
- **Parity test (DB-backed):** the batch preview's headline figures equal
  the consequence recorded after a bulk PATCH-equivalent confirm of the
  same ids. A single `refreshCurrentCalculationRun` with `subjectIds`
  mirrors the items route.

## Testing

- Pure tests for `describeSources`.
- DB-backed tests:
  - `loadRecentConsequences` returns `sources` for added drivers, and
    never returns another company's evidence.
  - `confirm_items` preview parity with a bulk confirm.
  - A mixed batch that includes a non-draft item returns 409.
- UI: typecheck and lint only. There is no UI harness.
