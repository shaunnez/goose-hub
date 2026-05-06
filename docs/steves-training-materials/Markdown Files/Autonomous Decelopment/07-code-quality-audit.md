# Training: Building a Code Quality Audit

How to build an 8-category complexity audit that combines automated metrics with
qualitative analysis to produce a scored, actionable report. This document teaches
the rubric and process; the companion template at the end is pluggable.

---

## Philosophy: Measure, Don't Guess

Code quality opinions are cheap. Scored evidence is valuable. This audit combines
two types of measurement:

1. **Automated metrics** -- cyclomatic complexity, LOC counts, fan-out analysis,
   maintainability index. These are objective and fast.
2. **Qualitative analysis** -- extension points, concept count, complecting,
   evolutionary history. These require reading code and making judgments, but each
   judgment cites specific file:line evidence.

The output is a 100-point scored report with ranked recommendations. Not a subjective
review -- a structured audit.

---

## The 8-Category Rubric

| # | Category | Points | Source | Question |
|---|----------|--------|--------|----------|
| 1 | Open/Closed Compliance | 20 | Qualitative | Can you add a new capability without modifying existing files? |
| 2 | Concept Count | 15 | Qualitative | How many concepts must a developer learn to add one capability? |
| 3 | Time-to-New-Capability | 15 | Qualitative | How long for a familiar developer to add a new capability? |
| 4 | Complecting Score | 15 | Qualitative | How many files braid independent concerns together? |
| 5 | LOC Discipline | 10 | Automated | What percentage of files are under 200 SLOC? |
| 6 | Coupling / Fan-Out | 10 | Automated | How many imports does each file pull in? |
| 7 | Gall's Law Compliance | 10 | Qualitative | Did the architecture evolve incrementally from simpler working versions? |
| 8 | Cyclomatic Complexity | 5 | Automated | What percentage of functions have CC <= 10? |

**Total: 100 points**

---

## Automated Categories (3 of 8)

These are scored by a metrics script. Do not re-score them -- use the script output.

### Category 5: LOC Discipline (10 pts)

| Score | Criteria |
|-------|----------|
| 10 | All files under 200 SLOC |
| 8 | 90%+ under 200 SLOC |
| 5 | 70-89% under 200 SLOC |
| 3 | 50-69% under 200 SLOC |
| 0 | < 50% under 200 SLOC |

**Note:** Pure data-model files (Pydantic schemas, TypedDicts with no logic) are
exempt if they contain no logic. Note this in evidence if it affects the score.

### Category 6: Coupling / Fan-Out (10 pts)

Fan-out thresholds by component type:

| Component Type | Healthy | Warning | Critical |
|---------------|---------|---------|----------|
| Config/manifest | 0-2 imports | 3-4 | 5+ |
| Tool/handler | 1-3 imports | 4-5 | 6+ |
| Entry point | 2-3 imports | 4-5 | 6+ |
| Orchestrator | 3-5 imports | 6-8 | 9+ |

### Category 8: Cyclomatic Complexity (5 pts)

| Score | Criteria |
|-------|----------|
| 5 | All functions CC <= 10 |
| 4 | 90%+ CC <= 10 |
| 3 | 80-89% CC <= 10 |
| 1 | 60-79% CC <= 10 |
| 0 | < 60% CC <= 10 |

---

## Qualitative Categories (5 of 8)

These require reading code and collecting evidence.

### Category 1: Open/Closed Compliance (20 pts)

**The most important category.** It measures the fundamental extensibility of the
architecture.

**Step 1:** Identify the extension point. Where are new capabilities registered?
Look for registries, `__init__.py` with explicit lists, manifest directories,
if/elif chains in dispatch code.

**Step 2:** Walk "add one new capability" end-to-end:
```
Files to CREATE: ___
Files to MODIFY: ___
Core platform files that must change: ___
```

**Step 3:** Count type-branch violations (if/elif type dispatch in shared code).

| Score | Criteria |
|-------|----------|
| 20 | 1 new file, 0 existing files modified |
| 15 | 1-2 new files, 1 existing file (e.g. registry import) |
| 10 | 2-3 existing files modified |
| 5 | 4+ existing files modified |
| 0 | Core platform code must change |

### Category 2: Concept Count (15 pts)

A "concept" = a distinct abstraction a developer must understand. Examples: "manifest
schema," "tool contract," "auth gate," "state schema," "streaming protocol."

Walk the registration path for the simplest existing capability. Count unique concepts.

| Score | Concept count |
|-------|--------------|
| 15 | 3-5 |
| 12 | 6-8 |
| 8 | 9-12 |
| 4 | 13-15 |
| 0 | 16+ |

### Category 3: Time-to-New-Capability (15 pts)

Based on the path walked in Category 1:

| Score | Time |
|-------|------|
| 15 | < 1 hour (config-only) |
| 12 | 1-4 hours (config + new function + register) |
| 8 | 4-8 hours (config + business logic + custom streaming) |
| 4 | 1-2 days (must understand platform internals) |
| 0 | 3+ days (platform code must change) |

### Category 4: Complecting Score (15 pts)

A "complecting instance" = two independent concerns braided into one file. Take the
top 5 largest files (by SLOC). For each:

1. Read its first ~100 lines and imports
2. List every independent concern (auth + routing + business logic + streaming = 4 concerns = 3 complecting instances)
3. A concern is independent if removing it leaves both pieces functional

| Score | Complecting instances across top-5 |
|-------|------------------------------------|
| 15 | 0 (each handles exactly 1 concern) |
| 12 | 1-2 |
| 8 | 3-5 |
| 4 | 6-10 |
| 0 | Pervasive |

