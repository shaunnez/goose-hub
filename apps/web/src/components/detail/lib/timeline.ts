import type { AgentEventDto } from '@/lib/types';

// ─── grouping ────────────────────────────────────────────────────────────────

export type RenderItem =
  | { kind: 'event'; event: AgentEventDto }
  | { kind: 'log-group'; events: AgentEventDto[] }
  | { kind: 'run-group'; runId: string; items: RenderItem[] };

/**
 * Pre-processes an events array for rendering.
 * - Consecutive `agent.log` events (4+) → collapsible log-group
 * - Events sharing the same runId are grouped into a run-group
 */
export function groupEvents(events: AgentEventDto[]): RenderItem[] {
  // First pass: collapse consecutive agent.log runs
  const collapsed = collapseLogRuns(events);
  // Second pass: group by runId
  return groupByRunId(collapsed);
}

function collapseLogRuns(events: AgentEventDto[]): RenderItem[] {
  const items: RenderItem[] = [];
  let i = 0;
  while (i < events.length) {
    if (events[i].kind === 'agent.log') {
      const group: AgentEventDto[] = [];
      while (i < events.length && events[i].kind === 'agent.log') {
        group.push(events[i]);
        i++;
      }
      if (group.length >= 4) {
        items.push({ kind: 'log-group', events: group });
      } else {
        for (const ev of group) {
          items.push({ kind: 'event', event: ev });
        }
      }
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

function groupByRunId(items: RenderItem[]): RenderItem[] {
  // Pass 1: collect all items per runId (order preserved).
  const byRunId = new Map<string, RenderItem[]>();
  for (const item of items) {
    const runId = getRunId(item);
    if (runId != null) {
      const group = byRunId.get(runId) ?? [];
      group.push(item);
      byRunId.set(runId, group);
    }
  }

  // Pass 2: walk original list; emit full group on first occurrence, skip rest.
  const seen = new Set<string>();
  const result: RenderItem[] = [];
  for (const item of items) {
    const runId = getRunId(item);
    if (runId != null) {
      if (seen.has(runId)) continue;
      seen.add(runId);
      const group = byRunId.get(runId) ?? [];
      if (group.length > 1) {
        result.push({ kind: 'run-group', runId, items: group });
      } else {
        result.push(...group);
      }
    } else {
      result.push(item);
    }
  }
  return result;
}
