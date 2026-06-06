# Research Workflow Plan

## Goal

Build a distinct research workflow that uses investigation-style repository discovery mechanics without pretending research is a bug investigation.

Research should answer: what is true, what are the options, and what follow-up work exists? It should not enter feature grilling or bug investigation unless the research result explicitly creates or routes follow-up work.

## Current State

- `type:research` already routes from triage to `factory:research-pending`.
- The workflow catalog already has a research entry describing `research-pending -> research-complete -> dev-ready | needs-human`.
- There is no executable research workflow dispatch for `factory:research-pending`.
- `factory:research-complete` is not dispatchable.
- The state machine does not currently allow `factory:research-complete -> factory:needs-human`.
- Settings only exposes configurable agent rows for registered skills in `SKILL_BUDGETS`.
- Timeline rendering requires explicit event kind registration, section routing, grouping, labels, render items, and components.

## Lifecycle Contract

Use a two-actor lifecycle split.

1. `dispatchResearch` consumes `factory:research-pending`.
2. The research workflow runs the read-only repo discovery and synthesis agent.
3. The research workflow emits `agent.research-complete`.
4. The research workflow transitions only `factory:research-pending -> factory:research-complete`.
5. `dispatchResearchComplete` consumes `factory:research-complete`.
6. `dispatchResearchComplete` computes the terminal routing decision and transitions to either:
   - `factory:dev-ready`
   - `factory:needs-human`

Do not let the workflow perform both state hops. Mixing the research run and the terminal routing hop makes resume behavior harder and risks illegal transition failures.

## Authoritative Outcome Rule

The server, not the agent, owns the final state decision.

The research skill should not emit `recommendedNextState`. It should emit facts, actionability, and follow-up candidates. `dispatchResearchComplete` computes the next state from that artifact.

Routing rule:

- If `actionability === 'directly-actionable'` and exactly one follow-up candidate has `actionable: true`, transition to `factory:dev-ready`.
- If there are zero actionable follow-ups, transition to `factory:needs-human`.
- If there are multiple actionable follow-ups, transition to `factory:needs-human` so a human can choose or create child work deliberately.
- If `actionability` is `advisory`, `ambiguous`, or `blocked`, transition to `factory:needs-human`.

## Skill Contract

Add `skills/research/`.

Required files:

- `prompt.md`
- `schema.ts`
- `skill.config.ts`
- `README.md`
- `slice.test.ts`

Skill config:

- `role: 'researcher'`
- `toolBundles: ['read']`
- `contextAllowlist: ['workItem', 'scoutDigest']`
- context contains `workItem` and optional `scoutDigest`
- use one tier source consistently

Model rule:

- Add `research` to `SKILL_BUDGETS` with a sonnet default.
- Do not set a contradictory `modelPin` in `skill.config.ts`.
- Either omit `modelPin` or match the `SKILL_BUDGETS` tier exactly.

Suggested output schema:

```ts
{
  summary: string;
  answer: string;
  evidence: Array<{
    file: string;
    line?: number;
    claim: string;
    confidence: 'low' | 'medium' | 'high';
  }>;
  options: Array<{
    title: string;
    tradeoffs: string[];
    files?: string[];
    confidence: 'low' | 'medium' | 'high';
  }>;
  followUpWork: Array<{
    type: 'feature' | 'bug' | 'chore' | 'research';
    title: string;
    rationale: string;
    actionable: boolean;
  }>;
  actionability: 'directly-actionable' | 'advisory' | 'ambiguous' | 'blocked';
  openQuestions: string[];
  decisionSummaries: DecisionSummary[];
}
```

Explicit exclusions:

- no `fixHint`
- no `requiresBrowserRepro`
- no Playwright repro contract
- no root-cause-only framing
- no feature PRD/grilling contract

## Workflow Slice

Add `slices/research/`.

Required files:

- `workflow.ts`
- `slice.test.ts`
- `README.md`

Reuse only neutral investigation machinery:

- repository affinity and checkout resolution
- workflow base resolution
- worktree creation and cleanup
- read-only scout dispatch
- scout report persistence or digest building
- synthesis invocation with `scoutDigest`
- runtime failure and schema-validation telemetry
- decision summary reconciliation

Do not reuse bug/delivery-specific investigation behavior:

- no `bug-enhance`
- no `playwright-repro`
- no `buildRouteSignals`
- no `selectWorkflowRoute`
- no route escalation proposal
- no `acceptance-contract`
- no `fixHint`
- no bug-specific repro packet

The workflow must:

