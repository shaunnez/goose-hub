# Local DB Remaining Slices Implementation Plan

Date: 2026-05-26
Base branch for this plan: `codex/local-db-work-item-source-foundation`
Target PR branch for this plan: `codex/local-db-remaining-slices-plan`
Implementation target: future branches should continue to branch from the latest local-db foundation branch and merge back into that branch, not `main`.

## Goal

Finish the local-db Work Item rollout after the `LocalDbStateSource` foundation.

After the remaining slices, newly bootstrapped `source.kind = "local-db"` Target Projects should be runnable through the normal Goose Hub UI and core workflows while local SQLite remains the lifecycle source of truth.

The completed behavior should be:

- URL route ids remain human-display Work Item external ids.
- Server routes resolve route ids through `StateSource.getItem()` before querying operational tables.
- Event, cost, artifact, PRD, engineering-spec, and timeline reads use canonical `WorkItem.id`.
- GitHub issues, PRs, comments, commits, and branches are linked as external refs.
- GitHub webhooks append integration events and maintain refs without overriding DB state.
- Optional label mirroring is best-effort and never makes GitHub authoritative.
- Multi-repo projects expose repo affinity explicitly and workflows choose a target repo from Work Item repo links.
- Bootstrap can create a config that is immediately usable for local-db Work Items after merge.

## Baseline Assumptions

This plan assumes the foundation PR has landed on the implementation base branch:

- `work_items`, `work_item_repo_links`, `work_item_external_refs`, `work_item_comments`, `work_item_state_events`, `work_item_labels`, and `work_item_milestones` exist.
- `LocalDbWorkItemRepository` exists.
- `LocalDbStateSource` implements the existing `StateSource` contract.
- `getSourceForSlug()` returns `LocalDbStateSource` for `source.kind = "local-db"`.
- MCP workflow state-source resolution can return either GitHub or local-db sources.

Do not backfill historical `github` source projects in these slices.

## Current Remaining Gaps

Known code seams still assuming GitHub-shaped ids or GitHub lifecycle authority:

- `apps/server/src/domains/issues/service.ts`
  - `getIssueSpec()`, `getIssuePrd()`, `getIssueEvents()`, `getIssueComments()`, `commentOnIssue()`, `setIssueMilestone()`, and `setIssueLabel()` construct `github:${repoRef}#${id}`.
- `apps/server/src/domains/issues/prd-actions.ts`
  - PRD gate actions construct GitHub ids before querying events and appending PRD events.
- `apps/server/src/domains/issues/transitions.ts`
  - approve/reject/manual transition paths construct GitHub ids and merge through GitHub PR metadata.
- `apps/server/src/domains/costs/router.ts`
  - cost/tool-stat routes construct GitHub ids before calling cost services.
- `apps/server/src/shared/work-item-snapshot.ts`
  - mostly canonicalizes through `StateSource`, but related route helpers should become the shared pattern.
- `apps/server/src/domains/webhooks/handler.ts`
  - maps repo refs to project slugs and dispatches workflows directly from GitHub issue label events.
- `slices/fix-issue/implement-phase.ts`
  - opens PRs with `stateSource.repoRef` and `Number(workItem.externalId)`; local-db Work Items may not have a matching GitHub issue.
- `core/tool-layer/mcp/tools/workflow.ts`
  - some helpers still receive `issueNumber` and synthesize GitHub item ids for comments/transitions.
- `core/tool-layer/mcp/tools/context.ts`
  - project context exposes `repos` but not structured repository metadata.
- `core/tool-layer/mcp/tools/repo-intel.ts`
  - uses the current workspace root, but does not yet reason about local-db Work Item repo links.

## Slice 4: Canonical Work Item Route Resolution

### Objective

Centralize route-id resolution so every server read/write route can accept a display external id while querying operational stores by canonical `WorkItem.id`.

### Files Likely Touched

- New `apps/server/src/shared/work-item-resolution.ts`
- `apps/server/src/domains/issues/service.ts`
- `apps/server/src/domains/issues/prd-actions.ts`
- `apps/server/src/domains/issues/transitions.ts`
- `apps/server/src/domains/costs/router.ts`
- `apps/server/src/shared/work-item-snapshot.ts`
- Tests:
  - `apps/server/src/shared/work-item-resolution.test.ts`
  - `apps/server/src/domains/issues/service.test.ts`
  - `apps/server/src/domains/issues/prd-actions.test.ts`
  - `apps/server/src/domains/issues/transitions.test.ts` if split out; otherwise existing service tests
  - `apps/server/src/domains/costs/router.test.ts`
  - `apps/server/src/shared/work-item-snapshot.test.ts`

