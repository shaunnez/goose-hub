import { fetchMilestones, setLabel, setMilestone } from '@/lib/api';
import { PRIORITY_BG, PRIORITY_BORDER, PRIORITY_COLOR, STATE_LABEL } from '@/lib/constants';
import { parseDependencies } from '@/lib/dependency-parser';
import { laneForState } from '@/lib/lanes.config';
import type { AgentEventDto, MilestoneDto, WorkItemDto } from '@/lib/types';
import { getPersonaLabel, usePersonaMap } from '@/lib/usePersonaMap';
import { formatCost, formatTokens } from '@/lib/utils';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { useIssueCostsBreakdown } from '../lib/costs';
import { MoveToCurrentDialog } from './MoveToCurrentDialog';
import { PillSelect } from './PillSelect';
import { TransitionButton } from './TransitionButton';

interface TaskHeaderProps {
  item?: WorkItemDto;
  projectSlug: string;
  hasOpenDep?: boolean;
  events?: AgentEventDto[];
}

function formatCacheHit(ratio: number): string {
  if (!Number.isFinite(ratio)) return '—';
  return `${Math.round(ratio * 100)}%`;
}

function eventTimeMs(event: AgentEventDto): number {
  const ms = new Date(event.createdAt).getTime();
  return Number.isFinite(ms) ? ms : Number.NaN;
}

function timestampMs(value?: string | null): number {
  if (value == null || value === '') return Number.NaN;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : Number.NaN;
}

function eventPipelineCompletedMs(events: AgentEventDto[]): number | null {
  const reviewCompletedMs = events
    .filter((event) => {
      if (event.kind !== 'review.completed') return false;
      const verdict = (event.payload as { verdict?: string } | null)?.verdict;
      return verdict !== 'needs-fix';
    })
    .map(eventTimeMs)
    .filter(Number.isFinite)
    .sort((a, b) => a - b)
    .at(-1);
  if (reviewCompletedMs != null) return reviewCompletedMs;

  const fallbackTerminalMs = events
    .filter((event) =>
      [
        'qa.completed',
        'qa.verification-blocked',
        'dev-review.completed',
        'dev-review.failed',
        'parallel-implement.exhausted',
        'parallel-implement.wp-terminal-blocked',
        'pr.opened',
        'agent.run-failed',
      ].includes(event.kind),
    )
    .map(eventTimeMs)
    .filter(Number.isFinite)
    .sort((a, b) => a - b)
    .at(-1);
  return fallbackTerminalMs ?? null;
}

function formatFixDuration(item: WorkItemDto | undefined, events: AgentEventDto[]): string {
  const itemCompletedMs = timestampMs(item?.pipelineCompletedAt);
  const eventCompletedMs = eventPipelineCompletedMs(events);
  const endMs =
    Number.isFinite(itemCompletedMs) || eventCompletedMs != null
      ? Math.max(Number.isFinite(itemCompletedMs) ? itemCompletedMs : 0, eventCompletedMs ?? 0)
      : Date.now();

  const itemStartedMs = timestampMs(item?.pipelineStartedAt);
  const eventStartedMs = events
    .filter((event) => event.kind === 'agent.run-started')
    .map(eventTimeMs)
    .filter((ms) => Number.isFinite(ms) && ms <= endMs)
    .sort((a, b) => a - b)
    .at(0);
  const startMs =
    Number.isFinite(itemStartedMs) && eventStartedMs != null
      ? Math.min(itemStartedMs, eventStartedMs)
      : Number.isFinite(itemStartedMs)
        ? itemStartedMs
        : eventStartedMs;
  if (startMs == null) return '—';

  const minutes = Math.max(0, Math.floor((endMs - startMs) / 60000));
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 48) return remainingMinutes === 0 ? `${hours}h` : `${hours}h ${remainingMinutes}m`;

  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours === 0 ? `${days}d` : `${days}d ${remainingHours}h`;
}

