# PRD Storage Read Model Plan

## Goal

Stop using the GitHub PRD marker comment as Factory's primary PRD storage.
The PRD should be a structured Factory artifact/read model, with GitHub comments
kept only for human visibility and backwards compatibility.

## Current State

`runGrillAndPrdWorkflow` currently writes the complete PRD JSON into a GitHub
issue comment with the marker `<!-- factory:prd -->`.

That comment is not just a notification:

- The PRD tab fetches issue comments, finds the latest marker comment, and
  parses the fenced JSON.
- PRD revision fetches the latest marker comment to recover `priorPrd`.
- `decompose-prd` fetches the latest marker comment to recover the approved PRD.
- `prd.drafted` also stores the structured PRD in the local event stream, but
  most consumers still ignore it as the source of truth.

This makes the system brittle. A malformed, deleted, edited, paginated, or
out-of-order GitHub comment can break internal workflow behavior even though the
structured PRD was already produced by Factory.

## Desired Model

Factory should treat the latest structured PRD as local operational state.
GitHub should remain the lifecycle source of truth for labels and a human-facing
audit surface, not the database for generated artifacts.

Recommended target:

- Persist PRD drafts in a first-class local table or artifact record.
- Expose a server endpoint that returns the latest PRD for a work item.
- Move the PRD tab, revision flow, and decompose flow to that endpoint/read
  function.
- Continue posting a GitHub comment, but reduce it to a summary plus a link or
  compact markdown rendering.
- Keep marker-comment parsing as a fallback for older work items.

## Slice 1: Centralize Latest-PRD Lookup

Status: completed in `codex/prd-storage-read-model`.

Create one server/core function for resolving the latest PRD for a work item.
Initial implementation may read from existing sources in this order:

1. Latest local structured `prd.drafted` event payload.
2. Latest legacy `<!-- factory:prd -->` marker comment.

This slice should not change behavior. It only removes duplicated parsing from
`PRDSection`, `revisePRD`, and `dispatchDecomposePrd`.

Acceptance criteria:

- One shared latest-PRD resolver exists.
- It returns `{ prd, advisorConcerns, source, createdAt/runId }`.
- It prefers structured local event data over comment data.
- Existing marker-comment PRDs still parse.
- Unit tests cover event-first, comment fallback, and malformed-comment cases.

## Slice 2: Add A PRD API Read Surface

Status: completed in `codex/prd-storage-read-model`.

Add an issue-scoped endpoint such as:

```text
GET /projects/:slug/issues/:id/prd
```

The endpoint should use the centralized resolver and return the parsed PRD
view model directly. The browser should not fetch all comments just to discover
the PRD.

Acceptance criteria:

- PRD tab fetches the PRD endpoint instead of comments for PRD content.
- PRD tab still fetches events only for child issue links and timeline-adjacent
  details it actually needs.
- Empty, drafting, parse-error, advisor-notes, approval, request-changes, and
  declined states still render correctly.
- Existing PRD comment parser tests are kept for the fallback resolver, not as
  the primary UI contract.

## Slice 3: Move Revision And Decompose To Structured Lookup

Status: completed in `codex/prd-storage-read-model`.

Update backend workflow actions to use the centralized latest-PRD resolver:

- `revisePRD` should get `priorPrd` from the resolver.
- `dispatchDecomposePrd` should get the approved PRD from the resolver.

Comment parsing remains as a fallback inside the resolver only.

Acceptance criteria:

- A missing GitHub marker comment no longer blocks decompose when a local
  `prd.drafted` event exists.
- Revision works from structured local PRD data.
- If neither structured data nor a legacy comment exists, behavior still moves
  to `factory:needs-human` with a clear diagnostic.
- Tests prove comment deletion does not break revise/decompose when local PRD
  data exists.

## Slice 4: Persist PRDs As First-Class Artifacts

Status: not started.

Events are append-only telemetry, but PRDs are durable generated artifacts. Add
a dedicated persistence record so the latest PRD can be queried without
replaying events.

Two acceptable implementations:

1. A `prd_drafts` table keyed by project/work item/version.
2. The existing agent artifact mechanism, if it supports durable issue-scoped
   structured payloads without expiry.

Preferred shape:

- `projectId`
- `workItemId`
- `runId`
- `version`
- `prd`
- `advisorConcerns`
- `sourceCommentUrl` nullable
- `createdAt`

Acceptance criteria:

- `runGrillAndPrdWorkflow` persists the PRD before moving to
  `factory:prd-review`.
- `prd.drafted` remains as timeline telemetry.
- Latest-PRD resolver reads artifact/table first, then event, then legacy
  comment.
- A failed GitHub comment post does not lose the PRD draft if local persistence
  succeeded.

## Slice 5: Demote The GitHub Comment

Status: not started.

Once the app and workflows read local structured state, change the GitHub
comment from "full JSON database" to "human-facing publication".

Recommended comment shape:

```md
<!-- factory:prd-summary -->
# PRD drafted

Factory drafted a PRD for this issue.

- Title: ...
- Complexity: ...
- Acceptance criteria: N
- Vertical slices: N

Review in Goose Hub: ...
```

Keep posting the legacy full JSON marker only behind a temporary compatibility
flag if needed for existing workflows.

Acceptance criteria:

- New PRDs no longer need a full JSON fence in GitHub comments.
- Existing legacy PRD marker comments still render through fallback.
- Timeline/comment surfaces do not become noisy with giant generated payloads.
- There is a clear operator diagnostic when comment publication fails but local
  PRD persistence succeeds.

## Slice 6: Cleanup And Guardrails

Status: not started.

Remove direct PRD marker-comment parsing from UI and workflow code after all
callers use the resolver.

Acceptance criteria:

- `<!-- factory:prd -->` parsing is isolated to a legacy fallback module.
- Tests fail if a new primary caller reads PRD JSON directly from issue
  comments.
- Documentation for PRD review and revision states the source of truth is the
  local PRD artifact/read model.
- ADR 0033 is amended or superseded if the persistence model changes the PRD
  revision contract materially.

## Verification Plan

Run focused unit and integration coverage:

```sh
pnpm vitest apps/web/src/components/detail/components/PRDSection.test.tsx
pnpm vitest apps/web/src/components/detail/lib/parse-prd-comment.test.ts
pnpm vitest apps/server/src/domains/issues/prd-actions.test.ts
pnpm vitest slices/grill-and-prd/slice.test.ts
pnpm vitest slices/decompose-prd/slice.test.ts
```

Add one end-to-end recovery case:

- Draft PRD.
- Delete or hide the GitHub marker comment in the test source.
- Confirm PRD tab still renders.
- Approve PRD.
- Confirm decompose runs from local structured PRD data.

## Non-Goals

- Do not change the PRD schema.
- Do not add direct manual PRD editing.
- Do not move issue lifecycle authority out of GitHub labels.
- Do not remove legacy comment fallback until existing work items have either
  been migrated or are known safe to abandon.

## Recommended Order

Implement slices 1-3 first. That gives the practical robustness win without a
schema migration.

Then implement slice 4 if replaying events proves awkward or if PRDs need
version history, search, export, or audit metadata beyond timeline display.

Only demote the GitHub comment after every internal consumer has moved off the
comment parser.
