import { type MilestoneDto, addComment, fetchMilestones, setLabel, setMilestone } from '@/lib/api';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

interface ManualActionsProps {
  projectSlug: string;
  id: string;
}

type ActionStatus = 'idle' | 'loading' | 'saved' | 'error';

function useActionState() {
  const [status, setStatus] = useState<ActionStatus>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setStatus('loading');
    setErrorMsg(null);
    try {
      await fn();
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 2000);
    } catch (e) {
      setStatus('error');
      setErrorMsg(e instanceof Error ? e.message : 'Unknown error');
    }
  };

  return { status, errorMsg, run };
}

function StatusBadge({ status, errorMsg }: { status: ActionStatus; errorMsg: string | null }) {
  if (status === 'loading') {
    return <span className="text-[11px] text-fg-3">Saving...</span>;
  }
  if (status === 'saved') {
    return <span className="text-[11px] text-[color:var(--success,#4ade80)]">Saved</span>;
  }
  if (status === 'error') {
    return (
      <span className="text-[11px] text-[color:var(--danger)] truncate max-w-[200px]">
        {errorMsg}
      </span>
    );
  }
  return null;
}

function AddCommentForm({ projectSlug, id }: ManualActionsProps) {
  const [text, setText] = useState('');
  const { status, errorMsg, run } = useActionState();
  const textareaId = `comment-body-${id}`;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    await run(() => addComment(projectSlug, id, text.trim()));
    setText('');
  };

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-1.5">
      <label
        htmlFor={textareaId}
        className="text-[11px] font-medium text-fg-2 uppercase tracking-wider"
      >
        Add comment
      </label>
      <textarea
        id={textareaId}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Write a comment..."
        rows={3}
        className="w-full rounded-md border border-line bg-bg text-[12.5px] px-2.5 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-accent placeholder:text-fg-4"
      />
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={status === 'loading' || !text.trim()}
          className="h-7 px-3 rounded-md text-[12px] bg-accent text-[color:var(--accent-fg)] hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
        >
          Post
        </button>
        <StatusBadge status={status} errorMsg={errorMsg} />
      </div>
    </form>
  );
}

function AssignMilestoneForm({ projectSlug, id }: ManualActionsProps) {
  const queryClient = useQueryClient();
  const { data: milestones = [] } = useQuery<MilestoneDto[]>({
    queryKey: ['milestones', projectSlug],
    queryFn: () => fetchMilestones(projectSlug),
  });
  const [selected, setSelected] = useState<string>('');
  const { status, errorMsg, run } = useActionState();
  const selectId = `milestone-select-${id}`;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const num = selected === 'none' ? null : Number(selected);
    await run(async () => {
      await setMilestone(projectSlug, id, num);
      void queryClient.invalidateQueries({ queryKey: ['issue', projectSlug, id] });
      void queryClient.invalidateQueries({ queryKey: ['issues', projectSlug] });
    });
  };

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-1.5">
      <label
        htmlFor={selectId}
        className="text-[11px] font-medium text-fg-2 uppercase tracking-wider"
      >
        Assign milestone
      </label>
      <div className="flex items-center gap-2">
        <select
          id={selectId}
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="h-7 rounded-md border border-line bg-bg text-[12.5px] px-2 focus:outline-none focus:ring-1 focus:ring-accent"
        >
          <option value="">Pick a milestone...</option>
          <option value="none">None</option>
          {milestones.map((m) => (
            <option key={m.number} value={String(m.number)}>
              {m.title}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={status === 'loading' || selected === ''}
          className="h-7 px-3 rounded-md text-[12px] bg-accent text-[color:var(--accent-fg)] hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
        >
          Set
        </button>
        <StatusBadge status={status} errorMsg={errorMsg} />
      </div>
    </form>
  );
}

function ChangePriorityForm({ projectSlug, id }: ManualActionsProps) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState('');
  const { status, errorMsg, run } = useActionState();
  const options = ['low', 'medium', 'high', 'critical'] as const;
  const selectId = `priority-select-${id}`;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!value) return;
    await run(async () => {
      await setLabel(projectSlug, id, 'priority', value);
      void queryClient.invalidateQueries({ queryKey: ['issue', projectSlug, id] });
      void queryClient.invalidateQueries({ queryKey: ['issues', projectSlug] });
    });
  };

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-1.5">
      <label
        htmlFor={selectId}
        className="text-[11px] font-medium text-fg-2 uppercase tracking-wider"
      >
        Change priority
      </label>
      <div className="flex items-center gap-2">
        <select
          id={selectId}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="h-7 rounded-md border border-line bg-bg text-[12.5px] px-2 focus:outline-none focus:ring-1 focus:ring-accent"
        >
          <option value="">Pick priority...</option>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={status === 'loading' || value === ''}
          className="h-7 px-3 rounded-md text-[12px] bg-accent text-[color:var(--accent-fg)] hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
        >
          Set
        </button>
        <StatusBadge status={status} errorMsg={errorMsg} />
      </div>
    </form>
  );
}

function ChangeScheduleForm({ projectSlug, id }: ManualActionsProps) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState('');
  const { status, errorMsg, run } = useActionState();
  const options = ['current', 'backlog', 'icebox'] as const;
  const selectId = `schedule-select-${id}`;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!value) return;
    await run(async () => {
      await setLabel(projectSlug, id, 'schedule', value);
      void queryClient.invalidateQueries({ queryKey: ['issue', projectSlug, id] });
      void queryClient.invalidateQueries({ queryKey: ['issues', projectSlug] });
    });
  };

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-1.5">
      <label
        htmlFor={selectId}
        className="text-[11px] font-medium text-fg-2 uppercase tracking-wider"
      >
        Change schedule
      </label>
      <div className="flex items-center gap-2">
        <select
          id={selectId}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="h-7 rounded-md border border-line bg-bg text-[12.5px] px-2 focus:outline-none focus:ring-1 focus:ring-accent"
        >
          <option value="">Pick schedule...</option>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={status === 'loading' || value === ''}
          className="h-7 px-3 rounded-md text-[12px] bg-accent text-[color:var(--accent-fg)] hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
        >
          Set
        </button>
        <StatusBadge status={status} errorMsg={errorMsg} />
      </div>
    </form>
  );
}

export function ManualActions({ projectSlug, id }: ManualActionsProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-line rounded-md bg-bg-elev">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-[12.5px] font-medium text-fg-2 hover:text-fg hover:bg-bg-hover rounded-md"
      >
        <span>Manual Actions</span>
        <span className="text-fg-4 text-[11px]">{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && (
        <div className="px-4 pb-4 flex flex-col gap-4 border-t border-line pt-4">
          <AddCommentForm projectSlug={projectSlug} id={id} />
          <AssignMilestoneForm projectSlug={projectSlug} id={id} />
          <ChangePriorityForm projectSlug={projectSlug} id={id} />
          <ChangeScheduleForm projectSlug={projectSlug} id={id} />
        </div>
      )}
    </div>
  );
}
