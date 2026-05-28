import type { AgentEventDto } from '@/lib/types';
import type { RenderItem } from './types';

export function effectiveTimestamp(item: RenderItem): number {
  if (item.kind === 'intervention-group') {
    return new Date(item.lastEventAt ?? item.startedAt ?? 0).getTime();
  }
  if (item.kind === 'run-group') {
    return new Date(item.lastEventAt ?? item.startedAt ?? 0).getTime();
  }
  if (item.kind === 'timeline-section') {
    return new Date(item.lastEventAt ?? item.startedAt ?? 0).getTime();
  }
  if (item.kind === 'investigation-phase') {
    return new Date(item.lastEventAt ?? item.startedAt ?? 0).getTime();
  }
  if (item.kind === 'event') return new Date(item.event.createdAt).getTime();
  if (item.kind === 'phase-group') return new Date(item.startedAt ?? 0).getTime();
  if (item.kind === 'review-group') {
    return new Date(item.lastEventAt ?? item.startedAt ?? 0).getTime();
  }
  return maxEventTimestamp(item.events);
}

export function optionalTimestamp(value: string | null): number {
  return value == null ? 0 : new Date(value).getTime();
}

export function compareRenderItems(a: RenderItem, b: RenderItem): number {
  const activityDelta = effectiveTimestamp(b) - effectiveTimestamp(a);
  if (activityDelta !== 0) return activityDelta;

  if (a.kind === 'run-group' && b.kind === 'run-group') {
    const startedDelta = optionalTimestamp(a.startedAt) - optionalTimestamp(b.startedAt);
    if (startedDelta !== 0) return startedDelta;
    return a.runId.localeCompare(b.runId);
  }

  return 0;
}

export function compareTopLevelTimelineItems(a: RenderItem, b: RenderItem): number {
  const startDelta = optionalTimestamp(itemStartedAt(b)) - optionalTimestamp(itemStartedAt(a));
  if (startDelta !== 0) return startDelta;
  return compareRenderItems(a, b);
}

export function compareTimelineChildrenForReading(a: RenderItem, b: RenderItem): number {
  const activityDelta = effectiveTimestamp(b) - effectiveTimestamp(a);
  if (activityDelta !== 0) return activityDelta;

  const startDelta = optionalTimestamp(itemStartedAt(a)) - optionalTimestamp(itemStartedAt(b));
  if (startDelta !== 0) return startDelta;

  if (a.kind === 'run-group' && b.kind === 'run-group') return a.runId.localeCompare(b.runId);
  if (a.kind === 'event' && b.kind === 'event') return a.event.id - b.event.id;
  return 0;
}

export function sortTimelineChildrenForReading(items: RenderItem[]): RenderItem[] {
  return items.map(sortTimelineItemChildrenForReading).sort(compareTimelineChildrenForReading);
}

function sortTimelineItemChildrenForReading(item: RenderItem): RenderItem {
  if (
    item.kind === 'timeline-section' ||
    item.kind === 'run-group' ||
    item.kind === 'investigation-phase' ||
    item.kind === 'phase-group' ||
    item.kind === 'review-group'
  ) {
    return { ...item, items: sortTimelineChildrenForReading(item.items) };
  }
  return item;
}

export function collectRunIdsForTimelineSection(items: RenderItem[]): Set<string> {
  const runIds = new Set<string>();
  for (const item of items) {
    if (item.kind === 'run-group') runIds.add(item.runId);
    if (item.kind === 'event' && item.event.runId != null) runIds.add(item.event.runId);
    if (item.kind === 'log-group') {
      for (const event of item.events) {
        if (event.runId != null) runIds.add(event.runId);
      }
    }
    if (
      item.kind === 'timeline-section' ||
      item.kind === 'run-group' ||
      item.kind === 'investigation-phase' ||
      item.kind === 'phase-group' ||
      item.kind === 'review-group'
    ) {
      for (const runId of collectRunIdsForTimelineSection(item.items)) runIds.add(runId);
    }
  }
  return runIds;
}

export function eventFromRenderItem(item: RenderItem): AgentEventDto[] {
  if (item.kind === 'event') return [item.event];
  if (item.kind === 'timeline-section') return item.items.flatMap(eventFromRenderItem);
  if (item.kind === 'run-group') return item.items.flatMap(eventFromRenderItem);
  if (item.kind === 'investigation-phase') return item.items.flatMap(eventFromRenderItem);
  if (item.kind === 'phase-group') return item.items.flatMap(eventFromRenderItem);
  if (item.kind === 'review-group') return item.items.flatMap(eventFromRenderItem);
  if (item.kind === 'intervention-group') return [];
  return item.events;
}

