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
  'agent.disclosure': 'Input summarized',
  'agent.terminated': 'Agent terminated',
  'agent.log': 'Agent log',
  'gate.awaiting-human': 'Gate — awaiting human',
  'system.note': 'Note',
  'manual.action': 'Manual action',
  'agent.run-started': 'Agent run started',
  'agent.run-completed': 'Agent run completed',
  'agent.run-failed': 'Agent run failed',
  'agent.budget-exceeded': 'Agent budget exceeded',
  'agent.tool-call': 'Tool call',
  'agent.tool-result': 'Tool result (error)',
  'tool.stdout-truncated': 'Stdout truncated',
  'tool.timeout': 'Timeout',
  'agent.fallback-triggered': 'Fallback triggered',
  'agent.triage-complete': 'Triage complete',
  'agent.investigation-complete': 'Investigation complete',
  'agent.investigation-context-injected': 'Investigation context injected',
  'agent.wrong-surface-guard': 'Wrong surface guard',
  'symbol-index.hints-used': 'Symbol hints used',
  'agent.implement-complete': 'Implement complete',
  'agent.fix-feedback-complete': 'Fix feedback complete',
  'agent.retry-escalated': 'Retry escalated',
  'pr.opened': 'PR opened',
  'pr.merged': 'PR merged',
  'gate.approved': 'Gate approved',
  'gate.rejected': 'Gate rejected',
  'review.completed': 'Review completed',
  'evidence.no-spec-declared': 'Evidence — no spec declared',
  'evidence.playwright-repro-skipped': 'Playwright repro skipped',
  'evidence.playwright-ran': 'Playwright evidence ran',
  'evidence.posted': 'Evidence posted',
  'evidence.post-skipped': 'Evidence post skipped',
  'evidence.post-failed': 'Evidence post failed',
  'agent.verify-command': 'Verify command',
  'qa.completed': 'QA completed',
  'qa.structural-passed': 'QA structural passed',
  'qa.structural-failed': 'QA structural failed',
  'qa.functional-passed': 'QA functional passed',
  'qa.functional-failed': 'QA functional failed',
  'qa.regression-passed': 'QA regression passed',
  'qa.regression-failed': 'QA regression failed',
  'qa.verification-summary-built': 'QA verification summary built',
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
  'dev-review.started': 'Dev review started',
  'dev-review.completed': 'Dev review completed',
  'dev-review.failed': 'Dev review failed',
  'dev-review.error': 'Dev review error',
  'dev-review.budget-skipped': 'Dev review budget skipped',
  'dev-review.response-started': 'Dev review response started',
  'dev-review.response-completed': 'Dev review response completed',
  'dev-review.response-failed': 'Dev review response failed',
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
      modelId: string | null;
      runtime: string | null;
    }
  | {
      kind: 'investigation-phase';
      investigationRunId: string;
      items: RenderItem[];
      status: 'started' | 'live' | 'completed' | 'failed';
      startedAt: string | null;
      endedAt: string | null;
      lastEventAt: string | null;
    }
  | {
      kind: 'phase-group';
      phase: 'dev';
      pipelineRunId: string;
      items: RenderItem[];
      status: 'started' | 'live' | 'completed' | 'failed';
      startedAt: string | null;
      endedAt: string | null;
      lastEventAt: string | null;
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
  if (item.kind === 'investigation-phase') {
    return new Date(item.lastEventAt ?? item.startedAt ?? 0).getTime();
  }
  if (item.kind === 'event') return new Date(item.event.createdAt).getTime();
  if (item.kind === 'phase-group') return new Date(item.startedAt ?? 0).getTime();
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

export function groupByDevPhase(items: RenderItem[]): RenderItem[] {
  const pipelines = new Set<string>();

  function findSpecCompleted(renderItems: RenderItem[]): void {
    for (const item of renderItems) {
      if (item.kind === 'event' && item.event.kind === 'spec.completed') {
        const p = item.event.payload as { pipelineRunId?: string } | null;
        if (p?.pipelineRunId != null) pipelines.add(p.pipelineRunId);
      } else if (item.kind === 'run-group') {
        findSpecCompleted(item.items);
      }
    }
  }

  findSpecCompleted(items);

  if (pipelines.size === 0) return items;

  function resolvedPipelineId(item: RenderItem): string | null {
    if (item.kind === 'run-group') {
      if (pipelines.has(item.runId)) return item.runId;
      for (const pid of pipelines) {
        if (item.runId.startsWith(`${pid}:wp:`) || item.runId.startsWith(`${pid}:dev-review`)) {
          return pid;
        }
      }
      for (const event of eventFromRenderItem(item)) {
        const p = event.payload as { pipelineRunId?: string } | null;
        if (p?.pipelineRunId != null && pipelines.has(p.pipelineRunId)) return p.pipelineRunId;
      }
      return null;
    }
    if (item.kind === 'event') {
      const p = item.event.payload as { pipelineRunId?: string } | null;
      if (p?.pipelineRunId != null && pipelines.has(p.pipelineRunId)) return p.pipelineRunId;
      return null;
    }
    return null;
  }

  const pipelineItems = new Map<string, RenderItem[]>();
  for (const pid of pipelines) pipelineItems.set(pid, []);

  const ungrouped: RenderItem[] = [];
  for (const item of items) {
    const pid = resolvedPipelineId(item);
    if (pid != null) {
      pipelineItems.get(pid)?.push(item);
    } else {
      ungrouped.push(item);
    }
  }

  const phaseGroups: RenderItem[] = [];
  for (const [pid, phaseItemList] of pipelineItems) {
    if (phaseItemList.length === 0) continue;
    const times = extractPhaseTimes(phaseItemList);
    phaseGroups.push({
      kind: 'phase-group',
      phase: 'dev',
      pipelineRunId: pid,
      items: phaseItemList,
      status: resolveDevPhaseStatus(pid, phaseItemList),
      ...times,
    });
  }

  return [...ungrouped, ...phaseGroups].sort(compareRenderItems);
}

export function groupEvents(events: AgentEventDto[]): RenderItem[] {
  const collapsed = collapseLogRuns(events.filter((event) => !isNoisyCodexStderrLog(event)));
  const grouped = groupByRunId(collapsed);
  const withInvestigationPhases = groupByInvestigationPhase([...grouped].sort(compareRenderItems));
  const withDevPhases = groupByDevPhase([...withInvestigationPhases].sort(compareRenderItems));
  return withDevPhases;
}

function isNoisyCodexStderrLog(event: AgentEventDto): boolean {
  if (event.kind !== 'agent.log') return false;
  const payload = event.payload as { stream?: string; text?: string } | null;
  return payload?.stream === 'stderr' && payload.text === 'Reading additional input from stdin...';
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
  modelId: string | null;
  runtime: string | null;
} {
  let skill: string | null = null;
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
    const p = ev.payload as { modelId?: string; runtime?: string; skill?: string } | null;

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
    if (modelId == null && p?.modelId != null) modelId = p.modelId;
    if (runtime == null && p?.runtime != null) runtime = p.runtime;

    if (ev.kind === 'agent.run-started') {
      if (startedAt == null) startedAt = ev.createdAt;
    } else if (ev.kind === 'agent.run-completed') {
      if (endedAt == null) endedAt = ev.createdAt;
    } else if (ev.kind === 'agent.run-failed') {
      if (endedAt == null) endedAt = ev.createdAt;
    } else if (ev.kind === 'agent.investigation-complete') {
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

function getRenderItemRunId(item: RenderItem): string | null {
  if (item.kind === 'run-group') return item.runId;
  if (item.kind === 'event') return item.event.runId ?? null;
  return null;
}

function getInvestigationChildParentRunId(item: RenderItem): string | null {
  const runId = getRenderItemRunId(item);
  if (runId == null) return null;
  const marker = ':scout:';
  const markerIndex = runId.indexOf(marker);
  if (markerIndex <= 0) return null;
  return runId.slice(0, markerIndex);
}

function isInvestigationParentItem(item: RenderItem): boolean {
  if (item.kind === 'run-group') return item.skill === 'investigate';
  if (item.kind !== 'event') return false;
  const payload = item.event.payload as { skill?: string } | null;
  return item.event.kind === 'agent.run-started' && payload?.skill === 'investigate';
}

function eventFromRenderItem(item: RenderItem): AgentEventDto[] {
  if (item.kind === 'event') return [item.event];
  if (item.kind === 'run-group') return item.items.flatMap(eventFromRenderItem);
  if (item.kind === 'investigation-phase') return item.items.flatMap(eventFromRenderItem);
  if (item.kind === 'phase-group') return item.items.flatMap(eventFromRenderItem);
  return item.events;
}

function extractPhaseTimes(items: RenderItem[]): {
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
      event.kind === 'swarm.wave-halted'
    ) {
      if (endedAt == null || ms > new Date(endedAt).getTime()) endedAt = event.createdAt;
    }
  }

  return { startedAt, endedAt, lastEventAt };
}

function hasLiveRunGroup(item: RenderItem): boolean {
  if (item.kind !== 'run-group') return false;
  return item.endedAt == null;
}

function resolveDevPhaseStatus(
  pipelineRunId: string,
  items: RenderItem[],
): 'started' | 'live' | 'completed' | 'failed' {
  const events = items.flatMap(eventFromRenderItem);
  const hasFailure = events.some((event) => {
    const payload = event.payload as {
      pipelineRunId?: string;
      to?: string;
      toState?: string;
    } | null;
    return (
      event.kind === 'parallel-implement.exhausted' ||
      event.kind === 'parallel-implement.wp-failed' ||
      event.kind === 'parallel-implement.wp-timeout' ||
      event.kind === 'parallel-implement.wp-commit-failed' ||
      event.kind === 'dev-review.failed' ||
      event.kind === 'dev-review.error' ||
      (event.kind === 'agent.run-failed' &&
        (event.runId === pipelineRunId || payload?.pipelineRunId === pipelineRunId)) ||
      (event.kind === 'state.transitioned' &&
        (payload?.to === 'factory:needs-human' || payload?.toState === 'factory:needs-human'))
    );
  });
  if (hasFailure) return 'failed';

  const hasCompletion = events.some((event) => {
    const payload = event.payload as {
      pipelineRunId?: string;
      to?: string;
      toState?: string;
    } | null;
    return (
      event.kind === 'pr.opened' ||
      (event.kind === 'state.transitioned' &&
        (payload?.to === 'factory:needs-qa' || payload?.toState === 'factory:needs-qa')) ||
      event.kind === 'dev-review.completed'
    );
  });
  if (hasCompletion) return 'completed';

  if (items.some(hasLiveRunGroup)) return 'live';

  const hasParallelActivity = events.some(
    (event) => event.kind.startsWith('parallel-implement.') || event.kind.startsWith('dev-review.'),
  );
  return hasParallelActivity ? 'live' : 'started';
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
    }

    if (phaseRunId != null) {
      phaseItems.get(phaseRunId)?.push(item);
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
