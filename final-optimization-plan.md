---
Final Plan: Complexity-Aware Workflow Routing

New module: core/workflow-routing/

┌──────────────────────┬──────────────────────────────────────────────────────────────────────────────────────┐
│         File         │                                       Purpose                                        │
├──────────────────────┼──────────────────────────────────────────────────────────────────────────────────────┤
│ types.ts             │ WorkflowRouteDecision, RouteTier, RouteSignals, BudgetCaps, SENSITIVE_PATH_PATTERN   │
├──────────────────────┼──────────────────────────────────────────────────────────────────────────────────────┤
│ select-route.ts      │ selectWorkflowRoute(signals) — pure, deterministic, no LLM                           │
├──────────────────────┼──────────────────────────────────────────────────────────────────────────────────────┤
│ signals.ts           │ buildRouteSignals(...) — assembles from metadata / seed / investigation              │
├──────────────────────┼──────────────────────────────────────────────────────────────────────────────────────┤
│ events.ts            │ emitRouteSelected/Confirmed/EscalationProposed/CapApplied, loadLatestRoute           │
├──────────────────────┼──────────────────────────────────────────────────────────────────────────────────────┤
│ escalation.ts        │ proposeRouteEscalation(...) — opens core/interventions/ record                       │
├──────────────────────┼──────────────────────────────────────────────────────────────────────────────────────┤
│ pipeline-selector.ts │ selectFixIssuePipeline(route) — 3-rung replacement for resolveFixIssuePipelineForBug │
├──────────────────────┼──────────────────────────────────────────────────────────────────────────────────────┤
│ reviewer-cap.ts      │ effectiveReviewerSlots(routeCap, configuredSlots)                                    │
└──────────────────────┴──────────────────────────────────────────────────────────────────────────────────────┘

Key types

type RouteTier = 'T0' | 'T1' | 'T2' | 'T3' | 'T4'
type RouteSource = 'promotion' | 'lazy-enhance' | 'metadata-only' | 'investigation' | 'escalation' | 'resume'

interface WorkflowRouteDecision {
  tier: RouteTier
  selectedStages: RouteStage[]
  budgetCaps: BudgetCaps        // maxUsd, maxScouts, allowWave2, reviewerSlots
  evidence: RouteEvidence        // reasons[], signals{}
  escalationTriggers: EscalationTrigger[]
  requiresHumanApproval: boolean
  source: RouteSource
  rootCauseSignature: string     // stable: "route|<workItemId>|workflow-routing"
                                 // tier + source live in payload, not signature
}

Routing decision rules

Preliminary stage (no investigation — metadata + seed only):

┌─────────────────────────────────────────────┬──────────────────────────────────────────────────────────────┐
│                  Condition                  │                             Tier                             │
├─────────────────────────────────────────────┼──────────────────────────────────────────────────────────────┤
│ hasVagueOrHighRiskSignal OR sensitive paths │ T3                                                           │
├─────────────────────────────────────────────┼──────────────────────────────────────────────────────────────┤
│ schema AND dependency signal                │ T3                                                           │
├─────────────────────────────────────────────┼──────────────────────────────────────────────────────────────┤
│ schema OR dependency signal                 │ T2                                                           │
├─────────────────────────────────────────────┼──────────────────────────────────────────────────────────────┤
│ bug + seed ≤3 files                         │ T1                                                           │
├─────────────────────────────────────────────┼──────────────────────────────────────────────────────────────┤
│ bug + no seed                               │ T2 (fail-safe up)                                            │
│                                             │ Follow-up metric: count no-seed bugs confirmed T1 post-      │
│                                             │ investigation. If rate is high, add metadata-only T1 rule    │
│                                             │ for explicit endpoint/component/path reports.                │
└─────────────────────────────────────────────┴──────────────────────────────────────────────────────────────┘

Confirmed stage (post-investigation — evidence only, no body keywords):

  low confidence               → T3, requiresHumanApproval
  contradictions > 0           → T3
  sensitive path               → T3
  nonTestFiles ≥ 4 or wave2    → T3
  nonTestFiles ≥ 2             → T2
  high confidence + ≤1 file    → T1
  else                         → T2

  finalTier = max(preliminary, confirmed)   // monotonic, never downgrades

Tier → pipeline

┌──────┬────────┬────────┬────────┬───────────────────────────────────────────────┬───────────┐
│ Tier │ maxUsd │ scouts │ Wave-2 │                   pipeline                    │ reviewers │
├──────┼────────┼────────┼────────┼───────────────────────────────────────────────┼───────────┤
│ T0   │ $0.30  │ 0      │ no     │ fix-issue                                     │ 1         │
├──────┼────────┼────────┼────────┼───────────────────────────────────────────────┼───────────┤
│ T1   │ $0.80  │ 1      │ no     │ fix-issue                                     │ 1         │
├──────┼────────┼────────┼────────┼───────────────────────────────────────────────┼───────────┤
│ T2   │ $2.00  │ 3      │ no     │ spec-author-lite + implement-wp               │ 1         │
├──────┼────────┼────────┼────────┼───────────────────────────────────────────────┼───────────┤
│ T3   │ $6.00  │ 6      │ yes    │ spec-author-full + parallel-implement         │ 2         │
├──────┼────────┼────────┼────────┼───────────────────────────────────────────────┼───────────┤
│ T4   │ —      │ —      │ —      │ roadmap-split → children routed independently │ —         │
└──────┴────────┴────────┴────────┴───────────────────────────────────────────────┴───────────┘

