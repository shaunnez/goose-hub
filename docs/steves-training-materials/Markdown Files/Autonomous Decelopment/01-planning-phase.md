# Training: The Planning Phase

How to run a rigorous, investigation-driven planning phase before writing any code.
This document teaches the pattern; the companion template at the end is pluggable
into Claude Code as a skill or inline prompt.

---

## Why Planning Is the Highest-Leverage Phase

Fixing a design gap in a spec takes 5 minutes. Fixing the same gap in code takes
30-60 minutes (understand, change, test, review, fix review findings). A thorough
planning phase that catches 30+ gaps before coding saves 15-30 hours of build
iteration. The math is unambiguous: **front-load investigation, not iteration.**

The planning phase produces three artifacts, each building on the last:

1. **User Journeys** -- who uses this, what they do step-by-step, what success looks like
2. **Functional Specification** -- what the system does, its states, rules, and edge cases
3. **Engineering Specification** -- how to build it, grounded in actual code with falsifiable ACs

Most teams skip 1 and 2 and jump to 3. Then they build something that compiles but
doesn't match what the user actually needs. The journeys and functional spec are the
"why" and "what." The engineering spec is the "how." You need all three.

---

## The Planning Protocol (10 Steps)

### Step 1: Check for an Existing Plan

Before writing anything:

1. Check the plans directory for recent files related to this feature.
2. Check if the user referenced a plan in their message.
3. Check if lifecycle state already has a `plan_file` set.

**If a plan exists, do not rewrite it.** Register it, send it through review, and
move to the next phase. Regenerating a plan that exists wastes time and loses
context the original author captured.

### Step 2: Investigation Swarm -- Wave 1 (Reconnaissance)

Parse the user request into structured deliverables, then dispatch 4-6 investigation
agents in parallel. You do NOT explore code yourself -- agents gather facts, you
synthesize and design.

| Agent | Role | Focus | Output Format |
|-------|------|-------|---------------|
| S1 | Schema Scout | DB models, migrations, schema in scope | Table: name, columns, types, FKs, indexes |
| S2 | Code Path Tracer | Entry points -> call chain for affected flows | Table: function sig, file:line, params, returns |
| S3 | Pattern Matcher | Similar features/patterns in codebase | File paths, exports, interfaces, established conventions |
| S4 | Test Inventory | Existing tests, harnesses, specs | File paths, what they cover, coverage gaps |
| S5 | Dependency Mapper | Import graph for files in scope | Who imports what, shared models/enums |
| S6 | User Journey Scout | Existing UX flows, page structure, navigation | Routes, components, interaction patterns, current user paths |

**Agent dispatch rules:**
- ALL agents run in background (parallel)
- Each gets a focused prompt (<500 words) with exact files/patterns to examine
- Report format is structured (tables, not prose)
- Constraint: "Report FACTS only -- do not design solutions. Include file:line for everything."

**While Wave 1 runs (do NOT idle):**
1. Read project constraints (CLAUDE.md, conventions)
2. Review recent git history for related work
3. Check for active lifecycles that might conflict
4. Parse the user request into structured deliverables

### Step 3: Cross-Validation Loop

Before launching Wave 2, cross-validate Wave 1 findings:

1. **Schema vs Code:** Compare S1 (schema) against S2 (code paths). Flag column/table name mismatches.
2. **Pattern vs Dependency:** Compare S3 (patterns) against S5 (imports). Flag missing imports.
3. **Test vs Change:** Cross-reference S4 (test inventory) against planned changes. Identify untested paths.
4. **UX vs Schema:** Compare S6 (user flows) against S1 (schema). What data does the user need that doesn't exist? What data exists that the user can't access?

If contradictions are found, dispatch a targeted agent to resolve them (read the
specific file, report the actual state). Agents check each other's work.

### Step 4: Investigation Swarm -- Wave 2 (Deep Investigation)

Dispatch 1-2 agents informed by Wave 1 findings. Choose model by complexity:

| Decision Factor | Use Stronger Model | Use Faster Model |
|----------------|-------------------|-----------------|
| Schema changes / migrations | Yes | No |
| Multi-service changes (>2) | Yes | No |
| Business logic with complex formulas | Yes | No |
| >5 files changing | Yes | No |
| Single service change | No | Yes |
| UI-only feature | No | Yes |
| Config/routing change | No | Yes |
| Well-established pattern | No | Yes |

Wave 2 agents:
- **Interface Designer** -- exact typed models, function signatures, SQL DDL/DML
- **Risk Analyst** -- what breaks, cascade effects, edge cases from codebase history

