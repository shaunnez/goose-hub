# Code Quality Improvements - types and interfaces plan
-
  Phase 1 — Pure duplications (trivial, no behavior change)

  1a. HOLDOUT_ROLES (7 files → 1 export)
  Add export const HOLDOUT_ROLES = new Set<Role>(['qa', 'reviewer'] as const) to core/agent-runtime/roles.ts. Delete inline definitions in:
  - context-assembly.ts:19, fallback.ts:11, holdout-validator.ts:4, model-router.ts:7, with-escalation.ts:10, allowlist.ts:13, ProjectModelPanel.tsx:26

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