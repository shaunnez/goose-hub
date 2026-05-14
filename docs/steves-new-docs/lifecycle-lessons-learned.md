# Lifecycle Harness — Lessons Learned & Standards (v2)

Distilled from two complete lifecycles that went through the full planning → building → Codex convergence loop:

- **`ws-logout-disconnect`**: 3 build iterations, 11 Codex work reviews, 17 investigation agents, 8 haiku paranoia agents. Shipped 8 WPs across 11 files.
- **`session-architecture-redesign`**: 7 Codex plan review rounds (codex-012 through codex-026), 37 architectural gaps found and resolved, 4 Sonnet investigators, 12 Haiku auditors, 9-layer programmatic harness. 5 deployment phases.

These lessons are universal — they apply to any lifecycle on any project using this harness.

---

## 1. The Planning Loop Is Where Quality Happens

### What We Learned

The `ws-logout-disconnect` lifecycle went to PLAN_REVIEW after 1 Codex round. It worked but required 3 build iterations and 6 Codex-found bugs to fix in code. The `session-architecture-redesign` lifecycle ran **7 Codex plan review rounds** before writing a single line of code. Each round found 3-8 new issues. By the time building started, the spec was so detailed that builders executed mechanically — no design decisions at build time.

**The math:** Fixing a design gap in the spec takes 5 minutes (edit the plan). Fixing the same gap in code takes 30-60 minutes (understand the code, change it, test it, Codex review it, fix Codex findings). A 7-round planning loop that catches 37 gaps saves 15-30 hours of build iteration.

### Standard: Codex Plan Review Until Convergence

```
Round 1: Parallel adversarial agents (2+). Expect 5-10 findings.
Round 2: Address findings, re-run. Expect 3-6 more.
Round 3+: Continue until TWO CONSECUTIVE ROUNDS find no new CRITICAL issues.
         MEDIUM/LOW findings can be captured as builder instructions.
```

**Convergence criteria (strict):**
- Two consecutive rounds where no new CRITICAL findings
- All prior CRITICAL + HIGH findings have explicit resolutions in the spec
- Every resolution references a specific phase/WP where it's implemented

**Never stop at one round** for: auth, session, security, data integrity, payment, or any system that touches user trust.

### Standard: Unrestricted Adversarial Prompts

Early rounds had focused prompts ("check file paths", "verify builder independence"). They found surface issues. The breakthrough came when we switched to:

```
"Comprehensive adversarial review. No constraints. Break it if you can."
```

This found: commit boundary problems, privilege demotion gaps, close code overloading, org-scoped termination needs, rolling deploy incompatibilities, and the fundamental question "why is this harder than OpenWebUI?"

**Rule: Every Codex round MUST include at least one agent with zero focus constraints.** The context should summarize what prior rounds found so the agent builds on previous work, but the focus field should be wide open.

### Standard: Devil's Advocate Agent

At least one Codex agent per round should challenge the fundamental approach:
- "Is this the right pattern? Propose alternatives."
- "Is this too complex? What's the simpler version?"
- "What would a senior engineer push back on?"
- "What's the minimum change that fixes the user's actual bugs?"

The `session-architecture-redesign` devil's advocate (codex-017) proposed the most valuable insight: **"Don't wrap SessionService — absorb it."** And: **"5 phases instead of 10 WPs."** And: **"Consider a transactional outbox instead of direct publish."** These reshaped the entire spec.

---

## 2. Investigation Before Design, Not During

### What We Learned

The `ws-logout-disconnect` investigation swarm (3 Sonnet + 8 Haiku) ran in parallel and completed in ~3 minutes. The findings directly shaped the spec — no speculation, no "I think this file does X." Every claim was grounded in file:line references.

The `session-architecture-redesign` used 4 targeted Sonnet investigators:
- S1: SessionService API audit → found 6/7 methods are dead code
- S2: Frontend session management audit → tagged every item as KEEP/REMOVE/SIMPLIFY
- S3: Redis infrastructure → confirmed Pub/Sub + PG persistence is correct, no Streams needed
- S4: All termination callers → mapped 24 call sites with cleanup status

Each investigator answered a SPECIFIC question. They didn't explore — they reported facts.

### Standard: Wave 1 Scouts (4-6 Sonnet, background)

