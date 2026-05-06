# Training: Building a Claude Code Skill

How to build a production-grade Claude Code skill from scratch. This document
teaches the anatomy, patterns, and principles; the companion template at the end
is a pluggable skeleton you fill in for your specific skill.

---

## What Is a Skill?

A skill is a self-contained Markdown prompt that gives Claude a specific role,
tools, constraints, and a state machine to follow. When triggered (by slash command
or natural language), Claude reads the SKILL.md and operates according to its
instructions -- no custom code needed beyond the prompt and any companion scripts.

Skills live in `.claude/skills/<skill-name>/SKILL.md`.

---

## Anatomy of a SKILL.md

Every skill has the same 7-section structure:

### 1. Frontmatter (YAML)

```yaml
---
name: my-skill
description: >
  One-paragraph description of what the skill does.
  Include trigger phrases: /my-skill, "natural language triggers", "alternate phrasings"
  Include constraints or special behaviors.
---
```

The description field is critical -- it's how Claude decides whether to auto-trigger
the skill. Include:
- What the skill does (1 sentence)
- All trigger phrases (slash commands and natural language)
- Key constraints (if the skill should NOT trigger in certain contexts)

### 2. Identity + Tools + Constraints

```markdown
## 1. Identity

You are a **[role]**. You [do X]. You [don't do Y]. You [always do Z].

**Your tools:**
- `command-or-script-1` -- what it does
- `command-or-script-2` -- what it does
- `Task` tool -- dispatch sub-agents (if applicable)

**Your constraints:**
- NEVER [dangerous thing]
- ALWAYS [required behavior]
- NEVER [common mistake]
```

**Why this matters:** The identity statement anchors Claude's behavior. A skill that
says "You are a QA engineering lead" behaves differently from one that says "You are
a software architecture auditor." The role shapes judgment calls throughout execution.

**Tools must be explicit.** List every script, CLI command, and Claude tool the skill
uses. If a tool isn't listed, Claude may not think to use it.

**Constraints are NEVER/ALWAYS rules.** They override default behavior. Put the most
critical constraints first. Common patterns:
- "NEVER skip the smoke gate"
- "ALWAYS fix what you can before registering issues"
- "NEVER create worktrees or branches"
- "NEVER modify production data"

### 3. State Machine (if applicable)

```markdown
## 2. State Machine

```
PHASE_A -> PHASE_B -> PHASE_C -> PHASE_D -> PHASE_E
              ^                                 |
              +------------ loop ---------------+
```
```

Not every skill needs a state machine. Use one when:
- The skill has distinct phases with different behaviors
- The skill loops (measure -> fix -> verify -> repeat)
- Progress must be tracked across tool calls or sessions
- The skill can be interrupted and resumed

### 4. Invocation (How to Start)

```markdown
## 3. Invocation

When the user says `/my-skill` or "natural language trigger":

1. Parse arguments (defaults if omitted)
2. Initialize state
3. Proceed to first phase
```

### 5. Phase Protocols (The Core Logic)

This is the bulk of the skill. Each phase gets its own subsection with:

```markdown
### PHASE_NAME

1. **What to do:**
   ```bash
   exact-command-with-flags --json
   ```

2. **How to interpret results:**
   - If X -> do Y
   - If Z -> do W

3. **How to advance:**
   ```bash
   state-tool advance NEXT_PHASE
   ```
```

**Key principle:** Every decision is a decision tree, not prose. Claude follows
if/then logic better than paragraphs. Use tables for classification:

```markdown
| Condition | Action |
|-----------|--------|
| Error type A | Fix locally |
| Error type B | Register in issue tracker |
| Error type C | Escalate to user |
```

### 6. Reference Material

Classification rules, data models, exit codes, model allocation tables, known
gotchas. Anything Claude needs to look up during execution.

### 7. Exit / Abort Handling

```markdown
## Exit Commands

Listen for: "stop", "abort", "cancel", "reset"

| Intent | Action |
|--------|--------|
| Stop + keep record | state-tool reset |
| Kill everything | state-tool abort |
```

---

## Design Principles for Skills

### 1. Role-Based Identity

