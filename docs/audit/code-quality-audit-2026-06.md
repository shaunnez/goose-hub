# Code Quality Audit — June 2026

Read-only audit of the Goose Hub repo for code that doesn't meet our standards,
code smells, redundant/legacy code, and files over 500 LOC. **No code was
changed.** Tests, markdown, and JSON were excluded from scope per the audit
brief.

Scope covered by parallel subagents: `apps/web`, `apps/server`, `core`,
`slices` + `scripts`. `apps/cli` was spot-checked directly (clean — largest
file 151 LOC). Quantitative markers were swept repo-wide.

## Repo-wide marker sweep (non-test source: apps, core, slices, scripts)

| Marker | Count | Notes |
|---|---|---|
| `@ts-ignore` / `@ts-expect-error` | 0 | Clean. |
| `: any` annotations | 3 | Negligible. |
| `as any` | 1 | Negligible. |
| `TODO`/`FIXME`/`HACK`/`XXX` | 7 | Mostly template strings, not real debt. |
| `biome-ignore` | 20 | All carry rationale comments; well-managed. |
| `eslint-disable` | 2 | Project uses Biome — these are dead suppressions (web). |
| `console.log` | 170 lines | ~Concentrated in `scripts/` + `apps/cli` (legitimate); only a handful in core/slices/web src. |

**Bottom line:** type-safety hygiene (`any`, ts-ignore) and TODO debt are
genuinely low. The real debt is in (1) large monolithic files, (2) duplicated
helpers, (3) a few hard-rule import-boundary violations, and (4) web styling
that bypasses the design system.

---

## 1. Files over 500 LOC (48 files)

Sorted by size. "Split" = recommend decomposition; "OK" = legitimately large
single-concern (data/generated/canvas). Covers `.ts`/`.tsx` plus `.js`/`.mjs`
source (one `.mjs` script qualifies).

| LOC | File | Verdict |
|---|---|---|
| 1691 | `slices/parallel-implement/workflow.ts` | Split — one fn ~1165 LOC |
| 1577 | `slices/qa/workflow.ts` | Split — main fn ~869 LOC |
| 1568 | `apps/web/src/components/detail/components/timeline/MiscEvents.tsx` | Split — god file, 30+ components |
| 1327 | `slices/investigate/workflow.ts` | Split — main fn ~943 LOC |
| 1311 | `slices/fix-feedback/workflow.ts` | Split |
| 1201 | `apps/web/src/components/office/game/static-floor-texture.ts` | OK — procedural canvas |
| 1179 | `apps/web/src/components/office/game/layers/RoomLayer.ts` | OK — Phaser layer |
| 1122 | `apps/web/src/lib/types.ts` | Split — god type file, 104 exports |
| 1113 | `core/workflows/workflow-catalog.ts` | OK-ish — pure graph data |
| 1104 | `apps/web/src/components/settings/components/ProjectBudgetPanel.tsx` | Split — god component, 15 sub-comps |
| 1077 | `core/agent-runtime/codex-cli.ts` | Split — `run()` ~800 LOC |
| 1044 | `apps/web/src/components/detail/lib/timeline/index.ts` | Borderline |
| 985 | `slices/fix-issue/implement-phase.ts` | Split — 3 phase fns |
| 960 | `slices/spec-author/workflow.ts` | Split |
| 946 | `apps/web/src/components/office/game/textures.ts` | OK — texture data |
| 938 | `core/workflows/grill-and-prd.ts` | Split — partial delegation only |
| 928 | `apps/server/src/shared/dispatch-dev.ts` | Split — god module, 5 workflows |
| 912 | `core/tool-layer/mcp/tools/read.ts` | Split — 7 tools in one file |
| 907 | `apps/server/src/domains/project-settings/router.ts` | Split — god router, 14+ resources |
| 898 | `apps/server/src/domains/chat/tools.ts` | Split — 25+ tool handlers |
| 873 | `slices/parallel-implement/wp-builder.ts` | Borderline |
| 862 | `core/agent-runtime/mock-outputs.ts` | OK — fixture data (but ships in prod) |
| 820 | `core/tool-layer/mcp/server.ts` | Split — by tool-bundle |
| 819 | `core/db/schema.ts` | OK — Drizzle schema (monitor) |
| 788 | `apps/server/src/domains/issues/service.ts` | Split — wide surface + barrel |
| 757 | `slices/review/convergent-review.ts` | Borderline |
| 756 | `apps/server/src/domains/bootstrap/service.ts` | Split — preview + run paths |
| 749 | `apps/web/src/components/office/game/layers/TicketLayer.ts` | OK — Phaser layer |
| 738 | `apps/web/src/components/bootstrap/components/BootstrapWizard.tsx` | Split — steps + 15 inline styles |
| 737 | `core/tool-layer/mcp/tools/repo-intel.ts` | Split |
| 731 | `apps/server/src/shared/dispatch-routing.ts` | Split — multi-responsibility |
| 709 | `slices/feature-grounding/workflow.ts` | Split |
| 709 | `apps/web/src/components/detail/components/PRDSection.tsx` | Borderline — extract approval panel |
| 683 | `core/agent-runtime/scout-runner.ts` | Split |
| 665 | `core/state-source/local-db-repository.ts` | Split |
| 606 | `apps/web/src/components/office/game/layers/PersonaLayer.ts` | OK — Phaser layer |
| 597 | `core/agent-runtime/claude-cli.ts` | Split — `run()` ~470 LOC |
| 590 | `scripts/file-m1-issues.mjs` | OK — standalone one-off issue-filing script |
| 580 | `apps/web/src/components/detail/components/timeline/QaEvents.tsx` | Borderline |
| 557 | `apps/server/src/domains/issues/transitions.ts` | Borderline — high cohesion |
| 550 | `core/workflows/bootstrap-renderers.ts` | Split — 2 large renderers |
| 541 | `core/tool-layer/mcp/tools/verify.ts` | Borderline |
| 530 | `scripts/generate-office-assets.ts` | OK — standalone script |
| 529 | `core/verify/tiers.ts` | Borderline |
| 529 | `apps/web/src/components/chat/components/ChatPanel.tsx` | Borderline |
| 522 | `slices/chat-orchestrator/workflow.ts` | Borderline (just over) |
| 511 | `core/agent-runtime/skill-contract-audit.ts` | Borderline |
| 505 | `core/agent-runtime/bug-enhance-runner.ts` | Split — near-dup of feature-enhance |

