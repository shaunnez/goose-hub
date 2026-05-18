# core/workflows

Orchestration workflows that compose skills, persist results, and transition work-item state.

## workflow-catalog.ts

Maintained catalog for the Settings Workflow map. This is the canonical visual
map source for normal bug, feature, chore, and research paths. Older ASCII or
Mermaid-style diagrams in slice docs are historical notes, not the source of
truth for the current cross-workflow map.

## retrospective.ts

Runs after every successful merge. Selects the retrospective tier (light or deep) and calls the appropriate skill.

### Tier selection

| Policy | Behaviour |
|---|---|
| `always-light` | Always runs `retrospective-light`, ignoring triggers |
| `always-deep` | Always runs `retrospective-deep`, ignoring triggers |
| `auto` | Light by default; deep when any trigger fires |

**Auto-mode deep triggers:**
- `firstRunInMilestone` — first issue shipped in this milestone
- `qaFailed` — any QA failure during the run
- `qualityScoreDeclining` — persona quality score trend is `declining`
- `humanRequested` — human explicitly requested deep retro

### What it does

1. Selects tier and skill name
2. Spawns the appropriate skill via `ClaudeCliRuntime`
3. Emits `retrospective.completed` event with tier and full output
4. Transitions work item `factory:retrospecting → factory:done`
5. On error: emits `agent.run-failed`, transitions to `factory:needs-human`

### Usage

```ts
import { runRetrospectiveWorkflow } from '@goose-hub/core/workflows/retrospective.js';

await runRetrospectiveWorkflow({
  workItem,
  stateSource,
  projectId: 'goose-hub-self',
  policy: 'auto',
  triggers: { qaFailed: true },
});
```

## cross-run-retro.ts

Runs on demand (via `POST /api/projects/:slug/playbooks`). Fetches a window of archived lifecycles and mined patterns, dispatches the `retrospective-cross-run` skill, and persists the validated output as a `playbooks` row.

### M11.14 auto-trigger

After the playbook is persisted, `dispatchCoachCandidates` scans the manifest's `improvementCandidates` and fires `skill-coaching.ts` for each eligible entry. Eligibility requires all of:

- `agentConfig.coachPolicy.enabled === true`
- `lifecycleCount >= coachPolicy.minLifecycles` (default 3)
- At least one `topPattern` with `consistencyScore >= coachPolicy.consistencyThreshold` (default 0.8)
- `candidate.kind ∈ {skill-prompt, skill-schema, skill-config}`
- `targetPath` parseable to a valid skill name (`skills/<name>/...`)
- Skill name not in the forbidden-target list

Forbidden targets emit `coach.skipped-forbidden-target`; dispatches emit `coach.dispatch-triggered`; errors emit `coach.dispatch-failed`. Output is always a candidate — never auto-applied.

## skill-coaching.ts

Reads a target skill's source files (`prompt.md`, `schema.ts`) and cross-run evidence, dispatches the `skill-coach` agent, and persists the output as an `improvement_candidates` row with `proposedDiff` and optional `sourcePlaybookId`.

Forbidden targets (`qa`, `review`, `retrospective-*`, `skill-coach`) are rejected before dispatch.
