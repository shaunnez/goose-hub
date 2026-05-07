<!-- Slide number: 1 -->

Claude Code Skills

What They Are, How to Build Them, and How to Make Them Self-Improving
Based on official Anthropic docs + community tutorials

### Notes:

<!-- Slide number: 2 -->

1
SECTION 1
What Are Skillsand How to Make Them

### Notes:

<!-- Slide number: 3 -->

You're Re-Explaining Yourself Every Session
• Your commit message style
• Your code review checklist
• Your brand voice and tone
• How you like things formatted

Skills fix this.  Write it once.  Claude applies it automatically — forever.

Claude Code Skills  ·  Anthropic + Community Docs

### Notes:

<!-- Slide number: 4 -->

A Skill Is a Markdown File That Teaches Claude Once
File structure
• Claude reads the description, recognises the situation, and loads the instructions
• Think of it as an SOP for your AI agent
• Skills can run scripts, call APIs, create files, spin up sub-agents
• Skills can call other skills

.claude/skills/commit-messages/
├── skill.md          ← the brain
├── examples.md       ← optional ref
└── scripts/          ← optional

Claude Code Skills  ·  Anthropic + Community Docs

### Notes:

<!-- Slide number: 5 -->

Know When to Use Each
| Feature | CLAUDE.md | Skill | Slash Command |
| --- | --- | --- | --- |
| When it loads | Every conversation | On-demand when matched | Only when you type it |
| Best for | Hard rules, always-on context | Repeatable workflows | One-off explicit invocations |
| Context cost | Always burns tokens | Lightweight — YAML only until matched | Zero until invoked |

Claude Code Skills  ·  Anthropic + Community Docs

### Notes:

<!-- Slide number: 6 -->

Personal vs. Project Skills

~/.claude/skills/   Personal
.claude/skills/   Project

• Follows you across ALL projects
• Your preferences, tone, and style
• Example: how you like commits
• Example: how you like code explained
• Only in this repo
• Anyone who clones it gets these skills
• Example: team standards, brand guidelines
• Example: CI workflows

Claude Code Skills  ·  Anthropic + Community Docs

### Notes:

<!-- Slide number: 7 -->

Claude Doesn't Read Everything — It's Efficient

Level 1 — Always
Scans YAML front matter only  (~100 tokens per skill)

Level 2 — If matched
Reads full skill.md body  (~1,000–2,000 tokens)

Level 3 — If needed
Loads reference files and scripts

Your YAML description is the most important line in the skill.  Get it wrong and the skill never fires.

Claude Code Skills  ·  Anthropic + Community Docs

### Notes:

<!-- Slide number: 8 -->

Explicit or Natural Language

Explicit — slash command
Natural language — automatic

/commit-messages
"write a commit message
 for this change"
You type the exact slash command.
Claude matches the request to skill descriptions automatically.

Claude Code Skills  ·  Anthropic + Community Docs

### Notes:

<!-- Slide number: 9 -->

The skill.md Structure
Keep skill.md under 500 lines

---
name: commit-messages
description: Format git commit messages using
  conventional commits — use when writing or
  reviewing any commit
---

## Goal
Produce a well-structured commit message every time.

## Process
1. Read the staged diff or change description
2. Identify the type: feat / fix / chore / docs
3. Write subject line under 72 chars

## Rules
- Never use past tense
- Never exceed 72 characters

## Reference
See ./examples.md for approved examples

Claude Code Skills  ·  Anthropic + Community Docs

### Notes:

<!-- Slide number: 10 -->

Six Steps from Blank File to Working Skill
| Step | Focus Question |
| --- | --- |
| 1 · Name & Trigger | What is it called? What natural language fires it? |
| 2 · Goal | One sentence: what does it accomplish? What is the output? |
| 3 · Process | Step-by-step: exactly what happens in what order? |
| 4 · Reference Files | What context does it need? Style guides, brand assets? |
| 5 · Rules | What could go wrong? Build in guardrails. |
| 6 · Self-Improvement | How will you test and iterate? |

Claude Code Skills  ·  Anthropic + Community Docs

### Notes:

<!-- Slide number: 11 -->

When Things Go Wrong
| Symptom | Fix |
| --- | --- |
| Wrong steps or wrong order | Edit skill.md instructions |
| Missing tone, style, or context | Add reference files |
| Same mistake repeating | Add a rule |
| Struggles with a tool | Create a reference doc for the tool |
| Skill isn't triggering | Fix the YAML description — make it more specific |
| Skill triggers too often | Set disable model invocation: true in YAML |

Claude Code Skills  ·  Anthropic + Community Docs

### Notes:

<!-- Slide number: 12 -->

The First Version Is Always a Draft