1. Validate the item is in `factory:research-pending`.
2. Create a worktree for the selected repository.
3. Optionally run research-safe scouts.
4. Build a scout digest.
5. Invoke `research`.
6. Validate output.
7. Call `reconcileDecisionSummaries(...)`.
8. Emit `agent.research-complete`.
9. Transition `factory:research-pending -> factory:research-complete`.
10. Always clean up the worktree.

On failure:

- emit `agent.run-failed` with `skill: 'research'`
- comment with a concise research failure summary
- transition to `factory:needs-human`
- support later resume back to `factory:research-pending`

## Dispatch Wiring

Update dispatch routing.

Required changes:

- Add `factory:research-pending` to `DISPATCHABLE_WORK_ITEM_STATES`.
- Add `factory:research-complete` to `DISPATCHABLE_WORK_ITEM_STATES`.
- Add `dispatchResearch(slug, issueNumber)`.
- Add `dispatchResearchComplete(slug, issueNumber)`.
- In `dispatchCurrentWorkItemState`, route:
  - `factory:research-pending -> dispatchResearch`
  - `factory:research-complete -> dispatchResearchComplete`
- Add both states to `RESUME_WORKFLOWS`.
- Add `failedSkill === 'research'` handling in the `factory:needs-human` resume block:
  - force state to `factory:research-pending`
  - emit resume state transition
  - rerun `dispatchResearch`

State machine change:

- Allow `factory:research-complete -> factory:needs-human`.

## Settings And Agents

Research must be visible and configurable in Settings.

Required changes:

- Add `research` to `SKILL_BUDGETS`.
- Add `research` to project settings metadata callers as `research workflow`.
- Add `roleForSkill('research') -> 'researcher'`.
- Ensure `registeredSkills` includes `research`.
- Ensure Settings -> Skill runtime can override:
  - provider
  - model tier
  - effort
  - max turns
  - max budget
  - timeout

If research uses scout fan-out, decide whether to reuse `useInvestigationSwarm` or add a separate `useResearchSwarm`.

Default recommendation:

- Reuse the existing scout cap and runtime controls for the first implementation.
- Do not add `useResearchSwarm` unless research needs independent product behavior.
- If reusing `useInvestigationSwarm`, label the research behavior as repository discovery fan-out in docs and workflow map copy.

## Workflow Catalog

Amend the existing research catalog entry. Do not create a second research map.

Required changes:

- Add a `research-skill` node:
  - `skill: 'research'`
  - `role: 'researcher'`
  - `state: 'factory:research-pending'`
  - `group: 'research'`
  - `visual: 'skill'`
- Add summary edge from `research-pending` to `research-skill`.
- Keep `research-pending -> research-complete` as the primary lifecycle edge.
- Keep `research-complete -> dev-ready` as the directly actionable path.
- Make `research-complete -> needs-human` a real optional edge, matching the legal transition.
- Ensure the workflow map shows the research stage as distinct from investigation.

## Timeline

Research must not render as raw JSON or fall into System.

Add event kinds:

- `agent.research-complete`
- optionally `research.digest-applied` if a research-specific digest event is emitted

Timeline section changes:

- Add `research` to `TIMELINE_SECTION_DEFINITIONS`.
- Map workflow group `research` to timeline section `research`.
- Add `agent.research-complete` to `DIRECT_EVENT_KIND_SECTION` mapped to `research`.
- Add the `research.` prefix in `resolveTimelineSection`.
- Ensure runtime events with `skill: 'research'` inherit the research section through `buildSkillSectionMap`.

Timeline grouping changes:

- Add a `research-phase` member to `RenderItem`.
- Add a research phase grouper, parallel to investigation grouping but keyed to:
  - parent research run id
  - `agent.run-started` with `skill: 'research'`
  - `agent.research-complete`
  - research scout child run ids
  - research digest events
- Wire the research grouper into:
  - top-level `groupEvents`
  - canonical section grouping
  - `groupItemsInsideTimelineSection`
- Add `case 'research'` to `timelineSegmentExplicitKey`.

Rendering changes:

- Add `ResearchPhaseWrapper` or a generalized phase wrapper with research labels.
- Add `AgentResearchCompleteEvent`.
- Add a render arm in `TimelineEvents.tsx` for `research-phase`.
- Add a render arm in `TimelineEvents.tsx` for `agent.research-complete`.
- Add labels in `labels.ts`.

The research complete card should show:

- actionability
- answer preview
- evidence count
- option count
- actionable follow-up count
- open question count
- final routing result if present in the event payload

## Documentation

Update documentation in the same PR.

Required docs:

