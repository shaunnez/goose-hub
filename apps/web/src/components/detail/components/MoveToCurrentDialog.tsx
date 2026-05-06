import { fetchIssue, fetchProjects, setLabel } from '@/lib/api';
import { parseDependencies } from '@/lib/dependency-parser';
import type { ProjectSummary, WorkItemDto } from '@/lib/types';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// ─── helpers (mirrors DependenciesSection / useHasOpenDep) ───────────────────

function isOpenState(state: string): boolean {
  return state !== 'factory:done' && state !== 'factory:archived';
}

function resolveDepTarget(
  ref: { repoRef: string | null; issueNumber: number },
  currentSlug: string,
  currentRepoRef: string,
  projects: ProjectSummary[],
): { slug: string; id: string } | 'unregistered' {
  if (ref.repoRef === null || ref.repoRef === currentRepoRef) {
    return { slug: currentSlug, id: String(ref.issueNumber) };
  }
  const match = projects.find((p) => p.source.repo === ref.repoRef);
  if (match == null) return 'unregistered';
  return { slug: match.slug, id: String(ref.issueNumber) };
}

// ─── types ───────────────────────────────────────────────────────────────────

interface MovableDep {
  issueNumber: number;
  refLabel: string;
  title: string;
  slug: string;
  id: string;
}

// ─── component ───────────────────────────────────────────────────────────────

interface MoveToCurrentDialogProps {
  item: WorkItemDto;
  projectSlug: string;
  /** Called after the issue (and any selected deps) have been moved. */
  onComplete: () => void;
  /** Called when the user cancels without moving. */
  onCancel: () => void;
}

/**
 * Shows a confirmation dialog when moving an issue to schedule:current and it
 * has open dependencies. If all deps are already closed or schedule:current the
 * dialog is skipped and the issue moves immediately.
 */
