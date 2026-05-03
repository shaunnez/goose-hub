# core/connectors/github

GitHub-specific connectors for the orchestrator. Lightweight modules — no
classes, no shared client. Each connector takes the auth token and the
target repo as parameters.

## Files

| File | Exports |
|---|---|
| `open-pr.ts` | `openPR`, `OpenPrInput`, `OpenPrResult`, `validatePrBody` |

## `openPR(input)` (#184)

Pushes the current worktree HEAD to a feature branch (`--force-with-lease`)
and opens a PR via the GitHub REST API.

```ts
import { openPR } from '@goose-hub/core/connectors/github/open-pr.js';

const { prNumber, prUrl } = await openPR({
  worktreePath: '/work/wt',
  repo: 'shaunnez/goose-hub',
  issueNumber: 42,
  title: 'M7.05: example chore',
  body: '## Summary\n\nDone\n\nCloses #42\n',
  branchName: 'factory/run-abc',
  token: process.env.GITHUB_TOKEN,
});
```

### Title format

Per CLAUDE.md "PR conventions": `M<milestone>.<task>: <short description>`.
Caller is responsible for the format; this module enforces only the 1–70
char length constraint.

### Body contract

`body` MUST contain `Closes #N` on its own line and the N MUST match
`issueNumber` — `validatePrBody` enforces this. If you forget, the PR
won't auto-close on merge.

`body` MUST NOT contain implementation reasoning. QA and Reviewer
holdouts (M8) read PR bodies; reasoning belongs in
`agent.decision-summary` events, not in PR descriptions. The connector
does not enforce this — it's the workflow's responsibility (and a
review-time check).

### Push semantics

`--force-with-lease` is intentional: on retry, the same workflow run
pushes the same logical change to the same branch. Forcing without
lease would clobber concurrent upstream commits — `--force-with-lease`
refuses that.

### No state-source coupling

This module does NOT call `transitionState` or write a label. The
`fix-issue` workflow (#183) is responsible for the `factory:in-progress`
transition before calling this connector, and for `factory:approved`
after the PR opens successfully.