| Role | Question | Output Format |
|------|----------|---------------|
| Schema/API Scout | What methods exist? Which are called? Which are dead? | Table: method, callers, status |
| Frontend Audit | What exists? What's KEEP/REMOVE/SIMPLIFY? | Tagged inventory with file:line |
| Infrastructure Scout | What's the data model? What's the deployment model? | Key patterns, TTLs, failover |
| Call Site Mapper | Every place that mutates the target data | Table: file:line, trigger, cleanup status |

**Rules:**
- ALL run in background (`run_in_background: true`)
- Each gets a focused prompt (<500 words) with exact files to examine
- Report format is structured (tables, not prose)
- Constraint: "Report FACTS only — do not design solutions"

### Standard: Haiku Paranoia Swarm (8-12, background)

After Wave 1, launch haiku agents to saturate the search space:
- One per cross-cutting concern (auth races, error handling, state leaks, cross-tab sync, etc.)
- Each searches exhaustively across the ENTIRE affected system
- Cheap and fast — use liberally for coverage

The `ws-logout-disconnect` haiku swarm found: 30+ raw fetch calls without auth guards, cross-tab desync (no BroadcastChannel for auth), CSRF realm selection bugs, error boundary gaps, and UI hang states. These were things the Sonnet investigators didn't look for because they had focused scopes.

---

## 3. Programmatic Harness — The Accountability Layer

### What We Learned

The `session-architecture-redesign` created a 9-layer verification harness (`verify_session_authority.py`) that programmatically checks for session fragmentation. Before building: 4/9 passing. After Phase 3: 9/9 passing. The harness caught real issues — Layer 4 found the enum mismatch, Layer 3 found missing session_id in token paths.

But the initial harness had bugs: Layer 4 scraped all enums (not just TerminationReason), Layer 8 flagged non-session expires_at usage, Layer 9 checked for `after_commit` when we switched to transaction-local queues. Each harness bug required a fix-and-rerun cycle.

### Standard: Build the Harness in Phase 1

The verification harness should be the FIRST thing built — before any production code. It defines the "done" criteria programmatically.

```
Phase 0 (implicit): Build harness. Run it. Document baseline (expected failures).
Phase 1: Compatibility shims. Harness gate: layers X, Y pass.
Phase 2: Core service. Harness gate: layers X, Y, Z, W pass.
...
Phase N: Cleanup. Harness gate: ALL layers pass.
```

### Standard: Harness Layer Design

Each harness layer should:
1. Check ONE specific invariant
2. Grep/AST-parse actual code (not trust claims)
3. Return PASS/FAIL with specific file:line findings
4. Have a "strict" mode (fail on informational findings) for post-migration
5. Be updatable as the design evolves (the harness is code, not a static checklist)

Good layers we built:
- **Authority violations** — grep for direct writes outside the authority service
- **Close code consistency** — each WS close code has ONE semantic meaning
- **Token completeness** — all minting paths include required fields
- **Enum sync** — values in enum A match values in enum B
- **Inventory drift** — detect new mutation sites added after the redesign
- **Frontend timer regression** — no new session-management timers
- **Raw fetch detection** — find unguarded API calls in protected pages

### Standard: Harness Evolves With the Design

The harness will have false positives. Fix them immediately:
- Layer 4 scraped all enums → fix to only scrape TerminationReason class
- Layer 8 flagged non-session expires_at → fix to only check session-related files
- Layer 9 checked for wrong pattern → fix to match actual side-effect pattern

Each harness fix should be committed alongside the production code it gates.

---

## 4. Architecture Standards

### Authority Over Data Models (The Root Cause)

The session system had 24 scattered mutation sites because `UserSession` had no authority service. `SessionService` existed (with correct methods) but nobody wired it in. Every feature built its own inline logic.

**Rule: For EVERY new table or significant schema change:**
1. Create the data model
2. Create the authority service (one class, all mutations)
3. Make direct writes forbidden (harness layer enforces this)
4. Add side effects to the service, not to callers
5. Document: "To modify X, call Y.method(). Never write directly."

### One Model, One Enum

Two competing invalidation models (`expires_at` vs `terminated_at`) coexisted for months. Two reason taxonomies (`TerminationReason` vs `UserEvictionEvent.reason`) didn't map to each other.

