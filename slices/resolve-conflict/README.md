# resolve-conflict slice

Triggered when an issue enters `factory:merge-conflict` (set by `approveIssue` after GitHub returns 405 on merge). Replays events to find the open PR, creates a worktree on its branch, runs `git merge origin/<base>`, calls the `resolve-conflict` skill once with the full conflicted-files list, commits, pushes, and re-invokes `mergePR`. On success → `factory:done`. On failure → `factory:needs-human`.

## Workflow

```
factory:merge-conflict
   │   replay events → find pr.opened → branch, baseBranch, prNumber, prUrl
   │
   │   git worktree add <wt> <branch>
   ▼
git fetch origin
git merge origin/<baseBranch>
   │
   ├─ no conflict (race) ──────────▶ skip skill, jump to push
   │
   ├─ conflicts present
   │     │  git diff --name-only --diff-filter=U → conflictedFiles
   │     │  invoke resolve-conflict skill ONCE with the full file list
   │     │  parse output: confidence + resolved + unresolvable + decisionSummaries
   │     │  fail if confidence=low OR unresolvable.length > 0
   │     │  defensive re-scan: any resolved file with markers still present → fail
   │     │  git add -A && git commit -m "chore: resolve merge conflicts with <baseBranch>"
   │     ▼
git push origin HEAD:refs/heads/<branch>
   │
   ▼
mergePR(prNumber)
   │
   ├─ success ─────▶ emit merge.conflict-resolved + pr.merged + gate.approved
   │                 transition merge-conflict → done
   │                 post comment "resolved automatically by agent; PR #<n> merged"
   │
   └─ any failure ─▶ emit merge.conflict-unresolvable
                     transition merge-conflict → needs-human
                     post comment "manual merge required: <prUrl>"
```

The worktree is removed in a `finally` block on every exit.

## Failure modes

All of these route to `factory:needs-human`:

- No `pr.opened` event in history (cannot derive branch / PR number)
- `git push` rejected (e.g. branch protection, force-required)
- `mergePR` throws on the second attempt (e.g. base moved again mid-flight)
- Skill output fails Zod validation
- Skill reports `confidence: 'low'`
- Skill reports any `unresolvable` files
- Defensive marker scan finds residual `<<<<<<<` / `=======` / `>>>>>>>` in a file the skill claimed to resolve

## Dependency injection

`runResolveConflictWorkflow` takes a `deps` object:

| Dep | Default | Use |
|---|---|---|
| `runtime` | `new ClaudeCliRuntime()` | Override for tests |
| `mergePRImpl` | real `mergePR` connector | Stub HTTP in tests |
| `gitExecImpl` | `execFileSync('git', ...)` | Stub git output in tests |

## Reference

- `core/connectors/github/merge-pr.ts` — `mergePR` + `MergeConflictError`
- `skills/resolve-conflict/` — the resolver skill (schema + prompt + config)
- `core/event-stream/store.ts` — event kinds: `merge.conflict-resolved`, `merge.conflict-unresolvable`, `pr.merged`, `gate.approved`
- Source spec: `docs/superpowers/specs/2026-05-05-merge-conflict-resolution-design.md`
