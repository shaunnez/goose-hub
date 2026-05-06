# skill-coach

Proposes unified diffs against other skills' `skill.md` files based on convergent evidence patterns from prior agent lifecycles.

## Purpose

The agent-coaching loop (M11 / Steve's training materials) detects recurring gaps in skill guidance by analyzing decision summaries and outcomes across many runs. The `skill-coach` skill synthesizes those patterns into focused, minimal diffs that improve the skill without over-engineering.

## Input

- `targetSkillName` — skill to coach (e.g. "investigate")
- `patternIds[]` — evidence pattern IDs from prior lifecycles
- `lifecycleIds[]` (optional) — specific lifecycle IDs to prioritize

## Output

`SkillCoachOutput`:

- `skillName` — target skill name
- `diagnosis` — analysis of patterns
- `proposedPatch` — unified diff (RFC 3881) against `skill.md`
- `rationale` — one sentence explaining the patch
- `evidencePatternIds[]` — pattern IDs that informed this proposal
- `confidence` — `low | medium | high`
- `decisionSummaries[]` — minimum 1 entry

## Forbidden targets

Cannot coach: `qa`, `review`, `retrospective-light`, `retrospective-deep`, `retrospective-cross-run`, `skill-coach`.

## Context allowlist

- `targetSkillName`
- `patternIds`
- `lifecycleIds`

## Model

Pinned to Sonnet 4.6 (routine pattern analysis). Opus 4.7 available for escalation if the orchestrator detects safety concerns (changes to high-impact skills).

## Invocation

Manual trigger via `POST /api/projects/:slug/coach` with `targetSkillName`, `patternIds[]`, optional `lifecycleIds[]`.

Auto-trigger from playbook (M11.14) with evidence aggregated from previous retrospectives.