**Rule:** Every lifecycle that introduces a new enum, status, or state model must:
- Check if an existing enum/model covers the same concept
- If yes: extend it
- If no: create ONE canonical version, use everywhere
- Harness layer: verify enum A values ⊆ enum B values

### Absorb, Don't Wrap

The initial spec (v3) proposed `SessionManager` as a wrapper around `SessionService`. Codex-017 pointed out this preserves complexity — two services, delegation pattern, potential cycle.

**Rule:** When creating a new authority service that replaces scattered logic:
- **Absorb** the old service's methods (move them into the new service)
- **Delete** the old service (or keep as import shim during migration)
- **Never wrap** — wrapping creates layers without reducing complexity

### Post-Commit Side Effects

Three iterations of the commit pattern:
1. v1: SessionManager commits (broke caller transactions)
2. v3: `after_commit` SQLAlchemy event (persists through rollback)
3. v6: Transaction-local queue + explicit `flush_side_effects()` (correct)

**Rule:** Services that trigger side effects (Redis, WS, tasks) on DB mutations:
- Use a **transaction-local queue** (list on the db session object)
- Queue is cleared on rollback (new list per transaction)
- Caller or middleware calls `flush_side_effects()` after commit
- Middleware is the preferred pattern (guarantees flush, no forgotten calls)

### Rolling Deploy Safety

Codex-018 found that `extra="forbid"` on Pydantic models causes old pods to reject new Redis hash fields during rolling deploy.

**Rule:** Phase 1 of every lifecycle that changes shared state:
1. Make readers forward-compatible (`extra="allow"`, expanded enums)
2. Deploy Phase 1 alone
3. Verify old + new pods coexist
4. Then make schema changes in Phase 2+
5. Revert to `extra="forbid"` in final cleanup phase

### Close Code / Status Code Discipline

Codex-023 found 4001 was used for 5+ different WS close reasons. Mapping it to auth:failure would cause spurious logouts.

**Rule:** Each status/close/error code must have ONE semantic meaning:
- Document the code → meaning mapping
- Harness layer enforces: each code appears with ≤2 unique reason strings
- When adding new semantics, add a new code (4010 for session termination)

---

## 5. The Build Loop

### What We Learned

The autonomous build loop pattern works:
```
Build Phase N → Codex work review → Harness gate check → Fix findings → Repeat until clean → Next phase
```

Phase 3 (the big switchover — 14 files, 30+ call sites) completed in one pass because the spec was so detailed that the builder executed mechanically. No design decisions at build time. Every call site was named with file:line. Every replacement was specified.

### Standard: Builder Instructions Must Be Complete

Each builder gets:
- Exact files they own (no overlap with other builders)
- Every change described with current code → new code
- File:line references (approximate is OK — builder reads to confirm)
- Acceptance criteria that are checkable (compile, test, harness layer)
- Rules: no git ops, no worktrees, read before writing

**The test:** Could a Sonnet builder (not Opus) execute this WP? If yes, the instructions are complete. If no, add more detail.

### Standard: Harness Gates Per Phase

```
Phase 1 complete → Layers X, Y pass
Phase 2 complete → Layers X, Y, Z, W pass
Phase 3 complete → Layers X, Y, Z, W, A, B, C pass
...
Final phase → ALL layers pass
```

Each phase MUST pass its gate layers before the lifecycle advances. The harness is the programmatic gatekeeper — not human judgment, not "I think it's fine."

### Standard: Codex Work Review on Every Phase

Not just plan review — EVERY built phase gets a Codex work review:
```
codex_review_work_start(
    plan_file=".claude/plans/...",
    work_summary="Phase N complete: [what changed]",
    changed_files=[...],
    context="Phase N of M. [what to check]"
)
```

Codex work reviews found: TTL not refreshed (WP1), tenant eviction gap (WP2), auth listener race (WP3), periodic retry dies on token failure (WP4), validation counter not reset on login (WP6). Each would have been a production bug.

---

## 6. Frontend Standards

### Backend Authority, Frontend Agnostic

The frontend had 4 compensating timers because it didn't trust the backend. Every timer was a workaround for missing backend authority.

