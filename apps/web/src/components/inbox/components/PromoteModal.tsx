import { fetchMilestones, fetchProjects, promoteInboxItem } from '@/lib/api';
import type { InboxItemDto, MilestoneDto, ProjectSummary } from '@/lib/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ChevronDown } from 'lucide-react';
import { useEffect, useState } from 'react';
import { resolveActiveMilestone } from '../lib/promote';

type ModalStep = 'picker' | 'confirm';

interface PromoteModalProps {
  item: InboxItemDto;
  onClose: () => void;
}

export function PromoteModal({ item, onClose }: PromoteModalProps) {
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
    setSelectedMilestoneNumber(resolveActiveMilestone(milestones));
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
