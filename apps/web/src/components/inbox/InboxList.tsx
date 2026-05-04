import {
  deleteInboxItem,
  fetchInboxItems,
  fetchMilestones,
  fetchProjects,
  promoteInboxItem,
} from '@/lib/api';
import type { InboxItemDto, MilestoneDto, ProjectSummary } from '@/lib/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ChevronDown, Inbox, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

// ---------------------------------------------------------------------------
// Two-step promote modal
// ---------------------------------------------------------------------------

type ModalStep = 'picker' | 'confirm';

function PromoteModal({
  item,
  onClose,
}: {
  item: InboxItemDto;
  onClose: () => void;
}) {
  const [step, setStep] = useState<ModalStep>('picker');
  const [selectedSlug, setSelectedSlug] = useState<string>('');
  const [selectedMilestoneNumber, setSelectedMilestoneNumber] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const {
    data: projects = [],
    isLoading: projectsLoading,
    error: projectsError,
  } = useQuery<ProjectSummary[]>({
    queryKey: ['projects'],
    queryFn: () => fetchProjects(),
  });

  const {
    data: milestones = [],
    isLoading: milestonesLoading,
    isError: milestonesError,
    isSuccess: milestonesLoaded,
  } = useQuery<MilestoneDto[]>({
    queryKey: ['milestones', selectedSlug],
    queryFn: () => fetchMilestones(selectedSlug),
    enabled: !!selectedSlug,
  });

  // Reset to null while milestones are loading (or when no project selected);
  // auto-select the first active milestone once the list arrives.
  useEffect(() => {
    if (!selectedSlug || !milestonesLoaded) {
      setSelectedMilestoneNumber(null);
      return;
    }
    const active = milestones.find((m) => m.isActive);
    setSelectedMilestoneNumber(active?.number ?? null);
  }, [selectedSlug, milestones, milestonesLoaded]);

  // Only send an explicit milestoneNumber once we have a confirmed loaded list.
  // While loading or on error, omit it so the server falls back to its persisted active milestone.
  const milestoneArg = milestonesLoaded && !milestonesError ? selectedMilestoneNumber : undefined;

  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => promoteInboxItem(item.id, selectedSlug, milestoneArg),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['inbox'] });
      onClose();
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Promotion failed');
    },
  });

  const selectedProject = projects.find((p) => p.slug === selectedSlug);
  const selectedMilestone = milestones.find((m) => m.number === selectedMilestoneNumber);

  function handlePickerNext() {
    if (!selectedSlug) return;
    setStep('confirm');
  }

  function handleBack() {
    setStep('picker');
    setError(null);
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.45)',
      }}
      onClick={onClose}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div
        data-testid="promote-modal"
        style={{
          background: 'var(--bg-elev)',
          border: '1px solid var(--line)',
          borderRadius: 8,
          padding: 24,
          width: '100%',
          maxWidth: 440,
        }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        {step === 'picker' ? (
          <>
            <h2 style={{ margin: '0 0 8px', fontSize: 15, fontWeight: 600 }}>Promote to project</h2>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--fg-2)' }}>
              Select which project to promote &ldquo;{item.title}&rdquo; into.
            </p>

            {projectsLoading && (
              <p style={{ fontSize: 13, color: 'var(--fg-3)', marginBottom: 16 }}>
                Loading projects…
              </p>
            )}

            {projectsError && (
              <p style={{ fontSize: 13, color: 'var(--danger)', marginBottom: 16 }}>
                Failed to load projects.
              </p>
            )}

            {!projectsLoading && !projectsError && (
              <>
                <div style={{ position: 'relative', marginBottom: 16 }}>
                  <select
                    aria-label="Select project"
                    data-testid="promote-project-select"
                    value={selectedSlug}
                    onChange={(e) => setSelectedSlug(e.target.value)}
                    style={{
                      appearance: 'none',
                      width: '100%',
                      height: 32,
                      paddingLeft: 12,
                      paddingRight: 32,
                      background: 'var(--bg)',
                      border: '1px solid var(--line)',
                      borderRadius: 6,
                      fontSize: 12.5,
                      color: 'var(--fg)',
                      cursor: 'pointer',
                    }}
                  >
                    <option value="" disabled>
                      — choose a project —
                    </option>
                    {projects.map((p) => (
                      <option key={p.slug} value={p.slug}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    size={13}
                    style={{
                      pointerEvents: 'none',
                      position: 'absolute',
                      right: 8,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: 'var(--fg-3)',
                    }}
                  />
                </div>

                {selectedSlug && (
                  <div style={{ marginBottom: 16 }}>
                    <p style={{ margin: '0 0 6px', fontSize: 12, color: 'var(--fg-3)' }}>
                      Milestone (optional)
                    </p>
                    {milestonesLoading ? (
                      <p style={{ fontSize: 12, color: 'var(--fg-3)', margin: 0 }}>
                        Loading milestones…
                      </p>
                    ) : (
                      <div style={{ position: 'relative' }}>
                        <select
                          aria-label="Select milestone"
                          data-testid="promote-milestone-select"
                          value={selectedMilestoneNumber ?? ''}
                          onChange={(e) => {
                            const val = e.target.value;
                            setSelectedMilestoneNumber(val === '' ? null : Number(val));
                          }}
                          style={{
                            appearance: 'none',
                            width: '100%',
                            height: 32,
                            paddingLeft: 12,
                            paddingRight: 32,
                            background: 'var(--bg)',
                            border: '1px solid var(--line)',
                            borderRadius: 6,
                            fontSize: 12.5,
                            color: 'var(--fg)',
                            cursor: 'pointer',
                          }}
                        >
                          <option value="">— no milestone —</option>
                          {milestones.map((m) => (
                            <option key={m.number} value={m.number}>
                              {m.title}
                            </option>
                          ))}
                        </select>
                        <ChevronDown
                          size={13}
                          style={{
                            pointerEvents: 'none',
                            position: 'absolute',
                            right: 8,
                            top: '50%',
                            transform: 'translateY(-50%)',
                            color: 'var(--fg-3)',
                          }}
                        />
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                onClick={onClose}
                style={{
                  padding: '5px 14px',
                  borderRadius: 6,
                  border: '1px solid var(--line)',
                  background: 'var(--bg)',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="promote-next"
                onClick={handlePickerNext}
                disabled={!selectedSlug}
                style={{
                  padding: '5px 14px',
                  borderRadius: 6,
                  border: 'none',
                  background: 'var(--accent, #6366f1)',
                  color: '#fff',
                  fontSize: 13,
                  cursor: !selectedSlug ? 'not-allowed' : 'pointer',
                  opacity: !selectedSlug ? 0.5 : 1,
                }}
              >
                Next
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <button
                type="button"
                onClick={handleBack}
                aria-label="Back"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '2px 6px',
                  borderRadius: 4,
                  border: '1px solid var(--line)',
                  background: 'var(--bg)',
                  cursor: 'pointer',
                  color: 'var(--fg-2)',
                }}
              >
                <ArrowLeft size={13} />
              </button>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Confirm promotion</h2>
            </div>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--fg-2)' }}>
              &ldquo;{item.title}&rdquo; will be created as a GitHub issue in{' '}
              <strong>{selectedProject?.name ?? selectedSlug}</strong>
              {selectedMilestone ? (
                <>
                  {' '}
                  under milestone <strong>{selectedMilestone.title}</strong>
                </>
              ) : null}
              .
            </p>
            {error && (
              <p style={{ color: 'var(--danger)', fontSize: 12, marginBottom: 12 }}>{error}</p>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                onClick={onClose}
                style={{
                  padding: '5px 14px',
                  borderRadius: 6,
                  border: '1px solid var(--line)',
                  background: 'var(--bg)',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="promote-confirm"
                onClick={() => mutation.mutate()}
                disabled={mutation.isPending}
                style={{
                  padding: '5px 14px',
                  borderRadius: 6,
                  border: 'none',
                  background: 'var(--accent, #6366f1)',
                  color: '#fff',
                  fontSize: 13,
                  cursor: mutation.isPending ? 'not-allowed' : 'pointer',
                  opacity: mutation.isPending ? 0.7 : 1,
                }}
              >
                {mutation.isPending ? 'Promoting…' : 'Promote'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail panel
// ---------------------------------------------------------------------------

function InboxDetail({
  item,
  onPromote,
  onDelete,
}: {
  item: InboxItemDto;
  onPromote: (item: InboxItemDto) => void;
  onDelete: (item: InboxItemDto) => void;
}) {
  return (
    <div className="flex flex-col h-full overflow-y-auto px-8 py-6">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="flex-1 min-w-0">
          <h2 className="text-[17px] font-semibold text-fg leading-snug mb-2">{item.title}</h2>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono uppercase tracking-wider text-fg-4 border border-line rounded px-1.5 py-0.5">
              {item.type}
            </span>
            <span className="text-[12px] text-fg-4">
              {new Date(item.createdAt).toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            data-testid="promote-button"
            onClick={() => onPromote(item)}
            className="h-8 px-4 rounded-md border border-line text-[12px] text-fg-2 hover:text-fg hover:bg-bg-hover"
          >
            Promote
          </button>
          <button
            type="button"
            data-testid="delete-button"
            onClick={() => onDelete(item)}
            aria-label="Delete inbox item"
            className="h-8 w-8 flex items-center justify-center rounded-md border border-line text-fg-3 hover:text-danger hover:border-danger/50 hover:bg-danger/5"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div className="border-t border-line pt-6">
        {item.body ? (
          <p className="text-[13px] text-fg-2 leading-relaxed whitespace-pre-wrap">{item.body}</p>
        ) : (
          <p className="text-[13px] text-fg-4 italic">No description.</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function InboxEmpty() {
  return (
    <div data-testid="inbox-empty" className="flex h-full items-center justify-center">
      <div className="text-center">
        <div className="flex justify-center mb-4">
          <Inbox size={40} className="text-fg-4" />
        </div>
        <p className="text-[15px] font-medium text-fg-2 mb-1">Inbox is empty</p>
        <p className="text-[13px] text-fg-4">Use the Capture button in the top bar to add ideas.</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function InboxList() {
  const [promoting, setPromoting] = useState<InboxItemDto | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const {
    data: items = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ['inbox'],
    queryFn: fetchInboxItems,
  });

  useEffect(() => {
    function handleCreated(e: Event) {
      const { id } = (e as CustomEvent<{ id: number }>).detail;
      setSelectedId(id);
    }
    window.addEventListener('inbox:item-created', handleCreated);
    return () => window.removeEventListener('inbox:item-created', handleCreated);
  }, []);

  const queryClient = useQueryClient();
  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteInboxItem(id),
    onSuccess: () => {
      setSelectedId(null);
      void queryClient.invalidateQueries({ queryKey: ['inbox'] });
    },
  });

  function handleDelete(item: InboxItemDto) {
    if (!window.confirm(`Delete "${item.title}"? This cannot be undone.`)) return;
    deleteMutation.mutate(item.id);
  }

  if (isLoading) return <div className="px-8 py-10 text-fg-3">Loading inbox…</div>;
  if (error)
    return <div className="px-8 py-10 text-[color:var(--danger)]">Failed to load inbox.</div>;
  if (items.length === 0) return <InboxEmpty />;

  const effectiveId = selectedId ?? items[0].id;
  const selectedItem = items.find((i) => i.id === effectiveId) ?? items[0];

  return (
    <div data-testid="inbox-list" className="flex h-full">
      {/* Left panel — list */}
      <div className="w-[35%] border-r border-line flex flex-col min-h-0">
        <div className="px-4 py-4 border-b border-line shrink-0">
          <h1 className="text-[14px] font-semibold text-fg">Inbox</h1>
        </div>
        <ol className="flex-1 overflow-y-auto p-2 flex flex-col gap-0.5">
          {items.map((item) => {
            const isSelected = item.id === effectiveId;
            return (
              <li key={item.id} data-testid="inbox-item" data-inbox-id={item.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  className={[
                    'w-full text-left rounded-md px-3 py-2.5 transition-colors',
                    isSelected
                      ? 'bg-accent/10 border border-accent/30'
                      : 'border border-transparent hover:bg-bg-hover',
                  ].join(' ')}
                >
                  <div
                    className={[
                      'text-[12.5px] font-medium truncate',
                      isSelected ? 'text-fg' : 'text-fg-2',
                    ].join(' ')}
                  >
                    {item.title}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10.5px] font-mono uppercase tracking-wider text-fg-4 border border-line rounded px-1 py-0.5">
                      {item.type}
                    </span>
                    <span className="text-[11px] text-fg-4">
                      {new Date(item.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      {/* Right panel — detail */}
      <div className="flex-1 min-w-0 min-h-0 bg-bg-elev/30">
        <InboxDetail item={selectedItem} onPromote={setPromoting} onDelete={handleDelete} />
      </div>

      {promoting && <PromoteModal item={promoting} onClose={() => setPromoting(null)} />}
    </div>
  );
}
