# Code Quality Improvements - types and interfaces plan

## Execution strategy (model + parallelism)

Legend:
- **Model**: Opus = architectural/judgement calls. Sonnet = mechanical edits.
- **Agent**: `cavecrew-builder` = 1-2 file surgical edit. `general-purpose` / `Explore` = larger scope or research.
- **Wave**: items in the same wave run in parallel (single message, multiple Agent calls). Waves run sequentially.
- **Conflict-free**: items only land in the same wave if they touch disjoint files.

| Item | Phase | Files touched | Model | Agent | Wave | Notes |
|------|-------|---------------|-------|-------|------|-------|
| 1a HOLDOUT_ROLES | 1 | 9 (grep shows sandbox.ts, swarm.ts beyond plan's 7) | Sonnet | general-purpose | 1 | Mechanical sweep. Too big for cavecrew-builder (3+ file refuse). |
| 1b TERMINAL_STATES | 1 | 3 (states.ts export + 2 callsites) | Sonnet | cavecrew-builder | 1 | Borderline file count; builder OK if export edit + 2 callsites grouped. |
| 1c ROLE_ABBREV | 1 | 2 (usePersonaMap.ts + verify persona-names.ts) | Sonnet | cavecrew-builder | 1 | Pure delete + import. |
| 2c VERDICT_TO_STATE | 2 | 2 (workflow.ts + schema.ts export) | Sonnet | cavecrew-builder | 1 | Type-safety win, isolated. |
| 1d CRITICAL_PRIORITIES merge | 1 | 2 (fallback.ts + advisor.ts) | **Opus decides order**, Sonnet edits | cavecrew-builder | 2 | Opus picks canonical name + order, builder applies. |
| 2b setLabelInGroup mismatch | 2 | 2 (interface.ts or service.ts) | **Opus decides**, Sonnet edits | cavecrew-builder | 2 | Allow `type` group or remove from interface — Opus call. |
| 2a Schedule UI translation | 2 | 4 (service.ts, api.ts, in-memory-labels.ts, github-labels.ts types) | **Opus** | inline (main thread) | 3 | Active bug; type split (Schedule vs ScheduleUIValue); test coverage. Serialize — touches service.ts shared w/ 2b. |
| 3a LABEL_GROUPS const | 3 | 10 (github-labels.ts export + 9 callsites) | Sonnet | general-purpose | 3 | After 2a (shares github-labels.ts). Mechanical sweep. |
| 3b Hardcoded defaults | 3 | 2 (github-labels.ts + interface.ts) | Sonnet | cavecrew-builder | 3 | Pair with 3a — same file. Run sequentially within wave or merge into 3a's agent. |
| 4a parseState validator | 4 | github-labels.ts ingress + new validator + ADR | **Opus** | inline + ADR | 4 | Design first. Write ADR in `docs/adr/`. |
| 4b Priority/Role/WorkItem parsers | 4 | github-labels.ts ingress (extend 4a) | **Opus** | inline | 4 | Piggyback on 4a pattern; same boundary. |

### Wave-by-wave dispatch

**Wave 1 — parallel, all Sonnet, no file overlap**
Dispatch in one message:
- general-purpose: 1a HOLDOUT_ROLES sweep (9 files)
- cavecrew-builder: 1b TERMINAL_STATES
- cavecrew-builder: 1c ROLE_ABBREV
- cavecrew-builder: 2c VERDICT_TO_STATE + export ReviewVerdict

**Wave 2 — parallel after Opus decisions**
Opus makes two calls first:
- 1d: pick canonical name (`CRITICAL_PRIORITIES` vs `ADVISOR_GATED_PRIORITIES`) + order
- 2b: keep `type` in interface or reject it server-side

Then dispatch in one message:
- cavecrew-builder: 1d apply
- cavecrew-builder: 2b apply

**Wave 3 — serialized (shared file `github-labels.ts` + `service.ts`)**
1. Opus inline: 2a Schedule fix (multi-file, type split, tests)
2. general-purpose Sonnet: 3a LABEL_GROUPS + 3b defaults (combine — same file)

**Wave 4 — Opus design**
1. ADR draft for parser-at-ingress strategy (covers 4a + 4b)
2. Implement parseState + parsePriority + parseRole + parseWorkItemType at github-labels.ts boundary
3. Optional follow-up issue: audit failures in CI logs

### Why this split
- **Opus reserved for**: type-system design (2a, 4a/4b), naming/ordering decisions (1d), interface-vs-server reconciliation (2b).
- **Sonnet via sub-agents for**: anything where the diff is obvious once the target export exists.
- **Parallel where files disjoint**: Wave 1 saves ~4x wall-clock on mechanical work.
- **cavecrew-builder preferred for ≤2 file edits**: output is caveman-compressed, ~60% smaller tool result returned to main context.
- **general-purpose for 3+ file sweeps**: cavecrew-builder hard-refuses; needs broader scope.

---

## Original plan

Phase 1 — Pure duplications (trivial, no behavior change)

  1a. HOLDOUT_ROLES (7 files → 1 export)
  Add export const HOLDOUT_ROLES = new Set<Role>(['qa', 'reviewer'] as const) to core/agent-runtime/roles.ts. Delete inline definitions in:
  - context-assembly.ts:19, fallback.ts:11, holdout-validator.ts:4, model-router.ts:7, with-escalation.ts:10, allowlist.ts:13, ProjectModelPanel.tsx:26
  - **Update**: grep also finds sandbox.ts and swarm.ts — sweep includes those too.

  1b. TERMINAL_STATES (2 files → 1 export)
  Export from core/state-machine/states.ts. Replace in apps/cli/src/index.ts:139 and sprint-review-eligibility.ts:10.

  1c. ROLE_ABBREV (2 defs → 1 import)
  usePersonaMap.ts:50 — delete local def, import from core/agent-runtime/persona-names.ts:34.

  1d. CRITICAL_PRIORITIES / ADVISOR_GATED_PRIORITIES
  fallback.ts:12 has ['critical', 'high']; advisor.ts:25 has ['high', 'critical'] — same values, different names, different order. Consolidate to one export, pick canonical
  order.

  ---
  Phase 2 — Correctness bugs

  2a. Schedule UI values not being translated (active bug)
  SCHEDULE_UI_TO_LABEL exists in github-labels.ts mapping backlog→schedule:next, icebox→schedule:later but:
  - apps/web/src/lib/api.ts:305 — setLabel() sends raw UI values without translating
  - apps/server/src/domains/issues/service.ts:183 — setLabelInGroup() applies raw values
  - in-memory-labels.ts:229 — silently ignores backlog/icebox

  Fix: translate at the server boundary in service.ts via SCHEDULE_UI_TO_LABEL before applying. Reconcile Schedule type to be the canonical label-space values only (current |
   next | later | blocked-by). UI-space values (backlog | icebox) are a separate ScheduleUIValue type used only at the API boundary.

  2b. setLabelInGroup type vs server validation mismatch
  Interface at interface.ts:89 allows 'type' group; server at service.ts:170 rejects it. Pick one and fix the other.

  2c. VERDICT_TO_STATE unsafe key (slices/review/workflow.ts:115)
  Record<string, StateName> — lookup can return undefined at runtime. Change to Record<ReviewVerdict, StateName>. Export ReviewVerdict type from skills/review/schema.ts.

  ---
  Phase 3 — Missing constants (low-risk, medium size)

  3a. LABEL_GROUPS const
  Export export const LABEL_GROUPS = { PRIORITY: 'priority', SCHEDULE: 'schedule', TYPE: 'type', MODE: 'mode', EXEC: 'exec' } as const from
  core/state-source/github-labels.ts. Replace at 9 known callsites.

  3b. Hardcoded default values
  github-labels.ts:110,118,129,135 — inline fallback strings 'medium', 'supervised', 'later', 'parallel'. Export named defaults alongside the types in
  core/state-source/interface.ts.

  ---
  Phase 4 — Large sweeps (separate issues, not one PR)

  4a. State string literals (1,304 uses, 80+ files not importing states.ts)
  Strategy: enforce at seam. Add a parseState(s: string): StateName validator used at GitHub label ingress. Trust the type downstream. Don't manually fix 1,304 callsites —
  fix the ingress, then let the type system catch new violations.

  4b. Priority / Role / WorkItemType literals (518+/520+/80+ uses)
  Same strategy: validate at GitHub label parse boundary. The github-labels.ts parser is the single ingress — strengthen it with Zod/type narrowing once, rather than auditing
   35 production files.

  ---
  What the earlier scan missed (confirmed by this pass)

  - Template literal construction: `factory:${...}` in triage-batch.ts and others
  - SCHEDULE_UI_TO_LABEL exists but is not being called at the right boundaries — active bug, not just style
  - VERDICT_TO_STATE unsafe record key — runtime undefined risk
  - Verdict type not exported from review schema, forcing hardcoded comparisons across review/QA workflows
  - CRITICAL_PRIORITIES / ADVISOR_GATED_PRIORITIES — same data, two names, different sort order

  ---
