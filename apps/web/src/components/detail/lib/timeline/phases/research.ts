import { compareRenderItems, eventFromRenderItem, extractPhaseTimes } from '../render-items';
import type { RenderItem } from '../types';

function getRenderItemRunId(item: RenderItem): string | null {
  if (item.kind === 'run-group') return item.runId;
  if (item.kind === 'event') return item.event.runId ?? null;
  return null;
}

function getResearchParentRunIdFromRunId(runId: string | null): string | null {
  if (runId == null) return null;
  const scoutMarker = ':research:scout:';
  const scoutIndex = runId.indexOf(scoutMarker);
  if (scoutIndex > 0) return runId.slice(0, scoutIndex + ':research'.length);
  if (runId.endsWith(':research')) return runId;
  return null;
}

function getResearchPayloadParentRunIds(item: RenderItem): string[] {
  const parentRunIds = new Set<string>();
  for (const event of eventFromRenderItem(item)) {
    const payload = event.payload as {
      parentRunId?: unknown;
      researchRunId?: unknown;
      workflowRunId?: unknown;
    } | null;
    for (const value of [payload?.parentRunId, payload?.researchRunId]) {
      if (
        typeof value === 'string' &&
        value.trim() !== '' &&
        getResearchParentRunIdFromRunId(value) === value
      ) {
        parentRunIds.add(value);
      }
    }
  }
  return [...parentRunIds];
}

function isResearchParentItem(item: RenderItem): boolean {
  if (item.kind === 'run-group') return item.skill === 'research';
  if (item.kind !== 'event') return false;
  const payload = item.event.payload as { skill?: string } | null;
  return (
    (item.event.kind === 'agent.run-started' && payload?.skill === 'research') ||
    item.event.kind === 'agent.research-complete'
  );
}

function withResearchParentSkill(item: RenderItem, researchRunId: string): RenderItem {
  if (item.kind === 'run-group' && item.runId === researchRunId && item.skill == null) {
    return { ...item, skill: 'research' };
  }
  return item;
}

function resolveResearchStatus(
  researchRunId: string,
  items: RenderItem[],
): 'started' | 'live' | 'completed' | 'failed' {
  const events = items.flatMap(eventFromRenderItem);
  const hasFailure = events.some((event) => {
    const payload = event.payload as { to?: string; toState?: string } | null;
    return (
      (event.kind === 'agent.run-failed' && event.runId === researchRunId) ||
      event.kind === 'swarm.wave-halted' ||
      (event.kind === 'state.transitioned' &&
        (payload?.to === 'factory:needs-human' || payload?.toState === 'factory:needs-human'))
    );
  });
  if (hasFailure) return 'failed';

  const hasCompletion = events.some(
    (event) =>
      event.kind === 'agent.research-complete' ||
      (event.kind === 'agent.run-completed' && event.runId === researchRunId),
  );
  if (hasCompletion) return 'completed';

  const eventCount = events.length;
  return eventCount <= 1 ? 'started' : 'live';
}

export function groupByResearchPhase(items: RenderItem[]): RenderItem[] {
  const parentRunIds = new Set<string>();
  for (const item of items) {
    const runId = getRenderItemRunId(item);
    if (runId != null && isResearchParentItem(item)) {
      const parentRunId = getResearchParentRunIdFromRunId(runId) ?? runId;
      parentRunIds.add(parentRunId);
    }
    const parentRunId = getResearchParentRunIdFromRunId(runId);
    if (parentRunId != null) parentRunIds.add(parentRunId);
    for (const payloadParentRunId of getResearchPayloadParentRunIds(item)) {
      parentRunIds.add(payloadParentRunId);
    }
  }
  if (parentRunIds.size === 0) return items;

  const phaseItems = new Map<string, RenderItem[]>();
  for (const runId of parentRunIds) phaseItems.set(runId, []);

  const ungrouped: RenderItem[] = [];
  for (const item of items) {
    let phaseRunId: string | null = null;
    const runId = getRenderItemRunId(item);
    if (runId != null && parentRunIds.has(runId)) {
      phaseRunId = runId;
    } else {
      const parentRunId = getResearchParentRunIdFromRunId(runId);
      if (parentRunId != null && parentRunIds.has(parentRunId)) phaseRunId = parentRunId;
      for (const payloadParentRunId of getResearchPayloadParentRunIds(item)) {
        if (parentRunIds.has(payloadParentRunId)) {
          phaseRunId = payloadParentRunId;
          break;
        }
      }
    }

    if (phaseRunId != null) {
      phaseItems.get(phaseRunId)?.push(withResearchParentSkill(item, phaseRunId));
    } else {
      ungrouped.push(item);
    }
  }

  const phases: RenderItem[] = [];
  for (const [researchRunId, phaseItemList] of phaseItems) {
    if (phaseItemList.length === 0) continue;
    const times = extractPhaseTimes(phaseItemList);
    phases.push({
      kind: 'research-phase',
      researchRunId,
      items: phaseItemList.sort(compareRenderItems),
      status: resolveResearchStatus(researchRunId, phaseItemList),
      ...times,
    });
  }

  return [...ungrouped, ...phases].sort(compareRenderItems);
}