export function MoveToCurrentDialog({
  item,
  projectSlug,
  onComplete,
  onCancel,
}: MoveToCurrentDialogProps) {
  const [phase, setPhase] = useState<'loading' | 'dialog' | 'working'>('loading');
  const [movableDeps, setMovableDeps] = useState<MovableDep[]>([]);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [error, setError] = useState('');
  // Guards against StrictMode double-firing and subsequent data refreshes re-triggering.
  const triggered = useRef(false);

  const deps = useMemo(
    () => parseDependencies(item.body).filter((d) => d.type === 'depends-on'),
    [item.body],
  );

  const { data: projects = [] } = useQuery<ProjectSummary[]>({
    queryKey: ['projects'],
    queryFn: fetchProjects,
    enabled: deps.length > 0,
  });

  const targets = useMemo(
    () => deps.map((ref) => resolveDepTarget(ref, projectSlug, item.repoRef, projects)),
    [deps, projectSlug, item.repoRef, projects],
  );

  const depQueries = useQueries({
    queries: deps.map((ref, i) => {
      const target = targets[i];
      return {
        queryKey: ['dep-issue', ref.repoRef ?? item.repoRef, ref.issueNumber],
        queryFn: async (): Promise<WorkItemDto | null> => {
          if (target === 'unregistered') return null;
          return fetchIssue(target.slug, target.id);
        },
        enabled: target !== 'unregistered',
      };
    }),
  });

  const allLoaded =
    deps.length === 0 ||
    (depQueries.length > 0 && depQueries.every((q) => !q.isLoading && !q.isPending));

  // Compute movable deps as a memoized value so the effect dep array stays stable.
  const movableComputed = useMemo((): MovableDep[] | null => {
    if (!allLoaded) return null;
    if (deps.length > 0 && projects.length === 0) return null;

    const movable: MovableDep[] = [];
    for (let i = 0; i < deps.length; i++) {
      const ref = deps[i];
      const target = targets[i];
      const depItem = depQueries[i]?.data;

      if (target === 'unregistered') continue;
      if (!depItem) continue;
      if (!isOpenState(depItem.state)) continue;
      if (depItem.schedule === 'current') continue;

      movable.push({
        issueNumber: ref.issueNumber,
        refLabel: ref.repoRef != null ? `${ref.repoRef}#${ref.issueNumber}` : `#${ref.issueNumber}`,
        title: depItem.title,
        slug: (target as { slug: string; id: string }).slug,
        id: (target as { slug: string; id: string }).id,
      });
    }
    return movable;
    // depQueries is intentionally included to recompute when query results arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allLoaded, deps, targets, depQueries, projects.length]);

  const doMove = useCallback(
    async (depsToMove: MovableDep[]) => {
      setPhase('working');
      setError('');
      try {
        for (const dep of depsToMove) {
          await setLabel(dep.slug, dep.id, 'schedule', 'current');
        }
        await setLabel(projectSlug, item.externalId, 'schedule', 'current');
        onComplete();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Move failed.');
        setPhase('dialog');
      }
    },
    [projectSlug, item.externalId, onComplete],
  );

  // When movableComputed transitions from null → array, decide whether to
  // show the dialog or auto-proceed. Runs at most once (triggered ref).
  useEffect(() => {
    if (movableComputed === null || triggered.current) return;
    triggered.current = true;

    if (movableComputed.length === 0) {
      void doMove([]);
    } else {
      setMovableDeps(movableComputed);
      setChecked(new Set(movableComputed.map((d) => d.issueNumber)));
      setPhase('dialog');
    }
  }, [movableComputed, doMove]);

  const handleConfirm = () => {
    const selected = movableDeps.filter((d) => checked.has(d.issueNumber));
    void doMove(selected);
  };

  const toggleDep = (issueNumber: number) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(issueNumber)) next.delete(issueNumber);
      else next.add(issueNumber);
      return next;
    });
  };

  return (
    <div
      style={overlayStyle}
      onClick={phase === 'loading' ? onCancel : undefined}
      onKeyDown={(e) => e.key === 'Escape' && onCancel()}
      data-testid="move-to-current-dialog"
    >
      <div
        style={panelStyle}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
      >
        {phase === 'loading' && (
          <p style={{ color: 'var(--fg-2)', fontSize: 13, margin: 0 }}>Checking dependencies…</p>
        )}

        {(phase === 'dialog' || phase === 'working') && (
          <>
            <h2 style={{ margin: '0 0 10px', fontSize: 15, fontWeight: 600 }}>
              Move to current sprint
            </h2>
            <p style={{ fontSize: 13, color: 'var(--fg-2)', margin: '0 0 12px' }}>
              This issue has open dependencies. Select which to move to{' '}
              <code style={{ fontSize: 12 }}>schedule:current</code> together:
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
              {movableDeps.map((dep) => (
                <label
                  key={dep.issueNumber}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    cursor: phase === 'working' ? 'not-allowed' : 'pointer',
                    fontSize: 13,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked.has(dep.issueNumber)}
                    onChange={() => toggleDep(dep.issueNumber)}
                    disabled={phase === 'working'}
                    data-testid={`dep-checkbox-${dep.issueNumber}`}
                  />
                  <span style={{ fontFamily: 'monospace', color: 'var(--accent)', flexShrink: 0 }}>
                    {dep.refLabel}
                  </span>
                  <span
                    style={{
                      color: 'var(--fg)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={dep.title}
                  >
                    {dep.title}
                  </span>
                </label>
              ))}
            </div>

            {error && (
              <p style={{ fontSize: 12, color: 'var(--danger, #e05)', margin: '0 0 12px' }}>
                {error}
              </p>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                onClick={onCancel}
                disabled={phase === 'working'}
                style={cancelBtnStyle}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={phase === 'working'}
                data-testid="move-confirm-btn"
                style={confirmBtnStyle}
              >
                {phase === 'working' ? 'Moving…' : 'Move to current'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── styles ──────────────────────────────────────────────────────────────────

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 50,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(0,0,0,0.45)',
};

const panelStyle: React.CSSProperties = {
  background: 'var(--bg-elev)',
  border: '1px solid var(--line)',
  borderRadius: 8,
  padding: 24,
  width: '100%',
  maxWidth: 480,
  color: 'var(--fg)',
};

const cancelBtnStyle: React.CSSProperties = {
  padding: '5px 14px',
  borderRadius: 6,
  border: '1px solid var(--line)',
  background: 'var(--bg)',
  color: 'var(--fg-2)',
  fontSize: 13,
  cursor: 'pointer',
};

const confirmBtnStyle: React.CSSProperties = {
  padding: '5px 14px',
  borderRadius: 6,
  border: 'none',
  background: 'var(--accent, #6366f1)',
  color: '#fff',
  fontSize: 13,
  cursor: 'pointer',
};
