export function getDiscoverSessionId(event: AgentEventDto): string | null {
  const payload = event.payload as { discoverSessionId?: unknown } | null;
  if (typeof payload?.discoverSessionId === 'string' && payload.discoverSessionId.trim() !== '') {
    return payload.discoverSessionId;
  }
  return null;
}

function getWorkflowRunId(event: AgentEventDto): string | null {
  const payload = event.payload as { workflowRunId?: unknown } | null;
  if (typeof payload?.workflowRunId === 'string' && payload.workflowRunId.trim() !== '') {
    return payload.workflowRunId;
  }
  return event.runId ?? null;
}

export type DiscoverSessionRunIndex = ReadonlyMap<string, string>;

export function discoverIndexKey(kind: 'run' | 'workflow', id: string): string {
  return `${kind}:${id}`;
}

export function getDiscoverPhaseId(
  event: AgentEventDto,
  discoverSessionByWorkflowOrRunId: DiscoverSessionRunIndex = new Map(),
): { id: string; idKind: 'session' | 'workflow' } | null {
  const discoverSessionId = getDiscoverSessionId(event);
  if (discoverSessionId != null) return { id: discoverSessionId, idKind: 'session' };
  const workflowRunId = getWorkflowRunId(event);
  if (workflowRunId != null) {
    const sessionId = discoverSessionByWorkflowOrRunId.get(
      discoverIndexKey('workflow', workflowRunId),
    );
    if (sessionId != null) return { id: sessionId, idKind: 'session' };
  }
  if (event.runId != null) {
    const sessionId = discoverSessionByWorkflowOrRunId.get(discoverIndexKey('run', event.runId));
    if (sessionId != null) return { id: sessionId, idKind: 'session' };
  }
  return workflowRunId != null ? { id: workflowRunId, idKind: 'workflow' } : null;
}

function isGrillPhaseEvent(event: AgentEventDto): boolean {
  if (event.kind.startsWith('grill.')) return true;
  if (event.kind !== 'state.transitioned' || getDiscoverSessionId(event) == null) return false;
  const payload = event.payload as { from?: unknown; to?: unknown } | null;
  return payload?.from === 'factory:gate-pending' && payload.to === 'factory:grilling';
}

function isPrdPhaseEvent(event: AgentEventDto): boolean {
  return event.kind.startsWith('prd.');
}

function resolveDiscoverPhaseStatus(
  phase: 'grill' | 'prd',
  items: RenderItem[],
): 'started' | 'live' | 'completed' | 'failed' {
  const events = items.flatMap(eventFromRenderItem);
  if (events.some((event) => event.kind === 'agent.run-failed')) return 'failed';
  if (phase === 'grill') {
    if (events.some((event) => event.kind === 'grill.completed')) return 'completed';
  } else if (
    events.some((event) =>
      ['prd.drafted', 'prd.approved', 'prd.rejected', 'prd.revised', 'prd.declined'].includes(
        event.kind,
      ),
    )
  ) {
    return 'completed';
  }
  return items.some(hasLiveRunGroup) ? 'live' : 'started';
}

function appendDiscoverPhaseItem(
  phaseItems: Map<
    string,
    { id: string; idKind: 'session' | 'workflow'; grill: RenderItem[]; prd: RenderItem[] }
  >,
  phaseId: { id: string; idKind: 'session' | 'workflow' },
  phase: 'grill' | 'prd',
  item: RenderItem,
): void {
  const key = `${phaseId.idKind}:${phaseId.id}`;
  const group = phaseItems.get(key) ?? { ...phaseId, grill: [], prd: [] };
  group[phase].push(item);
  phaseItems.set(key, group);
}

function discoverSessionIdFromUnknown(value: unknown): string | null {
  if (value == null || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.discoverSessionId === 'string' && record.discoverSessionId.trim() !== '') {
    return record.discoverSessionId;
  }
  for (const key of ['evidence', 'actionPayload', 'result', 'verification']) {
    const nested = discoverSessionIdFromUnknown(record[key]);
    if (nested != null) return nested;
  }
  return null;
}