### Design

Add one shared resolver:

```ts
export interface ResolvedWorkItemForRoute {
  source: StateSource;
  item: WorkItem;
  routeId: string;
  canonicalWorkItemId: string;
  externalId: string;
  repoRef: string;
  isLocalDb: boolean;
}

export async function resolveWorkItemForRoute(
  projectSlug: string,
  routeId: string,
): Promise<Result<ResolvedWorkItemForRoute>>;
```

Resolver rules:

- Validate project via `getSourceForSlug(projectSlug)`.
- Call `source.getItem(routeId)`.
- Return `item.id` as `canonicalWorkItemId`.
- Never synthesize `github:${repoRef}#${routeId}` outside this helper.
- Preserve existing GitHub behavior because `GitHubLabelsSource.getItem("42")` returns `github:owner/repo#42`.
- Treat `item.repoRef` as the Work Item's current repo affinity, not as global project authority.

### Implementation Steps

1. Add `work-item-resolution.ts` with tests for GitHub-shaped and local-db-shaped source doubles.
2. Replace route-level id construction in issue service reads:
   - `getIssueSpec()`
   - `getIssuePrd()`
   - `getIssueEvents()`
   - `getIssueComments()`
   - `commentOnIssue()`
   - `setIssueMilestone()`
   - `setIssueLabel()`
3. Replace cost/tool-stat route id construction with resolver output.
4. Replace PRD action id construction with resolver output.
5. Replace transition/approval id construction where the route is acting on a Work Item. Keep GitHub PR merge calls GitHub-specific and guard them behind linked PR refs.
6. Update snapshot helpers to reuse the shared resolver or keep their current canonicalization only if it remains identical.

### Acceptance

- A local-db Work Item with `externalId = "1"` and `id = "wi_..."` can:
  - load issue detail data,
  - load timeline events,
  - load PRD/spec/artifact data by canonical id,
  - list comments,
  - add comments,
  - set milestone/priority/schedule/type,
  - show costs/tool stats stored under `wi_...`.
- Existing GitHub source routes still resolve `42` to `github:owner/repo#42`.
- No new route code constructs `github:${repoRef}#${id}` for local-db projects.

### Verification

Run:

```bash
pnpm typecheck
pnpm vitest apps/server/src/shared/work-item-resolution.test.ts
pnpm vitest apps/server/src/domains/issues/service.test.ts apps/server/src/domains/issues/prd-actions.test.ts apps/server/src/domains/issues/router.test.ts
pnpm vitest apps/server/src/domains/costs/router.test.ts apps/server/src/domains/costs/service.test.ts
pnpm vitest apps/server/src/shared/work-item-snapshot.test.ts
```

## Slice 5: GitHub External Ref Import and Linking

### Objective

Make GitHub an integration/projection layer by importing issues into local-db Work Items and linking PR/comment/branch/commit refs to the canonical Work Item id.

### Files Likely Touched

- New `core/connectors/github/issues.ts` or `core/integrations/github/issues.ts`
- New `core/integrations/github/import-issues.ts`
- New `core/integrations/github/external-refs.ts`
- `core/state-source/local-db-repository.ts`
- `core/state-source/local-db.ts`
- `apps/server/src/domains/bootstrap/service.ts`
- `core/workflows/bootstrap-project.ts`
- `slices/fix-issue/implement-phase.ts`
- `core/tool-layer/mcp/tools/workflow.ts`
- Tests near new modules and existing fix/bootstrap tests

### Design

Use `work_item_external_refs` as the canonical mapping table.

Issue import mapping:

- GitHub issue number -> `work_item_external_refs(provider="github", kind="issue", repo_ref, external_id)`
- Local Work Item external id remains local and project-scoped.
- Imported GitHub body/title become local Work Item title/body at import time.
- Imported GitHub state should map to a local lifecycle state using label parser where possible:
  - existing `factory:*` label -> matching state
  - open issue without state label -> `factory:triaging`
  - closed issue -> `factory:done` only if no better state is present
- Imported grouped labels map into `type`, `priority`, `schedule`, `mode`, `exec`.
- Issue comments are not required to import in this slice unless cheap; do not block on comments.

Ref linking:

- PR opened by Factory:
  - store `kind="pull_request"` with `external_id = String(prNumber)`, `url`, `repoRef`.
  - store `kind="branch"` for `factory/<runId>`.
  - append `pr.opened` event under canonical local `WorkItem.id`.