1 · Invoke skill
2 · Watch it work (don't skip this)
3 · Spot something wrong

4 · Tell Claude: 'That's wrong because X — fix the skill'
5 · Claude edits skill.md
6 · Run again → repeat for 20–30 runs

By run 20–30, the skill is highly refined.

Claude Code Skills  ·  Anthropic + Community Docs

### Notes:

<!-- Slide number: 13 -->

2
SECTION 2
Auto-Improve

### Notes:

<!-- Slide number: 14 -->

Manual Improvement Plateaus at 'Pretty Good'
The slow loop:

Run skill
Spot something wrong
Edit skill.md
Run again
Repeat
Eventually stops
→
→
→
→
→

Karpathy Insight
"Give a system something to improve + one clear binary metric. It loops overnight while you sleep."

Claude Code Skills  ·  Anthropic + Community Docs

### Notes:

<!-- Slide number: 15 -->

Fix Triggering, Then Fix Output

Layer 1
Layer 2
Description Loop
Assertion Loop

→ Fixes whether the skill TRIGGERS correctly
→ Fixes whether the skill OUTPUT is correct
Already built into the Skill CreatorActivation rate was as low as 20% with vague descriptions
Karpathy-inspired binary scoringRuns overnight autonomously

Claude Code Skills  ·  Anthropic + Community Docs

### Notes:

<!-- Slide number: 16 -->

Already Done For You — Just Use It
1
Run test queries
Some should trigger, some shouldn't

2
Measure trigger accuracy
Count true positives + true negatives

3
Propose a better description
If accuracy is low, rewrite the YAML

4
Retest
Run the same queries again

5
Repeat
Until activation rate is acceptable

This is inside the Skill Creator skill.  Run  /skill-creator  to access it.

Claude Code Skills  ·  Anthropic + Community Docs

### Notes:

<!-- Slide number: 17 -->

Only Use True/False Assertions

Works  (binary assertions)
Doesn't work  (subjective)
• "does not contain em dashes"
• "under 300 words"
• "final line is a question"
• "subject line is under 72 chars"
• "contains a bullet list"
• "is it compelling?"
• "does it sound professional?"
• "is the tone right?"
• "is it creative enough?"

Subjective quality still needs human judgment.  The loop handles structure, format, and constraints.

Claude Code Skills  ·  Anthropic + Community Docs

### Notes:

<!-- Slide number: 18 -->

Create eval.json with 25 Binary Assertions
Folder structure
eval/eval.json

.claude/skills/your-skill/
├── skill.md
├── reference.md
└── eval/
    └── eval.json
{
  "test_cases": [
    {
      "prompt": "Write a commit message...",
      "assertions": [
        "subject line is under 72 characters",
        "uses imperative tense",
        "starts with feat or fix",
        "does not contain the word added",
        "includes a body paragraph"
      ]
    }
  ]
}

Target: 5 test prompts × 5 assertions = 25 binary checks

Claude Code Skills  ·  Anthropic + Community Docs

### Notes:

<!-- Slide number: 19 -->

One Change Per Iteration.  Loops Until Perfect.
Prompt to use:

Run all test prompts

"Run the self-improvement
 loop on my X skill.
 Use eval/eval.json.
 Keep looping until perfect
 score or I stop you."

Check every assertion (true/false)

Score = passing / total

Improved? → git commit  (keep)Dropped? → git reset  (roll back)

Make ONE change to skill.md

Loop →

Claude Code Skills  ·  Anthropic + Community Docs

### Notes:

<!-- Slide number: 20 -->

Structure Yes.  Tone No.
| Can Fix (structural) | Cannot Fix (human judgment) |
| --- | --- |
| Missing formatting rules | Tone of voice |
| Forbidden patterns | Creative quality |
| Word count violations | Whether reference files are used well |
| Structural requirements | Brand feel |
| Contradictions between files | Strategic judgment |

Real example: Marketing skill at v5 scored 23/24 (95.8%).  Failing assertion: "end with a question."Rule was in tone-of-voice.md but not skill.md — contradiction.  Loop added it.  Next run: 100%.

Claude Code Skills  ·  Anthropic + Community Docs

### Notes:

<!-- Slide number: 21 -->

From Blank File to Reliable Skill

Week 1Build
Week 1–2Layer 1
Week 2Layer 2
OngoingHuman Review

• Use the six-step framework
• Write skill.md + reference files
• Run manually 5–10 times, give feedback
• Run the built-in description improvement loop
• Verify skill is triggering correctly
• Write eval.json with 25 binary assertions
• Start overnight loop: 'keep going until perfect score'
• Review git log in the morning
• Check for tone/creativity gaps (won't auto-fix)
• Add new assertions as edge cases emerge

Claude Code Skills  ·  Anthropic + Community Docs

### Notes:

<!-- Slide number: 22 -->

Five Things to Remember
1
YAML description is everything
It controls whether the skill fires at all

2
One change per loop iteration
Keeps rollbacks clean and measurable

3
Binary assertions only
Subjective scoring breaks automation

4
Skills compound
Skills can call other skills in parallel

5
Watch the first few runs
Spot token waste before automating

Claude Code Skills  ·  Anthropic + Community Docs

### Notes:

<!-- Slide number: 23 -->

Quick Reference

Build a skill
Fix triggering
mkdir .claude/skills/my-skill && touch skill.mdAdd YAML front matter + six-step framework
/skill-creator → built-in description loop

Fix output quality
Debug
Create eval/eval.json with 25 binary assertions"Run self-improvement loop, use eval.json, keep going until perfect"
Not triggering? → Fix YAML descriptionTriggers too much? → disable model invocation: trueWrong output? → Add rules, add reference files

Based on official Anthropic docs + community tutorials

### Notes:
