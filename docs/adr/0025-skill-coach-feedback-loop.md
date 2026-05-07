# ADR 0025: Skill-coach skill with auto-trigger from convergent patterns

**Status:** Accepted
**Date:** 2026-05-07
**Milestone:** M11 — Dependency-aware Scheduling (M11.13, M11.14)

## Context

ADR 0024 establishes the cross-run learning loop: closed lifecycles get archived, decision patterns
get mined, and a cross-run retro skill writes up the convergent findings. The gap that remained was
the *write-back* edge: nothing was changing the skill prompts that drove the runs in the first place.
Improvement candidates would accumulate in the Roster, the human would have to read them, decide
which were valid, and hand-edit the relevant `skills/<name>/prompt.md`. In practice almost none of
that happened — the loop had a measurement stage but no actuator.

Steve's training corpus calls the actuator a "skill coach": an LLM that reads the mined patterns and
proposes a concrete diff to a target skill's `prompt.md`. The coach is dangerous in two specific ways:

1. **Self-coaching is incoherent.** A coach that can rewrite `qa`, `review`, `retrospective-light`,
   `retrospective-deep`, `retrospective-cross-run`, or `skill-coach` itself can subvert the holdout
   guarantees (ADR 0014) or rewrite its own evaluator. The forbidden-target set must be enforced at
   the workflow layer, not just in the prompt.
2. **Auto-triggering on weak evidence is worse than no trigger.** A coach that fires on a single
   noisy pattern produces churn in the skill prompts and erodes the whole convergence story.

We need both a coach skill (manual trigger) and a guarded auto-trigger from the cross-run retro,
with the policy gates fully visible in code rather than buried in prompts.

## Decision

Ship the coach as a workflow + skill pair with explicit, testable policy gates:

### Coach skill (`skills/skill-coach/`)

Manual-trigger skill that reads `(targetSkill, mined patterns, convergent decision summaries)` and
returns a `SkillCoachOutput` containing the proposed `prompt.md` diff plus a structured rationale
(which patterns drove which prompt change). The skill itself is invoked through
`runSkillCoachingWorkflow` in `core/workflows/skill-coaching.ts`, which:

- Loads the current `skills/<name>/prompt.md` from disk (errors with `SkillCoachMissingSourceError`
  if missing).
- Refuses any target in the `FORBIDDEN_COACH_TARGETS` set (`qa`, `review`,
  `retrospective-light`, `retrospective-deep`, `retrospective-cross-run`, `skill-coach`).
  Throws `SkillCoachForbiddenTargetError` — checked before any LLM call.
- Persists the output as an `improvement_candidate` of `kind: 'skill-prompt'`. Approval and merge
  are handled through the existing Roster approval flow; the coach never touches `prompt.md`
  directly.

### Auto-trigger gates (`core/workflows/cross-run-retro.ts`)

After the cross-run retro emits its output, the workflow evaluates four AND-gated conditions before
dispatching the coach:

1. `agentConfig.coachPolicy.enabled === true` — opt-in per project (default `false`).
2. `lifecycleCount >= coachPolicy.minLifecycles` (default `3`) — minimum sample size.
3. At least one `topPattern` with `consistencyScore >= coachPolicy.consistencyThreshold`
   (default `0.8`) — minimum confidence.
4. At least one improvement candidate's `evidence` references that pattern by ID — coach only fires
   when the cross-run retro itself has written a candidate naming the pattern. This ties dispatch
   to specific, traceable evidence rather than firing on any threshold breach.

Failures emit `coach.dispatch-failed` events with the failing condition. Successful dispatches emit
`coach.dispatched` with the target skill, pattern ID, and run ID, so the loop is fully auditable.

### Why the forbidden-target set is in code, not the prompt

A prompt-only forbidden list is one prompt-injection away from being bypassed. The
`FORBIDDEN_COACH_TARGETS` set is exported and asserted at workflow entry — the LLM can be coaxed
into proposing a coach for `qa`, but the workflow will throw before any I/O happens.

## Consequences

- The learning loop is now closed: lifecycles → archive → patterns → cross-run retro → coach diff →
  human approval → merged prompt change → next lifecycle observes the change.
- Holdout integrity (ADR 0014) is preserved; no LLM-authored prompt change can target a holdout
  skill.
- `coachPolicy` defaults to `enabled: false` for both registered projects; opting in is a deliberate
  per-project decision and is recorded in `target-projects/<slug>/project.config.ts`.
- Coach output is never auto-applied. It always lands as a candidate that the human approves through
  the Roster, mirroring the M9 improvement-candidate flow.
- Auto-trigger evidence binding (gate 4) means a low-volume project that does not produce
  candidates referencing patterns will never trigger the coach, even if its consistency is high. The
  trade-off is intentional: weak signal should not produce prompt churn.
