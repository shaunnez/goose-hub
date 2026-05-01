import { transitionState } from '@/lib/api';
import { cn } from '@/lib/cn';
import { GATE_STATES } from '@/lib/constants';
import { ShieldAlert } from 'lucide-react';
import { useState } from 'react';

export { GATE_STATES } from '@/lib/constants';

const GATE_ACTIONS: Record<string, { approve?: string; reject?: string; requestChanges?: string }> =
  {
    'factory:prd-review': { approve: 'factory:decomposing' },
    'factory:needs-review': {
      approve: 'factory:approved',
      reject: 'factory:rejected',
      requestChanges: 'factory:needs-fix',
    },
    'factory:approved': { approve: 'factory:retrospecting' },
    'factory:needs-human': {},
  };

export { GATE_ACTIONS };

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

  if (!state || !(state in GATE_STATES)) return null;

  const message = GATE_STATES[state];
  const actions = GATE_ACTIONS[state] ?? {};

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

  return (
    <div
      data-testid="gate-pending-banner"
      className={cn(
        'flex items-center gap-2.5 px-6 py-2.5 shrink-0',
        'border-b border-[color:var(--warning)]/40',
        'bg-[color:var(--warning)]/10 text-[color:var(--warning)]',
        'text-[12.5px] font-medium',
      )}
    >
      <ShieldAlert size={14} className="shrink-0" />
      <span>{message}</span>
      {error && <span className="text-[color:var(--danger)] ml-2">{error}</span>}
      <span className="grow" />
      <span className="flex items-center gap-2">
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
  );
}
