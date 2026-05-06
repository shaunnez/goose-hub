# model-router — predictive model selection

Selects the appropriate Claude tier (haiku, sonnet, opus) for an agent run *before* execution, based on issue complexity signals. Acts as the initial model assignment; the existing `with-escalation.ts` reactive escalation remains the safety net.

## Purpose

Steve's training (M11 learning loop) establishes `MODEL_SELECTION` as a first-class decision type informed by mined patterns and static heuristics. This module encodes the policy and integrates pattern data when available, degrading gracefully to static rules when patterns don't exist (e.g., early M11.11 deployment).

## API

```typescript
export function selectModel(input: SelectModelInput): SelectModelResult;

interface SelectModelInput {
  workItem: WorkItem;
  role: Role;
  projectId: string;
  agentConfig: AgentConfig;
  runId: string;
}

interface SelectModelResult {
  tier: ModelTier;
  reason: string;
}
```

## Behavior

### Holdout role bypass

Roles `qa` and `reviewer` use their configured primary tier from `agentConfig.rolesModels[role].primary`, regardless of issue complexity. They never escalate based on feature size or priority — enforcement is explicit in the skill config, not the router.

### Override precedence

Project-level overrides in `agentConfig.modelRouter.overrides` take precedence over policy:

1. **Role+type override** — e.g. `"developer+feature"` → `opus`
2. **Role override** — e.g. `"developer"` → `sonnet`
3. **Static policy** (below)

### Static policy (default)

Applied in order:

- **Bug** → `haiku` — simple fixes, low complexity
- **Chore** → `haiku` — routine maintenance
- **Priority high/critical** → `sonnet` — urgent items merit care
- **Feature** — size-based:
  - Small (AC < 5 AND body < 1500 chars) → `sonnet`
  - Large (AC ≥ 5 OR body ≥ 1500 chars) → `sonnet` with reason `"large-feature"`
- **Default** → `sonnet` — safe fallback for research or unknown types

### Acceptance criteria counting

Counts markdown checklist items matching `^[-*]\s+\[[ xX]\]` (one per line):

```markdown
- [ ] Unchecked
- [x] Checked (lowercase)
- [X] Checked (uppercase)
- [xX] Won't match — needs space
```

### Event emission

Emits `agent.model-selected` for each call, recording:

```json
{
  "kind": "agent.model-selected",
  "projectId": "...",
  "workItemId": "...",
  "runId": "...",
  "payload": {
    "role": "developer",
    "selectedTier": "sonnet",
    "reason": "large-feature"
  }
}
```

Enables retro/mining to learn: *"issues with these labels + this role historically needed sonnet"*.

## Testing

- **Unit tests** — each policy branch (bugs, features, chores, priorities, overrides, holdout bypass)
- **Integration tests** — edge cases (very long bodies, many ACs, mixed checkbox styles), config graceful degradation

## Future: pattern-informed selection

When M11.11 decision_patterns table exists with `kind: MODEL_SELECTION_OUTCOME` rows:

1. Query patterns for `(role, label_set)` with `consistencyScore > 0.7`
2. Weight static policy result — if pattern strongly recommends opus, override static haiku
3. Reason string includes pattern metadata: `"large-feature (pattern: opus for similar issues)"`

Currently degrades to static policy when patterns table is absent.

## Imports

```typescript
import { selectModel, type SelectModelInput, type SelectModelResult } from '@goose-hub/core/agent-runtime/model-router.js';
```

Related: `with-escalation.ts` (post-execution safety net), `models.ts` (tier definitions).
