# Steve's Training Materials — Analysis & Goose Hub Relevance

Generated: 2026-05-01  
Source: `docs/steves-training-materials/` (36 markdown files + presentations)

> Presentations (.pptx) not readable directly; their markdown counterparts cover equivalent content.

---

## Summary Table

| # | File | Summary | Confidence | Project Relevance | Milestone Tie | General SDLC Value |
|---|------|---------|-----------|-------------------|--------------|-------------------|
| 1 | `Autonomous Dev/00-index.md` | Index + composition diagram for 8 autonomous dev pattern docs | 99% | High — our Factory is exactly this pattern | M5–M9 (agent runtime, lifecycle, retro) | High |
| 2 | `Autonomous Dev/01-planning-phase.md` | 10-step investigation-swarm → user journeys → functional spec → engineering spec pipeline | 98% | High — matches how we should scope Factory issues | M3 (cockpit planning), M5+ | Very High |
| 3 | `Autonomous Dev/02-skill-builder.md` | Anatomy of a SKILL.md: 7-section template, state machine, companion scripts | 99% | Direct — our `skills/<name>/` convention mirrors this exactly | M5–M8 (skill definitions) | Very High |
| 4 | `Autonomous Dev/03-lifecycle-harness.md` | 10-phase state machine (PLANNING→COMPLETED), gated vs autonomous modes, quality scoring, cost tracking | 99% | Direct — this IS Factory's orchestration model | M4–M7 (orchestrator, workflows) | Very High |
| 5 | `Autonomous Dev/04-qa-routine.md` | 6-layer deterministic QA harness (auth→nav→console→API→smoke→UX), Playwright-driven, JSON output | 97% | High — pattern for our QA role holdout | M6 (QA workflow) | Very High |
| 6 | `Autonomous Dev/05-fix-loop.md` | INITIALIZING→TESTING→TRIAGING→FIXING→VERIFYING→REPORTING cycle, fix-or-register rule | 98% | High — fix loop is implicit in our TRIAGING→FIX_LOOP workflow states | M6–M7 | Very High |
| 7 | `Autonomous Dev/06-data-quality-check.md` | ORM drift 8-layer harness + N-way reconciliation (SOT vs replica vs app), ETL_DRIFT classification | 95% | Medium — pattern for data integrity; not directly in M3 scope | M10+ (when data pipeline work lands) | High |
| 8 | `Autonomous Dev/07-code-quality-audit.md` | 8-category 100-point rubric (open/closed, concept count, complecting, LOC, fan-out, CC, Gall's law) | 98% | High — directly applicable to Factory code reviews; code_quality_audit gate | M6 (REVIEW_READY phase) | Very High |
| 9 | `Autonomous Dev/08-learning-convergence-loop.md` | Karpathy observe-classify-analyze-improve loop, convergence detection, pattern mining, playbook export | 96% | High — this is M9 (Retrospector role) and M16 autonomous model-bump exactly | M9 (retro), M16 (self-improvement) | Very High |
| 10 | `Autonomous Dev/claude-code-hooks-observability-training-deck.md` | Hooks as enforcement layer (PreToolUse/PostToolUse/Stop), 14 hook types, SDLC three-phase pattern | 99% | Very High — our PreToolUse hook for allowlist enforcement is already implemented; this is the doctrine | M4 (hooks spike) | Very High |
| 11 | `Autonomous Dev/claude-code-skills-training-deck.md` | Skills anatomy, progressive context loading (YAML→body→deep), 6-step build framework, binary assertion self-improvement loop | 98% | Very High — our skills system mirrors this | M5–M8 | Very High |
| 12 | `Autonomous Dev/claude-cowork-training-deck.md` | Beginner guide to Claude Cowork (Desktop app, folder access, sub-agents, connectors) | 90% | Low — consumer-facing product; not relevant to Factory's CLI/SDK architecture | None directly | Low-Medium |
| 13 | `Integration Patterns/INTEGRATION_PATTERN.md` | Doctrine: SDK/CLI over MCP for internal services; ReAct loop guarantees; progressive query widening (L0–L4); progressive disclosure tiers; 7 hard rules | 99% | High — Factory's tool layer and agent runtime follow same principles | M4 (tool allowlist, spawn mechanism) | Very High |
| 14 | `Integration Patterns/NEW_SDK_INTEGRATION.md` | Fill-in scaffold: tiered Pydantic schemas, lazy singleton client, auto-detect query level, async-to-thread, Redis cache, 5-file structure | 98% | Medium-High — pattern for any external service Factory calls | M4+ (when tools beyond Claude CLI are added) | Very High |
| 15 | `Integration Patterns/NEW_CLI_INTEGRATION.md` | Same pattern but subprocess-based: argv list (never shell=True), binary resolution, snapshot tests, write-command capability gating | 98% | Medium — Factory currently spawns `claude -p`; this doctrine directly applies | M4 (spawn mechanism) | Very High |
| 16 | `Integration Patterns/README.md` | 3-line index pointing to the 3 integration files | 100% | Reference only | — | Low |
| 17 | `SEMANTIC_LAYER_FOR_DATA_ENGINEERS.md` | Semantic layer design: 5 primitives (domain, metric, breakdown, disclosure tier, skill), LLM composition over typed vocab, two-authority model (DB + human) | 96% | Medium — not in Factory's current scope but relevant to M10+ analytics | M10+ | High |
| 18 | `context-engineering-beginner.md` | 6-phase AI coach guiding any user to build a context repository (profile → goal → knowledge → rules → tasks → learning log) | 92% | Low-Medium — beginner material; Factory is already well beyond this | None directly | Medium |
| 19 | `context-engineering-claude-code.md` | 8-phase guide building production context engineering: 7 persistence layers (global CLAUDE.md, project CLAUDE.md, memory, plans, skills, hooks, sub-agents) | 99% | Very High — this IS our current architecture; memory system, CLAUDE.md, skills, hooks all match | All milestones | Very High |
| 20 | `steves-guide-to-iterating-with-ai.md` | Multi-turn iteration mindset, 3-question output check, confirmation bias trap, conversation drift, when to start fresh | 90% | Low — human training material; Factory automates this discipline | None directly | High (for humans) |
| 21 | `Skill Examples/drift.md` | Production drift skill: 8-layer ORM harness, exit codes, when-to-run guide | 99% | Medium — pattern for our SPEC_DRIFT_CHECK gate | M6 (harness design) | High |
| 22 | `Skill Examples/hardening.md` | Chat agent hardening loop: QA-as-restaurant-owner persona, fix-or-register pattern | 97% | Medium — QA holdout role pattern | M6 (QA workflow) | High |
| 23 | `Skill Examples/lifecycle.md` | Dark Factory lifecycle skill: PLANNING→SHIP state machine, `-f feature-name` flag discipline, 2 human gates | 99% | Very High — this is a working production version of exactly what we're building | M4–M7 | Very High |
| 24 | `Skill Examples/llm-eval.md` | LLM eval: fetch Langfuse traces, spawn parallel eval agents, PASS/PARTIAL/FAIL verdicts, domain filters | 96% | Medium — applicable to M9 retro/quality measurement | M9 | High |
| 25 | `Skill Examples/prod-hardening.md` | Three-way reconciliation: MSSQL→RDS→agent, ETL_DRIFT vs AGENT_DRIFT classification | 97% | Low-Medium — data reconciliation pattern; not in current Factory scope | M10+ | High |
| 26 | `Skill Examples/qa.md` | One-line QA prompt: "treat it like a sr engineer... magnum opus... use Playwright..." | 60% | Low — informal prompt, not a structured skill | None | Low |
| 27 | `Skill Examples/red-team.md` | Adversarial review via Grok 4: plan + diff + codebase context, structured scorecard | 96% | High — this is exactly our Reviewer holdout role pattern; adversarial review for plans | M5 (Reviewer skill) | Very High |
| 28 | `Skill Examples/review.md` | Work review skill: diff scope parsing, sub-agent codebase deep dive, structured scorecard | 97% | High — Reviewer holdout pattern | M5 (Reviewer skill) | Very High |
| 29 | `Skill Examples/troubleshoot-agent.md` | Langfuse-first debugging: fetch traces → identify tool failures → diagnose before touching code | 95% | Medium — applies when Factory has observability/tracing in place | M4 (event stream), M9 | High |
| 30 | `Plan Examples/auth-comprehensive-audit.md` | Full engineering spec: 10-layer auth harness, WP breakdown with file:line, tier 1/2/3 severity | 99% | High — gold standard for how our engineering specs should look | All milestones | Very High |
| 31 | `Plan Examples/invite-platform-user.md` | Engineering spec: dual-realm identity, 6 ACs with verify commands, DAG work packages | 99% | High — example of falsifiable ACs and work packages we should follow | All milestones | Very High |
| 32 | `Plan Examples/clean-schema-architecture.md` | Not read (plan example) | 80% (est.) | High — another spec example | All milestones | Very High |
| 33 | `Plan Examples/platform-compiler-phase-b.md` | Not read (plan example — likely compiler/manifest architecture) | 80% (est.) | High — platform compiler pattern relevant to Factory's skill/tool compilation | M4–M5 | Very High |
| 34 | `Plan Examples/tiered-enterprise-investigation.md` | Not read (investigation plan example) | 80% (est.) | High — investigation swarm pattern | M5 (Investigator role) | High |
| 35 | `Plan Examples/ws-architecture-polish.md` | Not read (WebSocket architecture polish) | 80% (est.) | Medium | M7+ | High |
| 36 | `Papers/The New Competitive Imperative...` | Three-tier AI proficiency maturity model (L1 info engine → L2 collaborative partner → L3 autonomous workforce) with economic mandate | 97% | Medium — strategic framing; Factory is building L3 infrastructure | Context for all milestones | High (strategic) |
| 37 | `Papers/Navigating Level 1...` | Trust deficit: hallucinations, verification burden, RAG as solution, critical thinking as default | 95% | Low-Medium — user training material | None directly | High (for humans) |
| 38 | `Papers/Achieving Level 2...` | Collaboration gap: HAX design, task allocation, analytical conflict, delegation/context engineering/HITL | 95% | Medium — informs how we design Factory's human gate UX | M3 (cockpit UX), M7 (gate mechanics) | High |
| 39 | `Papers/Mastering Level 3...` | Not read (control & scalability gap — technical limitations, alignment, orchestration) | 80% (est.) | High — directly describes what Factory is building | M4–M9 | Very High |
| 40 | `Papers/The Composable Enterprise...` | Not read (modular AI workflows, upskilling) | 75% (est.) | Low-Medium — strategic/org transformation | None directly | Medium |

---

## Deep Analysis by Category

### Category 1: Autonomous Development Patterns (docs 00–08)

**What they are:** A production-proven system for running 200+ autonomous development lifecycles. Genericized from a real system (likely SkyTab Intelligence).

**Key insight for Goose Hub:** These docs ARE the blueprint for Factory. The 10-phase lifecycle harness (doc 03) maps almost exactly to CONTEXT.md's Scheduler and workflow state machine. The learning loop (doc 08) IS the Retrospector role at M9. The skill anatomy (doc 02) matches our `skills/<name>/prompt.md + schema.ts + skill.config.ts` structure.

**Differences to note:**
- Their state persistence = JSON on disk. Ours = GitHub Issues (source of truth) + SQLite (operational). Different authority model.
- Their "gated mode" = 2 human gates. Our gate mechanics are more granular (any state can be gated).
- Their model allocation table uses Opus/Sonnet/Haiku by task type — identical to our CONTEXT.md model tier registry.

**What to extract now:**
- The three-tier verification framework (Structural/Functional/Regression) should inform our QA skill's harness design (M6)
- The fix-or-register rule matches our "QA and Review are holdouts" + "Never defer findings" principle
- The code quality 8-category rubric (doc 07) should be the scoring model for our `code_quality_audit` gate

**What to extract later (M9+):**
- Learning loop data models (DecisionRecord, LearningEntry, QualityScore) map directly to what our Retrospector needs
- Pattern mining and playbook export — this is M9's retro skill output schema
- Nightly retrospective as a scheduled run — this is exactly what M9 enables

---

### Category 2: Hooks & Observability

**What it is:** Training on Claude Code hooks as enforcement layer (not suggestions). PreToolUse/PostToolUse/Stop + full menu of 14 hook types.

**Key insight for Goose Hub:** We already use PreToolUse for allowlist enforcement (CONTEXT.md: "belt-and-braces, two layers"). The training deck validates our architecture and gives us the progression roadmap:

```
Week 1: Plan-first + quality check + completion gate    ← we're already past this
Week 4+: PostCompact (re-inject critical context)       ← we should implement for long agent runs
          SubagentStart (inject project context)        ← critical for our multi-agent skills
          SubagentStop (log token usage + duration)     ← feeds our budget tracking
```

**Direct impact on M4 (hooks spike):** The hook type table (Section 5.1) and the 4 hook types (command/http/prompt/agent) with their speed characteristics should inform our hook script deployment decision.

---

### Category 3: Integration Patterns

**What they are:** Production doctrine from SkyTab Intelligence for wrapping external APIs/CLIs in a way that minimizes agent token waste.

**Key insight for Goose Hub:** The "ReAct loop guarantees" section directly applies to Factory's agent runtime. Three guarantees an integration must give:
1. Typed result (agent never parses prose)
2. Signal to stop (total_count, has_more)
3. Typed error (ConnectionError vs NotFound vs QueryError)

The progressive query widening (L0 exact → L4 fan-out) mirrors our progressive disclosure in skill context. The "7 rules" are effectively Factory's tool layer rules.

**Direct M4 impact:** The `NEW_CLI_INTEGRATION.md` scaffold applies to our `claude -p` subprocess wrapper. The security rules (argv lists, never shell=True, binary resolve once, cap stdout) are non-negotiable in our spawn mechanism.

**IMPORTANT:** The `subprocess.run(shell=False)` discipline is exactly what our spawn code must follow. The snapshot test pattern (capture argv+stdout, replay in CI) is how we should test agent spawning without real LLM calls.

---

### Category 4: Skill Examples (Production Skills)

**What they are:** Real production skills from SkyTab Intelligence — working code, not templates.

**Directly actionable for Factory:**

| Skill | What to extract |
|-------|----------------|
| `lifecycle.md` | The `-f <feature-name>` flag discipline for multi-lifecycle collision avoidance; our orchestrator needs equivalent per-run isolation | 
| `drift.md` | Layer structure and exit codes for our SPEC_DRIFT_CHECK gate |
| `red-team.md` / `review.md` | Structure of our Reviewer holdout skill — collect diff + full file context before spawning |
| `hardening.md` | QA holdout skill structure — persona-based testing, fix-or-register |
| `llm-eval.md` | Parallel eval agent pattern → our Retrospector at M9 |
| `troubleshoot-agent.md` | Langfuse-first debugging → what our telemetry/observability should enable |

**Not directly useful:** `qa.md` (just an informal prompt, not a structured skill)

---

### Category 5: Plan Examples

**What they are:** Real engineering specs from SkyTab Intelligence. Gold standard for what a Factory-issued engineering spec should look like.

**Pattern these establish (directly applicable to our CLAUDE.md "How to approach a task"):**

1. Objective with measurable outcomes
2. Acceptance criteria with verify commands + tolerance (not "it works")
3. Work packages with file:line, exact before→after changes
4. Execution order DAG with rationale
5. Risk register (at least one entry)
6. Post-implementation harness spec

**Key gap they expose in our current CLAUDE.md:** We say "write failing test first" (TDD) but the plan examples show the verify command belongs IN the spec before any code is written. The AC should specify the exact command (`python3 scripts/verify_auth_integrity.py --live`) + expected output + tolerance.

---

### Category 6: Papers (AI Proficiency Maturity Model)

**What they are:** Academic-style papers on a 3-level AI proficiency framework with economic data.

**L1 (Info Engine) → L2 (Collaborative Partner) → L3 (Autonomous Workforce)**

Factory is building L3 infrastructure. The papers are most useful as:
- **Strategic framing** for why Goose Hub exists (L3 is the economic competitive moat)
- **Design input for gate UX** (L2 paper on Collaboration Gap: humans need transparency, control, feedback)
- **Risk vocabulary** (Trust Deficit at L1, Collaboration Gap at L2, Control & Scalability Gap at L3)

**Not directly useful for implementation** — these are for communicating the vision, not building the code.

---

### Category 7: Context Engineering Guides

**`context-engineering-claude-code.md`** — Very High relevance  
This is an 8-phase guide to building exactly the architecture we already have:
- 7 persistence layers (global CLAUDE.md, project CLAUDE.md, memory, plans, skills, hooks, sub-agents)
- Memory type taxonomy (user/feedback/project/reference) matches our current memory system
- Phase 5 (plans as executable specifications) matches our PLAN.md approach

**What it adds beyond what we have:** The "decay rate" framing for each layer is useful for our memory system: Global rules never change. Plans are frozen per-feature. Memory must be re-verified. This should inform when we invalidate cached agent context.

**`context-engineering-beginner.md`** — Low relevance  
Consumer-level content. Factory is already well past this.

**`steves-guide-to-iterating-with-ai.md`** — Low relevance for Factory  
Human training material. Useful for onboarding Shaun's team members to AI, not for building Factory.

---

## Milestone Tie-In

### Immediately actionable (M3 current)
- Auth-audit plan example → template for M3.09 UX redesign engineering spec structure
- Hooks training → confirm our PreToolUse allowlist hook design is correct
- Skill anatomy (doc 02) → verify our skill directory structure matches

### M4 (Agent Runtime Spike)
- `NEW_CLI_INTEGRATION.md` → spawn mechanism security rules (argv lists, binary resolution, stdout cap)
- Hook deployment decision (Section 4 of hooks deck: where does the PreToolUse script live?)
- Three-tier verification → harness baseline requirement before build

### M5 (Workflow Layer)
- Lifecycle harness state machine → workflow implementation blueprint
- Red-team/review skill examples → Reviewer holdout skill structure
- `lifecycle.md` skill → `-f feature-name` isolation discipline for parallel workflows

### M6 (QA + Fix Loop)
- QA routine (doc 04) → QA holdout skill's 6-layer harness
- Fix loop (doc 05) → TRIAGING→FIX_LOOP workflow states
- Code quality audit (doc 07) → `code_quality_audit` gate scoring
- Drift skill example → SPEC_DRIFT_CHECK gate implementation

### M7 (Gated Review + Ship)
- Lifecycle harness's gate system → our gate mechanics implementation
- Review skill examples → Reviewer holdout skill
- Gate authority (GitHub labels, L2 paper on human control)

### M9 (Retrospector + Self-Improvement)
- Learning loop (doc 08) → Retrospector skill schema (DecisionRecord, LearningEntry, QualityScore)
- Pattern mining → Retrospector's cross-lifecycle analysis
- Playbook export/import → improvement candidate format
- LLM eval skill → Retrospector's trace analysis capability

### M16+ (Autonomous Mode)
- Autonomous lifecycle mode → Factory's autonomous dispatch
- Convergence detection → when to stop iterating without human input

---

## Highest-Value Extractions (Priority Order)

1. **Three-tier verification framework** (Structural/Functional/Regression) — defines what a proper harness looks like for M6's QA skill. Extract and formalize as a FACTORY_RULES addition or CONTEXT.md entry.

2. **Fix-or-register rule** — already implicit in our rules ("QA is a holdout") but should be explicit in the QA skill's prompt.md: every finding is FIXED or REGISTERED, never deferred.

3. **Plan spec structure** from plan examples — our engineering specs for issues should follow the auth-audit format: AC with verify command + tolerance, work packages with file:line, execution DAG with rationale.

4. **Decision-type taxonomy** (MODEL_SELECTION, SCOPE_CHANGE, SKIP_GATE, ESCALATE, FIX_STRATEGY) — feeds our `decisionSummaries` field in skill schemas at M5+.

5. **8-category code quality rubric** — should be the scoring basis for our `code_quality_audit` gate; actionable at M6.

6. **Spawn mechanism security rules** from `NEW_CLI_INTEGRATION.md` — argv lists, never shell=True, binary resolve once, 4MB stdout cap, 30s timeout. Non-negotiable at M4.

7. **Learning loop data models** — DecisionRecord/LearningEntry/QualityScore schema directly feeds our M9 Retrospector skill schema. Extract now, implement at M9.

---

## What These Materials Are NOT

- Not applicable: `claude-cowork-training-deck.md` (consumer product, not Factory)
- Not applicable now: `SEMANTIC_LAYER_FOR_DATA_ENGINEERS.md` (M10+ analytics domain)
- Not applicable now: `prod-hardening.md` (three-way MSSQL reconciliation — different domain)
- Marginal: Papers other than the three-tier model (academic framing, not implementation)
- Marginal: `context-engineering-beginner.md` (consumer-level)

---

## Key Observation

Steve's system and Goose Hub Factory converged on the same architecture independently:

| Steve's system | Goose Hub Factory |
|---------------|------------------|
| State machine with phases + gates | Workflow state machine (CONTEXT.md: scheduler) |
| Non-skippable gates | `harness_verification`, `qa_verification` (FACTORY_RULES) |
| Fix-or-register | "QA is holdout, never sees implementation reasoning" |
| Holdout roles (no implementation context) | Holdout: `requiresFreshContext: true` type enforcement |
| Skills = versioned markdown + schema | `skills/<name>/prompt.md + schema.ts + skill.config.ts` |
| Learning loop → playbook export | Retrospector role → ImprovementCandidate filing |
| Cost tracking per agent/model/phase | `AgentSpec.budgets` + `--max-budget-usd` at spawn |
| Decision summaries (the "why") | `decisionSummaries` in skill schema (CONTEXT.md canonical record) |

This is strong validation that Factory's architecture is on the right track. The main delta is that Steve's system uses disk-based state JSON while Factory uses GitHub Issues as source of truth + SQLite for operational state. Our model is more robust for multi-session persistence and audit trails.