export function TaskHeader({
  item,
  projectSlug,
  hasOpenDep = false,
  events = [],
}: TaskHeaderProps) {
  const queryClient = useQueryClient();
  const [savingPriority, setSavingPriority] = useState(false);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [savingMilestone, setSavingMilestone] = useState(false);
  const [showMoveDialog, setShowMoveDialog] = useState(false);

  const { data: milestones = [] } = useQuery<MilestoneDto[]>({
    queryKey: ['milestones', projectSlug],
    queryFn: () => fetchMilestones(projectSlug),
    enabled: item != null,
  });

  const personaMap = usePersonaMap();
  const costs = useIssueCostsBreakdown(projectSlug, item?.externalId ?? '');

  const lane = item?.state ? (laneForState(item.state) ?? item.state.replace('factory:', '')) : '—';
  const lastPersonaLabel = getPersonaLabel(personaMap, item?.lastPersonaId) ?? '—';
  const costTitle =
    costs.runCount === 0
      ? 'No agent runs recorded yet'
      : [
          `${formatTokens(costs.totalTokens)} tokens`,
          `${formatTokens(costs.totalCachedInputTokens)} cached input tokens`,
          `${formatCacheHit(costs.totalCacheHitRatio)} cache hit`,
          `${costs.runCount} run${costs.runCount === 1 ? '' : 's'}`,
        ].join(' · ');
  const costValue = costs.runCount === 0 ? '$—' : formatCost(costs.total, costs.totalLabel);
  const tokenValue = costs.runCount === 0 ? '—' : formatTokens(costs.totalTokens);
  const cachedTokenValue = costs.runCount === 0 ? '—' : formatTokens(costs.totalCachedInputTokens);
  const cacheHitValue = costs.runCount === 0 ? '—' : formatCacheHit(costs.totalCacheHitRatio);
  const fixDuration = formatFixDuration(item, events);

  const externalId = item?.externalId;
  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['issue', projectSlug, externalId] });
    void queryClient.invalidateQueries({ queryKey: ['issues', projectSlug] });
  }, [queryClient, projectSlug, externalId]);

  const onPriority = async (value: string) => {
    if (!item) return;
    setSavingPriority(true);
    try {
      await setLabel(projectSlug, item.externalId, 'priority', value);
      invalidate();
    } finally {
      setSavingPriority(false);
    }
  };

  const onSchedule = async (value: string) => {
    if (!item) return;

    // When moving to schedule:current, check for open deps first.
    // If the item has any `depends-on` entries, open the dialog which either
    // auto-proceeds (all deps already satisfied) or presents a checkbox list.
    if (value === 'current') {
      const hasDeps =
        parseDependencies(item.body).filter((d) => d.type === 'depends-on').length > 0;
      if (hasDeps) {
        setShowMoveDialog(true);
        return;
      }
    }

    setSavingSchedule(true);
    try {
      await setLabel(projectSlug, item.externalId, 'schedule', value);
      invalidate();
    } finally {
      setSavingSchedule(false);
    }
  };

  const onMilestone = async (value: string) => {
    if (!item) return;
    setSavingMilestone(true);
    try {
      const num = value === 'none' ? null : Number(value);
      await setMilestone(projectSlug, item.externalId, num);
      invalidate();
    } finally {
      setSavingMilestone(false);
    }
  };

  const priorityColor = PRIORITY_COLOR[item?.priority ?? ''] ?? 'var(--fg-3)';
  const priorityBg = PRIORITY_BG[item?.priority ?? ''] ?? 'oklch(0.42 0.01 260 / 0.12)';
  const priorityBorder = PRIORITY_BORDER[item?.priority ?? ''] ?? 'oklch(0.42 0.01 260 / 0.4)';

  const milestoneOptions = [
    { value: 'none', label: 'No milestone' },
    ...milestones.map((m) => ({ value: String(m.number), label: m.title })),
  ];

  const currentMilestoneLabel =
    milestones.find((m) => String(m.number) === item?.milestoneId)?.title ??
    (item?.milestoneId != null ? `#${item.milestoneId}` : 'milestone');

  return (
    <>
      <div data-testid="task-header" className="px-6 py-4 border-b border-line bg-bg-elev shrink-0">
        <div className="flex items-start gap-4">
          <div className="flex flex-col grow min-w-0">
            <h1 className="text-[22px] font-semibold tracking-tight leading-tight text-fg">
              {item?.title}
            </h1>
            <div className="text-[12.5px] text-fg-3 mt-1">
              {lane} · {lastPersonaLabel}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 mt-3 text-[11.5px] text-fg-3 flex-wrap">
          <span>by {item?.authorIsOwner ? 'owner' : 'guest'}</span>
          <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
          <span>opened {item?.createdAt ? new Date(item?.createdAt).toLocaleString() : ''}</span>
          <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
          <span data-testid="task-header-cost">
            cost{' '}
            <span className="font-mono" title={costTitle}>
              {costValue}
            </span>
          </span>
          <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
          <span data-testid="task-header-tokens">
            tokens{' '}
            <span className="font-mono" title={costTitle}>
              {tokenValue}
            </span>
          </span>
          <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
          <span data-testid="task-header-cached-tokens">
            cached{' '}
            <span className="font-mono" title={costTitle}>
              {cachedTokenValue}
            </span>
          </span>
          <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
          <span data-testid="task-header-cache-hit">
            cache hit{' '}
            <span className="font-mono" title={costTitle}>
              {cacheHitValue}
            </span>
          </span>
          <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
          <span
            title="Elapsed time from the first agent run to review completion or the current pipeline point"
            data-testid="task-header-fix-duration"
          >
            fix duration <span className="font-mono">{fixDuration}</span>
          </span>
          {/* Type — static, leftmost */}
          <span className="inline-flex items-center h-6 px-2.5 rounded-full text-[11.5px] bg-bg-elev border border-line text-fg-2 capitalize">
            {item?.type}
          </span>

          <div className="flex grow" />
          {hasOpenDep && (
            <span
              data-testid="blocked-badge"
              className="inline-flex items-center h-6 px-2.5 rounded-full text-[11.5px] border font-medium"
              style={{
                color: 'var(--warning)',
                background: 'oklch(from var(--warning) l c h / 0.12)',
                borderColor: 'oklch(from var(--warning) l c h / 0.4)',
              }}
            >
              Blocked
            </span>
          )}
          {/* State — static accent pill */}
          <span
            data-testid="state-pill"
            className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-[11.5px] bg-accent-soft border border-accent-line text-fg"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
            <span className="font-medium">
              {item?.state ? (STATE_LABEL[item?.state] ?? item?.state) : ''}
            </span>
          </span>

          {/* Priority — pill select */}
          {item && (
            <PillSelect
              data-testid="priority-pill"
              value={item.priority}
              label="priority"
              saving={savingPriority}
              pillStyle={{
                color: priorityColor,
                background: priorityBg,
                borderColor: priorityBorder,
              }}
              options={[
                { value: 'low', label: 'low' },
                { value: 'medium', label: 'medium' },
                { value: 'high', label: 'high' },
                { value: 'critical', label: 'critical' },
              ]}
              onSelect={(v) => void onPriority(v)}
            />
          )}

          {/* Schedule — pill select */}
          {item && (
            <PillSelect
              data-testid="schedule-pill"
              value={item.schedule}
              label="schedule"
              saving={savingSchedule}
              pillStyle={{
                color: 'var(--fg-2)',
                background: 'var(--bg-elev)',
                borderColor: 'var(--line)',
              }}
              options={[
                { value: 'current', label: 'current' },
                { value: 'backlog', label: 'backlog' },
                { value: 'icebox', label: 'icebox' },
              ]}
              onSelect={(v) => void onSchedule(v)}
            />
          )}

          {/* Milestone — pill select */}
          {item && milestones.length > 0 && (
            <PillSelect
              data-testid="milestone-pill"
              value={currentMilestoneLabel}
              label="milestone"
              saving={savingMilestone}
              pillStyle={{
                color: 'var(--fg-2)',
                background: 'var(--bg-elev)',
                borderColor: 'var(--line)',
              }}
              options={milestoneOptions}
              onSelect={(v) => void onMilestone(v)}
            />
          )}

          {item && (
            <TransitionButton
              projectSlug={projectSlug}
              id={item?.externalId}
              currentState={item?.state}
            />
          )}
        </div>
      </div>

      {showMoveDialog && item && (
        <MoveToCurrentDialog
          item={item}
          projectSlug={projectSlug}
          onComplete={() => {
            setShowMoveDialog(false);
            invalidate();
          }}
          onCancel={() => setShowMoveDialog(false)}
        />
      )}
    </>
  );
}
