# Training: Building an Autonomous Fix Loop

How to build a self-improving measure-triage-fix-verify loop that finds problems,
fixes what it can, registers what it can't, and iterates until clean. This document
teaches the pattern; the companion template at the end is pluggable.

---

## What Is a Fix Loop?

A fix loop is an autonomous iteration cycle:

```
MEASURE -> TRIAGE -> FIX -> VERIFY -> (loop or done)
```

It replaces the human pattern of "run tests, read failures, fix something, run tests
again, hope nothing else broke" with a rigorous, tracked, state-machine-driven
process that:
- Persists findings to disk (survives session interruptions)
- Classifies findings by severity and fixability
- Dispatches specialized builders for fixes
- Verifies fixes AND checks for regressions
- Registers unfixable issues in an issue tracker
- Iterates N times or until clean

---

## The State Machine

```
INITIALIZING -> TESTING -> TRIAGING -> FIXING -> VERIFYING -> REPORTING
                   ^                                            |
                   +------------- loop (iteration N+1) ---------+
```

| Phase | What Happens |
|-------|-------------|
| **INITIALIZING** | Health checks, smoke gate, state init |
| **TESTING** | Run harness, collect findings |
| **TRIAGING** | Classify findings, route to fix or register |
| **FIXING** | Dispatch builders, apply fixes, restart services |
| **VERIFYING** | Re-run failing tests, regression check |
| **REPORTING** | Summarize iteration, decide: loop or done |

**No human gates.** The loop runs fully autonomously for N iterations. The user is
only involved at start (sets iteration count) and end (reviews final report).

---

## Phase Protocols

### INITIALIZING

The initializing phase confirms the system is healthy before testing begins.

1. **Infrastructure health checks:**
   - Services running (e.g., `docker ps`, process checks)
   - API health endpoint returns 200
   - Database connectivity + data availability

2. **Smoke gate (NON-SKIPPABLE):**
   ```bash
   harness_script --smoke-only
   ```
   If smoke fails, STOP. Fix the infrastructure issue first. Do not proceed to
   testing with a broken environment -- every finding will be noise.

3. **Advance:**
   ```bash
   state_tool advance TESTING
   ```

### TESTING (Measure)

1. **Run the full harness:**
   ```bash
   harness_script --full --json 2>&1 | tee /tmp/results.json
   ```

2. **Parse results.** The harness outputs structured JSON with:
   - Per-check pass/fail with evidence
   - Overall `ship_ready` boolean
   - Category-level summaries

3. **Register findings in state:**
   For each failure from the harness:
   ```bash
   state_tool add-finding "<summary>" <category> <severity> \
     --question "<what was tested>" --detail "<what went wrong>"
   ```

4. **Advance:**
   ```bash
   state_tool advance TRIAGING
   ```

### TRIAGING (Classify)

Load all findings and classify each into a fix queue:

| Category | Action | Criteria |
|----------|--------|----------|
| Bug (fixable) | Add to fix queue | Root cause is in code you control |
| Regression | Priority fix | Something that worked before now fails |
| Data accuracy | Investigate root cause | Is it code or data? Fix if code. |
| External dependency | Register in issue tracker | Cannot fix locally |
| Feature gap (small) | Fix if safe and obvious | <30 min fix, no architecture risk |
| Feature gap (large) | Register in issue tracker | Too large for the loop |

**Register unfixable findings immediately:**
```bash
issue_tool create \
  --title "Loop: <summary>" \
  --labels "<category_label>" "<priority_label>" \
  --finding-id "F-abc123" \
  --iteration 1 \
  --reproduce-steps "<exact reproduction steps>"
```

Then mark registered:
```bash
state_tool mark-registered F-abc123 <issue_id>
```

**Advance:**
```bash
state_tool advance FIXING
```

### FIXING

1. **Dispatch builders via sub-agents.**

   Use a file ownership model to prevent conflicts:

   | Builder | Owned Files | Scope |
   |---------|-------------|-------|
   | Fixer A | `service_a.py`, `handler_a.py` | Domain A queries |
   | Fixer B | `service_b.py`, `handler_b.py` | Domain B logic |
   | Orchestrator only | `routing.py`, `config.py` | Routing, config |

