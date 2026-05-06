# Claude Code Skills — Training Deck

> Sources: [What are skills?](https://youtu.be/bjdBVZa66oU) · [Master 95% of Claude Code Skills in 28 Minutes](https://youtu.be/zKBPwDpBfhs) · [Build Self-Improving Claude Code Skills](https://youtu.be/wQ0duoTeAAU)

---

## Section 1: What Are Skills and How to Make Them

---

### 1.1 The Problem Skills Solve

Every session, you re-explain the same things to Claude:
- Your commit message style
- Your code review checklist
- Your brand voice and tone
- How you like things formatted

**Skills fix this.** Write it once. Claude applies it automatically — forever.

---

### 1.2 What Is a Skill?

A skill is a **markdown file** that teaches Claude how to do something once. Claude reads the description, recognizes when the situation applies, and loads the full instructions automatically.

**Mental model:** An SOP for your AI agent. Same way you train a human employee with a standard operating procedure.

```
.claude/skills/commit-messages/
├── skill.md          ← the brain (YAML front matter + instructions)
├── examples.md       ← optional reference file
└── scripts/          ← optional scripts
```

---

### 1.3 Skills vs. CLAUDE.md vs. Slash Commands

| | CLAUDE.md | Skill | Slash Command |
|---|---|---|---|
| **When it loads** | Every conversation | On-demand, when matched | Only when you type it |
| **Best for** | Hard rules, always-on context | Repeatable workflows | One-off explicit invocations |
| **Context cost** | Always burns tokens | Lightweight — YAML only until matched | Zero until invoked |

**Rule of thumb:** If you're re-explaining the same workflow more than twice, it's a skill.

---

### 1.4 Two Storage Tiers

| Tier | Location | Scope |
|---|---|---|
| **Personal** | `~/.claude/skills/` | Follows you across all projects |
| **Project** | `.claude/skills/` | Anyone who clones the repo gets it |

Use **personal** for: your preferences, your tone of voice, how you like things explained.  
Use **project** for: team standards, brand guidelines, CI/CD workflows, shared SOPs.

---

### 1.5 How Claude Finds Skills — Progressive Context Loading

Claude is efficient. It doesn't read every skill file on every request.

```
Level 1 — Scan (always runs):
  Reads ONLY the YAML front matter (name + description)
  ~100 tokens per skill

Level 2 — Load (if matched):
  Reads the full skill.md body
  ~1,000–2,000 tokens

Level 3 — Deep load (only if needed):
  Loads reference files and scripts
  Only when the task requires them
```

**Implication:** Your YAML `description` is the most important line in the entire skill. Get it wrong and the skill never fires.

---

### 1.6 Two Trigger Methods

**1. Explicit — slash command:**
```
/commit-messages
```

**2. Natural language — automatic:**
```
"write a commit message for this change"
```
Claude matches the request against skill descriptions and loads the right one.

**Advanced YAML options** to control triggering:
```yaml
---
name: commit-messages
description: Format git commit messages using conventional commits style
disable model invocation: false    # set true to require explicit slash command only
allowed tools: [Bash, Edit]
argument hint: "branch or change description"
---
```

---

### 1.7 Anatomy of a Skill File

```markdown
---
name: commit-messages
description: Format git commit messages following conventional commits — use when writing or reviewing any commit
---

## Goal
Produce a well-structured commit message every time.

## Process
1. Read the staged diff or change description
2. Identify the type: feat / fix / chore / docs / refactor
3. Write subject line: type(scope): imperative summary under 72 chars
4. Add body: what changed and why (not how)
5. Add footer for breaking changes or issue references

## Rules
- Never use past tense ("added" → "add")
- Never exceed 72 characters on the subject line
- Always reference the ticket number if provided

## Reference
See ./examples.md for 10 approved examples
```

**Hard limit:** Keep `skill.md` under 500 lines. Move detailed reference material to separate files.

---

### 1.8 The Six-Step Build Framework

| Step | Question |
|---|---|
| **1. Name & trigger** | What is it called? What natural language should fire it? |
| **2. Goal** | One sentence: what does it accomplish? What is the output? |
| **3. Process** | Step-by-step: exactly what happens in what order? |
| **4. Reference files** | What context does it need? (style guides, brand assets, project info) |
| **5. Rules** | What could go wrong? Build in guardrails. |
| **6. Self-improvement loop** | How will you test and iterate? |

---

### 1.9 Reference Files — Two Patterns

**Self-contained (preferred for portability):**
```
.claude/skills/brand-voice/
├── skill.md
├── tone-of-voice.md      ← lives next to the skill
└── approved-phrases.md
```

**External (useful if docs are shared):**
```markdown
## Reference
See /docs/brand/tone-of-voice.md for voice guidelines
```

**Tip:** Prefer markdown reference docs over live API calls. Processing markdown is ~10x cheaper and faster than HTTP requests.

---

### 1.10 Debugging Guide

| Symptom | Fix |
|---|---|
| Wrong steps or wrong order | Edit skill.md instructions |
| Missing tone, style, context | Add reference files |
| Same mistake repeating | Add a rule |
| Struggles with a tool, keeps searching | Create a reference doc explaining the tool |
| Works but could improve | Run it 20–30 times, give feedback after each |
| **Skill isn't triggering** | **Check YAML description — make it more specific** |
| Skill triggers too often | Set `disable model invocation: true` in YAML |

---

### 1.11 The Feedback Cycle

Skills are not perfect on the first run. That's expected.

```
Invoke skill
    ↓
Watch it work (don't skip this)
    ↓
Spot something off — wrong format, redundant step, missing context
    ↓
Tell Claude: "That's wrong because X, fix the skill"
    ↓
Claude edits skill.md
    ↓
Run again
    ↓
Repeat for 20–30 runs
```

By run 20–30, the skill is highly refined. By run 1, it's a draft. **The first version is never the final version.**

---

---

## Section 2: Auto-Improve

---

### 2.1 The Problem With Manual Iteration

The manual improvement cycle is:

```
Run skill → spot something wrong → edit skill.md → run again → spot something wrong → ...
```

This is slow, inconsistent, and stops when you stop. Skills plateau at "pretty good" instead of reaching "reliable."

The insight from Andrej Karpathy's **Autoresearch** concept:

> Give a system something to improve + one clear binary metric.  
> It loops overnight while you sleep.

---

### 2.2 Two Layers of Skill Self-Improvement

```
Layer 1: Description Loop    → fixes whether the skill TRIGGERS correctly
Layer 2: Assertion Loop      → fixes whether the skill OUTPUT is correct
```

Both are automated. Both run without you.

---

### 2.3 Layer 1 — Description Improvement (Built In)

**Problem it solves:** Community testing found skills trigger correctly only ~20% of the time with vague descriptions.

**How it works (already built into the Skill Creator skill):**
1. Run test queries — some should trigger the skill, some shouldn't
2. Measure trigger accuracy (true positives + true negatives)
3. If accuracy is low, propose a better description
4. Retest
5. Repeat until activation rate is acceptable

**You don't need to build this.** It's inside the Skill Creator. Just use it.

---

### 2.4 Layer 2 — Binary Assertion Loop (The New Thing)

This is the Karpathy-inspired loop that fixes **output quality**, not just triggering.

**The core principle:** Use only binary (true/false) assertions. No subjective scoring.

```
✅ Works:                              ❌ Doesn't work:
"does not contain em dashes"          "is it compelling?"
"under 300 words"                     "does it sound professional?"
"final line is a question"            "is the tone right?"
"subject line is under 72 chars"
"contains a bullet list"
```

**Subjective quality still needs human judgment.** The loop handles structure, format, constraints, and forbidden patterns.

---

### 2.5 Setting Up the Assertion Loop

**Step 1 — Create an eval folder inside your skill:**
```
.claude/skills/your-skill/
├── skill.md
├── reference.md
└── eval/
    └── eval.json          ← your assertions live here
```

**Step 2 — Write `eval.json`:**
```json
{
  "test_cases": [
    {
      "prompt": "Write a commit message for adding user authentication",
      "assertions": [
        "subject line is under 72 characters",
        "subject line uses imperative tense",
        "subject line starts with feat or fix",
        "does not contain the word 'added'",
        "includes a body paragraph"
      ]
    },
    {
      "prompt": "Write a commit message for fixing a null pointer bug",
      "assertions": [
        "subject line starts with fix",
        "subject line is under 72 characters",
        "does not use past tense",
        "body explains why not just what"
      ]
    }
  ]
}
```

**Target:** 5 test prompts × 5 assertions each = 25 binary checks.

---

### 2.6 Running the Loop

Tell Claude:

```
Run the self-improvement loop on my commit-messages skill.
Use eval/eval.json.
Keep looping until you hit a perfect score or I stop you.
```

**What Claude does:**
```
Run all test prompts
    ↓
Check every assertion (true/false)
    ↓
Score = passing assertions / total assertions
    ↓
If score improved → git commit (keep the change)
If score dropped  → git reset (roll it back)
    ↓
Make ONE change to skill.md
    ↓
Loop
```

**One change per loop.** This is critical — it makes improvements attributable and rollbacks clean.

---

### 2.7 What the Loop Can and Cannot Fix

| Can fix (structural) | Cannot fix (human judgment needed) |
|---|---|
| Missing formatting rules | Tone of voice |
| Forbidden patterns (em dashes, passive voice) | Creative quality |
| Word count violations | Whether reference files are used correctly |
| Structural requirements (bullet list, subject line) | Brand feel |
| Contradictions between skill.md and reference files | Strategic judgment |

**Example from the video:** Marketing skill at v5, 95.8% score (23/24). One failing assertion: "end with a question." The rule was in `tone-of-voice.md` but not `skill.md` — contradictory. Loop added it to `skill.md`. Next run: 100%.

---

### 2.8 Practical Workflow — Start to Reliable

```
Week 1: Build the skill
  ├─ Use the six-step framework
  ├─ Write skill.md + reference files
  └─ Run it manually 5–10 times, give feedback

Week 1–2: Layer 1 automation
  ├─ Run the built-in description improvement loop
  └─ Verify skill is triggering correctly

Week 2: Layer 2 automation
  ├─ Write eval.json with 25 binary assertions
  ├─ Start the overnight loop: "keep going until perfect score"
  └─ Check results in the morning — review git log

Ongoing: Human review
  ├─ Run the skill on real work
  ├─ Check for tone/creativity gaps (these won't auto-fix)
  └─ Add new assertions as you find new edge cases
```

---

### 2.9 Key Principles to Remember

1. **YAML description is everything.** It controls whether the skill fires at all. Spend time on it.

2. **One change per loop iteration.** Keeps improvements clean and rollbacks safe.

3. **Binary assertions only.** Subjective scoring breaks the automation. If you can't answer true/false, it's not an assertion.

4. **Skills compound.** Skills can call other skills. A morning planning skill can invoke a task skill, a calendar skill, and a summary skill in parallel.

5. **Watch at least the first few runs.** Spot token waste, redundant API calls, and incorrect decision points before automating.

6. **The loop is not done for you.** It improves structure. You still own tone, creativity, and strategic alignment.

---

### 2.10 Quick Reference Card

```
Build a skill:
  mkdir .claude/skills/my-skill
  touch .claude/skills/my-skill/skill.md
  # Add YAML front matter + 6-step framework

Run description loop (triggering):
  /skill-creator → built-in loop

Run assertion loop (output quality):
  Create eval/eval.json with 25 binary assertions
  "Run self-improvement loop, use eval.json, keep going until perfect"

Debug activation:
  Description too vague? → make it more specific
  Triggers too much? → disable model invocation in YAML

Debug output:
  Wrong format? → add rule to skill.md
  Same mistake? → add explicit prohibition
  Missing context? → add reference file
```

---

*Training deck compiled from official Anthropic skills documentation and community tutorials.*
