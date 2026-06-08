import type { AgentEventDto } from '@/lib/types';
import { isCodexTransportWarningLog } from './log-events';
import type { RenderItem } from './types';

export function collapseLogRuns(events: AgentEventDto[]): RenderItem[] {
  const items: RenderItem[] = [];
  const flushLogGroup = (group: AgentEventDto[]) => {
    if (group.length >= 4) {
      items.push({ kind: 'log-group', events: group });
    } else {
      for (const ev of group) {
        items.push({ kind: 'event', event: ev });
      }
    }
  };
  let i = 0;
  while (i < events.length) {
    if (events[i].kind === 'agent.log') {
      const group: AgentEventDto[] = [];
      while (i < events.length && events[i].kind === 'agent.log') {
        if (isCodexTransportWarningLog(events[i])) {
          flushLogGroup(group);
          group.length = 0;
          items.push({ kind: 'event', event: events[i] });
          i++;
          continue;
        }
        group.push(events[i]);
        i++;
      }
      flushLogGroup(group);
    } else {
      items.push({ kind: 'event', event: events[i] });
      i++;
    }
  }
  return items;
}

function getRunId(item: RenderItem, qaAttemptByRunId: ReadonlyMap<string, string>): string | null {
  if (item.kind === 'event') {
    if (item.event.kind.startsWith('workflow.route-')) return null;
    const qaAttemptId = qaAttemptIdForTimelineEvent(item.event);
    if (qaAttemptId != null) return qaAttemptId;
    const inferredQaAttemptId = qaAttemptIdForRuntimeEvent(item.event, qaAttemptByRunId);
    if (inferredQaAttemptId != null) return inferredQaAttemptId;
    const runId = (item.event as AgentEventDto & { runId?: string | null }).runId ?? null;
    return scoutBaseRunId(runId);
  }
  return null;
}

function qaAttemptIdForTimelineEvent(event: AgentEventDto): string | null {
  if (!isQaTimelineEvent(event)) return null;
  const payload = event.payload as Record<string, unknown> | null;
  const qaAttemptId = payload?.qaAttemptId;
  return typeof qaAttemptId === 'string' && qaAttemptId.trim() !== '' ? qaAttemptId : null;
}

function qaAttemptIdForRuntimeEvent(
  event: AgentEventDto,
  qaAttemptByRunId: ReadonlyMap<string, string>,
): string | null {
  const runIds = eventRunIds(event);
  for (const runId of runIds) {
    const qaAttemptId = qaAttemptByRunId.get(runId);
    if (qaAttemptId != null) return qaAttemptId;
  }
  return null;
}

function eventRunIds(event: AgentEventDto): string[] {
  const ids = new Set<string>();
  if (event.runId != null && event.runId.trim() !== '') ids.add(event.runId);
  const payload = event.payload as Record<string, unknown> | null;
  for (const key of ['runId', 'run_id']) {
    const value = payload?.[key];
    if (typeof value === 'string' && value.trim() !== '') ids.add(value);
  }
  return [...ids];
}

function buildQaAttemptRunIndex(items: RenderItem[]): Map<string, string> {
  const qaAttemptByRunId = new Map<string, string>();
  for (const item of items) {
    if (item.kind !== 'event') continue;
    const qaAttemptId = qaAttemptIdForTimelineEvent(item.event);
    if (qaAttemptId == null) continue;
    for (const runId of eventRunIds(item.event)) {
      if (!qaAttemptByRunId.has(runId)) qaAttemptByRunId.set(runId, qaAttemptId);
    }
  }
  return qaAttemptByRunId;
}

function isQaTimelineEvent(event: AgentEventDto): boolean {
  if (event.kind.startsWith('qa.')) return true;
  const payload = event.payload as Record<string, unknown> | null;
  return (
    (event.kind === 'agent.run-started' ||
      event.kind === 'agent.run-completed' ||
      event.kind === 'agent.run-failed') &&
    payload?.skill === 'qa'
  );
}

