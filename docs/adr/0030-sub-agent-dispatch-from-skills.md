# ADR 0030: Sub-agent dispatch from skills (Wave-1 / Wave-2 swarm)

**Status:** Accepted, 2026-05-07
**Milestone:** M19 — Multi-Agent Orchestration
**Issue:** #558

## Context

Goose Hub's `investigate` skill is single-agent: one investigator reads the
worktree directly and emits findings. Steve's planning protocol
(`docs/steves-training-materials/Markdown Files/Autonomous Decelopment/01-planning-phase.md:28-97`,
`Harness 101.md` slide 4 line 103) replaces this with a two-wave fan-out:

- **Wave 1** — 4–6 parallel scouts; each gathers facts about one narrow
  concern (schema, code path, pattern usage, tests, dependencies, user
  journey) and returns a fact-list with file:line citations. **Read-only,
  no synthesis.**
- **Cross-validation** — orchestrator step between waves. Detects
  contradictions between scout reports (same file:line, different facts)
  and surfaces them as advisor findings.
- **Wave 2** — 1–2 deep agents (interface-designer, risk-analyst) consume
  the cross-validated Wave-1 reports and emit paste-ready outputs (Zod
  schemas, function signatures, real DDL).

The runtime today has no primitive for spawning sub-agents from inside
a parent skill. `AgentRuntime.run()` is single-agent end-to-end. This ADR
records the decision on how that primitive lands.

## Decisions

### 1. The orchestrator dispatches scouts, not the parent agent

The parent `investigate` skill drives the wave protocol via its prompt
(it instructs which scouts to run for which concerns), but the actual
spawning is performed by orchestrator-side code in
`core/agent-runtime/swarm.ts`. The investigator does not call a `spawn_scout`
tool. There is no agent-side dispatch primitive.

Reason: holdout discipline (rule 1, ADR 0014). Each scout spawn must route
through `assembleSpawnContext()` so `contextAllowlist` and `freshContext`
remain enforced at the same gateway as every other agent. Letting an
agent shell out to spawn another agent would re-introduce the ambient-
state surface ADR 0014 closed off.

### 2. Each scout is a real skill, not a parameterisation

`skills/scout-schema/`, `skills/scout-code-path/`, `skills/scout-pattern/`,
`skills/scout-test-inventory/`, `skills/scout-dependency/`,
`skills/scout-user-journey/` each ship the canonical five files
(`prompt.md`, `schema.ts`, `skill.config.ts`, `slice.test.ts`, `README.md`).
Wave-2 deep agents likewise: `skills/wave2-interface-designer/`,
`skills/wave2-risk-analyst/`.

Reason: rule 13 (versioned markdown skills) and ADR 0022 (skill file
convention). A "scout type" is a configurable capability that needs its
own description, schema, and trigger story. Inlining six prompts into a
parent string would re-introduce the inline-prompt anti-pattern.

### 3. Read-only file-ownership for write-side scouts: none

Wave-1 scouts have `toolBundles: ['read']` only — no Write/Edit/Bash.
Wave 1 is fact-gathering; synthesis is Wave 2's job; code change is
the parallel build's job (M19.03). The file-ownership rule (M19.02
Engineering Spec) does not apply here because no scout writes.

Wave-2 deep agents are also read-only at this milestone — they emit
paste-ready text in their JSON output, not file edits.

### 4. Holdout boundary preserved per child spawn

Every scout spawn calls `assembleSpawnContext()` directly inside
`swarm.ts:dispatchWave`. Each child gets its own fresh `AgentSpec` with
its own `runId` (`<parentRunId>:scout:<scoutName>:<n>`), its own
`contextAllowlist` derived from the scout's `skill.config.ts`, and
`freshContext: true` (scouts never receive ambient parent state).

The parent agent's text turn — including its `[decision]` markers —
never propagates into a scout's context. The scout sees only:

- `<task>` block with the work item
- `<scout_focus>` — one sentence describing what this scout is looking for
- `<worktree_path>` — read-only worktree

If a future caller passes implementation reasoning into a scout's
context, the existing holdout-violation pathway in `assembleSpawnContext()`
fires `tool.violation` events. Scouts are not on the `HOLDOUT_ROLES` list
(they are an investigator subrole), but the same allowlist machinery
filters disallowed keys for them too — they simply don't emit violation
events for non-holdout omissions, matching pre-M8 behaviour.

### 5. Concurrency cap: `maxScoutAgents` (default 6) — distinct from `maxParallelAgents`

`maxParallelAgents` (per-issue dispatch cap, default 1; goose-hub-self uses 3)
governs the orchestrator's scheduler — how many concurrent issue-level
workflows run for a project. Steve's "ALL scouts run in background
simultaneously" rule (01-planning-phase.md:57-61) requires up to 6
concurrent scout spawns *inside* a single investigation. If we tried to
honour this through `maxParallelAgents`, we would either (a) starve the
scheduler of issue-level slots while the scouts run, or (b) violate
Steve's pattern by serialising scouts.

Resolution: a new `BudgetConfig.maxScoutAgents` field (default 6). It
caps in-issue scout fan-out only and does not consume per-issue
dispatch slots. `dispatchWave` enforces it via a bounded-promise pool;
`min(scoutSpecs.length, project.maxScoutAgents)` is the actual concurrency.