The skill establishes a role and stays in character. "You are a QA engineering lead"
means Claude acts with QA judgment -- it prioritizes coverage, finds edge cases, and
doesn't cut corners. Choose roles that map to the judgment calls the skill requires.

### 2. Deterministic Over Probabilistic

Never guess -- run scripts, parse JSON, follow decision trees. The skill should
specify exact commands with exact flags. When the skill says "run the harness,"
it should give the full command, not leave Claude to figure out which flags to use.

### 3. Script-First Architecture

Put measurement logic in external scripts, not in the skill prompt. Scripts are:
- Testable independently
- Versionable in git
- Deterministic (same input -> same output)
- Reusable across skills

The skill orchestrates; scripts measure. This separation means the skill prompt
can change without breaking measurement, and vice versa.

### 4. JSON-Driven Communication

Harnesses output JSON; skills parse and decide based on structure. This is more
reliable than parsing prose output. Standard pattern:

```bash
python3 scripts/my_harness.py --full --json > /tmp/results.json
```

### 5. State Persistence on Disk

Skills that loop or span multiple invocations persist state to disk (JSON file),
not in conversation memory. This means:
- State survives conversation compression
- Multiple skills can read the same state
- State can be inspected externally

### 6. Gated Transitions

Critical transitions require explicit gate passage. Gates can be:
- **Automatic:** Harness passes -> gate passes
- **Human:** User approves before advancing
- **Quality threshold:** Score meets minimum bar

Non-skippable gates prevent dangerous shortcuts. Skippable gates allow judgment
calls with logged reasons.

### 7. Fix-It-or-Register-It

Every finding must be either fixed or registered in an issue tracker. "Known
issues" are not allowed. The user should never see a final report with untracked
items.

### 8. Model Allocation

Different tasks need different models. Specify which model for which agent type:

| Agent Type | Model | Why |
|------------|-------|-----|
| Investigation / fact-gathering | Fast model | Reliable, focused queries |
| Complex multi-file fixes | Strong model | Architecture decisions |
| Spot-checks | Fastest model | Cheap, high-volume verification |

---

## Companion Scripts

Most skills need at least one companion script. Standard patterns:

### State Machine Script

```python
# scripts/my_state.py
# Commands: init, load, advance, add-finding, mark-fixed, mark-registered, report
# Output: JSON (--json flag)
# Persistence: atomic write to state file
# State file: workspace/my_state.json
```

### Harness Script

```python
# scripts/my_harness.py
# Commands: --full, --smoke-only, --layer N, --json
# Output: JSON with findings, pass/fail counts, ship_ready boolean
# Exit codes: 0 = pass, 1 = fail, 2 = infrastructure error
```

### Issue Tracker Script

```python
# scripts/my_issues.py
# Commands: create, find, close
# Integration: GitLab, GitHub, Linear, Jira (your choice)
# Idempotent: check-before-create pattern
```

---

## Pluggable Template

Copy everything below this line into `.claude/skills/<your-skill>/SKILL.md`.
Replace `{{placeholders}}` with your specifics.

---

```markdown
---
name: {{skill-name}}
description: >
  {{One paragraph: what it does, when it triggers, key constraints.}}
  Trigger: /{{skill-name}}, "{{natural language trigger 1}}", "{{trigger 2}}"
---

# {{Skill Display Name}}

## 1. Identity

You are a **{{role}}**. You {{primary action}}. You {{secondary action}}.
You don't stop until {{completion condition}}.

**Your tools:**
- `{{script_1}}` -- {{what it does}}
- `{{script_2}}` -- {{what it does}}
- `Task` tool -- dispatch sub-agents ({{model}} for {{task type}})

**Your constraints:**
- NEVER {{dangerous action}}
- ALWAYS {{required behavior}}
- NEVER {{common mistake}}
- ALWAYS {{quality standard}}

---

## 2. State Machine

```
{{PHASE_1}} -> {{PHASE_2}} -> {{PHASE_3}} -> {{PHASE_4}} -> {{PHASE_5}}
                  ^                                            |
                  +------------------ loop --------------------+
