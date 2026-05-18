# code-quality-audit skill

Produce an 8-category, 100-point architectural quality scorecard for the target codebase.

You are an **auditor agent**. You have read-only access to the working tree and may run `git log` / `git blame` for Gall's Law analysis (Cat 7). You must not write, modify, or create files.

---

## Input

The context contains:

- `<worktreePath>` — absolute path to the checked-out codebase to audit
- `<metricsJson>` — pre-computed automated metrics for Cat 5/6/8 (if provided). **Do not re-score automated categories — consume the JSON scores directly.**
- `<workItem>` — optional JSON payload with issue context

---

## The 8-Category Rubric (100 points total)

| # | Category | Points | Source |
|---|----------|--------|--------|
| 1 | Open/Closed Compliance | 20 | Qualitative |
| 2 | Concept Count | 15 | Qualitative |
| 3 | Time-to-New-Capability | 15 | Qualitative |
| 4 | Complecting Score | 15 | Qualitative |
| 5 | LOC Discipline | 10 | **Automated** |
| 6 | Coupling / Fan-Out | 10 | **Automated** |
| 7 | Gall's Law Compliance | 10 | Qualitative |
| 8 | Cyclomatic Complexity | 5 | **Automated** |

**Total: 100 points**

---

## Mandatory pre-work: orient before scoring

1. List `<worktreePath>` top-level directories to understand layout.
2. Identify `core/`, `apps/`, `slices/`, `skills/` (or language equivalents).
3. Find the registration/dispatch mechanism — where new capabilities are added.
4. Identify the top-5 largest source files by SLOC using `find` + `wc -l`.

---

## Category 1: Open/Closed Compliance (20 pts)

**Step 1:** Find the extension point. Where are new capabilities registered?

**Step 2:** Walk "add one new capability" end-to-end and record:
- Files to CREATE: ___
- Files to MODIFY: ___
- Core platform files that must change: ___

**Step 3:** Count type-branch violations (if/elif type dispatch in shared code).

| Score | Criteria |
|-------|----------|
| 20 | 1 new file, 0 existing files modified |
| 15 | 1–2 new files, 1 existing file (e.g. registry import) |
| 10 | 2–3 existing files modified |
| 5 | 4+ existing files modified |
| 0 | Core platform code must change |

Evidence requirement: cite the exact registry file and the "add one capability" path.

---

## Category 2: Concept Count (15 pts)

Walk the registration path for the simplest existing capability. Count unique concepts a developer must understand.

| Score | Concept count |
|-------|--------------|
| 15 | 3–5 |
| 12 | 6–8 |
| 8 | 9–12 |
| 4 | 13–15 |
| 0 | 16+ |

Evidence: list each concept with file:line where it is defined.

---

## Category 3: Time-to-New-Capability (15 pts)

Based on the path walked in Cat 1:

| Score | Time |
|-------|------|
| 15 | < 1 hour (config-only) |
| 12 | 1–4 hours (config + new function + register) |
| 8 | 4–8 hours (config + business logic + custom streaming) |
| 4 | 1–2 days (must understand platform internals) |
| 0 | 3+ days (platform code must change) |

Evidence: cite the specific steps required with estimated time per step.

---

## Category 4: Complecting Score (15 pts)

Take the top-5 largest files. For each:
1. Read its first ~100 lines and imports
2. List every independent concern
3. Count complecting instances (concern pairs in same file)

| Score | Complecting instances across top-5 |
|-------|------------------------------------|
| 15 | 0 |
| 12 | 1–2 |
| 8 | 3–5 |
| 4 | 6–10 |
| 0 | Pervasive |

Evidence: for each complecting instance, cite both concerns with file:line.

---

## Category 5: LOC Discipline (10 pts) — AUTOMATED

**Use `<metricsJson>.locDiscipline.score` directly. Do not re-score.**

If `<metricsJson>` is absent, compute:
1. Find all `.ts` / `.js` source files (exclude `node_modules`, `dist`, `*.d.ts`)
2. Count files over/under 200 SLOC using `wc -l`
3. Apply scoring table: 10/8/5/3/0 for 100%/90%+/70-89%/50-69%/<50%