### 6. Timeout and cancellation

Each scout gets `scout.timeoutMs` (default 90 000 ms — short by design;
scouts are read-only fact-gathering). On timeout, the runtime kills
the subprocess (rule 32) and the swarm records a synthetic
`ScoutReport` with `status: 'timeout'` and an empty `findings` array.
Cancelled scouts emit `agent.cancelled` events.

Wave 1 advances to cross-validation as long as at least three scouts
returned successfully (`status: 'ok'`). Otherwise the wave is recorded
as `status: 'incomplete'` and the issue moves to `factory:gate-pending`
with a comment listing the failed scouts.

### 7. Partial-failure semantics

At most **one** scout failure (`status: 'error' | 'timeout'`) is
tolerated per Wave-1 run before degradation. **Two or more** failures
halt Wave 2 and escalate to `factory:needs-human` with the failed
scout names listed in the gate comment. This is stricter than the
"≥3 scouts succeed" threshold above — that threshold governs whether
cross-validation runs at all; this one governs whether Wave 2 dispatches.

### 8. Hang detection via `swarm.heartbeat` events

The parent emits a `swarm.heartbeat` event every 30 s. If no
`agent.tool-call` event from a given scout has arrived within
`scout.timeoutMs / 2` of the last heartbeat, the parent kills that
scout pre-emptively as a suspected hang (rule 32 alignment).

The heartbeat also lets the UI reflect "still running" state without
reaching into subprocess internals.

### 9. Budget propagation

Each scout inherits a per-scout budget from `SKILL_BUDGETS[scoutName]`
(haiku-tier, low cost — facts not synthesis). The parent's
`maxBudgetUsd` is **not** divided across children; scout budgets are
additive to the parent's. Budget enforcement still happens per spawn
via the existing `resolveBudgets` path; if any scout exceeds its cap,
that scout fails with `status: 'error'`, but the wave continues subject
to the partial-failure rule above.

### 10. Decision-summary aggregation

Each scout emits its own `decisionSummaries` (rule 6, ADR 0018) in
its terminal JSON. The orchestrator does **not** synthesise decisions
on behalf of the children; it does not merge their summaries into a
parent's. Each scout's summaries flow through the canonical
`agent.decision-summary` event stream tagged with the scout's
`runId`. Retro and the timeline UI see them as first-class events.

The parent investigator's own `decisionSummaries` describe wave-level
choices (`PLAN: dispatched 5 scouts after reading issue`,
`INSIGHT: cross-validation surfaced contradiction at file:line`),
**not** restated child claims.

## Consequences

**Positive:**

- The holdout gateway is the single point of context filtering for both
  parent and child spawns — same rule, same code path, same tests.
- Adding a new scout type is `mkdir skills/scout-<x>/` + 5 files. No
  changes to `swarm.ts` are needed.
- `maxScoutAgents` is opt-out per project; existing projects continue
  to work without changes.
- Decision-summary attribution stays clean: every summary has a single
  `runId`, traceable end-to-end without orchestrator synthesis.

**Trade-offs:**

- Six new skill packages (plus two Wave-2) is a meaningful diff size.
  Mitigated by the file-convention sameness — once the first scout is
  reviewed, the others are mechanical.
- The scout-budget-additive policy (decision 9) means a 6-scout wave
  can spend ~6× the parent's budget. Budget caps are still per-spawn;
  if this becomes a problem in practice, a wave-level budget aggregator
  is a follow-up.
- The 90 s scout timeout is short. If telemetry from real M19 runs
  shows scouts legitimately needing longer, the per-scout `SkillBudget`
  is the right place to relax it (per-skill, not global).

## Alternatives considered

**A. Agent-side `spawn_scout` tool.** Rejected: see decision 1. Re-opens
the ADR-0014 ambient-state surface.

**B. Single configurable `scout` skill with a `focus` parameter.**
Rejected: see decision 2. Each scout's `prompt.md` differs in shape and
emphasis; collapsing them collapses Steve's discipline of one-narrow-
concern-per-spawn into a generic "look at this" prompt.

**C. Use `maxParallelAgents` for both issue-level and scout-level.**
Rejected: see decision 5. Steve's pattern requires up to 6 concurrent
scouts per investigation; the issue-level cap is intentionally low to
preserve project-level coordination.

**D. Have the orchestrator merge scout decision summaries into the
parent's record.** Rejected: see decision 10. Orchestrator-synthesised
decisions break the rule-6 contract that decisions come from agents.

## Cross-references

- FACTORY_RULES rules 1, 5, 6, 13, 14, 19, 32
- ADR 0010 (tool-layer architecture; bundle assignment)
- ADR 0014 (M8 holdout enforcement; `assembleSpawnContext`)
- ADR 0018 (decision-kind taxonomy)
- ADR 0022 (skill-file convention)
- ADR 0023 (per-project workflow lock relaxation; distinct from this fan-out cap)
- CONTEXT.md "Context Assembly and Holdout Enforcement"
- `docs/steves-training-materials/Markdown Files/Autonomous Decelopment/01-planning-phase.md:28-97`
- `docs/steves-training-materials/ppt-conversion/Harness 101.md` slides 4 lines 103, 106
