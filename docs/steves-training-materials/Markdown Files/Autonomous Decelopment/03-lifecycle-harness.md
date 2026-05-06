# Training: Building a Lifecycle Harness

How to build a full autonomous development lifecycle -- a state machine that takes
a feature from plan through build, verification, fix loops, and ship. This document
teaches the architecture; the companion template at the end is a pluggable skeleton.

---

## What Is a Lifecycle Harness?

A lifecycle harness is a **state machine** that orchestrates the entire development
process for a feature: planning, harness design, building, verification, triage,
fix loops, code review, and shipping. It replaces ad-hoc "build then manually test"
with a rigorous, gate-checked, iterative process.

The harness operator (Claude or a human) never writes production code directly --
they delegate to builders, dispatch reviewers, run verification harnesses, and make
judgment calls. The lifecycle tracks everything: state, gates, findings, costs,
quality scores, and iteration history.

---

## The 10-Phase State Machine

```
PLANNING -> HARNESS_DESIGN -> BUILDING -> SPEC_DRIFT_CHECK -> REGRESSION_GATE
                                                                    |
                                                                    v
COMPLETED <- PENDING_AUDIT <- REVIEW_READY <- TRIAGING <--------+
                                  |              |
                                  |              v
                                  +---------- FIX_LOOP -> (back to SPEC_DRIFT_CHECK)
```

| Phase | Purpose | Exit Gate(s) |
|-------|---------|-------------|
| **PLANNING** | Produce engineering spec with falsifiable ACs | `plan_review` |
| **HARNESS_DESIGN** | Encode ACs into 3-tier automated verification | `harness_baseline_recorded`, `harness_review`, `tier_distribution_check` |
| **BUILDING** | Dispatch builders, execute plan | (none -- advance when WPs complete) |
| **SPEC_DRIFT_CHECK** | Verify built code matches planned interfaces | `spec_drift_check`, `stub_detection` |
| **REGRESSION_GATE** | Run 3-tier harness, compute quality score | `harness_verification` |
| **TRIAGING** | Classify failures, plan fixes | (decision: FIX_LOOP or REVIEW_READY) |
| **FIX_LOOP** | Execute fixes, bump iteration | (back to SPEC_DRIFT_CHECK) |
| **REVIEW_READY** | Code quality audit + final review | `code_quality_audit` + mode approval |
| **PENDING_AUDIT** | Final approval before ship | `qa_verification` |
| **COMPLETED** | Feature shipped (terminal) | -- |

**Edge phases:** ESCALATED (user pulled back in), BLOCKED (waiting for dependency).

---

## Two Modes: Gated vs Autonomous

| Mode | Human Gates | Auto-Gate Behavior |
|------|-------------|-------------------|
| **Gated** (default) | HARNESS_DESIGN + REVIEW_READY | User approves harness design and final review |
| **Autonomous** | None (escalation only) | Auto-approve when quality criteria met |

### Gated Mode

The lifecycle blocks at two points:
1. **After harness design** -- user reviews the verification plan before any code is written
2. **After review** -- user reviews all code quality checks before shipping

### Autonomous Mode

The lifecycle auto-approves when criteria are met:
1. **Harness design** -- baseline recorded + mutation tests caught defects + review converged
2. **Review** -- code quality score >= threshold + all P0/P1 fixed + quality convergence

**Max iterations:** Gated = 3 (user can extend). Autonomous = 5 (more room for auto-fixes).

---

## Gate System

Gates are checkpoints that must be satisfied before advancing to the next phase.

### Gate Status Values

| Status | Meaning |
|--------|---------|
| PENDING | Not yet evaluated |
| PASSED | Requirement met |
| FAILED | Did not meet requirement |
| SKIPPED | Agent skipped with logged reason (only for skippable gates) |

### Non-Skippable Gates

Some gates can never be skipped, regardless of circumstances:
- `harness_verification` -- harness MUST pass
- `harness_baseline_recorded` -- baseline MUST be established before build
- `stub_detection` -- must verify no test stubs remain
- `qa_verification` -- final QA approval is binding
- `code_quality_audit` -- code quality must meet ship threshold

### Gate Recording

```bash
# Record a gate as passed
state_tool record-gate <gate_name> passed "<evidence>"

# Record a gate as skipped (only for skippable gates)
state_tool record-gate <gate_name> skipped "" "<reason>"

# Check current gate status
state_tool gate-check
```

### Phase Advancement Logic

```
1. Check all required exit gates for current phase
2. If mode is gated, add mode-conditional approval gate
3. Check carried-forward failures from prior iterations
4. If all satisfied -> advance allowed
5. If any unsatisfied -> advance blocked (list unsatisfied gates)
```

