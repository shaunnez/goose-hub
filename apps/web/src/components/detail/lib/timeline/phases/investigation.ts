import { compareRenderItems, eventFromRenderItem, extractPhaseTimes } from '../render-items';
import type { RenderItem } from '../types';

function getRenderItemRunId(item: RenderItem): string | null {
  if (item.kind === 'run-group') return item.runId;
  if (item.kind === 'event') return item.event.runId ?? null;
  return null;
}

function getInvestigationChildParentRunId(item: RenderItem): string | null {
  const runId = getRenderItemRunId(item);
  if (runId == null) return null;
  for (const marker of [':scout:', ':bug-enhance']) {
    const markerIndex = runId.indexOf(marker);
    if (markerIndex > 0) return runId.slice(0, markerIndex);
  }
  return null;
}

function getInvestigationPayloadParentRunIds(item: RenderItem): string[] {
  const parentRunIds = new Set<string>();
  for (const event of eventFromRenderItem(item)) {
    if (!event.kind.startsWith('swarm.')) continue;
    const payload = event.payload as { parentRunId?: unknown } | null;
    if (typeof payload?.parentRunId === 'string' && payload.parentRunId.trim() !== '') {
      parentRunIds.add(payload.parentRunId);
    }
  }
  return [...parentRunIds];
}

function isInvestigationParentItem(item: RenderItem): boolean {
  if (item.kind === 'run-group') return item.skill === 'investigate';
  if (item.kind !== 'event') return false;
  const payload = item.event.payload as { skill?: string } | null;
  return (
    (item.event.kind === 'agent.run-started' && payload?.skill === 'investigate') ||
    item.event.kind === 'agent.investigation-complete'
  );
}

function withInvestigationParentSkill(item: RenderItem, investigationRunId: string): RenderItem {
  if (item.kind === 'run-group' && item.runId === investigationRunId && item.skill == null) {
    return { ...item, skill: 'investigate' };
  }
  return item;
}

function resolveInvestigationStatus(
  investigationRunId: string,
  items: RenderItem[],
): 'started' | 'live' | 'completed' | 'failed' {
  const events = items.flatMap(eventFromRenderItem);
  const hasFailure = events.some((event) => {
    const payload = event.payload as { to?: string; toState?: string } | null;
    return (
      (event.kind === 'agent.run-failed' && event.runId === investigationRunId) ||
      event.kind === 'swarm.wave-halted' ||
      (event.kind === 'state.transitioned' &&
        (payload?.to === 'factory:needs-human' || payload?.toState === 'factory:needs-human'))
    );
  });
  if (hasFailure) return 'failed';

  const hasCompletion = events.some(
    (event) =>
      event.kind === 'agent.investigation-complete' ||
      (event.kind === 'agent.run-completed' && event.runId === investigationRunId),
  );
  if (hasCompletion) return 'completed';

  const childCount = items.filter(
    (item) =>
      item.kind === 'run-group' && getInvestigationChildParentRunId(item) === investigationRunId,
  ).length;
  const eventCount = events.length;
  return childCount === 0 && eventCount <= 1 ? 'started' : 'live';
}

export function groupByInvestigationPhase(items: RenderItem[]): RenderItem[] {
  const parentRunIds = new Set<string>();
  for (const item of items) {
    const runId = getRenderItemRunId(item);
    if (runId != null && isInvestigationParentItem(item)) {
      parentRunIds.add(runId);
    }
    const childParentRunId = getInvestigationChildParentRunId(item);
    if (childParentRunId != null) {
      parentRunIds.add(childParentRunId);
    }
    for (const payloadParentRunId of getInvestigationPayloadParentRunIds(item)) {
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
      const parentRunId = getInvestigationChildParentRunId(item);
      if (parentRunId != null && parentRunIds.has(parentRunId)) {
        phaseRunId = parentRunId;
      }
      for (const payloadParentRunId of getInvestigationPayloadParentRunIds(item)) {
        if (parentRunIds.has(payloadParentRunId)) {
          phaseRunId = payloadParentRunId;
          break;
        }
      }
    }

    if (phaseRunId != null) {
      phaseItems.get(phaseRunId)?.push(withInvestigationParentSkill(item, phaseRunId));
    } else {
      ungrouped.push(item);
    }
  }

  const phases: RenderItem[] = [];
  for (const [investigationRunId, phaseItemList] of phaseItems) {
    if (phaseItemList.length === 0) continue;
    const times = extractPhaseTimes(phaseItemList);
    phases.push({
      kind: 'investigation-phase',
      investigationRunId,
      items: phaseItemList.sort(compareRenderItems),
      status: resolveInvestigationStatus(investigationRunId, phaseItemList),
      ...times,
    });
  }

  return [...ungrouped, ...phases].sort(compareRenderItems);
}
