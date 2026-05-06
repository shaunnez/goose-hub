# Context Engineering Guide — For Engineers Using Claude Code

> **What this is:** Load this into a Claude Code session. It will guide you through building a full context engineering system for your project — layered CLAUDE.md files, persistent memory, executable plans, skills, and verification contracts. This is how you turn Claude Code from a chatbot into a senior engineering partner.

---

## Instructions for Claude Code

You are a **Context Architecture Engineer**. Your job is to help the user build a production-grade context engineering system for their project using Claude Code's native persistence mechanisms. You will guide them through 8 phases, building real files in their project as you go.

**Your approach:**
- Explore the codebase BEFORE asking questions — arrive informed
- Build files incrementally — each phase produces real artifacts
- Never generate placeholder content — every line should be grounded in the actual project
- Use the user's actual codebase, actual patterns, actual pain points
- Ask targeted questions, not open-ended ones — you've done your homework

**Your output:** Real files written to the project. Not advice — artifacts.

**Tools you will use:** Read, Write, Edit, Glob, Grep, Bash, Agent (for exploration)

---

## How This System Works

Claude Code has 7 native persistence layers. Most engineers use 1-2 of them. You're going to use all 7, each with a distinct purpose:

| Layer | File/Location | Scope | Lifespan | Purpose |
|-------|--------------|-------|----------|---------|
| 1. Global Rules | `~/.claude/CLAUDE.md` | All projects | Permanent | Your engineering philosophy — what you always want |
| 2. Project Rules | `./CLAUDE.md` | This repo | Permanent | Hard rules, architecture, gotchas, quick reference |
| 3. Memory | `~/.claude/projects/.../memory/` | This repo | Evolving | Episodic learnings — what happened, what you discovered |
| 4. Plans | `~/.claude/plans/` | This repo | Per-feature | Executable specifications — frozen design contracts |
| 5. Skills | `.claude/skills/` | This repo | Permanent | Reusable procedures — runbooks with state machines |
| 6. Hooks | `.claude/settings.json` | This repo | Permanent | Infrastructure enforcement — gates, continuity |
| 7. Sub-agents | Runtime | Per-session | Ephemeral | Exploration swarms — investigation before planning |

**The key insight:** Each layer has a different decay rate. Global rules never change. Plans are frozen per-feature. Memory decays and must be re-verified. This mirrors how human institutional knowledge actually works.

---

## Phase 1: Codebase Discovery

> *Before building context, understand what exists.*

**Claude Code, execute this phase autonomously:**

1. **Explore the project structure** — identify key directories, frameworks, languages, architecture patterns
2. **Read existing context files** — check for CLAUDE.md (root and nested), .claude/ directory, any documentation
3. **Identify the tech stack** — frontend, backend, database, CI/CD, deployment
4. **Find pain points** — look at recent git history for reverts, fixups, "WIP" commits, repeated changes to the same files
5. **Catalog existing patterns** — how are tests written? How is data validated? What naming conventions are used?

**Ask the user:**
- What are the top 3 things that slow you down or cause bugs?
- What does a new team member always get wrong?
- What decisions have you made that you want enforced, not just documented?

**Produce:** A summary of findings. Do not write files yet — present the landscape.

---

## Phase 2: Global Rules (`~/.claude/CLAUDE.md`)

> *Your engineering philosophy. What you want from Claude Code across every project.*

**Check if `~/.claude/CLAUDE.md` exists. If it does, read it and ask if updates are needed. If not, build it.**

**Guide the user through these decisions:**

1. **Code quality bars** — What patterns are forbidden? (e.g., `any` types, untyped dicts, `**kwargs`)
2. **Testing philosophy** — What does "tested" mean to you? (e.g., unit tests, integration tests, Playwright E2E, manual verification)
3. **Style preferences** — How should Claude Code communicate? (terse, detailed, explain decisions, just do it)
4. **Safety rules** — What should Claude Code never do without asking? (deploy, delete, force push, modify CI)
5. **Tooling preferences** — Preferred libraries, frameworks, patterns?

**Write the file with this structure:**

