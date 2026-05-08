import {
  createMilestone,
  deleteMilestone,
  fetchActiveMilestone,
  fetchMilestones,
  fetchSprintReviewEligibility,
  triggerSprintReview,
  updateMilestone,
} from '@/lib/api';
import type { MilestoneDto, SprintReviewEligibility } from '@/lib/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, Pencil, Play, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface Props {
  slug: string;
}

const MILESTONE_RE = /^M\d+:\s+\S/;

function maxMilestoneNumber(milestones: MilestoneDto[]): number {
  return milestones.reduce((max, m) => {
    const n = Number.parseInt(m.title.match(/^M(\d+)/)?.[1] ?? '0', 10);
    return Math.max(max, n);
  }, 0);
}

function SprintReviewButton({
  slug,
  milestone,
  onFired,
}: {
  slug: string;
  milestone: MilestoneDto;
  onFired: () => void;
}) {
  const queryClient = useQueryClient();
  const { data: elig, isLoading } = useQuery<SprintReviewEligibility>({
    queryKey: ['sprint-review-eligibility', slug, milestone.number],
    queryFn: () => fetchSprintReviewEligibility(slug, milestone.number),
    staleTime: 30_000,
  });

  const [error, setError] = useState<string | null>(null);
  const [issueUrl, setIssueUrl] = useState<string | null>(null);

  const fire = useMutation({
    mutationFn: () => triggerSprintReview(slug, milestone.title),
    onSuccess: (data) => {
      setIssueUrl(data.issueUrl);
      void queryClient.invalidateQueries({
        queryKey: ['sprint-review-eligibility', slug, milestone.number],
      });
      onFired();
    },
    onError: (err: Error) => setError(err.message),
  });

  if (isLoading) return <span className="text-[11px] text-fg-3">…</span>;
  if (!elig) return null;

  const resolvedUrl = issueUrl ?? elig.existingIssueUrl ?? null;

  if (elig.alreadyExists || issueUrl != null) {
    return (
      <span className="text-[11px] text-fg-3 flex items-center gap-1">
        <Play size={10} />
        {resolvedUrl != null ? (
          <a
            href={resolvedUrl}
            target="_blank"
            rel="noreferrer"
            className="hover:text-fg underline underline-offset-2 transition-colors"
          >
            Review done
          </a>
        ) : (
          'Review done'
        )}
      </span>
    );
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <button
        type="button"
        disabled={!elig.eligible || fire.isPending}
        title={elig.eligible ? 'Trigger sprint review' : elig.reason}
        onClick={() => fire.mutate()}
        className={[
          'flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded transition-colors',
          elig.eligible && !fire.isPending
            ? 'text-fg hover:bg-bg-hover cursor-pointer'
            : 'text-fg-3 cursor-not-allowed',
        ].join(' ')}
      >
        <Play size={10} />
        Sprint Review
      </button>
      {error != null && <span className="text-[10px] text-danger">{error}</span>}
    </div>
  );
}

interface RowProps {
  slug: string;
  milestone: MilestoneDto;
  isActive: boolean;
  onMutated: () => void;
}

function MilestoneRow({ slug, milestone, isActive, onMutated }: RowProps) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(milestone.title);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['milestones', slug] });
    onMutated();
  };

  const rename = useMutation({
    mutationFn: (title: string) => updateMilestone(slug, milestone.number, { title }),
    onSuccess: () => {
      setEditing(false);
      invalidate();
    },
    onError: (err: Error) => setRowError(err.message),
  });

  const toggle = useMutation({
    mutationFn: () =>
      updateMilestone(slug, milestone.number, {
        state: milestone.state === 'open' ? 'closed' : 'open',
      }),
    onSuccess: invalidate,
    onError: (err: Error) => setRowError(err.message),
  });

  const remove = useMutation({
    mutationFn: () => deleteMilestone(slug, milestone.number),
    onSuccess: () => {
      invalidate();
      void queryClient.invalidateQueries({ queryKey: ['active-milestone', slug] });
    },
    onError: (err: Error) => {
      setConfirmDelete(false);
      setRowError(err.message);
    },
  });

  const canDelete = milestone.openIssues + milestone.closedIssues === 0;

  function handleRenameKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      if (MILESTONE_RE.test(editTitle) && editTitle !== milestone.title) {
        rename.mutate(editTitle);
      } else if (!MILESTONE_RE.test(editTitle)) {
        setRowError('Title must match M<N>: <name>');
      }
    }
    if (e.key === 'Escape') {
      setEditing(false);
      setEditTitle(milestone.title);
    }
  }

  return (
    <div
      className={[
        'flex items-center gap-2 py-1.5 px-2 rounded-md border-l-2 text-[12px]',
        isActive ? 'border-accent bg-accent-soft' : 'border-transparent',
      ].join(' ')}
    >
      <div className="flex-1 min-w-0">
        {editing ? (
          <input
            ref={inputRef}
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onKeyDown={handleRenameKeyDown}
            onBlur={() => {
              if (MILESTONE_RE.test(editTitle) && editTitle !== milestone.title) {
                rename.mutate(editTitle);
              } else {
                setEditing(false);
                setEditTitle(milestone.title);
              }
            }}
            className="w-full bg-bg border border-line rounded px-1.5 py-0.5 text-[12px] font-mono focus:outline-none focus:border-accent"
          />
        ) : (
          <span className="font-mono truncate">{milestone.title}</span>
        )}
      </div>

      <span
        className={[
          'text-[10px] px-1 py-0.5 rounded uppercase tracking-wider shrink-0',
          milestone.state === 'open' ? 'bg-success/10 text-success' : 'bg-fg-3/10 text-fg-3',
        ].join(' ')}
      >
        {milestone.state}
      </span>

      {milestone.state === 'open' && (
        <SprintReviewButton
          slug={slug}
          milestone={milestone}
          onFired={() => void queryClient.invalidateQueries({ queryKey: ['milestones', slug] })}
        />
      )}

      {confirmDelete ? (
        <span className="flex items-center gap-1.5 text-[11px] shrink-0">
          <span className="text-fg-2">Delete? Cannot be undone.</span>
          <button
            type="button"
            onClick={() => setConfirmDelete(false)}
            className="text-fg-2 hover:text-fg"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => remove.mutate()}
            className="text-danger hover:text-danger/80 font-medium"
          >
            Delete
          </button>
        </span>
      ) : (
        <span className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            title="Rename"
            onClick={() => {
              setEditing(true);
              setEditTitle(milestone.title);
            }}
            className="p-1 text-fg-3 hover:text-fg rounded transition-colors"
          >
            <Pencil size={11} />
          </button>
          <button
            type="button"
            title={milestone.state === 'open' ? 'Close milestone' : 'Reopen milestone'}
            onClick={() => toggle.mutate()}
            disabled={toggle.isPending}
            className="p-1 text-fg-3 hover:text-fg rounded transition-colors"
          >
            {milestone.state === 'open' ? <ChevronDown size={11} /> : <ChevronUp size={11} />}
          </button>
          <button
            type="button"
            title={canDelete ? 'Delete milestone' : 'Milestone has issues'}
            disabled={!canDelete}
            onClick={() => setConfirmDelete(true)}
            className={[
              'p-1 rounded transition-colors',
              canDelete ? 'text-fg-3 hover:text-danger' : 'text-fg-3/30 cursor-not-allowed',
            ].join(' ')}
          >
            <Trash2 size={11} />
          </button>
        </span>
      )}

      {rowError != null && <span className="text-[10px] text-danger ml-1">{rowError}</span>}
    </div>
  );
}

