# Local DB State Source Implementation Plan

Date: 2026-05-26
Base branch: `bootstrap-remote-localdb`
Target PR branch: create a worktree branch off `bootstrap-remote-localdb` and PR back into `bootstrap-remote-localdb`, not `main`.

## Goal

Make newly bootstrapped `source.kind = "local-db"` projects runnable end to end without using GitHub labels as lifecycle authority.

GitHub should become an integration/projection layer:

- GitHub repos remain code/search/PR targets.
- GitHub issues, PRs, comments, and labels are external refs or mirrored state.
- Local SQLite owns Work Item state, type, priority, schedule, mode, exec, dependency links, comments, and state transition history.

This plan intentionally does not backfill existing `github` source projects. Keep `goose-hub-self` working while adding the local-db path.

## Current Baseline

PR #1087 adds remote-first bootstrap and renders new configs with:

```ts
source: {
  kind: "local-db",
  stateMachine: "db",
  integrations: {
    github: {
      repos: ["owner/repo"],
      mirrorLabels: false,
      importIssues: true,
    },
  },
},
repos: ["owner/repo"],
repositories: [
  { id, repoRef, cloneUrl, defaultBranch, localPath, role: "unknown" },
],
```

However, runtime still lacks `LocalDbStateSource`, and many call sites assume `source.kind === "github"` or construct Work Item ids as `github:owner/repo#123`.

## Non-Goals

- Do not migrate historical GitHub-label projects.
- Do not remove `GitHubLabelsSource`.
- Do not implement full bidirectional GitHub sync in the first PR.
- Do not redesign repo intelligence beyond making it able to read local-db project repo lists where needed.
- Do not change holdout, advisor, budget, or skill runtime semantics.

## Architecture Target

### Authority

Local DB is authoritative for Factory lifecycle:

- Work Item identity
- Work Item state
- Work Item metadata labels/groups
- comments created inside Goose Hub
- dependency refs
- repo affinity
- state transition history

GitHub is an external integration:

- imported issues become `work_item_external_refs`
- PRs/comments are linked artifacts
- webhooks append integration events
- label mirroring is optional and best-effort

### StateSource Routing

`StateSource` remains the main seam.

`getSourceForSlug(projectSlug)` should return:

- `LocalDbStateSource` for `source.kind === "local-db"`
- `GitHubLabelsSource` for existing `source.kind === "github"` projects

The new path must satisfy the existing `StateSource` interface before broader route/workflow cleanup.

## Data Model

Add migrations and Drizzle schema for these tables.

### `work_items`

Core current-state projection.

Suggested columns:

- `id` text primary key. Use a generated stable id such as `wi_<ulid>` or plain ULID.
- `project_id` text not null.
- `external_id` text not null. Human-display number/string within a project. Can start as autoincrement text.
- `title` text not null.
- `body` text not null default `""`.
- `state` text not null.
- `type` text not null.
- `priority` text not null.
- `mode` text not null.
- `schedule` text not null.
- `exec` text not null.
- `parent_id` text nullable.
- `author_is_owner` integer boolean not null default true.
- `milestone_id` text nullable.
- `milestone_title` text nullable.
- `created_at` text not null.
- `updated_at` text not null.
- `closed_at` text nullable.

Indexes:

- `(project_id, state)`
- `(project_id, external_id)` unique
- `(project_id, schedule)`
- `(project_id, milestone_id)`

### `work_item_repo_links`

Repo affinity; many repos per Work Item.

Columns:

- `id` integer primary key autoincrement
- `project_id` text not null
- `work_item_id` text not null
- `repo_ref` text not null
- `role` text not null default `"unknown"`; allowed examples: `primary`, `code`, `docs`, `infra`, `test`, `unknown`
- `confidence` real nullable
- `source` text not null default `"manual"`; examples: `manual`, `bootstrap`, `repo-intel`, `github-import`
- `created_at` text not null