```

{{If no looping, remove the loop arrow. If no state machine, remove this section.}}

---

## 3. Invocation

When the user says `/{{skill-name}}` or "{{trigger phrase}}":

```bash
{{init_command}} --iterations {{default_N}}
```

Then proceed to {{PHASE_1}}.

---

## 4. Phase Protocols

### {{PHASE_1}}: {{Phase Name}}

1. **Prerequisite checks:**
   ```bash
   {{health_check_command}}
   ```
   Must return {{expected_result}}. If not, stop and fix.

2. **Smoke gate:**
   ```bash
   {{smoke_command}}
   ```
   If smoke fails, stop. Do not proceed.

3. **Advance:**
   ```bash
   {{state_tool}} advance {{PHASE_2}}
   ```

### {{PHASE_2}}: {{Phase Name}} (Measure)

1. **Run measurement:**
   ```bash
   {{harness_command}} --full --json
   ```

2. **Parse results.** The output contains:
   - `{{field_1}}` -- {{what it means}}
   - `{{field_2}}` -- {{what it means}}
   - `ship_ready` -- boolean

3. **Register findings:**
   ```bash
   {{state_tool}} add-finding "{{summary}}" {{category}} {{severity}}
   ```

4. **Advance:**
   ```bash
   {{state_tool}} advance {{PHASE_3}}
   ```

### {{PHASE_3}}: {{Phase Name}} (Triage)

1. **Load findings:**
   ```bash
   {{state_tool}} load
   ```

2. **Classify each finding:**

   | Category | Action |
   |----------|--------|
   | {{category_1}} | Fix locally |
   | {{category_2}} | Register in issue tracker |
   | {{category_3}} | Escalate to user |

3. **Register unfixable findings:**
   ```bash
   {{issue_tool}} create --title "{{prefix}}: {{summary}}" \
     --labels "{{label_1}}" "{{label_2}}" \
     --finding-id "{{finding_id}}"
   ```

4. **Advance:**
   ```bash
   {{state_tool}} advance {{PHASE_4}}
   ```

### {{PHASE_4}}: {{Phase Name}} (Fix)

1. **Dispatch builders via Task tool:**

   | Agent | Owned Files | Scope |
   |-------|-------------|-------|
   | Fixer A | {{files}} | {{domain}} |
   | Fixer B | {{files}} | {{domain}} |

2. **Each fixer follows plan-first protocol:**
   - Investigate root cause
   - Write fix plan (before/after, side effects)
   - Implement only after plan review
   - Report what changed

3. **After fixes -- restart/reload:**
   ```bash
   {{restart_command}}
   ```

4. **Mark fixed:**
   ```bash
   {{state_tool}} mark-fixed {{finding_id}}
   ```

5. **Advance:**
   ```bash
   {{state_tool}} advance {{PHASE_5}}
   ```

### {{PHASE_5}}: {{Phase Name}} (Verify + Report)

1. **Re-run exact failing tests** from the findings.

2. **Regression check:** Re-run {{N}} previously-passing tests.

3. **If new failures -> back to {{PHASE_3}}.**

4. **If clean -> check loop condition:**
   - `iteration < max_iterations` AND open findings -> loop to {{PHASE_2}}
   - Otherwise -> present final report

5. **Final report:**
   - Total findings across all iterations
   - Fixed count + registered count
   - Issue tracker links
   - Quality scores
   - Remaining open items

---

## 5. Classification Rules

| Condition | Label | Priority |
|-----------|-------|----------|
| {{condition_1}} | `{{label}}` | `{{priority}}` |
| {{condition_2}} | `{{label}}` | `{{priority}}` |
| {{condition_3}} | `{{label}}` | `{{priority}}` |

---

## 6. Model Allocation

| Agent Type | Model | Why |
|------------|-------|-----|
| Measurement / verification | {{fast_model}} | Reliable, focused |
| Bug fixes | {{strong_model}} | Multi-file reasoning |
| Spot-checks | {{fastest_model}} | Cheap, high-volume |

---

## 7. Exit Commands

| Intent | Command |
|--------|---------|
| Stop + keep record | `{{state_tool}} reset` |
| Kill everything | `{{state_tool}} abort` |

---

## 8. Gotchas

- {{Gotcha 1: data window, rate limits, known quirks}}
- {{Gotcha 2: async behavior, timing considerations}}
- {{Gotcha 3: column/field name discrepancies}}
```

---

**End of Skill Builder Training Document**
