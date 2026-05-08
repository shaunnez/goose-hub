import { fetchEvents } from '@/lib/api';
import { cn } from '@/lib/cn';
import { PENDING_NEXT_RUN_STATES } from '@/lib/constants';
import type { AgentEventDto } from '@/lib/types';
import { useQuery } from '@tanstack/react-query';
import { Clock } from 'lucide-react';

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
  let lastStartedIdx = -1;
  for (let i = 0; i < events.length; i++) {
    if (events[i].kind === 'agent.run-started') lastStartedIdx = i;
  }
  if (lastStartedIdx === -1) return false;
  for (let i = lastStartedIdx + 1; i < events.length; i++) {
    if (TERMINAL_EVENTS.has(events[i].kind)) return false;
  }
  return true;
}

interface PendingNextRunBannerProps {
  state?: string;
  projectSlug?: string;
  id?: string;
}

export function PendingNextRunBanner({ state, projectSlug, id }: PendingNextRunBannerProps) {
  const skillName = state != null ? PENDING_NEXT_RUN_STATES[state] : undefined;

  const { data: events = [] } = useQuery({
    queryKey: ['events', projectSlug, id],
    queryFn: () => fetchEvents(projectSlug ?? '', id ?? ''),
    enabled: skillName != null && !!projectSlug && !!id,
    refetchInterval: 5000,
  });

  if (skillName == null) return null;
  if (computeIsLive(events)) return null;

  return (
    <div
      data-testid="pending-next-run-banner"
      className={cn(
        'flex items-center gap-2.5 px-6 py-2.5 shrink-0',
        'border-b border-fg-3/20 bg-fg-3/5',
        'text-[12.5px] font-medium text-fg-3',
      )}
    >
      <Clock size={14} className="shrink-0" />
      <span>Next run pending · {skillName}</span>
    </div>
  );
}
