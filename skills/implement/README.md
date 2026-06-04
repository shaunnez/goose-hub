# skills/implement

TDD-first developer skill. Reads the issue, writes a plan, writes failing tests, writes implementation until tests pass, runs lint and typecheck, and returns structured output describing what shipped. The orchestrator opens the PR after this skill returns.

## When this skill runs

- M7 `fix-issue` workflow, after worktree creation and (for `priority:high`/`critical`) the advisor pass
- Per-priority advisor gate: `priority:medium` and `priority:low` skip the advisor; `priority:high` and `priority:critical` are advisor-gated (FACTORY_RULES rule 22)

## Inputs

`ImplementContextSchema`:

| Field | Type | Description |
|---|---|---|
| `workItem.title` | `string` | Issue title |
| `workItem.body` | `string` | Issue body (acceptance criteria) |
| `workItem.number` | `number` | Issue number |
| `workItem.priority` | `'low' \| 'medium' \| 'high' \| 'critical'` | Used to derive PR title and route advisor gating |
| `worktreePath` | `string` | Absolute path to the checked-out worktree to implement in |
| `stack.testCommand` | `string` | e.g. `pnpm test` |
| `stack.lintCommand` | `string` (optional) | e.g. `pnpm lint` |
| `stack.typecheckCommand` | `string` (optional) | e.g. `pnpm typecheck` |
| `advisorFeedback` | `string` (optional) | Present when advisor returned a `revise` verdict re-spawning this run |
| `revisionPass` | `0 \| 1` (optional) | Default `0`. `1` is the post-advisor revision pass |

## Outputs

`ImplementSchema`:

| Field | Type | Description |
|---|---|---|
| `plan` | `string` (non-empty) | The plan the developer wrote and executed |
| `filesWritten` | `FileWritten[]` | Each entry: `{ path, reason }` |
| `testsWritten` | `TestWritten[]` | Each entry: `{ path, cases: number ≥ 0 }`. Empty array allowed for chore PRs |
| `prUrl` | `string` (URL) | Filled in by orchestrator post-spawn; skill returns the workItem URL as placeholder |
| `evidenceSpecPath` | `string \| null` | Repo-root/worktree-root relative Playwright spec for `evidence-post` (#234). `null` is valid only with a `SKIP_GATE`, `TOOL_FAILURE`, or blocker decision summary; evidence-post runs only when this is a concrete path |
| `confidence` | `'low' \| 'medium' \| 'high'` | Self-reported confidence in the change |
| `decisionSummaries` | `DecisionSummary[]` | Required, ≥ 1 entry. Plan / red / green / lint markers, one sentence each |

## Tool allowlist

`dev-tools` bundle (M7.01, #179):
- `read`, `search`, `work-item-read` — sandboxed read
- `write` — workspace-bound writes (no absolute paths, no `..` traversal)
- `bash` — shell-free argv execution with `DEFAULT_BASH_DENYLIST` (sudo, rm -rf /, git push --force, etc.)
- `test` — runs the project's `testCommand`

All four enforce the workspace boundary; lifecycle is governed by FACTORY_RULES rules 29 (no shell), 31 (4 MB stdout cap), 32 (30 s default timeout).

## Model pin

`sonnet`. Routine implementation tier. Opus is reserved for the advisor (`skills/advise-on-plan/`) and the investigator (`skills/investigate/`).

## TDD discipline (RGR loop)

1. **Read** — load test files first; existing tests are the strongest signal of intent.
2. **Plan** — name the files, name the failing tests, name the patterns to mirror. Record in the `plan` output field.
3. **Red** — write the failing tests; confirm they fail.
4. **Green** — write the implementation; confirm all tests pass.
5. **Refactor** — only if needed to make the test pass cleanly. No drive-by refactors.
6. **Lint + typecheck** — run both; fix any failures. Re-run tests to confirm no regression.
7. **Evidence spec** — name `evidenceSpecPath` if a concrete Playwright spec exists. Return `null` only with a `SKIP_GATE`, `TOOL_FAILURE`, or blocker decision summary.
8. **Return** — structured `ImplementSchema` output. Orchestrator opens PR.

## Critical rules

- Single slice, single issue. No scope creep into related issues.
- TDD-first. A test added after the implementation does not count.
- Ordinary frontend product fixes should add nearby unit/component coverage; browser evidence is a separate post-implementation gate.
- Repo-root/worktree-root paths only.
- No shell. The `bash` tool spawns argv directly; no `&&` / `;` / pipes — invoke separate commands.
- `decisionSummaries` is required. One sentence per entry. No chain-of-thought, no secrets, no PII.

## Eval

`eval/eval.json` covers three cases:
1. Chore that adds a helper with tests (`evidenceSpecPath: null`)
2. UI slice that authors a Playwright spec (`evidenceSpecPath` set)
3. Revision pass after an advisor `revise` verdict (`advisorFeedback` honoured)

## Context allowlist

| Key | Included |
|---|---|
| `workItem.title` | yes |
| `workItem.body` | yes |
| `workItem.number` | yes |
| `workItem.priority` | yes |
| `worktreePath` | yes |
| `stack.testCommand` | yes |
| `stack.lintCommand` | yes |
| `stack.typecheckCommand` | yes |
| `advisorFeedback` | yes |
| `revisionPass` | yes |