- GitHub comments posted by Factory:
  - if GitHub API returns a comment id/url, store `kind="comment"`.
  - local-db comments remain local comments; GitHub comments are external refs.
- Merge:
  - store `kind="commit"` for merge SHA if available.

### Implementation Steps

1. Add repository helpers:
   - upsert external ref by `(projectId, provider, kind, repoRef, externalId)`.
   - get Work Item by external ref.
   - list external refs by kind/provider.
2. Add GitHub issue fetch/list connector with pagination.
3. Add `importGitHubIssuesToLocalDb(projectConfig)`:
   - no-op unless `source.kind === "local-db"` and `source.integrations.github.importIssues === true`.
   - idempotently creates or updates local Work Items.
   - creates repo links with `source="github-import"`.
   - creates issue external refs.
4. Wire import into bootstrap run after config generation only if the target project config is already locally available, or expose a separate server endpoint/worker for import-after-merge. Prefer the separate post-merge import command if bootstrap currently only opens a config PR.
5. Update implement PR open path:
   - If Work Item has linked GitHub issue ref, keep `Closes #N`.
   - If no linked issue ref, use a non-closing body with a local Work Item URL and store the PR ref.
   - If existing `openPR()` hard-requires `Closes #N`, add a second connector path for local-db PRs rather than weakening GitHub issue PR validation globally.
6. Update `LocalDbStateSource.getPrDiff()` to use linked PR refs and GitHub diff fetch when a token is available; otherwise return `""`.

### Acceptance

- Importing the same GitHub issue twice is idempotent.
- Imported GitHub issues become local Work Items with canonical ids and issue external refs.
- A Factory-opened PR for a local-db Work Item creates a PR external ref.
- `getPrDiff()` returns a diff for a linked PR when token and repo ref are available.
- Local-db Work Items without linked GitHub issues can still open PRs without pretending their local external id is a GitHub issue number.

### Verification

Run:

```bash
pnpm typecheck
pnpm vitest core/integrations/github/import-issues.test.ts core/integrations/github/external-refs.test.ts
pnpm vitest core/state-source/local-db.test.ts core/state-source/local-db-repository.test.ts
pnpm vitest slices/fix-issue/chore-shipping.test.ts core/connectors/github/slice.test.ts
pnpm vitest apps/server/src/domains/bootstrap/service.test.ts slices/bootstrap-project/slice.test.ts
```

## Slice 6: Optional GitHub Label Mirroring

### Objective

Support optional outward label mirroring for local-db projects while preserving local SQLite as lifecycle authority.

### Files Likely Touched

- New `core/integrations/github/label-mirror.ts`
- New or existing GitHub label connector under `core/connectors/github/`
- `core/state-source/local-db.ts`
- `apps/server/src/domains/webhooks/handler.ts`
- `core/event-stream/state-transition.ts`
- tests near label mirror and webhook handler

### Design

Mirror only when:

- `source.kind === "local-db"`
- `source.integrations.github.mirrorLabels === true`
- Work Item has a linked GitHub issue ref.

DB -> GitHub:

- On state transition, enqueue or synchronously apply label changes to the linked GitHub issue.
- Replace only `factory:*` labels for state transitions.
- Mirror grouped metadata labels for `priority`, `schedule`, and `type` when those fields change.
- Failure to mirror must append a warning event and not roll back the DB transition.

GitHub -> DB:

- GitHub label webhook for local-db projects must not update `work_items.state` directly.
- If external label differs from DB state:
  - append an integration event such as `github.label.changed`,
  - if conflict is lifecycle-relevant, open an intervention or warning event.
- Non-factory label changes should be recorded only if useful; they must not dispatch workflows.

### Implementation Steps

1. Add a mirror helper that computes label patches from a Work Item before/after state or metadata.
2. Add tests for mirror disabled, no linked issue, mirror success, and mirror failure.
3. Hook state transitions or local-db source transition methods to call mirror helper after DB commit.
4. Update webhook handler:
   - find project by repo.
   - if GitHub-source project, keep existing label dispatch behavior.
   - if local-db project, append integration events and optionally create intervention/warning; do not dispatch label workflows.
5. Add visible warning events to issue timeline if conflict affects lifecycle state.

### Acceptance

- With `mirrorLabels: true`, DB state transition mirrors the matching `factory:*` label to the linked GitHub issue.
- With `mirrorLabels: false`, no GitHub mutation happens.
- External GitHub label changes do not override DB state.
- Label mirror errors are visible in events and do not fail local DB transitions.

### Verification

Run:

```bash
pnpm typecheck
pnpm vitest core/integrations/github/label-mirror.test.ts
pnpm vitest apps/server/src/domains/webhooks/handler.test.ts
pnpm vitest core/state-source/local-db.test.ts core/event-stream/state-transition.test.ts
```

## Slice 7: Repo Affinity and Multi-Repo Workflow Selection

### Objective

Make local-db Work Item repo links drive repo context and workflow target selection for multi-repo projects.

### Files Likely Touched

- `core/state-source/local-db-repository.ts`
- `core/state-source/local-db.ts`
- `core/tool-layer/mcp/tools/context.ts`
- `core/tool-layer/mcp/tools/repo-intel.ts`
- workflow setup paths in:
  - `apps/server/src/shared/dispatch-dev.ts`
  - `apps/server/src/shared/dispatch-discover.ts`
  - `slices/investigate/workflow.ts`
  - `slices/fix-issue/implement-phase.ts`
  - `slices/parallel-implement/workflow.ts`
- `core/workspaces/worktree.ts` or workspace creation callers if they assume one target repo
- tests in touched workflow slices

### Design

Repo affinity should be explicit:

- Project config lists possible repos.
- Work Item repo links list selected repos.
- One link can be marked `role="primary"` for implementation.
- Multiple links can exist for investigation/context.

Selection rules:

1. If Work Item has one `primary` repo link, use it.
2. If Work Item has one repo link total, use it.
3. If Work Item has multiple non-primary links, route to investigation/repo-selection or needs-human rather than picking silently.
4. If Work Item has no repo links:
   - bugs/features requiring code changes route to investigation/repo-selection first.
   - research/triage can proceed with project-level repo context.

Expose structured repository context:

```ts
repositories: Array<{
  id: string;
  repoRef: string;
  localPath: string | null;
  defaultBranch: string;
  role: string;
  selectedForWorkItem: boolean;
}>;
```

Keep `StateSource.repoRef` as compatibility only.

### Implementation Steps

1. Add public repository methods to list/add/remove Work Item repo links through `LocalDbStateSource` or a dedicated local-db repository API.
2. Add a route or MCP workflow-owned helper for repo selection if no UI route exists yet.
3. Extend `get_project_context` to include structured `repositories`.
4. Update `repo_intel` and workflow context to use selected repo worktree/index path.
5. Update implement/fix setup:
   - resolve target repo from Work Item repo links,
   - create/open worktree for that repo,
   - open PR against that repo,
   - store PR external ref with the same repo ref.
6. Update investigation so repo-intel findings can add repo links with `source="repo-intel"` and confidence.

### Acceptance

- A local-db Work Item with two repo links exposes both in project context.
- A local-db Work Item with one primary repo link implements against that repo.
- A local-db Work Item with multiple ambiguous repo links does not silently choose the compatibility repo.
- `repo_intel` searches the selected repo/worktree/index.
- Existing GitHub single-repo workflows still pass.

### Verification

Run:

```bash
pnpm typecheck
pnpm vitest core/tool-layer/mcp/tools/repo-intel.test.ts core/tool-layer/mcp/tools/context.test.ts
pnpm vitest apps/server/src/shared/dispatch.test.ts
pnpm vitest slices/investigate/slice.test.ts slices/fix-feedback/slice.test.ts slices/parallel-implement/slice.test.ts
pnpm vitest slices/fix-issue/chore-shipping.test.ts
```

## Slice 8: Bootstrap Creates Runnable Local-DB Projects

### Objective

Make bootstrap output not only a config PR but also a path to seed/import the local-db state needed for first use after merge.

### Files Likely Touched

- `apps/server/src/domains/bootstrap/service.ts`
- `apps/server/src/domains/bootstrap/router.ts`
- `core/workflows/bootstrap-project.ts`
- `core/workflows/bootstrap-renderers.ts`
- `core/bootstrap/github-repo-inspector.ts`
- `core/integrations/github/import-issues.ts`
- `core/state-source/local-db-repository.ts`
- `target-projects/*` tests/fixtures only

### Design

Bootstrap has two phases:

1. Registration PR phase:
   - inspect repos,
   - render `target-projects/<slug>/project.config.ts`,
   - set `source.kind = "local-db"`,
   - set GitHub integration options,
   - do not require a local clone path for preview.
2. Post-merge activation phase:
   - load merged project config,
   - create/import local Work Items if `importIssues` is true,
   - create repo links from config repo list,
   - report import/mirror status.

Do not seed local DB for a project that does not exist in the current loaded config unless the activation command receives an explicit preview config object. Prefer post-merge activation to avoid writing durable state for an unmerged registration PR.

### Implementation Steps