**Rule:** For session/auth:
- Backend owns all lifecycle decisions
- Frontend receives signals and acts (no polling, no timers)
- `authFetch` 401-retry is the ONLY acceptable reactive mechanism
- WS close code 4010 → auth:failure → logout is the primary signal
- BroadcastChannel for cross-tab sync (KEEP)

### Map Close Codes to Auth Events, Don't Create New Message Types

The original plan proposed a `session_terminated` WS message. Codex-020 pointed out that just mapping close code 4010 to `auth:failure` achieves the same UX with zero new message types.

**Rule:** Prefer reusing existing signal mechanisms over creating new ones. Close codes are already part of the WS protocol — use them.

---

## 7. Process Anti-Patterns

| Anti-Pattern | What Happens | What We Did Instead |
|---|---|---|
| "We'll fix it later" phasing | Later never comes. Tenant session_id was "planned" but never shipped. | Tenant session_id embedded NOW. No phasing. |
| One Codex round on a complex spec | Surface issues found, 30+ architectural gaps missed | 7 rounds until convergence |
| Focused Codex prompts only | Misses cross-cutting concerns (privilege demotion, close code overloading) | Unrestricted adversarial + devil's advocate |
| Wrapping dead code | Two services, delegation pattern, cycles | Absorb or delete |
| Frontend compensating for backend gaps | 4 timers masking missing backend authority | Fix the backend, remove the timers |
| Direct DB writes to shared models | 24 mutation sites, no consistency | One authority service, harness enforces |
| SessionManager commits internally | Breaks caller transactions (suspend org + sessions in one tx) | Transaction-local queue, middleware flush |
| `extra="forbid"` without deploy plan | Old pods crash during rolling deploy | Phase 1 = `extra="allow"` first |
| Overloaded status/close codes | 4001 used for 5+ things, mapping to logout causes spurious logouts | Dedicated 4010 for session termination |
| MVP quality on foundation code | Session bugs persist for months, credibility lost | Production-grade from day 1, never revisit |
| Building before the spec converges | 3 build iterations, 6 Codex-found code bugs | 7 plan iterations, 0 architectural surprises at build time |
| Trusting the harness without validating it | False positives (scraped wrong enum, flagged non-session code) | Fix harness bugs immediately, commit alongside production code |

---

## 8. Metrics for Production-Grade Specs

Before PLAN_REVIEW, validate:

| Metric | Target | How to Check |
|--------|--------|-------------|
| Codex convergence | 2 consecutive rounds, 0 new CRITICALs | Decision log shows round N and N+1 clean |
| Call site inventory | 100% of mutations named with file:line | Investigation agent S4 + Codex cross-check |
| AC coverage | Every gap → AC with verification command | Count: gaps found ≥ ACs defined |
| Negative ACs | ≥ 30% test "X does NOT happen" | Count negative ACs / total ACs |
| Enum consistency | ONE canonical version everywhere | Harness layer check |
| Rolling deploy plan | Phase 1 is always compatibility shims | Phase 1 description is "zero behavior change" |
| Dead code disposition | Every dead module: absorb, delete, or tracked | Grep for unused methods matches plan |
| Authority enforcement | Harness layer for direct writes = 0 | Harness passes on baseline |
| Side effect safety | Post-commit only, rollback-safe | Design doc shows transaction pattern |
| Frontend timer count | 0 session timers (or justified) | Grep for setInterval in auth code |

---

## 9. The Lifecycle Improvement Loop

This document itself should be versioned and improved after each lifecycle:

1. After SHIP_REVIEW: Record what Codex found that the harness didn't catch
2. After production deployment: Record what users found that Codex didn't catch
3. After each lifecycle: Update anti-patterns with new failures observed
4. After each lifecycle: Update metrics with new thresholds learned

The goal: each lifecycle is better than the last because the harness, the standards, and the Codex prompts all improve from accumulated experience.

**v1 was written after ws-logout-disconnect (bandaid lifecycle).**
**v2 incorporates session-architecture-redesign (root cause lifecycle) — 7 Codex rounds, 37 gaps, programmatic harness, production-grade standard.**
**v3 incorporates dark factory Pillars 1+2 (composable-harness-framework + autonomous-lifecycle-v2) — 9+ Codex rounds, constraint-forward planning, advisory hooks.**

---

## 10. v3 Additions — Dark Factory Learnings

### Constraint-Forward Planning

