import type { RenderItem, TimelineContext } from '../lib/timeline';
import { AgentImplementCompleteEvent } from './timeline/AgentImplementCompleteEvent';
import { AgentInvestigationCompleteEvent } from './timeline/AgentInvestigationCompleteEvent';
import {
  AgentRunStatusEvent,
  AgentSpawnedEvent,
  AgentTerminatedEvent,
} from './timeline/AgentLifecycleEvents';
import { AgentToolCallEvent } from './timeline/AgentToolCallEvent';
import { AgentToolResultEvent } from './timeline/AgentToolResultEvent';
import { AgentTriageCompleteEvent } from './timeline/AgentTriageCompleteEvent';
import {
  AgentDecisionSummaryEvent,
  AgentDecisionSummaryLiveEvent,
} from './timeline/DecisionSummaryEvents';
import { DecomposeCompletedEvent } from './timeline/DecomposeEvents';
import {
  DevReviewBudgetSkippedEvent,
  DevReviewCompletedEvent,
  DevReviewErrorEvent,
  DevReviewFailedEvent,
  DevReviewResponseCompletedEvent,
  DevReviewResponseFailedEvent,
  DevReviewResponseStartedEvent,
  DevReviewStartedEvent,
} from './timeline/DevReviewEvents';
import {
  EvidenceNoSpecEvent,
  EvidencePlaywrightRanEvent,
  EvidencePostFailedEvent,
  EvidencePostedEvent,
  EvidenceSkippedEvent,
} from './timeline/EvidenceEvents';
import {
  AgentFixFeedbackCompleteEvent,
  AgentFixFeedbackSkippedEvent,
} from './timeline/FixFeedbackEvents';
import {
  GateApprovedEvent,
  GateAwaitingHumanEvent,
  GateRejectedEvent,
} from './timeline/GateEvents';
import {
  GrillCompletedEvent,
  GrillDecisionCrystallizedEvent,
  GrillQuestionPostedEvent,
} from './timeline/GrillEvents';
import { InterventionGroupWrapper } from './timeline/InterventionGroupWrapper';
import { InvestigationPhaseWrapper } from './timeline/InvestigationPhaseWrapper';
import { AgentLogEvent, AgentLogGroupEvent } from './timeline/LogEvents';
import {
  AcceptanceContractAuthoredEvent,
  AgentBudgetExceededEvent,
  AgentDisclosureEvent,
  AgentModelSelectedEvent,
  BugEnhanceLazyEvent,
  CompactOperationalEvent,
  ContractDriftEvent,
  DiscoveryBudgetExceededEvent,
  DogfoodSeedAppliedEvent,
  FallbackEvent,
  InvestigationContextInjectedEvent,
  InvestigationDigestAppliedEvent,
  InvestigationSeedBuiltEvent,
  ManualActionEvent,
  MilestoneActivatedEvent,
  RedundantReadEvent,
  RelatedSurfaceManifestEvent,
  StateTransitionedEvent,
  SystemNoteEvent,
  ToolIntensityAnomalyEvent,
  ToolViolationEvent,
  WrongSurfaceGuardEvent,
} from './timeline/MiscEvents';
import {
  ParallelExhaustedEvent,
  ParallelIterationStartedEvent,
  ParallelWpCommittedEvent,
  ParallelWpContextAssembledEvent,
  ParallelWpFailedEvent,
  ParallelWpPersistedEvent,
  ParallelWpStartedEvent,
  ParallelWpTimeoutEvent,
  SpecCompletedEvent,
  SpecPrdContextAttachedEvent,
} from './timeline/ParallelImplementEvents';
import { PhaseGroupWrapper } from './timeline/PhaseGroupWrapper';
import { PrMergedEvent, PrOpenedEvent } from './timeline/PrEvents';
import {
  PrdAdvisorSkippedEvent,
  PrdApprovedEvent,
  PrdDeclinedEvent,
  PrdDraftedEvent,
  PrdLifecycleRoutedEvent,
  PrdRejectedEvent,
  PrdRevisedEvent,
} from './timeline/PrdEvents';
import {
  QaCompletedEvent,
  QaFailedEvent,
  QaPassedEvent,
  QaPreflightEvent,
  QaPreflightStepEvent,
  QaVerificationBlockedEvent,
  QaVerificationSummaryBuiltEvent,
} from './timeline/QaEvents';
import { RetroCompletedEvent } from './timeline/RetroCompletedEvent';
import { AgentRetryEscalatedEvent } from './timeline/RetryEvents';
import { ReviewCompletedEvent } from './timeline/ReviewCompletedEvent';
import { ReviewGroupWrapper } from './timeline/ReviewGroupWrapper';
import {
  ReviewConvergedEvent,
  ReviewEscalatedEvent,
  ReviewSlotCompletedEvent,
  ReviewWaveCompletedEvent,
  ReviewWaveFailedEvent,
} from './timeline/ReviewWaveEvents';
import { RunGroupWrapper } from './timeline/RunGroupWrapper';
import {
  SwarmHeartbeatEvent,
  SwarmScoutCompletedEvent,
  SwarmScoutFailedEvent,
  SwarmScoutSkippedEvent,
  SwarmScoutTimeoutEvent,
  SwarmWaveEvent,
} from './timeline/SwarmEvents';
import { SymbolIndexHintsUsedEvent, SymbolIndexLookupEvent } from './timeline/SymbolIndexEvents';
import { TimelineSectionGroupWrapper } from './timeline/TimelineSectionGroupWrapper';
import { AgentVerifyCommandEvent, ToolWarningEvent } from './timeline/VerifyToolEvents';

