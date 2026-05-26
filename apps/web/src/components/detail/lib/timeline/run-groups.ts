import type { AgentEventDto } from '@/lib/types';
import { isAnsweredGrillTransition } from './grill';
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

function getRunId(item: RenderItem): string | null {
  if (item.kind === 'event') {
    return (item.event as AgentEventDto & { runId?: string | null }).runId ?? null;
  }
  return null;
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
    } else if (ev.kind === 'retrospective.completed') {
      // retrospective runs don't always emit agent.run-completed; treat this as terminal
      if (endedAt == null) endedAt = ev.createdAt;
    } else if (ev.kind === 'prd.approved' || ev.kind === 'prd.rejected') {
      if (endedAt == null) endedAt = ev.createdAt;
    } else if (ev.kind === 'grill.question-posted' || ev.kind === 'grill.completed') {
      // grill-me runs don't emit agent.run-completed - these are the terminal events
      if (endedAt == null) endedAt = ev.createdAt;
    } else if (isAnsweredGrillTransition(ev)) {
      // grill reply submissions transition back into grilling without agent.run-completed.
      if (endedAt == null || ms > new Date(endedAt).getTime()) endedAt = ev.createdAt;
    } else if (ev.kind === 'decompose.completed') {
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
      if (ev.kind === 'qa.completed' || ev.kind === 'qa.verification-blocked') {
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

export function groupByRunId(items: RenderItem[]): RenderItem[] {
  const byRunId = new Map<string, RenderItem[]>();
  for (const item of items) {
    const runId = getRunId(item);
    if (runId != null) {
      const group = byRunId.get(runId) ?? [];
      group.push(item);
      byRunId.set(runId, group);
    }
  }

  const seen = new Set<string>();
  const result: RenderItem[] = [];
  for (const item of items) {
    const runId = getRunId(item);
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
