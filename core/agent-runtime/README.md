# core/agent-runtime

Typed contracts and model registry for all agent runtime code.

## Files

| File | Exports |
|------|---------|
| `interface.ts` | `AgentSpec`, `AgentResult`, `AgentRuntime`, `DecisionSummary`, `AgentBudgets` |
| `models.ts` | `MODELS`, `ModelEntry`, `ModelTier`, `defaultModelForTier`, `tierOf`, `modelsAtOrAboveTier` |

## AgentSpec

The spec passed to `AgentRuntime.run()`. Key fields:

- **`runId`** — canonical workflow isolation key. Generated once per run (ULID/UUID). Propagated to workspace paths, events, and hook scripts. Every downstream component traces back to this key.
- **`contextAllowlist`** — only these keys from `context` are rendered into the XML prompt. Holdout roles (QA, Reviewer) restrict this to exclude implementation reasoning.
- **`freshContext`** — when `true`, no ambient injection (event stream, persona history) is added. Always `true` for holdouts.

## Model Tier Registry

Hardcoded in `models.ts`, git-tracked. Current IDs:

| Tier | Model ID |
|------|----------|
| `opus` | `claude-opus-4-7` |
| `sonnet` | `claude-sonnet-4-6` |
| `haiku` | `claude-haiku-4-5-20251001` |

Update by PR to `models.ts`. The git log of this file is the audit trail for model changes.

## Import path

```ts
import type { AgentSpec, AgentRuntime } from '@goose-hub/core/agent-runtime/interface.js';
import { defaultModelForTier, MODELS } from '@goose-hub/core/agent-runtime/models.js';
```
