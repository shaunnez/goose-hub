# ADR 0012 — Advisor wrapping and per-step typed-timeout scaffolding (M7)

Status: accepted
Date: 2026-05-03
Closes part of: M7 (#182, #219)

## Context

Two infrastructure patterns landed in M7 to support the supervised dev workflow (#183 / `slices/fix-issue/workflow.ts`):

- **(A) Advisor wrapping.** `skills/advise-on-plan/` (#181) defines the canonical advisor verdict (`proceed | revise | abort`) per CONTEXT.md "Advisor Flow". The orchestrator needed a thin wrapper that constructs the spec, validates the typed output, emits per-summary `agent.decision-summary` events, and surfaces parse failures as `agent.run-failed`. That is `core/agent-runtime/advisor.ts`.
- **(B) Per-step typed timeouts.** Multi-step lifecycle work (worktree create, hook exec, agent spawn, agent idle, tool call) needed a uniform way to cap each step with a typed error so callers can pattern-match on the failure mode. Reference inspiration: `@ai-hero/sandcastle` `docs/adr/0001-per-step-timeouts.md` (Effect-based; Goose Hub adopts the shape, not the dependency). That is `core/agent-runtime/with-timeout.ts`.

Both pieces are foundational — they shape every M7+ workflow that touches Claude. Recording the design here so #183's heir (M8 `run-qa.ts`, `run-review.ts`) doesn't re-derive the contract from the call sites.

## Decisions

### 1. `adviseOnPlan(input)` is a thin wrapper, not a class

A function, not a class — there's no per-instance state. The wrapper:

- Reads the skill's `config.ts` (`toolBundles`, `contextAllowlist`, `freshContext`, `role`) and constructs the `AgentSpec` from those values plus the caller's `runId` / `projectId` / `workItem` / `plan` / optional `revisionPass` + `previousAdvisorFeedback`.
- Hard-fails (throws) if the work-item priority is not `high` or `critical`. The advisor is gated to those two priorities (FACTORY_RULES rule 22); a caller passing `medium` is a bug, not a runtime concern.
- Validates `result.output` against the canonical Zod `AdviseOnPlanSchema`. Parse failure: emits `agent.run-failed` and throws.
- Emits one `agent.decision-summary` event per entry in `parsed.data.decisionSummaries`, with `skill: 'advise-on-plan'` in the payload (#206 pattern).
- Accepts a `runtime: AgentRuntime` override so tests can stub the spawn without mocking module imports.

### 2. `revisionPass` discipline lives in the workflow, not the wrapper

The wrapper is a single-spawn primitive. The state-machine table in CONTEXT.md ("Advisor Flow", §"State-machine table") — pass 0 / pass 1 / abort handling — is implemented by `slices/fix-issue/workflow.ts`. The wrapper accepts `revisionPass: 0 | 1` and `previousAdvisorFeedback?: string` and forwards them into the spec context, but it doesn't enforce the maximum-one-revise rule. That belongs at the orchestration layer where the developer re-spawn happens.

### 3. `withTimeout(promise, options)` is promise-only — does NOT kill subprocesses

The helper races a wrapped promise against a timer and rejects with a typed error from `errorFactory()` if the timer wins. It deliberately does not own subprocess cleanup:

- Promise-only is composable. Wrapping any awaited work is one line.
- Subprocess cleanup is caller-specific (`ClaudeCliRuntime` already captures the child handle in closure and calls `.kill('SIGKILL')` on its own internal timeout).
- Mixing promise timeouts with process-cleanup responsibilities would force every caller to pass a "kill function" — verbose for the common case (no subprocess) and brittle for the spawn case.

The header comment in `with-timeout.ts` makes this explicit so future callers don't assume cleanup is handled.

### 4. AbortSignal beats timeout

When `options.signal` aborts before the timer fires, the wrapping promise rejects with `signal.reason` — NOT the typed timeout error. Rationale: an explicit cancellation cause is more informative than an opportunistic timeout at the same instant. Loss of the timeout signal is acceptable because the signal carries strictly more information.

### 5. Defaults table is internal — not configurable from skill prompts

`DEFAULT_TIMEOUTS` exposes the per-step defaults (worktree 10 s, hook 5 s, spawn 60 s, idle 60 s, tool 30 s). These are NOT user-configurable from skill prompts because:

- Skill authors don't have visibility into orchestrator-level concerns (subprocess spawn time, hook RTT).
- Letting prompts adjust timeouts gives an LLM a knob to wave through hangs as legitimate work.
- The numbers are tuned against FACTORY_RULES rule 32 (30 s tool-call cap) and Anthropic's typical agent latency. Per-call override is allowed via `withTimeout({ timeoutMs })` from the caller side.

### 6. Typed errors carry `_tag` and `context`, not just `name`

Each subclass (`WorktreeCreateTimeoutError`, `HookExecTimeoutError`, etc.) inherits `LifecycleTimeoutError` and exposes:

- `_tag: LifecycleStepTag` — the discriminator. Pattern-matchable in TypeScript without `instanceof`.
- `timeoutMs: number` — the envelope value, for diagnostic surfaces.
- `context: Record<string, unknown>` — free-form per-call context (e.g. `{ runId, skill }`) so error reports carry the WHAT, not just the WHICH.

Equivalent to Effect's `Data.TaggedError` discipline without depending on Effect.

### 7. Synchronous lifecycle paths are NOT retrofitted in this PR

`createWorktree` (`core/workspaces/worktree.ts`) uses `execFileSync` and runs synchronously. Wrapping it in `withTimeout` would require converting it to async and rewriting all callers. That retrofit is intentionally out of scope — the primitives land first, the retrofit follows when the synchronous-call path becomes a problem (it hasn't yet; M7 created precisely one worktree per workflow run).

## Consequences

- New runtime surfaces under `core/agent-runtime/` — `advisor.ts` and `with-timeout.ts`.
- M8 `run-qa.ts` and `run-review.ts` should follow the same pattern: a thin wrapper that constructs the spec from the skill's `config.ts`, validates the output, emits per-summary events. The spawn is delegated to the runtime.
- The 5 typed timeout errors in `DEFAULT_TIMEOUTS` cover the lifecycle steps in `slices/fix-issue/workflow.ts` today. New steps (e.g. `BootDevServerTimeout` for `evidence-post`) get a new subclass and a new entry in the table.
- Skill authors do not see `withTimeout` — it's runtime-side. Skill authors do see `adviseOnPlan` only via the workflow, not directly.

## References

- CONTEXT.md "Advisor Flow" — canonical verdict union and state-machine table
- FACTORY_RULES rules 21 (max one revise pass), 22 (advisor disabled in autonomous by default), 32 (30 s tool-call cap)
- `@ai-hero/sandcastle` `docs/adr/0001-per-step-timeouts.md` — pattern reference for the typed-timeout shape
- `core/agent-runtime/advisor.ts` and `core/agent-runtime/with-timeout.ts`
- `slices/fix-issue/workflow.ts` (consumer)