Unique:

- `(work_item_id, repo_ref, role)`

### `work_item_external_refs`

Links to GitHub issues, PRs, comments, branches, or future external systems.

Columns:

- `id` integer primary key autoincrement
- `project_id` text not null
- `work_item_id` text not null
- `provider` text not null; initial value `github`
- `kind` text not null; `issue`, `pull_request`, `comment`, `branch`, `commit`
- `repo_ref` text nullable
- `external_id` text not null; issue number, PR number, comment id, branch name, SHA
- `url` text nullable
- `metadata_json` text nullable
- `created_at` text not null

Indexes:

- `(project_id, provider, kind, repo_ref, external_id)`
- `(work_item_id, kind)`

### `work_item_comments`

Local comments for Work Items when no GitHub issue exists.

Columns:

- `id` integer primary key autoincrement
- `project_id` text not null
- `work_item_id` text not null
- `body` text not null
- `author_login` text not null default `"goose-hub"`
- `created_at` text not null

### `work_item_state_events`

Transition history. This is not a replacement for the global event stream; it is a compact state-history read model.

Columns:

- `id` integer primary key autoincrement
- `project_id` text not null
- `work_item_id` text not null
- `from_state` text nullable
- `to_state` text not null
- `mode` text not null; `legal` or `forced`
- `note` text nullable
- `actor` text nullable
- `created_at` text not null

## Implementation Slices

### Slice 1: DB Schema and Repository

Files likely touched:

- `core/db/schema.ts`
- `core/db/migrations/*.sql`
- `core/db/migrations/meta/_journal.json`
- new `core/state-source/local-db-repository.ts`
- tests near `core/state-source/local-db-repository.test.ts`

Tasks:

1. Add tables above.
2. Add repository helpers:
   - create work item
   - get by `(projectId, id | externalId)`
   - list open by project/milestone
   - update state atomically
   - set grouped metadata (`priority`, `schedule`, `type`)
   - add/remove raw labels or metadata tags if needed
   - create/list comments
   - create/list repo links
   - create/list external refs
3. Keep repository functions small enough to test directly but avoid scattering SQL into `LocalDbStateSource`.
4. Add migration smoke test with temp DB if this repo has a migration test pattern.

Acceptance:

- `pnpm typecheck` passes.
- Repository unit tests cover create/get/list/transition/comment/repo-link/external-ref.
- Migration applies to an empty temp DB.

### Slice 2: `LocalDbStateSource`

Files likely touched:

- new `core/state-source/local-db.ts`
- `core/state-source/interface.ts` only if strictly needed
- `core/state-source/local-db.test.ts`

Implement the existing `StateSource` contract:

- `projectId`
- `repoRef`
  - For local-db projects, expose a stable compatibility repo ref:
    - first configured repo for now, or
    - `local:<projectId>` if no repo exists.
- `listOpenWork(milestoneNumber?)`
- `listClosedWorkByMilestone(milestoneNumber)`
- `listWorkByMilestone(milestoneNumber)`
- `getItem(itemId)`
- `listMilestones()`
- `getActiveMilestone()`
- `transitionState(itemId, from, to, note?)`
- `forceState(itemId, to)`
- `comment(itemId, body)`
- `listComments(itemId)`
- `setMilestone(itemId, milestoneNumber | null)`
- `setLabelInGroup(itemId, group, value)`
- `addLabels(itemId, labels)`
- `removeLabel(itemId, name)`
- `listLabels(itemId)`
- `attach(itemId, artifact)`
- `createIssue(input)`
- `createMilestone`, `updateMilestone`, `deleteMilestone`
- `getPrDiff(itemId)`
- `watchForUpdates(callback)`

Pragmatic notes:

- `getPrDiff` can use linked GitHub PR refs when present; otherwise return empty string with a clear comment/test.
- `watchForUpdates` can be a no-op subscription initially if no local pubsub exists.
- `attach` can store external/artifact refs only if an artifact table already exists; otherwise no-op with a test documenting current behavior.
- Preserve legal transition validation with `isLegalTransition`.

