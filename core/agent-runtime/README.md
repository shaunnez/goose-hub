# core/agent-runtime

Typed contracts and model registry for all agent runtime code.

## Files

| File | Exports |
|------|---------|
| `interface.ts` | `AgentSpec`, `AgentResult`, `AgentRuntime`, `DecisionSummary`, `AgentBudgets` |
| `models.ts` | `MODELS`, `ModelEntry`, `ModelTier`, `defaultModelForTier`, `tierOf`, `modelsAtOrAboveTier` |
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