export function itemStartedAt(item: RenderItem): string | null {
  if (item.kind === 'event') return item.event.createdAt;
  if (item.kind === 'log-group') return minEventTimestampIso(item.events);
  if (
    item.kind === 'timeline-section' ||
    item.kind === 'run-group' ||
    item.kind === 'investigation-phase' ||
    item.kind === 'phase-group' ||
    item.kind === 'review-group' ||
    item.kind === 'intervention-group'
  ) {
    return item.startedAt;
  }
  return null;
}

export function itemEndedAt(item: RenderItem): string | null {
  if (
    item.kind === 'timeline-section' ||
    item.kind === 'run-group' ||
    item.kind === 'investigation-phase' ||
    item.kind === 'phase-group' ||
    item.kind === 'review-group' ||
    item.kind === 'intervention-group'
  ) {
    return item.endedAt;
  }
  return null;
}

export function itemLastEventAt(item: RenderItem): string | null {
  if (item.kind === 'event') return item.event.createdAt;
  if (item.kind === 'log-group') return maxEventTimestampIso(item.events);
  if (
    item.kind === 'timeline-section' ||
    item.kind === 'run-group' ||
    item.kind === 'investigation-phase' ||
    item.kind === 'phase-group' ||
    item.kind === 'review-group' ||
    item.kind === 'intervention-group'
  ) {
    return item.lastEventAt;
  }
  return null;
}

function minEventTimestampIso(events: AgentEventDto[]): string | null {
  let minMs = Number.POSITIVE_INFINITY;
  let iso: string | null = null;
  for (const event of events) {
    const ms = new Date(event.createdAt).getTime();
    if (ms < minMs) {
      minMs = ms;
      iso = event.createdAt;
    }
  }
  return iso;
}

function maxEventTimestamp(events: AgentEventDto[]): number {
  let maxMs = Number.NEGATIVE_INFINITY;
  for (const event of events) {
    const ms = new Date(event.createdAt).getTime();
    if (ms > maxMs) maxMs = ms;
  }
  return maxMs === Number.NEGATIVE_INFINITY ? 0 : maxMs;
}

function maxEventTimestampIso(events: AgentEventDto[]): string | null {
  let maxMs = Number.NEGATIVE_INFINITY;
  let iso: string | null = null;
  for (const event of events) {
    const ms = new Date(event.createdAt).getTime();
    if (ms > maxMs) {
      maxMs = ms;
      iso = event.createdAt;
    }
  }
  return iso;
}

export function extractTimelineSectionTimes(items: RenderItem[]): {
  startedAt: string | null;
  endedAt: string | null;
  lastEventAt: string | null;
} {
  let earliestMs = Number.POSITIVE_INFINITY;
  let latestMs = Number.NEGATIVE_INFINITY;
  let endedMs = Number.NEGATIVE_INFINITY;
  let startedAt: string | null = null;
  let endedAt: string | null = null;
  let lastEventAt: string | null = null;

  for (const item of items) {
    const start = itemStartedAt(item);
    if (start != null) {
      const ms = new Date(start).getTime();
      if (ms < earliestMs) {
        earliestMs = ms;
        startedAt = start;
      }
    }

    const last = itemLastEventAt(item);
    if (last != null) {
      const ms = new Date(last).getTime();
      if (ms > latestMs) {
        latestMs = ms;
        lastEventAt = last;
      }
    }

    const end = itemEndedAt(item);
    if (end != null) {
      const ms = new Date(end).getTime();
      if (ms > endedMs) {
        endedMs = ms;
        endedAt = end;
      }
    }
  }

  return { startedAt, endedAt, lastEventAt };
}

export function extractPhaseTimes(items: RenderItem[]): {
  startedAt: string | null;
  endedAt: string | null;
  lastEventAt: string | null;
} {
  let earliestMs = Number.POSITIVE_INFINITY;
  let latestMs = Number.NEGATIVE_INFINITY;
  let startedAt: string | null = null;
  let endedAt: string | null = null;
  let lastEventAt: string | null = null;

  for (const event of items.flatMap(eventFromRenderItem)) {
    const ms = new Date(event.createdAt).getTime();
    if (ms < earliestMs) {
      earliestMs = ms;
      startedAt = event.createdAt;
    }
    if (ms > latestMs) {
      latestMs = ms;
      lastEventAt = event.createdAt;
    }
    if (
      event.kind === 'agent.investigation-complete' ||
      event.kind === 'agent.run-completed' ||
      event.kind === 'agent.run-failed' ||
      event.kind === 'parallel-implement.wp-terminal-blocked' ||
      event.kind === 'swarm.wave-halted'
    ) {
      if (endedAt == null || ms > new Date(endedAt).getTime()) endedAt = event.createdAt;
    }
  }

  return { startedAt, endedAt, lastEventAt };
}

export function hasLiveRunGroup(item: RenderItem): boolean {
  if (item.kind !== 'run-group') return false;
  return item.endedAt == null;
}