Flag caps and cap-conflict handling

Existing project flags (useInvestigationSwarm, useMultiAgentPipeline, reviewerSlots) are upper-bound
caps — they cannot raise a route above its computed tier. However, caps must NEVER silently weaken
a required tier. When a flag cap conflicts with the computed route:

  Route requires T3 (auth/schema/security) + flag cap allows only T2/T1:
    → Run the highest safe path within caps
    → Emit workflow.route-cap-applied with:
        { requiredTier: 'T3', effectiveTier: 'T2', cappedBy: 'useInvestigationSwarm', reason: '...' }
    → If requiredTier is T3 AND sensitive path is involved:
        → Also open a workflow_route_escalation intervention:
            "Required T3 (auth/schema) exceeds project caps. Human approval needed."
        → requiresHumanApproval = true on the applied route

  Route requires T2 + flag cap allows only T1:
    → Run T1 path, emit workflow.route-cap-applied (no intervention needed for non-sensitive)

Caps table:
  useInvestigationSwarm=false   → maxScouts=1, allowWave2=false (caps T3 to effective T1 investigation)
  useMultiAgentPipeline=false   → pipeline capped at fix-issue (caps T3/T2 implementation path)
  reviewerSlots=1               → effectiveReviewerSlots=1 regardless of tier

rootCauseSignature rules

Route identity (stable — tier/source in payload, not signature):
  "route|<workItemId>|workflow-routing"

Escalation intervention dedupe (includes trigger fingerprint):
  "route-escalation|<workItemId>|<trigger-kind>|<evidence-hash>"

  Where <trigger-kind> is one of: low-confidence-investigation | contradictions-found |
  sensitive-path-touched | wp-count-exceeded | cost-cap-approached | qa-failed-twice

  And <evidence-hash> is a short stable hash of the triggering signal values (not timestamps).
  This prevents the same root cause reopening on every tick while allowing a genuinely new
  evidence combination to open a fresh intervention.

10 implementation steps

1. Module scaffold + type exports — move predicate regexes into signals.ts, re-export from planner.
   Add workflow.route-cap-applied to event kinds alongside the other three. No behavior change.
   pnpm typecheck passes.

2. selectWorkflowRoute core + tests — #1178 fixture must resolve T1, maxUsd: 0.80, single scout,
   no Wave-2, fix-issue.

3. Events + loadLatestRoute — four new event kinds (route-selected, route-confirmed,
   route-escalation-proposed, route-cap-applied). Round-trip test.

4. Preliminary route at inbox promotion — service.ts emits route after createIssue. Bug-enhance
   stays conditional (Correction 1).

5. Preliminary route at lazy enhance / direct issues — slices/investigate/workflow.ts emits when
   no route exists yet.

6. Confirmed route + Wave-2 signal split — confirmed Wave-2 reads scout findings + contradictions
   only, drops workItem.body. Tests updated.

7. Three-rung pipeline selector + lite/full spec mode — replaces resolveFixIssuePipelineForBug.
   EngineeringSpecSchema untouched. validateEngineeringSpec gains: ≥2 WPs ⇒ interfaceContracts
   non-empty; sensitive paths ⇒ riskRegister non-empty; T1/T2 single-WP ⇒ both may be empty.

8. Reviewer cap intersection + cap-conflict handling — effectiveReviewerSlots. Wire
   workflow.route-cap-applied emission and intervention opening for sensitive-path cap conflicts.
   UI shows effective value (route ∩ project), not raw cap.

9. Resume durability + escalation intervention — dispatchResumeIssue loads route first, never
   downgrades. Add 'workflow_route_escalation' to InterventionTypeSchema (code-only, no migration).

10. #1178 integration test + docs — pnpm typecheck && pnpm test && pnpm build green. pnpm audit-docs.

Constraints (non-negotiable)

- Stateless: selectWorkflowRoute is pure. Route persists in event store, reconstructed via loadLatestRoute.
- Monotonic: finalTier = max(preliminary, confirmed). Resume never downgrades.
- No silent clamping: flag caps that conflict with a required tier emit workflow.route-cap-applied
  and open an intervention when sensitive paths are involved. Never silently weaken a safety-relevant route.
- Bug-enhance stays conditional: preliminary routing works without it.
- Schema stable: EngineeringSpecSchema unchanged. Lite = validation mode only, empty arrays permitted, shape intact.
- Flags = upper bounds only: cannot raise a tier, but conflicts with required tiers must surface, not be swallowed.
- QA never skips: no tier removes QA. RouteStage has no skip-qa member.
- Single control plane: core/interventions/ reused. No new tables.
- Wave-2 text isolation: confirmed Wave-2 reads scout findings + contradictions; body keywords removed from that path.
- Stable signatures: rootCauseSignature encodes work-item identity only; tier/source live in payload.
  Escalation signatures include trigger-kind + evidence-hash for per-cause dedupe.

Follow-up metrics / future tickets

- Track no-seed bug T2 → confirmed T1 rate. If high, add metadata-only T1 rule for bugs with
  explicit endpoint/component/path mentions.
- T4 child-lifecycle routing intersects dispatchDecomposePrd / PRD lane — separate slice.