function scoutBaseRunId(runId: string | null): string | null {
  if (runId == null) return null;
  const featureEnhanceRetry = runId.match(/^(.+:feature-enhance):retry:\d+$/);
  if (featureEnhanceRetry != null) return featureEnhanceRetry[1];
  return runId.endsWith(':evidence-retry') ? runId.slice(0, -':evidence-retry'.length) : runId;
}

export function extractRunMeta(items: RenderItem[]): {
  skill: string | null;
  startedAt: string | null;
  endedAt: string | null;
  lastEventAt: string | null;
  personaId: string | null;
  modelId: string | null;
  runtime: string | null;
} {
  let skill: string | null = null;
  let displaySkill: string | null = null;
  let lifecycleSkill: string | null = null;
  let fallbackSkill: string | null = null;
  let startedAt: string | null = null;
  let endedAt: string | null = null;
  let personaId: string | null = null;
  let modelId: string | null = null;
  let runtime: string | null = null;
  let earliestMs = Number.POSITIVE_INFINITY;
  let earliestIso: string | null = null;
  let latestMs = Number.NEGATIVE_INFINITY;
  let latestIso: string | null = null;

  for (const item of items) {
    if (item.kind !== 'event') continue;
    const ev = item.event;
    const p = ev.payload as {
      displaySkill?: string;
      modelId?: string;
      runtime?: string;
      skill?: string;
      workflowSkill?: string;
    } | null;

    const ms = new Date(ev.createdAt).getTime();
    if (ms < earliestMs) {
      earliestMs = ms;
      earliestIso = ev.createdAt;
    }
    if (ms > latestMs) {
      latestMs = ms;
      latestIso = ev.createdAt;
    }

    if (personaId == null && ev.personaId != null) personaId = ev.personaId;

    if (displaySkill == null && p?.displaySkill != null) displaySkill = p.displaySkill;
    if (displaySkill == null && p?.workflowSkill != null) displaySkill = p.workflowSkill;
    if (displaySkill == null && ev.kind === 'agent.fix-feedback-complete') {
      displaySkill = 'fix-feedback';
    }
    if (displaySkill == null && ev.kind.startsWith('feature.grounding-')) {
      displaySkill = 'feature-grounding';
    }
    if (fallbackSkill == null && p?.skill != null) fallbackSkill = p.skill;
    if (modelId == null && p?.modelId != null) modelId = p.modelId;
    if (runtime == null && p?.runtime != null) runtime = p.runtime;

    if (ev.kind === 'agent.run-started') {
      if (startedAt == null) startedAt = ev.createdAt;
      if (lifecycleSkill == null && p?.skill != null) lifecycleSkill = p.skill;
    } else if (ev.kind === 'agent.run-completed') {
      if (endedAt == null) endedAt = ev.createdAt;
      if (lifecycleSkill == null && p?.skill != null) lifecycleSkill = p.skill;
    } else if (ev.kind === 'agent.run-failed') {
      if (endedAt == null) endedAt = ev.createdAt;
      if (lifecycleSkill == null && p?.skill != null) lifecycleSkill = p.skill;
    } else if (ev.kind === 'agent.investigation-complete') {
      if (endedAt == null) endedAt = ev.createdAt;
    } else if (
      ev.kind === 'swarm.scout-completed' ||
      ev.kind === 'swarm.scout-skipped' ||
      ev.kind === 'swarm.scout-failed' ||
      ev.kind === 'swarm.scout-timeout'
    ) {
      if (endedAt == null || ms > new Date(endedAt).getTime()) endedAt = ev.createdAt;
    } else if (ev.kind === 'retrospective.completed') {
      // retrospective runs don't always emit agent.run-completed; treat this as terminal
      if (endedAt == null) endedAt = ev.createdAt;
    } else if (ev.kind === 'prd.approved' || ev.kind === 'prd.rejected') {
      if (endedAt == null) endedAt = ev.createdAt;
    } else if (ev.kind === 'grill.question-posted' || ev.kind === 'grill.completed') {
      // grill-me runs don't emit agent.run-completed - these are the terminal events
      if (endedAt == null) endedAt = ev.createdAt;
    } else if (ev.kind === 'decompose.completed') {
      if (endedAt == null) endedAt = ev.createdAt;
    } else if (ev.kind === 'feature.grounding-complete') {
      if (endedAt == null) endedAt = ev.createdAt;
    } else if (ev.kind === 'parallel-implement.iteration-started') {
      if (startedAt == null) startedAt = ev.createdAt;
      if (displaySkill == null) displaySkill = 'parallel-implement';
    } else if (
      ev.kind.startsWith('parallel-implement.') ||
      ev.kind === 'pr.opened' ||
      (ev.kind === 'state.transitioned' &&
        ((ev.payload as { to?: string; toState?: string } | null)?.to === 'factory:needs-qa' ||
          (ev.payload as { to?: string; toState?: string } | null)?.toState === 'factory:needs-qa'))
    ) {
      if (displaySkill == null) displaySkill = 'parallel-implement';
      if (
        ev.kind === 'pr.opened' ||
        ev.kind === 'parallel-implement.exhausted' ||
        ev.kind === 'parallel-implement.wp-terminal-blocked' ||
        (ev.kind === 'state.transitioned' &&
          ((ev.payload as { to?: string; toState?: string } | null)?.to === 'factory:needs-qa' ||
            (ev.payload as { to?: string; toState?: string } | null)?.toState ===
              'factory:needs-qa'))
      ) {
        if (endedAt == null || ms > new Date(endedAt).getTime()) endedAt = ev.createdAt;
      }
    } else if (ev.kind.startsWith('qa.')) {
      if (displaySkill == null) displaySkill = 'qa';
      if (isQaTerminalEvent(ev.kind)) {
        if (endedAt == null || ms > new Date(endedAt).getTime()) endedAt = ev.createdAt;
      }
    } else if (ev.kind.startsWith('dev-review.')) {
      if (displaySkill == null) displaySkill = 'dev-review';
      if (
        ev.kind === 'dev-review.completed' ||
        ev.kind === 'dev-review.failed' ||
        ev.kind === 'dev-review.error'
      ) {
        if (endedAt == null || ms > new Date(endedAt).getTime()) endedAt = ev.createdAt;
      }
    }
  }

  skill = displaySkill ?? lifecycleSkill ?? fallbackSkill;

  return {
    skill,
    startedAt: startedAt ?? earliestIso,
    endedAt,
    lastEventAt: latestIso,
    personaId,
    modelId,
    runtime,
  };
}

function isQaTerminalEvent(kind: string): boolean {
  return (
    kind === 'qa.completed' ||
    kind === 'qa.verification-blocked' ||
    kind === 'qa.workflow-completed' ||
    kind === 'qa.workflow-failed' ||
    kind === 'qa.workflow-aborted'
  );
}

export function groupByRunId(items: RenderItem[]): RenderItem[] {
  const qaAttemptByRunId = buildQaAttemptRunIndex(items);
  const byRunId = new Map<string, RenderItem[]>();
  for (const item of items) {
    const runId = getRunId(item, qaAttemptByRunId);
    if (runId != null) {
      const group = byRunId.get(runId) ?? [];
      group.push(item);
      byRunId.set(runId, group);
    }
  }

  const seen = new Set<string>();
  const result: RenderItem[] = [];
  for (const item of items) {
    const runId = getRunId(item, qaAttemptByRunId);
    if (runId != null) {
      if (seen.has(runId)) continue;
      seen.add(runId);
      const group = byRunId.get(runId) ?? [];
      if (group.length > 1) {
        const meta = extractRunMeta(group);
        result.push({ kind: 'run-group', runId, items: group, ...meta });
      } else {
        result.push(...group);
      }
    } else {
      result.push(item);
    }
  }
  return result;
}