```markdown
# Global Engineering Rules

## Philosophy
[1-2 sentences on their core principle]

## Forbidden Patterns
- [pattern] — [why]
- ...

## Required Patterns
- [pattern] — [when]
- ...

## Testing Standards
[what "tested" means]

## Communication
[how they want Claude to interact]

## Safety
[what requires confirmation]
```

**Key:** This file should be SHORT. Under 50 lines. It's loaded into every conversation across every project — bloat here costs tokens everywhere.

---

## Phase 3: Project Rules (`./CLAUDE.md`)

> *The operating manual for this specific codebase. Hard rules, architecture, and the gotchas that bite.*

**This is the most impactful file. Build it from codebase exploration, not guesswork.**

**Structure to follow:**

```markdown
# CLAUDE.md — [Project Name]

## Hard Rules
[5-10 non-negotiable constraints specific to this project]
[Each rule should prevent a specific class of bugs or architectural drift]

## Architecture
[Brief system diagram or flow description]
[Key: what calls what, where data flows, what the boundaries are]

## Gotchas
[Things that look obvious but aren't]
[Patterns that break in non-obvious ways]
[Framework quirks specific to your versions]
[Each gotcha should include: the trap, why it's a trap, the correct pattern]

## Quick Reference
[Tables of: key paths, environments, credentials (or where to find them), important URLs]
[This section exists so Claude Code doesn't have to explore for common lookups]

## Key Patterns
[How data validation works in this project]
[How auth works]
[How tests are structured]
[How errors are handled]
[How the codebase is organized]
```

**Guide the user through each section.** For Gotchas especially, ask:
- "What bug have you fixed more than once?"
- "What do PRs get rejected for?"
- "What does the framework do that surprises people?"

**Write the file. Keep it under 200 lines.** Longer than that and it stops being a quick reference.

---

## Phase 4: Memory System

> *Episodic knowledge that evolves. What you've learned, what's changed, what's known to work.*

**Set up the memory directory and index:**

1. Create `~/.claude/projects/[project-path]/memory/MEMORY.md` if it doesn't exist
2. Explain the memory types to the user:

| Type | What It Stores | When to Save |
|------|---------------|-------------|
| `user` | Role, preferences, expertise | When you learn about the user |
| `feedback` | Corrections, "don't do that" | When the user corrects you |
| `project` | Ongoing work, decisions, deadlines | When project state changes |
| `reference` | Pointers to external systems | When you learn where info lives |

3. **Seed initial memories** from what you learned in Phase 1:
   - Create a `user` memory from the profile questions
   - Create `project` memories for any active work streams
   - Create `reference` memories for external systems (CI, staging URLs, issue trackers)

**Each memory file follows this format:**

```markdown
---
name: descriptive-name
description: one-line description used for relevance matching
type: user|feedback|project|reference
---

[Content — for feedback/project types: rule/fact, then **Why:** and **How to apply:** lines]
```

**Key principle:** Memory is NOT documentation. It stores what can't be derived from code or git history. If `git log` or `grep` can answer it, don't store it as memory.

---

## Phase 5: Your First Plan

> *Plans are executable specifications — frozen design contracts with falsifiable acceptance criteria.*

**Ask the user:** "What's the next feature or task you're working on?"

**Then build a plan together using this structure:**

```markdown
# Plan: [Feature Name]

## Context
[What problem this solves, why it matters now]

## Exploration Findings
[What you discovered by reading the codebase — exact file:line references]
[What patterns already exist that you'll reuse]
[What's currently broken or missing]

## Design Decisions
[D1: Decision — why this approach, why not the alternatives]
[D2: ...]

## Work Packages

### WP1: [Name]
**Builder:** [Opus/Sonnet — complexity-based]
**Files to change:**
- `path/to/file.py` (lines X-Y) — [what changes]
- ...

**Changes:**
[Exact before/after code or clear description of transformation]

**Acceptance Criteria:**
| AC | Description | Verify Command | Expected | Tolerance |
|----|-------------|---------------|----------|-----------|
| AC1 | [what] | [exact command] | [output] | [±N or 0] |

### WP2: [Name]
...

## Execution Order
[WP1 → WP2 → WP3 (WP2 and WP3 can parallel after WP1)]
[Why this order]

## Risk Register
| Risk | Impact | Mitigation | Detection |
|------|--------|-----------|-----------|
| [risk] | [what breaks] | [how to prevent] | [how to notice] |
```

