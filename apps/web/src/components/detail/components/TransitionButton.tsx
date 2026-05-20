import { fetchLegalTargets, transitionState } from '@/lib/api';
import { interventionKeys } from '@/lib/query-keys';
import type { WorkItemDto } from '@/lib/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

interface TransitionButtonProps {
  projectSlug: string;
  id: string;
  currentState: string;
}

export function TransitionButton({ projectSlug, id, currentState }: TransitionButtonProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    data: legalTargets,
    isLoading,
    isError,
  } = useQuery({
    queryKey: interventionKeys.legalTargets(projectSlug, id),
    queryFn: () => fetchLegalTargets(projectSlug, id),
  });

  const targets = legalTargets?.legalTargets ?? [];
  const fromState = legalTargets?.from ?? currentState;

  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [open]);

  if (isLoading) {
    return (
      <button
        type="button"
        disabled
        data-testid="transition-button-loading"
        className="h-6 px-2.5 rounded-full text-[11.5px] border border-line text-fg-2 cursor-wait"
      >
        Loading transitions
      </button>
    );
  }

  if (isError || targets.length === 0) {
    return (
      <button
        type="button"
        disabled
        title={
          isError
            ? 'Could not load legal next states'
            : `Terminal state: ${fromState} has no legal next states`
        }
        data-testid="transition-button-disabled"
        className="h-6 px-2.5 rounded-full text-[11.5px] border border-line text-fg-2 cursor-not-allowed"
      >
        No transitions
      </button>
    );
  }

  const invalidateTransitionQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['issues', projectSlug] }),
      queryClient.invalidateQueries({ queryKey: ['issue', projectSlug, id] }),
      queryClient.invalidateQueries({ queryKey: interventionKeys.legalTargets(projectSlug, id) }),
    ]);
  };

  const onPick = async (to: string) => {
    setBusy(true);
    setError(null);

    queryClient.setQueryData<WorkItemDto>(['issue', projectSlug, id], (prev) =>
      prev != null ? { ...prev, state: to } : prev,
    );
    setOpen(false);

    const { status, data } = await transitionState(projectSlug, id, fromState, to);
    setBusy(false);

    if (status >= 200 && status < 300) {
      await invalidateTransitionQueries();
      return;
    }

    await invalidateTransitionQueries();
    setOpen(true);
    setError(data.error ?? `Transition failed (${status})`);
  };

  return (
    <div className="relative">
      <button
        type="button"
        data-testid="transition-button"
        onClick={() => setOpen((o) => !o)}
        disabled={busy}
        className="h-6 px-2.5 rounded-full text-[11.5px] bg-accent text-[color:var(--accent-fg)] hover:brightness-110 disabled:opacity-60 inline-flex items-center font-medium border border-accent-line"
      >
        Transition
      </button>
      {open && (
        <div
          data-testid="transition-popover"
          className="absolute right-0 mt-1 z-20 min-w-[220px] rounded-md border border-line bg-bg-elev shadow-md py-1"
        >
          <div className="px-3 py-1 text-[10.5px] uppercase tracking-wider text-fg-2">
            Legal next states
          </div>
          {targets.map((target) => (
            <button
              key={target}
              type="button"
              data-testid={`transition-target-${target}`}
              onClick={() => void onPick(target)}
              className="w-full text-left px-3 py-1.5 text-[12.5px] text-fg-2 hover:text-fg hover:bg-bg-hover font-mono"
            >
              {target}
            </button>
          ))}
          {error != null && (
            <div className="px-3 py-2 text-[11.5px] text-[color:var(--danger)] border-t border-line mt-1">
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
