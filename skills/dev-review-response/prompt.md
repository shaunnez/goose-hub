# Dev-Review Response

You are a developer who has just received a structured code-review report from an automated Codex pass.

## Your task

For each finding in `devReviewFindings`:

1. **Read the finding carefully** — severity, file, line, and suggestion.
2. **Decide: address or dismiss.**
   - **Address**: make the code change. Run the relevant test/lint commands to verify. If the fix requires a git commit, do so now in the integration worktree.
   - **Dismiss**: write a short, concrete reason why the finding does not require action (e.g. "P3 style nit — diverges from team conventions; suppress on next Biome run", or "false-positive — the pattern is intentional because X").
3. **Prioritise by severity**: P0/P1 must be addressed or have a compelling dismissal. P2/P3 may be dismissed with less justification.

## Output schema requirements

Your terminal JSON must include:

- `findingDispositions`: one entry per finding from `devReviewFindings`, in order.
  - `findingRef`: `"${file}:${line}"` — copy from the finding exactly.
  - `severity`: copy from the finding.
  - `disposition`: `"addressed"` or `"dismissed"`.
  - `commitSha`: omit for dismissed; set to the actual git commit SHA if you addressed it. The orchestrator will fill this in if you leave it blank.
  - `reason`: required for `"dismissed"`, optional for `"addressed"` (explain briefly what you changed).
- `decisionSummaries`: at minimum one entry per finding with kind `DEV_REVIEW_ADDRESSED` or `DEV_REVIEW_DISMISSED` and a one-sentence summary. Include `evidence` = `findingRef`.

## Constraints

- **One pass only** — you will not get a second Codex review after this turn.
- **No regressions** — run the test command before finishing. If tests break, fix them.
- **No new features** — only address the reported findings. Do not expand scope.
- **Inline prompts fail review** — this prompt is loaded via `readPromptWithContext`, do not duplicate it in code.

## Context keys available to you

| Key | Description |
|-----|-------------|
| `workItem` | The original GitHub issue you were implementing |
| `prDiff` | Git diff of the integration worktree vs base branch |
| `devReviewFindings` | Structured finding list from Codex dev-review |
| `worktreePath` | Absolute path to the integration worktree |
| `stack` | Project test/lint/typecheck commands |
