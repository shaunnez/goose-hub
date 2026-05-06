# Claude Code Training Documentation

Battle-tested patterns for building autonomous development workflows with Claude Code.
Each document teaches a pattern and includes a pluggable template you can drop into
a new project.

---

## Documents

| # | Document | What It Teaches | Template Produces |
|---|----------|----------------|-------------------|
| 01 | [Planning Phase](01-planning-phase.md) | User journeys, functional specs, investigation swarm, engineering specs, adversarial review | Three artifacts: user journeys, functional spec, engineering spec |
| 02 | [Skill Builder](02-skill-builder.md) | Anatomy of a SKILL.md, frontmatter, state machines, tool integration | A new Claude Code skill |
| 03 | [Lifecycle Harness](03-lifecycle-harness.md) | 10-phase state machine, gates, gated/autonomous modes, work packages | A full development lifecycle |
| 04 | [QA Routine](04-qa-routine.md) | 6-layer deterministic harness, Playwright, exit codes, directed testing | A QA verification harness |
| 05 | [Fix Loop](05-fix-loop.md) | Measure-triage-fix-verify cycle, finding classification, issue tracking | An autonomous fix loop |
| 06 | [Data Quality Check](06-data-quality-check.md) | ORM drift, N-way reconciliation, ETL vs app drift classification | A drift detection / reconciliation harness |
| 07 | [Code Quality Audit](07-code-quality-audit.md) | 8-category rubric, automated metrics + qualitative analysis, scored reports | A code complexity audit |
| 08 | [Learning Loop](08-learning-convergence-loop.md) | Karpathy-style observe-classify-analyze-improve, convergence detection, playbooks | A self-improving system that learns across sessions |

---

## How These Compose

These patterns are designed to compose. A full autonomous development workflow
combines all of them:

```
PLANNING (doc 01)
  │  Investigation swarm → User journeys → Functional spec → Engineering spec
  │  Three artifacts: who/what (journeys), what/why (functional), how (engineering)
  v
LIFECYCLE (doc 03)
  │  State machine orchestrates the entire process
  │
  ├── HARNESS DESIGN
  │     └── QA Routine (doc 04) defines verification layers
  │
  ├── BUILDING
  │     └── Builders write code, tracked by work packages
  │
  ├── VERIFICATION
  │     ├── Drift Check (doc 06) verifies data/schema alignment
  │     ├── QA Routine (doc 04) verifies end-to-end functionality
  │     └── Code Quality (doc 07) verifies architecture health
  │
  ├── FIX LOOP (doc 05)
  │     └── Measure -> Triage -> Fix -> Verify -> Repeat
  │
  ├── LEARNING (doc 08)
  │     └── Record decisions, detect convergence, mine patterns
  │
  └── SHIP
        └── All gates satisfied, quality converged, findings resolved
```

Each skill (doc 02) is a self-contained prompt that can trigger any of these patterns.

---

## Quick Start: Building Your First Skill

1. Read **doc 02 (Skill Builder)** for the anatomy of a skill
2. Pick the pattern your skill needs:
   - Measurement only? Use **doc 04 (QA)** or **doc 06 (Drift)**
   - Measurement + fixing? Use **doc 05 (Fix Loop)**
   - Full feature lifecycle? Use **doc 03 (Lifecycle)**
   - Learning across sessions? Add **doc 08 (Learning Loop)**
3. Copy the pluggable template from the relevant doc
4. Replace `{{placeholders}}` with your project specifics
5. Save as `.claude/skills/<name>/SKILL.md`

---

## Key Principles (Universal)

These principles apply across all patterns:

1. **Deterministic measurement, AI orchestration.** Scripts measure; Claude decides.
2. **State on disk, not in memory.** JSON state files survive session interruptions.
3. **Fix it or register it.** No "known issues." Every finding is tracked.
4. **Gates prevent shortcuts.** Non-skippable gates enforce quality.
5. **Evidence over opinion.** Every score cites file:line. Every decision logs "why."
6. **The "why" is the learning signal.** Actions alone aren't mineable. Reasoning is.
7. **Front-load investigation.** 5 minutes fixing a plan gap saves 30 minutes fixing code.
8. **Playbooks are portable.** Export from one project, import into the next.

---

## Provenance

These patterns are genericized from a production system that has run 200+ autonomous
development lifecycles, including:
- Multi-round adversarial plan reviews (7+ Codex rounds)
- 9-layer programmatic verification harnesses
- 3-way production data reconciliation (MSSQL source-of-truth vs RDS replica vs agent)
- Karpathy-style observe-classify-analyze-improve learning loops
- Decision pattern mining across 200+ archived lifecycles
- Playbook export/import for cross-project knowledge transfer

The patterns are battle-tested. The templates are production-ready.
