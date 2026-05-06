import { transitionState } from '@/lib/api';
import { LEGAL_TARGETS } from '@/lib/transitions';
import type { WorkItemDto } from '@/lib/types';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

interface TransitionButtonProps {
  projectSlug: string;
  id: string;
  currentState: string;
}

export function TransitionButton({ projectSlug, id, currentState }: TransitionButtonProps) {
  const queryClient = useQueryClient();
  const targets = LEGAL_TARGETS[currentState] ?? [];
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [open]);

  if (targets.length === 0) {
    return (
      <button
        type="button"
        disabled
        title={`Terminal state: ${currentState} has no legal next states`}
        data-testid="transition-button-disabled"
        className="h-6 px-2.5 rounded-full text-[11.5px] border border-line text-fg-2 cursor-not-allowed"
      >
        No transitions
      </button>
    );
  }

  const onPick = async (to: string) => {
    setBusy(true);
    setError(null);
    const original = currentState;

    // Optimistic: update the cached item immediately.
    queryClient.setQueryData<WorkItemDto>(['issue', projectSlug, id], (prev) =>
      prev != null ? { ...prev, state: to } : prev,
    );
    setOpen(false);

    const { status, data } = await transitionState(projectSlug, id, original, to);
    setBusy(false);

    if (status >= 200 && status < 300) {
      // Bust the board cache so it reflects the new state on next visit.
      void queryClient.invalidateQueries({ queryKey: ['issues', projectSlug] });
      return;
    }

    // Revert: refetch the true state from the server.
    void queryClient.invalidateQueries({ queryKey: ['issue', projectSlug, id] });
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
          {targets.map((t) => (
            <button
              key={t}
              type="button"
              data-testid={`transition-target-${t}`}
              onClick={() => void onPick(t)}
              className="w-full text-left px-3 py-1.5 text-[12.5px] text-fg-2 hover:text-fg hover:bg-bg-hover font-mono"
            >
              {t}
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
