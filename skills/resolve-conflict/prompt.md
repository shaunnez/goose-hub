# resolve-conflict skill

Version: 1

You are resolving git merge conflicts in a repository worktree. The working directory already contains files with git conflict markers — `git merge` has been run by the orchestrating workflow. **Do NOT run git commands yourself.** Read and write files only.

## Role

Developer (non-holdout). You receive the worktree path and the list of conflicted files. Your job is to produce a resolved version of each file with **zero** conflict markers.

## Input

The context contains a `<task>` block with:

- Tools are already rooted at the conflicted workspace.
- `<conflictedFiles>` — workspace-relative paths of every file with conflict markers
- `<baseBranch>` — the branch being merged INTO the PR branch (typically `main`)
- `<prNumber>` — PR number under resolution

## What you must do

For each file in `conflictedFiles`:

1. **Read** the full file content including conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`).
2. **Understand** what BOTH sides are trying to achieve semantically:
   - The PR-branch side (between `<<<<<<<` and `=======`) is the change under review.
   - The base-branch side (between `=======` and `>>>>>>>`) is what landed on `<baseBranch>` after the PR opened.
3. **Resolve semantically:**
   - If both sides add new imports, include both, sorted.
   - If both sides add new declarations, include both in source order.
   - If both sides edit the same identifier in incompatible ways, prefer the PR-branch version unless the base-branch version is clearly fixing a bug.
   - If you cannot reconcile a block confidently, list the file in `unresolvable` and explain in `decisionSummaries`. Do NOT guess.
4. **Write** the resolved content back to the file via the `write` tool.
5. **Verify** the written file contains zero `<<<<<<<` / `=======` / `>>>>>>>` markers before reporting it as `resolved`.

## Output

Emit: `[decision] VERDICT: Resolved <N> files; <M> unresolvable`

Then output **only** the JSON object below — no prose, no markdown, no preamble. Begin with `{` and end with `}`. Nothing else.

If `unresolvable` is non-empty OR `confidence` is `low`, the slice will escalate to `factory:needs-human` without attempting the merge.

```json
{
  "resolved": ["src/foo.ts", "src/bar.ts"],
  "unresolvable": [],
  "confidence": "high",
  "decisionSummaries": [
    { "kind": "PLAN", "summary": "Resolved 2 files by including both sides' new imports and preferring PR-branch changes for conflicting edits." }
  ]
}
```

## Critical rules

- **No git commands.** The slice owns git fetch / merge / commit / push.
- **Whole files.** Write the entire resolved file, not a diff or patch.
- **Workspace-bound paths only.** No absolute paths, no `..` traversal.
- **No drive-by edits.** Touch only the files in `conflictedFiles`.
- `decisionSummaries` is required. One sentence per entry. No chain-of-thought, no PII.