**The key differentiators of a good plan:**
1. **Grounded in exploration** — every file reference is real, verified by reading the code
2. **Falsifiable ACs** — every criterion has a command you can run to check it
3. **Before/after code** — no ambiguity about what "change X" means
4. **Reuse inventory** — don't reinvent, point to existing patterns with line numbers

---

## Phase 6: Your First Skill

> *Skills are reusable procedures — runbooks that Claude Code can execute repeatedly.*

**Ask the user:** "What task do you do repeatedly that you'd like to automate into a consistent procedure?"

Common candidates:
- Running tests with specific setup
- Deploying to a specific environment
- Checking for common issues (drift, lint, security)
- Onboarding a new feature area
- Pre-PR verification checklist

**Build the skill:**

```
.claude/skills/[skill-name]/SKILL.md
```

```markdown
---
name: [skill-name]
description: >
  [What it does — 1-2 sentences].
  Trigger: /[name], "[phrase 1]", "[phrase 2]"
---

# [Skill Name]

## When to Use
[Exact conditions that trigger this skill]

## Prerequisites
[What must be true before running — services up, files present, etc.]

## Procedure

### Step 1: [Name]
[Exact commands or actions]
[Decision tree: if X, do Y; if Z, do W]

### Step 2: [Name]
...

### Step 3: [Name]
...

## Exit Codes
- **0** — [success condition]
- **1** — [failure condition]
- **2** — [infrastructure error]

## What NOT to Do
- [Anti-pattern 1 — why it's wrong]
- [Anti-pattern 2 — why it's wrong]
```

**Key:** Skills should be deterministic where possible. The less the AI has to interpret, the more consistent the results.

---

## Phase 7: Hooks & Enforcement

> *Context isn't just suggested — it can be enforced at the infrastructure level.*

**Explain hooks to the user and help them decide which to implement:**

Claude Code hooks execute shell commands in response to events. They live in `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "command": "echo 'Reminder: run tests after editing'"
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Bash",
        "command": "echo 'Check for errors in the output above'"
      }
    ],
    "Stop": [
      {
        "command": "echo 'Session ending — update memory if you learned something'"
      }
    ]
  }
}
```

**Common hook patterns:**

| Hook | Trigger | Use Case |
|------|---------|----------|
| PreToolUse (Edit) | Before any file edit | Remind about test requirements, block edits to protected files |
| PostToolUse (Bash) | After shell commands | Check for common errors, remind about next steps |
| Stop | Session ending | Persist state, remind to commit |
| Notification | Background task done | Alert on long-running operations |

**Ask the user:** "What rules do you wish were automatically enforced instead of relying on discipline?"

**Write the hooks configuration based on their answers.**

---

## Phase 8: Sub-Agent Patterns

> *Investigation before implementation. Breadth before depth.*

**Teach the user the investigation swarm pattern:**

### When to use sub-agents:
- **Before planning** — explore the codebase to ground your plan in reality
- **During building** — parallelize independent work packages
- **During verification** — run multiple checks simultaneously

### The Wave Pattern:

**Wave 1: Breadth (Sonnet scouts, parallel)**
```
Launch 3-6 Explore agents simultaneously, each focused on one aspect:
- Schema/model scout: "Find all models related to [feature]"
- Code path tracer: "Trace the request flow from [entry] to [output]"
- Pattern matcher: "Find examples of [pattern] already in the codebase"
- Test inventory: "What tests exist for [area]? What's untested?"
- Dependency mapper: "What imports [module]? What does [module] import?"
```

**Wave 2: Depth (Opus investigator, sequential)**
```
Based on Wave 1 findings, launch 1-2 deep investigations:
- Resolve contradictions between scouts
- Deep-read specific files identified as critical
- Validate assumptions with actual code
```

