PRD: Engineering Spec Visibility In Investigation

  Problem

  The spec-author skill already creates a durable Engineering Spec, and downstream workflows use it to drive parallel
  implementation, QA verification, and Review criteria. Operators cannot currently inspect that artifact in a complete,
  readable way from the issue detail page.

  The Investigation tab shows investigator findings and a small Engineering Spec summary, but it does not expose the full
  spec-author decision surface: architecture, work-package dependencies, execution order, verification tooling, interface
  contracts, schema changes, constraints, or risk register.

  This creates an observability gap:

  - Operators can see that a spec was authored, but not what the spec-author actually decided.
  - Parallel implementation can behave unexpectedly without a visible work-package plan to inspect.
  - QA and Review may be judging against acceptance criteria derived from the spec, but the operator cannot easily see the
    source artifact behind that contract.
  - A live detail page can miss the newly persisted spec until query staleness expires or the page is refreshed.

  Product Decision

  Engineering Spec is a first-class issue artifact.

  It belongs in the Investigation tab because it is authored from investigation/scout evidence and is the bridge from
  investigation to delivery. It must remain visually distinct from investigator findings: investigator findings explain what
  was discovered; Engineering Spec explains the planned implementation contract.

  The PRD tab remains PRD-specific. Do not mix Engineering Spec into PRD unless a later product decision adds cross-links.

  Dependency

  Run this after `docs/prds/acceptance-criteria.md` lands.

  That PRD replaces verifyCommand-centric acceptance criteria with canonical criteria and executableChecks. Engineering Spec
  rendering should use the canonical AC DTO shape, not the current legacy verifyCommand projection.

  If `docs/prds/issue-event-stream.md` lands first:

  - Preserve the shared DetailPage event cache model.
  - Do not add a private InvestigationSection EventSource.
  - Any spec-related live refresh must use shared issue event handling and query invalidation.

  If `docs/prds/timeline.md` lands first:

  - Keep spec.completed as a lightweight timeline event in the delivery-router section.
  - Do not duplicate the full Engineering Spec inside the timeline.
  - Timeline should link or point to the Investigation artifact if deep inspection is needed.

  User Stories

  1. As an operator, I want to see the Engineering Spec in Investigation after spec-author succeeds, so I can inspect the
     plan that drives parallel implementation.
  2. As an operator, I want to see work packages, owned files, dependencies, and builder tiers, so I can understand how the
     work was split.
  3. As an operator, I want to see canonical acceptance criteria and executable checks, so I can understand what QA and
     Review will judge.
  4. As an operator, I want to see constraints and risks, so I can spot unsafe plans before downstream agents spend time.
  5. As an operator, I want to see interface contracts and schema changes, so I can inspect the intended implementation
     boundaries.
  6. As an operator watching a live run, I want the Engineering Spec panel to appear without a hard refresh once
     spec.completed lands.

  Scope

  Add an expanded Engineering Spec read model and render it in the Investigation tab.

  The panel should include:

  - Objective.
  - Architecture current/new/rationale.
  - Work packages: id, changes, files owned, dependencies, builder tier.
  - Execution order.
  - Canonical acceptance criteria, including executableChecks when present.
  - Verification tooling.
  - Interface contracts.
  - Schema changes.
  - Constraints.
  - Risk register.
  - Pipeline/run metadata such as pipelineRunId and updatedAt.

  Architecture

  Keep `engineering_specs` as the durable storage source. Do not add a second persistence path.

  Expand the server issue-spec endpoint into an explicit DTO projection over the stored EngineeringSpec. Avoid returning a
  raw unknown blob to the UI. The DTO may omit fields only if the source spec genuinely does not contain them.

  The Investigation tab owns the artifact rendering. It should fetch the spec through the existing issue API layer and render
  a collapsed-by-default artifact panel.

  The Acceptance Contract panel remains the normalized contract view. Engineering Spec may show the source criteria and
  executable checks, but it should not replace the Acceptance Contract display.

  Live Refresh

  When spec.completed is received for the current issue, invalidate:

  - `['spec', projectSlug, id]`
  - `['acceptance-contract', projectSlug, id]`

  Also keep existing issue and event invalidation behavior. The spec can change the acceptance-contract resolver result, so
  both queries need refresh.

  UI Decisions

  - Render Engineering Spec below the Acceptance Contract panel or immediately above it, but keep it in the main Investigation
    content flow.
  - Keep the panel collapsed by default.
  - Use compact sections rather than one giant JSON block.
  - Show empty states inside sections only when helpful; omit empty optional sections otherwise.
  - Show executable checks under each AC as checks, not as old verifyCommand text.
  - Do not treat criteria without executableChecks as incomplete. They are valid behavioral criteria.
  - Make long commands and file paths wrap without breaking the layout.

  Implementation Plan

  1. Update the Engineering Spec DTO in the server issue domain to project the full useful spec-author output.
  2. Update frontend types for EngineeringSpecDto, canonical ACs, executable checks, work packages, constraints, risks,
     interface contracts, schema changes, verification tooling, and execution batches.
  3. Refactor SpecDetails into a real Engineering Spec artifact panel.
  4. Keep InvestigationSection responsible for fetching and placing the artifact.
  5. Add shared live-event query invalidation for spec.completed.
  6. Ensure acceptance-contract rendering refreshes after spec.completed.
  7. Remove legacy verifyCommand-only display assumptions from SpecDetails.

  Regression Tests

  - Server route returns the expanded Engineering Spec DTO.
  - Server DTO handles canonical ACs with zero executableChecks.
  - Server DTO handles ACs with multiple executableChecks.
  - SpecDetails renders objective, architecture, WPs, execution order, constraints, risks, interface contracts, schema changes,
    verification tooling, and canonical AC executable checks.
  - SpecDetails does not render an old verifyCommand-only row for canonical ACs.
  - InvestigationSection renders the Engineering Spec panel when a spec exists.
  - spec.completed live event invalidates the spec query.
  - spec.completed live event invalidates the acceptance-contract query.
  - Existing timeline spec.completed card remains lightweight.

  Acceptance Criteria

  - After spec-author succeeds, the Investigation tab shows an Engineering Spec panel without requiring a hard refresh.
  - The panel exposes the full operator-relevant spec-author artifact, not just objective, WPs, and AC count.
  - Canonical acceptance criteria and executable checks render according to `docs/prds/acceptance-criteria.md`.
  - Criteria without executable checks are shown as valid behavioral criteria, not as missing QA evidence.
  - Downstream behavior for parallel-implement, QA, and Review is unchanged.
  - PRD tab remains PRD-specific.
  - Timeline keeps spec.completed as a lightweight event.

  Out of Scope

  - No backfill for old specs.
  - No changes to spec-author prompt or schema beyond what the canonical AC PRD already requires.
  - No new persistence table.
  - No raw JSON dump as the primary UI.
  - No PRD tab integration.
  - No changes to QA or Review verdict semantics.

  Further Notes

  The key distinction is artifact visibility, not contract ownership. The Engineering Spec remains the source artifact
  produced by spec-author. The Acceptance Contract remains the normalized criteria contract consumed by implementation,
  QA, and Review.
