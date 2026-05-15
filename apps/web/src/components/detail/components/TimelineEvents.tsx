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
  EvidencePostFailedEvent,
  EvidencePostedEvent,
  EvidenceSkippedEvent,
} from './timeline/EvidenceEvents';
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
import { AgentLogEvent, AgentLogGroupEvent } from './timeline/LogEvents';
import {
  AgentModelSelectedEvent,
  FallbackEvent,
  ManualActionEvent,
  MilestoneActivatedEvent,
  StateTransitionedEvent,
  SystemNoteEvent,
} from './timeline/MiscEvents';
import {
  ParallelExhaustedEvent,
  ParallelIterationStartedEvent,
  ParallelWpCommittedEvent,
  ParallelWpFailedEvent,
  ParallelWpStartedEvent,
  ParallelWpTimeoutEvent,
  SpecCompletedEvent,
} from './timeline/ParallelImplementEvents';
import { PhaseGroupWrapper } from './timeline/PhaseGroupWrapper';
import { PrMergedEvent, PrOpenedEvent } from './timeline/PrEvents';
import {
  PrdAdvisorSkippedEvent,
  PrdApprovedEvent,
  PrdDeclinedEvent,
  PrdDraftedEvent,
  PrdRejectedEvent,
  PrdRevisedEvent,
} from './timeline/PrdEvents';
import { QaCompletedEvent, QaFailedEvent } from './timeline/QaEvents';
import { RetroCompletedEvent } from './timeline/RetroCompletedEvent';
import { ReviewCompletedEvent } from './timeline/ReviewCompletedEvent';
import { RunGroupWrapper } from './timeline/RunGroupWrapper';
import {
  SwarmHeartbeatEvent,
  SwarmScoutCompletedEvent,
  SwarmScoutFailedEvent,
  SwarmScoutTimeoutEvent,
  SwarmWaveEvent,
} from './timeline/SwarmEvents';
import { AgentVerifyCommandEvent, ToolWarningEvent } from './timeline/VerifyToolEvents';

export function renderTimelineItem(item: RenderItem, idx: number, context?: TimelineContext) {
  if (item.kind === 'log-group') {
    return <AgentLogGroupEvent key={`log-group-${idx}`} events={item.events} />;
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
        context={context}
        renderItem={renderTimelineItem}
      />
    );
  }
  if (item.kind === 'phase-group') {
    return (
      <PhaseGroupWrapper
        key={`phase-group-${item.pipelineRunId}`}
        pipelineRunId={item.pipelineRunId}
        items={item.items}
        startedAt={item.startedAt}
        endedAt={item.endedAt}
        context={context}
        renderItem={renderTimelineItem}
      />
    );
  }
  const { event } = item;

  switch (event.kind) {
    case 'agent.model-selected':
      return <AgentModelSelectedEvent key={event.id} event={event} />;
    case 'agent.spawned':
      return <AgentSpawnedEvent key={event.id} event={event} />;
    case 'agent.decision-summary':
      return <AgentDecisionSummaryEvent key={event.id} event={event} />;
    case 'agent.decision-summary-live':
      return <AgentDecisionSummaryLiveEvent key={event.id} event={event} />;
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
    case 'agent.verify-command':
      return <AgentVerifyCommandEvent key={event.id} event={event} />;
    case 'tool.stdout-truncated':
    case 'tool.timeout':
      return <ToolWarningEvent key={event.id} event={event} />;
    case 'qa.completed':
      return <QaCompletedEvent key={event.id} event={event} />;
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
    case 'decompose.completed':
      return <DecomposeCompletedEvent key={event.id} event={event} context={context} />;
    case 'swarm.heartbeat':
      return <SwarmHeartbeatEvent key={event.id} event={event} />;
    case 'swarm.scout-completed':
      return <SwarmScoutCompletedEvent key={event.id} event={event} />;
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
    case 'parallel-implement.iteration-started':
      return <ParallelIterationStartedEvent key={event.id} event={event} />;
    case 'parallel-implement.wp-started':
      return <ParallelWpStartedEvent key={event.id} event={event} />;
    case 'parallel-implement.wp-committed':
      return <ParallelWpCommittedEvent key={event.id} event={event} />;
    case 'parallel-implement.wp-failed':
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