Acceptance:

- `LocalDbStateSource` passes a contract test suite shared with `InMemoryLabelsSource` where practical.
- Illegal transitions reject.
- Forced transitions write state history.
- Created Work Items can be listed, commented on, transitioned, and labeled without GitHub.

### Slice 3: Route `source.kind = "local-db"`

Files likely touched:

- `apps/server/src/shared/source.ts`
- `core/tool-layer/mcp/tools/_github.ts` or replacement naming if appropriate
- server/domain tests that call `getSourceForSlug`
- CLI command guardrails

Tasks:

1. `getSourceForSlug()` returns `LocalDbStateSource` for local-db projects.
2. MCP tools that only need a `StateSource` should stop importing from `_github` naming where possible.
3. GitHub-only tools should explicitly require a linked GitHub external ref/repo.
4. Existing `github` source projects still route to `GitHubLabelsSource`.

Acceptance:

- Server issue routes can list/create/transition local-db Work Items.
- Existing GitHub source tests still pass.
- New local-db source route tests cover list/get/create/transition.

### Slice 4: Work Item ID Cleanup for Read Routes

Files likely touched:

- `apps/server/src/domains/issues/*`
- `apps/server/src/domains/costs/router.ts`
- timeline/detail code that filters by `workItemId`
- `apps/server/src/shared/work-item-snapshot.ts`
- MCP workflow tools that build `github:${repo}#${n}`

Tasks:

1. Stop constructing `github:${repoRef}#${id}` for local-db projects.
2. Use `StateSource.getItem(id)` and then use returned `WorkItem.id`.
3. For URL params, keep `:id` as external display id, but resolve through state source.
4. Cost/event queries should use resolved canonical `WorkItem.id`.
5. Add a helper such as `resolveWorkItemForRoute(slug, externalId)` to centralize this.

Acceptance:

- Detail page loads for a local-db Work Item with no GitHub issue.
- Cost and tool-stat routes query by DB Work Item id after resolution.
- Existing GitHub issue detail routes still work.

### Slice 5: GitHub External Ref Import and Linking

Files likely touched:

- new `core/integrations/github/import-issues.ts`
- new `core/integrations/github/external-refs.ts`
- webhook handler paths
- bootstrap domain service if import-on-bootstrap is added

Tasks:

1. Import GitHub issues into local-db Work Items when `source.integrations.github.importIssues` is true.
2. Store issue refs in `work_item_external_refs`.
3. Link PR refs when implementation opens a PR.
4. Add comment refs when GitHub comments are posted.
5. Webhook ingest should append events and update refs, not become state authority.

Acceptance:

- Importing the same GitHub issue twice is idempotent.
- Imported issue has local state and external ref.
- PR link can be found from Work Item id.

### Slice 6: Optional GitHub Label Mirroring

Files likely touched:

- new `core/integrations/github/label-mirror.ts`
- webhook handler
- settings/config handling

Tasks:

1. If `mirrorLabels` is true, DB transitions enqueue/apply GitHub label updates.
2. External GitHub label changes become events.
3. If external label change conflicts with DB state, create an intervention or warning event rather than silently changing DB state.

Acceptance:

- DB transition can mirror state to linked GitHub issue.
- GitHub label webhook does not override DB state by default.

### Slice 7: Repo Affinity and Multi-Repo Workflows

Files likely touched:

- `core/tool-layer/mcp/tools/repo-intel.ts`
- investigate/spec/implement workflow setup
- dependency resolver
- worktree creation helpers

Tasks:

1. Project context returns `repositories` with repo refs and local paths.
2. Work Items can carry zero, one, or many repo links.
3. Investigation can add repo links based on repo-intel findings.
4. Implement/fix workflows choose a target repo from Work Item repo links.
5. If no repo link exists, route to investigation/repo-selection before implementation.

