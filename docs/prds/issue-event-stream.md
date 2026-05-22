PRD: Centralize Issue Eventstream And Canonical Event Emission

  Problem

  Live issue surfaces are currently driven by multiple partial data paths. Detail header/action state, Timeline, Grill, PRD,
  costs, comments, and run progress can drift because each surface owns or refreshes its own slice of truth.

  This causes visible stale states:

  - Timeline shows new events while header/actions stay stale.
  - Grill shows latest question but still renders “processing your reply”.
  - One tab misses live timeline events until reload.
  - Some workflows mutate issue state without emitting state.transitioned.
  - Some skill outputs produce decisionSummaries but do not become canonical agent.decision-summary events.

  Goal

  Make the issue detail page consume one shared live event truth, and make every workflow/skill state or decision mutation emit
  the event needed for that shared truth to stay current.

  Non-Goals

  - Replacing GitHub/source-of-truth state.
  - Broadcasting events between browser tabs.
  - Redesigning timeline rendering cards.
  - Changing the decision-summary taxonomy.

  Requirements

  1. DetailPage owns one issue SSE connection.
      - One EventSource per mounted issue detail page.
      - Subscribes to ISSUE_TIMELINE_EVENT_KINDS.
      - Upserts all issue timeline events into React Query cache ['events', slug, id].
  2. TimelineSection renders from shared event cache.
      - Remove TimelineSection’s private SSE state.
      - Preserve initial load, older-event pagination, de-dupe, grouping, and render behavior.
      - Backfill missed events on reconnect and visibility regain using the last cached event id.
      - Add slow safety refetch while any run is live.
  3. Live issue state is patched from events.
      - On state.transitioned, patch ['issue', slug, id] from payload.to.
      - Patch ['issues', slug] for board/list consistency.
      - Still invalidate/refetch in the background, but do not rely only on refetch.
  4. DetailPage owns event side effects.
      - Invalidate comments on grill.question-posted and comment-like events.
      - Invalidate costs on agent.run-completed, agent.run-failed, and budget terminal events.
      - Invalidate intervention timeline queries on intervention-linked transitions.
  5. All workflow-owned state mutations emit state.transitioned.
      - Reuse and extend the existing `core/event-stream/state-transition.ts` seam instead of creating an unrelated second
        event helper.
      - Introduce one canonical transition wrapper that composes the existing `StateSource.transitionState` /
        `StateSource.forceState` behavior with `emitStateTransitionEvent`.
      - Do not move event emission into `StateSource` implementations. `StateSource` remains the source-of-truth mutation
        adapter; workflow/server code remains responsible for Factory event emission.
      - The wrapper must preserve current semantics: legal transitions still use `transitionState`, explicit forced transitions
        still use `forceState`, existing notes/comments/intervention metadata remain supported, and no event is emitted if the
        source-state mutation fails.
      - Support explicit forced transitions with a required caller-supplied `from` state when known, or a clearly marked
        forced-transition payload when the previous state cannot be known safely.
      - Before migration, audit existing direct `transitionState` / `forceState` call sites and classify each as:
        workflow-owned mutation to migrate, source/test setup to leave alone, or external/bootstrap/sweep path intentionally
        outside issue timeline emission.
      - Migrate known workflow-owned direct call sites in Grill/PRD, decompose, investigate, approve/merge, retrospective,
        dispatch fallbacks, MCP/chat transition tools, and intervention appliers only after tests cover the wrapper's legal,
        forced, and failure cases.
  6. All skill decisions become canonical when appropriate.
      - implement-wp parsed output decisionSummaries must reconcile to agent.decision-summary.
      - evidence-post final output decisionSummaries must reconcile to agent.decision-summary.
      - playwright-repro should include decisionSummaries in its configured output schema and reconcile them.
      - Preserve agent.decision-summary-live from record_decision and compatibility [decision] markers.
      - Do not double-emit canonical decisions when DB-backed decision rows already exist.
  7. Grill UI is defensive against stale raw issue state.
      - Derive awaitingReply from the latest unanswered griller question.
      - If latest grill-thread comment is an unanswered griller question, show reply form even when raw state is stale.
      - Sending a reply must use effective state so stale factory:grilling does not skip the required transition.

  Acceptance Criteria

  - [ ] DetailPage opens exactly one SSE stream for an issue detail page.
  - [ ] TimelineSection does not create its own EventSource.
  - [ ] Live agent.decision-summary and agent.decision-summary-live events appear in Timeline without reload.
  - [ ] Live parallel-implement.* events continue appearing during implement-WP runs without reload.
  - [ ] If SSE reconnects after missed events, the client backfills events newer than the last cached event id.
  - [ ] When a state.transitioned event arrives, header state, banners, and available actions update immediately from payload.to.
  - [ ] A stale source refetch cannot overwrite a newer event-patched state with an older state.
  - [ ] PRD draft completion emits state.transitioned for factory:prd-drafting -> factory:prd-review.
  - [ ] PRD draft completion updates header/actions to PRD review without reload.
  - [ ] Decompose success emits transition events for factory:decomposing -> factory:issues-created -> factory:done.
  - [ ] Decompose failure paths emit transition events to factory:needs-human.
  - [ ] Investigate failure paths emit transition events to factory:needs-human.
  - [ ] Approved merge emits factory:approved -> factory:retrospecting.
  - [ ] Retrospective completion/failure emits factory:retrospecting -> factory:done or factory:needs-human.
  - [ ] MCP/chat transition tools emit state.transitioned when they mutate issue state.
  - [ ] Existing transition semantics are preserved: illegal legal-transition attempts still fail, forced transitions still
    bypass legality only where explicitly requested, and failed source mutations do not emit state.transitioned.
  - [ ] Direct transition call sites are audited and documented in the PR: migrated workflow-owned calls are listed, and
    intentionally-unmigrated source/test/bootstrap/sweep calls are justified.
  - [ ] implement-wp decision summaries become canonical agent.decision-summary events.
  - [ ] evidence-post final decision summaries become canonical agent.decision-summary events.
  - [ ] playwright-repro output includes decision summaries and emits canonical decision-summary events.
  - [ ] record_decision still emits immediate agent.decision-summary-live.
  - [ ] Canonical reconciliation does not duplicate live/DB-backed decisions.
  - [ ] Grill stale-state/latest-question regression shows the reply form, not the processing footer.
  - [ ] Two tabs on the same issue continue receiving implement events; a reload is not required to recover ordinary missed
    events.

  Verification

  Run focused unit/component tests for DetailPage live cache patching, Timeline shared cache rendering, Grill stale-state
  behavior, transition helper emission, and skill decision reconciliation. Then manually verify Grill loop, PRD draft/review, PRD
  approval/decompose, implement-WP live timeline, and bug investigation Playwright capture.
