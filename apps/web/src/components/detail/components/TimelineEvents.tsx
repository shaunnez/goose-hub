import type { RenderItem, TimelineContext } from '../lib/timeline';
import { AgentImplementCompleteEvent } from './timeline/AgentImplementCompleteEvent';
import { AgentInvestigationCompleteEvent } from './timeline/AgentInvestigationCompleteEvent';
import {
  AgentRunStatusEvent,
  AgentSpawnedEvent,
  AgentTerminatedEvent,
} from './timeline/AgentLifecycleEvents';
import { AgentModelSelectedEvent } from './timeline/AgentModelSelectedEvent';
import { AgentToolCallEvent } from './timeline/AgentToolCallEvent';
import { AgentToolResultEvent } from './timeline/AgentToolResultEvent';
import { AgentTriageCompleteEvent } from './timeline/AgentTriageCompleteEvent';
import {
  AgentDecisionSummaryEvent,
  AgentDecisionSummaryLiveEvent,
} from './timeline/DecisionSummaryEvents';
import { DecomposeCompletedEvent } from './timeline/DecomposeEvents';
import {
  EvidenceNoSpecEvent,
  EvidencePostFailedEvent,
  EvidencePostedEvent,
} from './timeline/EvidenceEvents';
import {
  GateApprovedEvent,
  GateAwaitingHumanEvent,
  GateRejectedEvent,
} from './timeline/GateEvents';
import { GrillCompletedEvent, GrillQuestionPostedEvent } from './timeline/GrillEvents';
import { AgentLogEvent, AgentLogGroupEvent } from './timeline/LogEvents';
import {
  FallbackEvent,
  ManualActionEvent,
  MilestoneActivatedEvent,
  StateTransitionedEvent,
  SystemNoteEvent,
} from './timeline/MiscEvents';
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
  const { event } = item;

  switch (event.kind) {
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
    case 'agent.model-selected':
      return <AgentModelSelectedEvent key={event.id} event={event} />;
    case 'grill.question-posted':
      return <GrillQuestionPostedEvent key={event.id} event={event} />;
    case 'grill.completed':
      return <GrillCompletedEvent key={event.id} event={event} />;
    case 'evidence.no-spec-declared':
      return <EvidenceNoSpecEvent key={event.id} event={event} />;
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
    default:
      return <FallbackEvent key={event.id} event={event} />;
  }
}
