# Steves Patterns Implemented 

Steve patterns already implemented in code or planned in open issues — no new action:
                                                                                                                                         
  ┌──────────────────────────────────────────────────────────────────┬───────────────────────────────────────────────────────────────┐   
  │                          Steve pattern                           │                       Factory location                        │   
  ├──────────────────────────────────────────────────────────────────┼───────────────────────────────────────────────────────────────┤   
  │ Lifecycle archive + cross-run pattern miner                      │ M11.11 (shipped) — core/learning/, core/retrospective/        │
  ├──────────────────────────────────────────────────────────────────┼───────────────────────────────────────────────────────────────┤
  │ Convergence detector (score-delta over iterations)               │ M11.11 (partial — pattern convergence, not score-based        │   
  │                                                                  │ ship-readiness)                                               │   
  ├──────────────────────────────────────────────────────────────────┼───────────────────────────────────────────────────────────────┤   
  │ Cross-run retrospective + playbook writer + gate thresholds      │ M11.12 (shipped)                                              │   
  ├────────────────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────┤
  │ Skill-coach proposing prompt-diffs from convergent patterns            │ M11.13 + M11.14 (shipped)                               │   
  ├────────────────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────┤
  │ Predictive model selection by complexity (Strong/Fast/Cheap            │ M11.15 (shipped)                                        │   
  │ allocation)                                                            │                                                         │
  ├────────────────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────┤   
  │ Decision summaries two-stream (canonical + live [decision] KIND:)      │ CONTEXT.md §21, ADR 0018,                               │   
  │                                                                        │ core/agent-runtime/decision-types.ts                    │   
  ├────────────────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────┤   
  │ DecisionKindSchema enum (Steve's DecisionRecord.decision_type)         │ core/agent-runtime/decision-types.ts                    │   
  ├────────────────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────┤   
  │ Fix-it-or-register-it disposition (fixed | registered | out-of-scope)  │ M9 #468, core/findings/disposition.ts                   │
  ├────────────────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────┤   
  │ Tool allowlist bundles (read-only | read-write | bash-restricted)      │ ADR 0010, core/tool-layer/                              │
  ├────────────────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────┤   
  │ Subprocess security (no shell:true, argv array, 30s timeout, 4MB       │ FACTORY_RULES rules 29–33 (matches Steve's              │   
  │ stdout cap, minimal env)                                               │ NEW_CLI_INTEGRATION discipline 1:1)                     │
  ├────────────────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────┤   
  │ Cost tracking per stage / per skill                                    │ ADR 0016, core/cost/ (covers Steve's                    │   
  │                                                                        │ per-agent/model/phase cost)                             │
  ├────────────────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────┤   
  │ Per-project budget caps + per-spawn enforcement                        │ FACTORY_RULES rules 15, 17, 18; ADR 0020 SKILL_BUDGETS  │   
  ├────────────────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────┤
  │ Holdout enforcement (QA/Reviewer fresh context, no decision summaries  │ ADR 0014, assembleSpawnContext()                        │   
  │ leak)                                                                  │                                                         │   
  ├────────────────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────┤
  │ Skill versioning (prompt.md + schema.ts + skill.config.ts, no inline   │ FACTORY_RULES rule 13, ADR 0022                         │   
  │ prompts)                                                               │                                                         │
  ├────────────────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────┤   
  │ Per-project context overlays                                           │ ADR 0022 (matches Steve's "deeper context" injection    │   
  │ (target-projects/<slug>/agent-context/<skillName>.md)                  │ pattern)                                                │
  ├────────────────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────┤   
  │ factory:in-progress work-item lock + per-issue dispatch                │ M11.08 parallel-lock slice                              │   
  ├────────────────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────┤   
  │ Dependency-aware scheduling (Depends on #N parser + filter)            │ M11.01–M11.03                                           │   
  ├────────────────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────┤   
  │ record-decision-style observability (PreToolUse hook tool-call audit)  │ CLAUDE.md §Decision summaries (live markers via         │
  │                                                                        │ PostToolUse hook)                                       │   
  ├────────────────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────┤
  │ Vertical-slice file ownership (in slice scope)                         │ FACTORY_RULES rule 24                                   │   
  ├────────────────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────┤   
  │ goose project bootstrap workflow + governance PR check                 │ M12 (#303–311) — covers Steve's bootstrap discipline    │
  ├────────────────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────┤   
  │ PRD lane (grill-me + write-prd + decompose-issues)                     │ M13 (#312–321) — covers Steve's planning intent         │
  │                                                                        │ (without Wave 1/2)                                      │   
  ├────────────────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────┤
  │ Auto-merge + autonomous Docker isolation                               │ M16 (#342–350)                                          │   
  └────────────────────────────────────────────────────────────────────────┴─────────────────────────────────────────────────────────┘   
                                      
  ---                                                                                                         

                                                                                                                           
  ---                                         
  Gap 1 (foundational) — Investigation Swarm in PLANNING phase                                                                           
                                                                                                                                         
  Title: M19.01: Wave 1/Wave 2 investigation swarm in investigate skill
  Milestone: New M19 (Multi-Agent Orchestration)                                                                                         
  Depends on: M11 complete; ADR for sub-agent dispatch from inside skills (NEW)
  Context: docs/steves-training-materials/Markdown Files/Autonomous Decelopment/01-planning-phase.md:28-97. Six Wave-1 scouts (Schema,   
  Code Path, Pattern, Test Inventory, Dependency, User Journey) run parallel-background; Wave 2 (1–2 deep agents: Interface Designer +   
  Risk Analyst) consume Wave-1 reports. Cross-validation between waves catches contradiction. Orchestrator never reads code directly.    
  Currently Factory's investigate skill is single-agent (S5: skills/investigate/, role=investigator). No Wave-based fan-out exists in any
   skill or workflow.                         
  Acceptance criteria:                
  - ADR docs/adr/0024-sub-agent-dispatch-from-skills.md lands in factory:bootstrap-pr describing how a skill spawns named scout
  sub-skills (file-ownership, budget propagation, decision-summary aggregation, holdout boundary).                                       
  - core/agent-runtime/swarm.ts exposes dispatchWave(parentRunId, scoutSpecs[]): Promise<ScoutReport[]> with per-scout budget caps from
  SKILL_BUDGETS and parallel execution limit from project.maxParallelAgents.                                                             
  - Six scout skills exist: skills/scout-schema/, skills/scout-code-path/, skills/scout-pattern/, skills/scout-test-inventory/,          
  skills/scout-dependency/, skills/scout-user-journey/. Each has prompt.md/schema.ts/skill.config.ts. Output schema: { findings: 
  Array<{file:string, line?:number, fact:string}>, decisionSummaries: [...] }.                                                           
  - Two Wave-2 deep skills exist: skills/wave2-interface-designer/, skills/wave2-risk-analyst/. Schema requires paste-ready
  Zod/SQL/function-signature output (no pseudocode).                                                                                     
  - investigate skill prompt updated to call dispatchWave for Wave 1, run cross-validation classifier, then dispatchWave for Wave 2.     
  - Verify: pnpm vitest core/agent-runtime/swarm.test.ts passes; integration test uses fake-fixture scouts and asserts cross-validation
  surfaces a contradiction when scouts disagree.                                                                                         
  Recommended build model: Opus 4.7 (architectural — modifies core orchestration + spawns 8 new skill packages).                         
  Size: L                                                                                                                                
                                                                                                                                         
  ---                                         
  Gap 2 (foundational) — Engineering Spec artefact with Work Packages + file ownership                                                   
                                                                                                                                         
  Title: M19.02: skills/spec-author/ outputs Engineering Spec with WPs, file-ownership, AC→Journey→Verification map
  Milestone: New M19                                                                                                                     
  Depends on: M19.01                          
  Context: S2 lifecycle.md, S1 01-planning-phase.md:282-327. Steve's plan format = Objective + numbered ACs + WP list (each declares     
  files owned, no overlap) + execution-order DAG + verification tooling spec + AC→Journey→Verification map + risk register. Plan Examples
   (S3: auth-comprehensive-audit, clean-schema-architecture, platform-compiler-phase-b, ws-architecture-polish) all follow this shape.
  Current skills/spec-author/ (S5) emits free-form spec; no WP/file-ownership semantics. Without this, parallel build (Gap 3) cannot run 
  safely.                                     
  Acceptance criteria:                
  - skills/spec-author/schema.ts declares EngineeringSpecSchema with: objective: string, acceptanceCriteria: Array<{id, statement, 
  journeyRef?, verifyCommand, tolerance?}>, workPackages: Array<{id, filesOwned: string[], changes: string, dependsOn: string[],         
  builderTier: 'opus'|'sonnet'|'haiku'}>, executionOrder: Array<{batch: number, wpIds: string[]}>, riskRegister: Array<{risk,    
  mitigation}>.                                                                                                                          
  - WP file-ownership uniqueness validator: same filepath cannot appear in two WPs in the same batch. Validator runs in skill-coach
  review and on schema validation.                                                                                                 
  - spec-author prompt instructs reading scout reports from Wave 1/Wave 2 (Gap 1) as upstream.                                           
  - AC→Journey→Verification map mandatory for type:feature; advisory for type:bug.            
  - Verify: pnpm vitest skills/spec-author/ passes including a file-ownership-collision rejection test.                                  
  Recommended build model: Sonnet 4.6 (mostly schema + prompt revision).                                                                 
  Size: M                                                                                                                                
                                                                                                                                         
  ---                                                                                                                                    
  Gap 3 (high leverage) — Parallel Builder-per-WP
                                                                                                                                         
  Title: M19.03: parallel implement workflow dispatches one builder per Work Package
  Milestone: New M19                                                                                                                     
  Depends on: M19.01, M19.02                                                                                                             
  Context: S2 lifecycle.md (file-ownership fixers A/B/C), S2 hardening.md, S1 03-lifecycle-harness.md:145-157. Builders own disjoint file
   sets; orchestrator owns git operations; builders never use EnterWorktree, never commit, never switch branches. Concurrency capped     
  (Steve: 2 Opus, 3 Sonnet). Factory currently has one implement agent per issue; no per-WP fan-out.
  Acceptance criteria:                                                                                                                   
  - slices/parallel-implement/ slice with workflow.ts dispatching per-WP builders concurrently up to project.maxParallelAgents (already
  enforced for issues; extend for in-issue WPs via a separate semaphore).                                                                
  - Builder skill (skills/implement-wp/) accepts WP context (id, files-owned, ACs, related code snippets only — never full repo). Prompt:
   NEVER create branches/worktrees/commits.                                                                                              
  - Orchestrator commits each WP's changes in a single squashed commit: M<n>.<seq>:WP<id> <description>.                                 
  - File-ownership runtime guard: if builder attempts to edit a file outside its filesOwned, PreToolUse hook denies and emits
  tool.violation.                                                                                                                        
  - Carry-forward failure semantics: a WP whose AC failed in iteration N stays in failed set in iteration N+1 unless explicitly verified 
  again (Steve 03-lifecycle-harness.md:197).                                                                                             
  - Verify: integration test spawns 3 fake builders on disjoint files concurrently, asserts all three commits land, asserts cross-WP edit
   attempt is blocked.                                                                                                                   
  Recommended build model: Opus 4.7 (worktree mechanics + concurrency + hook coordination).                                              
  Size: L                                     
                                                                                                                                         
  ---                                         
  Gap 4 (high leverage) — Parallel Adversarial Review (convergent)                                                                       
                                                                                                                                         
  Title: M19.04: convergent review workflow with 2 parallel adversarial reviewers
  Milestone: New M19                                                                                                                     
  Depends on: ADR 0014 (holdout enforcement) — no fallback on holdouts (rule 23) means each parallel review is independent, no
  escalation.                                                                                                                            
  Context: S1 01-planning-phase.md:362-380. Round 1 = 2 reviewers parallel; Round 2+ until 2 consecutive rounds with 0 new CRITICAL
  findings. ≥1 reviewer per round runs unconstrained ("comprehensive adversarial review, no constraints"). Auth/session/security topics  
  require ≥3 rounds. Currently Factory's review slice (S5) is single-reviewer.
  Acceptance criteria:                                                                                                                   
  - slices/review/ extended: dispatchReviewWave({pr, qaResult, round}) returns Array<ReviewVerdict>. Round-1 spawns 2 reviewers in
  parallel with same context (assembleSpawnContext per reviewer to preserve holdout rule).                                               
  - Convergence: union findings across reviewers; if newCriticalFindings.length === 0 for two consecutive rounds, advance to merge-ready.
   Else continue. Cap at maxReviewRounds (default 3, project-overridable).                                                               
  - Topic auto-classifier (regex on changed files: auth|session|crypto|secret) bumps minimum rounds to 3.                                
  - Holdout discipline preserved: each reviewer spawn uses freshContext: true, contextAllowlist filters as today; no decision summaries
  from siblings cross-pollinate.                                                                                                         
  - Verify: integration test with two fake reviewers — 1 finds CRITICAL, 1 doesn't — asserts second round runs; assert holdout violation 
  if any sibling-decision-summary key leaks.                                                                                             
  Recommended build model: Sonnet 4.6 (workflow + slice; no new core/ component beyond review-wave dispatcher; reuse Gap 1 swarm         
  primitive).                                 
  Size: M                                                                                                                                
                                              
  ---                                                                                                                                    
  Gap 5 — Lifecycle phase additions: HARNESS_DESIGN, SPEC_DRIFT_CHECK, REGRESSION_GATE
                                                                                                                                         
  Title: M19.05: extend state machine with HARNESS_DESIGN / SPEC_DRIFT_CHECK / REGRESSION_GATE phases
  Milestone: New M19                                                                                                                     
  Depends on: M19.02 (Engineering Spec format)
  Context: S1 03-lifecycle-harness.md:23-48. Steve's 10-phase machine adds HARNESS_DESIGN (build harness before code — defines "done"),  
  SPEC_DRIFT_CHECK (after each WP, has spec changed?), REGRESSION_GATE (run prior-passing tests, carry-forward failures). Factory's state
   machine (core/state-machine/) has 23 states but lacks these explicit checkpoints.                                                     
  Acceptance criteria:                                                                                                                   
  - Three new states added to core/state-machine/states.ts: factory:harness-design, factory:spec-drift-check, factory:regression-gate.
  Legal transitions documented in ADR.                                                                                                   
  - Per-WP loop: BUILDING → SPEC_DRIFT_CHECK → REGRESSION_GATE → next-WP or TRIAGING.
  - Carry-forward failure tracking in operational SQLite (carried_failures(run_id, ac_id, first_failed_iteration, last_seen_iteration)). 
  - Non-skippable gates: smoke gate (init), harness baseline, harness verification, regression gate, qa verification, code-quality audit.
   Hook denies state transition if any unsatisfied.                                                                                      
  - Verify: state-machine test asserts HARNESS_DESIGN cannot be skipped; carry-forward semantics test asserts a failed AC at iter N stays
   failed at iter N+1 unless explicitly re-verified.                                                                                     
  Recommended build model: Sonnet 4.6 (state-machine work is well-typed and incremental).                                                
  Size: M                                     
                                                                                                                                         
  ---                                         
  Gap 6 — 3-Tier Verification (Structural / Functional / Regression)                                                                     
                                                                                                                                         
  Title: M19.06: 3-tier verification harness — Structural, Functional, Regression
  Milestone: New M19                                                                                                                     
  Depends on: M19.05                          
  Context: S1 03-lifecycle-harness.md:121-142. Tier 1 = Structural (grep, file-existence, AST: did change execute?). Tier 2 = Functional 
  (runtime imports, API hits, Playwright: does new code work?). Tier 3 = Regression (E2E, smoke: anything else break?). All three        
  required. Factory has Vitest + Playwright but no explicit tiering or "did the change actually execute" assertion.                      
  Acceptance criteria:                                                                                                                   
  - core/verify/tiers.ts defines TierResult { tier: 1|2|3, passed: boolean, evidence: string[] }.
  - Tier-1 helper verifyStructural(spec, diff): greps for required call sites, asserts file existence, parses AST for required exports   
  per Engineering Spec.                                                                                                               
  - Tier-2 reuses existing playwright-repro and adds verifyFunctional(spec) runner with API smoke + import smoke.                        
  - Tier-3 invokes regression gate (Gap 5).                                                                      
  - Verify: a no-op PR (refactor that changes nothing) fails Tier 1 (call site never reached) — assertion test in CI.                    
  Recommended build model: Sonnet 4.6.                                                                                                   
  Size: M                                                                                                                                
                                                                                                                                         
  ---                                                                                                                                    
  Gap 7 — Hooks-based SDLC enforcement (PreToolUse plan-first, PostToolUse lint, Stop verify)
                                                                                                                                         
  Title: M16.10: SDLC hooks — plan-first / lint-feedback / verify-before-stop
  Milestone: M16 (Autonomous/Docker — sits next to existing sandbox + network-allowlist hooks)                                           
  Depends on: M19.02 (so plan-first hook can check Engineering Spec presence)                                                            
  Context: S1 claude-code-hooks-observability-training-deck.md:300-397. Three hooks: PreToolUse on Edit|Write denies if no Engineering   
  Spec exists for current run; PostToolUse on Edit|Write injects lint/typecheck output back into the run via additionalContext so the    
  agent self-corrects; Stop hook denies session-stop if ACs not all [x] and tests/lint failing. Factory currently has PreToolUse audit   
  hook but no enforcement gates.                                                                                                         
  Acceptance criteria:                        
  - hooks/require-spec.sh (PreToolUse on Edit|Write): exit 2 unless slices/<run-slug>/spec.json exists OR file path matches              
  slices/.*/spec\.(ts|json)|\.claude/.*|^docs/.*.                                                                                        
  - hooks/post-write-lint.sh (PostToolUse on Edit|Write): runs pnpm biome check --staged on changed files, returns exit 0 with           
  additionalContext containing failures.                                                                                                 
  - hooks/verify-before-stop.sh (Stop): exit 2 unless pnpm vitest run --changed passes AND ACs in spec all checked.                      
  - Hook deployment idempotent in ~/.factory/hooks/ (rule 18 ADR 0010 already deploys PreToolUse audit hook — extend, don't duplicate).
  - Verify: integration test runs an agent attempting Edit without spec — PreToolUse denies; runs an agent that writes broken TS —       
  PostToolUse injects tsc error; runs Stop with unchecked AC — denied.                                                                   
  Recommended build model: Sonnet 4.6 (bash + node integration).                                                                         
  Size: M                                                                                                                                
                                                                                                                                         
  ---                                         
  Gap 8 — Smoke Gate phase (mandatory init)                                                                                              
                                                                                                                                         
  Title: M19.07: non-skippable smoke gate at workflow start
  Milestone: New M19                                                                                                                     
  Depends on: M19.05                          
  Context: S2 hardening.md:82-84, prod-hardening.md:89-93, S1 05-fix-loop.md:50-67. Smoke gate fails = STOP, fix infrastructure first.   
  Currently Factory dispatches without a smoke check; if API key/SQLite/git/auth broken, agents burn budget and fail mid-run.            
  Acceptance criteria:                
  - core/orchestrator/smoke.ts runs: gh auth status, git fsck --no-progress on workspace, claude --version, SQLite ping, project budget  
  remaining > minimum-floor. All deterministic, no LLM tokens.                                                                           
  - Smoke gate runs before every workflow tick. Failure emits workflow.smoke-failed event and halts dispatch for that project (not the
  whole orchestrator).                                                                                                                   
  - Smoke results cached 60s per project (don't re-run on every tick).                                                                   
  - Verify: smoke-failure test sets invalid ANTHROPIC_API_KEY, asserts workflow.smoke-failed event and zero agent spawns.
  Recommended build model: Haiku 4.5 (deterministic shell + DB calls; no reasoning).                                                     
  Size: S                                                                                                                                
                                                                                                                                         
  ---                                                                                                                                    
  Gap 9 — record-decision runtime tool with category enum                                                                                
                                                                                                                                         
  Title: M19.08: record-decision tool exposed to agent runtime
  Milestone: New M19                                                                                                                     
  Depends on: existing DecisionKindSchema (core/agent-runtime/decision-types.ts)
  Context: S1 02-skill-builder.md:227-258 + S2 lifecycle.md:695-711 (record-decision is Steve's mid-run logging tool). Factory has       
  post-run canonical extraction + live [decision] KIND: markers (CLAUDE.md §Decision summaries). Missing: a callable tool the agent      
  invokes that writes structured DecisionRecord to operational SQLite synchronously, deduplicated, with iteration + phase metadata.      
  Acceptance criteria:                                                                                                                   
  - New tool in core/tool-layer/tools/record-decision.ts with sig recordDecision({ kind: DecisionKind, what: string, why: string }) → { 
  recorded: true, id: string }.                                                                                                          
  - Tool added to read-only allowlist bundle (no I/O risk).
  - Persists to agent_decisions(run_id, iteration, phase, kind, what, why, ts) table.                                                    
  - Reconciles with existing canonical decisionSummaries schema field at run end (no double-counting).                                   
  - Verify: vitest asserts unknown-kind rejection coerces to UNKNOWN; assert tool invocation increments agent_decisions row count.       
  Recommended build model: Sonnet 4.6.                                                                                                   
  Size: S                                                                                                                                
                                                                                                                                         
  ---                                                                                                                                    
  Gap 10 — eval.json skill self-improvement (Karpathy assertion loop)
                                                                                                                                         
  Title: M11.16: enhance skill-coach with eval.json binary-assertion loop
  Milestone: Patch into M11 final issues OR slot post-M11 (depending on remaining capacity).                                             
  Depends on: M11.13/M11.14 shipped                                                                                                      
  Context: S1 claude-code-skills-training-deck.md:233-320. Two-layer self-improvement: Layer 1 (description loop tests YAML auto-trigger 
  accuracy across query set), Layer 2 (binary-assertion eval over canned prompts → score = passing/total, only commit if score improves; 
  one change per iter; rollback on regression). M11.13 skill-coach proposes diffs but has no automated eval loop with binary scoring.    
  Acceptance criteria:                                                                                                                   
  - Each skill gains optional skills/<name>/eval.json with { test_cases: [{ prompt, assertions: [{ id, check: string }] }] }. Assertions 
  are binary (regex match, JSON-shape check, present/absent).                                                                            
  - skill-coach runs eval before/after proposed diff. If post-score < pre-score, abandon diff. If equal, abandon (avoid noise). If       
  higher, commit.                                                                                                                        
  - One diff per loop iteration (Steve's rule). State persisted in skill_coach_runs(skill_name, iter, pre_score, post_score, accepted).  
  - Verify: synthetic skill with 5 binary assertions; mutate prompt to make 1 assertion fail; assert skill-coach proposes a fix that   
  restores score and commits.                                                                                                            
  Recommended build model: Sonnet 4.6.                                                                                                   
  Size: M                                                                                                                                
                                                                                                                                         
  ---                                         
  Gap 11 — Code Quality Audit skill (8-category 100-pt rubric)
                                                                                                                                         
  Title: M19.09: skills/code-quality-audit/ 8-category scorecard
  Milestone: New M19 (or Discover Lane M13 alternative)                                                                                  
  Depends on: none                                                                                                                       
  Context: S1 07-code-quality-audit.md:25-37. Eight categories (Open/Closed=20, Concept Count=15, Time-to-Capability=15, Complecting=15, 
  LOC=10, Coupling=10, Gall's Law=10, Cyclomatic=5). Three automated (5/6/8 via metrics script), five qualitative. Output: scorecard +   
  ranked P0 recommendations + projected score after top-3 fixes. Factory's review slice covers correctness, not architecture quality.    
  Acceptance criteria:                                                                                                                   
  - skills/code-quality-audit/ with prompt enforcing file:line evidence per score.
  - scripts/code-quality-metrics.ts returns Cat 5/6/8 (LOC, fan-out, cyclomatic) as JSON for slot-into-rubric.                           
  - Output schema: { scorecard: Array<{ category, score, max, evidence: Array<{file, line, note}> }>, recommendations: Array<{ priority, 
  principle, file, line, fix, effortLow|Med|High, impactPoints }>, projectedScoreAfterTop3 }.                                            
  - Skill role: auditor (new role; no holdout — sees full reasoning).                                                                    
  - Verify: golden-test fixture repo with known coupling violations — assert Cat 6 score ≤ 5 and at least one P0 recommendation          
  references the violating file:line.                                                                                                    
  Recommended build model: Opus 4.7 (qualitative reasoning across 5 categories).                                                         
  Size: M                                                                                                                                
                                                                                                                                         
  ---                                         
  Gap 12 — User-Journey + Functional-Spec + Engineering-Spec triplet for Discover Lane                                                   
                                                                                                                                         
  Title: M13.11: extend skills/write-prd/ to emit User-Journeys + Functional-Spec + Engineering-Spec triplet
  Milestone: M13 Discover Lane (already in flight)                                                                                       
  Depends on: existing #313, #314, #319                                                                                                  
  Context: S1 01-planning-phase.md:107-180. Steve's planning produces three layered artefacts: User Journeys (persona → trigger → steps →
   success → errors → edges), Functional Spec (When/Given/Then behaviors + state model + invalid transitions), Engineering Spec (the     
  code-side spec with WPs). Current M13.02 (#313) write-prd produces a "structured PRD" — but no Journey-Spec layering and no AC→Journey 
  backref. Missing layering = "wrong thing" bugs caught only at code time.                                                               
  Acceptance criteria:                        
  - skills/write-prd/schema.ts extends to { journeys: Journey[], functionalSpec: FunctionalSpec, engineeringSpecRef: string } where
  Journey is { persona, trigger, steps: Array<{userAction, systemResponse, dataShown, stateChange}>, successState, errorStates: [{error, 
  recovery}], edgeCases: string[] }.                                                                                                     
  - acceptanceCriteria items must each cite a journeyId + stepIdx (validator rejects orphaned ACs unless explicitly tagged               
  cross-cutting).                                                                                                         
  - skills/decompose-issues/ (#314) consumes the spec triplet and emits child slices, each child carrying its parent journey reference.  
  - PRD tab UI (#319) renders the three layers as collapsible sections.                                                                
  - Verify: vitest asserts that a PRD with an AC missing journey-ref is rejected at schema validation.                                   
  Recommended build model: Sonnet 4.6.                                                                                                   
  Size: M                                                                                                                                
                                                                                                                                         
  ---                                                                                                                                    
  Gap 13 — PlaybookManifest portable export/import                                                                                       
                                                                                                                                         
  Title: M11.17 (or new): playbook export/import portability across projects
  Milestone: Patch into M11 OR slot M19                                                                                                  
  Depends on: M11.12 playbook writer                                                                                                     
  Context: S1 08-learning-convergence-loop.md:181-195. Steve's PlaybookManifest is portable JSON: { schema_version, learnings,           
  gate_thresholds, decision_patterns, cost_baselines }. Carries between projects. M11.12 writes playbooks but unclear if exported as     
  portable JSON or only consumed locally.     
  Acceptance criteria:                                                                                                                   
  - goose playbook export <project> > playbook.json CLI emits portable JSON conforming to PlaybookManifestSchema.
  - goose playbook import <project> < playbook.json writes decision_patterns + gate_thresholds to operational SQLite for that project.   
  - Schema versioned; import rejects unknown schema_version.                                                                          
  - Verify: round-trip test on goose-hub-self → import to a temp test project → assert pattern lookup returns same consistency_score.    
  Recommended build model: Haiku 4.5 (CLI + JSON serialisation, deterministic).                                                          
  Size: S                                                                                                                                
                                                                                                                                         
  ---                                                                                                                                    
  Gap 14 — Quality Score 0-100 with components                                                                                           
                                                                                                                                         
  Title: M19.10: per-run QualityScore aggregation
  Milestone: New M19                                                                                                                     
  Depends on: M19.06 (3-tier verify) + Gap 11 (code-quality-audit)                                                                       
  Context: S1 03-lifecycle-harness.md:159-177, 08-learning-convergence-loop.md:88-119. Score components: P0/P1/P2/P3 finding counts,     
  regressions_open, review_converged (bool), uat_passed (bool), static_passed (bool), harness_pass_rate. Convergence rule: score delta < 
  5.0 over last 3 iterations + zero P0/P1 = ship-ready. Factory's retro module aggregates findings but doesn't compute a 0–100           
  ship-readiness score.                                                                                                                  
  Acceptance criteria:                        
  - core/quality-score/score.ts exposes computeQualityScore(runArtifacts) → { score: 0-100, components: {...} }.
  - Convergence checker: isConverged(history) → boolean with Steve's rule.                                                               
  - Score persisted per run; surfaced in retrospective output (existing schema).
  - Verify: golden test — 3 successive runs with diminishing finding counts converge; with stalled counts but P0 open, do NOT converge.  
  Recommended build model: Sonnet 4.6.                                                                                                   
  Size: S                                                                                                                                
                                                                                                                                         
  ---                                                                                                                                    
  3. PLAN.md Updates Needed                                                                                                              
                                                                                                                                         
  Section: §28 M11 (lines 1747–1791)                                                                                                  
  Issue: Marked "mid-milestone status (2026-05-06): halfway through" — Steve material confirms M11.11–M11.15 shipped (lifecycle archive, 
    pattern miner, retrospective, skill-coach, model router).                                                                         
  Suggested change: Update to "M11 effectively complete; M11.01–M11.15 shipped; remaining: M11.04 move-with-deps CLI/UI, FACTORY_RULES   
    rule-14 amendment, M11.07 integration tests."                                                                                     
  ────────────────────────────────────────                                                                                               
  Section: §28 M14 Work Mode                                                                                                          
  Issue: Currently single-investigator. Investigation Swarm (Gap 1) re-architects this.                                                  
  Suggested change: Note Gap 1 dependency: M14 investigation needs Wave 1/2 swarm pattern from M19; otherwise M14 ships               
    single-investigator and is upgraded post-M19.                                                                                        
  ────────────────────────────────────────                                                                                            
  Section: §28 M16 Autonomous                                                                                                            
  Issue: Adds Docker isolation but no parallel-builder semantics yet.                                                                 
  Suggested change: Note Gap 3 dependency: M16 auto-merge gate (#343) should compose with M19.04 convergent review.                      
  ────────────────────────────────────────                                                                                            
  Section: §28 (new entry)                                                                                                               
  Issue: No M19 declared.                                                                                                                
  Suggested change: Add M19: Multi-Agent Orchestration. Outcome: Wave-based investigation, parallel build, convergent review, 3-tier
    verify, smoke gate, lifecycle phase additions. Dependencies: M11. Exit: a representative type:feature issue runs end-to-end through  
    Wave-1 scouts, Wave-2 deep, Engineering Spec with WPs, parallel build, convergent review — captured in cross-run retro.
  ────────────────────────────────────────
  Section: §28 sentinel                                                                                                                  
  Issue: No mention of "investigation swarm", "parallel scout", "scout role", "wave 1/2", "file ownership", "work package", "adversarial
    review (runtime)" anywhere in PLAN.md (S6 confirmed).                                                                                
  Suggested change: Add §6 (or extend §11) with vocabulary block defining these terms before M19 lands.
  ────────────────────────────────────────
  Section: §28 M11.16 + M11.17                                                                                                           
  Issue: Gap 10 and Gap 13 candidates for M11 patching.
  Suggested change: If milestone capacity allows, add M11.16 (eval.json self-improve) and M11.17 (playbook portability). Otherwise defer 
    to M19.                                   
  ────────────────────────────────────────
  Section: §6 Architecture                                                                                                               
  Issue: Currently no constraint on skills dispatching sub-agents.
  Suggested change: Add: "skills MAY dispatch named sub-skills via core/agent-runtime/swarm.ts. Inline prompts forbidden (rule 13)."     
                                              
  ---                                 
  4. FACTORY_RULES Candidates (for human review — DO NOT modify)
                                                                                                                                         
  Steve's materials imply these rules. Each requires explicit ADR + governance PR before adoption.
                                                                                                                                         
  ┌─────┬───────────────────────────────────────────────────────────────┬────────────────────────────────┬──────────────────────────┐ 
  │  #  │                        Candidate rule                         │             Origin             │        Rationale         │    
    orchestrator/parent skill synthesises; it does not Read/Grep/Glob arbitrary files.                                                
  Origin: S1 01-planning-phase.md, S2 lifecycle.md                                                                                    
  Rationale: Forces structured fact-gathering, reproducibility, decision-summary trail.                                               
  ────────────────────────────────────────                                                                                               
  #: 35                                                                                                                               
  Candidate rule: Sub-agent dispatch uses core/agent-runtime/swarm.ts. Each child spawn is itself a registered skill                     
    (prompt.md+schema.ts+skill.config.ts). No inline scout prompts.                                                                   
  Origin: extends rule 13                                                                                                                
  Rationale: Enforces skill registry as single dispatch surface.                                                                      
  ────────────────────────────────────────                                                                                               
  #: 36                                                                                                                               
  Candidate rule: Engineering Spec is the canonical contract for any multi-WP task. Each WP declares filesOwned. No two WPs in the same  
    execution batch may share a file path.                                                                                            
  Origin: S1 03-lifecycle-harness.md, S2 hardening.md                                                                                    
  Rationale: Prevents merge conflicts in parallel build.                                                                              
  ────────────────────────────────────────                                                                                               
  #: 37                                                                                                                               
  Candidate rule: Builders never run git operations. The orchestrator commits each WP. Builders never use EnterWorktree, never switch    
    branches, never commit.                                                                                                          
  Origin: S2 lifecycle.md:360-364, 630-643                                                                                               
  Rationale: Centralises git authority; prevents racey commits.                                                                      
  ────────────────────────────────────────                                                                                               
  #: 38                                                                                                                              
  Candidate rule: Non-skippable gates: smoke (init), harness baseline, harness verification, qa verification, code-quality audit,        
    regression gate. State transitions blocked unless gate satisfied.                                                                
  Origin: S1 02-skill-builder.md, 03-lifecycle-harness.md                                                                                
  Rationale: Prevents shortcuts; gates concentrate quality decisions.                                                                
  ────────────────────────────────────────                                                                                               
  #: 39                                                                                                                              
  Candidate rule: Findings are FIXED or REGISTERED. "Known issues" do not exist. Every finding either has a closed disposition or a      
    tracked issue ref.                                                                                                               
  Origin: S1 03/05/06 + ADR for disposition schema
  Rationale: Already partly enforced via disposition field; promote to rule.                                                             
  ────────────────────────────────────────
  #: 40                                                                                                                                  
  Candidate rule: Convergent review requires ≥2 reviewers in Round 1; ≥1 reviewer per round must be unconstrained. ≥3 rounds required for
                                      
    auth | session | crypto | secret topics.
  Origin: S1 01-planning-phase.md:362-380
  Rationale: Quality threshold for high-risk surfaces.
  ────────────────────────────────────────
  #: 41
  Candidate rule: Skill self-improvement (skill-coach) commits a diff only if eval.json post-score ≥ pre-score. One diff per loop
    iteration.
  Origin: S1 claude-code-skills-training-deck.md:233-320
  Rationale: Karpathy-style binary-assertion discipline; prevents skill-prompt drift.
  ────────────────────────────────────────
  #: 42                                                                                                                                  
  Candidate rule: Sub-investigation contracts declare budgetIterations + timeoutMs. Child-isolated state. Parent merges only evidenceLog
  +                                                                                                                                      
    toolsCalled + midsInvestigated; child never emits a parent-level report.
  Origin: S3 tiered-enterprise-investigation.md:562-587
  Rationale: Bounds fan-out cost; isolates child state for replay.
  ────────────────────────────────────────
  #: 43                                                                                                                                  
  Candidate rule: A skill's prompt may not contain raw Read/Grep/Glob tool invocations against arbitrary paths. Path globs allowed only
  if                                                                                                                                     
    declared in skill.config.ts.              
  Origin: tightens rule 13/19         
  Rationale: Prevents leakage of paths into prompt; enforces tool-allowlist registry.

  ---
  Notes for human review
                                                                                                                                         
  - All four target patterns (Investigation Swarm, Parallel Builder, Parallel Adversarial Review, file-ownership Engineering Spec) form a
   coherent whole. Recommend bundling into new milestone M19 rather than scattering across M14/M16. Single ADR (0024                     
  sub-agent-dispatch-from-skills) underpins all four.
  - Rule-14 amendment ADR is still pending per PLAN.md M11 status. Land it before M19 starts; multi-agent dispatch from inside a workflow
   effectively requires the relaxation.                                                                                                  
  - Gap 7 (SDLC hooks) is the smallest high-leverage win — three bash hooks, immediate enforcement, no ADR needed beyond a settings.json
  change. Could ship into M16.10 within the existing milestone scope.                                                                    
  - Gap 12 (User-Journey triplet for write-prd) is in-scope for M13 and should be merged into the existing #313 spec rather than added as
   new issue, if M13 hasn't started yet.                                                                                                 
  - Steve's Integration Patterns (S3) doctrine maps 1:1 with FACTORY_RULES rules 29–33 — Factory already has subprocess discipline
  equivalent. No gap there.                                                                                                              
  - Steve's record-decision is partially covered by Factory's two-stream decision summaries; Gap 9 fills the runtime-tool form.
  - agent.tool-call audit + PreToolUse hook already covers Steve's "every tool invocation captured with redacted inputs" requirement.    
                                                                                                                                         
  End of report.         


  # Discussion

  # todo                                                                                                                                 
  Check if are capturing full logs in timeline (pre and post hooks?)                                                                     
                                                                                                                                         
  Gap 1 - wave 1 / wave 2 investigation swarms ...                                                                                       
  M13 is building the write-prd, grill-me, decompose-issues, advise-on-prd, decomse-prd, grill-and-prd.. Should thise work (in terms of  
  the planing phase and wave scouts etc) be accomodated here? Like do we finish m13 or add storieshere?                                  
                                                                                                                                         
  Gap 2 - foundational                                                                                                                   
  Ok dockey                                                                                                                              
                                                                                                                                         
  Gap 3 - paralel builder per wp                                                                                                         
  Ok dockey                                                                                                                              
                                                                                                                                         
  Gap 4 - parallel adversial review                                                                                                      
  Ok dockey                                                                                                                              
                                                                                                                                         
  Gap 5 - lifecycle harness design, spec drift, regression gate                                                                          
  not sure we need?                                                                                                                      
                                                                                                                                         
  Gap 6 - 3 tier verification                                                                                                            
  Ok dockey                                                                                                                              
                                                                                                                                         
  Gap 7 - hook based sdlc                                                                                                                
  Ok dockey                                                                                                                              
                                                                                                                                         
  Gap 8 - smoke gate                                                                                                                     
  ok dockey                                                                                                                              
                                                                                                                                         
  Gap 9 - record decision                                                                                                                
  do we need this? iteration + phase metadata to sqllite?                                                                                
                                                                                                                                         
  Gap 10 - eval.json skill M11                                                                                                           
  Self improvement ... probably need to exapnd on how often this runs and which skills?                                                  
                                                                                                                                         
  Gap 11 - code quality audit skill                                                                                                      
  Do we not have some form of code quality measures already (dev/qa?)                                                                    
  Whats missing?                                                                                                                         
  This sounds really good! Where does the audit data cascade up to? Who uses it?                                                         
                                                                                                                                         
  Gap 12 - User Journey + functoinal -spec - M13                                                                                         
  yeah absolutely need to do this                                                                                                        
                                                                                                                                         
  Gap 13 playbook M11                                                                                                                    
  Whats missing?                                                                                                                         
  This sounds really good! Where does the audit data cascade up to? Who uses it?                                                         
                                                                                                                                         
  Gap 12 - User Journey + functoinal -spec - M13                                                                                         
  yeah absolutely need to do this                                                                                                        
                                                                                                                                         
  Gap 13 playbook M11                                                                                                                    
  Can you advise around playbooks and what the point it?                                                                                 
                                                                                                                                         
  Gap 14 - quality score                                                                                                                 
  sounds good                                                                                                                            
                                                                                                                                         
  Plan.md updates - lets do it                                                                                                           
                                                                                                                                         
  Factory_Rules                                                                                                                          
  Sounds fine in theory, although #37... does factory do this currently? I thought worktrees was good? I think at one point we were      
  going to move to docker (M16?)                                                                                                         
                                                                                                                                         
  - Notes for human review                                                                                                               
  1) Agreed re M19                                                                                                                       
  2) Rule 14 - do it? What do you need from me                                                                                           
  3) Should we do this now? gap 7 sdlc hooks                                                                                             
  4) Agreed - haven't started m13 yet - gap12 user journey bit                                                                           
  5) Steves record-decision - gap 9 - souns good                                                                                         
                                                                                                                                         
  Othewise - Around any of the earlier gaps able to be brought in now or at M13? Happy to leave till later milestone if thats gonna be   
  easiest. M14 could be skipped, M15 could come after, M16 could come after (although have a think), M17/18 at the end is good.          
                                                                                                                                         

⏺ Going through todo + each gap reply.               
                                                                                
  ---
  Top todo: pre/post-hook log capture in timeline                                                                                        
                                                 
  Partial answer from CLAUDE.md + S6:                                                                                                    
  - PreToolUse hook: emits agent.tool-call event with redacted inputs — captured per tool invocation.                                    
  - PostToolUse hook: scans transcript for [decision] KIND: markers, emits agent.decision-summary (best-effort progress).                
  - NOT captured: full tool output/stdout/result bodies. Only inputs (PreToolUse) + decision markers (PostToolUse).                      
                                                                                                                                         
  Gap on timeline: tool outputs never persisted. If retrospective wants "agent ran X, got back Y" — only X exists. For full pre/post     
  round-trip in archive, need PostToolUse hook to also emit agent.tool-result (truncated, redacted, size-capped per rule 31).            
                                                                                                                                         
  Want me to file as separate issue? Small, foundational for retro quality.                                                              
                                              
  ---                                                                                                                                    
  Gap-by-gap                                  
                                                                                                                                         
  Gap 1 — Investigation Swarm vs M13
                                                                                                                                         
  M13 builds Discover Lane (vague-idea → grill → PRD → decompose-to-issues). Wave 1/2 swarm runs during PLANNING phase of an existing    
  issue (already-decomposed work). Different phases:
  - M13 = top-of-funnel (idea → issues)                                                                                                  
  - Gap 1 = pre-build (issue → spec via scout fan-out)                                                                                   
                                                      
  Don't fold into M13. M13 produces the issue Wave 1 will then investigate. Sequence: ship M13 as-planned (with Gap 12 triplet patch),   
  then M19.01 (Wave swarm) consumed by investigate + spec-author per issue.                                                              
                                                                                                                                         
  Gap 5 — HARNESS_DESIGN / SPEC_DRIFT_CHECK / REGRESSION_GATE phases                                                                     
                                              
  Reconsidered: redundant if Gap 2/6/8 ship.                                                                                             
  - HARNESS_DESIGN ≈ "spec includes verifyCommand per AC" (Gap 2 covers).
  - SPEC_DRIFT_CHECK ≈ Tier 1 structural verify per WP (Gap 6 covers).                                                                   
  - REGRESSION_GATE ≈ Tier 3 regression run (Gap 6 covers).           
  - Smoke = Gap 8.                                                                                                                       
                                                                                                                                         
  Drop Gap 5 as standalone. Roll explicit state labels into Gap 6 if needed (e.g., Tier-1/2/3 emit distinct events tier1.passed,         
  tier2.passed, tier3.passed). State-machine doesn't need 3 new states; just events.                                                     
                                                                                                                                         
  Gap 9 — record-decision tool                                                                                                           
                                              
  Current state: live [decision] KIND: ... markers + canonical decisionSummaries field at run end. Both work.                            
  
  Question: do we need synchronous SQLite write with iteration+phase metadata?                                                           
                                              
  Honest answer: probably not yet. Marginal value:                                                                                       
  - Iteration metadata: today derivable from event timestamp + run phase
  - Phase metadata: derivable from current state-machine state at emit time                                                              
  - Deduplication: live markers already deduplicate on text match          
  - Survival across compression: live markers persist via event stream (already on disk)                                                 
                                                                                                                                         
  Drop Gap 9 unless retrospective flags decision-summary loss. Revisit after M19.04 lands and we see how dense decision streams get with 
  parallel reviewers/builders.                                                                                                           
                                                                                                                                         
  Gap 10 — eval.json cadence + which skills                                                                                              
                                              
  Two layers, different cadences:                                                                                                        
  
  Layer 1 (description auto-trigger accuracy):                                                                                           
  - When: at skill creation + after any prompt edit by skill-coach
  - Which skills: all skills with description triggers (currently all 18). Cheap (~100 tokens/skill scan).                               
  - Fail mode: skill not auto-triggering reliably → propose better description.                           
                                                                                                                                         
  Layer 2 (binary assertion on output):                                                                                                  
  - When: triggered by skill-coach when convergent pattern detected (M11.13 already has the trigger). Run nightly cron OR on-demand goose
   skill-coach <skill>.                                                                                                                  
  - Which skills: high-leverage + frequently invoked. Suggested first set: triage, qa, review, investigate, implement, spec-author. Skip:
   echo-test, echo-test-holdout (fixtures), evidence-post (mostly mechanical).                                                           
  - Each skill needs eval.json authored by human first (5 prompts × 5 binary asserts = 25 checks). Skill-coach can't generate eval.json  
  from scratch reliably.                                                                                                               
                                                                                                                                         
  Recommend: ship Layer 1 in M11.16 (cheap), Layer 2 manual-author rollout per skill across M19+ (each skill that lands gets eval.json as
   exit criterion).                                                                                                                      
                                              
  Gap 11 — Code Quality Audit, what's missing + cascade                                                                                  
                                              
  What Factory has today (from S5):                                                                                                      
  - core/test-runner/ parses Vitest JSON      
  - qa slice runs lint/typecheck/build/tests verdict (correctness)                                                                       
  - review slice independent verdict on PR (correctness + AC match)
  - Biome lints on commit                                                                                                                
  - No architectural quality scoring                                                                                                     
                                                                                                                                         
  What's missing (Steve's 8-category):                                                                                                   
  - Open/Closed score (can you add a capability without modifying existing code?)                                                        
  - Concept count (how many abstractions does a reader hold to understand the path?)                                                     
  - Time-to-new-capability estimate                                                                                                      
  - Complecting score (how many concerns braided into one file?)                                                                         
  - LOC discipline (% files <200 SLOC)                                                                                                   
  - Coupling/fan-out                                                                                                                     
  - Gall's Law (incremental vs big-bang evolution)                                                                                       
  - Cyclomatic complexity                                                                                                                
                                                                                                                                         
  Cascade — where audit data flows:                                                                                                      
  1. Per-run: audit emits scorecard + P0 recommendations as agent finding events. Stored in run archive (existing retrospective pipe).   
  2. Cross-run: cross-run pattern miner (M11.11 already shipped) detects convergent recommendations across runs ("LOC blown in           
  dispatch.ts 5 runs in row").                                                                                                           
  3. Skill-coach: convergent recommendation → improvement candidate issue auto-filed in shaunnez/goose-hub (existing M9 ImprovementKind =
   governance-suggestion route).                                                                                                         
  4. UI: Roster/quality-trend tab (existing) gains architecturalQualityScore series per project.                                         
  5. Gate (optional, autonomous-only): score < 60 = factory:needs-human until addressed (rule 38 candidate).
                                                                                                                                         
  Audit runs as part of review workflow OR as nightly retrospective trigger — not on every PR (too expensive).                           
                                                                                                                                         
  Gap 13 — playbooks, what's the point                                                                                                   
                                                                                                                                         
  Playbook = portable JSON bundle of learned wisdom from one project, reusable on another.                                               
                                      
  Concrete contents (Steve's PlaybookManifest):                                                                                          
  - Learnings — gotchas/patterns/regression-root-causes discovered during runs (e.g., "always check is_optional before nullable-cast —
  caught 4× in goose-hub-self")                                                                                                          
  - Gate thresholds — observed mean/min/max/std of gate pass-times per phase (e.g., "QA layer 5 typically passes in 2.3s ± 0.4")
  - Decision patterns — (decision_type, phase) → most-common-action with consistency_score (e.g., "MODEL_SELECTION in PLANNING → opus,   
  consistency 0.87 across 23 runs")                                                                                                      
  - Cost baselines — typical cost per phase per run                                                                                      
                                                                                                                                         
  Why portability matters:                                                                                                               
  - Bootstrapping new project (M12) → import playbook from goose-hub-self → new project starts with mined patterns instead of cold start.
  - Cross-project transfer at work (M14) → patterns learned at home apply to work repo without leaking work data (or vice versa).        
  - Disaster recovery → wipe SQLite, re-import playbook, keep wisdom.                                                            
                                                                                                                                         
  If playbooks stay project-local (M11.12 today), every new project re-learns same lessons. Export/import (Gap 13) is the difference     
  between one learning system and N independent learning systems.                                                                        
                                                                                                                                         
  Verdict: low-effort (CLI + JSON + version field), high-conceptual-leverage. Worth filing.                                              
                                              
  Rule 37 worktrees + Factory current pattern                                                                                            
                                              
  Current Factory pattern (S5 + slices/fix-issue/):                                                                                      
  - core/workspaces/ creates per-issue git worktree
  - slices/fix-issue/ (M7 dev workflow): worktree → implement skill → advise-on-plan → PR                                                
  - One worktree per issue. Builder works inside worktree. Builder DOES commit + push.   
                                                                                                                                         
  Steve's pattern (lifecycle.md, hardening.md):                                                                                          
  - All work on current branch, no worktree per builder                                                                                  
  - Builders NEVER commit, NEVER use EnterWorktree, NEVER switch branches                                                                
  - Orchestrator commits each WP                                                                                                         
                                                                                                                                         
  Conflict — worth flagging. Two reconcile paths:                                                                                        
                                                                                                                                         
  Path A (keep worktrees, builders commit): Factory's current model. Each WP-builder gets its own short-lived worktree off the issue     
  branch. Orchestrator merges WP branches into issue branch. Pro: maximum parallelism, no file-edit collisions. Con: more git plumbing,  
  harder to reason about.                                                                                                                
                                              
  Path B (Steve's model, single workspace): One worktree per issue. All WP builders work in same workspace. File-ownership rule +        
  PreToolUse hook prevents collision. Orchestrator commits per WP. Pro: simpler, matches Steve's training material. Con: builders must be
   sequenced or sandboxed if they touch overlapping unrelated files.                                                                     
                                              
  M16 Docker isolation could give us the strongest version: one container per WP-builder, each with its own bind-mounted worktree,       
  orchestrator merges. That's effectively Path A inside Docker.
                                                                                                                                         
  Rule 37 wording should change to: "Builders work in workspaces controlled by the orchestrator. Builders never commit on the main       
  project branch; per-WP commits land via orchestrator-controlled merge into the issue branch."
                                                                                                                                         
  Soft answer: rule 37 needs ADR (probably ADR 0025) before locking. Don't add to FACTORY_RULES yet.                                     
                                      
  Note 2 — Rule 14 ADR, what I need from you                                                                                             
                                              
  Per S6 + PLAN.md M11 status: ADR 0023 was about rule-14 relaxation per-issue and shipped (commit 82572c5 M11.09: ADR 0023 — relax      
  per-project workflow lock to per-issue + maxParallelAgents cap). So rule-14 amendment already shipped.
                                                                                                                                         
  What's still pending: rule-14 wording update in FACTORY_RULES.md to match ADR 0023. That's a governance-perimeter file — needs         
  factory:bootstrap-pr tag.           
                                                                                                                                         
  What I need from you: confirmation to draft a single bootstrap PR amending rule 14 wording to:                                         
                                      
  ▎ 14. One workflow at a time per work item. Per-project parallel cap is project.maxParallelAgents. (Was: one per project; relaxed in   
  ▎ ADR 0023.)                                
                                                                                                                                         
  You merge it. No code change.                                                                                                          
                                      
  Note 3 — Gap 7 (SDLC hooks) now?                                                                                                       
                                              
  Yes, ship now. Independent of M19. Three benefits available immediately:                                                               
  - Plan-first: forces existing investigate artifact before any Edit/Write — surfaces Factory's own "build without spec" bugs
  - Lint-feedback: agent self-corrects from biome output without human re-prompt                                                         
  - Verify-before-stop: Stop hook denies session-end if tests/typecheck failing 
                                                                                                                                         
  Slot as M11.16 (or whatever sequence). Tiny scope (3 bash hooks + settings.json). Sonnet build.                                        
                                                                                                                                         
  Resequencing other gaps for M13 / earlier slots                                                                                        
                                                                                                                                         
  ┌─────────────────────────────────┬───────────────────┬──────────────────────────────────────┐                                         
  │               Gap               │ Earliest landable │                Notes                 │
  ├─────────────────────────────────┼───────────────────┼──────────────────────────────────────┤                                         
  │ Gap 7 SDLC hooks                │ NOW (M11.16)      │ independent, 3 hooks, ships fast     │
  ├─────────────────────────────────┼───────────────────┼──────────────────────────────────────┤
  │ Gap 8 smoke gate                │ NOW (M11.17)      │ shell-based, no LLM, deterministic   │                                         
  ├─────────────────────────────────┼───────────────────┼──────────────────────────────────────┤                                         
  │ Gap 12 PRD triplet              │ M13.11            │ same milestone, before #313 ships    │                                         
  ├─────────────────────────────────┼───────────────────┼──────────────────────────────────────┤                                         
  │ Gap 13 playbook portability     │ M11.18            │ cheap CLI patch on shipped M11.12    │
  ├─────────────────────────────────┼───────────────────┼──────────────────────────────────────┤                                         
  │ Gap 10 Layer-1 description loop │ M11.19            │ one-time per-skill validation; cheap │
  ├─────────────────────────────────┼───────────────────┼──────────────────────────────────────┤                                         
  │ Gap 14 quality score            │ M19               │ depends on Gap 6 verify tiers        │
  ├─────────────────────────────────┼───────────────────┼──────────────────────────────────────┤                                         
  │ Gap 11 code quality audit       │ M19               │ depends on Gap 1 reasoning patterns  │
  ├─────────────────────────────────┼───────────────────┼──────────────────────────────────────┤                                         
  │ Gap 1/2/3/4/6                   │ M19 bundle        │ tightly coupled; ship as milestone   │
  └─────────────────────────────────┴───────────────────┴──────────────────────────────────────┘                                         
                                              
  Recommend sequence after M11 wraps:                                                                                                    
  1. M11.16–M11.19 (Gap 7, 8, 13, 10-Layer1) — small wins
  2. M13 (with Gap 12 patched into #313)                                                                                                 
  3. M19 multi-agent orchestration (Gaps 1, 2, 3, 4, 6, 11, 14)
  4. M16 (Docker isolation) — composes naturally with M19's parallel builders                                                            
  5. M15 (Slack) — anywhere, low coupling                                                                                                
  6. M14 (Work Mode) — defer if not needed near-term                                                                                     
  7. M17, M18 — last                                                                                                                     
                                                                                                                                         
  M14 skippable                                                                                                                          
                                                                                                                                         
  Realistically Goose Hub at home covers your personal repos. Work Mode is value-add only when you want Jira-driven Bitbucket workflow at
   the office. Defer until you actively need it. Doesn't block M19, M15, M16, M17, M18.
                                                                                                                                         
  ---                                         
  Asks (need confirmation before I file)
                                        
  1. Yes/no on splitting M11 patches (M11.16 hooks, M11.17 smoke, M11.18 playbook portability, M11.19 eval Layer-1) before M13?
  2. Confirm bootstrap PR for rule-14 wording amendment — I draft, you merge.                                                            
  3. Approve M19 milestone creation with the 7 issues (Gaps 1, 2, 3, 4, 6, 11, 14) bundled?                                              
  4. Gap 12 (PRD triplet) — patch into existing #313 or separate M13.11?                                                                 
  5. Pre/post-hook tool-result capture issue — file separately as observability gap? 