**Lesson:** During Pillar 1, 32+ Codex findings fell into 5 categories: grounding failures (assumed instead of verified), enforcement gaps (described intent without tracing execution), ordering failures (didn't walk the sequence), verification gaps (construction checks not behavioral proofs), consistency failures (iterative edits without final pass). All were catchable by reading actual code before writing the spec.

**Standard:** Add Steps 5b/5c/5d to PLANNING between spec assembly and Codex review:
- **5b Constraint Inventory:** Read actual enums, gates, hooks, models, script outputs BEFORE designing. Write a "Constraints This Spec Must Respect" section FIRST.
- **5c Dry-Run Simulation:** Dispatch 3-4 Sonnet agents to ACTUALLY trace code paths (phase transitions, hook invocations, method side effects, WP dependency graph). Not a mental once-over — agents reading actual code.
- **5d Self-Challenge:** For each AC: INPUT, ACTION, OUTPUT, SIDE EFFECT, FAILURE MODE. Convert construction checks to behavioral proofs.

### Hooks Are Advisory, Not Enforcement

**Lesson:** Hard hook enforcement (exit code 2) creates brittleness. Builders work around it with Bash heredoc. The "enforcement" doesn't prevent anything, just slows down legitimate work. During Pillar 1, builders were blocked from creating their assigned files by the very hooks the lifecycle was building.

**Standard:** Hooks WARN (advisory, exit 0 with context message) rather than BLOCK (exit 2). The master planner provides oversight, not the hooks. Only the core phase gate (wrong-phase edits to owned files) should hard-block.

### Recurring Issues Need Systemic Fixes

**Lesson:** Gate naming inconsistency came back across 3 Codex rounds because each round got a spot-fix (fix this reference) instead of a systemic fix (grep for ALL references). Same pattern with backwards-compat language that kept leaking into new ACs.

**Standard:** When Codex flags a consistency issue, the fix is a global grep-and-replace across the spec, not a single-line edit. The composable harness should include a "consistency sweep" layer type, and 5c dry-run agents should include a consistency auditor.

### Self-Referential Infrastructure Requires Special Handling

**Lesson:** Building the harness framework required a WP-ownership exception in the harness protection hooks. Building the lifecycle phases requires understanding that the old phases will break the hooks mid-build.

**Standard:** When modifying infrastructure that the lifecycle itself depends on (hooks, state machine, harness), the plan must include a "bootstrap sequence" that handles the chicken-and-egg: what changes first, what breaks during the transition, how to keep the lifecycle functional while replacing its own foundations.

### Haiku Spot-Check Swarm

**Lesson:** During Pillar 2, dispatching 3 haiku agents to spot-check WP1 and WP6 caught potential issues immediately — all passed, which gave confidence to proceed. The cost was negligible (~10s each) and the coverage was real (enum values, transition table, hook phase names, CLI flags).

**Standard:** After every WP completion and before dispatching the next wave, run 1-2 haiku agents that:
- Verify the specific ACs that WP claimed to satisfy
- Grep for stale references the WP should have cleaned up
- Run a quick import/compile check on modified files

This is the development equivalent of "measure twice, cut once" — cheap verification prevents expensive rework.

### Every Script Needs a JSON-Parsability AC

**Lesson:** The `--json` bug recurred across both Pillars — `verify_composable_harness.py` (Pillar 1) and `verify_autonomous_lifecycle.py` (Pillar 2) both shipped with broken JSON output (ANSI mixed into stdout). The root cause: no AC proved that `script --json 2>/dev/null | python3 -c "json.load(sys.stdin)"` actually works.

**Standard:** Every WP that creates a script with `--json` must include this AC:
```
script.py --json 2>/dev/null | python3 -c "import sys,json; json.load(sys.stdin)" exits 0
```
This should be a standard AC in the Engineering Spec Template (Section 11) and eventually a composable harness regression layer.

### Iteration Discipline

**Lesson:** In Pillar 1 iteration 2, the orchestrator rushed to fix findings without planning the fixes. User corrected: "plan these out, not just spot fix it." Ad-hoc dispatch without ACs is the same anti-pattern the harness is designed to prevent.

**Standard:** Each iteration gets the same rigor as iteration 1: plan the fixes, define ACs for each fix, dispatch builders with clear instructions, verify after. The lifecycle process applies to itself.