export function MilestonesPanel({ slug }: Props) {
  const queryClient = useQueryClient();
  const { data: activeMilestoneData } = useQuery({
    queryKey: ['active-milestone', slug],
    queryFn: ({ signal }) => fetchActiveMilestone(slug, signal),
  });
  const activeNumber = activeMilestoneData?.milestoneNumber ?? null;
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const addInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showAdd) addInputRef.current?.focus();
  }, [showAdd]);

  const { data: milestones = [], isLoading } = useQuery<MilestoneDto[]>({
    queryKey: ['milestones', slug],
    queryFn: ({ signal }) => fetchMilestones(slug, signal),
  });

  function nextTitle() {
    const n = maxMilestoneNumber(milestones) + 1;
    return `M${n}: `;
  }

  function handleOpenAdd() {
    setNewTitle(nextTitle());
    setAddError(null);
    setShowAdd(true);
  }

  const add = useMutation({
    mutationFn: (title: string) => createMilestone(slug, title),
    onSuccess: () => {
      setShowAdd(false);
      setNewTitle('');
      void queryClient.invalidateQueries({ queryKey: ['milestones', slug] });
    },
    onError: (err: Error) => setAddError(err.message),
  });

  function handleAddSubmit() {
    if (!MILESTONE_RE.test(newTitle)) {
      setAddError('Title must match M<N>: <name>');
      return;
    }
    add.mutate(newTitle);
  }

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[11px] uppercase tracking-wider text-fg-2">Milestones</h3>
        {!showAdd && (
          <button
            type="button"
            onClick={handleOpenAdd}
            className="text-[11px] text-fg-2 hover:text-fg px-1.5 py-0.5 rounded hover:bg-bg-hover transition-colors"
          >
            + Add
          </button>
        )}
      </div>

      {isLoading && <div className="text-[12px] text-fg-3 py-2">Loading…</div>}

      {showAdd && (
        <div className="flex items-center gap-2 mb-2 px-2 py-1.5">
          <input
            ref={addInputRef}
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddSubmit();
              if (e.key === 'Escape') setShowAdd(false);
            }}
            placeholder="M14: Sprint Name"
            className="flex-1 bg-bg border border-line rounded px-1.5 py-0.5 text-[12px] font-mono focus:outline-none focus:border-accent"
          />
          <button
            type="button"
            disabled={!MILESTONE_RE.test(newTitle) || add.isPending}
            onClick={handleAddSubmit}
            className="text-[11px] px-2 py-0.5 rounded bg-accent text-white disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Create
          </button>
          <button
            type="button"
            onClick={() => setShowAdd(false)}
            className="text-[11px] text-fg-2 hover:text-fg"
          >
            Cancel
          </button>
          {addError != null && <span className="text-[10px] text-danger">{addError}</span>}
        </div>
      )}

      <div className="flex flex-col gap-0.5">
        {milestones.map((m) => (
          <MilestoneRow
            key={m.number}
            slug={slug}
            milestone={m}
            isActive={m.number === activeNumber}
            onMutated={() => void queryClient.invalidateQueries({ queryKey: ['milestones', slug] })}
          />
        ))}
      </div>

      {!isLoading && milestones.length === 0 && (
        <p className="text-[12px] text-fg-3 py-2">No milestones found.</p>
      )}
    </div>
  );
}
