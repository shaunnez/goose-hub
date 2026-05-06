# core/agent-runtime

Typed contracts and model registry for all agent runtime code.

## Files

| File | Exports |
|------|---------|
| `interface.ts` | `AgentSpec`, `AgentResult`, `AgentRuntime`, `DecisionSummary`, `AgentBudgets` |
| `models.ts` | `MODELS`, `ModelEntry`, `ModelTier`, `defaultModelForTier`, `tierOf`, `modelsAtOrAboveTier` |
| `model-router.ts` | `selectModel`, `SelectModelInput`, `SelectModelResult` |
| `with-timeout.ts` | `withTimeout`, `LifecycleTimeoutError`, per-step subclasses, `DEFAULT_TIMEOUTS` |

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

## Model Router

`model-router.ts` provides predictive model selection based on issue-complexity signals. It is called by the dispatch path before building the `AgentSpec`, and its result overrides the budget's default `modelTier`.

```ts
import { selectModel } from '@goose-hub/core/agent-runtime/model-router.js';

const routerResult = selectModel({ workItem, role: 'developer', projectId, modelRouterConfig });
const modelOverride = routerResult != null ? defaultModelForTier(routerResult.tier) : budgetModelOverride;
```

**Resolution order** (highest wins):
1. `agentConfig.modelRouter.overrides` — project-level table keyed by `"role"`, `"role+type:TYPE"`, or `"role+priority:PRIORITY"`
2. Mined `decision_patterns` with `kind = MODEL_SELECTION_OUTCOME` and `consistencyScore > 0.7`
3. Static policy table (see below)

**Static policy** (applied when no override or pattern matches):

| Condition | Tier |
|-----------|------|
| `priority: high` or `priority: critical` | `sonnet` |
| `type: bug` | `haiku` |
| `type: chore` | `haiku` |
| `type: feature` with AC count ≥ 5 OR body ≥ 1500 chars | `sonnet` (reason: `large-feature`) |
| `type: feature` otherwise | `sonnet` (reason: `feature`) |
| default | `sonnet` |

**Holdout bypass**: `selectModel` returns `null` for `qa` and `reviewer` roles. Callers must not apply the result to holdout specs — use the skill's configured tier unchanged.

Emits `agent.model-selected` event after selection so retro / mining can learn from outcomes.

## Per-step typed timeouts (#219)

`with-timeout.ts` provides `withTimeout(promise, options)` and one typed error class per lifecycle step. Each error subclass extends `LifecycleTimeoutError`, sharing `_tag`, `timeoutMs`, and a free-form `context` object for diagnostic surfaces.

| Subclass | `_tag` | Default ms |
|---|---|---:|
| `WorktreeCreateTimeoutError` | `WorktreeCreateTimeout` | 10_000 |
| `HookExecTimeoutError` | `HookExecTimeout` | 5_000 |
| `AgentSpawnTimeoutError` | `AgentSpawnTimeout` | 60_000 |
| `AgentIdleTimeoutError` | `AgentIdleTimeout` | 60_000 (reset on each output line) |
| `ToolCallTimeoutError` | `ToolCallTimeout` | 30_000 (FACTORY_RULES rule 32) |

```ts
import { withTimeout, AgentSpawnTimeoutError } from '@goose-hub/core/agent-runtime/with-timeout.js';

const result = await withTimeout(spawnAgent(spec), {
  timeoutMs: 60_000,
  errorFactory: () => new AgentSpawnTimeoutError(60_000, { runId: spec.runId, skill: spec.skill }),
  signal: abortController.signal,
});
```

**AbortSignal beats timeout.** When `options.signal` aborts before the timer fires, the wrapping promise rejects with `signal.reason` — NOT the typed timeout error. This preserves the cancellation cause.

**`withTimeout` does NOT kill subprocesses.** It only races the promise against the timer. Callers managing a subprocess (e.g. `ClaudeCliRuntime`) must capture the child handle and call `.kill('SIGKILL')` themselves in their `.catch()` handler. The existing pattern in `claude-cli.ts` is the reference implementation.

Defaults are internal — they should not be configurable from skill prompts.

## Import path

```ts
import type { AgentSpec, AgentRuntime } from '@goose-hub/core/agent-runtime/interface.js';
import { defaultModelForTier, MODELS } from '@goose-hub/core/agent-runtime/models.js';
```