2. **Each builder follows plan-first protocol:**
   - Investigate root cause (read code, query data)
   - Write fix plan (before/after code, side effects considered)
   - Implement only after plan is reviewed
   - Report what changed

3. **After fixes -- restart/reload services:**
   ```bash
   # Clear caches if applicable
   restart_command
   # Verify service is healthy
   health_check_command
   ```

4. **Mark findings as fixed:**
   ```bash
   state_tool mark-fixed F-abc123
   ```

5. **Advance:**
   ```bash
   state_tool advance VERIFYING
   ```

### VERIFYING

1. **Re-run the EXACT tests that failed.** Not the full suite -- just the specific
   questions/scenarios from the findings.

2. **Regression check:** Re-run N previously-passing tests to confirm fixes didn't
   break anything.

3. **If new failures found:** Back to TRIAGING (within the same iteration). New
   failures from a fix are common -- the triage phase handles them.

4. **If clean:** Advance to REPORTING.

### REPORTING

1. **Generate iteration summary:**
   ```bash
   state_tool iteration-summary
   ```

2. **Check loop condition:**
   - If `iteration < max_iterations` AND there are still OPEN findings -> loop:
     ```bash
     state_tool advance TESTING
     ```
     (State machine auto-increments iteration counter on REPORTING -> TESTING)

   - If clean or max iterations reached -> present final report.

3. **Final report includes:**
   - Total findings across all iterations (found / fixed / registered / open)
   - Issue tracker links for registered items
   - Quality/accuracy scores
   - Iteration-by-iteration progression
   - Remaining open items (all registered -- nothing untracked)

---

## Finding Model

Every finding is a structured record:

```
Finding:
  id: "F-<hash>"            # Unique identifier
  summary: "string"          # Human-readable description
  category: enum             # BUG, DATA_ACCURACY, REGRESSION, FEATURE_GAP, etc.
  severity: enum             # P0 (blocks ship), P1 (degrades), P2 (minor), P3 (info)
  status: enum               # OPEN, FIXED, REGISTERED, WONT_FIX
  question: "string"         # What was tested (reproduction)
  detail: "string"           # What went wrong (evidence)
  iteration: int             # When it was found
  fix_iteration: int?        # When it was fixed (if applicable)
  issue_id: int?             # Issue tracker ID (if registered)
```

---

## The Fix-It-or-Register-It Rule

This is the single most important rule in the fix loop:

- **If you can fix it -> fix it.** No exceptions. No "we'll fix it later."
- **If you can't fix it safely -> register it** in an issue tracker with:
  - What was found
  - Why it can't be fixed autonomously
  - Suggested approach for a human
  - Exact reproduction steps (input -> expected -> actual)
- **The user should NEVER see a final report with untracked issues.**

This rule exists because "known issues" compound. Every untracked finding is a
future debugging session for someone who doesn't have the context you have right now.

---

## Issue Tracker Integration

Before creating an issue, check if one already exists:
```bash
issue_tool find --finding-id F-abc123
```

When a fix resolves a finding that had an issue, close it:
```bash
issue_tool close --id 42 --note "Fixed in iteration 2"
state_tool mark-fixed F-abc123
```

### Label Conventions

| Condition | Label | Priority |
|-----------|-------|----------|
| Bug that can't be fixed in loop | `loop::bug` | P1 |
| Feature too large for loop | `loop::feature-request` | P2 |
| Regression discovered | `loop::regression` | P0 |
| Data accuracy issue | `loop::data-accuracy` | P1 |
| External dependency issue | `loop::external` | P1 |

---

## Model Allocation

| Agent Type | Recommended Model | Why |
|------------|------------------|-----|
| Test runners / verification | Fast (Sonnet-class) | Reliable, focused work |
| Bug fixers | Strong (Opus-class) | Complex multi-file reasoning |
| Feature builders | Strong (Opus-class) | Architecture decisions |
| Log monitors / triage | Fastest (Haiku-class) | Pattern matching |

---

## Pluggable Template

Copy everything below into your project. This is a complete state machine skill
for an autonomous fix loop.

