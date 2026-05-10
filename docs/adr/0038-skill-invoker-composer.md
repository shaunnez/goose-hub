# ADR 0038 — Skill invocation composer + pre-spawn contextSchema validation

**Status:** Accepted
**Date:** 2026-05-10

## Context

CONTEXT.md line 75 has described pre-spawn contextSchema validation as the intended design since M7:

> **Per-skill typed context:** each `skill.config.ts` exports a `contextSchema: ZodSchema`. Orchestrator validates `AgentSpec.context` against it before spawn. Wrong context → run fails before subprocess starts.

In practice this validation was never enforced. Every workflow that spawned an agent had to manually assemble the same boilerplate: load config, read prompt, select persona, resolve budgets, resolve model, select runtime, build `AgentSpec`, run, validate output. The steps were identical across `advisor.ts`, `grill-and-prd.ts`, `decompose-prd.ts`, and every slice workflow — copied, not shared.

Three specific problems:
1. **contextSchema validation was aspirational.** Nothing enforced it at spawn time. A caller could pass any `Record<string, unknown>` and the agent would start regardless.
2. **contextAllowlist was optional on `SkillConfig`.** Skills that omitted it silently passed an empty allowlist, bypassing holdout context filtering in ways that were hard to catch.
3. **`AgentBudgets.timeoutMs` was optional**, even though every skill budget definition and FACTORY_RULES rule 32 require a timeout. Role defaults had no timeoutMs at all.

## Decision

**PR 1 — Type tightening:**
- `AgentBudgets.timeoutMs` made required. All `ROLE_DEFAULTS` entries receive `timeoutMs: 30_000` per FACTORY_RULES rule 32. All test fixtures updated.
- `SkillConfig.contextAllowlist` made required. The five skills that were missing it (`echo-test`, `bug-enhance`, `investigate`, `repo-match`, `triage`) get explicit allowlists matching their contextSchema fields. The `?? []` fallback in callers is no longer needed or used.
- `SkillConfig.outputSchema?: ZodType` added as an optional field. Skills opt in by importing and declaring their output Zod schema. Initial adopters: `advise-on-plan`, `echo-test`, `investigate`.

**PR 2 — `core/agent-runtime/invoke-skill.ts`:**

`invokeSkill(input: InvokeSkillInput): Promise<AgentResult>` is the new canonical entry point for skill-driven agent spawns. Pipeline stages:

1. Load skill config via `pathToFileURL(join(skillsRoot, name, 'skill.config.ts'))` — same pattern as `projects/loader.ts`, tsx-safe.
2. Validate `input.context` against `skillConfig.contextSchema` → throw `ContextValidationError` (with Zod issue paths) before spawn.
3. Load prompt via `readPromptWithContext` (project overlay-aware).
4. Select persona via `selectPersona` (round-robin within project + role).
5. Resolve budgets via `resolveBudgetsForProject`; fallback to `skillConfig.modelPin` + safe defaults for skills not yet in `SKILL_BUDGETS`.
6. Model: `overrides.modelOverride` wins over budget-resolved model ID.
7. Runtime: `overrides.runtimeOverride` (test seam) wins over `selectRuntime`.
8. Build `AgentSpec` — `contextAllowlist` read directly from `skillConfig.contextAllowlist` (no fallback).
9. Spawn via `runtime.run(spec)`.
10. Validate output against `skillConfig.outputSchema` (when declared) → throw `OutputValidationError` (with Zod issue paths + run telemetry) on failure.

`core/agent-runtime/index.ts` created: exports `invokeSkill`, `ContextValidationError`, `OutputValidationError`, `InvokeSkillInput`.

**PR 3 — First migration: `core/agent-runtime/advisor.ts`:**
Replaced 8 imports and ~60 lines of manual boilerplate with a single `invokeSkill` call. Catches `OutputValidationError` to re-emit `agent.run-failed` and re-throw with the original error message (backward compatibility with existing tests and callers).

## Consequences

- `contextSchema` validation is now enforced before every skill-driven spawn that uses `invokeSkill`. Wrong context → no subprocess started, `ContextValidationError` thrown.
- `contextAllowlist` is no longer optional on `SkillConfig`. A skill without an explicit allowlist fails the TypeScript build.
- `outputSchema` validation is opt-in per skill. Skills that declare it get post-spawn type safety; others continue unchanged.
- The `invokeSkill` composer is the only spawn entry point for new workflow code in `core/`. Existing direct `runtime.run()` callers are not forced to migrate — the composer is opt-in for skill-driven runs (per CONTEXT.md audit: direct callers in `grill-and-prd.ts`, `decompose-prd.ts`, `sprint-review.ts` stay bespoke until their own migration PRs).
- `triage-batch.ts` stays bespoke: it allocates personas once across a batch rather than per-skill-call. The composer doesn't support batch persona allocation; this is a known limitation documented in the risks section of the original plan.
- Utility modules (`readPromptWithContext`, `selectPersona`, `resolveBudgetsForProject`, etc.) remain as public helpers. The composer composes them; it does not hide them.

## Alternatives considered

- **Dynamic import via alias template literal (`@goose-hub/skills/${name}/skill.config.js`).** Rejected: Vite/Vitest cannot statically analyze variable alias paths; results in "Unknown variable dynamic import" at test time. The `pathToFileURL(absolutePath)` approach used by `projects/loader.ts` works correctly under both tsx and Vitest.
- **Skill registry (static map of name → config).** Would require updating the registry on every new skill. The filesystem-based dynamic import is self-maintaining.
- **`outputSchema` as a required field on `SkillConfig`.** Would require updating all 35 skills at once. Optional field with progressive opt-in is less disruptive and still enforces validation for opted-in skills.
