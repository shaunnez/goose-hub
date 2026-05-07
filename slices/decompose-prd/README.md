# decompose-prd slice (M13.06)

## What this slice does

Implements the `runDecomposePrdWorkflow` in `core/workflows/decompose-prd.ts`. The workflow:

1. Pre-condition: the parent work item must be in `factory:prd-review`. Transitions it to `factory:decomposing`.
2. Runs the `decompose-issues` skill via the injected `AgentRuntime` to produce a list of `DecomposedIssue` objects from the PRD output.
3. Validates the output against `DecomposeOutputSchema` (Zod). On failure: `forceState` to `factory:needs-human`.
4. Enforces a duplicate-title guard: if any two child issues share the same title (case-insensitive), posts a comment explaining the problem and transitions to `factory:needs-human` without creating any children.
5. Creates child issues sequentially via `stateSource.createIssue`, resolving cross-sibling `Depends on` references as it goes.
6. Sets milestone, priority, schedule, and type labels on each child via `stateSource.setMilestone` and `stateSource.setLabelInGroup`.
7. Posts a comment on the parent listing all created child issues (`## Child issues`).
8. Transitions parent from `factory:decomposing` → `factory:issues-created`.
9. Emits `agent.decision-summary` events and a `decompose.completed` event.
10. Wraps the entire skill run in a try/catch: unexpected errors transition to `factory:needs-human` and re-throw.

## Cross-sibling dependency resolution algorithm

The `decompose-issues` skill uses 0-based **batch-local indices** (not real GitHub issue numbers) to express ordering dependencies between child issues. These appear in issue bodies as:

- `(sibling index N)` — e.g. `Depends on (sibling index 0): must complete first`
- `#sibling:N` — shorthand form

Because child issues are created sequentially (index 0 first, then 1, 2, …), when creating issue at index `i`:

1. A `Map<number, number>` (`siblingNumbers`) maps every already-created index to its real GitHub issue number.
2. The body of issue `i` is passed through `resolveSiblingRefs(body, siblingNumbers)` before calling `createIssue`.
3. Both placeholder patterns are replaced with `#<real-number>`.
4. Forward references (index ≥ own index) are blocked by `DecomposeOutputSchema`'s `superRefine` validator, so they never reach this stage.

The resolver is a pure exported function (`resolveSiblingRefs`) with its own unit tests.

## Surfaces touched

- `core/workflows/decompose-prd.ts` — workflow implementation
- `slices/decompose-prd/slice.test.ts` — integration tests
- `slices/decompose-prd/README.md` — this file

## Limitations

### Labels: `factory:accepted` and `exec:serial` cannot be set via `setLabelInGroup`

`StateSource.setLabelInGroup` only supports three label groups: `priority`, `schedule`, and `type`. The `factory:accepted` and `exec:serial` labels that the `decompose-issues` skill includes by default are not in any supported group.

The GitHub `createIssue` implementation (`GitHubLabelsSource`) also does not accept arbitrary extra labels — it hard-codes `factory:triaging`, `type:*`, `priority:*`, `schedule:later`, `mode:supervised`, `exec:serial` at creation time, and there is no `addLabels` method on `StateSource`.

**Consequence**: Child issues created by this workflow start in `factory:triaging` state (not `factory:accepted`), and the triage workflow must process them normally. This is documented here and does not cause test failures because the in-memory source behaves the same way.

**Resolution path**: A future PR could add an `addLabels(itemId: string, labels: string[]): Promise<void>` method to `StateSource`, or extend `createIssue` to accept arbitrary labels.

### Budget registration

The `decompose-issues` skill is not yet registered in `SKILL_BUDGETS` (`core/agent-runtime/budgets.ts`). The workflow catches the thrown `Error` from `resolveBudgets` and falls back to `{ maxTurns: 30, maxBudgetUsd: 0.5, timeoutMs: 300_000, modelOverride: 'sonnet' }`.

**TODO**: Add a `'decompose-issues'` entry to `SKILL_BUDGETS` in a follow-up PR.

### No body-update method on StateSource

`StateSource` has no `updateBody` method. The child-issue list is posted as a comment on the parent (`## Child issues\n- #N — title\n...`) rather than appended to the parent's body.
