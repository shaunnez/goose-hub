# grill-and-prd slice (M13.05)

## What this slice does

Implements `runGrillAndPrdWorkflow` in `core/workflows/grill-and-prd.ts`. The workflow orchestrates the three Discover-Lane skills — `grill-me`, `write-prd`, and (priority-gated) `advise-on-prd` — with a human-in-the-loop gate at the grill step.

It is the most complex Discover-Lane workflow because each call advances exactly one round of the multi-tick interrogation loop. The orchestrator drives the loop across ticks; this workflow only ever runs one round per call.

## Multi-tick state machine

```
factory:accepted (type:feature)
        │
        │  orchestrator labels factory:grilling
        ▼
factory:grilling
        │
        │  runGrillAndPrdWorkflow tick:
        │    if grill-me.readyForPRD === false:
        │       post question as comment
        │       state → factory:gate-pending
        │       return { phase: 'grilling' }
        │    else:
        │       run write-prd → optionally advise-on-prd
        │       post PRD comment (JSON in code fence + advisor concerns)
        │       state → factory:prd-review
        │       return { phase: 'prd-review' }
        ▼
factory:gate-pending  (waiting for the human to reply on the issue)
        │
        │  orchestrator detects new comment(s), rebuilds priorReplies
        │  from stateSource.listComments(), invokes runGrillAndPrdWorkflow
        │  again. Each call is one round.
        ▼
factory:prd-drafting → factory:prd-review (ready for M13.06 decompose-prd)
```

A round is one invocation of `grill-me`. Round 1 happens when `priorReplies` contains zero `agent` entries. Each subsequent invocation increments the round counter. The skill itself caps the loop at 7 rounds — at `roundNumber >= 7` it must return `readyForPRD: true` regardless of whether intent has stabilised. The workflow does not enforce the cap independently; it trusts the skill output.

## priorReplies contract

The `priorReplies` argument is the Discover-Lane conversation transcript so far. The orchestrator builds it between ticks by calling `stateSource.listComments(workItem.id)` and filtering / projecting to:

```ts
{ role: 'user' | 'agent', content: string }
```

- `role: 'agent'` entries are the questions this workflow has previously posted.
- `role: 'user'` entries are the human replies.

This workflow does not mutate `priorReplies`; it reads it to compute the round number (`agent` entries + 1) and forwards it to the `grill-me` skill so the skill can see the conversation history.

## Crystallization

Each grill round (after round 1) distils the prior Q+A pair into a single-sentence decision recorded as a `grill.decision-crystallized` event in the local event store. The workflow rebuilds `priorReplies` from issue comments on every tick and re-attaches crystallizations from the event store before invoking grill-me, so the griller always sees the chain of prior decisions.

When `readyForPRD: true`, the same workflow tick:
1. Crystallizes the most recent Q+A.
2. Re-augments `priorReplies` with the just-emitted crystallization.
3. Forwards the augmented array to write-prd as the authoritative record.

Round 1 emits no crystallization (no Q+A exists yet). The round that flips `readyForPRD` to true also crystallizes the user's last answer — there is no uncrystallized tail.

## Worktree access

Grill-me runs with the `read` tool bundle (sandboxed `read`, `search`, `work-item-read`) against a per-round detached-HEAD worktree of the target repo. The workflow creates the worktree before the grill call and cleans it up in a `finally` block (covers success, validation failure, and exception paths). The path is injected into context as `worktreePath` and used as the agent's `cwd` via the runtime's `workspaceDir` parameter.

## Priority + budget gating for the advisor

The `advise-on-prd` skill runs only when **both** are true:

1. `workItem.priority === 'high' || 'critical'`
2. `projectConfig.budgets.perAdvisorMaxUsd > resolvedAdviseOnPrdBudget.maxBudgetUsd`

When skipped, an `prd.advisor-skipped` event is emitted with `reason: 'priority' | 'budget'`. When run, validated `revisedSections` are shallow-merged into the PRD before posting (`{ ...prdOutput, ...revisedSections }`); advisor `concerns` (when non-empty) are appended to the PRD comment under a `## Advisor concerns` heading.

The advisor cap check uses `perAdvisorMaxUsd` as a simple ceiling. Cumulative spend tracking is M9 territory and is not duplicated here.

## Posted PRD comment shape

When the workflow finishes a round successfully (PRD drafted), it posts a single comment on the parent issue with a deterministic header so the UI / future workflows can find and parse it:

````
<!-- factory:prd -->
# PRD

```json
<JSON encoded PRDOutput>
```

## Advisor concerns
- <concern 1>
- <concern 2>
````

The `## Advisor concerns` block is omitted when there are no concerns.

## Surfaces touched

- `core/workflows/grill-and-prd.ts` — workflow implementation
- `core/event-stream/store.ts` — adds 4 event kinds (`grill.question-posted`, `grill.completed`, `prd.drafted`, `prd.advisor-skipped`)
- `slices/grill-and-prd/slice.test.ts` — integration tests (vitest, mocked AgentRuntime + InMemoryLabelsSource)
- `slices/grill-and-prd/README.md` — this file

## Failure modes and recovery

| Failure | Recovery |
|---|---|
| Pre-condition fails (state not `grilling`/`gate-pending`) | Emit `agent.run-failed`, return `{ phase: 'needs-human' }`, no skill ran |
| `grill-me` schema validation fails | `forceState` to `factory:needs-human`, emit `agent.run-failed`, return `{ phase: 'needs-human' }` |
| `grill-me` returns `readyForPRD: false` with empty `questions` | Same as schema failure — skill contract violated |
| `write-prd` schema validation fails | `forceState` to `factory:needs-human`, return `{ phase: 'needs-human' }` |
| `advise-on-prd` schema validation fails | Fail loud — `forceState` to `factory:needs-human` rather than silently continuing with un-revised PRD |
| Any uncaught error in a skill run | Emit `agent.run-failed`, `forceState` to `factory:needs-human`, return `{ phase: 'needs-human' }` |

## Limitations

### State machine: `factory:grilling -> factory:gate-pending` is not a legal transition

The state machine (`core/state-machine/transitions.ts`) only allows `factory:grilling -> factory:prd-drafting` or `factory:archived`. Because the discover-lane interrogation loop genuinely needs to park in `factory:gate-pending` between rounds, the workflow uses `transitionState` first (which throws) and then falls back to `forceState`. A future PR could add the `grilling -> gate-pending` edge to the state machine to remove the fallback.

Likewise, when the workflow advances from `factory:gate-pending -> factory:prd-drafting` after the user's final reply, that transition is also not in the legal table and uses `forceState`.

### Budgets

When this slice landed, the `grill-me`, `write-prd`, and `advise-on-prd` budgets were already registered in `SKILL_BUDGETS`. The workflow still defensively wraps each `resolveBudgets` call in a try/catch with sensible per-skill fallback values, so removal or rename of the budget entries does not break the workflow at runtime.

### Persona round-robin

Each call advances the per-role persona round-robin index in `personaRouting`. This means consecutive rounds within the same Discover-Lane conversation may rotate through different `griller` personas. That is intentional under M11 — persona stats are aggregated post hoc.