Each receives Wave 1 findings as input. Their job is to READ actual files and
produce exact code (not pseudocode): complete model definitions (paste-ready),
function signatures with file:line references, SQL with real column names verified
against Wave 1 schema report.

---

### Step 5: User Journeys

**Before designing any system behavior, define who uses this and what they do.**

User journeys are the foundation. Everything else -- functional spec, engineering
spec, acceptance criteria, harness layers -- derives from these. If the journey is
wrong, everything downstream is wrong.

#### 5a: Identify Personas

Who interacts with this feature? Not generic "user" -- specific roles with specific
goals and constraints.

```markdown
### Persona: [Name / Role]

**Who:** [Role, experience level, technical comfort]
**Goal:** [What they're trying to accomplish -- in their words, not system terms]
**Context:** [When/where they use this -- what they were doing before, what they do after]
**Frustration today:** [What's broken or missing that this feature addresses]
**Success looks like:** [Observable outcome -- what do they see/feel when it works?]
```

#### 5b: Map Each Journey

For each persona, walk the complete interaction from trigger to outcome:

```markdown
### Journey: [Persona] → [Goal]

**Trigger:** [What causes the user to start this journey]

| Step | User Action | System Response | Data Shown | State Change |
|------|------------|-----------------|------------|--------------|
| 1 | [what they click/type/see] | [what the system does] | [what appears] | [what changes in the backend] |
| 2 | ... | ... | ... | ... |
| N | ... | ... | ... | ... |

**Success state:** [What the user sees when the journey completes successfully]
**Error states:**
- [Error 1]: [What the user sees] → [Recovery path]
- [Error 2]: [What the user sees] → [Recovery path]

**Edge cases:**
- [Edge case 1]: [What happens, how the system handles it]
- [Edge case 2]: ...
```

#### 5c: Journey Quality Gates

| Gate | Check |
|------|-------|
| Every step has a system response | No "magic happens here" gaps |
| Every step shows specific data | Not "displays results" -- what results, what format |
| Error states have recovery paths | User is never stuck |
| Edge cases are enumerated | Not "handles errors gracefully" -- which errors, how |
| Journey starts from a real trigger | Not "user opens the feature" -- what makes them want to? |
| Journey ends with observable success | The user knows it worked without reading logs |

#### 5d: Journey → AC Derivation

Every acceptance criterion should trace back to a specific journey step:

```markdown
| AC | Source Journey | Step | What It Proves |
|----|---------------|------|---------------|
| AC-1 | Owner → View Revenue | Step 3 | Revenue chart renders with correct date range |
| AC-2 | Owner → View Revenue | Error 1 | "No data" message shows when date range is empty |
| AC-3 | Admin → Configure Alert | Step 5 | Alert threshold persists after page reload |
```

If an AC doesn't trace to a journey step, it's either an internal quality check
(fine -- label it as such) or it's speculative (remove it).

---

### Step 6: Functional Specification

**The functional spec describes what the system does -- its behaviors, states, rules,
and boundaries. It bridges user journeys ("what the user experiences") to engineering
spec ("how to build it").**

#### 6a: Feature Overview

```markdown
## Feature: [Name]

**Purpose:** [One sentence -- what this feature enables, in user terms]
**Scope:** [What's IN scope / what's explicitly OUT of scope]
**Dependencies:** [Other features, services, data sources this relies on]
```

#### 6b: Behavioral Requirements

For each distinct behavior the system must exhibit:

```markdown
### Behavior: [Name]

**When:** [Trigger condition -- specific, testable]
**Given:** [Preconditions -- what state must exist]
**Then:** [What the system does -- specific, observable]
**Data:** [What data is read/written, what format, what source]

**Rules:**
- [Business rule 1 -- specific, not "handles appropriately"]
- [Business rule 2]

**Constraints:**
- [Performance: response time, throughput]
- [Security: who can access, what's validated]
- [Data integrity: what must be consistent]
```

#### 6c: State Model

If the feature has states (and most non-trivial features do):

```markdown
### States

| State | Entry Condition | Behaviors Available | Exit Transitions |
|-------|----------------|--------------------|-----------------| 
| [state_1] | [how you get here] | [what user can do] | [where you can go] |
| [state_2] | ... | ... | ... |

### Invalid Transitions

| From | To | Why It's Invalid |
|------|-----|-----------------|
| [state_1] | [state_3] | [business reason] |
```

#### 6d: Data Requirements

What data does this feature need, produce, and transform?

```markdown
### Data: [Entity Name]

**Source:** [Where it comes from -- DB table, API, user input]
**Fields:**
| Field | Type | Source | Validation | Example |
|-------|------|--------|------------|---------|
| [name] | [type] | [origin] | [rules] | [sample value] |

**Computed/Derived:**
| Field | Formula | Dependencies |
|-------|---------|-------------|
| [name] | [how it's calculated] | [what inputs] |
```

