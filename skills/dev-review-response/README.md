# dev-review-response

**M19.12** — Developer response to Codex pre-QA findings.

Runs once per implement workflow cycle when `skills/dev-review/` returns `blockers-found` or `inconclusive`. The developer reads the findings, optionally makes code changes in the integration worktree, and produces a structured disposition (`addressed` / `dismissed`) per finding. No second Codex pass is made after this turn.

## Files

| File | Purpose |
|------|---------|
| `prompt.md` | Instructions for the dev responding to findings |
| `schema.ts` | `DevReviewResponseOutputSchema` + `DevReviewResponseContextSchema` |
| `skill.config.ts` | Role `developer`, tool bundle `dev-tools`, `modelPin: 'sonnet'` |
| `slice.test.ts` | Schema validation and context-allowlist tests |

## Context keys

| Key | Required | Notes |
|-----|----------|-------|
| `workItem` | yes | Title, body, number, priority |
| `prDiff` | yes | Git diff vs base branch |
| `devReviewFindings` | yes | Array of `DevReviewFinding` from dev-review output |
| `worktreePath` | yes | Integration worktree path |
| `stack` | no | Test/lint/typecheck commands |

## Holdout safety

`devReviewFindings` is listed in `HOLDOUT_FORBIDDEN_KEYS` in
`core/agent-runtime/context-assembly.ts`. Even if a future caller
accidentally passes findings to a QA or Reviewer spec, the assembly
layer strips them and emits a `tool.violation` event.

## Wiring

Called from `core/agent-runtime/dev-review-advisor.ts` →
`slices/parallel-implement/workflow.ts` (post-build, pre-PR-open step).