---

## The Three Tiers of Verification

Every verification harness must check all three tiers:

| Tier | Question | Method | Example |
|------|----------|--------|---------|
| **Tier 1: Structural** | Was the change executed? | Grep, file existence, AST checks | Pattern appears/doesn't appear in codebase |
| **Tier 2: Functional** | Does the new code work? | Runtime imports, API calls, Playwright | Module instantiates, endpoint returns 200, UI renders data |
| **Tier 3: Regression** | Did it break anything? | End-to-end flows, smoke tests | Core user journeys still work, cross-feature smoke passes |

**Anti-pattern:** A harness that is 90% Tier 1 and 10% Tier 3. This proves code was
shuffled around but gives no confidence it works or that nothing broke.

**Tier distribution guidance:**

| Change Scope | Tier 1 | Tier 2 | Tier 3 |
|-------------|--------|--------|--------|
| Code elimination | Heavy | Light | Medium |
| Service consolidation | Light | Heavy | Heavy |
| API refactor | Medium | Heavy | Heavy |
| UI component change | Light | Heavy (Playwright) | Heavy (Playwright) |

---

## Work Package System

Each unit of work is a **Work Package (WP)** with:
- Unique ID (WP1, WP2, ...)
- File ownership (which files this WP touches)
- Acceptance criteria
- Builder assignment (which model/agent)
- Dependencies (which WPs must complete first)

**File ownership prevents conflicts:** No two WPs can own the same file. If they
must share, one WP creates the interface and the other consumes it.

---

## Quality Scoring

Quality is scored across multiple dimensions:

| Factor | What It Measures |
|--------|-----------------|
| P0/P1/P2/P3 counts | Severity of findings |
| Regressions open | Known failures ledger |
| Review convergence | Did adversarial review converge? |
| UAT passed | User acceptance testing |
| Static analysis | Lint/type-check clean |
| Work review | Adversarial code review approved |
| Harness pass rate | Layers passed / total |

**Convergence check:** Quality must be improving iteration-over-iteration. If the
quality score regresses (gets worse), something is wrong -- investigate before
continuing.

---

## Cost Tracking

Track spend per agent, per model, per phase:

```bash
state_tool record-cost <agent_type> <model> --input-tokens N --output-tokens N --wp WP1
```

Model pricing tiers:
| Model | Input ($/M tokens) | Output ($/M tokens) |
|-------|-------------------|-------------------|
| Strong (Opus-class) | ~15.00 | ~75.00 |
| Fast (Sonnet-class) | ~3.00 | ~15.00 |
| Cheap (Haiku-class) | ~0.25 | ~1.25 |

---

## The Fix Loop

The fix loop is the iterative core: TRIAGING -> FIX_LOOP -> SPEC_DRIFT_CHECK ->
REGRESSION_GATE -> TRIAGING -> (repeat or advance).

Each iteration:
1. **Classifies findings** by severity and fixability
2. **Dispatches builders** to fix what's fixable
3. **Re-runs verification** to confirm fixes and catch regressions
4. **Bumps iteration counter** (resets affected gates to PENDING)

**Critical rule: "Known issue" does not exist.** Every finding is either FIXED or
ESCALATED. No deferral, no "we'll fix it later."

---

## Lessons Learned

1. **The planning loop is where quality happens.** 7 rounds of plan review that
   catch 37 gaps save 15-30 hours of build iteration.

2. **Build the harness before the code.** The harness defines "done." If you build
   code first, you're guessing at what "done" means.

3. **The harness will have bugs.** Fix them immediately alongside the production
   code they gate. A false-positive harness is worse than no harness.

4. **Carried gate failures prevent regression amnesia.** If a gate failed in
   iteration 1 and wasn't fixed, it stays failed in iteration 2. You can't just
   re-run and hope.

5. **Never defer findings.** Every finding fixed in the lifecycle costs 10 minutes.
   Every finding deferred to "later" costs hours when someone rediscovers it.

---

## Pluggable Template

Copy everything below into your project. Adapt the phases, gates, and scripts to
your domain.

---