#### 6e: Integration Points

```markdown
### Integrations

| System | Direction | Data Exchanged | Protocol | Error Handling |
|--------|-----------|---------------|----------|---------------|
| [system] | Read/Write/Both | [what data] | [REST/WS/DB] | [what happens on failure] |
```

#### 6f: Functional Spec Quality Gates

| Gate | Check |
|------|-------|
| Every journey step maps to a behavior | No journey steps are "implied" |
| Every behavior has testable conditions | When/Given/Then, not prose |
| States are exhaustive | Every valid combination is covered |
| Invalid transitions are enumerated | You can't get into a bad state |
| Data fields have types and validation | Not "stores user data" |
| Error handling is specific | Not "fails gracefully" -- what does the user see? |

---

### Step 7: Engineering Specification

**Now -- and only now -- design how to build it.** The engineering spec translates
functional behaviors into code changes, grounded in actual codebase state.

Write the plan file with ALL of these sections:

1. **Objective + Falsifiable ACs** -- each AC traces to a journey step and has a verification command + tolerance
2. **User Journeys** (from Step 5) -- included in the spec for builder context
3. **Functional Requirements** (from Step 6) -- included as the behavioral contract
4. **Architecture** -- current flow, new flow, key design decisions with rationale
5. **Schema Changes** -- exact SQL DDL from actual DB (not memory)
6. **Interface Contracts** -- typed models, function sigs, API endpoints (paste-ready)
7. **Work Packages** -- files, exact changes with file:line, builder instructions
8. **Execution Order** -- DAG with rationale for every ordering constraint
9. **Verification Tooling Spec** -- dedicated WP for harness with models, check functions, tolerances
10. **AC -> Journey -> Verification Map** -- every AC traces through journey to verification command
11. **Risk Register** -- at least one entry with mitigation and detection method
12. **Constraints This Spec Must Respect** -- read the actual code for every referenced phase, gate, hook, model

**Self-check quality gates:**

| # | Gate | Pass Criteria |
|---|------|---------------|
| 1 | Journey Coverage | Every journey step has at least one AC |
| 2 | Grounded in Code | Every file path, function, column in spec exists in codebase |
| 3 | Complete Interfaces | Every cross-WP boundary has explicit typed contract |
| 4 | Falsifiable ACs | Every AC has a verification command -- no subjective criteria |
| 5 | Builder Independence | Each WP has file:line, current->new code, a fast model can execute without re-exploring |
| 6 | Verification Tooling | Dedicated WP for automated checks when >2 WPs total |
| 7 | Risk Register | At least one risk with actionable mitigation |
| 8 | Execution Order | DAG with "why" for every ordering constraint |
| 9 | Code Quality Design | Spec addresses LOC/coupling/complexity constraints for new code |

### Step 7b: Constraint Inventory

Before review, verify the spec against reality. For each area the spec touches,
READ the actual code and record the constraint:

- **State machine phases** -- read the enum. The spec must not reference phases that don't exist.
- **Gates** -- read the gate registry. Note which phases have no gate (those are extension points).
- **Hooks** -- read the hook handler. What does it block/advise?
- **Models** -- for every existing model referenced, read actual fields from code (not memory).
- **Script outputs** -- for every harness referenced, read the actual `--json` output format.

This catches grounding failures BEFORE review.

### Step 7c: Dry-Run Simulation

Mentally execute the spec end-to-end. Walk each user journey through the planned
implementation:

1. "The user does [Step 1]. Does the planned code handle this? What function is called?"
2. "The user hits [Error State]. Does the planned error handling match the journey's recovery path?"
3. "WP3 reads a field added by WP4. Is WP4 done first?" (walk the DAG)
4. "The harness fails. Can I still advance?" (trace the gate logic)

If you can't trace a user's path through the planned code without hand-waving, the
spec has a gap. Add it to the Risk Register and fix the design.

### Step 7d: Self-Challenge (Devil's Advocate)

For each AC, answer:
- **JOURNEY:** Which persona, which step does this prove?
- **INPUT:** What triggers this check? (exact command, exact data)
- **ACTION:** What does the system do? (exact code path)
- **OUTPUT:** What is produced? (exact model, exact fields)
- **SIDE EFFECT:** What else changes? (state, files, gates)
- **FAILURE MODE:** What happens when this fails? (error path, recovery)

---

### Step 8: Record the Plan

