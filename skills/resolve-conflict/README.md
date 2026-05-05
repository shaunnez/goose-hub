# skills/resolve-conflict

Resolves git merge conflicts in a worktree. The skill receives the worktree path and the list of conflicted files; the orchestrating slice (`slices/resolve-conflict/`) owns git fetch, merge, commit, and push. The skill reads each conflicted file, writes a resolved version with no conflict markers, and reports per-file outcomes.

## When this skill runs

- `slices/resolve-conflict/` workflow, after `git merge origin/<baseBranch>` produces conflicts and the slice has enumerated `git diff --name-only --diff-filter=U`.

## Inputs

`ResolveConflictContextSchema`:

| Field | Type | Description |
|---|---|---|
| `worktreePath` | `string` | Absolute path to the worktree where conflict markers are present |
| `conflictedFiles` | `string[]` | Workspace-relative paths of conflicted files |
| `baseBranch` | `string` | Branch being merged INTO the PR branch (typically `main`) |
| `prNumber` | `number` | PR number under resolution (context only) |

## Outputs

`ResolveConflictSchema`:

| Field | Type | Description |
|---|---|---|
| `resolved` | `string[]` | Workspace-relative paths the agent successfully resolved |
| `unresolvable` | `string[]` | Workspace-relative paths the agent could not resolve confidently |
| `confidence` | `'low' \| 'medium' \| 'high'` | Self-reported confidence in the overall resolution |
| `decisionSummaries` | `DecisionSummary[]` | Required, ≥ 1 entry. One per file or per resolution strategy |

## Tool allowlist

`dev-tools` bundle — `read`, `search`, `work-item-read`, `write`, `bash`, `test`. All workspace-bound, bash-denylist enforced. The skill writes resolved files directly via the `write` tool; the slice runs `git add -A && git commit` afterwards.

## Model pin

`sonnet`. Routine resolution tier (Opus reserved for advisor / investigator per FACTORY_RULES rule 22).

## Critical rules

- Never simply pick one side of a conflict — combine both intents semantically.
- Verify the written file contains zero `<<<<<<<` / `=======` / `>>>>>>>` markers before reporting it as `resolved`.
- If you cannot produce a confident resolution, list the file in `unresolvable` and explain in `decisionSummaries`. The slice will escalate to `factory:needs-human`.
- `decisionSummaries` is required. One sentence per entry. No chain-of-thought, no PII.

## Context allowlist

| Key | Included |
|---|---|
| `worktreePath` | yes |
| `conflictedFiles` | yes |
| `baseBranch` | yes |
| `prNumber` | yes |
