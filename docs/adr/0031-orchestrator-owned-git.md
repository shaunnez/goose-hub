# ADR 0031 — Orchestrator-Owned Git Operations

**Date:** 2026-05-07
**Status:** Accepted
**Author:** M19.03 implementing session

---

## Context

Steve's parallel-builder pattern (lifecycle.md:360-364, hardening.md:168-175) establishes that
builders work in disjoint file sets and the orchestrator owns all git operations. Factory's
existing `implement` skill (M7, slices/fix-issue) currently commits inside the worktree after
writing files, then `openPR` pushes the committed branch. This works for a single builder but
breaks down with parallel WP builders because:

1. Multiple builders committing to the same worktree create merge conflicts.
2. The per-WP audit trail (commit attribution) is lost when commits are rolled up together.
3. Per-WP rollback requires per-WP commit granularity — impossible if builders commit together.

The M19.02 Engineering Spec (skills/spec-author) decomposes issues into Work Packages (WPs),
each with a `filesOwned` list guaranteeing disjoint file ownership across the parallel set.
M19.03 introduces concurrent dispatch of per-WP builders.

---

## Decision

### 1. Builder no-commit rule

Builders (`implement` and `implement-wp`) never run `git commit`, `git push`, `git add`,
or any git mutation. Enforcement is two-layer:

1. **Sandbox denylist**: `writeWpBuilderSandbox()` adds `Bash(git *)` to the permissions
   deny list for WP builders. This is a hard block at the tool layer — the runtime rejects
   the tool call before it reaches the subprocess.
2. **Prompt instruction**: Both `implement` and `implement-wp` prompts say "The orchestrator
   commits on your behalf." The implement skill's Step 7 (Commit) is replaced with an
   explicit no-commit instruction pointing to this ADR.

### 2. Per-WP scratch worktree mechanics

Each WP builder runs in a dedicated scratch worktree at:

```
~/.factory/workspaces/<runId>:wp:<wpId>/
```

Created by `createWpScratchWorktree(repo, runId, wpId)` in
`core/workspaces/orchestrator-git.ts`. Uses `git worktree add --detach` to avoid branch
conflicts when multiple WPs run concurrently in the same repo.

The WP builder receives `workspaceDir = scratchWorktreePath`. Files in `filesOwned` are
written to the scratch worktree. Cross-ownership writes are denied by the `wp-file-guard.sh`
PreToolUse hook (reads `FACTORY_WP_FILESOWNED` env var set by the orchestrator at spawn time).

### 3. Orchestrator merge of WP commits into issue branch

After each WP builder completes successfully, the orchestrator:

1. Runs `git add <filesOwned[0]> <filesOwned[1]> …` in the scratch worktree.
2. Runs `git commit -m "M<N>:WP<id> <description>\n\nCo-Authored-By: <builderPersona>"`.
3. Records the commit SHA.
4. After all WPs in a batch complete, cherry-picks WP commits in dependency order onto the
   issue branch (`factory/<runId>`).
5. Calls `openPR` on the fully assembled issue branch.

WP commits are one-commit-per-WP, preserving the audit trail:

```
factory/<runId>
  commit: M19:WP1 Add DB schema + migrations
  commit: M19:WP2 Add API routes
  commit: M19:WP3 Add UI components
```

### 4. Rollback semantics on WP failure

If WP N fails (builder error, schema validation failure, or timeout):

- The orchestrator reverts WP N's scratch worktree: `git checkout -- <filesOwned>`.
- WP N's status in `wp_iterations` is set to `failed`.
- WP N is NOT committed to the issue branch.
- WPs 1..N-1 that already committed stay committed and are NOT rolled back.