---

## 2. Hard-rule violations (highest priority)

These break explicit, non-negotiable rules in `CLAUDE.md` / `FACTORY_RULES.md`.

### 2.1 Cross-slice imports — "Slices never import from other slices"
- `slices/parallel-implement/workflow.ts:63` → `../spec-author/path-normalization.js`
- `slices/parallel-implement/workflow.ts:64` → `../spec-author/prd-planning-context.js`
- `slices/parallel-implement/wp-builder.ts:42` → `../spec-author/prd-planning-context.js` (type)

Fix direction: promote `normalizeEngineeringSpecPaths`, `buildPrdPlanningContext`,
and `PrdPlanningContext` into `core/` (e.g. `core/engineering-specs/`).

### 2.2 Cross-slice imports in web (same rule, UI form)
- `settings/.../SettingsPage.tsx` → `@/components/bootstrap/components/BootstrapWizard`
- `chrome/TopBar.tsx` → `@/components/search/components/SearchModal`
- `detail/.../CostsSection.tsx` → `@/components/costs/CostLegend` (costs has no public `index.ts`)
- `office/components/OfficePage.tsx` → `@/components/chrome/AppShell`

### 2.3 Inline agent prompts — "Runtime prompts are loaded through `readPromptWithContext()`; inline prompts in code fail review"
- `slices/feature-grounding/workflow.ts:551-559` — appends a 4-bullet instruction block inline.
- `core/agent-runtime/with-escalation.ts:154-167` — `appendValidationRepairPrompt()` builds repair prompt inline.
- `core/agent-runtime/scout-runner.ts:657` — hardcoded evidence-retry instruction inline.
- `core/agent-runtime/runtime-instructions.ts:1-65` — four large guardrail prompt constants injected into every run. **Needs a ruling:** are infra guardrails exempt from this rule? Should be confirmed in `CONTEXT.md`/an ADR rather than left ambiguous.

### 2.4 Missing required slice files — "`slice.test.ts` and `README.md` are required"
- `slices/grill-prd-ui/` — README references `slice.test.ts` but the file is absent (stale doc).
- `slices/feature-grounding/` — no `README.md`.
- `apps/web/src/components/costs/` — no README + no slice.test.ts.
- `apps/web/src/components/interventions/` — no README + no slice.test.ts.

