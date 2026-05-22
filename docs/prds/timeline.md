## Problem Statement

  The issue timeline currently groups events with ad hoc frontend inference. This breaks when workflow state moves backwards or
  when runtime lifecycle events have incomplete metadata, such as Grill runs where agent.run-completed lacks the discover session
  id. Operators need the timeline to reflect the logical Factory workflow, not incidental event ordering or partial payloads.

  ## Solution

  Introduce a canonical timeline section model aligned with the workflow map. Events should render inside stable accordions such
  as Triage, Investigation, Grill, PRD, Decompose, Delivery Router, Implementation, Dev Review, QA, Review, Conflict, Retro,
  Transitions, and System.

  Runtime events such as logs, tool calls, run failures, budget exceeded, and output repair failures inherit the logical section
  of their parent run. Unknown events default to System.

  ## Dependency

  Run this after `docs/prds/issue-event-stream.md` lands, or rebase onto that work before implementation.

  This PRD assumes issue detail timeline data comes from the shared DetailPage event cache, not a private TimelineSection SSE
  connection. Do not reintroduce a TimelineSection-owned EventSource while implementing canonical timeline sections.

  ## User Stories

  1. As an operator, I want Grill events and Grill runs grouped together, so I can read the full conversation even after manual
     resume.
  2. As an operator, I want PRD draft and PRD review grouped together, so PRD work appears as one coherent phase.
  3. As an operator, I want repeated grill -> prd -> grill -> prd loops to stay in their logical accordions, so state rollback
     does not fragment the timeline.
  4. As an operator, I want transitions, gates, manual actions, and interventions grouped together, so control-flow changes are
     easy to audit.
  5. As an operator, I want logs and tool calls inside their parent run’s section, so low-level runtime detail does not clutter
     the top-level timeline.
  6. As an operator, I want section-level cost totals and run-level cost detail, so I can understand spend by workflow activity
     and by exact skill.
  7. As an operator, I want unknown events under System, so new telemetry is visible without breaking grouping.

  ## Implementation Decisions

  - Add a canonical timeline section taxonomy: triage, investigation, grill, prd, decompose, delivery-router, implementation,
    dev-review, qa, review, conflict, retro, transitions, system.
  - Update the workflow map so Grill, PRD, and Decompose are separate stages instead of one coarse Discovery stage.
  - Keep skill as agent/runtime identity. Do not overload it as the timeline grouping field.
  - Add explicit section metadata where practical, but keep frontend fallback inference for current rows.
  - Map state.transitioned, manual.action, interventions, and gate events to transitions.
  - Map repo-match and related repo selection events to triage.
  - Map Playwright, scout, wave, swarm, and investigation-blocked events to investigation.
  - Map spec-author and acceptance-contract to delivery-router.
  - Map fix-feedback, implement, implement-wp, and implementation repair events to implementation.
  - Map resolve-conflict to its own conflict section.
  - Keep dev-review and dev-review-response in a dedicated dev-review section.
  - agent.budget-exceeded, agent.run-failed, agent.log, agent.tool-call, retry, and output repair events inherit from parent run
    metadata.
  - project.budget-exceeded remains project-level and does not render in issue timelines.
  - Unknown or unmapped events render under system.

  ## Testing Decisions

  - Add unit tests for timeline section resolution as a pure mapping module.
  - Add regression coverage for newest-first mixed metadata where agent.run-completed lacks session metadata but agent.run-
    started has it.
  - Add coverage for repeated Grill/PRD loops so logical section grouping survives state rollback.
  - Add tests for runtime inheritance: logs, tool calls, budget exceeded, run failed, and output repair failed appear under the
    parent section.
  - Add workflow catalog tests proving Grill, PRD, Decompose, Conflict, and Dev Review are represented as distinct stages.

  ## Out of Scope

  - Do not backfill old events.
  - Do not depend on runtime completion events always carrying full workflow metadata.
  - Do not add Playwright coverage unless a deterministic fixture is added.
  - Do not move project-level budget events into issue timelines.

  ## Further Notes

  The important architectural move is to stop treating timeline grouping as a collection of special cases. The workflow map
  should become the source of truth for logical sections, with frontend inference only filling gaps for existing event rows.
