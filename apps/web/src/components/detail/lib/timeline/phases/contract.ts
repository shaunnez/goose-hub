import {
  compareRenderItems,
  eventFromRenderItem,
  extractPhaseTimes,
  hasLiveRunGroup,
} from '../render-items';
import type { RenderItem } from '../types';

function isContractPhaseItem(item: RenderItem): boolean {
  if (item.kind === 'run-group') {
    return item.skill === 'spec-author' || item.skill === 'acceptance-contract';
  }
  if (item.kind !== 'event') return false;
  return item.event.kind === 'spec.completed' || item.event.kind === 'acceptance.contract-authored';
}

function contractPhaseId(item: RenderItem): string | null {
  if (!isContractPhaseItem(item)) return null;
  if (item.kind === 'run-group') return item.runId;
  if (item.kind === 'event') return item.event.runId ?? item.event.kind;
  return null;
}

function resolveContractPhaseStatus(
  items: RenderItem[],
): 'started' | 'live' | 'completed' | 'failed' {
  const events = items.flatMap(eventFromRenderItem);
  if (events.some((event) => event.kind === 'agent.run-failed')) return 'failed';
  if (events.some((event) => event.kind === 'spec.completed')) return 'completed';
  if (events.some((event) => event.kind === 'acceptance.contract-authored')) return 'completed';
  if (events.some((event) => event.kind === 'agent.run-completed')) return 'completed';
  return items.some(hasLiveRunGroup) ? 'live' : 'started';
}

export function groupByContractPhase(items: RenderItem[]): RenderItem[] {
  const phaseItems = new Map<string, RenderItem[]>();
  const ungrouped: RenderItem[] = [];

  for (const item of items) {
    const id = contractPhaseId(item);
    if (id == null) {
      ungrouped.push(item);
      continue;
    }
    const group = phaseItems.get(id) ?? [];
    group.push(item);
    phaseItems.set(id, group);
  }

  if (phaseItems.size === 0) return items;

  const phases: RenderItem[] = [];
  for (const [id, phaseItemList] of phaseItems) {
    const times = extractPhaseTimes(phaseItemList);
    phases.push({
      kind: 'phase-group',
      phase: 'contract',
      pipelineRunId: id,
      idKind: 'contract',
      items: phaseItemList.sort(compareRenderItems),
      status: resolveContractPhaseStatus(phaseItemList),
      ...times,
    });
  }

  return [...ungrouped, ...phases].sort(compareRenderItems);
}