Register the plan path in your state management:
```bash
# Example: record plan path in lifecycle state
your_state_tool set-plan ".plans/my-feature.md"
```

### Step 9: Adversarial Review

**For simple fixes (1-2 files, obvious change):** Skip review. Log the skip with reason.

**For everything else:**

**Round 1** -- Two parallel adversarial reviewers:
- Reviewer A: "Verify all file paths, function signatures, column names exist. Flag speculative content. Do the user journeys cover all personas and error states?"
- Reviewer B: "Check interface contracts between WPs. Verify ACs are falsifiable and trace to journey steps. Can a builder execute each WP without deep codebase knowledge?"

**Round 2+** -- Single reviewer follow-ups until convergence.

**Convergence criteria:** Two consecutive rounds where no new CRITICAL findings.

**Key rule:** Every review round MUST include at least one agent with zero focus
constraints -- "Comprehensive adversarial review. No constraints. Break it if you can.
Challenge the user journeys, the functional spec, AND the engineering spec."

### Step 10: Record Gate + Advance

```bash
your_state_tool record-gate plan_review passed "Converged after N rounds"
your_state_tool advance NEXT_PHASE
```

---

## The Three Artifacts

The planning phase produces three artifacts in a clear hierarchy:

```
USER JOURNEYS (who and what)
  │  Personas, goals, step-by-step flows, error states, edge cases
  │  "The restaurant owner clicks Revenue, sees a chart for this week"
  │
  v
FUNCTIONAL SPEC (what the system does)
  │  Behaviors, states, rules, data requirements, integration points
  │  "When date range is empty, show 'No data for this period' message"
  │
  v
ENGINEERING SPEC (how to build it)
     Architecture, schema, interface contracts, work packages, verification
     "Add `empty_state_message` prop to RevenueChart.tsx:L45, render when data.length === 0"
```

Each level adds specificity. Each level is reviewable independently. A user journey
bug is caught before writing a functional spec. A functional spec bug is caught
before writing code.

**The common failure mode:** Jumping straight to engineering spec. The code compiles,
passes tests, and does the wrong thing because nobody wrote down what the user
actually needed.

---

## Lessons Learned (From Production Use)

1. **Never stop at one review round** for auth, session, security, data integrity,
   or anything touching user trust.

2. **Unrestricted adversarial prompts find the best bugs.** Focused prompts find
   surface issues. Open-ended "break it" prompts find architectural gaps.

3. **A devil's advocate agent is mandatory.** At least one reviewer per round should
   challenge the fundamental approach: "Is this the right pattern? What's simpler?"

4. **Investigation before design, not during.** Every claim in the spec must be
   grounded in file:line references. No "I think this file does X."

5. **User journeys catch "builds the wrong thing" bugs.** Engineering specs catch
   "builds it wrong" bugs. You need both.

6. **Functional specs prevent "works in demo, fails in production."** Edge cases,
   error states, and invalid transitions only surface when you enumerate behaviors
   systematically.

7. **The cost of doing it right is linear. The cost of fixing it later is exponential.**

---

## Pluggable Template

Copy everything below this line into a Claude Code skill, plan-mode prompt, or
CLAUDE.md section. Replace `{{placeholders}}` with your project specifics.

---

