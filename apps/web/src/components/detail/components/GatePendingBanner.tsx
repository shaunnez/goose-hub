import { fetchEvents, transitionState } from '@/lib/api';
import { cn } from '@/lib/cn';
import { GATE_STATES } from '@/lib/constants';
import type { AgentEventDto } from '@/lib/types';
import { useQuery } from '@tanstack/react-query';
import { ShieldAlert } from 'lucide-react';
import { useState } from 'react';

export { GATE_STATES } from '@/lib/constants';

const GATE_ACTIONS: Record<
  string,
  {
    approve?: string;
    reject?: string;
    requestChanges?: string;
    sendToTriage?: string;
    sendToDev?: string;
    sendToQA?: string;
  }
> = {
  'factory:prd-review': { approve: 'factory:decomposing' },
  'factory:needs-review': {
    approve: 'factory:approved',
    reject: 'factory:rejected',
    requestChanges: 'factory:needs-fix',
  },
  'factory:approved': { approve: 'factory:retrospecting' },
  'factory:needs-human': {
    sendToTriage: 'factory:triaging',
    sendToDev: 'factory:dev-ready',
    sendToQA: 'factory:needs-qa',
    reject: 'factory:rejected',
  },
};

export { GATE_ACTIONS };

function extractReason(events: AgentEventDto[]): string | null {
  const last = [...events].reverse().find((e) => e.kind === 'agent.decision-summary');
  if (!last) return null;
  const p = last.payload as Record<string, unknown>;
  if (typeof p.summary === 'string') return p.summary.slice(0, 120);
  return JSON.stringify(p).slice(0, 120);
}

interface GatePendingBannerProps {
  state?: string;
  projectSlug?: string;
  id?: string;
  onTransitioned?: () => void;
}

export function GatePendingBanner({
  state,
  projectSlug,
  id,
  onTransitioned,
}: GatePendingBannerProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isNeedsHuman = state === 'factory:needs-human';

  const { data: events = [] } = useQuery({
    queryKey: ['events', projectSlug, id],
    queryFn: () => fetchEvents(projectSlug ?? '', id ?? ''),
    enabled: isNeedsHuman && !!projectSlug && !!id,
  });

  if (!state || !(state in GATE_STATES)) return null;

  const message = GATE_STATES[state];
  const actions = GATE_ACTIONS[state] ?? {};
  const reason = isNeedsHuman ? extractReason(events) : null;

  const handleAction = async (target: string) => {
    if (!projectSlug || !id) return;
    setBusy(true);
    setError(null);
    try {
      const result = await transitionState(projectSlug, id, state, target);
      if (result.status >= 400) {
        setError(
          (result.data as { error?: string }).error ?? `Transition failed (${result.status})`,
        );
      } else {
        onTransitioned?.();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  const isDanger = isNeedsHuman;

  return (
    <div
      data-testid="gate-pending-banner"
      className={cn(
        'flex flex-col px-6 py-2.5 shrink-0',
        'border-b',
        'text-[12.5px] font-medium',
        isDanger
          ? 'border-[color:var(--danger)]/40 bg-[color:var(--danger)]/10 text-[color:var(--danger)]'
          : 'border-[color:var(--warning)]/40 bg-[color:var(--warning)]/10 text-[color:var(--warning)]',
      )}
    >
      <div className="flex items-center gap-2.5">
        <ShieldAlert size={14} className="shrink-0" />
        <span>{message}</span>
        {error && <span className="text-[color:var(--danger)] ml-2">{error}</span>}
        <span className="grow" />
        <span className="flex items-center gap-2">
          {actions.sendToTriage && (
            <button
              type="button"
              disabled={busy}
              data-testid="gate-action-send-to-triage"
              onClick={() => void handleAction(actions.sendToTriage ?? '')}
              className={cn(
                'h-6 px-2.5 rounded text-[11.5px] font-medium border',
                'border-[color:var(--danger)]/60 text-[color:var(--danger)]',
                'hover:bg-[color:var(--danger)]/20',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              )}
            >
              Triage
            </button>
          )}
          {actions.sendToDev && (
            <button
              type="button"
              disabled={busy}
              data-testid="gate-action-send-to-dev"
              onClick={() => void handleAction(actions.sendToDev ?? '')}
              className={cn(
                'h-6 px-2.5 rounded text-[11.5px] font-medium border',
                'border-[color:var(--danger)]/60 text-[color:var(--danger)]',
                'hover:bg-[color:var(--danger)]/20',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              )}
            >
              Dev
            </button>
          )}
          {actions.sendToQA && (
            <button
              type="button"
              disabled={busy}
              data-testid="gate-action-send-to-qa"
              onClick={() => void handleAction(actions.sendToQA ?? '')}
              className={cn(
                'h-6 px-2.5 rounded text-[11.5px] font-medium border',
                'border-[color:var(--danger)]/60 text-[color:var(--danger)]',
                'hover:bg-[color:var(--danger)]/20',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              )}
            >
              QA
            </button>
          )}
          {actions.requestChanges && (
            <button
              type="button"
              disabled={busy}
              data-testid="gate-action-request-changes"
              onClick={() => void handleAction(actions.requestChanges ?? '')}
              className={cn(
                'h-6 px-2.5 rounded text-[11.5px] font-medium border',
                'border-[color:var(--warning)]/60 text-[color:var(--warning)]',
                'hover:bg-[color:var(--warning)]/20',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              )}
            >
              Request Changes
            </button>
          )}
          {actions.reject && (
            <button
              type="button"
              disabled={busy}
              data-testid="gate-action-reject"
              onClick={() => void handleAction(actions.reject ?? '')}
              className={cn(
                'h-6 px-2.5 rounded text-[11.5px] font-medium border',
                'border-[color:var(--danger)]/60 text-[color:var(--danger)]',
                'hover:bg-[color:var(--danger)]/20',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              )}
            >
              Reject
            </button>
          )}
          {actions.approve && (
            <button
              type="button"
              disabled={busy}
              data-testid="gate-action-approve"
              onClick={() => void handleAction(actions.approve ?? '')}
              className={cn(
                'h-6 px-2.5 rounded text-[11.5px] font-medium border',
                'border-[color:var(--accent)]/60 text-[color:var(--accent)]',
                'hover:bg-[color:var(--accent)]/20',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              )}
            >
              Approve
            </button>
          )}
        </span>
      </div>
      {reason && (
        <p
          data-testid="escalation-reason"
          className="mt-1 pl-[22px] text-[11.5px] opacity-70 italic font-normal truncate"
        >
          {reason}
        </p>
      )}
    </div>
  );
}
