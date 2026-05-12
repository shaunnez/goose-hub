import { fetchEvents, resumeIssue } from '@/lib/api';
import { cn } from '@/lib/cn';
import { PENDING_NEXT_RUN_STATES } from '@/lib/constants';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Clock, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { computeIsLive, computeIsWritePrdStuck } from '../lib/timeline';

interface PendingNextRunBannerProps {
  state?: string;
  projectSlug?: string;
  id?: string;
}

export function PendingNextRunBanner({ state, projectSlug, id }: PendingNextRunBannerProps) {
  const skillName = state != null ? PENDING_NEXT_RUN_STATES[state] : undefined;
  const [retrying, setRetrying] = useState(false);

  const { data: events = [] } = useQuery({
    queryKey: ['events', projectSlug, id],
    queryFn: () => fetchEvents(projectSlug ?? '', id ?? ''),
    enabled: skillName != null && !!projectSlug && !!id,
    refetchInterval: 5000,
  });

  if (skillName == null) return null;
  if (computeIsLive(events)) return null;

  const isStuck = computeIsWritePrdStuck(events);

  const handleRetry = async () => {
    if (retrying || !projectSlug || !id) return;
    setRetrying(true);
    try {
      await resumeIssue(projectSlug, id);
    } finally {
      setRetrying(false);
    }
  };

  if (isStuck) {
    return (
      <div
        data-testid="pending-next-run-banner"
        className={cn(
          'flex items-center gap-2.5 px-6 py-2.5 shrink-0',
          'border-b border-amber-500/30 bg-amber-500/10',
          'text-[12.5px] font-medium text-amber-400',
        )}
      >
        <AlertTriangle size={14} className="shrink-0" />
        <span className="flex-1">
          Write PRD stalled — completed without advancing state. Retry to re-run write-prd
          directly (grill context preserved).
        </span>
        <button
          type="button"
          onClick={handleRetry}
          disabled={retrying}
          className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30 disabled:opacity-50 transition-colors"
        >
          <RefreshCw size={10} className={retrying ? 'animate-spin' : ''} />
          {retrying ? 'Dispatching…' : 'Retry'}
        </button>
      </div>
    );
  }

  return (
    <div
      data-testid="pending-next-run-banner"
      className={cn(
        'flex items-center gap-2.5 px-6 py-2.5 shrink-0',
        'border-b border-fg-3/20 bg-fg-3/5',
        'text-[12.5px] font-medium text-info',
      )}
    >
      <Clock size={14} className="shrink-0" />
      <span>Next run pending · {skillName}</span>
    </div>
  );
}
