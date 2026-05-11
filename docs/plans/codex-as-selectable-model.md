# Plan: Codex as a selectable model in role/tier settings

Branch: `claude/add-codex-model-settings-fFUe5`
Status: draft (pre-issue). Promote to a milestone issue before implementation.

## Goal

Make Codex (`gpt-5-codex`, `gpt-5-codex-mini`) a first-class selectable provider in **Settings → Models**, alongside Claude. Per-role, per-slot (primary / fallback / advisor). Today the UI only exposes tier (`haiku|sonnet|opus`) and tier→model resolution hardcodes Claude.

## Current state (confirmed by investigation)

- Provider abstraction exists: `ModelProvider = 'claude' | 'codex'` — `core/agent-runtime/models.ts:5`.
- Codex models already registered — `core/agent-runtime/models.ts:19-20`.
- `defaultModelForTierAndProvider(tier, provider)` already exists — `core/agent-runtime/models.ts:33` — but is not used in the role-model resolution path.
- `selectRuntime()` already routes provider correctly — `core/agent-runtime/select-runtime.ts:32-54`. This is the payoff from ADR-0034.
- Reviewer slots (M19.20) already persist `{model: 'claude'|'codex', prompt}` per slot — `apps/server/src/domains/project-settings/model-router.ts:232-235`. Pattern to mirror.
- Codex auth status endpoint exists — `model-router.ts:159-171`.

## Gap (confirmed)

1. `project_model_settings` table stores tier strings only; no provider column — `core/db/schema.ts:304-319` and migration `core/db/migrations/0010_project_model_settings.sql`.
2. `RoleModel` type has no provider fields — `core/types.ts:40-44`.
3. Server `PATCH /:slug/settings/models/:role` schema (`RoleModelPatchSchema`) accepts tier only — `apps/server/src/domains/project-settings/model-router.ts:34-38`.
4. Tier→model resolution hardcodes Claude:
   - `core/agent-runtime/budgets.ts:302` — `modelOverride: defaultModelForTier(merged.modelTier)`.
   - `core/agent-runtime/budgets.ts:352` — same in `resolveEscalatedBudgets()`.
   - `defaultModelForTier()` body filters `provider === 'claude'` — `models.ts:25-31`.
5. UI exposes tier only — `apps/web/src/components/settings/components/ProjectModelPanel.tsx:43-80` (`TierSelect`).

## Additional UX requirements (folded in after initial review)

Four UX additions requested after the initial plan was written. They are independent of the core provider-wiring work and can be implemented in a separate pass or folded into Groups 2–3 depending on capacity.

### UX-1. Reset to defaults — budgets tab

`apps/web/src/components/settings/components/ProjectBudgetPanel.tsx`

Add a **"Reset all to defaults"** button in the "Global budget caps" section header. On click, nulls out every global override in a single API call and issues `deleteSkillBudgetSetting` for every skill row that currently has any override. The existing per-row `Trash2` delete (line 225) remains for surgical resets.

Server side: a new endpoint `DELETE /projects/:slug/settings/budgets` (or `PATCH` with all-nulls body) that bulk-clears global + all skill overrides in one transaction, avoiding a waterfall of per-row calls from the client.

### UX-2. Bulk provider switch — models tab

`apps/web/src/components/settings/components/ProjectModelPanel.tsx`

Add two pill buttons in the "Role model assignments" section header row, right-aligned:

- **"All → Codex"** — fires PATCH for every non-holdout role setting `{primaryProvider: 'codex', primaryModel: 'sonnet'}` (maps to `gpt-5-codex`). Disabled if Codex CLI is not connected.
- **"All → Claude"** — fires PATCH for every non-holdout role setting `{primaryProvider: 'claude', primaryModel: 'sonnet'}` (maps to `claude-sonnet-4-6`).

Holdout roles (`qa`, `reviewer`) are excluded from bulk operations unless `allowHoldoutOverride: true`.

Server side: a new endpoint `PATCH /projects/:slug/settings/models/bulk` accepting `{provider: 'claude'|'codex', tier: ModelTier}` that writes the same (tier, provider) pair for all eligible roles in one DB transaction — cleaner than the UI issuing N individual PATCHes.

### UX-3. Show actual defaults below inputs