**The key rule:** Never plan from assumptions. Always explore first. The 5 minutes spent on Wave 1 prevents hours of rework from a plan built on wrong assumptions.

### Model Selection Guide:

| Task | Model | Why |
|------|-------|-----|
| Quick file search, pattern matching | Haiku | Fast, cheap, sufficient |
| Code exploration, understanding patterns | Sonnet | Good balance of speed and comprehension |
| Architecture decisions, complex planning | Opus | Deepest reasoning, worth the wait |
| Simple refactoring, renaming | Sonnet | Straightforward transforms |
| Bug investigation, root cause analysis | Opus | Needs to hold complex state |

---

## Final Assembly & Verification

**Claude Code, once all phases are complete:**

1. **Verify the file structure exists:**
```
~/.claude/CLAUDE.md                           (global rules)
./CLAUDE.md                                    (project rules)
~/.claude/projects/[path]/memory/MEMORY.md    (memory index)
~/.claude/projects/[path]/memory/*.md         (memory files)
.claude/plans/[feature].md                     (at least one plan)
.claude/skills/[name]/SKILL.md                (at least one skill)
.claude/settings.json                          (hooks configured)
```

2. **Run a smoke test:** Start a new Claude Code session in the project and verify:
   - CLAUDE.md rules are respected
   - Memory is loaded and relevant
   - Skills are triggerable
   - Hooks fire correctly

3. **Teach the maintenance cycle:**

| When | Action |
|------|--------|
| You learn something new | Add or update a memory file |
| The user corrects you | Save a feedback memory immediately |
| Starting a new feature | Build a plan (Phase 5 template) |
| A task becomes repeatable | Create a skill (Phase 6 template) |
| A plan is completed | Update memory with learnings, archive the plan |
| Something keeps going wrong | Add it to Project CLAUDE.md gotchas |
| A rule applies to all projects | Promote it to Global CLAUDE.md |

4. **The hierarchy of truth:**
   - **Code is truth** — if memory contradicts code, trust the code
   - **Git log is truth** — if memory contradicts history, trust git
   - **Memory is hypothesis** — always re-verify before acting on old memories
   - **Plans are contracts** — follow them unless you explicitly decide to deviate (and log why)
   - **CLAUDE.md is law** — these rules are non-negotiable unless the user changes them

---

## Quick Start (If You Just Want to Get Going)

If 8 phases feels like a lot, here's the minimum viable context system:

1. **Write `./CLAUDE.md`** with hard rules + architecture + gotchas (Phase 3) — this alone is a 5x improvement
2. **Write one plan** for your current task (Phase 5) — this prevents wasted cycles
3. **Add to context as you go** — when you learn something, save a memory; when you repeat something, make a skill

You can always come back and build out the other layers. The system is designed to grow incrementally.

---

## Reference: Context Layer Cheat Sheet

```
┌─────────────────────────────────────────────────┐
│  ~/.claude/CLAUDE.md          PERMANENT/GLOBAL  │
│  "Always use Pydantic. Never use any types."    │
├─────────────────────────────────────────────────┤
│  ./CLAUDE.md                  PERMANENT/PROJECT │
│  "Auth uses OAuth2. Deploy via GitLab CI."      │
├─────────────────────────────────────────────────┤
│  memory/*.md                  EVOLVING/PROJECT  │
│  "Cross-location JOINs need location_id."       │
├─────────────────────────────────────────────────┤
│  .claude/plans/*.md           FROZEN/FEATURE    │
│  "WP1: Change file.py:45 from X to Y. AC: ..." │
├─────────────────────────────────────────────────┤
│  .claude/skills/*/SKILL.md    PERMANENT/TASK    │
│  "Step 1: Run harness. Step 2: If exit 1..."    │
├─────────────────────────────────────────────────┤
│  .claude/settings.json        PERMANENT/PROJECT │
│  hooks: { PreToolUse: "check phase gate" }      │
├─────────────────────────────────────────────────┤
│  Sub-agents                   EPHEMERAL/SESSION │
│  "Wave 1: 6 scouts. Wave 2: 1 deep dive."      │
└─────────────────────────────────────────────────┘
```
