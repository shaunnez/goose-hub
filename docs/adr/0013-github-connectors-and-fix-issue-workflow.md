# ADR 0013 — GitHub connectors and fix-issue workflow shape (M7)

Status: accepted
Date: 2026-05-03
Closes part of: M7 (#183, #184, #186, #234)

## Context

The M7 milestone introduced two GitHub-side connectors and the orchestration glue that composes them into the supervised dev workflow:

- **`core/connectors/github/open-pr.ts` (#184)** — pushes a worktree HEAD to a feature branch and opens a PR via the REST API.
- **`core/connectors/github/merge-pr.ts` (#186)** — merges a PR via the REST API for the human-approval gate.
- **`slices/fix-issue/workflow.ts` (#183 + #234)** — the full M7 supervised dev state machine: `factory:dev-ready` → worktree → optional advisor → implement → openPR → evidence-post (best-effort) → `factory:approved`.

This ADR records the shaping decisions so M8 (`run-qa`, `run-review`, fix-issue workflow update for QA/Review insertion per #244) and later milestones (M9 retro, M11 multi-issue scheduling) can compose against the same shape without re-litigating it.

## Decisions

### 1. Connectors are stateless functions, not classes

Both `openPR` and `mergePR` are exported functions taking an input record and returning a result record. Reasons:

- No per-instance state to manage (the GitHub token is per-call).
- Mocking in tests is trivial — pass `fetchImpl` (and for openPR, `gitExec`) overrides; no module-level mocks needed.
- Each connector is a standalone module; composition happens at the workflow layer.

The existing `GitHubLabelsSource` class predates this convention and stays as-is — it carries auth state and is consumed via the `StateSource` interface. New per-call connectors follow the function pattern.

### 2. PR body is contract-validated; PR title is not

`validatePrBody(body, issueNumber)` enforces:

- `Closes #N` on its own line (anchored regex `/^Closes #(\d+)$/m`).
- The N matches the supplied `issueNumber`.

PR title is constrained only to length (1–70 chars). The CLAUDE.md `M<milestone>.<task>: <description>` format is enforced by the **caller** (the workflow), not the connector — the connector doesn't know the milestone name.

The body validation is critical: a missing `Closes #N` means GitHub doesn't auto-close the issue on merge, which silently breaks the milestone-completion path. The body is also the boundary that QA/Review holdouts see — implementation reasoning must NOT appear there (FACTORY_RULES rule 1). The connector cannot enforce "no reasoning" mechanically; the workflow's `buildPrBody` constructs a thin summary (files written, tests written, `Closes #N`) and the chore-shipping integration test asserts no reasoning leaks.

### 3. `--force-with-lease` on push, not `--force`

`openPR` pushes the worktree HEAD to a feature branch via `git push --force-with-lease origin HEAD:refs/heads/<branchName>`. Reasons:

- Workflow retry replays the same logical change to the same branch (`factory/<runId>`). Forcing without lease would clobber concurrent upstream commits.
- `--force-with-lease` aborts if the remote ref has moved unexpectedly — refusing to clobber surprises.
- Plain `git push` would fail on retry once the branch exists.

The branch name is `factory/<runId>` (one branch per workflow run). UUID-based names avoid collisions; a future M11+ scheduler may want a more human-readable scheme but that's a follow-up.

### 4. Merge method default is `merge`, not `squash`

`mergePR` defaults `mergeMethod: 'merge'`. Squash and rebase are exposed for future use. The `merge` default matches:

- Manual PRs in this repo's history (PR #237, #238, #250 are all merge commits).
- The default `gh pr merge` setting.
- A merge commit preserves the per-issue commit history so `git log core/agent-runtime/models.ts` (CONTEXT.md "Pin, not float") works for forensics.

### 5. Workflow uses dependency injection for testability — not for production swap-out

`runFixIssueWorkflow(workItem, source, projectId, repo, deps)` accepts a `deps` parameter:

```ts
{
  runtime?: AgentRuntime;
  openPRImpl?: typeof openPR;
  adviseOnPlanImpl?: typeof adviseOnPlan;
  createWorktreeImpl?: typeof createWorktree;
  cleanupWorktreeImpl?: typeof cleanupWorktree;
}
```

All defaults route to the real implementations. The DI surface exists exclusively so the slice test can exercise the full state machine without spawning agents or calling GitHub. Production callers always pass `{}`.

This is deliberately NOT a generic plugin point. If a future workflow needs to swap (say) the OpenPR implementation for a non-GitHub Git host, the right move is a new connector module + a new workflow, not a runtime-pluggable workflow. Workflows are read-once-per-run; predictability beats flexibility.

### 6. evidence-post wiring is best-effort, never blocking

`runEvidencePost` runs after PR open, before the `factory:approved` transition. Three outcomes are emitted as events:

- **`evidence.posted`** — success; payload includes `commentUrl`.
- **`evidence.post-failed`** — caught error; workflow continues to `factory:approved`.
- **`evidence.no-spec-declared`** — `evidenceSpecPath` was null; workflow logs and skips.

A failing evidence post does NOT roll back the PR or fail the workflow. Rationale: evidence is observability for the human reviewer, not a correctness requirement. Blocking the gate on a flaky video capture would be a worse failure mode than missing screenshots. The `evidence.post-failed` event surfaces the issue for retro / manual investigation.

### 7. Approval gate is UI-only

The `/approve` and `/reject` routes (`apps/server/src/domains/issues/router.ts`) are NOT in `apps/server/src/shared/dispatch.ts` and NOT triggered by webhook label flips. Only the UI invokes them. Reasons:

- Approval is a categorical human decision. Letting an agent or webhook trigger it would defeat the gate's purpose.
- The label change `factory:approved → factory:done` is the side effect of approval, NOT the trigger. A webhook on `factory:done` wouldn't make sense.
- Single-user local-first tool — no need for multi-actor approval ceremony.

Future M16 autonomous mode will define how `factory:approved → factory:done` happens without UI; until then, the human is the gate.

### 8. No state-source coupling in the connector layer

`openPR` does NOT call `transitionState`. `mergePR` does NOT call `transitionState`. The workflow (`fix-issue.ts`) and the gate service (`approveIssue`) are responsible for state transitions. The connector is a pure REST primitive.

This decoupling matters for testability and for future reuse — if a non-fix-issue workflow wants to open a PR (e.g., M9 improvement-candidate auto-PR), it shouldn't get the M7 state transitions for free.

## Consequences

- New module tree under `core/connectors/github/`. Future Git-host connectors (GitLab, Gitea) get sibling directories.
- M8 `run-qa.ts` will sit between `pr.opened` and `factory:approved`. It consumes the same `pr.opened` event that triggers the M7 path; the workflow update (#244) replaces `factory:approved` with `factory:needs-qa` after PR open.
- The chore-shipping integration test (`slices/fix-issue/chore-shipping.test.ts`) is the regression net for the workflow shape. Subsequent workflows (`run-qa`, `run-review`) should follow the same four-layer test pyramid: workflow integration test + per-skill slice test + connector test + UI test.
- The M8 fix-issue update (#244) only changes one transition target — the rest of the workflow (advisor, implement, openPR, evidence-post) stays intact.

## References

- FACTORY_RULES rules 1 (holdouts never see reasoning), 9 (state labels live on issues), 26 (workflows in TS not YAML)
- CLAUDE.md "PR conventions"
- CONTEXT.md "Gate Mechanics" — UI vs. label-edit equivalence
- `core/connectors/github/open-pr.ts`, `core/connectors/github/merge-pr.ts`
- `slices/fix-issue/workflow.ts`, `slices/fix-issue/README.md`, `slices/fix-issue/chore-shipping.test.ts`
- `apps/server/src/domains/issues/service.ts` (`approveIssue`, `rejectIssue`)
- `apps/web/src/components/detail/components/ApprovalGateSection.tsx`
