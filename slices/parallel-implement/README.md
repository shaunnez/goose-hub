# parallel-implement slice

**M19.03 — Parallel WP builder dispatch (ADR 0031)**

Orchestrates concurrent Work Package builders from an Engineering Spec (produced by
`skills/spec-author`). Each WP runs in an isolated scratch worktree; the orchestrator owns
all git operations (stage, commit, push). Failed WPs are tracked in `wp_iterations` and
retried in subsequent iterations.

## Workflow sequence

```
factory:dev-ready
  ↓ create integration worktree (factory/<runId>)
  ↓ create per-WP scratch worktrees + write wp-file-guard sandbox
  ↓ for each iteration (≤ maxRetries + 1):
      ↓ for each execution batch (ordered by dependsOn):
          ↓ dispatch WPs concurrently (capped at maxParallelAgents)
          ↓ on WP success: copy files → integration worktree → commit
          ↓ on WP failure: revertWpChanges in scratch worktree
      ↓ record wp_iterations (ok / failed)
      ↓ if all WPs ok → break
  ↓ openPR on integration worktree
factory:needs-qa
```

If retries exhausted: escalate to `factory:needs-human`.

## Key files

| File | Purpose |
|------|---------|
| `workflow.ts` | Main orchestrator |
| `slice.test.ts` | Rollback test + concurrency test + wp-file-guard integration |

## Dependencies

- `core/workspaces/orchestrator-git.ts` — `createWpScratchWorktree`, `orchestratorCommitWp`, `revertWpChanges`, `cleanupAllWpWorktrees`
- `core/workspaces/worktree.ts` — `createWorktree` (integration worktree)
- `core/tool-layer/sandbox.ts` — `writeWpBuilderSandbox` (file-guard + git denylist)
- `core/db/schema.ts` — `wpIterations` table
- `skills/implement-wp/` — WP builder skill
- `hooks/wp-file-guard.sh` — PreToolUse file-ownership guard

## Rollback semantics (ADR 0031 §4)

WP3 fails after WP1+WP2 committed:
- WP3 scratch worktree reverted via `revertWpChanges()`
- WP1+WP2 commits remain on integration worktree (untouched)
- `wp_iterations` records WP3 as `failed` for this iteration
- Next iteration retries only WP3 (carry-forward: WP1+WP2 already `ok`)

## Concurrency cap

`maxParallelAgents` from `project.config.ts` (separate from per-issue lock and scout cap).
Default: 3. Applies across all WPs in a batch; batches themselves run sequentially.

## Tested behaviours

- ✓ WP3 fails after WP1+WP2 committed: rollback correct, no orphans
- ✓ 3 builders on disjoint files: all 3 commits land, PR opened
- ✓ `wp-file-guard.sh`: denies cross-WP write, allows in-owned write, skips non-write tools
