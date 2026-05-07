# grill-prd-ui slice (M13.07 + M13.08)

## What this slice does

Ships the **Grill** and **PRD** tabs on the work-item detail page. They expose
the Discover-Lane conversation produced by `runGrillAndPrdWorkflow`
(slice `grill-and-prd`) so a human can read questions, post replies, review
the structured PRD, and approve or re-grill it.

Both tabs are bundled in one slice because they share files (the section
registry, the LeftRail dispatch, the marker-comment parser) and ship as a
single user-facing experience.

## Surfaces touched

UI:

- `apps/web/src/components/detail/components/PRDSection.tsx` — renders the
  parsed PRD (title, problem, proposed solution, AC table, journeys,
  behaviors, vertical slices, complexity badge) plus the `Approve PRD` /
  `Reject` buttons when the issue is in `factory:prd-review`. Advisor concerns,
  if present in the marker comment, render as a collapsible "Advisor notes"
  panel above the PRD content.
- `apps/web/src/components/detail/components/GrillSection.tsx` — renders the
  grill conversation (agent question vs. user reply distinguished by the
  `<!-- factory:grill-question -->` marker) and a reply textarea + Send
  button. Send posts a comment and, when in `factory:gate-pending`,
  transitions back to `factory:grilling` so the orchestrator can pick it up
  on the next tick. The reply renders optimistically.
- `apps/web/src/components/detail/lib/parse-prd-comment.ts` — pure parser
  for the `<!-- factory:prd -->` marker comment, extracting both the JSON
  PRD and the optional advisor concerns markdown block.
- `apps/web/src/components/detail/lib/sections.ts` — `prd` flipped to
  `available: true`; new `grill` section added between `prd` and `code`.
- `apps/web/src/components/detail/components/LeftRail.tsx` — adds
  `MessageCircleQuestion` icon for `grill`, and visibility gates for `prd`
  and `grill` (driven by `PRD_ACTIVE_STATES` / `GRILL_ACTIVE_STATES`).
  Both tabs are absent from the rail outside the Discover lane (not just
  collapsed).
- `apps/web/src/components/detail/components/DetailPage.tsx` — dispatches
  `prd` and `grill` section keys to the new section components.
- `apps/web/src/lib/constants.ts` — adds `PRD_ACTIVE_STATES` and
  `GRILL_ACTIVE_STATES`.
- `apps/web/src/lib/api.ts` — adds `approvePRD` and `rejectPRD` client
  helpers.

Server:

- `apps/server/src/domains/issues/prd-actions.ts` — implements `approvePRD`
  and `rejectPRD`. `approvePRD` advances `factory:prd-review →
  factory:decomposing` (a legal transition); `rejectPRD` returns the issue
  to `factory:grilling` and posts the `User rejected the PRD; returning to
  grill.` comment. Both use a `transitionState`-then-`forceState` fallback
  to be robust against future legal-table changes.
- `apps/server/src/domains/issues/router.ts` — exposes
  `POST /:slug/issues/:id/approve-prd` and
  `POST /:slug/issues/:id/reject-prd`.

Workflow:

- `core/workflows/grill-and-prd.ts` — grill questions are now prefixed with
  the `<!-- factory:grill-question -->` marker so the Grill tab can
  distinguish them from user replies. No other behaviour changed.

## Approve flow contract

The Approve PRD button calls `POST /approve-prd`, which transitions the
issue from `factory:prd-review` to `factory:decomposing`. **This slice does
NOT trigger the decompose-prd workflow synchronously.** The orchestrator
picks up issues in `factory:decomposing` on its next tick and dispatches
`runDecomposePrdWorkflow` (slice `decompose-prd`) at that point.

## Reject flow contract

The Reject button calls `POST /reject-prd`, which:

1. Posts the comment `User rejected the PRD; returning to grill.` so the
   conversation transcript reflects the rejection.
2. Returns the issue to `factory:grilling` so the orchestrator dispatches
   another grill round on its next tick.

## Tests

- `slice.test.ts` — slice-level smoke test that asserts the parser and the
  approve/reject helpers work end-to-end against the in-memory state source.
- `apps/web/src/components/detail/lib/parse-prd-comment.test.ts` — pure
  parser tests.
- `apps/web/src/components/detail/components/PRDSection.test.tsx` — RTL
  component tests covering empty / drafting / approved-state / advisor-notes
  / approve-button / reject-button / parse-error scenarios.
- `apps/web/src/components/detail/components/GrillSection.test.tsx` — RTL
  component tests covering empty thread, agent vs user message detection,
  PRD comment filtering, optimistic reply rendering, the
  gate-pending → grilling auto-transition, and the "Grilling complete"
  footer.
- `apps/server/src/domains/issues/router.test.ts` — happy-path / wrong-state
  (409) / project-not-found (404) for `approve-prd` and `reject-prd`.
- `apps/web/e2e/grill-prd-flow.spec.ts` — Playwright e2e covering the PRD
  approve flow and the Grill reply flow against mocked endpoints.

## Limitations

- The reply form on the Grill tab is a plain `<textarea>` rather than the
  shared `MarkdownEditor`. A markdown editor here would require also
  rendering markdown previews of in-flight replies; deferred to a follow-up.
- Optimistic replies clear when the mutation either succeeds or fails. On
  failure the reply text is not restored to the textarea — the user has to
  retype. Acceptable for v1; can be added later.