function interventionDiscoverSessionId(
  item: Extract<RenderItem, { kind: 'intervention-group' }>,
): string | null {
  if (item.intervention.interventionType !== 'manual_override') return null;
  for (const value of [
    item.intervention.decidedActionPayload,
    item.intervention.applicationResult,
    item.intervention.verification,
    ...item.events.map((event) => event.payload),
  ]) {
    const discoverSessionId = discoverSessionIdFromUnknown(value);
    if (discoverSessionId != null) return discoverSessionId;
  }
  return null;
}

function childDiscoverPhase(
  item: RenderItem,
  discoverSessionByWorkflowOrRunId: DiscoverSessionRunIndex = new Map(),
): { id: string; idKind: 'session' | 'workflow'; phase: 'grill' | 'prd' } | null {
  if (item.kind === 'intervention-group') {
    const discoverSessionId = interventionDiscoverSessionId(item);
    if (discoverSessionId != null) {
      return { id: discoverSessionId, idKind: 'session', phase: 'grill' };
    }
    return null;
  }
  if (item.kind !== 'run-group') return null;
  for (const event of eventFromRenderItem(item)) {
    const phaseId = getDiscoverPhaseId(event, discoverSessionByWorkflowOrRunId);
    if (phaseId == null) continue;
    const payload = event.payload as { skill?: string } | null;
    if (payload?.skill === 'grill-me') return { ...phaseId, phase: 'grill' };
    if (payload?.skill === 'write-prd' || payload?.skill === 'advise-on-prd') {
      return { ...phaseId, phase: 'prd' };
    }
  }
  if (item.runId.endsWith(':grill-me')) {
    return {
      id: item.runId.slice(0, -':grill-me'.length),
      idKind: 'workflow',
      phase: 'grill',
    };
  }
  if (item.runId.endsWith(':write-prd')) {
    return {
      id: item.runId.slice(0, -':write-prd'.length),
      idKind: 'workflow',
      phase: 'prd',
    };
  }
  if (item.runId.endsWith(':advise-on-prd')) {
    return {
      id: item.runId.slice(0, -':advise-on-prd'.length),
      idKind: 'workflow',
      phase: 'prd',
    };
  }
  return null;
}

export function eventDiscoverPhase(
  event: AgentEventDto,
  discoverSessionByWorkflowOrRunId: DiscoverSessionRunIndex = new Map(),
): { id: string; idKind: 'session' | 'workflow'; phase: 'grill' | 'prd' } | null {
  const phaseId = getDiscoverPhaseId(event, discoverSessionByWorkflowOrRunId);
  const payload = event.payload as { skill?: string } | null;
  if (phaseId != null) {
    if (payload?.skill === 'grill-me') return { ...phaseId, phase: 'grill' };
    if (payload?.skill === 'write-prd' || payload?.skill === 'advise-on-prd') {
      return { ...phaseId, phase: 'prd' };
    }
  }
  if (event.runId?.endsWith(':grill-me')) {
    return {
      id: event.runId.slice(0, -':grill-me'.length),
      idKind: 'workflow',
      phase: 'grill',
    };
  }
  if (event.runId?.endsWith(':write-prd')) {
    return {
      id: event.runId.slice(0, -':write-prd'.length),
      idKind: 'workflow',
      phase: 'prd',
    };
  }
  if (event.runId?.endsWith(':advise-on-prd')) {
    return {
      id: event.runId.slice(0, -':advise-on-prd'.length),
      idKind: 'workflow',
      phase: 'prd',
    };
  }
  return null;
}

export function groupByDiscoverPhase(items: RenderItem[]): RenderItem[] {
  return groupByDiscoverPhaseWithSessionIndex(items, new Map());
}

