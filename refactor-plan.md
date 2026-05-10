Plan 1 — SkillInvoker composer + contextSchema validation

  Goal: deep composer wraps spec-building. Closes contextSchema gap. Workflows shrink.

  New module: core/agent-runtime/invoke-skill.ts

  Public API:
  type InvokeSkillInput = {
    skillName: string;
    projectId: string;
    workItemId?: string;
    runId: string;
    context: Record<string, unknown>;
    overrides?: {
      modelOverride?: string;
      workspaceDir?: string;
      appendContext?: Record<string, unknown>;  // for advisor revision-pass feedback
      extraEventPayload?: Record<string, unknown>;
      runtimeOverride?: AgentRuntime;            // test seam
    };
  };
  
  invokeSkill(input: InvokeSkillInput): Promise<AgentResult>
  
  Composer pipeline (pure stages):
  1. loadSkillConfig(skillName) — dynamic import via @goose-hub/skills/<name>/skill.config.js
  2. validateContext(skillConfig.contextSchema, input.context) → ContextValidationError on
  failure (no spawn)
  3. readPromptWithContext(skillName, projectId) — overlay aware
  4. selectPersona(projectId, skillConfig.role) — round-robin
  5. resolveBudgetsForProject(skillName, projectConfig) — incl. fallback for unregistered
  6. resolveModel(skillConfig, projectConfig, overrides.modelOverride) — tier → model id
  7. selectRuntime({ configRuntime, model, skillProvider })
  8. toJsonSchema(skill output schema) — schema discovery via convention
  skills/<name>/schema.ts
  9. Build AgentSpec — contextAllowlist = skillConfig.contextAllowlist (now required)
  10. runtime.run(spec)
  11. safeParse(outputSchema, result.output) → OutputValidationError on failure (caller
  decides escalate vs needs-human)
  
  Pre-work — type tightening (PR 1)
  - interface.ts: AgentBudgets.timeoutMs required (use 30s default per FACTORY_RULES rule 32
  to keep migration cheap).
  - interface.ts: SkillConfig.contextAllowlist required.
  - Sweep: every skills/*/skill.config.ts (~30 files) → fill contextAllowlist. Holdout skills
  (qa, review) get explicit minimal allowlist; non-holdout skills get permissive list matching
   current implicit behavior.
  - Sweep: every AgentBudgets literal in core/agent-runtime/budgets.ts SKILL_BUDGETS → fill
  timeoutMs.
  - Both fields previously optional → now required is a breaking type change. tsc gates the
  sweep.
  
  TDD order (PR 2 — composer)
  1. Test: invokeSkill rejects when contextSchema fails — no runtime spawn (mock runtime
  asserts not-called). 
  2. Test: pre-spawn validation error carries Zod issue path for debuggability.
  3. Test: happy path — mock runtime, verify spec built with right contextAllowlist, budgets,
  personaId, appendSystemPrompt.
  4. Test: overrides.runtimeOverride short-circuits selectRuntime.
  5. Test: output safeParse failure surfaces as OutputValidationError with run telemetry.
  6. Test: persona round-robin advances per call.
  7. Test: project-pin > skill-pin > tier-default precedence (mirror existing budgets resolver
   tests).
   
  Migration (PR 3+) — one slice/workflow at a time:
  - core/agent-runtime/advisor.ts (smallest, single skill) → first migration; deletes ~60
  lines.
  - slices/investigate/workflow.ts → second.
  - core/workflows/grill-and-prd.ts → after Plan 2 phase split (avoid intersecting refactors).
  - Big-bang not allowed — incremental, slice by slice, each PR keeps tests green.

  ADR: new ADR 0038 — "Skill invocation composer + pre-spawn contextSchema validation". Cites
  CONTEXT.md line 75 promise. Notes: utility modules retained as internal helpers; composer is
   the only spawn entry point in core/.

  CONTEXT.md update: section "Context Assembly and Holdout Enforcement" — note that
  contextSchema validation now enforced via invokeSkill, not aspirational.

  Risks / unknowns
  - Some workflows pass non-skill-shaped contexts (e.g., direct runtime calls bypassing
  skills). Audit: grep "runtime.run(" core/ slices/. Plan: leave them; composer is opt-in for
  skill-driven runs.
  - swarm.ts already has its own contextSchema field — naming collision. Audit before rename.
  - triage-batch.ts calls bypass persona selection at scale — composer must support batch
  persona allocation or batch caller stays bespoke.
  
  Acceptance
  - Every skills/*/skill.config.ts has explicit contextAllowlist and every SKILL_BUDGETS entry
   has timeoutMs.
  - invokeSkill exported from core/agent-runtime/index.ts.
  - Slice tests for at least 2 migrated workflows green using composer.
  - ADR 0038 merged.

  ---
  Plan 2 — grill-and-prd phased extraction

  Goal: 936-line workflow → composable phases. ADR 0037 behavior preserved exactly.

  Guardrails
  - ADR 0037 contract: round-N crystallizes round N-1; readyForPRD also crystallizes its own
  round; worktree per round; cleanup on every exit; 7-round cap.
  - Slice test (slices/grill-and-prd/slice.test.ts, 1221 lines) passes unchanged after each
  phase. No test rewrites until phases extracted, then per-phase tests added alongside.
  - No state-transition contract change. factory:grilling ↔ factory:gate-pending loop intact.

  Phase 2A — WorktreeLifecycle resource (PR 1)

  New: core/workflows/grill-and-prd/worktree-lifecycle.ts

  type WorktreeDeps = {
    createWorktree: typeof createWorktreeImpl;
    cleanupWorktree: typeof cleanupWorktreeImpl;
    logger: Logger;
  };

  withWorktree<T>(
    runId: string,
    branch: string,
    deps: WorktreeDeps,
    body: (path: string) => Promise<T>,
  ): Promise<T>

  - Wraps create + try/finally cleanup. Idempotent cleanup. Logs cleanup-failure as warning
  (per ADR 0037).
  - Tests: cleanup runs on success, on validation failure, on thrown exception. Cleanup runs
  once even if body throws and finally itself partial-fails.
  - Migrate runGrillAndPrd to use withWorktree(...). Slice test must pass unchanged.

  Phase 2B — extract runGrillRound (PR 2)

  New: core/workflows/grill-and-prd/grill-round.ts

  type GrillRoundInput = {
    workItem: WorkItem;
    projectConfig: ProjectConfig;
    priorReplies: PriorReply[];           // already augmented with crystallizations
    priorCrystallizations: Crystallization[];  // round N-1 lookup
    worktreePath: string;
    invokeSkill: SkillInvoker;            // dependency injection
  };

  type GrillRoundResult =
    | { kind: 'question'; question: string; crystallization?: Crystallization }
    | { kind: 'ready-for-prd'; intent: string; crystallization: Crystallization };

  runGrillRound(input: GrillRoundInput): Promise<GrillRoundResult>

  - Pure orchestration: build context, invoke grill-me skill, validate output, extract
  crystallization.
  - No DB / event-store writes — caller persists.
  - Tests: round 1 (no priorReplies) returns no crystallization. Round N produces
  crystallization for round N-1. ready-for-prd path produces final crystallization. Validation
   failure surfaces typed error.

  Workflow rewrites grill section as: persist crystallization → emit event → loop tick.

  Phase 2C — extract runPrdDraft and runAdvisorReview (PR 3)

  New: core/workflows/grill-and-prd/prd-draft.ts,
  core/workflows/grill-and-prd/advisor-review.ts

  runPrdDraft(input: { workItem, projectConfig, augmentedPriorReplies, worktreePath,
  invokeSkill }): Promise<PrdArtifact>
  runAdvisorReview(input: { workItem, projectConfig, prd, invokeSkill }):
  Promise<AdvisorVerdict>

  - Advisor gating (priority + budget) lifted to runAdvisorReview — caller decides whether to
  invoke based on policy returned from a shouldRunAdvisor(workItem, projectConfig) predicate.
  - Tests: write-prd happy path, schema validation failure, advisor proceed/revise/abort each
  in isolation.

  Phase 2D — collapse top-level workflow (PR 4)

  core/workflows/grill-and-prd.ts becomes a thin coordinator (~150 lines):
  - Gate eligibility (already exists).
  - withWorktree → either runGrillRound or runPrdDraft + runAdvisorReview based on prior reply
   count and readyForPRD.
  - State transitions handled via existing ensureGatePending / forceState helpers — leave
  those alone.
  
  Slice-test refactor (PR 5, last)

  Original 1221-line slice test stays as integration smoke. Add per-phase tests:
  - worktree-lifecycle.test.ts — ~80 lines, focused on cleanup invariant.
  - grill-round.test.ts — ~150 lines, pure logic, no worktree mock needed.
  - prd-draft.test.ts — ~100 lines.
  - advisor-review.test.ts — ~80 lines, plus shouldRunAdvisor predicate tests.

  Goal: future changes touch one phase test instead of the full integration.

  Risks
  - Crystallization sequencing subtle. Add explicit invariant test: round-N input includes
  round-(N-1) crystallization, round-N output crystallizes round-(N-1) Q+A. 
  - Worktree cleanup-failure logging path must be preserved verbatim per ADR 0037.
  - Migration to invokeSkill (Plan 1) compounds risk if both happen at once. Sequence: Plan 2
  first uses existing runtime.run directly; final pass migrates to invokeSkill.

  Acceptance
  - Original slice test green after each PR.
  - runGrillAndPrd ≤ 150 lines.
  - ADR 0037 invariants covered by named per-phase tests.

  ---
  Plan 3 — context-assembly split (deferred / opportunistic)
  
  Goal: separate HoldoutValidator from ContextRenderer without breaking single-gateway
  invariant (ADR 0014, CONTEXT.md).

  Trigger condition: do not start standalone. Pull-trigger when next change touches holdout
  enforcement (new forbidden key, new role kind, holdout-allowlist refactor, or
  holdout-related CC ADR).

  Plan when triggered

  New files (same dir): core/agent-runtime/holdout-validator.ts,
  core/agent-runtime/context-renderer.ts. context-assembly.ts retained, becomes 5-line
  composer.

  Contracts
  // holdout-validator.ts
  findHoldoutContextLeaks(spec: AgentSpec): ToolViolation[]
  // pure; HOLDOUT_FORBIDDEN_KEYS lives here only

  // context-renderer.ts
  renderContext(context: Record<string, unknown>, allowlist: string[]): string  // XML
  // no governance knowledge; takes pre-filtered context

  // context-assembly.ts (kept)
  assembleSpawnContext(spec: AgentSpec): SpawnContext {
    const violations = findHoldoutContextLeaks(spec);
    emitViolations(violations);
    const filtered = filterAllowlist(spec.context, effectiveAllowlist(spec, violations));
    const xml = renderContext(filtered, effectiveAllowlist(spec, violations));
    if (spec.freshContext) return { xml };
    return { xml, eventStream: ..., personaHistory: ..., inboxNotes: ... };
  }

  TDD
  1. Move existing findHoldoutContextLeaks tests → holdout-validator.test.ts (rename only).
  2. New context-renderer.test.ts: dotted-path rendering, escaping, empty allowlist, missing
  keys.
  3. context-assembly.test.ts shrinks to integration: violation emit + filtered render compose
   correctly.
   
  Lint guard preserved
  ESLint rule pinning assembleSpawnContext as the only export consumed outside the module
  remains. New files re-export through context-assembly.ts index — call sites unchanged.

  ADR: minor amendment to ADR 0014 noting internal split. Single-gateway invariant unchanged.
  No new ADR needed.

  Risks
  - effectiveAllowlist derivation is currently inline; lifting it into a named function risks
  subtle behavior drift. Snapshot-test with current fixtures before split.
  - ESLint rule must not flag the new internal imports.

  Acceptance
  - assembleSpawnContext signature and behavior unchanged externally.
  - Tests previously in context-assembly.test.ts redistributed; all green.
  - One holdout-related change (the trigger) lands in same PR or follow-up.

  ---