### Category 7: Gall's Law Compliance (10 pts)

Check git history for evolutionary patterns:

```bash
# Commit volume by month
git log --pretty=format:"%ad" --date=format:"%Y-%m" | sort | uniq -c

# Large commits (>1000 line additions)
git log --pretty=format:"%H %s" --shortstat | head -40

# Oldest files per subsystem
git log --diff-filter=A --pretty=format:"%ad %f" --date=short -- "*.py" | sort | head -20
```

| Score | Criteria |
|-------|----------|
| 10 | Clear incremental evolution, intermediate states validated |
| 7 | Mostly evolutionary, 1-2 big-bang additions |
| 4 | Mixed |
| 2 | Mostly big-bang |
| 0 | Designed from scratch, no intermediate working states |

---

## Principle Citations

When justifying scores, cite the relevant principle:

| Finding | Principle | Citation |
|---------|-----------|---------|
| if/elif type dispatch in shared code | Open/Closed | SOLID-O: "open for extension, closed for modification" |
| 1000-line files | Unix Philosophy | McIlroy: "small is beautiful" |
| Multiple concerns in one module | Complecting | Hickey: "braid = complect; count the braids" |
| Adding capability requires runtime changes | Gall's Law | "A complex system designed from scratch never works" |
| 5+ params per function | Metz | Metz Rule 3: "4 parameters max per method" |
| Behavior driven by algorithms not data | Pike | Pike Rule 5: "data dominates" |

---

## Report Format

The audit produces a standardized Markdown report:

```markdown
# Complexity Audit: [System/Subsystem]

**Date:** YYYY-MM-DD
**Target:** [path audited]
**Tool:** metrics script + qualitative analysis

## Score: XX/100 -- "[Rating]"

[1-2 sentence summary of dominant finding]

## Inventory

| Metric | Value |
|--------|-------|
| Files | ... |
| Total LOC | ... |
| Total SLOC | ... |
| CC > 10 functions | .../... (X%) |

## Scorecard

| # | Category | Score | Evidence |
|---|----------|-------|---------|
| 1 | Open/Closed | X/20 | [file walk] |
| 2 | Concept Count | X/15 | [concept list] |
| 3 | Time-to-Capability | X/15 | [estimate] |
| 4 | Complecting | X/15 | [top-5 analysis] |
| 5 | LOC Discipline | X/10 | [from script] |
| 6 | Coupling | X/10 | [from script] |
| 7 | Gall's Law | X/10 | [git evidence] |
| 8 | Cyclomatic | X/5 | [from script] |
| | **Total** | **XX/100** | |

**Rating:** 90-100 Exemplary / 75-89 Good / 60-74 Needs Work / 40-59 Concerning / 0-39 Redesign

## What's Excellent (Don't Touch)
- [strength with principle citation]

## What Needs Work (Ranked by Score Impact)

### P0: [highest-impact fix]
- **Principle:** [citation]
- **Evidence:** [file:line]
- **Fix:** [specific action]
- **Effort:** Low/Medium/High
- **Impact:** +N pts (Category N)

## The McIlroy Question: What Can We Throw Out?

| Component | Recommendation | Reasoning |
|-----------|---------------|-----------|
| [name] | Keep/Remove/Audit | [why] |

## Projected Score After Top 3 Fixes

| Category | Current | After | Delta |
|----------|---------|-------|-------|
| ... | ... | ... | +N |
| **Total** | **XX** | **XX** | **+XX** |
```

---

## Pluggable Template

Copy everything below into `.claude/skills/code-quality/SKILL.md`.

---

```markdown
---
name: code-quality
description: >
  Complexity audit using the 8-category rubric. Runs automated metrics then
  performs qualitative analysis to produce a scored 100-point report.
  Invoke with: /code-quality [optional: path or subsystem]
---

# Code Quality Audit Skill

## 1. Identity

You are a **software architecture auditor**. Your job is to measure, score, and
recommend -- not to implement. You produce a scored report.

**Your tools:**
- `python3 scripts/{{metrics_script}}.py --target <path> --json` -- automated metrics
- Read, Grep, Glob -- qualitative investigation
- Bash (`git log`, `git shortlog`) -- evolutionary evidence

**Your constraints:**
- NEVER guess -- every score cites specific file:line evidence
- NEVER skip the automated script
- ALWAYS complete all 8 categories
- Scores are point-in-time snapshots; note the date

## 2. Startup

1. Parse target (default: whole repo)
2. Run: `python3 scripts/{{metrics_script}}.py --target <target> --json`
3. Parse JSON (gives automated scores for categories 5, 6, 8)
4. Proceed through qualitative analysis

## 3. Qualitative Analysis

### Category 1: Open/Closed (20 pts)
Walk "add one capability" end-to-end. Count files created vs modified.

### Category 2: Concept Count (15 pts)
Walk the registration path. Count distinct abstractions.

### Category 3: Time-to-Capability (15 pts)
Estimate based on Category 1 path.

### Category 4: Complecting (15 pts)
Top 5 largest files. Count independent concerns per file.

### Category 7: Gall's Law (10 pts)
Git history: steady evolution vs big-bang commits.

## 4. Report

Produce the standardized report format (see training doc for exact structure).

**Rating scale:**
- 90-100 Exemplary
- 75-89 Good
- 60-74 Needs Work
- 40-59 Concerning
- 0-39 Redesign Required
```

---

**End of Code Quality Audit Training Document**