---

## 3. Duplicated logic (DRY)

### 3.1 `core/agent-runtime` helper duplication (highest-value cleanup)
Identical private helpers copy-pasted across runner files:
- `stableJson` — 4 copies: `claude-cli.ts:52`, `codex-cli.ts:255`, `feature-enhance-runner.ts:88`, `invoke-skill.ts:70`
- `outputSchemaHash`/`schemaHash` — 4 copies (same locations).
- `payloadRecord` — 6 copies: `bug-enhance-runner.ts:215`, `feature-enhance-runner.ts:109`, `scout-runner.ts:114`, `cost/repository.ts:355` (returns `{}` not `null` — divergent), `runtime-profiler/profile-runs.ts:248`, `workspaces/workflow-base.ts:15`.
- `normalizedToolName` — 3 identical copies (bug/feature-enhance, scout-runner).
- `ToolEventAnalysis` + `analyzeToolEvents` — duplicated between `bug-enhance-runner.ts:208` and `feature-enhance-runner.ts:75`.
- `outputPreview`/`previewOutput` — 3 copies, truncation limits diverge (2000 vs 4000).

Recommendation: extract to a shared `core/agent-runtime/event-utils.ts`. The
two enhance-runners are ~40-50 lines of near-identical helper code and should
share an `enhance-common.ts`.

### 3.2 Server duplication
- `interventionEventPayload` — byte-identical in `domains/issues/transitions.ts:403` and `shared/dispatch-routing.ts:277`.
- Work-item type list `['feature','bug','chore','research']` re-derived in ≥4 places (`inbox/service.ts:24`, `search/service.ts:57`, `shared/inbox-bridge.ts:12`, `issues/service.ts:751`) — `core/state-source/interface.ts` already exports `WorkItemType`.
- Legacy mock-deps block duplicated in `dispatch-dev.ts` (`dispatchFixIssue` ~572-593 and `dispatchParallelImplement` ~749-769).
- 14× repeated `getProject`/404 guard in `project-settings/router.ts` (candidate for Hono middleware).

### 3.3 Slice duplication
- `localIssueRef` — `qa/workflow.ts:210` and `fix-feedback/workflow.ts:356`.
- Evidence helpers (`webSpecPath`, `evidencePath`, `copyIfPresent`, `publishEvidence`) duplicated between `fix-issue/evidence-post-workflow.ts` and `investigate/playwright-repro-evidence.ts`.
- `getQaVerdict` — duplicated within review slice (`workflow.ts:225` vs `convergent-review.ts:55`).
- `wpRelevantExecutableChecks` — `wp-context.ts:74` vs `wp-builder.ts:382` share a name but use **different dedup keys** — silent behavioral divergence, possible bug.
- `uniqueSorted` — 3 private copies across feature-grounding, parallel-implement, fix-issue.

### 3.4 Web duplication
- `AgentEventDto.payload` typed `unknown` (`lib/types.ts:199`) forces **88 `payload as {...}` casts** across 15+ timeline files. A per-kind discriminated union / payload map would eliminate them.
- Event-card className `rounded-md border border-line bg-bg-elev/60 px-4 py-3` repeated **29×**; timestamp+dot-separator pattern repeated 30+× — no shared `EventCard`.
- `DetailRow` (2 copies), `Section` (4 copies) — file-private utilities reimplemented; belong in `components/ui/`.

---

## 4. Legacy / redundant / dead code

- `apps/web/src/components/detail/components/RightRail.tsx` — 190 lines, ~130 commented out; renders only a placeholder stub. Implement or delete. **(High)**
- `core/tool-layer/mcp/tools/workflow.ts` — self-documented "unused / deprecated until adopted"; nothing imports it. Delete or adopt.
- `apps/web/src/components/office/lib/layout.ts:54` — `deskPositions()` marked `@deprecated v1`, zero importers. Remove.
- `apps/server/src/domains/issues/prd-actions.ts:309` — `rejectPRD()` legacy alias; its route now returns 410, so the export + import are dead weight.
- `apps/server/src/shared/dispatch-routing.ts:164` — `dispatchForLabel` "temporary label compatibility wrapper" with no removal tracking.
- Commented-out imports in active files: `App.tsx:2`, `detail/.../LeftRail.tsx:2`, `InvestigationSection.tsx:15`, `DetailPage.tsx:55`, `board/.../Board.tsx:40`.