- `skills/research/README.md`
- `slices/research/README.md`
- `CONTEXT.md` with the research lifecycle contract
- `docs/inventory.md` via `pnpm manifest`

Doc points to capture:

- Research is a distinct workflow.
- Research uses investigation-style repo discovery mechanics.
- Research emits a research artifact.
- Research does not emit bug investigation artifacts.
- Research does not enter feature grilling unless later follow-up work is explicitly created or routed.
- `dispatchResearchComplete` owns the final routing decision.

## Tests

Skill tests:

- research config has role `researcher`
- read-only tools only
- context allowlist is `workItem` and `scoutDigest`
- schema accepts complete research artifact
- schema rejects missing decision summaries
- schema does not contain bug-only fields

Workflow tests:

- happy path emits `agent.research-complete`
- happy path transitions `research-pending -> research-complete`
- failed skill output emits `agent.run-failed`
- failure transitions to `needs-human`
- worktree cleanup runs on success and failure
- decision summaries are reconciled
- research scouts do not call bug-enhance, Playwright, route selection, or acceptance-contract behavior

Dispatch tests:

- `factory:research-pending` dispatches `dispatchResearch`
- `factory:research-complete` dispatches `dispatchResearchComplete`
- `research-complete` with one actionable follow-up transitions to `dev-ready`
- zero actionable follow-ups transitions to `needs-human`
- multiple actionable follow-ups transitions to `needs-human`
- advisory, ambiguous, and blocked research transitions to `needs-human`
- resume from `needs-human` after `failedSkill: 'research'` returns to `research-pending`
- `RESUME_WORKFLOWS` includes both research states

State machine tests:

- `research-pending -> research-complete` remains legal
- `research-complete -> dev-ready` remains legal
- `research-complete -> needs-human` becomes legal

Workflow catalog tests:

- research entry still exists once
- research entry includes `research-skill`
- `research-skill` has `group: 'research'`
- research-complete has both dev-ready and needs-human edges
- activation settings remain known

Settings tests:

- `research` is in `registeredSkills`
- `research` has role metadata `researcher`
- `research` can resolve runtime defaults
- `research` accepts per-skill overrides

Timeline tests:

- `agent.research-complete` maps to `research`
- `research.` prefix maps to `research`
- `skill: 'research'` runtime events inherit `research`
- research phase grouping groups parent, child scouts, digest, and complete events
- research phase group renders through `TimelineEvents.tsx`
- research complete card renders actionability, evidence count, option count, and follow-up count
- no research event falls back to System unexpectedly

Docs/check tests:

- `pnpm audit-docs`
- `pnpm manifest --check`

## Verification Commands

Run focused tests first:

```sh
pnpm vitest skills/research/slice.test.ts slices/research/slice.test.ts
pnpm vitest core/state-machine/transitions.test.ts apps/server/src/shared/dispatch-routing.test.ts
pnpm vitest core/workflows/workflow-catalog.test.ts core/workflows/timeline-sections.test.ts
pnpm vitest apps/web/src/components/detail/lib/timeline.test.ts apps/web/src/components/detail/components/timeline
pnpm vitest apps/web/src/components/settings
```

Then run broader checks:

```sh
pnpm typecheck
pnpm audit-docs
pnpm manifest --check
git diff --check
```

If a fresh worktree lacks local binaries, run:

```sh
pnpm install
```

## Execution Order

1. Add contracts first: skill schema/config, budget registration, event kind, state transition.
2. Add dispatch skeleton and tests for pending/complete/resume behavior.
3. Add the research workflow with a minimal non-scout synthesis path.
4. Add research-safe scout fan-out only after the minimal path is green.
5. Add settings metadata and workflow catalog visibility.
6. Add timeline section, grouping, wrappers, and cards.
7. Update docs and generated inventory.
8. Run focused verification, then full checks.

## Acceptance Criteria

- A `type:research` item in `factory:research-pending` runs a research workflow.
- The research workflow emits a structured research artifact via `agent.research-complete`.
- The workflow transitions only to `factory:research-complete`.
- `dispatchResearchComplete` performs the final routing hop.
- Directly actionable single follow-up research can reach `factory:dev-ready`.
- Advisory, ambiguous, blocked, zero-actionable, and multi-actionable research reaches `factory:needs-human`.
- Research is visible in Settings -> Skill runtime and configurable like other skills.
- Research is visible in Settings -> Workflow map as its own stage.
- Research timeline events render with dedicated research wrappers/components.
- No research timeline event falls back to raw JSON or the System section.
- Docs and inventory are updated.
- Focused tests, typecheck, audit-docs, manifest check, and diff check pass.
