import type { AgentEventDto, CostRowDto } from '@/lib/types';

export type TimelineContext = {
  slug: string;
  issueId: string;
  latestRunId: string | null;
  runCosts?: Map<string, CostRowDto>;
  /** Monotonic tick that increments each time the user clicks expand/collapse all. */
  expandSignal?: { tick: number; open: boolean };
};

// ─── display helpers ──────────────────────────────────────────────────────────

/**
 * Maps event-kind strings (`agent.run-started`, `state.transitioned`, …) to
 * human-readable labels. Doubles as the canonical list of event kinds the
 * timeline renders — `Object.keys(EVENT_KIND_LABEL)` is what the SSE listener
 * subscribes to.
 *
 * NOTE: this is event-kind labelling. `STATE_LABEL` in `@/lib/constants`
 * separately maps `factory:*` work-item state names; keep them apart.
 */
export const EVENT_KIND_LABEL: Record<string, string> = {
  'state.transitioned': 'State transitioned',
  'milestone.activated': 'Milestone activated',
  'agent.spawned': 'Agent spawned',
  'agent.decision-summary': 'Decision summary',
  'agent.decision-summary-live': 'Decision (live)',
  'agent.terminated': 'Agent terminated',
  'agent.log': 'Agent log',
  'gate.awaiting-human': 'Gate — awaiting human',
  'system.note': 'Note',
  'manual.action': 'Manual action',
  'agent.run-started': 'Agent run started',
  'agent.run-completed': 'Agent run completed',
  'agent.run-failed': 'Agent run failed',
  'agent.tool-call': 'Tool call',
  'agent.tool-result': 'Tool result (error)',
  'tool.stdout-truncated': 'Stdout truncated',
  'tool.timeout': 'Timeout',
  'agent.fallback-triggered': 'Fallback triggered',
  'agent.triage-complete': 'Triage complete',
  'agent.investigation-complete': 'Investigation complete',
  'agent.implement-complete': 'Implement complete',
  'pr.opened': 'PR opened',
  'pr.merged': 'PR merged',
  'gate.approved': 'Gate approved',
  'gate.rejected': 'Gate rejected',
  'review.completed': 'Review completed',
  'evidence.no-spec-declared': 'Evidence — no spec declared',
  'evidence.posted': 'Evidence posted',
  'evidence.post-failed': 'Evidence post failed',
  'agent.verify-command': 'Verify command',
  'qa.completed': 'QA completed',
  'qa.structural-failed': 'QA structural failed',
  'qa.functional-failed': 'QA functional failed',
  'qa.regression-failed': 'QA regression failed',
  'retrospective.completed': 'Retrospective completed',
  'grill.question-posted': 'Grill question posted',
  'grill.completed': 'Grill completed',
  'prd.drafted': 'PRD drafted',
  'prd.advisor-skipped': 'Advisor skipped',
  'prd.approved': 'PRD approved',
  'prd.rejected': 'PRD rejected',
  'prd.revised': 'PRD revision requested',
  'prd.declined': 'Feature declined',
  'decompose.completed': 'Decompose complete',
  'spec.completed': 'Spec authored',
  'agent.model-selected': 'Model selected',
  'swarm.heartbeat': 'Swarm heartbeat',
  'swarm.scout-completed': 'Scout completed',
  'swarm.scout-failed': 'Scout failed',
  'swarm.scout-timeout': 'Scout timeout',
  'swarm.wave-completed': 'Wave completed',
  'swarm.wave-halted': 'Wave halted',
  'swarm.wave-incomplete': 'Wave incomplete',
  'parallel-implement.iteration-started': 'Parallel iteration started',
  'parallel-implement.wp-started': 'Work package started',
  'parallel-implement.wp-committed': 'Work package committed',
  'parallel-implement.wp-failed': 'Work package failed',
  'parallel-implement.wp-timeout': 'Work package timed out',
  'parallel-implement.wp-commit-failed': 'Work package commit failed',
  'parallel-implement.exhausted': 'Parallel implement exhausted',
};

export function formatSkillName(skill: string | null): string {
  if (skill == null) return '(Unknown)';
  return skill
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function getPayloadStr(payload: unknown): string {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload ?? {});
  return text.length <= 80 ? text : `${text.slice(0, 79)}…`;
}

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
      lastEventAt: string | null;
      personaId: string | null;
    };

