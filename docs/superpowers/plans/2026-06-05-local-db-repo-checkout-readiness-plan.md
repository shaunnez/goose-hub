# Local-DB Repo Assignment And Checkout Readiness Plan

## Goal

Make multi-repo local-db projects repo-neutral by default, then let repo-match or explicit user selection assign repositories. Any workflow that reads or edits code must operate from a real target-repo checkout under `~/.factory/repos` and a unique disposable worktree per repo/run.

## Non-Goals

- Do not build full multi-repo implementation orchestration in the first slice.
- Do not clone every registered project repository during project creation or repo-match.
- Do not edit canonical clones under `~/.factory/repos` directly.
- Do not backfill existing stories or existing Shift4 repo links.

## Current Evidence

- `core/state-source/local-db.ts:271-279` creates a primary repo link from `this.repoRef` during local issue creation when `this.repoRef` is not `local:*`. In multi-repo local-db projects this can make the default project repo look like a deliberate issue repo assignment.
- `core/state-source/local-db.ts:96-98` maps work items back to `this.repoRef` when there is no repo link, so DTO/header consumers can still see a misleading fallback.
- `core/workspaces/repo-affinity.ts:70` already blocks local-db implementation when no repo link exists, but `core/workspaces/repo-affinity.ts:76` still has a `firstProjectRepository(project)` fallback for other paths.
- `core/workspaces/repo-affinity.ts:17-26` treats one repo link as checkout-eligible even if the role is not `primary`.
- `core/workspaces/worktree.ts:41-43` keys disposable worktree paths only by `runId`; multi-repo work in one run would collide.
- `apps/server/src/domains/issues/transitions.ts:315-316` already cleans up a dev worktree after PR merge using `devRunId` from `pr.opened`.
- Existing review/retro code intentionally expects dev worktrees to remain available until after PR merge.

## Desired Model

### Repo Links

Local-db work items can have zero, one, or many repo links.

- `primary`: the single checkout repo for workflows that require one codebase.
- `related`: relevant supporting repo, not checkout-eligible by itself.
- `unknown`: imported/manual metadata where the system cannot infer checkout intent.

Only `primary` satisfies single-repo checkout requirements. A lone `related` link must not be treated as primary.

### Clone Storage

Default clone root:

```text
~/.factory/repos
```

Default clone path:

```text
~/.factory/repos/<projectId>/<repoRef>
```

Example:

```text
~/.factory/repos/shift4-smartpay/smartpayplatform/nz-transaction-verification-api
```

Canonical clones are long-lived and are only used as sources for `git worktree add`.

### Disposable Worktrees

All code-reading and code-writing workflows use disposable worktrees created from canonical clones. Worktree paths must be unique by repo and run.

Acceptable path pattern:

```text
~/.factory/workspaces/<runId>/<repoId>
```

Where `repoId` is a stable normalized form of `repoRef`, for example `smartpayplatform-nz-transaction-verification-api`.

## Implementation Slices

### Slice 1: Stop Fake Repo Assignment

1. Change local issue creation so it does not create a repo link from compatibility fallback for multi-repo local-db projects.
2. Preserve explicit repo links from Jira import, Bitbucket PR linking, GitHub import, manual assignment, and future issue-capture repo selection.
3. Allow local-db `WorkItem.repoRef` and DTO `repoRef` to be null when no repo link exists.
4. Audit UI/header assumptions and render unassigned local issues without using the first configured repo.

Acceptance:

- Creating a local issue in `shift4-smartpay` creates no `work_item_repo_links` row unless the user/import explicitly supplied one.
- Detail header does not show `smartpayCloud/ami-build` or any first configured repo for an unassigned item.
- A Shift4 local issue with no repo link cannot start investigation or fix workflows against Goose Hub or the first configured repo.

### Slice 2: Repo-Link Selection Semantics

1. Replace `selectRepoLink()` behavior with checkout-aware selection:
   - exactly one `primary` link: select it
   - zero `primary` links: return a typed `repo-unassigned` result
   - more than one `primary` link: return a typed `repo-ambiguous` result
   - ignore `related` links for primary checkout selection
2. Convert raw throws in repo-affinity to typed results where dispatchers can create a clear intervention or needs-human event.
3. Remove or strictly scope `firstProjectRepository(project)` fallback so it cannot become implicit local-db repo assignment.

Acceptance:

- A lone `related` repo link does not satisfy checkout.
- Two related links and no primary produce a repo-selection requirement, not an arbitrary checkout.
- Multiple primary links produce a clear ambiguity error.

### Slice 3: Repo-Match Persistence

1. Repo-match may persist multiple repo links.
2. High-confidence top candidate can become `primary`.
3. Other plausible candidates become `related`.
4. Ambiguous output leaves the item without primary and relies on user selection/intervention.
5. Persist `source: 'repo-match'` and numeric confidence.

Acceptance:

- High-confidence repo-match creates one primary link.
- Low-confidence or ambiguous repo-match creates no primary link.
- Related candidates are visible but do not drive checkout.

### Slice 4: Checkout Readiness

Add a shared helper, for example `ensureRepositoryCheckout(projectId, repoConfig, options)`.

Responsibilities:

1. Resolve canonical clone path under `~/.factory/repos/<projectId>/<repoRef>`.
2. If missing, clone `repoConfig.cloneUrl`.
3. If present, verify path is a git repository.
4. Verify remote matches expected repo.
5. Fetch refs.
6. Resolve branch/base ref using configured branch strategy.
7. Emit checkout-readiness event with `repoRef`, `clonePath`, `baseBranch`, `baseRef`, and selection reason.