export function renderTimelineItem(item: RenderItem, idx: number, context?: TimelineContext) {
  if (item.kind === 'log-group') {
    return <AgentLogGroupEvent key={`log-group-${idx}`} events={item.events} />;
  }
  if (item.kind === 'timeline-section') {
    return (
      <TimelineSectionGroupWrapper
        key={`timeline-section-${item.segmentId}-${idx}`}
        segmentId={item.segmentId}
        section={item.section}
        items={item.items}
        startedAt={item.startedAt}
        endedAt={item.endedAt}
        lastEventAt={item.lastEventAt}
        context={context}
        renderItem={renderTimelineItem}
      />
    );
  }
  if (item.kind === 'intervention-group') {
    return (
      <InterventionGroupWrapper
        key={`intervention-group-${item.intervention.id}`}
        intervention={item.intervention}
        events={item.events}
        startedAt={item.startedAt}
        endedAt={item.endedAt}
        lastEventAt={item.lastEventAt}
        context={context}
      />
    );
  }
  if (item.kind === 'run-group') {
    return (
      <RunGroupWrapper
        key={`run-group-${item.runId}`}
        runId={item.runId}
        items={item.items}
        idx={idx}
        skill={item.skill}
        startedAt={item.startedAt}
        endedAt={item.endedAt}
        lastEventAt={item.lastEventAt}
        personaId={item.personaId}
        modelId={item.modelId}
        runtime={item.runtime}
        context={context}
        renderItem={renderTimelineItem}
      />
    );
  }
  if (item.kind === 'phase-group') {
    return (
      <PhaseGroupWrapper
        key={`phase-group-${item.phase}-${item.pipelineRunId}`}
        phase={item.phase}
        pipelineRunId={item.pipelineRunId}
        idKind={item.idKind}
        items={item.items}
        status={item.status}
        startedAt={item.startedAt}
        endedAt={item.endedAt}
        lastEventAt={item.lastEventAt}
        context={context}
        renderItem={renderTimelineItem}
      />
    );
  }
  if (item.kind === 'investigation-phase') {
    return (
      <InvestigationPhaseWrapper
        key={`investigation-phase-${item.investigationRunId}`}
        investigationRunId={item.investigationRunId}
        items={item.items}
        status={item.status}
        startedAt={item.startedAt}
        endedAt={item.endedAt}
        lastEventAt={item.lastEventAt}
        context={context}
        renderItem={renderTimelineItem}
      />
    );
  }
  if (item.kind === 'review-group') {
    return (
      <ReviewGroupWrapper
        key={`review-group-${item.reviewWorkflowRunId}`}
        reviewWorkflowRunId={item.reviewWorkflowRunId}
        items={item.items}
        status={item.status}
        startedAt={item.startedAt}
        endedAt={item.endedAt}
        lastEventAt={item.lastEventAt}
        context={context}
        renderItem={renderTimelineItem}
      />
    );
  }
  const { event } = item;

  switch (event.kind) {
    case 'dogfood.seed-applied':
      return <DogfoodSeedAppliedEvent key={event.id} event={event} />;
    case 'agent.model-selected':
      return <AgentModelSelectedEvent key={event.id} event={event} />;
    case 'agent.budget-exceeded':
      return <AgentBudgetExceededEvent key={event.id} event={event} />;
    case 'agent.investigation-seed-built':
      return <InvestigationSeedBuiltEvent key={event.id} event={event} />;
    case 'agent.bug-enhance-lazy':
      return <BugEnhanceLazyEvent key={event.id} event={event} />;
    case 'agent.redundant-read':
      return <RedundantReadEvent key={event.id} event={event} />;
    case 'agent.fallback-triggered':
    case 'agent.repo-override':
    case 'merge.conflict':
    case 'merge.conflict-resolved':
    case 'merge.conflict-unresolvable':
    case 'qa.tier-disagreement':
    case 'project.budget-exceeded':
    case 'coach.completed':
    case 'coach.dispatch-triggered':
    case 'coach.skipped-forbidden-target':
    case 'coach.dispatch-failed':
    case 'workflow.smoke-failed':
    case 'agent.cancelled':
    case 'agent.runtime-advisory':
    case 'spec.wp-issues-created':
    case 'merge-decision.completed':
    case 'audit.completed':
    case 'audit.failed':
    case 'audit.autonomy-gate-fired':
    case 'agent.investigation-seed-empty':
    case 'state.transition-deferred':
    case 'agent.bug-enhance-empty':
    case 'agent.bug-enhance-hallucinated':
    case 'agent.bug-enhance-workspace-empty':
    case 'agent.run-aborted':
    case 'workflow.route-selected':
    case 'workflow.route-confirmed':
    case 'workflow.route-escalation-proposed':
    case 'workflow.route-cap-applied':
      return <CompactOperationalEvent key={event.id} event={event} />;
    case 'agent.investigation-context-injected':
      return <InvestigationContextInjectedEvent key={event.id} event={event} />;
    case 'investigation.digest-applied':
      return <InvestigationDigestAppliedEvent key={event.id} event={event} />;
    case 'agent.related-surface-manifest-created':
      return <RelatedSurfaceManifestEvent key={event.id} event={event} />;
    case 'agent.discovery-budget-exceeded':
      return <DiscoveryBudgetExceededEvent key={event.id} event={event} />;
    case 'agent.wrong-surface-guard':
      return <WrongSurfaceGuardEvent key={event.id} event={event} />;
    case 'agent.path-normalized':
    case 'agent.output-repaired':
    case 'agent.output-repair-failed':
    case 'agent.output-fact-mismatch':
    case 'agent.contract-gate-blocked':
      return <ContractDriftEvent key={event.id} event={event} />;
    case 'acceptance.contract-authored':
      return <AcceptanceContractAuthoredEvent key={event.id} event={event} />;
    case 'symbol-index.lookup':
      return <SymbolIndexLookupEvent key={event.id} event={event} />;
    case 'symbol-index.hints-used':
      return <SymbolIndexHintsUsedEvent key={event.id} event={event} />;
    case 'agent.spawned':
      return <AgentSpawnedEvent key={event.id} event={event} />;
    case 'agent.decision-summary':
      return <AgentDecisionSummaryEvent key={event.id} event={event} />;
    case 'agent.decision-summary-live':
      return <AgentDecisionSummaryLiveEvent key={event.id} event={event} />;
    case 'agent.disclosure':
      return <AgentDisclosureEvent key={event.id} event={event} />;
    case 'agent.log':
      return <AgentLogEvent key={event.id} event={event} />;
    case 'agent.terminated':
      return <AgentTerminatedEvent key={event.id} event={event} />;
    case 'manual.action':
      return <ManualActionEvent key={event.id} event={event} />;
    case 'milestone.activated':
      return <MilestoneActivatedEvent key={event.id} event={event} />;
    case 'state.transitioned':
      return <StateTransitionedEvent key={event.id} event={event} />;
    case 'gate.awaiting-human':
      return <GateAwaitingHumanEvent key={event.id} event={event} />;
    case 'system.note':
      return <SystemNoteEvent key={event.id} event={event} />;
    case 'agent.run-started':
    case 'agent.run-completed':
    case 'agent.run-failed':
      return <AgentRunStatusEvent key={event.id} event={event} />;
    case 'agent.tool-call':
      return <AgentToolCallEvent key={event.id} event={event} />;
    case 'agent.tool-result':
      return <AgentToolResultEvent key={event.id} event={event} />;
    case 'agent.tool-intensity-anomaly':
      return <ToolIntensityAnomalyEvent key={event.id} event={event} />;
    case 'tool.violation':
      return <ToolViolationEvent key={event.id} event={event} />;
    case 'agent.verify-command':
      return <AgentVerifyCommandEvent key={event.id} event={event} />;
    case 'tool.stdout-truncated':
    case 'tool.timeout':
      return <ToolWarningEvent key={event.id} event={event} />;
    case 'qa.completed':
      return <QaCompletedEvent key={event.id} event={event} />;
    case 'qa.verification-blocked':
      return <QaVerificationBlockedEvent key={event.id} event={event} />;
    case 'qa.verification-summary-built':
      return <QaVerificationSummaryBuiltEvent key={event.id} event={event} />;
    case 'qa.preflight-started':
    case 'qa.preflight-completed':
      return <QaPreflightEvent key={event.id} event={event} />;
    case 'qa.preflight-step-started':
    case 'qa.preflight-step-completed':
    case 'qa.preflight-step-failed':
      return <QaPreflightStepEvent key={event.id} event={event} />;
    case 'qa.structural-passed':
    case 'qa.functional-passed':
    case 'qa.regression-passed':
      return <QaPassedEvent key={event.id} event={event} />;
    case 'qa.structural-failed':
    case 'qa.functional-failed':
    case 'qa.regression-failed':
      return <QaFailedEvent key={event.id} event={event} />;
    case 'agent.triage-complete':
      return <AgentTriageCompleteEvent key={event.id} event={event} />;
    case 'agent.investigation-complete':
      return <AgentInvestigationCompleteEvent key={event.id} event={event} />;
    case 'pr.opened':
      return <PrOpenedEvent key={event.id} event={event} />;
    case 'review.completed':
      return <ReviewCompletedEvent key={event.id} event={event} />;
    case 'review.wave-completed':
      return <ReviewWaveCompletedEvent key={event.id} event={event} />;
    case 'review.wave-failed':
      return <ReviewWaveFailedEvent key={event.id} event={event} />;
    case 'review.converged':
      return <ReviewConvergedEvent key={event.id} event={event} />;
    case 'review.escalated':
      return <ReviewEscalatedEvent key={event.id} event={event} />;
    case 'review.slot-completed':
      return <ReviewSlotCompletedEvent key={event.id} event={event} />;
    case 'retrospective.completed':
      return <RetroCompletedEvent key={event.id} event={event} />;
    case 'pr.merged':
      return <PrMergedEvent key={event.id} event={event} />;
    case 'gate.approved':
      return <GateApprovedEvent key={event.id} event={event} />;
    case 'gate.rejected':
      return <GateRejectedEvent key={event.id} event={event} />;
    case 'agent.implement-complete':
      return <AgentImplementCompleteEvent key={event.id} event={event} />;
    case 'agent.fix-feedback-complete':
      return <AgentFixFeedbackCompleteEvent key={event.id} event={event} />;
    case 'agent.fix-feedback-skipped':
      return <AgentFixFeedbackSkippedEvent key={event.id} event={event} />;
    case 'agent.retry-escalated':
      return <AgentRetryEscalatedEvent key={event.id} event={event} />;
    case 'grill.question-posted':
      return <GrillQuestionPostedEvent key={event.id} event={event} />;
    case 'grill.decision-crystallized':
      return <GrillDecisionCrystallizedEvent key={event.id} event={event} />;
    case 'grill.completed':
      return <GrillCompletedEvent key={event.id} event={event} />;
    case 'evidence.no-spec-declared':
      return <EvidenceNoSpecEvent key={event.id} event={event} />;
    case 'evidence.playwright-repro-skipped':
    case 'evidence.post-skipped':
      return <EvidenceSkippedEvent key={event.id} event={event} />;
    case 'evidence.playwright-ran':
      return <EvidencePlaywrightRanEvent key={event.id} event={event} />;
    case 'evidence.posted':
      return <EvidencePostedEvent key={event.id} event={event} />;
    case 'evidence.post-failed':
      return <EvidencePostFailedEvent key={event.id} event={event} />;
    case 'prd.drafted':
      return <PrdDraftedEvent key={event.id} event={event} />;
    case 'prd.advisor-skipped':
      return <PrdAdvisorSkippedEvent key={event.id} event={event} />;
    case 'prd.approved':
      return <PrdApprovedEvent key={event.id} event={event} />;
    case 'prd.rejected':
      return <PrdRejectedEvent key={event.id} event={event} />;
    case 'prd.revised':
      return <PrdRevisedEvent key={event.id} event={event} />;
    case 'prd.declined':
      return <PrdDeclinedEvent key={event.id} event={event} />;
    case 'prd.lifecycle-routed':
      return <PrdLifecycleRoutedEvent key={event.id} event={event} />;
    case 'decompose.completed':
      return <DecomposeCompletedEvent key={event.id} event={event} context={context} />;
    case 'swarm.heartbeat':
      return <SwarmHeartbeatEvent key={event.id} event={event} />;
    case 'swarm.scout-completed':
      return <SwarmScoutCompletedEvent key={event.id} event={event} />;
    case 'swarm.scout-skipped':
      return <SwarmScoutSkippedEvent key={event.id} event={event} />;
    case 'swarm.scout-failed':
      return <SwarmScoutFailedEvent key={event.id} event={event} />;
    case 'swarm.scout-timeout':
      return <SwarmScoutTimeoutEvent key={event.id} event={event} />;
    case 'swarm.wave-completed':
    case 'swarm.wave-halted':
    case 'swarm.wave-incomplete':
      return <SwarmWaveEvent key={event.id} event={event} />;
    case 'spec.completed':
      return <SpecCompletedEvent key={event.id} event={event} />;
    case 'spec.prd-context-attached':
      return <SpecPrdContextAttachedEvent key={event.id} event={event} />;
    case 'parallel-implement.iteration-started':
      return <ParallelIterationStartedEvent key={event.id} event={event} />;
    case 'parallel-implement.wp-started':
      return <ParallelWpStartedEvent key={event.id} event={event} />;
    case 'parallel-implement.wp-context-assembled':
      return <ParallelWpContextAssembledEvent key={event.id} event={event} />;
    case 'parallel-implement.wp-committed':
      return <ParallelWpCommittedEvent key={event.id} event={event} />;
    case 'parallel-implement.wp-persisted':
      return <ParallelWpPersistedEvent key={event.id} event={event} />;
    case 'parallel-implement.wp-failed':
    case 'parallel-implement.wp-loop-cap-hit':
    case 'parallel-implement.wp-terminal-blocked':
    case 'parallel-implement.wp-commit-failed':
      return <ParallelWpFailedEvent key={event.id} event={event} />;
    case 'parallel-implement.wp-timeout':
      return <ParallelWpTimeoutEvent key={event.id} event={event} />;
    case 'parallel-implement.exhausted':
      return <ParallelExhaustedEvent key={event.id} event={event} />;
    case 'dev-review.started':
      return <DevReviewStartedEvent key={event.id} event={event} />;
    case 'dev-review.completed':
      return <DevReviewCompletedEvent key={event.id} event={event} />;
    case 'dev-review.failed':
      return <DevReviewFailedEvent key={event.id} event={event} />;
    case 'dev-review.error':
      return <DevReviewErrorEvent key={event.id} event={event} />;
    case 'dev-review.budget-skipped':
      return <DevReviewBudgetSkippedEvent key={event.id} event={event} />;
    case 'dev-review.response-started':
      return <DevReviewResponseStartedEvent key={event.id} event={event} />;
    case 'dev-review.response-completed':
      return <DevReviewResponseCompletedEvent key={event.id} event={event} />;
    case 'dev-review.response-failed':
      return <DevReviewResponseFailedEvent key={event.id} event={event} />;
    default:
      return <FallbackEvent key={event.id} event={event} />;
  }
}
