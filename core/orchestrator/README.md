# core/orchestrator

Cross-cutting orchestration concerns that don't belong to a single slice. The orchestrator is stateless across ticks (FACTORY_RULES rule 7); these modules are pure or scoped to a single dispatch.

## Files

| File | Purpose |
|---|---|
| `smoke.ts` | Pre-dispatch smoke checks gating any workflow run. Validates: GitHub auth (`gh-auth`), git integrity (`git-fsck`), Claude binary version (`claude-version`), SQLite reachability (`sqlite-ping`), API key presence (`api-key`), and budget floor (`budget-floor`). Results are cached for 60s per check to avoid hammering on every tick. Stderr is redacted (`ghp_*`, `Bearer …`) and capped at 4 KB per FACTORY_RULES rule 31. |

## Smoke check contract

`SmokeResult` is `{ ok: boolean; failedCheck?: SmokeCheckName; reason?: string }`. On failure the orchestrator refuses to dispatch any workflow for the project until the underlying issue is fixed. Failure also emits an event so the UI can surface it.

`slices/smoke-gate` wraps these checks in the dispatch path; this module is the pure check library.

## Consumers

- `slices/smoke-gate` — pre-dispatch gate.
- `apps/server` — `/health` and per-project status endpoints.