Remote matching rule:

- Normalize SCP-style remotes such as `git@bitbucket.org:workspace/repo.git`.
- Normalize HTTPS remotes such as `https://bitbucket.org/workspace/repo.git`.
- Strip trailing `.git`.
- Case-fold host and owner/workspace/repo.
- Match host plus repo path.

Acceptance:

- Missing local checkout clones only the selected repo.
- Existing non-git path fails before agent start with a clear error.
- Wrong remote fails before agent start with expected and actual remote details.

### Slice 5: Config-Driven Branch Policy

Avoid Shift4-specific string-prefix logic in generic core code. Add config-driven branch preferences to project or repository config.

Suggested shape:

```ts
branchStrategy: {
  preferredBranches: [
    { repoNamePattern: "^nz-", branches: ["develop", "poc"] },
    { repoNamePattern: ".*", branches: ["poc"] }
  ],
  fallbackBranches: ["main", "master"],
  useRemoteHeadFallback: true
}
```

Resolution order:

1. Matching preferred branches from config.
2. Repo configured `defaultBranch`, if present.
3. Remote HEAD, if enabled.
4. Fallback branches.
5. Clear failure if no candidate exists.

Reconcile this with existing `resolveWorkflowBase()` so there is one branch resolver, not two competing policies.

Acceptance:

- `nz-*` Shift4 repos prefer `develop` when it exists.
- Non-`nz-*` Shift4 repos prefer `poc` when it exists.
- Generic projects can omit branch strategy and retain normal default/HEAD/main/master behavior.

### Slice 6: Repo-Aware Disposable Worktrees

1. Extend worktree pathing from run-only to repo/run-aware.
2. Add worktree creation metadata events:
   - `runId`
   - `projectId`
   - `workItemId`
   - `repoRef`
   - `repoId`
   - `path`
   - `baseBranch`
   - `baseRef`
3. Update cleanup to accept either legacy `runId` or explicit worktree path records.
4. Keep legacy path support during migration.

Known consumers to audit:

- `core/workspaces/worktree.ts`
- `apps/server/src/domains/issues/diff.ts`
- `apps/server/src/domains/issues/transitions.ts`
- `apps/server/src/domains/workflows/retro-batch.ts`
- `slices/review/review-audit.ts`
- `apps/server/src/shared/dispatch-dev.ts`
- `apps/server/src/shared/dispatch-discover.ts`
- `slices/investigate/workflow.ts`
- `slices/spec-author/workflow.ts`
- `slices/feature-grounding/workflow.ts`
- `slices/fix-issue/workflow.ts`
- `slices/parallel-implement/workflow.ts`

Acceptance:

- Two repos in one run get two distinct worktree paths.
- Existing single-repo flows still expose diff/review/retro worktree access.
- No workflow writes into `~/.factory/repos`.

### Slice 7: Apply Checkout Contract To Code Workflows

All code-reading or code-writing workflows must resolve repo affinity and checkout readiness before starting agents.

Initial target workflows:

- investigation
- spec-author
- feature-grounding
- fix-issue
- parallel-implement
- QA/review diff readers

Rules:

- If no primary repo exists, stop with repo-selection requirement.
- If one primary exists, ensure checkout and create disposable worktree.
- If multiple primary repos exist, stop with ambiguity requirement.
- No non-Goose-Hub workflow may fall back to `REPO_ROOT`.

Acceptance:

- Investigation for a Shift4 item with primary repo uses the Shift4 repo worktree.
- Investigation for a Shift4 item with no primary repo fails clearly and does not inspect Goose Hub.
- Fix/development workflows always work from disposable worktrees sourced from `~/.factory/repos`.

### Slice 8: Terminal Cleanup

Add generic terminal cleanup for disposable worktrees when a story reaches `factory:done` or `factory:archived`.

Rules:

- Replaying events should find all `worktree-created` records for the work item.
- Cleanup removes disposable worktrees only.
- Cleanup never removes canonical clones under `~/.factory/repos`.
- Cleanup is idempotent.
- Cleanup failures emit warning events and do not block terminal state.

Keep existing merge cleanup behavior, but make terminal cleanup a safety net for:

- archived items
- failed cleanup after merge
- multi-repo worktrees
- legacy flows that did not clean immediately

Acceptance:

- Marking a story done cleans all disposable worktrees for that work item.
- Archiving a story cleans all disposable worktrees for that work item.
- Canonical clones remain intact.
- Missing already-cleaned worktrees are ignored.

### Slice 9: Future Issue-Capture Repo Selection

Later, issue creation/capture in multi-repo projects should let users select applicable repos.

- One selected repo: create primary link.
- Multiple selected repos: user can choose primary, or leave primary unset.
- Selected non-primary repos become related.

This is not required for the first checkout-readiness slice.

## Regression Test List

- Local issue creation in a multi-repo local-db project creates no repo link by fallback.
- DTO/header for an unassigned local issue does not show the first configured repo.
- Lone `related` repo link does not satisfy checkout.
- Multiple related links with no primary produce repo-selection requirement.
- High-confidence repo-match creates primary link with `source: 'repo-match'`.
- Low-confidence repo-match creates no primary link.
- Missing local clone triggers clone of selected repo only.
- Wrong remote fails with normalized expected/actual details.
- Branch strategy prefers `develop` for `nz-*` repos and `poc` otherwise.
- Two repos in the same run produce two unique disposable worktree paths.
- Terminal done/archive cleanup removes all disposable worktrees and keeps canonical clones.
- Investigation/fix for unassigned local-db item cannot fall back to Goose Hub or first configured repo.