---

```markdown
---
name: {{loop-name}}
description: >
  Self-improving {{domain}} loop. Tests {{what_it_tests}}, finds {{what_it_finds}},
  fixes what it can, registers what it can't. Runs N iterations autonomously.
  Trigger: /{{loop-name}}, "{{trigger_1}}", "{{trigger_2}}"
---

# {{Loop Display Name}}

## 1. Identity

You are a **QA engineering lead** running a self-improving test loop against
{{system_under_test}}. You test like {{persona}}. You fix what you find. You
register what you can't fix. You don't stop until it's clean or you're out of
iterations.

**Your tools:**
- `python3 scripts/{{state_script}}.py` -- state machine
- `python3 scripts/{{harness_script}}.py` -- test runner
- `python3 scripts/{{issue_script}}.py` -- issue tracker
- `Task` tool -- dispatch fix builders

**Your constraints:**
- NEVER skip the smoke gate
- ALWAYS fix what you can before registering
- ALWAYS use fresh test inputs each iteration
- NEVER create worktrees or branches

---

## 2. State Machine

```
INITIALIZING -> TESTING -> TRIAGING -> FIXING -> VERIFYING -> REPORTING
                   ^                                            |
                   +------------- loop (iteration N+1) ---------+
```

---

## 3. Invocation

```bash
python3 scripts/{{state_script}}.py init --iterations {{default_N}}
```

---

## 4. Phase Protocols

### INITIALIZING

1. Health checks:
   ```bash
   {{health_checks}}
   ```

2. Smoke gate:
   ```bash
   python3 scripts/{{harness_script}}.py --smoke-only
   ```
   If smoke fails, stop. Fix the issue. Do not proceed.

3. Advance:
   ```bash
   python3 scripts/{{state_script}}.py advance TESTING
   ```

### TESTING

1. Run full suite:
   ```bash
   python3 scripts/{{harness_script}}.py --full --json 2>&1 | tee /tmp/results.json
   ```

2. Register findings:
   ```bash
   python3 scripts/{{state_script}}.py add-finding "<summary>" <category> <severity> \
     --question "<question>" --detail "<detail>"
   ```

3. Advance:
   ```bash
   python3 scripts/{{state_script}}.py advance TRIAGING
   ```

### TRIAGING

| Category | Action |
|----------|--------|
| {{category_1}} (fixable) | Add to fix queue |
| {{category_2}} | Register in issue tracker |
| {{category_3}} | Priority fix (regression) |

Register unfixable:
```bash
python3 scripts/{{issue_script}}.py create \
  --title "{{prefix}}: <summary>" \
  --labels "{{label}}" "priority::P1" \
  --finding-id "F-abc123"
```

Advance: `python3 scripts/{{state_script}}.py advance FIXING`

### FIXING

1. Dispatch builders:

   | Builder | Files | Scope |
   |---------|-------|-------|
   | Fixer A | {{files_a}} | {{domain_a}} |
   | Fixer B | {{files_b}} | {{domain_b}} |

2. Plan-first: investigate -> plan -> implement -> report
3. Restart: `{{restart_command}}`
4. Mark fixed: `python3 scripts/{{state_script}}.py mark-fixed F-abc123`
5. Advance: `python3 scripts/{{state_script}}.py advance VERIFYING`

### VERIFYING

1. Re-run exact failing tests
2. Regression check: {{N}} previously-passing tests
3. New failures -> back to TRIAGING
4. Clean -> `python3 scripts/{{state_script}}.py advance REPORTING`

### REPORTING

1. Summary: `python3 scripts/{{state_script}}.py iteration-summary`
2. Loop: if `iteration < max` AND open findings -> advance TESTING
3. Done: present final report (found/fixed/registered/open, issue links, scores)

---

## 5. Model Allocation

| Agent Type | Model | Why |
|------------|-------|-----|
| Test runners | {{fast_model}} | Reliable verification |
| Bug fixers | {{strong_model}} | Multi-file reasoning |
| Log monitors | {{fastest_model}} | Pattern matching |
```

---

**End of Fix Loop Training Document**