---

## 5. Other standards / smell notes

### Web
- **175 `style={{}}` occurrences** bypassing Tailwind/shadcn. Worst: `PromoteModal.tsx` (28), `BootstrapWizard.tsx` (15 `CSSProperties` consts), `ChangelogModal.tsx` (14), `CodeDiffViewer.tsx` (13). Several modals hand-roll an overlay-div instead of shadcn `Dialog`. **(High — design-system erosion)**
- 16 files use `React.ReactNode`/`CSSProperties` without importing React (works under `react-jsx` but should be `import type { ReactNode }`).
- 2 dead `eslint-disable` comments (`MoveToCurrentDialog.tsx:129`, `office/game/choreography/Timeline.ts:64`) — project uses Biome.
- Array-index keys without `biome-ignore` rationale in 5 files; magic z-index (50/30) and poll intervals (5000/3000/30000) as bare literals.

### Server
- Unvalidated numeric query params via raw `Number()` (NaN can reach the service): `issues/router.ts:76-78` and `:116-117`. Other routes correctly use `z.coerce.number()`.
- `as never` casts to dodge `readonly` array `.includes` narrowing: `inbox/service.ts:32`, `issues/service.ts:762/765/768`.
- Hardcoded mock PR URL `github.com/shaunnez/goose-hub/pull/999` in `dispatch-dev.ts` (×3).
- `cleanMarkdownText`/`loadSkillDescription` markdown parsing living in a router; inline `SKILL_CALLERS` registry duplicating the skill catalogue.

### Core
- Two entries share the `surface: 'resources/list failed'` label in `ADVISORY_RUNTIME_SURFACE_PATTERNS` (`codex-cli.ts:87-101`) but their regexes differ — the second adds `(?:\?path=[^\s]+)?` to match path-qualified failures (`resources/list?path=… failed`) the first regex misses. **Not dead duplication** (initial finding corrected); at most a readability nit since the identical `surface`/`toolName` labels obscure that they cover distinct inputs.
- Audit-path hooks swallow errors silently (`pre-tool-use-hook.ts:130`, `post-tool-use-hook.ts:102/131`, `decision-capture-hook.ts:96` — all `.catch(() => {})`).
- `console.*` not routed through `core/logger.ts`: `db/migrate.ts:7`, `schema-bridge.ts:16`, `read-prompt.ts:27`, `codex-parser.ts:283`, `claude-cli.ts:121`, `interventions/applier.ts:213`, `interventions/proposer.ts:324`.
- Name collision: `FallbackPolicy` is both a union (`types.ts:85`) and an interface (`fallback.ts:7`); the `AgentConfig.fallbackPolicy` field appears to be never read in `core/` (possibly dead config).
- `with-escalation.ts:13` re-declares `TIER_RANK` privately (drift risk vs `models.ts`); `skill-runtime-resolver.ts:278` hardcodes holdout roles instead of `HOLDOUT_ROLES`.

---

## Severity rollup (per area, as reported by subagents)

| Area | High | Medium | Low |
|---|---|---|---|
| apps/web | ~4 themes | ~5 | ~6 |
| apps/server | 2 | 15 | 10 |
| core | 12 | 10 | 10 |
| slices + scripts | 4 | 18 | 12 |

## Suggested follow-up issues (not done here — audit only)

1. **Boundary fixes (High):** promote shared spec-author helpers to `core/`; give `costs` a public `index.ts`; resolve the 4 cross-slice web imports.
2. **Inline-prompt ruling (High):** decide whether infra guardrails are exempt from `readPromptWithContext()`; move the 3 clear in-code prompts to skills.
3. **agent-runtime dedup (High):** extract `event-utils.ts` + `enhance-common.ts`.
4. **Dead-code sweep:** delete `RightRail` stub, deprecated `deskPositions`, unused `tools/workflow.ts`, `rejectPRD`.
5. **Web design-system debt:** migrate inline-styled modals to shadcn `Dialog` + Tailwind; type `AgentEventDto.payload` per-kind to kill 88 casts.
6. **Monolith decomposition:** phase-split the 800-1165 LOC workflow/runner functions.
7. **Server hardening:** Zod-coerce the issues-router query params; consolidate the work-item-type list onto `WorkItemType`.
</content>
</invoke>
