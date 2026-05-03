# core/workflows

Orchestration workflows that compose skills, persist results, and transition work-item state.

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
