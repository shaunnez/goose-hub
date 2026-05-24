# dogfood

End-to-end harness for proving Factory's bug/feature workflows actually work against Goose Hub itself.

## Why this exists

You can run any individual skill in isolation, but proving a *workflow* end-to-end requires:

1. A controlled bug whose acceptance test is **already in the suite** (so success is objective).
2. A real GitHub issue with a user-language description (so triage/investigate behave realistically).
3. A repeatable mechanism to apply the bug, kick the workflow, observe outcomes, and clean up.

This slice provides (1) and (3). It is the smallest thing that lets you ask "did the bug workflow actually work?" with a yes/no answer.

## Concept: break-and-fix seeds

A **seed** is a controlled mutation that breaks an existing green test. The seed encodes:

- `apply(repoRoot)` — performs the mutation
- `restore(repoRoot)` — reverses it
- `isApplied(repoRoot)` — detects current state
- `truthSignal` — the pre-existing test name that should turn red (and back to green when the bug is fixed)
- `issue` — user-language title + body deliberately *not* mentioning "the test on line X is failing"

The agent's job is to investigate from the user-language issue, fix the bug, and make the truth-signal go green. Success is objective: the named test passes on the PR head.

## CLI

**End-to-end orchestrator (the one-command path):**

```
pnpm dogfood run <seed-id> [--server-url=…] [--repo=…] [--project-slug=…] [--timeout-ms=…]
                           [--no-restore] [--skip-verify-red] [--skip-verify-green]
                           [--delete-remote-branch-on-finish]
```

What it does:

1. Pre-flight: verifies `gh` is installed + authenticated and the operator worktree is clean.
2. Creates `dogfood/<runId>/<seed-id>`, applies the seed there, runs the truth-signal test locally, commits the seed, and pushes the seed branch.
3. Calls `gh issue create` with the seed's user-language title + body + labels (including `factory:triaging`). Records a pending run row plus a durable `dogfood.seed-applied` event carrying `baseBranch`, `baseRef`, `seedCommit`, and `truthSignal`.
4. Opens an SSE connection to your local server and prints a workflow-specific checklist that ticks off as `state.transitioned` events arrive. Stops when the workflow reaches a terminal state or any agent run fails.
5. Records the completion (reached-terminal / stalled / failed:<node>), checks the truth signal against the final PR branch when possible, restores the operator's original branch, and deletes the local dogfood branch.

**Seed mechanics:**

```
pnpm dogfood list                          # List registered seeds
pnpm dogfood status                        # Show which seeds are currently applied
pnpm dogfood apply <seed-id>               # Apply a seed mutation
pnpm dogfood restore <seed-id>             # Revert
pnpm dogfood verify-red <seed-id>          # Run the truth-signal test, expect it to fail
pnpm dogfood issue <seed-id>               # Print the user-language issue title + body for filing
```

**Outcome tracking:**

```
pnpm dogfood file-issue <seed-id>          # Print gh-issue-create cmd + record a pending run row
pnpm dogfood record <run-id> --completion=reached-terminal --truth-pass=true ...
pnpm dogfood runs [--limit=N]              # List recent dogfood runs (default 20)
pnpm dogfood runs:summary                  # Aggregate stats across all recorded runs
```

The outcome row lives in `~/.factory/dogfood/runs.jsonl` (one JSON line per run). Each row carries `seedId`, `workflow`, `startedAt`, `issue` (number + URL), `baseBranch`, `baseRef`, `seedCommit`, `completion`, and the four outcome signals:

- `truthPass` — did the truth-signal test go red → green on the PR head?
- `qaCorrect` — did the QA agent's verdict match `truthPass`? (Measures QA accuracy.)
- `hygieneClean` — workspace pruned, branch deleted, no stray processes?
- `efficiency` — turns, tool calls, repeated-identical tool invocations

Completion is one of: `pending | reached-terminal | stalled | aborted-by-human | failed:<node>[:<reason>]`.

## Running an end-to-end loop (manual)

The harness handles seed mechanics, issue-command generation, and outcome recording. Kicking the workflow itself is still manual — needs a running server with the project's mode set to `supervised`.

1. **Run the orchestrator from a clean checkout:**
   ```bash
   pnpm dogfood run logger-001-drop-meta
   ```

2. **Let the workflow run.** With the local server running and the project on supervised mode, dispatch picks up `factory:triaging` and routes through:
   `triage → investigate → dev-ready → fix-issue → needs-qa → needs-review → approved → merged`

3. **Watch the event stream:**
   ```bash
   curl -N "http://localhost:3001/events?projectId=goose-hub-self&workItemId=github:shaunnez/goose-hub#<n>"
   ```

4. **Once the PR merges**, record any remaining manual outcome signals:
   ```bash
   pnpm dogfood record <run-id> \
     --completion=reached-terminal \
     --qa-correct=true \
     --hygiene-clean=true
   ```

5. **If something stalls or fails**, record where:
   ```bash
   pnpm dogfood record <run-id> --completion=failed:qa:playwright-crashed --truth-pass=false
   ```

6. **See the trend:**
   ```bash
   pnpm dogfood runs:summary
   # Total runs, pass rates, by-workflow + by-seed breakdowns
   ```

## What v1 covers vs. what comes later

**v1 (this slice):**
- Seed type definition
- One seed: `logger-001-drop-meta` (frontend, `apps/web/src/lib/logger.ts`)
- `apply` / `restore` / `verify-red` / `status` / `issue` CLI commands
- `slice.test.ts` exercising the mutation/restore mechanic against a tmpdir

**v2 (planned, after first successful run):**
- Filing the issue programmatically (`gh issue create` wrapper)
- Tailing the event stream during the run and ticking off a state checklist
- Persisting an outcome row per run (`dogfood_run` SQLite table): `completion`, `truth_pass`, `qa_correct`, `hygiene_clean`, `efficiency`, `drift`
- Additional seeds (`backend-001`, etc.)
- Tiers (2)–(5): same harness with feature workflow, multi-agent settings, etc.

## Adding a seed

1. Create `seeds/<area>-<NNN>-<short-name>.seed.ts`.
2. Identify a green test in the suite the seed will break.
3. Encode `apply` / `restore` / `isApplied` so they're idempotent and detect drift.
4. Write a user-language `issue.title` + `issue.body` that does **not** name the failing test or the file. Treat it like a real bug report from a user.
5. Register the seed in `seeds/index.ts`.
6. Extend `slice.test.ts` to cover its apply/restore mechanic against a tmpdir.

## Constraints

- Seeds modify *source files*, not test files. The whole point is that the test stays unchanged and provides ground truth.
- Seeds must be reversible. `restore` must return the file byte-identical to the pre-apply state.
- Seeds must detect drift. If the target file has changed since the seed was authored, `apply` throws — the seed is updated, not the mutation silently misapplied.
- Issue bodies must not leak implementation reasoning. QA and Review are holdouts; their context will only ever include the issue body.
