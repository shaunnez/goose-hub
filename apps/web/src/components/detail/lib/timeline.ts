import type { AgentEventDto } from '@/lib/types';

// ─── grouping ────────────────────────────────────────────────────────────────

export type RenderItem =
  | { kind: 'event'; event: AgentEventDto }
  | { kind: 'log-group'; events: AgentEventDto[] }
  | {
      kind: 'run-group';
      runId: string;
      items: RenderItem[];
      skill: string | null;
      startedAt: string | null;
      endedAt: string | null;
    };

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

function extractRunMeta(items: RenderItem[]): {
  skill: string | null;
  startedAt: string | null;
  endedAt: string | null;
} {
  let skill: string | null = null;
  let startedAt: string | null = null;
  let endedAt: string | null = null;
  let earliestMs = Number.POSITIVE_INFINITY;
  let earliestIso: string | null = null;

  for (const item of items) {
    if (item.kind !== 'event') continue;
    const ev = item.event;
    const p = ev.payload as { skill?: string } | null;

    const ms = new Date(ev.createdAt).getTime();
    if (ms < earliestMs) {
      earliestMs = ms;
      earliestIso = ev.createdAt;
    }

    if (ev.kind === 'agent.run-started') {
      if (startedAt == null) startedAt = ev.createdAt;
      if (skill == null && p?.skill != null) skill = p.skill;
    } else if (ev.kind === 'agent.spawned') {
      if (skill == null && p?.skill != null) skill = p.skill;
    } else if (ev.kind === 'agent.run-completed') {
      if (skill == null && p?.skill != null) skill = p.skill;
      if (endedAt == null) endedAt = ev.createdAt;
    } else if (ev.kind === 'agent.run-failed') {
      if (endedAt == null) endedAt = ev.createdAt;
    }
  }

  return { skill, startedAt: startedAt ?? earliestIso, endedAt };
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