1. Add `activateLocalDbProject(slug)` service/workflow helper.
2. In activation:
   - validate project exists and `source.kind === "local-db"`,
   - seed local metadata needed outside config if any,
   - call GitHub issue import when configured,
   - return counts: repos linked, issues imported, issues skipped, mirror enabled/disabled.
3. Add route or CLI command for activation if the server already owns bootstrap actions.
4. Update bootstrap run response to tell the human whether activation is pending or completed.
5. Update docs/plan references and tests.

### Acceptance

- After the config PR is merged, one activation action can make a local-db project list/create Work Items.
- If `importIssues` is true, GitHub issues are imported idempotently.
- Preview still works without local clone paths.
- Bootstrap remains safe for multi-repo projects.

### Verification

Run:

```bash
pnpm typecheck
pnpm vitest apps/server/src/domains/bootstrap/service.test.ts apps/server/src/domains/bootstrap/router.test.ts
pnpm vitest slices/bootstrap-project/slice.test.ts
pnpm vitest core/integrations/github/import-issues.test.ts
pnpm vitest core/state-source/local-db.test.ts core/state-source/local-db-repository.test.ts
```

## Recommended Implementation Order

1. **PR A: Slice 4 only.**
   - This unblocks local-db detail pages, timeline, comments, PRD/spec reads, and cost/tool-stat reads.
   - It also reduces risk for all later slices by removing scattered GitHub id synthesis.
2. **PR B: Slice 5 without bootstrap activation.**
   - Add external refs, GitHub issue import helper, PR/comment/branch linking, and local-db PR opening semantics.
3. **PR C: Slice 6.**
   - Add optional label mirroring and webhook conflict behavior.
4. **PR D: Slice 7.**
   - Make repo links drive repo context and implementation target selection.
5. **PR E: Slice 8.**
   - Add post-merge activation/import flow and bootstrap status reporting.

Do not bundle Slices 5-8 into one PR unless the implementation is unexpectedly tiny. Slice 4 should stay separate because it changes the read/write route contract used by all later slices.

## Cross-Slice Invariants

- Local DB remains Work Item lifecycle authority for `source.kind = "local-db"`.
- GitHub labels never directly mutate local-db state.
- GitHub external refs are links, not identity.
- Route params remain display ids; internal queries use canonical `WorkItem.id`.
- `StateSource.repoRef` remains compatibility only.
- Holdout context and decision-summary rules do not change.
- Existing `source.kind = "github"` Target Projects must continue to pass their current tests.
- No new heavyweight dependencies.
- Do not modify governance files.

## End-to-End Acceptance for the Full Rollout

A freshly bootstrapped local-db Target Project can:

1. Load in the project list.
2. Create a local Work Item from the UI.
3. Show the Work Item detail page without a GitHub issue.
4. Append local comments.
5. Transition state from the UI and show state transition history.
6. Show timeline/events/costs/tool-stats by canonical Work Item id.
7. Import linked GitHub issues idempotently when configured.
8. Open implementation PRs against the selected repo and link the PR as an external ref.
9. Run QA/review/approval paths against the canonical local Work Item id.
10. Optionally mirror DB state to GitHub labels without accepting GitHub labels as authority.

## Full Verification Checklist

Run at minimum before the final rollout PR is considered complete:

```bash
pnpm typecheck
pnpm vitest core/state-source/local-db-repository.test.ts core/state-source/local-db.test.ts core/db/smoke.test.ts
pnpm vitest apps/server/src/shared/source.test.ts apps/server/src/shared/work-item-resolution.test.ts apps/server/src/shared/work-item-snapshot.test.ts
pnpm vitest apps/server/src/domains/issues/service.test.ts apps/server/src/domains/issues/prd-actions.test.ts apps/server/src/domains/issues/router.test.ts
pnpm vitest apps/server/src/domains/costs/router.test.ts apps/server/src/domains/costs/service.test.ts
pnpm vitest apps/server/src/domains/webhooks/handler.test.ts
pnpm vitest apps/server/src/domains/bootstrap/service.test.ts apps/server/src/domains/bootstrap/router.test.ts slices/bootstrap-project/slice.test.ts
pnpm vitest core/tool-layer/mcp/tools/context.test.ts core/tool-layer/mcp/tools/repo-intel.test.ts
pnpm vitest slices/investigate/slice.test.ts slices/fix-issue/chore-shipping.test.ts slices/parallel-implement/slice.test.ts
```

If route behavior changes are visible in the web UI, add or update an e2e test that creates/loads a local-db Work Item with no GitHub issue and verifies detail page sections do not 404.

