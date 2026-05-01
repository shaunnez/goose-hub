import { fetchMilestones, setLabel, setMilestone } from '@/lib/api';
import { cn } from '@/lib/cn';
import { PRIORITY_BG, PRIORITY_BORDER, PRIORITY_COLOR, STATE_LABEL } from '@/lib/constants';
import type { MilestoneDto, WorkItemDto } from '@/lib/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { TransitionButton } from './TransitionButton';

interface PillSelectProps {
  value: string;
  label: string;
  options: { value: string; label: string }[];
  onSelect: (value: string) => void;
  saving?: boolean;
  pillStyle?: React.CSSProperties;
  'data-testid'?: string;
}

function PillSelect({
  value,
  label,
  options,
  onSelect,
  saving,
  pillStyle,
  'data-testid': testId,
}: PillSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        data-testid={testId}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'inline-flex items-center gap-1 h-6 px-2.5 rounded-full text-[11.5px] border cursor-pointer',
          'hover:brightness-110 hover:opacity-90 transition-opacity',
          saving && 'opacity-50 cursor-wait',
        )}
        style={pillStyle}
        title={`Change ${label}`}
      >
        {value}
        <span className="text-[9px] opacity-60">▾</span>
      </button>
      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 min-w-[120px] rounded-md border border-line bg-bg-elev shadow-md py-1">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                onSelect(o.value);
                setOpen(false);
              }}
              className={cn(
                'w-full text-left px-3 py-1.5 text-[12px] hover:bg-bg-hover',
                o.value === value ? 'text-fg font-medium' : 'text-fg-2',
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface TaskHeaderProps {
  item?: WorkItemDto;
  projectSlug: string;
}

export function TaskHeader({ item, projectSlug }: TaskHeaderProps) {
  const queryClient = useQueryClient();
  const [savingPriority, setSavingPriority] = useState(false);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [savingMilestone, setSavingMilestone] = useState(false);

  const { data: milestones = [] } = useQuery<MilestoneDto[]>({
    queryKey: ['milestones', projectSlug],
    queryFn: () => fetchMilestones(projectSlug),
    enabled: item != null,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['issue', projectSlug, item?.externalId] });
    void queryClient.invalidateQueries({ queryKey: ['issues', projectSlug] });
  };

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
    <div data-testid="task-header" className="px-6 py-4 border-b border-line bg-bg-elev shrink-0">
      <div className="flex items-start gap-4">
        <div className="flex items-center grow min-w-0 gap-4">
          {/* <div className="flex items-center gap-2 mb-1.5 text-[11px] text-fg-3">
            <span className="font-mono uppercase tracking-wider">#{item?.externalId}</span>
            <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
            <span className="font-mono">{item?.repoRef}</span>
          </div> */}
          <h1 className="text-[22px] font-semibold tracking-tight leading-tight text-fg">
            {item?.title}
          </h1>
        </div>
      </div>
      <div className="flex items-center gap-3 mt-3 text-[11.5px] text-fg-3 flex-wrap">
        <span>by {item?.authorIsOwner ? 'owner' : 'guest'}</span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span>opened {item?.createdAt ? new Date(item?.createdAt).toLocaleString() : ''}</span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span title="Cost tracking available in M9" data-testid="cost-placeholder">
          cost <span className="font-mono">$—</span>
        </span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span title="Duration tracking available in M9" data-testid="duration-placeholder">
          duration <span className="font-mono">—</span>
        </span>
        {/* Type — static, leftmost */}
        <span className="inline-flex items-center h-6 px-2.5 rounded-full text-[11.5px] bg-bg-elev border border-line text-fg-2 capitalize">
          {item?.type}
        </span>

        <div className="flex grow" />
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
  );
}
