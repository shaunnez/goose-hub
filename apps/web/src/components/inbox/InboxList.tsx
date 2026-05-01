import { fetchInboxItems, promoteInboxItem } from '@/lib/api';
import type { InboxItemDto } from '@/lib/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

function PromoteModal({
  item,
  projectSlug,
  onClose,
}: {
  item: InboxItemDto;
  projectSlug: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => promoteInboxItem(item.id, projectSlug),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['inbox'] });
      onClose();
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Promotion failed');
    },
  });

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
        <h2 style={{ margin: '0 0 8px', fontSize: 15, fontWeight: 600 }}>Promote to project</h2>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--fg-2)' }}>
          &ldquo;{item.title}&rdquo; will be created as a GitHub issue in{' '}
          <strong>goose-hub-self</strong>.
        </p>
        {error && <p style={{ color: 'var(--danger)', fontSize: 12, marginBottom: 12 }}>{error}</p>}
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
      </div>
    </div>
  );
}

interface InboxListProps {
  projectSlug?: string;
}

export function InboxList({ projectSlug = 'goose-hub-self' }: InboxListProps) {
  const [promoting, setPromoting] = useState<InboxItemDto | null>(null);
  const {
    data: items = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ['inbox'],
    queryFn: fetchInboxItems,
  });

  if (isLoading) return <div className="px-8 py-10 text-fg-3">Loading inbox…</div>;
  if (error)
    return <div className="px-8 py-10 text-[color:var(--danger)]">Failed to load inbox.</div>;
  if (items.length === 0) {
    return (
      <div data-testid="inbox-empty" className="px-8 py-16 text-center text-fg-3 text-[13px]">
        <p className="mb-2 font-medium text-fg-2">Inbox is empty</p>
        <p>Use the Capture button in the top bar to add ideas.</p>
      </div>
    );
  }

  return (
    <div data-testid="inbox-list" className="px-8 py-6 max-w-[860px]">
      <h1 className="text-[15px] font-semibold mb-6">Inbox</h1>
      <ol className="flex flex-col gap-2">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex items-center gap-4 rounded-md border border-line bg-bg-elev/60 px-4 py-3"
          >
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-medium text-fg truncate">{item.title}</div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[11px] font-mono uppercase tracking-wider text-fg-4 border border-line rounded px-1.5 py-0.5">
                  {item.type}
                </span>
                <span className="text-[11px] text-fg-4">
                  {new Date(item.createdAt).toLocaleDateString()}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setPromoting(item)}
              className="h-7 px-3 rounded-md border border-line text-[12px] text-fg-2 hover:text-fg hover:bg-bg-hover shrink-0"
            >
              Promote
            </button>
          </li>
        ))}
      </ol>
      {promoting && (
        <PromoteModal
          item={promoting}
          projectSlug={projectSlug}
          onClose={() => setPromoting(null)}
        />
      )}
    </div>
  );
}