Acceptance:

- A local-db Work Item with two repo links exposes both repos in project context.
- `repo_intel` can search the correct worktree/index for the selected repo.
- Implementation refuses to run when no target repo has been selected.

### Slice 8: Bootstrap Creates Runnable Local-DB Projects

Files likely touched:

- `apps/server/src/domains/bootstrap/service.ts`
- `core/workflows/bootstrap-project.ts`
- `core/bootstrap/github-repo-inspector.ts`
- local-db repository/source

Tasks:

1. After config/PR path is stable, add a run mode that can seed DB project repo records if the app stores them outside config.
2. Optionally import GitHub issues during bootstrap when requested.
3. Show post-bootstrap status: config PR, repos inspected, labels mirrored or skipped, issues imported.

Acceptance:

- Bootstrapping a multi-repo project creates a config that can list/create DB Work Items after merge.
- No local clone path is required for preview.

## Risk Areas

- `StateSource.repoRef` is a single string but local-db projects can have many repos. Keep it as compatibility only and avoid adding new dependence on it.
- Event stream currently expects stable `workItemId`; local-db must generate canonical ids early and consistently.
- Costs and run records may still use GitHub-form ids. Resolve route ids to canonical ids before querying.
- CLI commands currently assume GitHub labels. It is acceptable to keep explicit local-db unsupported messages until server/UI paths work.
- GitHub milestones do not naturally map to local-db projects. Use local milestone tables or nullable milestone fields rather than trying to infer from GitHub.

## Verification Checklist

Run at minimum:

```bash
pnpm typecheck
pnpm vitest core/state-source/local-db.test.ts core/state-source/dependency-resolver.test.ts
pnpm vitest apps/server/src/domains/issues/router.test.ts apps/server/src/shared/source.test.ts
pnpm vitest apps/server/src/domains/bootstrap/service.test.ts slices/bootstrap-project/slice.test.ts
```

Also run the migration against a temp DB using the repo's existing migration pattern.

## PR Strategy

For the next implementation session:

1. Create a worktree from `bootstrap-remote-localdb`.
2. Implement Slices 1-3 first.
3. Only include Slices 4-8 if they remain tractable without turning the PR into a rewrite.
4. Raise the PR back into `bootstrap-remote-localdb`.
5. In the PR body, explicitly list unsupported local-db surfaces that remain.

If the implementation gets too large, stop after Slices 1-3 and open follow-up issues for Slices 4-8.

## Prompt for Next Session

```text
You are in /Users/shaunnesbitt/projects/goose-hub. Read CLAUDE.md, CONTEXT.md, and docs/superpowers/plans/2026-05-26-local-db-state-source-implementation.md.

Create a new git worktree and branch off the existing branch `bootstrap-remote-localdb`; do not work directly on main and do not PR to main. Implement the local-db Work Item source foundation described in the plan, aiming to complete Slices 1-3 end to end:

1. Add SQLite/Drizzle schema + migrations + repository helpers for local DB Work Items, repo links, external refs, comments, and state transition history.
2. Implement `LocalDbStateSource` behind the existing `StateSource` interface, with tests for create/get/list/comment/transition/forceState/label groups.
3. Route `source.kind = \"local-db\"` through server source resolution and relevant MCP state-source access while keeping existing GitHub source projects working.

If the changes remain reasonably scoped, continue into Slice 4 route id cleanup enough that server issue routes can list/create/transition local-db Work Items. Do not implement GitHub label mirroring unless Slices 1-4 are already green.

Verification required before PR:
- pnpm typecheck
- focused vitest suites for local-db source/repository, source routing, dependency resolver, and any touched issue routes
- migration smoke test against a temp DB if available

When done, push the worktree branch and open a PR with base `bootstrap-remote-localdb`. Include a concise implementation summary, verification output, and explicit remaining local-db gaps.
```