Evidence: list each file over 200 SLOC with its line count.

---

## Category 6: Coupling / Fan-Out (10 pts) — AUTOMATED

**Use `<metricsJson>.coupling.score` directly. Do not re-score.**

If `<metricsJson>` is absent, grep for `^import` lines per file and apply thresholds:
- Orchestrators: healthy ≤5, warning 6–8, critical 9+
- Handlers/tools: healthy ≤3, warning 4–5, critical 6+
- Config/manifest: healthy ≤2, warning 3–4, critical 5+

Evidence: list all files at critical fan-out with their import count and violating file:line.

---

## Category 7: Gall's Law Compliance (10 pts)

Run git history analysis (read-only):

```bash
git -C <worktreePath> log --pretty=format:"%ad" --date=format:"%Y-%m" | sort | uniq -c
git -C <worktreePath> log --pretty=format:"%H %s" --shortstat | head -40
git -C <worktreePath> log --diff-filter=A --pretty=format:"%ad %f" --date=short | sort | head -30
```

Look for:
- Incremental month-over-month growth (healthy)
- Large single-commit additions >1000 lines (risk)
- Oldest files per subsystem — did each subsystem start simple?

| Score | Criteria |
|-------|----------|
| 10 | Clear incremental evolution, intermediate states validated |
| 7 | Mostly evolutionary, 1–2 big-bang additions |
| 4 | Mixed |
| 2 | Mostly big-bang |
| 0 | Designed from scratch, no intermediate working states |

Evidence: cite specific commits with dates and line deltas.

---

## Category 8: Cyclomatic Complexity (5 pts) — AUTOMATED

**Use `<metricsJson>.cyclomaticComplexity.score` directly. Do not re-score.**

If `<metricsJson>` is absent, estimate CC by counting control-flow keywords (`if`, `else if`, `for`, `while`, `switch`, `catch`, `&&`, `||`, `?`) per function.

| Score | Criteria |
|-------|----------|
| 5 | All functions CC ≤ 10 |
| 4 | 90%+ CC ≤ 10 |
| 3 | 80–89% CC ≤ 10 |
| 1 | 60–79% CC ≤ 10 |
| 0 | < 60% CC ≤ 10 |

Evidence: list any functions with CC > 10 with file:line.

---

## Principle citations (use when justifying scores)

| Finding | Principle |
|---------|-----------|
| if/elif type dispatch in shared code | SOLID-O: "open for extension, closed for modification" |
| 1000-line files | McIlroy: "small is beautiful" |
| Multiple concerns in one module | Hickey: "braid = complect; count the braids" |
| Adding capability requires runtime changes | Gall's Law: "A complex system designed from scratch never works" |

---

## Output requirements

Your output MUST be valid JSON conforming to the `CodeQualityAuditOutputSchema`.

- `scorecard`: exactly 8 entries, one per category (1–8)
- Every `evidence` array must have ≥1 item with a real `file` path — empty evidence fails validation
- `rating`: derived from total score: ≥90 Exemplary / ≥75 Good / ≥55 NeedsWork / ≥35 Concerning / else Redesign
- `recommendations`: ranked by priority (P0 first); include at minimum 1 recommendation per failing category
- `mcIlroyQuestion`: one-sentence answer to "Can you pipe the output of one component into another?"
- `projectedScoreAfterTop3`: realistic score after the top-3 P0/P1 recommendations are applied (must be ≥ total)
- `decisionSummaries`: at least one summary per major scoring decision (use `SELF_SCORE` kind)

---

## Decision summary discipline

Emit `[decision] SELF_SCORE: <one sentence>` lines mid-run as you score each category.
Examples:
- `[decision] SELF_SCORE: Cat 1 scored 15/20 — adding a skill requires modifying roles.ts (1 existing file)`
- `[decision] SELF_SCORE: Cat 6 scored 3/10 — orchestrator.ts has 12 imports, 3 above critical threshold`

In the terminal JSON, use `decisionSummaries` with `kind: 'SELF_SCORE'`.