export function groupByDiscoverPhaseWithSessionIndex(
  items: RenderItem[],
  discoverSessionByWorkflowOrRunId: DiscoverSessionRunIndex,
): RenderItem[] {
  const phaseItems = new Map<
    string,
    { id: string; idKind: 'session' | 'workflow'; grill: RenderItem[]; prd: RenderItem[] }
  >();
  const ungrouped: RenderItem[] = [];

  for (const item of items) {
    const childPhase = childDiscoverPhase(item, discoverSessionByWorkflowOrRunId);
    if (childPhase != null) {
      appendDiscoverPhaseItem(phaseItems, childPhase, childPhase.phase, item);
      continue;
    }

    if (item.kind === 'event') {
      const runtimePhase = eventDiscoverPhase(item.event, discoverSessionByWorkflowOrRunId);
      if (runtimePhase != null) {
        appendDiscoverPhaseItem(phaseItems, runtimePhase, runtimePhase.phase, item);
        continue;
      }
      const phaseId = getDiscoverPhaseId(item.event, discoverSessionByWorkflowOrRunId);
      if (phaseId != null && isGrillPhaseEvent(item.event)) {
        appendDiscoverPhaseItem(phaseItems, phaseId, 'grill', item);
        continue;
      }
      if (phaseId != null && isPrdPhaseEvent(item.event)) {
        appendDiscoverPhaseItem(phaseItems, phaseId, 'prd', item);
        continue;
      }
      ungrouped.push(item);
      continue;
    }

    if (item.kind === 'run-group') {
      const remaining: RenderItem[] = [];
      let consumedDiscoverPhase: 'grill' | 'prd' | null = null;
      for (const event of eventFromRenderItem(item)) {
        const phaseId = getDiscoverPhaseId(event, discoverSessionByWorkflowOrRunId);
        if (phaseId != null && isGrillPhaseEvent(event)) {
          appendDiscoverPhaseItem(phaseItems, phaseId, 'grill', { kind: 'event', event });
          consumedDiscoverPhase = 'grill';
        } else if (phaseId != null && isPrdPhaseEvent(event)) {
          appendDiscoverPhaseItem(phaseItems, phaseId, 'prd', { kind: 'event', event });
          consumedDiscoverPhase = 'prd';
        } else {
          remaining.push({ kind: 'event', event });
        }
      }
      if (consumedDiscoverPhase != null) {
        if (remaining.length > 1) {
          const meta = extractRunMeta(remaining);
          ungrouped.push({
            kind: 'run-group',
            runId: item.runId,
            items: remaining,
            ...meta,
            skill: meta.skill ?? (consumedDiscoverPhase === 'grill' ? 'grill-me' : 'write-prd'),
          });
        } else {
          ungrouped.push(...remaining);
        }
      } else {
        ungrouped.push(item);
      }
      continue;
    }

    ungrouped.push(item);
  }

  const phases: RenderItem[] = [];
  for (const grouped of phaseItems.values()) {
    for (const phase of ['grill', 'prd'] as const) {
      const phaseItemList = grouped[phase];
      if (phaseItemList.length === 0) continue;
      const times = extractPhaseTimes(phaseItemList);
      phases.push({
        kind: 'phase-group',
        phase,
        pipelineRunId: grouped.id,
        idKind: grouped.idKind,
        items: withDefaultDiscoverRunSkill(phaseItemList, phase).sort(compareRenderItems),
        status: resolveDiscoverPhaseStatus(phase, phaseItemList),
        ...times,
      });
    }
  }

  return [...ungrouped, ...phases].sort(compareRenderItems);
}

function withDefaultDiscoverRunSkill(items: RenderItem[], phase: 'grill' | 'prd'): RenderItem[] {
  const skill = phase === 'grill' ? 'grill-me' : 'write-prd';
  return items.map((item) => {
    if (item.kind === 'run-group' && item.skill == null) return { ...item, skill };
    return item;
  });
}
import type { AgentEventDto } from '@/lib/types';
import {
  compareRenderItems,
  eventFromRenderItem,
  extractPhaseTimes,
  hasLiveRunGroup,
} from '../render-items';
import { extractRunMeta } from '../run-groups';
import type { RenderItem } from '../types';