```markdown
# {{PROJECT_NAME}} -- Autonomous Development Lifecycle

## 1. Identity

You are a **senior technical engineering manager**. You NEVER write production code.
You plan, delegate, review, make judgment calls, and steer. Sub-agents execute.

**Your tools:**
- `Task` tool -- dispatch builders, reviewers, verifiers
- `python3 scripts/{{state_script}}.py` -- state machine
- `python3 scripts/{{harness_script}}.py` -- verification harness
- Adversarial review tool (Codex, Grok, or peer agent)

**Your constraints:**
- NEVER write production code directly -- delegate to builders
- NEVER skip the harness baseline -- non-negotiable before building
- NEVER advance past {{HUMAN_GATE_1}} or {{HUMAN_GATE_2}} without user approval (gated mode)
- ALWAYS log decisions -- every skip, every scope change, every judgment call
- NEVER defer findings -- fix it or escalate it

---

## 2. State Machine

```
PLANNING -> HARNESS_DESIGN -> BUILDING -> VERIFICATION -> TRIAGING
                                                            |
COMPLETED <- REVIEW <- -------------------------------- FIX_LOOP
```

### Phase Exit Gates

| Phase | Required Gates |
|-------|---------------|
| PLANNING | `{{plan_review_gate}}` |
| HARNESS_DESIGN | `{{harness_gates}}` |
| VERIFICATION | `{{verification_gate}}` |
| REVIEW | `{{review_gates}}` |

### Non-Skippable Gates

- `{{gate_1}}` -- {{why it can't be skipped}}
- `{{gate_2}}` -- {{why it can't be skipped}}

### Modes

| Mode | Human Gates | Auto-Approve Criteria |
|------|-------------|----------------------|
| Gated | {{phases}} | User approves |
| Autonomous | None | Quality score >= {{threshold}} + all P0/P1 fixed |

---

## 3. Phase Protocols

### PLANNING

See `docs/training/01-planning-phase.md` for the full protocol.

Output: Engineering specification at `{{plans_dir}}/{{feature}}.md`
Gate: `{{plan_review_gate}}` -- adversarial review converges

### HARNESS_DESIGN

1. Read the plan's acceptance criteria
2. Design a harness with layers across all three tiers:

   | Tier | Layers | Method |
   |------|--------|--------|
   | Structural | {{layers}} | Grep, file existence, AST |
   | Functional | {{layers}} | Runtime, API, Playwright |
   | Regression | {{layers}} | E2E flows, smoke tests |

3. Record baseline:
   ```bash
   {{state_tool}} -f {{feature}} record-gate harness_baseline_recorded passed
   ```

4. User approval (gated mode):
   Present the harness design. Wait for approval.

### BUILDING

1. Assign work packages:
   ```bash
   {{state_tool}} -f {{feature}} assign-wp WP1 "builder-opus" "{{files}}"
   ```

2. Dispatch builders via Task tool (one per WP):
   ```
   Task(
       description="WP1: {{description}}",
       prompt="{{builder_instructions}}",
       model="{{model}}"
   )
   ```

3. Track completion:
   ```bash
   {{state_tool}} -f {{feature}} complete-wp WP1
   ```

### VERIFICATION (Spec Drift + Regression)

1. Run spec drift check:
   ```bash
   {{harness}} --spec-check --json
   {{state_tool}} -f {{feature}} record-gate spec_drift_check passed
   ```

2. Run full harness:
   ```bash
   {{harness}} --full --json
   ```

3. Record results:
   ```bash
   {{state_tool}} -f {{feature}} record-harness-run {{results}}
   {{state_tool}} -f {{feature}} record-gate harness_verification passed|failed
   ```

### TRIAGING

1. Load harness results
2. Classify findings:

   | Severity | Criteria | Action |
   |----------|----------|--------|
   | P0 | Blocks ship | Fix immediately |
   | P1 | Degrades quality | Fix this iteration |
   | P2 | Minor issue | Fix if time permits |
   | P3 | Informational | Log only |

3. Route:
   - Any fixable findings -> FIX_LOOP
   - Zero fixable findings -> REVIEW_READY

### FIX_LOOP

1. Dispatch fixers (same WP ownership model)
2. Mark findings fixed
3. Bump iteration
4. Return to VERIFICATION

### REVIEW

1. Run code quality audit:
   ```bash
   {{code_quality_tool}} --target {{path}} --json
   {{state_tool}} -f {{feature}} record-gate code_quality_audit passed
   ```

2. Run adversarial work review

3. User approval (gated) or auto-approve (autonomous):
   ```bash
   {{state_tool}} -f {{feature}} record-gate {{approval_gate}} passed
   ```

### COMPLETED

Terminal state. Generate final report:
- Iterations: {{N}}
- Quality score: {{score}}/100
- Gates satisfied: {{list}}
- Total cost: ${{amount}}
- Files changed: {{list}}
```

---

**End of Lifecycle Harness Training Document**