**Example: WP3 fails after WP1+WP2 committed:**
- WP1 and WP2 commits are already on the issue branch — left untouched.
- WP3 scratch worktree: `git checkout -- <filesOwned>` reverts written files.
- `wp_iterations` records `(runId, 'WP3', 1, 'failed')`.
- On iteration 2, the orchestrator re-runs only WP3 (WP1+WP2 already `ok`).
- No orphaned commits: WP3 never committed, so no revert is needed on the branch.
- No orphaned worktrees: `cleanupAllWpWorktrees()` runs on final exit (success or exhausted).

### 5. Carry-forward failure semantics

`wp_iterations(run_id, wp_id, iteration, status)` persists each WP's attempt outcome in
local SQLite (via `core/db/schema.ts`). Rules:

- A WP whose last recorded status is `failed` stays in the retry set for iteration N+1.
- A WP is only promoted to `ok` when its builder completes AND the orchestrator commits
  its files without error.
- A WP that has never appeared in `wp_iterations` for this `run_id` is treated as
  un-attempted and scheduled for the current iteration.

### 6. File-ownership runtime guard

`hooks/wp-file-guard.sh` (PreToolUse, `Edit|Write` matcher):

- Active only when `FACTORY_WP_FILESOWNED` is non-empty (i.e., inside a WP builder session).
- Denies writes to files outside the builder's `filesOwned` list.
- Exits 2 with stderr: `wp-file-guard: DENIED — file '<path>' outside WP '<id>' filesOwned`.
- The orchestrator reports blocked attempts as `tool.violation` events.

### 7. Fix-issue workflow alignment

The single-builder `slices/fix-issue/` workflow aligns to this pattern:

- The implement skill no longer commits (Step 7 removed from prompt; git denylist added).
- The orchestrator calls `orchestratorCommitAll(worktreePath, commitMsg)` in `afterImplement()`
  before `openPR`.
- This establishes a uniform "builder writes, orchestrator commits" contract for all paths.

---

## Consequences

**Positive:**
- Parallel WP builders run concurrently without git conflicts (each in a disjoint scratch worktree).
- Per-WP audit trail preserved in commit history.
- Rollback is deterministic: failed WP's scratch worktree is cleanly reverted; no branch pollution.
- File-ownership enforcement prevents cross-WP contamination at the tool layer.
- Single-builder (fix-issue) path is now consistent with multi-builder (parallel-implement).

**Negative:**
- `core/workspaces/orchestrator-git.ts` and `hooks/wp-file-guard.sh` are new surfaces to maintain.
- Fix-issue workflow gains one git subprocess call (orchestratorCommitAll) per run.
- Per-WP scratch worktrees consume temporary disk space proportional to the repo size per WP.

**Neutral:**
- Implement prompt change (remove commit step) is backwards-compatible: existing test stubs
  that mock `runWithEscalation` are unaffected.

---

## Rejected alternatives

**A. Builders commit to isolated branches; orchestrator cherry-picks.**
Rejected: cherry-pick ordering complexity outweighs benefit; per-WP scratch worktrees with
`git add <filesOwned>` are simpler and audit-traceable.

**B. Orchestrator locks the shared worktree with a mutex; builders commit serially.**
Rejected: serializes the concurrency benefit away. Scratch worktrees give real isolation at low cost.

**C. Keep builders committing; orchestrator squashes at PR-open time.**
Rejected: requires history rewriting on every PR open, breaking `--force-with-lease` safety.

---

## References

- Steve lifecycle.md: parallel builder pattern (lines 360-364, 630-643)
- Steve hardening.md: file-ownership model (lines 168-175)
- FACTORY_RULES rule 12: governance files not modifiable by Factory PRs
- FACTORY_RULES rule 37 (to be applied by human post-merge):
  > Builders work in workspaces controlled by the orchestrator. Builders never commit on the
  > project branch; per-WP commits land via orchestrator-controlled merge into the issue branch.
  > Builders never use `EnterWorktree`, never switch branches, never run `git commit` / `git push`.
- ADR 0030: sub-agent dispatch pattern (scouts)
- Issue #560: M19.03 implementation
