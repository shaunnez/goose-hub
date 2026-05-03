# ADR 0014: M8 Holdout Enforcement Architecture

**Status:** Accepted  
**Date:** 2026-05-03  
**Milestone:** M8 — QA and Review Holdouts

## Context

M8 adds QA and Reviewer agents that are "holdouts" — they must never see implementation reasoning, developer decision summaries, investigation findings, or advisor feedback. This is a hard requirement (FACTORY_RULES rules 1, 20, 23). The question was how to enforce this at the runtime layer rather than by convention.

Three sub-decisions were required:

1. Where to gate context injection
2. How to signal a violation without silently swallowing it
3. What to do when a holdout primary model fails

## Decision

### 1. Centralised context gateway in `context-assembly.ts`

All context injection routes through `assembleSpawnContext()` in `core/agent-runtime/context-assembly.ts`. This is the single point where `spec.context` is filtered against `spec.contextAllowlist` before being rendered into XML and passed to Claude.

`HOLDOUT_ROLES = new Set(['qa', 'reviewer'])` is the source of truth for which roles enforce strict context isolation.

`SYSTEM_KEYS = new Set(['projectId', 'workItemId'])` exempts runtime-managed keys from violation detection — they are always present in `spec.context` by convention and never considered user-injected.

Any key in `spec.context` that is (a) not in `spec.contextAllowlist` and (b) not a `SYSTEM_KEY` is a disallowed key.

### 2. `tool.violation` event per disallowed key on holdout roles

When a disallowed key is detected on a holdout role, `assembleSpawnContext` emits a `tool.violation` event to the event store for each disallowed key. The event payload carries `role`, `disallowedKey`, and `runId`.

Non-holdout roles do NOT emit violations — disallowed keys are silently omitted. This matches the existing pre-M8 behaviour and avoids noise for normal developer runs where partial context is routine.

The violation event is the observable signal for the M8 exit criterion: "explicit attempt to inject Dev decision-summaries into QA/Reviewer fails at the runtime layer with `tool.violation` event."

### 3. `HoldoutFallbackForbiddenError` — typed escalation on holdout primary failure

FACTORY_RULES rule 23: fallback is forbidden on holdouts. If the primary model for a QA or Reviewer run fails (rate limit, timeout, API error), `withFallback()` in `core/agent-runtime/fallback.ts` now catches the error and re-throws `HoldoutFallbackForbiddenError(role)` — a named, typed error. The workflow's catch block can detect this specific error class and transition to `factory:needs-human` with a clear signal.

Before M8, holdout failures propagated as untyped errors. The typed error makes the failure mode explicit and testable.

### 4. Retry counter in `core/retry/` — no new DB table

Retry counts are derived from the existing event stream: count `qa.completed` events with non-pass verdict for QA retries; count `review.completed` events with `needs-fix` verdict for review retries. `DEFAULT_MAX_RETRIES = 2`. When the count meets or exceeds `maxRetries`, the workflow escalates to `factory:needs-human` and emits `agent.retry-escalated`.

This module lives in `core/retry/retry-counter.ts` (not in any slice) so both `slices/qa/` and `slices/review/` can import it without violating FACTORY_RULES rule 24 (slices never import from other slices).

## Consequences

**Positive:**
- Holdout enforcement is enforced at a single gateway, not distributed across every skill and workflow.
- Violations are observable and auditable via `tool.violation` events.
- The typed error class makes the "no fallback on holdouts" constraint verifiable in tests.
- Retry escalation reuses the event stream as state rather than adding a new DB table, staying consistent with the stateless-orchestrator model.

**Trade-offs:**
- `assembleSpawnContext` now has a side-effect (emitting events). This is a deliberate exception to the render-only contract — the side-effect is the enforcement signal, not a data mutation.
- The retry counter includes the current run's event in its count (the just-appended `qa.completed` fires before the count check). This means: with `maxRetries=2`, the second consecutive failure triggers escalation. This is the intended behaviour (first fail → retry; second fail → escalate) and is documented in `slices/retry-escalate/README.md`.
- `getQaVerdict` in `slices/review/workflow.ts` returns `undefined` for M8 scope. The Reviewer does not receive QA context as corroborating signal. A follow-up issue should be filed for M9 to read `qa.completed` from the event store.

## Alternatives Considered

**Alternative A: Enforce at the CC spawn layer** — reject the spawn call itself if disallowed keys are present. Rejected: too late in the pipeline; the rendering layer is the correct gate since it is the only place all context is assembled.

**Alternative B: Compile-time enforcement only** — use TypeScript's conditional type on `AgentSpec<R>` to prevent building a spec with disallowed keys. Rejected: insufficient alone — runtime callers can pass `as any` or the wrong role. Runtime enforcement is required in addition to compile-time checks.

**Alternative C: New DB table for retry counts** — add `retry_counters(workItemId, stage, count)`. Rejected: the event stream already records every outcome. Reading from it avoids schema drift and keeps retry logic consistent with the event-sourcing model.