**Budgets tab** — `ProjectBudgetPanel.tsx` `NumericInput` (line 55): the global rows already show the config value as `placeholder` (line 159), but the per-skill rows just say `"default"` (lines 202, 209, 217). Resolve the actual `SKILL_BUDGETS[skill]` values server-side and include them in the GET response as a `skillDefaults: Record<string, {maxTurns, maxBudgetUsd, timeoutMs}>` field. Render as `<p className="text-[10px] text-fg-3">default: {val}</p>` below each input.

**Models tab** — `ProjectModelPanel.tsx` `TierSelect` (line 43): below each select, add `<p className="text-[10px] text-fg-3">{resolvedModelId}</p>` showing the concrete model ID that will be used (e.g. `claude-sonnet-4-6` or `gpt-5-codex`). Derive from the effective tier + provider: if neither DB nor config override is set, fall back to skill default. This requires the GET response to include the resolved model ID per slot (add `resolvedPrimary`, `resolvedFallback`, `resolvedAdvisor` string fields alongside the existing tier fields).

### UX-4. Max turns + timeout configurable per-role — readability assessment

**Decision: place in the expanded row, not as table columns.**

The role table already has 4 columns (role, primary, fallback, advisor). Adding `maxTurns` and `timeoutMs` as columns would make it too wide at typical viewport widths and visually conflate budget controls with model controls.

Better: when a role row is expanded (the `ChevronDown` already exists at line 219), render budget inputs beneath the complexity editor — same `ml-4 border-l-2` inset pattern — with `maxTurns` and `timeoutMs` per role. This matches the mental model ("this role, at these settings") without crowding the table.

Implementation scope:
- New DB columns `max_turns` (integer, nullable) and `timeout_ms` (integer, nullable) on `project_model_settings`.
- Extend `RoleModelPatch` and server schema to accept them.
- Extend the GET response to return resolved values (DB override → config `rolesModels[role].budgets` → `SKILL_BUDGETS` minimum).
- Render two numeric inputs in the expanded row, below `ComplexityEditor`.
- These feed into `resolveBudgetsForProject()` in `core/agent-runtime/resolve-for-project.ts` — the DB row's values win over the skill-level budget.

This is the higher-effort addition; ship the other three first if time is short.

## Out of scope (phase 2)

- Complexity-based provider overrides (the `complexity_overrides_json` JSON would need to carry provider per rule).
- Mid-run provider failover.
- Changing per-skill default `provider` declarations.

## Work plan

Each step lists the files to touch and an acceptance signal. Steps within a group are safe to parallelize.

### Group 1 — Foundation (sequential, lands first)

**1A. Schema + types + repository**

- New migration `core/db/migrations/0XXX_role_model_provider.sql`: add three nullable TEXT columns to `project_model_settings`: `primary_provider`, `fallback_provider`, `advisor_provider` (NULL = inherit, treated as `'claude'`).
- Extend the Drizzle table in `core/db/schema.ts:304-319`.
- Extend `RoleModel` (`core/types.ts:40-44`) with optional `primaryProvider | fallbackProvider | advisorProvider: ModelProvider`.
- Extend `RoleModelPatch` and `writeRoleModelSetting()` in `core/db/repositories/project-model-settings.ts` (lines 8-12, 67-91). Read path returns providers alongside tiers.
- Tests: extend `core/db/repositories/project-model-settings.test.ts` — round-trip a row with mixed providers; verify NULL-as-claude default.
- AC: `pnpm test` + `pnpm typecheck` green; `pnpm manifest` regenerated if inventory changes.

### Group 2 — Parallel (depend only on 1A; mutually independent)

**2A. Core resolution wiring**

- `core/agent-runtime/budgets.ts:302` and `:352`: thread provider preference through. Add `provider?: ModelProvider` to the resolution input; use `defaultModelForTierAndProvider(tier, provider ?? 'claude')`.
- `core/agent-runtime/select-model-for-role.ts`: extend the `dbParams` shape to carry per-slot provider; extend `RoleModelResult` to return `{tier, provider}`.
- `core/agent-runtime/resolve-for-project.ts`: read provider columns from the DB row and pass them through.
- Tests: extend `select-model-for-role.test.ts` — claude-only project still resolves claude; codex-tagged role resolves to codex model ID at the right tier; holdout gating still drops provider preference when `allowHoldoutOverride: false`.
- AC: existing ADR-0034 resolution-order test table still passes.

**2B. Server API contract**

- Extend `RoleModelPatchSchema` in `apps/server/src/domains/project-settings/model-router.ts:34-38` with optional `primaryProvider | fallbackProvider | advisorProvider: z.enum(['claude','codex']).nullable().optional()`.
- Extend the GET response (lines 78-95) to include provider per slot.
- Update DTO types in `apps/server/.../dto.ts` and the mirror in `apps/web/src/lib/types.ts`.
- Integration test in `apps/server` covering PATCH + GET round-trip with each (tier, provider) combination.
- AC: server integration tests green.

**2C. UI — ProjectModelPanel**

- Replace `TierSelect` (`apps/web/src/components/settings/components/ProjectModelPanel.tsx:43-80`) with `TierProviderSelect` — two side-by-side dropdowns: provider (`claude | codex`) + tier (`haiku | sonnet | opus`). Two selects beats one combined dropdown so the "inherit" state stays a single empty value.
- Disable Codex provider option when `codexAuthStatus.status !== 'connected'` — data already fetched by `CodexAuthSection` (line 293); lift the query result into the panel or re-query.
- Holdout rows stay gated by `locked` (line 189) — no change.
- Component test (Vitest + RTL) in a colocated `.test.tsx`: changing provider emits a PATCH body with the provider field; codex option is disabled when auth is missing.
- AC: web typecheck + unit tests green; manual check via `pnpm dev` shows a working toggle.

### Group 3 — Sequential after Group 2

**3A. End-to-end smoke**

- Manual against `goose-hub-self`: set `developer.primary` to `codex:sonnet`, run a low-cost skill, verify `agent.spawn` event carries `model: 'gpt-5-codex'` and that `CodexCliRuntime` was selected.
- Playwright test in `apps/web/e2e/settings-models.spec.ts` covering provider toggle persistence (skip Codex-auth-required assertion if no token on CI).
- AC: smoke passes locally; CI green.

## Risks / notes

- Codex CLI auth is **machine-scoped**, not project-scoped. A project can pick codex while the CLI isn't logged in; spawn will fail at runtime. UI gating in 2C makes this visible but does not prevent it.
- Holdout roles (`qa`, `reviewer`) remain gated by `allowHoldoutOverride`. Provider preference must respect the same gate — explicit test in 2A.
- The complexity-overrides JSON (`complexity_overrides_json`) is untouched in this plan. Provider preference applies only at the (primary | fallback | advisor) slot level for now; complexity rules continue to be tier-only and inherit the role's slot provider.
- Reviewer-slot settings (`projectReviewSettings`) and role-model settings (`projectModelSettings`) remain separate tables. The reviewer slot already carries provider; nothing to merge.

## Acceptance criteria (rolled up)

- [x] Migration applied and reversible. (0023 — providers; 0024 — max_turns + timeout_ms)
- [x] `RoleModel` carries optional per-slot provider in TS types.
- [x] `selectModelForRole()` returns `{tier, provider}` and resolves to a concrete model ID via `defaultModelForTierAndProvider()`.
- [x] PATCH `/:slug/settings/models/:role` accepts and persists provider per slot.
- [x] `ProjectModelPanel` exposes provider per slot; codex options disabled without auth.
- [x] Existing ADR-0034 resolution tests still pass.
- [x] Smoke run (3A): Playwright test in `apps/web/e2e/settings-models.spec.ts` asserts codex provider toggle persists and resolved subtitle shows `gpt-5-codex`; disabled-when-missing assertion included.
- [x] UX-1: "Reset all to defaults" clears all budget overrides in one action.
- [x] UX-2: "All → Codex" and "All → Claude" bulk-set primary provider/tier for all non-holdout roles.
- [x] UX-3: Resolved model IDs and skill budget defaults are visible beneath each input in small text.
- [x] UX-4: Max turns + timeout editable per-role in the expanded row, below complexity rules. DB columns added (migration 0024), `resolveRoleBudgetOverrideForProject` wired in `invoke-skill.ts` with holdout gating, `roleDefaultBudgets` hints rendered below each input.