/**
 * Pre-processes an events array for rendering.
 * - Consecutive `agent.log` events (4+) → collapsible log-group
 * - Events sharing the same runId are grouped into a run-group
 */
function effectiveTimestamp(item: RenderItem): number {
  if (item.kind === 'run-group') {
    return new Date(item.lastEventAt ?? item.startedAt ?? 0).getTime();
  }
  if (item.kind === 'event') return new Date(item.event.createdAt).getTime();
  return new Date(item.events[0]?.createdAt ?? 0).getTime();
}

function optionalTimestamp(value: string | null): number {
  return value == null ? 0 : new Date(value).getTime();
}

function compareRenderItems(a: RenderItem, b: RenderItem): number {
  const activityDelta = effectiveTimestamp(b) - effectiveTimestamp(a);
  if (activityDelta !== 0) return activityDelta;

  if (a.kind === 'run-group' && b.kind === 'run-group') {
    const startedDelta = optionalTimestamp(a.startedAt) - optionalTimestamp(b.startedAt);
    if (startedDelta !== 0) return startedDelta;
    return a.runId.localeCompare(b.runId);
  }

  return 0;
}

export function groupEvents(events: AgentEventDto[]): RenderItem[] {
  const collapsed = collapseLogRuns(events);
  const grouped = groupByRunId(collapsed);
  return [...grouped].sort(compareRenderItems);
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
  lastEventAt: string | null;
  personaId: string | null;
} {
  let skill: string | null = null;
  let startedAt: string | null = null;
  let endedAt: string | null = null;
  let personaId: string | null = null;
  let earliestMs = Number.POSITIVE_INFINITY;
  let earliestIso: string | null = null;
  let latestMs = Number.NEGATIVE_INFINITY;
  let latestIso: string | null = null;

  for (const item of items) {
    if (item.kind !== 'event') continue;
    const ev = item.event;
    const p = ev.payload as { skill?: string } | null;

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

    if (skill == null && p?.skill != null) skill = p.skill as string;

    if (ev.kind === 'agent.run-started') {
      if (startedAt == null) startedAt = ev.createdAt;
    } else if (ev.kind === 'agent.run-completed') {
      if (endedAt == null) endedAt = ev.createdAt;
    } else if (ev.kind === 'agent.run-failed') {
      if (endedAt == null) endedAt = ev.createdAt;
    } else if (ev.kind === 'retrospective.completed') {
      // retrospective runs don't always emit agent.run-completed; treat this as terminal
      if (endedAt == null) endedAt = ev.createdAt;
    } else if (ev.kind === 'prd.approved' || ev.kind === 'prd.rejected') {
      if (endedAt == null) endedAt = ev.createdAt;
    } else if (ev.kind === 'grill.question-posted' || ev.kind === 'grill.completed') {
      // grill-me runs don't emit agent.run-completed — these are the terminal events
      if (endedAt == null) endedAt = ev.createdAt;
    } else if (ev.kind === 'decompose.completed') {
      if (endedAt == null) endedAt = ev.createdAt;
    }
  }

  return { skill, startedAt: startedAt ?? earliestIso, endedAt, lastEventAt: latestIso, personaId };
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

// ─── run-state detection ─────────────────────────────────────────────────────

const TERMINAL_EVENTS = new Set([
  'agent.run-completed',
  'agent.run-failed',
  'grill.question-posted',
  'grill.completed',
  'decompose.completed',
  'retrospective.completed',
  'prd.drafted',
]);

export function computeIsLive(events: AgentEventDto[]): boolean {
  const sorted = [...events].sort((a, b) => a.id - b.id);
  let lastStartedIdx = -1;
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].kind === 'agent.run-started') lastStartedIdx = i;
  }
  if (lastStartedIdx === -1) return false;
  for (let i = lastStartedIdx + 1; i < sorted.length; i++) {
    if (TERMINAL_EVENTS.has(sorted[i].kind)) return false;
  }
  return true;
}

export function computeIsWritePrdStuck(events: AgentEventDto[]): boolean {
  const hasWritePrdCompleted = events.some(
    (e) =>
      e.kind === 'agent.run-completed' &&
      (e.payload as { skill?: string } | null)?.skill === 'write-prd',
  );
  if (!hasWritePrdCompleted) return false;
  const hasPrdDrafted = events.some((e) => e.kind === 'prd.drafted');
  if (hasPrdDrafted) return false;
  return !computeIsLive(events);
}
