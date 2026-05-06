# fix-feedback

Handles the QA retry loop: when QA fails and `factory:qa-failed` is applied, the orchestrator auto-transitions to `factory:needs-fix` and dispatches this workflow.

## What it does

1. Finds the existing dev worktree from the `pr.opened` event in the event store.
2. Extracts QA findings from the most recent `qa.completed` event.
3. Transitions `factory:needs-fix` → `factory:in-progress`.
4. Re-runs the `implement` skill in the existing worktree with QA findings injected as `advisorFeedback` and `revisionPass: 1`.
5. Pushes the fix to the existing branch (no new PR is opened).
6. Transitions `factory:in-progress` → `factory:needs-qa` to re-trigger QA.

## Key differences from fix-issue

| Concern | fix-issue | fix-feedback |
|---|---|---|
| Worktree | Creates new | Reuses existing (from `pr.opened` event) |
| Branch | Creates new `factory/<runId>` | Pushes to existing branch |
| PR | Opens new PR | No PR — existing PR updated |
| `revisionPass` | 0 | 1 (signals to implement skill this is a correction) |
| `advisorFeedback` | Optional advisor review | QA findings from `qa.completed` |

## Context allowlist

The implement skill receives:
- `workItem.title`, `workItem.body`, `workItem.number`, `workItem.priority`
- `worktreePath`
- `stack.testCommand`, `stack.lintCommand`, `stack.typecheckCommand`
- `advisorFeedback` — formatted QA findings
- `revisionPass` — always `1` for fix-feedback runs

## Escalation

Transitions to `factory:needs-human` if:
- No `pr.opened` event found (worktree cannot be located)
- Implement skill throws
- Implement schema validation fails
