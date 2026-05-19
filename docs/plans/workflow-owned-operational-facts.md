# Workflow-owned operational facts

## Goal

Stop treating model-authored structured output as the source of record for operational facts Factory can observe.

Agents may still return plans, summaries, reasons, confidence, and intent. Workflows should derive facts such as changed files, tests run, evidence artifacts, PR branch, commit SHA, and guard surfaces from git, tool events, test results, and collectors.

## Depends On

- Repo-relative path normalization.
- Factory-tools canonical path responses for at least write/edit/test operations, or equivalent existing audit events.

## Non-goals

- Do not remove agent JSON output entirely.
- Do not expose QA or review to non-holdout implementation reasoning.
- Do not make QA rerun workflow-owned commands just to reconstruct facts.

## Design

Each workflow should have an "observed facts" packet assembled after the agent run and before state transition.

Example:

```ts
{
  changedFiles: ["apps/web/src/components/chrome/Sidebar.tsx"],
  writtenFilesFromTools: ["apps/web/src/components/chrome/Sidebar.tsx"],
  testsRun: [
    {
      command: "pnpm test --reporter=json",
      paths: ["apps/web/src/components/chrome/slice.test.ts"],
      status: "passed"
    }
  ],
  evidenceSpecs: ["apps/web/e2e/issue-868.spec.ts"],
  commitSha: "..."
}
```

Model output should be reconciled against this packet, not trusted blindly.

## Slices

### [x] Slice 1 - Derive changed files from git diff

Before committing or opening a PR, derive changed files from `git diff --name-only` and `git status --porcelain` in the worktree.

Acceptance criteria:

- `agent.implement-complete` can include observed changed-file count and paths.
- Wrong-surface guard can compare observed changed files against investigation key files.
- PR body generation prefers observed changed files over model-declared `filesWritten`.

Completed:

- Added `core/workspaces/observed-changes.ts` to build an observed changed-file packet from `git diff --name-only`, `git diff --cached --name-only`, and `git status --porcelain --untracked-files=all`.
- Normalized observed paths through the shared repo-relative path normalizer and deduped paths across diff/status sources.
- The implement wrong-surface guard now uses observed changed files when git reports them, falling back to model-declared touched paths only when no observed paths are available.
- `agent.implement-complete` now includes `observedChangedFiles: { count, paths }`.
- PR body generation prefers observed changed files over model-declared `filesWritten` when observed git changes exist.

Notes:

- Non-git test seams or unavailable worktrees return an empty `gitAvailable: false` packet instead of failing the workflow.
- This slice does not reconcile model-declared files against observed files yet; mismatches remain Slice 2.

### [x] Slice 2 - Reconcile model-declared files with observed files

Compare `filesWritten` and `testsWritten` against observed write/edit events and git diff.

Acceptance criteria:

- Missing model-declared files do not hide observed changes.
- Extra model-declared files are recorded as mismatches.
- Mismatches emit a compact event such as `agent.output-fact-mismatch`.
- Non-fatal mismatches do not fail the run when observed facts satisfy the workflow gate.

Completed:

- Added an implement-surface reconciliation step after normalized implement output parsing.
- Compared model-declared `filesWritten` and `testsWritten` paths against observed git changed files and canonical write/edit tool audit paths.
- Emitted compact `agent.output-fact-mismatch` events with observed changed files, observed write files, model-declared files, and `observedNotDeclared` / `declaredNotObserved` mismatch groups.
- Kept mismatches non-fatal: the wrong-surface guard and PR body continue to use observed git facts where available.
- Added the new event kind to the event stream and timeline labels so the compact mismatch event is persisted and visible.

Notes:

- Tool-audit reconciliation only uses write/edit-style tool calls that already carry canonical path metadata.
- This slice does not derive canonical targeted test execution; `testsRun.paths` remains Slice 3.

### [ ] Slice 3 - Derive targeted tests from tool/test audit

Use factory-tools test output or existing test audit events to populate canonical `devTestsRun`.

Acceptance criteria:

- QA receives canonical test paths from observed test execution.
- Model `testsRun.paths` becomes advisory or a fallback.
- Outside-targeted failure bucketing uses observed paths.

### [ ] Slice 4 - Evidence facts come from collector output

Treat evidence artifacts, screenshots, GIFs, and comment URLs as collector/publisher facts, not model facts.

Acceptance criteria:

- Evidence-post result reflects collector classification and publisher output.
- Screenshot paths are discovered and normalized by workflow code.
- Missing `commentUrl` is reported as publish failure, not guessed as Playwright failure.

## Verification

- Unit tests for observed changed-file packet construction.
- Workflow test where model output omits a changed file but git diff sees it.
- QA test where model reports package-relative test path but observed test path is canonical.
- Evidence test where package-local evidence artifacts are discovered recursively.

Latest verification:

- Slice 1: `pnpm vitest run core/workspaces/observed-changes.test.ts slices/fix-issue/slice.test.ts`
- Slice 1: `pnpm lint`
- Guard: `pnpm typecheck`
- Slice 2: `pnpm vitest run slices/fix-issue/slice.test.ts core/workspaces/observed-changes.test.ts core/tool-layer/tool-call-audit.test.ts`
- Slice 2: `pnpm lint`

Next unchecked slice: Slice 3 - Derive targeted tests from tool/test audit.