```markdown
# Planning Phase Protocol

## Context

You are planning the implementation of: {{FEATURE_DESCRIPTION}}

## Step 1: Existing Plan Check

Look in {{PLANS_DIRECTORY}} for existing plans. If one exists, register it and
skip to Step 9 (review). Do not regenerate.

## Step 2: Investigation Swarm -- Wave 1

Dispatch {{4-6}} background agents:

| Agent | Role | Prompt Focus |
|-------|------|-------------|
| S1 | Schema Scout | "Examine {{DB_MODELS_PATH}}. Report all tables, columns, types, FKs for {{SCOPE}}. Facts only, file:line for everything." |
| S2 | Code Path Tracer | "Trace {{ENTRY_POINTS}} call chains. Report function sigs, file:line, params, returns. Facts only." |
| S3 | Pattern Matcher | "Find similar features/patterns to {{FEATURE}} in {{CODEBASE_PATH}}. Report file paths, interfaces, conventions." |
| S4 | Test Inventory | "Inventory existing tests in {{TEST_PATHS}}. Report what's covered, what's not, coverage gaps." |
| S5 | Dependency Mapper | "Map imports for {{AFFECTED_FILES}}. Report who imports what, shared models." |
| S6 | UX Scout | "Map existing user flows in {{FRONTEND_PATH}} for {{SCOPE}}. Report routes, components, interaction patterns, navigation." |

While agents run: read {{CLAUDE_MD_PATH}}, review `git log --oneline -20`, parse
user request into deliverables.

## Step 3: Cross-Validation

Compare agent findings:
- S1 schema vs S2 code paths -- flag mismatches
- S3 patterns vs S5 imports -- flag missing dependencies
- S4 tests vs planned changes -- flag untested paths
- S6 UX flows vs S1 schema -- flag data gaps (user needs it, doesn't exist)

Dispatch targeted agents to resolve contradictions.

## Step 4: Wave 2 Deep Investigation

Dispatch 1-2 agents with Wave 1 findings as input:
- Interface Designer: "Produce exact {{MODEL_FRAMEWORK}} models, function sigs, SQL DDL"
- Risk Analyst: "What breaks? Cascade effects? Edge cases from git history?"

## Step 5: User Journeys

For each persona affected by this feature:

```
### Persona: [Name / Role]
**Who:** [Role, experience, context]
**Goal:** [In their words]
**Frustration today:** [What's broken]
**Success looks like:** [Observable outcome]

### Journey: [Persona] → [Goal]
**Trigger:** [What starts this journey]

| Step | User Action | System Response | Data Shown | State Change |
|------|------------|-----------------|------------|--------------|
| 1 | ... | ... | ... | ... |

**Success state:** [What the user sees]
**Error states:**
- [Error]: [What user sees] → [Recovery]
**Edge cases:**
- [Case]: [What happens]
```

Quality gates:
- Every step has a system response (no gaps)
- Every step shows specific data (not "displays results")
- Error states have recovery paths
- Journey traces from real trigger to observable success

## Step 6: Functional Specification

For each behavior:

```
### Behavior: [Name]
**When:** [Trigger -- specific, testable]
**Given:** [Preconditions]
**Then:** [System response -- specific, observable]
**Rules:** [Business rules]
**Constraints:** [Performance, security, data integrity]
```

State model (if applicable):
| State | Entry Condition | Available Actions | Exit Transitions |
|-------|----------------|-------------------|-----------------|

Data requirements:
| Field | Type | Source | Validation | Example |
|-------|------|--------|------------|---------|

## Step 7: Engineering Specification

Write to `{{PLANS_DIRECTORY}}/{{FEATURE_NAME}}.md`:

```
# {{FEATURE_NAME}}

## Objective
{{Clear goal with measurable outcomes}}

## User Journeys
{{From Step 5 -- included for builder context}}

## Functional Requirements
{{From Step 6 -- the behavioral contract}}

## Acceptance Criteria
| AC | Journey Step | Verify Command | Expected Output | Tolerance |
|----|-------------|---------------|-----------------|-----------|
| AC-1 | [Persona] Step 3 | {{command}} | {{output}} | {{tolerance}} |

## Architecture
Current: {{current_flow}}
New: {{new_flow}}
Decision: {{rationale}}

## Interface Contracts
{{Paste-ready typed models and function signatures}}

## Work Packages
| WP | Files | Changes | Builder Model |
|----|-------|---------|--------------|
| WP1 | {{files}} | {{file:line changes}} | {{model}} |

## Execution Order
{{DAG with rationale for ordering}}

## AC -> Journey -> Verification Map
| AC | Persona | Journey Step | Command | Expected | Automated |
|----|---------|-------------|---------|----------|-----------|
| AC-1 | {{persona}} | Step 3 | {{cmd}} | {{expected}} | Yes/No |

## Risk Register
| Risk | Likelihood | Impact | Mitigation | Detection |
|------|-----------|--------|------------|-----------|
| {{risk}} | L/M/H | L/M/H | {{action}} | {{how}} |

## Constraints This Spec Respects
{{Read from actual code, not memory}}
```

## Step 8: Self-Check Gates

| Gate | Check |
|------|-------|
| Journey Coverage | Every journey step has at least one AC |
| Grounded | Every path/function/column exists in codebase |
| Interfaces | Every cross-WP boundary has typed contract |
| Falsifiable | Every AC has a verification command |
| Builder Independence | Each WP executable without deep exploration |

## Step 9: Adversarial Review

Round 1 (parallel):
- Agent A: "Verify all paths, sigs, columns exist. Flag speculation. Do user journeys cover all personas and error states?"
- Agent B: "Check WP interfaces. Are ACs falsifiable and traced to journey steps? Can builders execute independently?"

Round 2+: until two consecutive rounds with 0 new CRITICAL findings.

## Step 10: Record + Advance

```bash
{{STATE_TOOL}} record-gate plan_review passed "Converged round N"
{{STATE_TOOL}} advance {{NEXT_PHASE}}
```
```

---

**End of Planning Phase Training Document**
